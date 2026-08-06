// economy.js — the market engine, the player's house, contracts and events.
// Pure logic: no DOM, no Three.js. The QA harness imports this into node and
// runs thousands of simulated voyages against it.
//
// THE MODEL
// Every port holds a *stock* of every good. Production adds to it daily,
// consumption drains it, and the price is a function of how far stock sits
// from that port's target holding:
//
//     spot = base x priceIndex x (target / stock) ^ volatility
//
// So a producing port drifts to a surplus and goes cheap; a consuming port
// drains to a deficit and goes dear. Buying 40 tuns genuinely empties the
// warehouse and the price genuinely climbs behind you, then recovers over the
// following days at the speed the port can actually produce. Nothing is faked
// with a random walk.

import { GOODS, GOOD, PORTS, PORT, SHIP, UPGRADE, passage, seasonOf } from "./world.js";

export { GOODS, GOOD, PORTS, PORT };

/* ---------------------------------------------------------------- rng ---- */
// Mulberry32. Deterministic, so a seed reproduces a whole campaign exactly,
// which is what makes the balance simulation in qa/sim.js meaningful.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* --------------------------------------------------------- price model ---- */

// How many days of throughput a port likes to keep on hand.
const COVER_DAYS = 22;
// Hard bounds on the price multiplier, so a drained port stays buyable.
const MULT_MIN = 0.45, MULT_MAX = 2.6;
// How fast other merchants arbitrage an imbalance away. You are faster, and
// that edge is the whole game — but if this is too low, a port that consumes a
// good it cannot produce pins to the price ceiling forever and the run becomes
// a money printer. At 0.09/day the background fleet keeps a consuming port
// around 1.5x fair and a producing port around 0.8x: a real margin, not a gift.
const BACKGROUND_TRADE = 0.09;

export class Market {
  constructor(seed = 1620) {
    this.rng = makeRng(seed);
    this.day = 1;
    this.stock = {};    // stock[portId][goodId]
    this.target = {};   // target[portId][goodId]
    this.history = {};  // history[portId][goodId] = last 40 days of spot
    this.events = [];

    for (const p of PORTS) {
      this.stock[p.id] = {};
      this.target[p.id] = {};
      this.history[p.id] = {};
      for (const g of GOODS) {
        const prod = p.produces?.[g.id] || 0;
        const cons = p.consumes?.[g.id] || 0;
        const throughput = Math.max(prod, cons, 2);
        this.target[p.id][g.id] = throughput * COVER_DAYS;
        this.history[p.id][g.id] = [];
      }
      // resting level needs target populated first
      for (const g of GOODS) {
        const rest = this.restingStock(p.id, g.id);
        this.stock[p.id][g.id] = Math.max(1, rest * (0.88 + this.rng() * 0.24));
      }
    }
    // Prime 40 days so the sparklines open with real history behind them.
    for (let i = 0; i < 40; i++) this.tick(1, { silent: true });
    this.day = 1;
  }

  /** Where stock settles if nobody trades: production against consumption. */
  restingStock(portId, goodId) {
    const p = PORT[portId];
    const prod = p.produces?.[goodId] || 0;
    const cons = p.consumes?.[goodId] || 0;
    const target = this.target[portId][goodId];
    if (prod === 0 && cons === 0) return target;
    // net + (target - rest) * BACKGROUND_TRADE = 0
    const rest = target + (prod - cons) / BACKGROUND_TRADE;
    return clamp(rest, target * 0.18, target * 2.6);
  }

  /** Fair price at a port, ignoring the current stock position. */
  fair(portId, goodId) {
    return GOOD[goodId].base * PORT[portId].priceIndex * this.eventPriceFactor(portId, goodId);
  }

  /** Live spot price, pounds per unit. */
  spot(portId, goodId) {
    const target = this.target[portId][goodId];
    const stock = Math.max(1, this.stock[portId][goodId]);
    const mult = clamp(Math.pow(target / stock, GOOD[goodId].vol), MULT_MIN, MULT_MAX);
    return Math.max(1, Math.round(this.fair(portId, goodId) * mult));
  }

  /** The brokers take their cut: you buy at the ask and sell at the bid. */
  spread(portId) {
    return clamp(0.03 + (PORT[portId].priceIndex - 1) * 0.06, 0.02, 0.075);
  }
  ask(portId, goodId) { return Math.max(1, Math.round(this.spot(portId, goodId) * (1 + this.spread(portId)))); }
  bid(portId, goodId) { return Math.max(1, Math.round(this.spot(portId, goodId) * (1 - this.spread(portId)))); }

  /** Cheap or dear here, measured against this good's Atlantic average. */
  role(portId, goodId) {
    const here = this.spot(portId, goodId);
    const avg = this.averageSpot(goodId);
    if (here < avg * 0.86) return "buy";
    if (here > avg * 1.14) return "sell";
    return "neutral";
  }

  averageSpot(goodId) {
    let sum = 0;
    for (const p of PORTS) sum += this.spot(p.id, goodId);
    return sum / PORTS.length;
  }

  /** Move stock. Positive adds to the warehouse, negative drains it. */
  moveStock(portId, goodId, qty) {
    const cap = this.target[portId][goodId] * 4;
    this.stock[portId][goodId] = clamp(this.stock[portId][goodId] + qty, 1, cap);
  }

  priceHistory(portId, goodId) { return this.history[portId][goodId]; }

  /* ------------------------------------------------------------ events ---- */

  eventPriceFactor(portId, goodId) {
    let f = 1;
    for (const e of this.events) {
      if (e.port !== portId) continue;
      if (e.good && e.good !== goodId) continue;
      f *= e.priceFactor ?? 1;
    }
    return f;
  }

  isBlockaded(portId) {
    return this.events.some((e) => e.port === portId && e.blockade);
  }

  eventsAt(portId) { return this.events.filter((e) => e.port === portId); }

  _maybeSpawnEvent() {
    if (this.rng() > 0.055) return null;
    const p = PORTS[Math.floor(this.rng() * PORTS.length)];
    const kinds = ["glut", "shortage", "blockade", "fever", "boom"];
    const kind = kinds[Math.floor(this.rng() * kinds.length)];
    const produced = Object.keys(p.produces || {});
    const consumed = Object.keys(p.consumes || {});

    let ev = null;
    if (kind === "glut" && produced.length) {
      const g = produced[Math.floor(this.rng() * produced.length)];
      ev = { kind, port: p.id, good: g, days: 14 + Math.floor(this.rng() * 20),
        stockPulse: this.target[p.id][g] * 0.9, priceFactor: 0.82,
        headline: `Bumper harvest at ${p.name}`,
        note: `${GOOD[g].name} floods the ${p.name} quays. Buy while it lasts.` };
    } else if (kind === "shortage" && consumed.length) {
      const g = consumed[Math.floor(this.rng() * consumed.length)];
      ev = { kind, port: p.id, good: g, days: 12 + Math.floor(this.rng() * 22),
        stockPulse: -this.target[p.id][g] * 0.62, priceFactor: 1.22,
        headline: `${GOOD[g].name} scarce at ${p.name}`,
        note: `${p.name} is short of ${GOOD[g].name.toLowerCase()}. They will pay for it.` };
    } else if (kind === "blockade") {
      ev = { kind, port: p.id, days: 8 + Math.floor(this.rng() * 14), blockade: true, priceFactor: 1.35,
        headline: `${p.name} blockaded`,
        note: `Warships off ${p.name}. No cargo moves until they lift.` };
    } else if (kind === "fever") {
      ev = { kind, port: p.id, days: 16 + Math.floor(this.rng() * 20), consumeFactor: 0.55, priceFactor: 0.9,
        headline: `Fever in ${p.name}`,
        note: `Sickness ashore. The town buys little and pays less.` };
    } else if (kind === "boom") {
      ev = { kind, port: p.id, days: 20 + Math.floor(this.rng() * 26), consumeFactor: 1.6, priceFactor: 1.12,
        headline: `${p.name} is building`,
        note: `New wharves and warehouses. The town is buying everything.` };
    }
    if (ev) {
      ev.id = `${ev.kind}-${p.id}-${this.day}`;
      ev.startedDay = this.day;
      if (ev.stockPulse) this.moveStock(p.id, ev.good, ev.stockPulse);
      this.events.push(ev);
    }
    return ev;
  }

  /** Harvests are not spread evenly through the year. */
  _seasonFactor(goodId) {
    const s = seasonOf(this.day);
    const table = {
      port_wine: { Autumn: 1.9, Summer: 1.1, Spring: 0.5, Winter: 0.4 },
      olive_oil: { Winter: 1.8, Autumn: 1.2, Spring: 0.6, Summer: 0.5 },
      sugar:     { Winter: 1.5, Spring: 1.3, Summer: 0.7, Autumn: 0.7 },
      cod:       { Summer: 1.6, Spring: 1.3, Autumn: 0.8, Winter: 0.5 },
      salt:      { Summer: 1.7, Spring: 1.0, Autumn: 0.7, Winter: 0.4 },
      timber:    { Winter: 1.4, Autumn: 1.2, Spring: 0.8, Summer: 0.7 },
    };
    return table[goodId]?.[s] ?? 1;
  }

  /** Advance the whole world by `days`. Returns any events that fired. */
  tick(days = 1, opts = {}) {
    const fired = [];
    for (let d = 0; d < days; d++) {
      this.day++;
      this.events = this.events.filter((e) => this.day - e.startedDay < e.days);

      for (const p of PORTS) {
        const ev = this.events.filter((e) => e.port === p.id);
        const consumeFactor = ev.reduce((f, e) => f * (e.consumeFactor ?? 1), 1);
        for (const g of GOODS) {
          const prod = (p.produces?.[g.id] || 0) * this._seasonFactor(g.id);
          const cons = (p.consumes?.[g.id] || 0) * consumeFactor;
          const target = this.target[p.id][g.id];
          let s = this.stock[p.id][g.id];
          s += prod - cons;
          s += (target - s) * BACKGROUND_TRADE;      // other merchants, slowly
          s *= 1 + (this.rng() - 0.5) * 0.018;       // never perfectly still
          this.stock[p.id][g.id] = clamp(s, 1, target * 4);
        }
      }

      if (!opts.silent) {
        const ev = this._maybeSpawnEvent();
        if (ev) fired.push(ev);
      }

      for (const p of PORTS) {
        for (const g of GOODS) {
          const h = this.history[p.id][g.id];
          h.push(this.spot(p.id, g.id));
          if (h.length > 40) h.shift();
        }
      }
    }
    return fired;
  }
}

/* ------------------------------------------------------------- the ship --- */

let shipCounter = 0;

export function makeShip(typeId, name) {
  const t = SHIP[typeId];
  return {
    uid: `${typeId}-${++shipCounter}`,
    type: typeId,
    name,
    hold: t.hold,
    speedKn: t.speedKn,
    crew: t.crew,
    seaworthy: t.seaworthy,
    masts: t.masts,
    rig: t.rig,
    armed: false,
    condition: 1.0,     // 1 = fresh out of the yard, 0.15 = fit for firewood
    wearRate: 1.0,
    upgrades: [],
    cargo: {},
    cost: {},
  };
}

export function holdUsed(ship) {
  let t = 0;
  for (const [g, q] of Object.entries(ship.cargo)) t += q * GOOD[g].bulk;
  return Math.round(t * 100) / 100;
}
export function holdFree(ship) { return Math.max(0, ship.hold - holdUsed(ship)); }
export function avgCost(ship, goodId) {
  const q = ship.cargo[goodId] || 0;
  return q > 0 ? (ship.cost[goodId] || 0) / q : 0;
}
/** A worn hull and a full hold both cost you speed. */
export function effectiveSpeed(ship) {
  const load = holdUsed(ship) / ship.hold;
  return ship.speedKn * (0.62 + 0.38 * ship.condition) * (1 - load * 0.16);
}

/* ------------------------------------------------------------- the house -- */

export const START_CASH = 1400;
const INTEREST_PER_DAY = 0.0016;   // roughly 63% a year. Lisbon is not kind.
const WAGE_PER_CREW_DAY = 0.55;

export class House {
  constructor(seed = 1620) {
    this.seed = seed;
    this.market = new Market(seed);
    this.rng = makeRng(seed ^ 0x9e37);
    this.cash = START_CASH;
    this.debt = 0;
    this.day = 1;
    this.location = "lisbon";
    this.fleet = [makeShip("caravel", "Andorinha")];
    this.activeShip = 0;
    this.reputation = Object.fromEntries(PORTS.map((p) => [p.id, p.home ? 25 : 0]));
    this.contracts = [];
    this.offers = [];
    this.log = [];
    this.milestones = [];
    this.stats = { voyages: 0, tunsTraded: 0, bestVoyage: 0, grossProfit: 0, wagesPaid: 0, interestPaid: 0 };
    this.refreshOffers();
  }

  get ship() { return this.fleet[this.activeShip]; }

  /** Standing: which ports and goods will deal with a house this size. */
  get tier() {
    const nw = this.netWorth();
    if (nw >= 45000) return 2;
    if (nw >= 9000) return 1;
    return 0;
  }

  portOpen(portId) { return PORT[portId].tier <= this.tier; }
  goodOpen(goodId) { return GOOD[goodId].tier <= this.tier; }

  netWorth() {
    let w = this.cash - this.debt;
    for (const s of this.fleet) {
      w += Math.round(SHIP[s.type].price * 0.72 * s.condition);
      for (const [g, q] of Object.entries(s.cargo)) w += q * this.market.bid(this.location, g);
    }
    return Math.round(w);
  }

  crewCount() { return this.fleet.reduce((n, s) => n + s.crew, 0); }
  dailyCosts() { return Math.round(this.crewCount() * WAGE_PER_CREW_DAY + this.debt * INTEREST_PER_DAY); }

  say(text, kind = "info") {
    this.log.unshift({ day: this.day, text, kind });
    if (this.log.length > 60) this.log.pop();
    return { ok: kind !== "bad", msg: text, kind };
  }

  /* --------------------------------------------------------- trading ---- */

  /** How many units of this good you could actually buy here, right now. */
  maxBuy(goodId) {
    const m = this.market, s = this.ship, port = this.location;
    if (!this.goodOpen(goodId) || m.isBlockaded(port)) return 0;
    const unit = m.ask(port, goodId);
    const byHold = Math.floor(holdFree(s) / GOOD[goodId].bulk);
    const byCash = Math.floor(this.cash / unit);
    const byStock = Math.floor(Math.max(0, m.stock[port][goodId] - m.target[port][goodId] * 0.08));
    return Math.max(0, Math.min(byHold, byCash, byStock));
  }

  buy(goodId, qty) {
    const m = this.market, s = this.ship, port = this.location;
    if (!this.goodOpen(goodId)) return this.say("No broker here will deal that with a house your size.", "bad");
    if (m.isBlockaded(port)) return this.say("The port is blockaded. Nothing moves.", "bad");

    const cap = this.maxBuy(goodId);
    qty = Math.min(Math.floor(qty), cap);
    if (qty <= 0) {
      if (holdFree(s) < GOOD[goodId].bulk) return this.say("No room left in the hold.", "bad");
      if (this.cash < m.ask(port, goodId)) return this.say("Not enough coin for that.", "bad");
      return this.say("The warehouse here is bare.", "bad");
    }

    // Buying a large parcel walks the price up as the warehouse empties.
    let spent = 0, left = qty;
    const step = Math.max(1, Math.ceil(qty / 8));
    while (left > 0) {
      const n = Math.min(step, left);
      spent += m.ask(port, goodId) * n;
      m.moveStock(port, goodId, -n);
      left -= n;
    }
    this.cash -= spent;
    s.cargo[goodId] = (s.cargo[goodId] || 0) + qty;
    s.cost[goodId] = (s.cost[goodId] || 0) + spent;
    this.stats.tunsTraded += qty;
    this.reputation[port] = Math.min(100, this.reputation[port] + qty * 0.04);
    const unit = Math.round(spent / qty);
    return this.say(`Bought ${qty} x ${GOOD[goodId].name} at £${unit} — £${spent.toLocaleString()}.`, "good");
  }

  sell(goodId, qty) {
    const m = this.market, s = this.ship, port = this.location;
    if (m.isBlockaded(port)) return this.say("The port is blockaded. Nothing moves.", "bad");

    qty = Math.min(Math.floor(qty), s.cargo[goodId] || 0);
    if (qty <= 0) return this.say("None of that in the hold.", "bad");

    // Selling a large parcel walks the price down as the warehouse fills.
    let gross = 0, left = qty;
    const step = Math.max(1, Math.ceil(qty / 8));
    while (left > 0) {
      const n = Math.min(step, left);
      gross += m.bid(port, goodId) * n;
      m.moveStock(port, goodId, n);
      left -= n;
    }
    const costPart = avgCost(s, goodId) * qty;
    this.cash += gross;
    s.cargo[goodId] -= qty;
    s.cost[goodId] = Math.max(0, (s.cost[goodId] || 0) - costPart);
    if (s.cargo[goodId] <= 0) { delete s.cargo[goodId]; delete s.cost[goodId]; }

    const profit = Math.round(gross - costPart);
    this.stats.grossProfit += profit;
    this.stats.tunsTraded += qty;
    this.reputation[port] = Math.min(100, this.reputation[port] + qty * 0.05);
    this._settleContracts(goodId, qty);

    const unit = Math.round(gross / qty);
    const tail = profit >= 0 ? `+£${profit.toLocaleString()}` : `−£${Math.abs(profit).toLocaleString()}`;
    return this.say(`Sold ${qty} x ${GOOD[goodId].name} at £${unit} — £${gross.toLocaleString()} (${tail}).`,
      profit >= 0 ? "good" : "bad");
  }

  /* ------------------------------------------------------------ credit ---- */

  creditLimit() {
    return Math.max(0, Math.round(Math.max(0, this.netWorth()) * 0.55 + this.reputation.lisbon * 40));
  }
  borrow(amount) {
    amount = Math.floor(Math.min(amount, this.creditLimit() - this.debt));
    if (amount <= 0) return this.say("The house will not extend you another penny.", "bad");
    this.cash += amount;
    this.debt += amount;
    return this.say(`Drew £${amount.toLocaleString()} on the Lisbon house. Interest runs daily.`, "info");
  }
  repay(amount) {
    amount = Math.floor(Math.min(amount, this.cash, this.debt));
    if (amount <= 0) return this.say("Nothing to repay, or nothing to repay it with.", "bad");
    this.cash -= amount;
    this.debt -= amount;
    return this.say(`Repaid £${amount.toLocaleString()}. Debt now £${Math.round(this.debt).toLocaleString()}.`, "good");
  }

  /* --------------------------------------------------------- shipyard ---- */

  buyShip(typeId, name) {
    const t = SHIP[typeId];
    if (!t) return this.say("No such hull.", "bad");
    if (t.price <= 0) return this.say("That hull is not for sale.", "bad");
    if (this.cash < t.price) return this.say(`A ${t.name} is £${t.price.toLocaleString()}. You are short.`, "bad");
    if (this.fleet.length >= 4) return this.say("Four hulls is all one house can crew.", "bad");
    this.cash -= t.price;
    this.fleet.push(makeShip(typeId, name || t.name));
    return this.say(`Bought a ${t.name} for £${t.price.toLocaleString()}. She joins the house.`, "good");
  }

  fitUpgrade(upgradeId) {
    const u = UPGRADE[upgradeId], s = this.ship;
    if (!u) return this.say("No such refit.", "bad");
    if (s.upgrades.includes(upgradeId)) return this.say("Already fitted.", "bad");
    if (this.cash < u.price) return this.say(`That refit is £${u.price.toLocaleString()}.`, "bad");
    this.cash -= u.price;
    s.upgrades.push(upgradeId);
    u.apply(s);
    return this.say(`${u.name} fitted to ${s.name}.`, "good");
  }

  careen() {
    const s = this.ship;
    if (s.condition > 0.985) return this.say("She is already sound.", "bad");
    const cost = Math.round((1 - s.condition) * 900 + 60);
    if (this.cash < cost) return this.say(`A careen and refit is £${cost.toLocaleString()}.`, "bad");
    this.cash -= cost;
    s.condition = 1;
    this.day += 3;
    this.market.tick(3);
    return this.say(`${s.name} careened and recaulked for £${cost.toLocaleString()}. Three days lost.`, "good");
  }

  switchShip(index) {
    if (index < 0 || index >= this.fleet.length) return this.say("No such hull in the fleet.", "bad");
    this.activeShip = index;
    return this.say(`${this.ship.name} is now your flag.`, "info");
  }

  /* -------------------------------------------------------- contracts ---- */

  refreshOffers() {
    this.offers = [];
    const openPorts = PORTS.filter((p) => this.portOpen(p.id) && p.id !== this.location);
    const n = 2 + Math.floor(this.rng() * 3);
    for (let i = 0; i < n && openPorts.length; i++) {
      const dest = openPorts[Math.floor(this.rng() * openPorts.length)];
      const wanted = Object.keys(dest.consumes || {}).filter((g) => this.goodOpen(g));
      if (!wanted.length) continue;
      const goodId = wanted[Math.floor(this.rng() * wanted.length)];
      const qty = 8 + Math.floor(this.rng() * 26);
      const p = passage(this.location, dest.id, effectiveSpeed(this.ship));
      const marketValue = this.market.spot(dest.id, goodId) * qty;
      const reward = Math.round(marketValue * (1.18 + this.rng() * 0.32));
      this.offers.push({
        id: `c${this.day}-${i}`,
        from: this.location, to: dest.id, goodId, qty, reward,
        dueDay: this.day + p.days + 6 + Math.floor(this.rng() * 10),
        penalty: Math.round(reward * 0.35),
        rep: 6 + Math.floor(this.rng() * 8),
      });
    }
  }

  acceptContract(offerId) {
    const i = this.offers.findIndex((o) => o.id === offerId);
    if (i < 0) return this.say("That commission is gone.", "bad");
    if (this.contracts.length >= 4) return this.say("Four commissions is enough to be carrying.", "bad");
    const c = this.offers.splice(i, 1)[0];
    c.delivered = 0;
    this.contracts.push(c);
    return this.say(`Signed: ${c.qty} x ${GOOD[c.goodId].name} to ${PORT[c.to].name} by day ${c.dueDay}.`, "info");
  }

  _settleContracts(goodId, qty) {
    for (const c of [...this.contracts]) {
      if (c.to !== this.location || c.goodId !== goodId) continue;
      const take = Math.min(c.qty - c.delivered, qty);
      c.delivered += take;
      qty -= take;
      if (c.delivered >= c.qty) {
        this.cash += c.reward;
        this.reputation[c.to] = Math.min(100, this.reputation[c.to] + c.rep);
        this.contracts = this.contracts.filter((x) => x !== c);
        this.say(`Commission complete at ${PORT[c.to].name}: £${c.reward.toLocaleString()} paid.`, "good");
      }
      if (qty <= 0) break;
    }
  }

  _expireContracts() {
    for (const c of [...this.contracts]) {
      if (this.day <= c.dueDay) continue;
      this.cash -= c.penalty;
      this.reputation[c.to] = Math.max(-50, this.reputation[c.to] - c.rep * 2);
      this.contracts = this.contracts.filter((x) => x !== c);
      this.say(`Commission to ${PORT[c.to].name} missed. £${c.penalty.toLocaleString()} forfeited.`, "bad");
    }
  }

  /* ---------------------------------------------------------- voyages ---- */

  /** Everything that happens between casting off and making fast. */
  completeVoyage(destId, opts = {}) {
    const s = this.ship;
    const p = passage(this.location, destId, effectiveSpeed(s));
    const days = opts.days ?? p.days;
    const before = this.netWorth();

    const wages = Math.round(this.crewCount() * WAGE_PER_CREW_DAY * days);
    this.cash -= wages;
    this.stats.wagesPaid += wages;
    const interest = Math.round(this.debt * INTEREST_PER_DAY * days);
    this.debt += interest;
    this.stats.interestPaid += interest;

    const spoiled = [];
    for (const [g, q] of Object.entries({ ...s.cargo })) {
      const rate = GOOD[g].perish;
      if (!rate) continue;
      const lost = Math.floor(q * (1 - Math.pow(1 - rate, days)));
      if (lost > 0) {
        s.cargo[g] -= lost;
        s.cost[g] = Math.max(0, (s.cost[g] || 0) - avgCost(s, g) * lost);
        if (s.cargo[g] <= 0) { delete s.cargo[g]; delete s.cost[g]; }
        spoiled.push(`${lost} x ${GOOD[g].name}`);
      }
    }

    s.condition = clamp(s.condition - days * 0.0042 * s.wearRate, 0.15, 1);
    const hazard = this._rollHazard(days, p.nm);

    this.day += days;
    this.market.tick(days);
    this.location = destId;
    this.stats.voyages++;
    this._expireContracts();
    this.refreshOffers();

    const after = this.netWorth();
    const delta = after - before;
    if (delta > this.stats.bestVoyage) this.stats.bestVoyage = delta;

    const notes = [`${days} days at sea. Wages £${wages.toLocaleString()}.`];
    if (interest > 0) notes.push(`Interest £${interest.toLocaleString()}.`);
    if (spoiled.length) notes.push(`Spoiled in the hold: ${spoiled.join(", ")}.`);
    if (hazard) notes.push(hazard.note);

    this._checkMilestones();
    return { days, wages, interest, spoiled, hazard, notes, netWorth: after, delta, passage: p };
  }

  _rollHazard(days, nm) {
    const s = this.ship;
    const risk = clamp((1 - s.seaworthy) * (0.55 + nm / 6000) * (1.35 - s.condition * 0.35), 0, 0.6);
    if (this.rng() > risk) return null;

    const kinds = s.armed ? ["storm", "storm", "calms"] : ["storm", "privateer", "calms"];
    const kind = kinds[Math.floor(this.rng() * kinds.length)];

    if (kind === "storm") {
      const lost = [];
      for (const [g, q] of Object.entries({ ...s.cargo })) {
        if (this.rng() > 0.45) continue;
        const n = Math.max(1, Math.floor(q * (0.12 + this.rng() * 0.25)));
        s.cargo[g] -= n;
        s.cost[g] = Math.max(0, (s.cost[g] || 0) - avgCost(s, g) * n);
        if (s.cargo[g] <= 0) { delete s.cargo[g]; delete s.cost[g]; }
        lost.push(`${n} x ${GOOD[g].name}`);
      }
      s.condition = clamp(s.condition - 0.08 - this.rng() * 0.12, 0.15, 1);
      const note = lost.length
        ? `A gale on the passage. Jettisoned ${lost.join(", ")} and started a seam.`
        : `A gale on the passage. She held, but she is the worse for it.`;
      this.say(note, "bad");
      return { kind, note };
    }
    if (kind === "privateer") {
      const toll = Math.max(0, Math.min(this.cash, Math.round(Math.max(0, this.netWorth()) * (0.03 + this.rng() * 0.07))));
      this.cash -= toll;
      const note = `A privateer under no flag you recognised. £${toll.toLocaleString()} bought him off.`;
      this.say(note, "bad");
      return { kind, note };
    }
    const extra = 2 + Math.floor(this.rng() * 5);
    this.day += extra;
    this.market.tick(extra);
    const wages = Math.round(this.crewCount() * WAGE_PER_CREW_DAY * extra);
    this.cash -= wages;
    const note = `Becalmed for ${extra} days. £${wages.toLocaleString()} in wages for nothing.`;
    this.say(note, "bad");
    return { kind, note };
  }

  _checkMilestones() {
    const nw = this.netWorth();
    const marks = [
      { at: 5000,   text: "£5,000. The house has a name on the Tagus." },
      { at: 9000,   text: "£9,000. Antwerp and the Brazil run will deal with you now." },
      { at: 20000,  text: "£20,000. Merchants who ignored you are sending letters." },
      { at: 45000,  text: "£45,000. The Guinea coast is open to you, and so is its risk." },
      { at: 100000, text: "£100,000. You are one of the great houses of the Atlantic." },
    ];
    for (const m of marks) {
      if (nw >= m.at && !this.milestones.includes(m.at)) {
        this.milestones.push(m.at);
        this.say(m.text, "milestone");
      }
    }
  }

  /** Ruined: nothing left to sell and the debt still running. */
  isRuined() {
    if (this.netWorth() > 0) return false;
    const anyCargo = this.fleet.some((s) => Object.keys(s.cargo).length > 0);
    return this.cash <= 0 && !anyCargo;
  }

  /* ------------------------------------------------------------- save ---- */

  toJSON() {
    return {
      v: 2, seed: this.seed, cash: this.cash, debt: this.debt, day: this.day, location: this.location,
      fleet: this.fleet, activeShip: this.activeShip, reputation: this.reputation,
      contracts: this.contracts, offers: this.offers, milestones: this.milestones,
      stats: this.stats, log: this.log.slice(0, 20),
      market: { day: this.market.day, stock: this.market.stock, events: this.market.events },
    };
  }

  static fromJSON(data) {
    const h = new House(data?.seed ?? 1620);
    if (!data || data.v !== 2) return h;
    Object.assign(h, {
      cash: data.cash, debt: data.debt, day: data.day, location: data.location,
      fleet: data.fleet, activeShip: data.activeShip, reputation: data.reputation,
      contracts: data.contracts, offers: data.offers, milestones: data.milestones,
      stats: data.stats, log: data.log || [],
    });
    if (data.market) {
      h.market.day = data.market.day;
      h.market.stock = data.market.stock;
      h.market.events = data.market.events;
    }
    return h;
  }
}

/* ------------------------------------------------------- opportunities ---- */

/** What a parcel actually fetches once its own weight moves the price. */
export function estimateRealised(market, portId, goodId, qty, side) {
  const saved = market.stock[portId][goodId];
  const step = Math.max(1, Math.ceil(qty / 8));
  let total = 0, left = qty;
  while (left > 0) {
    const n = Math.min(step, left);
    total += (side === "sell" ? market.bid(portId, goodId) : market.ask(portId, goodId)) * n;
    market.moveStock(portId, goodId, side === "sell" ? n : -n);
    left -= n;
  }
  market.stock[portId][goodId] = saved;
  return Math.round(total);
}

/**
 * The best runs visible from here, ranked by profit per day at sea.
 * The UI shows the top few as hints; qa/sim.js uses this as its trading AI.
 */
export function opportunities(house, limit = 6) {
  const m = house.market, from = house.location, s = house.ship;
  const out = [];
  for (const p of PORTS) {
    if (p.id === from || !house.portOpen(p.id) || m.isBlockaded(p.id)) continue;
    const leg = passage(from, p.id, effectiveSpeed(s));
    for (const g of GOODS) {
      if (!house.goodOpen(g.id)) continue;
      const qty = house.maxBuy(g.id);
      if (qty < 1) continue;
      const outlay = estimateRealised(m, from, g.id, qty, "buy");
      const revenue = estimateRealised(m, p.id, g.id, qty, "sell");
      const wages = house.crewCount() * WAGE_PER_CREW_DAY * leg.days;
      const net = revenue - outlay - wages;
      if (net <= 0) continue;
      out.push({
        to: p.id, goodId: g.id, qty, days: leg.days, nm: leg.nm,
        buy: Math.round(outlay / qty), sell: Math.round(revenue / qty),
        net: Math.round(net), perDay: Math.round(net / leg.days),
      });
    }
  }
  out.sort((a, b) => b.perDay - a.perDay);
  return out.slice(0, limit);
}

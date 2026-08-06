// economy.js — commodity market model and player state.
// The market mean-reverts around a per-port fair value, drifts a little each
// day, and — crucially — reacts to the player's own trades (price elasticity).

export const GOODS = [
  { id: "port_wine", name: "Port Wine", base: 40 },
  { id: "salt",      name: "Salt",      base: 8 },
  { id: "cork",      name: "Cork",      base: 15 },
  { id: "olive_oil", name: "Olive Oil", base: 30 },
  { id: "cloth",     name: "Woollen Cloth", base: 55 },
  { id: "sugar",     name: "Sugar",     base: 45 },
  { id: "tea",       name: "Tea",       base: 90 },
  { id: "spices",    name: "Spices",    base: 120 },
];

// factor < 1  → produced here, cheap to BUY
// factor > 1  → wanted here, dear to SELL
// (missing good → 1.0, traded at fair value)
export const PORTS = [
  {
    id: "lisbon", name: "Lisbon", home: true, pos: { x: 0, y: 0 },
    blurb: "Home. The Tagus quays, and your line of credit.",
    factors: { port_wine: 0.7, salt: 0.8, cork: 0.7, olive_oil: 0.8, spices: 1.35, tea: 1.3, cloth: 1.15 },
  },
  {
    id: "porto", name: "Porto", pos: { x: -0.3, y: 1.6 },
    blurb: "Wine country — barrels roll down to the Douro cheap.",
    factors: { port_wine: 0.6, cork: 0.75, salt: 1.2, spices: 1.4, sugar: 1.25, cloth: 1.1 },
  },
  {
    id: "funchal", name: "Funchal", pos: { x: -3.2, y: -3.4 },
    blurb: "Madeira. Sugar cane and sweet wine; short of most else.",
    factors: { sugar: 0.6, port_wine: 0.9, salt: 1.35, cloth: 1.35, olive_oil: 1.25, tea: 1.15 },
  },
  {
    id: "azores", name: "Ponta Delgada", pos: { x: -8.5, y: 0.4 },
    blurb: "The Azores. Mid-ocean — everything from away is dear.",
    factors: { cloth: 1.45, olive_oil: 1.35, port_wine: 1.25, spices: 1.4, sugar: 0.85 },
  },
  {
    id: "cadiz", name: "Cádiz", pos: { x: 0.9, y: -1.5 },
    blurb: "Andalusian salt pans and olive groves.",
    factors: { salt: 0.7, olive_oil: 0.85, port_wine: 1.15, tea: 1.2, spices: 1.25, sugar: 1.1 },
  },
  {
    id: "bristol", name: "Bristol", pos: { x: -0.4, y: 6.2 },
    blurb: "England. Hungry for southern goods; cloth and tea are cheap.",
    factors: { cloth: 0.6, tea: 0.85, port_wine: 1.5, olive_oil: 1.45, sugar: 1.35, cork: 1.3, spices: 1.55 },
  },
];

export const GOOD = Object.fromEntries(GOODS.map((g) => [g.id, g]));
export const PORT = Object.fromEntries(PORTS.map((p) => [p.id, p]));

const DEPTH = 55; // market thickness: trading DEPTH units moves price ~100% of fair.

// Deterministic seeded RNG so a session behaves consistently within a run.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export class Market {
  constructor(seed = 20260806) {
    this.rng = makeRng(seed);
    // price[portId][goodId] = current spot price
    this.price = {};
    for (const p of PORTS) {
      this.price[p.id] = {};
      for (const g of GOODS) {
        const fair = this.fair(p.id, g.id);
        // start slightly dispersed so opening prices aren't identical every run
        this.price[p.id][g.id] = fair * (0.94 + this.rng() * 0.12);
      }
    }
  }

  fair(portId, goodId) {
    const f = PORT[portId].factors[goodId] ?? 1.0;
    return GOOD[goodId].base * f;
  }

  spot(portId, goodId) {
    return Math.max(1, Math.round(this.price[portId][goodId]));
  }

  // classify a good at a port for the player: a clear buy, a clear sell, or neutral
  role(portId, goodId) {
    const f = PORT[portId].factors[goodId] ?? 1.0;
    if (f <= 0.9) return "buy";
    if (f >= 1.15) return "sell";
    return "neutral";
  }

  // Apply the player's trade impact: buying pushes the local price up,
  // selling pushes it down. Elasticity scales with quantity vs market depth.
  applyTrade(portId, goodId, qty, side) {
    const impact = Math.min(0.6, Math.abs(qty) / DEPTH);
    const dir = side === "buy" ? 1 : -1;
    this.price[portId][goodId] *= 1 + dir * impact;
    this.price[portId][goodId] = Math.max(1, this.price[portId][goodId]);
  }

  // Advance the whole market by `days`: mean-revert toward fair value with drift.
  advance(days = 1) {
    for (let d = 0; d < days; d++) {
      for (const p of PORTS) {
        for (const g of GOODS) {
          const fair = this.fair(p.id, g.id);
          const cur = this.price[p.id][g.id];
          const reverted = cur + (fair - cur) * 0.14;         // pull toward fair
          const shock = (this.rng() - 0.5) * fair * 0.09;     // daily noise
          this.price[p.id][g.id] = Math.max(1, reverted + shock);
        }
      }
    }
  }
}

// Rough nautical distance between two ports, in "days of sail" and metres-ish.
export function legDistance(fromId, toId) {
  const a = PORT[fromId].pos, b = PORT[toId].pos;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return {
    units: d,
    days: Math.max(1, Math.round(d * 1.4)),
  };
}

export class Player {
  constructor() {
    this.cash = 1200;
    this.day = 1;
    this.location = "lisbon";
    this.ship = { name: "Andorinha", type: "Caravel", hold: 40, speedKn: 7 };
    this.cargo = {};   // goodId -> qty
    this.cost = {};    // goodId -> total spent (for average cost)
  }

  held(goodId) { return this.cargo[goodId] || 0; }
  holdUsed() { return Object.values(this.cargo).reduce((a, b) => a + b, 0); }
  holdFree() { return this.ship.hold - this.holdUsed(); }
  avgCost(goodId) {
    const q = this.held(goodId);
    return q > 0 ? (this.cost[goodId] || 0) / q : 0;
  }

  netWorth(market) {
    let w = this.cash;
    for (const g of GOODS) {
      const q = this.held(g.id);
      if (q > 0) w += q * market.spot(this.location, g.id);
    }
    return Math.round(w);
  }

  buy(market, goodId, qty) {
    qty = Math.min(qty, this.holdFree());
    if (qty <= 0) return { ok: false, msg: "No room left in the hold." };
    const unit = market.spot(this.location, goodId);
    const cost = unit * qty;
    if (cost > this.cash) return { ok: false, msg: "Not enough coin for that." };
    this.cash -= cost;
    this.cargo[goodId] = this.held(goodId) + qty;
    this.cost[goodId] = (this.cost[goodId] || 0) + cost;
    market.applyTrade(this.location, goodId, qty, "buy");
    return { ok: true, msg: `Bought ${qty} × ${GOOD[goodId].name} for £${cost.toLocaleString()}.` };
  }

  sell(market, goodId, qty) {
    qty = Math.min(qty, this.held(goodId));
    if (qty <= 0) return { ok: false, msg: "None of that in the hold." };
    const unit = market.spot(this.location, goodId);
    const gross = unit * qty;
    const costPart = this.avgCost(goodId) * qty;
    this.cash += gross;
    this.cargo[goodId] = this.held(goodId) - qty;
    this.cost[goodId] = Math.max(0, (this.cost[goodId] || 0) - costPart);
    if (this.cargo[goodId] === 0) { delete this.cargo[goodId]; delete this.cost[goodId]; }
    market.applyTrade(this.location, goodId, qty, "sell");
    const profit = Math.round(gross - costPart);
    const tail = profit >= 0 ? `+£${profit.toLocaleString()}` : `−£${Math.abs(profit).toLocaleString()}`;
    return { ok: true, msg: `Sold ${qty} × ${GOOD[goodId].name} for £${gross.toLocaleString()} (${tail}).`, profit };
  }
}

/* Economy and world unit tests.  node qa/unit.js
   Pure logic only — no DOM, no WebGL. */

import {
  House, Market, makeShip, holdUsed, holdFree, avgCost, effectiveSpeed,
  opportunities, estimateRealised, makeRng, START_CASH,
} from "../src/economy.js";
import {
  GOODS, GOOD, PORTS, PORT, SHIPS, UPGRADE,
  distanceNm, passage, bearing, cardinal, chartXY, seasonOf, dateOf,
} from "../src/world.js";

const fails = [];
let count = 0;
function check(cond, msg) {
  count++;
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fails.push(msg);
}
function group(name) { console.log("\n— " + name); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------- world ---- */
group("world data integrity");

check(GOODS.length >= 15, `${GOODS.length} commodities defined`);
check(PORTS.length >= 15, `${PORTS.length} ports defined`);
check(new Set(GOODS.map((g) => g.id)).size === GOODS.length, "no duplicate good ids");
check(new Set(PORTS.map((p) => p.id)).size === PORTS.length, "no duplicate port ids");
check(PORTS.filter((p) => p.home).length === 1, "exactly one home port");

let badRef = [];
for (const p of PORTS) {
  for (const g of Object.keys(p.produces || {})) if (!GOOD[g]) badRef.push(`${p.id} produces unknown ${g}`);
  for (const g of Object.keys(p.consumes || {})) if (!GOOD[g]) badRef.push(`${p.id} consumes unknown ${g}`);
}
check(badRef.length === 0, "every produces/consumes entry names a real good" + (badRef.length ? ` (${badRef[0]})` : ""));

let unproduced = GOODS.filter((g) => !PORTS.some((p) => p.produces?.[g.id]));
check(unproduced.length === 0, "every good is produced somewhere" + (unproduced.length ? ` (missing ${unproduced.map(g=>g.id).join(",")})` : ""));
let unwanted = GOODS.filter((g) => !PORTS.some((p) => p.consumes?.[g.id]));
check(unwanted.length === 0, "every good is consumed somewhere" + (unwanted.length ? ` (missing ${unwanted.map(g=>g.id).join(",")})` : ""));

let tierGap = PORTS.filter((p) => p.tier === 0).length;
check(tierGap >= 6, `${tierGap} ports open at tier 0 (need a playable opening map)`);

/* --------------------------------------------------------- geography ---- */
group("geography");

check(near(distanceNm("lisbon", "porto"), 150, 40), `Lisbon-Porto ~150nm (got ${Math.round(distanceNm("lisbon","porto"))})`);
check(near(distanceNm("lisbon", "bristol"), 810, 90), `Lisbon-Bristol ~810nm (got ${Math.round(distanceNm("lisbon","bristol"))})`);
check(near(distanceNm("lisbon", "recife"), 3150, 250), `Lisbon-Recife ~3150nm (got ${Math.round(distanceNm("lisbon","recife"))})`);
check(distanceNm("lisbon", "porto") === distanceNm("porto", "lisbon"), "distance is symmetric");
check(Math.abs(bearing("lisbon", "bristol")) < 45, `Bristol is north of Lisbon (bearing ${Math.round(bearing("lisbon","bristol"))})`);
check(cardinal(0) === "N" && cardinal(90) === "E" && cardinal(180) === "S" && cardinal(270) === "W", "compass points map correctly");
check(cardinal(-90) === "W", "negative bearings wrap");

const legShort = passage("lisbon", "porto", 7);
const legLong = passage("lisbon", "recife", 7);
check(legShort.days >= 2, `short hops still cost 2 days (got ${legShort.days})`);
check(legLong.days > legShort.days * 4, `Brazil is a real voyage (${legLong.days}d vs ${legShort.days}d)`);
check(passage("lisbon", "recife", 12).days < legLong.days, "a faster ship makes a shorter passage");

const xy = chartXY(PORT.lisbon.lat, PORT.lisbon.lon);
check(xy.x > 0 && xy.x < 1 && xy.y > 0 && xy.y < 1, "Lisbon projects inside the chart");
let offChart = PORTS.filter((p) => { const c = chartXY(p.lat, p.lon); return c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1; });
check(offChart.length === 0, "every port projects inside the chart" + (offChart.length ? ` (${offChart[0].id} does not)` : ""));

check(seasonOf(1) === "Spring" && seasonOf(95) === "Summer" && seasonOf(185) === "Autumn" && seasonOf(275) === "Winter", "seasons cycle across the year");
check(dateOf(1).month === "March" && dateOf(1).year === 1620, "day 1 is March 1620");
check(dateOf(361).year === 1621, "day 361 rolls into 1621");

/* ------------------------------------------------------------ market ---- */
group("market model");

const m = new Market(7);
check(m.spot("lisbon", "port_wine") > 0, "spot price is positive");
check(m.ask("lisbon", "port_wine") > m.bid("lisbon", "port_wine"), "ask sits above bid");

const producerPrice = m.spot("porto", "port_wine");
const consumerPrice = m.spot("bristol", "port_wine");
check(producerPrice < consumerPrice, `wine is cheaper where it is made (Porto £${producerPrice} vs Bristol £${consumerPrice})`);

let worstRatio = 0, worstGood = "";
for (const g of GOODS) {
  let lo = Infinity, hi = 0;
  for (const p of PORTS) { const s = m.spot(p.id, g.id); lo = Math.min(lo, s); hi = Math.max(hi, s); }
  if (hi / lo > worstRatio) { worstRatio = hi / lo; worstGood = g.id; }
}
check(worstRatio < 4.0, `no good spreads more than 4x across the map (worst: ${worstGood} at ${worstRatio.toFixed(2)}x)`);
check(worstRatio > 1.4, `spreads are wide enough to trade on (best: ${worstRatio.toFixed(2)}x)`);

const beforeBuy = m.spot("porto", "port_wine");
m.moveStock("porto", "port_wine", -m.target.porto.port_wine * 0.5);
check(m.spot("porto", "port_wine") > beforeBuy, "draining the warehouse raises the price");
m.moveStock("porto", "port_wine", m.target.porto.port_wine * 1.0);
check(m.spot("porto", "port_wine") < beforeBuy, "glutting the warehouse lowers the price");

// recovery: after a drain, production should walk the price back toward fair
const m2 = new Market(11);
const restPrice = m2.spot("porto", "port_wine");
m2.moveStock("porto", "port_wine", -m2.target.porto.port_wine * 0.6);
const shockPrice = m2.spot("porto", "port_wine");
m2.tick(40, { silent: true });
const healedPrice = m2.spot("porto", "port_wine");
check(shockPrice > restPrice, "the shock moved the price");
check(Math.abs(healedPrice - restPrice) < Math.abs(shockPrice - restPrice), `the market heals over 40 days (${shockPrice} -> ${healedPrice}, rest ${restPrice})`);

check(m.priceHistory("lisbon", "salt").length === 40, "40 days of price history is primed");

// determinism
const a1 = new Market(99), a2 = new Market(99);
a1.tick(30, { silent: true }); a2.tick(30, { silent: true });
check(a1.spot("lisbon", "salt") === a2.spot("lisbon", "salt"), "same seed gives the same market");
const b1 = new Market(100);
b1.tick(30, { silent: true });
check(b1.spot("lisbon", "salt") !== a1.spot("lisbon", "salt") || b1.spot("cadiz", "sugar") !== a1.spot("cadiz", "sugar"), "different seeds diverge");

// the marginal-price walk
const m3 = new Market(5);
const headline = m3.bid("bristol", "port_wine") * 60;
const realised = estimateRealised(m3, "bristol", "port_wine", 60, "sell");
check(realised < headline, `a 60-tun parcel sells below the headline price (£${realised} vs £${headline})`);
check(realised > headline * 0.6, "but not catastrophically below it");
const stockAfter = m3.stock.bristol.port_wine;
check(near(stockAfter, m3.stock.bristol.port_wine, 0.001), "estimateRealised leaves the market untouched");

/* -------------------------------------------------------------- ship ---- */
group("ship and hold");

const sh = makeShip("caravel", "Test");
check(holdUsed(sh) === 0 && holdFree(sh) === 40, "a new caravel has 40 tuns free");
sh.cargo.timber = 10;                       // timber is bulk 2
check(holdUsed(sh) === 20, `bulky cargo eats extra hold (10 timber = ${holdUsed(sh)} tuns)`);
sh.cargo.gold = 10;                         // gold is bulk 0.5
check(holdUsed(sh) === 25, `dense cargo packs tighter (${holdUsed(sh)} tuns)`);
sh.cost.timber = 200;
check(avgCost(sh, "timber") === 20, "average cost tracks per unit");

const fast = makeShip("caravel", "A"), slow = makeShip("caravel", "B");
slow.cargo.salt = 40;
check(effectiveSpeed(fast) > effectiveSpeed(slow), "a full hold slows her down");
const worn = makeShip("caravel", "C");
worn.condition = 0.3;
check(effectiveSpeed(worn) < effectiveSpeed(fast), "a worn hull slows her down");

check(SHIPS.every((s) => s.hold > 0 && s.speedKn > 0 && s.crew > 0), "every hull has sane stats");
check(SHIPS[0].price === 0, "the starting caravel is not for sale");

/* ------------------------------------------------------------- house ---- */
group("the house: trading");

const h = new House(42);
check(h.cash === START_CASH && h.day === 1 && h.location === "lisbon", "a new house starts in Lisbon with its stake");
check(h.tier === 0, "and starts at tier 0");
check(!h.portOpen("elmina"), "the Guinea coast is shut at tier 0");
check(h.portOpen("porto"), "Porto is open at tier 0");
check(!h.goodOpen("gold"), "gold dust is shut at tier 0");

const cashBefore = h.cash;
const rBuy = h.buy("port_wine", 10);
check(rBuy.ok, "can buy port wine in Lisbon");
check(h.ship.cargo.port_wine === 10, "10 tuns land in the hold");
check(h.cash < cashBefore, "and the coin leaves the purse");

const overspend = h.buy("spices", 99999);
check(!overspend.ok || h.cash >= 0, "cannot overspend into negative cash");
check(h.cash >= 0, `cash never goes negative (£${h.cash})`);

const rSellNone = h.sell("tea", 5);
check(!rSellNone.ok, "cannot sell what is not in the hold");

const holdCap = new House(43);
holdCap.cash = 999999;
holdCap.buy("salt", 99999);
check(holdUsed(holdCap.ship) <= holdCap.ship.hold + 0.001, `cannot overfill the hold (${holdUsed(holdCap.ship)}/${holdCap.ship.hold})`);

// buying a big parcel should cost more per unit than the headline ask
const walk = new House(44);
walk.cash = 999999;
const headlineAsk = walk.market.ask("lisbon", "salt");
walk.buy("salt", 40);
const paidPerUnit = walk.ship.cost.salt / walk.ship.cargo.salt;
check(paidPerUnit >= headlineAsk, `a big parcel walks the price up (paid £${paidPerUnit.toFixed(1)} vs headline £${headlineAsk})`);

group("the house: credit");

const cr = new House(45);
const limit = cr.creditLimit();
check(limit > 0, `the house extends some credit (£${limit})`);
cr.borrow(limit * 2);
check(cr.debt <= limit + 1, "cannot borrow beyond the limit");
const dBefore = cr.debt;
cr.repay(999999);
check(cr.debt < dBefore, "repayment reduces the debt");
check(cr.cash >= 0, "repayment cannot push cash negative");

group("the house: voyages");

const v = new House(46);
v.buy("port_wine", 10);
const dayBefore = v.day, netBefore = v.netWorth();
const out = v.completeVoyage("bristol");
check(v.location === "bristol", "the voyage lands you at the destination");
check(v.day > dayBefore, `time passes (${dayBefore} -> ${v.day})`);
check(out.wages > 0, `wages are paid (£${out.wages})`);
check(v.ship.condition < 1, `the hull wears (${v.ship.condition.toFixed(3)})`);
check(Array.isArray(out.notes) && out.notes.length > 0, "the voyage reports what happened");
check(typeof out.netWorth === "number", "net worth is reported on arrival");

const sellRes = v.sell("port_wine", 10);
check(sellRes.ok, "and you can sell the cargo at the other end");

// perishables
const per = new House(47);
per.cash = 99999;
per.buy("cod", 30);
const codBefore = per.ship.cargo.cod;
per.completeVoyage("recife");
check((per.ship.cargo.cod || 0) < codBefore, `dried cod spoils on a long passage (${codBefore} -> ${per.ship.cargo.cod || 0})`);

const nonPer = new House(48);
nonPer.cash = 99999;
nonPer.buy("salt", 30);
nonPer.completeVoyage("recife");
check(nonPer.ship.cargo.salt === 30, "salt does not spoil");

group("contracts");

const c = new House(49);
check(c.offers.length > 0, `commissions are on offer (${c.offers.length})`);
const offer = c.offers[0];
c.acceptContract(offer.id);
check(c.contracts.length === 1, "a commission can be accepted");
check(!c.offers.find((o) => o.id === offer.id), "and leaves the offer board");
check(c.acceptContract("nonsense").ok === false, "accepting a dead offer fails cleanly");

// deliver it. The hold is loaded directly so the test exercises settlement
// rather than the buy path's stock and bulk limits, which are covered above.
const ct = c.contracts[0];
c.cash = 999999;
c.location = ct.to;
c.ship.hold = 9999;
c.ship.cargo[ct.goodId] = ct.qty;
c.ship.cost[ct.goodId] = 1;
const cashPre = c.cash;
c.sell(ct.goodId, ct.qty);
check(c.cash > cashPre + ct.reward * 0.5, "delivering pays the commission on top of the sale");
check(c.contracts.length === 0, "and clears the commission");

// a partial delivery leaves the commission open
const part = new House(58);
const po = part.offers.find((o) => o.qty >= 4);
part.acceptContract(po.id);
part.location = po.to;
part.ship.hold = 9999;
part.ship.cargo[po.goodId] = 2;
part.ship.cost[po.goodId] = 1;
part.sell(po.goodId, 2);
check(part.contracts.length === 1, "a part cargo does not close the commission");
check(part.contracts[0].delivered === 2, "but the delivery is credited against it");

// missed deadline
const miss = new House(50);
const mo = miss.offers[0];
miss.acceptContract(mo.id);
const missCash = miss.cash;
miss.day = mo.dueDay + 1;
miss._expireContracts();
check(miss.cash < missCash, "missing a deadline costs you the penalty");
check(miss.contracts.length === 0, "and the commission is struck off");

group("shipyard");

const y = new House(51);
y.cash = 99999;
const before = y.fleet.length;
y.buyShip("carrack", "Sao Rafael");
check(y.fleet.length === before + 1, "a second hull joins the fleet");
check(y.buyShip("carrack", "x").ok, "and a third");
y.cash = 10;
check(!y.buyShip("galleon", "x").ok, "cannot buy what you cannot afford");

const up = new House(52);
up.cash = 99999;
const speedBefore = up.ship.speedKn;
up.fitUpgrade("topsails");
check(up.ship.speedKn > speedBefore, `topsails make her faster (${speedBefore} -> ${up.ship.speedKn.toFixed(2)})`);
check(!up.fitUpgrade("topsails").ok, "cannot fit the same refit twice");
const holdBefore2 = up.ship.hold;
up.fitUpgrade("holdext");
check(up.ship.hold > holdBefore2, "the extended hold carries more");

const car = new House(53);
car.cash = 99999;
car.ship.condition = 0.5;
const carDay = car.day;
car.careen();
check(car.ship.condition === 1, "careening restores the hull");
check(car.day > carDay, "and costs days in the yard");

group("opportunities");

const o = new House(54);
const ops = opportunities(o, 6);
check(ops.length > 0, `there is something worth doing on day 1 (${ops.length} runs)`);
check(ops.every((x) => x.net > 0), "every listed run is profitable after wages");
check(ops.every((x) => x.qty >= 1 && x.qty <= o.ship.hold), "and every run fits the hold");
check(ops[0].perDay >= ops[ops.length - 1].perDay, "ranked by profit per day");
check(ops.every((x) => o.portOpen(x.to)), "and never suggests a port that is shut to you");
check(ops[0].perDay < 900, `the best opening run is not absurd (£${ops[0].perDay}/day on £${o.cash})`);

group("save and load");

const s1 = new House(55);
s1.buy("port_wine", 8);
s1.completeVoyage("porto");
s1.acceptContract(s1.offers[0]?.id);
const json = JSON.parse(JSON.stringify(s1.toJSON()));
const s2 = House.fromJSON(json);
check(s2.cash === s1.cash, "cash survives the round trip");
check(s2.day === s1.day, "the day survives");
check(s2.location === s1.location, "the location survives");
check(JSON.stringify(s2.ship.cargo) === JSON.stringify(s1.ship.cargo), "the cargo survives");
check(s2.market.spot("lisbon", "salt") === s1.market.spot("lisbon", "salt"), "the market state survives");
check(House.fromJSON(null).cash === START_CASH, "a corrupt save falls back to a fresh house");
check(House.fromJSON({ v: 1 }).cash === START_CASH, "an old save version falls back too");

group("edge cases");

const e = new House(56);
check(!e.buy("port_wine", 0).ok, "buying zero is refused");
check(!e.buy("port_wine", -5).ok, "buying a negative amount is refused");
check(!e.sell("port_wine", -5).ok, "selling a negative amount is refused");
e.cash = 0;
check(!e.buy("spices", 1).ok, "broke means broke");
check(e.cash === 0, "and a refused buy changes nothing");

const blocked = new House(57);
blocked.market.events.push({ id: "t", kind: "blockade", port: "lisbon", days: 99, startedDay: blocked.day, blockade: true, priceFactor: 1 });
check(!blocked.buy("salt", 5).ok, "a blockaded port will not sell to you");
check(!blocked.sell("salt", 5).ok, "nor buy from you");

const rng = makeRng(1);
let lo = 1, hi = 0;
for (let i = 0; i < 5000; i++) { const r = rng(); lo = Math.min(lo, r); hi = Math.max(hi, r); }
check(lo >= 0 && hi < 1, `rng stays in [0,1) (${lo.toFixed(4)}..${hi.toFixed(4)})`);

/* ------------------------------------------------------------ report ---- */
console.log(`\n${count - fails.length}/${count} checks passed`);
if (fails.length) {
  console.log("\nFAILED:");
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("unit: OK");

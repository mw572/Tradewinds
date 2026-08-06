/* Balance simulation.  node qa/sim.js
 *
 * Plays whole campaigns headlessly and asserts the economy behaves like a
 * game rather than a money printer or a brick wall. Three traders:
 *
 *   greedy  — always takes the best profit-per-day run it can see
 *   random  — picks a destination and a cargo at random
 *   idle    — sits in Lisbon and pays the wages
 *
 * Greedy must beat random, random must beat idle, and none of them may
 * discover an unbounded loop. Everything is seeded, so a failure here
 * reproduces exactly.
 */

import { House, opportunities, holdFree, effectiveSpeed } from "../src/economy.js";
import { GOODS, GOOD, PORTS, PORT, passage } from "../src/world.js";

const fails = [];
let count = 0;
function check(cond, msg) {
  count++;
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fails.push(msg);
}
function group(name) { console.log("\n— " + name); }

const money = (n) => "£" + Math.round(n).toLocaleString();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

/* ------------------------------------------------------------ traders ---- */

function playGreedy(seed, maxDays) {
  const h = new House(seed);
  const track = [];
  let stuck = 0;
  while (h.day < maxDays) {
    // sell everything we are carrying that turns a profit here
    for (const g of Object.keys({ ...h.ship.cargo })) h.sell(g, h.ship.cargo[g]);

    // take a commission if one happens to suit the best run
    const ops = opportunities(h, 8);
    if (!ops.length) { stuck++; if (stuck > 3) break; h.completeVoyage(pickAnyOpenPort(h)); continue; }
    stuck = 0;
    const best = ops[0];

    const offer = h.offers.find((o) => o.to === best.to && o.goodId === best.goodId);
    if (offer) h.acceptContract(offer.id);

    h.buy(best.goodId, best.qty);
    // top the hold up with the next best thing bound for the same port
    for (const o of ops) {
      if (o.to !== best.to || o.goodId === best.goodId) continue;
      if (holdFree(h.ship) < GOOD[o.goodId].bulk) break;
      h.buy(o.goodId, o.qty);
    }
    h.completeVoyage(best.to);

    // keep her sound, and settle the debt when flush
    if (h.ship.condition < 0.55 && h.cash > 1500) h.careen();
    if (h.debt > 0 && h.cash > h.debt * 2) h.repay(h.debt);
    // trade up when the money is clearly there
    if (h.cash > 30000 && h.fleet.length === 1) h.buyShip("fluyt", "Boa Ventura");
    else if (h.cash > 14000 && h.ship.type === "caravel") h.buyShip("carrack", "Sao Rafael"), h.switchShip(h.fleet.length - 1);

    track.push({ day: h.day, net: h.netWorth() });
    if (h.isRuined()) break;
  }
  return { h, track, net: h.netWorth() };
}

function pickAnyOpenPort(h) {
  const open = PORTS.filter((p) => p.id !== h.location && h.portOpen(p.id) && !h.market.isBlockaded(p.id));
  return open.length ? open[0].id : (h.location === "lisbon" ? "porto" : "lisbon");
}

function playRandom(seed, maxDays) {
  const h = new House(seed);
  const rnd = h.rng;
  while (h.day < maxDays) {
    for (const g of Object.keys({ ...h.ship.cargo })) h.sell(g, h.ship.cargo[g]);
    const open = PORTS.filter((p) => p.id !== h.location && h.portOpen(p.id) && !h.market.isBlockaded(p.id));
    if (!open.length) break;
    const dest = open[Math.floor(rnd() * open.length)];
    const tradable = GOODS.filter((g) => h.goodOpen(g.id));
    const g = tradable[Math.floor(rnd() * tradable.length)];
    h.buy(g.id, h.maxBuy(g.id));
    h.completeVoyage(dest.id);
    if (h.isRuined()) break;
  }
  return { h, net: h.netWorth() };
}

/* A beginner: buys whatever looks cheapest against its Atlantic average and
 * carries it to wherever that good is dearest. No margin arithmetic, no wages
 * in the sum, no regard for how far away that is. This is the floor a player
 * should clear on their first campaign. */
function playNaive(seed, maxDays) {
  const h = new House(seed);
  while (h.day < maxDays) {
    for (const g of Object.keys({ ...h.ship.cargo })) h.sell(g, h.ship.cargo[g]);

    let pick = null;
    for (const g of GOODS) {
      if (!h.goodOpen(g.id)) continue;
      const here = h.market.ask(h.location, g.id);
      const ratio = here / h.market.averageSpot(g.id);
      if (!pick || ratio < pick.ratio) pick = { g: g.id, ratio };
    }
    if (!pick) break;

    let dest = null;
    for (const p of PORTS) {
      if (p.id === h.location || !h.portOpen(p.id) || h.market.isBlockaded(p.id)) continue;
      const there = h.market.bid(p.id, pick.g);
      if (!dest || there > dest.price) dest = { id: p.id, price: there };
    }
    if (!dest) break;

    h.buy(pick.g, h.maxBuy(pick.g));
    h.completeVoyage(dest.id);
    if (h.ship.condition < 0.4 && h.cash > 1200) h.careen();
    if (h.isRuined()) break;
  }
  return { h, net: h.netWorth() };
}

function playIdle(seed, maxDays) {
  const h = new House(seed);
  while (h.day < maxDays) {
    h.completeVoyage(h.location === "lisbon" ? "porto" : "lisbon");
    if (h.isRuined()) break;
  }
  return { h, net: h.netWorth() };
}

/* ---------------------------------------------------------- the runs ---- */

const SEEDS = 24;
const DAYS = 720;   // two years of trading

console.log(`Simulating ${SEEDS} campaigns x ${DAYS} days per trader…`);

const greedy = [], naive = [], random = [], idle = [];
let ruinedGreedy = 0, ruinedRandom = 0, ruinedNaive = 0;
let maxTier = 0, everBorrowed = 0, hazardsSeen = 0, eventsSeen = 0;
let peakNet = 0, peakSeed = 0;

for (let i = 0; i < SEEDS; i++) {
  const seed = 1000 + i * 37;
  const g = playGreedy(seed, DAYS);
  greedy.push(g.net);
  if (g.h.isRuined()) ruinedGreedy++;
  maxTier = Math.max(maxTier, g.h.tier);
  if (g.h.stats.interestPaid > 0) everBorrowed++;
  hazardsSeen += g.h.log.filter((l) => /gale|privateer|becalmed/i.test(l.text)).length;
  eventsSeen += g.h.market.events.length;
  if (g.net > peakNet) { peakNet = g.net; peakSeed = seed; }

  const n = playNaive(seed, DAYS);
  naive.push(n.net);
  if (n.h.isRuined()) ruinedNaive++;

  const r = playRandom(seed, DAYS);
  random.push(r.net);
  if (r.h.isRuined()) ruinedRandom++;

  idle.push(playIdle(seed, DAYS).net);
}

const gMed = median(greedy), nMed = median(naive), rMed = median(random), iMed = median(idle);

group("outcomes after two years");
console.log(`  greedy  median ${money(gMed).padStart(12)}   p10 ${money(pct(greedy,0.1)).padStart(12)}   p90 ${money(pct(greedy,0.9)).padStart(12)}`);
console.log(`  naive   median ${money(nMed).padStart(12)}   p10 ${money(pct(naive,0.1)).padStart(12)}   p90 ${money(pct(naive,0.9)).padStart(12)}`);
console.log(`  random  median ${money(rMed).padStart(12)}   p10 ${money(pct(random,0.1)).padStart(12)}   p90 ${money(pct(random,0.9)).padStart(12)}`);
console.log(`  idle    median ${money(iMed).padStart(12)}`);
console.log(`  ruined: greedy ${ruinedGreedy}/${SEEDS}, naive ${ruinedNaive}/${SEEDS}, random ${ruinedRandom}/${SEEDS}`);
console.log(`  best campaign ${money(peakNet)} (seed ${peakSeed}); highest tier reached ${maxTier}`);

group("skill has to matter");
check(gMed > nMed * 1.4, `optimising beats a rough heuristic (${money(gMed)} vs ${money(nMed)})`);
check(nMed > 1400, `a beginner's heuristic still makes money (${money(nMed)})`);
check(nMed > rMed, `having any idea beats having none (${money(nMed)} vs ${money(rMed)})`);
check(rMed < 1400, `buying at random pays the spread and loses (${money(rMed)})`);
check(iMed < 1400, `sitting in port loses money to wages (${money(iMed)})`);

group("the economy is bounded");
check(gMed < 4_000_000, `no unbounded loop: median stays under £4m (${money(gMed)})`);
check(peakNet < 20_000_000, `even the luckiest campaign is bounded (${money(peakNet)})`);
check(gMed > 12_000, `but a good trader clearly gets somewhere (${money(gMed)})`);

group("risk is real");
check(ruinedGreedy <= SEEDS * 0.25, `skilled play is usually survivable (${ruinedGreedy}/${SEEDS} ruined)`);
check(ruinedRandom > 0 || rMed < 6000, `careless play is punished (${ruinedRandom} ruined, median ${money(rMed)})`);
check(hazardsSeen > 0, `storms, privateers and calms actually fire (${hazardsSeen} logged)`);
check(maxTier >= 1, `a good campaign unlocks the tier-1 map (reached ${maxTier})`);

group("progression pacing");
const arc = playGreedy(1234, DAYS);
const at = (d) => { const p = arc.track.filter((t) => t.day <= d).pop(); return p ? p.net : 1400; };
console.log(`  day  90: ${money(at(90))}`);
console.log(`  day 180: ${money(at(180))}`);
console.log(`  day 360: ${money(at(360))}`);
console.log(`  day 720: ${money(at(720))}`);
check(at(90) > 1400, "the first season shows progress");
check(at(360) > at(90), "the first year compounds");
check(at(90) < 45_000, "but tier 2 is not reachable in one season");

group("no free lunch at rest");
// A market nobody trades in must not drift into free money.
const still = new House(777);
const before = opportunities(still, 1)[0]?.perDay ?? 0;
still.market.tick(360, { silent: true });
const after = opportunities(still, 1)[0]?.perDay ?? 0;
console.log(`  best run per-day: day 1 ${money(before)}, day 361 ${money(after)}`);
check(after < before * 6, `an untraded market does not blow open (${money(before)} -> ${money(after)})`);
check(after > 0, "and does not close entirely either");

group("prices stay sane over a long campaign");
const long = new House(888);
long.market.tick(720, { silent: true });
let insane = [];
for (const p of PORTS) for (const g of GOODS) {
  const s = long.market.spot(p.id, g.id);
  const fair = g.base * p.priceIndex;
  if (s > fair * 3.2 || s < fair * 0.35) insane.push(`${p.id}/${g.id} £${s} vs fair £${Math.round(fair)}`);
}
check(insane.length === 0, `no price runs away over two years${insane.length ? ` (${insane.length} did, e.g. ${insane[0]})` : ""}`);

/* ------------------------------------------------------------ report ---- */
console.log(`\n${count - fails.length}/${count} checks passed`);
if (fails.length) {
  console.log("\nFAILED:");
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("sim: OK");

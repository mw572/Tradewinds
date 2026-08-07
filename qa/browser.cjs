/* Browser test for Tradewinds.  node qa/browser.cjs
 *
 * Serves nothing itself: expects a static server on TW_URL (default :8749).
 * Playwright is borrowed from the-apiarist's qa install via NODE_PATH; see
 * package.json. CommonJS deliberately, because NODE_PATH does not apply to ESM.
 *
 * This drives the real page: boots it, trades, plots a course, sails the 3-D
 * helm, docks, and checks the arrival report. It also fails on any uncaught JS
 * error or WebGL failure, which is the thing a unit test cannot see.
 */
'use strict';

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TW_URL || 'http://localhost:8749/';
const SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
let count = 0;
function check(cond, msg) {
  count++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) failures.push(msg);
}
function group(n) { console.log('\n— ' + n); }

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) });

(async function () {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  /* ==================== DESKTOP ==================== */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text()); });

  group('boot');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, '01-title.png');
  check(await page.isVisible('#title-screen.active'), 'the title screen shows');
  check((await page.textContent('.game-title')).trim() === 'TRADEWINDS', 'the title reads TRADEWINDS');
  check(jsErrors.length === 0, 'no JS errors on load' + (jsErrors.length ? `: ${jsErrors[0]}` : ''));

  group('the three ages');
  const eraCards = await page.locator('#era-picker .era-card').count();
  check(eraCards === 3, `three ages are offered (${eraCards})`);
  check(await page.locator('#era-picker .era-card.sel').count() === 1, 'one is selected');

  // Play a Steam campaign far enough to prove the whole stack is era-driven.
  await page.locator('#era-picker .era-card[data-era="steam"]').click();
  await page.waitForTimeout(120);
  await page.click('#start-btn');
  await page.waitForSelector('#port-screen.active', { timeout: 6000 });
  await page.waitForTimeout(400);
  const steamDate = await page.textContent('#stat-date');
  check(/1880/.test(steamDate), `Steam starts in 1880 (${steamDate})`);
  const steamCash = await page.textContent('#stat-cash');
  check(/9,000/.test(steamCash), `with its own stake (${steamCash})`);
  const steamGoods = await page.locator('#market-rows tr').allTextContents();
  check(steamGoods.some((t) => /Steam Coal/.test(t)), 'coal is on the exchange');
  check(!steamGoods.some((t) => /Port Wine/.test(t)), 'and the sail-era goods are not');
  check(/tons/.test(await page.textContent('#ship-hold')), 'the hold is measured in tons');
  await page.click('.tab[data-tab="shipyard"]');
  await page.waitForTimeout(200);
  const steamHulls = await page.textContent('#hulls-list');
  check(/Tramp Steamer/.test(steamHulls), 'steamers are for sale');
  const steamTabs = (await page.locator('.tab').allTextContents()).join(' | ');
  check(/The Baltic/.test(steamTabs) && /Fixtures/.test(steamTabs) && /The office/.test(steamTabs),
    `the 1880 house speaks its own language (${steamTabs})`);
  check(!/Counting house/.test(steamTabs), 'and has no counting house');
  await shot(page, '11-steam-era.png');

  // The steamer must actually be a different vessel, not the caravel reskinned.
  await page.click('.tab[data-tab="chart"]'); await page.waitForTimeout(200);
  await page.locator('#chart .port-g[data-port="porto"]').click(); await page.waitForTimeout(150);
  await page.click('#sail-btn');
  await page.waitForSelector('#voyage-screen.active', { timeout: 15000 });
  await page.waitForTimeout(2600);
  const steamShip = await page.evaluate(() => {
    const s = window.__tw.state.voyage.ship3d;
    return { era: s.era, sails: s.sails.length, smoke: !!s.smoke, len: Math.round(s.len) };
  });
  check(steamShip.era === 'steam', `the helm builds a steam vessel (${steamShip.era})`);
  check(steamShip.sails === 0, 'she carries no canvas');
  check(steamShip.smoke, 'and she makes smoke');
  check(/Engine/.test(await page.textContent('.inst:nth-child(3) .inst-label')), 'the instruments read Engine, not Point of sail');
  check(/telegraph/.test(await page.textContent('#key-trim')), 'and the controls say telegraph');

  // Engines, not canvas: a steamer must never be reported in irons, and the
  // engine room must lag behind the telegraph.
  const eng = await page.evaluate(async () => {
    const v = window.__tw.state.voyage;
    v.trim = 1.0;                        // ring down full ahead
    const r0 = v.revs;
    await new Promise((r) => setTimeout(r, 700));
    return { prop: v.propulsion, r0, r1: v.revs, ordered: v.ordered };
  });
  check(eng.prop === 'steam', `she is driven by steam (${eng.prop})`);
  check(eng.r1 > eng.r0 && eng.r1 < 1.0, `the engine room lags the telegraph (${eng.r0.toFixed(2)} -> ${eng.r1.toFixed(2)} for an order of 1.00)`);
  // Head her straight into the wind: under canvas that is in irons, under steam
  // it is simply a headwind.
  const irons = await page.evaluate(async () => {
    const v = window.__tw.state.voyage;
    v.heading = v.windFrom;
    await new Promise((r) => setTimeout(r, 500));
    return { inIrons: v._lastHud?.inIrons, speed: v.speedKn };
  });
  check(irons.inIrons !== true, 'head to wind she is not in irons');
  check(irons.speed > 0.5, `and she keeps driving into it (${irons.speed.toFixed(1)} kn)`);

  // And a Box campaign, which uses a different currency entirely.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.locator('#era-picker .era-card[data-era="box"]').click();
  await page.waitForTimeout(120);
  await page.click('#start-btn');
  await page.waitForSelector('#port-screen.active', { timeout: 6000 });
  await page.waitForTimeout(400);
  const boxCash = await page.textContent('#stat-cash');
  check(/^\$/.test(boxCash.trim()), `the Box age trades in dollars (${boxCash})`);
  check(/1985/.test(await page.textContent('#stat-date')), 'and starts in 1985');
  check(/TEU/.test(await page.textContent('#ship-hold')), 'the hold is measured in TEU');
  const boxGoods = await page.locator('#market-rows tr').allTextContents();
  check(boxGoods.some((t) => /Electronics/.test(t)), 'boxed cargo is on the exchange');
  const boxTabs = (await page.locator('.tab').allTextContents()).join(' | ');
  check(/Rate board/.test(boxTabs) && /Bookings/.test(boxTabs) && /Head office/.test(boxTabs),
    `the 1985 line speaks its own language (${boxTabs})`);
  check(/Slots/.test(await page.locator('.stat-label').allTextContents().then((a) => a.join(' '))),
    'and measures capacity in slots');
  await shot(page, '12-box-era.png');

  await page.click('.tab[data-tab="chart"]'); await page.waitForTimeout(200);
  await page.locator('#chart .port-g[data-port="porto"]').click(); await page.waitForTimeout(150);
  await page.click('#sail-btn');
  await page.waitForSelector('#voyage-screen.active', { timeout: 15000 });
  await page.waitForTimeout(2600);
  const boxShip = await page.evaluate(() => {
    const s = window.__tw.state.voyage.ship3d;
    return { era: s.era, boxes: s.boxCount || 0, sails: s.sails.length, len: Math.round(s.len) };
  });
  check(boxShip.era === 'box', `the helm builds a container ship (${boxShip.era})`);
  check(boxShip.boxes > 60, `she is loaded with containers (${boxShip.boxes})`);
  check(boxShip.sails === 0, 'and carries no canvas');
  check(boxShip.len > steamShip.len, `she is longer than the steamer (${boxShip.len} vs ${steamShip.len})`);

  // Back to Sail for the rest of the run.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.locator('#era-picker .era-card[data-era="sail"]').click();
  await page.waitForTimeout(120);

  group('the docks');
  await page.click('#start-btn');
  await page.waitForSelector('#port-screen.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  check(await page.isVisible('#port-screen.active'), 'the port screen opens');
  check((await page.textContent('#port-name')).trim() === 'Lisbon', 'you start in Lisbon');
  const cash0 = await page.textContent('#stat-cash');
  check(/1,400/.test(cash0), `you start with £1,400 (got ${cash0})`);

  check(!(await page.isVisible('#stat-debt-wrap')), 'the debt readout is hidden while you owe nothing');

  const rowCount = await page.locator('#market-rows tr').count();
  check(rowCount >= 15, `the exchange lists every commodity (${rowCount})`);
  const sparks = await page.locator('#market-rows .spark').count();
  check(sparks >= 10, `price history sparklines render (${sparks})`);
  const lockedRows = await page.locator('#market-rows tr.locked').count();
  check(lockedRows > 0, `tier-locked goods are shown but shut (${lockedRows})`);
  await shot(page, '02-exchange.png');

  group('opportunities panel');
  // Checked before trading: the panel ranks what you can afford, so spending
  // the whole purse first would correctly empty it.
  const ops = await page.locator('#ops-list .op').count();
  check(ops > 0, `runs worth taking are listed (${ops})`);

  group('trading moves the market');
  // Five tuns out of a well-stocked Lisbon warehouse rightly moves nothing, so
  // measure the elasticity where it should bite: emptying the hold into one good.
  const priceProbe = () => page.evaluate(() => {
    const h = window.__tw.house;
    return h.market.ask(h.location, 'port_wine');
  });
  const askBefore = await priceProbe();
  await page.locator('#market-rows tr:has-text("Port Wine") button[data-act="buymax"]').first().click();
  await page.waitForTimeout(250);
  const msg = await page.textContent('#trade-msg');
  check(/Bought/.test(msg), `a buy reports back (${msg})`);
  const askAfter = await priceProbe();
  check(askAfter > askBefore, `emptying the warehouse moved the price up (£${askBefore} -> £${askAfter})`);
  const hold = await page.textContent('#stat-hold');
  check(!/^0 \//.test(hold), `the hold is no longer empty (${hold})`);

  const cashNow = await page.textContent('#stat-cash');
  check(cashNow !== cash0, 'and the cash changed');

  group('the chart table');
  await page.click('.tab[data-tab="chart"]');
  await page.waitForTimeout(250);
  check(await page.isVisible('#chart'), 'the chart renders');
  // Scoped to .port-g: the legend reuses the same dot classes as swatches.
  const portDots = await page.locator('#chart .port-g .port-dot').count();
  check(portDots >= 15, `every port is plotted (${portDots})`);
  check(await page.locator('#chart .port-g .port-dot.here').count() === 1, 'your position is marked');
  const coastPaths = await page.locator('#chart .coast path').count();
  check(coastPaths >= 100, `real coastlines are drawn (${coastPaths} paths)`);
  check(await page.locator('#chart .rhumbs line').count() > 80, 'the rhumb network is struck');
  check(await page.locator('#chart .cartouche').count() === 1, 'the cartouche is inked');
  await page.locator('#chart .port-g[data-port="porto"]').click();
  await page.waitForTimeout(200);
  check((await page.textContent('#dest-title')).trim() === 'Porto', 'clicking a port sets the course');
  const legText = await page.textContent('#dest-detail');
  check(/nm/.test(legText) && /days/.test(legText), 'and reports the passage');
  check(!(await page.locator('#sail-btn').isDisabled()), 'the sail button unlocks');
  await shot(page, '03-chart.png');

  group('commissions, shipyard, counting house');
  await page.click('.tab[data-tab="commissions"]');
  await page.waitForTimeout(150);
  const offers = await page.locator('#offers-list .card').count();
  check(offers > 0, `commissions are on offer (${offers})`);
  await page.locator('#offers-list button[data-accept]').first().click();
  await page.waitForTimeout(200);
  check(await page.locator('#contracts-list .card').count() === 1, 'signing one moves it to the signed list');
  check(await page.isVisible('#tab-badge-c'), 'and the tab badge appears');

  await page.click('.tab[data-tab="shipyard"]');
  await page.waitForTimeout(150);
  check(await page.locator('#hulls-list .card').count() >= 3, 'hulls are for sale');
  check(await page.locator('#refits-list .card').count() >= 4, 'refits are offered');
  check(await page.locator('#fleet-list .card').count() === 1, 'your fleet shows one hull');
  await shot(page, '04-shipyard.png');

  await page.click('.tab[data-tab="counting"]');
  await page.waitForTimeout(150);
  check(/£/.test(await page.textContent('#c-limit')), 'a credit limit is quoted');
  await page.fill('#loan-amt', '300');
  await page.click('#borrow-btn');
  await page.waitForTimeout(200);
  check(await page.isVisible('#stat-debt-wrap'), 'borrowing shows the debt in the topbar');

  group('the helm');
  await page.click('.tab[data-tab="chart"]');
  await page.waitForTimeout(150);
  await page.locator('#chart .port-g[data-port="porto"]').click();
  await page.waitForTimeout(150);
  await page.click('#sail-btn');
  await page.waitForSelector('#voyage-screen.active', { timeout: 15000 });
  await page.waitForTimeout(2600);   // let the scene build and a few frames run

  check(await page.isVisible('#voyage-screen.active'), 'the helm screen opens');

  const webgl = await page.evaluate(() => {
    const c = document.getElementById('sea');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { has: !!gl, w: c.width, h: c.height };
  });
  check(webgl.has, 'a WebGL context is live');
  check(webgl.w > 100 && webgl.h > 100, `the canvas is sized (${webgl.w}x${webgl.h})`);

  // The scene must not be a black or flat-filled canvas. Reading the WebGL
  // framebuffer back through drawImage returns blank without
  // preserveDrawingBuffer, so measure the compressed size of a real screenshot
  // instead: a flat fill packs down to a few KB, an ocean does not.
  const canvasShot = await page.locator('#sea').screenshot();
  check(canvasShot.length > 60000,
    `the scene renders real content, not a flat fill (${Math.round(canvasShot.length / 1024)} KB of PNG)`);
  fs.writeFileSync(path.join(SHOTS, '05a-canvas-only.png'), canvasShot);

  // The render pipeline: PBR needs something to reflect, or every material is
  // lit as if it were in a black room.
  const gfx = await page.evaluate(() => {
    const v = window.__tw.state.voyage;
    return {
      env: !!v.scene.environment,
      post: !!v.post,
      shadow: v.sun.shadow.mapSize.width,
      shadowSpan: Math.round(v.sun.shadow.camera.right * 2),
      probes: v.probes ? v.probes.length : 0,
      colliders: v.colliders ? v.colliders.length : 0,
    };
  });
  check(gfx.env, 'the scene has an environment map to reflect');
  check(gfx.post, 'post-processing is running');
  check(gfx.shadow >= 2048, `the shadow map is ${gfx.shadow}px`);
  check(gfx.shadowSpan < 200, `and fitted to the ship, not the harbour (${gfx.shadowSpan} units across)`);
  check(gfx.probes >= 12, `the hull floats on ${gfx.probes} probes, not one point`);
  check(gfx.colliders >= 1, 'and the quay is solid');

  // Buoyancy: she must pitch and roll independently, which one sample cannot do.
  const motion = await page.evaluate(async () => {
    const v = window.__tw.state.voyage;
    const P = [], R = [], Y = [];
    for (let i = 0; i < 40; i++) {
      P.push(v.pitchAngle); R.push(v.heelAngle); Y.push(v.ship3d.group.position.y);
      await new Promise((r) => setTimeout(r, 55));
    }
    const rng = (a) => Math.max(...a) - Math.min(...a);
    return { pitch: rng(P) * 57.3, roll: rng(R) * 57.3, heave: rng(Y) };
  });
  check(motion.pitch > 0.4, `she pitches in a seaway (${motion.pitch.toFixed(1)} deg)`);
  check(motion.heave > 0.2, `and heaves (${motion.heave.toFixed(2)} units)`);
  check(motion.pitch < 25 && motion.roll < 35, 'without throwing herself about');

  const heading0 = await page.textContent('#i-heading');
  check(/^\d{3}°$/.test(heading0), `the heading instrument reads out (${heading0})`);
  const pos = await page.textContent('#i-pos');
  check(pos.length > 2, `point of sail reads out (${pos})`);
  await shot(page, '05-helm.png');

  // Steering must actually change the heading.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1400);
  await page.keyboard.up('ArrowRight');
  const heading1 = await page.textContent('#i-heading');
  check(heading0 !== heading1, `the rudder answers (${heading0} -> ${heading1})`);

  // Trim must change the canvas set.
  const trim0 = await page.textContent('#i-trim');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowUp');
  const trim1 = await page.textContent('#i-trim');
  check(trim0 !== trim1, `the sails trim (${trim0} -> ${trim1})`);

  // Camera cycling must not throw.
  const errsBeforeCam = jsErrors.length;
  await page.keyboard.press('c');
  await page.waitForTimeout(500);
  await page.keyboard.press('c');
  await page.waitForTimeout(500);
  await shot(page, '06-helm-alt-camera.png');
  check(jsErrors.length === errsBeforeCam, 'changing camera does not throw');

  // Docking far from the berth must be refused, with a reason.
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const helmMsg = await page.textContent('#helm-msg');
  check(helmMsg.length > 0, `docking early is refused with a reason (${helmMsg})`);
  check(!(await page.isVisible('#arrival.show')), 'and the arrival card does not open');

  group('arrival');
  // Drive the arrival directly rather than sailing 900m by hand.
  await page.evaluate(() => window.__tw.arrive());
  await page.waitForTimeout(600);
  check(await page.isVisible('#arrival.show'), 'the arrival card opens');
  check((await page.textContent('#arrival-title')).trim() === 'Porto', 'at the right port');
  const notes = await page.locator('#arrival-notes li').count();
  check(notes > 0, `the voyage reports what happened (${notes} notes)`);
  check(/£/.test(await page.textContent('#arrival-net')), 'net worth is reported');
  await shot(page, '07-arrival.png');

  await page.click('#arrival-btn');
  await page.waitForSelector('#port-screen.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  check((await page.textContent('#port-name')).trim() === 'Porto', 'going ashore lands you at the new port');
  const dateNow = await page.textContent('#stat-date');
  check(!/1 Mar 1620/.test(dateNow), `time has passed (${dateNow})`);

  group('the save survives a reload');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check(await page.isVisible('#continue-btn'), 'a resume button appears');
  await page.click('#continue-btn');
  await page.waitForSelector('#port-screen.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  check((await page.textContent('#port-name')).trim() === 'Porto', 'and resumes where you left off');

  group('layout');
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `no horizontal overflow at 1440px (${overflow}px)`);

  group('no errors across the whole run');
  check(jsErrors.length === 0, 'the console stayed clean' + (jsErrors.length ? `: ${jsErrors.slice(0, 2).join(' | ')}` : ''));

  /* ==================== MOBILE ==================== */
  group('mobile');
  const mctx = await browser.newContext(Object.assign({}, devices['iPhone 13'], { hasTouch: true }));
  const mp = await mctx.newPage();
  const mErrors = [];
  mp.on('pageerror', (e) => mErrors.push(String(e)));
  mp.on('console', (m) => { if (m.type() === 'error') mErrors.push(m.text()); });

  await mp.goto(BASE, { waitUntil: 'networkidle' });
  await mp.tap('#start-btn');
  await mp.waitForSelector('#port-screen.active', { timeout: 5000 });
  await mp.waitForTimeout(400);
  await shot(mp, '08-mobile-exchange.png');
  const mOverflow = await mp.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  check(mOverflow <= 1, `no horizontal overflow on iPhone (${mOverflow}px)`);
  check(await mp.isVisible('#market-rows'), 'the exchange renders on a phone');

  await mp.tap('.tab[data-tab="chart"]');
  await mp.waitForTimeout(350);
  check(await mp.isVisible('#chart'), 'the chart renders on a phone');
  await shot(mp, '09-mobile-chart.png');

  await mp.locator('#chart .port-g[data-port="porto"]').tap();
  await mp.waitForTimeout(200);
  await mp.tap('#sail-btn');
  await mp.waitForSelector('#voyage-screen.active', { timeout: 15000 });
  await mp.waitForTimeout(2400);
  check(await mp.isVisible('.touch-pad'), 'touch controls appear at the helm');
  await shot(mp, '10-mobile-helm.png');
  check(mErrors.length === 0, 'no JS errors on mobile' + (mErrors.length ? `: ${mErrors[0]}` : ''));

  await browser.close();

  console.log(`\n${count - failures.length}/${count} checks passed`);
  console.log(`screenshots in ${SHOTS}`);
  if (failures.length) {
    console.log('\nFAILED:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('browser: OK');
})().catch((e) => { console.error('\nHARNESS CRASH:', e); process.exit(1); });

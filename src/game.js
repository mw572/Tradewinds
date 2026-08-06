// game.js — screen flow, DOM wiring, and the chart table.
// Title -> docks (trade, plot, sign, refit) -> helm (sail and dock) -> arrive.

import {
  House, holdUsed, avgCost, effectiveSpeed, opportunities, estimateRealised,
} from "./economy.js";
import {
  GOODS, GOOD, PORTS, PORT, SHIPS, UPGRADES,
  passage, cardinal, dateOf, seasonOf,
} from "./world.js";
import { Voyage } from "./sailing.js";
import { drawChart as renderChart } from "./chart.js";

const $ = (id) => document.getElementById(id);
const money = (n) => "£" + Math.round(n).toLocaleString();
const signed = (n) => (n >= 0 ? "+" : "−") + "£" + Math.abs(Math.round(n)).toLocaleString();
const SAVE_KEY = "tradewinds.save.v2";

const state = {
  house: null,
  dest: null,
  voyage: null,
  pendingLeg: null,
};

/* ------------------------------------------------------------- screens --- */

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
  if (name === "chart") drawChart();
}

/* ---------------------------------------------------------------- save --- */

function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state.house.toJSON())); } catch (e) { /* private mode */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return House.fromJSON(JSON.parse(raw));
  } catch (e) { return null; }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------- topbar ---- */

function renderTopbar() {
  const h = state.house, s = h.ship, p = PORT[h.location];
  $("port-name").textContent = p.name;
  $("port-country").textContent = p.country;
  $("stat-cash").textContent = money(h.cash);
  $("stat-hold").textContent = `${holdUsed(s)} / ${s.hold}`;
  $("stat-net").textContent = money(h.netWorth());
  const d = dateOf(h.day);
  $("stat-date").textContent = `${d.day} ${d.month.slice(0, 3)} ${d.year}`;
  $("stat-debt-wrap").hidden = h.debt <= 0;
  $("stat-debt").textContent = money(h.debt);

  $("ship-name").textContent = s.name;
  $("ship-type").textContent = `${s.rig} ${SHIPS.find((x) => x.id === s.type)?.name ?? ""}`;
  $("ship-hold").textContent = `${s.hold} tuns`;
  $("ship-speed").textContent = `${effectiveSpeed(s).toFixed(1)} kn`;
  $("ship-crew").textContent = s.crew;
  $("ship-cond").textContent = Math.round(s.condition * 100) + "%";
  const fill = $("cond-fill");
  fill.style.width = Math.round(s.condition * 100) + "%";
  fill.className = "cond-fill" + (s.condition < 0.4 ? " bad" : s.condition < 0.7 ? " warn" : "");

  const n = h.contracts.length;
  $("tab-badge-c").hidden = n === 0;
  $("tab-badge-c").textContent = n;
}

/* ------------------------------------------------------------ exchange --- */

/** Tiny inline sparkline of the last 40 days. */
function sparkline(series, w = 78, hgt = 22) {
  if (!series || series.length < 2) return "";
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = hi - lo || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = hgt - ((v - lo) / span) * (hgt - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cls = series[series.length - 1] >= series[0] ? "spark-up" : "spark-down";
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4"
      stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function renderEvents() {
  const h = state.house;
  const box = $("port-events");
  box.innerHTML = "";
  for (const e of h.market.eventsAt(h.location)) {
    const el = document.createElement("div");
    el.className = "event event-" + e.kind;
    el.innerHTML = `<b>${e.headline}</b><span>${e.note}</span>`;
    box.appendChild(el);
  }
}

function renderMarket() {
  const h = state.house, m = h.market, s = h.ship, port = h.location;
  $("port-flavor").textContent = PORT[port].blurb;
  const tbody = $("market-rows");
  tbody.innerHTML = "";

  for (const g of GOODS) {
    const open = h.goodOpen(g.id);
    const ask = m.ask(port, g.id);
    const bid = m.bid(port, g.id);
    const avg = m.averageSpot(g.id);
    const role = m.role(port, g.id);
    const held = s.cargo[g.id] || 0;
    const cost = avgCost(s, g.id);
    const maxBuy = h.maxBuy(g.id);

    const tr = document.createElement("tr");
    tr.className = open ? "" : "locked";

    const tag = role === "buy" ? `<span class="good-tag tag-buy">cheap here</span>`
      : role === "sell" ? `<span class="good-tag tag-sell">dear here</span>`
      : `<span class="good-tag tag-neutral">at par</span>`;
    const askCls = ask > avg * 1.1 ? "price-up" : ask < avg * 0.9 ? "price-down" : "";
    const pl = held ? bid - cost : 0;

    tr.innerHTML = `
      <td>
        <div class="good-name">${g.name}</div>
        ${open ? tag : `<span class="good-tag tag-locked">standing too low</span>`}
        <div class="good-note">${g.note}</div>
      </td>
      <td class="num"><span class="price ${askCls}">${money(ask)}</span></td>
      <td class="num"><span class="price">${money(bid)}</span></td>
      <td class="num spark-col">${sparkline(m.priceHistory(port, g.id))}</td>
      <td class="num">${held || "—"}${g.bulk !== 1 && open ? `<span class="bulk">&times;${g.bulk}</span>` : ""}</td>
      <td class="num">${held ? `${money(cost)}<span class="pl ${pl >= 0 ? "up" : "down"}">${signed(pl)}</span>` : "—"}</td>
      <td class="actions">
        <div class="trade-group">
          <button class="mini-btn" data-act="buy" data-g="${g.id}" data-n="5">Buy 5</button>
          <button class="mini-btn" data-act="buy" data-g="${g.id}" data-n="25">25</button>
          <button class="mini-btn" data-act="buymax" data-g="${g.id}">Max</button>
        </div>
        <div class="trade-group">
          <button class="mini-btn sell" data-act="sell" data-g="${g.id}" data-n="5">Sell 5</button>
          <button class="mini-btn sell" data-act="sell" data-g="${g.id}" data-n="25">25</button>
          <button class="mini-btn sell" data-act="sellall" data-g="${g.id}">All</button>
        </div>
      </td>`;
    tbody.appendChild(tr);

    for (const btn of tr.querySelectorAll("button")) {
      const act = btn.dataset.act;
      if (!open) { btn.disabled = true; continue; }
      if (act === "buy") btn.disabled = maxBuy < 1;
      else if (act === "buymax") btn.disabled = maxBuy < 1;
      else btn.disabled = held < 1;
    }
  }
}

function onMarketClick(e) {
  const btn = e.target.closest("button.mini-btn");
  if (!btn) return;
  const h = state.house, g = btn.dataset.g, act = btn.dataset.act;
  let res;
  if (act === "buy") res = h.buy(g, Number(btn.dataset.n));
  else if (act === "buymax") res = h.buy(g, h.maxBuy(g));
  else if (act === "sell") res = h.sell(g, Number(btn.dataset.n));
  else if (act === "sellall") res = h.sell(g, h.ship.cargo[g] || 0);
  if (res) {
    const el = $("trade-msg");
    el.textContent = res.msg;
    el.className = "trade-msg " + (res.kind || "");
  }
  renderPort(false);
  saveGame();
}

function renderOps() {
  const h = state.house;
  const list = $("ops-list");
  list.innerHTML = "";
  const ops = opportunities(h, 5);
  if (!ops.length) {
    list.innerHTML = `<p class="empty">Nothing here turns a profit worth the wages. Try another port, or wait for the market to move.</p>`;
    return;
  }
  for (const o of ops) {
    const el = document.createElement("button");
    el.className = "op";
    el.innerHTML = `
      <span class="op-good">${GOOD[o.goodId].name}</span>
      <span class="op-route">${PORT[h.location].name} &rarr; ${PORT[o.to].name}</span>
      <span class="op-nums"><b>${money(o.net)}</b> on ${o.qty} tuns
        <em>${money(o.perDay)}/day &middot; ${o.days}d &middot; ${o.nm.toLocaleString()} nm</em></span>`;
    el.addEventListener("click", () => {
      state.dest = o.to;
      showTab("chart");
      renderDestPanel();
    });
    list.appendChild(el);
  }
}

/* --------------------------------------------------------------- chart --- */

function drawChart() {
  const h = state.house;
  if (!h) return;
  const svg = $("chart");
  renderChart(svg, h, state.dest);
  svg.querySelectorAll(".port-g.clickable").forEach((g) => {
    g.addEventListener("click", () => {
      state.dest = g.dataset.port;
      drawChart();
      renderDestPanel();
    });
  });
}

function renderDestPanel() {
  const h = state.house;
  const box = $("dest-detail");
  const btn = $("sail-btn");

  if (!state.dest || state.dest === h.location) {
    $("dest-title").textContent = "No course set";
    $("dest-blurb").textContent = "Choose a port on the chart.";
    box.innerHTML = "";
    btn.disabled = true;
    btn.textContent = "Choose a destination";
    return;
  }

  const p = PORT[state.dest];
  const leg = passage(h.location, state.dest, effectiveSpeed(h.ship));
  const wages = Math.round(h.crewCount() * 0.55 * leg.days);

  $("dest-title").textContent = p.name;
  $("dest-blurb").textContent = p.blurb;

  const rows = [];
  let hereValue = 0, thereValue = 0;
  for (const [gid, qty] of Object.entries(h.ship.cargo)) {
    const hv = estimateRealised(h.market, h.location, gid, qty, "sell");
    const tv = estimateRealised(h.market, state.dest, gid, qty, "sell");
    hereValue += hv; thereValue += tv;
    rows.push(`<div class="manifest-row"><span>${qty} &times; ${GOOD[gid].name}</span>
      <b class="${tv >= hv ? "up" : "down"}">${signed(tv - hv)}</b></div>`);
  }

  box.innerHTML = `
    <div class="dest-figs">
      <div><span>Distance</span><b>${leg.nm.toLocaleString()} nm</b></div>
      <div><span>Passage</span><b>${leg.days} days</b></div>
      <div><span>Course</span><b>${cardinal(leg.bearing)} ${leg.bearing}&deg;</b></div>
      <div><span>Wages</span><b class="neg">${money(wages)}</b></div>
    </div>
    ${h.market.isBlockaded(state.dest)
      ? `<p class="warn-note">${p.name} is blockaded. You will not be able to trade when you arrive.</p>` : ""}
    ${rows.length
      ? `<h3 class="sub-head">Your hold, sold there instead of here</h3>
         <div class="manifest">${rows.join("")}</div>
         <div class="manifest-row total"><span>Net swing</span>
           <b class="${thereValue >= hereValue ? "up" : "down"}">${signed(thereValue - hereValue)}</b></div>`
      : `<p class="empty">The hold is empty. You would be sailing in ballast.</p>`}`;

  btn.disabled = false;
  btn.textContent = `Set sail for ${p.name}`;
}

/* --------------------------------------------------------- commissions --- */

function renderCommissions() {
  const h = state.house;
  const offers = $("offers-list");
  offers.innerHTML = "";
  if (!h.offers.length) offers.innerHTML = `<p class="empty">Nothing on the board today.</p>`;
  for (const o of h.offers) {
    const leg = passage(h.location, o.to, effectiveSpeed(h.ship));
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="card-head"><b>${o.qty} &times; ${GOOD[o.goodId].name}</b><span class="card-pay">${money(o.reward)}</span></div>
      <div class="card-body">To <b>${PORT[o.to].name}</b> by day ${o.dueDay} &middot; ${leg.days} days' sail
        <br/>Worth about ${money(h.market.spot(o.to, o.goodId) * o.qty)} on that market. Forfeit ${money(o.penalty)}.</div>
      <button class="btn btn-sm" data-accept="${o.id}">Sign</button>`;
    offers.appendChild(el);
  }
  offers.querySelectorAll("[data-accept]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = h.acceptContract(b.dataset.accept);
      $("trade-msg").textContent = r.msg;
      renderPort(false); saveGame();
    }));

  const active = $("contracts-list");
  active.innerHTML = "";
  if (!h.contracts.length) active.innerHTML = `<p class="empty">Nothing signed.</p>`;
  for (const c of h.contracts) {
    const el = document.createElement("div");
    el.className = "card" + (h.day > c.dueDay ? " card-late" : "");
    el.innerHTML = `
      <div class="card-head"><b>${c.qty} &times; ${GOOD[c.goodId].name}</b><span class="card-pay">${money(c.reward)}</span></div>
      <div class="card-body">To <b>${PORT[c.to].name}</b> &middot; delivered ${c.delivered}/${c.qty}
        <br/>Due day ${c.dueDay} (${c.dueDay - h.day} days). Forfeit ${money(c.penalty)}.</div>`;
    active.appendChild(el);
  }
}

/* ------------------------------------------------------------ shipyard --- */

function renderShipyard() {
  const h = state.house;

  const hulls = $("hulls-list");
  hulls.innerHTML = "";
  for (const t of SHIPS) {
    if (t.price <= 0) continue;
    const owned = h.fleet.filter((s) => s.type === t.id).length;
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="card-head"><b>${t.name}</b><span class="card-pay">${money(t.price)}</span></div>
      <div class="card-body">${t.hold} tuns &middot; ${t.speedKn} kn &middot; ${t.crew} crew &middot; ${Math.round(t.seaworthy * 100)}% seaworthy
        <br/>${t.note}${owned ? `<br/><em>You have ${owned}.</em>` : ""}</div>
      <button class="btn btn-sm" data-hull="${t.id}" ${h.cash < t.price || h.fleet.length >= 4 ? "disabled" : ""}>Buy</button>`;
    hulls.appendChild(el);
  }
  hulls.querySelectorAll("[data-hull]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = h.buyShip(b.dataset.hull);
      $("trade-msg").textContent = r.msg;
      renderPort(false); saveGame();
    }));

  $("refit-ship").textContent = h.ship.name;
  const refits = $("refits-list");
  refits.innerHTML = "";
  for (const u of UPGRADES) {
    const fitted = h.ship.upgrades.includes(u.id);
    const el = document.createElement("div");
    el.className = "card" + (fitted ? " card-done" : "");
    el.innerHTML = `
      <div class="card-head"><b>${u.name}</b><span class="card-pay">${fitted ? "Fitted" : money(u.price)}</span></div>
      <div class="card-body">${u.note}</div>
      ${fitted ? "" : `<button class="btn btn-sm" data-refit="${u.id}" ${h.cash < u.price ? "disabled" : ""}>Fit</button>`}`;
    refits.appendChild(el);
  }
  refits.querySelectorAll("[data-refit]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = h.fitUpgrade(b.dataset.refit);
      $("trade-msg").textContent = r.msg;
      renderPort(false); saveGame();
    }));

  const fleet = $("fleet-list");
  fleet.innerHTML = "";
  h.fleet.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "card" + (i === h.activeShip ? " card-active" : "");
    el.innerHTML = `
      <div class="card-head"><b>${s.name}</b><span class="card-pay">${Math.round(s.condition * 100)}%</span></div>
      <div class="card-body">${SHIPS.find((x) => x.id === s.type).name} &middot; ${s.hold} tuns &middot; ${holdUsed(s)} laden
        ${s.upgrades.length ? `<br/><em>${s.upgrades.length} refit${s.upgrades.length > 1 ? "s" : ""}</em>` : ""}</div>
      ${i === h.activeShip ? `<span class="card-flag">Your flag</span>`
        : `<button class="btn btn-sm" data-ship="${i}">Sail her</button>`}`;
    fleet.appendChild(el);
  });
  fleet.querySelectorAll("[data-ship]").forEach((b) =>
    b.addEventListener("click", () => {
      state.house.switchShip(Number(b.dataset.ship));
      renderPort(false); saveGame();
    }));

  const cb = $("careen-btn");
  const cost = Math.round((1 - h.ship.condition) * 900 + 60);
  cb.textContent = h.ship.condition > 0.985 ? "She is sound" : `Careen and recaulk — ${money(cost)}, 3 days`;
  cb.disabled = h.ship.condition > 0.985 || h.cash < cost;
}

/* ------------------------------------------------------ counting house --- */

function renderCounting() {
  const h = state.house;
  $("c-cash").textContent = money(h.cash);
  $("c-debt").textContent = money(h.debt);
  $("c-limit").textContent = money(h.creditLimit());
  $("c-daily").textContent = money(h.dailyCosts());

  const s = h.stats;
  $("stats-grid").innerHTML = `
    <div><span>Voyages</span><b>${s.voyages}</b></div>
    <div><span>Tuns traded</span><b>${s.tunsTraded.toLocaleString()}</b></div>
    <div><span>Gross trading profit</span><b>${money(s.grossProfit)}</b></div>
    <div><span>Best single voyage</span><b>${money(s.bestVoyage)}</b></div>
    <div><span>Wages paid</span><b class="neg">${money(s.wagesPaid)}</b></div>
    <div><span>Interest paid</span><b class="neg">${money(s.interestPaid)}</b></div>
    <div><span>Standing</span><b>Tier ${h.tier}</b></div>
    <div><span>Season</span><b>${seasonOf(h.day)}</b></div>`;

  const log = $("log-list");
  log.innerHTML = "";
  for (const l of h.log.slice(0, 26)) {
    const el = document.createElement("div");
    el.className = "log-line log-" + l.kind;
    el.innerHTML = `<span class="log-day">${l.day}</span><span></span>`;
    el.lastChild.textContent = l.text;
    log.appendChild(el);
  }
  if (!h.log.length) log.innerHTML = `<p class="empty">Nothing logged yet.</p>`;
}

/* ---------------------------------------------------------- port render --- */

function renderPort(resetDest = true) {
  if (resetDest) { state.dest = null; $("trade-msg").textContent = ""; }
  renderTopbar();
  renderEvents();
  renderMarket();
  renderOps();
  renderCommissions();
  renderShipyard();
  renderCounting();
  renderDestPanel();
  if (document.querySelector('.tabpane[data-pane="chart"]').classList.contains("active")) drawChart();
  if (state.house.isRuined()) showRuin();
}

/* --------------------------------------------------------------- helm ---- */

function startVoyage() {
  const h = state.house;
  const destId = state.dest;
  if (!destId) return;
  const dest = PORT[destId];
  const leg = passage(h.location, destId, effectiveSpeed(h.ship));

  const windDeg = Math.floor(Math.random() * 360);
  const windKn = 8 + Math.floor(Math.random() * 18);
  // Time of day drifts with the game day, so successive landfalls differ.
  const dayFraction = ((h.day * 0.37) % 1) * 0.62 + 0.16;

  $("hud-dest").textContent = dest.name;
  $("hud-wind").textContent = `${cardinal(windDeg)} ${windKn} kn`;
  $("dock-prompt").classList.remove("show");
  $("arrival").classList.remove("show");
  $("helm-msg").textContent = "";
  show("voyage-screen");

  if (!state.voyage) state.voyage = new Voyage($("sea"));
  state.pendingLeg = { destId, leg };

  requestAnimationFrame(() => {
    state.voyage.start({
      port: dest,
      shipSpec: {
        type: h.ship.type, masts: h.ship.masts, rig: h.ship.rig,
        armed: h.ship.armed, condition: h.ship.condition,
        speedKn: effectiveSpeed(h.ship),
      },
      windDeg, windKn, legNm: leg.nm, dayFraction,
      onHud: updateHud,
      onDockable: (ok) => $("dock-prompt").classList.toggle("show", ok),
      onMessage: flashHelm,
      onArrive: arrive,
    });
  });
}

let helmTimer = null;
function flashHelm(msg) {
  const el = $("helm-msg");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(helmTimer);
  helmTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function updateHud(d) {
  $("i-heading").textContent = String(d.headingDeg).padStart(3, "0") + "°";
  $("i-speed").textContent = d.speedKn.toFixed(1) + " kn";
  const pos = $("i-pos");
  pos.textContent = d.pointOfSail;
  pos.classList.toggle("alarm", d.inIrons);
  $("i-trim").textContent = Math.round(d.trim * 100) + "%";
  $("i-dist").textContent = d.distM.toLocaleString() + " m";
  $("hud-progress").style.width = Math.round(d.progress * 100) + "%";
  $("wind-arrow").style.transform = `translate(-50%, -100%) rotate(${d.windFrom - d.headingDeg}deg)`;
}

function arrive() {
  const h = state.house;
  const { destId } = state.pendingLeg;
  state.voyage.stop();

  const out = h.completeVoyage(destId);

  $("arrival-eyebrow").textContent = out.hazard ? "Made fast, after a passage" : "Made fast alongside";
  $("arrival-title").textContent = PORT[destId].name;
  const ul = $("arrival-notes");
  ul.innerHTML = "";
  for (const n of out.notes) {
    const li = document.createElement("li");
    li.textContent = n;
    ul.appendChild(li);
  }
  const milestone = h.log.find((l) => l.kind === "milestone" && l.day === h.day);
  if (milestone) {
    const li = document.createElement("li");
    li.className = "milestone";
    li.textContent = milestone.text;
    ul.appendChild(li);
  }
  $("arrival-net").textContent = money(out.netWorth);
  const dEl = $("arrival-delta");
  dEl.textContent = signed(out.delta);
  dEl.className = out.delta >= 0 ? "up" : "down";
  $("arrival").classList.add("show");
  saveGame();
}

function showRuin() {
  const h = state.house;
  $("ruin-note").textContent =
    `After ${h.stats.voyages} voyages the house is worth ${money(h.netWorth())}, with ${money(h.debt)} owing on the Tagus and nothing in the hold to sell. The creditors have the ship.`;
  show("ruin-screen");
  clearSave();
}

/* --------------------------------------------------------- touch helm ---- */

function bindHold(id, key) {
  const el = $(id);
  if (!el) return;
  const down = (e) => { e.preventDefault(); state.voyage?.keys.add(key); };
  const up = (e) => { e.preventDefault(); state.voyage?.keys.delete(key); };
  el.addEventListener("touchstart", down, { passive: false });
  el.addEventListener("touchend", up);
  el.addEventListener("touchcancel", up);
  el.addEventListener("mousedown", down);
  el.addEventListener("mouseup", up);
  el.addEventListener("mouseleave", up);
}

/* ---------------------------------------------------------------- boot --- */

function newGame() {
  clearSave();
  state.house = new House(Math.floor(Math.random() * 1e9));
  state.dest = null;
  showTab("exchange");
  renderPort();
  show("port-screen");
  saveGame();
}

function init() {
  const saved = loadGame();
  if (saved) {
    $("continue-btn").hidden = false;
    $("continue-btn").addEventListener("click", () => {
      state.house = saved;
      showTab("exchange");
      renderPort();
      show("port-screen");
    });
  }

  $("start-btn").addEventListener("click", newGame);
  $("ruin-btn").addEventListener("click", newGame);
  $("reset-btn").addEventListener("click", () => {
    if (confirm("Wind up the house and start a fresh campaign?")) newGame();
  });

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => showTab(t.dataset.tab)));

  $("market-rows").addEventListener("click", onMarketClick);
  $("sail-btn").addEventListener("click", startVoyage);
  $("arrival-btn").addEventListener("click", () => {
    $("arrival").classList.remove("show");
    renderPort();
    show("port-screen");
  });

  $("borrow-btn").addEventListener("click", () => {
    const r = state.house.borrow(Number($("loan-amt").value) || 0);
    $("trade-msg").textContent = r.msg;
    renderPort(false); saveGame();
  });
  $("repay-btn").addEventListener("click", () => {
    const r = state.house.repay(Number($("loan-amt").value) || 0);
    $("trade-msg").textContent = r.msg;
    renderPort(false); saveGame();
  });
  $("careen-btn").addEventListener("click", () => {
    const r = state.house.careen();
    $("trade-msg").textContent = r.msg;
    renderPort(false); saveGame();
  });

  bindHold("t-left", "ArrowLeft");
  bindHold("t-right", "ArrowRight");
  bindHold("t-more", "ArrowUp");
  bindHold("t-less", "ArrowDown");
  $("t-dock").addEventListener("click", (e) => { e.preventDefault(); state.voyage?.dock(); });
}

init();

// Exposed for the browser test harness, which drives the game headlessly.
window.__tw = {
  state, newGame, startVoyage, arrive, renderPort, showTab,
  get house() { return state.house; },
  setDest(id) { state.dest = id; renderDestPanel(); },
};

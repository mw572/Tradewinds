// game.js — screen flow, DOM wiring, and the chart table.
// Title -> docks (trade, plot, sign, refit) -> helm (sail and dock) -> arrive.

import {
  House, holdUsed, avgCost, effectiveSpeed, opportunities, estimateRealised,
} from "./economy.js";
import {
  GOODS, GOOD, PORTS, PORT, SHIPS, UPGRADES,
  passage, chartXY, cardinal, dateOf, seasonOf,
} from "./world.js";
import { Voyage } from "./sailing.js";

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

const CHART_W = 600, CHART_H = 780;

function chartPoint(p) {
  const c = chartXY(p.lat, p.lon);
  return { x: 26 + c.x * (CHART_W - 52), y: 22 + c.y * (CHART_H - 44) };
}

// Rough coastlines in lon/lat, projected at draw time. Enough to read the
// Atlantic at a glance; this is a chart table, not an atlas.
const LANDS = [
  [[-9.5,43.8],[-8.9,41.9],[-9.5,38.7],[-8.9,37.0],[-6.3,36.0],[-5.3,36.1],[-4.4,36.7],[-2.1,36.7],[0.9,38.0],[3.2,41.9],[4.9,43.4],[7.6,43.8],[7.6,49.0],[4.3,51.5],[2.0,51.1],[-1.5,50.6],[-5.7,50.1],[-3.0,53.4],[-4.7,54.9],[-2.0,57.6],[-3.0,58.7],[-6.2,58.5],[-5.6,55.9],[-8.0,54.5],[-10.5,51.5],[-6.0,49.9],[-1.8,46.3],[-1.3,44.5],[-9.5,43.8]],
  [[-10.4,51.5],[-6.0,51.9],[-5.9,54.7],[-8.2,55.3],[-10.2,54.2],[-10.4,51.5]],
  [[-9.8,32.0],[-6.0,35.9],[-2.2,35.3],[3.1,36.8],[10.2,37.3],[11.6,33.2],[11.5,23.0],[-5.0,20.0],[-17.1,21.0],[-16.5,26.0],[-13.0,27.7],[-9.8,32.0]],
  [[-17.1,21.0],[-16.0,16.5],[-13.6,9.5],[-11.5,7.4],[-7.5,4.4],[-3.0,5.1],[1.2,6.1],[3.4,6.4],[8.5,4.3],[9.7,3.9],[9.4,0.4],[11.8,-3.9],[13.0,-8.0],[12.0,-13.0],[11.7,-18.0],[8.0,-18.0],[8.0,-6.0],[5.0,0.0],[-2.0,3.0],[-9.0,3.5],[-14.0,10.0],[-17.5,14.7],[-17.1,21.0]],
  [[-52.0,4.9],[-48.5,-1.4],[-44.3,-2.5],[-38.5,-3.7],[-34.8,-7.1],[-35.2,-9.6],[-37.0,-11.0],[-38.5,-13.0],[-39.0,-18.0],[-46.0,-18.0],[-46.0,4.9],[-52.0,4.9]],
];

function drawChart() {
  const h = state.house;
  if (!h) return;
  const svg = $("chart");
  const here = PORT[h.location];
  const parts = [];

  parts.push(`<defs>
    <radialGradient id="vignette" cx="50%" cy="45%" r="72%">
      <stop offset="58%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(24,14,4,0.40)"/>
    </radialGradient>
  </defs>`);
  parts.push(`<rect x="0" y="0" width="${CHART_W}" height="${CHART_H}" class="chart-sea"/>`);

  for (let lon = -40; lon <= 10; lon += 10) {
    const a = chartPoint({ lat: 56, lon }), b = chartPoint({ lat: -18, lon });
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="grat"/>`);
    parts.push(`<text x="${a.x}" y="14" class="grat-label" text-anchor="middle">${Math.abs(lon)}&deg;${lon < 0 ? "W" : "E"}</text>`);
  }
  for (let lat = -10; lat <= 50; lat += 10) {
    const a = chartPoint({ lat, lon: -46 }), b = chartPoint({ lat, lon: 12 });
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="grat"/>`);
    parts.push(`<text x="4" y="${a.y + 3}" class="grat-label">${Math.abs(lat)}&deg;${lat < 0 ? "S" : "N"}</text>`);
  }

  for (const poly of LANDS) {
    const d = poly.map(([lon, lat], i) => {
      const q = chartPoint({ lat, lon });
      return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
    }).join(" ") + " Z";
    parts.push(`<path d="${d}" class="chart-land"/>`);
  }

  const rose = chartPoint({ lat: -6, lon: -22 });
  parts.push(`<g class="rose" transform="translate(${rose.x},${rose.y})">
    <circle r="32" class="rose-ring"/><circle r="21" class="rose-ring"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const r = a % 90 === 0 ? 31 : 22;
      const rad = ((a - 90) * Math.PI) / 180;
      return `<line x1="0" y1="0" x2="${(Math.cos(rad) * r).toFixed(1)}" y2="${(Math.sin(rad) * r).toFixed(1)}" class="rose-spoke"/>`;
    }).join("")}
    <text y="-35" class="rose-n" text-anchor="middle">N</text></g>`);

  if (state.dest && state.dest !== h.location) {
    const a = chartPoint(here), b = chartPoint(PORT[state.dest]);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="course"/>`);
    const leg = passage(h.location, state.dest, effectiveSpeed(h.ship));
    parts.push(`<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 8}" class="course-label" text-anchor="middle">${leg.nm.toLocaleString()} nm &middot; ${leg.days} days</text>`);
  }

  for (const p of PORTS) {
    const q = chartPoint(p);
    const open = h.portOpen(p.id);
    const isHere = p.id === h.location;
    const cls = ["port-dot", isHere ? "here" : "", p.id === state.dest ? "dest" : "",
      open ? "" : "shut", h.market.isBlockaded(p.id) ? "blockaded" : ""].filter(Boolean).join(" ");
    parts.push(`<g class="port-g ${open && !isHere ? "clickable" : ""}" data-port="${p.id}">
      <circle cx="${q.x}" cy="${q.y}" r="15" class="port-hit"/>
      <circle cx="${q.x}" cy="${q.y}" r="${isHere ? 6.5 : 4.5}" class="${cls}"/>
      <text x="${q.x + 9}" y="${q.y + 4}" class="port-label ${open ? "" : "shut"}">${p.name}</text></g>`);
  }

  parts.push(`<rect x="0" y="0" width="${CHART_W}" height="${CHART_H}" fill="url(#vignette)" pointer-events="none"/>`);

  svg.innerHTML = parts.join("");
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

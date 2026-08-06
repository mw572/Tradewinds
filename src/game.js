// game.js — screen flow and DOM wiring: title → docks (trade) → helm (sail &
// dock) → arrive → docks. One Voyage instance is reused across passages.
import { GOODS, GOOD, PORTS, PORT, Market, Player, legDistance } from "./economy.js";
import { Voyage } from "./sailing.js";

const $ = (id) => document.getElementById(id);
const money = (n) => "£" + Math.round(n).toLocaleString();

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const cardinal = (deg) => CARDINALS[Math.round(((deg % 360) / 22.5)) % 16];

const state = {
  market: new Market(),
  player: new Player(),
  selectedDest: null,
  voyage: null,
  windDeg: 0,
  windKn: 0,
  won: false,
};

/* ---------------- screen switching ---------------- */
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

/* ---------------- docks / market ---------------- */
function renderTopbar() {
  const p = state.player;
  $("port-name").textContent = PORT[p.location].name;
  $("stat-cash").textContent = money(p.cash);
  $("stat-hold").textContent = `${p.holdUsed()} / ${p.ship.hold}`;
  $("stat-net").textContent = money(p.netWorth(state.market));
  $("stat-day").textContent = p.day;
  $("ship-name").textContent = p.ship.name;
  $("ship-hold").textContent = `${p.ship.hold} tuns`;
  $("ship-speed").textContent = `${p.ship.speedKn} kn`;
}

function renderMarket() {
  const { market, player } = state;
  const port = player.location;
  $("port-flavor").textContent = PORT[port].blurb;
  const tbody = $("market-rows");
  tbody.innerHTML = "";

  for (const g of GOODS) {
    const spot = market.spot(port, g.id);
    const fair = market.fair(port, g.id);
    const role = market.role(port, g.id);
    const held = player.held(g.id);
    const avg = player.avgCost(g.id);

    const tr = document.createElement("tr");

    const priceCls = spot > fair * 1.03 ? "price-up" : spot < fair * 0.97 ? "price-down" : "";
    const roleTag = role === "buy"
      ? `<span class="good-tag tag-buy">produced here</span>`
      : role === "sell"
        ? `<span class="good-tag tag-sell">wanted here</span>`
        : `<span class="good-tag tag-neutral">—</span>`;

    tr.innerHTML = `
      <td><div class="good-name">${g.name}</div>${roleTag}</td>
      <td class="num"><span class="price ${priceCls}">${money(spot)}</span></td>
      <td class="num">${held || "—"}</td>
      <td class="num">${held ? money(avg) : "—"}</td>
      <td class="actions">
        <button class="mini-btn" data-act="buy" data-g="${g.id}" data-n="5">Buy 5</button>
        <button class="mini-btn" data-act="buymax" data-g="${g.id}">Max</button>
        <button class="mini-btn sell" data-act="sell" data-g="${g.id}" data-n="5">Sell 5</button>
        <button class="mini-btn sell" data-act="sellall" data-g="${g.id}">All</button>
      </td>`;
    tbody.appendChild(tr);

    const [b5, bmax, s5, sall] = tr.querySelectorAll("button");
    b5.disabled = player.holdFree() < 1 || player.cash < spot;
    bmax.disabled = player.holdFree() < 1 || player.cash < spot;
    s5.disabled = held < 1;
    sall.disabled = held < 1;
  }
}

function onMarketClick(e) {
  const btn = e.target.closest("button.mini-btn");
  if (!btn) return;
  const { market, player } = state;
  const g = btn.dataset.g;
  const act = btn.dataset.act;
  let res;
  if (act === "buy") res = player.buy(market, g, 5);
  else if (act === "buymax") {
    const spot = market.spot(player.location, g);
    const affordable = Math.floor(player.cash / spot);
    res = player.buy(market, g, Math.min(affordable, player.holdFree()));
  } else if (act === "sell") res = player.sell(market, g, 5);
  else if (act === "sellall") res = player.sell(market, g, player.held(g));
  if (res) $("trade-msg").textContent = res.msg;
  renderTopbar();
  renderMarket();
  renderDestinations();
}

function renderDestinations() {
  const { player } = state;
  const list = $("dest-list");
  list.innerHTML = "";
  for (const p of PORTS) {
    if (p.id === player.location) continue;
    const leg = legDistance(player.location, p.id);
    // headline demand at this port
    const wants = Object.entries(p.factors).filter(([, f]) => f >= 1.15)
      .sort((a, b) => b[1] - a[1])[0];
    const wantsName = wants ? GOOD[wants[0]].name : "little";
    const el = document.createElement("button");
    el.className = "dest" + (state.selectedDest === p.id ? " selected" : "");
    el.dataset.dest = p.id;
    el.innerHTML = `
      <span class="dest-name">${p.name}</span>
      <span class="dest-meta">${leg.days} days' sail<br/>wants <b>${wantsName}</b></span>`;
    el.addEventListener("click", () => {
      state.selectedDest = p.id;
      renderDestinations();
      const btn = $("sail-btn");
      btn.disabled = false;
      btn.textContent = `Set sail for ${p.name} ⚓`;
    });
    list.appendChild(el);
  }
  if (!state.selectedDest) {
    const btn = $("sail-btn");
    btn.disabled = true;
    btn.textContent = "Choose a destination";
  }
}

function renderPort() {
  state.selectedDest = null;
  $("trade-msg").textContent = "";
  renderTopbar();
  renderMarket();
  renderDestinations();
  show("port-screen");
}

/* ---------------- voyage / helm ---------------- */
function setWindArrow(headingDeg) {
  // arrow points toward where the wind comes FROM, relative to the bow
  const rel = state.windDeg - headingDeg;
  $("wind-arrow").style.transform = `translate(-50%, -100%) rotate(${rel}deg)`;
}

function startVoyage() {
  const { player } = state;
  const dest = PORT[state.selectedDest];
  const leg = legDistance(player.location, dest.id);
  state.windDeg = Math.floor(Math.random() * 360);
  state.windKn = 10 + Math.floor(Math.random() * 16);

  $("hud-dest").textContent = dest.name;
  $("hud-wind").textContent = `${cardinal(state.windDeg)} ${state.windKn} kn`;
  $("dock-prompt").classList.remove("show");
  $("arrival").classList.remove("show");
  show("voyage-screen");

  if (!state.voyage) state.voyage = new Voyage($("sea"));
  const v = state.voyage;
  v.ship.speedKn = player.ship.speedKn;

  requestAnimationFrame(() => {
    v.start({
      destName: dest.name,
      windDeg: state.windDeg,
      legUnits: leg.units,
      onHud: (d) => {
        $("i-heading").textContent = String(d.headingDeg).padStart(3, "0") + "°";
        $("i-speed").textContent = d.speedKn.toFixed(1) + " kn";
        $("i-pos").textContent = d.pos;
        $("i-dist").textContent = d.distM + " m";
        setWindArrow(d.headingDeg);
      },
      onDockable: (ok) => $("dock-prompt").classList.toggle("show", ok),
      onArrive: () => arrive(dest, leg),
    });
  });
}

function arrive(dest, leg) {
  const { player, market } = state;
  state.voyage.stop();

  // fold in the passage: time passes, the whole market drifts
  player.location = dest.id;
  player.day += leg.days;
  market.advance(leg.days);

  const worth = player.netWorth(market);
  let note = `You raise the harbour after ${leg.days} days under ${cardinal(state.windDeg)} winds.<br/>` +
    `Net worth <span class="gain">${money(worth)}</span>.`;
  let eyebrow = "Made fast alongside";
  if (!state.won && worth >= 5000) {
    state.won = true;
    eyebrow = "The house is established";
    note += `<br/><br/>£5,000 in worth — you've made your name on the Tagus. Sail on, or call it a fortune.`;
  }
  $("arrival-eyebrow").textContent = eyebrow;
  $("arrival-title").textContent = dest.name;
  $("arrival-note").innerHTML = note;
  $("dock-prompt").classList.remove("show");
  $("arrival").classList.add("show");
}

/* ---------------- boot ---------------- */
function init() {
  $("start-btn").addEventListener("click", () => renderPort());
  $("market-rows").addEventListener("click", onMarketClick);
  $("sail-btn").addEventListener("click", () => { if (state.selectedDest) startVoyage(); });
  $("arrival-btn").addEventListener("click", () => {
    $("arrival").classList.remove("show");
    renderPort();
  });
}

init();

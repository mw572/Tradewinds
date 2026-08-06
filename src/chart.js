// chart.js — the chart table.
//
// Drawn as a portolan rather than a modern map, because that is what a merchant
// in 1620 would have had on the table: parchment, a rhumb-line network struck
// from a ring of compass roses, coastlines inked and tinted, and a cartouche in
// the empty ocean. The rhumb network is the period's actual navigation aid —
// you laid a straightedge along the nearest rhumb to read a course — so it is
// doing a job here as well as looking right.
//
// The whole panel is the parchment. There is no map box inside a frame; the
// margins are open ocean, which is where the cartouche and the scale live.

import { PORTS, PORT, chartXY, passage, cardinal, distanceNm } from "./world.js";
import { COAST, MAJOR_AREA } from "./coastline.js";

export const VB_W = 1040, VB_H = 760;

// Uniform degrees-to-pixels, so shapes are not stretched. Latitude drives the
// fit because the Atlantic window is taller than it is wide.
const LAT_TOP = 58, LAT_BOT = -20;
const MAP_TOP = 34, MAP_BOT = 726;
const SCALE = (MAP_BOT - MAP_TOP) / (LAT_TOP - LAT_BOT);   // px per degree
const LON_ORIGIN_X = 648;                                   // where 0 degrees falls

export function project(lat, lon) {
  return {
    x: LON_ORIGIN_X + lon * SCALE,
    y: MAP_TOP + (LAT_TOP - lat) * SCALE,
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* --------------------------------------------------------------- defs ---- */

function defs() {
  return `<defs>
    <!-- Paper grain: low-frequency turbulence lit from the side, so the sheet
         reads as laid vellum rather than flat fill. -->
    <filter id="grain" x="-4%" y="-4%" width="108%" height="108%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" seed="7" result="n"/>
      <feDiffuseLighting in="n" lighting-color="#fff8e6" surfaceScale="1.1" result="lit">
        <feDistantLight azimuth="115" elevation="62"/>
      </feDiffuseLighting>
      <feComposite in="lit" in2="SourceGraphic" operator="arithmetic" k1="1.05" k2="0" k3="0" k4="0"/>
    </filter>

    <!-- Age staining: big soft blotches, strongest at the edges. -->
    <filter id="stain" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="3" seed="19" result="s"/>
      <feColorMatrix in="s" type="matrix" result="m"
        values="0 0 0 0 0.42  0 0 0 0 0.30  0 0 0 0 0.14  0 0 0 -0.72 0.42"/>
      <feComposite in="m" in2="SourceGraphic" operator="in"/>
    </filter>

    <!-- Ink bleed for the coastline, so the shore is not a vector-sharp edge. -->
    <filter id="bleed" x="-3%" y="-3%" width="106%" height="106%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="3" result="t"/>
      <feDisplacementMap in="SourceGraphic" in2="t" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
    </filter>

    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#efe3c6"/>
      <stop offset="45%"  stop-color="#e7d9b8"/>
      <stop offset="100%" stop-color="#dbcaa4"/>
    </linearGradient>

    <radialGradient id="burn" cx="50%" cy="48%" r="68%">
      <stop offset="62%"  stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(86,58,24,0.30)"/>
    </radialGradient>

    <!-- Coastal shading: the hatched band a cartographer inks inside the shore. -->
    <pattern id="shoreHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#7d6034" stroke-width="0.8" opacity="0.5"/>
    </pattern>
  </defs>`;
}

/* --------------------------------------------------------------- paper ---- */

function paper() {
  return `
    <rect width="${VB_W}" height="${VB_H}" fill="url(#paper)"/>
    <rect width="${VB_W}" height="${VB_H}" filter="url(#grain)" opacity="0.30" fill="#e7d9b8"/>
    <rect width="${VB_W}" height="${VB_H}" filter="url(#stain)" opacity="0.55" fill="#8a6a34"/>
    <rect width="${VB_W}" height="${VB_H}" fill="url(#burn)"/>`;
}

function border() {
  const m = 11, n = 20;
  return `
    <rect x="${m}" y="${m}" width="${VB_W - m * 2}" height="${VB_H - m * 2}"
      fill="none" stroke="#6b5228" stroke-width="2.2" opacity="0.72"/>
    <rect x="${n}" y="${n}" width="${VB_W - n * 2}" height="${VB_H - n * 2}"
      fill="none" stroke="#6b5228" stroke-width="0.8" opacity="0.55"/>`;
}

/* ---------------------------------------------------------- rhumb lines ---- */

/**
 * A portolan wind-rose network: sixteen nodes on a hidden circle, every node
 * joined to every other. The chords that result are the rhumbs. Colour follows
 * the convention — black for the eight principal winds, green for the half
 * winds, red for the quarter winds.
 */
function rhumbs() {
  const cx = 470, cy = 400, R = 372;
  const N = 16;
  const nodes = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    nodes.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, i });
  }
  const out = [];
  for (let a = 0; a < N; a++) {
    for (let b = a + 1; b < N; b++) {
      const step = (b - a) % N;
      const principal = a % 4 === 0 && b % 4 === 0;
      const half = a % 2 === 0 && b % 2 === 0;
      const stroke = principal ? "#3d3222" : half ? "#3f6b45" : "#9a4030";
      const w = principal ? 0.55 : 0.4;
      const op = principal ? 0.30 : half ? 0.22 : 0.18;
      void step;
      out.push(`<line x1="${nodes[a].x.toFixed(1)}" y1="${nodes[a].y.toFixed(1)}" x2="${nodes[b].x.toFixed(1)}" y2="${nodes[b].y.toFixed(1)}" stroke="${stroke}" stroke-width="${w}" opacity="${op}"/>`);
    }
  }
  // The nodes themselves, as small roses.
  for (const n of nodes) {
    out.push(`<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="3.2" fill="none" stroke="#6b5228" stroke-width="0.7" opacity="0.5"/>`);
  }
  return `<g class="rhumbs">${out.join("")}</g>`;
}

/* --------------------------------------------------------------- coast ---- */

function ringPath(flat) {
  let d = "";
  for (let i = 0; i < flat.length; i += 2) {
    const p = project(flat[i + 1], flat[i]);
    d += `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return d + "Z";
}

function coast() {
  const fills = [], strokes = [], hatch = [];
  for (const [hole, area, flat] of COAST) {
    const d = ringPath(flat);
    if (hole) {
      fills.push(`<path d="${d}" fill="url(#paper)"/>`);
    } else {
      fills.push(`<path d="${d}" fill="#cdb98c" opacity="0.92"/>`);
      if (area >= MAJOR_AREA) hatch.push(`<path d="${d}" fill="url(#shoreHatch)" opacity="0.45"/>`);
    }
    strokes.push(`<path d="${d}" fill="none" stroke="#5b431f" stroke-width="${area >= MAJOR_AREA ? 1.15 : 0.9}" opacity="0.85"/>`);
  }
  // The hatch is clipped to the land by being drawn over the same paths, then
  // the ink line goes on top so the shore stays crisp through the bleed filter.
  return `<g class="coast">
    <g>${fills.join("")}</g>
    <g>${hatch.join("")}</g>
    <g filter="url(#bleed)">${strokes.join("")}</g>
  </g>`;
}

/* ----------------------------------------------------------- graticule ---- */

function graticule() {
  const out = [];
  for (let lon = -50; lon <= 15; lon += 10) {
    const a = project(LAT_TOP, lon), b = project(LAT_BOT, lon);
    out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y}" x2="${b.x.toFixed(1)}" y2="${b.y}" stroke="#6b5228" stroke-width="0.5" opacity="0.22" stroke-dasharray="2 5"/>`);
    if (lon >= -50 && lon <= 15) {
      out.push(`<text x="${a.x.toFixed(1)}" y="${MAP_TOP - 9}" class="grat-label" text-anchor="middle">${Math.abs(lon)}&#176;${lon < 0 ? "W" : lon > 0 ? "E" : ""}</text>`);
    }
  }
  for (let lat = -20; lat <= 55; lat += 10) {
    const a = project(lat, -52), b = project(lat, 16);
    out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#6b5228" stroke-width="0.5" opacity="0.22" stroke-dasharray="2 5"/>`);
    out.push(`<text x="${(a.x - 8).toFixed(1)}" y="${(a.y + 3.5).toFixed(1)}" class="grat-label" text-anchor="end">${Math.abs(lat)}&#176;${lat < 0 ? "S" : "N"}</text>`);
  }
  // The tropics and the line, which is what a period chart would actually mark.
  for (const [lat, name] of [[23.44, "Tropic of Cancer"], [0, "The Line"]]) {
    const a = project(lat, -52), b = project(lat, 16);
    out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#9a4030" stroke-width="0.9" opacity="0.4"/>`);
    out.push(`<text x="${(a.x + 12).toFixed(1)}" y="${(a.y - 5).toFixed(1)}" class="tropic-label">${name}</text>`);
  }
  return `<g class="graticule">${out.join("")}</g>`;
}

/* ------------------------------------------------------------ compass ---- */

function compassRose(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const a1 = a - Math.PI / 8, a2 = a + Math.PI / 8;
    const R = i % 2 === 0 ? r : r * 0.66;
    const ri = r * 0.17;
    const tip = `${(cx + Math.cos(a) * R).toFixed(1)},${(cy + Math.sin(a) * R).toFixed(1)}`;
    const l = `${(cx + Math.cos(a1) * ri).toFixed(1)},${(cy + Math.sin(a1) * ri).toFixed(1)}`;
    const rr = `${(cx + Math.cos(a2) * ri).toFixed(1)},${(cy + Math.sin(a2) * ri).toFixed(1)}`;
    // Two half-points per compass point, one inked and one left open, which is
    // what gives a rose its pinwheel look.
    pts.push(`<polygon points="${cx},${cy} ${l} ${tip}" fill="#3d3222" opacity="0.82"/>`);
    pts.push(`<polygon points="${cx},${cy} ${tip} ${rr}" fill="none" stroke="#3d3222" stroke-width="0.7" opacity="0.7"/>`);
  }
  return `<g class="rose">
    <circle cx="${cx}" cy="${cy}" r="${r * 1.12}" fill="none" stroke="#6b5228" stroke-width="0.8" opacity="0.55"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 1.02}" fill="none" stroke="#6b5228" stroke-width="0.5" opacity="0.45"/>
    ${pts.join("")}
    <path d="M${cx},${cy - r * 1.02} l-${r * 0.11},${r * 0.20} h${r * 0.22} Z" fill="#9a4030"/>
    <text x="${cx}" y="${cy - r * 1.28}" class="rose-n" text-anchor="middle">N</text>
  </g>`;
}

/* ------------------------------------------------------------ furniture ---- */

function scaleBar(x, y) {
  // One degree of latitude is 60 nautical miles, and SCALE is px per degree.
  const nmPerPx = 60 / SCALE;
  const target = 500;                       // nautical miles
  const px = target / nmPerPx;
  const seg = px / 5;
  const ticks = [];
  for (let i = 0; i < 5; i++) {
    ticks.push(`<rect x="${(x + i * seg).toFixed(1)}" y="${y}" width="${seg.toFixed(1)}" height="7"
      fill="${i % 2 ? "#efe3c6" : "#3d3222"}" stroke="#3d3222" stroke-width="0.6"/>`);
  }
  return `<g class="scalebar">
    ${ticks.join("")}
    <text x="${x}" y="${y + 21}" class="chart-note" text-anchor="middle">0</text>
    <text x="${(x + px).toFixed(1)}" y="${y + 21}" class="chart-note" text-anchor="middle">${target}</text>
    <text x="${(x + px / 2).toFixed(1)}" y="${y - 8}" class="chart-note" text-anchor="middle">Scale of sea miles</text>
  </g>`;
}

function cartouche(house) {
  const x = 42, y = 470, w = 250, h = 176;
  const d = `M${x},${y + 14} q0,-14 14,-14 h${w - 28} q14,0 14,14 v${h - 28} q0,14 -14,14 h-${w - 28} q-14,0 -14,-14 Z`;
  const tierName = ["A small house", "A house of standing", "A great house"][house.tier] || "A small house";
  return `<g class="cartouche">
    <path d="${d}" fill="#efe6cd" opacity="0.72" stroke="#6b5228" stroke-width="1.4"/>
    <path d="${d}" fill="none" stroke="#6b5228" stroke-width="0.5" opacity="0.6" transform="translate(4,4) scale(0.985)"/>
    <text x="${x + w / 2}" y="${y + 42}" class="cart-title" text-anchor="middle">Carta do Mar Oceano</text>
    <line x1="${x + 28}" y1="${y + 54}" x2="${x + w - 28}" y2="${y + 54}" stroke="#6b5228" stroke-width="0.7" opacity="0.6"/>
    <text x="${x + w / 2}" y="${y + 78}" class="cart-line" text-anchor="middle">Lisbon to the Guinea coast</text>
    <text x="${x + w / 2}" y="${y + 98}" class="cart-line" text-anchor="middle">and the coast of Brazil</text>
    <text x="${x + w / 2}" y="${y + 128}" class="cart-sub" text-anchor="middle">${esc(tierName)}</text>
    <text x="${x + w / 2}" y="${y + 148}" class="cart-sub" text-anchor="middle">${house.fleet.length} hull${house.fleet.length > 1 ? "s" : ""} &#183; ${Math.round(house.reputation[house.location] || 0)} standing here</text>
  </g>`;
}

function legend(x, y) {
  const rows = [
    ["port-dot here", "Where you lie"],
    ["port-dot dest", "Course laid"],
    ["port-dot", "Open to you"],
    ["port-dot shut", "Beyond your standing"],
    ["port-dot blockaded", "Blockaded"],
  ];
  const out = rows.map((r, i) =>
    `<circle cx="${x + 8}" cy="${y + 14 + i * 20}" r="4.5" class="${r[0]}"/>
     <text x="${x + 22}" y="${y + 18 + i * 20}" class="chart-note">${r[1]}</text>`);
  return `<g class="legend">
    <text x="${x}" y="${y - 4}" class="chart-note-b">The marks</text>
    ${out.join("")}</g>`;
}

/** A small drawn ship, the way a cartographer fills empty ocean. */
function doodleShip(x, y, s) {
  return `<g class="doodle" transform="translate(${x},${y}) scale(${s})" opacity="0.42">
    <path d="M-16,0 q16,9 32,0 l-4,5 q-12,5 -24,0 Z" fill="#3d3222"/>
    <line x1="0" y1="0" x2="0" y2="-24" stroke="#3d3222" stroke-width="1.4"/>
    <path d="M1,-22 q11,5 0,10 Z" fill="#3d3222" opacity="0.7"/>
    <path d="M-1,-16 q-10,5 0,9 Z" fill="#3d3222" opacity="0.55"/>
  </g>`;
}

/** A blowing wind-head, the other thing a cartographer puts in empty ocean.
 *  Drawn in profile with cheeks out and breath streaming, not face-on — face-on
 *  with two dots and a curve reads as a smiley, which it did. */
function windHead(x, y, s) {
  return `<g class="doodle" transform="translate(${x},${y}) scale(${s})" opacity="0.40">
    <path d="M0,-15 q13,0 15,14 q2,14 -11,17 q-13,3 -17,-9 q-4,-13 4,-19 q4,-3 9,-3 Z"
      fill="none" stroke="#3d3222" stroke-width="1.3"/>
    <path d="M-9,-14 q-7,-4 -11,3 q9,-1 11,2" fill="#3d3222" opacity="0.75"/>
    <path d="M-11,-2 q-6,1 -6,6 q5,-2 7,-2" fill="#3d3222" opacity="0.6"/>
    <circle cx="4" cy="-2" r="1.7" fill="#3d3222"/>
    <path d="M11,7 q6,3 2,7" fill="none" stroke="#3d3222" stroke-width="1.2"/>
    <path d="M15,10 q18,2 33,-6" fill="none" stroke="#3d3222" stroke-width="1.1" stroke-dasharray="7 5"/>
    <path d="M15,15 q16,5 29,0" fill="none" stroke="#3d3222" stroke-width="0.85" stroke-dasharray="5 5"/>
    <path d="M14,20 q13,6 23,4" fill="none" stroke="#3d3222" stroke-width="0.7" stroke-dasharray="4 5"/>
  </g>`;
}

/* --------------------------------------------------------------- ports ---- */

/**
 * Greedy label placement. Each port tries right, left, above then below, and
 * takes the first slot that does not overlap a box already placed. Without
 * this, Cadiz sits on top of Tangier and Elmina runs off the sheet.
 */
function placeLabels(entries) {
  const placed = [];
  const hit = (b) => placed.some((p) =>
    b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);

  for (const e of entries) {
    const w = e.name.length * 6.4 + 8, h = 15;
    const slots = [
      { x: e.x + 10, y: e.y - h / 2, anchor: "start", tx: e.x + 10, ty: e.y + 4 },
      { x: e.x - 10 - w, y: e.y - h / 2, anchor: "end", tx: e.x - 10, ty: e.y + 4 },
      { x: e.x - w / 2, y: e.y - 22, anchor: "middle", tx: e.x, ty: e.y - 12 },
      { x: e.x - w / 2, y: e.y + 8, anchor: "middle", tx: e.x, ty: e.y + 19 },
      { x: e.x + 10, y: e.y + 6, anchor: "start", tx: e.x + 10, ty: e.y + 17 },
      { x: e.x - 10 - w, y: e.y + 6, anchor: "end", tx: e.x - 10, ty: e.y + 17 },
    ];
    let chosen = null;
    for (const s of slots) {
      const box = { x: s.x, y: s.y, w, h };
      if (box.x < 26 || box.x + box.w > VB_W - 26) continue;
      if (!hit(box)) { chosen = s; placed.push(box); break; }
    }
    if (!chosen) { chosen = slots[0]; placed.push({ x: slots[0].x, y: slots[0].y, w, h }); }
    e.label = chosen;
  }
  return entries;
}

function ports(house, dest) {
  const entries = PORTS.map((p) => {
    const q = project(p.lat, p.lon);
    return {
      id: p.id, name: p.name, x: q.x, y: q.y,
      here: p.id === house.location,
      dest: p.id === dest,
      open: house.portOpen(p.id),
      blockaded: house.market.isBlockaded(p.id),
    };
  });
  // Place the ones that matter first so they always get their best slot.
  const order = [...entries].sort((a, b) =>
    (b.here ? 4 : 0) + (b.dest ? 3 : 0) + (b.open ? 1 : 0) -
    ((a.here ? 4 : 0) + (a.dest ? 3 : 0) + (a.open ? 1 : 0)));
  placeLabels(order);

  return entries.map((e) => {
    const cls = ["port-dot", e.here ? "here" : "", e.dest ? "dest" : "",
      e.open ? "" : "shut", e.blockaded ? "blockaded" : ""].filter(Boolean).join(" ");
    const l = e.label;
    return `<g class="port-g ${e.open && !e.here ? "clickable" : ""}" data-port="${e.id}">
      <circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="15" class="port-hit"/>
      <circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="${e.here ? 6 : 4}" class="${cls}"/>
      ${e.here ? `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="11" class="here-halo"/>` : ""}
      <text x="${l.tx.toFixed(1)}" y="${l.ty.toFixed(1)}" text-anchor="${l.anchor}"
        class="port-label ${e.open ? "" : "shut"} ${e.here ? "is-here" : ""}">${esc(e.name)}</text>
    </g>`;
  }).join("");
}

/* -------------------------------------------------------------- course ---- */

function course(house, dest) {
  if (!dest || dest === house.location) return "";
  const a = project(PORT[house.location].lat, PORT[house.location].lon);
  const b = project(PORT[dest].lat, PORT[dest].lon);
  const leg = passage(house.location, dest, 7);
  const nm = Math.round(distanceNm(house.location, dest));
  const len = Math.hypot(b.x - a.x, b.y - a.y);

  // Offset the caption perpendicular to the course so it never sits on the
  // line, and drop it entirely on a short leg where it would swamp both ports.
  let cap = "";
  if (len > 90) {
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const mx = (a.x + b.x) / 2 + nx * 17;
    const my = (a.y + b.y) / 2 + ny * 17;
    const text = `${nm.toLocaleString()} sea miles \u00b7 ${cardinal(leg.bearing)}`;
    const w = text.length * 6.2 + 14;
    cap = `<g transform="translate(${mx.toFixed(1)},${my.toFixed(1)})">
      <rect x="${(-w / 2).toFixed(1)}" y="-10" width="${w.toFixed(1)}" height="18" rx="3"
        fill="#efe6cd" opacity="0.88" stroke="#6b5228" stroke-width="0.5"/>
      <text y="3" class="course-label" text-anchor="middle">${text}</text></g>`;
  }

  return `<g class="course-g">
    <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="course-shadow"/>
    <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="course"/>
    ${cap}
  </g>`;
}

/* ---------------------------------------------------------------- draw ---- */

export function drawChart(svg, house, dest) {
  const parts = [
    defs(),
    paper(),
    rhumbs(),
    graticule(),
    coast(),
    compassRose(470, 400, 52),
    compassRose(206, 176, 30),
    doodleShip(150, 300, 1.15),
    windHead(96, 96, 1.0),
    doodleShip(880, 590, 0.9),
    course(house, dest),
    ports(house, dest),
    cartouche(house),
    legend(846, 486),
    scaleBar(846, 660),
    border(),
  ];
  svg.setAttribute("viewBox", `0 0 ${VB_W} ${VB_H}`);
  svg.innerHTML = parts.join("");
}

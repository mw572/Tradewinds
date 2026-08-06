// ship3d.js — the ship, built rather than blocked out.
//
// The hull is lofted: a rounded-V cross-section is swept along the keel while
// its beam, depth and sheer height vary station by station. That gives a sharp
// entry at the bow, full midships, a tucked run aft and a proper sheer line,
// none of which you can get from stacked boxes.
//
// On top of that: wales and channels, shrouds and stays as real lines, square
// courses that belly with the trim, a lateen mizzen, a working rudder, a stern
// lantern that lights at dusk, and a wake ribbon with bow spray.

import * as THREE from "three";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------- hull geometry ---- */

// The three curves that define a hull, per era. Hoisted to module scope because
// the wales, the deck and the rail all follow the same shape — the moment they
// are approximated separately you get gaps and floating trim.
//
// The shapes are genuinely different, not the same hull rescaled. A caravel is
// a short cod's-head-and-mackerel-tail with enormous sheer; an 1880 steamer is
// long, parallel-sided and almost sheerless with a counter stern; a boxship is
// a rectangular box with a bulbous bow, because every cubic metre that isn't a
// rectangle is a container you cannot stack.

const SHAPES = {
  sail: {
    beam: (u) => Math.pow(Math.sin(Math.PI * clamp(u * 1.14, 0, 1)), 0.62) *
                 (1 - Math.pow(clamp((u - 0.72) / 0.28, 0, 1), 1.8) * 0.42),
    draft: (u) => Math.pow(Math.sin(Math.PI * clamp(u * 1.06, 0, 1)), 0.5) *
                  (1 - Math.pow(clamp((u - 0.85) / 0.15, 0, 1), 2) * 0.55),
    sheer: (u) => 0.62 + 0.72 * Math.pow(Math.abs(u - 0.46) * 2.05, 1.7),
    rib: 0.72, rise: 1.35,
  },
  steam: {
    // Fine entry, long parallel middle body, counter stern tucked right in.
    beam: (u) => {
      const entry = Math.pow(Math.sin(Math.PI * clamp(u * 2.6, 0, 0.5)), 0.5);
      const run = 1 - Math.pow(clamp((u - 0.78) / 0.22, 0, 1), 1.6) * 0.78;
      return Math.min(1, entry) * run;
    },
    draft: (u) => Math.min(1, Math.pow(Math.sin(Math.PI * clamp(u * 2.2, 0, 0.5)), 0.42)) *
                  (1 - Math.pow(clamp((u - 0.86) / 0.14, 0, 1), 2) * 0.62),
    sheer: (u) => 0.86 + 0.42 * Math.pow(Math.abs(u - 0.52) * 2.0, 2.6),
    rib: 0.42, rise: 1.10,
  },
  box: {
    // Almost a rectangle. The bow is a bulb, the stern is a transom.
    beam: (u) => {
      const entry = Math.pow(Math.sin(Math.PI * clamp(u * 3.4, 0, 0.5)), 0.34);
      const run = 1 - Math.pow(clamp((u - 0.88) / 0.12, 0, 1), 2) * 0.34;
      return Math.min(1, entry) * run;
    },
    draft: (u) => Math.min(1, Math.pow(Math.sin(Math.PI * clamp(u * 3.0, 0, 0.5)), 0.22)),
    sheer: (u) => 0.96 + 0.16 * Math.pow(Math.abs(u - 0.55) * 2.0, 3.0),
    rib: 0.24, rise: 1.02,
  },
};

const shapeOf = (d) => SHAPES[d.shape || "sail"];

// Kept as a named export because the deck builder and the harbour's moored
// craft both use it.
const beamProfile = (u, shape = "sail") => SHAPES[shape].beam(u);

/** A point on the hull skin. u runs bow to stern, v runs keel to gunwale. */
export function hullPoint(u, v, d) {
  const sp = shapeOf(d);
  const b = (d.beam * 0.5) * sp.beam(u);
  const dr = d.draft * sp.draft(u);
  const sh = d.rise * sp.sheer(u);
  return {
    x: b * Math.pow(v, sp.rib),
    y: -dr + (dr + sh) * Math.pow(v, sp.rise),
    z: (u - 0.5) * d.len,
  };
}

/**
 * A wale: the heavy rubbing strake that runs the length of a hull. Built as a
 * ribbon swept along a constant-v line of the hull skin and pushed slightly
 * proud, so it hugs the tumblehome instead of hovering over it.
 *
 * This replaces a scaled TorusGeometry, which was quick to write and read on
 * screen as a black hula hoop around the ship.
 */
function buildWale(d, v, thickness, proud) {
  const N = 40;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const c = hullPoint(u, v, d);
    // Outward normal in the beam plane, approximated from the local slope.
    const cUp = hullPoint(u, Math.min(1, v + 0.05), d);
    const nx = 1, ny = -(cUp.x - c.x) / 0.05 * 0.12;
    const nl = Math.hypot(nx, ny) || 1;
    const ox = (nx / nl) * proud, oy = (ny / nl) * proud;
    for (const side of [1, -1]) {
      for (const dy of [thickness, -thickness]) {
        pos.push(side * (c.x + ox), c.y + oy + dy, c.z);
      }
    }
  }
  // Four vertices per station: stbd-top, stbd-bottom, port-top, port-bottom.
  for (let i = 0; i < N; i++) {
    const a = i * 4, b = (i + 1) * 4;
    idx.push(a, b, a + 1, a + 1, b, b + 1);           // starboard face
    idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // port face
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Oak planking: horizontal strakes with caulked seams and weathering. */
function plankTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#5b3d22"; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) {
    const shade = 0.82 + Math.random() * 0.36;
    g.fillStyle = `rgb(${Math.round(91 * shade)},${Math.round(61 * shade)},${Math.round(34 * shade)})`;
    g.fillRect(0, y, 256, 7);
    g.fillStyle = "rgba(24,14,7,0.55)";           // the caulked seam
    g.fillRect(0, y + 7, 256, 1);
  }
  // Butt joints between plank ends, and a little tar and salt staining.
  g.fillStyle = "rgba(24,14,7,0.4)";
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 256, y = Math.floor(Math.random() * 32) * 8;
    g.fillRect(x, y, 1.2, 7);
  }
  g.fillStyle = "rgba(180,190,180,0.05)";
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.ellipse(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 22, 3 + Math.random() * 8, 0, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}

/**
 * Loft a hull.
 *  len   — stem to transom
 *  beam  — maximum width
 *  draft — keel below the waterline
 *  rise  — freeboard at the waist
 */
export function buildHull(d) {
  const STATIONS = 34;
  const RIBS = 15;
  const pos = [], uvs = [], idx = [], grid = [];

  for (let i = 0; i < STATIONS; i++) {
    const u = i / (STATIONS - 1);
    const row = [];
    for (let j = 0; j < RIBS; j++) {
      const v = j / (RIBS - 1);
      const p = hullPoint(u, v, d);
      row.push(pos.length / 3);
      pos.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
    grid.push(row);
  }

  for (let i = 0; i < STATIONS - 1; i++) {
    for (let j = 0; j < RIBS - 1; j++) {
      const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j], e = grid[i + 1][j + 1];
      idx.push(a, c, b, b, c, e);
    }
  }

  // Mirror to port with the winding flipped so the normals face outward.
  const half = pos.length / 3;
  for (let k = 0; k < half; k++) {
    pos.push(-pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    uvs.push(uvs[k * 2], uvs[k * 2 + 1]);
  }
  const tri = idx.length;
  for (let k = 0; k < tri; k += 3) idx.push(idx[k] + half, idx[k + 2] + half, idx[k + 1] + half);

  for (let j = 0; j < RIBS - 1; j++) {
    const s0 = grid[STATIONS - 1][j], s1 = grid[STATIONS - 1][j + 1];
    idx.push(s0, s1, s0 + half, s1, s1 + half, s0 + half);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Deck laid just inside the gunwale, following the same beam curve. */
function buildDeck({ len, beam, y, shape: shapeId = "sail" }) {
  const shape = new THREE.Shape();
  const N = 26;
  const w = (u) => (beam * 0.5) * beamProfile(u, shapeId) * 0.93;
  shape.moveTo(w(0), -len / 2);
  for (let i = 1; i <= N; i++) { const u = i / N; shape.lineTo(w(u), (u - 0.5) * len); }
  for (let i = N; i >= 0; i--) { const u = i / N; shape.lineTo(-w(u), (u - 0.5) * len); }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

/* --------------------------------------------------------------- sails ---- */

function squareSail(w, h, belly = 1.0) {
  const geo = new THREE.PlaneGeometry(w, h, 16, 10);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    // Belly: full across the middle, pinched at the leeches where the sail is
    // bent to the yard and hauled down at the clews.
    const acrossW = Math.cos((x / w) * Math.PI);
    const down = (y / h) + 0.5;                        // 0 at the foot, 1 at the head
    const acrossH = Math.sin(down * Math.PI) * 0.55 + 0.45;
    p.setZ(i, -acrossW * acrossH * belly * (h * 0.30));
    // The foot scoops: an unsheeted sail hangs in a curve, not a straight edge.
    if (down < 0.06) p.setY(i, y + Math.abs(acrossW) * h * 0.07);
  }
  geo.computeVertexNormals();
  return geo;
}

function lateenSail(luff, foot, belly = 0.9) {
  const shape = new THREE.Shape();
  shape.moveTo(0, luff * 0.5);
  shape.lineTo(foot, -luff * 0.32);
  shape.lineTo(0, -luff * 0.5);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 14);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, -Math.sin((p.getX(i) / foot) * Math.PI) * belly * foot * 0.14);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A soft round puff, so smoke is not a cloud of grey squares. */
function puffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.42)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Riveted steel plating. Rivet lines are what make a hull read as iron. */
function plateTexture(base, rivets) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  const col = new THREE.Color(base);
  g.fillStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
  g.fillRect(0, 0, 256, 256);
  // Plate seams on a staggered grid, the way shell plating is actually laid.
  g.strokeStyle = "rgba(0,0,0,0.30)"; g.lineWidth = 1.2;
  for (let y = 0; y < 256; y += 32) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
    const off = (y / 32) % 2 ? 32 : 0;
    for (let x = off; x < 256; x += 64) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke();
    }
  }
  if (rivets) {
    g.fillStyle = "rgba(255,255,255,0.10)";
    for (let y = 4; y < 256; y += 32) {
      for (let x = 4; x < 256; x += 7) g.fillRect(x, y, 1.4, 1.4);
    }
  }
  // Rust weeping and salt streaks.
  g.fillStyle = "rgba(120,62,30,0.16)";
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, y = Math.random() * 200;
    g.fillRect(x, y, 1.5 + Math.random() * 2, 12 + Math.random() * 40);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2);
  return t;
}

/** Corrugated container side, with door ends and a paint panel. */
function containerTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 64);
  // Corrugations: vertical ribs, which is how you know it is a container and
  // not a crate, even at a hundred metres.
  for (let x = 0; x < 128; x += 6) {
    g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(x, 0, 2, 64);
    g.fillStyle = "rgba(255,255,255,0.22)"; g.fillRect(x + 3, 0, 1.5, 64);
  }
  g.fillStyle = "rgba(0,0,0,0.30)";
  g.fillRect(0, 0, 128, 3); g.fillRect(0, 61, 128, 3);
  g.fillStyle = "rgba(255,255,255,0.30)";
  g.fillRect(52, 22, 26, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sailTexture(withCross) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#efe8d6"; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(150,138,112,0.30)"; g.lineWidth = 1;
  for (let y = 12; y < 256; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  g.fillStyle = "rgba(120,110,90,0.07)";
  for (let i = 0; i < 70; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 30, 7);
  if (withCross) {
    g.fillStyle = "rgba(168,52,42,0.80)";
    g.fillRect(110, 38, 36, 180);
    g.fillRect(54, 96, 148, 36);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --------------------------------------------------------------- ship ---- */

export class Ship3D {
  /** `spec` from the fleet: { era, type, masts, rig, armed, condition } */
  constructor(spec = {}) {
    // Scale and proportion are era properties, not just size. A boxship is not
    // a big caravel: she is nine times longer than she is deep and her length
    // to beam ratio is completely different.
    const SCALE = {
      caravel: 1.0, carrack: 1.28, fluyt: 1.36, galleon: 1.58,
      coaster: 1.5, tramp: 2.2, collier: 2.6, liner: 3.0,
      feeder: 2.6, handy: 3.4, panamax: 4.4, postpanamax: 5.4,
    };
    const S = SCALE[spec.type] || 1;
    const era = spec.era || "sail";
    this.era = era;
    this.spec = spec;
    this.scale = S;
    this.group = new THREE.Group();

    const PROP = {
      sail:  { len: 26,   beamR: 0.285, draft: 2.4,  rise: 3.6 },
      steam: { len: 30,   beamR: 0.140, draft: 2.6,  rise: 2.4 },
      box:   { len: 34,   beamR: 0.135, draft: 2.4,  rise: 3.0 },
    }[era];
    this.len = PROP.len * S;
    this.beam = this.len * PROP.beamR;
    this.dims = {
      len: this.len, beam: this.beam,
      draft: PROP.draft * S, rise: PROP.rise * S, shape: era,
    };

    this.sailSet = 1;
    this.heel = 0;
    this.sails = [];
    this.spray = null;
    this.smoke = null;

    this._materials(spec);
    if (era === "steam") this._buildSteamer(S, spec);
    else if (era === "box") this._buildBoxship(S, spec);
    else {
      this._buildHull(S);
      this._buildCastles(S, spec);
      this._buildRig(S, spec);
      this._buildDetails(S, spec);
    }
    this._buildSpray(S);
  }

  /** Hull, deck and a boot-topping stripe, shared by the powered eras. */
  _poweredHull(S, hullMat, bootColor) {
    const d = this.dims;
    const hull = new THREE.Mesh(buildHull(d), hullMat);
    hull.castShadow = true; hull.receiveShadow = true;
    this.group.add(hull);
    this.hullMesh = hull;

    // Boot-topping: the band of anti-fouling colour at the waterline. It is the
    // single detail that most makes a steel hull read as a real ship.
    const boot = new THREE.Mesh(
      buildWale(d, 0.30, 0.55 * S, 0.02 * S),
      new THREE.MeshStandardMaterial({ color: bootColor, roughness: 0.72, side: THREE.DoubleSide })
    );
    this.group.add(boot);

    const deck = new THREE.Mesh(
      buildDeck({ len: d.len, beam: d.beam, y: d.rise * 0.97, shape: this.era }),
      this.mat.steelDeck
    );
    deck.receiveShadow = true;
    this.group.add(deck);
    this.deckY = d.rise * 0.97;

    // Bulwark: the plating that runs up from the deck edge.
    const bul = new THREE.Mesh(buildWale(d, 1.0, 0.42 * S, 0.03 * S), hullMat);
    bul.castShadow = true;
    this.group.add(bul);

    return hull;
  }

  /** Guard rails: stanchions and two wires, run along a constant-v hull line. */
  _railing(S, fromU, toU, yOff, step = 0.045) {
    const d = this.dims;
    const mat = this.mat.rail;
    for (let u = fromU; u <= toU; u += step) {
      const p = hullPoint(u, 1, d);
      for (const side of [1, -1]) {
        const st = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05 * S, 0.05 * S, 0.85 * S, 4), this.mat.steelTrim);
        st.position.set(side * p.x, p.y + yOff + 0.42 * S, p.z);
        this.group.add(st);
      }
    }
    for (const h of [0.32, 0.72]) {
      for (const side of [1, -1]) {
        const pts = [];
        for (let u = fromU; u <= toU; u += 0.02) {
          const p = hullPoint(u, 1, d);
          pts.push(new THREE.Vector3(side * p.x, p.y + yOff + h * S, p.z));
        }
        if (pts.length > 1) {
          this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
      }
    }
  }

  /* ============================ STEAM, 1880 ============================
   * A tramp steamer: black riveted iron hull, white deckhouse, one tall
   * funnel, two pole masts carrying derricks rather than canvas, ventilator
   * cowls, and a counter stern. No square rig — the sails are gone and the
   * silhouette is entirely different because of it.
   */
  _buildSteamer(S, spec) {
    const d = this.dims;
    this._poweredHull(S, this.mat.ironHull, 0x6d2b22);
    const deckY = this.deckY;
    const add = (m) => { m.castShadow = true; this.group.add(m); return m; };

    // Riveted plating seams along the topsides.
    for (const v of [0.58, 0.80]) {
      const seam = new THREE.Mesh(buildWale(d, v, 0.07 * S, 0.02 * S), this.mat.steelTrim);
      this.group.add(seam);
    }

    // Well decks fore and aft with a raised bridge deck between: the classic
    // three-island profile of a tramp.
    const bridgeDeck = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.92, 0.9 * S, d.len * 0.22), this.mat.steelDeck));
    bridgeDeck.position.set(0, deckY + 0.45 * S, -d.len * 0.02);

    const house = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.66, 2.6 * S, d.len * 0.15), this.mat.white));
    house.position.set(0, deckY + 2.2 * S, -d.len * 0.02);

    // Bridge with wings out to the ship's side, and a row of windows.
    const bridge = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 1.02, 1.5 * S, d.len * 0.075), this.mat.white));
    bridge.position.set(0, deckY + 4.25 * S, -d.len * 0.055);
    const glass = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.99, 0.7 * S, d.len * 0.078), this.mat.glass));
    glass.position.set(0, deckY + 4.5 * S, -d.len * 0.055);
    const monkey = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 1.04, 0.16 * S, d.len * 0.08), this.mat.steelDeck));
    monkey.position.set(0, deckY + 5.05 * S, -d.len * 0.055);

    // The funnel. Tall, raked aft, black-topped over the company colour.
    const funnel = add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.86 * S, 1.02 * S, 5.6 * S, 18), this.mat.funnel));
    funnel.position.set(0, deckY + 6.1 * S, d.len * 0.03);
    funnel.rotation.x = -0.10;
    const cap = add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.90 * S, 0.90 * S, 1.15 * S, 18), this.mat.black));
    cap.position.set(0, deckY + 8.6 * S, d.len * 0.03 - 0.26 * S);
    cap.rotation.x = -0.10;
    this.funnelTop = new THREE.Vector3(0, deckY + 9.2 * S, d.len * 0.03 - 0.32 * S);

    // Steam pipe alongside the funnel, and guy wires.
    const pipe = add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.13 * S, 0.13 * S, 6.2 * S, 8), this.mat.steelTrim));
    pipe.position.set(1.05 * S, deckY + 6.4 * S, d.len * 0.03);
    for (const side of [1, -1]) {
      this.group.add(line(
        new THREE.Vector3(side * 0.9 * S, deckY + 8.4 * S, d.len * 0.03),
        new THREE.Vector3(side * d.beam * 0.44, deckY, d.len * 0.10), this.mat.rope));
    }

    // Ventilator cowls: the bell-mouthed trumpets that fed air to the stokehold.
    for (const [x, z] of [[-1.5, 0.10], [1.5, 0.10], [-1.5, -0.10], [1.5, -0.10]]) {
      const stalk = add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.24 * S, 0.28 * S, 2.4 * S, 8), this.mat.white));
      stalk.position.set(x * S, deckY + 1.2 * S, d.len * z);
      const cowl = add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.62 * S, 0.26 * S, 0.9 * S, 10, 1, true), this.mat.cowl));
      cowl.position.set(x * S, deckY + 2.6 * S, d.len * z + 0.30 * S);
      cowl.rotation.x = -Math.PI / 2.4;
    }

    // Two pole masts, each with a pair of cargo derricks and a boom rest.
    for (const [z, h] of [[-d.len * 0.26, 12 * S], [d.len * 0.24, 11 * S]]) {
      const mast = add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.15 * S, 0.26 * S, h, 10), this.mat.mastBuff));
      mast.position.set(0, deckY + h / 2, z);
      for (const side of [1, -1]) {
        const derrick = add(new THREE.Mesh(
          new THREE.CylinderGeometry(0.10 * S, 0.15 * S, h * 0.66, 7), this.mat.mastBuff));
        derrick.position.set(side * 1.5 * S, deckY + h * 0.30, z + side * 0.4 * S);
        derrick.rotation.set(0.42, 0, side * 0.34);
        // Runner from the derrick head down to the hatch it works.
        this.group.add(line(
          new THREE.Vector3(side * 2.6 * S, deckY + h * 0.56, z + side * 0.9 * S),
          new THREE.Vector3(side * 1.1 * S, deckY + 0.3 * S, z - 2.4 * S), this.mat.rope));
      }
      // Stays fore and aft.
      for (const dz of [-1, 1]) {
        this.group.add(line(
          new THREE.Vector3(0, deckY + h * 0.92, z),
          new THREE.Vector3(0, deckY + 0.4 * S, z + dz * d.len * 0.16), this.mat.rope));
      }
    }

    // Cargo hatches with tarpaulins and battened coamings.
    for (const z of [-0.34, -0.18, 0.14, 0.32]) {
      const coam = add(new THREE.Mesh(
        new THREE.BoxGeometry(d.beam * 0.50, 0.42 * S, d.len * 0.085), this.mat.steelTrim));
      coam.position.set(0, deckY + 0.21 * S, d.len * z);
      const tarp = add(new THREE.Mesh(
        new THREE.BoxGeometry(d.beam * 0.46, 0.14 * S, d.len * 0.078), this.mat.tarp));
      tarp.position.set(0, deckY + 0.48 * S, d.len * z);
    }

    // Portholes down the topsides.
    for (let i = 0; i < 16; i++) {
      const u = 0.18 + (i / 16) * 0.68;
      const p = hullPoint(u, 0.72, d);
      for (const side of [1, -1]) {
        const ph = new THREE.Mesh(new THREE.CircleGeometry(0.16 * S, 8), this.mat.glass);
        ph.position.set(side * (p.x + 0.05 * S), p.y, p.z);
        ph.rotation.y = side * Math.PI / 2;
        this.group.add(ph);
      }
    }

    // Counter stern overhang, rudder and a single screw.
    const counter = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.52, 0.5 * S, 1.6 * S), this.mat.ironHull));
    counter.position.set(0, 0.3 * S, d.len * 0.50);
    const rudderPivot = new THREE.Group();
    rudderPivot.position.set(0, -1.0 * S, d.len * 0.47);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18 * S, 2.6 * S, 1.5 * S), this.mat.ironHull);
    blade.position.set(0, -0.6 * S, 0.6 * S);
    rudderPivot.add(blade);
    this.group.add(rudderPivot);
    this.rudderMesh = rudderPivot;

    this._railing(S, 0.10, 0.90, 0.05 * S, 0.05);
    this._buildEnsign(S, deckY + 0.4 * S, d.len * 0.46, 3.4 * S);
    this._buildSmoke(S);

    // Anchors catted at the bow.
    for (const side of [1, -1]) {
      const p = hullPoint(0.08, 0.74, d);
      const anc = add(new THREE.Mesh(new THREE.BoxGeometry(0.12 * S, 0.9 * S, 0.55 * S), this.mat.black));
      anc.position.set(side * (p.x + 0.06 * S), p.y, p.z);
    }
  }

  /* ============================= BOX, 1985 =============================
   * A container feeder: flat-topped hull, bulbous bow, accommodation block and
   * funnel right aft, and the cargo itself as the superstructure — bays of
   * boxes stacked three high, which is the whole silhouette.
   */
  _buildBoxship(S, spec) {
    const d = this.dims;
    this._poweredHull(S, this.mat.boxHull, 0x8c1f16);
    const deckY = this.deckY;
    const add = (m) => { m.castShadow = true; this.group.add(m); return m; };

    // Bulbous bow, below the waterline where it belongs.
    const bulb = add(new THREE.Mesh(new THREE.SphereGeometry(0.95 * S, 14, 10), this.mat.boxHull));
    bulb.scale.set(0.8, 0.72, 2.1);
    bulb.position.set(0, -d.draft * 0.55, -d.len * 0.505);

    // Hatch covers: the flat lids the deck stacks sit on.
    const BAYS = { feeder: 7, handy: 9, panamax: 11, postpanamax: 13 }[spec.type] || 7;
    // Bays run from the forecastle to the accommodation block, which is where
    // the cargo actually goes.
    const holdFrom = -d.len * 0.40, holdTo = d.len * 0.27;
    const bayLen = (holdTo - holdFrom) / BAYS;
    const firstZ = holdFrom + bayLen * 0.5;

    for (let b = 0; b < BAYS; b++) {
      const z = firstZ + b * bayLen;
      const cover = add(new THREE.Mesh(
        new THREE.BoxGeometry(d.beam * 0.90, 0.30 * S, bayLen * 0.90), this.mat.hatch));
      cover.position.set(0, deckY + 0.15 * S, z);
    }

    // The containers. Instanced, because a boxship is several hundred identical
    // boxes and one draw call is the difference between 60fps and a slideshow.
    const ROWS = spec.type === "feeder" ? 6 : spec.type === "handy" ? 7 : 9;
    const TIERS = spec.type === "feeder" ? 3 : spec.type === "handy" ? 4 : 5;
    const bw = (d.beam * 0.86) / ROWS;
    const bh = 0.78 * S;
    const bl = bayLen * 0.82;

    const boxGeo = new THREE.BoxGeometry(bw * 0.94, bh * 0.94, bl);
    const count = BAYS * ROWS * TIERS;
    const boxes = new THREE.InstancedMesh(boxGeo, this.mat.container, count);
    boxes.castShadow = true;
    boxes.receiveShadow = true;

    // Deterministic per-ship, so a given hull always loads the same way.
    let seed = 1337;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const LIVERY = [0xa5352b, 0x2b5fa5, 0xb5892c, 0x2f7a4f, 0x8d8d92, 0xc4622d, 0x37474f];
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();

    let i = 0, loaded = 0;
    for (let b = 0; b < BAYS; b++) {
      for (let r = 0; r < ROWS; r++) {
        // A real ship is never a perfect brick: the stack steps down toward the
        // bow where the deck narrows and the flare would foul it, and there are
        // always a few empty slots where a box was landed short.
        const nose = Math.min(1, (b + 1.2) / 2.2);
        const edge = 1 - Math.abs(r - (ROWS - 1) / 2) / ((ROWS - 1) / 2 + 0.9);
        const maxTier = Math.max(1, Math.round(TIERS * Math.min(nose, 0.55 + edge * 0.55)));
        for (let t = 0; t < TIERS; t++) {
          const present = t < maxTier && rnd() > 0.05;
          mtx.makeTranslation(
            (r - (ROWS - 1) / 2) * bw,
            present ? deckY + 0.30 * S + bh * (t + 0.5) : -9999,
            firstZ + b * bayLen
          );
          boxes.setMatrixAt(i, mtx);
          boxes.setColorAt(i, col.setHex(LIVERY[Math.floor(rnd() * LIVERY.length)]));
          if (present) loaded++;
          i++;
        }
      }
    }
    boxes.instanceMatrix.needsUpdate = true;
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    this.group.add(boxes);
    this.boxCount = loaded;

    // Accommodation block aft: five decks of white superstructure and a bridge
    // with wings that overhang the ship's side.
    const blockZ = d.len * 0.34;
    const block = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.86, 4.4 * S, d.len * 0.115), this.mat.white));
    block.position.set(0, deckY + 2.2 * S, blockZ);

    // Windows in short runs rather than full-width bands, or the block reads
    // as a barcode instead of a building.
    for (let deck = 0; deck < 4; deck++) {
      for (const xf of [-0.26, 0, 0.26]) {
        const win = add(new THREE.Mesh(
          new THREE.BoxGeometry(d.beam * 0.18, 0.30 * S, d.len * 0.118), this.mat.glass));
        win.position.set(d.beam * xf, deckY + 1.1 * S + deck * 1.0 * S, blockZ);
      }
    }

    const wheelhouse = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 1.06, 1.3 * S, d.len * 0.075), this.mat.white));
    wheelhouse.position.set(0, deckY + 5.25 * S, blockZ - d.len * 0.012);
    const wgGlass = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 1.03, 0.66 * S, d.len * 0.078), this.mat.glass));
    wgGlass.position.set(0, deckY + 5.45 * S, blockZ - d.len * 0.012);

    // Squat modern funnel behind the block.
    const funnel = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.30, 3.0 * S, d.len * 0.055), this.mat.funnelBox));
    funnel.position.set(0, deckY + 7.2 * S, blockZ + d.len * 0.035);
    const fCap = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.33, 0.5 * S, d.len * 0.06), this.mat.black));
    fCap.position.set(0, deckY + 8.85 * S, blockZ + d.len * 0.035);
    this.funnelTop = new THREE.Vector3(0, deckY + 9.3 * S, blockZ + d.len * 0.035);

    // Radar mast above the wheelhouse.
    const rmast = add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.08 * S, 0.12 * S, 3.2 * S, 6), this.mat.steelTrim));
    rmast.position.set(0, deckY + 7.5 * S, blockZ - d.len * 0.012);
    const scanner = add(new THREE.Mesh(
      new THREE.BoxGeometry(2.2 * S, 0.10 * S, 0.22 * S), this.mat.white));
    scanner.position.set(0, deckY + 9.0 * S, blockZ - d.len * 0.012);
    this.radar = scanner;

    // A geared feeder carries her own cranes; the bigger hulls do not.
    if (spec.type === "feeder" || spec.type === "handy") {
      for (const z of [-d.len * 0.20, d.len * 0.06]) {
        const ped = add(new THREE.Mesh(
          new THREE.CylinderGeometry(0.55 * S, 0.72 * S, 2.4 * S, 12), this.mat.craneYellow));
        ped.position.set(d.beam * 0.40, deckY + 1.2 * S, z);
        const jib = add(new THREE.Mesh(
          new THREE.BoxGeometry(0.34 * S, 0.34 * S, 9 * S), this.mat.craneYellow));
        jib.position.set(d.beam * 0.10, deckY + 4.6 * S, z);
        jib.rotation.set(0, Math.PI / 2, -0.36);
        const cab = add(new THREE.Mesh(
          new THREE.BoxGeometry(0.8 * S, 0.7 * S, 0.9 * S), this.mat.craneYellow));
        cab.position.set(d.beam * 0.40, deckY + 2.8 * S, z);
      }
    }

    // Deck lashing bridges between bays, and a forecastle with the windlass.
    const fc = add(new THREE.Mesh(
      new THREE.BoxGeometry(d.beam * 0.62, 0.7 * S, d.len * 0.07), this.mat.boxHull));
    fc.position.set(0, deckY + 0.35 * S, -d.len * 0.44);
    const windlass = add(new THREE.Mesh(
      new THREE.BoxGeometry(1.4 * S, 0.6 * S, 0.9 * S), this.mat.steelTrim));
    windlass.position.set(0, deckY + 1.0 * S, -d.len * 0.44);

    const rudderPivot = new THREE.Group();
    rudderPivot.position.set(0, -1.0 * S, d.len * 0.47);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.20 * S, 2.8 * S, 1.7 * S), this.mat.boxHull);
    blade.position.set(0, -0.6 * S, 0.6 * S);
    rudderPivot.add(blade);
    this.group.add(rudderPivot);
    this.rudderMesh = rudderPivot;

    this._railing(S, 0.08, 0.36, 0.05 * S, 0.05);
    this._buildEnsign(S, deckY + 5.9 * S, blockZ + d.len * 0.05, 2.6 * S);
    this._buildSmoke(S);
  }

  /** Funnel smoke. Steam is dirty and diesel is thin, so both are wanted. */
  _buildSmoke(S) {
    const COUNT = 220;
    const pos = new Float32Array(COUNT * 3);
    this._smokeState = [];
    for (let i = 0; i < COUNT; i++) {
      this._smokeState.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, size: 1 });
      pos[i * 3 + 1] = -999;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.smoke = new THREE.Points(geo, new THREE.PointsMaterial({
      color: this.era === "steam" ? 0x6b6459 : 0x9aa0a6,
      size: (this.era === "steam" ? 1.9 : 1.3) * S,
      map: puffTexture(),
      transparent: true, opacity: 0.30, depthWrite: false, sizeAttenuation: true,
    }));
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
  }

  _updateSmoke(dt, speedFrac, windFrom = 0) {
    if (!this.smoke || !this.funnelTop) return;
    const arr = this.smoke.geometry.attributes.position.array;
    const S = this.scale;
    // Under power she always makes some smoke; working hard she makes more.
    const emit = Math.floor((0.35 + speedFrac * 0.9) * 60 * dt * 60);
    let spawned = 0;
    for (let i = 0; i < this._smokeState.length; i++) {
      const p = this._smokeState[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy += 2.0 * dt;                        // hot gas rises
        p.vz += 16.0 * dt * (0.5 + speedFrac);   // and is carried astern hard
        p.vy *= 1 - 0.5 * dt;                    // then flattens out as it cools
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      } else if (spawned < emit) {
        spawned++;
        p.life = 2.4 + Math.random() * 1.8;
        p.x = this.funnelTop.x + (Math.random() - 0.5) * 0.6 * S;
        p.y = this.funnelTop.y;
        p.z = this.funnelTop.z + (Math.random() - 0.5) * 0.6 * S;
        p.vx = (Math.random() - 0.5) * 1.6 * S;
        p.vy = (4 + Math.random() * 2.5) * S * 0.45;
        p.vz = (1 + Math.random()) * S * 0.5;
      }
      const k = i * 3;
      if (p.life > 0) { arr[k] = p.x; arr[k + 1] = p.y; arr[k + 2] = p.z; }
      else arr[k + 1] = -999;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
  }

  _materials(spec) {
    const wear = clamp(spec.condition ?? 1, 0.15, 1);
    const darken = (hex, k) => new THREE.Color(hex).multiplyScalar(0.72 + 0.28 * k);
    this.mat = {
      hull:   new THREE.MeshStandardMaterial({
        map: plankTexture(), color: darken(0xb08a5e, wear),
        roughness: 0.86, metalness: 0.02, side: THREE.DoubleSide,
      }),
      wale:   new THREE.MeshStandardMaterial({ color: darken(0x6b4a28, wear), roughness: 0.92, side: THREE.DoubleSide }),
      deck:   new THREE.MeshStandardMaterial({ color: darken(0xa78355, wear), roughness: 0.86, side: THREE.DoubleSide }),
      trim:   new THREE.MeshStandardMaterial({ color: darken(0x6d4a26, wear), roughness: 0.8 }),
      gold:   new THREE.MeshStandardMaterial({ color: 0xb08d3e, roughness: 0.42, metalness: 0.55 }),
      iron:   new THREE.MeshStandardMaterial({ color: 0x35383c, roughness: 0.62, metalness: 0.6 }),
      rope:   new THREE.LineBasicMaterial({ color: 0x2b241a, transparent: true, opacity: 0.78 }),
      ratline: new THREE.LineBasicMaterial({ color: 0x4a3d2a, transparent: true, opacity: 0.5 }),
      // Canvas is thin and lit from both sides: a real sail glows a little where
      // the sun is behind it. A plain opaque standard material reads as card.
      sail:   new THREE.MeshStandardMaterial({
        map: sailTexture(true), side: THREE.DoubleSide, roughness: 0.92, metalness: 0,
        emissive: 0x6b5f45, emissiveIntensity: 0.30,
      }),
      sailPlain: new THREE.MeshStandardMaterial({
        map: sailTexture(false), side: THREE.DoubleSide, roughness: 0.92, metalness: 0,
        emissive: 0x6b5f45, emissiveIntensity: 0.30,
      }),

      /* ---- steel eras ---- */
      ironHull:   new THREE.MeshStandardMaterial({
        map: plateTexture(0x63656c, true), color: 0xe4e4e8,
        roughness: 0.66, metalness: 0.30, side: THREE.DoubleSide }),
      boxHull:    new THREE.MeshStandardMaterial({
        map: plateTexture(0x3f74a8, false), color: 0xe8e8ee,
        roughness: 0.52, metalness: 0.24, side: THREE.DoubleSide }),
      steelDeck:  new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.88, side: THREE.DoubleSide }),
      steelTrim:  new THREE.MeshStandardMaterial({ color: 0x6e7379, roughness: 0.62, metalness: 0.42 }),
      white:      new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.68 }),
      black:      new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.72 }),
      glass:      new THREE.MeshStandardMaterial({
        color: 0x243a44, roughness: 0.12, metalness: 0.75, emissive: 0x0d1a20, emissiveIntensity: 0.5 }),
      funnel:     new THREE.MeshStandardMaterial({ color: 0xa8442f, roughness: 0.70 }),
      funnelBox:  new THREE.MeshStandardMaterial({ color: 0xc8442f, roughness: 0.62 }),
      cowl:       new THREE.MeshStandardMaterial({ color: 0xb03428, roughness: 0.72, side: THREE.DoubleSide }),
      tarp:       new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.95 }),
      hatch:      new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.84 }),
      mastBuff:   new THREE.MeshStandardMaterial({ color: 0xc9a468, roughness: 0.78 }),
      craneYellow:new THREE.MeshStandardMaterial({ color: 0xd8a12a, roughness: 0.66 }),
      rail:       new THREE.LineBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.75 }),
      container:  new THREE.MeshStandardMaterial({
        map: containerTexture(), roughness: 0.74, metalness: 0.10 }),
    };
  }

  /** Ensign on a staff, built as one group so the flag cannot fly off alone. */
  _buildEnsign(S, y, z, staffH) {
    const ensign = new THREE.Group();
    const staff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06 * S, 0.09 * S, staffH, 6), this.mat.trim || this.mat.steelTrim);
    staff.position.y = staffH / 2;
    ensign.add(staff);

    const fc = document.createElement("canvas");
    fc.width = 64; fc.height = 40;
    const fg = fc.getContext("2d");
    fg.fillStyle = "#0d5c3a"; fg.fillRect(0, 0, 26, 40);
    fg.fillStyle = "#c8302a"; fg.fillRect(26, 0, 38, 40);
    fg.fillStyle = "#e8c860"; fg.beginPath(); fg.arc(26, 20, 7, 0, Math.PI * 2); fg.fill();
    const ftex = new THREE.CanvasTexture(fc);
    ftex.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0 * S, 1.25 * S, 10, 4),
      new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.geometry.translate(1.0 * S, 0, 0);
    flag.position.set(0, staffH - 0.9 * S, 0);
    ensign.add(flag);
    this.flag = flag;
    this.flagGeo = flag.geometry;
    this.flagSpan = 2.0 * S;

    ensign.position.set(0, y, z);
    this.group.add(ensign);
  }

  _buildHull(S) {
    // rise is freeboard at the waist. The waterline sits at y=0, so this is
    // literally how much ship there is between the sea and the deck.
    const dims = { len: this.len, beam: this.beam, draft: 2.4 * S, rise: 3.6 * S };
    this.dims = dims;

    const hull = new THREE.Mesh(buildHull(dims), this.mat.hull);
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.group.add(hull);
    this.hullMesh = hull;

    const deck = new THREE.Mesh(buildDeck({ len: this.len, beam: this.beam, y: 2.35 * S }), this.mat.deck);
    deck.receiveShadow = true;
    this.group.add(deck);

    // Wales, swept along constant-v lines of the hull skin so they follow the
    // sheer and the tumblehome exactly.
    for (const [v, th, proud] of [[0.62, 0.20, 0.10], [0.82, 0.16, 0.09], [0.97, 0.13, 0.06]]) {
      const strake = new THREE.Mesh(buildWale(dims, v, th * S, proud * S), this.mat.wale);
      strake.castShadow = true;
      this.group.add(strake);
    }

    // Frame heads standing proud of the rail, the way a period hull shows its
    // ribs above the sheer strake.
    for (let i = 4; i < 30; i += 3) {
      const u = i / 32;
      const p = hullPoint(u, 1, dims);
      for (const side of [1, -1]) {
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(0.13 * S, 0.26 * S, 0.22 * S), this.mat.trim
        );
        head.position.set(side * p.x, p.y + 0.10 * S, p.z);
        this.group.add(head);
      }
    }

    // Stem post and bowsprit
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.4 * S, 4.2 * S, 0.9 * S), this.mat.trim);
    stem.position.set(0, 2.8 * S, -this.len * 0.49);
    stem.rotation.x = -0.28;
    this.group.add(stem);

    const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * S, 0.26 * S, 9 * S, 7), this.mat.trim);
    bowsprit.rotation.x = Math.PI / 2 - 0.34;
    bowsprit.position.set(0, 4.1 * S, -this.len * 0.60);
    this.group.add(bowsprit);
    this.bowsprit = bowsprit;
  }

  _buildCastles(S, spec) {
    // Sterncastle: the raised aft structure with the great cabin under it.
    const castleH = (spec.type === "galleon" || spec.type === "carrack") ? 3.4 : 2.2;
    // Tapered: narrower at the top and drawn in aft, which is what a stern
    // actually does. A straight box reads as a shed on a boat.
    const castleGeo = new THREE.CylinderGeometry(1, 1, castleH * S, 4, 1);
    castleGeo.rotateY(Math.PI / 4);
    castleGeo.scale(this.beam * 0.38, 1, this.len * 0.13);
    const cp = castleGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      if (cp.getY(i) > 0) { cp.setX(i, cp.getX(i) * 0.84); cp.setZ(i, cp.getZ(i) * 0.90); }
    }
    castleGeo.computeVertexNormals();
    const castle = new THREE.Mesh(castleGeo, this.mat.trim);
    castle.position.set(0, (2.35 + castleH / 2) * S, this.len * 0.31);
    castle.castShadow = true;
    this.group.add(castle);
    this.castleTop = (2.35 + castleH) * S;

    // Taffrail round the poop.
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(this.beam * 0.30, 0.11 * S, 5, 4),
      this.mat.wale
    );
    rail.rotation.x = Math.PI / 2;
    rail.rotation.z = Math.PI / 4;
    rail.scale.set(1, this.len * 0.115 / (this.beam * 0.30), 1);
    rail.position.set(0, (2.35 + castleH) * S + 0.5 * S, this.len * 0.31);
    this.group.add(rail);

    const poop = new THREE.Mesh(
      new THREE.BoxGeometry(this.beam * 0.6, 0.34 * S, this.len * 0.2),
      this.mat.deck
    );
    poop.position.set(0, (2.35 + castleH) * S + 0.17 * S, this.len * 0.31);
    this.group.add(poop);

    // Stern gallery windows, picked out in gilt.
    for (let i = -1; i <= 1; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9 * S, 1.1 * S, 0.12 * S), this.mat.gold);
      win.position.set(i * 1.3 * S, (2.35 + castleH * 0.5) * S, this.len * 0.425);
      this.group.add(win);
    }

    if (spec.type === "carrack" || spec.type === "galleon") {
      const fore = new THREE.Mesh(
        new THREE.BoxGeometry(this.beam * 0.6, 2.6 * S, this.len * 0.15),
        this.mat.trim
      );
      fore.position.set(0, (2.35 + 1.2) * S, -this.len * 0.33);
      fore.castShadow = true;
      this.group.add(fore);
    }

    // Guns, if she carries them.
    if (spec.armed) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * S, 0.18 * S, 1.5 * S, 6), this.mat.iron);
          gun.rotation.z = Math.PI / 2;
          gun.position.set(side * this.beam * 0.44, 2.1 * S, (-0.18 + i * 0.13) * this.len);
          this.group.add(gun);
        }
      }
    }
  }

  _buildRig(S, spec) {
    const masts = spec.masts || 2;
    const lateen = spec.rig === "Lateen";
    // Mast stations along the keel, fore to aft.
    const layout = {
      2: [-0.18, 0.20],
      3: [-0.30, -0.02, 0.26],
      4: [-0.34, -0.10, 0.12, 0.32],
    }[clamp(masts, 2, 4)] || [-0.18, 0.20];

    this.masts = [];

    layout.forEach((zFrac, i) => {
      const isMizzen = i === layout.length - 1 && layout.length > 1;
      const height = (isMizzen ? 15 : 21) * S * (i === 0 && layout.length > 2 ? 0.92 : 1);
      const z = zFrac * this.len;

      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16 * S, 0.30 * S, height, 8), this.mat.trim
      );
      mast.position.set(0, 2.35 * S + height / 2, z);
      mast.castShadow = true;
      this.group.add(mast);

      const top = 2.35 * S + height;
      this.masts.push({ mesh: mast, z, height, top });

      // Shrouds, and the ratlines rung across them. Shrouds alone read as a few
      // stray threads; it is the horizontal rungs that make rigging look rigged.
      const SHROUDS = 5;
      for (const side of [-1, 1]) {
        const feet = [], heads = [];
        for (let k = 0; k < SHROUDS; k++) {
          const spread = (0.30 + k * 0.085) * this.beam;
          const foot = new THREE.Vector3(side * spread, 2.3 * S, z + (k - (SHROUDS - 1) / 2) * 0.55 * S);
          const head = new THREE.Vector3(side * 0.26 * S, top - 1.6 * S, z);
          feet.push(foot); heads.push(head);
          this.group.add(line(foot, head, this.mat.rope));

          // A deadeye where each shroud is set up to the channel.
          const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * S, 0.17 * S, 0.11 * S, 7), this.mat.trim);
          eye.rotation.x = Math.PI / 2;
          eye.position.copy(foot).setY(foot.y + 0.35 * S);
          this.group.add(eye);
        }
        // A channel: the shelf the shrouds are spread on, outboard of the rail.
        const chan = new THREE.Mesh(
          new THREE.BoxGeometry(0.5 * S, 0.16 * S, SHROUDS * 0.62 * S), this.mat.wale
        );
        chan.position.set(side * 0.40 * this.beam, 2.25 * S, z);
        this.group.add(chan);

        // Ratlines every 0.42 units up the shrouds, narrowing as they climb.
        const RUNGS = Math.floor(height / (0.9 * S));
        for (let r = 1; r < RUNGS; r++) {
          const t = r / RUNGS;
          const a = feet[0].clone().lerp(heads[0], t);
          const b = feet[SHROUDS - 1].clone().lerp(heads[SHROUDS - 1], t);
          this.group.add(line(a, b, this.mat.ratline));
        }
      }
      // Forestay and backstay
      if (i === 0) {
        this.group.add(line(
          new THREE.Vector3(0, top - 1.2 * S, z),
          new THREE.Vector3(0, 5.4 * S, -this.len * 0.66), this.mat.rope));
      }
      this.group.add(line(
        new THREE.Vector3(0, top - 1.2 * S, z),
        new THREE.Vector3(0, 3.0 * S, this.len * 0.47), this.mat.rope));

      // Canvas
      if (lateen && isMizzen) {
        const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * S, 0.09 * S, height * 0.95, 6), this.mat.trim);
        yard.rotation.z = 0.72;
        yard.position.set(0, top - height * 0.42, z);
        this.group.add(yard);

        const sail = new THREE.Mesh(lateenSail(height * 0.72, this.beam * 0.95), this.mat.sailPlain);
        sail.position.set(0, top - height * 0.44, z + 0.4 * S);
        sail.castShadow = true;
        this.group.add(sail);
        this.sails.push({ mesh: sail, base: sail.scale.clone(), kind: "lateen" });
      } else {
        // Course, and a topsail above it on the taller masts.
        const tiers = height > 17 * S ? 2 : 1;
        for (let t = 0; t < tiers; t++) {
          const yFrac = t === 0 ? 0.46 : 0.76;
          const w = this.beam * (t === 0 ? 1.55 : 1.12);
          const h = height * (t === 0 ? 0.34 : 0.24);
          const yy = 2.35 * S + height * yFrac;

          const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.10 * S, 0.10 * S, w * 1.12, 6), this.mat.trim);
          yard.rotation.z = Math.PI / 2;
          yard.position.set(0, yy + h * 0.5, z);
          this.group.add(yard);

          const mat = (i === 0 && t === 0) ? this.mat.sail : this.mat.sailPlain;
          const sail = new THREE.Mesh(squareSail(w, h), mat);
          sail.position.set(0, yy, z + 0.25 * S);
          sail.castShadow = true;
          this.group.add(sail);
          this.sails.push({ mesh: sail, anchorY: yy + h * 0.5, height: h, kind: "square" });
        }
      }

      // Crow's nest on the fore mast
      if (i === 0 && height > 16 * S) {
        const nest = new THREE.Mesh(
          new THREE.CylinderGeometry(1.1 * S, 0.8 * S, 0.8 * S, 10, 1, true), this.mat.trim
        );
        nest.position.set(0, top - 3.2 * S, z);
        this.group.add(nest);
      }
    });
  }

  _buildDetails(S, spec) {
    const castleTop = this.castleTop || 4 * S;
    // Rudder and tiller
    // Hung on the sternpost and pivoting about it, so the blade swings rather
    // than sliding sideways when the helm goes over.
    const rudderPivot = new THREE.Group();
    rudderPivot.position.set(0, -0.6 * S, this.len * 0.47);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22 * S, 3.0 * S, 1.4 * S), this.mat.wale);
    blade.position.set(0, -0.5 * S, 0.7 * S);
    rudderPivot.add(blade);
    this.group.add(rudderPivot);
    this.rudderMesh = rudderPivot;

    this._buildEnsign(S, 1.9 * S + castleTop, this.len * 0.40, 5.5 * S);

    // Ship's boat lashed amidships
    const boat = new THREE.Mesh(
      new THREE.SphereGeometry(1.5 * S, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      this.mat.deck
    );
    boat.rotation.x = Math.PI;
    boat.scale.set(0.6, 0.5, 1.5);
    boat.position.set(0, 2.85 * S, this.len * 0.06);
    this.group.add(boat);
  }

  _buildSpray(S) {
    const COUNT = 160;
    const pos = new Float32Array(COUNT * 3);
    this._sprayState = [];
    for (let i = 0; i < COUNT; i++) {
      this._sprayState.push({ life: 0, vx: 0, vy: 0, vz: 0, x: 0, y: -999, z: 0 });
      pos[i * 3 + 1] = -999;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.spray = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.75 * S, transparent: true, opacity: 0.68,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.spray.frustumCulled = false;
    this.group.add(this.spray);
  }

  /* ------------------------------------------------------------ update ---- */

  /**
   * @param dt        seconds
   * @param speedFrac 0..1 of best speed, drives spray and sail belly
   * @param trim      0..1 canvas set
   * @param rudder    -1..1
   * @param night     0..1 how dark it is
   */
  update(dt, { speedFrac = 0, trim = 1, rudder = 0, night = 0, t = 0 } = {}) {
    if (this.radar) this.radar.rotation.y += dt * 1.9;   // the scanner sweeps
    // Canvas: reef the sails down as trim falls off. Powered ships have none.
    const want = 0.16 + 0.84 * clamp(trim, 0, 1);
    this.sailSet += (want - this.sailSet) * clamp(dt * 2.2, 0, 1);
    for (const s of this.sails) {
      if (s.kind === "square") {
        s.mesh.scale.y = this.sailSet;
        // Keep the head of the sail on the yard as it reefs.
        s.mesh.position.y = s.anchorY - (s.height * this.sailSet) / 2;
      } else {
        s.mesh.scale.set(1, this.sailSet, 1);
      }
      // Breathe with the wind.
      s.mesh.scale.z = 1 + Math.sin(t * 1.7 + s.mesh.position.z) * 0.06 * this.sailSet;
    }

    if (this.rudderMesh) this.rudderMesh.rotation.y = -rudder * 0.5;
    if (this.flag) {
      // Ripple along the fly: the hoist stays put, the free edge moves most.
      const p = this.flagGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const along = p.getX(i) / (this.flagSpan || 2.0 * this.scale);   // 0 at the hoist, 1 at the fly
        p.setZ(i, Math.sin(t * 5.5 - along * 4.2) * along * 0.34 * this.scale);
      }
      p.needsUpdate = true;
      this.flag.rotation.y = Math.sin(t * 1.6) * 0.10;
    }

    const lit = clamp((night - 0.35) / 0.35, 0, 1);
    if (this.lantern) this.lantern.material.emissiveIntensity = lit * 2.4;
    if (this.lanternLight) this.lanternLight.intensity = lit * 3.2;

    this._updateSpray(dt, speedFrac);
    this._updateSmoke(dt, speedFrac);
  }

  _updateSpray(dt, speedFrac) {
    const arr = this.spray.geometry.attributes.position.array;
    const S = this.scale;
    const bowZ = -this.len * 0.46;
    // Emission scales with the cube of speed: a slow ship barely throws water.
    const emit = Math.floor(Math.pow(clamp(speedFrac, 0, 1), 2.2) * 34 * dt * 60);

    let spawned = 0;
    for (let i = 0; i < this._sprayState.length; i++) {
      const p = this._sprayState[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 26 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0) p.life = 0;
      } else if (spawned < emit) {
        spawned++;
        const side = Math.random() < 0.5 ? -1 : 1;
        p.life = 0.5 + Math.random() * 0.5;
        p.x = side * (0.5 + Math.random() * 1.2) * S;
        p.y = 0.7 * S;
        p.z = bowZ + Math.random() * 2.5 * S;
        p.vx = side * (3 + Math.random() * 5) * S;
        p.vy = (5 + Math.random() * 7) * S;
        p.vz = -(3 + Math.random() * 5) * S;
      }
      const k = i * 3;
      if (p.life > 0) { arr[k] = p.x; arr[k + 1] = p.y; arr[k + 2] = p.z; }
      else { arr[k + 1] = -999; }
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.spray.material.opacity = 0.30 + 0.42 * clamp(speedFrac, 0, 1);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}

function line(from, to, mat) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), mat);
}

/* ---------------------------------------------------------------- wake ---- */

/** A ribbon of foam trailing astern, widening and fading as it goes. */
export class Wake {
  constructor(length = 90) {
    this.points = [];
    this.maxPoints = length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(length * 2 * 3), 3));
    geo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(length * 2), 1));
    const idx = [];
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    this.geometry = geo;

    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xdfeef2) } },
      vertexShader: `
        attribute float alpha;
        varying float vA;
        void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColor; varying float vA;
        void main(){ gl_FragColor = vec4(uColor, vA); }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Called each frame with the ship's world position and heading. */
  push(x, y, z, headingRad, speedFrac) {
    const last = this.points[this.points.length - 1];
    // Wide spacing matters: the quads are up to 9 units across, so packing
    // points closer stacks translucent layers until the wake reads as solid paint.
    if (last && Math.hypot(last.x - x, last.z - z) < 7.5) return;
    this.points.push({ x, y, z, h: headingRad, s: speedFrac });
    if (this.points.length > this.maxPoints) this.points.shift();
    this._rebuild();
  }

  _rebuild() {
    const pos = this.geometry.attributes.position.array;
    const alpha = this.geometry.attributes.alpha.array;
    const n = this.points.length;
    for (let i = 0; i < this.maxPoints; i++) {
      const p = this.points[i];
      const k = i * 6, ka = i * 2;
      if (!p || i >= n) {
        pos[k + 1] = pos[k + 4] = -999;
        alpha[ka] = alpha[ka + 1] = 0;
        continue;
      }
      const age = i / Math.max(1, n - 1);        // 0 oldest, 1 newest
      // Narrow at the transom, spreading astern: a wake, not a delta.
      const width = 2.2 + (1 - age) * 7.0;
      const nx = Math.cos(p.h), nz = -Math.sin(p.h);   // normal to the heading
      pos[k]     = p.x + nx * width; pos[k + 1] = p.y + 0.16; pos[k + 2] = p.z + nz * width;
      pos[k + 3] = p.x - nx * width; pos[k + 4] = p.y + 0.16; pos[k + 5] = p.z - nz * width;
      const a = age * age * 0.14 * clamp(p.s, 0, 1);
      alpha[ka] = alpha[ka + 1] = a;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
  }

  clear() {
    this.points = [];
    this._rebuild();
  }
}

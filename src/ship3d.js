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

// The three curves that define the hull. Hoisted to module scope because the
// wales, the deck and the rail all have to follow exactly the same shape — the
// moment they are approximated separately you get gaps and floating trim.
const beamProfile = (u) =>
  Math.pow(Math.sin(Math.PI * clamp(u * 1.14, 0, 1)), 0.62) *
  (1 - Math.pow(clamp((u - 0.72) / 0.28, 0, 1), 1.8) * 0.42);

const draftProfile = (u) =>
  Math.pow(Math.sin(Math.PI * clamp(u * 1.06, 0, 1)), 0.5) *
  (1 - Math.pow(clamp((u - 0.85) / 0.15, 0, 1), 2) * 0.55);

const sheerProfile = (u) => 0.62 + 0.72 * Math.pow(Math.abs(u - 0.46) * 2.05, 1.7);

/** A point on the hull skin. u runs bow to stern, v runs keel to gunwale. */
export function hullPoint(u, v, d) {
  const b = (d.beam * 0.5) * beamProfile(u);
  const dr = d.draft * draftProfile(u);
  const sh = d.rise * sheerProfile(u);
  return {
    x: b * Math.pow(v, 0.72),
    y: -dr + (dr + sh) * Math.pow(v, 1.35),
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
function buildDeck({ len, beam, y }) {
  const shape = new THREE.Shape();
  const N = 24;
  const w = (u) => (beam * 0.5) * beamProfile(u) * 0.90;
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
  /** `spec` from the fleet: { type, masts, rig, armed, condition } */
  constructor(spec = {}) {
    const SCALE = { caravel: 1.0, carrack: 1.28, fluyt: 1.36, galleon: 1.58 };
    const S = SCALE[spec.type] || 1;
    this.spec = spec;
    this.scale = S;
    this.len = 26 * S;
    this.beam = 7.4 * S;
    this.group = new THREE.Group();

    this.sailSet = 1;
    this.heel = 0;
    this.sails = [];
    this.spray = null;

    this._materials(spec);
    this._buildHull(S);
    this._buildCastles(S, spec);
    this._buildRig(S, spec);
    this._buildDetails(S, spec);
    this._buildSpray(S);
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
    };
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

    // Ensign at the stern, built as one group so the flag cannot part company
    // with its own staff — which it had, and was flying along beside the ship.
    const ensign = new THREE.Group();
    const staffH = 5.5 * S;
    const staff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07 * S, 0.10 * S, staffH, 6), this.mat.trim);
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
      new THREE.PlaneGeometry(2.4 * S, 1.5 * S, 10, 4),
      new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, roughness: 0.9 }));
    // Anchored by its hoist to the staff, so it streams from the mast.
    flag.geometry.translate(1.2 * S, 0, 0);
    flag.position.set(0, staffH - 1.1 * S, 0);
    ensign.add(flag);
    this.flag = flag;
    this.flagGeo = flag.geometry;

    ensign.position.set(0, 1.9 * S + castleTop, this.len * 0.40);
    ensign.rotation.x = -0.16;
    this.group.add(ensign);

    // Stern lantern, sitting on the taffrail rather than hovering astern.
    const lantern = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30 * S, 0.38 * S, 0.85 * S, 8),
      new THREE.MeshStandardMaterial({ color: 0xffcf7a, emissive: 0xffa542, emissiveIntensity: 0 })
    );
    lantern.position.set(0, 1.55 * S + castleTop, this.len * 0.395);
    this.group.add(lantern);
    this.lantern = lantern;
    this.lanternLight = new THREE.PointLight(0xffb055, 0, 60 * S, 2);
    this.lanternLight.position.copy(lantern.position);
    this.group.add(this.lanternLight);

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
    // Canvas: reef the sails down as trim falls off.
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
        const along = (p.getX(i) / (2.4 * this.scale));   // 0 at the hoist, 1 at the fly
        p.setZ(i, Math.sin(t * 5.5 - along * 4.2) * along * 0.34 * this.scale);
      }
      p.needsUpdate = true;
      this.flag.rotation.y = Math.sin(t * 1.6) * 0.10;
    }

    const lit = clamp((night - 0.35) / 0.35, 0, 1);
    if (this.lantern) this.lantern.material.emissiveIntensity = lit * 2.4;
    if (this.lanternLight) this.lanternLight.intensity = lit * 3.2;

    this._updateSpray(dt, speedFrac);
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

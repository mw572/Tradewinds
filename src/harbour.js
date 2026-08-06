// harbour.js — the landfall you are steering for.
//
// Each port builds from its own `berth` spec in world.js, so Lisbon arrives as
// a stacked river city and São Tomé as two huts and a jetty. Everything is
// generated from a seeded PRNG keyed on the port id, which means a given
// harbour looks the same every time you make it without any of it being
// authored by hand.

import * as THREE from "three";
import { buildHull } from "./ship3d.js";

const rngFrom = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), h | 1); h ^= h + Math.imul(h ^ (h >>> 7), h | 61); return ((h ^ (h >>> 14)) >>> 0) / 4294967296; };
};

const PALETTES = {
  city:     { wall: [0xd8c9a8, 0xc9b894, 0xe0d3b6], roof: 0x8c4a32, land: 0x5d6b45, stone: 0x8b8272 },
  river:    { wall: [0xcfc0a2, 0xbcae90, 0xd6cbb0], roof: 0x7d4530, land: 0x536b3e, stone: 0x847b6c },
  fortress: { wall: [0xc4b598, 0xb4a68a, 0xcdc0a4], roof: 0x6f4632, land: 0x6b6b46, stone: 0x9a9081 },
  island:   { wall: [0xe4d8bd, 0xd6c8aa, 0xefe4cc], roof: 0x9c5638, land: 0x4e6b3c, stone: 0x93897a },
  kasbah:   { wall: [0xe6d5b0, 0xd8c69f, 0xf0e2c2], roof: 0xb08050, land: 0x7a7250, stone: 0xa2977f },
  reef:     { wall: [0xdfd2b4, 0xcdbe9c, 0xe8dcc2], roof: 0x8e5138, land: 0x4a6b46, stone: 0x8d8474 },
};

export class Harbour {
  /**
   * @param port      the port record from world.js
   * @param berthPos  THREE.Vector3 where the ship must come alongside
   * @param headingDeg the berth's orientation, so the pier runs alongside it
   * @param berthRadius the green ring the ship must be inside
   */
  constructor(port, berthPos, headingDeg, berthRadius) {
    const spec = port.berth || { scale: 1, style: "city", lighthouse: false, moored: 2 };
    const pal = PALETTES[spec.style] || PALETTES.city;
    const rnd = rngFrom(port.id);
    const S = spec.scale;

    this.group = new THREE.Group();
    this.lights = [];

    const hRad = (headingDeg * Math.PI) / 180;
    const fwd = new THREE.Vector3(Math.sin(hRad), 0, -Math.cos(hRad));   // along the berth
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);                    // to seaward-left

    const mat = {
      land:  new THREE.MeshStandardMaterial({ color: pal.land, roughness: 1 }),
      stone: new THREE.MeshStandardMaterial({ color: pal.stone, roughness: 0.95 }),
      roof:  new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.9 }),
      wood:  new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.92 }),
      walls: pal.wall.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.94 })),
    };
    this.mat = mat;

    const at = (alongBerth, offshore, y = 0) =>
      new THREE.Vector3().copy(berthPos)
        .addScaledVector(fwd, alongBerth)
        .addScaledVector(side, offshore)
        .setY(y);

    /* ------------------------------- the land -------------------------------
     * A heightmap, not stacked boxes. Ground height is a ramp from the
     * waterline plus two octaves of value noise, so the coast has bays and
     * headlands instead of a straight edge, and the ground behind the town
     * rises into hills. Colour is per-vertex by height and slope: wet sand,
     * dry sand, grass, scrub, then bare rock on anything steep.
     *
     * The harbour basin is carved by pulling the height down inside a radius
     * of the berth, which is what stops the town growing over the water you
     * are trying to steer into. */
    const TERRAIN_SIZE = 1500 * S;
    const TERRAIN_SEG = 132;
    const SHORE_AT = 46 * S;          // offshore distance where the ground meets the sea

    const n2 = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const h = (a, b) => {
        let v = Math.imul(a * 374761393 + b * 668265263, 1274126177);
        v = (v ^ (v >>> 13)) >>> 0;
        return v / 4294967296;
      };
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) +
             (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
    };
    const fbm = (x, y) =>
      n2(x, y) * 0.55 + n2(x * 2.1 + 5.3, y * 2.1 + 1.7) * 0.28 +
      n2(x * 4.3 + 9.1, y * 4.3 + 3.3) * 0.17;

    // Height above sea level at a point given in (alongBerth, offshore) units.
    const groundAt = (along, off) => {
      const a = along / S, o = off / S;
      // Coastline wobble: the shore is not a ruled line.
      const wobble = (fbm(a * 0.006 + 3.1, 17.0) - 0.5) * 84;
      const d = o - (SHORE_AT / S) - wobble;         // metres inland of the shore
      if (d < -60) return -9 * S;                    // well out to sea
      // Ramp inland, then hills, with a bay scooped out around the berth.
      const ramp = Math.min(1, Math.max(0, d / 105));
      const hill = fbm(a * 0.0045 + 11, o * 0.0045 + 7) * 44 + fbm(a * 0.013, o * 0.013) * 13;
      let h = -7 + ramp * (15 + hill * ramp);
      // Carve the basin: pull everything down near the berth so there is water
      // to manoeuvre in, and a shelving bottom rather than a cliff.
      const distBerth = Math.hypot(a, o);
      h -= Math.max(0, 1 - distBerth / 190) * 62;
      return h * S;
    };
    this.groundAt = groundAt;

    const tGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    tGeo.rotateX(-Math.PI / 2);
    const tp = tGeo.attributes.position;
    const colors = new Float32Array(tp.count * 3);
    const CG = {
      wet:   new THREE.Color(0xa89468),
      sand:  new THREE.Color(0xd6c493),
      grass: new THREE.Color(pal.land),
      dry:   new THREE.Color(pal.land).lerp(new THREE.Color(0xb9b06a), 0.45),
      rock:  new THREE.Color(pal.stone).multiplyScalar(0.92),
    };
    const tmpC = new THREE.Color();

    // The plane's local +x runs along the berth and +z runs offshore; the mesh
    // is rotated into place afterwards, so the height function reads directly.
    for (let i = 0; i < tp.count; i++) {
      const lx = tp.getX(i), lz = tp.getZ(i);
      const off = lz + TERRAIN_SIZE / 2;
      const h = groundAt(lx, off);
      tp.setY(i, h);
    }
    tGeo.computeVertexNormals();

    const tn = tGeo.attributes.normal;
    for (let i = 0; i < tp.count; i++) {
      const h = tp.getY(i) / S;
      const slope = 1 - Math.abs(tn.getY(i));
      if (h < -1.0) tmpC.copy(CG.wet);
      else if (h < 1.6) tmpC.copy(CG.wet).lerp(CG.sand, (h + 1.0) / 2.6);
      else if (h < 5.5) tmpC.copy(CG.sand).lerp(CG.grass, (h - 1.6) / 3.9);
      else if (h < 40) tmpC.copy(CG.grass);
      else if (h < 68) tmpC.copy(CG.grass).lerp(CG.dry, (h - 40) / 28);
      else tmpC.copy(CG.dry).lerp(CG.rock, Math.min(1, (h - 68) / 45));
      if (slope > 0.42) tmpC.lerp(CG.rock, Math.min(1, (slope - 0.42) * 2.2));
      // Break up the flat fill so a hillside is not one colour.
      const j = 0.94 + fbm(tp.getX(i) * 0.05, tp.getZ(i) * 0.05) * 0.14;
      colors[i * 3] = tmpC.r * j;
      colors[i * 3 + 1] = tmpC.g * j;
      colors[i * 3 + 2] = tmpC.b * j;
    }
    tGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.97, metalness: 0, flatShading: false,
    }));
    terrain.position.copy(at(0, TERRAIN_SIZE / 2, 0));
    terrain.rotation.y = hRad;
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    this.group.add(terrain);

    /* ------------------------------ the pier ------------------------------ */
    const pier = new THREE.Mesh(new THREE.BoxGeometry(11 * S, 7 * S, 88 * S), mat.stone);
    pier.position.copy(at(0, 10 * S, 1.4 * S));
    pier.rotation.y = hRad;
    pier.castShadow = true; pier.receiveShadow = true;
    this.group.add(pier);

    // Steps down to the water
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3.4 * S, 0.6 * S, 9 * S), mat.stone);
      step.position.copy(at(-6 * S, (5.4 - i * 0.7) * S, (3.4 - i * 0.85) * S));
      step.rotation.y = hRad;
      this.group.add(step);
    }

    // Bollards
    for (const a of [-26, -9, 9, 26]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.8 * S, 1.05 * S, 5.4 * S, 8), mat.stone);
      post.position.copy(at(a * S, 5.2 * S, 3.4 * S));
      post.castShadow = true;
      this.group.add(post);
    }

    // A crane on the quay
    const craneBase = new THREE.Mesh(new THREE.CylinderGeometry(1.5 * S, 2.0 * S, 9 * S, 8), mat.wood);
    craneBase.position.copy(at(30 * S, 12 * S, 5 * S));
    this.group.add(craneBase);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(1.0 * S, 1.0 * S, 16 * S), mat.wood);
    jib.position.copy(at(30 * S, 12 * S, 11 * S));
    jib.rotation.set(0.5, hRad, 0);
    this.group.add(jib);

    /* ---------------------------- the town ---------------------------- */
    const count = { city: 78, river: 62, fortress: 46, island: 30, kasbah: 54, reef: 40 }[spec.style] || 46;
    for (let i = 0; i < count; i++) {
      const w = (9 + rnd() * 13) * S;
      const d = (9 + rnd() * 12) * S;
      const storeys = 1 + Math.floor(rnd() * (spec.style === "city" ? 4 : 2));
      const h = (7 + storeys * 4.5) * S;

      const along = (rnd() - 0.5) * 300 * S;
      const off = (78 + rnd() * 260) * S;
      const ground = groundAt(along, off);
      if (ground < 1.5 * S) continue;      // do not build below the tide line

      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat.walls[Math.floor(rnd() * mat.walls.length)]);
      // Sunk by a fifth of their height: on a slope a box placed exactly on the
      // sampled height leaves daylight under its downhill corner.
      b.position.copy(at(along, off, ground + h / 2 - h * 0.20));
      b.rotation.y = hRad + (rnd() - 0.5) * 0.55;
      b.castShadow = true; b.receiveShadow = true;
      this.group.add(b);

      // Gable roof: a prism, not a pyramid. Real terraces have ridges running
      // one way, and a street of four-sided pyramids reads as a tent village.
      const gable = rnd() < 0.72;
      let r;
      if (gable) {
        const ridge = new THREE.CylinderGeometry(Math.max(w, d) * 0.62, Math.max(w, d) * 0.62, Math.max(w, d) * 1.02, 3);
        ridge.rotateZ(Math.PI / 2);
        r = new THREE.Mesh(ridge, mat.roof);
        r.scale.set(1, 1, 0.62);
        r.rotation.y = b.rotation.y + (w > d ? 0 : Math.PI / 2);
      } else {
        r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.74, 3.4 * S, 4), mat.roof);
        r.rotation.y = b.rotation.y + Math.PI / 4;
      }
      r.position.copy(b.position).setY(b.position.y + h / 2 + 1.4 * S);
      r.castShadow = true;
      this.group.add(r);

      // A chimney or two, which is most of what makes a roofline read as lived in.
      if (rnd() < 0.6) {
        const ch = new THREE.Mesh(
          new THREE.BoxGeometry(0.9 * S, 2.4 * S, 0.9 * S), mat.walls[0]);
        ch.position.copy(b.position)
          .setY(b.position.y + h / 2 + 2.2 * S)
          .add(new THREE.Vector3((rnd() - 0.5) * w * 0.5, 0, (rnd() - 0.5) * d * 0.5));
        this.group.add(ch);
      }

      // A lit window or two after dark
      if (rnd() < 0.5) {
        const win = new THREE.PointLight(0xffb861, 0, 46 * S, 2);
        win.position.copy(b.position).setY(b.position.y + h * 0.2);
        this.group.add(win);
        this.lights.push({ light: win, peak: 0.9 + rnd() * 0.8 });
      }
    }

    /* ------------------------------- planting -------------------------------
     * Bare terrain reads as a golf course. Trees give the hillside scale and
     * break up the vertex colouring, and they cost one instanced draw call. */
    {
      const TREES = { island: 90, reef: 110, kasbah: 40 }[spec.style] ?? 190;
      const trunkGeo = new THREE.CylinderGeometry(0.34 * S, 0.5 * S, 3.2 * S, 5);
      const crownGeo = new THREE.IcosahedronGeometry(2.6 * S, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 });
      const crownMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(pal.land).multiplyScalar(0.82), roughness: 0.95, flatShading: true });
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, TREES);
      crowns.castShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const sc = new THREE.Vector3(), pos = new THREE.Vector3();
      const cCol = new THREE.Color();
      let placed = 0;
      for (let i = 0; i < TREES * 4 && placed < TREES; i++) {
        const along = (rnd() - 0.5) * 620 * S;
        const off = (70 + rnd() * 380) * S;
        const g = groundAt(along, off);
        if (g < 4 * S) continue;                    // not on the beach
        const near = Math.hypot(along / S, off / S);
        if (near < 90) continue;                    // not on the quay
        const h = 0.7 + rnd() * 0.7;
        pos.copy(at(along, off, g + 1.4 * S * h));
        sc.set(h, h, h);
        m.compose(pos, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), sc);
        trunks.setMatrixAt(placed, m);
        pos.setY(g + 4.2 * S * h);
        m.compose(pos, q, sc.set(h * (0.8 + rnd() * 0.4), h * (0.9 + rnd() * 0.5), h));
        crowns.setMatrixAt(placed, m);
        crowns.setColorAt(placed, cCol.setHSL(0.25 + rnd() * 0.06, 0.32 + rnd() * 0.2, 0.20 + rnd() * 0.12));
        placed++;
      }
      trunks.count = placed; crowns.count = placed;
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      this.group.add(trunks); this.group.add(crowns);
    }

    // Rocks where the ground meets the water.
    {
      const rockGeo = new THREE.DodecahedronGeometry(2.0 * S, 0);
      const rocks = new THREE.InstancedMesh(rockGeo, mat.stone, 70);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < 300 && n < 70; i++) {
        const along = (rnd() - 0.5) * 560 * S;
        const off = (40 + rnd() * 90) * S;
        const g = groundAt(along, off);
        if (g < -3 * S || g > 6 * S) continue;      // only in the wash
        if (Math.hypot(along / S, off / S) < 80) continue;
        const h = 0.4 + rnd() * 0.9;
        m.compose(at(along, off, g + 0.4 * S),
          q.setFromAxisAngle(new THREE.Vector3(rnd(), rnd(), rnd()).normalize(), rnd() * 6.28),
          sc.set(h, h * 0.6, h));
        rocks.setMatrixAt(n++, m);
      }
      rocks.count = n;
      rocks.instanceMatrix.needsUpdate = true;
      rocks.castShadow = true;
      this.group.add(rocks);
    }

    /* ------------------------- landmark per style ------------------------- */
    if (spec.style === "fortress") {
      const keep = new THREE.Mesh(new THREE.BoxGeometry(46 * S, 26 * S, 46 * S), mat.stone);
      keep.position.copy(at(-70 * S, 150 * S, groundAt(-70 * S, 150 * S) + 13 * S));
      keep.rotation.y = hRad;
      keep.castShadow = true;
      this.group.add(keep);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(7 * S, 8 * S, 34 * S, 10), mat.stone);
        t.position.copy(at((-70 + dx * 24) * S, (150 + dz * 24) * S, groundAt((-70 + dx * 24) * S, (150 + dz * 24) * S) + 17 * S));
        t.castShadow = true;
        this.group.add(t);
      }
    } else if (spec.style === "kasbah") {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(190 * S, 14 * S, 5 * S), mat.stone);
      wall.position.copy(at(0, 165 * S, groundAt(0, 165 * S) + 7 * S));
      wall.rotation.y = hRad;
      this.group.add(wall);
    } else {
      // A cathedral or a great church
      const nave = new THREE.Mesh(new THREE.BoxGeometry(20 * S, 22 * S, 34 * S), mat.walls[0]);
      nave.position.copy(at(-58 * S, 158 * S, groundAt(-58 * S, 158 * S) + 11 * S));
      nave.rotation.y = hRad;
      nave.castShadow = true;
      this.group.add(nave);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(6 * S, 26 * S, 8), mat.roof);
      spire.position.copy(nave.position).setY(nave.position.y + 24 * S);
      spire.castShadow = true;
      this.group.add(spire);
    }

    if (spec.lighthouse) {
      const towerH = 40 * S;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(4.2 * S, 6.4 * S, towerH, 14), mat.stone);
      const gh = Math.max(0, groundAt(-118 * S, 52 * S));
      const tPos = at(-118 * S, 52 * S, gh + towerH / 2 - 4 * S);
      tower.position.copy(tPos);
      tower.castShadow = true;
      this.group.add(tower);

      const lampGeo = new THREE.SphereGeometry(3.0 * S, 10, 8);
      this.lampMat = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffb246, emissiveIntensity: 0.2 });
      const lamp = new THREE.Mesh(lampGeo, this.lampMat);
      lamp.position.copy(tPos).setY(towerH + 2 * S);
      this.group.add(lamp);

      this.beacon = new THREE.PointLight(0xffc070, 0, 620 * S, 2);
      this.beacon.position.copy(lamp.position);
      this.group.add(this.beacon);
    }

    /* -------------------------- moored shipping --------------------------
     * Real lofted hulls at a smaller scale. These were a scaled hemisphere with
     * two sails floating above it, which from the water read as canvas on
     * sticks with no boat underneath. */
    for (let i = 0; i < (spec.moored || 0); i++) {
      const m = new THREE.Group();
      const sc = 0.42 + rnd() * 0.30;
      const dims = { len: 26 * S * sc, beam: 7.4 * S * sc, draft: 2.6 * S * sc, rise: 2.5 * S * sc };
      const hull = new THREE.Mesh(buildHull(dims), mat.wood);
      hull.castShadow = true;
      m.add(hull);

      const masts = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < masts; k++) {
        const mh = 15 * S * sc;
        const z = (k - (masts - 1) / 2) * 6 * S * sc;
        const mast = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16 * S * sc, 0.24 * S * sc, mh, 6), mat.wood);
        mast.position.set(0, 1.4 * S * sc + mh / 2, z);
        m.add(mast);
        // Furled, because a ship at her moorings does not carry canvas.
        const furl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42 * S * sc, 0.42 * S * sc, 6 * S * sc, 6),
          new THREE.MeshStandardMaterial({ color: 0xded5bd, roughness: 0.95 }));
        furl.rotation.z = Math.PI / 2;
        furl.position.set(0, 1.4 * S * sc + mh * 0.62, z);
        m.add(furl);
      }
      m.position.copy(at((-80 + i * 38 + rnd() * 14) * S, (26 + rnd() * 18) * S, -0.4 * S));
      m.rotation.y = hRad + (rnd() - 0.5) * 0.7;
      m.rotation.z = (rnd() - 0.5) * 0.06;
      this.group.add(m);
    }

    /* ---------------------------- berth marker ---------------------------- */
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(berthRadius * 0.42, berthRadius, 56),
      new THREE.MeshBasicMaterial({ color: 0x74d3a0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(berthPos).setY(0.5);
    ring.renderOrder = 3;
    this.group.add(ring);
    this.ring = ring;

    // A pair of leading marks: line them up and you are on the right approach.
    for (let i = 0; i < 2; i++) {
      const markH = (14 + i * 9) * S;
      const mark = new THREE.Mesh(new THREE.ConeGeometry(2.4 * S, markH, 4), mat.stone);
      mark.position.copy(at(0, (78 + i * 46) * S, Math.max(0, groundAt(0, (78 + i * 46) * S)) + markH / 2));
      mark.rotation.y = hRad + Math.PI / 4;
      this.group.add(mark);
    }

    /* ------------------------------- gulls ------------------------------- */
    this.gulls = [];
    const gullGeo = new THREE.BufferGeometry();
    gullGeo.setAttribute("position", new THREE.Float32BufferAttribute(
      [-1.4, 0, 0, 0, 0.34, -0.28, 1.4, 0, 0], 3));
    const gullMat = new THREE.MeshBasicMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Mesh(gullGeo, gullMat);
      g.scale.setScalar(1.6 + rnd() * 1.4);
      this.group.add(g);
      this.gulls.push({
        mesh: g,
        r: (60 + rnd() * 170) * S,
        y: (24 + rnd() * 42) * S,
        phase: rnd() * Math.PI * 2,
        speed: 0.16 + rnd() * 0.22,
        centre: at((rnd() - 0.5) * 90 * S, (60 + rnd() * 80) * S, 0),
      });
    }
  }

  /** night is 0 in full daylight, 1 in the dark. */
  update(t, night) {
    for (const g of this.gulls) {
      const a = t * g.speed + g.phase;
      g.mesh.position.set(
        g.centre.x + Math.cos(a) * g.r,
        g.y + Math.sin(a * 2.3) * 4,
        g.centre.z + Math.sin(a) * g.r
      );
      g.mesh.rotation.y = -a;
      g.mesh.rotation.z = Math.sin(a * 3.1) * 0.35;
    }
    for (const w of this.lights) w.light.intensity = night * w.peak;
    if (this.beacon) {
      // A revolving light: bright as it sweeps past you.
      const sweep = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(t * 0.55)), 6);
      this.beacon.intensity = night * 5.5 * sweep;
      if (this.lampMat) this.lampMat.emissiveIntensity = 0.2 + night * sweep * 3.2;
    }
  }

  setDockable(ok) {
    if (this.ring) this.ring.material.opacity = ok ? 0.46 : 0.22;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
  }
}

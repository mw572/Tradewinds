// harbour.js — the landfall you are steering for.
//
// Each port builds from its own `berth` spec in world.js, so Lisbon arrives as
// a stacked river city and São Tomé as two huts and a jetty. Everything is
// generated from a seeded PRNG keyed on the port id, which means a given
// harbour looks the same every time you make it without any of it being
// authored by hand.

import * as THREE from "three";

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

    /* ---- the land: terraces rising away from the water, not a flat slab ----
     * Each shelf is set further offshore and stands higher than the last, so
     * the coast reads as ground climbing from a low foreshore to a headland
     * behind the town. Deep boxes, so no shelf edge is visible from seaward. */
    // The near edge of the first shelf must clear the pier, or the coast eats
    // the berth you are trying to steer into.
    const DEPTH = 240 * S;
    for (let i = 0; i < 6; i++) {
      const w = (400 - i * 44) * S;
      const top = (3.5 + i * i * 1.15) * S;       // height of this shelf above the water
      const h = top + 70 * S;                     // buried deep, so no floating edge shows
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, DEPTH), mat.land);
      slab.position.copy(at((rnd() - 0.5) * 44 * S, (DEPTH / 2 + 58 * S) + i * 66 * S, top - h / 2));
      slab.rotation.y = hRad + (rnd() - 0.5) * 0.18;
      slab.receiveShadow = true;
      this.group.add(slab);
    }
    // A pale foreshore where the ground meets the sea. Narrower than the shelf
    // behind it, or it juts out past the coast as a bare rectangle.
    const beach = new THREE.Mesh(
      new THREE.BoxGeometry(330 * S, 6 * S, 44 * S),
      new THREE.MeshStandardMaterial({ color: 0xc9b98f, roughness: 1 })
    );
    beach.position.copy(at(0, 42 * S, 1.2 * S));
    beach.rotation.y = hRad;
    beach.receiveShadow = true;
    this.group.add(beach);

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
    const count = { city: 26, river: 20, fortress: 16, island: 11, kasbah: 18, reef: 14 }[spec.style] || 16;
    for (let i = 0; i < count; i++) {
      const w = (9 + rnd() * 13) * S;
      const d = (9 + rnd() * 12) * S;
      const storeys = 1 + Math.floor(rnd() * (spec.style === "city" ? 4 : 2));
      const h = (7 + storeys * 4.5) * S;

      const along = (rnd() - 0.5) * 250 * S;
      // Push the town up the hill: further from the water means higher ground.
      // The 66 floor keeps every building on the first shelf rather than
      // standing in the harbour.
      const off = (66 + rnd() * 230) * S;
      const ground = Math.min(24 * S, Math.pow((off / S - 58) / 66, 2) * 1.15 * S + 3.5 * S);

      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat.walls[Math.floor(rnd() * mat.walls.length)]);
      b.position.copy(at(along, off, ground + h / 2));
      b.rotation.y = hRad + (rnd() - 0.5) * 0.55;
      b.castShadow = true; b.receiveShadow = true;
      this.group.add(b);

      // Pitched roof
      const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.76, 4.2 * S, 4), mat.roof);
      r.position.copy(b.position).setY(b.position.y + h / 2 + 2.1 * S);
      r.rotation.y = b.rotation.y + Math.PI / 4;
      r.castShadow = true;
      this.group.add(r);

      // A lit window or two after dark
      if (rnd() < 0.5) {
        const win = new THREE.PointLight(0xffb861, 0, 46 * S, 2);
        win.position.copy(b.position).setY(b.position.y + h * 0.2);
        this.group.add(win);
        this.lights.push({ light: win, peak: 0.9 + rnd() * 0.8 });
      }
    }

    /* ------------------------- landmark per style ------------------------- */
    if (spec.style === "fortress") {
      const keep = new THREE.Mesh(new THREE.BoxGeometry(46 * S, 26 * S, 46 * S), mat.stone);
      keep.position.copy(at(-70 * S, 150 * S, 15 * S));
      keep.rotation.y = hRad;
      keep.castShadow = true;
      this.group.add(keep);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(7 * S, 8 * S, 34 * S, 10), mat.stone);
        t.position.copy(at((-70 + dx * 24) * S, (150 + dz * 24) * S, 18 * S));
        t.castShadow = true;
        this.group.add(t);
      }
    } else if (spec.style === "kasbah") {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(190 * S, 14 * S, 5 * S), mat.stone);
      wall.position.copy(at(0, 165 * S, 13 * S));
      wall.rotation.y = hRad;
      this.group.add(wall);
    } else {
      // A cathedral or a great church
      const nave = new THREE.Mesh(new THREE.BoxGeometry(20 * S, 22 * S, 34 * S), mat.walls[0]);
      nave.position.copy(at(-58 * S, 158 * S, 14 * S));
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
      const tPos = at(-118 * S, 30 * S, towerH / 2 - 3 * S);
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

    /* -------------------------- moored shipping -------------------------- */
    for (let i = 0; i < (spec.moored || 0); i++) {
      const m = new THREE.Group();
      const hull = new THREE.Mesh(
        new THREE.SphereGeometry(6 * S, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.wood
      );
      hull.rotation.x = Math.PI;
      hull.scale.set(0.42, 0.55, 1.5);
      m.add(hull);
      for (let k = 0; k < 2; k++) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * S, 0.3 * S, 20 * S, 6), mat.wood);
        mast.position.set(0, 10 * S, (k - 0.5) * 6 * S);
        m.add(mast);
        const sail = new THREE.Mesh(
          new THREE.PlaneGeometry(7 * S, 8 * S),
          new THREE.MeshStandardMaterial({ color: 0xe4dcc6, side: THREE.DoubleSide, roughness: 0.95 })
        );
        sail.position.set(0, 13 * S, (k - 0.5) * 6 * S + 0.4);
        m.add(sail);
      }
      m.position.copy(at((-70 + i * 34 + rnd() * 12) * S, (24 + rnd() * 14) * S, 0));
      m.rotation.y = hRad + (rnd() - 0.5) * 0.5;
      m.castShadow = true;
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
      mark.position.copy(at(0, (78 + i * 46) * S, markH / 2 + 3 * S));
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

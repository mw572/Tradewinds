// sailing.js — the helm. Scene assembly, ship physics, docking.
//
// The sailing model is the part worth getting right, because it is the only
// place in the game where you are not looking at a table of numbers:
//
//  - you cannot sail into the wind. Inside about 30 degrees the sails luff and
//    she stalls, and the only way out is to bear away and build speed first
//  - a beam reach is fastest; running dead downwind is not
//  - the rudder only bites when there is water flowing past it, so a stalled
//    ship will not answer her helm
//  - she carries her way. Momentum is the whole difficulty of docking
//
// Everything else here is presentation: sky, ocean, harbour, camera.

import * as THREE from "three";
import { Ocean, gerstner, waveNormal } from "./ocean.js";
import { Sky } from "./sky.js";
import { Ship3D, Wake } from "./ship3d.js";
import { Harbour } from "./harbour.js";

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Smallest absolute angle between two compass bearings. */
export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Sail power against the true wind angle. 0 is head to wind, 180 dead downwind.
 * The classic polar: nothing in irons, climbing hard through close-hauled,
 * peaking on a beam reach, easing off as you bear away.
 */
export function sailPower(twa) {
  if (twa < 30) return clamp((twa - 6) / 24, 0, 1) * 0.22;      // luffing
  if (twa < 55) return 0.22 + ((twa - 30) / 25) * 0.56;         // close-hauled
  if (twa < 100) return 0.78 + ((twa - 55) / 45) * 0.22;        // reaching, best
  if (twa < 150) return 1.0 - ((twa - 100) / 50) * 0.14;        // broad reach
  return 0.86 - ((twa - 150) / 30) * 0.18;                      // running
}

export function pointOfSail(twa) {
  if (twa < 30) return "In irons";
  if (twa < 55) return "Close-hauled";
  if (twa < 100) return "Beam reach";
  if (twa < 150) return "Broad reach";
  return "Running";
}

export class Voyage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: "high-performance", alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.8, 12000);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.ocean = new Ocean();
    this.scene.add(this.ocean.mesh);

    this.hemi = new THREE.HemisphereLight(0xbcd7e0, 0x0d2530, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 500; sc.left = -100; sc.right = 100; sc.top = 100; sc.bottom = -100;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.wake = new Wake(110);
    this.scene.add(this.wake.mesh);

    this.ship3d = null;
    this.harbour = null;

    this.keys = new Set();
    this._onKeyDown = (e) => {
      const k = e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) e.preventDefault();
      if (k === " ") { this._tryDock(); return; }
      if (k === "c" || k === "C") { this.camMode = (this.camMode + 1) % 3; return; }
      this.keys.add(k);
    };
    this._onKeyUp = (e) => this.keys.delete(e.key);
    this._onResize = () => this._resize();
    this._onBlur = () => this.keys.clear();

    // Touch: drag anywhere to steer and trim.
    this._touch = { active: false, x0: 0, y0: 0 };
    this._onTouchStart = (e) => {
      const t = e.touches[0]; if (!t) return;
      this._touch = { active: true, x0: t.clientX, y0: t.clientY };
    };
    this._onTouchMove = (e) => {
      if (!this._touch.active) return;
      const t = e.touches[0]; if (!t) return;
      e.preventDefault();
      this.touchRudder = clamp((t.clientX - this._touch.x0) / 90, -1, 1);
      this.touchTrim = clamp(-(t.clientY - this._touch.y0) / 120, -1, 1);
    };
    this._onTouchEnd = () => { this._touch.active = false; this.touchRudder = 0; this.touchTrim = 0; };

    this.touchRudder = 0;
    this.touchTrim = 0;
    this.camMode = 0;
    this.running = false;
    this.clock = new THREE.Clock();
    this._tmp = { x: 0, y: 0, z: 0 };
  }

  /* ---------------------------------------------------------- lifecycle -- */

  /**
   * opts: { port, shipSpec, windDeg, windKn, legNm, dayFraction,
   *         onHud, onDockable, onArrive, onMessage }
   */
  start(opts) {
    this.opts = opts;
    this.onHud = opts.onHud;
    this.onDockableCb = opts.onDockable;
    this.onArrive = opts.onArrive;

    // Only rebuild the ship when the hull actually changed.
    const specKey = JSON.stringify([opts.shipSpec?.type, opts.shipSpec?.masts, opts.shipSpec?.armed,
      Math.round((opts.shipSpec?.condition ?? 1) * 4)]);
    if (this._specKey !== specKey) {
      if (this.ship3d) { this.scene.remove(this.ship3d.group); this.ship3d.dispose(); }
      this.ship3d = new Ship3D(opts.shipSpec || {});
      this.scene.add(this.ship3d.group);
      this._specKey = specKey;
    }

    if (this.harbour) { this.scene.remove(this.harbour.group); this.harbour.dispose(); }
    this.berth = new THREE.Vector3(0, 0, 0);
    this.berthRadius = 26;

    // The quay runs alongshore and the land sits to one side of it. That
    // orientation has to be fixed per port and independent of the weather:
    // when it was tied to the wind direction the whole coast swung round with
    // it, and on some headings the ship spawned several hundred metres inland.
    let hash = 0;
    for (let i = 0; i < opts.port.id.length; i++) hash = (hash * 31 + opts.port.id.charCodeAt(i)) >>> 0;
    this.berthHeading = (hash % 360);
    this.harbour = new Harbour(opts.port, this.berth, this.berthHeading, this.berthRadius);
    this.scene.add(this.harbour.group);

    // Seaward is the opposite of the direction the harbour builds its land in.
    const bRad = this.berthHeading * DEG;
    const fwdB = new THREE.Vector3(Math.sin(bRad), 0, -Math.cos(bRad));   // along the quay
    const sideB = new THREE.Vector3(fwdB.z, 0, -fwdB.x);                  // toward the land
    const seaward = sideB.clone().negate();
    this._fwdB = fwdB; this._sideB = sideB;

    // The wind blows across the approach rather than straight down it, so
    // there is a real sailing problem in getting alongside.
    this.windFrom = (this.berthHeading + (Math.random() < 0.5 ? -1 : 1) * (55 + Math.random() * 55) + 360) % 360;
    this.opts.windDeg = this.windFrom;
    this.baseWindKn = opts.windKn ?? 14;
    this.windKn = this.baseWindKn;
    this.gust = 0;
    this.gustPhase = Math.random() * 100;
    this.heelAngle = 0;
    this.heelVel = 0;
    this.pitchAngle = 0;
    this.pitchVel = 0;
    this.maxKn = Math.max(3, opts.shipSpec?.speedKn ?? 7);

    // Always start well out to sea, offset along the shore so the run in is a
    // reach rather than a straight line at the quay.
    const startDist = clamp(560 + (opts.legNm ?? 300) * 0.16, 560, 1250);
    const along = (Math.random() < 0.5 ? -1 : 1) * startDist * 0.45;
    this.pos = new THREE.Vector3()
      .addScaledVector(seaward, startDist)
      .addScaledVector(fwdB, along);

    // Head roughly at the berth, but never inside the no-go zone.
    const toBerth = Math.atan2(this.berth.x - this.pos.x, -(this.berth.z - this.pos.z));
    let heading = ((toBerth / DEG) + 360) % 360;
    if (angleDiff(heading, this.windFrom) < 50) {
      heading = (this.windFrom + (angleDiff((heading + 60) % 360, this.windFrom) > 50 ? 60 : -60) + 360) % 360;
    }
    this.heading = heading;
    this.speedKn = 2.5;
    this.trim = 0.55;
    this.rudder = 0;
    this.dockable = false;
    this.arrived = false;
    this.t = 0;
    this.startDist = startDist;
    this.bumped = -99;
    this._look = null;

    this.wake.clear();
    this.sky.setTime(opts.dayFraction ?? 0.42, (this.windFrom + 140) % 360);

    window.addEventListener("keydown", this._onKeyDown, { passive: false });
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("blur", this._onBlur);
    this.canvas.addEventListener("touchstart", this._onTouchStart, { passive: true });
    this.canvas.addEventListener("touchmove", this._onTouchMove, { passive: false });
    this.canvas.addEventListener("touchend", this._onTouchEnd);

    this._resize();
    this.running = true;
    this.clock.start();
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("blur", this._onBlur);
    this.canvas.removeEventListener("touchstart", this._onTouchStart);
    this.canvas.removeEventListener("touchmove", this._onTouchMove);
    this.canvas.removeEventListener("touchend", this._onTouchEnd);
    this.keys.clear();
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Called by SPACE and by the on-screen dock button. */
  dock() { this._tryDock(); }

  _tryDock() {
    if (this.arrived) return;
    if (this.dockable) { this.arrived = true; this.onArrive?.({ clean: true }); return; }
    const dist = Math.hypot(this.pos.x - this.berth.x, this.pos.z - this.berth.z);
    let why = "Not close enough to the berth yet.";
    if (dist < this.berthRadius && this.speedKn >= 1.4) why = "Too much way on. Spill the wind and come in slow.";
    else if (dist < this.berthRadius) why = "Square her up with the berth before you make fast.";
    this.opts?.onMessage?.(why);
  }

  /* ------------------------------------------------------------ physics -- */

  _update(dt) {
    const upKey = this.keys.has("ArrowUp") || this.keys.has("w");
    const downKey = this.keys.has("ArrowDown") || this.keys.has("s");
    const leftKey = this.keys.has("ArrowLeft") || this.keys.has("a");
    const rightKey = this.keys.has("ArrowRight") || this.keys.has("d");

    if (upKey) this.trim = clamp(this.trim + dt * 0.75, 0, 1);
    if (downKey) this.trim = clamp(this.trim - dt * 0.75, 0, 1);
    if (Math.abs(this.touchTrim) > 0.25) this.trim = clamp(this.trim + this.touchTrim * dt * 0.75, 0, 1);

    const wantRudder = clamp((leftKey ? -1 : 0) + (rightKey ? 1 : 0) + this.touchRudder, -1, 1);
    this.rudder += (wantRudder - this.rudder) * clamp(dt * 5.5, 0, 1);

    // The wind is never steady. Two slow sine terms of different periods give
    // gusts and lulls that arrive at irregular intervals without needing noise,
    // and the heading wanders a few degrees with them the way real wind does.
    this.gustPhase += dt;
    const g1 = Math.sin(this.gustPhase * 0.21);
    const g2 = Math.sin(this.gustPhase * 0.083 + 2.1);
    this.gust = clamp(g1 * 0.6 + g2 * 0.55, -1, 1);
    this.windKn = Math.max(2, this.baseWindKn * (1 + this.gust * 0.32));
    this.windFrom = (this.opts.windDeg + g2 * 7 + 360) % 360;

    const twa = angleDiff(this.heading, this.windFrom);
    const power = sailPower(twa);
    const windScale = clamp(this.windKn / 14, 0.45, 1.7);
    const targetKn = this.trim * this.maxKn * power * windScale;

    // She builds way slowly and loses it fast. That asymmetry is the game.
    const accel = targetKn > this.speedKn ? 0.55 : 1.5;
    this.speedKn += (targetKn - this.speedKn) * clamp(dt * accel, 0, 1);
    this.speedKn = Math.max(0, this.speedKn);

    // The rudder needs water past it: stalled, she barely answers her helm.
    // The 0.2 floor is deliberate. With no floor a ship caught head-to-wind can
    // never turn out of it, because turning needs speed and speed needs turning,
    // and the voyage becomes unwinnable. Sweeps and a backed sail would get her
    // round in reality; this is the cheap stand-in for that.
    const steerAuth = clamp(0.2 + this.speedKn / (this.maxKn * 0.5), 0, 1.15);
    this.heading = (this.heading + this.rudder * 40 * steerAuth * dt + 360) % 360;

    const hRad = this.heading * DEG;
    const fwd = new THREE.Vector3(Math.sin(hRad), 0, -Math.cos(hRad));
    const wRad = this.windFrom * DEG;
    const windVec = new THREE.Vector3(-Math.sin(wRad), 0, Math.cos(wRad));
    const WORLD_PER_KN = 7.5;
    this.pos.addScaledVector(fwd, this.speedKn * WORLD_PER_KN * dt);
    // Leeway: a badly-drawing sail pushes her sideways instead of forwards.
    const leeway = (1 - power) * this.trim * 0.5 + 0.06;
    this.pos.addScaledVector(windVec, leeway * WORLD_PER_KN * dt * windScale);

    // Ground her rather than letting her sail through the coast. The terrain
    // has a height function; anything shallower than the draft is not water.
    if (this.harbour?.groundAt && this._sideB) {
      const along = this.pos.x * this._fwdB.x + this.pos.z * this._fwdB.z;
      const off = this.pos.x * this._sideB.x + this.pos.z * this._sideB.z;
      const g0 = this.harbour.groundAt(along, off);
      const DRAFT = -3.0;
      if (g0 > DRAFT) {
        // Push back down the steepest seaward gradient until she floats.
        const e = 6;
        const gA = this.harbour.groundAt(along + e, off) - this.harbour.groundAt(along - e, off);
        const gO = this.harbour.groundAt(along, off + e) - this.harbour.groundAt(along, off - e);
        const push = new THREE.Vector3(
          -(this._fwdB.x * gA + this._sideB.x * gO),
          0,
          -(this._fwdB.z * gA + this._sideB.z * gO));
        if (push.lengthSq() < 1e-6) push.copy(this._sideB).negate();
        push.normalize();
        this.pos.addScaledVector(push, Math.min(9, (g0 - DRAFT) * 0.8 + 1.2));
        if (this.speedKn > 1.2 && this.t - this.bumped > 3) {
          this.bumped = this.t;
          this.opts?.onMessage?.("You touch the bottom. Get her off before the tide leaves you.");
        }
        this.speedKn *= 0.80;
      }
    }

    // Fend off the quay rather than sailing through it.
    const dist = Math.hypot(this.pos.x - this.berth.x, this.pos.z - this.berth.z);
    if (dist < 11) {
      const push = new THREE.Vector3(this.pos.x - this.berth.x, 0, this.pos.z - this.berth.z);
      if (push.lengthSq() < 1e-4) push.set(1, 0, 0);
      push.normalize();
      this.pos.addScaledVector(push, 11 - dist);
      if (this.speedKn > 1.6 && this.t - this.bumped > 2) {
        this.bumped = this.t;
        this.opts?.onMessage?.("You clout the quay. Mind her way next time.");
      }
      this.speedKn *= 0.86;
    }

    // Ride the swell: the hull sits on the true Gerstner surface and trims to
    // its normal, so she pitches into head seas and rolls across beam seas.
    const g = gerstner(this.pos.x, this.pos.z, this.t, this._tmp);
    const grp = this.ship3d.group;
    grp.position.set(g.x, g.y, g.z);
    grp.rotation.set(0, -hRad, 0);

    const n = waveNormal(this.pos.x, this.pos.z, this.t, 4);
    const roll = Math.asin(clamp(n.x * Math.cos(hRad) - n.z * Math.sin(hRad), -1, 1));
    const pitch = Math.asin(clamp(n.x * Math.sin(hRad) + n.z * Math.cos(hRad), -1, 1));

    // Heel is a damped spring rather than a value assigned straight from the
    // wind. A hull has mass and a righting moment: she leans INTO a gust over a
    // second or so, hangs there, and rolls back upright when it eases. Setting
    // the angle directly made her snap between attitudes like a hinge.
    const heelSign = Math.sin((this.heading - this.windFrom) * DEG);
    const heelTarget = -roll * 0.72 + heelSign * this.trim * power * 0.30 * windScale;
    const STIFF = 26, DAMP = 6.4;        // righting moment, and the water's drag on it
    this.heelVel += (heelTarget - this.heelAngle) * STIFF * dt - this.heelVel * DAMP * dt;
    this.heelAngle += this.heelVel * dt;
    this.heelAngle = clamp(this.heelAngle, -0.55, 0.55);

    // Pitch: the swell drives it, and driving hard into a head sea lifts the bow.
    const bury = clamp(Math.cos(twa * DEG), -1, 1) * -1;
    const pitchTarget = pitch * 0.72 + bury * (this.speedKn / this.maxKn) * 0.05;
    this.pitchVel += (pitchTarget - this.pitchAngle) * 30 * dt - this.pitchVel * 7 * dt;
    this.pitchAngle += this.pitchVel * dt;

    grp.rotation.z = this.heelAngle;
    grp.rotation.x = this.pitchAngle;

    const speedFrac = this.speedKn / this.maxKn;
    const night = 1 - clamp((this.sky.sunDir.y + 0.12) / 0.42, 0, 1);
    this.ship3d.update(dt, { speedFrac, trim: this.trim, rudder: this.rudder, night, t: this.t });

    this.wake.push(g.x, g.y, g.z, hRad, speedFrac);
    if (speedFrac > 0.18 && Math.random() < speedFrac * dt * 12) this.ocean.addWake(g.x, g.z);

    const p = this.sky.palette;
    // A floor under the ambient: even at dusk the ship has to read.
    this.hemi.intensity = 0.62 + p.ambient * 0.72;
    this.hemi.color.copy(p.horizon);
    this.sun.color.copy(p.sunColor);
    this.sun.intensity = 0.55 + p.intensity * 1.85;
    this.sun.position.copy(this.sky.sunDir).multiplyScalar(240).add(grp.position);
    this.sun.target.position.copy(grp.position);
    this.sun.target.updateMatrixWorld();

    this.ocean.update(this.t, this.pos, this.camera, { ...p, sunDir: this.sky.sunDir },
      { kn: this.windKn, fromDeg: this.windFrom });
    this.harbour.update(this.t, night);

    const aligned = angleDiff(this.heading, this.berthHeading) < 60;
    const slow = this.speedKn < 1.4;
    const inside = dist < this.berthRadius;
    this.dockable = inside && slow && aligned && !this.arrived;
    this.harbour.setDockable(this.dockable);
    this.onDockableCb?.(this.dockable, { inside, slow, aligned });

    this._camera(dt, fwd, g, speedFrac);

    this.onHud?.({
      headingDeg: Math.round(this.heading),
      speedKn: this.speedKn,
      maxKn: this.maxKn,
      trim: this.trim,
      pointOfSail: pointOfSail(twa),
      twa: Math.round(twa),
      distM: Math.round(dist),
      progress: clamp(1 - dist / this.startDist, 0, 1),
      windFrom: this.windFrom,
      windKn: this.windKn,
      gust: this.gust,
      heelDeg: Math.round((this.heelAngle * 180) / Math.PI),
      inIrons: twa < 30,
      dockable: this.dockable,
      night,
    });
  }

  _camera(dt, fwd, g, speedFrac) {
    let desired, look;
    if (this.camMode === 0) {
      // Quarter view from astern and above, opening out as she picks up speed
      // so the sense of motion comes from the frame as well as the wake.
      const back = 74 + speedFrac * 26;
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const off = 13 + speedFrac * 7;
      desired = new THREE.Vector3(
        g.x - fwd.x * back + side.x * off,
        g.y + 34 + speedFrac * 9,
        g.z - fwd.z * back + side.z * off);
      look = new THREE.Vector3(g.x + fwd.x * 30, g.y + 9, g.z + fwd.z * 30);
    } else if (this.camMode === 1) {
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      desired = new THREE.Vector3(
        g.x - fwd.x * 30 + side.x * 34, g.y + 11, g.z - fwd.z * 30 + side.z * 34);
      look = new THREE.Vector3(g.x, g.y + 8, g.z);
    } else {
      // Masthead: high up the main, looking out over the bow at the horizon
      // rather than straight down at the deck.
      desired = new THREE.Vector3(g.x - fwd.x * 2, g.y + 40, g.z - fwd.z * 2);
      look = new THREE.Vector3(g.x + fwd.x * 260, g.y + 26, g.z + fwd.z * 260);
    }
    this.camera.position.lerp(desired, clamp(dt * 2.6, 0, 1));
    if (!this._look) this._look = look.clone();
    this._look.lerp(look, clamp(dt * 3.4, 0, 1));
    this.camera.lookAt(this._look);
    this.camera.rotation.z += (this.heelAngle || 0) * 0.16;
  }

  _loop() {
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(() => this._loop());
  }
}

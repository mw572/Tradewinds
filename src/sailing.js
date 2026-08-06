// sailing.js — the 3-D helm. A Gerstner-wave ocean, a caravel you steer with
// real inertia and point-of-sail physics, and a berth you must bring her into
// slowly and squarely. Three.js, no build step.
import * as THREE from "three";

// Wave field shared between the GPU (vertex shader) and the CPU (ship bob).
// phase = dot(dir, worldXZ) * freq + time * speed ; y += amp * sin(phase)
const WAVES = [
  { dir: [1.0, 0.15], amp: 1.6, freq: 0.011, speed: 0.55, q: 0.30 },
  { dir: [0.6, 0.8], amp: 1.0, freq: 0.020, speed: 0.80, q: 0.35 },
  { dir: [-0.5, 0.85], amp: 0.5, freq: 0.035, speed: 1.15, q: 0.40 },
  { dir: [0.25, -1.0], amp: 0.25, freq: 0.060, speed: 1.6, q: 0.45 },
];

function normDir([x, z]) { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }
const WDIR = WAVES.map((w) => normDir(w.dir));

// CPU-side height sample (matches the shader) so the hull rides the swell.
function waveHeight(x, z, t) {
  let y = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i], d = WDIR[i];
    const phase = (d[0] * x + d[1] * z) * w.freq + t * w.speed;
    y += w.amp * Math.sin(phase);
  }
  return y;
}

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function angleDiff(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// Sail power vs true wind angle (0 = pointing into wind, 180 = dead downwind).
function sailPower(twa) {
  if (twa < 32) return clamp((twa - 8) / 24, 0, 1) * 0.28;   // in irons → luffing
  if (twa < 55) return 0.28 + (twa - 32) / 23 * 0.5;         // close-hauled
  if (twa < 105) return 0.78 + (twa - 55) / 50 * 0.22;       // reaching → best
  if (twa < 150) return 1.0 - (twa - 105) / 45 * 0.12;       // broad reach
  return 0.88 - (twa - 150) / 30 * 0.16;                     // running
}
function pointOfSailName(twa) {
  if (twa < 32) return "In irons";
  if (twa < 55) return "Close-hauled";
  if (twa < 105) return "Beam reach";
  if (twa < 150) return "Broad reach";
  return "Running";
}

export class Voyage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a3a48, 900, 2600);
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 6000);

    this._buildSky();
    this._buildOcean();
    this._buildShip();
    this._buildLights();

    this.keys = new Set();
    this._onKeyDown = (e) => {
      const k = e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) e.preventDefault();
      if (k === " ") { if (this.dockable && this.onArrive) this.onArrive(); return; }
      this.keys.add(k);
    };
    this._onKeyUp = (e) => this.keys.delete(e.key);
    this._onResize = () => this._resize();

    this.running = false;
    this.clock = new THREE.Clock();
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xbcd7e0, 0x0a2028, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
    this.sunDir = new THREE.Vector3(-0.4, 0.7, 0.55).normalize();
    sun.position.copy(this.sunDir).multiplyScalar(500);
    this.scene.add(sun);
  }

  _buildSky() {
    // vertical gradient backdrop
    const c = document.createElement("canvas");
    c.width = 8; c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, "#0b2a3c");
    grad.addColorStop(0.55, "#2b6076");
    grad.addColorStop(0.78, "#8fb2b8");
    grad.addColorStop(1.0, "#d8cba0");
    g.fillStyle = grad; g.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
  }

  _buildOcean() {
    const SIZE = 5000, SEG = 200;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);

    const waveDirs = WDIR.flat();
    const uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uSun: { value: this.sunDir ? this.sunDir.clone() : new THREE.Vector3(-0.4, 0.7, 0.55).normalize() },
      uCam: { value: new THREE.Vector3() },
      uDeep: { value: new THREE.Color(0x0a3446) },
      uShallow: { value: new THREE.Color(0x2a7d84) },
      uSky: { value: new THREE.Color(0x9fc0c4) },
      uAmp: { value: WAVES.map((w) => w.amp) },
      uFreq: { value: WAVES.map((w) => w.freq) },
      uSpeed: { value: WAVES.map((w) => w.speed) },
      uDir: { value: waveDirs },
    };
    this.oceanUniforms = uniforms;

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        uniform float uTime;
        uniform vec2 uCenter;
        uniform float uAmp[4];
        uniform float uFreq[4];
        uniform float uSpeed[4];
        uniform float uDir[8];
        varying vec3 vWorld;
        varying vec3 vNormal;
        float wy(vec2 p){
          float y = 0.0;
          for(int i=0;i<4;i++){
            vec2 d = vec2(uDir[i*2], uDir[i*2+1]);
            float ph = dot(d,p)*uFreq[i] + uTime*uSpeed[i];
            y += uAmp[i]*sin(ph);
          }
          return y;
        }
        void main(){
          vec2 wp = position.xz + uCenter;
          float e = 2.0;
          float h  = wy(wp);
          float hR = wy(wp+vec2(e,0.0));
          float hU = wy(wp+vec2(0.0,e));
          vNormal = normalize(vec3(h-hR, e, h-hU));
          vec3 pos = vec3(position.x, h, position.z);
          vWorld = vec3(wp.x, h, wp.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos,1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform vec3 uSun; uniform vec3 uCam;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky;
        varying vec3 vWorld; varying vec3 vNormal;
        void main(){
          vec3 N = normalize(vNormal);
          vec3 V = normalize(uCam - vWorld);
          float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
          float diff = clamp(dot(N, normalize(uSun))*0.5+0.5, 0.0, 1.0);
          float crest = smoothstep(0.6, 2.2, vWorld.y);
          vec3 water = mix(uDeep, uShallow, diff);
          water = mix(water, uSky, fres*0.6);
          water += crest * 0.25;
          vec3 H = normalize(normalize(uSun)+V);
          float spec = pow(max(dot(N,H),0.0), 120.0);
          water += spec * vec3(1.0,0.95,0.8) * 0.8;
          float dist = length(uCam.xz - vWorld.xz);
          water = mix(water, vec3(0.55,0.66,0.62), clamp((dist-1400.0)/1600.0,0.0,0.45));
          gl_FragColor = vec4(water, 1.0);
        }
      `,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.scene.add(this.ocean);
  }

  _buildShip() {
    const ship = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5c3d22, roughness: 0.85 });
    const woodLt = new THREE.MeshStandardMaterial({ color: 0x7a5330, roughness: 0.8 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3a2716, roughness: 0.9 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.8, 14), wood);
    hull.position.y = 0.4; ship.add(hull);

    // pointed bow (a low 4-sided prism) at -Z
    const bow = new THREE.Mesh(new THREE.ConeGeometry(2.9, 6, 4), wood);
    bow.rotation.x = -Math.PI / 2; bow.rotation.z = Math.PI / 4;
    bow.position.set(0, 0.4, -9.5); ship.add(bow);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.5, 12.5), woodLt);
    deck.position.y = 1.9; ship.add(deck);

    const aft = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.6, 3.4), woodLt);
    aft.position.set(0, 3.0, 5.2); ship.add(aft);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 17, 8), trim);
    mast.position.set(0, 9, -1); ship.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 12, 6), trim);
    boom.rotation.x = Math.PI / 2; boom.position.set(0, 5.5, -1); ship.add(boom);

    // sail with a red cross (a nod to the age of Portuguese sail)
    const sc = document.createElement("canvas");
    sc.width = 128; sc.height = 160;
    const sg = sc.getContext("2d");
    sg.fillStyle = "#efe7d2"; sg.fillRect(0, 0, 128, 160);
    sg.fillStyle = "#b23a2e";
    sg.fillRect(52, 20, 24, 120); sg.fillRect(20, 58, 88, 24);
    const stex = new THREE.CanvasTexture(sc);
    stex.colorSpace = THREE.SRGBColorSpace;
    const sailMat = new THREE.MeshStandardMaterial({ map: stex, side: THREE.DoubleSide, roughness: 0.95 });
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(11, 12, 6, 4), sailMat);
    sail.position.set(0, 9, -1.1);
    // gentle belly in the sail
    const pos = sail.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, -Math.cos((x / 11) * Math.PI) * 1.1 - 1.0);
    }
    sail.geometry.computeVertexNormals();
    ship.add(sail);
    this.sail = sail;

    this.ship = ship;
    this.scene.add(ship);
  }

  _buildHarbour(berthPos, berthHeadingDeg) {
    if (this.harbour) this.scene.remove(this.harbour);
    const h = new THREE.Group();
    const hRad = berthHeadingDeg * DEG;
    const fwd = new THREE.Vector3(Math.sin(hRad), 0, -Math.cos(hRad));  // along berth
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);                   // to starboard of berth

    const stone = new THREE.MeshStandardMaterial({ color: 0x6b6156, roughness: 1 });
    const land = new THREE.MeshStandardMaterial({ color: 0x53603f, roughness: 1 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x7a4b34, roughness: 1 });
    const wallM = new THREE.MeshStandardMaterial({ color: 0xcbb58c, roughness: 1 });

    // landmass behind the pier
    const landMesh = new THREE.Mesh(new THREE.BoxGeometry(340, 40, 340), land);
    const landCenter = new THREE.Vector3().copy(berthPos).addScaledVector(side, 190).setY(-16);
    landMesh.position.copy(landCenter); h.add(landMesh);

    // stone pier alongside the berth
    const pier = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 70), stone);
    pier.position.copy(berthPos).addScaledVector(side, 9).setY(1);
    pier.rotation.y = -hRad; h.add(pier);

    // mooring posts
    for (const s of [-18, 18]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 5, 8), stone);
      post.position.copy(berthPos).addScaledVector(fwd, s).addScaledVector(side, 4).setY(2);
      h.add(post);
    }
    // a few buildings + a tower for a skyline
    for (let i = 0; i < 6; i++) {
      const w = 10 + (i % 3) * 5;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 12 + (i % 4) * 5, w), wallM);
      b.position.copy(berthPos)
        .addScaledVector(side, 45 + (i % 3) * 30)
        .addScaledVector(fwd, -60 + i * 24).setY(6);
      h.add(b);
      const r = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, 7, 4), roof);
      r.position.copy(b.position).setY(b.position.y + 9); r.rotation.y = Math.PI / 4;
      h.add(r);
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 34, 12), wallM);
    tower.position.copy(berthPos).addScaledVector(side, 60).addScaledVector(fwd, 40).setY(17);
    h.add(tower);

    // berth zone marker on the water
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6, this.berthRadius, 40),
      new THREE.MeshBasicMaterial({ color: 0x6fbf8e, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(berthPos).setY(0.6);
    h.add(ring);
    this.berthRing = ring;

    this.harbour = h;
    this.scene.add(h);
  }

  start(opts) {
    // opts: { destName, windDeg, legUnits, onHud, onDockable, onArrive }
    this.onHud = opts.onHud;
    this.onDockableCb = opts.onDockable;
    this.onArrive = opts.onArrive;
    this.destName = opts.destName;

    this.windFrom = opts.windDeg;                 // compass deg the wind blows FROM
    this.berthRadius = 20;
    this.berth = new THREE.Vector3(0, 0, 0);
    this.berthHeading = this.windFrom;            // moor bow-to-wind
    this._buildHarbour(this.berth, this.berthHeading);

    // start downwind of the berth so there's a real approach to sail
    const startDist = clamp(520 + opts.legUnits * 34, 520, 1080);
    const bearing = (this.windFrom + 180) * DEG;  // downwind side
    this.pos = new THREE.Vector3(Math.sin(bearing) * startDist, 0, -Math.cos(bearing) * startDist);

    // face roughly toward the berth to begin
    const toBerth = Math.atan2(this.berth.x - this.pos.x, -(this.berth.z - this.pos.z));
    this.heading = (toBerth / DEG + 360) % 360;
    this.speedKn = 2;
    this.trim = 0.5;
    this.rudder = 0;
    this.prevDist = startDist;
    this.dockable = false;
    this.arrived = false;
    this.t = 0;

    window.addEventListener("keydown", this._onKeyDown, { passive: false });
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("resize", this._onResize);
    this._resize();
    this.running = true;
    this.clock.start();
    this._loop();
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _update(dt) {
    const maxKn = this.ship.speedKn;

    // controls
    if (this.keys.has("ArrowUp")) this.trim = clamp(this.trim + dt * 0.8, 0, 1);
    if (this.keys.has("ArrowDown")) this.trim = clamp(this.trim - dt * 0.8, 0, 1);
    const wantRudder = (this.keys.has("ArrowLeft") ? -1 : 0) + (this.keys.has("ArrowRight") ? 1 : 0);
    this.rudder += (wantRudder - this.rudder) * clamp(dt * 6, 0, 1);

    // point of sail
    const twa = angleDiff(this.heading, this.windFrom);
    const power = sailPower(twa);
    const targetKn = this.trim * maxKn * power;
    const accel = targetKn > this.speedKn ? 0.6 : 1.4;         // slows faster than she builds way
    this.speedKn += (targetKn - this.speedKn) * clamp(dt * accel, 0, 1);
    this.speedKn = Math.max(0, this.speedKn);

    // steering needs way on
    const steerAuth = clamp(0.25 + this.speedKn / maxKn, 0, 1.1);
    this.heading = (this.heading + this.rudder * 42 * steerAuth * dt + 360) % 360;

    // translate
    const hRad = this.heading * DEG;
    const fwd = new THREE.Vector3(Math.sin(hRad), 0, -Math.cos(hRad));
    const worldPerKn = 7;
    this.pos.addScaledVector(fwd, this.speedKn * worldPerKn * dt);

    // fend off if she'd drive onto the pier
    const dist = Math.hypot(this.pos.x - this.berth.x, this.pos.z - this.berth.z);
    if (dist < 8 && this.speedKn > 1) this.speedKn *= 0.9;

    // ride the swell
    const wy = waveHeight(this.pos.x, this.pos.z, this.t);
    this.ship.position.set(this.pos.x, wy, this.pos.z);
    this.ship.rotation.y = -hRad;
    const e = 4;
    const hx = waveHeight(this.pos.x + e, this.pos.z, this.t) - waveHeight(this.pos.x - e, this.pos.z, this.t);
    const hz = waveHeight(this.pos.x, this.pos.z + e, this.t) - waveHeight(this.pos.x, this.pos.z - e, this.t);
    this.ship.rotation.z = -clamp(hx / e, -0.3, 0.3) + this.rudder * 0.08;
    this.ship.rotation.x = clamp(hz / e, -0.3, 0.3);
    if (this.sail) this.sail.material.opacity = 1;

    // dockable?
    const aligned = angleDiff(this.heading, this.berthHeading) < 55;
    this.dockable = dist < this.berthRadius && this.speedKn < 1.2 && aligned;
    if (this.onDockableCb) this.onDockableCb(this.dockable);
    if (this.berthRing) this.berthRing.material.opacity = this.dockable ? 0.5 : 0.28;

    // chase camera
    const camBack = 46, camUp = 22;
    const desired = new THREE.Vector3(
      this.pos.x - fwd.x * camBack, wy + camUp, this.pos.z - fwd.z * camBack
    );
    this.camera.position.lerp(desired, clamp(dt * 2.5, 0, 1));
    this.camera.lookAt(this.pos.x + fwd.x * 20, 3, this.pos.z + fwd.z * 20);

    // ocean follows the ship; feed camera + time to the shader
    this.ocean.position.set(this.pos.x, 0, this.pos.z);
    this.oceanUniforms.uCenter.value.set(this.pos.x, this.pos.z);
    this.oceanUniforms.uTime.value = this.t;
    this.oceanUniforms.uCam.value.copy(this.camera.position);

    // HUD
    if (this.onHud) {
      this.onHud({
        headingDeg: Math.round(this.heading),
        speedKn: this.speedKn,
        pos: pointOfSailName(twa),
        distM: Math.round(dist),
        windFrom: this.windFrom,
        closing: this.prevDist - dist,
      });
    }
    this.prevDist = dist;
  }

  _loop() {
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(() => this._loop());
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("resize", this._onResize);
    this.keys.clear();
  }
}

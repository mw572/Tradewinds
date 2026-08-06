// ocean.js — the sea.
//
// Proper Gerstner waves: each wave displaces the surface horizontally as well
// as vertically, so crests sharpen and troughs flatten the way real swell does.
// The same wave sum runs on the CPU (so the hull rides the water exactly, not
// approximately) and on the GPU (so it looks right at 200x200 vertices).
//
// Foam comes from the Jacobian of the displacement: where the surface folds in
// on itself the wave is breaking, and that is where whitewater belongs. It is
// the cheapest physically-motivated foam there is and it beats a height
// threshold every time, because it tracks the *steep face* of the wave rather
// than simply the top.

import * as THREE from "three";

// dir must be a unit vector. steep is the Gerstner Q: 0 is a sine wave, higher
// values sharpen the crest. Sum of (steep * amp * freq) must stay under 1 or
// the surface folds through itself and you get visible pinching.
// Wavelengths are tuned against a 26-unit hull: the dominant swell runs about
// 9 ship-lengths, which is what an Atlantic swell looks like from a caravel's
// deck. Amplitudes are deliberately generous; a physically-scaled sea reads as
// flat on a screen.
// Amplitudes sum to about 2.6 units against a hull with roughly 3.5 units of
// freeboard. They used to sum to 6.3, which is a survival storm for a 26-unit
// caravel: the sea stood higher than her deck and washed straight through it.
export const WAVES = [
  { dir: [1.00, 0.16],   amp: 1.30, len: 240, speed: 0.62, steep: 0.86 },
  { dir: [0.62, 0.79],   amp: 0.70, len: 132, speed: 0.86, steep: 0.76 },
  { dir: [-0.48, 0.88],  amp: 0.36, len: 68,  speed: 1.15, steep: 0.64 },
  { dir: [0.28, -0.96],  amp: 0.18, len: 34,  speed: 1.55, steep: 0.54 },
  { dir: [-0.92, -0.39], amp: 0.09, len: 17,  speed: 2.10, steep: 0.42 },
];

const norm = ([x, z]) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const DIRS = WAVES.map((w) => norm(w.dir));
const FREQ = WAVES.map((w) => (Math.PI * 2) / w.len);
const PHASE_SPEED = WAVES.map((w, i) => w.speed * Math.sqrt(9.81 / FREQ[i]) * 0.06);

/**
 * CPU-side Gerstner sum. Returns the displaced surface point for a base
 * position, matching the vertex shader exactly. The hull uses this so it sits
 * in the water rather than hovering over an approximation of it.
 */
export function gerstner(x, z, t, out = { x: 0, y: 0, z: 0 }) {
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i], d = DIRS[i], k = FREQ[i];
    const phase = (d[0] * x + d[1] * z) * k + t * PHASE_SPEED[i] * k;
    const c = Math.cos(phase), s = Math.sin(phase);
    const q = w.steep / (k * w.amp * WAVES.length);
    dx += q * w.amp * d[0] * c;
    dz += q * w.amp * d[1] * c;
    dy += w.amp * s;
  }
  out.x = x + dx; out.y = dy; out.z = z + dz;
  return out;
}

/** Just the height, for cheap sampling. */
export function waveHeight(x, z, t) {
  let y = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i], d = DIRS[i], k = FREQ[i];
    y += w.amp * Math.sin((d[0] * x + d[1] * z) * k + t * PHASE_SPEED[i] * k);
  }
  return y;
}

/** Surface normal by finite difference, for trimming the hull to the swell. */
export function waveNormal(x, z, t, e = 3) {
  const hL = waveHeight(x - e, z, t), hR = waveHeight(x + e, z, t);
  const hD = waveHeight(x, z - e, t), hU = waveHeight(x, z + e, t);
  return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform vec2  uCenter;
  uniform float uAmp[5];
  uniform float uFreq[5];
  uniform float uPhaseSpeed[5];
  uniform float uSteep[5];
  uniform vec2  uDir[5];
  uniform vec3  uWake[8];      // xz = world position, z-slot = age 0..1
  uniform float uWindAmp;      // 0.45 in a calm .. 1.6 in a gale

  varying vec3  vWorld;
  varying vec3  vNormal;
  varying float vFoam;
  varying float vHeight;

  void main() {
    vec2 base = position.xz + uCenter;
    vec3 disp = vec3(0.0);

    // Gerstner sum, plus the partial derivatives we need for the normal and
    // for the Jacobian that tells us where the surface is folding.
    vec3 ddx = vec3(1.0, 0.0, 0.0);
    vec3 ddz = vec3(0.0, 0.0, 1.0);

    for (int i = 0; i < 5; i++) {
      float k = uFreq[i];
      vec2  d = uDir[i];
      float ph = dot(d, base) * k + uTime * uPhaseSpeed[i] * k;
      float c = cos(ph), s = sin(ph);
      float a = uAmp[i] * uWindAmp;
      float q = uSteep[i] / (k * a * 5.0);

      disp.x += q * a * d.x * c;
      disp.z += q * a * d.y * c;
      disp.y += a * s;

      float wa = k * a;
      ddx.x -= q * wa * d.x * d.x * s;
      ddx.y += wa * d.x * c;
      ddx.z -= q * wa * d.x * d.y * s;

      ddz.x -= q * wa * d.y * d.x * s;
      ddz.y += wa * d.y * c;
      ddz.z -= q * wa * d.y * d.y * s;
    }

    vec3 world = vec3(base.x + disp.x, disp.y, base.y + disp.z);
    vNormal = normalize(cross(ddz, ddx));
    vHeight = disp.y;

    // Jacobian: below 1 the surface is compressing, which is a breaking crest.
    float jacobian = ddx.x * ddz.z - ddx.z * ddz.x;
    float breaking = smoothstep(0.62, 0.18, jacobian);

    // Wake foam: the ship stamps decaying discs into the foam field. Keep these
    // tight — a disturbed patch a few beams wide, not a lake of milk.
    float wake = 0.0;
    for (int i = 0; i < 8; i++) {
      float age = uWake[i].z;
      if (age <= 0.0) continue;
      float d = distance(world.xz, uWake[i].xy);
      float radius = 4.0 + (1.0 - age) * 15.0;
      wake = max(wake, smoothstep(radius, radius * 0.30, d) * age * 0.40);
    }

    vFoam = clamp(breaking + wake, 0.0, 1.0);
    vWorld = world;

    // Draw in the plane's local space; the mesh itself is parented to the ship.
    gl_Position = projectionMatrix * modelViewMatrix
                * vec4(position.x + disp.x, disp.y, position.z + disp.z, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3  uSun;
  uniform vec3  uCam;
  uniform vec3  uDeep;
  uniform vec3  uShallow;
  uniform vec3  uSkyTint;
  uniform vec3  uSunColor;
  uniform vec3  uHorizon;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec2  uWindDir;      // unit vector the wind blows TOWARDS
  uniform float uWindStr;      // 0 calm .. 1 hard
  uniform float uTime2;

  varying vec3  vWorld;
  varying vec3  vNormal;
  varying float vFoam;
  varying float vHeight;

  // Cheap value noise. Two octaves is plenty for wind texture on water.
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCam - vWorld);
    vec3 L = normalize(uSun);

    // Schlick Fresnel. Water is ~2% reflective head-on and a mirror at grazing.
    float f0 = 0.02;
    float fres = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);

    // Depth tint: steeper faces read as deeper water.
    float facing = clamp(dot(N, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    vec3 body = mix(uDeep, uShallow, pow(facing, 2.2));

    // Subsurface glow through the back of a wave, lit from behind.
    float back = pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0);
    float lift = smoothstep(-0.5, 2.4, vHeight);
    body += uShallow * back * lift * 0.42;

    // Sky reflection, cheap: tint by how much sky the normal can see.
    vec3 reflected = mix(uHorizon, uSkyTint, clamp(N.y, 0.0, 1.0));
    vec3 col = mix(body, reflected, fres * 0.82);

    // Sun glitter. Two lobes: a tight specular and a broad sheen.
    vec3 H = normalize(L + V);
    float ndh = clamp(dot(N, H), 0.0, 1.0);
    col += uSunColor * pow(ndh, 420.0) * 1.5;
    col += uSunColor * pow(ndh, 28.0) * 0.16;

    // Cat's paws: the dark ruffled patches wind drags across water. Stretched
    // along the wind axis and scrolled downwind, they are the single clearest
    // signal on screen that the air is moving and which way.
    vec2 windPerp = vec2(-uWindDir.y, uWindDir.x);
    vec2 wp = vec2(dot(vWorld.xz, uWindDir), dot(vWorld.xz, windPerp));
    vec2 streakUV = vec2(wp.x * 0.0055 - uTime2 * 0.42, wp.y * 0.030);
    float paw = vnoise(streakUV) * 0.65 + vnoise(streakUV * 2.7 + 11.0) * 0.35;
    paw = smoothstep(0.48, 0.86, paw) * uWindStr;
    col *= 1.0 - paw * 0.30;                       // ruffled water is darker
    col += uSunColor * paw * 0.05;                 // and glitters a little more

    // Foam sits on top of everything, slightly blue in shadow.
    vec3 foamCol = mix(vec3(0.72, 0.80, 0.83), vec3(1.0), clamp(dot(N, L), 0.0, 1.0));
    col = mix(col, foamCol, clamp(vFoam, 0.0, 1.0) * 0.92);

    // Distance haze into the horizon band, so the sea meets the sky cleanly.
    float dist = length(uCam - vWorld);
    col = mix(col, uHorizon, smoothstep(uFogNear, uFogFar, dist));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Ocean {
  /**
   * The grid is radially graded: vertices bunch up near the ship and stretch
   * out toward the horizon. A uniform 9000-unit plane at 220 segments gives
   * ~41 units per quad, which is longer than four of the five wave components,
   * so they alias away and the sea renders mirror-flat. Warping the radius by
   * a power curve puts ~4 units per quad under the hull, where the waves are
   * actually looked at, while still reaching the horizon with the same vertex
   * budget.
   */
  constructor({ size = 9000, segments = 240, falloff = 2.7 } = {}) {
    const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const half = size * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // Square-to-disc, warp the radius, then back out to world scale.
      const r = Math.max(Math.abs(x), Math.abs(z));      // Chebyshev keeps it square
      if (r < 1e-6) continue;
      const warped = Math.pow(r, falloff) / r;           // r^falloff, kept as a scale
      pos.setX(i, x * warped * half);
      pos.setZ(i, z * warped * half);
    }
    pos.needsUpdate = true;

    this.uniforms = {
      uTime:       { value: 0 },
      uCenter:     { value: new THREE.Vector2() },
      uAmp:        { value: WAVES.map((w) => w.amp) },
      uFreq:       { value: FREQ.slice() },
      uPhaseSpeed: { value: PHASE_SPEED.slice() },
      uSteep:      { value: WAVES.map((w) => w.steep) },
      uDir:        { value: DIRS.map(([x, z]) => new THREE.Vector2(x, z)) },
      uWake:       { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uSun:        { value: new THREE.Vector3(0, 1, 0) },
      uCam:        { value: new THREE.Vector3() },
      uDeep:       { value: new THREE.Color(0x06283a) },
      uShallow:    { value: new THREE.Color(0x1d7f8c) },
      uSkyTint:    { value: new THREE.Color(0x8fc4d8) },
      uSunColor:   { value: new THREE.Color(0xfff2d2) },
      uHorizon:    { value: new THREE.Color(0xa8c2c4) },
      uFogNear:    { value: 1500 },
      uFogFar:     { value: 4200 },
      uWindAmp:    { value: 1 },
      uWindDir:    { value: new THREE.Vector2(1, 0) },
      uWindStr:    { value: 0.5 },
      uTime2:      { value: 0 },
    };

    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;

    this._wake = [];     // { x, z, born }
    this._t = 0;
  }

  /** Drop a foam stamp where the hull is churning the water. */
  addWake(x, z) {
    this._wake.push({ x, z, born: this._t });
    if (this._wake.length > 8) this._wake.shift();
  }

  /**
   * The ocean plane follows the ship so it is always centred under her, while
   * uCenter keeps the wave field locked to world space. Without this the waves
   * would appear to travel with the ship and she would never seem to move.
   */
  update(t, shipPos, camera, palette, wind) {
    this._t = t;
    this.uniforms.uTime.value = t;
    this.uniforms.uTime2.value = t;
    if (wind) {
      // Wave height follows the wind, but not linearly: a sea takes time to get
      // up, so the exponent keeps a fresh breeze from looking like a storm.
      this.uniforms.uWindAmp.value = 0.45 + Math.pow(Math.min(wind.kn, 34) / 22, 1.35) * 1.05;
      const r = (wind.fromDeg + 180) * Math.PI / 180;
      this.uniforms.uWindDir.value.set(Math.sin(r), -Math.cos(r));
      this.uniforms.uWindStr.value = Math.min(1, Math.max(0, (wind.kn - 4) / 22));
    }
    this.mesh.position.set(shipPos.x, 0, shipPos.z);
    this.uniforms.uCenter.value.set(shipPos.x, shipPos.z);
    this.uniforms.uCam.value.copy(camera.position);

    const WAKE_LIFE = 3.6;
    const slots = this.uniforms.uWake.value;
    for (let i = 0; i < slots.length; i++) {
      const w = this._wake[i];
      if (!w) { slots[i].set(0, 0, 0); continue; }
      const age = 1 - (t - w.born) / WAKE_LIFE;
      slots[i].set(w.x, w.z, Math.max(0, age));
    }
    this._wake = this._wake.filter((w) => t - w.born < WAKE_LIFE);

    if (palette) {
      this.uniforms.uSun.value.copy(palette.sunDir);
      this.uniforms.uSunColor.value.copy(palette.sunColor);
      this.uniforms.uSkyTint.value.copy(palette.zenith);
      this.uniforms.uHorizon.value.copy(palette.horizon);
      this.uniforms.uDeep.value.copy(palette.deep);
      this.uniforms.uShallow.value.copy(palette.shallow);
    }
  }
}

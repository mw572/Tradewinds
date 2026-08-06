// sky.js — sky dome, sun, and the palette everything else is lit by.
//
// A cheap analytic sky rather than full Rayleigh scattering: a three-stop
// vertical gradient with a Mie-ish forward-scatter glow around the sun and a
// warm band along the horizon. It costs one draw call, needs no textures, and
// at sunrise and sunset it does the thing an atmospheric model is actually
// for, which is turning the whole scene orange.
//
// The palette this produces drives the ocean shader, the fog and the lights,
// so the time of day is coherent across the frame instead of being three
// separate guesses.

import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Strip the translation from the view matrix so the dome never moves
    // relative to the camera, and force it to the far plane.
    mat4 rotView = mat4(mat3(modelViewMatrix));
    vec4 pos = projectionMatrix * rotView * vec4(position, 1.0);
    gl_Position = pos.xyww;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uSun;
  uniform vec3  uZenith;
  uniform vec3  uHorizon;
  uniform vec3  uGround;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform float uHaze;
  varying vec3  vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    // Vertical gradient: ground haze below, horizon band, zenith above.
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
    col = mix(col, uGround, smoothstep(0.0, -0.16, h));

    // Horizon glow, strongest toward the sun's bearing.
    float towardSun = clamp(dot(normalize(vec3(d.x, 0.0, d.z)),
                                normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0, 1.0);
    float band = exp(-abs(h) * 9.0);
    col += uSunColor * band * towardSun * uHaze;

    // Forward scatter around the sun, then the disc itself.
    float mu = clamp(dot(d, normalize(uSun)), 0.0, 1.0);
    col += uSunColor * pow(mu, 8.0) * 0.30 * uSunIntensity;
    col += uSunColor * pow(mu, 220.0) * 0.9 * uSunIntensity;
    float disc = smoothstep(0.99965, 0.99988, mu);
    col += uSunColor * disc * 6.0 * uSunIntensity;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/* Keyframed palettes. The sun elevation drives which pair we blend between,
 * so dawn and dusk are the same curve read in opposite directions. */
const KEYS = [
  { at: -0.22, name: "night",   zenith: 0x070d1c, horizon: 0x14203a, ground: 0x060a14, sun: 0x36527a, intensity: 0.10, haze: 0.30, deep: 0x030a16, shallow: 0x0d2438, amb: 0.34 },
  { at: -0.04, name: "twilight",zenith: 0x1b2a4d, horizon: 0x6b4a5a, ground: 0x121a2c, sun: 0xd98a5e, intensity: 0.55, haze: 0.90, deep: 0x05121f, shallow: 0x1a4553, amb: 0.52 },
  { at:  0.06, name: "goldenhour", zenith: 0x2f5f8c, horizon: 0xe8a05c, ground: 0x2a3448, sun: 0xffc07a, intensity: 1.00, haze: 1.25, deep: 0x06243a, shallow: 0x2a7f88, amb: 0.72 },
  { at:  0.26, name: "morning", zenith: 0x3a7fae, horizon: 0xcfd6c8, ground: 0x51606a, sun: 0xfff0cf, intensity: 1.00, haze: 0.62, deep: 0x06283a, shallow: 0x1f8592, amb: 0.90 },
  { at:  0.70, name: "noon",    zenith: 0x2f7fc4, horizon: 0xc3dbe2, ground: 0x64757c, sun: 0xffffff, intensity: 1.00, haze: 0.40, deep: 0x052b46, shallow: 0x1e93a4, amb: 1.00 },
];

const lerpColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Blend the keyframes for a given sun elevation, expressed as sin(altitude). */
export function paletteFor(sunY) {
  let lo = KEYS[0], hi = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (sunY >= KEYS[i].at && sunY <= KEYS[i + 1].at) { lo = KEYS[i]; hi = KEYS[i + 1]; break; }
    if (sunY < KEYS[0].at) { lo = hi = KEYS[0]; break; }
    if (sunY > KEYS[KEYS.length - 1].at) { lo = hi = KEYS[KEYS.length - 1]; break; }
  }
  const span = hi.at - lo.at;
  const t = span > 0 ? THREE.MathUtils.clamp((sunY - lo.at) / span, 0, 1) : 0;
  const smooth = t * t * (3 - 2 * t);
  return {
    name: smooth < 0.5 ? lo.name : hi.name,
    zenith:   lerpColor(lo.zenith, hi.zenith, smooth),
    horizon:  lerpColor(lo.horizon, hi.horizon, smooth),
    ground:   lerpColor(lo.ground, hi.ground, smooth),
    sunColor: lerpColor(lo.sun, hi.sun, smooth),
    deep:     lerpColor(lo.deep, hi.deep, smooth),
    shallow:  lerpColor(lo.shallow, hi.shallow, smooth),
    intensity: lerp(lo.intensity, hi.intensity, smooth),
    haze:      lerp(lo.haze, hi.haze, smooth),
    ambient:   lerp(lo.amb, hi.amb, smooth),
  };
}

export class Sky {
  constructor() {
    this.uniforms = {
      uSun:          { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
      uZenith:       { value: new THREE.Color(0x2f7fc4) },
      uHorizon:      { value: new THREE.Color(0xc3dbe2) },
      uGround:       { value: new THREE.Color(0x64757c) },
      uSunColor:     { value: new THREE.Color(0xffffff) },
      uSunIntensity: { value: 1 },
      uHaze:         { value: 0.5 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
    );
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;

    this.sunDir = new THREE.Vector3();
    this.palette = paletteFor(0.7);
  }

  /**
   * `dayFraction` 0..1 across a 24-hour day; 0.5 is noon. `bearing` in degrees
   * sets which way the sun sits, so successive voyages don't all look alike.
   */
  setTime(dayFraction, bearingDeg = 120) {
    const angle = (dayFraction - 0.25) * Math.PI * 2;   // sunrise at 0.25
    const elev = Math.sin(angle);
    const b = (bearingDeg * Math.PI) / 180;
    const horiz = Math.cos(angle);
    this.sunDir.set(Math.sin(b) * horiz, elev, -Math.cos(b) * horiz).normalize();

    const p = paletteFor(elev);
    this.palette = p;
    this.palette.sunDir = this.sunDir;

    this.uniforms.uSun.value.copy(this.sunDir);
    this.uniforms.uZenith.value.copy(p.zenith);
    this.uniforms.uHorizon.value.copy(p.horizon);
    this.uniforms.uGround.value.copy(p.ground);
    this.uniforms.uSunColor.value.copy(p.sunColor);
    this.uniforms.uSunIntensity.value = p.intensity;
    this.uniforms.uHaze.value = p.haze;
    return p;
  }
}

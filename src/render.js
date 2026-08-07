// render.js — the frame: environment lighting and post-processing.
//
// Two things were doing most of the damage to how this looked, and neither was
// geometry. The scene runs 175k triangles across 284 meshes, which is nothing.
//
// 1. No environment map. Every material is MeshStandardMaterial, which is a PBR
//    model, and PBR without an environment to reflect is physically a black
//    room. Metal came out looking like plastic and paint like poster paint —
//    not because the shapes were wrong but because there was nothing for them
//    to reflect. The fix is to render the game's own sky into a prefiltered
//    radiance map and hand it to the scene. It costs one render at the start of
//    each voyage and nothing per frame.
//
// 2. No post-processing. Bloom on the sun glitter and the lanterns, and an
//    antialias pass, are most of the difference between "a WebGL demo" and
//    "a game", and they are cheap.

import * as THREE from "three";
import { EffectComposer } from "../vendor/pp/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/pp/postprocessing/RenderPass.js";
import { ShaderPass } from "../vendor/pp/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "../vendor/pp/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/pp/postprocessing/OutputPass.js";
import { SSAOPass } from "../vendor/pp/postprocessing/SSAOPass.js";
import { FXAAShader } from "../vendor/pp/shaders/FXAAShader.js";

/* --------------------------------------------------- environment light ---- */

export class SkyEnvironment {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.rt = null;
    this._key = "";
  }

  /**
   * Build a radiance map from the sky dome itself, so the light in the scene
   * and the light in the sky are the same light. Called when the sky changes —
   * at the start of a voyage and when the weather shifts — never per frame.
   */
  update(skyMesh, key) {
    if (key === this._key) return this.rt?.texture ?? null;
    this._key = key;

    const scene = new THREE.Scene();
    // The dome is drawn with depthTest off and a stripped view matrix so it can
    // sit at the far plane in the main scene. For capture it just needs to be a
    // big inside-out sphere around the origin.
    const capture = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 24),
      new THREE.ShaderMaterial({
        uniforms: skyMesh.material.uniforms,
        vertexShader: `
          varying vec3 vDir;
          void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: skyMesh.material.fragmentShader.replace(
          "varying vec3  vDir;", "varying vec3 vDir;"),
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    scene.add(capture);

    if (this.rt) this.rt.dispose();
    this.rt = this.pmrem.fromScene(scene, 0.04, 1, 120);

    capture.geometry.dispose();
    capture.material.dispose();
    return this.rt.texture;
  }

  dispose() {
    if (this.rt) this.rt.dispose();
    this.pmrem.dispose();
  }
}

/* ------------------------------------------------------ post-processing ---- */

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = true;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Ambient occlusion. Subtle: an ocean scene is dominated by sky light, so
    // heavy AO reads as dirt. It earns its place in the rigging and under the
    // quay, which is exactly where the eye looks for contact.
    this.ssao = new SSAOPass(scene, camera, size.x, size.y);
    this.ssao.kernelRadius = 5;
    this.ssao.minDistance = 0.0015;
    this.ssao.maxDistance = 0.08;
    this.ssao.output = SSAOPass.OUTPUT.Default;
    // Off by default. Measured at 44% of the frame, and in a scene lit almost
    // entirely by sky there is very little contact shadow for it to find — it
    // mostly darkens rigging that is already dark. Available for a screenshot.
    this.ssao.enabled = false;
    this.composer.addPass(this.ssao);

    // Bloom, tuned for sun glitter on water and for lanterns after dark rather
    // than for a general glow. A high threshold keeps it off the sails.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.62, 0.86);
    this.composer.addPass(this.bloom);

    // Tone mapping and colour space happen here now rather than in the
    // renderer, because the composer's intermediate buffers are linear.
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);

    this.setSize(size.x, size.y, renderer.getPixelRatio());
  }

  setSize(w, h, pixelRatio = 1) {
    this.composer.setSize(w, h);
    this.ssao.setSize(w, h);
    this.bloom.setSize(w, h);
    this.fxaa.material.uniforms.resolution.value.set(
      1 / (w * pixelRatio), 1 / (h * pixelRatio));
  }

  /** Night wants more bloom: it is all lanterns and lit windows. */
  setNight(night) {
    this.bloom.strength = 0.42 + night * 0.55;
    this.bloom.threshold = 0.86 - night * 0.42;
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
  }
}

/* ------------------------------------------------------------- shadows ---- */

/**
 * Fit the shadow camera to the ship rather than to the harbour.
 *
 * One 1024 map stretched over a 1,500-unit scene gives roughly 1.5 units per
 * texel, which is half the beam of a caravel: the ship's own shadow was
 * effectively a blur. Following the ship with a tight frustum spends the whole
 * map on the thing being looked at, and the harbour picks up the rest from
 * ambient, where nobody misses it.
 */
export function fitShadowToShip(sun, shipPos, sunDir, radius) {
  const cam = sun.shadow.camera;
  cam.left = -radius; cam.right = radius;
  cam.top = radius; cam.bottom = -radius;
  cam.near = 1;
  cam.far = radius * 6;
  sun.position.copy(sunDir).multiplyScalar(radius * 2.6).add(shipPos);
  sun.target.position.copy(shipPos);
  sun.target.updateMatrixWorld();
  cam.updateProjectionMatrix();
}

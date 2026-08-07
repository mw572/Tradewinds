// hydro.js — buoyancy and collision.
//
// The ship used to be placed at a single wave sample and rotated to the surface
// normal at that one point. That is animation, not floating: a 90-unit hull
// pivoting on one probe cannot pitch into a head sea, cannot ride diagonally
// across a swell, and never disagrees with the water.
//
// Instead: sample the wave field at a set of probes distributed over the hull,
// work out how deep each one is, and fit a plane through the wet ones. The
// plane's height gives heave, its gradient gives pitch and roll, and because
// the probes are spread along the length, a wave shorter than the ship lifts
// one end and not the other — which is where the motion comes from.
//
// Collision is the same idea from the other side: the same probes are tested
// against the ground, and the deepest one decides how hard she is pushed off.

import * as THREE from "three";
import { gerstner, waveHeight } from "./ocean.js";

/**
 * Probes over the hull's waterplane. Spread along the length and out to the
 * beam, because both matter: length probes give pitch, beam probes give roll.
 * Eleven is enough to be smooth and cheap enough to run every frame.
 */
export function makeProbes(len, beam) {
  const pts = [];
  for (const u of [-0.46, -0.30, -0.12, 0.06, 0.24, 0.42]) {
    // The hull narrows at the ends, so probes there sit closer to the centreline.
    const spread = 0.5 * beam * (1 - Math.pow(Math.abs(u) * 2.1, 1.8) * 0.72);
    pts.push({ x: 0, z: u * len, w: 1 });
    if (spread > beam * 0.12) {
      pts.push({ x: spread, z: u * len, w: 0.85 });
      pts.push({ x: -spread, z: u * len, w: 0.85 });
    }
  }
  return pts;
}

const _p = new THREE.Vector3();
const _g = { x: 0, y: 0, z: 0 };

/**
 * Sample the sea under a hull and return the attitude it should take.
 *
 * Returns { y, pitch, roll, wetness } where wetness is the fraction of probes
 * actually in the water — under 0.5 she is coming out of the sea over a crest,
 * which is when a hull slams.
 */
export function floatOn(probes, posX, posZ, headingRad, t) {
  const cos = Math.cos(headingRad), sin = Math.sin(headingRad);

  // Least-squares plane through the samples: h = a*localZ + b*localX + c.
  // Solved directly rather than with a matrix library — three unknowns.
  let sw = 0, sx = 0, sz = 0, sh = 0;
  let sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  let wet = 0;

  for (const p of probes) {
    // Probe position in world space, rotated by the ship's heading.
    const wx = posX + p.x * cos - p.z * sin;
    const wz = posZ + p.x * sin + p.z * cos;
    const h = waveHeight(wx, wz, t);
    const w = p.w;
    sw += w; sx += w * p.x; sz += w * p.z; sh += w * h;
    sxx += w * p.x * p.x; szz += w * p.z * p.z; sxz += w * p.x * p.z;
    sxh += w * p.x * h; szh += w * p.z * h;
    if (h > -0.4) wet += w;
  }

  const mx = sx / sw, mz = sz / sw, mh = sh / sw;
  const cxx = sxx - sw * mx * mx;
  const czz = szz - sw * mz * mz;
  const cxz = sxz - sw * mx * mz;
  const cxh = sxh - sw * mx * mh;
  const czh = szh - sw * mz * mh;

  const det = cxx * czz - cxz * cxz;
  let a = 0, b = 0;
  if (Math.abs(det) > 1e-6) {
    b = (cxh * czz - czh * cxz) / det;   // slope across the beam -> roll
    a = (czh * cxx - cxh * cxz) / det;   // slope along the keel  -> pitch
  }

  return {
    y: mh - (a * mz + b * mx),
    pitch: Math.atan(a),
    roll: Math.atan(b),
    wetness: wet / sw,
  };
}

/**
 * The bow wave. A hull pushes water aside, and where it does the surface stands
 * higher — so the bow probe is raised by how fast she is driving. Small, but it
 * is what stops the stem from slicing the sea like a knife through paper.
 */
export function bowRise(speedFrac, len) {
  return speedFrac * speedFrac * len * 0.018;
}

/* --------------------------------------------------------- collision ---- */

/**
 * Test the hull against the ground and return the push needed to clear it.
 *
 * `groundAt` works in the harbour's (along, offshore) frame, so the caller
 * passes the basis it should use. Every probe is tested; the one with the least
 * clearance decides. Returning the worst rather than the average matters — a
 * ship that touches at one point should stop at that point, not sink halfway in
 * because the other ten probes are still in deep water.
 */
export function groundCheck(probes, posX, posZ, headingRad, draft, groundAt, fwd, side) {
  const cos = Math.cos(headingRad), sin = Math.sin(headingRad);
  let worst = Infinity, wx = 0, wz = 0;

  for (const p of probes) {
    const x = posX + p.x * cos - p.z * sin;
    const z = posZ + p.x * sin + p.z * cos;
    const along = x * fwd.x + z * fwd.z;
    const off = x * side.x + z * side.z;
    const clearance = -draft - groundAt(along, off);
    if (clearance < worst) { worst = clearance; wx = x; wz = z; }
  }

  if (worst >= 0) return null;

  // Push down the steepest seaward gradient at the point that touched.
  const e = 6;
  const alongW = wx * fwd.x + wz * fwd.z;
  const offW = wx * side.x + wz * side.z;
  const gA = groundAt(alongW + e, offW) - groundAt(alongW - e, offW);
  const gO = groundAt(alongW, offW + e) - groundAt(alongW, offW - e);

  const dir = new THREE.Vector3(
    -(fwd.x * gA + side.x * gO), 0, -(fwd.z * gA + side.z * gO));
  if (dir.lengthSq() < 1e-6) dir.copy(side).negate();
  dir.normalize();

  return { depth: -worst, dir, x: wx, z: wz };
}

/**
 * Test the hull against an upright box — a quay, a pier, a mole. Returns the
 * shortest push that separates them, or null.
 *
 * Boxes rather than meshes because every solid thing in a harbour is a box, and
 * a swept-hull-against-triangle-soup test would cost more than the whole rest
 * of the frame.
 */
export function boxCheck(probes, posX, posZ, headingRad, box) {
  const cos = Math.cos(headingRad), sin = Math.sin(headingRad);
  const bc = Math.cos(-box.rot), bs = Math.sin(-box.rot);
  let best = null;

  for (const p of probes) {
    const x = posX + p.x * cos - p.z * sin;
    const z = posZ + p.x * sin + p.z * cos;
    // Into the box's own frame.
    const dx = x - box.x, dz = z - box.z;
    const lx = dx * bc - dz * bs;
    const lz = dx * bs + dz * bc;
    const ox = box.hw - Math.abs(lx);
    const oz = box.hl - Math.abs(lz);
    if (ox <= 0 || oz <= 0) continue;               // this probe is outside

    // Push out along whichever axis needs the smaller correction.
    let nlx = 0, nlz = 0, depth;
    if (ox < oz) { nlx = Math.sign(lx) || 1; depth = ox; }
    else { nlz = Math.sign(lz) || 1; depth = oz; }
    if (!best || depth > best.depth) {
      const nx = nlx * bc + nlz * bs;
      const nz = -nlx * bs + nlz * bc;
      best = { depth, dir: new THREE.Vector3(nx, 0, nz).normalize() };
    }
  }
  return best;
}

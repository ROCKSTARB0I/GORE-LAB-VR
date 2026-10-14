// Tiny Verlet physics world: particles, distance constraints, a box room,
// a few static AABBs and sphere colliders. Everything in the lab (ragdolls,
// guns, balls, barrels, gibs) is made of these particles.
import * as THREE from '../vendor/three.module.js';

export const HALF = 8;        // room is 16 x 16 m
export const WALL_H = 5;
export const TICK = 1 / 90;   // real seconds per physics tick

export class Particle {
  constructor(x, y, z, r = 0.05, invMass = 1) {
    this.pos = new THREE.Vector3(x, y, z);
    this.prev = this.pos.clone();
    this.r = r;
    this.invMass = invMass;
    this.pinned = false;
    this.bounce = 0;
    this.body = null;      // particles sharing a body don't collide with each other
    this.detached = false; // ragdoll: no longer driven by the pose
  }
  // add velocity dv (m/s) given the step length h
  push(dv, h) { this.prev.addScaledVector(dv, -h); }
  setVelocity(v, h) { this.prev.copy(this.pos).addScaledVector(v, -h); }
}

export class World {
  constructor() {
    this.particles = [];
    this.sticks = [];
    this.colliders = [];  // particles that bump into every other particle
    this.boxes = [];      // static {min, max}
    this.bodies = [];     // solid ragdoll volumes: {owner, center, caps: [{a, b, r, self}]}
    this.rods = [];       // things with length that must not pass through a body: {a, b, r, body} or {bone, r, body}
    this.gravity = -9.8;
    this.scale = 1;       // time scale (slow-mo)
  }
  get dt() { return TICK * this.scale; }

  add(p) { this.particles.push(p); return p; }
  stick(a, b, opts = {}) {
    const s = { a, b, len: opts.len ?? a.pos.distanceTo(b.pos), min: !!opts.min, body: opts.body ?? null, dead: false };
    this.sticks.push(s);
    return s;
  }
  removeBody(body) {
    this.particles = this.particles.filter(p => p.body !== body);
    this.colliders = this.colliders.filter(p => p.body !== body);
    this.sticks = this.sticks.filter(s => s.body !== body);
    this.bodies = this.bodies.filter(b => b.owner !== body);
    this.rods = this.rods.filter(r => r.body !== body);
  }
  // Verlet stores velocity as (pos - prev), so changing the step means rescaling it.
  setScale(s) {
    const r = s / this.scale;
    for (const p of this.particles) {
      p.prev.set(p.pos.x - (p.pos.x - p.prev.x) * r, p.pos.y - (p.pos.y - p.prev.y) * r, p.pos.z - (p.pos.z - p.prev.z) * r);
    }
    this.scale = s;
  }

  step() {
    const h = this.dt, g = this.gravity * h * h;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const vx = (p.pos.x - p.prev.x) * 0.997, vy = (p.pos.y - p.prev.y) * 0.997, vz = (p.pos.z - p.prev.z) * 0.997;
      p.prev.copy(p.pos);
      p.pos.x += vx; p.pos.y += vy + g; p.pos.z += vz;
    }
    for (let it = 0; it < 6; it++) {
      for (const s of this.sticks) {
        const a = s.a, b = s.b;
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        if (s.min && d >= s.len) continue;
        const wa = a.pinned ? 0 : a.invMass, wb = b.pinned ? 0 : b.invMass, w = wa + wb;
        if (w === 0) continue;
        const k = (d - s.len) / d / w;
        a.pos.x += dx * k * wa; a.pos.y += dy * k * wa; a.pos.z += dz * k * wa;
        b.pos.x -= dx * k * wb; b.pos.y -= dy * k * wb; b.pos.z -= dz * k * wb;
      }
      if (it === 2) { this.collide(); this.collideBodies(); }
    }
    this.collideSpheres();
    this.collideBodies();
    this.collide();
  }

  collide() {
    const FR = 0.05;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const r = p.r, pos = p.pos, prev = p.prev;
      const fr = p.bounce ? 0.01 : FR;
      if (pos.y < r) {
        const vy = pos.y - prev.y;
        pos.y = r;
        prev.y = vy < -0.004 ? r + vy * p.bounce : r;
        prev.x += (pos.x - prev.x) * fr; prev.z += (pos.z - prev.z) * fr;
      }
      const lim = HALF - r;
      if (pos.x > lim) { const v = pos.x - prev.x; pos.x = lim; prev.x = lim + v * p.bounce; }
      else if (pos.x < -lim) { const v = pos.x - prev.x; pos.x = -lim; prev.x = -lim + v * p.bounce; }
      if (pos.z > lim) { const v = pos.z - prev.z; pos.z = lim; prev.z = lim + v * p.bounce; }
      else if (pos.z < -lim) { const v = pos.z - prev.z; pos.z = -lim; prev.z = -lim + v * p.bounce; }
      if (pos.y > WALL_H - r) { pos.y = WALL_H - r; prev.y = pos.y; }

      for (const b of this.boxes) {
        const x1 = pos.x - (b.min.x - r), x2 = (b.max.x + r) - pos.x;
        const y1 = pos.y - (b.min.y - r), y2 = (b.max.y + r) - pos.y;
        const z1 = pos.z - (b.min.z - r), z2 = (b.max.z + r) - pos.z;
        if (x1 <= 0 || x2 <= 0 || y1 <= 0 || y2 <= 0 || z1 <= 0 || z2 <= 0) continue;
        const m = Math.min(x1, x2, y1, y2, z1, z2);
        if (m === y2) {
          const vy = pos.y - prev.y;
          pos.y += y2; prev.y = vy < -0.004 ? pos.y + vy * p.bounce : pos.y;
          prev.x += (pos.x - prev.x) * fr; prev.z += (pos.z - prev.z) * fr;
        }
        else if (m === y1) { pos.y -= y1; prev.y = pos.y; }
        else if (m === x1) { pos.x -= x1; prev.x = pos.x; }
        else if (m === x2) { pos.x += x2; prev.x = pos.x; }
        else if (m === z1) { pos.z -= z1; prev.z = pos.z; }
        else { pos.z += z2; prev.z = pos.z; }
      }
    }
  }

  // Bodies are solid: loose limbs, guts, dropped guns, chunks and other people
  // can't pass through a torso, head, arm or leg. Each body is a handful of
  // capsules (two particles and a radius); anything inside one is pushed out
  // and the capsule is pushed back.
  collideBodies() {
    for (const B of this.bodies) {
      const c = B.center.pos, own = B.owner;
      // each shape's midpoint and half-length, for cheap rejection below
      for (const cap of B.caps) {
        if (cap.dead) continue;
        const ca = cap.bone ? cap.bone.a : cap.a, cb = cap.bone ? cap.bone.b : cap.b;
        cap.mx = (ca.pos.x + cb.pos.x) * 0.5; cap.my = (ca.pos.y + cb.pos.y) * 0.5; cap.mz = (ca.pos.z + cb.pos.z) * 0.5;
        cap.hl = ca === cb ? 0 : ca.pos.distanceTo(cb.pos) * 0.5;
      }
      for (const p of this.particles) {
        if (p.pinned || p.ghost) continue;
        const cx = p.pos.x - c.x, cy = p.pos.y - c.y, cz = p.pos.z - c.z;
        if (cx * cx + cy * cy + cz * cz > 2.4) continue;
        const mine = p.body === own;
        if (mine && p.noSelf) continue;
        for (const cap of B.caps) {
          if (cap.dead || (mine && !cap.self)) continue;
          const far = cap.hl + cap.r + p.r, qx = p.pos.x - cap.mx, qy = p.pos.y - cap.my, qz = p.pos.z - cap.mz;
          if (qx * qx + qy * qy + qz * qz > far * far) continue;
          const a = cap.bone ? cap.bone.a : cap.a, b = cap.bone ? cap.bone.b : cap.b;
          if (p === a || p === b || a.gone) continue;
          const ex = b.pos.x - a.pos.x, ey = b.pos.y - a.pos.y, ez = b.pos.z - a.pos.z;
          const px = p.pos.x - a.pos.x, py = p.pos.y - a.pos.y, pz = p.pos.z - a.pos.z;
          const l2 = ex * ex + ey * ey + ez * ez;
          let t = l2 > 1e-9 ? (px * ex + py * ey + pz * ez) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - ex * t, dy = py - ey * t, dz = pz - ez * t;
          const rr = cap.r + p.r * 0.5, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-10) continue;
          const d = Math.sqrt(d2);
          // Something already resting on the floor can't be pushed further
          // down, so the body on top of it is lifted instead.
          const wp = dy < 0 && p.pos.y <= p.r + 0.004 ? 0 : p.invMass;
          const wa = a.pinned ? 0 : a.invMass * (1 - t), wb = b.pinned ? 0 : b.invMass * t, w = wp + wa + wb;
          if (w === 0) continue;
          const k = (rr - d) / d / w;
          p.pos.x += dx * k * wp; p.pos.y += dy * k * wp; p.pos.z += dz * k * wp;
          a.pos.x -= dx * k * wa; a.pos.y -= dy * k * wa; a.pos.z -= dz * k * wa;
          b.pos.x -= dx * k * wb; b.pos.y -= dy * k * wb; b.pos.z -= dz * k * wb;
          // a little grip so things rest on a body instead of skating off it
          p.prev.x += (p.pos.x - p.prev.x) * 0.08; p.prev.y += (p.pos.y - p.prev.y) * 0.08; p.prev.z += (p.pos.z - p.prev.z) * 0.08;
        }
      }
      // Whole lengths, not just their ends: a forearm, a loop of gut or a gun
      // lying across a chest is stopped anywhere along it.
      for (const R of this.rods) {
        if (R.skip?.()) continue;
        const a = R.bone ? R.bone.a : R.a, b = R.bone ? R.bone.b : R.b;
        if (a.gone || b.gone) continue;
        const cx = a.pos.x - c.x, cy = a.pos.y - c.y, cz = a.pos.z - c.z;
        if (cx * cx + cy * cy + cz * cz > 3.2) continue;
        const mine = R.body === own;
        if (mine && (a.noSelf || b.noSelf)) continue;   // joined to the trunk at that end
        const rmx = (a.pos.x + b.pos.x) * 0.5, rmy = (a.pos.y + b.pos.y) * 0.5, rmz = (a.pos.z + b.pos.z) * 0.5;
        const rhl = Math.sqrt((b.pos.x - a.pos.x) ** 2 + (b.pos.y - a.pos.y) ** 2 + (b.pos.z - a.pos.z) ** 2) * 0.5;
        for (const cap of B.caps) {
          if (cap.dead || (mine && !cap.self)) continue;
          const far = rhl + cap.hl + cap.r + R.r, qx = rmx - cap.mx, qy = rmy - cap.my, qz = rmz - cap.mz;
          if (qx * qx + qy * qy + qz * qz > far * far) continue;
          const ca = cap.bone ? cap.bone.a : cap.a, cb = cap.bone ? cap.bone.b : cap.b;
          if (ca === a || ca === b || cb === a || cb === b || ca.gone) continue;
          const rr = cap.r + R.r, d2 = segSeg(a.pos, b.pos, ca.pos, cb.pos);
          if (d2 >= rr * rr || d2 < 1e-9) continue;
          const s = segSeg.s, t = segSeg.t, d = Math.sqrt(d2);
          const nx = (a.pos.x + (b.pos.x - a.pos.x) * s) - (ca.pos.x + (cb.pos.x - ca.pos.x) * t);
          const ny = (a.pos.y + (b.pos.y - a.pos.y) * s) - (ca.pos.y + (cb.pos.y - ca.pos.y) * t);
          const nz = (a.pos.z + (b.pos.z - a.pos.z) * s) - (ca.pos.z + (cb.pos.z - ca.pos.z) * t);
          const floored = ny < 0 && (a.pos.y <= a.r + 0.004 || b.pos.y <= b.r + 0.004);
          const wa = a.pinned || floored ? 0 : a.invMass * (1 - s), wb = b.pinned || floored ? 0 : b.invMass * s;
          const wca = ca.pinned ? 0 : ca.invMass * (1 - t), wcb = cb.pinned || cb === ca ? 0 : cb.invMass * t;
          const W = wa + wb + wca + wcb;
          if (W === 0) continue;
          const k = (rr - d) / d / W;
          a.pos.x += nx * k * wa; a.pos.y += ny * k * wa; a.pos.z += nz * k * wa;
          b.pos.x += nx * k * wb; b.pos.y += ny * k * wb; b.pos.z += nz * k * wb;
          ca.pos.x -= nx * k * wca; ca.pos.y -= ny * k * wca; ca.pos.z -= nz * k * wca;
          cb.pos.x -= nx * k * wcb; cb.pos.y -= ny * k * wcb; cb.pos.z -= nz * k * wcb;
        }
      }
    }
  }

  collideSpheres() {
    for (const c of this.colliders) {
      for (const p of this.particles) {
        if (p === c || p.body === c.body) continue;
        const dx = p.pos.x - c.pos.x, dy = p.pos.y - c.pos.y, dz = p.pos.z - c.pos.z;
        const rr = p.r + c.r, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-10) continue;
        const wc = c.pinned ? 0 : c.invMass, wp = p.pinned ? 0 : p.invMass, w = wc + wp;
        if (w === 0) continue;
        const d = Math.sqrt(d2), k = (rr - d) / d / w;
        p.pos.x += dx * k * wp; p.pos.y += dy * k * wp; p.pos.z += dz * k * wp;
        c.pos.x -= dx * k * wc; c.pos.y -= dy * k * wc; c.pos.z -= dz * k * wc;
      }
    }
  }
}

// Closest points between segments p1-q1 and p2-q2 (Ericson). Returns the
// squared distance; the parameters land in segSeg.s / segSeg.t.
export function segSeg(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-9, cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = cl(f / e); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = cl(-c / a); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > EPS ? cl((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = cl(-c / a); }
      else if (t > 1) { t = 1; s = cl((b - c) / a); }
    }
  }
  segSeg.s = s; segSeg.t = t;
  const x = rx + d1x * s - d2x * t, y = ry + d1y * s - d2y * t, z = rz + d1z * s - d2z * t;
  return x * x + y * y + z * z;
}

// Test dummies: a 16-particle Verlet ragdoll that is pulled toward a standing /
// walking pose while alive ("active ragdoll"), goes limp when dead, and can
// lose its head and limbs.
import * as THREE from '../vendor/three.module.js';
import { Particle, HALF, segSeg } from './physics.js';

// rest pose, facing +Z
const REST = {
  head: [0, 1.68, 0], neck: [0, 1.5, 0], chest: [0, 1.3, 0.1],
  lSh: [-0.19, 1.45, 0], rSh: [0.19, 1.45, 0],
  pelvis: [0, 0.98, 0], lHip: [-0.1, 0.94, 0], rHip: [0.1, 0.94, 0],
  lElbow: [-0.24, 1.17, 0], lHand: [-0.26, 0.9, 0.03],
  rElbow: [0.24, 1.17, 0], rHand: [0.26, 0.9, 0.03],
  lKnee: [-0.11, 0.52, 0.02], lFoot: [-0.12, 0.07, 0],
  rKnee: [0.11, 0.52, 0.02], rFoot: [0.12, 0.07, 0],
};
const RADIUS = { head: 0.11, neck: 0.07, chest: 0.1, pelvis: 0.1, lFoot: 0.06, rFoot: 0.06 };
const TORSO = ['neck', 'chest', 'lSh', 'rSh', 'pelvis', 'lHip', 'rHip'];
// [name, proximal, distal, radius, hit points, is leg]
const BONES = [
  ['head', 'neck', 'head', 0.12, 2, false],
  ['lUpperArm', 'lSh', 'lElbow', 0.05, 3, false], ['lForearm', 'lElbow', 'lHand', 0.042, 3, false],
  ['rUpperArm', 'rSh', 'rElbow', 0.05, 3, false], ['rForearm', 'rElbow', 'rHand', 0.042, 3, false],
  ['lThigh', 'lHip', 'lKnee', 0.07, 4, true], ['lShin', 'lKnee', 'lFoot', 0.055, 3, true],
  ['rThigh', 'rHip', 'rKnee', 0.07, 4, true], ['rShin', 'rKnee', 'rFoot', 0.055, 3, true],
];
// joint limits: keep these pairs at least this far apart
const LIMITS = [
  ['head', 'chest', 0.3], ['head', 'lSh', 0.24], ['head', 'rSh', 0.24],
  ['lHand', 'lSh', 0.2], ['rHand', 'rSh', 0.2], ['lElbow', 'chest', 0.16], ['rElbow', 'chest', 0.16],
  ['lFoot', 'lHip', 0.35], ['rFoot', 'rHip', 0.35], ['lKnee', 'rKnee', 0.13], ['lFoot', 'rFoot', 0.12],
  ['lKnee', 'chest', 0.3], ['rKnee', 'chest', 0.3],
];

const SHIRTS = [0x3b6fb5, 0xb5483b, 0x3f9b62, 0xc9a227, 0x7a4fb0, 0xd9772b, 0x4aa7b8];
const SKIN = 0xdcb58f, PANTS = 0x2e3b52, GORE_COL = new THREE.Color(0x5e0000);
const UP = new THREE.Vector3(0, 1, 0);
const geoCache = {};
const capsule = (r, len) => geoCache[r + '_' + len.toFixed(2)] ??= new THREE.CapsuleGeometry(r, len, 3, 8);
const headGeo = new THREE.SphereGeometry(0.115, 14, 10);
const eyeGeo = new THREE.SphereGeometry(0.018, 6, 5);
const torsoGeo = new THREE.BoxGeometry(0.4, 0.6, 0.21);
const stumpGeo = new THREE.SphereGeometry(1, 8, 6);
const stumpMat = new THREE.MeshLambertMaterial({ color: 0x8a0606 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), mb = new THREE.Matrix4();

export class Dummy {
  constructor(world, scene, fx, x, z, yaw, opts = {}) {
    this.world = world; this.scene = scene; this.fx = fx;
    this.root = { x, z }; this.yaw = yaw;
    this.alive = true; this.hp = opts.hp ?? 100; this.state = 'stand';
    this.aggro = !!opts.aggro; this.speed = opts.speed ?? 1; this.gone = false;
    this.downT = 0; this.rise = 1; this.stun = 0; this.bleeding = 0; this.headGone = false;
    this.phase = Math.random() * 6; this.moveAmt = 0; this.time = Math.random() * 10;
    this.wanderT = 0; this.wanderYaw = yaw; this.wandering = false;
    this.sliceCd = 0;
    this.onDeath = null;

    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.p = {}; this.all = []; this.sticks = [];
    for (const k in REST) {
      const [rx, ry, rz] = REST[k];
      const p = new Particle(x + rx * c + rz * s, ry, z - rx * s + rz * c, RADIUS[k] ?? 0.05, TORSO.includes(k) ? 0.6 : 1);
      p.body = this; p.name = k;
      this.p[k] = p; this.all.push(p); world.add(p);
    }
    const stick = (a, b, opts) => { const st = world.stick(this.p[a], this.p[b], { ...opts, body: this }); this.sticks.push(st); return st; };
    for (let i = 0; i < TORSO.length; i++) for (let j = i + 1; j < TORSO.length; j++) stick(TORSO[i], TORSO[j]);
    for (const [a, b, len] of LIMITS) stick(a, b, { len, min: true });

    this.group = new THREE.Group(); scene.add(this.group);
    const shirt = opts.shirt ?? SHIRTS[Math.floor(Math.random() * SHIRTS.length)], skin = opts.skin ?? SKIN;
    this.bones = []; this.bone = {};
    for (const [name, a, b, r, hp, leg] of BONES) {
      const st = stick(a, b);
      const bone = { name, a: this.p[a], b: this.p[b], r, hp: hp * (opts.tough ?? 1), leg, stick: st, severed: false, mesh: null };
      if (name !== 'head') {
        const col = leg ? PANTS : (name.includes('Upper') ? shirt : skin);
        bone.mesh = new THREE.Mesh(capsule(r, st.len), new THREE.MeshLambertMaterial({ color: col }));
        this.group.add(bone.mesh);
      }
      this.bones.push(bone); this.bone[name] = bone;
    }
    this.headMesh = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: skin }));
    for (const ex of [-0.042, 0.042]) { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(ex, 0.02, 0.1); this.headMesh.add(e); }
    this.torsoMesh = new THREE.Mesh(torsoGeo, new THREE.MeshLambertMaterial({ color: shirt }));
    this.group.add(this.headMesh, this.torsoMesh);
    this.stumps = [];
    this.sync();
  }

  canStand() { const b = this.bone; return !(b.lThigh.severed || b.rThigh.severed || b.lShin.severed || b.rShin.severed); }

  // one physics tick of "muscles"
  tick(h, player, hostile) {
    this.time += h;
    this.sliceCd -= h;
    if (!this.alive) return;
    if (this.bleeding) { this.hp -= this.bleeding * 6 * h; if (this.hp <= 0) return this.die(); }
    this.stun = Math.max(0, this.stun - h * 1.4);
    const P = this.p;

    if (this.state === 'down') {
      this.downT -= h;
      if (this.downT <= 0) {
        if (this.canStand()) { this.state = 'stand'; this.rise = 0; this.root.x = P.pelvis.pos.x; this.root.z = P.pelvis.pos.z; }
        else this.state = 'crawl';
      }
      return;
    }
    const dx = player.x - P.pelvis.pos.x, dz = player.z - P.pelvis.pos.z, dist = Math.hypot(dx, dz) || 1;
    if (this.state === 'crawl') {
      if (hostile && dist > 0.6) {
        t1.set(dx / dist * 7 * h, 0, dz / dist * 7 * h);
        for (const k of ['chest', 'lHand', 'rHand']) if (!P[k].detached && !P[k].pinned) P[k].push(t1, h);
      }
      return;
    }

    // standing / walking
    this.rise = Math.min(1, this.rise + h * 0.9);
    let speed = 0, want = this.yaw;
    if (hostile) { want = Math.atan2(dx, dz); speed = dist > 0.95 ? 1.15 * this.speed : 0; }
    else {
      this.wanderT -= h;
      if (this.wanderT <= 0) { this.wanderT = 2 + Math.random() * 4; this.wandering = Math.random() < 0.5; this.wanderYaw = Math.random() * Math.PI * 2; }
      if (this.wandering) { want = this.wanderYaw; speed = 0.55; }
    }
    let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, h * 3.5);
    speed *= this.rise * (1 - Math.min(1, this.stun));
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.root.x += s * speed * h; this.root.z += c * speed * h;
    // get shoved around rather than rubber-banding back
    this.root.x += (P.pelvis.pos.x - this.root.x) * 0.03; this.root.z += (P.pelvis.pos.z - this.root.z) * 0.03;
    const lim = HALF - 0.5;
    if (Math.abs(this.root.x) > lim || Math.abs(this.root.z) > lim) { this.wanderYaw += Math.PI; this.wanderT = 3; }
    this.root.x = Math.max(-lim, Math.min(lim, this.root.x)); this.root.z = Math.max(-lim, Math.min(lim, this.root.z));
    this.phase += speed * h * 3.4;
    this.moveAmt += ((speed > 0.05 ? 1 : 0) - this.moveAmt) * Math.min(1, h * 6);

    const sw = Math.sin(this.phase), cw = Math.cos(this.phase), amt = this.moveAmt;
    const k = 0.2 * this.rise * (1 - Math.min(0.92, this.stun));
    const attack = hostile && dist < 1.3;
    for (const name in REST) {
      const p = P[name];
      if (p.detached || p.pinned) continue;
      let [x, y, z] = REST[name];
      switch (name) {
        case 'lFoot': z += sw * 0.24 * amt; y += Math.max(0, cw) * 0.11 * amt; break;
        case 'rFoot': z -= sw * 0.24 * amt; y += Math.max(0, -cw) * 0.11 * amt; break;
        case 'lKnee': z += sw * 0.13 * amt + 0.03; y += Math.max(0, cw) * 0.05 * amt; break;
        case 'rKnee': z -= sw * 0.13 * amt - 0.03; y += Math.max(0, -cw) * 0.05 * amt; break;
        case 'lHand': if (hostile) { x = -0.16; y = 1.36; z = 0.5 + (attack ? Math.sin(this.time * 9) * 0.18 : 0); } else z -= sw * 0.14 * amt; break;
        case 'rHand': if (hostile) { x = 0.16; y = 1.36; z = 0.5 - (attack ? Math.sin(this.time * 9) * 0.18 : 0); } else z += sw * 0.14 * amt; break;
        case 'lElbow': if (hostile) { x = -0.22; y = 1.36; z = 0.24; } break;
        case 'rElbow': if (hostile) { x = 0.22; y = 1.36; z = 0.24; } break;
        case 'head': case 'neck': case 'chest': x += Math.sin(this.time * 1.3) * 0.012; if (hostile) z += 0.05; break;
      }
      const kk = (name.endsWith('Hand') || name.endsWith('Elbow')) ? k * 0.5 : k;
      const ex = (this.root.x + x * c + z * s - p.pos.x) * kk, ey = (y - p.pos.y) * kk, ez = (this.root.z - x * s + z * c - p.pos.z) * kk;
      p.pos.x += ex; p.pos.y += ey; p.pos.z += ez;
      // move prev most of the way too so the pull doesn't turn into a bouncy spring
      p.prev.x += ex * 0.75; p.prev.y += ey * 0.75; p.prev.z += ez * 0.75;
      p.prev.lerp(p.pos, 0.06 * this.rise);
    }
  }

  knockdown(seconds) {
    if (!this.alive || this.state === 'crawl') return;
    this.state = 'down'; this.downT = Math.max(this.downT, seconds);
  }
  die() {
    if (!this.alive) return;
    this.alive = false; this.state = 'dead';
    this.onDeath?.(this);
  }

  // part = a bone, or null for the torso. dv = velocity kick.
  hit(part, dmg, dv, point, opts = {}) {
    const h = this.world.dt, P = this.p;
    this.stun = Math.min(1.5, this.stun + 0.5 * dmg);
    if (!part) {
      for (const k of ['chest', 'pelvis', 'neck']) P[k].push(dv, h * 0.6);
      this.tint(this.torsoMesh);
      this.hp -= 14 * dmg;
    } else {
      part.a.push(dv, h); part.b.push(dv, h);
      part.hp -= dmg;
      this.hp -= (part.name === 'head' ? 60 : 6) * dmg;
      if (part.mesh) this.tint(part.mesh); else this.tint(this.headMesh);
      if (part.name === 'head') {
        if (part.severed || (part.hp <= 0 && opts.explode)) this.explodeHead();
        else if (part.hp <= 0) this.sever(part);
      } else if (part.hp <= 0 && !part.severed) this.sever(part);
    }
    if (this.hp <= 0) this.die();
  }
  // a blade pushed in: big damage, no dismemberment
  stab(part, dv) {
    const h = this.world.dt, P = this.p;
    this.stun = 1.5;
    if (!part) { for (const k of ['chest', 'pelvis']) P[k].push(dv, h); this.tint(this.torsoMesh); this.hp -= 45; }
    else { part.a.push(dv, h); part.b.push(dv, h); this.tint(part.mesh ?? this.headMesh); this.hp -= part.name === 'head' ? 400 : 12; }
    this.bleeding += 0.5;
    if (this.hp <= 0) this.die();
  }
  tint(mesh) { mesh.material.color.lerp(GORE_COL, 0.3); }

  sever(bone) {
    if (bone.severed) return;
    bone.severed = true;
    const a = bone.a, b = bone.b, w = this.world;
    const stub = new Particle(a.pos.x, a.pos.y, a.pos.z, 0.045, 1);
    stub.prev.copy(a.prev); stub.body = this; stub.detached = true; stub.name = 'stub';
    w.add(stub); this.all.push(stub);
    // everything further down the limb comes off with it
    const D = new Set([b]);
    for (let grew = true; grew;) { grew = false; for (const o of this.bones) if (D.has(o.a) && !D.has(o.b)) { D.add(o.b); grew = true; } }
    for (const st of this.sticks) { if (st !== bone.stick && D.has(st.a) !== D.has(st.b)) st.dead = true; }
    bone.stick.a = stub; bone.a = stub;
    for (const q of D) q.detached = true;
    w.sticks = w.sticks.filter(st => !st.dead); this.sticks = this.sticks.filter(st => !st.dead);

    this.addStump(a, bone.r * 1.05); this.addStump(stub, bone.r * 1.05);
    this.fx.emitter(a, 5, 45); this.fx.emitter(stub, 2.5, 30);
    t1.subVectors(b.pos, a.pos).normalize();
    this.fx.spray(a.pos, t1, 24, 3.5, 0.8);
    // pop the limb away a little
    t2.copy(t1).multiplyScalar(1.5).add(t3.set((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2));
    for (const q of D) q.push(t2, w.dt);
    stub.push(t2, w.dt);
    this.bleeding += 1;
    if (bone.name === 'head') this.die();
    else if (bone.leg && this.alive) { this.state = 'down'; this.downT = 1.2; }
  }

  explodeHead() {
    if (this.headGone) return;
    const hb = this.bone.head, head = this.p.head;
    if (!hb.severed) this.sever(hb);
    this.headGone = true; head.gone = true; hb.a.gone = true;
    this.headMesh.visible = false;
    this.fx.gibs(head.pos, 12);
    this.fx.spray(head.pos, UP, 45, 4.5, 1.3);
    const w = this.world;
    w.particles = w.particles.filter(p => p !== head && p !== hb.a);
    w.sticks = w.sticks.filter(st => st !== hb.stick);
    this.all = this.all.filter(p => p !== head && p !== hb.a);
    this.stumps = this.stumps.filter(st => { if (st.p === hb.a) { this.group.remove(st.mesh); return false; } return true; });
  }

  addStump(p, r) {
    const mesh = new THREE.Mesh(stumpGeo, stumpMat);
    mesh.scale.setScalar(r);
    this.group.add(mesh); this.stumps.push({ p, mesh });
  }

  // nearest hit of segment o->end. Returns {s, bone} (bone null = torso) or null
  raycast(o, end) {
    let best = null, bs = 2;
    for (const b of this.bones) {
      if (b.name === 'head') {
        if (this.headGone) continue;
        if (segSeg(o, end, b.b.pos, b.b.pos) < 0.13 * 0.13 && segSeg.s < bs) { bs = segSeg.s; best = b; }
      } else if (segSeg(o, end, b.a.pos, b.b.pos) < (b.r + 0.025) ** 2 && segSeg.s < bs) { bs = segSeg.s; best = b; }
    }
    if (segSeg(o, end, this.p.pelvis.pos, this.p.neck.pos) < 0.17 * 0.17 && segSeg.s < bs) { bs = segSeg.s; best = null; }
    return bs <= 1 ? { s: bs, bone: best } : null;
  }

  sync() {
    const P = this.p;
    for (const b of this.bones) {
      if (!b.mesh) continue;
      b.mesh.position.addVectors(b.a.pos, b.b.pos).multiplyScalar(0.5);
      t1.subVectors(b.b.pos, b.a.pos).normalize();
      b.mesh.quaternion.setFromUnitVectors(UP, t1);
    }
    // torso + head share a frame built from the spine and the shoulders
    t1.subVectors(P.rSh.pos, P.lSh.pos).normalize();
    t2.subVectors(P.neck.pos, P.pelvis.pos).normalize();
    t3.crossVectors(t1, t2).normalize(); t1.crossVectors(t2, t3);
    this.torsoMesh.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
    this.torsoMesh.position.addVectors(P.neck.pos, P.pelvis.pos).multiplyScalar(0.5).addScaledVector(t3, 0.02);
    if (!this.headGone) {
      const hb = this.bone.head;
      t2.subVectors(hb.b.pos, hb.a.pos).normalize();
      t1.crossVectors(t2, t3).normalize(); t3.crossVectors(t1, t2);
      this.headMesh.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      this.headMesh.position.copy(hb.b.pos);
    }
    for (const st of this.stumps) st.mesh.position.copy(st.p.pos);
  }

  dispose() {
    this.scene.remove(this.group); this.gone = true;
    for (const p of this.all) p.gone = true;
    this.p.head.gone = true;
    this.world.removeBody(this);
    for (const b of this.bones) b.mesh?.material.dispose();
    this.headMesh.material.dispose(); this.torsoMesh.material.dispose();
  }
}

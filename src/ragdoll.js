// Test dummies: a 16-particle Verlet ragdoll that is pulled toward a standing /
// walking pose while alive ("active ragdoll"), goes limp when dead, and can
// lose its head and limbs.
import * as THREE from '../vendor/three.module.js';
import { Particle, HALF, segSeg } from './physics.js?v=7';

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
const torsoGeo = new THREE.BoxGeometry(0.4, 0.6, 0.21);
const stumpGeo = new THREE.SphereGeometry(1, 8, 6);
const stumpMat = new THREE.MeshLambertMaterial({ color: 0x8a0606 });

const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), mb = new THREE.Matrix4();
const w1 = new THREE.Vector3(), w2 = new THREE.Vector3(), wn = new THREE.Vector3(), wq = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- faces
// The head is a sphere wrapped in a 256x128 texture; the face sits at x=64
// (the +Z side). One texture per skin / hair / expression, shared by everyone.
const HAIR = [0x2a1b10, 0x5a3a1a, 0xc9a24a, 0x1a1a1a, 0x8a3b1e, 0x6b6b6b];
const css = hex => '#' + hex.toString(16).padStart(6, '0');
const faceCache = {};
function faceTex(skin, hair, expr) {
  const key = skin + '_' + hair + '_' + expr;
  if (faceCache[key]) return faceCache[key];
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'), cx = 64, LINE = 'rgba(45,22,14,.95)', BLOOD = '#8a0303';
  g.fillStyle = css(skin); g.fillRect(0, 0, 256, 128);
  if (expr === 'dead') { g.fillStyle = 'rgba(170,185,200,.4)'; g.fillRect(0, 0, 256, 128); }
  if (hair !== null) {
    g.fillStyle = css(hair);
    g.fillRect(0, 0, 256, 30);                       // top of the head
    g.fillRect(112, 0, 144, 78); g.fillRect(0, 0, 16, 78);   // sides and back
    g.beginPath(); g.ellipse(cx, 30, 50, 9, 0, 0, Math.PI * 2); g.fill();   // fringe
  }
  // ears
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(14, 54, 6, 16); g.fillRect(108, 54, 6, 16);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const eye = (x, open, pupilY = 0) => {
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.ellipse(x, 58, 6.5, 5 * open, 0, 0, Math.PI * 2); g.fill();
    if (pupilY !== null) { g.fillStyle = '#1c1410'; g.beginPath(); g.arc(x, 58 + pupilY, 2.8, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = LINE; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, 58, 6.5, 5 * open, 0, Math.PI, Math.PI * 2); g.stroke();
  };
  const brow = (x, inner, outer) => {   // inner / outer = height offsets at the nose side and the ear side
    const dir = x < cx ? 1 : -1;
    g.strokeStyle = LINE; g.lineWidth = 3; g.beginPath(); g.moveTo(x - dir * 8, 47 + outer); g.lineTo(x + dir * 7, 47 + inner); g.stroke();
  };
  const blood = (x0, y0, x1, y1, w = 2.5) => { g.strokeStyle = BLOOD; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // nose
  g.strokeStyle = 'rgba(45,22,14,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, 62); g.lineTo(cx - 3, 73); g.lineTo(cx + 2, 74); g.stroke();
  const L = cx - 15, R = cx + 15;
  if (expr === 'neutral') {
    eye(L, 1); eye(R, 1); brow(L, 0, 0); brow(R, 0, 0);
    g.strokeStyle = LINE; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx - 9, 86); g.quadraticCurveTo(cx, 89, cx + 9, 86); g.stroke();
  } else if (expr === 'angry') {
    eye(L, 0.75); eye(R, 0.75); brow(L, 5, -3); brow(R, 5, -3);
    g.fillStyle = '#2a0d0a'; g.beginPath(); g.ellipse(cx, 87, 11, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ece6d8'; g.fillRect(cx - 8, 84, 16, 3);
  } else if (expr === 'hurt') {
    g.strokeStyle = LINE; g.lineWidth = 3;
    g.beginPath(); g.moveTo(L - 6, 54); g.lineTo(L + 5, 58); g.lineTo(L - 6, 62); g.stroke();
    g.beginPath(); g.moveTo(R + 6, 54); g.lineTo(R - 5, 58); g.lineTo(R + 6, 62); g.stroke();
    brow(L, -5, 2); brow(R, -5, 2);
    g.fillStyle = '#2a0d0a'; g.beginPath(); g.ellipse(cx, 88, 9, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ece6d8'; g.fillRect(cx - 6, 80, 12, 3);
    g.fillStyle = '#b5484a'; g.beginPath(); g.ellipse(cx, 93, 5, 3, 0, 0, Math.PI * 2); g.fill();
  } else if (expr === 'bleed') {
    eye(L, 0.55, 1.5); eye(R, 0.55, 1.5); brow(L, -5, 1); brow(R, -5, 1);
    g.strokeStyle = LINE; g.lineWidth = 2.5; g.beginPath();
    g.moveTo(cx - 10, 87); g.lineTo(cx - 5, 85); g.lineTo(cx, 88); g.lineTo(cx + 5, 85); g.lineTo(cx + 10, 88); g.stroke();
    blood(cx + 9, 88, cx + 11, 104); blood(cx - 2, 75, cx - 3, 83, 2);
    g.fillStyle = 'rgba(140,200,255,.8)'; g.beginPath(); g.ellipse(cx + 30, 46, 2, 3.5, 0, 0, Math.PI * 2); g.fill();   // sweat
  } else {   // dead
    eye(L, 0.45, null); eye(R, 0.6, null);
    g.fillStyle = '#1c1410'; g.beginPath(); g.arc(L, 56, 2.5, 0, Math.PI); g.fill(); g.beginPath(); g.arc(R + 1, 56, 2.5, 0, Math.PI); g.fill();
    brow(L, 1, 1); brow(R, 1, 1);
    g.fillStyle = '#2a0d0a'; g.beginPath(); g.ellipse(cx, 88, 7, 4.5, 0, 0, Math.PI * 2); g.fill();
    blood(cx - 6, 89, cx - 9, 108, 3); blood(cx + 1, 75, cx + 2, 84, 2); blood(cx - 3, 75, cx - 4, 82, 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return faceCache[key] = t;
}

// ---------------------------------------------------------------- wounds
function decalTex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const decalMat = (map, factor) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor });
const woundGeo = new THREE.PlaneGeometry(1, 1);
// bullet hole: ragged dark red rim, black centre
const holeMat = decalMat(decalTex(g => {
  g.fillStyle = '#6e0505'; g.beginPath();
  for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2, r = 20 + Math.random() * 10; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  g.fill();
  g.fillStyle = '#2b0000'; g.beginPath(); g.arc(32, 32, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#050000'; g.beginPath(); g.arc(32, 32, 10, 0, Math.PI * 2); g.fill();
}), -6);
// stab / slash: a dark slit with raw red edges
const slitMat = decalMat(decalTex(g => {
  g.fillStyle = '#7a0606'; g.beginPath(); g.ellipse(32, 32, 9, 30, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#120000'; g.beginPath(); g.ellipse(32, 32, 4, 26, 0, 0, Math.PI * 2); g.fill();
}), -6);
// blood soaking out around a wound, with a run down from it
const stainMat = decalMat(decalTex(g => {
  const gr = g.createRadialGradient(32, 24, 2, 32, 24, 22);
  gr.addColorStop(0, 'rgba(95,0,0,.95)'); gr.addColorStop(0.6, 'rgba(105,2,2,.8)'); gr.addColorStop(1, 'rgba(110,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(100,0,0,.85)'; g.fillRect(28, 26, 5, 34); g.fillRect(36, 28, 3, 22);
}), -3);
const MAX_WOUNDS = 36;

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
    this.maxHp = this.hp; this.hurtT = 0; this.angry = false; this.expr = ''; this.clutch = null; this.wounds = [];
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
        bone.len = st.len;
        bone.mesh = new THREE.Mesh(capsule(r, st.len), new THREE.MeshLambertMaterial({ color: col }));
        this.group.add(bone.mesh);
      }
      this.bones.push(bone); this.bone[name] = bone;
    }
    this.skin = skin;
    this.hair = opts.hair !== undefined ? opts.hair : HAIR[Math.floor(Math.random() * HAIR.length)];
    this.headMesh = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ map: faceTex(skin, this.hair, 'neutral') }));
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
    this.hurtT -= h; this.angry = hostile;
    const P = this.p;
    // press a hand over the latest wound for a while
    if (this.clutch) {
      const c = this.clutch, hand = P[c.hand], part = c.decal.parent;
      if ((c.t -= h) <= 0 || !part || !part.visible || hand.detached) this.clutch = null;
      else if (!hand.pinned) {
        w1.copy(c.decal.position).applyQuaternion(part.quaternion).add(part.position);
        const k = 0.2, ex = (w1.x - hand.pos.x) * k, ey = (w1.y - hand.pos.y) * k, ez = (w1.z - hand.pos.z) * k;
        hand.pos.x += ex; hand.pos.y += ey; hand.pos.z += ez;
        hand.prev.x += ex * 0.75; hand.prev.y += ey * 0.75; hand.prev.z += ez * 0.75;
      }
    }

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
      if (this.clutch && name === this.clutch.hand) continue;   // that hand is busy
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
      let kk = (name.endsWith('Hand') || name.endsWith('Elbow')) ? k * 0.5 : k;
      if (this.clutch && name === this.clutch.hand.replace('Hand', 'Elbow')) kk *= 0.25;
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
    this.alive = false; this.state = 'dead'; this.clutch = null;
    this.onDeath?.(this);
  }

  // part = a bone, or null for the torso. dv = velocity kick.
  hit(part, dmg, dv, point, opts = {}) {
    const h = this.world.dt, P = this.p;
    this.stun = Math.min(1.5, this.stun + 0.5 * dmg);
    this.hurtT = 1.1;
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
    this.stun = 1.5; this.hurtT = 1.4;
    if (!part) { for (const k of ['chest', 'pelvis']) P[k].push(dv, h); this.tint(this.torsoMesh); this.hp -= 45; }
    else { part.a.push(dv, h); part.b.push(dv, h); this.tint(part.mesh ?? this.headMesh); this.hp -= part.name === 'head' ? 400 : 12; }
    this.bleeding += 0.5;
    if (this.hp <= 0) this.die();
  }
  // Wounds are drawn as decals now; cloth only darkens slightly, and only on
  // limbs, which are too thin to carry a soak stain.
  tint(mesh) { if (mesh !== this.torsoMesh && mesh !== this.headMesh) mesh.material.color.lerp(GORE_COL, 0.1); }

  // Put a wound on a body part where something went in. bone = null for the
  // torso; point / dir are in world space; kind = 'bullet' | 'stab' | 'slash'.
  addWound(bone, point, dir, kind) {
    const head = bone?.name === 'head';
    const mesh = bone ? (head ? this.headMesh : bone.mesh) : this.torsoMesh;
    if (!mesh.visible) return;
    wq.copy(mesh.quaternion).invert();
    const lp = w1.copy(point).sub(mesh.position).applyQuaternion(wq), ld = w2.copy(dir).applyQuaternion(wq);
    let first = null;
    // one decal on the side the hit came from, and for bullets an exit wound opposite
    for (const side of kind === 'bullet' && !head ? [-1, 1] : [-1]) {
      const pos = new THREE.Vector3();
      if (head) { wn.copy(ld).multiplyScalar(side * 0.75).addScaledVector(t1.copy(lp).normalize(), 0.25).normalize(); pos.copy(wn).multiplyScalar(0.1175); }
      else if (bone) {
        wn.set(ld.x * side, 0, ld.z * side);
        if (wn.lengthSq() < 1e-4) wn.set(lp.x, 0, lp.z);
        wn.normalize();
        pos.copy(wn).multiplyScalar(bone.r + 0.002); pos.y = Math.max(-bone.len / 2, Math.min(bone.len / 2, lp.y));
      } else if (Math.abs(ld.z) >= Math.abs(ld.x)) {
        wn.set(0, 0, Math.sign(ld.z * side) || 1);
        pos.set(Math.max(-0.17, Math.min(0.17, lp.x)), Math.max(-0.27, Math.min(0.27, lp.y)), wn.z * 0.107);
      } else {
        wn.set(Math.sign(ld.x * side) || 1, 0, 0);
        pos.set(wn.x * 0.202, Math.max(-0.27, Math.min(0.27, lp.y)), Math.max(-0.08, Math.min(0.08, lp.z)));
      }
      const exit = side === 1;
      const d = new THREE.Mesh(woundGeo, kind === 'bullet' ? holeMat : slitMat);
      d.position.copy(pos); d.quaternion.setFromUnitVectors(Z_AXIS, wn);
      if (kind === 'bullet') d.scale.setScalar(exit ? 0.06 : 0.036);
      else {
        d.scale.set(kind === 'stab' ? 0.022 : 0.02, kind === 'stab' ? 0.06 : 0.16, 1);
        d.rotateZ(kind === 'stab' ? (Math.random() - 0.5) * 1.2 : Math.PI / 2 + (Math.random() - 0.5) * 1.4);
      }
      d.renderOrder = 2;
      mesh.add(d);
      const w = { decal: d, stain: null, born: this.time };
      if (!bone) {
        // blood soaks out through the shirt and runs down from the hole
        const st = new THREE.Mesh(woundGeo, stainMat);
        st.position.copy(pos).addScaledVector(wn, -0.001); st.position.y -= 0.02; st.quaternion.copy(d.quaternion);
        st.scale.setScalar(0.07); st.renderOrder = 1;
        mesh.add(st); w.stain = st;
      }
      this.wounds.push(w); first ??= w;
      if (this.wounds.length > MAX_WOUNDS) { const old = this.wounds.shift(); old.decal.removeFromParent(); old.stain?.removeFromParent(); }
    }
    if (!this.alive) return;
    this.bleeding += kind === 'slash' ? 0.2 : 0.12;
    // grab at it with whichever good hand is nearer
    if (head || this.clutch?.t > 3.5) return;
    let best = null, bd = Infinity;
    for (const s of ['l', 'r']) {
      const up = this.bone[s + 'UpperArm'], fore = this.bone[s + 'Forearm'];
      if (up.severed || fore.severed || bone === up || bone === fore) continue;
      const dd = this.p[s + 'Hand'].pos.distanceToSquared(point);
      if (dd < bd) { bd = dd; best = s + 'Hand'; }
    }
    if (best) this.clutch = { hand: best, decal: first.decal, t: 4.5 + Math.random() * 2 };
  }

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
    const expr = !this.alive ? 'dead' : this.hurtT > 0 ? 'hurt'
      : (this.bleeding > 0 || this.hp < this.maxHp * 0.6) ? 'bleed' : this.angry ? 'angry' : 'neutral';
    if (expr !== this.expr) { this.expr = expr; this.headMesh.material.map = faceTex(this.skin, this.hair, expr); }
    for (const w of this.wounds) {
      if (!w.stain) continue;
      const age = this.time - w.born;
      if (age < 9) { const g = 0.07 + Math.min(0.11, age * 0.014); w.stain.scale.set(g, g * 1.5, 1); }
    }
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

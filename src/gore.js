// Blood droplets, splat decals, bleeding stumps and gib chunks.
import * as THREE from '../vendor/three.module.js';
import { Particle, HALF, WALL_H } from './physics.js?v=6';

const N_DROPS = 600, N_DECALS = 900, N_GIBS = 48;
const BLOOD = new THREE.Color(0x8a0303), SPARK = new THREE.Color(0xffd27a);

// decal orientation per surface: 0 z=-HALF, 1 z=+HALF, 2 x=-HALF, 3 x=+HALF, 4 floor/tabletop
const SURF_Q = [
  new THREE.Quaternion(),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
];

const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Gore {
  constructor(scene, world) {
    this.world = world;
    this.pos = new Float32Array(N_DROPS * 3);
    this.vel = new Float32Array(N_DROPS * 3);
    this.life = new Float32Array(N_DROPS);
    this.size = new Float32Array(N_DROPS);
    this.spark = new Uint8Array(N_DROPS);
    this.next = 0;

    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), N_DROPS);
    this.drops.frustumCulled = false;
    for (let i = 0; i < N_DROPS; i++) { this.drops.setMatrixAt(i, ZERO); this.drops.setColorAt(i, BLOOD); }
    scene.add(this.drops);

    this.decals = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 10),
      new THREE.MeshBasicMaterial({ color: 0x6e0202, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      N_DECALS);
    this.decals.frustumCulled = false;
    for (let i = 0; i < N_DECALS; i++) this.decals.setMatrixAt(i, ZERO);
    this.decalNext = 0;
    scene.add(this.decals);

    this.gibMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x9c1f1f }), N_GIBS);
    this.gibMesh.frustumCulled = false;
    for (let i = 0; i < N_GIBS; i++) this.gibMesh.setMatrixAt(i, ZERO);
    scene.add(this.gibMesh);
    this.gibParts = new Array(N_GIBS).fill(null);
    this.gibNext = 0;
    this.gibBody = {};

    this.emitters = [];
    this.wallH = WALL_H;
  }

  drop(x, y, z, vx, vy, vz, size, spark = false) {
    const i = this.next; this.next = (i + 1) % N_DROPS;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = spark ? 0.35 : 4; this.size[i] = size; this.spark[i] = spark ? 1 : 0;
    this.drops.setColorAt(i, spark ? SPARK : BLOOD);
    this.drops.instanceColor.needsUpdate = true;
  }

  // n droplets from point p, roughly along dir
  spray(p, dir, n, speed, spread = 0.45) {
    for (let i = 0; i < n; i++) {
      const s = speed * (0.3 + Math.random() * 0.9);
      this.drop(p.x, p.y, p.z,
        (dir.x + (Math.random() - 0.5) * 2 * spread) * s,
        (dir.y + (Math.random() - 0.5) * 2 * spread) * s + 0.6,
        (dir.z + (Math.random() - 0.5) * 2 * spread) * s,
        0.012 + Math.random() * 0.022);
    }
  }
  sparks(p, n = 5) {
    for (let i = 0; i < n; i++) {
      this.drop(p.x, p.y, p.z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.012, true);
    }
  }

  // keep bleeding from a physics particle for a while
  emitter(particle, seconds, rate = 40) { this.emitters.push({ p: particle, t: seconds, rate, acc: 0 }); }

  gibs(p, n) {
    const h = this.world.dt;
    for (let i = 0; i < n; i++) {
      const k = this.gibNext; this.gibNext = (k + 1) % N_GIBS;
      const old = this.gibParts[k];
      if (old) this.world.particles.splice(this.world.particles.indexOf(old), 1);
      const g = new Particle(p.x + (Math.random() - 0.5) * 0.1, p.y + (Math.random() - 0.5) * 0.1, p.z + (Math.random() - 0.5) * 0.1, 0.03 + Math.random() * 0.03);
      g.body = this.gibBody; g.bounce = 0.2;
      g.setVelocity(v.set((Math.random() - 0.5) * 7, 1 + Math.random() * 5, (Math.random() - 0.5) * 7), h);
      g.spin = Math.random() * 6;
      this.world.add(g);
      this.gibParts[k] = g;
      this.emitter(g, 1.2, 25);
    }
  }

  decal(x, y, z, surf, size) {
    const i = this.decalNext; this.decalNext = (i + 1) % N_DECALS;
    const wall = surf < 4;
    sc.set(size * (0.7 + Math.random() * 0.6), size * (wall ? 1.2 + Math.random() * 2.2 : 0.7 + Math.random() * 0.6), 1);
    q.copy(SURF_Q[surf]);
    m4.compose(v.set(x, y, z), q, sc);
    this.decals.setMatrixAt(i, m4);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  update(h) {
    const g = this.world.gravity * h, lim = HALF - 0.006;
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.t -= h;
      if (e.t <= 0 || e.p.gone) { this.emitters.splice(k, 1); continue; }
      e.acc += e.rate * h;
      while (e.acc >= 1) {
        e.acc -= 1;
        const p = e.p;
        this.drop(p.pos.x, p.pos.y, p.pos.z,
          (p.pos.x - p.prev.x) / h * 0.5 + (Math.random() - 0.5) * 1.6,
          (p.pos.y - p.prev.y) / h * 0.5 + Math.random() * 1.8,
          (p.pos.z - p.prev.z) / h * 0.5 + (Math.random() - 0.5) * 1.6,
          0.012 + Math.random() * 0.02);
      }
    }
    const P = this.pos, V = this.vel;
    for (let i = 0; i < N_DROPS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= h;
      const a = i * 3;
      V[a + 1] += g;
      P[a] += V[a] * h; P[a + 1] += V[a + 1] * h; P[a + 2] += V[a + 2] * h;
      let surf = -1;
      if (P[a + 1] <= 0.006) { P[a + 1] = 0.006; surf = 4; }
      else if (P[a + 2] < -lim) { P[a + 2] = -lim; surf = 0; }
      else if (P[a + 2] > lim) { P[a + 2] = lim; surf = 1; }
      else if (P[a] < -lim) { P[a] = -lim; surf = 2; }
      else if (P[a] > lim) { P[a] = lim; surf = 3; }
      else if (P[a + 1] > WALL_H) surf = 5;
      else {
        for (const b of this.world.boxes) {
          if (V[a + 1] < 0 && P[a] > b.min.x && P[a] < b.max.x && P[a + 2] > b.min.z && P[a + 2] < b.max.z && P[a + 1] < b.max.y + 0.006 && P[a + 1] > b.min.y) {
            P[a + 1] = b.max.y + 0.006; surf = 4;
          }
        }
      }
      if (surf >= 0 || this.life[i] <= 0) {
        if (surf >= 0 && surf < 5 && !this.spark[i] && (surf === 4 || P[a + 1] < this.wallH)) this.decal(P[a], P[a + 1], P[a + 2], surf, this.size[i] * (2.5 + Math.random() * 4));
        this.life[i] = 0;
      }
    }
  }

  sync(time) {
    const P = this.pos;
    for (let i = 0; i < N_DROPS; i++) {
      if (this.life[i] <= 0) { this.drops.setMatrixAt(i, ZERO); continue; }
      const s = this.size[i];
      m4.makeScale(s, s, s).setPosition(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      this.drops.setMatrixAt(i, m4);
    }
    this.drops.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < N_GIBS; i++) {
      const g = this.gibParts[i];
      if (!g) continue;
      q.setFromAxisAngle(v.set(0.5, 0.7, 0.3).normalize(), g.spin + g.pos.x * 4 + g.pos.z * 4);
      sc.setScalar(g.r * 1.8);
      m4.compose(g.pos, q, sc);
      this.gibMesh.setMatrixAt(i, m4);
    }
    this.gibMesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.emitters.length = 0;
    for (let i = 0; i < N_DECALS; i++) this.decals.setMatrixAt(i, ZERO);
    this.decals.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < N_GIBS; i++) {
      const g = this.gibParts[i];
      if (g) { g.gone = true; this.gibMesh.setMatrixAt(i, ZERO); }
      this.gibParts[i] = null;
    }
    this.world.removeBody(this.gibBody);
  }
}

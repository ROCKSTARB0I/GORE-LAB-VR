// Explosions: a flash of light, a fireball of expanding flame puffs, a column of
// smoke that rolls up and hangs about, dust and a shock ring along the ground,
// glowing embers, tumbling debris and a scorch mark left on the floor.
import * as THREE from '../vendor/three.module.js';

const rand = (a, b) => a + Math.random() * (b - a);

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// lumpy blob: several overlapping soft circles, so puffs aren't perfect discs
function blob(g, S, stops, lumps = 9) {
  for (let i = 0; i < lumps; i++) {
    const a = Math.random() * Math.PI * 2, r = i ? S * rand(0.08, 0.2) : 0;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r, rad = S * (i ? rand(0.2, 0.3) : 0.36);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
}
// dense flame (drawn normally, so it shows against bright walls) and a soft glow on top
const FIRE = [0, 1, 2].map(() => canvasTex(128, (g, S) => {
  blob(g, S, [[0, 'rgba(255,240,190,0.95)'], [0.3, 'rgba(255,170,55,0.9)'], [0.62, 'rgba(215,70,12,0.7)'], [0.85, 'rgba(90,25,5,0.3)'], [1, 'rgba(40,10,0,0)']], 10);
}));
const GLOW = canvasTex(128, (g, S) => {
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,180,80,0.6)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
const SMOKE = [0, 1, 2].map(() => canvasTex(128, (g, S) => {
  blob(g, S, [[0, 'rgba(255,255,255,0.5)'], [0.55, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']], 12);
  // grain so it reads as smoke, not fog
  const d = g.getImageData(0, 0, S, S);
  for (let i = 0; i < d.data.length; i += 4) { const k = 0.75 + Math.random() * 0.25; d.data[i] *= k; d.data[i + 1] *= k; d.data[i + 2] *= k; }
  g.putImageData(d, 0, 0);
}));
const RING = canvasTex(128, (g, S) => {
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.72, 'rgba(255,255,255,0)'); gr.addColorStop(0.88, 'rgba(255,235,210,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
const SCORCH = canvasTex(256, (g, S) => {
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(8,6,5,0.95)'); gr.addColorStop(0.45, 'rgba(15,11,9,0.8)'); gr.addColorStop(0.8, 'rgba(30,22,16,0.35)'); gr.addColorStop(1, 'rgba(30,22,16,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  // blast streaks radiating out
  g.strokeStyle = 'rgba(10,8,6,0.35)';
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r0 = S * rand(0.15, 0.3), r1 = S * rand(0.35, 0.5);
    g.lineWidth = rand(1, 5); g.beginPath(); g.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0); g.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1); g.stroke();
  }
});

const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const chunkGeo = new THREE.BoxGeometry(1, 1, 1);
const emberGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D(), col = new THREE.Color();
const FIRE_HOT = new THREE.Color(1, 0.95, 0.8), FIRE_COOL = new THREE.Color(0.9, 0.28, 0.06);
const SMOKE_DARK = new THREE.Color(0.12, 0.11, 0.1), SMOKE_LIGHT = new THREE.Color(0.38, 0.36, 0.34);

export class Explosions {
  constructor(scene) {
    this.scene = scene; this.list = []; this.scorches = [];
    // one light, reused, so adding explosions never makes the renderer rebuild shaders
    this.light = new THREE.PointLight(0xffa040, 0, 14, 2); this.light.position.set(0, -50, 0);
    scene.add(this.light); this.flash = 0;
  }

  // c: centre, R: blast radius, floorY: the ground under it
  spawn(c, R = 5, floorY = 0) {
    const k = R / 5, e = { t: 0, sprites: [], parts: [], c: c.clone() };
    const sprite = (tex, blending, color, opacity) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending, color, transparent: true, depthWrite: false, opacity, rotation: Math.random() * 6.28 }));
      this.scene.add(m); return m;
    };
    // the fireball: puffs flung out from the centre, swelling as they cool
    for (let i = 0; i < 18; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize();
      const s = sprite(FIRE[i % 3], THREE.NormalBlending, FIRE_HOT, 1);
      s.position.copy(c).addScaledVector(d, rand(0, 0.35) * k);
      e.sprites.push({ s, kind: 'fire', v: d.multiplyScalar(rand(2.5, 6.5) * k), life: rand(0.55, 1.0), size0: rand(0.9, 1.4) * k, size1: rand(2.4, 3.4) * k, spin: rand(-2, 2) });
    }
    // white-hot glow over the first instant, then the fireball's own glow
    for (const [life, a, b] of [[0.14, 3.5, 5], [0.6, 2.5, 4]]) {
      e.sprites.push({ s: sprite(GLOW, THREE.AdditiveBlending, FIRE_HOT, 1), kind: 'core', v: new THREE.Vector3(0, 1.5 * k, 0), life, size0: a * k, size1: b * k, spin: 0 });
      e.sprites.at(-1).s.position.copy(c);
    }
    // smoke rolls up out of it and hangs about
    for (let i = 0; i < 16; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize();
      const s = sprite(SMOKE[i % 3], THREE.NormalBlending, SMOKE_DARK.clone(), 0);
      s.position.copy(c).addScaledVector(d, rand(0.1, 0.6) * k);
      e.sprites.push({ s, kind: 'smoke', delay: rand(0.04, 0.3), v: d.multiplyScalar(rand(1, 3) * k).add(new THREE.Vector3(0, rand(0.8, 1.6), 0)), life: rand(3, 5.5), size0: rand(0.8, 1.2) * k, size1: rand(3, 4.5) * k, spin: rand(-0.4, 0.4) });
    }
    const low = c.y - floorY < 2.2 * k;
    if (low) {
      // dust kicked out along the ground
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + rand(-0.2, 0.2), s = sprite(SMOKE[i % 3], THREE.NormalBlending, new THREE.Color(0.42, 0.37, 0.31), 0);
        s.position.set(c.x, floorY + 0.25, c.z);
        e.sprites.push({ s, kind: 'dust', delay: 0.02, v: new THREE.Vector3(Math.cos(a), 0.05, Math.sin(a)).multiplyScalar(rand(5, 8) * k), life: rand(1.2, 2), size0: 0.5 * k, size1: rand(1.8, 2.6) * k, spin: rand(-0.5, 0.5) });
      }
      // shock ring racing out across the floor
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: RING, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.set(c.x, floorY + 0.03, c.z); this.scene.add(ring);
      e.ring = { m: ring, R: R * 1.6 };
      this.scorch(c, floorY, k);
    }
    // embers: glowing bits on arcs
    const NE = 30, embers = new THREE.InstancedMesh(emberGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), NE);
    embers.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(embers);
    // debris: dark chunks of whatever was there
    const ND = 12, debris = new THREE.InstancedMesh(chunkGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), ND);
    debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(debris);
    for (let i = 0; i < NE; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize();
      e.parts.push({ mesh: embers, i, p: c.clone(), v: d.multiplyScalar(rand(4, 12) * k), life: rand(0.7, 1.8), size: rand(0.012, 0.025), ember: true, rot: new THREE.Euler() });
      embers.setColorAt(i, col.setHSL(rand(0.04, 0.11), 1, rand(0.55, 0.7)));
    }
    for (let i = 0; i < ND; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0.3, 1.3), rand(-1, 1)).normalize();
      e.parts.push({ mesh: debris, i, p: c.clone(), v: d.multiplyScalar(rand(3, 9) * k), life: rand(3, 4.5), size: rand(0.03, 0.08), ember: false,
        rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), floorY });
      debris.setColorAt(i, col.setHSL(rand(0.05, 0.1), rand(0.1, 0.3), rand(0.08, 0.2)));
    }
    e.embers = embers; e.debris = debris;
    this.light.position.copy(c); this.flash = Math.max(this.flash, 1) * 1; this.flashK = k;
    this.list.push(e);
  }

  // a burnt patch left on the floor
  scorch(c, floorY, k) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: SCORCH, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(c.x, floorY + 0.008 + this.scorches.length * 0.0005, c.z); m.rotation.y = Math.random() * 6.28;
    m.scale.setScalar(rand(2.2, 2.8) * k); m.renderOrder = 1;
    this.scene.add(m); this.scorches.push(m);
    if (this.scorches.length > 14) { const o = this.scorches.shift(); this.scene.remove(o); o.material.dispose(); }
  }

  update(dt) {
    // the flash lights up the room for a moment
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 0.35);
      this.light.intensity = 60 * (this.flashK ?? 1) * this.flash * this.flash * (0.85 + Math.random() * 0.3);
    } else this.light.intensity = 0;
    for (let n = this.list.length - 1; n >= 0; n--) {
      const e = this.list[n]; e.t += dt;
      let alive = false;
      for (const p of e.sprites) {
        const s = p.s, m = s.material;
        if (p.done) continue;
        const t = e.t - (p.delay ?? 0);
        if (t < 0) continue;
        const u = t / p.life;
        if (u >= 1) { p.done = true; this.scene.remove(s); m.dispose(); continue; }
        alive = true;
        s.position.addScaledVector(p.v, dt);
        // air drag; smoke rises as it cools
        p.v.multiplyScalar(Math.exp(-dt * (p.kind === 'smoke' ? 1.6 : p.kind === 'dust' ? 2.5 : 3.5)));
        if (p.kind === 'smoke') p.v.y += dt * 0.6;
        if (p.kind === 'fire') p.v.y += dt * 2.5;
        const ease = 1 - (1 - u) ** 3;
        s.scale.setScalar(p.size0 + (p.size1 - p.size0) * ease);
        m.rotation += p.spin * dt;
        if (p.kind === 'fire') {
          // white-yellow, through orange, to a sooty red that the smoke swallows
          m.color.copy(FIRE_HOT).lerp(FIRE_COOL, Math.min(1, u * 1.5)).multiplyScalar(u > 0.55 ? 1 - (u - 0.55) * 1.2 : 1);
          m.opacity = u < 0.6 ? 1 : (1 - u) / 0.4;
        } else if (p.kind === 'core') {
          m.color.copy(FIRE_HOT).lerp(FIRE_COOL, u);
          m.opacity = (1 - u) ** 1.5 * 0.9;
        } else if (p.kind === 'smoke') {
          m.color.copy(SMOKE_DARK).lerp(SMOKE_LIGHT, u);
          m.opacity = Math.min(1, t / 0.25) * 0.85 * (1 - u) ** 1.2;
        } else m.opacity = Math.min(1, t / 0.1) * 0.55 * (1 - u) ** 1.5;
      }
      if (e.ring) {
        const u = Math.min(1, e.t / 0.32), m = e.ring.m;
        m.scale.setScalar(0.4 + e.ring.R * 2 * (1 - (1 - u) ** 2));
        m.material.opacity = (1 - u) * 0.6;
        if (u >= 1) { this.scene.remove(m); m.material.dispose(); e.ring = null; } else alive = true;
      }
      for (const p of e.parts) {
        const t = e.t, u = t / p.life;
        if (u >= 1) { dummy.scale.setScalar(0); dummy.updateMatrix(); p.mesh.setMatrixAt(p.i, dummy.matrix); continue; }
        alive = true;
        p.v.y -= 9.8 * dt * (p.ember ? 0.55 : 1);
        p.v.multiplyScalar(Math.exp(-dt * (p.ember ? 1.2 : 0.3)));
        p.p.addScaledVector(p.v, dt);
        if (!p.ember) {
          // chunks bounce and skid on the floor
          const fy = p.floorY + p.size / 2;
          if (p.p.y < fy) { p.p.y = fy; if (p.v.y < 0) p.v.y *= -0.3; p.v.x *= 0.6; p.v.z *= 0.6; p.spin.multiplyScalar(0.6); }
          p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
        }
        dummy.position.copy(p.p); dummy.rotation.copy(p.rot);
        const shrink = p.ember ? 1 - u : u > 0.8 ? (1 - u) / 0.2 : 1;
        dummy.scale.set(p.size * shrink, p.size * shrink, p.size * shrink * (p.ember ? 2.5 : 0.7));
        if (p.ember) dummy.lookAt(dummy.position.x + p.v.x, dummy.position.y + p.v.y, dummy.position.z + p.v.z);   // streak along their path
        dummy.updateMatrix(); p.mesh.setMatrixAt(p.i, dummy.matrix);
      }
      e.embers.instanceMatrix.needsUpdate = true; e.debris.instanceMatrix.needsUpdate = true;
      if (!alive) this._remove(e, n);
    }
  }

  _remove(e, n) {
    for (const p of e.sprites) if (!p.done) { this.scene.remove(p.s); p.s.material.dispose(); }
    if (e.ring) { this.scene.remove(e.ring.m); e.ring.m.material.dispose(); }
    for (const m of [e.embers, e.debris]) { this.scene.remove(m); m.material.dispose(); m.dispose(); }
    this.list.splice(n, 1);
  }

  // everything, scorch marks included (CLEAR ALL, map change)
  clear() {
    for (let n = this.list.length - 1; n >= 0; n--) this._remove(this.list[n], n);
    for (const m of this.scorches) { this.scene.remove(m); m.material.dispose(); }
    this.scorches.length = 0; this.flash = 0; this.light.intensity = 0;
  }
}

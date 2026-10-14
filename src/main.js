import * as THREE from '../vendor/three.module.js';
import { World, Particle, HALF, WALL_H, TICK, segSeg } from './physics.js?v=11';
import { Dummy } from './ragdoll.js?v=11';
import { Gore } from './gore.js?v=11';
import { sfx, music } from './audio.js?v=11';

const V3 = THREE.Vector3;
const NEG_Z = new V3(0, 0, -1), UP = new V3(0, 1, 0);
const $ = id => document.getElementById(id);

// ------------------------------------------------------------ renderer / scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20242b);
const rig = new THREE.Group(); scene.add(rig);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
camera.rotation.order = 'YXZ';
camera.position.set(0, 1.65, 0);
rig.add(camera);
rig.position.set(0, 0, 1.5);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.4); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 8, 5); scene.add(sun);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------ maps
// Every map shares the same 16 x 16 m play space; they differ in looks,
// lighting and the solid boxes (crates etc.) standing in it.
function tiled(tex, rx, ry) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(rx, ry); return tex; }
function noiseTex(base, spread, extra) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor(Math.random() * spread);
      g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${v / 255})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    extra?.(g, w, h);
  });
}
function addFloor(g, mat) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), mat);
  floor.rotation.x = -Math.PI / 2; g.add(floor);
}
function addWalls(g, height, mat, stripe) {
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, height), mat);
    wall.position.set(-Math.sin(a) * HALF, height / 2, -Math.cos(a) * HALF); wall.rotation.y = a; g.add(wall);
    if (stripe) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 0.12), stripe);
      st.position.set(-Math.sin(a) * (HALF - 0.01), 0.06, -Math.cos(a) * (HALF - 0.01)); st.rotation.y = a; g.add(st);
    }
  }
}
// solid box you can't walk or shoot through; returns its collision AABB
function addBlock(g, boxes, mat, x, y, z, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z); g.add(m);
  boxes.push({ min: new V3(x - w / 2, y, z - d / 2), max: new V3(x + w / 2, y + h, z + d / 2) });
}

const MAPS = {
  lab: {
    name: 'Lab', bg: 0x20242b, hemi: [0xffffff, 0x8a8f99, 2.4], sun: [0xffffff, 1.4], wallH: WALL_H,
    build(g) {
      const tile = tiled(canvasTex(256, 256, (c, w, h) => {
        c.fillStyle = '#c9cdd3'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#9aa0a8'; c.lineWidth = 4; c.strokeRect(0, 0, w, h);
        c.strokeStyle = '#b7bcc3'; c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
      }), HALF, HALF);
      addFloor(g, new THREE.MeshLambertMaterial({ map: tile }));
      const wallTex = tiled(canvasTex(256, 256, (c, w, h) => {
        c.fillStyle = '#e6e9ed'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#cfd4da'; c.lineWidth = 3; c.strokeRect(0, 0, w, h);
      }), HALF, WALL_H / 2);
      addWalls(g, WALL_H, new THREE.MeshLambertMaterial({ map: wallTex }), new THREE.MeshBasicMaterial({ color: 0xe8792b }));
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshLambertMaterial({ color: 0x8d939c }));
      ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; g.add(ceil);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (const x of [-4, 4]) for (const z of [-4, 4]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.5), lampMat);
        lamp.position.set(x, WALL_H - 0.03, z); g.add(lamp);
      }
    },
  },
  warehouse: {
    name: 'Warehouse', bg: 0x0c0d10, hemi: [0xffe6c4, 0x3a3a36, 1.5], sun: [0xffd9a0, 0.9], wallH: WALL_H,
    build(g, boxes) {
      const floorTex = tiled(noiseTex('#6f706c', 26, (c, w, h) => {
        c.strokeStyle = 'rgba(40,40,40,.5)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h);
      }), HALF / 2, HALF / 2);
      addFloor(g, new THREE.MeshLambertMaterial({ map: floorTex }));
      const wallTex = tiled(canvasTex(128, 128, (c, w, h) => {
        for (let x = 0; x < w; x += 16) { const gr = c.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#2f4a4d'); gr.addColorStop(0.5, '#4d6f72'); gr.addColorStop(1, '#2a4245'); c.fillStyle = gr; c.fillRect(x, 0, 16, h); }
        c.fillStyle = 'rgba(120,60,20,.25)'; c.fillRect(0, h - 22, w, 22);
      }), HALF * 2, 1);
      addWalls(g, WALL_H, new THREE.MeshLambertMaterial({ map: wallTex }), new THREE.MeshBasicMaterial({ color: 0xd9b000 }));
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshLambertMaterial({ color: 0x24262a }));
      ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; g.add(ceil);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), rodMat = new THREE.MeshLambertMaterial({ color: 0x18191c });
      for (const x of [-4.5, 0, 4.5]) for (const z of [-4.5, 2.5]) {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 0.25, 12), lampMat); lamp.position.set(x, WALL_H - 1, z); g.add(lamp);
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.03), rodMat); rod.position.set(x, WALL_H - 0.45, z); g.add(rod);
      }
      const crate = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = '#9a6a35'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#5e3d1b'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
        c.lineWidth = 8; c.beginPath(); c.moveTo(8, 8); c.lineTo(w - 8, h - 8); c.stroke();
        c.strokeStyle = 'rgba(60,35,10,.35)'; c.lineWidth = 2; for (let y = 24; y < h; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      }) });
      for (const [x, z, sz, n] of [[3.6, -2.6, 1.1, 2], [4.8, -2.6, 1.1, 1], [-5.5, -6.2, 1.3, 1], [5.8, 3.4, 1.0, 2], [-5.2, 4.8, 1.1, 1], [0.8, -7.1, 1.2, 1], [-6.6, -1, 1.0, 1], [2.2, 5.8, 1.2, 1]]) {
        for (let i = 0; i < n; i++) addBlock(g, boxes, crate, x, i * sz, z, sz, sz, sz);
      }
      const shelf = new THREE.MeshLambertMaterial({ color: 0x8a3b1e });
      addBlock(g, boxes, shelf, 7.3, 0, -5, 1.0, 2.6, 4);
    },
  },
  rooftop: {
    name: 'Rooftop', bg: 0x070914, hemi: [0x9fb0ff, 0x1c1e2c, 1.25], sun: [0xbfd0ff, 0.9], wallH: 1.1,
    build(g, boxes) {
      addFloor(g, new THREE.MeshLambertMaterial({ map: tiled(noiseTex('#3a3d44', 30), HALF / 2, HALF / 2) }));
      addWalls(g, 1.1, new THREE.MeshLambertMaterial({ color: 0x70747c }), new THREE.MeshBasicMaterial({ color: 0xff3df2 }));
      const cap = new THREE.MeshLambertMaterial({ color: 0x8a8f98 });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, m = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.4, 0.08, 0.4), cap);
        m.position.set(-Math.sin(a) * (HALF + 0.1), 1.12, -Math.cos(a) * (HALF + 0.1)); m.rotation.y = a; g.add(m);
      }
      // city around and below
      const winTex = canvasTex(64, 128, (c, w, h) => {
        c.fillStyle = '#0b0d16'; c.fillRect(0, 0, w, h);
        for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) if (Math.random() < 0.4) { c.fillStyle = Math.random() < 0.8 ? '#ffd98a' : '#8ad1ff'; c.fillRect(x, y, 4, 5); }
      });
      const tower = new THREE.MeshBasicMaterial({ map: winTex });
      for (let i = 0; i < 34; i++) {
        const a = i / 34 * Math.PI * 2 + Math.random() * 0.1, r = 22 + Math.random() * 30, w = 5 + Math.random() * 7, top = -8 + Math.random() * 30;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 60, w), tower);
        m.position.set(Math.sin(a) * r, top - 30, Math.cos(a) * r); g.add(m);
      }
      const street = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x05060c }));
      street.rotation.x = -Math.PI / 2; street.position.y = -40; g.add(street);
      const starPos = [];
      for (let i = 0; i < 500; i++) { const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.35; starPos.push(Math.cos(a) * Math.cos(e) * 90, Math.sin(e) * 90, Math.sin(a) * Math.cos(e) * 90); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
      g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true })));
      const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf2f0e0 }));
      moon.position.set(30, 55, -60); g.add(moon);
      const metal = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
      addBlock(g, boxes, metal, 4.5, 0, -4.5, 1.8, 1.2, 1.2);
      addBlock(g, boxes, metal, -5.5, 0, 4.5, 1.2, 1.4, 1.8);
      addBlock(g, boxes, new THREE.MeshLambertMaterial({ color: 0x5c6068 }), 5.5, 0, 5, 2.4, 2.5, 2.4);
    },
  },
  backyard: {
    name: 'Backyard', bg: 0x8ec9f0, hemi: [0xffffff, 0x7fa860, 2.3], sun: [0xfff3d0, 1.9], wallH: 1.8,
    build(g, boxes) {
      addFloor(g, new THREE.MeshLambertMaterial({ map: tiled(noiseTex('#5f9a45', 34), HALF, HALF) }));
      const fence = tiled(canvasTex(128, 128, (c, w, h) => {
        for (let x = 0; x < w; x += 32) { c.fillStyle = x % 64 ? '#a9773f' : '#b98448'; c.fillRect(x, 0, 30, h); c.fillStyle = '#6b4a25'; c.fillRect(x + 30, 0, 2, h); }
        c.fillStyle = 'rgba(70,45,20,.5)'; c.fillRect(0, 24, w, 6); c.fillRect(0, 96, w, 6);
      }), HALF, 1);
      addWalls(g, 1.8, new THREE.MeshLambertMaterial({ map: fence }));
      const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24), new THREE.MeshLambertMaterial({ color: 0x6aa64e }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; g.add(ground);
      const trunk = new THREE.MeshLambertMaterial({ color: 0x6b4a2a }), leaf = new THREE.MeshLambertMaterial({ color: 0x3d7f3a });
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2 + 0.2, r = 13 + Math.random() * 9, hgt = 3 + Math.random() * 3;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, hgt, 8), trunk); t.position.set(Math.sin(a) * r, hgt / 2, Math.cos(a) * r); g.add(t);
        const l = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 + Math.random() * 1.2, 1), leaf); l.position.set(Math.sin(a) * r, hgt + 1.2, Math.cos(a) * r); g.add(l);
      }
      const cloud = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (let i = 0; i < 9; i++) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 5, 10, 8), cloud);
        c.scale.y = 0.3; c.position.set((Math.random() - 0.5) * 140, 32 + Math.random() * 12, (Math.random() - 0.5) * 140); g.add(c);
      }
      const sunBall = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
      sunBall.position.set(40, 70, 30); g.add(sunBall);
      addBlock(g, boxes, new THREE.MeshLambertMaterial({ color: 0x9c4a2e }), 5.8, 0, -5.8, 2.6, 2.3, 2.6);   // shed
      addBlock(g, boxes, new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }), -5.5, 0, 5.5, 2.0, 0.45, 1.0);  // bench
    },
  },
};
const MAP_KEYS = Object.keys(MAPS);
let mapGroup = null;
function setMap(key) {
  if (!MAPS[key]) key = 'lab';
  const def = MAPS[key];
  if (mapGroup) {
    scene.remove(mapGroup);
    mapGroup.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  }
  mapGroup = new THREE.Group();
  const boxes = [];
  def.build(mapGroup, boxes);
  scene.add(mapGroup);
  scene.background.setHex(def.bg);
  hemi.color.setHex(def.hemi[0]); hemi.groundColor.setHex(def.hemi[1]); hemi.intensity = def.hemi[2];
  sun.color.setHex(def.sun[0]); sun.intensity = def.sun[1];
  world.boxes = [TABLE, ...boxes];
  gore.clear(); gore.wallH = def.wallH;
  S.map = key; saveSettings(); drawMenu(); drawPanel(); drawMainMenu();
}
function insideBox(x, z, pad = 0.5) {
  return world.boxes.some(b => x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad);
}

// ------------------------------------------------------------ world
const world = new World();
const gore = new Gore(scene, world);

// weapon table, to the player's left
const TABLE = { min: new V3(-2.45, 0.84, -3.55), max: new V3(-1.35, 0.9, 0.8) };
world.boxes.push(TABLE);
{
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a5059 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 4.35), mat);
  top.position.set(-1.9, 0.87, -1.375); scene.add(top);
  for (const x of [-2.4, -1.4]) for (const z of [-3.5, -1.375, 0.75]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.84, 0.05), mat);
    leg.position.set(x, 0.42, z); scene.add(leg);
  }
}

const S = { kills: 0, hostile: false, slowmo: false, lowG: false, god: false, map: 'lab', track: 0, height: 0 };
try { const o = JSON.parse(localStorage.getItem('goreLabSettings') || '{}'); for (const k of ['map', 'track', 'height']) if (k in o) S[k] = o[k]; if ('vol' in o) music.setVolume(o.vol); } catch { /* defaults */ }
function saveSettings() { try { localStorage.setItem('goreLabSettings', JSON.stringify({ map: S.map, track: S.track, height: S.height, vol: music.volume })); } catch { /* ignore */ } }
function setTrack(i) { S.track = i; music.play(i); saveSettings(); drawMenu(); drawMainMenu(); }
function setVolume(v) { music.setVolume(v); saveSettings(); drawMenu(); drawMainMenu(); }
function setHeight(v) { S.height = Math.round(Math.max(-0.8, Math.min(0.8, v)) * 100) / 100; saveSettings(); drawMenu(); drawMainMenu(); }
const fmtHeight = () => (S.height >= 0 ? '+' : '\u2212') + Math.abs(S.height * 100).toFixed(0) + ' cm';
const trackName = () => S.track < 0 ? 'Off' : music.tracks[S.track].name;
const dummies = [], barrels = [], balls = [], tools = [];
const MAX_DUMMIES = 12;

const DUMMY_TYPES = {
  dummy: {},
  zombie: { aggro: true, skin: 0x8faa72, speed: 1.3, hair: 0x2b2f24 },
  brute: { hp: 320, tough: 3, shirt: 0x1d1f24, speed: 0.85, hair: null },
};
function spawnDummy(x, z, type = 'dummy') {
  if (dummies.length >= MAX_DUMMIES) {
    const i = Math.max(0, dummies.findIndex(d => !d.alive));
    releaseBody(dummies[i]); dummies[i].dispose(); dummies.splice(i, 1);
  }
  x ??= (Math.random() - 0.5) * 10; z ??= -4.2 - Math.random() * 3;
  const head = headPos();
  const d = new Dummy(world, scene, gore, x, z, Math.atan2(head.x - x, head.z - z), typeof type === 'object' ? type : DUMMY_TYPES[type]);
  d.onDeath = () => { S.kills++; drawPanel(); };
  dummies.push(d);
  return d;
}

// ------------------------------------------------------------ props
const barrelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 14);
const barrelTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#b3261e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f2c230'; g.fillRect(0, 44, w, 40);
  g.fillStyle = '#1a1a1a';
  for (let x = -20; x < w; x += 32) { g.beginPath(); g.moveTo(x, 84); g.lineTo(x + 16, 84); g.lineTo(x + 36, 44); g.lineTo(x + 20, 44); g.fill(); }
});
function spawnBarrel(x, z) {
  x ??= (Math.random() - 0.5) * 9; z ??= -3 - Math.random() * 4;
  const b = { hp: 3, mesh: new THREE.Mesh(barrelGeo, new THREE.MeshLambertMaterial({ map: barrelTex })) };
  b.a = new Particle(x, 0.28, z, 0.28, 0.15); b.b = new Particle(x, 0.62, z, 0.28, 0.15);
  b.a.body = b.b.body = b; b.a.grab = b.b.grab = b;
  world.add(b.a); world.add(b.b); world.colliders.push(b.a, b.b);
  world.stick(b.a, b.b, { body: b });
  scene.add(b.mesh); barrels.push(b);
}
const ballGeo = new THREE.SphereGeometry(0.14, 16, 12);
function spawnBall(x, y, z, color) {
  const b = { mesh: new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ color })) };
  b.p = new Particle(x, y, z, 0.14, 0.5); b.p.body = b; b.p.bounce = 0.65; b.p.grab = b;
  world.add(b.p); world.colliders.push(b.p);
  scene.add(b.mesh); balls.push(b);
}

const explosions = [];
const blastGeo = new THREE.SphereGeometry(1, 16, 12);
const tv = new V3(), tv2 = new V3(), tv3 = new V3(), tq = new THREE.Quaternion();

function explode(barrel) {
  const i = barrels.indexOf(barrel);
  if (i < 0) return;
  barrels.splice(i, 1);
  const c = new V3().addVectors(barrel.a.pos, barrel.b.pos).multiplyScalar(0.5);
  releaseBody(barrel);
  world.removeBody(barrel); scene.remove(barrel.mesh);
  blast(c, 5);
}

// explosion at c: throws everything within R, tears up dummies, sets off other explosives
function blast(c, R = 5) {
  sfx.boom(); pulseAll(1, 200);
  const mesh = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }));
  mesh.position.copy(c); scene.add(mesh); explosions.push({ mesh, t: 0, size: R / 5 });
  gore.sparks(c, 40);
  { const d = headPos().distanceTo(c); if (d < R) damagePlayer(70 * (1 - d / R)); }
  const h = world.dt;
  for (const p of world.particles) {
    const d = p.pos.distanceTo(c);
    if (d > R || p.pinned) continue;
    tv.subVectors(p.pos, c).normalize().multiplyScalar(13 * (1 - d / R)); tv.y += 4 * (1 - d / R);
    p.push(tv, h);
  }
  for (const d of dummies) {
    const dist = d.p.pelvis.pos.distanceTo(c), kill = R * 0.9;
    if (dist > kill) continue;
    d.hp -= 220 * (1 - dist / kill); d.knockdown(3.5);
    if (dist < R * 0.64) {
      const limbs = d.bones.filter(b => !b.severed && b.name !== 'head');
      for (let n = dist < R * 0.36 ? 4 : 2; n > 0 && limbs.length; n--) d.sever(limbs.splice(Math.floor(Math.random() * limbs.length), 1)[0]);
      if (dist < R * 0.44) d.explodeHead();
      gore.spray(d.p.chest.pos, UP, 30, 5, 1.2);
      gore.gibs(d.p.chest.pos, 5, [0x8a0f0f, 0x7a1414, 0xa01818, d.skin, 0xe8dcc0]);
    }
    if (d.hp <= 0) d.die();
  }
  for (const b of [...barrels]) if (b.a.pos.distanceTo(c) < 3.5) setTimeout(() => explode(b), 120 + Math.random() * 200);
  for (const g of grenades) if (g.p.pos.distanceTo(c) < 3 && (g.fuse < 0 || g.fuse > 0.3)) g.fuse = 0.1 + Math.random() * 0.2;
  for (const m of mines) if (Math.hypot(m.x - c.x, m.z - c.z) < 3) m.trigger = true;
}

const grenades = [], mines = [], rockets = [];
const grenadeGeo = new THREE.SphereGeometry(0.055, 10, 8);
function spawnGrenade(x, y, z) {
  const g = { fuse: -1, mesh: new THREE.Mesh(grenadeGeo, new THREE.MeshLambertMaterial({ color: 0x3f5a2a })) };
  g.p = new Particle(x, y, z, 0.055, 0.8); g.p.body = g; g.p.grab = g; g.p.bounce = 0.35;
  world.add(g.p); world.colliders.push(g.p);
  scene.add(g.mesh); grenades.push(g);
  return g;
}
function removeGrenade(g) {
  releaseBody(g); world.removeBody(g); scene.remove(g.mesh);
  grenades.splice(grenades.indexOf(g), 1);
}
const mineGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.05, 12), mineLampGeo = new THREE.SphereGeometry(0.025, 8, 6);
function spawnMine(x, z) {
  const m = { x, z, t: 0, trigger: false, mesh: new THREE.Mesh(mineGeo, new THREE.MeshLambertMaterial({ color: 0x2c3327 })) };
  m.lamp = new THREE.Mesh(mineLampGeo, new THREE.MeshBasicMaterial({ color: 0x551111 }));
  m.lamp.position.y = 0.035; m.mesh.add(m.lamp);
  m.mesh.position.set(x, 0.025, z); scene.add(m.mesh); mines.push(m);
}
const rocketGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8); rocketGeo.rotateX(Math.PI / 2);
function spawnRocket(pos, dir) {
  const r = { pos: pos.clone(), dir: dir.clone(), life: 4, mesh: new THREE.Mesh(rocketGeo, new THREE.MeshLambertMaterial({ color: 0xb3261e })) };
  r.mesh.position.copy(pos); r.mesh.lookAt(tv.copy(pos).add(dir));
  scene.add(r.mesh); rockets.push(r);
}
// sdt = simulated seconds (slow-mo applies)
function updateExplosives(sdt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.mesh.position.copy(g.p.pos);
    if (g.fuse < 0) continue;
    g.fuse -= sdt;
    g.mesh.material.emissive.setHex(Math.sin(g.fuse * 30) > 0 ? 0xff2200 : 0);
    if (g.fuse <= 0) { const c = g.p.pos.clone(); removeGrenade(g); blast(c, 4.5); }
  }
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    m.t += sdt;
    const armed = m.t > 1.5;
    m.lamp.material.color.setHex(armed && Math.sin(m.t * 8) > 0 ? 0xff2200 : 0x551111);
    if (armed && !m.trigger) {
      for (const d of dummies) for (const p of d.all) {
        const dx = p.pos.x - m.x, dz = p.pos.z - m.z;
        if (p.pos.y < 0.5 && dx * dx + dz * dz < 0.2) { m.trigger = true; break; }
      }
    }
    if (m.trigger) { scene.remove(m.mesh); mines.splice(i, 1); blast(new V3(m.x, 0.15, m.z), 4.5); }
  }
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.life -= sdt;
    const step = 30 * sdt, hit = hitscan(r.pos, r.dir);
    if (hit.t <= step + 0.15 || r.life <= 0) {
      const c = r.pos.clone().addScaledVector(r.dir, Math.max(0, Math.min(hit.t, step) - 0.15));
      scene.remove(r.mesh); r.mesh.material.dispose(); rockets.splice(i, 1);
      blast(c, 5.5);
    } else {
      r.pos.addScaledVector(r.dir, step); r.mesh.position.copy(r.pos);
      gore.sparks(r.pos, 1);
    }
  }
}

// ------------------------------------------------------------ tools (guns, blades, spawn gun)
const GUNS = {
  spawngun: { name: 'Spawn gun', len: 0.25, spawner: true, cool: 0.3, kick: 0.05, muzzle: [0, 0.03, -0.27] },
  pistol: { name: 'Pistol', len: 0.2, cool: 0.13, pellets: 1, spread: 0.004, dmg: 1, push: 3.5, kick: 0.25, muzzle: [0, 0.03, -0.18] },
  revolver: { name: 'Revolver', len: 0.24, cool: 0.4, pellets: 1, spread: 0.002, dmg: 3, push: 7, kick: 0.7, gib: true, sound: 'revolver', muzzle: [0, 0.035, -0.23] },
  smg: { twoHand: true, name: 'SMG', len: 0.3, auto: true, cool: 0.075, pellets: 1, spread: 0.02, dmg: 0.7, push: 2.5, kick: 0.1, sound: 'smg', muzzle: [0, 0.035, -0.27] },
  rifle: { twoHand: true, name: 'Assault rifle', len: 0.55, auto: true, cool: 0.1, pellets: 1, spread: 0.012, dmg: 1.3, push: 3.5, kick: 0.14, sound: 'rifle', muzzle: [0, 0.04, -0.6] },
  shotgun: { twoHand: true, name: 'Shotgun', len: 0.62, cool: 0.65, pellets: 9, spread: 0.06, dmg: 1, push: 3.2, kick: 0.5, gib: true, sound: 'shotgun', muzzle: [0, 0.04, -0.62] },
  rocket: { twoHand: true, name: 'Rocket launcher', len: 0.7, cool: 1.0, rocket: true, kick: 0.4, sound: 'rocket', muzzle: [0, 0.06, -0.66] },
  knife: { name: 'Knife', len: 0.27, melee: true, blade: 0.4, dmg: 2, tiltVR: 0.8, tiltDesk: 0.1, thrust: true },
  machete: { name: 'Machete', len: 0.66, melee: true, blade: 0.2, dmg: 4 },
  katana: { name: 'Katana', len: 0.98, melee: true, blade: 0.22, dmg: 6, halves: true },
  bat: { name: 'Baseball bat', len: 0.8, melee: true, blade: 0.3, dmg: 1, blunt: true },
  chainsaw: { name: 'Chainsaw', len: 0.78, melee: true, saw: true, blade: 0.32, tiltVR: 0.3, tiltDesk: 0.15, thrust: true },
};
const DEFAULT_TOOLS = Object.keys(GUNS);
// Where the hand closes on each tool (in the tool's own space) and how far the
// fist is rolled about X so the fingers wrap the handle the way a real hand would.
const HANDLE = -Math.PI / 2;   // fist wrapped round a handle that runs along the tool
const GRIPS = {
  spawngun: [[0, -0.045, 0.005], -0.22], pistol: [[0, -0.035, 0.005], -0.22], revolver: [[0, -0.04, 0.02], -0.3],
  smg: [[0, -0.04, 0.01], -0.22], rifle: [[0, -0.04, 0.01], -0.22], shotgun: [[0, -0.012, 0.05], -0.45], rocket: [[0, -0.03, 0], -0.15],
  knife: [[0, 0, -0.03], HANDLE], machete: [[0, 0, -0.04], HANDLE], katana: [[0, 0, -0.07], HANDLE], bat: [[0, 0, -0.02], HANDLE],
  chainsaw: [[0, -0.03, 0.06], -0.2],
};
const M = {
  dark: new THREE.MeshLambertMaterial({ color: 0x23262b }), grey: new THREE.MeshLambertMaterial({ color: 0x555b64 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x7a4a26 }), steel: new THREE.MeshLambertMaterial({ color: 0xcfd6de }),
  olive: new THREE.MeshLambertMaterial({ color: 0x4d5a3a }), orange: new THREE.MeshLambertMaterial({ color: 0xe8792b }), white: new THREE.MeshLambertMaterial({ color: 0xdfe6ee }),
  red: new THREE.MeshLambertMaterial({ color: 0xb3261e }), cyan: new THREE.MeshBasicMaterial({ color: 0x35e0ff }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
};
function box(parent, mat, w, h, d, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
}
// cylinder lying along the tool's length (z)
function cyl(parent, mat, rFront, rBack, len, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rBack, rFront, len, 10), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m;
}
// every tool is modelled with its grip at the origin, pointing down -Z
function buildToolMesh(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'pistol':
      box(g, M.dark, 0.034, 0.045, 0.2, 0, 0.03, -0.08); box(g, M.grey, 0.03, 0.1, 0.042, 0, -0.035, 0.005, -0.22); break;
    case 'revolver':
      box(g, M.steel, 0.028, 0.034, 0.17, 0, 0.037, -0.14); cyl(g, M.grey, 0.03, 0.03, 0.055, 0, 0.03, -0.03);
      box(g, M.wood, 0.03, 0.1, 0.042, 0, -0.04, 0.02, -0.3); box(g, M.steel, 0.02, 0.03, 0.05, 0, 0.03, 0.02); break;
    case 'smg':
      box(g, M.dark, 0.045, 0.07, 0.3, 0, 0.03, -0.11); box(g, M.grey, 0.03, 0.15, 0.04, 0, -0.07, -0.12);
      box(g, M.grey, 0.032, 0.1, 0.042, 0, -0.04, 0.01, -0.22); box(g, M.dark, 0.03, 0.03, 0.08, 0, 0.035, -0.29); break;
    case 'rifle':
      box(g, M.dark, 0.045, 0.075, 0.42, 0, 0.03, -0.14); cyl(g, M.grey, 0.012, 0.012, 0.26, 0, 0.04, -0.47);
      box(g, M.wood, 0.034, 0.18, 0.055, 0, -0.09, -0.16, 0.3); box(g, M.wood, 0.04, 0.075, 0.24, 0, 0.012, 0.18, 0.1);
      box(g, M.wood, 0.05, 0.05, 0.16, 0, 0.02, -0.33); box(g, M.grey, 0.032, 0.1, 0.042, 0, -0.04, 0.01, -0.22); break;
    case 'shotgun':
      box(g, M.dark, 0.04, 0.04, 0.62, 0, 0.04, -0.31); box(g, M.wood, 0.05, 0.05, 0.17, 0, 0.005, -0.33);
      box(g, M.wood, 0.04, 0.075, 0.26, 0, 0.0, 0.14, 0.12); box(g, M.grey, 0.045, 0.06, 0.14, 0, 0.03, -0.03); break;
    case 'rocket':
      cyl(g, M.olive, 0.055, 0.055, 0.95, 0, 0.06, -0.18); cyl(g, M.dark, 0.07, 0.055, 0.1, 0, 0.06, -0.62);
      cyl(g, M.dark, 0.055, 0.075, 0.1, 0, 0.06, 0.3); box(g, M.dark, 0.03, 0.1, 0.04, 0, -0.03, 0.0, -0.15);
      box(g, M.red, 0.02, 0.05, 0.08, 0, 0.13, -0.2); break;
    case 'knife':
      box(g, M.dark, 0.026, 0.032, 0.1, 0, 0, -0.03); box(g, M.grey, 0.05, 0.014, 0.012, 0, 0, -0.085);
      box(g, M.steel, 0.005, 0.03, 0.17, 0, 0.002, -0.175); break;
    case 'machete':
      box(g, M.wood, 0.03, 0.035, 0.15, 0, 0, -0.04); box(g, M.steel, 0.006, 0.065, 0.52, 0, 0.012, -0.39); break;
    case 'katana':
      box(g, M.dark, 0.028, 0.032, 0.24, 0, 0, -0.06); box(g, M.grey, 0.065, 0.065, 0.008, 0, 0, -0.185);
      box(g, M.steel, 0.005, 0.034, 0.78, 0, 0.004, -0.58); break;
    case 'bat':
      cyl(g, M.wood, 0.036, 0.017, 0.8, 0, 0, -0.38); cyl(g, M.dark, 0.022, 0.022, 0.03, 0, 0, 0.03); break;
    case 'chainsaw':
      box(g, M.orange, 0.11, 0.13, 0.26, 0, 0.02, -0.08); box(g, M.dark, 0.03, 0.03, 0.2, 0, 0.115, -0.1);
      box(g, M.dark, 0.03, 0.09, 0.03, 0, 0.07, -0.19); box(g, M.dark, 0.04, 0.1, 0.05, 0, -0.03, 0.06, -0.2);
      box(g, M.dark, 0.012, 0.092, 0.54, 0, 0.02, -0.5); box(g, M.steel, 0.016, 0.062, 0.5, 0, 0.02, -0.49); break;
    case 'spawngun': {
      box(g, M.white, 0.06, 0.08, 0.2, 0, 0.03, -0.09); box(g, M.dark, 0.034, 0.1, 0.045, 0, -0.045, 0.005, -0.22);
      cyl(g, M.cyan, 0.022, 0.032, 0.08, 0, 0.03, -0.22); box(g, M.dark, 0.062, 0.02, 0.12, 0, 0.075, -0.09);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: menuTex }));
      screen.position.set(0, 0.24, -0.06); screen.rotation.x = -0.3; g.add(screen);
      break;
    }
  }
  return g;
}
function makeTool(kind, x, y, z) {
  const def = GUNS[kind];
  const t = { kind, def, mesh: buildToolMesh(kind), held: null, stuck: null, cool: 0, recoil: 0, flashT: 0 };
  t.a = new Particle(x + def.len / 2, y, z, 0.04, 1); t.b = new Particle(x - def.len / 2, y, z, 0.035, 1);
  t.a.body = t.b.body = t;
  world.add(t.a); world.add(t.b); world.stick(t.a, t.b, { len: def.len, body: t });
  // Solid against bodies, except while stuck in one, holstered, or a blade in the hand
  // (blades have to be able to cut). A gun in the hand shoves bodies but isn't shoved back.
  world.rods.push({ a: t.a, b: t.b, r: 0.03, body: t, skip: () => !!(t.stuck || t.holster || (t.held && def.melee)) });
  if (def.muzzle) {
    t.muzzle = new THREE.Object3D(); t.muzzle.position.fromArray(def.muzzle); t.mesh.add(t.muzzle);
    t.flash = new THREE.Mesh(new THREE.SphereGeometry(kind === 'shotgun' || kind === 'rocket' ? 0.07 : 0.045, 8, 6), def.spawner ? M.cyan : M.flash);
    t.flash.visible = false; t.muzzle.add(t.flash);
  }
  scene.add(t.mesh); tools.push(t);
  if (tools.length > 30) { const old = tools.find(o => !o.held && !o.stuck && o !== t); if (old) removeTool(old); }
  return t;
}
function removeTool(t) {
  if (t.held) { t.held.held = null; t.held = null; }
  if (t.support) { t.support.held = null; t.support = null; }
  if (t.holster) { t.holster.tool = null; t.holster = null; }
  world.removeBody(t); scene.remove(t.mesh);
  tools.splice(tools.indexOf(t), 1);
}
function resetItems() {
  for (const t of [...tools]) removeTool(t);
  DEFAULT_TOOLS.forEach((k, i) => makeTool(k, -1.9, 0.96, 0.3 - i * 0.33));
  for (const b of balls) { releaseBody(b); world.removeBody(b); scene.remove(b.mesh); }
  balls.length = 0;
  spawnBall(1.6, 0.3, -0.6, 0x2f7fd1); spawnBall(2.0, 0.3, -0.9, 0xe0c020);
  for (const g of [...grenades]) removeGrenade(g);
  for (const x of [-2.15, -1.9, -1.65]) spawnGrenade(x, 0.97, 0.62);
}

// ------------------------------------------------------------ spawn gun menu
const MENU = [
  { name: 'WEAPONS', items: DEFAULT_TOOLS.filter(k => k !== 'spawngun').map(k => [GUNS[k].name, p => makeTool(k, p.x, p.y + 0.35, p.z)]).concat([['Spawn gun', p => makeTool('spawngun', p.x, p.y + 0.35, p.z)]]) },
  { name: 'NPCS', items: [
    ['Dummy', p => spawnDummy(p.x, p.z)],
    ['Zombie', p => spawnDummy(p.x, p.z, 'zombie')],
    ['Brute', p => spawnDummy(p.x, p.z, 'brute')],
    ['Crowd x5', p => { for (let i = 0; i < 5; i++) spawnDummy(p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3); }],
    ['Zombie horde x5', p => { for (let i = 0; i < 5; i++) spawnDummy(p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, 'zombie'); }],
  ] },
  { name: 'PROPS', items: [
    ['Explosive barrel', p => spawnBarrel(p.x, p.z)],
    ['Grenade', p => spawnGrenade(p.x, p.y + 0.3, p.z)],
    ['Land mine', p => spawnMine(p.x, p.z)],
    ['Bouncy ball', p => spawnBall(p.x, p.y + 0.4, p.z, [0x2f7fd1, 0xe0c020, 0x3f9b62, 0xd9772b][Math.floor(Math.random() * 4)])],
  ] },
  { name: 'WORLD', items: [
    [() => 'Hostile: ' + (S.hostile ? 'ON' : 'OFF'), () => { panelCd = 0; press(4); }],
    [() => 'Slow-mo: ' + (S.slowmo ? 'ON' : 'OFF'), () => { panelCd = 0; press(5); }],
    [() => 'Low gravity: ' + (S.lowG ? 'ON' : 'OFF'), () => { panelCd = 0; press(6); }],
    [() => 'Survival: ' + (SV.on ? 'ON' : 'OFF'), () => { panelCd = 0; press(8); }],
    [() => 'God mode: ' + (S.god ? 'ON' : 'OFF'), () => { panelCd = 0; press(9); }],
    ['Clear everything', () => { panelCd = 0; press(3); }],
    ['Reset items', () => { panelCd = 0; press(7); }],
  ] },
];
MENU.push(
  { name: 'MUSIC', items: [
    [() => (S.track < 0 ? '\u25B6 ' : '') + 'Music off', () => setTrack(-1)],
    ...music.tracks.map((t, i) => [() => (S.track === i ? '\u25B6 ' : '') + t.name, () => setTrack(i)]),
    [() => 'Volume + (' + Math.round(music.volume * 100) + '%)', () => setVolume(music.volume + 0.1)],
    [() => 'Volume \u2212 (' + Math.round(music.volume * 100) + '%)', () => setVolume(music.volume - 0.1)],
  ] },
  { name: 'MAPS', items: MAP_KEYS.map(k => [() => (S.map === k ? '\u25B6 ' : '') + MAPS[k].name, () => setMap(k)]) },
);
MENU[3].items.push(
  [() => 'Height up (' + fmtHeight() + ')', () => setHeight(S.height + 0.05)],
  [() => 'Height down (' + fmtHeight() + ')', () => setHeight(S.height - 0.05)],
  ['Main menu', () => openMenu()],
);
const menu = { cat: 0, idx: MENU.map(() => 0) };
const menuCanvas = document.createElement('canvas'); menuCanvas.width = menuCanvas.height = 512;
const menuTex = new THREE.CanvasTexture(menuCanvas); menuTex.colorSpace = THREE.SRGBColorSpace;
function drawMenu() {
  const g = menuCanvas.getContext('2d'), W = 512, cat = MENU[menu.cat], sel = menu.idx[menu.cat];
  g.fillStyle = '#10141a'; g.fillRect(0, 0, W, W);
  g.fillStyle = '#35e0ff'; g.fillRect(0, 0, W, 78);
  g.fillStyle = '#10141a'; g.font = 'bold 44px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('◀  ' + cat.name + '  ▶', W / 2, 41);
  g.font = 'bold 36px Helvetica, Arial, sans-serif'; g.textAlign = 'left';
  const rows = 7, first = Math.max(0, Math.min(sel - 3, cat.items.length - rows));
  for (let r = 0; r < rows && first + r < cat.items.length; r++) {
    const i = first + r, y = 96 + r * 58, label = cat.items[i][0];
    if (i === sel) { g.fillStyle = '#e8792b'; g.fillRect(10, y, W - 20, 52); }
    g.fillStyle = i === sel ? '#10141a' : '#e6e9ed';
    g.fillText(typeof label === 'function' ? label() : label, 28, y + 27);
  }
  g.fillStyle = '#7d8794'; g.font = '24px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
  g.fillText((sel + 1) + ' / ' + cat.items.length, W / 2, W - 16);
  menuTex.needsUpdate = true;
  const hud = $('spawnHud');
  if (hud) { const label = cat.items[sel][0]; hud.textContent = 'SPAWN GUN · ' + cat.name + ' · ' + (typeof label === 'function' ? label() : label); }
}
function menuMove(dCat, dItem) {
  if (dCat) menu.cat = (menu.cat + dCat + MENU.length) % MENU.length;
  const n = MENU[menu.cat].items.length;
  if (dItem) menu.idx[menu.cat] = (menu.idx[menu.cat] + dItem + n) % n;
  sfx.tick(); drawMenu();
}
const spawnDot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), M.cyan);
spawnDot.visible = false; scene.add(spawnDot);
const spawnPt = new V3();
// where the spawn gun is pointing: just in front of whatever the beam hits, kept inside the room
function spawnAim(o, d) {
  const r = hitscan(o, d);
  spawnPt.copy(o).addScaledVector(d, Math.max(0.3, r.t - 0.25));
  const lim = HALF - 0.6;
  spawnPt.x = Math.max(-lim, Math.min(lim, spawnPt.x)); spawnPt.z = Math.max(-lim, Math.min(lim, spawnPt.z));
  spawnPt.y = Math.max(0, Math.min(WALL_H - 1, spawnPt.y));
  return spawnPt;
}

// ------------------------------------------------------------ tracers
const tracers = [];
{
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0, 0.5);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, depthWrite: false }));
    m.visible = false; scene.add(m); tracers.push({ m, t: 0 });
  }
}
let tracerNext = 0;
function tracer(from, to) {
  const tr = tracers[tracerNext]; tracerNext = (tracerNext + 1) % tracers.length;
  tr.m.position.copy(from); tr.m.lookAt(to);
  tr.m.scale.set(0.008, 0.008, from.distanceTo(to)); tr.m.visible = true; tr.t = 0.07;
}

// ------------------------------------------------------------ control panel (right wall)
const PANEL = { x: HALF - 0.03, y: 1.55, z: -1, w: 2.6, h: 2.2, head: 0.18 };
const BUTTONS = [
  ['SPAWN DUMMY', () => spawnDummy()], ['SPAWN x5', () => { for (let i = 0; i < 5; i++) spawnDummy(); }],
  ['SPAWN BARREL', () => spawnBarrel()], ['CLEAR ALL', () => clearAll()],
  [() => 'HOSTILE: ' + (S.hostile ? 'ON' : 'OFF'), () => { S.hostile = !S.hostile; }],
  [() => 'SLOW-MO: ' + (S.slowmo ? 'ON' : 'OFF'), () => { S.slowmo = !S.slowmo; world.setScale(S.slowmo ? 0.2 : 1); }],
  [() => 'LOW GRAVITY: ' + (S.lowG ? 'ON' : 'OFF'), () => { S.lowG = !S.lowG; world.gravity = S.lowG ? -1.6 : -9.8; }],
  ['RESET ITEMS', () => resetItems()],
  [() => 'SURVIVAL: ' + (SV.on ? 'ON' : 'OFF'), () => { SV.on ? endSurvival() : startSurvival(); }],
  [() => 'GOD MODE: ' + (S.god ? 'ON' : 'OFF'), () => { S.god = !S.god; }],
  ['MAIN MENU', () => openMenu()],
  [() => 'MAP: ' + MAPS[S.map].name.toUpperCase(), () => setMap(MAP_KEYS[(MAP_KEYS.indexOf(S.map) + 1) % MAP_KEYS.length])],
];
const PANEL_ROWS = 6;
const panelCanvas = document.createElement('canvas'); panelCanvas.width = 832; panelCanvas.height = 704;
const panelTex = new THREE.CanvasTexture(panelCanvas); panelTex.colorSpace = THREE.SRGBColorSpace;
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.w, PANEL.h), new THREE.MeshBasicMaterial({ map: panelTex }));
  m.position.set(PANEL.x, PANEL.y, PANEL.z); m.rotation.y = -Math.PI / 2; scene.add(m);
}
let panelFlash = -1, panelCd = 0;
function drawPanel() {
  const g = panelCanvas.getContext('2d'), W = panelCanvas.width, H = panelCanvas.height, hh = H * PANEL.head;
  g.fillStyle = '#14171c'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8792b'; g.font = 'bold 54px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('GORE LAB', 30, hh / 2);
  g.fillStyle = '#e6e9ed'; g.textAlign = 'right'; g.fillText('KILLS ' + S.kills, W - 30, hh / 2);
  g.font = 'bold 38px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
  const bw = W / 2, bh = (H - hh) / PANEL_ROWS;
  BUTTONS.forEach(([label], i) => {
    const x = (i % 2) * bw, y = hh + Math.floor(i / 2) * bh;
    const text = typeof label === 'function' ? label() : label;
    g.fillStyle = i === panelFlash ? '#e8792b' : text.endsWith('ON') ? '#7d1f16' : '#2a3038';
    g.fillRect(x + 12, y + 12, bw - 24, bh - 24);
    g.fillStyle = '#f2f4f7'; g.fillText(text, x + bw / 2, y + bh / 2);
  });
  panelTex.needsUpdate = true;
  drawMenu();
  $('kills').textContent = 'KILLS ' + S.kills;
}
function panelIndex(y, z) {
  const u = (z - (PANEL.z - PANEL.w / 2)) / PANEL.w, v = (PANEL.y + PANEL.h / 2 - y) / PANEL.h;
  if (u < 0 || u > 1 || v < PANEL.head || v > 1) return -1;
  return Math.min(PANEL_ROWS - 1, Math.floor((v - PANEL.head) / (1 - PANEL.head) * PANEL_ROWS)) * 2 + (u < 0.5 ? 0 : 1);
}
function press(i) {
  if (i < 0 || panelCd > 0) return;
  panelCd = 0.35; panelFlash = i;
  BUTTONS[i][1](); sfx.beep(); drawPanel();
  setTimeout(() => { panelFlash = -1; drawPanel(); }, 150);
}
function clearAll() {
  if (SV.on) endSurvival();
  for (const d of dummies) { releaseBody(d); d.dispose(); }
  dummies.length = 0;
  for (const b of barrels) { releaseBody(b); world.removeBody(b); scene.remove(b.mesh); }
  barrels.length = 0;
  for (const g of [...grenades]) removeGrenade(g);
  for (const m of mines) scene.remove(m.mesh);
  for (const r of rockets) scene.remove(r.mesh);
  mines.length = rockets.length = 0;
  gore.clear(); S.kills = 0;
  for (const h of [...vrHands, desk]) bloody(h, -1);
}

// ------------------------------------------------------------ hands
let inVR = false, started = false;

// Jointed player hand. Built flat (fingers along -Z, palm down) then rolled so
// the palm faces inward like a hand wrapped round a controller.
const skinMat = new THREE.MeshLambertMaterial({ color: 0xe0b48c }), cuffMat = new THREE.MeshLambertMaterial({ color: 0x23262b });
function buildHand(side, skin = skinMat) {
  const s = side === 'left' ? 1 : -1;   // which way the thumb sits in the flat frame
  const root = new THREE.Group(), flat = new THREE.Group();
  flat.rotation.z = s * Math.PI / 2;
  flat.position.set(-s * 0.012, -0.03, 0.075);
  root.add(flat);
  const seg = (parent, w, t, len, mat = skin) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, len), mat);
    m.position.z = -len / 2; parent.add(m); return m;
  };
  const palm = seg(flat, 0.078, 0.026, 0.09); palm.position.z = 0;
  const cuff = seg(flat, 0.07, 0.05, 0.1, cuffMat); cuff.position.set(0, 0, 0.1);
  const fingers = [];
  const LEN = [[0.04, 0.026, 0.02], [0.044, 0.029, 0.022], [0.04, 0.027, 0.02], [0.031, 0.02, 0.017]];
  for (let i = 0; i < 4; i++) {
    const joints = [];
    let parent = flat, z = -0.045;
    for (let j = 0; j < 3; j++) {
      const g = new THREE.Group();
      g.position.set(j === 0 ? s * (0.029 - i * 0.0193) : 0, 0, z);
      parent.add(g); seg(g, 0.0165, 0.0165 - j * 0.0015, LEN[i][j]);
      joints.push(g); parent = g; z = -LEN[i][j];
    }
    fingers.push(joints);
  }
  const thumb = new THREE.Group(); thumb.position.set(s * 0.036, -0.004, 0.025); flat.add(thumb);
  seg(thumb, 0.02, 0.02, 0.042);
  const thumb2 = new THREE.Group(); thumb2.position.z = -0.042; thumb.add(thumb2);
  seg(thumb2, 0.018, 0.018, 0.03);
  const cur = { index: 0.15, rest: 0.15 };
  // index / rest: 0 = open, 1 = fist
  root.userData.pose = (index, rest, k = 1) => {
    cur.index += (index - cur.index) * k; cur.rest += (rest - cur.rest) * k;
    fingers.forEach((joints, i) => {
      const c = i === 0 ? cur.index : cur.rest;
      joints[0].rotation.x = -c * 1.25; joints[1].rotation.x = -c * 1.5; joints[2].rotation.x = -c * 1.0;
    });
    const c = Math.max(cur.rest, cur.index * 0.6);
    thumb.rotation.y = -s * (0.75 - 0.5 * c); thumb.rotation.x = -c * 0.35; thumb2.rotation.x = -c * 0.9;
  };
  root.userData.pose(0.15, 0.15);
  return root;
}
function makeHand(ctrl) {
  return { ctrl, pos: new V3(), prevPos: new V3(), vel: new V3(), quat: new THREE.Quaternion(), held: null, trigger: false,
    skin: skinMat.clone(), bloody: 0, wasTrigger: false, src: null, active: false, punchCd: 0, tip: new V3(), prevTip: new V3(), hasTip: false, btn: [false, false], snapped: false, holdDist: 0.9 };
}
const vrHands = [0, 1].map(i => {
  const c = renderer.xr.getController(i); rig.add(c);
  const h = makeHand(c);
  h.side = i ? 'right' : 'left';
  h.glove = buildHand(h.side, h.skin); h.glove.visible = false; scene.add(h.glove);
  h.ray = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  h.ray.position.z = -0.65; c.add(h.ray);
  c.addEventListener('connected', e => {
    h.src = e.data;
    // controller index doesn't say which hand it is -- rebuild to match
    h.side = e.data.handedness === 'left' ? 'left' : 'right';
    scene.remove(h.glove); h.glove = buildHand(h.side, h.skin); scene.add(h.glove);
  });
  c.addEventListener('disconnected', () => { h.src = null; h.trigger = false; drop(h); });
  c.addEventListener('selectstart', () => { h.trigger = true; });
  c.addEventListener('selectend', () => { h.trigger = false; });
  c.addEventListener('squeezestart', () => grab(h));
  c.addEventListener('squeezeend', () => drop(h));
  return h;
});
const desk = makeHand(null);
desk.jab = 0;
desk.side = 'right';
desk.glove = buildHand('right', desk.skin); desk.glove.visible = false; scene.add(desk.glove);
const hands = () => inVR ? vrHands : [desk];

// hands get bloodier the more mess they're involved in; CLEAR ALL washes them
const BLOODY = new THREE.Color(0x7a0505);
function bloody(h, amt) {
  h.bloody = amt < 0 ? 0 : Math.min(1, h.bloody + amt);
  h.skin.color.copy(skinMat.color).lerp(BLOODY, h.bloody * 0.85);
}
function pulse(h, intensity, ms) { h.src?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms); }
function pulseAll(i, ms) { for (const h of vrHands) pulse(h, i, ms); }

const headV = new V3();
function headPos() { return camera.getWorldPosition(headV); }

// distance from point to tool / particle for grabbing
function grab(h) {
  if (h.held) return;
  // reach for a holster first
  for (const hs of holsters) {
    if (!hs.tool || (inVR && holsterPos(hs, tv).distanceTo(h.pos) > 0.27)) continue;
    const t = hs.tool;
    hs.tool = null; t.holster = null; t.held = h; h.held = { type: 'tool', tool: t }; h.hasTip = false;
    pulse(h, 0.6, 50); sfx.tick();
    return;
  }
  let best = null, bd = 0.2;
  for (const t of tools) {
    if (t.holster) continue;
    const d = Math.sqrt(segSeg(h.pos, h.pos, t.a.pos, t.b.pos));
    if (t.held) {
      // second hand on a long gun someone is already holding: steady it
      if (t.held !== h && t.def.twoHand && !t.support && d < 0.16 && d < bd) { bd = d; best = { type: 'support', tool: t }; }
      continue;
    }
    if (d < bd) { bd = d; best = { type: 'tool', tool: t }; }
  }
  for (const p of world.particles) {
    if (p.pinned || p.gone || !(p.grab || p.body instanceof Dummy)) continue;
    const d = p.pos.distanceTo(h.pos) - p.r;
    if (d < bd - 0.06) { bd = d + 0.06; best = { type: 'particle', p }; }
  }
  if (!best) {
    // distance grab: whatever is nearest the pointing ray
    tv.copy(NEG_Z).applyQuaternion(h.quat);
    const range = inVR ? 8 : 4;
    tv2.copy(h.aimFrom ?? h.pos).addScaledVector(tv, range);
    let off = 0.3;
    const o = h.aimFrom ?? h.pos;
    for (const t of tools) {
      if (t.held || t.holster) continue;
      const d = Math.sqrt(segSeg(o, tv2, t.a.pos, t.b.pos));
      if (d < off) { off = d; best = { type: 'tool', tool: t }; }
    }
    for (const p of world.particles) {
      if (p.pinned || p.gone) continue;
      const isDummy = p.body instanceof Dummy;
      if (!(p.grab || (isDummy && !inVR))) continue;
      const d = Math.sqrt(segSeg(o, tv2, p.pos, p.pos)) - p.r;
      if (d < off - 0.1) { off = d + 0.1; best = { type: 'particle', p, dist: segSeg.s * range }; }
    }
  }
  if (!best) return;
  h.held = best;
  if (best.type === 'support') { best.tool.support = h; pulse(h, 0.4, 40); return; }
  if (best.type === 'tool') {
    const t = best.tool;
    if (t.stuck) {
      // yank it back out
      const d = t.stuck.d;
      gore.spray(t.b.pos, tv.subVectors(t.a.pos, t.b.pos).normalize(), 18, 3.5, 0.6);
      gore.emitter(d.p.chest, 3, 20);
      d.bleeding += 0.5; d.sliceCd = 0.4; t.stuck = null;
      sfx.squish(); bloody(h, 0.2);
    }
    t.held = h; t.a.pinned = t.b.pinned = true; h.hasTip = false;
  }
  else {
    best.p.pinned = true; h.holdDist = Math.max(0.6, Math.min(1.6, best.dist ?? 0.9));
    const b = best.p.body;
    if (b instanceof Dummy && (b.bleeding || b.hp < 60)) bloody(h, 0.3);
  }
  pulse(h, 0.4, 40);
}
function drop(h) {
  const held = h.held;
  if (!held) return;
  h.held = null;
  if (held.type === 'support') { held.tool.support = null; return; }
  if (held.type === 'tool' && held.tool.support) {
    // the steadying hand keeps hold of the gun
    const t = held.tool, sup = t.support;
    t.support = null; t.held = sup; sup.held = { type: 'tool', tool: t };
    return;
  }
  if (held.type === 'tool') {
    // let go at a hip or over the shoulder and it goes in the holster there
    for (const hs of holsters) {
      if (hs.tool || holsterPos(hs, tv).distanceTo(h.pos) > 0.25) continue;
      hs.tool = held.tool; held.tool.holster = hs; held.tool.held = null;
      pulse(h, 0.6, 50); sfx.tick();
      return;
    }
  }
  const ps = held.type === 'tool' ? [held.tool.a, held.tool.b] : [held.p];
  if (held.type === 'tool') held.tool.held = null;
  for (const p of ps) { p.pinned = false; p.prev.copy(p.pos).addScaledVector(h.vel, -TICK); }
  if (held.type === 'particle' && held.p.grab?.fuse === -1) held.p.grab.fuse = 2.5;
}
// Holsters ride on the body: one at each hip and one over the right shoulder.
const holsters = [
  { name: 'left hip', off: [-0.25, -0.72, 0.02], tool: null },
  { name: 'right hip', off: [0.25, -0.72, 0.02], tool: null },
  { name: 'back', off: [0.14, -0.22, 0.2], tool: null },
];
for (const hs of holsters) {
  hs.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.05), new THREE.MeshLambertMaterial({ color: 0x3a2a1c }));
  hs.mesh.visible = false; scene.add(hs.mesh);
}
const holQ = new THREE.Quaternion(), holDown = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -Math.PI / 2);
function bodyYaw() { camera.getWorldDirection(tv3); return Math.atan2(-tv3.x, -tv3.z); }
function holsterPos(hs, out) {
  const yaw = bodyYaw(), c = Math.cos(yaw), s = Math.sin(yaw), head = headPos();
  return out.set(head.x + hs.off[0] * c + hs.off[2] * s, head.y + hs.off[1], head.z - hs.off[0] * s + hs.off[2] * c);
}
function updateHolsters() {
  holQ.setFromAxisAngle(UP, bodyYaw());
  for (const hs of holsters) {
    holsterPos(hs, hs.mesh.position); hs.mesh.quaternion.copy(holQ);
    hs.mesh.visible = started && !hs.tool;
  }
}
// a holstered tool hangs barrel-down at its holster
function updateHolstered(t) {
  holsterPos(t.holster, t.mesh.position);
  t.mesh.quaternion.copy(holQ).multiply(holDown);
  if (t.holster.name === 'back') t.mesh.quaternion.multiply(gq.setFromAxisAngle(X_AXIS, Math.PI));   // long guns ride muzzle-up
  t.a.pos.copy(t.mesh.position); t.b.pos.copy(NEG_Z).applyQuaternion(t.mesh.quaternion).multiplyScalar(t.def.len).add(t.a.pos);
  t.a.prev.copy(t.a.pos); t.b.prev.copy(t.b.pos);
  t.a.pinned = t.b.pinned = true;
}
// desktop: one key puts the held weapon away, or draws the last one holstered
function holsterKey() {
  if (desk.held?.type === 'tool') {
    const hs = holsters.find(x => !x.tool);
    if (!hs) return;
    const t = desk.held.tool;
    if (t.support) return;
    desk.held = null; t.held = null; t.holster = hs; hs.tool = t; sfx.tick();
  } else if (!desk.held) grab(desk);
}

// let go of anything belonging to a body that is about to be removed
function releaseBody(body) {
  for (const h of [...vrHands, desk]) if (h.held?.type === 'particle' && h.held.p.body === body) { h.held.p.pinned = false; h.held = null; }
}

const TOOL_TILT = new THREE.Quaternion(), aimM = new THREE.Matrix4();
// Put the visible hand where a real one would be: wrapped round the grip of
// the tool it holds, cupping the barrel when steadying, otherwise on the controller.
const X_AXIS = new V3(1, 0, 0), gq = new THREE.Quaternion(), gv = new V3(), gx = new V3(), gy = new V3(), gz = new V3();
function placeGlove(h) {
  const g = h.glove, held = h.held, s = h.side === 'left' ? 1 : -1;
  if (held?.type === 'tool') {
    const t = held.tool, [pos, rot] = GRIPS[t.kind];
    g.quaternion.copy(t.mesh.quaternion).multiply(gq.setFromAxisAngle(X_AXIS, rot));
    gv.set(-0.016 * s, 0.03, -0.04).applyQuaternion(g.quaternion);   // centre of the closed fist -> the grip
    g.position.fromArray(pos).applyQuaternion(t.mesh.quaternion).add(t.mesh.position).add(gv);
  } else if (held?.type === 'support') {
    // palm up under the barrel, fingers wrapped over it
    const t = held.tool;
    gy.copy(NEG_Z).applyQuaternion(t.mesh.quaternion);                 // along the barrel
    gx.set(0, 1, 0).applyQuaternion(t.mesh.quaternion).multiplyScalar(s);
    gz.crossVectors(gx, gy);
    g.quaternion.setFromRotationMatrix(aimM.makeBasis(gx, gy, gz));
    const along = Math.max(0.14, Math.min(t.def.len - 0.04, gv.subVectors(h.pos, t.mesh.position).dot(gy)));
    gv.set(-0.016 * s, 0.03, -0.04).applyQuaternion(g.quaternion);
    g.position.copy(t.mesh.position).addScaledVector(gy, along).addScaledVector(gx, s * 0.035).add(gv);
  } else { g.position.copy(h.pos); g.quaternion.copy(h.quat); }
}
let spawnDotOn = false;
function updateHand(h, dt) {
  h.prevPos.copy(h.pos);
  if (h.ctrl) {
    h.active = !!h.src && h.ctrl.visible;
    h.ctrl.getWorldPosition(h.pos); h.ctrl.getWorldQuaternion(h.quat);
    h.ray.visible = !h.held || paused;
    h.glove.visible = h.active;
    const gp = h.src?.gamepad;
    h.trigV = gp?.buttons[0]?.value ?? (h.trigger ? 1 : 0); h.gripV = gp?.buttons[1]?.value ?? 0;
  } else {
    h.active = true;
    camera.getWorldQuaternion(h.quat);
    h.aimFrom = headPos().clone();
    h.jab = Math.max(0, h.jab - dt);
    const u = h.jab > 0 ? Math.sin(Math.PI * (1 - h.jab / 0.22)) : 0;
    if (h.held?.type === 'particle') tv.set(0, 0, -h.holdDist);
    else tv.set(0.22, -0.2, -0.45 - u * 0.65);
    if (h.held?.tool?.def.melee && !h.held.tool.def.thrust) {
      // swing the blade across the view
      const sw = h.jab > 0 ? 1.1 - 2.2 * (1 - h.jab / 0.22) : 1.1;
      tv.set(0.22 - (1.1 - sw) * 0.2, -0.2, -0.5 - u * 0.4);
      h.quat.multiply(tq.setFromAxisAngle(UP, h.jab > 0 ? sw : 0));
    }
    h.pos.copy(tv).applyQuaternion(camera.getWorldQuaternion(tq)).add(h.aimFrom);
    h.glove.visible = started && !inVR;
    h.trigV = h.trigger ? 1 : 0; h.gripV = h.jab > 0 ? 1 : 0;
  }
  // finger pose: wrap round whatever is held, otherwise follow trigger / grip
  const k = Math.min(1, dt * 18);
  if (h.held?.type === 'tool') h.glove.userData.pose(h.held.tool.def.melee ? 0.95 : 0.35 + h.trigV * 0.45, 0.95, k);
  else if (h.held) h.glove.userData.pose(0.8, 0.8, k);
  else h.glove.userData.pose(0.12 + h.trigV * 0.9, 0.12 + Math.max(h.gripV, h.trigV * 0.0) * 0.9, k);
  tv.subVectors(h.pos, h.prevPos).divideScalar(Math.max(dt, 1e-4));
  if (teleported || tv.length() > 40) { tv.set(0, 0, 0); h.vel.set(0, 0, 0); h.hasTip = false; }   // snap turn isn't a punch
  h.vel.lerp(tv, 0.5);
  h.punchCd -= dt;

  const held = h.held;
  if (held?.type === 'tool') {
    const t = held.tool;
    t.recoil = Math.max(0, t.recoil - dt * 4);
    tq.copy(h.quat);
    if (t.def.melee) tq.multiply(TOOL_TILT.setFromAxisAngle(tv.set(1, 0, 0), inVR ? t.def.tiltVR ?? 1.05 : t.def.tiltDesk ?? 0.45));
    if (t.support && h.pos.distanceTo(t.support.pos) > 0.12) {
      // two-handed: the barrel runs from the trigger hand to the front hand
      aimM.lookAt(h.pos, t.support.pos, tv.set(0, 1, 0).applyQuaternion(h.quat));
      tq.setFromRotationMatrix(aimM);
    }
    (t.aimQ ??= new THREE.Quaternion()).copy(tq);
    tv.copy(NEG_Z).applyQuaternion(tq);
    t.a.pos.copy(h.pos); t.b.pos.copy(h.pos).addScaledVector(tv, t.def.len);
    t.a.prev.copy(t.a.pos); t.b.prev.copy(t.b.pos);
    t.mesh.position.copy(h.pos);
    t.mesh.quaternion.copy(tq).multiply(TOOL_TILT.setFromAxisAngle(tv.set(1, 0, 0), t.recoil));
    t.mesh.updateMatrixWorld(true);
    if (t.def.spawner) {
      t.muzzle.getWorldPosition(fromV);
      spawnDot.position.copy(spawnAim(h.ctrl ? fromV : h.aimFrom, dirV.copy(NEG_Z).applyQuaternion(t.aimQ)));
      spawnDotOn = true;
    }
    if (paused) h.hasTip = false;
    else if (t.def.saw) saw(h, t, dt);
    else if (t.def.melee) melee(h, t, dt);
    else {
      t.cool -= dt;
      const want = t.def.auto ? h.trigger : (h.trigger && !h.wasTrigger);
      if (want && t.cool <= 0) fire(h, t);
    }
  } else if (held?.type === 'particle') {
    held.p.pos.copy(h.pos); held.p.prev.copy(h.pos);
  }
  placeGlove(h);
  h.wasTrigger = h.trigger;
}

// ------------------------------------------------------------ shooting
const rayEnd = new V3(), hitPt = new V3(), dirV = new V3(), fromV = new V3();
function rayBox(o, d, b) {
  let t0 = 0, t1 = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-8) { if (o[ax] < b.min[ax] || o[ax] > b.max[ax]) return Infinity; continue; }
    let a = (b.min[ax] - o[ax]) / d[ax], c = (b.max[ax] - o[ax]) / d[ax];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
function hitscan(o, d) {
  const L = 60;
  rayEnd.copy(o).addScaledVector(d, L);
  const best = { t: L, kind: 'none' };
  const take = (t, kind, extra) => { if (t > 0 && t < best.t) { best.t = t; best.kind = kind; Object.assign(best, extra); } };
  if (d.x > 0) take((HALF - o.x) / d.x, 'wall'); else if (d.x < 0) take((-HALF - o.x) / d.x, 'wall');
  if (d.z > 0) take((HALF - o.z) / d.z, 'wall'); else if (d.z < 0) take((-HALF - o.z) / d.z, 'wall');
  if (d.y > 0) take((WALL_H - o.y) / d.y, 'wall'); else if (d.y < 0) take(-o.y / d.y, 'wall');
  for (const b of world.boxes) take(rayBox(o, d, b), 'wall');
  if (d.x > 0) {
    const t = (PANEL.x - 0.02 - o.x) / d.x, i = panelIndex(o.y + d.y * t, o.z + d.z * t);
    if (i >= 0) take(t, 'panel', { index: i });
  }
  for (const dm of dummies) { const r = dm.raycast(o, rayEnd); if (r) take(r.s * L, 'dummy', { dummy: dm, bone: r.bone }); }
  for (const b of barrels) if (segSeg(o, rayEnd, b.a.pos, b.b.pos) < 0.28 * 0.28) take(segSeg.s * L - 0.2, 'barrel', { barrel: b });
  for (const b of balls) if (segSeg(o, rayEnd, b.p.pos, b.p.pos) < 0.14 * 0.14) take(segSeg.s * L, 'ball', { ball: b });
  for (const g of grenades) if (segSeg(o, rayEnd, g.p.pos, g.p.pos) < 0.09 * 0.09) take(segSeg.s * L, 'grenade', { grenade: g });
  return best;
}

function fire(h, t) {
  const def = t.def;
  const steady = t.support ? 0.4 : 1;
  t.cool = def.cool; t.recoil = def.kick * (t.support ? 0.5 : 1); t.flashT = 0.05; t.flash.visible = true;
  if (t.support) pulse(t.support, 0.6, 50);
  t.muzzle.getWorldPosition(fromV);
  // on desktop aim through the crosshair, not along the offset gun
  const o = h.ctrl ? fromV : h.aimFrom;
  dirV.copy(NEG_Z).applyQuaternion(t.aimQ);
  if (def.spawner) {
    const p = spawnAim(o, dirV), item = MENU[menu.cat].items[menu.idx[menu.cat]];
    item[1](p.clone());
    tracer(fromV, p); sfx.spawn(); pulse(h, 0.5, 40); drawMenu();
    return;
  }
  sfx.shot(def.sound); pulse(h, def.kick > 0.4 ? 1 : 0.6, def.kick > 0.4 ? 120 : 50);
  if (def.rocket) { spawnRocket(fromV, dirV); return; }
  const hitsPer = new Map(), clusters = new Map();
  for (let i = 0; i < def.pellets; i++) {
    const sp = def.spread * steady;
    dirV.copy(NEG_Z).applyQuaternion(t.aimQ);
    dirV.x += (Math.random() - 0.5) * 2 * sp; dirV.y += (Math.random() - 0.5) * 2 * sp; dirV.z += (Math.random() - 0.5) * 2 * sp;
    dirV.normalize();
    const r = hitscan(o, dirV);
    hitPt.copy(o).addScaledVector(dirV, r.t);
    tracer(fromV, hitPt);
    if (r.kind === 'dummy') {
      const d = r.dummy;
      gore.spray(hitPt, dirV, 9, 6, 0.35);
      gore.spray(hitPt, tv.copy(dirV).negate(), 4, 2, 0.6);
      if (d.alive && Math.random() < 0.5) sfx.grunt();
      if (def.pellets > 1) {
        // pellets that land on the same part are drawn as one torn-out chunk
        const key = r.bone ?? d;
        let c = clusters.get(key);
        if (!c) clusters.set(key, c = { d, bone: r.bone, pt: new V3(), dir: dirV.clone(), n: 0 });
        c.pt.add(hitPt); c.n++;
      } else d.addWound(r.bone, hitPt, dirV, 'bullet', !!def.gib);
      d.hit(r.bone, def.dmg, tv.copy(dirV).multiplyScalar(def.push), hitPt, { bullet: true, big: !!def.gib, dir: dirV });
      hitsPer.set(d, (hitsPer.get(d) || 0) + 1);
    } else if (r.kind === 'wall') gore.sparks(hitPt, 3);
    else if (r.kind === 'panel') press(r.index);
    else if (r.kind === 'barrel') { gore.sparks(hitPt, 6); if (--r.barrel.hp <= 0) explode(r.barrel); }
    else if (r.kind === 'grenade') r.grenade.fuse = 0.02;
    else if (r.kind === 'ball') r.ball.p.push(tv.copy(dirV).multiplyScalar(6), world.dt);
  }
  for (const c of clusters.values()) c.d.addWound(c.bone, c.pt.multiplyScalar(1 / c.n), c.dir, 'bullet', true, c.n);
  if (hitsPer.size) sfx.squish();
  for (const [d, n] of hitsPer) if (n >= 4 || def.dmg >= 3) d.knockdown(2.5 + Math.random());
}

// Blades and bats. A fast sideways sweep slashes (or bashes); a thrust along
// the blade stabs, and the blade stays stuck in whatever it went into.
const bladeA = new V3(), bladeDir = new V3(), tipVel = new V3(), gutV = new V3();
const qInv = new THREE.Quaternion();
function melee(h, t, dt) {
  const def = t.def;
  bladeA.copy(t.a.pos).lerp(t.b.pos, def.blade);
  h.tip.copy(t.b.pos);
  if (!h.hasTip) { h.prevTip.copy(h.tip); h.hasTip = true; return; }
  tipVel.subVectors(h.tip, h.prevTip).divideScalar(Math.max(dt, 1e-4));
  const speed = tipVel.length();
  bladeDir.subVectors(t.b.pos, t.a.pos).normalize();
  const thrust = tipVel.dot(bladeDir);
  if (speed > 1.4 && speed < 80) {
    for (const d of dummies) {
      let hit = null, torso = false;
      for (const b of d.bones) {
        const head = b.name === 'head';
        if (head && d.headGone) continue;
        const pa = head ? b.b.pos : b.a.pos, r = (head ? 0.12 : b.r) + 0.04;
        if (segSeg(bladeA, h.tip, pa, b.b.pos) < r * r || segSeg(h.prevTip, h.tip, pa, b.b.pos) < r * r) { hit = b; break; }
      }
      // the blade can catch an arm and still open the belly behind it
      const touch = !d.split && segSeg(bladeA, h.tip, d.p.pelvis.pos, d.p.neck.pos) < 0.2 * 0.2;
      if (touch) gutV.copy(bladeA).lerp(h.tip, segSeg.s);
      if (!hit && !d.split && (touch || segSeg(h.prevTip, h.tip, d.p.pelvis.pos, d.p.neck.pos) < 0.2 * 0.2)) torso = true;
      if (!hit && !torso && !touch) continue;
      const stab = !def.blunt && thrust > 1.4 && thrust > speed * 0.7;
      // A hard katana stroke goes clean through: straight down splits them left
      // from right, level through the waist takes the top half off. Checked every
      // frame the blade is in them, so catching an arm first doesn't stop it.
      if (def.halves && !stab && !d.split && speed > 3.4) {
        tv.copy(tipVel).normalize();
        const done = tv.y < -0.7 && (hit?.name === 'head' || touch || torso) ? d.splitVertical()
          : Math.abs(tv.y) < 0.5 && touch ? d.splitWaist(gutV) : false;
        if (done) { d.sliceCd = 0.4; sfx.slice(); sfx.splat(); pulseAll(1, 150); bloody(h, 0.4); continue; }
      }
      if (d.sliceCd > 0 || (!hit && !torso)) continue;
      if (!stab && speed < 2.8) continue;
      d.sliceCd = 0.25;
      tv.copy(tipVel).normalize();
      const at = hit ? (hit.name === 'head' ? hit.b.pos : tv3.addVectors(hit.a.pos, hit.b.pos).multiplyScalar(0.5)) : h.tip;
      if (d.alive) sfx.grunt();
      bloody(h, 0.15); pulse(h, 1, 70);
      if (stab) {
        gore.spray(h.tip, tv2.copy(bladeDir).negate(), 14, 3, 0.7);
        d.addWound(hit, h.tip, bladeDir, 'stab');
        d.stab(hit, tv2.copy(bladeDir).multiplyScalar(2));
        sfx.squish();
        stickTool(t, d, hit ? (hit.name === 'head' ? d.headMesh : hit.mesh) : d.torsoMesh, h);
        return;
      }
      if (def.blunt) {
        if (speed > 4) gore.spray(at, tv, 8, 3, 0.7);
        d.hit(hit, def.dmg, tv2.copy(tv).multiplyScalar(Math.min(12, speed * 1.6)), at);
        d.hp -= 20; if (d.hp <= 0) d.die();
        if (speed > 3.6) d.knockdown(2.5 + Math.random());
        sfx.thud();
      } else {
        gore.spray(at, tv, 16, 4, 0.6);
        d.addWound(hit, at, tv, 'slash');
        if (touch) { if (d.disembowel(gutV) && hit) d.addWound(null, gutV, tv, 'slash'); }
        else if (!hit) d.disembowel(at);
        d.hit(hit, hit ? def.dmg : 3, tv2.copy(tv).multiplyScalar(2.5), at);
        sfx.slice();
      }
    }
  }
  h.prevTip.copy(h.tip);
}

// Chainsaw: no swing needed. Hold the trigger to rev it and whatever the bar
// touches gets chewed through a bit more every tenth of a second.
let sawLevel = 0, sawCutting = false;
function saw(h, t, dt) {
  h.hasTip = false;
  if (!h.trigger) { sawLevel = Math.max(sawLevel, 1); return; }
  sawLevel = 2;
  t.recoil = 0.02 + Math.random() * 0.03;   // rattle
  if ((h.sawBuzz = (h.sawBuzz ?? 0) - dt) <= 0) { h.sawBuzz = 0.08; pulse(h, 0.45, 60); }
  bladeA.copy(t.a.pos).lerp(t.b.pos, t.def.blade);
  bladeDir.subVectors(t.b.pos, t.a.pos).normalize();
  for (const d of dummies) {
    let hit = null, torso = false;
    for (const b of d.bones) {
      const head = b.name === 'head';
      if (head && d.headGone) continue;
      const r = (head ? 0.12 : b.r) + 0.04;
      if (segSeg(bladeA, t.b.pos, head ? b.b.pos : b.a.pos, b.b.pos) < r * r) { hit = b; break; }
    }
    const limbS = segSeg.s;
    // the bar can be on an arm and in the trunk at the same time
    const touch = !d.split && segSeg(bladeA, t.b.pos, d.p.pelvis.pos, d.p.neck.pos) < 0.2 * 0.2;
    const trunkS = segSeg.s;
    if (!hit && touch) torso = true;
    if (!hit && !torso) continue;
    sawCutting = true;
    if (d.sliceCd > 0) continue;
    d.sliceCd = 0.1;
    // where on the bar it's biting
    const at = tv3.copy(bladeA).lerp(t.b.pos, hit ? limbS : trunkS);
    tv.set(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).normalize();
    gore.spray(at, tv, 14, 5, 0.9);
    d.addWound(hit, at, bladeDir, 'slash');
    const onHead = hit?.name === 'head';
    if (!d.split && (onHead || touch)) {
      // sawing down from the head or shoulders splits them lengthways; through the middle cuts them in two
      const top = onHead || d.heightOf(gutV.copy(bladeA).lerp(t.b.pos, trunkS)) > 0.36;
      d.sawTop = (d.sawTop ?? 0) + (top ? 1 : 0); d.sawMid = (d.sawMid ?? 0) + (top ? 0 : 1);
      if (d.sawTop >= 5 ? d.splitVertical() : d.sawMid >= 5 ? d.splitWaist() : false) { sfx.splat(); pulseAll(1, 150); bloody(h, 0.4); continue; }
    }
    if (onHead && !d.split) { d.hp -= 30; d.hurtT = 1; if (d.hp <= 0) d.die(); }
    else d.hit(hit, 1.6, tv2.copy(bladeDir).multiplyScalar(1.2), at);
    if (!hit) d.disembowel(at);
    if (d.alive && Math.random() < 0.3) sfx.grunt();
    bloody(h, 0.06);
  }
}

// leave tool t embedded in a dummy's body part (mesh) and take it out of the hand
function stickTool(t, d, mesh, h) {
  const pos = tv.copy(t.a.pos).addScaledVector(bladeDir, 0.08);
  qInv.copy(mesh.quaternion).invert();
  t.stuck = { d, mesh, lp: pos.clone().sub(mesh.position).applyQuaternion(qInv), lq: qInv.clone().multiply(t.mesh.quaternion) };
  h.held = null; t.held = null; h.hasTip = false;
  gore.emitter(t.b, 4, 22);
}
function updateStuck(t) {
  const st = t.stuck;
  if (st.d.gone || !st.mesh.visible || (st.mesh === st.d.headMesh && st.d.headGone)) {
    t.stuck = null; t.a.pinned = t.b.pinned = false;
    return;
  }
  t.mesh.quaternion.copy(st.mesh.quaternion).multiply(st.lq);
  t.mesh.position.copy(st.lp).applyQuaternion(st.mesh.quaternion).add(st.mesh.position);
  t.a.pos.copy(t.mesh.position); t.b.pos.copy(NEG_Z).applyQuaternion(t.mesh.quaternion).multiplyScalar(t.def.len).add(t.a.pos);
  t.a.prev.copy(t.a.pos); t.b.prev.copy(t.b.pos);
}

// fists (and open hands) shove particles around
function pushHands() {
  for (const h of hands()) {
    if (!h.active || h.held) continue;
    const speed = h.vel.length();
    for (const p of world.particles) {
      if (p.pinned) continue;
      const isDummy = p.body instanceof Dummy;
      if (!isDummy && !p.grab) continue;
      const dx = p.pos.x - h.pos.x, dy = p.pos.y - h.pos.y, dz = p.pos.z - h.pos.z;
      const rr = p.r + 0.07, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-10) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, pen = rr - d;
      p.pos.x += nx * pen; p.pos.y += ny * pen; p.pos.z += nz * pen;
      const vn = h.vel.x * nx + h.vel.y * ny + h.vel.z * nz;
      if (vn > 0) { p.prev.x -= nx * vn * TICK * 0.9; p.prev.y -= ny * vn * TICK * 0.9; p.prev.z -= nz * vn * TICK * 0.9; }
      if (isDummy && speed > 2.2 && h.punchCd <= 0) {
        const dm = p.body, head = p.name === 'head';
        h.punchCd = 0.25;
        dm.hp -= speed * (head ? 7 : 3.5); dm.stun = 1.2;
        if (speed > 4.2) dm.knockdown(2 + Math.random());
        if (speed > 3.2) { gore.spray(p.pos, tv.copy(h.vel).normalize(), head ? 10 : 4, 3, 0.7); bloody(h, 0.2); }
        if (dm.hp <= 0) dm.die();
        sfx.thud(); pulse(h, 1, 70);
      }
    }
  }
}

// ------------------------------------------------------------ player health + survival mode
const P = { hp: 100, dead: false, deadT: 0, flash: 0, lastHit: -99, y: 0, vy: 0, onGround: true };
const SV = { on: false, wave: 0, queue: 0, inter: 0, spawnT: 0, best: 0 };
try { SV.best = +(localStorage.getItem('goreLabBest') || 0); } catch { /* private mode */ }

// red wash over the view when hurt
const hurtMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xb00000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
hurtMesh.renderOrder = 998; hurtMesh.visible = false; camera.add(hurtMesh);

// big text that floats in front of you: wave numbers, deaths
const bannerCanvas = document.createElement('canvas'); bannerCanvas.width = 1024; bannerCanvas.height = 320;
const bannerTex = new THREE.CanvasTexture(bannerCanvas); bannerTex.colorSpace = THREE.SRGBColorSpace;
const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6),
  new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true, depthTest: false, depthWrite: false }));
bannerMesh.position.set(0, 0.28, -2.2); bannerMesh.renderOrder = 999; bannerMesh.visible = false; camera.add(bannerMesh);
let bannerT = 0;
function banner(text, sub = '', secs = 2.5) {
  const g = bannerCanvas.getContext('2d');
  g.clearRect(0, 0, 1024, 320);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.font = 'bold 150px Helvetica, Arial, sans-serif'; g.lineWidth = 18; g.strokeStyle = '#14171c'; g.fillStyle = '#e8792b';
  g.strokeText(text, 512, 120); g.fillText(text, 512, 120);
  if (sub) {
    g.font = 'bold 54px Helvetica, Arial, sans-serif'; g.lineWidth = 10; g.fillStyle = '#f2f4f7';
    g.strokeText(sub, 512, 255); g.fillText(sub, 512, 255);
  }
  bannerTex.needsUpdate = true; bannerT = secs; bannerMesh.visible = true;
}

// health + wave readout: floats over each wrist in VR, DOM bar on desktop
const wristCanvas = document.createElement('canvas'); wristCanvas.width = 256; wristCanvas.height = 128;
const wristTex = new THREE.CanvasTexture(wristCanvas); wristTex.colorSpace = THREE.SRGBColorSpace;
function makeWristHud() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ map: wristTex }));
  m.position.set(0, 0.075, 0.13); m.rotation.x = -0.95;
  return m;
}
for (const h of vrHands) h.ctrl.add(makeWristHud());
let hudKey = '';
function drawHud() {
  const hp = Math.max(0, Math.ceil(P.hp));
  const left = SV.on ? SV.queue + dummies.filter(d => d.wave && d.alive).length : 0;
  const info = SV.on ? 'WAVE ' + SV.wave + (SV.inter > 0 ? ' incoming' : ' · ' + left + ' left') : '';
  const key = hp + info + S.god;
  if (key === hudKey) return;
  hudKey = key;
  const g = wristCanvas.getContext('2d');
  g.fillStyle = '#10141a'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#3a1010'; g.fillRect(12, 12, 232, 52);
  g.fillStyle = hp > 30 ? '#3fb950' : '#e5484d'; g.fillRect(12, 12, 232 * hp / 100, 52);
  g.fillStyle = '#fff'; g.font = 'bold 38px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(S.god ? 'GOD' : hp, 128, 40);
  g.font = 'bold 26px Helvetica, Arial, sans-serif'; g.fillStyle = '#e8792b';
  g.fillText(info || 'KILLS ' + S.kills, 128, 96);
  wristTex.needsUpdate = true;
  $('hpFill').style.width = hp + '%'; $('hpFill').style.background = hp > 30 ? '#3fb950' : '#e5484d';
  $('hpText').textContent = S.god ? 'GOD MODE' : hp;
  $('waveInfo').textContent = info + (SV.on || !SV.best ? '' : 'Best wave ' + SV.best);
}

function damagePlayer(n) {
  if (!started || P.dead || S.god || freecam) return;
  P.hp -= n; P.lastHit = performance.now() / 1000; P.flash = Math.min(0.75, 0.3 + n / 40);
  sfx.hurt(); pulseAll(0.8, 90);
  if (P.hp <= 0) playerDie();
}
function playerDie() {
  P.hp = 0; P.dead = true; P.deadT = 3.5;
  for (const h of [...vrHands, desk]) drop(h);
  if (SV.on) {
    const wave = SV.wave;
    endSurvival();
    banner('GAME OVER', 'Wave ' + wave + ' · ' + S.kills + ' kills · best wave ' + SV.best, 3.5);
  } else banner('YOU DIED', '', 3);
}
function respawn() {
  P.hp = 100; P.dead = false; P.flash = 0;
  P.y = 0; P.vy = 0;
  rig.position.set(0, S.height, 1.5);
  for (const d of dummies) d.knockdown(3);
}
function updatePlayer(dt) {
  const now = performance.now() / 1000;
  P.flash = Math.max(0, P.flash - dt * 1.4);
  if (P.dead) { if ((P.deadT -= dt) <= 0) respawn(); }
  else {
    if (!SV.on && now - P.lastHit > 4) P.hp = Math.min(100, P.hp + 8 * dt);
    // anything hostile within arm's reach hits you
    const head = headPos(), sdt = dt * world.scale;
    for (const d of dummies) {
      if (!d.alive || !(S.hostile || d.aggro)) continue;
      const reach = d.state === 'stand' ? 1.25 : d.state === 'crawl' ? 0.85 : 0;
      if (reach && d.stun < 0.4 && Math.hypot(d.p.chest.pos.x - head.x, d.p.chest.pos.z - head.z) < reach) {
        d.atkT = (d.atkT ?? 0.6) - sdt;
        if (d.atkT <= 0) { d.atkT = 0.9; damagePlayer(d.state === 'crawl' ? 5 : d.dmg ?? 10); }
      } else d.atkT = 0.6;
    }
  }
  const op = Math.max(P.flash, P.dead ? 0.8 : 0, !P.dead && P.hp < 30 ? 0.14 + 0.08 * Math.sin(now * 6) : 0);
  hurtMesh.visible = op > 0.01; hurtMesh.material.opacity = op;
  if (bannerT > 0) { bannerT -= dt; bannerMesh.material.opacity = Math.min(1, bannerT * 2); if (bannerT <= 0) bannerMesh.visible = false; }
  drawHud();
}

function startSurvival() {
  clearAll();
  P.hp = 100; P.dead = false;
  SV.on = true; SV.wave = 0;
  nextWave();
}
function endSurvival() {
  if (!SV.on) return;
  SV.on = false;
  if (SV.wave > SV.best) { SV.best = SV.wave; try { localStorage.setItem('goreLabBest', SV.best); } catch { /* ignore */ } }
  for (const d of dummies) if (d.wave) d.aggro = false;
  hudKey = '';
}
function nextWave() {
  SV.wave++; SV.queue = 3 + SV.wave * 2; SV.inter = SV.wave === 1 ? 3 : 6; SV.spawnT = 0;
  banner('WAVE ' + SV.wave, SV.queue + ' incoming');
  sfx.wave();
}
function updateSurvival(sdt) {
  if (!SV.on || P.dead) return;
  if (SV.inter > 0) { SV.inter -= sdt; return; }
  const alive = dummies.filter(d => d.wave && d.alive).length;
  SV.spawnT -= sdt;
  if (SV.queue > 0 && SV.spawnT <= 0 && alive < 8 && (dummies.length < MAX_DUMMIES || dummies.some(d => !d.alive))) {
    // come in from somewhere away from the player and clear of the table
    const head = headPos();
    let x = 0, z = -6;
    for (let i = 0; i < 20; i++) {
      x = (Math.random() - 0.5) * 13; z = (Math.random() - 0.5) * 13;
      if (Math.hypot(x - head.x, z - head.z) > 5 && !insideBox(x, z)) break;
    }
    const brute = SV.wave >= 3 && Math.random() < 0.18;
    const d = spawnDummy(x, z, brute
      ? { ...DUMMY_TYPES.brute, aggro: true, speed: 1 }
      : { ...DUMMY_TYPES.zombie, speed: Math.min(2, 1.15 + SV.wave * 0.07) });
    d.wave = true; d.dmg = brute ? 20 : 10;
    SV.queue--; SV.spawnT = Math.max(0.35, 1.1 - SV.wave * 0.06);
  } else if (SV.queue === 0 && alive === 0) {
    // wave cleared: patch up, sweep the bodies out, go again
    P.hp = Math.min(100, P.hp + 25);
    for (let i = dummies.length - 1; i >= 0; i--) if (!dummies[i].alive) { releaseBody(dummies[i]); dummies[i].dispose(); dummies.splice(i, 1); }
    nextWave();
  }
}

// ------------------------------------------------------------ main menu (floating panel, pauses the game)
let paused = false, played = false;
const UI = { w: 1.7, h: 1.5, hover: -1, side: 0, follow: 0, head: 180, rowH: 102, help: -1 };
UI.canvas = document.createElement('canvas'); UI.canvas.width = 1024; UI.canvas.height = 900;
UI.tex = new THREE.CanvasTexture(UI.canvas); UI.tex.colorSpace = THREE.SRGBColorSpace;
UI.mesh = new THREE.Mesh(new THREE.PlaneGeometry(UI.w, UI.h), new THREE.MeshBasicMaterial({ map: UI.tex }));
UI.mesh.visible = false; scene.add(UI.mesh);
UI.dots = [0, 1].map(() => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); d.visible = false; scene.add(d); return d; });
// sel: true = the left half steps back, the right half steps forward
const UI_ROWS = [
  { label: () => played ? 'RESUME' : 'PLAY SANDBOX', act: () => closeMenu() },
  { label: () => SV.on ? 'RESTART SURVIVAL' : 'PLAY SURVIVAL', act: () => { closeMenu(); startSurvival(); } },
  { sel: true, label: () => 'MAP:  ' + MAPS[S.map].name, act: d => setMap(MAP_KEYS[(MAP_KEYS.indexOf(S.map) + d + MAP_KEYS.length) % MAP_KEYS.length]) },
  { sel: true, label: () => 'MUSIC:  ' + trackName(), act: d => setTrack((S.track + 1 + d + music.tracks.length + 1) % (music.tracks.length + 1) - 1) },
  { sel: true, label: () => 'MUSIC VOLUME:  ' + Math.round(music.volume * 100) + '%', act: d => setVolume(music.volume + d * 0.1) },
  { sel: true, label: () => 'HEIGHT:  ' + fmtHeight(), act: d => setHeight(S.height + d * 0.05) },
  { label: () => 'INSTRUCTIONS', act: () => { UI.help = 0; } },
];
// what the INSTRUCTIONS button shows, a page at a time
const HELP = [
  ['MOVING', [
    'Left stick: walk.   Right stick: turn.',
    'A: jump. You can get up on crates and the table.',
    'Click either stick in: open or close this menu.',
    'Too tall or too short? Change HEIGHT in this menu.',
    'Desktop: WASD, mouse, Space to jump, M for menu.',
  ]],
  ['HANDS AND GUNS', [
    'Grip: grab and let go. Point and grip to pull things to you.',
    'Trigger: shoot.   Grip alone points your finger.',
    'Long guns: grip the barrel with your other hand to steady them.',
    'Holsters: let go of a weapon at either hip or over your',
    'right shoulder to stow it. Grip there to draw it again.',
    'Desktop: E grab, click shoot, B holster or draw.',
  ]],
  ['BLADES', [
    'Swing to slash. Thrust to stab: the blade stays stuck in.',
    'Grip a stuck blade to pull it out.',
    'Slash the belly and the guts spill out.',
    'Katana: a hard downward stroke splits them in half.',
    'A hard level stroke through the waist cuts them in two.',
    'Chainsaw: hold the trigger. Keep it in them to saw through.',
  ]],
  ['GUNSHOTS', [
    'Each hit to the same spot goes deeper: skin, muscle, bone.',
    'Pistol, SMG and rifle take pieces off a head.',
    'Revolver and shotgun take the whole head.',
    'Wounded dummies hold the wound and slowly bleed out.',
    'Barrels, grenades, mines and rockets set each other off.',
  ]],
  ['SPAWN GUN', [
    'Hold it, then use that hand\'s stick:',
    'up / down picks an item, left / right changes tab.',
    'Trigger spawns it where the blue dot is.',
    'Tabs: Weapons, NPCs, Props, World, Music, Maps.',
    'Desktop: mouse wheel or Z / X to pick, Q for the next tab.',
  ]],
  ['SURVIVAL AND HEALTH', [
    'Your health and the wave count float over your wrists.',
    'Hostile dummies and zombies hit you at arm\'s reach.',
    'Explosions hurt you too, including your own.',
    'Survival: zombies come in waves. Each wave heals you a bit.',
    'B: slow-mo.   X: hostile on / off.   Y: clear everything.',
  ]],
];
const HELP_ROWS = [
  { label: () => '◀  BACK TO MENU', act: () => { UI.help = -1; } },
  null, null, null, null, null,
  { sel: true, label: () => 'PAGE ' + (UI.help + 1) + ' / ' + HELP.length, act: d => { UI.help = (UI.help + d + HELP.length) % HELP.length; } },
];
const uiRows = () => UI.help >= 0 ? HELP_ROWS : UI_ROWS;
function drawMainMenu() {
  if (!UI.mesh.visible) return;
  const g = UI.canvas.getContext('2d'), W = 1024, H = 900;
  g.fillStyle = '#14171c'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8792b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 110px Helvetica, Arial, sans-serif'; g.fillText('GORE LAB', W / 2, 80);
  g.fillStyle = '#8b94a1'; g.font = '30px Helvetica, Arial, sans-serif';
  g.fillText(inVR ? 'point and pull the trigger · click a stick to open this menu' : 'click to choose · M opens this menu', W / 2, 152);
  if (UI.help >= 0) {
    const [title, lines] = HELP[UI.help], top = UI.head + UI.rowH;
    g.fillStyle = '#1c2026'; g.fillRect(40, top + 6, W - 80, UI.rowH * 5 - 12);
    g.fillStyle = '#e8792b'; g.font = 'bold 52px Helvetica, Arial, sans-serif'; g.fillText(title, W / 2, top + 50);
    g.fillStyle = '#f2f4f7'; g.font = '33px Helvetica, Arial, sans-serif';
    lines.forEach((ln, i) => g.fillText(ln, W / 2, top + 122 + i * 62));
  }
  uiRows().forEach((r, i) => {
    if (!r) return;
    const y = UI.head + i * UI.rowH, hot = i === UI.hover;
    g.fillStyle = hot ? '#e8792b' : i < 2 && UI.help < 0 ? '#3a2a1c' : '#2a3038'; g.fillRect(40, y + 8, W - 80, UI.rowH - 16);
    g.fillStyle = hot ? '#14171c' : '#f2f4f7'; g.font = 'bold 46px Helvetica, Arial, sans-serif';
    g.fillText(r.label(), W / 2, y + UI.rowH / 2);
    if (r.sel) {
      g.font = 'bold 64px Helvetica, Arial, sans-serif';
      g.globalAlpha = hot && UI.side < 0 ? 1 : 0.5; g.fillText('◀', 96, y + UI.rowH / 2);
      g.globalAlpha = hot && UI.side > 0 ? 1 : 0.5; g.fillText('▶', W - 96, y + UI.rowH / 2);
      g.globalAlpha = 1;
    }
  });
  UI.tex.needsUpdate = true;
}
function placeMenu() {
  const head = headPos();
  camera.getWorldDirection(tv); tv.y = 0;
  if (tv.lengthSq() < 0.01) tv.set(0, 0, -1);
  tv.normalize();
  UI.mesh.position.copy(head).addScaledVector(tv, 1.9);
  UI.mesh.position.y = Math.max(1.0, head.y - 0.05);
  UI.mesh.lookAt(head.x, UI.mesh.position.y, head.z);
}
function openMenu() {
  paused = true; UI.mesh.visible = true; UI.hover = -1; UI.help = -1;
  for (const h of [...vrHands, desk]) h.trigger = false;
  rig.updateMatrixWorld(true); placeMenu(); drawMainMenu();
}
function closeMenu() {
  paused = false; played = true; UI.mesh.visible = false;
  for (const d of UI.dots) d.visible = false;
  hudKey = '';
}
// where a ray meets the menu panel: {row, side, point} or null
const uiQ = new THREE.Quaternion(), uiO = new V3(), uiD = new V3(), uiPt = new V3();
function menuPoint(o, d) {
  uiQ.copy(UI.mesh.quaternion).invert();
  uiO.copy(o).sub(UI.mesh.position).applyQuaternion(uiQ); uiD.copy(d).applyQuaternion(uiQ);
  if (uiD.z > -1e-4) return null;
  const t = -uiO.z / uiD.z, x = uiO.x + uiD.x * t, y = uiO.y + uiD.y * t;
  const u = x / UI.w + 0.5, v = 0.5 - y / UI.h;
  if (t < 0 || u < 0 || u > 1 || v < 0 || v > 1) return null;
  const row = Math.floor((v * 900 - UI.head) / UI.rowH);
  uiPt.copy(o).addScaledVector(d, t - 0.01);
  return { row: row >= 0 && row < uiRows().length && uiRows()[row] ? row : -1, side: u < 0.5 ? -1 : 1, point: uiPt };
}
function menuActivate(hit) {
  if (!hit || hit.row < 0) return;
  const r = uiRows()[hit.row];
  sfx.beep(); r.act(r.sel ? hit.side : 0);
  drawMainMenu();
}
// desktop: aim the menu with the mouse cursor, or the crosshair once the mouse is captured
function deskMenuRay() {
  if (locked) return tv.copy(NEG_Z).applyQuaternion(camera.getWorldQuaternion(tq));
  return tv.set(mouseN.x, mouseN.y, 0.5).unproject(camera).sub(headPos()).normalize();
}
function menuClick() { menuActivate(menuPoint(headPos(), deskMenuRay())); }
function updateMainMenu() {
  if (UI.follow > 0) { UI.follow--; placeMenu(); }
  let hover = -1, side = 0;
  const point = (i, o, d) => {
    const hit = menuPoint(o, d);
    UI.dots[i].visible = !!hit;
    if (hit) { UI.dots[i].position.copy(hit.point); if (hit.row >= 0) { hover = hit.row; side = hit.side; } }
    return hit;
  };
  if (inVR) {
    vrHands.forEach((h, i) => {
      if (!h.active) { UI.dots[i].visible = false; return; }
      const hit = point(i, h.pos, tv.copy(NEG_Z).applyQuaternion(h.quat));
      if (h.trigger && !h.menuWas) menuActivate(hit);
      h.menuWas = h.trigger;
    });
  } else point(0, headPos(), deskMenuRay());
  if (paused && (hover !== UI.hover || side !== UI.side)) { UI.hover = hover; UI.side = side; drawMainMenu(); }
}

// ------------------------------------------------------------ player movement
const keys = {};
let yaw = 0, pitch = 0, locked = false, noLock = false, dragging = false, freecam = false, teleported = false;

function jump() {
  if (paused || P.dead || !P.onGround) return;
  P.vy = 5; P.onGround = false;
}
// gravity for the player, plus crates and tables you can stand on or bump into
function playerPhysics(dt) {
  const head = headPos(), pad = 0.22;
  let ground = 0;
  for (const b of world.boxes) {
    const x1 = head.x - (b.min.x - pad), x2 = (b.max.x + pad) - head.x, z1 = head.z - (b.min.z - pad), z2 = (b.max.z + pad) - head.z;
    if (x1 <= 0 || x2 <= 0 || z1 <= 0 || z2 <= 0) continue;
    if (P.y >= b.max.y - 0.3) { ground = Math.max(ground, b.max.y); continue; }   // on top of it, or a step low enough to walk up
    const m = Math.min(x1, x2, z1, z2);
    if (m === x1) rig.position.x -= x1; else if (m === x2) rig.position.x += x2; else if (m === z1) rig.position.z -= z1; else rig.position.z += z2;
  }
  P.vy += world.gravity * dt; P.y += P.vy * dt;
  if (P.y <= ground) { P.y = ground; P.vy = 0; P.onGround = true; } else P.onGround = false;
  rig.position.y = S.height + P.y;
}
function clampRig() {
  const p = headPos(), lim = HALF - 0.35;
  if (p.x > lim) rig.position.x -= p.x - lim; else if (p.x < -lim) rig.position.x -= p.x + lim;
  if (p.z > lim) rig.position.z -= p.z - lim; else if (p.z < -lim) rig.position.z -= p.z + lim;
}
function desktopMove(dt) {
  const look = 1.8 * dt;
  if (keys.ArrowLeft) yaw += look; if (keys.ArrowRight) yaw -= look;
  if (keys.ArrowUp) pitch += look; if (keys.ArrowDown) pitch -= look;
  pitch = Math.max(-1.5, Math.min(1.5, pitch));
  camera.rotation.set(pitch, yaw, 0);
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (freecam) {
    camera.getWorldDirection(tv);
    rig.position.addScaledVector(tv, f * 7 * dt);
    rig.position.x += Math.cos(yaw) * s * 7 * dt; rig.position.z -= Math.sin(yaw) * s * 7 * dt;
    rig.position.y += ((keys.Space ? 1 : 0) - (keys.ShiftLeft ? 1 : 0)) * 5 * dt;
  } else {
    const sp = (keys.ShiftLeft ? 5.5 : 3.2) * dt;
    rig.position.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp;
    rig.position.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp;
    playerPhysics(dt);
    clampRig();
  }
}
function vrMove(dt) {
  for (const h of vrHands) {
    const gp = h.src?.gamepad;
    if (!gp) continue;
    const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0, ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
    const left = h.src.handedness === 'left';
    if (h.held?.tool?.def.spawner) {
      h.navCd = (h.navCd ?? 0) - dt;
      if (Math.abs(ax) < 0.4 && Math.abs(ay) < 0.4) h.navCd = 0;
      else if (h.navCd <= 0) {
        if (Math.abs(ay) > 0.6) { menuMove(0, Math.sign(ay)); h.navCd = 0.22; }
        else if (Math.abs(ax) > 0.6) { menuMove(Math.sign(ax), 0); h.navCd = 0.35; }
      }
    } else if (left) {
      if (Math.hypot(ax, ay) > 0.15) {
        camera.getWorldDirection(tv); tv.y = 0; tv.normalize();
        rig.position.x += (tv.x * -ay - tv.z * ax) * 2.6 * dt;
        rig.position.z += (tv.z * -ay + tv.x * ax) * 2.6 * dt;
      }
    } else if (Math.abs(ax) > 0.6 && !h.snapped) {
      h.snapped = true;
      const a = -Math.sign(ax) * Math.PI / 6, p = headPos();
      rig.position.sub(p).applyAxisAngle(UP, a).add(p);
      rig.rotation.y += a;
      teleported = true;
    } else if (Math.abs(ax) < 0.3) h.snapped = false;
    // clicking either stick opens / closes the main menu
    const click = !!gp.buttons[3]?.pressed;
    if (click && !h.stickWas) paused ? closeMenu() : openMenu();
    h.stickWas = click;
    if (paused) continue;
    // face buttons: right A = jump, B = slow-mo; left X = hostile, Y = clear
    for (let i = 0; i < 2; i++) {
      const down = !!gp.buttons[4 + i]?.pressed;
      if (down && !h.btn[i]) { if (!left && !i) jump(); else { panelCd = 0; press(left ? (i ? 3 : 4) : 5); } }
      h.btn[i] = down;
    }
  }
  playerPhysics(dt);
  clampRig();
}

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!started || inVR || e.repeat) return;
  if (e.code === 'BracketLeft') setHeight(S.height - 0.05);
  if (e.code === 'BracketRight') setHeight(S.height + 0.05);
  const map = paused ? {} : { Digit1: 0, Digit2: 2, Digit5: 1, KeyC: 3, KeyH: 4, KeyT: 5, KeyG: 6, KeyR: 7, KeyV: 8, KeyI: 9 };
  if (e.code in map) { panelCd = 0; press(map[e.code]); }
  if (e.code === 'KeyM') { paused ? closeMenu() : openMenu(); return; }
  if (paused) return;
  if (e.code === 'KeyE') desk.held ? drop(desk) : grab(desk);
  if (e.code === 'KeyB') holsterKey();
  if (e.code === 'Space' && !freecam) jump();
  if (e.code === 'KeyQ' || e.code === 'Tab') { e.preventDefault(); menuMove(e.shiftKey ? -1 : 1, 0); }
  if (e.code === 'KeyZ') menuMove(0, -1);
  if (e.code === 'KeyX') menuMove(0, 1);
  if (e.code === 'KeyF') { freecam = !freecam; $('free').hidden = !freecam; }
  if (e.code === 'Space' && !freecam) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('mousedown', e => {
  if (!started || inVR) return;
  sfx.init();
  if (e.button === 2) { desk.held ? drop(desk) : grab(desk); return; }
  if (e.button !== 0) return;
  if (paused) { mouseN.x = e.clientX / innerWidth * 2 - 1; mouseN.y = 1 - e.clientY / innerHeight * 2; menuClick(); return; }
  dragging = true;
  if (!locked && !noLock) { try { canvas.requestPointerLock()?.catch?.(() => { noLock = true; }); } catch { noLock = true; } }
  desk.trigger = true;
  const tool = desk.held?.type === 'tool' ? desk.held.tool : null;
  if (tool?.def.saw) return;   // the saw just runs while the button is held
  if (!tool || tool.def.melee) {
    if (!desk.held) {
      // empty hand: press a panel button if we're pointing at one, otherwise punch
      dirV.copy(NEG_Z).applyQuaternion(camera.getWorldQuaternion(tq));
      const r = hitscan(headPos(), dirV);
      if (r.kind === 'panel' && r.t < 5) { press(r.index); return; }
    }
    if (desk.jab <= 0) desk.jab = 0.22;
  }
});
addEventListener('mouseup', e => { if (e.button === 0) { dragging = false; desk.trigger = false; } });
const mouseN = { x: 0, y: 0 };
addEventListener('mousemove', e => {
  mouseN.x = e.clientX / innerWidth * 2 - 1; mouseN.y = 1 - e.clientY / innerHeight * 2;
  if (inVR || !(locked || dragging)) return;
  yaw -= e.movementX * 0.0024; pitch -= e.movementY * 0.0024;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { if (started && !inVR && desk.held?.tool?.def.spawner) menuMove(0, Math.sign(e.deltaY)); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.addEventListener('pointerlockerror', () => { noLock = true; });

// ------------------------------------------------------------ start / VR session
function begin() {
  if (started) return;
  started = true;
  sfx.init();
  $('screen').hidden = true;
  resetItems(); spawnBarrel(3.5, -5.5);
  spawnDummy(-2, -4.5); spawnDummy(0.5, -5.5); spawnDummy(2.5, -4);
  setMap(S.map);
  music.play(S.track);
  openMenu();
}
$('playDesktop').addEventListener('click', () => { begin(); $('hud').hidden = false; });
$('enterVR').addEventListener('click', async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    begin();
    session.addEventListener('end', () => {
      inVR = false; drop(vrHands[0]); drop(vrHands[1]);
      for (const h of vrHands) h.glove.visible = false;
      camera.position.set(0, 1.65, 0); rig.rotation.y = 0; rig.position.y = 0; yaw = pitch = 0;
      $('hud').hidden = false; resize();
    });
    await renderer.xr.setSession(session);
    drop(desk); inVR = true; freecam = false; desk.glove.visible = false;
    for (const h of vrHands) h.glove.visible = false;
    $('hud').hidden = true;
    rig.position.set(0, S.height, 1.5); rig.rotation.y = 0;
    UI.follow = 30;   // keep the menu in front until the headset pose arrives
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  } catch (err) {
    $('vrNote').textContent = 'Could not start VR: ' + err.message;
  }
});
if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    $('enterVR').disabled = !ok;
    if (!ok) $('vrNote').textContent = 'No VR headset detected in this browser. Open this page in the Quest browser to play in VR.';
  }).catch(() => {});
} else {
  $('enterVR').disabled = true;
  $('vrNote').textContent = 'This browser has no WebXR. Open this page in the Quest browser to play in VR.';
}

function resize() {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------ main loop
let last = 0, acc = 0;
renderer.setAnimationLoop(time => {
  const dt = Math.min(0.05, (time - last) / 1000 || 0.016); last = time;
  if (started) {
    if (inVR) vrMove(dt); else desktopMove(dt);
    rig.updateMatrixWorld(true);
    panelCd -= dt;
    updateHolsters();
    spawnDotOn = false; sawLevel = 0; sawCutting = false;
    for (const h of hands()) updateHand(h, dt);
    sfx.saw(sawLevel, sawCutting);
    spawnDot.visible = spawnDotOn;
    $('spawnHud').hidden = !(spawnDotOn && !inVR);
    // touching a panel button with a hand presses it
    if (inVR) for (const h of vrHands) {
      const i = h.active && h.pos.x > PANEL.x - 0.1 ? panelIndex(h.pos.y, h.pos.z) : -1;
      if (i >= 0 && i !== h.touching) press(i);
      h.touching = i;
    }
    teleported = false;

    const head = headPos();
    if (paused) updateMainMenu(); else acc += dt;
    let n = 0;
    while (acc >= TICK && n < 4) {
      for (const d of dummies) d.tick(world.dt, head, S.hostile || d.aggro);
      world.step();
      pushHands();
      gore.update(world.dt);
      acc -= TICK; n++;
    }
    if (n === 4) acc = 0;

    for (const d of dummies) d.sync();
    for (const t of tools) {
      if (t.flashT > 0 && (t.flashT -= dt) <= 0) t.flash.visible = false;
      if (t.stuck) { updateStuck(t); continue; }
      if (t.holster) { updateHolstered(t); continue; }
      if (t.held) continue;
      t.mesh.position.copy(t.a.pos);
      t.mesh.quaternion.setFromUnitVectors(NEG_Z, tv.subVectors(t.b.pos, t.a.pos).normalize());
    }
    for (const b of barrels) {
      b.mesh.position.addVectors(b.a.pos, b.b.pos).multiplyScalar(0.5);
      b.mesh.quaternion.setFromUnitVectors(UP, tv.subVectors(b.b.pos, b.a.pos).normalize());
    }
    for (const b of balls) b.mesh.position.copy(b.p.pos);
    if (!paused) {
      updateExplosives(dt * world.scale);
      updateSurvival(dt * world.scale);
      updatePlayer(dt);
    }
    gore.sync(time);
    for (const tr of tracers) if (tr.m.visible) { tr.t -= dt; tr.m.material.opacity = Math.max(0, tr.t / 0.07); if (tr.t <= 0) tr.m.visible = false; }
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i]; e.t += dt;
      e.mesh.scale.setScalar((0.3 + e.t * 16) * (e.size ?? 1)); e.mesh.material.opacity = Math.max(0, 0.9 - e.t * 3.2);
      if (e.t > 0.3) { scene.remove(e.mesh); e.mesh.material.dispose(); explosions.splice(i, 1); }
    }
  }
  renderer.render(scene, camera);
});

// for poking at things from the console
window.lab = { holsters, jump, HELP, UI, UI_ROWS, MAPS, setMap, setTrack, setHeight, openMenu, closeMenu, menuActivate, music, get paused() { return paused; }, P, SV, damagePlayer, startSurvival, world, dummies, tools, barrels, balls, grenades, mines, rockets, menu, menuMove, S, gore, desk, rig, camera, press, grab, drop, spawnDummy, spawnBarrel,
  look(y, p) { yaw = y; pitch = p; }, get state() { return { started, inVR, freecam, locked, noLock }; } };

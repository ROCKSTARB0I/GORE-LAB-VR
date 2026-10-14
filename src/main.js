import * as THREE from '../vendor/three.module.js';
import { World, Particle, HALF, setHalf, WALL_H, TICK, segSeg } from './physics.js?v=17';
import { Dummy } from './ragdoll.js?v=17';
import { Gore } from './gore.js?v=17';
import { sfx, music } from './audio.js?v=17';

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

function addSky(g, night) {
  if (night) {
    const starPos = [];
    for (let i = 0; i < 600; i++) { const a = Math.random() * Math.PI * 2, e = 0.12 + Math.random() * 1.4; starPos.push(Math.cos(a) * Math.cos(e) * 90, Math.sin(e) * 90, Math.sin(a) * Math.cos(e) * 90); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true, fog: false })));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf2f0e0, fog: false }));
    moon.position.set(-35, 55, -55); g.add(moon);
    const cloud = new THREE.MeshBasicMaterial({ color: 0x1c2232, fog: false });
    for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 5, 10, 8), cloud); c.scale.y = 0.3; c.position.set((Math.random() - 0.5) * 140, 34 + Math.random() * 10, (Math.random() - 0.5) * 140); g.add(c); }
  } else {
    const cloud = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 5, 10, 8), cloud); c.scale.y = 0.3; c.position.set((Math.random() - 0.5) * 140, 32 + Math.random() * 12, (Math.random() - 0.5) * 140); g.add(c); }
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6c0, fog: false }));
    sunBall.position.set(40, 70, 30); g.add(sunBall);
  }
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
    build(g, boxes, day = false) {
      addFloor(g, new THREE.MeshLambertMaterial({ map: tiled(noiseTex('#3a3d44', 30), HALF / 2, HALF / 2) }));
      addWalls(g, 1.1, new THREE.MeshLambertMaterial({ color: 0x70747c }), new THREE.MeshBasicMaterial({ color: 0xff3df2 }));
      const cap = new THREE.MeshLambertMaterial({ color: 0x8a8f98 });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, m = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.4, 0.08, 0.4), cap);
        m.position.set(-Math.sin(a) * (HALF + 0.1), 1.12, -Math.cos(a) * (HALF + 0.1)); m.rotation.y = a; g.add(m);
      }
      // city around and below
      const winTex = day
        // by day: concrete and glass, windows catching the sky
        ? canvasTex(64, 128, (c, w, h) => {
          c.fillStyle = ['#8a929c', '#9c958a', '#7a8592'][Math.floor(Math.random() * 3)]; c.fillRect(0, 0, w, h);
          for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) { c.fillStyle = Math.random() < 0.7 ? '#a9c4dc' : '#5b6b7c'; c.fillRect(x, y, 4, 5); }
        })
        : canvasTex(64, 128, (c, w, h) => {
          c.fillStyle = '#0b0d16'; c.fillRect(0, 0, w, h);
          for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) if (Math.random() < 0.4) { c.fillStyle = Math.random() < 0.8 ? '#ffd98a' : '#8ad1ff'; c.fillRect(x, y, 4, 5); }
        });
      const tower = day ? new THREE.MeshLambertMaterial({ map: winTex }) : new THREE.MeshBasicMaterial({ map: winTex });
      for (let i = 0; i < 34; i++) {
        const a = i / 34 * Math.PI * 2 + Math.random() * 0.1, r = 22 + Math.random() * 30, w = 5 + Math.random() * 7, top = -8 + Math.random() * 30;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 60, w), tower);
        m.position.set(Math.sin(a) * r, top - 30, Math.cos(a) * r); g.add(m);
      }
      const street = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: day ? 0x4a4e55 : 0x05060c }));
      street.rotation.x = -Math.PI / 2; street.position.y = -40; g.add(street);
      if (day) {
        addSky(g, false);
      } else {
      const starPos = [];
      for (let i = 0; i < 500; i++) { const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.35; starPos.push(Math.cos(a) * Math.cos(e) * 90, Math.sin(e) * 90, Math.sin(a) * Math.cos(e) * 90); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
      g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true })));
      const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf2f0e0 }));
      moon.position.set(30, 55, -60); g.add(moon);
      }
      const metal = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
      addBlock(g, boxes, metal, 4.5, 0, -4.5, 1.8, 1.2, 1.2);
      addBlock(g, boxes, metal, -5.5, 0, 4.5, 1.2, 1.4, 1.8);
      addBlock(g, boxes, new THREE.MeshLambertMaterial({ color: 0x5c6068 }), 5.5, 0, 5, 2.4, 2.5, 2.4);
    },
  },
  backyard: {
    name: 'Backyard', bg: 0x8ec9f0, hemi: [0xffffff, 0x7fa860, 2.3], sun: [0xfff3d0, 1.9], wallH: 1.8,
    build(g, boxes, night = false) {
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
      addSky(g, night);
      if (night) {
        // a porch light on the shed and a few fireflies over the grass
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd48a }));
        bulb.position.set(4.4, 2.1, -5.8); g.add(bulb);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0.18, depthWrite: false }));
        glow.position.copy(bulb.position); g.add(glow);
        const flyMat = new THREE.MeshBasicMaterial({ color: 0xd8ff7a });
        for (let i = 0; i < 24; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.02, 5, 4), flyMat); f.position.set((Math.random() - 0.5) * 14, 0.4 + Math.random() * 1.6, (Math.random() - 0.5) * 14); g.add(f); }
      }
      addBlock(g, boxes, new THREE.MeshLambertMaterial({ color: 0x9c4a2e }), 5.8, 0, -5.8, 2.6, 2.3, 2.6);   // shed
      addBlock(g, boxes, new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }), -5.5, 0, 5.5, 2.0, 0.45, 1.0);  // bench
    },
  },
  backyardNight: {
    name: 'Backyard (Night)', short: 'Yard Night', bg: 0x0a0f1e, fog: [0x0a0f1e, 18, 80], hemi: [0x6a7cb0, 0x10180e, 0.95], sun: [0xa8b8ff, 0.55], wallH: 1.8,
    build(g, boxes) { MAPS.backyard.build(g, boxes, true); },
  },
  rooftopDay: {
    name: 'Rooftop (Day)', short: 'Roof Day', bg: 0x9cc8ea, fog: [0x9cc8ea, 60, 160], hemi: [0xffffff, 0x8a8f98, 2.2], sun: [0xfff3d8, 1.8], wallH: 1.1,
    build(g, boxes) { MAPS.rooftop.build(g, boxes, true); },
  },
  town: {
    name: 'Abandoned Town', short: 'Town', half: 22, bg: 0x6b5f55, fog: [0x6b5f55, 16, 75], hemi: [0xe0cdb0, 0x3a352e, 1.7], sun: [0xffc890, 1.2], wallH: 2.2,
    build(g, boxes) {
      addFloor(g, new THREE.MeshLambertMaterial({ map: tiled(noiseTex('#5e5548', 38), HALF / 2, HALF / 2) }));
      // cracked road down the middle with a faded centre line
      const road = new THREE.Mesh(new THREE.PlaneGeometry(10, HALF * 2), new THREE.MeshLambertMaterial({ map: tiled(noiseTex('#2f2f31', 30, (c, w, h) => {
        c.fillStyle = 'rgba(200,170,60,.5)'; c.fillRect(w / 2 - 3, 20, 6, 90); c.fillRect(w / 2 - 3, 150, 6, 90);
        c.strokeStyle = 'rgba(15,15,15,.8)'; c.lineWidth = 2;
        for (let i = 0; i < 6; i++) { c.beginPath(); let x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 30; c.lineTo(x, y); } c.stroke(); }
      }), 1, HALF / 4) }));
      road.rotation.x = -Math.PI / 2; road.position.y = 0.004; g.add(road);
      const walk = new THREE.MeshLambertMaterial({ map: tiled(noiseTex('#8a8478', 26, (c, w, h) => { c.strokeStyle = 'rgba(40,40,40,.6)'; c.lineWidth = 3; c.strokeRect(0, 0, w, h); }), 1, HALF / 1.5) });
      for (const sx of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, HALF * 2), walk); sw.position.set(sx * 6.5, 0.06, 0); g.add(sw); }
      // chain-link fence round the edge
      const fenceTex = canvasTex(64, 64, (c, w, h) => { c.strokeStyle = '#9aa0a6'; c.lineWidth = 2; for (let i = -64; i < 128; i += 12) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 64, 64); c.stroke(); c.beginPath(); c.moveTo(i + 64, 0); c.lineTo(i, 64); c.stroke(); } });
      tiled(fenceTex, HALF * 2, 4);
      addWalls(g, 2.2, new THREE.MeshLambertMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
      // ruined buildings along both sides
      const wallTex = (base) => canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = base; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
        for (let y = 14; y < h - 20; y += 42) for (let x = 14; x < w - 20; x += 40) {
          const r = Math.random();
          c.fillStyle = r < 0.55 ? '#121212' : r < 0.8 ? '#6b4a2a' : '#2a3a44';   // dark hole, boarded up, dusty glass
          c.fillRect(x, y, 22, 26);
          if (r >= 0.55 && r < 0.8) { c.fillStyle = '#4a3420'; c.fillRect(x - 2, y + 6, 26, 4); c.fillRect(x - 2, y + 16, 26, 4); }
        }
        c.fillStyle = 'rgba(30,25,20,.45)'; c.fillRect(0, h - 18, w, 18);
      });
      const looks = ['#7a5a48', '#8a8274', '#6e6a5e', '#7c4f3c', '#5f6a6a'].map(b => new THREE.MeshLambertMaterial({ map: wallTex(b) }));
      const rubble = new THREE.MeshLambertMaterial({ color: 0x77706a });
      for (const side of [-1, 1]) for (let z = -18; z <= 18; z += 9) {
        const w = 7 + Math.random() * 2, d = 6 + Math.random() * 2, h = 3.5 + Math.random() * 5.5;
        const x = side * (12.5 + Math.random() * 2);
        addBlock(g, boxes, looks[Math.floor(Math.random() * looks.length)], x, 0, z, d, h, w);
        // broken-off top
        for (let k = 0; k < 3; k++) { const bw = 1 + Math.random() * 2.5, bh = 0.5 + Math.random() * 1.6; const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), rubble); m.position.set(x + (Math.random() - 0.5) * (d - bw), h + bh / 2 - 0.2, z + (Math.random() - 0.5) * (w - bw)); g.add(m); }
      }
      for (const z of [-20, 20]) for (const x of [-7, 7]) addBlock(g, boxes, looks[Math.floor(Math.random() * looks.length)], x, 0, z, 6, 4 + Math.random() * 3, 3.5);
      // wrecked cars
      const rust = [0x6e3b26, 0x4b5560, 0x5e5a3a, 0x7a2a20].map(c => new THREE.MeshLambertMaterial({ color: c })), glass = new THREE.MeshLambertMaterial({ color: 0x1c2228 });
      for (const [x, z, flip] of [[3.2, -8, 0], [-3.4, -14, 0], [2.6, 9, 1], [-3.1, 15, 0], [3.4, 17, 0]]) {
        const mat = rust[Math.floor(Math.random() * rust.length)];
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.3), mat), cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.1), glass);
        body.position.set(x, flip ? 0.95 : 0.4, z); cab.position.set(x, flip ? 0.3 : 1.02, z - 0.2);
        g.add(body, cab);
        for (const dx of [-0.85, 0.85]) for (const dz of [-1.4, 1.4]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10), new THREE.MeshLambertMaterial({ color: 0x151515 })); wh.rotation.z = Math.PI / 2; wh.position.set(x + dx, flip ? 1.35 : 0.33, z + dz); g.add(wh); }
        boxes.push({ min: new V3(x - 0.95, 0, z - 2.2), max: new V3(x + 0.95, flip ? 1.45 : 1.3, z + 2.2) });
      }
      // leaning street lamps, junk
      const pole = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
      for (let z = -18; z <= 18; z += 12) for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), pole);
        p.position.set(sx * 5.4, 2.5, z + sx * 3); p.rotation.z = (Math.random() - 0.5) * 0.35; g.add(p);
      }
      const junk = [0x6b5a44, 0x55585c, 0x4a3a28, 0x7a7a70].map(c => new THREE.MeshLambertMaterial({ color: c }));
      for (let i = 0; i < 70; i++) {
        const sz = 0.15 + Math.random() * 0.5, m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.5, sz * (0.5 + Math.random())), junk[i % 4]);
        let x = (Math.random() - 0.5) * 2 * (HALF - 1), z = (Math.random() - 0.5) * 2 * (HALF - 1);
        if (Math.abs(x) < 3.5 && Math.abs(z) < 4) x += 5;
        m.position.set(x, sz * 0.25, z); m.rotation.y = Math.random() * 3; g.add(m);
      }
      for (const [x, z] of [[5.5, -4], [-5.8, 6], [6, 13]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), new THREE.MeshLambertMaterial({ color: 0x2a201a })); b.position.set(x, 0.45, z); g.add(b); }
    },
  },
  yard: {
    name: 'Construction Yard', short: 'Yard', half: 16, bg: 0x9fb6c8, fog: [0x9fb6c8, 25, 90], hemi: [0xffffff, 0x8a7f6a, 2.0], sun: [0xfff0d8, 1.6], wallH: 2.2,
    build(g, boxes) {
      addFloor(g, new THREE.MeshLambertMaterial({ map: tiled(noiseTex('#9a9180', 46), HALF / 2, HALF / 2) }));
      const fenceTex = tiled(canvasTex(64, 64, (c, w, h) => { c.strokeStyle = '#b0b4b8'; c.lineWidth = 2; for (let i = -64; i < 128; i += 12) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 64, 64); c.stroke(); c.beginPath(); c.moveTo(i + 64, 0); c.lineTo(i, 64); c.stroke(); } }), HALF * 2, 4);
      addWalls(g, 2.2, new THREE.MeshLambertMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
      // shipping containers, some stacked
      const boxTex = (col) => canvasTex(128, 64, (c, w, h) => {
        c.fillStyle = col; c.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 8) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x, 0, 3, h); }
        for (let i = 0; i < 60; i++) { c.fillStyle = 'rgba(90,50,20,.35)'; c.fillRect(Math.random() * w, Math.random() * h, 4, 2 + Math.random() * 6); }
      });
      const cols = ['#9c3b27', '#2f5f8a', '#3f7a4a', '#c87a26', '#6a6e74'].map(c => new THREE.MeshLambertMaterial({ map: boxTex(c) }));
      for (const [x, z, rotate, stack] of [[10, -9, 0, 2], [10, -2, 0, 1], [-10.5, -10, 0, 1], [-10, 6, 1, 2], [6, 10, 1, 1], [-4, -12, 1, 1], [12, 9, 0, 1]]) {
        const w = rotate ? 6.1 : 2.44, d = rotate ? 2.44 : 6.1;
        for (let k = 0; k < stack; k++) addBlock(g, boxes, cols[(x * 7 + z * 3 + k) & 3], x, k * 2.6, z, w, 2.6, d);
      }
      // concrete pipes lying about
      const conc = new THREE.MeshLambertMaterial({ color: 0xa8a49a });
      for (const [x, z] of [[4.5, -6], [-6, -3], [-7, 11]]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.4, 14, 1, true), conc);
        pipe.material.side = THREE.DoubleSide; pipe.rotation.z = Math.PI / 2; pipe.position.set(x, 0.6, z); g.add(pipe);
        boxes.push({ min: new V3(x - 1.2, 0, z - 0.6), max: new V3(x + 1.2, 1.2, z + 0.6) });
      }
      // scaffolding against a container stack
      const scaf = new THREE.MeshLambertMaterial({ color: 0xc8b04a });
      for (let i = 0; i < 4; i++) for (const dz of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5.4, 0.06), scaf); p.position.set(8.4, 2.7, -9 + dz * 2.8 + i * 0.01); g.add(p); }
      for (let y = 1; y < 5.4; y += 1.3) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 5.6), scaf); r.position.set(8.4, y, -9); g.add(r); }
      // sand piles, a site toilet, floodlights
      for (const [x, z] of [[-2, 10], [11, 3]]) { const s = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.4, 16), new THREE.MeshLambertMaterial({ color: 0xc8b088 })); s.position.set(x, 0.7, z); g.add(s); }
      addBlock(g, boxes, new THREE.MeshLambertMaterial({ color: 0x2f8a5a }), -13, 0, -13, 1.2, 2.3, 1.2);
      const pole = new THREE.MeshLambertMaterial({ color: 0x55585c }), lamp = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
      for (const [x, z] of [[-14, 0], [14, -14], [0, 14.5]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 8, 8), pole); p.position.set(x, 4, z); g.add(p);
        const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.3), lamp); l.position.set(x, 8, z); g.add(l);
      }
    },
  },
};
const MAP_KEYS = Object.keys(MAPS);
let mapGroup = null;
function setMap(key) {
  if (!MAPS[key]) key = 'lab';
  const def = MAPS[key];
  setHalf(def.half ?? 8);
  scene.fog = def.fog ? new THREE.Fog(def.fog[0], def.fog[1], def.fog[2]) : null;
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
  if (started) fullReset();
}
// Back to a clean slate: bodies, props, blood, debris and weapons all go; kills stay.
function fullReset() {
  if (SV.on) endSurvival();
  clearAll();
  resetItems(); spawnBarrel(3.5, -5.5);
  spawnDummy(-2, -4.5); spawnDummy(0.5, -5.5); spawnDummy(2.5, -4);
  P.hp = 100;
  rig.position.set(0, S.height + P.y, 1.5);
}
function addKill() { S.kills++; saveKills(); drawPanel(); }
const fmtKills = () => S.kills === Infinity ? '∞' : S.kills;
function saveKills() { try { localStorage.setItem('goreLabKills', S.kills); } catch { /* private mode */ } }
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

const S = { kills: +(localStorage.getItem('goreLabKills') || 0) || 0, hostile: false, slowmo: false, lowG: false, god: false, map: 'lab', track: 0, height: 0 };
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
  runner: { type: 'runner', aggro: true, skin: 0xb8b0a0, speed: 2.3, hair: 0x1a1a1a, shirt: 0x5a6a5a },
  riot: { type: 'riot', armor: 1, hp: 150, shirt: 0x1c2638, speed: 1.0, aggro: true, hair: null },
  bomber: { type: 'bomber', bomb: true, aggro: true, speed: 1.7, shirt: 0x6a5a40 },
  crawler: { type: 'crawler', legless: true, aggro: true, skin: 0x8faa72, hair: 0x2b2f24 },
  gunman: { type: 'gunman', gunner: true, aggro: true, shirt: 0x2a2a2a, hp: 90 },
  giant: { type: 'giant', scale: 1.45, hp: 600, tough: 4, speed: 0.8, aggro: true, dmg: 25, shirt: 0x4a2a2a, hair: null },
  butcher: { type: 'butcher', boss: 'THE BUTCHER', scale: 1.75, hp: 1600, tough: 6, speed: 0.85, aggro: true, dmg: 35, shirt: 0xcfc6b2, hair: null, cleaver: true },
  juggernaut: { type: 'juggernaut', boss: 'THE JUGGERNAUT', scale: 1.6, armor: 2, hp: 1400, tough: 6, speed: 0.75, aggro: true, dmg: 35, shirt: 0x1c2638, hair: null },
};
// things some enemies carry in their right hand
function giveItem(d, kind) {
  const g = new THREE.Group();
  if (kind === 'gun') { box(g, M.dark, 0.034, 0.045, 0.2, 0, 0.03, -0.08); box(g, M.grey, 0.03, 0.1, 0.042, 0, -0.035, 0.005, -0.22); }
  else { box(g, M.wood, 0.035, 0.04, 0.16, 0, 0, -0.03); box(g, M.steel, 0.008, 0.16, 0.34, 0, 0.05, -0.27); }   // cleaver
  g.scale.setScalar(d.s); scene.add(g);
  d.item = { mesh: g, kind };
}
function syncItems() {
  const head = headPos();
  for (const d of dummies) {
    const it = d.item;
    if (!it) continue;
    const hand = d.p.rHand;
    if (d.gone || d.bone.rForearm.severed && !it.dropped) { it.dropped = true; }
    it.mesh.position.copy(hand.pos);
    // a gunman points it at you; otherwise it follows the forearm
    if (it.kind === 'gun' && d.alive && d.state === 'stand') tv.subVectors(head, hand.pos).normalize();
    else tv.subVectors(hand.pos, d.bone.rForearm.a.pos).normalize();
    it.mesh.quaternion.setFromUnitVectors(NEG_Z, tv);
  }
}
function disposeDummy(d) { dropWeapon(d); if (d.item) scene.remove(d.item.mesh); d.dispose(); }
function spawnDummy(x, z, type = 'dummy') {
  if (dummies.length >= MAX_DUMMIES) {
    const i = Math.max(0, dummies.findIndex(d => !d.alive));
    releaseBody(dummies[i]); disposeDummy(dummies[i]); dummies.splice(i, 1);
  }
  x ??= (Math.random() - 0.5) * 10; z ??= -4.2 - Math.random() * 3;
  const head = headPos();
  const d = new Dummy(world, scene, gore, x, z, Math.atan2(head.x - x, head.z - z), typeof type === 'object' ? type : DUMMY_TYPES[type]);
  d.onDeath = () => { addKill(); if (SV.on) SV.kills++; };
  const o = typeof type === 'object' ? type : DUMMY_TYPES[type];
  if (o?.gunner) { d.gunner = true; d.shootT = 2 + Math.random() * 2; giveItem(d, 'gun'); }
  if (o?.cleaver) giveItem(d, 'cleaver');
  if (o?.bomb) d.bomb = true;
  if (o?.boss) d.boss = o.boss;
  d.dmg = o?.dmg ?? 10;
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
function blast(c, R = 5, rocket = false) {
  sfx.boom(); pulseAll(1, 200);
  const mesh = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }));
  mesh.position.copy(c); scene.add(mesh); explosions.push({ mesh, t: 0, size: R / 5 });
  gore.sparks(c, 40);
  {
    // measured from the middle of the player's body
    const head = headPos(), dx = head.x - c.x, dy = head.y - 0.8 - c.y, dz = head.z - c.z, d = Math.hypot(dx, dy, dz);
    if (d < R) {
      const f = 1 - d / R;
      if (rocket) {
        // rocket jump: a rocket only stings, and throws you up and away from the blast
        damagePlayer(10);
        if (!P.dead && !freecam) {
          const flat = Math.hypot(dx, dz) || 1;
          P.vy = Math.max(P.vy, 0) + 3 + 6.5 * f; P.onGround = false;
          P.vx += dx / flat * 5.5 * f * Math.min(1, flat / 0.6); P.vz += dz / flat * 5.5 * f * Math.min(1, flat / 0.6);
        }
      } else damagePlayer(70 * f);
    }
  }
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
    if (g.impact && g.fuse < 1.55 && dummies.some(d => d.p.chest.pos.distanceTo(g.p.pos) < 0.45 * d.s)) g.fuse = 0;
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
      blast(c, 5.5, true);
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
  // spawn-gun only: these never go on the table
  sniper: { extra: true, twoHand: true, name: 'Sniper rifle', len: 1.05, cool: 1.1, pellets: 1, spread: 0.001, dmg: 6, push: 9, kick: 0.9, gib: true, pierce: true, sound: 'sniper', muzzle: [0, 0.045, -1.02] },
  minigun: { extra: true, twoHand: true, name: 'Minigun', len: 0.85, auto: true, cool: 0.035, pellets: 1, spread: 0.035, dmg: 0.9, push: 2.5, kick: 0.04, spin: true, sound: 'minigun', muzzle: [0, 0, -0.86] },
  launcher: { extra: true, twoHand: true, name: 'Grenade launcher', len: 0.6, cool: 0.8, launcher: true, kick: 0.5, sound: 'launcher', muzzle: [0, 0.05, -0.6] },
  crossbow: { extra: true, name: 'Crossbow', len: 0.6, cool: 1.0, bolt: true, kick: 0.2, sound: 'crossbow', muzzle: [0, 0.07, -0.52] },
  flamethrower: { extra: true, twoHand: true, name: 'Flamethrower', len: 0.75, flame: true, muzzle: [0, 0.02, -0.74] },
  axe: { extra: true, name: 'Fire axe', len: 0.85, melee: true, blade: 0.78, dmg: 6 },
  sledge: { extra: true, name: 'Sledgehammer', len: 0.95, melee: true, blade: 0.85, dmg: 3, blunt: true, heavy: true },
};
const DEFAULT_TOOLS = Object.keys(GUNS).filter(k => !GUNS[k].extra);
// Where the hand closes on each tool (in the tool's own space) and how far the
// fist is rolled about X so the fingers wrap the handle the way a real hand would.
const HANDLE = -Math.PI / 2;   // fist wrapped round a handle that runs along the tool
const GRIPS = {
  spawngun: [[0, -0.045, 0.005], -0.22], pistol: [[0, -0.035, 0.005], -0.22], revolver: [[0, -0.04, 0.02], -0.3],
  smg: [[0, -0.04, 0.01], -0.22], rifle: [[0, -0.04, 0.01], -0.22], shotgun: [[0, -0.012, 0.05], -0.45], rocket: [[0, -0.03, 0], -0.15],
  knife: [[0, 0, -0.03], HANDLE], machete: [[0, 0, -0.04], HANDLE], katana: [[0, 0, -0.07], HANDLE], bat: [[0, 0, -0.02], HANDLE],
  chainsaw: [[0, -0.03, 0.06], -0.2],
  sniper: [[0, -0.04, 0.02], -0.25], minigun: [[0, 0.075, 0.08], HANDLE + 0.2], launcher: [[0, -0.04, 0.02], -0.22], crossbow: [[0, -0.04, 0.05], -0.25],
  flamethrower: [[0, -0.04, 0.02], -0.22], axe: [[0, 0, -0.05], HANDLE], sledge: [[0, 0, -0.08], HANDLE],
};
const M = {
  dark: new THREE.MeshLambertMaterial({ color: 0x23262b }), grey: new THREE.MeshLambertMaterial({ color: 0x555b64 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x7a4a26 }), steel: new THREE.MeshLambertMaterial({ color: 0xcfd6de }),
  olive: new THREE.MeshLambertMaterial({ color: 0x4d5a3a }), orange: new THREE.MeshLambertMaterial({ color: 0xe8792b }), white: new THREE.MeshLambertMaterial({ color: 0xdfe6ee }),
  red: new THREE.MeshLambertMaterial({ color: 0xb3261e }), cyan: new THREE.MeshBasicMaterial({ color: 0x35e0ff }),
  black: new THREE.MeshLambertMaterial({ color: 0x131416 }), brass: new THREE.MeshLambertMaterial({ color: 0xb08a3a }), rubber: new THREE.MeshLambertMaterial({ color: 0x2a2420 }),
  pilot: new THREE.MeshBasicMaterial({ color: 0x4fa8ff }), glass: new THREE.MeshLambertMaterial({ color: 0x1a2a3a }), tan: new THREE.MeshLambertMaterial({ color: 0x8a7a5a }),
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
// a trigger guard: a little loop under the gun
function guard(g, z, y = -0.02, w = 0.006) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0035, 4, 10, Math.PI), M.black);
  t.rotation.set(0, Math.PI / 2, Math.PI); t.position.set(0, y, z); g.add(t);
  box(g, M.black, 0.006, 0.012, 0.006, 0, y - 0.004, z + 0.002);   // trigger
}
// every tool is modelled with its grip at the origin, pointing down -Z
function buildToolMesh(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'pistol':
      box(g, M.dark, 0.03, 0.03, 0.19, 0, 0.042, -0.08); box(g, M.black, 0.028, 0.022, 0.17, 0, 0.018, -0.075);   // slide, frame
      for (let i = 0; i < 6; i++) box(g, M.black, 0.031, 0.022, 0.003, 0, 0.044, 0.0 - i * 0.008);              // slide serrations
      box(g, M.black, 0.006, 0.008, 0.008, 0, 0.061, -0.165); box(g, M.black, 0.012, 0.007, 0.008, 0, 0.061, 0.005);   // sights
      cyl(g, M.black, 0.006, 0.006, 0.02, 0, 0.042, -0.178);
      box(g, M.rubber, 0.03, 0.1, 0.042, 0, -0.035, 0.005, -0.22); box(g, M.black, 0.024, 0.012, 0.03, 0, -0.088, 0.016, -0.22);   // grip, mag base
      guard(g, -0.035); break;
    case 'revolver':
      cyl(g, M.steel, 0.011, 0.011, 0.15, 0, 0.042, -0.15); box(g, M.steel, 0.012, 0.012, 0.15, 0, 0.056, -0.15);     // barrel + rib
      cyl(g, M.grey, 0.028, 0.028, 0.05, 0, 0.033, -0.035);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(g, M.black, 0.006, 0.006, 0.051, Math.cos(a) * 0.017, 0.033 + Math.sin(a) * 0.017, -0.035); }
      box(g, M.steel, 0.022, 0.045, 0.07, 0, 0.03, 0.02); box(g, M.steel, 0.008, 0.02, 0.012, 0, 0.06, 0.05, 0.6);   // frame, hammer
      box(g, M.wood, 0.03, 0.1, 0.042, 0, -0.04, 0.035, -0.32); box(g, M.steel, 0.004, 0.012, 0.01, 0, 0.065, -0.22); guard(g, -0.01); break;
    case 'smg':
      box(g, M.dark, 0.042, 0.06, 0.28, 0, 0.035, -0.1); box(g, M.black, 0.044, 0.016, 0.24, 0, 0.073, -0.1);       // receiver, top rail
      cyl(g, M.black, 0.013, 0.013, 0.09, 0, 0.04, -0.28); cyl(g, M.black, 0.02, 0.02, 0.05, 0, 0.04, -0.3);       // barrel, suppressor stub
      box(g, M.black, 0.028, 0.16, 0.034, 0, -0.08, -0.12, 0.08); box(g, M.rubber, 0.032, 0.1, 0.042, 0, -0.04, 0.01, -0.22);
      box(g, M.black, 0.03, 0.02, 0.16, 0, 0.045, 0.12); box(g, M.rubber, 0.03, 0.06, 0.02, 0, 0.02, 0.2);           // folding stock
      box(g, M.black, 0.01, 0.025, 0.01, 0, 0.09, -0.02); guard(g, -0.035); break;
    case 'rifle':
      box(g, M.dark, 0.044, 0.07, 0.4, 0, 0.032, -0.13);
      cyl(g, M.black, 0.011, 0.011, 0.3, 0, 0.045, -0.48); cyl(g, M.black, 0.016, 0.016, 0.045, 0, 0.045, -0.62);   // barrel, brake
      cyl(g, M.dark, 0.008, 0.008, 0.18, 0, 0.068, -0.4);                                                             // gas tube
      box(g, M.wood, 0.052, 0.055, 0.17, 0, 0.03, -0.35); box(g, M.black, 0.006, 0.05, 0.01, 0, 0.083, -0.5);       // handguard, front sight
      const mag = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 5, 10, Math.PI * 0.35), M.black); mag.rotation.set(0, Math.PI / 2, -0.5); mag.position.set(0, 0.035, -0.06); g.add(mag);   // curved magazine
      box(g, M.wood, 0.04, 0.08, 0.25, 0, 0.012, 0.18, 0.12); box(g, M.rubber, 0.032, 0.1, 0.042, 0, -0.04, 0.01, -0.22);
      box(g, M.black, 0.01, 0.02, 0.05, 0, 0.074, -0.06); guard(g, -0.035); break;
    case 'shotgun':
      cyl(g, M.dark, 0.018, 0.018, 0.62, 0, 0.05, -0.31); cyl(g, M.black, 0.016, 0.016, 0.48, 0, 0.018, -0.3);    // barrel, tube magazine
      box(g, M.wood, 0.05, 0.05, 0.17, 0, 0.022, -0.36); for (let i = 0; i < 5; i++) box(g, M.rubber, 0.052, 0.004, 0.006, 0, 0.022, -0.3 - i * 0.025);   // ribbed pump
      box(g, M.grey, 0.046, 0.065, 0.15, 0, 0.035, -0.02); box(g, M.brass, 0.006, 0.006, 0.006, 0, 0.065, -0.61);  // receiver, bead sight
      box(g, M.wood, 0.042, 0.08, 0.28, 0, -0.002, 0.15, 0.13); box(g, M.rubber, 0.044, 0.09, 0.02, 0, -0.02, 0.29, 0.13); guard(g, 0.0); break;
    case 'rocket':
      cyl(g, M.olive, 0.055, 0.055, 0.95, 0, 0.06, -0.18); cyl(g, M.dark, 0.07, 0.055, 0.1, 0, 0.06, -0.62);
      cyl(g, M.dark, 0.055, 0.075, 0.1, 0, 0.06, 0.3); box(g, M.dark, 0.03, 0.1, 0.04, 0, -0.03, 0.0, -0.15);
      box(g, M.dark, 0.03, 0.09, 0.04, 0, -0.02, -0.3, -0.1);                                                        // front grip
      box(g, M.black, 0.03, 0.04, 0.1, 0.045, 0.1, -0.1); cyl(g, M.glass, 0.014, 0.014, 0.012, 0.045, 0.1, -0.155);   // sight
      cyl(g, M.red, 0.04, 0.03, 0.12, 0, 0.06, -0.72); box(g, M.red, 0.02, 0.05, 0.08, 0, 0.13, -0.2); break;          // warhead tip
    case 'knife':
      box(g, M.rubber, 0.026, 0.032, 0.1, 0, 0, -0.03); for (let i = 0; i < 4; i++) box(g, M.black, 0.027, 0.033, 0.004, 0, 0, -0.065 + i * 0.022);
      box(g, M.grey, 0.05, 0.014, 0.012, 0, 0, -0.085);
      box(g, M.steel, 0.005, 0.03, 0.15, 0, 0.002, -0.165); box(g, M.steel, 0.004, 0.018, 0.035, 0, -0.005, -0.255, 0.35);   // blade, tip
      box(g, M.white, 0.0055, 0.004, 0.15, 0, -0.012, -0.165); break;                                                         // honed edge
    case 'machete':
      box(g, M.wood, 0.03, 0.035, 0.15, 0, 0, -0.04); cyl(g, M.brass, 0.005, 0.005, 0.034, 0, 0, -0.01); cyl(g, M.brass, 0.005, 0.005, 0.034, 0, 0, -0.07);
      box(g, M.steel, 0.006, 0.065, 0.48, 0, 0.012, -0.37); box(g, M.steel, 0.006, 0.08, 0.08, 0, 0.0, -0.62, 0.3);
      box(g, M.white, 0.0065, 0.006, 0.5, 0, -0.019, -0.38); break;
    case 'katana':
      box(g, M.dark, 0.028, 0.032, 0.24, 0, 0, -0.06); for (let i = 0; i < 8; i++) box(g, M.white, 0.029, 0.006, 0.006, 0, 0, 0.04 - i * 0.026, 0.7);   // wrapped hilt
      cyl(g, M.brass, 0.034, 0.034, 0.008, 0, 0, -0.185);
      box(g, M.steel, 0.005, 0.034, 0.72, 0, 0.004, -0.55); box(g, M.steel, 0.005, 0.02, 0.07, 0, 0.0, -0.94, 0.25);
      box(g, M.white, 0.0055, 0.008, 0.72, 0, -0.011, -0.55); break;                                                    // temper line
    case 'bat':
      cyl(g, M.wood, 0.036, 0.017, 0.8, 0, 0, -0.38); cyl(g, M.dark, 0.022, 0.022, 0.03, 0, 0, 0.03);
      for (let i = 0; i < 6; i++) cyl(g, M.rubber, 0.0185, 0.0185, 0.012, 0, 0, -0.01 - i * 0.025); break;               // grip tape
    case 'chainsaw':
      box(g, M.orange, 0.11, 0.13, 0.26, 0, 0.02, -0.08); box(g, M.black, 0.112, 0.04, 0.12, 0, -0.02, -0.12);
      box(g, M.dark, 0.03, 0.03, 0.2, 0, 0.115, -0.1); box(g, M.dark, 0.03, 0.09, 0.03, 0, 0.07, -0.19);
      box(g, M.dark, 0.04, 0.1, 0.05, 0, -0.03, 0.06, -0.2); cyl(g, M.black, 0.03, 0.03, 0.02, 0.06, 0.03, -0.05);
      box(g, M.dark, 0.012, 0.092, 0.54, 0, 0.02, -0.5); box(g, M.steel, 0.016, 0.062, 0.5, 0, 0.02, -0.49);
      for (let i = 0; i < 18; i++) box(g, M.black, 0.018, 0.008, 0.012, 0, 0.068, -0.26 - i * 0.028);                     // chain teeth
      break;
    case 'spawngun': {
      box(g, M.white, 0.06, 0.08, 0.2, 0, 0.03, -0.09); box(g, M.dark, 0.034, 0.1, 0.045, 0, -0.045, 0.005, -0.22);
      cyl(g, M.cyan, 0.022, 0.032, 0.08, 0, 0.03, -0.22); box(g, M.dark, 0.062, 0.02, 0.12, 0, 0.075, -0.09);
      for (let i = 0; i < 3; i++) box(g, M.cyan, 0.062, 0.006, 0.01, 0, 0.03, -0.03 - i * 0.04);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: menuTex }));
      screen.position.set(0, 0.24, -0.06); screen.rotation.x = -0.3; g.add(screen);
      guard(g, -0.035, -0.02); break;
    }
    case 'sniper':
      box(g, M.olive, 0.05, 0.07, 0.42, 0, 0.02, 0.0); box(g, M.olive, 0.044, 0.09, 0.22, 0, 0.0, 0.3, 0.1);          // stock
      cyl(g, M.black, 0.013, 0.011, 0.62, 0, 0.045, -0.62); cyl(g, M.black, 0.019, 0.019, 0.06, 0, 0.045, -0.96);     // barrel, brake
      box(g, M.dark, 0.042, 0.05, 0.2, 0, 0.045, -0.12); cyl(g, M.black, 0.022, 0.022, 0.3, 0, 0.11, -0.1);           // receiver, scope
      cyl(g, M.black, 0.028, 0.022, 0.05, 0, 0.11, -0.27); cyl(g, M.black, 0.026, 0.022, 0.04, 0, 0.11, 0.07); cyl(g, M.glass, 0.02, 0.02, 0.005, 0, 0.11, -0.295);
      box(g, M.black, 0.03, 0.04, 0.02, 0, 0.08, -0.17); box(g, M.black, 0.03, 0.04, 0.02, 0, 0.08, -0.03);
      box(g, M.black, 0.006, 0.006, 0.05, 0.03, 0.045, -0.06, 0); box(g, M.black, 0.03, 0.08, 0.04, 0, -0.06, -0.08);  // bolt, mag
      for (const sx of [-1, 1]) box(g, M.black, 0.008, 0.16, 0.008, sx * 0.025, -0.05, -0.55, sx * 0.3);                // bipod
      guard(g, 0.0); break;
    case 'minigun': {
      box(g, M.dark, 0.14, 0.14, 0.24, 0, 0, -0.04); box(g, M.dark, 0.035, 0.12, 0.04, 0, 0.13, 0.04);                  // body, top handle
      box(g, M.black, 0.03, 0.12, 0.04, 0, -0.12, 0.05, -0.2); box(g, M.olive, 0.12, 0.14, 0.12, 0.13, -0.05, 0.02);   // rear grip, ammo box
      const barrels = new THREE.Group(); barrels.position.set(0, 0, -0.16); g.add(barrels);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(barrels, M.black, 0.011, 0.011, 0.66, Math.cos(a) * 0.038, Math.sin(a) * 0.038, -0.33); }
      cyl(barrels, M.grey, 0.06, 0.06, 0.03, 0, 0, -0.5); cyl(barrels, M.grey, 0.06, 0.06, 0.03, 0, 0, -0.1);
      g.userData.barrels = barrels; break;
    }
    case 'launcher':
      cyl(g, M.olive, 0.045, 0.045, 0.42, 0, 0.05, -0.36); cyl(g, M.black, 0.05, 0.05, 0.03, 0, 0.05, -0.58);
      cyl(g, M.dark, 0.075, 0.075, 0.12, 0, 0.03, -0.08);                                                              // revolving drum
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(g, M.brass, 0.018, 0.018, 0.122, Math.cos(a) * 0.05, 0.03 + Math.sin(a) * 0.05, -0.08); }
      box(g, M.rubber, 0.032, 0.1, 0.042, 0, -0.04, 0.02, -0.22); box(g, M.black, 0.03, 0.09, 0.04, 0, -0.03, -0.32, -0.1);
      box(g, M.olive, 0.04, 0.06, 0.24, 0, 0.0, 0.15, 0.1); box(g, M.black, 0.02, 0.05, 0.06, 0, 0.115, -0.25); guard(g, -0.035); break;
    case 'crossbow':
      box(g, M.wood, 0.04, 0.05, 0.62, 0, 0.03, -0.18); box(g, M.wood, 0.036, 0.09, 0.18, 0, -0.005, 0.17, 0.15);    // stock
      box(g, M.black, 0.01, 0.01, 0.4, 0, 0.06, -0.3);                                                                // rail
      for (const sx of [-1, 1]) { const limb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.025), M.black); limb.position.set(sx * 0.15, 0.06, -0.48 + 0.04); limb.rotation.y = sx * 0.35; g.add(limb); }
      box(g, M.white, 0.5, 0.003, 0.003, 0, 0.065, -0.3); box(g, M.black, 0.04, 0.03, 0.04, 0, 0.11, -0.12);          // string, sight
      cyl(g, M.steel, 0.005, 0.005, 0.38, 0, 0.07, -0.3); box(g, M.red, 0.002, 0.02, 0.04, 0, 0.08, -0.13);           // loaded bolt
      box(g, M.rubber, 0.03, 0.09, 0.04, 0, -0.04, 0.03, -0.25); guard(g, -0.01); break;
    case 'flamethrower':
      box(g, M.dark, 0.05, 0.06, 0.34, 0, 0.02, -0.18); cyl(g, M.grey, 0.022, 0.022, 0.32, 0, 0.03, -0.5);          // body, wand
      cyl(g, M.black, 0.034, 0.026, 0.07, 0, 0.03, -0.69); cyl(g, M.red, 0.07, 0.07, 0.34, 0, -0.1, -0.08);          // nozzle, fuel tank
      box(g, M.brass, 0.02, 0.02, 0.06, 0.04, -0.02, -0.08); cyl(g, M.rubber, 0.012, 0.012, 0.22, 0.05, -0.04, 0.02);   // valve, hose
      box(g, M.rubber, 0.032, 0.1, 0.042, 0, -0.04, 0.02, -0.22); box(g, M.black, 0.03, 0.09, 0.04, 0, -0.03, -0.36, -0.1);
      { const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), M.pilot); pilot.position.set(0, 0.005, -0.74); g.add(pilot); }
      guard(g, -0.035); break;
    case 'axe':
      box(g, M.wood, 0.034, 0.03, 0.8, 0, 0, -0.38); for (let i = 0; i < 5; i++) box(g, M.rubber, 0.036, 0.032, 0.012, 0, 0, 0.0 - i * 0.03);
      box(g, M.red, 0.008, 0.14, 0.09, 0, 0.065, -0.77); box(g, M.steel, 0.006, 0.17, 0.03, 0, 0.07, -0.73);         // head, edge
      box(g, M.red, 0.02, 0.1, 0.03, 0, -0.06, -0.78, 0.4); break;                                                       // pick
    case 'sledge':
      cyl(g, M.wood, 0.018, 0.02, 0.9, 0, 0, -0.42); for (let i = 0; i < 5; i++) cyl(g, M.rubber, 0.022, 0.022, 0.014, 0, 0, -0.0 - i * 0.03);
      { const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.24), M.dark); head.rotation.x = Math.PI / 2; head.position.set(0, 0, -0.86); g.add(head);
        for (const sy of [-1, 1]) { const face = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.01), M.steel); face.position.set(0, sy * 0.12, -0.86); face.rotation.x = Math.PI / 2; g.add(face); } }
      break;
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
  world.rods.push({ a: t.a, b: t.b, r: 0.03, body: t, skip: () => !!(t.stuck || t.holster || t.npc || (t.held && def.melee)) });
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
  if (t.npc) { t.npc.weapon = null; t.npc = null; }
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
  { name: 'WEAPONS', items: Object.keys(GUNS).filter(k => k !== 'spawngun').map(k => [GUNS[k].name, p => makeTool(k, p.x, p.y + 0.35, p.z)]).concat([['Spawn gun', p => makeTool('spawngun', p.x, p.y + 0.35, p.z)]]) },
  { name: 'NPCS', items: [
    ['Dummy', p => spawnDummy(p.x, p.z)],
    ['Zombie', p => spawnDummy(p.x, p.z, 'zombie')],
    ['Brute', p => spawnDummy(p.x, p.z, 'brute')],
    ['Runner', p => spawnDummy(p.x, p.z, 'runner')],
    ['Riot cop', p => spawnDummy(p.x, p.z, 'riot')],
    ['Bomber', p => spawnDummy(p.x, p.z, 'bomber')],
    ['Crawler', p => spawnDummy(p.x, p.z, 'crawler')],
    ['Gunman', p => spawnDummy(p.x, p.z, 'gunman')],
    ['Giant', p => spawnDummy(p.x, p.z, 'giant')],
    ['Boss: The Butcher', p => spawnDummy(p.x, p.z, 'butcher')],
    ['Boss: The Juggernaut', p => spawnDummy(p.x, p.z, 'juggernaut')],
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
const PANEL = { x: 4.5, y: 1.55, z: -1, w: 2.6, h: 2.2, head: 0.22 };
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
  [() => 'MAP: ' + (MAPS[S.map].short ?? MAPS[S.map].name).toUpperCase(), () => setMap(MAP_KEYS[(MAP_KEYS.indexOf(S.map) + 1) % MAP_KEYS.length])],
];
const PANEL_ROWS = 6;
const panelCanvas = document.createElement('canvas'); panelCanvas.width = 832; panelCanvas.height = 704;
const panelTex = new THREE.CanvasTexture(panelCanvas); panelTex.colorSpace = THREE.SRGBColorSpace;
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.w, PANEL.h), new THREE.MeshBasicMaterial({ map: panelTex }));
  m.position.set(PANEL.x, PANEL.y, PANEL.z); m.rotation.y = -Math.PI / 2; scene.add(m);
  // it stands on its own board so it works on every map, big or small
  const standMat = new THREE.MeshLambertMaterial({ color: 0x2a2e35 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.08, PANEL.h + 0.12, PANEL.w + 0.12), standMat);
  board.position.set(PANEL.x + 0.045, PANEL.y, PANEL.z); scene.add(board);
  for (const dz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, PANEL.y - PANEL.h / 2, 0.08), standMat);
    leg.position.set(PANEL.x + 0.045, (PANEL.y - PANEL.h / 2) / 2, PANEL.z + dz * (PANEL.w / 2 - 0.1)); scene.add(leg);
  }
}
let panelFlash = -1, panelCd = 0;
function drawPanel() {
  const g = panelCanvas.getContext('2d'), W = panelCanvas.width, H = panelCanvas.height, hh = H * PANEL.head;
  g.fillStyle = '#14171c'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8792b'; g.font = 'bold 54px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('GORE LAB', 30, hh / 2);
  g.fillStyle = '#e6e9ed'; g.textAlign = 'right'; g.fillText('KILLS ' + fmtKills(), W - 30, 46);
  // reset button tucked under the kill count
  g.fillStyle = panelFlash === 'reset' ? '#e8792b' : '#5a1a14'; g.fillRect(W - 300, 84, 270, 58);
  g.fillStyle = '#f2f4f7'; g.font = 'bold 32px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('RESET KILLS', W - 165, 113);
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
  $('kills').textContent = 'KILLS ' + fmtKills();
}
function panelIndex(y, z) {
  const u = (z - (PANEL.z - PANEL.w / 2)) / PANEL.w, v = (PANEL.y + PANEL.h / 2 - y) / PANEL.h;
  if (u > 0.63 && u < 0.97 && v > 0.115 && v < 0.205) return 'reset';
  if (u < 0 || u > 1 || v < PANEL.head || v > 1) return -1;
  return Math.min(PANEL_ROWS - 1, Math.floor((v - PANEL.head) / (1 - PANEL.head) * PANEL_ROWS)) * 2 + (u < 0.5 ? 0 : 1);
}
function press(i) {
  if (i === -1 || panelCd > 0) return;
  panelCd = 0.35; panelFlash = i;
  if (i === 'reset') { S.kills = 0; saveKills(); } else BUTTONS[i][1]();
  sfx.beep(); drawPanel();
  setTimeout(() => { panelFlash = -1; drawPanel(); }, 150);
}
function clearAll() {
  if (SV.on) endSurvival();
  for (const d of dummies) { releaseBody(d); disposeDummy(d); }
  dummies.length = 0;
  for (const b of barrels) { releaseBody(b); world.removeBody(b); scene.remove(b.mesh); }
  barrels.length = 0;
  for (const g of [...grenades]) removeGrenade(g);
  for (const m of mines) scene.remove(m.mesh);
  for (const r of rockets) scene.remove(r.mesh);
  for (const b of bolts) b.mesh.removeFromParent();
  bolts.length = 0; gore.clearFire?.();
  mines.length = rockets.length = 0;
  gore.clear();
  for (const h of [...vrHands, desk]) bloody(h, -1);
}

// ------------------------------------------------------------ hands
let inVR = false, started = false;

// Jointed player hand. Built flat (fingers along -Z, palm down) then rolled so
// the palm faces inward like a hand wrapped round a controller.
const skinMat = new THREE.MeshLambertMaterial({ color: 0xe0b48c }), cuffMat = new THREE.MeshLambertMaterial({ color: 0x23262b });
// style: 'default' | 'fingerless' | 'gloves' | 'realism' (shop unlocks)
const nailMat = new THREE.MeshLambertMaterial({ color: 0xf0c8b8 });
function buildHand(side, skin = skinMat, style = 'default', gloveHex = 0x1c1c1e) {
  const s = side === 'left' ? 1 : -1;   // which way the thumb sits in the flat frame
  const root = new THREE.Group(), flat = new THREE.Group();
  flat.rotation.z = s * Math.PI / 2;
  flat.position.set(-s * 0.012, -0.03, 0.075);
  root.add(flat);
  const real = style === 'realism', glove = new THREE.MeshLambertMaterial({ color: gloveHex });
  // which material each part gets: j = finger segment, 0 nearest the palm
  const matFor = (part, j = 0) => style === 'gloves' ? glove
    : style === 'fingerless' ? (part === 'finger' && j > 0 ? skin : glove)
    : part === 'cuff' ? cuffMat : skin;
  const seg = (parent, w, t, len, mat) => {
    let m;
    if (real && mat !== cuffMat) {
      // rounded capsule segments instead of blocks
      const r = Math.min(w, t) / 2;
      m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 1.2), 4, 10), mat);
      m.rotation.x = Math.PI / 2; m.scale.x = w / (2 * r);
    } else m = new THREE.Mesh(new THREE.BoxGeometry(w, t, len), mat);
    m.position.z = -len / 2; parent.add(m); return m;
  };
  const palm = seg(flat, 0.078, 0.026, 0.09, matFor('palm')); palm.position.z = 0;
  if (real) { palm.scale.set(palm.scale.x, 1.15, 0.86); for (let i = 0; i < 4; i++) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 8, 6), skin); k.position.set(s * (0.029 - i * 0.0193), 0.006, -0.043); flat.add(k); } }
  const cuff = seg(flat, 0.07, 0.05, 0.1, matFor('cuff')); cuff.position.set(0, 0, 0.1);
  const fingers = [];
  const LEN = [[0.04, 0.026, 0.02], [0.044, 0.029, 0.022], [0.04, 0.027, 0.02], [0.031, 0.02, 0.017]];
  for (let i = 0; i < 4; i++) {
    const joints = [];
    let parent = flat, z = -0.045;
    for (let j = 0; j < 3; j++) {
      const g = new THREE.Group();
      g.position.set(j === 0 ? s * (0.029 - i * 0.0193) : 0, 0, z);
      if (real && j === 0) g.rotation.y = s * (i - 1.5) * 0.04;   // fingers fan out a little
      const w = real ? 0.0172 - j * 0.0012 - i * 0.0004 : 0.0165;
      parent.add(g); seg(g, w, w - (real ? 0.001 : j * 0.0015), LEN[i][j], matFor('finger', j));
      if (real && j === 2 && style !== 'gloves') { const n = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.002, LEN[i][j] * 0.5), nailMat); n.position.set(0, w * 0.45, -LEN[i][j] * 0.7); g.add(n); }
      joints.push(g); parent = g; z = -LEN[i][j];
    }
    fingers.push(joints);
  }
  const thumb = new THREE.Group(); thumb.position.set(s * 0.036, -0.004, 0.025); flat.add(thumb);
  seg(thumb, 0.02, 0.02, 0.042, matFor('finger', 0));
  const thumb2 = new THREE.Group(); thumb2.position.z = -0.042; thumb.add(thumb2);
  seg(thumb2, 0.018, 0.018, 0.03, matFor('finger', 2));
  if (real && style !== 'gloves') { const n = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.002, 0.014), nailMat); n.position.set(0, 0.0095, -0.022); thumb2.add(n); }
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
// ---------------------------------------------------------------- shop
// Things unlock once your kill count reaches their number; kills aren't spent.
const SHOP = { owned: [], style: 'default', gloveColor: 0, body: false };
try { Object.assign(SHOP, JSON.parse(localStorage.getItem('goreLabShop') || '{}')); } catch { /* defaults */ }
const GLOVE_COLORS = [['Black', 0x1c1c1e], ['Red', 0xa01c1c], ['Blue', 0x24489a], ['Green', 0x2f6a32], ['White', 0xe4e4e4], ['Orange', 0xe8792b], ['Purple', 0x5a2a8a]];
const SHOP_ITEMS = { fingerless: ['FINGERLESS GLOVES', 15], gloves: ['FULL GLOVES', 30], realism: ['REALISTIC HANDS', 60], body: ['FULL BODY', 100] };
const owns = k => k === 'default' || SHOP.owned.includes(k);
function saveShop() { try { localStorage.setItem('goreLabShop', JSON.stringify(SHOP)); } catch { /* ignore */ } }
function shopLabel(k) {
  if (k === 'default') return 'DEFAULT HANDS' + (SHOP.style === 'default' ? '   ✔' : '');
  const [name, need] = SHOP_ITEMS[k];
  if (!owns(k)) return name + '  ·  ' + (S.kills >= need ? 'UNLOCK NOW' : 'NEEDS ' + need + ' KILLS');
  if (k === 'body') return name + ':  ' + (SHOP.body ? 'ON' : 'OFF');
  return name + (SHOP.style === k ? '   ✔' : '   (EQUIP)');
}
function shopAct(k) {
  if (!owns(k)) {
    if (S.kills < SHOP_ITEMS[k][1]) { sfx.beep(); return; }
    SHOP.owned.push(k); sfx.spawn();
  }
  if (k === 'body') SHOP.body = !SHOP.body; else SHOP.style = k;
  saveShop(); applyHands();
}
const SHOP_ROWS = [
  { label: () => '◀  BACK TO MENU', act: () => { UI.shop = false; } },
  { label: () => shopLabel('default'), act: () => shopAct('default') },
  { label: () => shopLabel('fingerless'), act: () => shopAct('fingerless'), locked: () => !owns('fingerless') && S.kills < 15 },
  { sel: true, label: () => 'GLOVE COLOUR:  ' + GLOVE_COLORS[SHOP.gloveColor][0], swatch: () => '#' + GLOVE_COLORS[SHOP.gloveColor][1].toString(16).padStart(6, '0'),
    act: d => { SHOP.gloveColor = (SHOP.gloveColor + d + GLOVE_COLORS.length) % GLOVE_COLORS.length; saveShop(); applyHands(); } },
  { label: () => shopLabel('gloves'), act: () => shopAct('gloves'), locked: () => !owns('gloves') && S.kills < 30 },
  { label: () => shopLabel('realism'), act: () => shopAct('realism'), locked: () => !owns('realism') && S.kills < 60 },
  { label: () => shopLabel('body'), act: () => shopAct('body'), locked: () => !owns('body') && S.kills < 100 },
  null, null, null, null,
];
// rebuild every hand in the equipped style
function applyHands() {
  if (!owns(SHOP.style)) SHOP.style = 'default';
  for (const h of [...vrHands, desk]) {
    const vis = h.glove.visible;
    scene.remove(h.glove);
    h.glove = buildHand(h.side, h.skin, SHOP.style, GLOVE_COLORS[SHOP.gloveColor][1]);
    h.glove.visible = vis; scene.add(h.glove);
  }
}

// Full body: a simple torso, arms and legs under your head, arms reaching to your hands.
const avatar = (() => {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const shirt = new THREE.MeshLambertMaterial({ color: 0x3a3f47 }), pants = new THREE.MeshLambertMaterial({ color: 0x252a36 }), boot = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const limb = (r, m) => { const x = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 1, 10), m); g.add(x); return x; };
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.48, 0.15), shirt), hips = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.15, 0.15), pants);
  g.add(torso, hips);
  const feet = [0, 1].map(() => { const f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.26), boot); g.add(f); return f; });
  return { g, torso, hips, feet, phase: 0, speed: 0, last: new V3(), arms: [[limb(0.042, shirt), limb(0.034, shirt)], [limb(0.042, shirt), limb(0.034, shirt)]], legs: [[limb(0.062, pants), limb(0.05, pants)], [limb(0.062, pants), limb(0.05, pants)]] };
})();
const av = { a: new V3(), b: new V3(), c: new V3(), e: new V3(), f: new V3(), r: new V3(), u: new V3(0, 1, 0) };
function placeLimb(m, a, b) {
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.scale.set(1, Math.max(0.01, a.distanceTo(b)), 1);
  m.quaternion.setFromUnitVectors(UP, tv2.subVectors(b, a).normalize());
}
// elbow / knee for a two-part limb from root S to end H, bending toward `bend`
function joint(S, H, L1, L2, bend, out) {
  const d = Math.min(L1 + L2 - 0.001, Math.max(0.01, S.distanceTo(H)));
  tv3.subVectors(H, S).normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  tv2.copy(bend).addScaledVector(tv3, -bend.dot(tv3)).normalize();
  return out.copy(S).addScaledVector(tv3, a).addScaledVector(tv2, hh);
}
function updateAvatar() {
  const on = started && SHOP.body && owns('body') && !freecam;
  avatar.g.visible = on;
  if (!on) return;
  const head = headPos(), yaw = bodyYaw();
  const fwd = av.f.set(-Math.sin(yaw), 0, -Math.cos(yaw)), right = av.r.set(Math.cos(yaw), 0, -Math.sin(yaw));
  const neck = av.a.copy(head).addScaledVector(UP, -0.24).addScaledVector(fwd, -0.07);
  holQ.setFromAxisAngle(UP, yaw);
  avatar.torso.position.copy(neck).addScaledVector(UP, -0.27); avatar.torso.quaternion.copy(holQ);
  avatar.hips.position.copy(neck).addScaledVector(UP, -0.58); avatar.hips.quaternion.copy(holQ);
  const floorY = P.y;
  // walking: stride with how fast the head is moving across the floor
  const dt = 1 / 72, moved = Math.hypot(head.x - avatar.last.x, head.z - avatar.last.z);
  avatar.last.copy(head);
  avatar.speed += (Math.min(4, moved / dt) - avatar.speed) * 0.15;
  const walking = avatar.speed > 0.25 && P.onGround;
  avatar.phase += walking ? moved * 6.5 : 0;
  const stride = walking ? Math.min(0.28, avatar.speed * 0.12) : 0;
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    const swing = Math.sin(avatar.phase + i * Math.PI);
    const hip = av.b.copy(neck).addScaledVector(UP, -0.64).addScaledVector(right, side * 0.09);
    const foot = av.c.set(hip.x, floorY + 0.08 + Math.max(0, swing) * stride * 0.5, hip.z).addScaledVector(fwd, 0.04 + swing * stride);
    const knee = joint(hip, foot, 0.44, 0.44, fwd, av.e);
    placeLimb(avatar.legs[i][0], hip, knee); placeLimb(avatar.legs[i][1], knee, foot);
    avatar.feet[i].position.copy(foot).addScaledVector(fwd, 0.06).setY(floorY + 0.04); avatar.feet[i].quaternion.copy(holQ);
    // arms to the hands (a free arm hangs at your side)
    const sh = av.b.copy(neck).addScaledVector(UP, -0.05).addScaledVector(right, side * 0.165);
    const hand = inVR ? vrHands.find(h => h.active && (h.side === 'left') === (side < 0)) : (side > 0 ? desk : null);
    // the arm ends at the wrist, behind the hand, so it doesn't poke through it
    const H = hand ? av.c.copy(hand.glove.position).add(tv.set(0, 0, 0.13).applyQuaternion(hand.glove.quaternion))
      : av.c.copy(sh).addScaledVector(UP, -0.55).addScaledVector(right, side * 0.05);
    const elbow = joint(sh, H, 0.3, 0.29, tv.copy(UP).multiplyScalar(-0.6).addScaledVector(right, side * 0.5).addScaledVector(fwd, -0.3), av.e);
    placeLimb(avatar.arms[i][0], sh, elbow); placeLimb(avatar.arms[i][1], elbow, H);
  }
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
      if (t.held !== h && (t.def.twoHand || t.def.melee) && !t.support && !t.embed && d < 0.16 && d < bd) { bd = d; best = { type: 'support', tool: t }; }
      continue;
    }
    if (d < bd) { bd = d; best = { type: 'tool', tool: t }; }
  }
  for (const p of world.particles) {
    if (p.pinned || p.gone || !(p.grab || p.body instanceof Dummy)) continue;
    const d = p.pos.distanceTo(h.pos) - p.r;
    if (d < bd - 0.06) { bd = d + 0.06; best = { type: 'particle', p }; }
  }
  // a hand round the throat beats anything else nearby
  for (const dm of dummies) {
    if (dm.bone.head.severed || dm.headGone || dm.skeleton || dm.p.neck.pinned) continue;
    if (tv.copy(dm.p.neck.pos).lerp(dm.p.head.pos, 0.4).distanceTo(h.pos) < 0.13 * dm.s) { best = { type: 'particle', p: dm.p.neck }; break; }
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
  if (best.type === 'support') {
    const t = best.tool;
    t.support = h;
    // which end the second hand went on: in front of the first (a gun's barrel, a
    // sword choked up) or behind it (a two-handed bat or axe grip)
    t.supportAhead = tv.subVectors(h.pos, t.held.pos).dot(tv2.subVectors(t.b.pos, t.a.pos)) > 0;
    t.supportAlong = Math.abs(tv.dot(tv2.normalize()));
    pulse(h, 0.4, 40); return;
  }
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
    if (t.npc) { const d = t.npc; d.weapon = null; t.npc = null; d.gunner = !!d.item && d.item.kind === 'gun'; }   // disarmed
    t.held = h; t.a.pinned = t.b.pinned = true; h.hasTip = false;
  }
  else {
    best.p.pinned = true; h.holdDist = Math.max(0.6, Math.min(1.6, best.dist ?? 0.9));
    const b = best.p.body;
    if (b instanceof Dummy && (b.bleeding || b.hp < 60)) bloody(h, 0.3);
    if (b instanceof Dummy) {
      b.heldBy = h; b.choked = best.p.name === 'neck' || best.p.name === 'head';
      if (b.alive) Dummy.say(b, b.choked ? 'choke' : 'grabbed');
    }
  }
  pulse(h, 0.4, 40);
}
function drop(h) {
  const held = h.held;
  if (!held) return;
  h.held = null;
  if (held.type === 'particle' && held.p.body instanceof Dummy) { held.p.body.heldBy = null; held.p.body.choked = false; }
  if (held.type === 'tool' && held.tool.embed) {
    // let go of a blade that's in someone: it stays in them
    const t = held.tool, e = t.embed, m = e.mesh;
    t.embed = null; t.held = null;
    qInv.copy(m.quaternion).invert();
    t.stuck = { d: e.d, mesh: m, lp: t.mesh.position.clone().sub(m.position).applyQuaternion(qInv), lq: qInv.clone().multiply(t.mesh.quaternion) };
    return;
  }
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
  if (body instanceof Dummy) { body.heldBy = null; body.choked = false; }
  for (const h of [...vrHands, desk]) {
    if (h.held?.type === 'particle' && h.held.p.body === body) { h.held.p.pinned = false; h.held = null; }
    if (h.held?.type === 'tool' && h.held.tool.embed?.d === body) h.held.tool.embed = null;
  }
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
  } else if (held?.type === 'support' && held.tool.def.melee) {
    // second hand wrapped round the handle, above or below the first
    const t = held.tool, [pos, rot] = GRIPS[t.kind];
    gy.copy(NEG_Z).applyQuaternion(t.mesh.quaternion);
    g.quaternion.copy(t.mesh.quaternion).multiply(gq.setFromAxisAngle(X_AXIS, rot));
    const along = (t.supportAhead ? 1 : -1) * Math.min(0.3, Math.max(0.1, t.supportAlong ?? 0.12));
    gv.set(-0.016 * s, 0.03, -0.04).applyQuaternion(g.quaternion);
    g.position.fromArray(pos).applyQuaternion(t.mesh.quaternion).add(t.mesh.position).addScaledVector(gy, along).add(gv);
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
    // desktop: a blade that's gone in stays at full reach until you click to pull it out
    const u = h.held?.tool?.embed ? 1 : h.jab > 0 ? Math.sin(Math.PI * (1 - h.jab / 0.22)) : 0;
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
    if (t.def.melee && !t.support) tq.multiply(TOOL_TILT.setFromAxisAngle(tv.set(1, 0, 0), inVR ? t.def.tiltVR ?? 1.05 : t.def.tiltDesk ?? 0.45));
    if (t.support && h.pos.distanceTo(t.support.pos) > 0.08) {
      // two-handed: the tool lies along the line between the hands
      if (t.supportAhead) aimM.lookAt(h.pos, t.support.pos, tv.set(0, 1, 0).applyQuaternion(h.quat));
      else aimM.lookAt(h.pos, tv2.copy(h.pos).multiplyScalar(2).sub(t.support.pos), tv.set(0, 1, 0).applyQuaternion(h.quat));
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
    else if (t.embed) { h.hasTip = false; updateEmbed(h, t); }
    else if (t.def.saw) saw(h, t, dt);
    else if (t.def.melee) melee(h, t, dt);
    else {
      t.cool -= dt;
      if (t.def.flame) { flameTool(h, t, dt); h.wasTrigger = h.trigger; placeGlove(h); return; }
      if (t.def.spin) {
        // the barrels have to wind up before it fires
        t.spin = Math.max(0, Math.min(1, (t.spin ?? 0) + (h.trigger ? dt / 0.6 : -dt / 0.9)));
        t.mesh.userData.barrels.rotation.z += t.spin * dt * 45;
        if (t.spin < 0.95) { h.wasTrigger = h.trigger; placeGlove(h); return; }
      }
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
    if (i !== -1) take(t, 'panel', { index: i });
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
  if (def.launcher) {
    // lobbed grenade: bursts on a body, otherwise on a short fuse
    const g = spawnGrenade(fromV.x, fromV.y, fromV.z);
    g.p.setVelocity(tv.copy(dirV).multiplyScalar(15).add(tv2.set(0, 1.5, 0)), world.dt);
    g.fuse = 1.6; g.impact = true; return;
  }
  if (def.bolt) { spawnBolt(fromV, dirV); return; }
  const hitsPer = new Map(), clusters = new Map();
  for (let i = 0; i < def.pellets; i++) {
    const sp = def.spread * steady;
    dirV.copy(NEG_Z).applyQuaternion(t.aimQ);
    dirV.x += (Math.random() - 0.5) * 2 * sp; dirV.y += (Math.random() - 0.5) * 2 * sp; dirV.z += (Math.random() - 0.5) * 2 * sp;
    dirV.normalize();
    let r = hitscan(o, dirV);
    hitPt.copy(o).addScaledVector(dirV, r.t);
    tracer(fromV, hitPt);
    // a sniper round keeps going through the first two bodies
    if (def.pierce) for (let k = 0; k < 2 && r.kind === 'dummy'; k++) {
      const d = r.dummy;
      d.addWound(r.bone, hitPt, dirV, 'bullet', true);
      d.hit(r.bone, def.dmg, tv.copy(dirV).multiplyScalar(def.push), hitPt, { bullet: true, big: true, dir: dirV });
      gore.spray(hitPt, dirV, 14, 7, 0.3);
      const from = tv2.copy(hitPt).addScaledVector(dirV, 0.45);
      const r2 = hitscan(from, dirV);
      if (r2.kind !== 'dummy' || r2.dummy === d) { r = { kind: 'none' }; break; }
      r = r2; hitPt.copy(from).addScaledVector(dirV, r.t);
    }
    if (r.kind === 'dummy' && r.dummy.armor && !def.gib && r.dummy.alive &&
      (!r.bone ? true : r.bone.name === 'head' && (r.dummy.armor > 1 || hitPt.y > r.dummy.p.head.pos.y - 0.02))) {
      // stopped by the vest or helmet
      gore.sparks(hitPt, 6); sfx.thud();
      r.dummy.p.chest.push(tv.copy(dirV).multiplyScalar(1.2), world.dt);
      continue;
    }
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
        if (tv.y < -0.7 && (hit?.name === 'head' || touch || torso)) {
          // remember how low this stroke has reached; it's resolved when the blade leaves them
          const low = hit?.name === 'head' ? 0.75 * d.s : d.heightOf(touch ? gutV : h.tip);
          d.stroke = { low: Math.min(d.stroke?.low ?? 9, low), last: performance.now() / 1000, hand: h };
          continue;
        }
        const done = Math.abs(tv.y) < 0.5 && touch ? d.splitWaist(gutV) : false;
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
        embedTool(t, d, hit, hit ? (hit.name === 'head' ? d.headMesh : hit.mesh) : d.torsoMesh);
        return;
      }
      if (def.blunt) {
        if (speed > 4) gore.spray(at, tv, 8, 3, 0.7);
        d.hit(hit, def.dmg, tv2.copy(tv).multiplyScalar(Math.min(def.heavy ? 22 : 12, speed * (def.heavy ? 3 : 1.6))), at);
        if (def.heavy && hit?.name === 'head' && speed > 4) d.explodeHead();
        if (hit?.name === 'head') d.bruise = Math.min(3, d.bruise + 0.5);
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
const sweepV = new V3();
function saw(h, t, dt) {
  h.hasTip = false;
  // how fast the bar is moving, for sweep cuts
  if (h.sawPrev) { tv.subVectors(t.b.pos, h.sawPrev).divideScalar(Math.max(dt, 1e-4)); h.sawVel.lerp(tv, 0.5); }
  else { h.sawPrev = new V3(); h.sawVel = new V3(); }
  h.sawPrev.copy(t.b.pos); sweepV.copy(h.sawVel);
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
    // ripped through fast enough, it goes straight through, every frame it's in them
    const onHead0 = hit?.name === 'head';
    if (!d.split && (onHead0 || touch)) {
      const sp = sweepV.length();
      if (sp > 2.2) {
        const top = onHead0 || d.heightOf(gutV.copy(bladeA).lerp(t.b.pos, trunkS)) > 0.36;
        const down = sweepV.y < -0.6 * sp, level = Math.abs(sweepV.y) < 0.6 * sp;
        if (top && down) { d.stroke = { low: Math.min(d.stroke?.low ?? 9, onHead0 ? 0.75 * d.s : d.heightOf(gutV)), last: performance.now() / 1000, hand: h }; continue; }
        if (!top && (level || down) && d.splitWaist()) { sfx.splat(); pulseAll(1, 150); bloody(h, 0.4); continue; }
      }
    }
    if (d.sliceCd > 0) continue;
    d.sliceCd = 0.1;
    // where on the bar it's biting
    const at = tv3.copy(bladeA).lerp(t.b.pos, hit ? limbS : trunkS);
    tv.set(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).normalize();
    gore.spray(at, tv, 14, 5, 0.9);
    d.addWound(hit, at, bladeDir, 'slash');
    const onHead = hit?.name === 'head';
    if (!d.split && (onHead || touch)) {
      // Held in: into the head or shoulders it splits them lengthways, into the
      // middle it cuts them in two.
      const top = onHead || d.heightOf(gutV.copy(bladeA).lerp(t.b.pos, trunkS)) > 0.36;
      d.sawTop = (d.sawTop ?? 0) + (top ? 1 : 0); d.sawMid = (d.sawMid ?? 0) + (top ? 0 : 1);
      const done = top && d.sawTop >= 3 ? d.splitVertical(Math.min(0.6 * d.s, d.heightOf(gutV))) : !top && d.sawMid >= 3 ? d.splitWaist() : false;
      if (done) { sfx.splat(); pulseAll(1, 150); bloody(h, 0.4); continue; }
    }
    if (onHead && !d.split) { d.hp -= 30; d.hurtT = 1; if (d.hp <= 0) d.die(); }
    else d.hit(hit, 1.6, tv2.copy(bladeDir).multiplyScalar(0.6), at);
    if (d.alive && Math.random() < 0.3) sfx.grunt();
    bloody(h, 0.06);
  }
}

// The blade is in them but still in your hand. Pull back hard enough and it
// comes out; move gently and you drag them about on it; let go and it stays in.
function embedTool(t, d, bone, mesh) {
  const anchor = tv.copy(h_tip(t)).addScaledVector(bladeDir, -0.05);
  qInv.copy(mesh.quaternion).invert();
  t.embed = {
    d, mesh,
    body: anchor.clone().sub(mesh.position).applyQuaternion(qInv),   // the spot on them
    blade: t.mesh.worldToLocal(anchor.clone()),                       // the same spot on the blade
    parts: bone ? (bone.name === 'head' ? [d.p.head] : [bone.a, bone.b]) : [d.p.chest, d.p.pelvis, d.p.neck],
  };
  gore.emitter(t.b, 4, 22);
}
function h_tip(t) { return t.b.pos; }
const embA = new V3(), embB = new V3();
function updateEmbed(h, t) {
  const e = t.embed;
  if (e.d.gone || !e.mesh.visible) { t.embed = null; return; }
  embA.copy(e.body).applyQuaternion(e.mesh.quaternion).add(e.mesh.position);
  embB.copy(e.blade); t.mesh.localToWorld(embB);
  const pull = embB.sub(embA);
  if (pull.length() > 0.2) yankOut(h, t);
  else for (const p of e.parts) {
    if (p.pinned) continue;
    p.pos.addScaledVector(pull, 0.3); p.prev.addScaledVector(pull, 0.22);
  }
}
function yankOut(h, t) {
  const e = t.embed;
  if (!e) return;
  embA.copy(e.body).applyQuaternion(e.mesh.quaternion).add(e.mesh.position);
  const pull = embB.subVectors(t.a.pos, embA);
  {
    t.embed = null;
    gore.spray(embA, tv.copy(pull).normalize(), 20, 3.5, 0.6); gore.emitter(e.parts[0], 3, 25);
    e.d.bleeding += 0.5; e.d.sliceCd = 0.4; sfx.squish(); bloody(h, 0.2); pulse(h, 0.8, 60);
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
// a downward stroke that has left the body (or reached the crotch) gets its cut now
function resolveStrokes() {
  const now = performance.now() / 1000;
  for (const d of dummies) {
    const st = d.stroke;
    if (!st || (now - st.last < 0.07 && st.low > 0.12 * d.s)) continue;
    d.stroke = null;
    if (d.splitVertical(st.low)) { sfx.slice(); sfx.splat(); pulseAll(1, 150); bloody(st.hand, 0.4); }
  }
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
    if (h.held) continue;
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
      // A hard punch landing on the front of the chest tears the heart out into
      // your fist. (Any upper-chest point counts: the body gives way under the fist.)
      if (isDummy && speed > 3 && (p.name === 'chest' || p.name === 'lSh' || p.name === 'rSh' || p.name === 'neck')) {
        const dm = p.body;
        if (!dm.heartOut && !dm.split && dm.torsoMesh.visible) {
          tv.subVectors(dm.p.rSh.pos, dm.p.lSh.pos); tv2.subVectors(dm.p.neck.pos, dm.p.pelvis.pos); tv3.crossVectors(tv, tv2).normalize();   // body forward
          if (tv.subVectors(h.pos, dm.p.chest.pos).dot(tv3) > -0.03) {
            const heart = dm.ripHeart();
            if (heart) {
              heart.pinned = true; h.held = { type: 'particle', p: heart };
              sfx.splat(); sfx.squish(); pulse(h, 1, 160); bloody(h, 0.6); h.punchCd = 0.5;
              break;
            }
          }
        }
      }
      if (isDummy && speed > 2.2 && h.punchCd <= 0) {
        const dm = p.body, head = p.name === 'head';
        h.punchCd = 0.25;
        dm.hp -= speed * (head ? 7 : 3.5); dm.stun = 1.2; dm.aggro = true;
        if (head) dm.bruise = Math.min(3, dm.bruise + 0.34);   // three good punches per stage of bruising
        if (speed > 4.2) dm.knockdown(2 + Math.random());
        if (speed > 3.2) { gore.spray(p.pos, tv.copy(h.vel).normalize(), head ? 10 : 4, 3, 0.7); bloody(h, 0.2); }
        if (dm.hp <= 0) dm.die();
        sfx.thud(); pulse(h, 1, 70);
      }
    }
  }
}

// ------------------------------------------------------------ player health + survival mode
const P = { hp: 100, dead: false, deadT: 0, flash: 0, lastHit: -99, y: 0, vy: 0, vx: 0, vz: 0, onGround: true };
const SV = { on: false, wave: 0, queue: 0, inter: 0, spawnT: 0, best: 0, kills: 0 };
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
applyHands();
function drawHud() {
  const hp = Math.max(0, Math.ceil(P.hp));
  const left = SV.on ? SV.queue + dummies.filter(d => d.wave && d.alive).length : 0;
  const boss = SV.on && dummies.find(d => d.boss && d.alive);
  const info = SV.on ? (boss ? 'BOSS ' + Math.max(0, Math.round(boss.hp / boss.maxHp * 100)) + '%' : 'WAVE ' + SV.wave + (SV.inter > 0 ? ' incoming' : ' · ' + left + ' left')) : '';
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
  g.fillText(info || 'KILLS ' + fmtKills(), 128, 96);
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
    banner('GAME OVER', 'Wave ' + wave + ' · ' + SV.kills + ' kills · best wave ' + SV.best, 3.5);
  } else banner('YOU DIED', '', 3);
}
function respawn() {
  P.hp = 100; P.dead = false; P.flash = 0;
  P.y = 0; P.vy = 0; P.vx = 0; P.vz = 0;
  fullReset();
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
      const wpn = d.weapon && GUNS[d.weapon.kind].melee ? d.weapon : null;
      const reach = d.state === 'stand' ? 1.25 + (wpn ? wpn.def.len * 0.5 : 0) : d.state === 'crawl' ? 0.85 : 0;
      if (reach && d.stun < 0.4 && Math.hypot(d.p.chest.pos.x - head.x, d.p.chest.pos.z - head.z) < reach) {
        d.atkT = (d.atkT ?? 0.6) - sdt;
        if (d.atkT <= 0) { d.atkT = 0.9; damagePlayer(d.state === 'crawl' ? 5 : wpn ? MELEE_HIT[wpn.kind] ?? 15 : d.dmg ?? 10); Dummy.say(d, 'attack'); if (wpn?.kind === 'chainsaw') sfx.slice(); else if (wpn) sfx.thud(); }
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
  SV.on = true; SV.wave = 0; SV.kills = 0;
  // survival has its own soundtrack: one of the action tracks
  SV.prevTrack = S.track;
  music.play(music.tracks.findIndex(t => t.name.startsWith('Action')) + Math.floor(Math.random() * 2));
  nextWave();
}
function endSurvival() {
  if (!SV.on) return;
  SV.on = false;
  if (SV.wave > SV.best) { SV.best = SV.wave; try { localStorage.setItem('goreLabBest', SV.best); } catch { /* ignore */ } }
  for (const d of dummies) if (d.wave) d.aggro = false;
  music.play(SV.prevTrack ?? S.track);   // back to whatever was on before
  hudKey = '';
}
function nextWave() {
  SV.wave++; SV.queue = 3 + SV.wave * 2; SV.inter = SV.wave === 1 ? 3 : 6; SV.spawnT = 0;
  // every fifth wave brings a boss
  SV.boss = SV.wave % 5 === 0 ? (SV.wave % 10 === 5 ? 'butcher' : 'juggernaut') : null;
  if (SV.boss) { SV.queue = Math.ceil(SV.queue * 0.6); banner('BOSS WAVE', DUMMY_TYPES[SV.boss].boss); }
  else banner('WAVE ' + SV.wave, SV.queue + ' incoming');
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
      x = (Math.random() - 0.5) * 2 * (HALF - 1.5); z = (Math.random() - 0.5) * 2 * (HALF - 1.5);
      if (Math.hypot(x - head.x, z - head.z) > 5 && !insideBox(x, z)) break;
    }
    // the mix gets nastier as the waves go on
    const w = SV.wave, r = Math.random();
    let kind = { ...DUMMY_TYPES.zombie, speed: Math.min(2, 1.15 + w * 0.07) };
    if (SV.boss) { kind = DUMMY_TYPES[SV.boss]; SV.boss = null; SV.queue++; }
    else if (w >= 8 && r < 0.05) kind = DUMMY_TYPES.giant;
    else if (w >= 6 && r < 0.13) kind = DUMMY_TYPES.bomber;
    else if (w >= 6 && r < 0.23) kind = DUMMY_TYPES.riot;
    else if (w >= 4 && r < 0.33) kind = DUMMY_TYPES.gunman;
    else if (w >= 4 && r < 0.43) kind = DUMMY_TYPES.crawler;
    else if (w >= 3 && r < 0.55) kind = { ...DUMMY_TYPES.brute, aggro: true, speed: 1, dmg: 20 };
    else if (w >= 2 && r < 0.72) kind = DUMMY_TYPES.runner;
    const d = spawnDummy(x, z, kind);
    d.wave = true;
    SV.queue--; SV.spawnT = Math.max(0.35, 1.1 - SV.wave * 0.06);
  } else if (SV.queue === 0 && alive === 0) {
    // wave cleared: patch up, sweep the bodies out, go again
    P.hp = Math.min(100, P.hp + 25);
    for (let i = dummies.length - 1; i >= 0; i--) if (!dummies[i].alive) { releaseBody(dummies[i]); disposeDummy(dummies[i]); dummies.splice(i, 1); }
    nextWave();
  }
}

// ------------------------------------------------------------ main menu (floating panel, pauses the game)
let paused = false, played = false;
const UI = { w: 1.7, h: 1.5, hover: -1, side: 0, follow: 0, head: 150, rowH: 67, help: -1, shop: false, cheat: false, gore: false };
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
  { label: () => 'GORE:  ' + goreName(), act: () => { UI.gore = true; } },
  { label: () => 'SHOP', act: () => { UI.shop = true; } },
  { label: () => 'GET A SPAWN GUN', act: () => giveSpawnGun() },
  { label: () => 'DO NOT CLICK', act: () => { UI.cheat = true; } },
];
// ---- gore level: four presets, or tune each part by hand (that makes it Custom)
const GORE_PRESETS = {
  none: { name: 'No gore', blood: 0, gibs: 0, sever: false, wounds: false, guts: false },
  medium: { name: 'Medium', blood: 0.5, gibs: 0.5, sever: true, wounds: true, guts: false },
  bravin: { name: "Bravin' it", blood: 1, gibs: 1, sever: true, wounds: true, guts: true },
  ultra: { name: 'ULTRAMAX!!!', blood: 2.5, gibs: 2.5, sever: true, wounds: true, guts: true },
};
const PRESET_KEYS = Object.keys(GORE_PRESETS);
S.goreSet ??= { preset: 'bravin', ...GORE_PRESETS.bravin };
try { const o = JSON.parse(localStorage.getItem('goreLabGore') || 'null'); if (o) S.goreSet = o; } catch { /* default */ }
const goreName = () => S.goreSet.preset === 'custom' ? 'Custom' : GORE_PRESETS[S.goreSet.preset].name;
function applyGore() {
  const g = S.goreSet;
  gore.blood = g.blood; gore.gibMult = g.gibs;
  Dummy.gore.sever = g.sever; Dummy.gore.wounds = g.wounds; Dummy.gore.guts = g.guts;
  try { localStorage.setItem('goreLabGore', JSON.stringify(g)); } catch { /* ignore */ }
}
function setGore(change) {
  if (typeof change === 'string') S.goreSet = { preset: change, ...GORE_PRESETS[change] };
  else Object.assign(S.goreSet, change, { preset: 'custom' });
  delete S.goreSet.name; applyGore();
}
const pct = v => Math.round(v * 100) + '%', onOff = v => v ? 'ON' : 'OFF';
const GORE_ROWS = [
  { label: () => '◀  BACK TO MENU', act: () => { UI.gore = false; } },
  { sel: true, label: () => 'PRESET:  ' + goreName(), act: d => {
    const i = PRESET_KEYS.indexOf(S.goreSet.preset);
    setGore(PRESET_KEYS[((i < 0 ? 2 : i) + d + PRESET_KEYS.length) % PRESET_KEYS.length]);
  } },
  { label: () => 'CUSTOM: change any of these', act: () => {} },
  { sel: true, label: () => 'BLOOD:  ' + pct(S.goreSet.blood), act: d => setGore({ blood: Math.max(0, Math.min(3, Math.round((S.goreSet.blood + d * 0.25) * 4) / 4)) }) },
  { sel: true, label: () => 'CHUNKS & GIBS:  ' + pct(S.goreSet.gibs), act: d => setGore({ gibs: Math.max(0, Math.min(3, Math.round((S.goreSet.gibs + d * 0.25) * 4) / 4)) }) },
  { label: () => 'LIMBS & HEADS COME OFF:  ' + onOff(S.goreSet.sever), act: () => setGore({ sever: !S.goreSet.sever }) },
  { label: () => 'WOUNDS & HOLES:  ' + onOff(S.goreSet.wounds), act: () => setGore({ wounds: !S.goreSet.wounds }) },
  { label: () => 'GUTS & ORGANS:  ' + onOff(S.goreSet.guts), act: () => setGore({ guts: !S.goreSet.guts }) },
  null, null, null,
];
applyGore();

// the cheat bar behind DO NOT CLICK
const CHEAT_ROWS = [
  { label: () => '◀  BACK TO MENU', act: () => { UI.cheat = false; } },
  { label: () => 'INFINITE KILLS:  ' + (S.kills === Infinity ? 'ON' : 'OFF'), act: () => { S.kills = S.kills === Infinity ? 0 : Infinity; saveKills(); drawPanel(); } },
  { label: () => 'To undo it, hit RESET KILLS on the wall panel.', act: () => {} },
  null, null, null, null, null, null, null, null,
];
// lost it? a fresh spawn gun straight into an empty hand, or at your feet
function giveSpawnGun() {
  const h = (inVR ? vrHands : [desk]).find(x => x.active && !x.held);
  const head = headPos();
  camera.getWorldDirection(tv); tv.y = 0; tv.normalize();
  const t = makeTool('spawngun', head.x + tv.x * 0.6, Math.max(0.3, head.y - 0.6), head.z + tv.z * 0.6);
  if (h) { t.held = h; t.a.pinned = t.b.pinned = true; h.held = { type: 'tool', tool: t }; h.hasTip = false; }
  sfx.spawn();
}
// what the INSTRUCTIONS button shows, a page at a time
const HELP = [
  ['MOVING', [
    'Left stick: walk.   Right stick: turn.',
    'A: jump. You can get up on crates and the table.',
    'Rocket jump: fire a rocket at your feet. 10 damage, big boost.',
    'Click either stick in: open or close this menu.',
    'Too tall or too short? Change HEIGHT in this menu.',
    'Desktop: WASD, mouse, Space to jump, M for menu.',
  ]],
  ['HANDS AND GUNS', [
    'Grip: grab and let go. Point and grip to pull things to you.',
    'Trigger: shoot.   Grip alone points your finger.',
    "Two hands: grip a long gun's barrel, or any melee weapon's handle,",
    'with your other hand to hold it two-handed.',
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
    'Chainsaw: hold the trigger and push it in, or rip it through:',
    'into the waist cuts them in two, into the head splits them.',
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
    'Hurt anyone and they come for you. Hostiles grab dropped weapons.',
    'Grab the weapon out of an enemy\'s hand to disarm them.',
    'B: slow-mo.   X: hostile on / off.   Y: clear everything.',
  ]],
];
const HELP_ROWS = [
  { label: () => '◀  BACK TO MENU', act: () => { UI.help = -1; } },
  null, null, null, null, null, null, null, null, null,
  { sel: true, label: () => 'PAGE ' + (UI.help + 1) + ' / ' + HELP.length, act: d => { UI.help = (UI.help + d + HELP.length) % HELP.length; } },
];
const uiRows = () => UI.gore ? GORE_ROWS : UI.cheat ? CHEAT_ROWS : UI.shop ? SHOP_ROWS : UI.help >= 0 ? HELP_ROWS : UI_ROWS;
function drawMainMenu() {
  if (!UI.mesh.visible) return;
  const g = UI.canvas.getContext('2d'), W = 1024, H = 900;
  g.fillStyle = '#14171c'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8792b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 92px Helvetica, Arial, sans-serif'; g.fillText(UI.gore ? 'GORE' : UI.cheat ? 'CHEATS' : UI.shop ? 'SHOP' : 'GORE LAB', W / 2, 62);
  g.fillStyle = '#8b94a1'; g.font = '28px Helvetica, Arial, sans-serif';
  g.fillText(UI.shop || UI.cheat || UI.gore ? (UI.gore ? 'Pick a preset, or tune it yourself.' : UI.cheat ? 'You clicked it.' : 'Unlocked with kills. You have ' + fmtKills() + '.') : inVR ? 'point and pull the trigger · click a stick to open this menu' : 'click to choose · M opens this menu', W / 2, 126);
  if (UI.help >= 0 && !UI.shop && !UI.cheat && !UI.gore) {
    const [title, lines] = HELP[UI.help], top = UI.head + UI.rowH;
    g.fillStyle = '#1c2026'; g.fillRect(40, top + 6, W - 80, UI.rowH * 9 - 12);
    g.fillStyle = '#e8792b'; g.font = 'bold 50px Helvetica, Arial, sans-serif'; g.fillText(title, W / 2, top + 50);
    g.fillStyle = '#f2f4f7'; g.font = '32px Helvetica, Arial, sans-serif';
    lines.forEach((ln, i) => g.fillText(ln, W / 2, top + 118 + i * 60));
  }
  uiRows().forEach((r, i) => {
    if (!r) return;
    const y = UI.head + i * UI.rowH, hot = i === UI.hover;
    g.fillStyle = hot ? '#e8792b' : r.locked?.() ? '#1e2126' : i < 2 && UI.help < 0 && !UI.shop && !UI.cheat && !UI.gore ? '#3a2a1c' : '#2a3038'; g.fillRect(40, y + 6, W - 80, UI.rowH - 12);
    if (r.swatch) { g.fillStyle = r.swatch(); g.fillRect(150, y + 18, 46, UI.rowH - 36); }
    g.fillStyle = hot ? '#14171c' : r.locked?.() ? '#7d8794' : '#f2f4f7'; g.font = 'bold 36px Helvetica, Arial, sans-serif';
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
  paused = true; UI.mesh.visible = true; UI.hover = -1; UI.help = -1; UI.shop = false; UI.cheat = false; UI.gore = false;
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

// ------------------------------------------------------------ voices
const ALWAYS = new Set(['die', 'burnDie', 'heart', 'passout', 'dismember']);
Dummy.onSay = (d, ev) => {
  const now = performance.now() / 1000;
  if (!ALWAYS.has(ev) && now - (d.saidAt ?? -9) < 1.6) return;
  d.saidAt = now;
  sfx.voice?.(ev, d.p.chest.pos, d.type, d.s);
};

// ------------------------------------------------------------ fire
let flameOn = false;
function flameTool(h, t, dt) {
  if (!h.trigger) return;
  flameOn = true;
  t.muzzle.getWorldPosition(fromV);
  tv.copy(NEG_Z).applyQuaternion(t.aimQ ?? h.quat);
  pulse(h, 0.25, 30);
  t.flameAcc = (t.flameAcc ?? 0) + dt * 110;
  while (t.flameAcc >= 1) {
    t.flameAcc -= 1;
    gore.flame(fromV.x, fromV.y, fromV.z, tv.x * 9 + (Math.random() - 0.5) * 1.4, tv.y * 9 + (Math.random() - 0.5) * 1.4, tv.z * 9 + (Math.random() - 0.5) * 1.4, 0.55 + Math.random() * 0.25, 0.05, true);
  }
}
// flames from the thrower set alight whatever they reach; burning bodies spread it
function updateFire(sdt) {
  gore.forHotFlames((x, y, z, size, i) => {
    for (const d of dummies) {
      const c = d.p.chest.pos, dx = x - c.x, dy = y - c.y, dz = z - c.z;
      if (dx * dx + dy * dy + dz * dz > (1.1 * d.s) ** 2) continue;
      tv.set(x, y, z);
      let near = segSeg(tv, tv, d.p.pelvis.pos, d.p.neck.pos) < (0.2 + size) ** 2;
      for (const b of d.bones) if (!near && segSeg(tv, tv, b.a.pos, b.b.pos) < (b.r + 0.08 + size) ** 2) near = true;
      if (near) { d.ignite(); gore.slowFlame(i); return; }
    }
    for (const b of barrels) if (b.a.pos.distanceTo(tv.set(x, y, z)) < 0.5) { b.heat = (b.heat ?? 0) + sdt * 0.3; if (b.heat > 1) explode(b); }
  });
  for (const d of dummies) {
    if (!d.burn(sdt)) continue;
    // flames licking off the body
    for (let i = 0; i < 3; i++) {
      const p = d.all[Math.floor(Math.random() * d.all.length)];
      gore.flame(p.pos.x, p.pos.y, p.pos.z, (Math.random() - 0.5) * 0.6, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.3, 0.07 + Math.random() * 0.06, false);
    }
    for (const o of dummies) if (o !== d && o.fireT <= 0 && o.p.chest.pos.distanceTo(d.p.chest.pos) < 0.7) o.ignite();
  }
}

// crossbow bolts fly, drop a little, and stick in whatever they hit
const bolts = [];
const boltGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.38, 6); boltGeo.rotateX(Math.PI / 2);
function boltMesh() {
  const m = new THREE.Mesh(boltGeo, M.steel);
  for (const r of [0, Math.PI / 2]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.022, 0.05), M.red); f.position.z = 0.16; f.rotation.z = r; m.add(f); }
  return m;
}
function spawnBolt(pos, dir) {
  const m = boltMesh(); m.position.copy(pos); scene.add(m);
  bolts.push({ pos: pos.clone(), vel: dir.clone().multiplyScalar(45), mesh: m, life: 3, stuck: false });
}
function updateBolts(sdt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    if (b.stuck) { if ((b.life -= sdt) <= 0) { b.mesh.removeFromParent(); bolts.splice(i, 1); } continue; }
    b.vel.y += world.gravity * 0.15 * sdt;
    const step = b.vel.length() * sdt;
    tv2.copy(b.vel).normalize();
    const r = hitscan(b.pos, tv2);
    if (r.t <= step) {
      hitPt.copy(b.pos).addScaledVector(tv2, r.t);
      b.stuck = true; b.life = 20;
      if (r.kind === 'dummy') {
        const d = r.dummy, part = r.bone ? (r.bone.name === 'head' ? d.headMesh : r.bone.mesh) : d.torsoMesh;
        d.addWound(r.bone, hitPt, tv2, 'stab');
        d.hit(r.bone, 2.5, tv.copy(tv2).multiplyScalar(4), hitPt);
        gore.spray(hitPt, tv2, 10, 3, 0.5); sfx.squish();
        // pinned in the body part, sticking out the way it went in
        qInv.copy(part.quaternion).invert();
        b.mesh.position.copy(hitPt).addScaledVector(tv2, 0.06).sub(part.position).applyQuaternion(qInv).divideScalar(d.s);
        b.mesh.quaternion.copy(qInv).multiply(tq.setFromUnitVectors(NEG_Z, tv2));
        part.add(b.mesh); b.life = 1e9;
      } else {
        b.mesh.position.copy(hitPt).addScaledVector(tv2, -0.12); b.mesh.quaternion.setFromUnitVectors(NEG_Z, tv2);
        if (r.kind === 'barrel') { if (--r.barrel.hp <= 0) explode(r.barrel); }
        else if (r.kind === 'grenade') r.grenade.fuse = 0.02;
        else gore.sparks(hitPt, 3);
      }
      continue;
    }
    b.pos.addScaledVector(b.vel, sdt);
    b.mesh.position.copy(b.pos); b.mesh.quaternion.setFromUnitVectors(NEG_Z, tv2);
    if ((b.life -= sdt) <= 0) { b.mesh.removeFromParent(); bolts.splice(i, 1); }
  }
}

// ------------------------------------------------------------ enemy behaviour
// Hostile enemies pick up weapons left lying about and use them on you.
const MELEE_HIT = { knife: 14, machete: 20, katana: 26, bat: 16, chainsaw: 32, axe: 26, sledge: 30 };
const onTable = t => t.a.pos.x > TABLE.min.x - 0.1 && t.a.pos.x < TABLE.max.x + 0.1 && t.a.pos.z > TABLE.min.z - 0.1 && t.a.pos.z < TABLE.max.z + 0.1 && t.a.pos.y > 0.7;
function freeTool(t) { return !t.held && !t.stuck && !t.holster && !t.embed && !t.npc && t.kind !== 'spawngun' && !onTable(t); }
function dropWeapon(d) {
  const t = d.weapon;
  if (!t) return;
  d.weapon = null; t.npc = null; t.claim = null;
  t.a.pinned = t.b.pinned = false;
  d.gunner = !!d.item && d.item.kind === 'gun';
}
// a weapon in an enemy's hand follows the hand; guns point at you
function holdWeapon(d, head) {
  const t = d.weapon, hand = d.p.rHand;
  if (!d.alive || d.gone || d.bone.rForearm.severed || d.bone.rUpperArm.severed || d.heldBy) { dropWeapon(d); return; }
  if (t.def.melee) tv.subVectors(hand.pos, d.bone.rForearm.a.pos).normalize().lerp(UP, 0.5).normalize();
  else tv.subVectors(head, hand.pos).normalize();
  t.mesh.quaternion.setFromUnitVectors(NEG_Z, tv);
  t.mesh.position.copy(hand.pos);
  t.a.pos.copy(hand.pos); t.b.pos.copy(hand.pos).addScaledVector(tv, t.def.len);
  t.a.prev.copy(t.a.pos); t.b.prev.copy(t.b.pos);
}
// an armed enemy firing at you
function enemyFire(d, head) {
  const t = d.weapon, def = t.def;
  t.mesh.updateMatrixWorld(true);
  const from = t.muzzle ? t.muzzle.getWorldPosition(tv2) : tv2.copy(t.b.pos);
  t.flashT = 0.05; if (t.flash) t.flash.visible = true;
  sfx.shot(def.sound);
  dirV.subVectors(head, from).normalize();
  if (def.rocket) { spawnRocket(from, dirV); return; }
  if (def.launcher) { const g = spawnGrenade(from.x, from.y, from.z); g.p.setVelocity(tv.copy(dirV).multiplyScalar(11).add(tv3.set(0, 2.5, 0)), world.dt); g.fuse = 1.8; g.impact = true; return; }
  if (def.bolt) { spawnBolt(from, tv.copy(dirV).add(tv3.set((Math.random() - 0.5) * 0.08, 0.02, (Math.random() - 0.5) * 0.08)).normalize()); if (Math.random() < 0.35) damagePlayer(25); return; }
  let dmg = 0;
  for (let i = 0; i < (def.pellets ?? 1); i++) {
    const to = tv3.copy(head).add(tv.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.6));
    tracer(from, to);
    if (Math.random() < 0.35) dmg += Math.min(20, 7 * (def.dmg ?? 1));
  }
  if (dmg) { damagePlayer(dmg); if (Math.random() < 0.4) Dummy.say(d, 'taunt'); }
}
function updateArmed(d, sdt, head, dist) {
  if (d.weapon) {
    holdWeapon(d, head);
    const t = d.weapon;
    if (!t || t.def.melee || !d.alive || d.state !== 'stand' || dist > 18 || dist < 1) return;
    if (t.flashT > 0 && (t.flashT -= sdt) <= 0 && t.flash) t.flash.visible = false;
    if ((d.wShootT = (d.wShootT ?? 1.5) - sdt) <= 0) {
      const def = t.def;
      d.wShootT = def.rocket || def.launcher ? 4 + Math.random() * 2 : def.auto ? 0.5 + Math.random() * 0.4 : Math.max(def.cool ?? 1, 1.1) + Math.random() * 1.2;
      enemyFire(d, head);
    }
    return;
  }
  // unarmed and hostile: go and get the nearest weapon lying around
  if (!d.alive || d.state !== 'stand' || d.heldBy || d.item || !(S.hostile || d.aggro)) { if (d.goal) { d.goal = null; if (d.seek) d.seek.claim = null; d.seek = null; } return; }
  if (d.seek && (!freeTool(d.seek) || d.seek.claim !== d)) { d.seek = null; d.goal = null; }
  if (!d.seek && (d.seekT = (d.seekT ?? 0) - sdt) <= 0) {
    d.seekT = 0.6;
    let best = null, bd = 6;
    for (const t of tools) {
      if (!freeTool(t) || (t.claim && t.claim !== d)) continue;
      const dd = Math.hypot(t.a.pos.x - d.p.pelvis.pos.x, t.a.pos.z - d.p.pelvis.pos.z);
      if (dd < bd) { bd = dd; best = t; }
    }
    if (best) { d.seek = best; best.claim = d; }
  }
  if (d.seek) {
    const t = d.seek;
    d.goal = { x: t.a.pos.x, z: t.a.pos.z };
    if (Math.hypot(t.a.pos.x - d.p.pelvis.pos.x, t.a.pos.z - d.p.pelvis.pos.z) < 0.6 * d.s) {
      // picked it up
      d.goal = null; d.seek = null;
      d.weapon = t; t.npc = d; t.claim = null; t.a.pinned = t.b.pinned = true;
      d.gunner = !t.def.melee; d.wShootT = 1.2;
      Dummy.say(d, 'attack');
    }
  }
}
function updateEnemies(sdt) {
  const head = headPos();
  for (const d of [...dummies]) {
    updateArmed(d, sdt, head, Math.hypot(d.p.chest.pos.x - head.x, d.p.chest.pos.z - head.z));
    const dist = Math.hypot(d.p.chest.pos.x - head.x, d.p.chest.pos.z - head.z);
    if (d.gunner && d.item && d.alive && d.state === 'stand' && !d.heldBy && (S.hostile || d.aggro) && dist < 16 && dist > 1.2) {
      if ((d.shootT -= sdt) <= 0) {
        d.shootT = 1.3 + Math.random() * 1.3;
        const from = tv2.copy(NEG_Z).applyQuaternion(d.item.mesh.quaternion).multiplyScalar(0.2 * d.s).add(d.item.mesh.position);
        const to = tv3.copy(head).add(tv.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5));
        tracer(from, to); sfx.shot('pistol');
        if (Math.random() < 0.4) { damagePlayer(8); if (Math.random() < 0.5) Dummy.say(d, 'taunt'); }
      }
    }
    if (d.bomb && !d.bombDone) {
      if (d.bombT === undefined && ((d.alive && dist < 1.6 * d.s && (S.hostile || d.aggro)) || !d.alive)) { d.bombT = d.alive ? 0.9 : 0.35; if (d.alive) Dummy.say(d, 'bomber'); }
      if (d.bombT !== undefined) {
        const before = d.bombT; d.bombT -= sdt;
        if (Math.floor(before * 8) !== Math.floor(d.bombT * 8)) sfx.tick();
        if (d.bombT <= 0) { d.bombDone = true; blast(d.p.chest.pos.clone(), 5); }
      }
    }
  }
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
  // sideways shove from a blast: carries in the air, scrubs off on the ground
  if (P.vx || P.vz) {
    rig.position.x += P.vx * dt; rig.position.z += P.vz * dt;
    const keep = Math.pow(P.onGround ? 0.002 : 0.6, dt);
    P.vx *= keep; P.vz *= keep;
    if (Math.abs(P.vx) + Math.abs(P.vz) < 0.05) P.vx = P.vz = 0;
  }
  // indoor maps have a ceiling
  if (MAPS[S.map].wallH === WALL_H && P.y > WALL_H - 1.95) { P.y = WALL_H - 1.95; P.vy = Math.min(P.vy, 0); }
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
  if (tool?.embed) { yankOut(desk, tool); return; }
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
function frame(time) {
  const dt = Math.min(0.05, (time - last) / 1000 || 0.016); last = time;
  if (started) {
    if (inVR) vrMove(dt); else desktopMove(dt);
    rig.updateMatrixWorld(true);
    panelCd -= dt;
    { const hp = headPos(); sfx.setListener(hp.x, hp.y, hp.z, bodyYaw()); }
    updateHolsters(); updateAvatar();
    spawnDotOn = false; sawLevel = 0; sawCutting = false; flameOn = false;
    for (const h of hands()) updateHand(h, dt);
    sfx.saw(sawLevel, sawCutting);
    sfx.flame(flameOn && !paused);
    spawnDot.visible = spawnDotOn;
    $('spawnHud').hidden = !(spawnDotOn && !inVR);
    // touching a panel button with a hand presses it
    if (inVR) for (const h of vrHands) {
      const i = h.active && Math.abs(h.pos.x - PANEL.x) < 0.1 ? panelIndex(h.pos.y, h.pos.z) : -1;
      if (i !== -1 && i !== h.touching) press(i);
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
    syncItems();
    for (const t of tools) {
      if (t.flashT > 0 && (t.flashT -= dt) <= 0) t.flash.visible = false;
      if (t.stuck) { updateStuck(t); continue; }
      if (t.npc) continue;
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
      updateEnemies(dt * world.scale);
      updateFire(dt * world.scale);
      updateBolts(dt * world.scale);
      resolveStrokes();
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
}
renderer.setAnimationLoop(frame);

// for poking at things from the console
window.lab = { step(ms = 16.7, n = 1) { for (let i = 0; i < n; i++) frame(last + ms); }, snap() { frame(last + 16.7); return renderer.domElement.toDataURL('image/jpeg', 0.6); }, makeTool, setGore, bolts, holsters, jump, HELP, UI, UI_ROWS, MAPS, setMap, setTrack, setHeight, openMenu, closeMenu, menuActivate, music, get paused() { return paused; }, P, SV, damagePlayer, startSurvival, world, dummies, tools, barrels, balls, grenades, mines, rockets, menu, menuMove, S, gore, desk, rig, camera, press, grab, drop, spawnDummy, spawnBarrel,
  look(y, p) { yaw = y; pitch = p; }, get state() { return { started, inVR, freecam, locked, noLock }; } };

import * as THREE from '../vendor/three.module.js';
import { World, Particle, HALF, WALL_H, TICK, segSeg } from './physics.js';
import { Dummy } from './ragdoll.js';
import { Gore } from './gore.js';
import { sfx } from './audio.js';

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

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 8, 5); scene.add(sun);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// room: bright tiled test chamber so the mess shows up
{
  const tile = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c9cdd3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9aa0a8'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
    g.strokeStyle = '#b7bcc3'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.repeat.set(HALF, HALF);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshLambertMaterial({ map: tile }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);

  const wallTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e6e9ed'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#cfd4da'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping; wallTex.repeat.set(HALF, WALL_H / 2);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe8792b });
  for (let i = 0; i < 4; i++) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, WALL_H), wallMat);
    const a = i * Math.PI / 2;
    wall.position.set(-Math.sin(a) * HALF, WALL_H / 2, -Math.cos(a) * HALF);
    wall.rotation.y = a;
    scene.add(wall);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 0.12), stripeMat);
    stripe.position.set(-Math.sin(a) * (HALF - 0.01), 0.06, -Math.cos(a) * (HALF - 0.01));
    stripe.rotation.y = a;
    scene.add(stripe);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshLambertMaterial({ color: 0x8d939c }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; scene.add(ceil);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const x of [-4, 4]) for (const z of [-4, 4]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.5), lampMat);
    lamp.position.set(x, WALL_H - 0.03, z); scene.add(lamp);
  }
}

// ------------------------------------------------------------ world
const world = new World();
const gore = new Gore(scene, world);

// weapon table, to the player's left
const TABLE = { min: new V3(-2.2, 0.84, -1.4), max: new V3(-1.4, 0.9, 0.6) };
world.boxes.push(TABLE);
{
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a5059 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 2.0), mat);
  top.position.set(-1.8, 0.87, -0.4); scene.add(top);
  for (const x of [-2.15, -1.45]) for (const z of [-1.35, 0.55]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.84, 0.05), mat);
    leg.position.set(x, 0.42, z); scene.add(leg);
  }
}

const S = { kills: 0, hostile: false, slowmo: false, lowG: false };
const dummies = [], barrels = [], balls = [], tools = [];
const MAX_DUMMIES = 10;

function spawnDummy(x, z) {
  if (dummies.length >= MAX_DUMMIES) {
    const i = Math.max(0, dummies.findIndex(d => !d.alive));
    releaseBody(dummies[i]); dummies[i].dispose(); dummies.splice(i, 1);
  }
  x ??= (Math.random() - 0.5) * 10; z ??= -3 - Math.random() * 4;
  const head = headPos();
  const d = new Dummy(world, scene, gore, x, z, Math.atan2(head.x - x, head.z - z));
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
  sfx.boom(); pulseAll(1, 200);
  const mesh = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }));
  mesh.position.copy(c); scene.add(mesh); explosions.push({ mesh, t: 0 });
  gore.sparks(c, 40);
  const R = 5, h = world.dt;
  for (const p of world.particles) {
    const d = p.pos.distanceTo(c);
    if (d > R || p.pinned) continue;
    tv.subVectors(p.pos, c).normalize().multiplyScalar(13 * (1 - d / R)); tv.y += 4 * (1 - d / R);
    p.push(tv, h);
  }
  for (const d of dummies) {
    const dist = d.p.pelvis.pos.distanceTo(c);
    if (dist > 4.5) continue;
    d.hp -= 220 * (1 - dist / 4.5); d.knockdown(3.5);
    if (dist < 3.2) {
      const limbs = d.bones.filter(b => !b.severed && b.name !== 'head');
      for (let n = dist < 1.8 ? 4 : 2; n > 0 && limbs.length; n--) d.sever(limbs.splice(Math.floor(Math.random() * limbs.length), 1)[0]);
      if (dist < 2.2) d.explodeHead();
      gore.spray(d.p.chest.pos, UP, 30, 5, 1.2);
    }
    if (d.hp <= 0) d.die();
  }
  for (const b of [...barrels]) if (b.a.pos.distanceTo(c) < 3.5) setTimeout(() => explode(b), 120 + Math.random() * 200);
}

// ------------------------------------------------------------ tools (guns + machete)
const GUNS = {
  pistol: { len: 0.2, auto: false, cool: 0.13, pellets: 1, spread: 0.004, dmg: 1, push: 3.5, kick: 0.25, muzzle: [0, 0.03, -0.18] },
  smg: { len: 0.3, auto: true, cool: 0.075, pellets: 1, spread: 0.02, dmg: 0.7, push: 2.5, kick: 0.1, muzzle: [0, 0.035, -0.27] },
  shotgun: { len: 0.62, auto: false, cool: 0.65, pellets: 9, spread: 0.06, dmg: 1, push: 3.2, kick: 0.5, muzzle: [0, 0.04, -0.62] },
  machete: { len: 0.66, melee: true },
};
const M = {
  dark: new THREE.MeshLambertMaterial({ color: 0x23262b }), grey: new THREE.MeshLambertMaterial({ color: 0x555b64 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x7a4a26 }), steel: new THREE.MeshLambertMaterial({ color: 0xcfd6de }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
};
function box(parent, mat, w, h, d, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
}
function buildToolMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'pistol') {
    box(g, M.dark, 0.034, 0.045, 0.2, 0, 0.03, -0.08); box(g, M.grey, 0.03, 0.1, 0.042, 0, -0.035, 0.005, -0.22);
  } else if (kind === 'smg') {
    box(g, M.dark, 0.045, 0.07, 0.3, 0, 0.03, -0.11); box(g, M.grey, 0.03, 0.15, 0.04, 0, -0.07, -0.12);
    box(g, M.grey, 0.032, 0.1, 0.042, 0, -0.04, 0.01, -0.22); box(g, M.dark, 0.03, 0.03, 0.08, 0, 0.035, -0.29);
  } else if (kind === 'shotgun') {
    box(g, M.dark, 0.04, 0.04, 0.62, 0, 0.04, -0.31); box(g, M.wood, 0.05, 0.05, 0.17, 0, 0.005, -0.33);
    box(g, M.wood, 0.04, 0.075, 0.26, 0, 0.0, 0.14, 0.12); box(g, M.grey, 0.045, 0.06, 0.14, 0, 0.03, -0.03);
  } else {
    box(g, M.wood, 0.03, 0.035, 0.15, 0, 0, -0.04); box(g, M.steel, 0.006, 0.065, 0.52, 0, 0.012, -0.39);
  }
  return g;
}
const TOOL_HOME = { pistol: -0.95, smg: -0.55, shotgun: -0.1, machete: 0.35 };
function makeTool(kind) {
  const def = GUNS[kind];
  const t = { kind, def, mesh: buildToolMesh(kind), held: null, cool: 0, recoil: 0, flashT: 0 };
  t.a = new Particle(0, 0, 0, 0.04, 1); t.b = new Particle(0, 0, 0, 0.035, 1);
  t.a.body = t.b.body = t;
  world.add(t.a); world.add(t.b); world.stick(t.a, t.b, { len: def.len, body: t });
  if (!def.melee) {
    t.muzzle = new THREE.Object3D(); t.muzzle.position.fromArray(def.muzzle); t.mesh.add(t.muzzle);
    t.flash = new THREE.Mesh(new THREE.SphereGeometry(kind === 'shotgun' ? 0.07 : 0.045, 8, 6), M.flash);
    t.flash.visible = false; t.muzzle.add(t.flash);
  }
  scene.add(t.mesh); tools.push(t);
  return t;
}
function homeTool(t) {
  if (t.held) { t.held.held = null; t.held = null; }
  const z = TOOL_HOME[t.kind], x0 = -1.8 - t.def.len / 2;
  t.a.pinned = t.b.pinned = false;
  t.a.pos.set(x0 + t.def.len, 0.96, z); t.b.pos.set(x0, 0.96, z);
  t.a.prev.copy(t.a.pos); t.b.prev.copy(t.b.pos);
}
function resetItems() {
  for (const t of tools) homeTool(t);
  for (const b of balls) { releaseBody(b); world.removeBody(b); scene.remove(b.mesh); }
  balls.length = 0;
  spawnBall(1.6, 0.3, -0.6, 0x2f7fd1); spawnBall(2.0, 0.3, -0.9, 0xe0c020);
}
for (const k in GUNS) makeTool(k);

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
];
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
  g.font = 'bold 40px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
  const bw = W / 2, bh = (H - hh) / 4;
  BUTTONS.forEach(([label], i) => {
    const x = (i % 2) * bw, y = hh + Math.floor(i / 2) * bh;
    const text = typeof label === 'function' ? label() : label;
    g.fillStyle = i === panelFlash ? '#e8792b' : text.endsWith('ON') ? '#7d1f16' : '#2a3038';
    g.fillRect(x + 12, y + 12, bw - 24, bh - 24);
    g.fillStyle = '#f2f4f7'; g.fillText(text, x + bw / 2, y + bh / 2);
  });
  panelTex.needsUpdate = true;
  $('kills').textContent = 'KILLS ' + S.kills;
}
function panelIndex(y, z) {
  const u = (z - (PANEL.z - PANEL.w / 2)) / PANEL.w, v = (PANEL.y + PANEL.h / 2 - y) / PANEL.h;
  if (u < 0 || u > 1 || v < PANEL.head || v > 1) return -1;
  return Math.min(3, Math.floor((v - PANEL.head) / (1 - PANEL.head) * 4)) * 2 + (u < 0.5 ? 0 : 1);
}
function press(i) {
  if (i < 0 || panelCd > 0) return;
  panelCd = 0.35; panelFlash = i;
  BUTTONS[i][1](); sfx.beep(); drawPanel();
  setTimeout(() => { panelFlash = -1; drawPanel(); }, 150);
}
function clearAll() {
  for (const d of dummies) { releaseBody(d); d.dispose(); }
  dummies.length = 0;
  for (const b of barrels) { releaseBody(b); world.removeBody(b); scene.remove(b.mesh); }
  barrels.length = 0;
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
  h.glove = buildHand(i ? 'right' : 'left', h.skin); c.add(h.glove);
  h.ray = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  h.ray.position.z = -0.65; c.add(h.ray);
  c.addEventListener('connected', e => {
    h.src = e.data;
    // controller index doesn't say which hand it is -- rebuild to match
    c.remove(h.glove); h.glove = buildHand(e.data.handedness === 'left' ? 'left' : 'right', h.skin); c.add(h.glove);
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
  let best = null, bd = 0.2;
  for (const t of tools) {
    if (t.held) continue;
    const d = Math.sqrt(segSeg(h.pos, h.pos, t.a.pos, t.b.pos));
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
      if (t.held) continue;
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
  if (best.type === 'tool') { best.tool.held = h; best.tool.a.pinned = best.tool.b.pinned = true; h.hasTip = false; }
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
  const ps = held.type === 'tool' ? [held.tool.a, held.tool.b] : [held.p];
  if (held.type === 'tool') held.tool.held = null;
  for (const p of ps) { p.pinned = false; p.prev.copy(p.pos).addScaledVector(h.vel, -TICK); }
}
// let go of anything belonging to a body that is about to be removed
function releaseBody(body) {
  for (const h of [...vrHands, desk]) if (h.held?.type === 'particle' && h.held.p.body === body) { h.held.p.pinned = false; h.held = null; }
}

const TOOL_TILT = new THREE.Quaternion();
function updateHand(h, dt) {
  h.prevPos.copy(h.pos);
  if (h.ctrl) {
    h.active = !!h.src && h.ctrl.visible;
    h.ctrl.getWorldPosition(h.pos); h.ctrl.getWorldQuaternion(h.quat);
    h.ray.visible = !h.held;
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
    if (h.held?.tool?.def.melee) {
      // swing the blade across the view
      const sw = h.jab > 0 ? 1.1 - 2.2 * (1 - h.jab / 0.22) : 1.1;
      tv.set(0.22 - (1.1 - sw) * 0.2, -0.2, -0.5 - u * 0.4);
      h.quat.multiply(tq.setFromAxisAngle(UP, h.jab > 0 ? sw : 0));
    }
    h.pos.copy(tv).applyQuaternion(camera.getWorldQuaternion(tq)).add(h.aimFrom);
    h.glove.visible = started && !inVR;
    h.glove.position.copy(h.pos); h.glove.quaternion.copy(h.quat);
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
    if (t.def.melee) tq.multiply(TOOL_TILT.setFromAxisAngle(tv.set(1, 0, 0), inVR ? 1.0 : 0.45));
    tv.copy(NEG_Z).applyQuaternion(tq);
    t.a.pos.copy(h.pos); t.b.pos.copy(h.pos).addScaledVector(tv, t.def.len);
    t.a.prev.copy(t.a.pos); t.b.prev.copy(t.b.pos);
    t.mesh.position.copy(h.pos);
    t.mesh.quaternion.copy(tq).multiply(TOOL_TILT.setFromAxisAngle(tv.set(1, 0, 0), t.recoil));
    t.mesh.updateMatrixWorld(true);
    if (t.def.melee) slice(h, t, dt);
    else {
      t.cool -= dt;
      const want = t.def.auto ? h.trigger : (h.trigger && !h.wasTrigger);
      if (want && t.cool <= 0) fire(h, t);
    }
  } else if (held?.type === 'particle') {
    held.p.pos.copy(h.pos); held.p.prev.copy(h.pos);
  }
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
  take(rayBox(o, d, TABLE), 'wall');
  if (d.x > 0) {
    const t = (PANEL.x - 0.02 - o.x) / d.x, i = panelIndex(o.y + d.y * t, o.z + d.z * t);
    if (i >= 0) take(t, 'panel', { index: i });
  }
  for (const dm of dummies) { const r = dm.raycast(o, rayEnd); if (r) take(r.s * L, 'dummy', { dummy: dm, bone: r.bone }); }
  for (const b of barrels) if (segSeg(o, rayEnd, b.a.pos, b.b.pos) < 0.28 * 0.28) take(segSeg.s * L - 0.2, 'barrel', { barrel: b });
  for (const b of balls) if (segSeg(o, rayEnd, b.p.pos, b.p.pos) < 0.14 * 0.14) take(segSeg.s * L, 'ball', { ball: b });
  return best;
}

function fire(h, t) {
  const def = t.def;
  t.cool = def.cool; t.recoil = def.kick; t.flashT = 0.05; t.flash.visible = true;
  sfx.shot(t.kind); pulse(h, t.kind === 'shotgun' ? 1 : 0.6, t.kind === 'shotgun' ? 120 : 50);
  t.muzzle.getWorldPosition(fromV);
  // on desktop aim through the crosshair, not along the offset gun
  const o = h.ctrl ? fromV : h.aimFrom;
  const hitsPer = new Map();
  for (let i = 0; i < def.pellets; i++) {
    dirV.copy(NEG_Z).applyQuaternion(h.quat);
    dirV.x += (Math.random() - 0.5) * 2 * def.spread; dirV.y += (Math.random() - 0.5) * 2 * def.spread; dirV.z += (Math.random() - 0.5) * 2 * def.spread;
    dirV.normalize();
    const r = hitscan(o, dirV);
    hitPt.copy(o).addScaledVector(dirV, r.t);
    tracer(fromV, hitPt);
    if (r.kind === 'dummy') {
      const d = r.dummy;
      gore.spray(hitPt, dirV, 9, 6, 0.35);
      gore.spray(hitPt, tv.copy(dirV).negate(), 4, 2, 0.6);
      d.hit(r.bone, def.dmg, tv.copy(dirV).multiplyScalar(def.push), hitPt, { explode: t.kind === 'shotgun' || Math.random() < 0.35 });
      hitsPer.set(d, (hitsPer.get(d) || 0) + 1);
    } else if (r.kind === 'wall') gore.sparks(hitPt, 3);
    else if (r.kind === 'panel') press(r.index);
    else if (r.kind === 'barrel') { gore.sparks(hitPt, 6); if (--r.barrel.hp <= 0) explode(r.barrel); }
    else if (r.kind === 'ball') r.ball.p.push(tv.copy(dirV).multiplyScalar(6), world.dt);
  }
  if (hitsPer.size) sfx.squish();
  for (const [d, n] of hitsPer) if (n >= 4) d.knockdown(2.5 + Math.random());
}

// machete: sever whatever the blade sweeps through fast enough
const bladeA = new V3();
function slice(h, t, dt) {
  bladeA.copy(t.a.pos).lerp(t.b.pos, 0.2);
  h.tip.copy(t.b.pos);
  if (!h.hasTip) { h.prevTip.copy(h.tip); h.hasTip = true; return; }
  const speed = h.tip.distanceTo(h.prevTip) / Math.max(dt, 1e-4);
  if (speed > 2.8 && speed < 80) {
    for (const d of dummies) {
      if (d.sliceCd > 0) continue;
      let hit;
      for (const b of d.bones) {
        if (b.name === 'head' ? d.headGone : false) continue;
        const pa = b.name === 'head' ? b.b.pos : b.a.pos, r = (b.name === 'head' ? 0.12 : b.r) + 0.04;
        if (segSeg(bladeA, h.tip, pa, b.b.pos) < r * r || segSeg(h.prevTip, h.tip, pa, b.b.pos) < r * r) { hit = b; break; }
      }
      let torso = false;
      if (!hit && (segSeg(bladeA, h.tip, d.p.pelvis.pos, d.p.neck.pos) < 0.2 * 0.2 || segSeg(h.prevTip, h.tip, d.p.pelvis.pos, d.p.neck.pos) < 0.2 * 0.2)) torso = true;
      if (!hit && !torso) continue;
      d.sliceCd = 0.2;
      tv.subVectors(h.tip, h.prevTip).normalize();
      const at = hit ? hit.b.pos : d.p.chest.pos;
      gore.spray(at, tv, 16, 4, 0.6);
      d.hit(hit ?? null, hit ? 4 : 3, tv2.copy(tv).multiplyScalar(2.5), at);
      sfx.slice(); pulse(h, 0.9, 60); bloody(h, 0.15);
    }
  }
  h.prevTip.copy(h.tip);
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

// ------------------------------------------------------------ player movement
const keys = {};
let yaw = 0, pitch = 0, locked = false, noLock = false, dragging = false, freecam = false, teleported = false;

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
    rig.position.y = 0;
    clampRig();
  }
}
function vrMove(dt) {
  for (const h of vrHands) {
    const gp = h.src?.gamepad;
    if (!gp) continue;
    const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0, ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
    const left = h.src.handedness === 'left';
    if (left) {
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
    // face buttons: right A = spawn, B = slow-mo; left X = hostile, Y = clear
    for (let i = 0; i < 2; i++) {
      const down = !!gp.buttons[4 + i]?.pressed;
      if (down && !h.btn[i]) { panelCd = 0; press(left ? (i ? 3 : 4) : (i ? 5 : 0)); }
      h.btn[i] = down;
    }
  }
  clampRig();
}

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!started || inVR || e.repeat) return;
  const map = { Digit1: 0, Digit2: 2, Digit5: 1, KeyC: 3, KeyH: 4, KeyT: 5, KeyG: 6, KeyR: 7 };
  if (e.code in map) { panelCd = 0; press(map[e.code]); }
  if (e.code === 'KeyE') desk.held ? drop(desk) : grab(desk);
  if (e.code === 'KeyF') { freecam = !freecam; $('free').hidden = !freecam; }
  if (e.code === 'Space' && !freecam) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('mousedown', e => {
  if (!started || inVR) return;
  sfx.init();
  if (e.button === 2) { desk.held ? drop(desk) : grab(desk); return; }
  if (e.button !== 0) return;
  dragging = true;
  if (!locked && !noLock) { try { canvas.requestPointerLock()?.catch?.(() => { noLock = true; }); } catch { noLock = true; } }
  desk.trigger = true;
  const tool = desk.held?.type === 'tool' ? desk.held.tool : null;
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
addEventListener('mousemove', e => {
  if (inVR || !(locked || dragging)) return;
  yaw -= e.movementX * 0.0024; pitch -= e.movementY * 0.0024;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
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
  drawPanel();
}
$('playDesktop').addEventListener('click', () => { begin(); $('hud').hidden = false; });
$('enterVR').addEventListener('click', async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    begin();
    session.addEventListener('end', () => {
      inVR = false; drop(vrHands[0]); drop(vrHands[1]);
      camera.position.set(0, 1.65, 0); rig.rotation.y = 0; rig.position.y = 0; yaw = pitch = 0;
      $('hud').hidden = false; resize();
    });
    await renderer.xr.setSession(session);
    drop(desk); inVR = true; freecam = false; desk.glove.visible = false;
    $('hud').hidden = true;
    rig.position.set(0, 0, 1.5); rig.rotation.y = 0;
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
    for (const h of hands()) updateHand(h, dt);
    // touching a panel button with a hand presses it
    if (inVR) for (const h of vrHands) {
      const i = h.active && h.pos.x > PANEL.x - 0.1 ? panelIndex(h.pos.y, h.pos.z) : -1;
      if (i >= 0 && i !== h.touching) press(i);
      h.touching = i;
    }
    teleported = false;

    const head = headPos();
    acc += dt;
    let n = 0;
    while (acc >= TICK && n < 4) {
      for (const d of dummies) d.tick(world.dt, head, S.hostile);
      world.step();
      pushHands();
      gore.update(world.dt);
      acc -= TICK; n++;
    }
    if (n === 4) acc = 0;

    for (const d of dummies) d.sync();
    for (const t of tools) {
      if (t.flashT > 0 && (t.flashT -= dt) <= 0) t.flash.visible = false;
      if (t.held) continue;
      t.mesh.position.copy(t.a.pos);
      t.mesh.quaternion.setFromUnitVectors(NEG_Z, tv.subVectors(t.b.pos, t.a.pos).normalize());
    }
    for (const b of barrels) {
      b.mesh.position.addVectors(b.a.pos, b.b.pos).multiplyScalar(0.5);
      b.mesh.quaternion.setFromUnitVectors(UP, tv.subVectors(b.b.pos, b.a.pos).normalize());
    }
    for (const b of balls) b.mesh.position.copy(b.p.pos);
    gore.sync(time);
    for (const tr of tracers) if (tr.m.visible) { tr.t -= dt; tr.m.material.opacity = Math.max(0, tr.t / 0.07); if (tr.t <= 0) tr.m.visible = false; }
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i]; e.t += dt;
      e.mesh.scale.setScalar(0.3 + e.t * 16); e.mesh.material.opacity = Math.max(0, 0.9 - e.t * 3.2);
      if (e.t > 0.3) { scene.remove(e.mesh); e.mesh.material.dispose(); explosions.splice(i, 1); }
    }
  }
  renderer.render(scene, camera);
});

// for poking at things from the console
window.lab = { world, dummies, tools, barrels, balls, S, gore, desk, rig, camera, press, grab, drop, spawnDummy, spawnBarrel,
  look(y, p) { yaw = y; pitch = p; }, get state() { return { started, inVR, freecam, locked, noLock }; } };

// Test dummies: a 16-particle Verlet ragdoll that is pulled toward a standing /
// walking pose while alive ("active ragdoll"), goes limp when dead, and can
// lose its head and limbs.
import * as THREE from '../vendor/three.module.js';
import { Particle, HALF, segSeg } from './physics.js?v=25';

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
const gutMat = new THREE.MeshLambertMaterial({ color: 0xc4596a });

const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), mb = new THREE.Matrix4();
const w1 = new THREE.Vector3(), w2 = new THREE.Vector3(), wn = new THREE.Vector3(), wq = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- faces
// The head is a sphere wrapped in a 256x128 texture; the face sits at x=64
// (the +Z side). One texture per skin / hair / expression, shared by everyone.
const HAIR = [0x2a1b10, 0x5a3a1a, 0xc9a24a, 0x1a1a1a, 0x8a3b1e, 0x6b6b6b];
const css = hex => '#' + hex.toString(16).padStart(6, '0');
const faceCache = {};
// bruise: 0-3, how badly the face has been beaten (black eyes, cuts, swelling)
export function faceTex(skin, hair, expr, bruise = 0) {
  const key = skin + '_' + hair + '_' + expr + '_' + bruise;
  if (faceCache[key]) return faceCache[key];
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'), cx = 64, LINE = 'rgba(45,22,14,.95)', BLOOD = '#8a0303';
  if (expr === 'skeleton') return faceCache[key] = skullTex();
  g.fillStyle = css(skin); g.fillRect(0, 0, 256, 128);
  if (expr === 'dead' || expr === 'out') { g.fillStyle = 'rgba(170,185,200,.35)'; g.fillRect(0, 0, 256, 128); }
  if (expr === 'choke') { g.fillStyle = 'rgba(120,20,60,.38)'; g.fillRect(0, 0, 256, 128); }
  if (expr === 'scorched') {
    // skin burned off: charred black with raw red cracks, no hair
    g.fillStyle = '#2a1712'; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 90; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(120,20,10,.7)' : 'rgba(10,6,4,.8)'; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 128, 2 + Math.random() * 7, 1 + Math.random() * 4, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
    hair = null;
  }
  if (hair !== null) {
    g.fillStyle = css(hair);
    g.fillRect(0, 0, 256, 30);                       // top of the head
    g.fillRect(112, 0, 144, 78); g.fillRect(0, 0, 16, 78);   // sides and back
    g.beginPath(); g.ellipse(cx, 30, 50, 9, 0, 0, Math.PI * 2); g.fill();   // fringe
  }
  if (bruise > 0 && expr !== 'scorched') {
    const L0 = cx - 15, R0 = cx + 15;
    const blot = (x, y, rx, ry, a, col = '90,30,90') => { const gr = g.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry)); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
    blot(R0 + 6, 72, 13, 10, 0.45, '120,60,90');                        // bruised cheek
    if (bruise >= 2) { blot(L0, 59, 12, 10, 0.85, '55,20,60'); blot(cx + 2, 88, 7, 5, 0.5, '130,30,40'); }   // black eye, fat lip
    if (bruise >= 3) { blot(R0, 59, 12, 10, 0.85, '55,20,60'); blot(L0 - 6, 74, 12, 11, 0.5, '110,70,40'); }  // second black eye, swelling
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
  } else if (expr === 'choke') {
    // eyes bulging, brows pinched up, mouth gaping with the tongue out
    eye(L, 1.35, -0.5); eye(R, 1.35, -0.5); brow(L, -6, 2); brow(R, -6, 2);
    g.fillStyle = '#2a0d0a'; g.beginPath(); g.ellipse(cx, 89, 10, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c0505a'; g.beginPath(); g.ellipse(cx, 96, 6, 7, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(160,30,40,.6)'; g.lineWidth = 1; for (const ex of [L, R]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(ex - 6, 57 + i); g.lineTo(ex - 2, 58); g.stroke(); }
  } else if (expr === 'out') {
    // knocked out: eyes shut, mouth hanging open
    g.strokeStyle = LINE; g.lineWidth = 2.5;
    for (const ex of [L, R]) { g.beginPath(); g.moveTo(ex - 6, 58); g.quadraticCurveTo(ex, 61, ex + 6, 58); g.stroke(); }
    brow(L, 1, 1); brow(R, 1, 1);
    g.fillStyle = '#2a0d0a'; g.beginPath(); g.ellipse(cx + 2, 88, 6, 4, 0.2, 0, Math.PI * 2); g.fill();
    blood(cx + 6, 90, cx + 7, 97, 1.5);
  } else if (expr === 'scorched') {
    // lids burned away: staring whites, lipless grin of teeth
    g.fillStyle = '#efe9da'; for (const ex of [L, R]) { g.beginPath(); g.ellipse(ex, 58, 7, 6, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#3a2a20'; g.beginPath(); g.arc(ex, 58, 2.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#efe9da'; }
    g.fillStyle = '#120806'; g.fillRect(cx - 14, 81, 28, 13);
    g.fillStyle = '#e8dcc0'; for (let i = 0; i < 6; i++) { g.fillRect(cx - 13 + i * 4.5, 82, 3.5, 5); g.fillRect(cx - 13 + i * 4.5, 88, 3.5, 5); }
  } else {   // dead
    eye(L, 0.45, null); eye(R, 0.6, null);
    g.fillStyle = '#1c1410'; g.beginPath(); g.arc(L, 56, 2.5, 0, Math.PI); g.fill(); g.beginPath(); g.arc(R + 1, 56, 2.5, 0, Math.PI); g.fill();
    brow(L, 1, 1); brow(R, 1, 1);
    g.fillStyle = '#2a0d0a'; g.beginPath(); g.ellipse(cx, 88, 7, 4.5, 0, 0, Math.PI * 2); g.fill();
    blood(cx - 6, 89, cx - 9, 108, 3); blood(cx + 1, 75, cx + 2, 84, 2); blood(cx - 3, 75, cx - 4, 82, 2);
  }
  if (bruise >= 2 && expr !== 'scorched') {
    // cuts and scabbed scars
    g.strokeStyle = '#7a0c0c'; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx + 22, 44); g.lineTo(cx + 30, 52); g.stroke();
    g.beginPath(); g.moveTo(cx - 6, 92); g.lineTo(cx - 2, 96); g.stroke();
    if (bruise >= 3) { g.beginPath(); g.moveTo(cx - 28, 40); g.lineTo(cx - 18, 46); g.lineTo(cx - 12, 44); g.stroke(); g.beginPath(); g.moveTo(cx + 4, 66); g.lineTo(cx + 9, 70); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return faceCache[key] = t;
}

// a bare skull, wrapped round the head the same way as a face
function skullTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'), cx = 64;
  g.fillStyle = '#e4d8bc'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(120,100,70,${Math.random() * 0.25})`; g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2); }
  g.strokeStyle = 'rgba(110,95,70,.8)'; g.lineWidth = 1.2;   // sutures
  g.beginPath(); g.moveTo(0, 22); for (let x = 0; x <= 256; x += 8) g.lineTo(x, 22 + (x % 16 ? 3 : -3)); g.stroke();
  g.fillStyle = '#1a120c';
  for (const ex of [cx - 16, cx + 16]) { g.beginPath(); g.ellipse(ex, 58, 10, 9, 0, 0, Math.PI * 2); g.fill(); }   // sockets
  g.beginPath(); g.moveTo(cx, 66); g.lineTo(cx - 5, 78); g.lineTo(cx + 5, 78); g.closePath(); g.fill();          // nose hole
  g.fillStyle = '#f2ead6'; for (let i = 0; i < 8; i++) { g.fillRect(cx - 16 + i * 4, 84, 3.2, 6); g.fillRect(cx - 16 + i * 4, 91, 3.2, 6); }
  g.strokeStyle = '#3a2a1c'; g.lineWidth = 1; g.strokeRect(cx - 16, 84, 32, 13);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
const boneMat = new THREE.MeshLambertMaterial({ color: 0xe4d8bc });
const CHAR = new THREE.Color(0x1c120d), RAW = new THREE.Color(0x5a1a12);
// ragged, charred cloth once it's been burning a while
const tatterTex = (base) => texOf(64, 64, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) { const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 9;
    g.fillStyle = '#e8792b'; g.beginPath(); g.arc(x, y, r + 1.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a1a10'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(Math.random() * w, Math.random() * h, 3, 1 + Math.random() * 5); }
});

// Layered wounds: 1 = through the skin, 2 = into muscle, 3 = down to bone.
const fleshMats = [
  decalMat(decalTex(g => {
    g.fillStyle = '#e3a48f'; g.beginPath();   // torn skin edge
    for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2, r = 22 + Math.random() * 9; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    g.fill();
    g.fillStyle = '#9c1212'; g.beginPath(); g.arc(32, 32, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a0303'; g.beginPath(); g.arc(32, 32, 9, 0, Math.PI * 2); g.fill();
  }), -6),
  decalMat(decalTex(g => {
    g.fillStyle = '#d9967f'; g.beginPath();
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, r = 25 + Math.random() * 6; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    g.fill();
    g.fillStyle = '#e8cf78'; g.beginPath(); g.arc(32, 32, 23, 0, Math.PI * 2); g.fill();   // fat
    g.fillStyle = '#8f1414'; g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.fill();   // muscle
    g.strokeStyle = '#5c0808'; g.lineWidth = 1.5;                                           // muscle fibres
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(14 + i * 4.5, 16); g.lineTo(12 + i * 4.5, 48); g.stroke(); }
    g.fillStyle = '#220000'; g.beginPath(); g.arc(32, 32, 8, 0, Math.PI * 2); g.fill();
  }), -7),
  decalMat(decalTex(g => {
    g.fillStyle = '#d9967f'; g.beginPath();
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, r = 27 + Math.random() * 4; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    g.fill();
    g.fillStyle = '#e8cf78'; g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8f1414'; g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5c0808'; g.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo(11 + i * 4.5, 14); g.lineTo(9 + i * 4.5, 50); g.stroke(); }
    g.fillStyle = '#efe6cf'; g.beginPath(); g.arc(32, 32, 12, 0, Math.PI * 2); g.fill();   // bone
    g.strokeStyle = '#8a7f66'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(24, 28); g.lineTo(33, 33); g.lineTo(30, 42); g.moveTo(33, 33); g.lineTo(41, 30); g.stroke();
    g.fillStyle = '#5a0a0a'; g.beginPath(); g.arc(34, 31, 3.5, 0, Math.PI * 2); g.fill();   // marrow
  }), -8),
];
const FLESH_SIZE = [0.038, 0.052, 0.066];

// ---------------------------------------------------------------- insides
const BONE_COL = 0xe8dcc0, BRAIN_COL = 0xd98a9a;
const texOf = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const blob = (g, x, y, rx, ry, fill, stroke) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); } };
const coils = (g, x0, y0, x1, y1, n) => { for (let i = 0; i < n; i++) { const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0), r = 8 + Math.random() * 4; blob(g, x, y, r, r * 0.9, '#d98a94', '#a85a66'); blob(g, x, y, r * 0.35, r * 0.3, '#7a3340'); } };

// Looking down at a body cut through at the waist. Top of the picture is the belly, bottom is the back.
const waistTex = texOf(256, 136, (g) => {
  blob(g, 128, 68, 126, 66, '#d9a98a');            // skin
  blob(g, 128, 68, 120, 60, '#e9cf7a');            // fat
  blob(g, 128, 68, 111, 52, '#8a1c1c');            // abdominal wall muscle
  blob(g, 128, 66, 99, 42, '#3a0808');             // cavity
  blob(g, 72, 60, 38, 26, '#6b2a1a', '#4a1a10');   // liver
  blob(g, 182, 56, 26, 20, '#c97a84', '#9a5560');  // stomach
  coils(g, 80, 30, 180, 78, 16);                   // intestines
  blob(g, 76, 92, 15, 10, '#6b2420', '#3f1210'); blob(g, 180, 92, 15, 10, '#6b2420', '#3f1210');   // kidneys
  blob(g, 96, 108, 20, 11, '#7a1414'); blob(g, 160, 108, 20, 11, '#7a1414');                       // back muscles
  blob(g, 128, 98, 16, 14, '#efe6d0', '#b8ab8a'); blob(g, 128, 98, 9, 8, '#e0c9a0');               // vertebra
  blob(g, 128, 116, 5, 4, '#3a0808'); blob(g, 128, 116, 2.5, 2, '#f0e08a');                         // spinal cord
  g.fillStyle = '#efe6d0'; g.fillRect(124, 119, 8, 10);                                             // spinous process
  blob(g, 138, 80, 5.5, 5.5, '#c01818', '#6e0a0a'); blob(g, 118, 80, 5.5, 5, '#3a4a9a', '#1f2a5a'); // aorta, vena cava
});
// A body cut top to bottom, seen from the side. Left of the picture is the back, right is the front.
const drawSide = heart => (g, w, h) => {
  g.fillStyle = '#3a0808'; g.fillRect(0, 0, w, h);
  for (const [x, c] of [[0, '#d9a98a'], [4, '#e9cf7a'], [9, '#8a1c1c']]) { g.fillStyle = c; g.fillRect(x, 0, 6, h); g.fillRect(w - x - 6, 0, 6, h); }
  blob(g, 70, 84, 30, 62, '#d9a0a8', '#b07a84');   // lung
  for (let i = 0; i < 40; i++) blob(g, 46 + Math.random() * 48, 30 + Math.random() * 108, 2, 2, 'rgba(160,90,100,.6)');
  if (heart) { blob(g, 84, 108, 18, 23, '#9c1a1a', '#5c0a0a'); blob(g, 88, 104, 7, 9, '#6e0a0a'); }   // heart (unless it's been ripped out)
  else blob(g, 84, 108, 18, 22, '#1a0303', '#5c0a0a');
  g.strokeStyle = '#7a1414'; g.lineWidth = 5; g.beginPath(); g.moveTo(22, 168); g.quadraticCurveTo(70, 140, 108, 164); g.stroke();   // diaphragm
  blob(g, 74, 190, 34, 22, '#6b2a1a', '#4a1a10');  // liver
  blob(g, 80, 226, 22, 16, '#c97a84', '#9a5560');  // stomach
  coils(g, 48, 250, 104, 316, 13);                 // intestines
  blob(g, 86, 336, 12, 10, '#e0d08a', '#a89a55');  // bladder
  blob(g, 40, 345, 16, 14, '#efe6d0', '#b8ab8a'); blob(g, 100, 352, 9, 7, '#efe6d0', '#b8ab8a');   // pelvis
  g.fillStyle = '#f0e08a'; g.fillRect(17, 6, 3, 318);                                              // spinal cord
  for (let y = 8; y < 322; y += 20) { g.fillStyle = '#efe6d0'; g.fillRect(21, y, 17, 13); g.fillStyle = '#8fa3b0'; g.fillRect(21, y + 13, 17, 4); g.fillStyle = '#efe6d0'; g.fillRect(8, y + 3, 8, 6); }
  for (let y = 26; y < 160; y += 18) blob(g, 106, y, 4.5, 4.5, '#efe6d0', '#b8ab8a');             // ribs, cut end-on
  g.fillStyle = '#efe6d0'; g.fillRect(109, 40, 5, 96);                                             // sternum
};
const sideTex = texOf(128, 368, drawSide(true)), sideTexNH = texOf(128, 368, drawSide(false));
const sideTexFlip = sideTex.clone(); sideTexFlip.wrapS = THREE.RepeatWrapping; sideTexFlip.repeat.x = -1; sideTexFlip.offset.x = 1; sideTexFlip.needsUpdate = true;
// A head cut down the middle, seen from the side. Left is the back of the head, right is the face.
const brainTex = texOf(128, 128, (g) => {
  blob(g, 64, 64, 62, 62, '#d9a98a'); blob(g, 64, 60, 57, 55, '#efe6d0'); blob(g, 62, 54, 49, 43, '#d99aa6', '#b06a78');   // scalp, skull, brain
  g.strokeStyle = '#b06a78'; g.lineWidth = 2;
  for (let i = 0; i < 9; i++) { const x = 22 + i * 10; g.beginPath(); g.moveTo(x, 22 + Math.random() * 10); g.bezierCurveTo(x + 8, 34, x - 8, 50, x + 3, 66 + Math.random() * 10); g.stroke(); }
  blob(g, 34, 84, 17, 12, '#c07a88', '#8f4f5e');   // cerebellum
  g.strokeStyle = '#8f4f5e'; g.lineWidth = 1; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(20 + i * 5, 76); g.lineTo(22 + i * 5, 93); g.stroke(); }
  g.fillStyle = '#e8c9a8'; g.fillRect(50, 84, 9, 34);   // brain stem
  blob(g, 98, 78, 13, 9, '#3a0808');                  // nasal cavity
  blob(g, 88, 102, 20, 9, '#b5484a', '#7a2a2c');      // tongue
  g.fillStyle = '#efe6d0'; g.fillRect(78, 112, 34, 7); g.fillRect(104, 92, 8, 5); g.fillRect(104, 99, 8, 4);   // jaw, teeth
});
const capMat = map => new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide });
const flipTex = t => { const f = t.clone(); f.wrapS = THREE.RepeatWrapping; f.repeat.x = -1; f.offset.x = 1; f.needsUpdate = true; return f; };
const waistMat = capMat(waistTex), sideMatR = capMat(sideTex), sideMatL = capMat(sideTexFlip), brainMatR = capMat(brainTex);
const sideMatRNH = capMat(sideTexNH), sideMatLNH = capMat(flipTex(sideTexNH));
// where the heart was torn out through the ribs
const chestHoleMat = decalMat(decalTex(g => {
  g.fillStyle = '#d9967f'; g.beginPath(); for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI * 2, r = 27 + Math.random() * 4; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.fill();
  g.fillStyle = '#8f1414'; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#140000'; g.beginPath(); g.arc(32, 33, 18, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#efe6cf'; for (const y of [20, 30, 40]) { g.fillRect(12, y, 15, 4); g.fillRect(37, y + 1, 15, 4); }   // snapped ribs
}), -8);
const brainTexFlip = brainTex.clone(); brainTexFlip.wrapS = THREE.RepeatWrapping; brainTexFlip.repeat.x = -1; brainTexFlip.offset.x = 1; brainTexFlip.needsUpdate = true;
const brainMatL = capMat(brainTexFlip);
const waistCapGeo = new THREE.PlaneGeometry(0.4, 0.21), sideCapGeo = new THREE.PlaneGeometry(0.21, 0.6), brainCapGeo = new THREE.CircleGeometry(0.113, 20);
const upperGeo = new THREE.BoxGeometry(0.4, 0.34, 0.21), lowerGeo = new THREE.BoxGeometry(0.38, 0.24, 0.2), halfGeo = new THREE.BoxGeometry(0.2, 0.6, 0.21);

// loose organs
const organGeo = new THREE.SphereGeometry(1, 10, 8);
const ORGANS = {
  liver: [0x6b1f1a, 0.062, [1.5, 0.7, 1.0]], stomach: [0xd98a8a, 0.052, [1.25, 0.9, 0.8]], kidney: [0x7a2a2a, 0.03, [0.8, 1.35, 0.7]],
  heart: [0x9c1a1a, 0.046, [1.0, 1.2, 1.0]], lung: [0xd9a0a8, 0.062, [0.75, 1.45, 0.8]],
};
const organMats = {};
for (const k in ORGANS) organMats[k] = new THREE.MeshLambertMaterial({ color: ORGANS[k][0] });

// The head breaks apart in twelve pieces of scalp and face over a skull core.
const HEAD_R = 0.115, BANDS = [0, 0.36, 0.66, 1].map(v => v * Math.PI);
// A partial sphere gets texture coordinates stretched over the whole image, so
// every piece would show an entire face. Squeeze them back to the slice of the
// image that part of the head actually covers.
function sliceGeo(r, ws, hs, phi0, phiLen, th0, thLen) {
  const g = new THREE.SphereGeometry(r, ws, hs, phi0, phiLen, th0, thLen), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = Math.min(1, Math.max(0, uv.getX(i))), v = 1 - uv.getY(i);
    uv.setXY(i, (phi0 + u * phiLen) / (Math.PI * 2), 1 - (th0 + v * thLen) / Math.PI);
  }
  return g;
}
const pieceGeo = [0, 1, 2].map(b => [0, 1, 2, 3].map(q => sliceGeo(HEAD_R, 5, 4, q * Math.PI / 2, Math.PI / 2, BANDS[b], BANDS[b + 1] - BANDS[b])));
const EMPTY_GEO = new THREE.BufferGeometry();
const coreGeo = new THREE.SphereGeometry(0.099, 14, 10);
const coreHalfGeo = [sliceGeo(0.099, 8, 10, Math.PI / 2, Math.PI, 0, Math.PI), sliceGeo(0.099, 8, 10, Math.PI * 1.5, Math.PI, 0, Math.PI)];   // right, left
const coreMat = new THREE.MeshLambertMaterial({ map: texOf(128, 64, (g, w, h) => {
  g.fillStyle = '#7a1212'; g.fillRect(0, 0, w, h);                       // raw muscle
  g.strokeStyle = '#4f0707'; g.lineWidth = 1; for (let x = 0; x < w; x += 5) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 3, h); g.stroke(); }
  for (let i = 0; i < 9; i++) blob(g, Math.random() * w, 18 + Math.random() * 34, 12 + Math.random() * 10, 8 + Math.random() * 7, '#eadfc6', '#b8ab8a');   // skull showing through
  g.strokeStyle = '#8a7f66'; g.lineWidth = 1; for (let i = 0; i < 12; i++) { const x = Math.random() * w, y = 14 + Math.random() * 40; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8 - Math.random() * 16, y + 9); g.stroke(); }
  g.fillStyle = '#d99aa6'; g.fillRect(0, 0, w, 13);                       // brain at the crown
  g.strokeStyle = '#b06a78'; g.lineWidth = 1.5; for (let x = 0; x < w; x += 7) { g.beginPath(); g.arc(x, 7, 4, 0, Math.PI, x % 14 === 0); g.stroke(); }
}) });
const pieceDir = (b, q, out) => { const th = (BANDS[b] + BANDS[b + 1]) / 2, ph = (q + 0.5) * Math.PI / 2; return out.set(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)); };

export class Dummy {
  // the game sets this to play a voice line: (dummy, event)
  static say(d, ev) { Dummy.onSay?.(d, ev); }
  // what the gore setting allows
  static gore = { sever: true, wounds: true, guts: true };
  constructor(world, scene, fx, x, z, yaw, opts = {}) {
    this.world = world; this.scene = scene; this.fx = fx;
    const sc = this.s = opts.scale ?? 1;
    this.type = opts.type ?? 'dummy'; this.armor = opts.armor ?? 0; this.dmgToPlayer = opts.dmg ?? 10;
    this.root = { x, z }; this.yaw = yaw;
    this.alive = true; this.hp = opts.hp ?? 100; this.state = 'stand';
    this.aggro = !!opts.aggro; this.speed = opts.speed ?? 1; this.gone = false;
    this.downT = 0; this.rise = 1; this.stun = 0; this.bleeding = 0; this.headGone = false;
    this.phase = Math.random() * 6; this.moveAmt = 0; this.time = Math.random() * 10;
    this.wanderT = 0; this.wanderYaw = yaw; this.wandering = false;
    this.sliceCd = 0;
    this.gutted = false; this.guts = [];
    this.heldBy = null; this.choked = false; this.chokeT = 0; this.outT = 0; this.heartOut = false; this.cleaved = false;
    this.burnT = 0; this.fireT = 0; this.skeleton = false; this.bruise = 0; this.organs = []; this.split = null; this.halves = [];
    this.headPieces = null; this.headL = null; this.woundCount = new Map();
    this.maxHp = this.hp; this.hurtT = 0; this.angry = false; this.expr = ''; this.clutch = null; this.wounds = [];
    this.onDeath = null;

    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.p = {}; this.all = []; this.sticks = [];
    for (const k in REST) {
      const [rx, ry, rz] = REST[k];
      const p = new Particle(x + (rx * c + rz * s) * sc, ry * sc, z + (-rx * s + rz * c) * sc, (RADIUS[k] ?? 0.05) * sc, TORSO.includes(k) ? 0.6 : 1);
      p.body = this; p.name = k;
      p.noSelf = k === 'head' || TORSO.includes(k);   // these sit inside the body's own collision shapes
      this.p[k] = p; this.all.push(p); world.add(p);
    }
    const stick = (a, b, opts) => { const st = world.stick(this.p[a], this.p[b], { ...opts, body: this }); this.sticks.push(st); return st; };
    for (let i = 0; i < TORSO.length; i++) for (let j = i + 1; j < TORSO.length; j++) stick(TORSO[i], TORSO[j]);
    for (const [a, b, len] of LIMITS) stick(a, b, { len: len * sc, min: true });

    this.group = new THREE.Group(); scene.add(this.group);
    const shirt = opts.shirt ?? SHIRTS[Math.floor(Math.random() * SHIRTS.length)], skin = opts.skin ?? SKIN;
    this.bones = []; this.bone = {};
    for (const [name, a, b, r, hp, leg] of BONES) {
      const st = stick(a, b);
      const bone = { name, a: this.p[a], b: this.p[b], r: r * sc, hp: hp * (opts.tough ?? 1), leg, stick: st, severed: false, mesh: null };
      if (name !== 'head') {
        const col = leg ? PANTS : (name.includes('Upper') ? shirt : skin);
        bone.len = st.len;
        bone.mesh = new THREE.Mesh(capsule(r * sc, st.len), new THREE.MeshLambertMaterial({ color: col }));
        this.group.add(bone.mesh);
      }
      this.bones.push(bone); this.bone[name] = bone;
    }
    this.skin = skin;
    this.hair = opts.hair !== undefined ? opts.hair : HAIR[Math.floor(Math.random() * HAIR.length)];
    this.headMesh = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ map: faceTex(skin, this.hair, 'neutral') }));
    this.torsoMesh = new THREE.Mesh(torsoGeo, new THREE.MeshLambertMaterial({ color: shirt }));
    this.headMesh.scale.setScalar(sc); this.torsoMesh.scale.setScalar(sc);
    // a neck you can see (and get a hand round)
    this.neckMesh = new THREE.Mesh(capsule(0.046 * sc, 0.1 * sc), new THREE.MeshLambertMaterial({ color: skin }));
    this.group.add(this.headMesh, this.torsoMesh, this.neckMesh);
    this.cloth = [this.torsoMesh, ...this.bones.filter(b => b.mesh && (b.leg || b.name.includes('Upper'))).map(b => b.mesh)];
    this.skinParts = [this.neckMesh, ...this.bones.filter(b => b.mesh && !b.leg && !b.name.includes('Upper')).map(b => b.mesh)];
    if (opts.armor) {
      // riot gear: helmet with a visor and a padded vest
      const navy = new THREE.MeshLambertMaterial({ color: 0x1c2638 });
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), navy);
      const visor = new THREE.Mesh(new THREE.SphereGeometry(0.131, 14, 6, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.3, Math.PI * 0.22), new THREE.MeshLambertMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.6 }));
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 0.25), navy); vest.position.y = 0.03;
      this.headMesh.add(helm, visor); this.torsoMesh.add(vest);
    }
    if (opts.bomb) {
      // a vest of dynamite
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.23), new THREE.MeshLambertMaterial({ color: 0x4a3a24 })); strap.position.y = -0.05;
      this.torsoMesh.add(strap);
      for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8), new THREE.MeshLambertMaterial({ color: 0xb3261e })); st.position.set(-0.15 + i * 0.06, -0.05, 0.125); strap.parent.add(st); }
      this.bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), new THREE.MeshBasicMaterial({ color: 0x330000 })); this.bombLight.position.set(0, 0.06, 0.13); this.torsoMesh.add(this.bombLight);
    }
    this.stumps = [];
    // solid shapes: trunk, head and every limb, against outsiders and against the body's own loose parts
    const P = this.p;
    this.torsoCaps = [{ a: P.pelvis, b: P.neck, r: 0.115 * sc, self: true }, { a: P.lSh, b: P.lHip, r: 0.075 * sc, self: true }, { a: P.rSh, b: P.rHip, r: 0.075 * sc, self: true }];
    this.headCap = { a: P.head, b: P.head, r: 0.105 * sc, self: true };
    this.solid = { owner: this, center: P.chest, caps: [...this.torsoCaps, this.headCap, ...this.bones.filter(b => b.name !== 'head').map(b => ({ bone: b, r: b.r, self: true }))] };
    world.bodies.push(this.solid);
    if (opts.legless) {   // crawlers come already missing their legs
      this.sever(this.bone.lThigh); this.sever(this.bone.rThigh);
      this.bleeding = 0; this.state = 'crawl';
    }
    for (const b of this.bones) if (b.name !== 'head') world.rods.push({ bone: b, r: b.r, body: this });
    this.sync();
  }

  canStand() { const b = this.bone; return !(b.lThigh.severed || b.rThigh.severed || b.lShin.severed || b.rShin.severed); }

  // one physics tick of "muscles"
  tick(h, player, hostile) {
    this.time += h;
    this.sliceCd -= h;
    // in someone's hand: steady it instead of letting it swing round and round
    if (this.heldBy) for (const p of this.all) if (!p.pinned) p.prev.lerp(p.pos, 0.12);
    if (!this.choked) this.chokeT = Math.max(0, this.chokeT - h * 0.5);
    if (!this.alive) return;
    if (this.state === 'out') {
      // passed out; comes round after ten seconds
      if ((this.outT -= h) <= 0) { this.state = 'down'; this.downT = 0.6; Dummy.say(this, 'wake'); }
      return;
    }
    if (this.heldBy) {
      this.stun = 0.5;
      if (this.choked) {
        // hands up to claw at the hand round their throat
        this.chokeT += h;
        if (this.chokeT > 1 && Math.random() < h * 0.6) Dummy.say(this, 'choke');
        for (const k of ['lHand', 'rHand']) {
          const p = this.p[k]; if (p.detached || p.pinned) continue;
          const tx = this.heldBy.pos.x - p.pos.x, ty = this.heldBy.pos.y - 0.04 - p.pos.y, tz = this.heldBy.pos.z - p.pos.z;
          p.pos.x += tx * 0.22; p.pos.y += ty * 0.22; p.pos.z += tz * 0.22;
          p.prev.x += tx * 0.17; p.prev.y += ty * 0.17; p.prev.z += tz * 0.17;
        }
        if (this.chokeT > 4) { this.state = 'out'; this.outT = 10; this.chokeT = 0; Dummy.say(this, 'passout'); }
      }
      return;
    }
    if (this.bleeding) { this.hp -= this.bleeding * 6 * h; if (this.hp <= 0) return this.die(); }
    this.stun = Math.max(0, this.stun - h * 1.4);
    this.hurtT -= h; this.angry = hostile;
    const P = this.p;
    // press a hand over the latest wound for a while
    if (this.clutch) {
      const c = this.clutch, hand = P[c.hand], part = c.decal.parent;
      if ((c.t -= h) <= 0 || !part || !part.visible || hand.detached) { hand.ghost = false; this.clutch = null; }
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
    const gx = this.goal ? this.goal.x : player.x, gz = this.goal ? this.goal.z : player.z;
    const dx = gx - P.pelvis.pos.x, dz = gz - P.pelvis.pos.z, dist = Math.hypot(dx, dz) || 1;
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
    if (this.panic) { if (Math.random() < h * 2) this.wanderYaw = Math.random() * 6.28; want = this.wanderYaw; speed = 2.0; }
    else if (this.goal) { want = Math.atan2(dx, dz); speed = dist > 0.35 ? 1.3 * this.speed : 0; }
    else if (hostile) { want = Math.atan2(dx, dz); speed = dist > (this.gunner ? 5 : 0.95 * this.s) ? 1.15 * this.speed : 0; }
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
      if (this.panic && (name.endsWith('Hand') || name.endsWith('Elbow'))) { y += 0.35 + Math.sin(this.time * 14 + x * 9) * 0.15; x *= 1.4; }   // on fire: arms flailing
      if (this.gunner && hostile && (name === 'rHand' || name === 'rElbow')) { x = name === 'rHand' ? 0.12 : 0.18; y = 1.42; z = name === 'rHand' ? 0.55 : 0.3; }   // gun arm out
      x *= this.s; y *= this.s; z *= this.s;
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
    if (!this.alive || this.state === 'crawl' || this.state === 'out') return;
    this.state = 'down'; this.downT = Math.max(this.downT, seconds);
  }
  die() {
    if (!this.alive) return;
    if (this.alive && !this.split && !this.headGone && !this.bone.head.severed) Dummy.say(this, this.fireT > 0 ? 'burnDie' : 'die');
    this.alive = false; this.state = 'dead';
    if (this.clutch) { this.p[this.clutch.hand].ghost = false; this.clutch = null; }
    this.onDeath?.(this);
  }

  // part = a bone, or null for the torso. dv = velocity kick.
  hit(part, dmg, dv, point, opts = {}) {
    const h = this.world.dt, P = this.p;
    this.stun = Math.min(1.5, this.stun + 0.5 * dmg);
    this.hurtT = 1.1; this.aggro = true;
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
        if (opts.bullet) { if (opts.big) this.explodeHead(); else { this.fx.emitter(this.p.head, 4, 30); this.bleeding += 0.4; } }
        else if (part.severed) this.explodeHead();
        else if (part.hp <= 0) this.sever(part);
      } else if (part.hp <= 0 && !part.severed) this.sever(part);
    }
    if (this.alive && this.hp > 0) Dummy.say(this, dmg >= 2 || this.hp < this.maxHp * 0.35 ? 'hurtBad' : 'hurt');
    if (this.hp <= 0) this.die();
  }
  // a blade pushed in: big damage, no dismemberment
  stab(part, dv) {
    const h = this.world.dt, P = this.p;
    this.stun = 1.5; this.hurtT = 1.4; this.aggro = true;
    if (!part) { for (const k of ['chest', 'pelvis']) P[k].push(dv, h); this.tint(this.torsoMesh); this.hp -= 45; }
    else { part.a.push(dv, h); part.b.push(dv, h); this.tint(part.mesh ?? this.headMesh); this.hp -= part.name === 'head' ? 400 : 12; }
    this.bleeding += 0.5;
    if (this.hp > 0) Dummy.say(this, 'stabbed');
    if (this.hp <= 0) this.die();
  }
  // Wounds are drawn as decals now; cloth only darkens slightly, and only on
  // limbs, which are too thin to carry a soak stain.
  tint(mesh) { if (mesh !== this.torsoMesh && mesh !== this.headMesh) mesh.material.color.lerp(GORE_COL, 0.1); }

  // Put a wound on a body part where something went in. bone = null for the
  // torso; point / dir are in world space; kind = 'bullet' | 'stab' | 'slash'.
  // cluster = how many shotgun pellets landed together: they tear out one ragged chunk
  addWound(bone, point, dir, kind, big = false, cluster = 1) {
    if (!Dummy.gore.wounds) { if (this.alive) this.bleeding += 0.05; return; }
    const head = bone?.name === 'head';
    const mesh = bone ? (head ? this.headMesh : bone.mesh) : this.torsoMesh;
    if (!mesh.visible) return;
    wq.copy(mesh.quaternion).invert();
    const lp = w1.copy(point).sub(mesh.position).applyQuaternion(wq), ld = w2.copy(dir).applyQuaternion(wq);
    let first = null;
    // Each hit to the same area digs a layer deeper: skin, then muscle, then bone.
    const area = bone ?? ('torso' + (lp.x > 0 ? 'R' : 'L') + (lp.y > 0 ? 'U' : 'D'));
    const hits = (this.woundCount.get(area) ?? 0) + 1;
    this.woundCount.set(area, hits);
    const depth = Math.min(3, hits + (big ? 1 : 0) + (cluster >= 3 ? 1 : 0));
    // one decal on the side the hit came from, and for bullets an exit wound opposite
    for (const side of kind === 'bullet' ? [-1, 1] : [-1]) {
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
      const layer = Math.min(3, depth + (exit ? 1 : 0));
      const d = new THREE.Mesh(woundGeo, kind === 'bullet' ? fleshMats[layer - 1] : slitMat);
      d.position.copy(pos); d.quaternion.setFromUnitVectors(Z_AXIS, wn);
      if (kind === 'bullet' && head) {
        // through the skull: a small round hole in, a bigger one out the back
        d.material = fleshMats[2]; d.scale.setScalar(exit ? 0.042 : 0.024);
      } else if (kind === 'bullet') {
        d.scale.setScalar(FLESH_SIZE[layer - 1] * (head ? 0.8 : 1) * (cluster > 1 ? 1.4 + Math.min(cluster, 7) * 0.2 : 1) * (cluster > 1 && bone ? 0.7 : 1));
        d.rotateZ(Math.random() * 6.28);
        if (cluster > 1) d.scale.x *= 0.8 + Math.random() * 0.5;   // a torn chunk, not a neat circle
      }
      else {
        d.scale.set(kind === 'stab' ? 0.022 : 0.02, kind === 'stab' ? 0.06 : 0.16, 1);
        d.rotateZ(kind === 'stab' ? (Math.random() - 0.5) * 1.2 : Math.PI / 2 + (Math.random() - 0.5) * 1.4);
      }
      d.renderOrder = 2;
      mesh.add(d);
      const w = { decal: d, stain: null, born: this.time };
      if (head && kind === 'bullet' && !exit) {
        // a run of blood down from the hole
        const run = new THREE.Mesh(woundGeo, stainMat);
        run.position.copy(pos).addScaledVector(wn, -0.0005); run.position.y -= 0.022; run.quaternion.copy(d.quaternion);
        run.scale.set(0.035, 0.07, 1); run.renderOrder = 1; mesh.add(run); w.stain = run;
      }
      if (!bone) {
        // blood soaks out through the shirt and runs down from the hole
        const st = new THREE.Mesh(woundGeo, stainMat);
        st.position.copy(pos).addScaledVector(wn, -0.001); st.position.y -= 0.02; st.quaternion.copy(d.quaternion);
        st.scale.setScalar(0.07); st.renderOrder = 1;
        mesh.add(st); w.stain = st;
      }
      this.wounds.push(w); first ??= w;
      if (cluster > 1 && !exit) {
        // stray pellets pepper the skin round the main chunk
        const span = bone ? 0.05 : 0.15;
        for (let i = Math.min(cluster - 1, 4); i > 0; i--) {
          const sat = new THREE.Mesh(woundGeo, fleshMats[Math.random() < 0.5 ? 0 : 1]);
          sat.quaternion.copy(d.quaternion);
          sat.position.copy(pos).add(t1.set((Math.random() - 0.5) * span, (Math.random() - 0.5) * span, 0.0005).applyQuaternion(d.quaternion));
          sat.scale.setScalar(0.022 + Math.random() * 0.014); sat.renderOrder = 2;
          mesh.add(sat); this.wounds.push({ decal: sat, stain: null, born: this.time });
        }
      }
      if (this.wounds.length > MAX_WOUNDS) { const old = this.wounds.shift(); old.decal.removeFromParent(); old.stain?.removeFromParent(); }
    }
    if (!this.alive) return;
    this.bleeding += kind === 'slash' ? 0.2 : 0.12 * Math.min(cluster, 4);
    // grab at it with whichever good hand is nearer
    if (head || this.clutch?.t > 3.5) return;
    let best = null, bd = Infinity;
    for (const s of ['l', 'r']) {
      const up = this.bone[s + 'UpperArm'], fore = this.bone[s + 'Forearm'];
      if (up.severed || fore.severed || bone === up || bone === fore) continue;
      const dd = this.p[s + 'Hand'].pos.distanceToSquared(point);
      if (dd < bd) { bd = dd; best = s + 'Hand'; }
    }
    if (best) { if (this.clutch) this.p[this.clutch.hand].ghost = false; this.p[best].ghost = true; this.clutch = { hand: best, decal: first.decal, t: 4.5 + Math.random() * 2 }; }
  }

  // Belly opened up: loops of intestine spill out and hang from the wound.
  // They're Verlet ropes pinned to the hips, so they swing, drag and can be grabbed.
  disembowel(point) {
    if (this.gutted || this.split || this.skeleton || !Dummy.gore.guts) return false;
    const P = this.p, w = this.world;
    t1.subVectors(P.rSh.pos, P.lSh.pos).normalize();          // body right
    t2.subVectors(P.neck.pos, P.pelvis.pos).normalize();      // body up
    t3.crossVectors(t1, t2).normalize();                      // body forward
    if (w1.subVectors(point, P.pelvis.pos).dot(t2) > 0.36) return false;   // too high: that's the chest
    this.gutted = true;
    const side = Math.max(-0.08, Math.min(0.08, w1.dot(t1)));
    const front = w1.dot(t3) >= 0 ? 1 : -1;
    const ends = [];
    for (const s of [-1, 1]) {
      let prev = null;
      for (let i = 0; i < 6; i++) {
        const p = new Particle(0, 0, 0, 0.03, 1.5);
        p.pos.copy(P.pelvis.pos).addScaledVector(t2, 0.13 - i * 0.02).addScaledVector(t3, front * (0.11 + i * 0.035)).addScaledVector(t1, side + s * (0.025 + i * 0.012));
        p.prev.copy(p.pos); p.body = this; p.detached = true; p.name = 'gut'; p.noSelf = i < 2;
        w.add(p); this.all.push(p);
        if (prev) {
          this.sticks.push(w.stick(prev, p, { len: 0.075, body: this }));
          const mesh = new THREE.Mesh(capsule(0.027, 0.075), gutMat);
          this.group.add(mesh); this.guts.push({ a: prev, b: p, mesh });
          w.rods.push({ a: prev, b: p, r: 0.027, body: this });
        } else for (const k of ['pelvis', 'lHip', 'rHip', 'chest']) this.sticks.push(w.stick(P[k], p, { body: this }));
        prev = p;
      }
      ends.push(prev);
    }
    // join the two strands into one hanging loop
    this.sticks.push(w.stick(ends[0], ends[1], { len: 0.09, body: this }));
    const loop = new THREE.Mesh(capsule(0.027, 0.09), gutMat);
    this.group.add(loop); this.guts.push({ a: ends[0], b: ends[1], mesh: loop });
    this.fx.spray(point, t3.multiplyScalar(front), 40, 3.5, 0.9);
    this.fx.emitter(ends[0], 7, 30); this.fx.emitter(P.pelvis, 5, 25);
    this.hp -= 35; this.bleeding += 1.5; this.hurtT = 2.5;
    if (this.hp > 0) Dummy.say(this, 'gutted');
    if (this.hp <= 0) this.die(); else this.knockdown(2.5);
    return true;
  }

  // ---- head damage -------------------------------------------------------
  // First damage swaps the smooth head for its twelve pieces over a skull core.
  crackHead() {
    if (this.headPieces) return;
    this.headPieces = [];
    for (let b = 0; b < 3; b++) for (let q = 0; q < 4; q++) {
      const m = new THREE.Mesh(pieceGeo[b][q], this.headMesh.material);
      m.userData.b = b; m.userData.q = q;
      this.headMesh.add(m); this.headPieces.push(m);
    }
    this.headCore = new THREE.Mesh(coreGeo, coreMat);
    this.headMesh.add(this.headCore);
    this.headMesh.geometry = EMPTY_GEO;
  }
  // A small-calibre hit blows off the piece of head it struck, not the whole thing.
  breakHead(point, dir) {
    if (this.headGone) return;
    this.crackHead();
    wq.copy(this.headMesh.quaternion).invert();
    w1.copy(point).sub(this.headMesh.position).applyQuaternion(wq).normalize();
    if (dir) w1.multiplyScalar(0.3).addScaledVector(w2.copy(dir).applyQuaternion(wq), -0.7).normalize();
    let best = null, bd = -2;
    for (const m of this.headPieces) { const d = pieceDir(m.userData.b, m.userData.q, wn).dot(w1); if (d > bd) { bd = d; best = m; } }
    if (!best) return this.explodeHead();
    pieceDir(best.userData.b, best.userData.q, wn);
    best.removeFromParent(); this.headPieces.splice(this.headPieces.indexOf(best), 1);
    // wounds drawn on that piece go with it
    this.wounds = this.wounds.filter(w => {
      if (w.decal.parent !== this.headMesh || t1.copy(w.decal.position).normalize().dot(wn) < 0.55) return true;
      w.decal.removeFromParent(); return false;
    });
    this.fx.gibs(point, 4, [0x8a0f0f, this.skin, BONE_COL, BRAIN_COL], 0.6);
    this.fx.spray(point, wn.applyQuaternion(this.headMesh.quaternion), 16, 3.5, 0.8);
    this.fx.emitter(this.p.head, 3, 25);
    this.bleeding += 0.6;
    if (this.headPieces.length <= 6) this.explodeHead();
  }

  // ---- cutting in half ---------------------------------------------------
  _extra(name, pos, r = 0.08, invMass = 0.6) {
    const p = new Particle(pos.x, pos.y, pos.z, r, invMass);
    p.body = this; p.detached = true; p.name = name;
    p.noSelf = name !== 'organ' && name !== 'gut';
    this.world.add(p); this.all.push(p);
    return p;
  }
  _link(a, b) { this.sticks.push(this.world.stick(a, b, { body: this })); }
  // drop every constraint joining a particle named in A to one named in B
  _cut(A, B) {
    for (const st of this.sticks) if ((A.has(st.a.name) && B.has(st.b.name)) || (B.has(st.a.name) && A.has(st.b.name))) st.dead = true;
    this.world.sticks = this.world.sticks.filter(st => !st.dead); this.sticks = this.sticks.filter(st => !st.dead);
  }
  _frame() {   // body right / up / forward into t1 / t2 / t3
    const P = this.p;
    t1.subVectors(P.rSh.pos, P.lSh.pos).normalize();
    t2.subVectors(P.neck.pos, P.pelvis.pos).normalize();
    t3.crossVectors(t1, t2).normalize();
  }
  heightOf(point) { return w1.subVectors(point, this.p.pelvis.pos).dot(t2.subVectors(this.p.neck.pos, this.p.pelvis.pos).normalize()); }
  // a length of intestine starting at `from`; pinned to `anchor` if given
  _rope(from, n, anchor) {
    let prev = anchor;
    for (let i = 0; i < n; i++) {
      const p = this._extra('gut', w2.copy(from).add(w1.set((Math.random() - 0.5) * 0.1, -i * 0.03, (Math.random() - 0.5) * 0.1)), 0.03, 1.5);
      p.noSelf = i < 2;
      if (prev) {
        this.sticks.push(this.world.stick(prev, p, { len: 0.075, body: this }));
        if (prev !== anchor || i > 0) { const mesh = new THREE.Mesh(capsule(0.027, 0.075), gutMat); this.group.add(mesh); this.guts.push({ a: prev, b: p, mesh }); this.world.rods.push({ a: prev, b: p, r: 0.027, body: this }); }
      }
      prev = p;
    }
    return prev;
  }
  // organs that drop out of the opening
  _spill(names, from) {
    for (const name of names) {
      const [, r, sc] = ORGANS[name];
      const p = this._extra('organ', w2.copy(from).add(w1.set((Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.12)), r, 1.2);
      p.setVelocity(w1.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2), this.world.dt);
      const mesh = new THREE.Mesh(organGeo, organMats[name]);
      mesh.scale.set(r * sc[0], r * sc[1], r * sc[2]);
      this.group.add(mesh); this.organs.push({ p, mesh });
      this.fx.emitter(p, 1.5, 15);
    }
  }
  _halfMesh(geo, capGeo, capMat, capPos, capRot) {
    const m = new THREE.Mesh(geo, this.torsoMesh.material);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.fromArray(capPos); cap.rotation.fromArray(capRot);
    m.add(cap); this.group.add(m);
    return m;
  }

  // Cut through at the waist: chest, arms and head come away from hips and legs.
  splitWaist(point) {
    if (this.split || !Dummy.gore.sever) return false;
    if (point) { const hgt = this.heightOf(point); if (hgt < -0.02 || hgt > 0.36) return false; }
    const P = this.p;
    this._frame();
    const right = t1.clone(), up = t2.clone(), fwd = t3.clone();
    this.split = 'waist';
    this._cut(new Set(['neck', 'chest', 'lSh', 'rSh', 'head', 'lElbow', 'lHand', 'rElbow', 'rHand']),
      new Set(['pelvis', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lFoot', 'rFoot', 'gut']));
    const cutAt = P.pelvis.pos.clone().addScaledVector(up, 0.2);
    const wu = this._extra('waistU', cutAt), wl = this._extra('waistL', P.pelvis.pos.clone().addScaledVector(up, 0.15).addScaledVector(fwd, 0.08));
    for (const k of ['neck', 'chest', 'lSh', 'rSh']) this._link(P[k], wu);
    for (const k of ['pelvis', 'lHip', 'rHip']) this._link(P[k], wl);
    for (const c of this.torsoCaps) c.dead = true;
    // each half is its own solid body now
    const legs = this.solid.caps.filter(c => c.bone?.leg);
    this.solid.caps = this.solid.caps.filter(c => !c.bone?.leg);
    this.solid.caps.push({ a: P.neck, b: wu, r: 0.11, self: true });
    this.world.bodies.push({ owner: this, center: P.pelvis, caps: [{ a: P.pelvis, b: wl, r: 0.1, self: true }, ...legs] });
    this.torsoMesh.visible = false;
    const upper = this._halfMesh(upperGeo, waistCapGeo, waistMat, [0, -0.171, 0], [Math.PI / 2, 0, 0]);
    const lower = this._halfMesh(lowerGeo, waistCapGeo, waistMat, [0, 0.121, 0], [-Math.PI / 2, 0, Math.PI]);
    lower.children[0].scale.set(0.95, 0.95, 1);
    this.halves.push(() => {
      t1.subVectors(P.rSh.pos, P.lSh.pos).normalize(); t2.subVectors(P.neck.pos, wu.pos).normalize();
      t3.crossVectors(t1, t2).normalize(); t1.crossVectors(t2, t3);
      upper.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      upper.position.copy(P.neck.pos).addScaledVector(t2, -0.15).addScaledVector(t3, 0.02);
    }, () => {
      t1.subVectors(P.rHip.pos, P.lHip.pos).normalize(); t2.subVectors(wl.pos, P.pelvis.pos);
      t3.crossVectors(t1, t2).normalize(); t2.crossVectors(t3, t1);
      lower.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      lower.position.copy(P.pelvis.pos).addScaledVector(t2, 0.03);
    });
    // intestines trail from the top half; the rest slops out on the floor
    this._rope(cutAt, 7, wu); this._rope(cutAt, 5, wu); this._rope(cutAt, 5, wl);
    this._spill(['liver', 'stomach', 'kidney', 'kidney'], cutAt);
    for (const k of ['neck', 'chest', 'lSh', 'rSh']) P[k].push(w1.copy(up).multiplyScalar(1.6).addScaledVector(fwd, -1.2), this.world.dt);
    this.fx.spray(cutAt, up, 60, 4.5, 1.2); this.fx.gibs(cutAt, 5, [0x8a0f0f, 0x7a1414, this.skin, 0xe9cf7a]);
    this.fx.emitter(wu, 8, 45); this.fx.emitter(wl, 8, 45);
    this.bleeding += 3; this.hp = Math.min(this.hp, 0); this.die();
    return true;
  }

  // Cut from the crown down through the groin: a left half and a right half.
  // depth: how far down the cut went (height above the pelvis); short of the
  // crotch it only cleaves the head and chest
  splitVertical(depth) {
    if (this.split || !Dummy.gore.sever) return false;
    if (depth !== undefined && depth > 0.14 * this.s) return this.cleave(depth);
    const P = this.p;
    this._frame();
    const right = t1.clone(), up = t2.clone();
    this.split = 'vertical';
    this._cut(new Set(['lSh', 'lHip', 'lElbow', 'lHand', 'lKnee', 'lFoot']),
      new Set(['neck', 'chest', 'pelvis', 'head', 'rSh', 'rHip', 'rElbow', 'rHand', 'rKnee', 'rFoot', 'gut']));
    const nL = this._extra('neckL', P.neck.pos.clone().addScaledVector(right, -0.02)), cL = this._extra('chestL', P.chest.pos.clone().addScaledVector(right, -0.02)),
      pL = this._extra('pelvisL', P.pelvis.pos.clone().addScaledVector(right, -0.02));
    const L = [nL, cL, pL, P.lSh, P.lHip];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (!(i >= 3 && j >= 3)) this._link(L[i], L[j]);
    this._link(P.lSh, P.lHip);
    for (const c of this.torsoCaps) c.dead = true;
    const leftSide = this.solid.caps.filter(c => c.bone?.name[0] === 'l');
    this.solid.caps = this.solid.caps.filter(c => c.bone?.name[0] !== 'l');
    this.solid.caps.push({ a: P.rSh, b: P.rHip, r: 0.08, self: true });
    this.world.bodies.push({ owner: this, center: cL, caps: [{ a: P.lSh, b: P.lHip, r: 0.08, self: true }, ...leftSide] });
    this.torsoMesh.visible = false;
    const halfR = this._halfMesh(halfGeo, sideCapGeo, this.heartOut ? sideMatRNH : sideMatR, [-0.101, 0, 0], [0, -Math.PI / 2, 0]);
    const halfL = this._halfMesh(halfGeo, sideCapGeo, this.heartOut ? sideMatLNH : sideMatL, [0.101, 0, 0], [0, Math.PI / 2, 0]);
    this.halves.push(() => {
      t2.subVectors(P.neck.pos, P.pelvis.pos).normalize(); t1.subVectors(P.rSh.pos, P.neck.pos);
      t3.crossVectors(t1, t2).normalize(); t1.crossVectors(t2, t3);
      halfR.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      halfR.position.addVectors(P.neck.pos, P.pelvis.pos).multiplyScalar(0.5).addScaledVector(t1, 0.1).addScaledVector(t3, 0.02);
    }, () => {
      t2.subVectors(nL.pos, pL.pos).normalize(); t1.subVectors(nL.pos, P.lSh.pos);
      t3.crossVectors(t1, t2).normalize(); t1.crossVectors(t2, t3);
      halfL.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      halfL.position.addVectors(nL.pos, pL.pos).multiplyScalar(0.5).addScaledVector(t1, -0.1).addScaledVector(t3, 0.02);
    });
    // the head goes too, if it's still on
    if (this.headL) { this.headL.mesh.visible = false; this.headL = null; }   // already split by an earlier cut
    this._headHalves(nL, cL, P.lSh, right);
    const mid = P.chest.pos.clone();
    this._spill([...(this.heartOut ? [] : ['heart']), 'lung', 'lung', 'liver', 'stomach', 'kidney', 'kidney'], mid);
    this._rope(P.pelvis.pos.clone().addScaledVector(up, 0.15), 7, null); this._rope(P.pelvis.pos.clone().addScaledVector(up, 0.15), 6, pL);
    for (const p of this.all) {
      if (p.pinned) continue;
      const side = ['lSh', 'lHip', 'lElbow', 'lHand', 'lKnee', 'lFoot', 'neckL', 'chestL', 'pelvisL', 'headL'].includes(p.name) ? -1 : p.name === 'organ' || p.name === 'gut' ? 0 : 1;
      if (side) p.push(w1.copy(right).multiplyScalar(side * 1.8), this.world.dt);
    }
    this.fx.spray(mid, up, 80, 5, 1.4); this.fx.gibs(mid, 6, [0x8a0f0f, 0x7a1414, this.skin, BONE_COL]);
    this.fx.emitter(P.chest, 8, 50); this.fx.emitter(cL, 8, 50); this.fx.emitter(P.pelvis, 6, 30);
    this.bleeding += 3; this.hp = Math.min(this.hp, 0); this.die();
    return true;
  }

  // Punched hard in the chest: the heart comes out in the fist. Returns the heart.
  ripHeart() {
    if (this.heartOut || this.split || this.skeleton || !Dummy.gore.guts) return null;
    this.heartOut = true;
    const P = this.p;
    this._frame();
    const at = P.chest.pos.clone().addScaledVector(t3, 0.12 * this.s);
    const [, r, sc] = ORGANS.heart;
    const heart = this._extra('organ', at, r, 1.2);
    const mesh = new THREE.Mesh(organGeo, organMats.heart); mesh.scale.set(r * sc[0], r * sc[1], r * sc[2]);
    this.group.add(mesh); this.organs.push({ p: heart, mesh });
    const hole = new THREE.Mesh(woundGeo, chestHoleMat);
    hole.position.set(-0.03, 0.08, 0.108); hole.scale.setScalar(0.15); hole.renderOrder = 2; this.torsoMesh.add(hole);
    this.fx.spray(at, t3, 50, 4, 0.9); this.fx.emitter(P.chest, 8, 45); this.fx.emitter(heart, 3, 20);
    Dummy.say(this, 'heart');
    this.bleeding += 3; this.hp = 0; this.die();
    return heart;
  }

  // both halves of the head, the left half on its own particle
  _headHalves(neckP, chestP, shP, right) {
    const P = this.p, hb = this.bone.head;
    if (this.headGone || hb.severed) return;
    this.crackHead();
    const hL = this._extra('headL', P.head.pos.clone().addScaledVector(right, -0.02), 0.09, 1);
    this._link(hL, neckP); this._link(hL, chestP); this._link(hL, shP);
    const meshL = new THREE.Mesh(EMPTY_GEO, this.headMesh.material);
    meshL.scale.setScalar(this.s);
    for (const m of [...this.headPieces]) if (m.userData.q === 0 || m.userData.q === 3) meshL.add(m);
    this.headCore.geometry = coreHalfGeo[0];
    meshL.add(new THREE.Mesh(coreHalfGeo[1], coreMat));
    const capR = new THREE.Mesh(brainCapGeo, brainMatR); capR.rotation.y = -Math.PI / 2; capR.position.x = -0.001; this.headMesh.add(capR);
    const capL = new THREE.Mesh(brainCapGeo, brainMatL); capL.rotation.y = Math.PI / 2; capL.position.x = 0.001; meshL.add(capL);
    this.group.add(meshL);
    this.headL = { mesh: meshL, head: hL, neck: neckP, sh: shP };
    return hL;
  }
  // A downward cut that stopped short of the crotch: the head comes apart and the
  // chest is laid open only as far as the blade went. depth = height above the pelvis.
  cleave(depth) {
    if (this.split || this.cleaved || !Dummy.gore.sever) return false;
    this.cleaved = true;
    const P = this.p;
    this._frame();
    const right = t1.clone(), up = t2.clone();
    const hL = this._headHalves(P.neck, P.chest, P.lSh, right);
    if (hL) {
      // let the two halves fall apart
      this.sticks.push(this.world.stick(hL, P.head, { len: 0.1 * this.s, min: true, body: this }));
      hL.push(w1.copy(right).multiplyScalar(-1.2), this.world.dt); P.head.push(w1.copy(right).multiplyScalar(1.2), this.world.dt);
    }
    const top = 0.52 * this.s, len = Math.max(0, top - depth);
    if (len > 0.04 && this.torsoMesh.visible) {
      const gash = new THREE.Mesh(woundGeo, slitMat);
      gash.position.set(0, 0.27 - len / this.s / 2, 0.109); gash.scale.set(0.07, len / this.s, 1); gash.renderOrder = 2; this.torsoMesh.add(gash);
      const soak = new THREE.Mesh(woundGeo, stainMat);
      soak.position.copy(gash.position); soak.position.z -= 0.001; soak.position.y -= 0.03; soak.scale.set(0.16, len / this.s * 1.3, 1); soak.renderOrder = 1; this.torsoMesh.add(soak);
      this.fx.emitter(P.chest, 6, 40);
    }
    this.fx.spray(P.head.pos, up, 50, 4, 1.2); this.fx.emitter(P.neck, 6, 40);
    this.bleeding += 2; this.hp = 0; this.die();
    return true;
  }

  // ---- fire ----------------------------------------------------------------
  ignite() {
    if (this.skeleton) return;
    if (this.fireT <= 0 && this.alive) Dummy.say(this, 'burn');
    this.fireT = 4;
  }
  // called every frame with simulated seconds; returns true while it's alight
  burn(sdt) {
    if (this.fireT <= 0) { this.panic = false; return false; }
    this.fireT -= sdt; this.burnT += sdt;
    if (this.alive) {
      this.hp -= 9 * sdt; this.panic = this.state === 'stand';
      if (Math.random() < sdt * 0.8) Dummy.say(this, 'burning');
      if (this.hp <= 0) this.die();
    }
    // clothes go dark and ragged, skin chars
    const k = Math.min(1, this.burnT / 5);
    for (const m of this.cloth) {
      m.material.color.lerp(CHAR, sdt * 0.4);
      if (this.burnT > 2.5 && !m.userData.tattered) { m.userData.tattered = true; m.material.map = tatterTex('#' + m.material.color.getHexString()); m.material.color.set(0xffffff).lerp(CHAR, 0.3); m.material.needsUpdate = true; }
    }
    for (const m of this.skinParts) m.material.color.lerp(k < 0.6 ? RAW : CHAR, sdt * 0.35);
    if (this.burnT > 8) this.skeletonize();
    return true;
  }
  // burned long enough: nothing left but bone
  skeletonize() {
    if (this.skeleton) return;
    this.skeleton = true; this.bleeding = 0; this.fireT = Math.min(this.fireT, 1.5);
    for (const w of this.wounds) { w.decal.removeFromParent(); w.stain?.removeFromParent(); }
    this.wounds.length = 0;
    for (const b of this.bones) if (b.mesh) { b.mesh.geometry = capsule(0.018 * this.s, b.len ?? 0.3); b.mesh.material = boneMat; }
    this.neckMesh.geometry = capsule(0.02 * this.s, 0.1 * this.s); this.neckMesh.material = boneMat;
    for (const g of this.guts) g.mesh.visible = false;
    for (const o of this.organs) o.mesh.visible = false;
    if (this.headPieces) for (const m of this.headPieces) m.visible = true;
    if (this.headCore) this.headCore.visible = false;
    // ribcage, spine and pelvis instead of the torso
    const cage = new THREE.Group();
    for (let i = 0; i < 9; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.04), boneMat); v.position.set(0, -0.26 + i * 0.065, -0.07); cage.add(v); }
    for (let i = 0; i < 6; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(0.15 - i * 0.008, 0.009, 4, 14, Math.PI * 1.7), boneMat); rib.rotation.set(Math.PI / 2, 0, Math.PI * 1.15); rib.scale.set(1, 0.68, 1); rib.position.set(0, 0.2 - i * 0.055, 0); cage.add(rib); }
    const pelvis = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 5, 12), boneMat); pelvis.rotation.x = Math.PI / 2; pelvis.scale.set(1, 0.6, 1); pelvis.position.y = -0.27; cage.add(pelvis);
    this.torsoMesh.add(cage);
    this.torsoMesh.material = new THREE.MeshBasicMaterial({ visible: false });
    for (const ch of [...this.torsoMesh.children]) if (ch !== cage) ch.visible = false;
    for (const ch of [...this.headMesh.children]) if (ch.material === coreMat || ch.material?.color?.getHex?.() === 0x1c2638) ch.visible = false;
    if (this.alive) this.die();
  }

  sever(bone) {
    if (bone.severed || !Dummy.gore.sever) return;
    bone.severed = true;
    const a = bone.a, b = bone.b, w = this.world;
    const stub = new Particle(a.pos.x, a.pos.y, a.pos.z, 0.045, 1);
    stub.prev.copy(a.prev); stub.body = this; stub.detached = true; stub.name = 'stub'; stub.noSelf = true;
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
    if (this.alive && bone.name !== 'head') Dummy.say(this, 'dismember');
    if (bone.name === 'head') this.die();
    else if (bone.leg && this.alive) { this.state = 'down'; this.downT = 1.2; }
  }

  explodeHead() {
    if (this.headGone) return;
    if (!Dummy.gore.sever) { this.hp = 0; this.die(); return; }
    const hb = this.bone.head, head = this.p.head;
    if (!hb.severed) this.sever(hb);
    if (this.headL) { this.headL.mesh.visible = false; this.headL = null; }
    this.headGone = true; head.gone = true; hb.a.gone = true; this.headCap.dead = true;
    this.headMesh.visible = false;
    this.fx.gibs(head.pos, 14, [0x8a0f0f, 0x7a1414, this.skin, BONE_COL, BONE_COL, BRAIN_COL, BRAIN_COL]);
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
    if (!this.split && segSeg(o, end, this.p.pelvis.pos, this.p.neck.pos) < 0.17 * 0.17 && segSeg.s < bs) { bs = segSeg.s; best = null; }
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
    if (!this.split) {
      t1.subVectors(P.rSh.pos, P.lSh.pos).normalize();
      t2.subVectors(P.neck.pos, P.pelvis.pos).normalize();
      t3.crossVectors(t1, t2).normalize(); t1.crossVectors(t2, t3);
      this.torsoMesh.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      this.torsoMesh.position.addVectors(P.neck.pos, P.pelvis.pos).multiplyScalar(0.5).addScaledVector(t3, 0.02);
    } else for (const update of this.halves) update();
    if (!this.headGone) {
      const hb = this.bone.head;
      if (this.split === 'vertical') t1.subVectors(P.rSh.pos, P.neck.pos); else t1.subVectors(P.rSh.pos, P.lSh.pos);
      t2.subVectors(hb.b.pos, hb.a.pos).normalize();
      t3.crossVectors(t1, t2).normalize(); t1.crossVectors(t2, t3);
      this.headMesh.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      this.headMesh.position.copy(hb.b.pos);
    }
    const hb2 = this.bone.head;
    this.neckMesh.visible = !hb2.severed;
    if (this.neckMesh.visible) {
      this.neckMesh.position.addVectors(P.neck.pos, P.head.pos).multiplyScalar(0.5).addScaledVector(t2, -0.03 * this.s);
      this.neckMesh.quaternion.setFromUnitVectors(UP, w1.subVectors(P.head.pos, P.neck.pos).normalize());
    }
    if (this.headL) {
      const hl = this.headL;
      t1.subVectors(hl.neck.pos, hl.sh.pos); t2.subVectors(hl.head.pos, hl.neck.pos).normalize();
      t3.crossVectors(t1, t2).normalize(); t1.crossVectors(t2, t3);
      hl.mesh.quaternion.setFromRotationMatrix(mb.makeBasis(t1, t2, t3));
      hl.mesh.position.copy(hl.head.pos);
    }
    for (const o of this.organs) { o.mesh.position.copy(o.p.pos); o.mesh.rotation.set(o.p.pos.z * 4, 0, o.p.pos.x * 4); }
    for (const st of this.stumps) st.mesh.position.copy(st.p.pos);
    for (const gt of this.guts) {
      gt.mesh.position.addVectors(gt.a.pos, gt.b.pos).multiplyScalar(0.5);
      gt.mesh.quaternion.setFromUnitVectors(UP, t1.subVectors(gt.b.pos, gt.a.pos).normalize());
    }
    const expr = this.skeleton ? 'skeleton' : this.burnT > 3 ? 'scorched' : !this.alive ? 'dead' : this.state === 'out' ? 'out'
      : this.choked && this.chokeT > 0.3 ? 'choke' : this.hurtT > 0 ? 'hurt'
      : (this.bleeding > 0 || this.hp < this.maxHp * 0.6) ? 'bleed' : this.angry ? 'angry' : 'neutral';
    const look = expr + Math.floor(this.bruise);
    if (look !== this.expr) { this.expr = look; this.headMesh.material.map = faceTex(this.skin, this.hair, expr, Math.floor(this.bruise)); }
    if (this.bombLight) this.bombLight.material.color.setHex(this.bombT > 0 && Math.sin(this.time * 30) > 0 ? 0xff2200 : 0x330000);
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

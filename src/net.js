// Multiplayer over PeerJS (WebRTC, peer to peer). One player hosts: their peer
// id is gorelab-<CODE> and everyone else connects to them. Game messages go
// through the host (a star); voice goes directly between every pair of players.
import { audioCtx, sfx } from './audio.js?v=29';

const PREFIX = 'gorelab-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
// a distinct shirt for each player, handed out by the host in join order
export const SHIRTS = [0xd03a2f, 0x2f6fd0, 0x3fa34a, 0xe0b52c, 0x8a3fd0, 0xe0732c, 0x2cc0c8, 0xe04f9c];

let peer = null, hostConn = null, localStream = null, selfAnalyser = null, lastPose = 0;
const conns = new Map();     // host only: peer id -> connection
const voices = new Map();    // peer id -> { el, an, pan, g, call, level }
const buf = new Uint8Array(512);

export const net = {
  on: false, host: false, code: '', id: '', name: '', color: 0, status: '',
  players: new Map(),        // everyone else: id -> { id, name, color, pose }
  muted: false, micOk: false, selfLevel: 0,
  // filled in by the game
  getMap: () => '', onMap: null, onPose: null, onPlayers: null, onDmg: null, onFx: null, onKill: null, onStatus: null,
};

function status(s) { net.status = s; net.onStatus?.(s); }

function loadPeer() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    sc.onload = res; sc.onerror = () => rej(new Error('could not load the multiplayer library'));
    document.head.appendChild(sc);
  });
}

async function getMic() {
  if (localStream) return;
  const ac = audioCtx();
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    net.micOk = true;
    selfAnalyser = ac.createAnalyser(); selfAnalyser.fftSize = 512;
    ac.createMediaStreamSource(localStream).connect(selfAnalyser);
  } catch {
    // no mic (or it was refused): send silence so calls still connect and you can still hear everyone
    localStream = ac.createMediaStreamDestination().stream; net.micOk = false;
  }
}

function openPeer(id) {
  return new Promise((res, rej) => {
    const p = id ? new window.Peer(id) : new window.Peer();
    const fail = e => { p.destroy(); rej(e); };
    p.once('error', fail);
    p.once('open', () => { p.off('error', fail); peer = p; res(); });
  });
}

function setupPeer() {
  peer.on('call', call => { call.answer(localStream); hookCall(call); });
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', e => { if (e.type === 'peer-unavailable') return; status('Connection problem: ' + (e.type || e.message)); });
}

// ---------------------------------------------------------------- hosting
export async function host(name) {
  net.name = name; status('Starting a game…');
  await loadPeer(); await getMic();
  let err = null;
  for (let i = 0; i < 6 && !peer; i++) {
    const code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    try { await openPeer(PREFIX + code); net.code = code; } catch (e) { err = e; if (e.type !== 'unavailable-id') break; }
  }
  if (!peer) throw err || new Error('could not start a game');
  Object.assign(net, { on: true, host: true, id: peer.id, color: 0 });
  setupPeer();
  peer.on('connection', conn => {
    conn.on('data', m => hostData(conn, m));
    conn.on('close', () => leave(conn.peer));
    conn.on('error', () => leave(conn.peer));
  });
  status('Hosting room ' + net.code + (net.micOk ? '' : ' · no microphone'));
}

function hostData(conn, m) {
  const from = conn.peer;
  if (m.t === 'hello') {
    if (net.players.size >= 7) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
    const used = new Set([net.color, ...[...net.players.values()].map(p => p.color)]);
    let color = 0; while (used.has(color)) color++;
    const info = { id: from, name: String(m.name || 'Player').slice(0, 16), color };
    const others = [{ id: net.id, name: net.name, color: net.color }, ...[...net.players.values()].map(({ id, name, color }) => ({ id, name, color }))];
    conns.set(from, conn);
    conn.send({ t: 'welcome', color, map: net.getMap(), players: others });
    for (const [id, c] of conns) if (id !== from) c.send({ t: 'join', p: info });
    net.players.set(from, info);
    net.onPlayers?.('join', info);
    return;
  }
  if (!conns.has(from)) return;
  m.from = from;
  if (m.to) { if (m.to === net.id) deliver(m); else conns.get(m.to)?.send(m); return; }
  for (const [id, c] of conns) if (id !== from) c.send(m);
  deliver(m);
}

// ---------------------------------------------------------------- joining
export async function join(name, code) {
  code = code.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) throw new Error('room codes are 4 letters');
  net.name = name; status('Joining ' + code + '…');
  await loadPeer(); await getMic();
  await openPeer();
  setupPeer();
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('no game found with code ' + code)), 12000);
    peer.on('error', e => { if (e.type === 'peer-unavailable') { clearTimeout(timer); rej(new Error('no game found with code ' + code)); } });
    hostConn = peer.connect(PREFIX + code, { serialization: 'json', reliable: true });
    hostConn.on('open', () => hostConn.send({ t: 'hello', name }));
    hostConn.on('data', m => {
      if (m.t === 'full') { clearTimeout(timer); rej(new Error('that game is full')); return; }
      if (m.t === 'welcome') {
        clearTimeout(timer);
        Object.assign(net, { on: true, host: false, code, id: peer.id, color: m.color });
        for (const p of m.players) { net.players.set(p.id, p); net.onPlayers?.('join', p); }
        net.onMap?.(m.map);
        // the newcomer rings everyone already there
        for (const p of m.players) hookCall(peer.call(p.id, localStream));
        status('In room ' + code + (net.micOk ? '' : ' · no microphone'));
        res();
        return;
      }
      clientData(m);
    });
    hostConn.on('close', () => {
      for (const id of [...net.players.keys()]) leave(id);
      net.on = false; status('The host left the game');
    });
  });
}

function clientData(m) {
  if (m.t === 'join') { net.players.set(m.p.id, m.p); net.onPlayers?.('join', m.p); return; }
  if (m.t === 'leave') { leave(m.id); return; }
  deliver(m);
}

function deliver(m) {
  if (m.t === 'pose') { const p = net.players.get(m.from); if (p) { p.pose = m.p; net.onPose?.(p); } }
  else if (m.t === 'dmg') { if (m.to === net.id) net.onDmg?.(m); }
  else if (m.t === 'fx') net.onFx?.(m);
  else if (m.t === 'kill') net.onKill?.(m);
  else if (m.t === 'map') net.onMap?.(m.map);
}

function leave(id) {
  const p = net.players.get(id);
  const v = voices.get(id);
  if (v) { v.call?.close(); v.el.srcObject = null; v.src?.disconnect(); v.g.disconnect(); voices.delete(id); }
  if (!p) return;
  net.players.delete(id);
  if (net.host) { conns.get(id)?.close(); conns.delete(id); for (const c of conns.values()) c.send({ t: 'leave', id }); }
  net.onPlayers?.('leave', p);
}

// ---------------------------------------------------------------- sending
export function send(m) {
  if (!net.on) return;
  if (net.host) { m.from = net.id; if (m.to) conns.get(m.to)?.send(m); else for (const c of conns.values()) c.send(m); }
  else if (hostConn?.open) hostConn.send(m);
}
// your pose, about 20 times a second
export function sendPose(p, now) {
  if (!net.on || now - lastPose < 0.05) return;
  lastPose = now; send({ t: 'pose', p });
}

// ---------------------------------------------------------------- voice
function hookCall(call) {
  call.on('stream', stream => {
    const old = voices.get(call.peer);
    if (old?.stream === stream) return;
    if (old) { old.el.srcObject = null; old.src?.disconnect(); old.g.disconnect(); }
    const ac = audioCtx();
    // Chrome only feeds a WebRTC stream into Web Audio while a media element plays it too
    const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(), pan = ac.createStereoPanner(), g = ac.createGain();
    an.fftSize = 512; g.gain.value = 1;
    src.connect(an); src.connect(pan).connect(g).connect(ac.destination);
    voices.set(call.peer, { stream, el, src, an, pan, g, call, level: 0 });
  });
  call.on('close', () => { const v = voices.get(call.peer); if (v?.call === call) { v.el.srcObject = null; v.src?.disconnect(); v.g.disconnect(); voices.delete(call.peer); } });
}

function rms(an) {
  an.getByteTimeDomainData(buf);
  let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
  return Math.sqrt(s / buf.length);
}
// how loud each player is talking right now (0..1), for their mouth, and where their voice comes from
export function updateVoices(dt, headOf) {
  const k = 1 - Math.exp(-dt * 18);
  for (const [id, v] of voices) {
    const lvl = Math.min(1, Math.max(0, rms(v.an) - 0.01) * 9);
    v.level += (lvl - v.level) * k;
    const p = net.players.get(id); if (p) p.level = v.level;
    const at = headOf(id);
    if (at) sfx.place(v.pan, v.g, at); else v.g.gain.value = 0;
  }
  const self = selfAnalyser && !net.muted ? Math.min(1, Math.max(0, rms(selfAnalyser) - 0.01) * 9) : 0;
  net.selfLevel += (self - net.selfLevel) * k;
}

export function setMuted(m) {
  net.muted = m;
  for (const t of localStream?.getAudioTracks() ?? []) t.enabled = !m;
}

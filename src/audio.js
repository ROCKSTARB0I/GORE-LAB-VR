// Synthesised sound effects -- no audio files.
let ac = null, noiseBuf = null, sawNodes = null, flameNodes = null;

let fxOut = null, verb = null, verbWet = null, verbWant = null, verbKey = '';
// A room's reverb: tail length in seconds and how much of it you hear. null = outdoors, dry.
function impulse(secs, damp) {
  const n = Math.floor(ac.sampleRate * secs), buf = ac.createBuffer(2, n, ac.sampleRate), pre = Math.floor(ac.sampleRate * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / (n - pre);
      lp += (Math.random() * 2 - 1 - lp) * (1 - damp * t);   // later echoes get duller
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
  }
  return buf;
}
function ctx() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // sound effects go through one bus with a reverb send (music and voice chat stay dry)
    fxOut = ac.createGain(); fxOut.connect(ac.destination);
    verb = ac.createConvolver(); verbWet = ac.createGain(); verbWet.gain.value = 0;
    fxOut.connect(verb).connect(verbWet).connect(ac.destination);
    if (verbWant) sfx.reverb(verbWant);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

function noise(dur, vol, freq, type = 'lowpass', freqEnd = freq) {
  if (!ac) return;
  const t = ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf; src.loopStart = Math.random() * 0.5; src.loop = true;
  f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(fxOut);
  src.start(t); src.stop(t + dur);
}

function tone(type, f0, f1, dur, vol) {
  if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(fxOut);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  init() { ctx(); loadVoices(); },
  shot(kind) {
    if (kind === 'shotgun') { noise(0.35, 0.9, 2600, 'lowpass', 300); tone('sine', 140, 40, 0.3, 0.9); }
    else if (kind === 'revolver') { noise(0.25, 0.8, 3000, 'lowpass', 400); tone('sine', 170, 45, 0.22, 0.8); }
    else if (kind === 'rifle') { noise(0.12, 0.6, 3800, 'lowpass', 700); tone('square', 190, 70, 0.09, 0.3); }
    else if (kind === 'rocket') { noise(0.7, 0.7, 500, 'bandpass', 2500); tone('sawtooth', 90, 300, 0.5, 0.2); }
    else if (kind === 'sniper') { noise(0.6, 1.0, 5000, 'lowpass', 200); tone('sine', 120, 30, 0.5, 1.0); }
    else if (kind === 'minigun') { noise(0.06, 0.4, 4500, 'lowpass', 1200); tone('square', 300, 120, 0.04, 0.18); }
    else if (kind === 'launcher') { tone('sine', 160, 60, 0.18, 0.7); noise(0.12, 0.3, 900, 'lowpass', 200); }
    else if (kind === 'crossbow') { tone('square', 520, 140, 0.12, 0.25); noise(0.05, 0.3, 3000, 'bandpass', 800); }
    else if (kind === 'smg') { noise(0.09, 0.45, 4200, 'lowpass', 900); tone('square', 260, 90, 0.07, 0.25); }
    else { noise(0.14, 0.6, 3600, 'lowpass', 600); tone('sine', 200, 60, 0.12, 0.6); }
  },
  squish() { noise(0.16, 0.5, 900, 'lowpass', 180); tone('sine', 180, 70, 0.1, 0.25); },
  splat() { noise(0.3, 0.6, 700, 'lowpass', 120); tone('sine', 120, 45, 0.2, 0.4); },
  thud() { tone('sine', 110, 45, 0.14, 0.7); noise(0.06, 0.3, 500); },
  slice() { noise(0.14, 0.4, 5000, 'bandpass', 1200); noise(0.2, 0.4, 800, 'lowpass', 150); },
  boom() { noise(0.9, 1.0, 1800, 'lowpass', 60); tone('sine', 90, 25, 0.8, 1.0); },
  grunt() { const f = 150 + Math.random() * 90; tone('sawtooth', f, f * 0.55, 0.22, 0.22); noise(0.18, 0.12, 900, 'bandpass', 500); },
  spawn() { tone('sine', 400, 1200, 0.12, 0.25); tone('triangle', 800, 1600, 0.1, 0.12); },
  tick() { tone('square', 1100, 1100, 0.03, 0.08); },
  hurt() { tone('sawtooth', 220, 90, 0.18, 0.35); noise(0.12, 0.4, 600); },
  wave() { tone('square', 330, 330, 0.12, 0.2); setTimeout(() => tone('square', 495, 495, 0.2, 0.2), 140); },
  // flamethrower roar while it's firing
  flame(on) {
    if (!ac || (!flameNodes && !on)) return;
    if (!flameNodes) {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noiseBuf; src.loop = true; f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0;
      src.connect(f).connect(g).connect(fxOut); src.start();
      flameNodes = { f, g };
    }
    flameNodes.g.gain.setTargetAtTime(on ? 0.35 : 0, ac.currentTime, 0.06);
    flameNodes.f.frequency.setTargetAtTime(on ? 600 + Math.random() * 500 : 400, ac.currentTime, 0.05);
  },
  // level: 0 off, 1 idling in the hand, 2 revving; cutting = biting into something
  saw(level, cutting) {
    if (!ac || (!sawNodes && !level)) return;
    if (!sawNodes) {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; g.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(g).connect(fxOut);
      o1.start(); o2.start();
      sawNodes = { o1, o2, lp, g };
    }
    const t = ac.currentTime, n = sawNodes;
    const f = level === 2 ? (cutting ? 74 + Math.random() * 14 : 104) : 38;
    n.o1.frequency.setTargetAtTime(f, t, 0.05); n.o2.frequency.setTargetAtTime(f * 1.51, t, 0.05);
    n.lp.frequency.setTargetAtTime(level === 2 ? (cutting ? 2400 : 1300) : 500, t, 0.05);
    n.g.gain.setTargetAtTime(level === 2 ? (cutting ? 0.3 : 0.2) : level === 1 ? 0.045 : 0, t, 0.04);
  },
  beep() { tone('square', 660, 880, 0.08, 0.15); },
};

// ---------------------------------------------------------------- music
// Generated on the fly: each track is a tempo, a key, a chord loop and a few
// patterns. The melody is rolled from a fixed seed so a track always sounds the same.
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
};
const TRACKS = [
  { name: 'Chill: Drift', bpm: 74, root: 48, mode: 'major', prog: [0, 5, 3, 4], seed: 11,
    pad: { type: 'triangle', vol: 0.07, notes: [0, 2, 4, 6] }, bass: { type: 'sine', pat: 'x.......x.....x.', vol: 0.2, len: 5 },
    lead: { type: 'sine', vol: 0.09, density: 0.3, len: 5 }, kick: 'x.......x.......', kickVol: 0.3, hat: '..x...x...x...x.', hatVol: 0.03 },
  { name: 'Chill: Lagoon', bpm: 88, root: 53, mode: 'lydian', prog: [0, 2, 3, 0], seed: 23, swing: 0.12,
    pad: { type: 'triangle', vol: 0.06, notes: [0, 2, 4, 6] }, bass: { type: 'sine', pat: 'x.....x...x.....', vol: 0.2, len: 4 },
    lead: { type: 'triangle', vol: 0.08, density: 0.42, len: 3 }, kick: 'x.....x...x.....', kickVol: 0.3, snare: '....x.......x...', snareVol: 0.06, hat: 'x.x.x.x.x.x.x.x.', hatVol: 0.025 },
  { name: 'Suspense: Creep', bpm: 56, root: 38, mode: 'phrygian', prog: [0, 0, 1, 0], seed: 37,
    pad: { type: 'sawtooth', vol: 0.06, cut: 380, oct: 1, notes: [0, 4, 7] }, bass: { type: 'sine', pat: 'x...............', vol: 0.26, len: 14 },
    lead: { type: 'sine', vol: 0.06, density: 0.1, len: 9, oct: 4 }, kick: 'x..x............', kickVol: 0.35 },
  { name: 'Suspense: Stalker', bpm: 66, root: 40, mode: 'minor', prog: [0, 5, 0, 6], seed: 41,
    pad: { type: 'sawtooth', vol: 0.05, cut: 500, oct: 1, notes: [0, 2, 4] }, bass: { type: 'triangle', pat: 'x.......x..x....', vol: 0.2, len: 3 },
    lead: { type: 'square', vol: 0.03, density: 0.13, len: 2, oct: 3 }, kick: 'x.......x..x....', kickVol: 0.3, hat: 'x...x...x...x...', hatVol: 0.035 },
  { name: 'Action: Overdrive', bpm: 142, root: 33, mode: 'minor', prog: [0, 0, 5, 6], seed: 53,
    pad: { type: 'sawtooth', vol: 0.035, cut: 1400, oct: 2, notes: [0, 2, 4] }, bass: { type: 'sawtooth', pat: 'x.x.x.x.x.x.x.x.', vol: 0.13, cut: 700, len: 1.4, oct: 0 },
    lead: { type: 'square', vol: 0.04, density: 0.55, len: 1.5, oct: 3 }, kick: 'x...x...x...x...', kickVol: 0.55, snare: '....x.......x...', snareVol: 0.2, hat: 'x.x.x.x.x.x.x.x.', hatVol: 0.05 },
  { name: 'Action: Bloodrush', bpm: 160, root: 31, mode: 'phrygian', prog: [0, 1, 0, 6], seed: 67,
    pad: { type: 'sawtooth', vol: 0.03, cut: 1600, oct: 2, notes: [0, 4, 7] }, bass: { type: 'sawtooth', pat: 'x.xxx.xxx.xxx.xx', vol: 0.12, cut: 800, len: 0.9, oct: 0 },
    lead: { type: 'sawtooth', vol: 0.035, density: 0.5, len: 1.2, oct: 3 }, kick: 'x..x..x.x..x..x.', kickVol: 0.55, snare: '....x.......x..x', snareVol: 0.2, hat: 'xxxxxxxxxxxxxxxx', hatVol: 0.04 },
  { name: 'Bored: Waiting Room', bpm: 104, root: 48, mode: 'major', prog: [0, 5, 1, 4], seed: 71, swing: 0.1,
    pad: { type: 'triangle', vol: 0.05, notes: [0, 2, 4, 6] }, bass: { type: 'sine', pat: 'x.....x.x.....x.', vol: 0.18, len: 2.5 },
    lead: { type: 'triangle', vol: 0.09, density: 0.45, len: 2.2 }, snare: '...x..x...x..x..', snareVol: 0.025, hat: 'x.xxx.xxx.xxx.xx', hatVol: 0.02 },
  { name: 'Bored: Hold Music', bpm: 92, root: 51, mode: 'major', prog: [0, 3, 4, 0], seed: 83,
    pad: { type: 'sine', vol: 0.07, notes: [0, 2, 4] }, bass: { type: 'triangle', pat: 'x...x...x...x...', vol: 0.14, len: 2.5 },
    lead: { type: 'square', vol: 0.035, density: 0.5, len: 1.8 }, hat: '..x...x...x...x.', hatVol: 0.02 },
];
let musicGain = null, mBus = null, mBuses = 0, mTimer = null, mCur = -1, mStep = 0, mNext = 0, mVol = 0.5, mMelody = null;

function rng(seed) {
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function mFreq(tr, deg, oct) {
  const m = MODES[tr.mode], o = Math.floor(deg / 7);
  return 440 * Math.pow(2, (tr.root + m[((deg % 7) + 7) % 7] + 12 * (o + oct) - 69) / 12);
}
function mNote(type, f, t, dur, v, attack, cut, pluck) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + attack);
  if (pluck) g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  else { g.gain.setValueAtTime(v, t + Math.max(attack, dur - 0.06)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1); }
  let node = o;
  if (cut) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; o.connect(lp); node = lp; }
  node.connect(g).connect(mBus);
  o.start(t); o.stop(t + dur + 0.15);
}
function mNoise(t, dur, v, freq, type) {
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf; src.loop = true; src.loopStart = Math.random() * 0.5;
  f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(mBus);
  src.start(t); src.stop(t + dur + 0.02);
}
function mKick(t, v) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
  o.connect(g).connect(mBus); o.start(t); o.stop(t + 0.25);
}
function mSchedule() {
  const tr = TRACKS[mCur];
  if (!tr || !ac) return;
  const sd = 60 / tr.bpm / 4, bars = tr.prog.length, sw = tr.swing ?? 0;
  if (mNext < ac.currentTime) mNext = ac.currentTime + 0.05;   // tab was asleep: don't burst-play the backlog
  while (mNext < ac.currentTime + 0.3) {
    const s16 = mStep % 16, bar = Math.floor(mStep / 16) % bars, pass = Math.floor(mStep / (16 * bars)) % 2;
    const deg = tr.prog[bar], t = mNext;
    if (s16 === 0 && tr.pad) for (const k of tr.pad.notes) mNote(tr.pad.type, mFreq(tr, deg + k, tr.pad.oct ?? 1), t, sd * 16, tr.pad.vol, 0.5, tr.pad.cut);
    if (tr.bass && tr.bass.pat[s16] === 'x') mNote(tr.bass.type, mFreq(tr, deg, tr.bass.oct ?? 0), t, sd * tr.bass.len, tr.bass.vol, 0.012, tr.bass.cut);
    const m = mMelody[pass][bar * 16 + s16];
    if (m !== null) mNote(tr.lead.type, mFreq(tr, deg + m, tr.lead.oct ?? 2), t, sd * tr.lead.len, tr.lead.vol, 0.008, 0, true);
    if (tr.kick?.[s16] === 'x') mKick(t, tr.kickVol);
    if (tr.snare?.[s16] === 'x') mNoise(t, 0.14, tr.snareVol, 1800, 'bandpass');
    if (tr.hat?.[s16] === 'x') mNoise(t, 0.04, tr.hatVol, 7000, 'highpass');
    mNext += sd * (s16 % 2 ? 1 - sw : 1 + sw); mStep++;
  }
}
export const music = {
  tracks: TRACKS.map(t => ({ name: t.name })),
  get current() { return mCur; },
  get buses() { return mBuses; },
  get volume() { return mVol; },
  setVolume(v) { mVol = Math.max(0, Math.min(1, Math.round(v * 10) / 10)); if (musicGain) musicGain.gain.value = mVol * 0.7; },
  play(i) {
    clearInterval(mTimer); mTimer = null; mCur = -1;
    // Only one track is ever audible: each track plays into its own bus, and
    // the old bus is silenced and unplugged before the next one starts, so
    // notes that were already ringing or queued can't overlap the new track.
    if (mBus) {
      const old = mBus; mBus = null;
      old.gain.cancelScheduledValues(ac.currentTime);
      old.gain.setValueAtTime(old.gain.value, ac.currentTime);
      old.gain.linearRampToValueAtTime(0, ac.currentTime + 0.1);
      setTimeout(() => { old.disconnect(); mBuses--; }, 150);
    }
    const tr = TRACKS[i];
    if (!tr) return;
    ctx();
    if (!musicGain) { musicGain = ac.createGain(); musicGain.connect(ac.destination); }
    musicGain.gain.value = mVol * 0.7;
    mBus = ac.createGain(); mBus.connect(musicGain); mBuses++;
    // two passes of melody so the loop doesn't repeat too soon
    const r = rng(tr.seed), n = tr.prog.length * 16;
    mMelody = [0, 1].map(() => {
      let cur = 2;
      return Array.from({ length: n }, (_, s) => {
        const p = tr.lead.density * (s % 4 === 0 ? 1.6 : s % 2 === 0 ? 1 : 0.45);
        if (r() >= p) return null;
        cur = Math.max(0, Math.min(9, cur + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]));
        if (s % 4 === 0) cur = [0, 2, 4, 7, 9].reduce((a, b) => Math.abs(b - cur) < Math.abs(a - cur) ? b : a);
        return cur;
      });
    });
    mCur = i; mStep = 0; mNext = ac.currentTime + 0.1;
    mTimer = setInterval(mSchedule, 80);
  },
};

// ---------------------------------------------------------------- voices
// Each event can play any recorded clip listed in voice/manifest.json (see
// voice/VOICE_LINES.md). Events with nothing recorded get a synthesized cry.
const VOICE_EVENTS = {"hurt": ["hurt_01", "hurt_02", "hurt_03", "hurt_04", "hurt_05", "hurt_06"], "hurtBad": ["hurt_bad_01", "hurt_bad_02", "hurt_bad_03", "hurt_bad_04"], "stabbed": ["stabbed_01", "stabbed_02", "stabbed_03"], "dismember": ["dismember_01", "dismember_02", "dismember_03", "dismember_04"], "gutted": ["gutted_01", "gutted_02", "gutted_03"], "heart": ["heart_01", "heart_02"], "die": ["die_01", "die_02", "die_03", "die_04"], "burn": ["burn_start_01", "burn_start_02", "burn_start_03"], "burning": ["burning_01", "burning_02", "burning_03"], "burnDie": ["burn_die_01", "burn_die_02"], "choke": ["choke_01", "choke_02", "choke_03"], "passout": ["passout_01", "passout_02"], "wake": ["wake_01", "wake_02"], "grabbed": ["grabbed_01", "grabbed_02", "grabbed_03"], "attack": ["attack_01", "attack_02", "attack_03"], "taunt": ["taunt_01", "taunt_02"], "bomber": ["bomber_01", "bomber_02"]};
const voiceBufs = {};
let voicesLoaded = false, voicesPlaying = 0;
const listener = { x: 0, y: 1.6, z: 0, yaw: 0 };
async function loadVoices() {
  if (voicesLoaded) return;
  voicesLoaded = true;
  try {
    const list = await (await fetch('voice/manifest.json', { cache: 'no-cache' })).json();
    for (const file of list) {
      try {
        const buf = await ac.decodeAudioData(await (await fetch('voice/' + file)).arrayBuffer());
        voiceBufs[file.replace(/\.[a-z0-9]+$/i, '')] = buf;
      } catch { /* a missing or broken file just falls back to the synth */ }
    }
  } catch { /* no manifest: synth only */ }
}
// left/right and distance from the player
function spatial(pos) {
  const dx = pos.x - listener.x, dz = pos.z - listener.z, dist = Math.hypot(dx, dz, pos.y - listener.y);
  const ang = Math.atan2(dx, -dz) + listener.yaw;
  const pan = ac.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, Math.sin(ang)));
  const g = ac.createGain(); g.gain.value = 1 / (1 + dist * 0.35);
  pan.connect(g).connect(fxOut);
  return pan;
}
// a crude vocal cry: buzzy source through a couple of vowel-ish filters
function cry(out, f0, f1, dur, vol, wobble = 0) {
  const t = ac.currentTime, o = ac.createOscillator(), f = ac.createBiquadFilter(), f2 = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
  if (wobble) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 7; lg.gain.value = wobble; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur); }
  f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 3; f2.type = 'bandpass'; f2.frequency.value = 1300; f2.Q.value = 4;
  g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(vol, t + 0.04); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(f).connect(g); o.connect(f2).connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
function breath(out, dur, vol, freq) {
  const t = ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.5;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(out); src.start(t); src.stop(t + dur);
}
export const audioCtx = () => ctx();
sfx.reverb = cfg => {
  verbWant = cfg;
  if (!ac || !verb) return;
  const t = ac.currentTime;
  if (!cfg) { verbWet.gain.setTargetAtTime(0, t, 0.1); return; }
  const key = cfg.secs + '_' + cfg.damp;
  if (key !== verbKey) { verb.buffer = impulse(cfg.secs, cfg.damp); verbKey = key; }
  verbWet.gain.setTargetAtTime(cfg.wet, t, 0.1);
};
// keep a live source (a player's voice) placed: same panning and falloff as one-shot sounds
sfx.place = (pan, gain, pos, vol = 1) => {
  const dx = pos.x - listener.x, dz = pos.z - listener.z, dist = Math.hypot(dx, dz, pos.y - listener.y);
  const ang = Math.atan2(dx, -dz) + listener.yaw;
  pan.pan.value = Math.max(-1, Math.min(1, Math.sin(ang)));
  gain.gain.value = vol * 1.6 / (1 + dist * 0.3);
};
sfx.setListener = (x, y, z, yaw) => { listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw; };
sfx.loadVoices = () => { if (ac) loadVoices(); };
// type: who's speaking (giants and bosses deeper, runners higher); scale: body size
sfx.voice = (ev, pos, type, scale = 1) => {
  if (!ac || voicesPlaying > 3) return;
  voicesPlaying++; setTimeout(() => voicesPlaying--, 900);
  // everything goes through one gain so the line can be cut off when the speaker says something more important
  const out = ac.createGain(), pitch = (type === 'runner' ? 1.15 : 1) / scale;
  out.connect(spatial(pos));
  const line = { end: ac.currentTime + 1.1, stop() { out.gain.setTargetAtTime(0, ac.currentTime, 0.03); line.end = 0; } };
  const recorded = (VOICE_EVENTS[ev] || []).filter(id => voiceBufs[id]);
  if (recorded.length) {
    const src = ac.createBufferSource();
    src.buffer = voiceBufs[recorded[Math.floor(Math.random() * recorded.length)]];
    src.playbackRate.value = pitch; src.connect(out); src.start();
    line.end = ac.currentTime + src.buffer.duration / pitch;
    return line;
  }
  const p = pitch * (0.9 + Math.random() * 0.2);
  switch (ev) {
    case 'hurt': case 'attack': case 'taunt': case 'grabbed': cry(out, 190 * p, 140 * p, 0.2, 0.35); break;
    case 'hurtBad': case 'stabbed': case 'gutted': cry(out, 260 * p, 380 * p, 0.55, 0.4, 12); break;
    case 'dismember': case 'burn': case 'burning': cry(out, 340 * p, 560 * p, 0.9, 0.45, 25); break;
    case 'die': case 'heart': cry(out, 220 * p, 80 * p, 0.8, 0.35); breath(out, 0.9, 0.15, 500); break;
    case 'burnDie': cry(out, 420 * p, 120 * p, 1.1, 0.4, 20); break;
    case 'choke': for (let i = 0; i < 4; i++) setTimeout(() => breath(out, 0.12, 0.35, 350), i * 140); break;
    case 'passout': breath(out, 1.2, 0.25, 400); break;
    case 'wake': cry(out, 120 * p, 170 * p, 0.6, 0.25); break;
    case 'bomber': cry(out, 240 * p, 300 * p, 0.5, 0.4, 6); break;
    default: cry(out, 200 * p, 160 * p, 0.25, 0.3);
  }
  return line;
};
sfx.now = () => ac ? ac.currentTime : 0;

// ---------------------------------------------------------------- ambience
// birdsong by day in the backyard, crickets at night
let ambTimer = null;
function chirp(base, notes, pan, vol) {
  const t0 = ac.currentTime, p = ac.createStereoPanner(); p.pan.value = pan; p.connect(ac.destination);
  for (let i = 0; i < notes; i++) {
    const t = t0 + i * (0.07 + Math.random() * 0.05), o = ac.createOscillator(), g = ac.createGain();
    const f = base * (0.9 + Math.random() * 0.4);
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.5 : 0.7), t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(p); o.start(t); o.stop(t + 0.08);
  }
}
function cricket(pan) {
  const t0 = ac.currentTime, p = ac.createStereoPanner(); p.pan.value = pan; p.connect(ac.destination);
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.05, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = 4400;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.012, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(p); o.start(t); o.stop(t + 0.04);
  }
}
sfx.ambience = (kind) => {
  clearTimeout(ambTimer); ambTimer = null;
  if (!ac || !kind) return;
  const next = () => {
    if (kind === 'birds') {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) setTimeout(() => chirp(2200 + Math.random() * 2600, 2 + Math.floor(Math.random() * 6), Math.random() * 2 - 1, 0.03 + Math.random() * 0.03), k * 300);
      ambTimer = setTimeout(next, 900 + Math.random() * 2600);
    } else {
      cricket(Math.random() * 2 - 1);
      ambTimer = setTimeout(next, 250 + Math.random() * 700);
    }
  };
  next();
};

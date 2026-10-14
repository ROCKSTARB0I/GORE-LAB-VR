// Synthesised sound effects -- no audio files.
let ac = null, noiseBuf = null;

function ctx() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t); src.stop(t + dur);
}

function tone(type, f0, f1, dur, vol) {
  if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  init() { ctx(); },
  shot(kind) {
    if (kind === 'shotgun') { noise(0.35, 0.9, 2600, 'lowpass', 300); tone('sine', 140, 40, 0.3, 0.9); }
    else if (kind === 'revolver') { noise(0.25, 0.8, 3000, 'lowpass', 400); tone('sine', 170, 45, 0.22, 0.8); }
    else if (kind === 'rifle') { noise(0.12, 0.6, 3800, 'lowpass', 700); tone('square', 190, 70, 0.09, 0.3); }
    else if (kind === 'rocket') { noise(0.7, 0.7, 500, 'bandpass', 2500); tone('sawtooth', 90, 300, 0.5, 0.2); }
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
let musicGain = null, mTimer = null, mCur = -1, mStep = 0, mNext = 0, mVol = 0.5, mMelody = null;

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
  node.connect(g).connect(musicGain);
  o.start(t); o.stop(t + dur + 0.15);
}
function mNoise(t, dur, v, freq, type) {
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf; src.loop = true; src.loopStart = Math.random() * 0.5;
  f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(musicGain);
  src.start(t); src.stop(t + dur + 0.02);
}
function mKick(t, v) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
  o.connect(g).connect(musicGain); o.start(t); o.stop(t + 0.25);
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
  get volume() { return mVol; },
  setVolume(v) { mVol = Math.max(0, Math.min(1, Math.round(v * 10) / 10)); if (musicGain) musicGain.gain.value = mVol * 0.7; },
  play(i) {
    clearInterval(mTimer); mTimer = null; mCur = -1;
    const tr = TRACKS[i];
    if (!tr) return;
    ctx();
    if (!musicGain) { musicGain = ac.createGain(); musicGain.connect(ac.destination); }
    musicGain.gain.value = mVol * 0.7;
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

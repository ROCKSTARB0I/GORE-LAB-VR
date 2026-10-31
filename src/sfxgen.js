// Realistic weapon, impact and body sounds, synthesised sample by sample into
// AudioBuffers. Each sound is built from physical layers: the supersonic crack,
// the muzzle blast, the low "body" of the shot, metal parts moving, the room
// tail and echoes. Several variations of each are made so repeats don't sound
// identical. Buffers are built lazily the first time a sound is asked for, and
// warmed up in the background after the audio starts.

let SR = 44100;

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// RBJ-cookbook biquad, run per sample; cutoff can sweep while it runs
class Biquad {
  constructor(type, f, q = 0.707) { this.type = type; this.q = q; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f); }
  set(f) {
    f = Math.max(20, Math.min(SR * 0.45, f));
    const w = 2 * Math.PI * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * this.q);
    let b0, b1, b2;
    if (this.type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (this.type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }   // band-pass, 0 dB peak
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ---------------------------------------------------------------- layers
// Every layer adds into the sample array d. Times are in seconds.

// filtered noise with an attack / exponential decay envelope; the filter cutoff
// glides from f0 to f1 (time constant ftau). am = rough wet modulation.
function noise(d, r, o) {
  const { at = 0, attack = 0.0005, decay = 0.05, gain = 1, type = 'lp', f0 = 4000, f1 = f0, ftau = decay, q = 0.707, hp = 0, am = 0, amRate = 50, len = decay * 7 } = o;
  const s0 = Math.floor(at * SR), n = Math.min(d.length - s0, Math.floor((len + attack) * SR));
  const f = new Biquad(type, f0, q), h = hp ? new Biquad('hp', hp) : null;
  let amv = 1, amT = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 15) === 0 && f0 !== f1) f.set(f1 + (f0 - f1) * Math.exp(-t / ftau));
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    let x = f.run(r() * 2 - 1);
    if (h) x = h.run(x);
    if (am) { if ((amT -= 1 / SR) <= 0) { amT = (0.5 + r()) / amRate; amv = 1 - am * r(); } x *= amv; }
    d[s0 + i] += x * env * gain;
  }
}

// a pitched thump: sine gliding from f0 down to f1
function tone(d, r, o) {
  const { at = 0, attack = 0.001, decay = 0.05, gain = 1, f0 = 120, f1 = 50, ftau = decay * 0.8, len = decay * 7 } = o;
  const s0 = Math.floor(at * SR), n = Math.min(d.length - s0, Math.floor((len + attack) * SR));
  let ph = r() * 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / SR, fr = f1 + (f0 - f1) * Math.exp(-t / ftau);
    ph += 2 * Math.PI * fr / SR;
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    d[s0 + i] += Math.sin(ph) * env * gain;
  }
}

// metal parts: a few inharmonic ringing modes struck by a click
function metal(d, r, o) {
  const { at = 0, freqs = [2300, 3700, 5100, 6900], decay = 0.015, gain = 0.3 } = o;
  const s0 = Math.floor(at * SR);
  for (const f0 of freqs) {
    const fr = f0 * (0.96 + r() * 0.08), dc = decay * (0.6 + r() * 0.8), n = Math.min(d.length - s0, Math.floor(dc * 7 * SR));
    const g = gain / freqs.length * (0.6 + r() * 0.8), ph = r() * 6.28;
    for (let i = 0; i < n; i++) d[s0 + i] += Math.sin(ph + 2 * Math.PI * fr * i / SR) * Math.exp(-i / SR / dc) * g;
  }
  noise(d, r, { at, decay: 0.0015, gain: gain * 0.8, type: 'hp', f0: 3000 });
}

// supersonic crack: an N-shaped pressure wave a fraction of a millisecond long
function crack(d, r, o) {
  const { at = 0, width = 0.0004, gain = 1 } = o;
  const s0 = Math.floor(at * SR), n = Math.max(3, Math.floor(width * SR));
  for (let i = 0; i < n && s0 + i < d.length; i++) d[s0 + i] += gain * (1 - 2 * i / n);
}

// a plucked string (crossbow), Karplus-Strong
function string(d, r, o) {
  const { at = 0, f = 140, decay = 0.12, gain = 0.5 } = o;
  const p = Math.max(2, Math.round(SR / f)), buf = new Float32Array(p);
  for (let i = 0; i < p; i++) buf[i] = r() * 2 - 1;
  const s0 = Math.floor(at * SR), n = Math.min(d.length - s0, Math.floor(decay * 6 * SR));
  let k = 0;
  for (let i = 0; i < n; i++) {
    const nx = (k + 1) % p, v = buf[k];
    buf[k] = (v + buf[nx]) * 0.5 * 0.998; k = nx;
    d[s0 + i] += v * gain * Math.exp(-i / SR / decay);
  }
}

// late reflections: delayed, darker copies of what is already there
function echoes(d, list) {
  const src = Float32Array.from(d);
  for (const [t, g, lp = 1800] of list) {
    const off = Math.floor(t * SR), f = new Biquad('lp', lp);
    for (let i = 0; i + off < d.length; i++) d[i + off] += f.run(src[i]) * g;
  }
}

// Squash only the loud first instant (real recordings of guns always clip a
// little) and leave the tail alone, remove DC, fade the end and normalise.
// drive 1 = clean; higher pushes more of the bang into the soft limiter.
function finish(d, drive = 1.5, peak = 0.95) {
  const hp = new Biquad('hp', 25);
  let m = 0;
  for (let i = 0; i < d.length; i++) { d[i] = hp.run(d[i]); m = Math.max(m, Math.abs(d[i])); }
  const k = m > 0 ? (0.45 + 0.3 * drive) / m : 1, T = 0.6;
  m = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i] * k, a = Math.abs(x);
    d[i] = a <= T ? x : Math.sign(x) * (T + (1 - T) * Math.tanh((a - T) / (1 - T)));
    m = Math.max(m, Math.abs(d[i]));
  }
  const fade = Math.min(d.length, Math.floor(0.01 * SR));
  for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

// spent brass bouncing on the floor
function casing(d, r, at) {
  for (let b = 0, t = at; b < 3; b++) {
    metal(d, r, { at: t, freqs: [5200, 7800, 9900, 12100], decay: 0.03 / (b + 1), gain: 0.07 / (b + 1) });
    t += 0.06 + r() * 0.08;
  }
}
// slide / pump / bolt friction: a short scrape
function scrape(d, r, at, len, f, gain) { noise(d, r, { at, attack: len * 0.3, decay: len * 0.5, gain, type: 'bp', f0: f, q: 2.2, len }); }

// ---------------------------------------------------------------- recipes
// each returns a filled Float32Array
const RECIPES = {
  pistol: r => {
    const d = new Float32Array(SR * 0.85);
    crack(d, r, { gain: 0.6, width: 0.0003 });
    noise(d, r, { decay: 0.03, gain: 1, f0: 9000, f1: 1300, ftau: 0.012 });
    tone(d, r, { f0: 170, f1: 55, decay: 0.05, gain: 0.8 });
    noise(d, r, { at: 0.004, decay: 0.11, gain: 0.25, f0: 2200, f1: 400 });
    metal(d, r, { at: 0.012, decay: 0.012, gain: 0.25 });
    metal(d, r, { at: 0.045 + r() * 0.01, freqs: [1900, 3100, 4600], decay: 0.01, gain: 0.2 });
    noise(d, r, { at: 0.02, attack: 0.01, decay: 0.3, gain: 0.1, f0: 1300, f1: 300 });
    echoes(d, [[0.085, 0.18], [0.2, 0.08, 1200]]);
    casing(d, r, 0.42 + r() * 0.2);
    return finish(d, 2.2);
  },
  revolver: r => {
    const d = new Float32Array(SR * 1.1);
    crack(d, r, { gain: 0.8, width: 0.00035 });
    noise(d, r, { decay: 0.05, gain: 1.1, f0: 8000, f1: 900, ftau: 0.018 });
    tone(d, r, { f0: 140, f1: 42, decay: 0.09, gain: 1 });
    noise(d, r, { at: 0.005, decay: 0.18, gain: 0.3, f0: 1800, f1: 300 });
    noise(d, r, { at: 0.025, attack: 0.015, decay: 0.55, gain: 0.16, f0: 1100, f1: 250 });
    echoes(d, [[0.1, 0.22], [0.26, 0.1, 1000]]);
    metal(d, r, { at: 0.55 + r() * 0.05, freqs: [2600, 4100, 5800], decay: 0.008, gain: 0.12 });   // hammer back
    return finish(d, 2.6);
  },
  smg: r => {
    const d = new Float32Array(SR * 0.4);
    crack(d, r, { gain: 0.5, width: 0.0003 });
    noise(d, r, { decay: 0.022, gain: 1, f0: 9500, f1: 1600, ftau: 0.01 });
    tone(d, r, { f0: 200, f1: 70, decay: 0.035, gain: 0.7 });
    metal(d, r, { at: 0.008, freqs: [2500, 3900, 5600], decay: 0.008, gain: 0.25 });
    noise(d, r, { at: 0.015, attack: 0.008, decay: 0.16, gain: 0.08, f0: 1400, f1: 350 });
    echoes(d, [[0.07, 0.12]]);
    return finish(d, 2);
  },
  rifle: r => {
    const d = new Float32Array(SR * 0.9);
    crack(d, r, { gain: 1, width: 0.00025 });
    noise(d, r, { decay: 0.035, gain: 1, f0: 12000, f1: 1500, ftau: 0.01 });
    tone(d, r, { f0: 150, f1: 48, decay: 0.06, gain: 0.75 });
    noise(d, r, { at: 0.006, decay: 0.12, gain: 0.3, f0: 2600, f1: 450 });
    metal(d, r, { at: 0.01, freqs: [2100, 3300, 4700, 6400], decay: 0.01, gain: 0.25 });
    noise(d, r, { at: 0.02, attack: 0.01, decay: 0.45, gain: 0.15, f0: 2000, f1: 380 });
    echoes(d, [[0.09, 0.2], [0.23, 0.1, 1100]]);
    if (r() < 0.6) casing(d, r, 0.45 + r() * 0.2);
    return finish(d, 2.5);
  },
  shotgun: r => {
    const d = new Float32Array(SR * 1.05);
    crack(d, r, { gain: 0.6, width: 0.0005 });
    noise(d, r, { decay: 0.07, gain: 1.2, f0: 6500, f1: 500, ftau: 0.02 });
    tone(d, r, { f0: 100, f1: 33, decay: 0.14, gain: 1.1 });
    noise(d, r, { at: 0.004, decay: 0.25, gain: 0.4, f0: 450, f1: 150 });
    noise(d, r, { at: 0.03, attack: 0.02, decay: 0.7, gain: 0.18, f0: 1000, f1: 200 });
    echoes(d, [[0.11, 0.25], [0.28, 0.12, 900]]);
    // pump: slide back, then forward and lock
    const p = 0.42 + r() * 0.04;
    scrape(d, r, p, 0.06, 1700, 0.3); metal(d, r, { at: p + 0.055, freqs: [1400, 2600, 3900], decay: 0.012, gain: 0.35 });
    scrape(d, r, p + 0.14, 0.05, 1500, 0.28); metal(d, r, { at: p + 0.19, freqs: [900, 1700, 2600, 4100], decay: 0.02, gain: 0.45 });
    return finish(d, 3);
  },
  sniper: r => {
    const d = new Float32Array(SR * 1.5);
    crack(d, r, { gain: 1.2, width: 0.0002 });
    noise(d, r, { decay: 0.06, gain: 1.2, f0: 14000, f1: 900, ftau: 0.015 });
    tone(d, r, { f0: 95, f1: 28, decay: 0.2, gain: 1.2 });
    noise(d, r, { at: 0.006, decay: 0.3, gain: 0.35, f0: 1500, f1: 200 });
    noise(d, r, { at: 0.03, attack: 0.03, decay: 1.1, gain: 0.22, f0: 1500, f1: 200 });
    echoes(d, [[0.25, 0.25, 1200], [0.6, 0.12, 800]]);
    // bolt: lift, back, forward, lock
    const b = 0.78 + r() * 0.05;
    metal(d, r, { at: b, freqs: [2200, 3500], decay: 0.008, gain: 0.2 });
    scrape(d, r, b + 0.06, 0.07, 2100, 0.22); metal(d, r, { at: b + 0.13, freqs: [1800, 2900, 4300], decay: 0.012, gain: 0.3 });
    scrape(d, r, b + 0.24, 0.06, 1900, 0.2); metal(d, r, { at: b + 0.31, freqs: [1200, 2100, 3600], decay: 0.015, gain: 0.35 });
    return finish(d, 3);
  },
  minigun: r => {
    const d = new Float32Array(SR * 0.14);
    crack(d, r, { gain: 0.5, width: 0.0003 });
    noise(d, r, { decay: 0.014, gain: 0.9, f0: 9000, f1: 1600, ftau: 0.008 });
    tone(d, r, { f0: 230, f1: 95, decay: 0.02, gain: 0.6 });
    noise(d, r, { at: 0.01, attack: 0.005, decay: 0.04, gain: 0.08, f0: 1500 });
    return finish(d, 2);
  },
  launcher: r => {
    const d = new Float32Array(SR * 0.7);
    noise(d, r, { decay: 0.05, gain: 0.7, f0: 1600, f1: 300 });
    tone(d, r, { f0: 125, f1: 55, decay: 0.1, gain: 1 });
    metal(d, r, { at: 0.002, freqs: [380, 1150, 2100, 3300], decay: 0.12, gain: 0.18 });
    noise(d, r, { at: 0.01, attack: 0.01, decay: 0.2, gain: 0.1, f0: 900, f1: 200 });
    return finish(d, 1.8);
  },
  rocket: r => {
    const d = new Float32Array(SR * 1.3);
    crack(d, r, { gain: 0.3 });
    noise(d, r, { attack: 0.01, decay: 0.45, gain: 0.8, type: 'bp', q: 0.8, f0: 600, f1: 2600, ftau: 0.2 });
    tone(d, r, { f0: 75, f1: 38, decay: 0.3, gain: 0.8 });
    noise(d, r, { attack: 0.02, decay: 0.6, gain: 0.3, type: 'hp', f0: 3200 });
    noise(d, r, { at: 0.02, attack: 0.03, decay: 0.5, gain: 0.25, f0: 500, f1: 150 });
    return finish(d, 2.4);
  },
  crossbow: r => {
    const d = new Float32Array(SR * 0.5);
    string(d, r, { f: 130 + r() * 30, decay: 0.09, gain: 0.6 });
    noise(d, r, { decay: 0.025, gain: 0.7, type: 'bp', q: 1.2, f0: 520 });
    tone(d, r, { f0: 180, f1: 90, decay: 0.03, gain: 0.4 });
    noise(d, r, { at: 0.003, decay: 0.04, gain: 0.15, type: 'hp', f0: 4000 });
    return finish(d, 1.6);
  },
  explosion: r => {
    const d = new Float32Array(SR * 2.4);
    crack(d, r, { gain: 1, width: 0.0008 });
    noise(d, r, { decay: 0.3, gain: 1.3, f0: 5000, f1: 140, ftau: 0.07 });
    tone(d, r, { f0: 60, f1: 22, decay: 0.6, gain: 1.4 });
    noise(d, r, { at: 0.02, attack: 0.03, decay: 1.2, gain: 0.55, f0: 260, f1: 90 });
    for (let i = 0; i < 26; i++) noise(d, r, { at: 0.12 + r() * 1.3, decay: 0.006 + r() * 0.01, gain: 0.05 + r() * 0.12, type: 'hp', f0: 1500 + r() * 2500 });   // debris
    echoes(d, [[0.3, 0.2, 600], [0.75, 0.1, 400]]);
    return finish(d, 3);
  },

  // ---- impacts
  flesh: r => {   // a bullet going into a body
    const d = new Float32Array(SR * 0.3);
    tone(d, r, { f0: 115, f1: 55, decay: 0.03, gain: 0.8 });
    noise(d, r, { decay: 0.028, gain: 0.8, f0: 1600, f1: 400 });
    noise(d, r, { at: 0.004, decay: 0.07, gain: 0.45, type: 'bp', q: 1.4, f0: 900 + r() * 400, am: 0.8, amRate: 70 });
    return finish(d, 1.5, 0.8);
  },
  wall: r => {     // concrete / plaster
    const d = new Float32Array(SR * 0.25);
    crack(d, r, { gain: 0.6, width: 0.00015 });
    noise(d, r, { decay: 0.011, gain: 0.9, type: 'bp', q: 1, f0: 2500 + r() * 800 });
    noise(d, r, { decay: 0.06, gain: 0.35, f0: 3200, f1: 600 });
    tone(d, r, { f0: 320, f1: 150, decay: 0.014, gain: 0.25 });
    return finish(d, 1.6, 0.7);
  },
  ricochet: r => {
    const d = new Float32Array(SR * 0.6);
    crack(d, r, { gain: 0.5, width: 0.00015 });
    noise(d, r, { decay: 0.01, gain: 0.8, type: 'bp', f0: 2800 });
    // the whine of the deformed bullet tumbling away
    const f0 = 3600 + r() * 1500, f1 = 1300 + r() * 500, n = Math.floor(0.42 * SR), s0 = Math.floor(0.008 * SR);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, fr = f0 + (f1 - f0) * t + Math.sin(i / SR * 2 * Math.PI * 23) * 120;
      ph += 2 * Math.PI * fr / SR;
      d[s0 + i] += Math.sin(ph) * 0.22 * Math.sin(Math.PI * Math.min(1, t * 6)) * (1 - t);
    }
    return finish(d, 1.3, 0.6);
  },
  metalHit: r => { // a round off a barrel, helmet or vest plate
    const d = new Float32Array(SR * 0.9);
    crack(d, r, { gain: 0.5, width: 0.0002 });
    metal(d, r, { freqs: [520, 1360, 2410, 3700, 5600], decay: 0.25, gain: 0.7 });
    noise(d, r, { decay: 0.02, gain: 0.4, type: 'bp', f0: 3000 });
    return finish(d, 1.4, 0.65);
  },
  punchBody: r => {
    const d = new Float32Array(SR * 0.3);
    tone(d, r, { f0: 90, f1: 45, decay: 0.07, gain: 1 });
    noise(d, r, { decay: 0.04, gain: 0.6, f0: 700, f1: 200 });
    noise(d, r, { decay: 0.03, gain: 0.14, type: 'hp', f0: 2500 });   // clothing
    return finish(d, 2, 0.9);
  },
  punchFace: r => {
    const d = new Float32Array(SR * 0.25);
    noise(d, r, { decay: 0.005, gain: 1, type: 'hp', f0: 1300 });    // skin smack
    noise(d, r, { decay: 0.02, gain: 0.5, type: 'bp', q: 1, f0: 1700 + r() * 500 });
    tone(d, r, { f0: 150, f1: 70, decay: 0.035, gain: 0.75 });
    return finish(d, 2, 0.9);
  },
  punchCrunch: r => { // a hard one: cartilage and bone giving way
    const d = new Float32Array(SR * 0.35);
    noise(d, r, { decay: 0.006, gain: 1, type: 'hp', f0: 1200 });
    tone(d, r, { f0: 130, f1: 55, decay: 0.07, gain: 1 });
    noise(d, r, { decay: 0.05, gain: 0.5, f0: 900, f1: 250 });
    for (let i = 0; i < 5; i++) noise(d, r, { at: 0.004 + r() * 0.03, decay: 0.002, gain: 0.35 + r() * 0.3, type: 'bp', q: 2, f0: 2500 + r() * 2000 });
    return finish(d, 2.4, 0.95);
  },
  bash: r => {     // bat, sledge or axe-back into a body
    const d = new Float32Array(SR * 0.35);
    noise(d, r, { decay: 0.05, gain: 0.6, type: 'bp', q: 6, f0: 650 + r() * 150 });   // the wood knocks
    noise(d, r, { decay: 0.03, gain: 0.3, type: 'bp', q: 5, f0: 1300 + r() * 200 });
    tone(d, r, { f0: 95, f1: 42, decay: 0.08, gain: 1 });
    noise(d, r, { decay: 0.05, gain: 0.5, f0: 800, f1: 220 });
    return finish(d, 2.2, 0.95);
  },
  cut: r => {      // a blade opening flesh
    const d = new Float32Array(SR * 0.35);
    noise(d, r, { decay: 0.05, gain: 0.6, type: 'bp', q: 1.2, f0: 3800, f1: 1200, ftau: 0.03 });
    noise(d, r, { at: 0.01, decay: 0.1, gain: 0.55, f0: 1500, f1: 400, am: 0.85, amRate: 60 });
    tone(d, r, { f0: 160, f1: 80, decay: 0.03, gain: 0.35 });
    return finish(d, 1.6, 0.85);
  },
  stab: r => {
    const d = new Float32Array(SR * 0.4);
    noise(d, r, { attack: 0.01, decay: 0.15, gain: 0.7, f0: 900, f1: 300, am: 0.8, amRate: 45 });
    tone(d, r, { f0: 125, f1: 60, decay: 0.06, gain: 0.55 });
    noise(d, r, { at: 0.02, decay: 0.09, gain: 0.35, type: 'bp', q: 2, f0: 620, f1: 300 });
    return finish(d, 1.6, 0.85);
  },
  squish: r => {
    const d = new Float32Array(SR * 0.35);
    noise(d, r, { attack: 0.005, decay: 0.13, gain: 0.8, f0: 1300, f1: 300, am: 0.9, amRate: 40 + r() * 30 });
    tone(d, r, { f0: 140, f1: 60, decay: 0.05, gain: 0.3 });
    return finish(d, 1.5, 0.8);
  },
  splat: r => {
    const d = new Float32Array(SR * 0.7);
    noise(d, r, { decay: 0.22, gain: 1, f0: 2200, f1: 220, am: 0.7, amRate: 35 });
    tone(d, r, { f0: 95, f1: 40, decay: 0.14, gain: 0.6 });
    for (let i = 0; i < 4; i++) noise(d, r, { at: 0.2 + r() * 0.4, decay: 0.012, gain: 0.08 + r() * 0.08, type: 'bp', q: 3, f0: 1200 + r() * 900 });   // drips
    return finish(d, 1.8, 0.95);
  },
  bodyfall: r => {
    const d = new Float32Array(SR * 0.45);
    tone(d, r, { f0: 72, f1: 36, decay: 0.12, gain: 1 });
    noise(d, r, { decay: 0.09, gain: 0.7, f0: 420, f1: 120 });
    noise(d, r, { decay: 0.05, gain: 0.12, type: 'hp', f0: 2000 });
    tone(d, r, { at: 0.08 + r() * 0.04, f0: 80, f1: 45, decay: 0.05, gain: 0.3 });
    return finish(d, 2, 0.9);
  },
  hurt: r => {     // the player taking a hit
    const d = new Float32Array(SR * 0.3);
    tone(d, r, { f0: 85, f1: 40, decay: 0.09, gain: 1 });
    noise(d, r, { decay: 0.05, gain: 0.6, f0: 900, f1: 200 });
    return finish(d, 2.2, 0.9);
  },
};
// swings: light (knife), medium (machete, katana), heavy (bat, axe, sledge)
for (const [name, T, fc, g] of [['swingLight', 0.17, 2600, 0.5], ['swingMedium', 0.24, 1600, 0.55], ['swingHeavy', 0.33, 850, 0.6]]) {
  RECIPES[name] = r => {
    const d = new Float32Array(Math.floor(SR * (T + 0.05)));
    const f = new Biquad('bp', fc, 1.3), n = Math.floor(T * SR), c = fc * (0.85 + r() * 0.3);
    for (let i = 0; i < n; i++) {
      const t = i / n, s = Math.sin(Math.PI * t);
      if ((i & 15) === 0) f.set(c * (0.55 + 0.9 * s));
      d[i] += f.run(r() * 2 - 1) * s * s * g;
    }
    return finish(d, 1.2, 0.6);
  };
}

// ---------------------------------------------------------------- loops
// seamless: the end is cross-faded into the start
function looped(d, xf) {
  const n = d.length - xf, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = d[i];
  for (let i = 0; i < xf; i++) { const k = i / xf; out[i] = d[i] * k + d[n + i] * (1 - k); }
  return out;
}
const LOOPS = {
  // two-stroke engine at idle: one rough combustion pulse per revolution
  sawEngine: r => {
    const f = 46, cycles = 46, n = Math.floor(SR * cycles / f), d = new Float32Array(n);
    const lp = new Biquad('lp', 1900, 1.2);
    let ph = 0;
    for (let c = 0; c < cycles; c++) {
      const s0 = Math.floor(c * SR / f), amp = 0.75 + r() * 0.5, len = Math.floor(SR / f);
      for (let i = 0; i < len && s0 + i < n; i++) {
        const t = i / SR, e = Math.exp(-t / 0.0045) * amp;
        ph += 2 * Math.PI * 92 / SR;
        d[s0 + i] += (r() * 2 - 1) * e * 0.9 + Math.sin(ph) * e * 0.7 + ((ph / Math.PI) % 2 - 1) * 0.08;
      }
    }
    for (let i = 0; i < n; i++) d[i] = lp.run(d[i]);
    return finish(d, 3.2, 0.9);
  },
  // the chain biting into meat and bone
  sawGrind: r => {
    const d = new Float32Array(SR * 1.05);
    noise(d, r, { attack: 0.02, decay: 100, gain: 1, type: 'bp', q: 0.9, f0: 1400, am: 0.9, amRate: 38, len: 1.05 });
    noise(d, r, { attack: 0.02, decay: 100, gain: 0.5, f0: 380, am: 0.7, amRate: 22, len: 1.05 });
    return finish(looped(d, Math.floor(SR * 0.05)), 2.5, 0.9);
  },
  // gas roar with crackles
  flame: r => {
    const d = new Float32Array(SR * 2.1);
    noise(d, r, { attack: 0.01, decay: 100, gain: 1, f0: 800, len: 2.1 });
    noise(d, r, { attack: 0.01, decay: 100, gain: 0.8, f0: 160, len: 2.1 });
    for (let i = 0; i < 60; i++) noise(d, r, { at: r() * 2, decay: 0.004 + r() * 0.006, gain: 0.3 + r() * 0.5, type: 'hp', f0: 1800 + r() * 3000 });
    const ph = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] *= 0.75 + 0.15 * Math.sin(t * 2 * Math.PI * 1 + ph[0]) + 0.1 * Math.sin(t * 2 * Math.PI * 3.5 + ph[1]); }
    return finish(looped(d, Math.floor(SR * 0.1)), 1.8, 0.9);
  },
};

const VARIANTS = { minigun: 4, flesh: 5, wall: 5, punchBody: 4, punchFace: 4, punchCrunch: 3, bash: 4, cut: 4, stab: 3, squish: 4, splat: 3, bodyfall: 4 };
const cache = {};
// all variations of one sound as AudioBuffers (built on first use)
export function buffers(ac, name) {
  if (cache[name]) return cache[name];
  SR = ac.sampleRate;
  const recipe = RECIPES[name] || LOOPS[name];
  if (!recipe) return null;
  const n = LOOPS[name] ? 1 : VARIANTS[name] ?? 3, list = [];
  for (let v = 0; v < n; v++) {
    const data = recipe(rng(name.length * 977 + v * 7919 + name.charCodeAt(0)));
    const b = ac.createBuffer(1, data.length, SR); b.copyToChannel(data, 0); list.push(b);
  }
  return cache[name] = list;
}
// build everything a little at a time so the first shot doesn't stutter
export function warm(ac) {
  const names = [...Object.keys(LOOPS), ...Object.keys(RECIPES)];
  const next = () => { const n = names.shift(); if (!n) return; buffers(ac, n); setTimeout(next, 15); };
  setTimeout(next, 50);
}

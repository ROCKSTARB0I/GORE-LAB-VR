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
    else if (kind === 'smg') { noise(0.09, 0.45, 4200, 'lowpass', 900); tone('square', 260, 90, 0.07, 0.25); }
    else { noise(0.14, 0.6, 3600, 'lowpass', 600); tone('sine', 200, 60, 0.12, 0.6); }
  },
  squish() { noise(0.16, 0.5, 900, 'lowpass', 180); tone('sine', 180, 70, 0.1, 0.25); },
  splat() { noise(0.3, 0.6, 700, 'lowpass', 120); tone('sine', 120, 45, 0.2, 0.4); },
  thud() { tone('sine', 110, 45, 0.14, 0.7); noise(0.06, 0.3, 500); },
  slice() { noise(0.14, 0.4, 5000, 'bandpass', 1200); noise(0.2, 0.4, 800, 'lowpass', 150); },
  boom() { noise(0.9, 1.0, 1800, 'lowpass', 60); tone('sine', 90, 25, 0.8, 1.0); },
  beep() { tone('square', 660, 880, 0.08, 0.15); },
};

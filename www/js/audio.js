// Sky Highway — WebAudio synth. No audio assets; everything is generated.
// The context is created lazily on the first user gesture (autoplay policy).

let ctx = null;
let master = null;
let musicGain = null;
let musicTimer = null;
let enabled = true;

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.5 : 0;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.16;
    musicGain.connect(master);
  } catch { ctx = null; }
}

export function setEnabled(v) {
  enabled = v;
  if (master) master.gain.value = v ? 0.5 : 0;
}

function env(node, t0, attack, decay, peak = 1) {
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.linearRampToValueAtTime(peak, t0 + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function tone({ type = 'sine', from = 440, to = from, dur = 0.15, attack = 0.005, peak = 0.6, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  env(g, t0, attack, dur, peak);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + attack + dur + 0.05);
}

function noise({ dur = 0.3, filterFrom = 3000, filterTo = 200, peak = 0.7, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(filterFrom, t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
  const g = ctx.createGain();
  env(g, t0, 0.005, dur, peak);
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

export const sfx = {
  click() { tone({ type: 'square', from: 660, dur: 0.04, peak: 0.25 }); },
  jump() { tone({ type: 'square', from: 220, to: 440, dur: 0.12, peak: 0.35 }); },
  land() { tone({ type: 'triangle', from: 110, to: 70, dur: 0.08, peak: 0.4 }); },
  coin() {
    tone({ type: 'sine', from: 880, dur: 0.06, peak: 0.35 });
    tone({ type: 'sine', from: 1320, dur: 0.09, peak: 0.35, delay: 0.055 });
  },
  ammo() {
    tone({ type: 'square', from: 520, dur: 0.05, peak: 0.3 });
    tone({ type: 'square', from: 780, dur: 0.08, peak: 0.3, delay: 0.05 });
  },
  shoot() { tone({ type: 'sawtooth', from: 900, to: 240, dur: 0.12, peak: 0.35 }); },
  explode() { noise({ dur: 0.35, filterFrom: 2400, filterTo: 120, peak: 0.7 }); },
  crash() {
    noise({ dur: 0.45, filterFrom: 3200, filterTo: 90, peak: 0.9 });
    tone({ type: 'sawtooth', from: 200, to: 40, dur: 0.4, peak: 0.5 });
  },
  boost() { tone({ type: 'sawtooth', from: 200, to: 900, dur: 0.3, peak: 0.4 }); },
  pad() { tone({ type: 'sine', from: 330, to: 660, dur: 0.2, peak: 0.45 }); },
  slowmo() { tone({ type: 'sine', from: 700, to: 180, dur: 0.5, peak: 0.4 }); },
  flowUp(tier = 2) {
    // rising two-note blip, pitched by flow tier
    const base = 300 + tier * 110;
    tone({ type: 'square', from: base, dur: 0.06, peak: 0.3 });
    tone({ type: 'square', from: base * 1.5, dur: 0.09, peak: 0.3, delay: 0.06 });
  },
  rewind() {
    for (let i = 0; i < 3; i++) tone({ type: 'square', from: 300 + i * 180, to: 600 + i * 180, dur: 0.08, peak: 0.3, delay: i * 0.09 });
  },
  win() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone({ type: 'square', from: f, dur: 0.14, peak: 0.35, delay: i * 0.12 }));
  },
  lose() {
    const notes = [392, 330, 262];
    notes.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.2, peak: 0.35, delay: i * 0.15 }));
  },
};

// ---------------------------------------------------------------------------
// Music — a simple 2-bar synthwave loop scheduled with a lookahead timer.
// ---------------------------------------------------------------------------
const BPM = 112;
const BEAT = 60 / BPM;
// bassline (semitones relative to A1 = 55Hz), one note per 8th
const BASS = [0, 0, 12, 0, 3, 3, 15, 3, 5, 5, 17, 5, 3, 3, 15, 3];
const CHORDS = [[0, 3, 7], [3, 7, 10], [5, 8, 12], [3, 7, 10]]; // per bar-half

let nextNoteTime = 0;
let step = 0;

function scheduleMusic() {
  if (!ctx || !musicGain) return;
  while (nextNoteTime < ctx.currentTime + 0.25) {
    const t0 = nextNoteTime;
    const s = step % 16;
    // bass
    {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 55 * Math.pow(2, BASS[s] / 12);
      env(g, t0, 0.01, BEAT * 0.4, 0.5);
      osc.connect(g); g.connect(musicGain);
      osc.start(t0); osc.stop(t0 + BEAT * 0.5);
    }
    // pad chord on beat 1 of each half-bar
    if (s % 4 === 0) {
      const chord = CHORDS[Math.floor(s / 4)];
      for (const semi of chord) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = 220 * Math.pow(2, semi / 12);
        env(g, t0, 0.06, BEAT * 1.8, 0.12);
        osc.connect(g); g.connect(musicGain);
        osc.start(t0); osc.stop(t0 + BEAT * 2);
      }
    }
    nextNoteTime += BEAT / 2;
    step++;
  }
}

export function setMusic(on) {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (on && ctx) {
    nextNoteTime = ctx.currentTime + 0.05;
    step = 0;
    musicTimer = setInterval(scheduleMusic, 100);
  }
}

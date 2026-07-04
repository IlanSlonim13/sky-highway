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
  cometWarn() {
    // two-tone incoming alarm
    tone({ type: 'square', from: 980, to: 740, dur: 0.09, peak: 0.22 });
    tone({ type: 'square', from: 980, to: 740, dur: 0.09, peak: 0.22, delay: 0.14 });
  },
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
// Music — an 8-bit chiptune sequencer with two songs:
//   'level' — "Hyperlane": 152 BPM driving square lead, pumping bass,
//             16th-note arps, noise drums. Thrilling.
//   'menu'  — "Docking Bay": mellow triangle arps over soft chords.
// Patterns are 16-step bars; MIDI note numbers, 0 = rest.
// ---------------------------------------------------------------------------
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const SONGS = {
  level: {
    bpm: 152,
    bars: 4,
    // per bar: 8 eighth-note bass hits (root pump with octave kicks)
    bass: [
      [45, 45, 57, 45, 45, 57, 45, 57],   // Am
      [41, 41, 53, 41, 41, 53, 41, 53],   // F
      [48, 48, 60, 48, 48, 60, 48, 60],   // C
      [43, 43, 55, 43, 43, 55, 43, 55],   // G
    ],
    bassType: 'square', bassGain: 0.30,
    // per bar: 8 eighth-note lead melody notes
    lead: [
      [69, 72, 76, 81, 79, 76, 72, 76],
      [65, 69, 72, 77, 76, 72, 69, 72],
      [67, 72, 76, 79, 84, 79, 76, 72],
      [74, 71, 67, 71, 74, 79, 77, 74],
    ],
    leadType: 'square', leadGain: 0.16,
    // per bar: chord tones for the 16th-note arp (played +1 octave)
    arp: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
    arpType: 'square', arpGain: 0.055,
    drums: { kick: [0, 8, 10], snare: [4, 12], hatEvery: 2 },
  },
  menu: {
    bpm: 100,
    bars: 4,
    bass: [
      [45, 0, 45, 0, 45, 0, 45, 0],
      [41, 0, 41, 0, 41, 0, 41, 0],
      [48, 0, 48, 0, 48, 0, 48, 0],
      [43, 0, 43, 0, 43, 0, 43, 0],
    ],
    bassType: 'triangle', bassGain: 0.30,
    lead: [
      [69, 0, 72, 0, 76, 0, 72, 0],
      [69, 0, 72, 0, 77, 0, 72, 0],
      [67, 0, 72, 0, 76, 0, 72, 0],
      [67, 0, 71, 0, 74, 0, 71, 0],
    ],
    leadType: 'triangle', leadGain: 0.14,
    arp: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
    arpType: 'triangle', arpGain: 0.04,
    drums: { kick: [0], snare: [], hatEvery: 4 },
  },
};

let songName = 'menu';
let nextNoteTime = 0;
let step = 0;

function chipNote(type, midi, t0, dur, peak) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = midiHz(midi);
  env(g, t0, 0.008, dur, peak);
  osc.connect(g); g.connect(musicGain);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function chipNoise(t0, dur, filterHz, peak) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = filterHz;
  const g = ctx.createGain();
  env(g, t0, 0.003, dur, peak);
  src.connect(filt); filt.connect(g); g.connect(musicGain);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

function scheduleMusic() {
  if (!ctx || !musicGain) return;
  const song = SONGS[songName];
  const step16 = 60 / song.bpm / 4;
  while (nextNoteTime < ctx.currentTime + 0.3) {
    const t0 = nextNoteTime;
    const s = step % 16;                              // 16th within the bar
    const bar = Math.floor(step / 16) % song.bars;

    if (s % 2 === 0) { // eighth-note grid
      const e = s / 2;
      const b = song.bass[bar][e];
      if (b) chipNote(song.bassType, b, t0, step16 * 1.6, song.bassGain);
      const l = song.lead[bar][e];
      if (l) chipNote(song.leadType, l, t0, step16 * 1.7, song.leadGain);
    }
    // 16th-note arpeggio, one octave up, up-down pattern
    const chord = song.arp[bar];
    const arpNote = chord[[0, 1, 2, 1][s % 4]] + 12;
    chipNote(song.arpType, arpNote, t0, step16 * 0.9, song.arpGain);

    // drums
    const d = song.drums;
    if (d.kick.includes(s)) chipNote('sine', 41, t0, 0.09, 0.5); // thump
    if (d.snare.includes(s)) chipNoise(t0, 0.09, 1800, 0.30);
    if (s % d.hatEvery === 0) chipNoise(t0, 0.03, 6000, 0.10);

    nextNoteTime += step16;
    step++;
  }
}

export function setMusic(on, mode) {
  if (mode && mode !== songName) { songName = mode; step = 0; }
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (on && ctx) {
    nextNoteTime = ctx.currentTime + 0.05;
    step = 0;
    musicTimer = setInterval(scheduleMusic, 100);
  }
}

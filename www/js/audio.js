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
//   'level' — "Hyperlane Odyssey": a full 60-bar arrangement (~91 s at
//             158 BPM before it repeats) — intro, two verses, chorus,
//             bridge, verse reprise, final chorus, breakdown. Authored as
//             sections and expanded into flat per-bar arrays at load time.
//   'menu'  — "Docking Bay": mellow triangle arps over soft chords.
// Patterns are 16-step bars; MIDI note numbers, 0 = rest.
// ---------------------------------------------------------------------------
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chord bank: bass root (octave 2) + mid-register triad for the arp
const CHORDS = {
  Am: { root: 45, arp: [57, 60, 64] },
  F:  { root: 41, arp: [53, 57, 60] },
  C:  { root: 48, arp: [60, 64, 67] },
  G:  { root: 43, arp: [55, 59, 62] },
  Dm: { root: 38, arp: [50, 53, 57] },
  E:  { root: 40, arp: [52, 56, 59] },
};

// bass figure generators (8 eighth-notes from a chord root)
const BASS_STYLES = {
  pump:   (r) => [r, r, r + 12, r, r, r + 12, r, r + 12],
  drive:  (r) => [r, r + 12, r, r + 12, r, r + 12, r, r + 12],
  half:   (r) => [r, 0, r + 7, 0, r, 0, r + 7, 0],
  sparse: (r) => [r, 0, 0, 0, r + 12, 0, 0, 0],
};

const DRUM_KITS = {
  quiet:  { kick: [0], snare: [], hatEvery: 4 },
  verse:  { kick: [0, 8, 10], snare: [4, 12], hatEvery: 2 },
  chorus: { kick: [0, 6, 8, 10], snare: [4, 12], hatEvery: 2 },
  bridge: { kick: [0, 8], snare: [4, 12], hatEvery: 2 },
};

// --- "Hyperlane Odyssey" sections (A minor) --------------------------------
const INTRO = {
  chords: ['Am', 'Am', 'F', 'G'], bass: 'sparse', drums: 'quiet', arp: 'half',
  lead: [
    [0, 0, 0, 0, 69, 0, 72, 0],
    [76, 0, 72, 0, 69, 0, 72, 0],
    [77, 0, 72, 0, 69, 0, 72, 0],
    [79, 0, 74, 0, 71, 0, 74, 0],
  ],
};
const VERSE1 = {
  chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E'], bass: 'pump', drums: 'verse',
  lead: [
    [69, 0, 72, 74, 76, 74, 72, 69],
    [69, 72, 77, 76, 72, 69, 65, 69],
    [67, 72, 76, 72, 79, 76, 72, 67],
    [74, 71, 67, 71, 74, 76, 74, 71],
    [69, 0, 72, 74, 76, 79, 81, 79],
    [77, 76, 72, 77, 76, 72, 69, 72],
    [76, 72, 67, 72, 76, 79, 84, 79],
    [76, 75, 71, 68, 64, 68, 71, 75],
  ],
};
const VERSE2 = {
  chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E'], bass: 'pump', drums: 'verse', arp: 'roll',
  lead: [
    [81, 79, 76, 79, 81, 84, 81, 79],
    [77, 81, 84, 81, 77, 72, 77, 81],
    [79, 76, 72, 76, 79, 84, 88, 84],
    [83, 79, 74, 79, 83, 86, 83, 79],
    [81, 0, 81, 84, 88, 84, 81, 76],
    [84, 81, 77, 81, 84, 77, 72, 77],
    [84, 79, 76, 79, 84, 88, 84, 79],
    [80, 76, 71, 76, 80, 83, 88, 83],
  ],
};
const CHORUS = {
  chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'E'], bass: 'drive', drums: 'chorus', arp: 'sparkle', harmony: true,
  lead: [
    [84, 0, 79, 0, 76, 79, 84, 0],
    [83, 0, 79, 0, 74, 79, 83, 0],
    [81, 0, 76, 0, 72, 76, 81, 0],
    [81, 84, 81, 77, 72, 77, 81, 84],
    [88, 0, 84, 0, 79, 84, 88, 0],
    [86, 0, 83, 0, 79, 83, 86, 0],
    [84, 81, 79, 76, 72, 76, 79, 81],
    [76, 0, 80, 0, 83, 0, 88, 0],
  ],
};
const BRIDGE = {
  chords: ['Dm', 'Am', 'Dm', 'E', 'F', 'C', 'G', 'E'], bass: 'half', drums: 'bridge',
  lead: [
    [74, 0, 77, 74, 69, 74, 77, 0],
    [76, 0, 72, 76, 69, 72, 76, 0],
    [74, 77, 81, 77, 74, 69, 65, 69],
    [68, 71, 76, 71, 68, 64, 68, 71],
    [72, 77, 76, 72, 69, 72, 77, 81],
    [79, 76, 72, 76, 79, 84, 79, 76],
    [74, 79, 83, 79, 74, 71, 67, 71],
    [64, 68, 71, 76, 80, 83, 88, 0],
  ],
};
const BREAKDOWN = {
  chords: ['Am', 'F', 'Am', 'E', 'Am', 'F', 'G', 'E'], bass: 'sparse', drums: 'quiet', arp: 'half',
  lead: [
    [69, 0, 0, 0, 64, 0, 0, 0],
    [65, 0, 0, 0, 69, 0, 0, 0],
    [69, 0, 0, 0, 72, 0, 0, 0],
    [68, 0, 0, 0, 71, 0, 0, 0],
    [69, 0, 72, 0, 76, 0, 0, 0],
    [77, 0, 76, 0, 72, 0, 0, 0],
    [79, 0, 76, 0, 74, 0, 0, 0],
    [76, 0, 79, 0, 83, 0, 88, 0],
  ],
};

// expand a section list into flat per-bar bass/lead/arp/drum arrays
function expandSections(sections) {
  const bass = [], lead = [], arp = [], drums = [], meta = [];
  for (const sec of sections) {
    sec.chords.forEach((name, i) => {
      const c = CHORDS[name];
      bass.push(BASS_STYLES[sec.bass](c.root));
      lead.push(sec.lead[i]);
      arp.push(c.arp);
      drums.push(DRUM_KITS[sec.drums]);
      meta.push({
        arp: sec.arp || 'updown',
        harmony: !!sec.harmony,
        fill: i === sec.chords.length - 1, // snare roll into the next section
      });
    });
  }
  return { bass, lead, arp, drums, meta, bars: bass.length };
}

// exported for the node test harness (bar-shape assertions)
export const SONGS = {
  level: {
    bpm: 158,
    bassType: 'square', bassGain: 0.30,
    leadType: 'square', leadGain: 0.16,
    arpType: 'square', arpGain: 0.055,
    // 4 + 8*7 = 60 bars ≈ 91 s at base tempo before the song repeats
    ...expandSections([INTRO, VERSE1, VERSE2, CHORUS, BRIDGE, VERSE1, CHORUS, BREAKDOWN]),
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
    drums: [
      { kick: [0], snare: [], hatEvery: 4 },
      { kick: [0], snare: [], hatEvery: 4 },
      { kick: [0], snare: [], hatEvery: 4 },
      { kick: [0], snare: [], hatEvery: 4 },
    ],
  },
};

let songName = 'menu';
let nextNoteTime = 0;
let step = 0;
let rateMult = 1; // tempo follows the ship: faster flight = faster music

export function setMusicRate(m) {
  rateMult = Math.max(0.7, Math.min(1.6, m));
}

function chipNote(type, midi, t0, dur, peak) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = midiHz(midi);
  if (dur > 0.2) {
    // sustained note: gentle chip vibrato after a short delay
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = midiHz(midi) * 0.009;
    lfo.connect(depth); depth.connect(osc.frequency);
    lfo.start(t0 + 0.09); lfo.stop(t0 + dur + 0.05);
  }
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

const DEFAULT_META = { arp: 'updown', harmony: false, fill: false };

function scheduleMusic() {
  if (!ctx || !musicGain) return;
  const song = SONGS[songName];
  const step16 = 60 / (song.bpm * rateMult) / 4;
  while (nextNoteTime < ctx.currentTime + 0.3) {
    const t0 = nextNoteTime;
    const s = step % 16;                              // 16th within the bar
    const bar = Math.floor(step / 16) % song.bars;
    const meta = song.meta ? song.meta[bar] : DEFAULT_META;

    if (s % 2 === 0) { // eighth-note grid
      const e = s / 2;
      const b = song.bass[bar][e];
      if (b) chipNote(song.bassType, b, t0, step16 * 1.6, song.bassGain);
      const l = song.lead[bar][e];
      if (l) {
        // a note followed by a rest sustains through it (vibrato kicks in)
        const sustained = e < 7 && song.lead[bar][e + 1] === 0;
        const dur = sustained ? step16 * 3.6 : step16 * 1.7;
        chipNote(song.leadType, l, t0, dur, song.leadGain);
        if (songName === 'level') {
          // arcade sparkle: quiet octave doubling on the lead
          chipNote(song.leadType, l + 12, t0, dur * 0.8, song.leadGain * 0.35);
          // chip delay: the note repeats an eighth later, quietly
          chipNote(song.leadType, l, t0 + step16 * 2, step16 * 1.2, song.leadGain * 0.22);
          // chorus bars get a parallel harmony a fourth below (power-chord feel)
          if (meta.harmony) chipNote('triangle', l - 5, t0, dur, song.leadGain * 0.5);
        }
      }
    }
    // arpeggio, one octave up — pattern varies by section
    const chord = song.arp[bar];
    let arpNote = null;
    if (meta.arp === 'half') { // airy: eighth-notes only
      if (s % 2 === 0) arpNote = chord[[0, 1, 2, 1][(s / 2) % 4]] + 12;
    } else if (meta.arp === 'roll') { // 3-against-4 shimmer
      arpNote = chord[s % 3] + 12;
    } else if (meta.arp === 'sparkle') { // 16ths leaping between octaves
      arpNote = chord[[0, 1, 2, 1][s % 4]] + (s % 2 === 0 ? 12 : 24);
    } else { // 'updown'
      arpNote = chord[[0, 1, 2, 1][s % 4]] + 12;
    }
    if (arpNote !== null) chipNote(song.arpType, arpNote, t0, step16 * 0.9, song.arpGain);

    // drums (per-bar kits — sections vary from sparse intro to driving chorus)
    const d = song.drums[bar];
    if (meta.fill && s >= 12) {
      // section turnaround: rising 16th snare roll into the next section
      chipNoise(t0, 0.07, 1600, 0.14 + (s - 12) * 0.05);
    } else {
      if (d.kick.includes(s)) chipNote('sine', 41, t0, 0.09, 0.5); // thump
      if (d.snare.includes(s)) chipNoise(t0, 0.09, 1800, 0.30);
      if (s % d.hatEvery === 0) chipNoise(t0, 0.03, 6000, 0.10);
    }

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

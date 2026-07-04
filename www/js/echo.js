// Sky Highway — Echo Ghosts: record every run, replay it as a translucent
// ship racing beside the player. DOM-free (node-testable).
//
// Packing: 3 bytes per sample at ECHO.hz —
//   byte 0: x * 20   (int8, lanes -6.35..6.35)
//   byte 1: y * 40   (int8, -3.15..3.15)
//   byte 2: dz * 100 (uint8; max speed ~20 tiles/s at 15Hz -> dz ~1.34 -> 134)
// ~2.7 KB per minute of run, base64-encoded into the save.

import { ECHO } from './config.js';
import { save } from './save.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function packSamples(samples) {
  const bytes = new Uint8Array(samples.length * 3);
  let prevZ = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    bytes[i * 3] = Math.round(clamp(s.x, -6.35, 6.35) * 20) & 0xff;
    bytes[i * 3 + 1] = Math.round(clamp(s.y, -3.15, 3.15) * 40) & 0xff;
    bytes[i * 3 + 2] = clamp(Math.round((s.z - prevZ) * 100), 0, 255);
    prevZ = s.z;
  }
  return bytesToB64(bytes);
}

export function unpackSamples(b64) {
  const bytes = b64ToBytes(b64);
  const n = Math.floor(bytes.length / 3);
  const out = new Array(n);
  let z = 0;
  for (let i = 0; i < n; i++) {
    const xi = bytes[i * 3] << 24 >> 24;       // sign-extend int8
    const yi = bytes[i * 3 + 1] << 24 >> 24;
    z += bytes[i * 3 + 2] / 100;
    out[i] = { x: xi / 20, y: yi / 40, z };
  }
  return out;
}

// ---------------------------------------------------------------------------
export class EchoRecorder {
  constructor() {
    this.samples = [];
    this._acc = 1; // force an immediate first sample
  }
  feed(dtGame, ship) {
    this._acc += dtGame;
    const interval = 1 / ECHO.hz;
    if (this._acc >= interval) {
      this._acc -= interval;
      this.samples.push({ x: ship.x, y: ship.y, z: ship.z });
    }
  }
  // rewind-revive rewrites history: drop samples past the restored position
  truncateAfterZ(z) {
    while (this.samples.length && this.samples[this.samples.length - 1].z > z) this.samples.pop();
  }
  finish() {
    return {
      hz: ECHO.hz,
      dur: this.samples.length / ECHO.hz,
      data: packSamples(this.samples),
    };
  }
}

export class EchoPlayer {
  constructor(record) {
    this.hz = record.hz || ECHO.hz;
    this.dur = record.dur;
    this.samples = unpackSamples(record.data);
    this.finished = this.samples.length === 0;
  }
  // position at echo-clock t (seconds); returns null once the echo is done
  positionAt(t) {
    const n = this.samples.length;
    if (n === 0) return null;
    const f = t * this.hz;
    if (f >= n - 1) { this.finished = true; return null; }
    const i = Math.max(0, Math.floor(f));
    const k = f - i;
    const a = this.samples[i], b = this.samples[Math.min(n - 1, i + 1)];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, bank: 0 };
  }
}

// ---------------------------------------------------------------------------
// Persistence — best echo per mode key ('c<levelIndex>', 'd<dayKey>', 'endless')
// ---------------------------------------------------------------------------
export function echoKey(level) {
  if (level.endless) return `e${level.seed}`; // endless tracks rotate daily by seed
  if (level.daily) return `d${level.dayKey}`;
  return `c${level.index}`;
}

export function loadBestEcho(level) {
  const rec = save.getEcho(echoKey(level));
  return rec ? new EchoPlayer(rec) : null;
}

// store if better: campaign/daily = faster completion; endless = farther
export function storeBestEcho(level, record, { completed, distance = 0 }) {
  const key = echoKey(level);
  const prev = save.getEcho(key);
  let better;
  if (level.endless) better = !prev || distance > (prev.meta?.distance || 0);
  else better = completed && (!prev || record.dur < prev.dur);
  if (better) {
    save.putEcho(key, { ...record, meta: { distance: Math.round(distance) } }, ECHO.maxStored);
    return true;
  }
  return false;
}

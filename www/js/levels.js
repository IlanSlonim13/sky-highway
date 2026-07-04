// Sky Highway — level definitions.
//
// A level is { name, speed, theme, rows } where rows is an array of 7-char
// strings (lane -3 .. lane +3), row 0 being the start line. Cell characters
// are defined in config.js (CELL).
//
// Levels 1-10 are handcrafted with the builder DSL below. Levels 11-100 are
// produced by a deterministic seeded generator that carves a guaranteed
// playable path first and decorates around it; every level additionally
// passes the reachability solver in `validateLevel` (see tools/validate-levels.mjs).

import { CELL, TRACK_LANES, PHYSICS } from './config.js';

export const LEVEL_COUNT = 100;

// ---------------------------------------------------------------------------
// Themes — neon palettes cycled across the campaign.
// ---------------------------------------------------------------------------
export const THEMES = [
  { name: 'Neon Dawn',   skyTop: '#050014', skyBot: '#2b0a4e', floor: '#7a2ff0', floorAlt: '#5a1fd0', block: '#ff3d9a', blockDark: '#a91f62', glow: '#c86bff', star: '#b9a0ff' },
  { name: 'Cyan Rush',   skyTop: '#00050f', skyBot: '#003a52', floor: '#00c2d1', floorAlt: '#0092a1', block: '#ffb300', blockDark: '#a97400', glow: '#5ff2ff', star: '#a0e8ff' },
  { name: 'Ember Belt',  skyTop: '#0f0202', skyBot: '#4e1200', floor: '#ff6a00', floorAlt: '#c94f00', block: '#ffd000', blockDark: '#a98800', glow: '#ff9d5c', star: '#ffc9a0' },
  { name: 'Viridia',     skyTop: '#01100a', skyBot: '#0a4e2b', floor: '#12d97c', floorAlt: '#0aa95c', block: '#e8ff3d', blockDark: '#96a91f', glow: '#6bffb8', star: '#a0ffcf' },
  { name: 'Magenta Void',skyTop: '#0d0014', skyBot: '#3a0a4e', floor: '#e02fd0', floorAlt: '#a81f9c', block: '#3d9aff', blockDark: '#1f62a9', glow: '#ff6bf2', star: '#f2a0ff' },
  { name: 'Arctic Line', skyTop: '#02060f', skyBot: '#0a2a4e', floor: '#4d8dff', floorAlt: '#2f63c9', block: '#ff5c7a', blockDark: '#a93248', glow: '#8ab8ff', star: '#cfe0ff' },
  { name: 'Solar Wind',  skyTop: '#0f0a00', skyBot: '#4e3a0a', floor: '#ffcf3d', floorAlt: '#c99e1f', block: '#ff3d5c', blockDark: '#a91f38', glow: '#ffe08a', star: '#fff0c0' },
  { name: 'Deep Signal', skyTop: '#00000a', skyBot: '#101a52', floor: '#5c6bff', floorAlt: '#3a45c9', block: '#00e0b0', blockDark: '#009a78', glow: '#9aa5ff', star: '#c0c8ff' },
  { name: 'Rose Orbit',  skyTop: '#10000a', skyBot: '#520a2e', floor: '#ff4d88', floorAlt: '#c92f63', block: '#b06bff', blockDark: '#7038a9', glow: '#ff8ab0', star: '#ffc0d8' },
  { name: 'Chrome City', skyTop: '#050508', skyBot: '#2e3038', floor: '#c0c8d8', floorAlt: '#8a92a4', block: '#5ff2ff', blockDark: '#3a9aa4', glow: '#e8f0ff', star: '#ffffff' },
];

// ---------------------------------------------------------------------------
// Builder DSL — rows are built as arrays of 7 chars then joined.
// Lane arguments use -3..+3; row helpers return arrays of row strings.
// ---------------------------------------------------------------------------
const L = 3; // lane offset: lane -3 -> index 0

function emptyRow() { return CELL.EMPTY.repeat(TRACK_LANES).split(''); }
function fullRow(ch = CELL.FLOOR) { return ch.repeat(TRACK_LANES).split(''); }

class Builder {
  constructor() { this.rows = []; }

  // n rows of full floor
  straight(n) {
    for (let i = 0; i < n; i++) this.rows.push(fullRow());
    return this;
  }

  // n rows where only lanes [from..to] have floor
  bridge(n, from, to, ch = CELL.FLOOR) {
    for (let i = 0; i < n; i++) {
      const r = emptyRow();
      for (let l = from; l <= to; l++) r[l + L] = ch;
      this.rows.push(r);
    }
    return this;
  }

  // n rows of full-width gap
  gap(n) {
    for (let i = 0; i < n; i++) this.rows.push(emptyRow());
    return this;
  }

  // full floor rows with specific cells overridden: over = [[lane, ch], ...]
  floorWith(n, over) {
    for (let i = 0; i < n; i++) {
      const r = fullRow();
      for (const [l, ch] of over) r[l + L] = ch;
      this.rows.push(r);
    }
    return this;
  }

  // raw rows as 7-char strings (nearest first)
  raw(strings) {
    for (const s of strings) {
      if (s.length !== TRACK_LANES) throw new Error(`bad row: "${s}"`);
      this.rows.push(s.split(''));
    }
    return this;
  }

  // a single full row with a coin at each given lane
  coins(lanes) {
    const r = fullRow();
    for (const l of lanes) r[l + L] = CELL.COIN;
    this.rows.push(r);
    return this;
  }

  build() { return this.rows.map((r) => r.join('')); }
}

function b() { return new Builder(); }

// ---------------------------------------------------------------------------
// Handcrafted levels 1-10.
// Speeds ramp 6.5 -> 9.2; each level introduces one mechanic.
// ---------------------------------------------------------------------------

function level1() {
  // Tutorial: steering and simple gaps.
  return b()
    .straight(10)
    .coins([0]).coins([0]).coins([0])
    .straight(4)
    .gap(2)
    .straight(6)
    .coins([-1, 1])
    .straight(3)
    .gap(2)
    .straight(5)
    .bridge(6, -3, 0)      // right half missing — steer left
    .straight(5)
    .coins([-2, 0, 2])
    .bridge(6, 0, 3)       // left half missing — steer right
    .straight(4)
    .gap(2)
    .straight(4)
    .coins([0]).coins([0])
    .straight(6)
    .build();
}

function level2() {
  // Introduce low blocks (jump over) and boost pads.
  return b()
    .straight(8)
    .floorWith(1, [[0, CELL.LOW]])
    .straight(5)
    .floorWith(1, [[-1, CELL.LOW], [0, CELL.LOW], [1, CELL.LOW]])
    .straight(5)
    .coins([0])
    .gap(2)
    .straight(4)
    .floorWith(1, [[0, CELL.BOOST]])
    .straight(6)
    .floorWith(1, [[-2, CELL.LOW], [-1, CELL.LOW], [0, CELL.LOW], [1, CELL.LOW], [2, CELL.LOW]])
    .straight(5)
    .coins([-1, 0, 1])
    .bridge(5, -1, 3)
    .floorWith(1, [[1, CELL.LOW], [2, CELL.LOW]])
    .straight(4)
    .gap(3)
    .straight(5)
    .coins([0]).coins([0])
    .straight(6)
    .build();
}

function level3() {
  // Tall blocks — weave, don't jump.
  return b()
    .straight(8)
    .floorWith(2, [[-1, CELL.TALL]])
    .straight(3)
    .floorWith(2, [[1, CELL.TALL]])
    .straight(3)
    .floorWith(2, [[0, CELL.TALL], [-3, CELL.TALL], [3, CELL.TALL]])
    .straight(4)
    .coins([-2, 2])
    .gap(2)
    .straight(4)
    .floorWith(2, [[-2, CELL.TALL], [2, CELL.TALL]])
    .floorWith(2, [[0, CELL.TALL]])
    .straight(4)
    .bridge(6, -3, 1)
    .floorWith(2, [[-1, CELL.TALL]])
    .straight(3)
    .coins([0])
    .floorWith(2, [[-3, CELL.TALL], [-2, CELL.TALL], [1, CELL.TALL], [2, CELL.TALL], [3, CELL.TALL]])
    .straight(5)
    .gap(2)
    .straight(6)
    .build();
}

function level4() {
  // Hazard tiles.
  return b()
    .straight(8)
    .floorWith(2, [[0, CELL.HAZARD]])
    .straight(4)
    .floorWith(2, [[-3, CELL.HAZARD], [-2, CELL.HAZARD], [-1, CELL.HAZARD]])
    .straight(4)
    .floorWith(2, [[1, CELL.HAZARD], [2, CELL.HAZARD], [3, CELL.HAZARD]])
    .straight(4)
    .coins([0])
    .gap(2)
    .straight(3)
    // hazard corridor: only center lane safe
    .floorWith(4, [[-3, CELL.HAZARD], [-2, CELL.HAZARD], [-1, CELL.HAZARD], [1, CELL.HAZARD], [2, CELL.HAZARD], [3, CELL.HAZARD]])
    .straight(4)
    .coins([-1, 1])
    .floorWith(1, [[0, CELL.LOW]])
    .straight(3)
    .floorWith(3, [[-1, CELL.HAZARD], [0, CELL.HAZARD], [1, CELL.HAZARD]]) // jumpable hazard strip? steer around
    .straight(4)
    .gap(3)
    .straight(4)
    .coins([0]).coins([0])
    .straight(6)
    .build();
}

function level5() {
  // Bounce pads over big gaps + first ammo/destructible wall.
  return b()
    .straight(8)
    .floorWith(1, [[-1, CELL.AMMO], [1, CELL.AMMO]])
    .straight(3)
    .raw(['DDDDD##'])      // blast through or swerve right
    .straight(4)
    .floorWith(1, [[0, CELL.PAD]])
    .gap(4)
    .straight(5)
    .coins([0])
    .floorWith(1, [[-1, CELL.PAD], [0, CELL.PAD], [1, CELL.PAD]])
    .gap(5)
    .straight(5)
    .bridge(4, -2, 2)
    .floorWith(1, [[0, CELL.BOOST]])
    .straight(4)
    .gap(3)
    .straight(4)
    .coins([-1, 0, 1])
    .floorWith(1, [[0, CELL.PAD]])
    .gap(5)
    .straight(5)
    .floorWith(2, [[-2, CELL.TALL], [2, CELL.TALL]])
    .straight(4)
    .gap(2)
    .straight(6)
    .build();
}

function level6() {
  // Narrow bridges under pressure.
  return b()
    .straight(8)
    .bridge(6, -1, 1)
    .straight(3)
    .bridge(8, 0, 0)          // single-lane center bridge
    .straight(4)
    .coins([0])
    .bridge(5, -3, -2)        // far-left bridge
    .straight(9)              // room to cross the whole track
    .bridge(5, 2, 3)          // far-right bridge
    .straight(4)
    .gap(2)
    .bridge(6, -1, 1)
    .floorWith(1, [[0, CELL.LOW]])
    .bridge(4, -1, 1)
    .straight(4)
    .coins([-1, 1])
    .bridge(8, 1, 1)          // single lane, off-center
    .straight(5)
    .gap(3)
    .straight(6)
    .build();
}

function level7() {
  // Mixed: gaps + low blocks chained.
  return b()
    .straight(8)
    .floorWith(1, [[-1, CELL.LOW], [0, CELL.LOW], [1, CELL.LOW]])
    .straight(3)
    .gap(3)
    .straight(3)
    .floorWith(1, [[0, CELL.LOW], [1, CELL.LOW], [2, CELL.LOW], [3, CELL.LOW]])
    .straight(3)
    .coins([0])
    .floorWith(1, [[0, CELL.AMMO]])
    .straight(3)
    .raw(['##DDDDD'])      // wall with the left side open
    .straight(3)
    .gap(3)
    .bridge(5, -2, 2)
    .floorWith(1, [[-2, CELL.LOW], [-1, CELL.LOW], [0, CELL.LOW]])
    .bridge(4, -2, 2)
    .straight(3)
    .floorWith(1, [[0, CELL.BOOST]])
    .gap(4)
    .straight(4)
    .coins([-2, 0, 2])
    .floorWith(1, [[-3, CELL.LOW], [-2, CELL.LOW], [-1, CELL.LOW], [0, CELL.LOW], [1, CELL.LOW]])
    .straight(3)
    .gap(3)
    .straight(6)
    .build();
}

function level8() {
  // Hazard weave + tall block maze.
  return b()
    .straight(8)
    .floorWith(3, [[-3, CELL.HAZARD], [-2, CELL.HAZARD], [2, CELL.HAZARD], [3, CELL.HAZARD]])
    .floorWith(2, [[-1, CELL.TALL], [1, CELL.TALL]])
    .straight(3)
    .floorWith(2, [[0, CELL.TALL], [-2, CELL.TALL], [2, CELL.TALL]])
    .straight(3)
    .coins([-1, 1])
    .gap(2)
    .bridge(6, -1, 2)
    .floorWith(2, [[0, CELL.TALL]])
    .bridge(3, -1, 2)
    .straight(3)
    .floorWith(4, [[-3, CELL.HAZARD], [-1, CELL.HAZARD], [1, CELL.HAZARD], [3, CELL.HAZARD]])
    .straight(3)
    .coins([0])
    .floorWith(1, [[-1, CELL.AMMO]])
    .straight(2)
    .floorWith(1, [[0, CELL.DESTRUCTIBLE], [-1, CELL.DESTRUCTIBLE], [1, CELL.DESTRUCTIBLE]])
    .straight(3)
    .floorWith(1, [[-2, CELL.LOW], [-1, CELL.LOW], [0, CELL.LOW], [1, CELL.LOW], [2, CELL.LOW]])
    .straight(3)
    .gap(3)
    .straight(3)
    .floorWith(2, [[-2, CELL.TALL], [0, CELL.TALL], [2, CELL.TALL]])
    .straight(5)
    .coins([0]).coins([0])
    .straight(6)
    .build();
}

function level9() {
  // Speed level: boosts everywhere, generous but fast.
  return b()
    .straight(8)
    .floorWith(1, [[0, CELL.BOOST]])
    .straight(5)
    .gap(3)
    .straight(4)
    .floorWith(1, [[-1, CELL.BOOST], [1, CELL.BOOST]])
    .straight(4)
    .gap(4)
    .straight(4)
    .coins([0])
    .floorWith(1, [[0, CELL.BOOST]])
    .bridge(6, -1, 1)
    .straight(3)
    .gap(3)
    .straight(3)
    .floorWith(1, [[0, CELL.LOW]])
    .straight(3)
    .floorWith(1, [[0, CELL.BOOST]])
    .gap(4)
    .straight(4)
    .coins([-1, 0, 1])
    .gap(2)
    .bridge(4, 0, 2)
    .straight(4)
    .gap(2)
    .straight(6)
    .build();
}

function level10() {
  // Graduation exam: everything combined.
  return b()
    .straight(8)
    .floorWith(2, [[-1, CELL.TALL], [1, CELL.TALL]])
    .straight(3)
    .gap(3)
    .bridge(5, -1, 1)
    .floorWith(1, [[0, CELL.LOW]])
    .bridge(3, -1, 1)
    .straight(3)
    .coins([0])
    .floorWith(3, [[-3, CELL.HAZARD], [-2, CELL.HAZARD], [-1, CELL.HAZARD], [1, CELL.HAZARD], [2, CELL.HAZARD], [3, CELL.HAZARD]])
    .straight(3)
    .floorWith(1, [[0, CELL.PAD]])
    .gap(5)
    .straight(4)
    .coins([-1, 1])
    .floorWith(1, [[0, CELL.AMMO]])
    .straight(3)
    .raw(['DDD#DDD'])      // wall with only the center open
    .straight(3)
    .bridge(6, 1, 3)
    .floorWith(2, [[2, CELL.TALL]])
    .bridge(3, 1, 3)
    .straight(3)
    .gap(3)
    .straight(3)
    .floorWith(1, [[-2, CELL.LOW], [-1, CELL.LOW], [0, CELL.LOW], [1, CELL.LOW], [2, CELL.LOW]])
    .straight(3)
    .floorWith(1, [[0, CELL.BOOST]])
    .gap(4)
    .straight(4)
    .coins([0]).coins([0])
    .straight(8)
    .build();
}

const HANDCRAFTED = [level1, level2, level3, level4, level5, level6, level7, level8, level9, level10];

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — deterministic generation per level index.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Level speed / jump reach model — shared by game, generator and solver.
// ---------------------------------------------------------------------------
export function levelSpeed(index) {
  // index is 0-based. 6.5 tiles/s at level 1 -> capped 12.5.
  return Math.min(12.5, 6.5 + index * 0.062);
}

// Max full-width gap (in rows) that a normal jump can clear at given speed,
// with a safety margin so generated levels are strictly easier than physics allows.
export function maxJumpGap(speed) {
  const airtime = (2 * PHYSICS.jumpVelocity) / PHYSICS.gravity; // ~0.667s
  return Math.max(2, Math.floor(speed * airtime) - 1);
}

// ---------------------------------------------------------------------------
// Generator for levels 11-100.
//
// Strategy: walk a "path lane" down the track. For each chunk pick a pattern
// and emit rows such that the path lane is always survivable with simple
// moves (steer <=1 lane per 2 rows on the ground; gaps <= maxJumpGap; low
// blocks always have >=2 rows of runway and >=2 rows of landing).
// Decoration (side floor, towers, hazards, coins) never touches the path.
// ---------------------------------------------------------------------------
function generateLevel(index) {
  const rng = mulberry32(0xA11CE + index * 7919);
  const speed = levelSpeed(index);
  const jump = maxJumpGap(speed);
  const difficulty = Math.min(1, (index - 9) / 90); // 0 at lvl 10, 1 at lvl 100
  const targetRows = Math.round(200 + 260 * difficulty); // 200 -> 460 rows

  const rows = [];
  let path = 0; // current guaranteed-safe lane
  const LANE_MIN_ = -3, LANE_MAX_ = 3;

  const pushRow = (cells) => rows.push(cells);

  // Probability that a non-path cell has floor at all (thins out with difficulty)
  const sideFloorP = 0.9 - 0.35 * difficulty;

  function decoratedRow(safeLanes, opts = {}) {
    // safeLanes: Set of lanes that must be plain floor (or given char)
    const r = emptyRow();
    for (let lane = LANE_MIN_; lane <= LANE_MAX_; lane++) {
      const i = lane + L;
      if (safeLanes.has(lane)) { r[i] = opts.pathChar || CELL.FLOOR; continue; }
      if (rng() < sideFloorP) {
        const roll = rng();
        if (roll < 0.06 * difficulty + 0.02) r[i] = CELL.TALL;
        else if (roll < 0.12 * difficulty + 0.05) r[i] = CELL.LOW;
        else if (roll < 0.16 * difficulty + 0.06) r[i] = CELL.HAZARD;
        else r[i] = CELL.FLOOR;
      }
    }
    return r;
  }

  function safeSet(center, width) {
    const s = new Set();
    const half = Math.floor(width / 2);
    let from = center - half, to = center + (width - 1 - half);
    if (from < LANE_MIN_) { to += LANE_MIN_ - from; from = LANE_MIN_; }
    if (to > LANE_MAX_) { from -= to - LANE_MAX_; to = LANE_MAX_; }
    for (let l = from; l <= to; l++) s.add(l);
    return s;
  }

  // --- pattern emitters ------------------------------------------------
  function patStraight(n) {
    for (let i = 0; i < n; i++) {
      const r = decoratedRow(safeSet(path, 3));
      if (i === 1 && rng() < 0.22) r[path + L] = CELL.AMMO;
      pushRow(r);
    }
  }

  function patMeander(n) {
    let placed = 0;
    while (placed < n) {
      const dir = path <= LANE_MIN_ + 1 ? 1 : path >= LANE_MAX_ - 1 ? -1 : (rng() < 0.5 ? -1 : 1);
      // 2 rows at current lane, then shift (<=1 lane per 2 rows keeps it easy)
      pushRow(decoratedRow(safeSet(path, 3)));
      pushRow(decoratedRow(safeSet(path, 3)));
      path = Math.max(LANE_MIN_, Math.min(LANE_MAX_, path + dir));
      placed += 2;
    }
  }

  function patGap() {
    const g = 2 + Math.floor(rng() * Math.max(1, jump - 1)); // 2..jump
    const gap = Math.min(g, jump);
    // runway
    for (let i = 0; i < 3; i++) pushRow(decoratedRow(safeSet(path, 3)));
    // the gap: nothing anywhere (occasional floating coin arc over it)
    const coinArc = rng() < 0.5;
    for (let i = 0; i < gap; i++) {
      const r = emptyRow();
      if (coinArc) r[path + L] = CELL.COIN_AIR;
      pushRow(r);
    }
    // landing
    for (let i = 0; i < 3; i++) pushRow(decoratedRow(safeSet(path, 3)));
  }

  function patNarrowBridge() {
    const len = 4 + Math.floor(rng() * (5 + 6 * difficulty));
    const width = rng() < 0.3 + 0.4 * difficulty ? 1 : 2;
    for (let i = 0; i < len; i++) {
      const s = safeSet(path, width);
      const r = emptyRow();
      for (const l of s) r[l + L] = CELL.FLOOR;
      if (i === Math.floor(len / 2)) r[path + L] = CELL.COIN;
      pushRow(r);
    }
    for (let i = 0; i < 2; i++) pushRow(decoratedRow(safeSet(path, 3)));
  }

  function patLowBlockJump() {
    // runway, 1 row of low blocks across the safe zone, landing
    for (let i = 0; i < 3; i++) pushRow(decoratedRow(safeSet(path, 3)));
    const r = decoratedRow(safeSet(path, 3), { pathChar: CELL.LOW });
    pushRow(r);
    for (let i = 0; i < 3; i++) pushRow(decoratedRow(safeSet(path, 3)));
  }

  function patSlalom() {
    // tall blocks alternate on either side of the path; path stays clear
    const n = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const side = k % 2 === 0 ? 1 : -1;
      const blockLane = Math.max(LANE_MIN_, Math.min(LANE_MAX_, path + side));
      for (let i = 0; i < 2; i++) {
        const r = decoratedRow(safeSet(path, 3));
        if (blockLane !== path) r[blockLane + L] = CELL.TALL;
        pushRow(r);
      }
      pushRow(decoratedRow(safeSet(path, 3)));
    }
  }

  function patHazardCorridor() {
    const len = 3 + Math.floor(rng() * (3 + 4 * difficulty));
    for (let i = 0; i < len; i++) {
      const r = fullRow(CELL.HAZARD);
      for (const l of safeSet(path, 2)) r[l + L] = CELL.FLOOR;
      pushRow(r);
    }
    for (let i = 0; i < 2; i++) pushRow(decoratedRow(safeSet(path, 3)));
  }

  function patBoost() {
    const r = decoratedRow(safeSet(path, 3));
    r[path + L] = CELL.BOOST;
    pushRow(r);
    // boosted: generous straight after
    for (let i = 0; i < 8; i++) pushRow(decoratedRow(safeSet(path, 3)));
  }

  function patBouncePad() {
    // pad, big gap (cleared by pad's high jump), landing
    const r = decoratedRow(safeSet(path, 3));
    r[path + L] = CELL.PAD;
    pushRow(r);
    const gap = Math.min(jump + 2, 4 + Math.floor(rng() * 3));
    for (let i = 0; i < gap; i++) {
      const g = emptyRow();
      if (i % 2 === 0) g[path + L] = CELL.COIN_AIR;
      pushRow(g);
    }
    for (let i = 0; i < 4; i++) pushRow(decoratedRow(safeSet(path, 3)));
  }

  function patDestructibleWall() {
    // ammo on the path, then a barrier wall with a 2-lane open corridor at
    // one edge; the guaranteed path meanders into the corridor first, so the
    // wall is always avoidable without firing a shot.
    const r0 = decoratedRow(safeSet(path, 3));
    r0[path + L] = CELL.AMMO;
    pushRow(r0);
    const side = rng() < 0.5 ? -1 : 1;
    const target = side < 0 ? LANE_MIN_ + 1 : LANE_MAX_ - 1; // inner corridor lane
    while (path !== target) {
      pushRow(decoratedRow(safeSet(path, 3)));
      pushRow(decoratedRow(safeSet(path, 3)));
      path += Math.sign(target - path);
    }
    for (let i = 0; i < 2; i++) pushRow(decoratedRow(safeSet(path, 3)));
    // the wall: destructible everywhere except the 2-lane edge corridor
    const wall = fullRow(CELL.DESTRUCTIBLE);
    const open1 = side < 0 ? LANE_MIN_ : LANE_MAX_;
    const open2 = target;
    wall[open1 + L] = CELL.FLOOR;
    wall[open2 + L] = CELL.FLOOR;
    pushRow(wall);
    for (let i = 0; i < 3; i++) pushRow(decoratedRow(safeSet(path, 3)));
  }

  function patCoinRun() {
    for (let i = 0; i < 5; i++) {
      const r = decoratedRow(safeSet(path, 3));
      r[path + L] = CELL.COIN;
      pushRow(r);
    }
  }

  // weighted pattern table; harder patterns gain weight with difficulty
  const patterns = [
    [patStraight.bind(null, 6), 1.0],
    [patMeander.bind(null, 8), 1.2],
    [patGap, 1.0 + difficulty],
    [patNarrowBridge, 0.6 + difficulty],
    [patLowBlockJump, 0.8 + difficulty * 0.7],
    [patSlalom, 0.7 + difficulty * 0.8],
    [patHazardCorridor, 0.4 + difficulty],
    [patBoost, 0.5],
    [patBouncePad, 0.5 + difficulty * 0.4],
    [patDestructibleWall, 0.5 + difficulty * 0.6],
    [patCoinRun, 0.7],
  ];
  const totalW = patterns.reduce((s, [, w]) => s + w, 0);

  // opening: full floor
  for (let i = 0; i < 8; i++) pushRow(fullRow());

  while (rows.length < targetRows) {
    let roll = rng() * totalW;
    for (const [fn, w] of patterns) {
      roll -= w;
      if (roll <= 0) { fn(); break; }
    }
  }

  // closing: full floor
  for (let i = 0; i < 6; i++) pushRow(fullRow());

  return rows.map((r) => (Array.isArray(r) ? r.join('') : r));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
const cache = new Map();

export function getLevel(index) {
  // index: 0-based
  if (cache.has(index)) return cache.get(index);
  const rows = index < 10 ? HANDCRAFTED[index]() : generateLevel(index);
  const level = {
    index,
    name: `Level ${index + 1}`,
    speed: levelSpeed(index),
    theme: THEMES[index % THEMES.length],
    rows,
    length: rows.length,
  };
  cache.set(index, level);
  return level;
}

// ---------------------------------------------------------------------------
// Solver / validator — coarse BFS proving a level is completable.
//
// State: (row, lane, airRows) where airRows > 0 means we're mid-jump and land
// after airRows more rows. Movement model (deliberately weaker than the real
// physics, so "solvable here" implies "solvable in game"):
//   - on ground: may stay or move +-1 lane every 2 rows (tracked via parity)
//   - jump from ground: becomes airborne for `jumpRows` rows, may drift +-1
//     lane total during the whole jump
//   - landing cell must be floor-like; tall blocks kill unless jumped from
//     afar (we simply never allow entering a TALL cell); hazard kills on
//     ground contact; low blocks kill on ground contact but are cleared while
//     airborne; empty cells kill on ground contact.
// ---------------------------------------------------------------------------
export function validateLevel(level) {
  const { rows, speed } = level;
  const jumpRows = Math.max(2, maxJumpGap(speed)); // rows spent airborne
  const n = rows.length;
  // Boost pads raise speed 1.55x for 1.6s (~15+ rows in game); model it as a
  // conservative 12-row counter that lengthens jumps by 2 rows while active.
  const BOOST_ROWS = 12;
  const maxAir = jumpRows + 4;

  const groundOK = (ch) => ch === CELL.FLOOR || ch === CELL.BOOST || ch === CELL.PAD || ch === CELL.COIN || ch === CELL.AMMO;
  // destructibles count as walls here: levels must be completable with zero shots
  const airOK = (ch) => ch !== CELL.TALL && ch !== CELL.DESTRUCTIBLE;

  const seen = new Set();
  const key = (row, lane, air, par, boost) =>
    (((row * 7 + (lane + 3)) * (maxAir + 1) + air) * 2 + par) * (BOOST_ROWS + 1) + boost;

  const queue = [];
  for (let lane = -3; lane <= 3; lane++) {
    if (groundOK(rows[0][lane + 3])) {
      const s = [0, lane, 0, 0, 0];
      seen.add(key(...s));
      queue.push(s);
    }
  }

  while (queue.length) {
    const [row, lane, air, par, boost] = queue.shift();
    if (row >= n - 1) return true;
    const nextRow = row + 1;

    const tryPush = (r, l, a, p) => {
      if (l < -3 || l > 3 || r >= n) return;
      const ch = rows[r][l + 3];
      if (a > 0) { if (!airOK(ch)) return; }
      else if (!groundOK(ch)) return;
      const b = a === 0 && ch === CELL.BOOST ? BOOST_ROWS : Math.max(0, boost - 1);
      const k = key(r, l, a, p, b);
      if (seen.has(k)) return;
      seen.add(k);
      queue.push([r, l, a, p, b]);
    };

    if (air > 0) {
      // airborne: continue forward; drift allowed only once (encoded in parity bit)
      const landing = air === 1;
      const nextAir = landing ? 0 : air - 1;
      if (landing) {
        tryPush(nextRow, lane, 0, 0);
        if (par === 0) { // landing drift +-1 if the mid-air drift wasn't spent
          tryPush(nextRow, lane - 1, 0, 0);
          tryPush(nextRow, lane + 1, 0, 0);
        }
      } else {
        tryPush(nextRow, lane, nextAir, par);
        if (par === 0) { // spend the one allowed drift
          tryPush(nextRow, lane - 1, nextAir, 1);
          tryPush(nextRow, lane + 1, nextAir, 1);
        }
      }
    } else {
      // grounded: forward same lane
      tryPush(nextRow, lane, 0, 0);
      // steer: 1 lane per 2 rows -> only when parity allows
      if (par === 0) {
        tryPush(nextRow, lane - 1, 0, 1);
        tryPush(nextRow, lane + 1, 0, 1);
      } else {
        tryPush(nextRow, lane, 0, 0);
      }
      // jump: longer while boosted; bounce pads fling highest
      const ch = rows[row][lane + 3];
      const isPad = ch === CELL.PAD;
      const airLen = isPad ? jumpRows + 3 : boost > 0 || ch === CELL.BOOST ? jumpRows + 2 : jumpRows;
      tryPush(nextRow, lane, airLen, 0);
    }
  }
  return false;
}

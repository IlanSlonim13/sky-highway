#!/usr/bin/env node
// Validates every level: format checks + solvability proof via the BFS solver
// in www/js/levels.js. The solver's movement model is strictly weaker than the
// real game physics, so a pass here guarantees the level is completable —
// including with zero shots fired (destructible barriers count as walls).
//
// Usage: node tools/validate-levels.mjs [--verbose]

import { getLevel, validateLevel, LEVEL_COUNT, maxJumpGap, getDailyLevel } from '../www/js/levels.js';
import { CELL, TRACK_LANES } from '../www/js/config.js';
import { createHash } from 'crypto';

// Pinned campaign output: refactors of the generator must not change any of
// the 100 shipped levels (players' progress refers to these exact layouts).
const CAMPAIGN_SHA256 = '31fb4be476fe2c7ce13d23d63c62b5e83cce7accc4a5f96417bdde269fb84786';

const LEGAL = new Set(Object.values(CELL));
const verbose = process.argv.includes('--verbose');

let failures = 0;
const stats = { rows: 0, coins: 0, ammo: 0, destructibles: 0 };

for (let i = 0; i < LEVEL_COUNT; i++) {
  const level = getLevel(i);
  const problems = [];

  // --- format checks ---
  if (!level.rows.length) problems.push('no rows');
  level.rows.forEach((row, r) => {
    if (row.length !== TRACK_LANES) problems.push(`row ${r} has length ${row.length}`);
    for (const ch of row) if (!LEGAL.has(ch)) problems.push(`row ${r} has illegal cell '${ch}'`);
  });
  const full = CELL.FLOOR.repeat(TRACK_LANES);
  if (level.rows[0] !== full) problems.push('first row not fully floored');
  if (level.rows[level.rows.length - 1] !== full) problems.push('last row not fully floored');

  // --- solvability ---
  if (!validateLevel(level)) problems.push('NOT SOLVABLE');

  // --- stats ---
  stats.rows += level.rows.length;
  for (const row of level.rows) {
    for (const ch of row) {
      if (ch === CELL.COIN || ch === CELL.COIN_AIR) stats.coins++;
      else if (ch === CELL.AMMO) stats.ammo++;
      else if (ch === CELL.DESTRUCTIBLE) stats.destructibles++;
    }
  }

  if (problems.length) {
    failures++;
    console.log(`FAIL  level ${String(i + 1).padStart(3)}  rows=${level.rows.length} speed=${level.speed.toFixed(1)} jump=${maxJumpGap(level.speed)}  ${problems.join('; ')}`);
  } else if (verbose) {
    console.log(`ok    level ${String(i + 1).padStart(3)}  rows=${level.rows.length} speed=${level.speed.toFixed(1)} jump=${maxJumpGap(level.speed)}`);
  }
}

console.log(`\n${LEVEL_COUNT - failures}/${LEVEL_COUNT} levels valid — ${stats.rows} total rows, ${stats.coins} coins, ${stats.ammo} ammo cells, ${stats.destructibles} destructible barriers`);

// --- pinned campaign hash ---
const h = createHash('sha256');
for (let i = 0; i < LEVEL_COUNT; i++) h.update(getLevel(i).rows.join('|'));
const hash = h.digest('hex');
if (hash !== CAMPAIGN_SHA256) {
  failures++;
  console.log(`FAIL  campaign hash drifted!\n  expected ${CAMPAIGN_SHA256}\n  got      ${hash}`);
} else {
  console.log('campaign layouts hash-identical to pinned SHA ✓');
}

// --- daily challenge: 30 seeds must be deterministic and solvable ---
let dailyFails = 0;
for (let d = 1; d <= 30; d++) {
  const key = `2026-07-${String(d).padStart(2, '0')}`;
  const a = getDailyLevel(key);
  const b = getDailyLevel(key);
  if (a.rows.join('|') !== b.rows.join('|')) { dailyFails++; console.log(`FAIL  daily ${key} not deterministic`); continue; }
  if (!validateLevel(a)) { dailyFails++; console.log(`FAIL  daily ${key} NOT SOLVABLE`); }
}
failures += dailyFails;
console.log(dailyFails === 0 ? '30/30 daily seeds deterministic + solvable ✓' : `${30 - dailyFails}/30 daily seeds OK`);

process.exit(failures ? 1 : 0);

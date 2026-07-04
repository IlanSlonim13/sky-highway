// Sky Highway — pilot XP & ranks. DOM-free (node-testable).
//
// Every run pays XP (even failed ones) so every session shows progress.
// Rank-ups pay coins; milestone ranks grant charges and exclusive cosmetics.

import { save } from './save.js';
import { grantShip, grantTrail } from './cosmetics.js';

export const RANK_CAP = 50;

const RANK_TITLES = [
  'Cadet', 'Pilot', 'Ace', 'Veteran', 'Ranger',
  'Specter', 'Comet', 'Nova', 'Pulsar', 'Void Legend',
];

// milestone extras paid on reaching a rank
const RANK_EXTRAS = {
  5: { rewind: 2, label: '+2 rewinds' },
  10: { slowmo: 3, label: '+3 slow-mo' },
  15: { ship: 'meridian', label: 'ship MERIDIAN' },
  20: { ammo: 6, label: '+6 ammo' },
  30: { trail: 'starlight', label: 'trail STARLIGHT' },
  40: { coins: 300, label: '+◆300' },
};

export function titleFor(rank) {
  const i = Math.min(RANK_TITLES.length - 1, Math.floor((rank - 1) / (RANK_CAP / RANK_TITLES.length)));
  return RANK_TITLES[i];
}

// XP required to go from `rank` to `rank+1`
export function xpNeeded(rank) {
  return Math.round(150 * Math.pow(rank, 1.35));
}

export function xpForRun({ distance = 0, coins = 0, completed = false, maxFlow = 1 }) {
  return Math.round((distance * 0.5 + coins * 2 + (completed ? 60 : 0)) * (1 + 0.1 * (maxFlow - 1)));
}

// current progress toward the next rank (for the menu bar)
export function rankProgress() {
  const d = save.get();
  if (d.rank >= RANK_CAP) return { rank: d.rank, title: titleFor(d.rank), fill: 1, xp: d.xp, need: 0 };
  const need = xpNeeded(d.rank);
  return { rank: d.rank, title: titleFor(d.rank), fill: Math.min(1, d.xp / need), xp: d.xp, need };
}

// grant XP, applying any number of rank-ups; returns them for UI banners
export function grantXp(amount) {
  const rankUps = [];
  save.update((d) => {
    d.xp += Math.max(0, Math.round(amount));
    while (d.rank < RANK_CAP && d.xp >= xpNeeded(d.rank)) {
      d.xp -= xpNeeded(d.rank);
      d.rank++;
      rankUps.push(d.rank);
    }
  });
  const results = [];
  for (const rank of rankUps) {
    const coins = 50 + rank * 10;
    save.addCoins(coins);
    const extra = RANK_EXTRAS[rank] || null;
    if (extra) {
      if (extra.rewind) save.addCharges('rewind', extra.rewind);
      if (extra.slowmo) save.addCharges('slowmo', extra.slowmo);
      if (extra.ammo) save.addPendingAmmo(extra.ammo);
      if (extra.coins) save.addCoins(extra.coins);
      if (extra.ship) grantShip(extra.ship);
      if (extra.trail) grantTrail(extra.trail);
    }
    results.push({ rank, title: titleFor(rank), coins, extra: extra ? extra.label : null });
  }
  return { rankUps: results };
}

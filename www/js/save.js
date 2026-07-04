// Sky Highway — persistent progress (localStorage).

import { ECONOMY } from './config.js';

const KEY = 'skyhighway.save.v1';

function freshSave() {
  return {
    unlocked: 1,                              // levels 1..unlocked are playable
    coins: 0,
    slowmoCharges: ECONOMY.startingSlowmo,
    rewindCharges: ECONOMY.startingRewind,
    adsRemoved: false,
    sound: true,
    best: {},                                 // best[levelIndex] = { pct, coins }
  };
}

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const parsed = JSON.parse(raw);
    return { ...freshSave(), ...parsed };
  } catch {
    return freshSave();
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full/blocked */ }
}

export const save = {
  get() { return data; },

  addCoins(n) { data.coins += n; persist(); },
  spendCoins(n) {
    if (data.coins < n) return false;
    data.coins -= n; persist();
    return true;
  },

  useSlowmo() {
    if (data.slowmoCharges <= 0) return false;
    data.slowmoCharges--; persist();
    return true;
  },
  useRewind() {
    if (data.rewindCharges <= 0) return false;
    data.rewindCharges--; persist();
    return true;
  },
  addCharges(kind, n) {
    if (kind === 'slowmo') data.slowmoCharges += n;
    else if (kind === 'rewind') data.rewindCharges += n;
    persist();
  },

  unlockThrough(levelNumber) {
    if (levelNumber > data.unlocked) { data.unlocked = levelNumber; persist(); }
  },
  recordBest(index, pct, coins) {
    const prev = data.best[index];
    if (!prev || pct > prev.pct || (pct === prev.pct && coins > prev.coins)) {
      data.best[index] = { pct: Math.round(pct * 100) / 100, coins };
      persist();
    }
  },

  setAdsRemoved(v) { data.adsRemoved = v; persist(); },
  setSound(v) { data.sound = v; persist(); },

  reset() { data = freshSave(); persist(); },
};

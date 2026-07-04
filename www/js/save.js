// Sky Highway — persistent progress (localStorage), schema v2.
// v2 adds: streak/daily state, missions, achievements, stats, cosmetics,
// piggy bank, endless best, echo ghost storage, premium flag semantics
// (adsRemoved === premium owned). Migrates v1 saves in place.

import { ECONOMY, WEAPON } from './config.js';

const KEY = 'skyhighway.save.v2';
const KEY_V1 = 'skyhighway.save.v1';

function freshSave() {
  return {
    unlocked: 1,                              // levels 1..unlocked are playable
    coins: 0,
    slowmoCharges: ECONOMY.startingSlowmo,
    rewindCharges: ECONOMY.startingRewind,
    adsRemoved: false,                        // true == premium owned (bundle perks)
    starterOwned: false,
    sound: true,
    best: {},                                 // best[levelIndex] = { pct, coins }

    streak: { count: 0, lastDay: null, restores: [] }, // restores: dayKeys when a saver was used
    daily: { day: null, attemptsUsed: 0, adAttemptsGranted: 0, medals: {} }, // medals[dayKey] = 'bronze'|'silver'|'gold'
    missions: { day: null, progress: {}, claimed: {} },
    achievements: {},                         // id -> true
    stats: {
      coinsCollected: 0, barriersDestroyed: 0, jumps: 0, levelsCompleted: 0,
      dailiesCompleted: 0, echoBeats: 0, revives: 0, slowmosUsed: 0,
      bestDistance: 0, maxFlow: 0, airCoins: 0,
    },
    cosmetics: { ships: ['delta'], trails: ['ion'], ship: 'delta', trail: 'ion' },
    bank: 0,
    bankAdViews: 0,
    pendingAmmo: 0,                           // store-bought ammo banked for next run
    endlessBest: { distance: 0, score: 0 },
    echoes: {},                               // key -> { lru, hz, dur, data (b64), meta }
    echoLru: 0,
    notifAsked: false,
    reviewShown: false,
  };
}

function migrate() {
  try {
    const raw2 = localStorage.getItem(KEY);
    if (raw2) return { ...freshSave(), ...JSON.parse(raw2) };
    const raw1 = localStorage.getItem(KEY_V1);
    if (raw1) {
      const v1 = JSON.parse(raw1);
      const d = freshSave();
      for (const k of ['unlocked', 'coins', 'slowmoCharges', 'rewindCharges', 'adsRemoved', 'sound', 'best']) {
        if (v1[k] !== undefined) d[k] = v1[k];
      }
      return d;
    }
  } catch { /* corrupted -> fresh */ }
  return freshSave();
}

let data = migrate();
persist();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full/blocked */ }
}

export const save = {
  get() { return data; },

  // generic mutate-and-persist; new v2 modules use this
  update(fn) { fn(data); persist(); },

  isPremium() { return !!data.adsRemoved; },

  addCoins(n) {
    // premium perk: +10% coin earnings (positive earns only)
    if (n > 0 && data.adsRemoved) n = Math.ceil(n * 1.1);
    data.coins += n;
    persist();
    return n;
  },
  spendCoins(n) {
    if (data.coins < n) return false;
    data.coins -= n; persist();
    return true;
  },

  useSlowmo() {
    if (data.slowmoCharges <= 0) return false;
    data.slowmoCharges--; data.stats.slowmosUsed++; persist();
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

  addPendingAmmo(n) { data.pendingAmmo = Math.min(WEAPON.maxAmmo, data.pendingAmmo + n); persist(); },
  takePendingAmmo() { const a = data.pendingAmmo; data.pendingAmmo = 0; persist(); return a; },

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

  // stats + achievements
  bumpStat(key, n = 1) { data.stats[key] = (data.stats[key] || 0) + n; persist(); },
  maxStat(key, v) { if (v > (data.stats[key] || 0)) { data.stats[key] = v; persist(); } },
  grantAchievement(id) {
    if (data.achievements[id]) return false;
    data.achievements[id] = true; persist();
    return true;
  },

  // piggy bank
  feedBank(earned, cap, rate) {
    const add = Math.min(cap - data.bank, Math.ceil(earned * rate));
    if (add > 0) { data.bank += add; persist(); }
    return add;
  },
  crackBank() {
    const amount = data.bank;
    data.bank = 0; data.bankAdViews = 0; data.coins += amount; persist();
    return amount;
  },

  // echo ghost storage (LRU-capped by caller)
  putEcho(key, record, maxStored) {
    data.echoes[key] = { ...record, lru: ++data.echoLru };
    const keys = Object.keys(data.echoes);
    if (keys.length > maxStored) {
      keys.sort((a, b) => data.echoes[a].lru - data.echoes[b].lru);
      for (let i = 0; i < keys.length - maxStored; i++) delete data.echoes[keys[i]];
    }
    persist();
  },
  getEcho(key) {
    const e = data.echoes[key];
    if (e) { e.lru = ++data.echoLru; persist(); }
    return e || null;
  },

  setAdsRemoved(v) { data.adsRemoved = v; persist(); },
  setSound(v) { data.sound = v; persist(); },

  reset() { data = freshSave(); persist(); },
};

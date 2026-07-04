// Sky Highway — daily challenge, streaks and missions. DOM-free (node-testable).
//
// All dates use the player's LOCAL calendar day ('YYYY-MM-DD'): "a new daily
// at midnight" matches player intuition, and since the date is the level seed
// everyone in a timezone flips to the new track together.

import { DAILY } from './config.js';
import { save } from './save.js';
import { mulberry32 } from './levels.js';

let dayOverride = null; // test hook (set via debug tools)
export function setDayOverride(k) { dayOverride = k; }

export function todayKey(now = new Date()) {
  if (dayOverride) return dayOverride;
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function shiftDay(key, days) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function msUntilNextDaily(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next - now;
}

// ---------------------------------------------------------------------------
// Day rollover
// ---------------------------------------------------------------------------
export function ensureDailyState() {
  const day = todayKey();
  save.update((d) => {
    if (d.daily.day !== day) {
      d.daily.day = day;
      d.daily.attemptsUsed = 0;
      d.daily.adAttemptsGranted = 0;
    }
    if (d.missions.day !== day) {
      d.missions.day = day;
      d.missions.progress = {};
      d.missions.claimed = {};
    }
  });
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------
export function attemptsLeft() {
  ensureDailyState();
  const d = save.get();
  const base = save.isPremium() ? DAILY.premiumAttempts : DAILY.attempts;
  return Math.max(0, base + d.daily.adAttemptsGranted - d.daily.attemptsUsed);
}

export function canWatchAdForAttempt() {
  ensureDailyState();
  return save.get().daily.adAttemptsGranted < DAILY.adAttempts;
}

export function grantAdAttempt() {
  if (!canWatchAdForAttempt()) return false;
  save.update((d) => { d.daily.adAttemptsGranted++; });
  return true;
}

// consume at run start; revives within a run don't consume
export function consumeAttempt() {
  if (attemptsLeft() <= 0) return false;
  save.update((d) => { d.daily.attemptsUsed++; });
  return true;
}

export function completedToday() {
  return !!save.get().daily.medals[todayKey()];
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------
export function streakInfo() {
  ensureDailyState();
  const d = save.get();
  const today = todayKey();
  const yesterday = shiftDay(today, -1);
  const { count, lastDay } = d.streak;
  const alive = lastDay === today || lastDay === yesterday;
  return {
    count: alive ? count : 0,
    rawCount: count,
    lastDay,
    doneToday: lastDay === today,
    atRisk: lastDay === yesterday,                      // complete today to keep it
    broken: !!lastDay && !alive && count > 0,           // missed >= 1 full day
    restorable: canRestoreStreak(),
  };
}

// restorable only when exactly one day was missed (lastDay == today-2)
export function canRestoreStreak() {
  const d = save.get();
  const today = todayKey();
  if (d.streak.lastDay !== shiftDay(today, -2) || d.streak.count === 0) return false;
  const weekAgo = shiftDay(today, -7);
  const recent = d.streak.restores.filter((r) => r >= weekAgo); // inclusive 7-day window
  return recent.length < DAILY.maxRestoresPerWeek;
}

// caller already paid (rewarded ad or coins)
export function restoreStreak() {
  if (!canRestoreStreak()) return false;
  const today = todayKey();
  save.update((d) => {
    d.streak.lastDay = shiftDay(today, -1); // as if yesterday was completed
    d.streak.restores.push(today);
    d.streak.restores = d.streak.restores.filter((r) => r > shiftDay(today, -14));
  });
  return true;
}

// Credit today's completion. Returns { coins, chest, streak } — coins 0 if
// already credited today.
export function creditDailyCompletion(medal) {
  ensureDailyState();
  const today = todayKey();
  const yesterday = shiftDay(today, -1);
  const d = save.get();

  // medal always upgradeable
  const rank = { bronze: 1, silver: 2, gold: 3 };
  const prevMedal = d.daily.medals[today];
  if (!prevMedal || rank[medal] > rank[prevMedal]) {
    save.update((s) => { s.daily.medals[today] = medal; });
  }

  if (d.streak.lastDay === today) {
    return { coins: 0, chest: 0, streak: d.streak.count };
  }
  const newCount = d.streak.lastDay === yesterday ? d.streak.count + 1 : 1;
  save.update((s) => {
    s.streak.count = newCount;
    s.streak.lastDay = today;
    s.stats.dailiesCompleted++;
  });
  const coins = Math.min(DAILY.streakCap, DAILY.streakBase + DAILY.streakStep * (newCount - 1));
  const chest = newCount % DAILY.chestEvery === 0 ? DAILY.chestCoins : 0;
  return { coins, chest, streak: newCount };
}

export function medalFor(coinsCollected, coinsTotal) {
  const share = coinsTotal > 0 ? coinsCollected / coinsTotal : 1;
  if (share >= 0.9) return 'gold';
  if (share >= 0.6) return 'silver';
  return 'bronze';
}

// last 7 days of medals for the mini calendar, oldest first
export function medalCalendar() {
  const medals = save.get().daily.medals;
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const key = shiftDay(todayKey(), -i);
    out.push({ day: key, medal: medals[key] || null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Missions — 3 per day rotated by date seed
// ---------------------------------------------------------------------------
export const MISSION_TABLE = [
  { id: 'coins150', desc: 'Collect 150 coins', stat: 'coins', kind: 'sum', target: 150, reward: 40 },
  { id: 'barriers5', desc: 'Blast 5 barriers', stat: 'barriers', kind: 'sum', target: 5, reward: 40 },
  { id: 'jumps40', desc: 'Jump 40 times', stat: 'jumps', kind: 'sum', target: 40, reward: 30 },
  { id: 'dist800', desc: 'Fly 800m in one Hyperdrive run', stat: 'runDistance', kind: 'max', target: 800, reward: 50 },
  { id: 'echo1', desc: 'Beat your echo', stat: 'echoBeats', kind: 'sum', target: 1, reward: 50 },
  { id: 'levels2', desc: 'Complete 2 campaign levels', stat: 'levels', kind: 'sum', target: 2, reward: 40 },
  { id: 'air10', desc: 'Grab 10 sky coins mid-jump', stat: 'airCoins', kind: 'sum', target: 10, reward: 35 },
  { id: 'flow5', desc: 'Reach FLOW ×5', stat: 'maxFlow', kind: 'max', target: 5, reward: 45 },
  { id: 'slowmo2', desc: 'Bend time twice (slow-mo)', stat: 'slowmos', kind: 'sum', target: 2, reward: 30 },
  { id: 'revive1', desc: 'Come back from a crash', stat: 'revives', kind: 'sum', target: 1, reward: 35 },
  { id: 'rings3', desc: 'Thread 3 rings', stat: 'rings', kind: 'sum', target: 3, reward: 40 },
];

// ---------------------------------------------------------------------------
// First victory of the day — the first completed run each day pays double
// ---------------------------------------------------------------------------
export function isFirstWinToday() {
  return save.get().firstWinDay !== todayKey();
}
export function markWinToday() {
  save.update((d) => { d.firstWinDay = todayKey(); });
}

export function todaysMissions() {
  ensureDailyState();
  const n = Number(todayKey().replace(/-/g, ''));
  const rng = mulberry32((0x5EED ^ Math.imul(n, 40503)) >>> 0);
  const idx = MISSION_TABLE.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const d = save.get();
  return idx.slice(0, 3).map((i) => {
    const m = MISSION_TABLE[i];
    return {
      ...m,
      progress: Math.min(m.target, d.missions.progress[m.id] || 0),
      done: (d.missions.progress[m.id] || 0) >= m.target,
      claimed: !!d.missions.claimed[m.id],
    };
  });
}

// feed a stat event into today's active missions
export function missionEvent(stat, value) {
  ensureDailyState();
  const active = todaysMissions();
  let changed = false;
  save.update((d) => {
    for (const m of active) {
      if (m.stat !== stat || m.claimed) continue;
      const cur = d.missions.progress[m.id] || 0;
      const next = m.kind === 'sum' ? cur + value : Math.max(cur, value);
      if (next !== cur) { d.missions.progress[m.id] = next; changed = true; }
    }
  });
  return changed;
}

// returns reward (already multiplied) or 0
export function claimMission(id, multiplier = 1) {
  const m = todaysMissions().find((x) => x.id === id);
  if (!m || !m.done || m.claimed) return 0;
  save.update((d) => { d.missions.claimed[id] = true; });
  const reward = m.reward * multiplier;
  save.addCoins(reward);
  return reward;
}

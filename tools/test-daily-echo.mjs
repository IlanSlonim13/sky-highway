#!/usr/bin/env node
// Unit tests for daily.js (attempts / streak / missions) and echo.js packing.
// Runs in plain node — localStorage is shimmed.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { save } = await import('../www/js/save.js');
const daily = await import('../www/js/daily.js');
const echo = await import('../www/js/echo.js');
const { DAILY } = await import('../www/js/config.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// ---------------------------------------------------------------- attempts
daily.setDayOverride('2026-07-04');
check('fresh day: 3 attempts', daily.attemptsLeft() === 3, `${daily.attemptsLeft()}`);
daily.consumeAttempt();
daily.consumeAttempt();
check('2 consumed -> 1 left', daily.attemptsLeft() === 1);
check('can watch ad for attempt', daily.canWatchAdForAttempt());
daily.grantAdAttempt();
check('ad grants +1', daily.attemptsLeft() === 2);
daily.grantAdAttempt(); daily.grantAdAttempt();
check('ad attempts capped at 3', !daily.canWatchAdForAttempt() && !daily.grantAdAttempt());
daily.consumeAttempt(); daily.consumeAttempt(); daily.consumeAttempt(); daily.consumeAttempt();
check('all attempts exhausted', daily.attemptsLeft() === 0 && !daily.consumeAttempt());

daily.setDayOverride('2026-07-05');
check('new day resets attempts', daily.attemptsLeft() === 3);

// premium = 5 base attempts
save.setAdsRemoved(true);
check('premium: 5 attempts', daily.attemptsLeft() === 5, `${daily.attemptsLeft()}`);
save.setAdsRemoved(false);

// ---------------------------------------------------------------- streak
daily.setDayOverride('2026-07-05');
let r = daily.creditDailyCompletion('bronze');
check('first completion: streak 1', r.streak === 1 && r.coins === DAILY.streakBase, JSON.stringify(r));
r = daily.creditDailyCompletion('gold');
check('same-day recompletion pays 0', r.coins === 0 && r.streak === 1);
check('medal upgraded to gold', save.get().daily.medals['2026-07-05'] === 'gold');

daily.setDayOverride('2026-07-06');
r = daily.creditDailyCompletion('silver');
check('next day: streak 2, escalated reward', r.streak === 2 && r.coins === DAILY.streakBase + DAILY.streakStep);

// simulate days 3..7 -> chest on 7
for (let d = 7; d <= 11; d++) {
  daily.setDayOverride(`2026-07-${String(d).padStart(2, '0')}`);
  r = daily.creditDailyCompletion('bronze');
}
check('7-day streak pays chest', r.streak === 7 && r.chest === DAILY.chestCoins, JSON.stringify(r));

// miss exactly one day -> restorable
daily.setDayOverride('2026-07-13'); // skipped the 12th
let info = daily.streakInfo();
check('missed one day: broken but restorable', info.broken && info.restorable, JSON.stringify(info));
check('restore works', daily.restoreStreak());
r = daily.creditDailyCompletion('bronze');
check('restored streak continues at 8', r.streak === 8, `${r.streak}`);

// miss two days -> NOT restorable
daily.setDayOverride('2026-07-16'); // skipped 14th + 15th
info = daily.streakInfo();
check('missed two days: not restorable', info.broken && !info.restorable, JSON.stringify(info));
r = daily.creditDailyCompletion('bronze');
check('streak resets to 1', r.streak === 1);

// restore rate limit: 2/week
daily.setDayOverride('2026-07-18'); // skipped 17th -> restorable #2
check('second restore this week ok', daily.restoreStreak());
daily.creditDailyCompletion('bronze');
daily.setDayOverride('2026-07-20'); // skipped 19th -> would be restore #3 within 7 days
check('third restore within a week blocked', !daily.canRestoreStreak());

// ---------------------------------------------------------------- medals & calendar
check('medalFor thresholds', daily.medalFor(95, 100) === 'gold' && daily.medalFor(60, 100) === 'silver' && daily.medalFor(10, 100) === 'bronze');
const cal = daily.medalCalendar();
check('calendar is 7 days ending today', cal.length === 7 && cal[6].day === '2026-07-20');

// ---------------------------------------------------------------- missions
daily.setDayOverride('2026-07-21');
const missions = daily.todaysMissions();
check('3 daily missions', missions.length === 3 && new Set(missions.map((m) => m.id)).size === 3, missions.map((m) => m.id).join(','));
const m2 = daily.todaysMissions();
check('mission rotation deterministic', missions.map((m) => m.id).join() === m2.map((m) => m.id).join());
daily.setDayOverride('2026-07-22');
const m3 = daily.todaysMissions();
daily.setDayOverride('2026-07-21');
check('different day, (likely) different missions', missions.map((m) => m.id).join() !== m3.map((m) => m.id).join());

const target = missions[0];
daily.missionEvent(target.stat, target.kind === 'sum' ? target.target : target.target);
const after = daily.todaysMissions().find((m) => m.id === target.id);
check('mission progress reaches done', after.done, JSON.stringify(after));
const coinsBefore = save.get().coins;
const reward = daily.claimMission(target.id, 2); // doubled via ad
check('claim pays doubled reward once', reward === target.reward * 2 && save.get().coins === coinsBefore + reward);
check('double-claim blocked', daily.claimMission(target.id, 1) === 0);

// ---------------------------------------------------------------- echo packing
const samples = [];
for (let i = 0; i < 400; i++) {
  samples.push({ x: Math.sin(i / 20) * 3, y: Math.abs(Math.sin(i / 7)) * 1.5, z: i * 0.55 });
}
const packed = echo.packSamples(samples);
const un = echo.unpackSamples(packed);
let maxErr = 0;
for (let i = 0; i < samples.length; i++) {
  maxErr = Math.max(maxErr,
    Math.abs(un[i].x - samples[i].x),
    Math.abs(un[i].y - samples[i].y),
    Math.abs(un[i].z - samples[i].z));
}
check('echo roundtrip max error < 0.06', maxErr < 0.06, `maxErr=${maxErr.toFixed(4)} size=${packed.length}B`);

const rec = { hz: 15, dur: samples.length / 15, data: packed };
const player = new echo.EchoPlayer(rec);
const p0 = player.positionAt(0), p5 = player.positionAt(5);
check('echo player interpolates', p0 && p5 && p5.z > p0.z, `z0=${p0?.z.toFixed(2)} z5=${p5?.z.toFixed(2)}`);
check('echo player ends', player.positionAt(1000) === null && player.finished);

// LRU cap
for (let i = 0; i < 15; i++) {
  save.putEcho(`c${i}`, { hz: 15, dur: 1, data: packed.slice(0, 40) }, 12);
}
check('echo LRU caps at 12', Object.keys(save.get().echoes).length === 12);
check('oldest evicted', !save.get().echoes.c0 && !!save.get().echoes.c14);

// ---------------------------------------------------------------- pilot XP
const pilot = await import('../www/js/pilot.js');
const { ownsShip } = await import('../www/js/cosmetics.js');

check('xp curve monotonic', pilot.xpNeeded(2) > pilot.xpNeeded(1) && pilot.xpNeeded(30) > pilot.xpNeeded(10));
check('xpForRun pays failed runs', pilot.xpForRun({ distance: 100, coins: 0, completed: false }) > 0);
check('flow multiplies xp', pilot.xpForRun({ distance: 100, coins: 20, completed: true, maxFlow: 5 }) >
  pilot.xpForRun({ distance: 100, coins: 20, completed: true, maxFlow: 1 }));

const coinsBeforeRank = save.get().coins;
let r1 = pilot.grantXp(pilot.xpNeeded(1)); // exactly one rank-up
check('rank-up detected + paid', r1.rankUps.length === 1 && r1.rankUps[0].rank === 2 &&
  save.get().coins > coinsBeforeRank, JSON.stringify(r1.rankUps));
// grind to rank 15 -> meridian ship
let total = 0;
for (let rk = save.get().rank; rk < 15; rk++) total += pilot.xpNeeded(rk);
const r15 = pilot.grantXp(total + 10);
check('rank 15 grants Meridian ship', save.get().rank >= 15 && ownsShip('meridian'),
  `rank=${save.get().rank} ups=${r15.rankUps.length}`);
check('rank progress shape', (() => { const p = pilot.rankProgress(); return p.fill >= 0 && p.fill <= 1 && p.title.length > 0; })());

// ---------------------------------------------------------------- daily deal
const shop = await import('../www/js/store.js');
daily.setDayOverride('2026-07-21');
const dealA = shop.todaysDeal(), dealB = shop.todaysDeal();
check('daily deal deterministic', dealA.id === dealB.id && dealA.dealPrice === Math.round(dealA.price / 2), JSON.stringify({ id: dealA.id, p: dealA.price, dp: dealA.dealPrice }));
daily.setDayOverride('2026-07-23');
const dealC = shop.todaysDeal();
daily.setDayOverride('2026-07-21');
save.addCoins(1000);
const before = save.get().coins;
check('deal price charged (50% off)', shop.buyWithCoins(dealA.id) && save.get().coins === before - dealA.dealPrice,
  `${before} -> ${save.get().coins} (deal ◆${dealA.dealPrice})`);

// ---------------------------------------------------------------- first win of the day
daily.setDayOverride('2026-07-25');
check('first win available', daily.isFirstWinToday());
daily.markWinToday();
check('second win same day not doubled', !daily.isFirstWinToday());
daily.setDayOverride('2026-07-26');
check('next day resets first win', daily.isFirstWinToday());

// ---------------------------------------------------------------- stars in recordBest
save.recordBest(7, 100, 12, 2);
save.recordBest(7, 100, 8, 1);  // worse stars must not downgrade
check('stars keep their max', save.get().best[7].stars === 2 && save.get().best[7].coins === 12);
save.recordBest(7, 100, 20, 3);
check('stars upgrade to 3', save.get().best[7].stars === 3);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures ? 1 : 0);

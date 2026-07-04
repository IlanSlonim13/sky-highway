// Sky Highway — bootstrap and UI wiring (v2: modes, daily, endless, echoes,
// missions, hangar, piggy bank, premium).

import { ECONOMY, ADS, MAX_REVIVES_PER_RUN, PIGGY, ECHO, APP_VERSION, PHYSICS } from './config.js';
import { getLevel, LEVEL_COUNT, getDailyLevel, createEndlessTrack } from './levels.js';
import { save } from './save.js';
import * as audio from './audio.js';
import { sfx } from './audio.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import * as ads from './ads.js';
import { CATALOG, PIGGY_IAP, buyWithCoins, purchaseIAP, restorePurchases, todaysDeal } from './store.js';
import * as daily from './daily.js';
import { EchoPlayer, echoKey, loadBestEcho, storeBestEcho } from './echo.js';
import { SHIPS, TRAILS, ownsShip, ownsTrail, buyShip, buyTrail, equipShip, equipTrail, grantShip, grantTrail } from './cosmetics.js';
import { grantXp, xpForRun, rankProgress } from './pilot.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const input = new Input(document.body);
const game = new Game(input);
const renderer = new Renderer(canvas);

let currentLevelIndex = 0;
let failsSinceAd = 0;
let winsSinceAd = 0;
let lastInterstitialAt = -Infinity; // enforce a minimum gap between interstitials

function interstitialAllowed() {
  return (performance.now() - lastInterstitialAt) / 1000 >= ADS.minInterstitialGapS;
}
let reviveTimer = null;
let coinsDoubled = false;          // per-results-screen: double-coins used
let lastEarnedRunCoins = 0;        // what the double button doubles
const sessionEchoes = new Map();   // echoKey -> last attempt recording (this session)

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
const ACHIEVEMENTS = [
  { id: 'firstwin', name: 'Lift-off', test: (s) => s.stats.levelsCompleted >= 1, coins: 30 },
  { id: 'levels10', name: 'Roadworthy', test: (s) => s.stats.levelsCompleted >= 10, coins: 100 },
  { id: 'levels50', name: 'Highway Veteran', test: (s) => s.stats.levelsCompleted >= 50, coins: 300 },
  { id: 'levels100', name: 'Sky Legend', test: (s) => s.stats.levelsCompleted >= 100, coins: 1000 },
  { id: 'coins1000', name: 'Collector', test: (s) => s.stats.coinsCollected >= 1000, coins: 100 },
  { id: 'barriers50', name: 'Demolition', test: (s) => s.stats.barriersDestroyed >= 50, coins: 150 },
  { id: 'streak3', name: 'Regular', test: (s) => s.streak.count >= 3, coins: 60 },
  { id: 'streak7', name: 'Devoted', test: (s) => s.streak.count >= 7, coins: 150, ship: 'ember' },
  { id: 'streak30', name: 'Unbreakable', test: (s) => s.streak.count >= 30, coins: 500 },
  { id: 'echo10', name: 'Time Rival', test: (s) => s.stats.echoBeats >= 10, coins: 200 },
  { id: 'dist1000', name: 'Deep Space', test: (s) => s.stats.bestDistance >= 1000, coins: 200 },
  { id: 'flowmax', name: 'Flow State', test: (s) => s.stats.maxFlow >= 5, coins: 100 },
  { id: 'rings25', name: 'Ringmaster', test: (s) => (s.stats.rings || 0) >= 25, coins: 150 },
];

function checkAchievements() {
  const d = save.get();
  for (const a of ACHIEVEMENTS) {
    if (!d.achievements[a.id] && a.test(d)) {
      save.grantAchievement(a.id);
      if (a.coins) save.addCoins(a.coins);
      if (a.ship) grantShip(a.ship);
      toast(`🏅 ${a.name}${a.coins ? ` · +◆${a.coins}` : ''}${a.ship ? ' · new ship!' : ''}`);
    }
  }
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 30);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2600);
}

// ---------------------------------------------------------------------------
// Screen management: one base screen + at most one overlay.
// ---------------------------------------------------------------------------
const BASE_SCREENS = ['screen-menu', 'screen-levels', 'screen-store', 'screen-hangar', 'hud'];
const OVERLAYS = ['screen-pause', 'screen-revive', 'screen-complete', 'screen-failed', 'screen-daily', 'screen-settings', 'screen-wheel'];

function showBase(id) {
  for (const s of BASE_SCREENS) $(s).classList.toggle('visible', s === id);
  hideOverlay();
  const inMenus = id !== 'hud';
  if (inMenus) {
    startAttract();
    if (ads.adsAvailable()) ads.showBanner();
    if (id === 'screen-menu') refreshMenu();
    if (save.get().sound) audio.setMusic(true, 'menu');
  } else {
    ads.hideBanner();
    if (save.get().sound) audio.setMusic(true, 'level');
  }
  refreshWallets();
}

function showOverlay(id) {
  for (const s of OVERLAYS) $(s).classList.toggle('visible', s === id);
}
function hideOverlay() {
  for (const s of OVERLAYS) $(s).classList.remove('visible');
}

function refreshWallets() {
  const coins = save.get().coins;
  for (const id of ['menu-coins', 'levels-coins', 'store-coins', 'hangar-coins']) $(id).textContent = coins;
}

function startAttract() {
  if (!game.attract || game.state !== 'attract') {
    game.loadLevel(getLevel(2), { attract: true });
  }
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function refreshMenu() {
  const d = save.get();
  const info = daily.streakInfo();
  $('daily-streak').textContent = `🔥${info.count}`;
  const attempts = daily.attemptsLeft();
  $('daily-sub').textContent = daily.completedToday()
    ? `done today · next in ${countdownText()}`
    : `${attempts} attempt${attempts === 1 ? '' : 's'} left today`;
  $('campaign-sub').textContent = `${Math.min(LEVEL_COUNT, d.unlocked)}/${LEVEL_COUNT} unlocked`;
  $('endless-sub').textContent = d.endlessBest.distance > 0
    ? `best ${d.endlessBest.distance}m · score ${d.endlessBest.score}`
    : 'endless · ever faster';

  // missions strip
  const strip = $('mission-strip');
  strip.innerHTML = '';
  for (const m of daily.todaysMissions()) {
    const chip = document.createElement('div');
    chip.className = 'mission-chip' + (m.done ? ' mdone' : '');
    chip.innerHTML = `${m.claimed ? '✅' : m.done ? '🎁' : '🎯'} ${m.desc}<span class="mprog">${m.progress}/${m.target}</span>`;
    strip.appendChild(chip);
  }

  // piggy chip
  $('piggy-chip').hidden = d.bank <= 0;
  $('piggy-fill').textContent = d.bank;
  $('piggy-cap').textContent = PIGGY.cap;

  // pilot rank chip
  const rp = rankProgress();
  $('rank-label').textContent = `RANK ${rp.rank} · ${rp.title.toUpperCase()}`;
  $('rank-fill').style.width = `${Math.round(rp.fill * 100)}%`;

  // prize wheel free badge
  $('wheel-free').hidden = !freeSpinAvailable();
}

function countdownText() {
  const ms = daily.msUntilNextDaily();
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Gameplay flows
// ---------------------------------------------------------------------------
function echoPlayerFor(level) {
  const best = loadBestEcho(level);
  if (best) { best.completedRun = !level.endless; return best; }
  const session = sessionEchoes.get(echoKey(level));
  if (session) {
    const p = new EchoPlayer(session);
    p.completedRun = false;
    return p;
  }
  return null;
}

function launch(level) {
  coinsDoubled = false;
  game.loadLevel(level, {
    startAmmo: save.takePendingAmmo(),
    echoPlayer: echoPlayerFor(level),
  });
  showBase('hud');
  $('progress-label').textContent = level.name.toUpperCase();
  game.start();
}

const MECHANIC_HINTS = {
  1: ['hold', 'TIP: HOLD ▲ to jump higher and farther'],
  2: ['hurdle', 'TIP: energy fences are too tall for a tap — HOLD the jump'],
  5: ['debris', "TIP: don't hold under debris — tap-hop or drive beneath it"],
};

function playCampaign(index) {
  currentLevelIndex = index;
  launch(getLevel(index));
  const hint = MECHANIC_HINTS[index];
  if (hint && !save.get().hints[hint[0]]) {
    save.markHint(hint[0]);
    toast(hint[1]);
  }
}

function playDaily() {
  if (!daily.consumeAttempt()) { openDailyModal(); return; }
  hideOverlay();
  launch(getDailyLevel(daily.todayKey()));
}

function playEndless() {
  // the endless track rotates daily: same seed for everyone, echoes stay valid
  const seed = Number(daily.todayKey().replace(/-/g, ''));
  launch(createEndlessTrack(seed));
}

function replayCurrent() {
  if (game.mode === 'daily') playDaily();
  else if (game.mode === 'endless') playEndless();
  else playCampaign(currentLevelIndex);
}

// ---------------------------------------------------------------------------
// Run end: shared bookkeeping (missions, stats, piggy, echoes)
// ---------------------------------------------------------------------------
function applyRunStats(completed) {
  const rs = game.runStats;
  daily.missionEvent('coins', rs.coins);
  daily.missionEvent('barriers', rs.barriers);
  daily.missionEvent('jumps', rs.jumps);
  daily.missionEvent('airCoins', rs.airCoins);
  daily.missionEvent('slowmos', rs.slowmos);
  daily.missionEvent('revives', rs.revives);
  daily.missionEvent('maxFlow', rs.maxFlow);
  daily.missionEvent('rings', rs.rings);
  if (game.mode === 'campaign' && completed) daily.missionEvent('levels', 1);
  if (game.mode === 'endless') daily.missionEvent('runDistance', game.distance);
  if (game.beatEcho) daily.missionEvent('echoBeats', 1);

  save.update((d) => {
    d.stats.coinsCollected += rs.coins;
    d.stats.barriersDestroyed += rs.barriers;
    d.stats.jumps += rs.jumps;
    d.stats.revives += rs.revives;
    d.stats.maxFlow = Math.max(d.stats.maxFlow, rs.maxFlow);
    d.stats.rings = (d.stats.rings || 0) + rs.rings;
    if (completed) d.stats.levelsCompleted += game.mode === 'campaign' ? 1 : 0;
    if (game.beatEcho) d.stats.echoBeats++;
    if (game.mode === 'endless') d.stats.bestDistance = Math.max(d.stats.bestDistance, game.distance);
  });

  // pilot XP: every run pays progress, even a failed one
  const { rankUps } = grantXp(xpForRun({
    distance: game.distance,
    coins: rs.coins,
    completed,
    maxFlow: rs.maxFlow,
  }));
  for (const up of rankUps) {
    toast(`🎖 RANK ${up.rank} — ${up.title.toUpperCase()} · +◆${up.coins}${up.extra ? ' · ' + up.extra : ''}`);
  }
}

function keepEcho(completed) {
  if (!game.recorder || game.recorder.samples.length < 8) return;
  const rec = game.recorder.finish();
  sessionEchoes.set(echoKey(game.level), rec);
  storeBestEcho(game.level, rec, { completed, distance: game.distance });
}

function grantRunCoins(base) {
  lastEarnedRunCoins = base;
  const granted = save.addCoins(base);
  save.feedBank(granted, PIGGY.cap, PIGGY.rate);
  return granted;
}

function renderMissionTicks(containerId) {
  const wrap = $(containerId);
  wrap.innerHTML = '';
  for (const m of daily.todaysMissions()) {
    const row = document.createElement('div');
    row.className = 'mission-tick' + (m.done && !m.claimed ? ' done-row' : '');
    const status = m.claimed ? '✅' : m.done ? '🎁' : `${m.progress}/${m.target}`;
    row.innerHTML = `<span>${m.desc}</span><span class="tick-actions">${status}</span>`;
    if (m.done && !m.claimed) {
      const actions = row.querySelector('.tick-actions');
      actions.innerHTML = '';
      const claim = document.createElement('button');
      claim.className = 'claim';
      claim.textContent = `◆${m.reward}`;
      claim.addEventListener('click', () => {
        daily.claimMission(m.id, 1);
        sfx.coin(); refreshWallets(); renderMissionTicks(containerId);
      });
      const claim2 = document.createElement('button');
      claim2.className = 'claim';
      claim2.textContent = `🎬 ◆${m.reward * 2}`;
      claim2.addEventListener('click', async () => {
        if (await ads.showRewarded()) {
          daily.claimMission(m.id, 2);
          sfx.coin(); refreshWallets();
        }
        renderMissionTicks(containerId);
      });
      actions.append(claim, claim2);
    }
    wrap.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Complete / failed screens
// ---------------------------------------------------------------------------
game.events.onCrash = () => {
  failsSinceAd++;
  if (game.revivesUsed >= MAX_REVIVES_PER_RUN || !game.canRevive()) {
    game.giveUp();
    showFailed();
    return;
  }
  openReviveModal();
};

game.events.onComplete = async ({ coins, beatEcho }) => {
  applyRunStats(true);
  keepEcho(true);

  let breakdown = [];
  let total = coins;
  if (beatEcho) { total += ECHO.beatBonus; breakdown.push(`👻 echo beaten +◆${ECHO.beatBonus}`); }

  // 3-star rating (campaign) + first victory of the day
  let stars = 0;
  if (game.mode === 'campaign') {
    stars = 1 +
      (coins >= 0.6 * countLevelCoins(game.level) ? 1 : 0) +
      ((beatEcho || (!game.echoPlayer && game.revivesUsed === 0)) ? 1 : 0);
    $('stars-row').hidden = false;
    $('stars-row').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  } else {
    $('stars-row').hidden = true;
  }
  const firstWin = daily.isFirstWinToday();
  if (firstWin) daily.markWinToday();
  $('firstwin-banner').hidden = !firstWin;

  if (game.mode === 'daily') {
    const medal = daily.medalFor(coins, countLevelCoins(game.level));
    const credit = daily.creditDailyCompletion(medal);
    total += credit.coins + credit.chest;
    $('complete-title').textContent = `${medal.toUpperCase()} MEDAL!`;
    breakdown.push(`◆ ${coins} collected`);
    if (credit.coins) breakdown.push(`🔥 streak ${credit.streak} +◆${credit.coins}`);
    if (credit.chest) breakdown.push(`🎁 streak chest +◆${credit.chest}`);
    $('btn-next').style.display = 'none';
  } else {
    const bonus = ECONOMY.levelCompleteBonusBase + currentLevelIndex;
    total += bonus;
    $('complete-title').textContent = 'LEVEL COMPLETE!';
    breakdown.push(`◆ ${coins} collected + ◆ ${bonus} bonus`);
    save.recordBest(currentLevelIndex, 100, coins, stars);
    save.unlockThrough(Math.min(LEVEL_COUNT, currentLevelIndex + 2));
    $('btn-next').style.display = currentLevelIndex + 1 < LEVEL_COUNT ? '' : 'none';
  }

  if (firstWin) { total *= 2; breakdown.push('☀ first victory ×2'); }
  grantRunCoins(total);
  $('echo-banner').hidden = !beatEcho;
  $('complete-stats').textContent = `${breakdown.join(' · ')} = ◆ ${total}`;
  $('btn-double').style.display = total > 0 && ads.adsAvailable() ? '' : 'none';
  $('btn-double').disabled = false;
  renderMissionTicks('complete-missions');
  checkAchievements();
  maybeAskReview();
  winsSinceAd++;
  showOverlay('screen-complete');
  refreshWallets();
  if (winsSinceAd >= ADS.interstitialEveryNWins && interstitialAllowed()) {
    winsSinceAd = 0;
    lastInterstitialAt = performance.now();
    await ads.showInterstitial();
  }
};

async function showFailed() {
  applyRunStats(false);
  keepEcho(false);

  const salvaged = game.runCoins;
  grantRunCoins(salvaged);

  if (game.mode === 'endless') {
    const d = save.get();
    const isBest = game.distance > d.endlessBest.distance;
    if (isBest) {
      save.update((s) => { s.endlessBest = { distance: game.distance, score: game.score }; });
    }
    $('failed-title').textContent = 'RUN OVER';
    $('newbest-banner').hidden = !isBest;
    $('failed-stats').textContent =
      `${game.distance}m · score ${game.score} · ◆ ${salvaged} salvaged` +
      (isBest ? '' : ` · best ${d.endlessBest.distance}m`);
  } else {
    $('failed-title').textContent = 'SHIP LOST';
    $('newbest-banner').hidden = true;
    $('failed-stats').textContent =
      `made it ${Math.round(game.progress * 100)}% of the way · ◆ ${salvaged} salvaged`;
  }
  $('btn-double-fail').style.display = salvaged > 0 && ads.adsAvailable() ? '' : 'none';
  $('btn-double-fail').disabled = false;
  renderMissionTicks('failed-missions');
  checkAchievements();
  showOverlay('screen-failed');
  refreshWallets();
  if (failsSinceAd >= ADS.interstitialEveryNFails && interstitialAllowed()) {
    failsSinceAd = 0;
    lastInterstitialAt = performance.now();
    await ads.showInterstitial();
  }
}

function countLevelCoins(level) {
  let n = 0;
  for (const row of level.rows) for (const ch of row) if (ch === 'C' || ch === 'c') n++;
  return n || 1;
}

// double-coins rewarded button (both screens)
async function doubleCoins(btn) {
  if (coinsDoubled || lastEarnedRunCoins <= 0) return;
  btn.disabled = true;
  if (await ads.showRewarded()) {
    coinsDoubled = true;
    const granted = save.addCoins(lastEarnedRunCoins);
    save.feedBank(granted, PIGGY.cap, PIGGY.rate);
    sfx.win();
    toast(`🎬 coins doubled! +◆${granted}`);
    refreshWallets();
    btn.style.display = 'none';
  } else {
    btn.disabled = false;
  }
}
$('btn-double').addEventListener('click', (e) => doubleCoins(e.currentTarget));
$('btn-double-fail').addEventListener('click', (e) => doubleCoins(e.currentTarget));

// ---------------------------------------------------------------------------
// Revive (extra life) modal — unchanged flow, ad-first
// ---------------------------------------------------------------------------
const CRASH_LINES = {
  wall: 'SMASHED INTO A BARRIER',
  burn: 'BURNED ON A HAZARD TILE',
  fall: 'LOST IN THE VOID',
  debris: 'CLIPPED THE SPACE DEBRIS',
  comet: 'OBLITERATED BY A COMET',
};

function openReviveModal() {
  $('revive-title').textContent = CRASH_LINES[game.crashType] || 'CRASHED!';
  $('revive-sub').textContent = game.mode === 'endless'
    ? `${game.distance}m — keep the run alive!`
    : `${Math.round(game.progress * 100)}% of the way there`;
  $('btn-revive-ad').style.display = ads.adsAvailable() ? '' : 'none';
  const charges = save.get().rewindCharges;
  $('revive-charges').textContent = charges;
  $('btn-revive-charge').style.display = charges > 0 ? '' : 'none';
  $('btn-revive-buy').style.display =
    charges === 0 && save.get().coins >= ECONOMY.rewindPrice ? '' : 'none';
  showOverlay('screen-revive');

  let secs = 5;
  $('revive-count').textContent = secs;
  clearInterval(reviveTimer);
  reviveTimer = setInterval(() => {
    secs--;
    $('revive-count').textContent = Math.max(0, secs);
    if (secs <= 0) {
      stopReviveTimer();
      hideOverlay();
      game.giveUp();
      showFailed();
    }
  }, 1000);
}

function stopReviveTimer() {
  clearInterval(reviveTimer);
  reviveTimer = null;
}

function doRevive() {
  hideOverlay();
  game.revive();
}

$('btn-revive-ad').addEventListener('click', async () => {
  stopReviveTimer();
  sfx.click();
  const earned = await ads.showRewarded();
  if (earned) doRevive();
  else openReviveModal();
});
$('btn-revive-charge').addEventListener('click', () => {
  stopReviveTimer();
  sfx.click();
  if (save.useRewind()) doRevive();
});
$('btn-revive-buy').addEventListener('click', () => {
  stopReviveTimer();
  sfx.click();
  if (buyWithCoins('rewind3') && save.useRewind()) {
    refreshWallets();
    doRevive();
  }
});
$('btn-giveup').addEventListener('click', () => {
  stopReviveTimer();
  sfx.click();
  hideOverlay();
  game.giveUp();
  showFailed();
});

// ---------------------------------------------------------------------------
// Daily modal
// ---------------------------------------------------------------------------
function openDailyModal() {
  daily.ensureDailyState();
  const info = daily.streakInfo();
  const attempts = daily.attemptsLeft();

  const cal = $('daily-calendar');
  cal.innerHTML = '';
  const medalIcon = { gold: '🥇', silver: '🥈', bronze: '🥉' };
  daily.medalCalendar().forEach((c, i) => {
    const cell = document.createElement('div');
    cell.className = 'daily-cell' + (i === 6 ? ' today' : '');
    cell.innerHTML = `<span class="medal">${c.medal ? medalIcon[c.medal] : '·'}</span>${c.day.slice(8)}`;
    cal.appendChild(cell);
  });

  $('daily-attempts').textContent = attempts;
  $('daily-streak-big').textContent = `🔥${info.count}`;

  const saver = $('daily-saver');
  saver.hidden = !(info.broken && info.restorable);
  if (!saver.hidden) {
    $('saver-count').textContent = info.rawCount;
    $('btn-saver-coins').style.display = save.get().coins >= 200 ? '' : 'none';
  }

  $('btn-daily-play').disabled = attempts <= 0;
  $('btn-daily-play').textContent = attempts > 0 ? '▶ FLY' : `NEW RUN IN ${countdownText()}`;
  $('btn-daily-ad-attempt').style.display =
    attempts <= 0 && daily.canWatchAdForAttempt() && ads.adsAvailable() ? '' : 'none';

  showOverlay('screen-daily');
}

$('card-daily').addEventListener('click', () => { sfx.click(); openDailyModal(); });
$('btn-daily-play').addEventListener('click', () => { sfx.click(); playDaily(); });
$('btn-daily-ad-attempt').addEventListener('click', async () => {
  sfx.click();
  if (await ads.showRewarded()) {
    daily.grantAdAttempt();
    toast('🎬 +1 attempt');
  }
  openDailyModal();
});
$('btn-saver-ad').addEventListener('click', async () => {
  sfx.click();
  if (await ads.showRewarded()) {
    daily.restoreStreak();
    toast('🔥 streak restored!');
  }
  openDailyModal();
});
$('btn-saver-coins').addEventListener('click', () => {
  sfx.click();
  if (save.spendCoins(200) && daily.restoreStreak()) {
    toast('🔥 streak restored!');
    refreshWallets();
  }
  openDailyModal();
});

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
$('btn-jump').addEventListener('pointerdown', (e) => { e.stopPropagation(); input.pressJump(); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  $('btn-jump').addEventListener(ev, () => input.releaseJump());
}
$('btn-fire').addEventListener('pointerdown', (e) => { e.stopPropagation(); game.shoot(); });
$('btn-slowmo').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (game.state !== 'running' || game.slowmoLeft > 0) return;
  if (save.get().slowmoCharges > 0) {
    if (game.activateSlowmo()) save.useSlowmo();
  } else {
    sfx.click();
    const btn = $('btn-slowmo');
    btn.style.borderColor = '#ff5c7a';
    setTimeout(() => (btn.style.borderColor = ''), 350);
  }
});

$('btn-pause').addEventListener('click', () => {
  if (game.pause()) { sfx.click(); showOverlay('screen-pause'); }
});
input.onPause(() => {
  if (game.state === 'running' && game.pause()) showOverlay('screen-pause');
  else if (game.state === 'paused') { hideOverlay(); game.resume(); }
});

$('btn-resume').addEventListener('click', () => { sfx.click(); hideOverlay(); game.resume(); });
$('btn-restart').addEventListener('click', () => { sfx.click(); replayCurrent(); });
$('btn-quit').addEventListener('click', () => { sfx.click(); showBase('screen-menu'); });

function syncHud() {
  if (!$('hud').classList.contains('visible')) return;
  if (game.mode === 'endless') {
    $('progress-fill').style.width = '0%';
    $('progress-label').textContent = `${game.distance} m`;
  } else {
    $('progress-fill').style.width = `${game.progress * 100}%`;
  }
  $('hud-coins').textContent = game.runCoins;
  $('ammo-count').textContent = game.ammo;
  $('btn-fire').disabled = game.ammo <= 0;
  const sm = save.get().slowmoCharges;
  $('slowmo-count').textContent = game.slowmoLeft > 0 ? Math.ceil(game.slowmoLeft) : sm;
  $('btn-slowmo').classList.toggle('active', game.slowmoLeft > 0);
  const chip = $('flow-chip');
  chip.textContent = `×${game.flow}`;
  chip.classList.toggle('hot', game.flow > 1);
  // hold-to-jump charge ring on the ▲ button
  const jumpBtn = $('btn-jump');
  const charging = !game.ship.grounded && input.jumpHeld && game._sustain;
  jumpBtn.classList.toggle('charging', charging);
  if (charging) jumpBtn.style.setProperty('--charge', Math.min(1, game._holdT / PHYSICS.maxJumpHoldS));
}

// ---------------------------------------------------------------------------
// Results buttons
// ---------------------------------------------------------------------------
$('btn-next').addEventListener('click', () => { sfx.click(); playCampaign(currentLevelIndex + 1); });
$('btn-replay').addEventListener('click', () => { sfx.click(); replayCurrent(); });
$('btn-complete-menu').addEventListener('click', () => { sfx.click(); showBase('screen-menu'); });
$('btn-retry').addEventListener('click', () => { sfx.click(); replayCurrent(); });
$('btn-failed-menu').addEventListener('click', () => { sfx.click(); showBase('screen-menu'); });

// ---------------------------------------------------------------------------
// Level select
// ---------------------------------------------------------------------------
const SECTOR_SIZE = 100;
const STAR_CHESTS = [
  { stars: 50, coins: 100 }, { stars: 150, coins: 200 }, { stars: 300, coins: 300 },
  { stars: 500, coins: 500, trail: 'aurum' }, { stars: 750, coins: 800 }, { stars: 1000, coins: 1200 },
];

function totalStars() {
  const best = save.get().best;
  return Object.values(best).reduce((s, b) => s + (b.stars || 0), 0);
}

function buildStarStrip() {
  const strip = $('star-strip');
  strip.innerHTML = '';
  const total = totalStars();
  const label = document.createElement('span');
  label.className = 'star-total';
  label.textContent = `★ ${total}`;
  strip.appendChild(label);
  const claimed = save.get().starChestsClaimed;
  for (const chest of STAR_CHESTS) {
    const btn = document.createElement('button');
    const done = claimed.includes(chest.stars);
    const ready = !done && total >= chest.stars;
    btn.className = 'star-chest' + (done ? ' claimed' : ready ? ' ready' : '');
    btn.textContent = done ? `✓ ${chest.stars}★` : `🎁 ${chest.stars}★ · ◆${chest.coins}${chest.trail ? ' +trail' : ''}`;
    if (ready) {
      btn.addEventListener('click', () => {
        save.update((d) => { d.starChestsClaimed.push(chest.stars); });
        const c = save.addCoins(chest.coins);
        save.feedBank(c, PIGGY.cap, PIGGY.rate);
        if (chest.trail) grantTrail(chest.trail);
        sfx.win();
        toast(`🎁 star chest: +◆${chest.coins}${chest.trail ? ' · trail AURUM' : ''}`);
        refreshWallets();
        buildStarStrip();
      });
    } else {
      btn.disabled = true;
    }
    strip.appendChild(btn);
  }
}

function buildLevelGrid(sector) {
  buildStarStrip();
  const { unlocked, best } = save.get();
  const sectors = Math.ceil(LEVEL_COUNT / SECTOR_SIZE);
  if (sector === undefined) sector = Math.min(sectors - 1, Math.floor((unlocked - 1) / SECTOR_SIZE));

  const tabs = $('sector-tabs');
  tabs.innerHTML = '';
  for (let sIdx = 0; sIdx < sectors; sIdx++) {
    const tab = document.createElement('button');
    tab.className = 'sector-tab' + (sIdx === sector ? ' active' : '');
    tab.textContent = `${sIdx * SECTOR_SIZE + 1}–${Math.min(LEVEL_COUNT, (sIdx + 1) * SECTOR_SIZE)}`;
    tab.addEventListener('click', () => { sfx.click(); buildLevelGrid(sIdx); });
    tabs.appendChild(tab);
  }

  const grid = $('level-grid');
  grid.innerHTML = '';
  const from = sector * SECTOR_SIZE;
  const to = Math.min(LEVEL_COUNT, from + SECTOR_SIZE);
  for (let i = from; i < to; i++) {
    const cell = document.createElement('button');
    cell.className = 'level-cell';
    const b = best[i];
    if (i + 1 > unlocked) {
      cell.classList.add('locked');
      cell.innerHTML = `🔒`;
    } else {
      const badge = b && b.stars > 0
        ? `<span class="stars">${'★'.repeat(b.stars)}</span>`
        : b ? `<span class="best">${Math.round(b.pct)}%</span>` : '';
      cell.innerHTML = `${i + 1}${badge}`;
      if (b && b.pct >= 100) cell.classList.add('done');
      cell.addEventListener('click', () => { sfx.click(); playCampaign(i); });
    }
    grid.appendChild(cell);
  }
}

// ---------------------------------------------------------------------------
// Hangar
// ---------------------------------------------------------------------------
function buildHangar() {
  const shipWrap = $('hangar-ships');
  shipWrap.innerHTML = '';
  const equippedShipId = save.get().cosmetics.ship;
  for (const s of SHIPS) {
    const owned = ownsShip(s.id);
    const row = document.createElement('div');
    row.className = 'store-item' + (equippedShipId === s.id ? ' equipped' : '');
    const swatch = `<div class="swatch" style="color:${s.color || '#c86bff'};background:${s.color || 'linear-gradient(45deg,#c86bff,#54f0ff)'}"></div>`;
    let action;
    if (equippedShipId === s.id) action = `<button class="buy equipped-btn" disabled>FLYING</button>`;
    else if (owned) action = `<button class="buy" data-equip-ship="${s.id}">EQUIP</button>`;
    else if (s.unlock.type === 'coins') action = `<button class="buy gold" data-buy-ship="${s.id}">◆ ${s.unlock.price}</button>`;
    else action = `<button class="buy" disabled>${s.unlock.label}</button>`;
    row.innerHTML = `${swatch}<div class="info"><div class="name">${s.name}</div><div class="desc">${s.desc}</div></div>${action}`;
    shipWrap.appendChild(row);
  }

  const trailWrap = $('hangar-trails');
  trailWrap.innerHTML = '';
  const equippedTrailId = save.get().cosmetics.trail;
  for (const t of TRAILS) {
    const owned = ownsTrail(t.id);
    const row = document.createElement('div');
    row.className = 'store-item' + (equippedTrailId === t.id ? ' equipped' : '');
    let action;
    if (equippedTrailId === t.id) action = `<button class="buy equipped-btn" disabled>ACTIVE</button>`;
    else if (owned) action = `<button class="buy" data-equip-trail="${t.id}">EQUIP</button>`;
    else if (t.unlock.type === 'coins') action = `<button class="buy gold" data-buy-trail="${t.id}">◆ ${t.unlock.price}</button>`;
    else action = `<button class="buy" disabled>${t.unlock.label}</button>`;
    row.innerHTML = `<div class="swatch" style="color:${t.color};background:${t.color}"></div><div class="info"><div class="name">${t.name}</div></div>${action}`;
    trailWrap.appendChild(row);
  }

  // one delegated handler
  $('screen-hangar').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.equipShip) { equipShip(b.dataset.equipShip); sfx.click(); }
    else if (b.dataset.equipTrail) { equipTrail(b.dataset.equipTrail); sfx.click(); }
    else if (b.dataset.buyShip) { if (buyShip(b.dataset.buyShip)) sfx.win(); else sfx.click(); }
    else if (b.dataset.buyTrail) { if (buyTrail(b.dataset.buyTrail)) sfx.win(); else sfx.click(); }
    else return;
    refreshWallets();
    buildHangar();
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
function buildStore() {
  // piggy bank card
  const piggyWrap = $('store-piggy');
  const d = save.get();
  piggyWrap.innerHTML = '';
  const full = d.bank >= PIGGY.cap;
  const piggyRow = document.createElement('div');
  piggyRow.className = 'store-item';
  piggyRow.innerHTML = `
    <div class="ico">🐷</div>
    <div class="info"><div class="name">Piggy Bank ◆${d.bank}/${PIGGY.cap}</div>
    <div class="desc">10% of everything you earn piles up in here</div></div>`;
  if (d.bank > 0) {
    const crack = document.createElement('button');
    crack.className = 'buy gold';
    crack.textContent = PIGGY_IAP.price;
    crack.addEventListener('click', async () => {
      if (await purchaseIAP('piggy')) { sfx.win(); refreshWallets(); buildStore(); }
    });
    piggyRow.appendChild(crack);
    if (full) {
      const adBtn = document.createElement('button');
      adBtn.className = 'buy';
      adBtn.textContent = `🎬 ${d.bankAdViews}/${PIGGY.adsToOpen}`;
      adBtn.addEventListener('click', async () => {
        if (await ads.showRewarded()) {
          save.update((s) => { s.bankAdViews++; });
          if (save.get().bankAdViews >= PIGGY.adsToOpen) {
            const amount = save.crackBank();
            toast(`🐷 bank cracked! +◆${amount}`);
          }
          refreshWallets(); buildStore();
        }
      });
      piggyRow.appendChild(adBtn);
    }
  }
  piggyWrap.appendChild(piggyRow);

  const coinWrap = $('store-coin-items');
  coinWrap.innerHTML = '';
  const deal = todaysDeal();
  const dealCard = document.createElement('div');
  dealCard.className = 'deal-card';
  dealCard.innerHTML = `
    <div class="ico">${deal.icon}</div>
    <div class="info"><div class="deal-tag">⚡ TODAY ONLY · ends in ${countdownText()}</div>
    <div class="name">${deal.name}</div><div class="desc">${deal.desc}</div></div>
    <button class="buy gold"><span class="old-price">◆${deal.price}</span>◆${deal.dealPrice}</button>`;
  dealCard.querySelector('.buy').addEventListener('click', () => {
    if (buyWithCoins(deal.id)) { sfx.coin(); refreshWallets(); buildStore(); }
    else sfx.click();
  });
  coinWrap.appendChild(dealCard);
  for (const item of CATALOG.coinItems) {
    if (item.id === deal.id) continue; // shown as the deal card above
    coinWrap.appendChild(storeRow(item, `◆ ${item.price}`, () => {
      if (buyWithCoins(item.id)) { sfx.coin(); refreshWallets(); buildStore(); }
      else sfx.click();
    }, save.get().coins < item.price));
  }

  const earnWrap = $('store-earn');
  earnWrap.innerHTML = '';
  earnWrap.appendChild(storeRow(
    { icon: '🎬', name: `+${ADS.rewardedCoinReward} Coins`, desc: 'Watch a short ad' },
    'WATCH',
    async () => {
      const earned = await ads.showRewarded();
      if (earned) {
        const granted = save.addCoins(ADS.rewardedCoinReward);
        save.feedBank(granted, PIGGY.cap, PIGGY.rate);
        sfx.coin(); refreshWallets(); buildStore();
      }
    },
    !ads.adsAvailable(),
  ));

  const iapWrap = $('store-iap-items');
  iapWrap.innerHTML = '';
  for (const item of CATALOG.iapItems) {
    if (item.owned && item.owned()) continue;
    iapWrap.appendChild(storeRow(item, item.price, async () => {
      if (await purchaseIAP(item.id)) { sfx.win(); refreshWallets(); refreshMenu(); buildStore(); }
    }, false, true));
  }
}

function storeRow(item, priceLabel, onBuy, disabled, gold) {
  const row = document.createElement('div');
  row.className = 'store-item';
  row.innerHTML = `
    <div class="ico">${item.icon}</div>
    <div class="info"><div class="name">${item.name}</div><div class="desc">${item.desc}</div></div>
    <button class="buy${gold ? ' gold' : ''}" ${disabled ? 'disabled' : ''}>${priceLabel}</button>`;
  row.querySelector('.buy').addEventListener('click', onBuy);
  return row;
}

$('btn-restore').addEventListener('click', async () => {
  sfx.click();
  await restorePurchases();
  buildStore();
});

// ---------------------------------------------------------------------------
// Native niceties (no-ops on web)
// ---------------------------------------------------------------------------
function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// after the first daily completion, ask once to schedule streak reminders
async function maybeScheduleNotifications() {
  const d = save.get();
  if (!isNative() || d.notifAsked || d.stats.dailiesCompleted < 1) return;
  save.update((s) => { s.notifAsked = true; });
  try {
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN) return;
    const perm = await LN.requestPermissions();
    if (perm.display !== 'granted') return;
    await LN.schedule({
      notifications: [{
        id: 1,
        title: 'Sky Highway',
        body: "Today's Run is live — keep your streak alive! 🔥",
        schedule: { on: { hour: 19, minute: 0 }, repeats: true },
      }],
    });
  } catch { /* plugin absent */ }
}

function maybeAskReview() {
  const d = save.get();
  if (d.reviewShown || d.stats.levelsCompleted < 3) return;
  save.update((s) => { s.reviewShown = true; });
  if (!isNative()) return;
  try { window.Capacitor?.Plugins?.RateApp?.requestReview?.(); } catch { /* plugin absent */ }
}

// ---------------------------------------------------------------------------
// Prize wheel — one free spin a day, one more behind a rewarded ad
// ---------------------------------------------------------------------------
const WHEEL_SLICES = [
  { coins: 20, label: '◆20', color: '#3a2a68' },
  { coins: 40, label: '◆40', color: '#252054' },
  { ammo: 6, label: '🔸×6', color: '#3a2a68' },
  { coins: 80, label: '◆80', color: '#252054' },
  { slowmo: 1, label: '🐌×1', color: '#3a2a68' },
  { coins: 150, label: '◆150', color: '#252054' },
  { rewind: 1, label: '⏪×1', color: '#3a2a68' },
  { coins: 400, label: '◆400!', color: '#7a5a10' },
];
const WHEEL_WEIGHTS = [22, 18, 14, 12, 10, 8, 10, 6];
let wheelSpinning = false;
let wheelRotation = 0;

function freeSpinAvailable() {
  const w = save.get().wheel;
  return w.day !== daily.todayKey() || w.spins === 0;
}
function adSpinAvailable() {
  const w = save.get().wheel;
  return w.day === daily.todayKey() && w.spins === 1 && ads.adsAvailable();
}

function buildWheelDisc() {
  const disc = $('wheel-disc');
  const n = WHEEL_SLICES.length;
  const seg = 360 / n;
  disc.style.background = `conic-gradient(${WHEEL_SLICES
    .map((s, i) => `${s.color} ${i * seg}deg ${(i + 1) * seg}deg`).join(', ')})`;
  disc.querySelectorAll('.wheel-slice-label').forEach((el) => el.remove());
  WHEEL_SLICES.forEach((s, i) => {
    const el = document.createElement('span');
    el.className = 'wheel-slice-label';
    el.textContent = s.label;
    el.style.transform = `rotate(${i * seg + seg / 2 - 90}deg) translate(28%, -50%)`;
    disc.appendChild(el);
  });
}

function openWheel() {
  daily.ensureDailyState();
  save.update((d) => {
    if (d.wheel.day !== daily.todayKey()) { d.wheel.day = daily.todayKey(); d.wheel.spins = 0; }
  });
  buildWheelDisc();
  syncWheelButtons();
  showOverlay('screen-wheel');
}

function syncWheelButtons() {
  $('btn-spin').style.display = freeSpinAvailable() ? '' : 'none';
  $('btn-spin-ad').hidden = !adSpinAvailable();
  $('wheel-note').textContent = freeSpinAvailable()
    ? 'one free spin every day'
    : adSpinAvailable() ? 'watch an ad for one more spin' : `next free spin in ${countdownText()}`;
}

function pickWheelSlice(forced) {
  if (forced !== undefined) return forced;
  const total = WHEEL_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < WHEEL_WEIGHTS.length; i++) {
    roll -= WHEEL_WEIGHTS[i];
    if (roll <= 0) return i;
  }
  return 0;
}

function spinWheel(forced) {
  if (wheelSpinning) return;
  wheelSpinning = true;
  const i = pickWheelSlice(forced);
  const seg = 360 / WHEEL_SLICES.length;
  // land the CENTER of slice i under the top pointer
  wheelRotation += 720 + ((360 - (i * seg + seg / 2)) - (wheelRotation % 360) + 360) % 360;
  $('wheel-disc').style.transform = `rotate(${wheelRotation}deg)`;
  save.update((d) => { d.wheel.spins++; });
  setTimeout(() => {
    wheelSpinning = false;
    const prize = WHEEL_SLICES[i];
    if (prize.coins) { const c = save.addCoins(prize.coins); save.feedBank(c, PIGGY.cap, PIGGY.rate); toast(`🎡 +◆${prize.coins}${prize.coins >= 400 ? ' JACKPOT!' : ''}`); }
    if (prize.ammo) { save.addPendingAmmo(prize.ammo); toast(`🎡 +${prize.ammo} ammo (next run)`); }
    if (prize.slowmo) { save.addCharges('slowmo', prize.slowmo); toast('🎡 +1 slow-mo'); }
    if (prize.rewind) { save.addCharges('rewind', prize.rewind); toast('🎡 +1 rewind'); }
    sfx.win();
    refreshWallets();
    syncWheelButtons();
  }, 3200);
}

$('btn-wheel').addEventListener('click', () => { sfx.click(); openWheel(); });
$('btn-spin').addEventListener('click', () => { if (freeSpinAvailable()) { sfx.click(); spinWheel(); syncWheelButtons(); } });
$('btn-spin-ad').addEventListener('click', async () => {
  sfx.click();
  if (!adSpinAvailable()) return;
  if (await ads.showRewarded()) { spinWheel(); }
  syncWheelButtons();
});

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------
$('card-campaign').addEventListener('click', () => { sfx.click(); buildLevelGrid(); showBase('screen-levels'); });
$('card-endless').addEventListener('click', () => { sfx.click(); playEndless(); });
$('btn-hangar').addEventListener('click', () => { sfx.click(); buildHangar(); showBase('screen-hangar'); });
$('btn-store').addEventListener('click', () => { sfx.click(); buildStore(); showBase('screen-store'); });
document.querySelectorAll('[data-back]').forEach((b) =>
  b.addEventListener('click', () => { sfx.click(); showBase('screen-menu'); }));

function syncSoundButton() {
  $('btn-sound').textContent = save.get().sound ? '🔊 SOUND ON' : '🔇 SOUND OFF';
}
$('btn-sound').addEventListener('click', () => {
  const v = !save.get().sound;
  save.setSound(v);
  audio.setEnabled(v);
  audio.setMusic(v);
  syncSoundButton();
  sfx.click();
});

// ---------------------------------------------------------------------------
// Settings (incl. left-handed mode)
// ---------------------------------------------------------------------------
function applyFlip() {
  const flipped = save.get().flipControls;
  $('hud').classList.toggle('flipped', flipped);
  $('btn-flip').setAttribute('aria-pressed', String(flipped));
  $('btn-flip').style.borderColor = flipped ? 'var(--glow2)' : '';
}
$('btn-settings').addEventListener('click', () => { sfx.click(); syncSoundButton(); showOverlay('screen-settings'); });
$('btn-flip').addEventListener('click', () => {
  sfx.click();
  save.setFlipControls(!save.get().flipControls);
  applyFlip();
});
$('app-version').textContent = `v${APP_VERSION}`;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let audioUnlocked = false;
window.addEventListener('pointerdown', () => {
  if (audioUnlocked) return;
  audioUnlocked = true;
  audio.unlock();
  audio.setEnabled(save.get().sound);
  if (save.get().sound) audio.setMusic(true);
}, { capture: true });

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 250));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'running' && game.pause()) showOverlay('screen-pause');
});

ads.initAds(save.get().adsRemoved);
ads.setAdsRemoved(save.get().adsRemoved);
syncSoundButton();
applyFlip();
daily.ensureDailyState();
showBase('screen-menu');
maybeScheduleNotifications();

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  game.frame(dt);
  renderer.render(game, dt);
  syncHud();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------------------
// Debug hooks for automated testing (?debug)
// ---------------------------------------------------------------------------
if (location.search.includes('debug')) {
  window.__shq = {
    game, input, save, renderer, daily, sessionEchoes,
    playLevel: playCampaign,
    playDaily, playEndless, openDailyModal, refreshMenu,
    openWheel, spinWheel, buildStarStrip, buildStore, rankProgress,
    spawnComet: (lane) => game._spawnComet(lane),
    win() { game.ship.z = game.level.length - 0.5; },
    crash() { game._crash('wall'); },
    state() {
      return {
        state: game.state, mode: game.mode, z: game.ship.z, x: game.ship.x, y: game.ship.y,
        progress: game.progress, distance: game.distance, score: game.score,
        coins: game.runCoins, ammo: game.ammo, flow: game.flow,
        timeScale: game.timeScale, revivesUsed: game.revivesUsed,
        destroyed: game.destroyed.size, collected: game.collected.size,
        hasEcho: !!game.echoPlayer, echoPos: game.echoPos, beatEcho: game.beatEcho,
      };
    },
  };
}

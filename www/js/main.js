// Sky Highway — bootstrap and UI wiring.

import { ECONOMY, ADS, MAX_REVIVES_PER_RUN } from './config.js';
import { getLevel, LEVEL_COUNT } from './levels.js';
import { save } from './save.js';
import * as audio from './audio.js';
import { sfx } from './audio.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import * as ads from './ads.js';
import { CATALOG, buyWithCoins, purchaseIAP, restorePurchases, takePendingAmmo } from './store.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const input = new Input(document.body);
const game = new Game(input);
const renderer = new Renderer(canvas);

let currentLevelIndex = 0;
let failsSinceAd = 0;
let winsSinceAd = 0;
let reviveTimer = null;

// ---------------------------------------------------------------------------
// Screen management: one base screen + at most one overlay.
// ---------------------------------------------------------------------------
const BASE_SCREENS = ['screen-menu', 'screen-levels', 'screen-store', 'hud'];
const OVERLAYS = ['screen-pause', 'screen-revive', 'screen-complete', 'screen-failed'];

function showBase(id) {
  for (const s of BASE_SCREENS) $(s).classList.toggle('visible', s === id);
  hideOverlay();
  const inMenus = id !== 'hud';
  if (inMenus) {
    startAttract();
    if (ads.adsAvailable()) ads.showBanner();
  } else {
    ads.hideBanner();
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
  $('menu-coins').textContent = coins;
  $('levels-coins').textContent = coins;
  $('store-coins').textContent = coins;
}

// ---------------------------------------------------------------------------
// Attract mode (menu background)
// ---------------------------------------------------------------------------
function startAttract() {
  if (!game.attract || game.state !== 'attract') {
    game.loadLevel(getLevel(2), { attract: true });
  }
}

// ---------------------------------------------------------------------------
// Gameplay flow
// ---------------------------------------------------------------------------
function playLevel(index) {
  currentLevelIndex = index;
  game.loadLevel(getLevel(index), { startAmmo: takePendingAmmo() });
  showBase('hud');
  $('progress-label').textContent = `LEVEL ${index + 1}`;
  game.start();
}

game.events.onCrash = () => {
  failsSinceAd++;
  if (game.revivesUsed >= MAX_REVIVES_PER_RUN || !game.canRevive()) {
    game.giveUp();
    showFailed();
    return;
  }
  openReviveModal();
};

game.events.onComplete = async ({ coins }) => {
  const bonus = ECONOMY.levelCompleteBonusBase + currentLevelIndex;
  const total = coins + bonus;
  save.addCoins(total);
  save.recordBest(currentLevelIndex, 100, coins);
  save.unlockThrough(Math.min(LEVEL_COUNT, currentLevelIndex + 2));
  $('complete-stats').textContent = `◆ ${coins} collected + ◆ ${bonus} bonus = ◆ ${total}`;
  $('btn-next').style.display = currentLevelIndex + 1 < LEVEL_COUNT ? '' : 'none';
  winsSinceAd++;
  showOverlay('screen-complete');
  refreshWallets();
  if (winsSinceAd >= ADS.interstitialEveryNWins) {
    winsSinceAd = 0;
    await ads.showInterstitial();
  }
};

async function showFailed() {
  $('failed-stats').textContent = `made it ${Math.round(game.progress * 100)}% of the way · ◆ ${game.runCoins} lost with the ship`;
  showOverlay('screen-failed');
  if (failsSinceAd >= ADS.interstitialEveryNFails) {
    failsSinceAd = 0;
    await ads.showInterstitial();
  }
}

// ---------------------------------------------------------------------------
// Revive (extra life) modal
// ---------------------------------------------------------------------------
const CRASH_LINES = {
  wall: 'SMASHED INTO A BARRIER',
  burn: 'BURNED ON A HAZARD TILE',
  fall: 'LOST IN THE VOID',
};

function openReviveModal() {
  $('revive-title').textContent = CRASH_LINES[game.crashType] || 'CRASHED!';
  $('revive-sub').textContent = `${Math.round(game.progress * 100)}% of the way there`;
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
  else openReviveModal(); // dismissed early — offer again with a fresh countdown
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
// HUD
// ---------------------------------------------------------------------------
$('btn-jump').addEventListener('pointerdown', (e) => { e.stopPropagation(); input.queueJump(); });
$('btn-fire').addEventListener('pointerdown', (e) => { e.stopPropagation(); game.shoot(); });
$('btn-slowmo').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (game.state !== 'running' || game.slowmoLeft > 0) return;
  if (save.get().slowmoCharges > 0) {
    if (game.activateSlowmo()) save.useSlowmo();
  } else {
    sfx.click(); // no charges — nudge toward the store
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
$('btn-restart').addEventListener('click', () => { sfx.click(); playLevel(currentLevelIndex); });
$('btn-quit').addEventListener('click', () => { sfx.click(); showBase('screen-menu'); });

function syncHud() {
  if (!$('hud').classList.contains('visible')) return;
  $('progress-fill').style.width = `${game.progress * 100}%`;
  $('hud-coins').textContent = game.runCoins;
  $('ammo-count').textContent = game.ammo;
  $('btn-fire').disabled = game.ammo <= 0;
  const sm = save.get().slowmoCharges;
  $('slowmo-count').textContent = game.slowmoLeft > 0 ? Math.ceil(game.slowmoLeft) : sm;
  $('btn-slowmo').classList.toggle('active', game.slowmoLeft > 0);
}

// ---------------------------------------------------------------------------
// Screens: complete / failed
// ---------------------------------------------------------------------------
$('btn-next').addEventListener('click', () => { sfx.click(); playLevel(currentLevelIndex + 1); });
$('btn-replay').addEventListener('click', () => { sfx.click(); playLevel(currentLevelIndex); });
$('btn-complete-menu').addEventListener('click', () => { sfx.click(); showBase('screen-menu'); });
$('btn-retry').addEventListener('click', () => { sfx.click(); playLevel(currentLevelIndex); });
$('btn-failed-menu').addEventListener('click', () => { sfx.click(); showBase('screen-menu'); });

// ---------------------------------------------------------------------------
// Level select
// ---------------------------------------------------------------------------
function buildLevelGrid() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  const { unlocked, best } = save.get();
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const cell = document.createElement('button');
    cell.className = 'level-cell';
    const b = best[i];
    if (i + 1 > unlocked) {
      cell.classList.add('locked');
      cell.innerHTML = `🔒`;
    } else {
      cell.innerHTML = `${i + 1}${b ? `<span class="best">${Math.round(b.pct)}%</span>` : ''}`;
      if (b && b.pct >= 100) cell.classList.add('done');
      cell.addEventListener('click', () => { sfx.click(); playLevel(i); });
    }
    grid.appendChild(cell);
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
function buildStore() {
  const coinWrap = $('store-coin-items');
  coinWrap.innerHTML = '';
  for (const item of CATALOG.coinItems) {
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
      if (earned) { save.addCoins(ADS.rewardedCoinReward); sfx.coin(); refreshWallets(); buildStore(); }
    },
    !ads.adsAvailable(),
  ));

  const iapWrap = $('store-iap-items');
  iapWrap.innerHTML = '';
  for (const item of CATALOG.iapItems) {
    if (item.id === 'removeads' && save.get().adsRemoved) continue;
    iapWrap.appendChild(storeRow(item, item.price, async () => {
      if (await purchaseIAP(item.id)) { sfx.win(); refreshWallets(); buildStore(); }
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
// Menu
// ---------------------------------------------------------------------------
$('btn-play').addEventListener('click', () => { sfx.click(); buildLevelGrid(); showBase('screen-levels'); });
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
showBase('screen-menu');

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
    game, input, save, renderer,
    playLevel,
    win() { game.ship.z = game.level.length - 0.5; },
    crash() { game._crash('wall'); },
    state() {
      return {
        state: game.state, z: game.ship.z, x: game.ship.x, y: game.ship.y,
        progress: game.progress, coins: game.runCoins, ammo: game.ammo,
        timeScale: game.timeScale, revivesUsed: game.revivesUsed,
        destroyed: game.destroyed.size, collected: game.collected.size,
      };
    },
  };
}

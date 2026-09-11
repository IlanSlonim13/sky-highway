// Sky Highway — economy + in-app purchases.
//
// Two currencies:
//   * coins  — earned by playing (pickups + level completion + streaks +
//              missions), spent on charges, ammo, ships and trails.
//   * money  — real IAP: coin packs, Starter Pack, Piggy Bank, Premium.
//
// The native IAP path is a single splice point (`purchaseIAP`): wire it to
// RevenueCat or cordova-plugin-purchase for store builds (see README). On web
// and in dev builds purchases are simulated behind a confirm dialog.

import { ECONOMY } from './config.js';
import { save } from './save.js';
import { setAdsRemoved as adsSetRemoved, hideBanner } from './ads.js';
import { grantShip, grantTrail } from './cosmetics.js';
import { mulberry32 } from './levels.js';
import { todayKey } from './daily.js';

export const CATALOG = {
  coinItems: [
    {
      id: 'slowmo3', icon: '🐌', name: `Slow-Mo ×${ECONOMY.slowmoPackSize}`,
      desc: 'Bend time for 6 seconds per charge', price: ECONOMY.slowmoPrice,
      grant: () => save.addCharges('slowmo', ECONOMY.slowmoPackSize),
    },
    {
      id: 'rewind3', icon: '⏪', name: `Rewind ×${ECONOMY.rewindPackSize}`,
      desc: 'Extra life: crash and rewind 3 seconds', price: ECONOMY.rewindPrice,
      grant: () => save.addCharges('rewind', ECONOMY.rewindPackSize),
    },
    {
      id: 'ammo6', icon: '🔸', name: 'Ammo ×6',
      desc: 'Start your next run with 6 shots banked', price: 40,
      grant: () => save.addPendingAmmo(6),
    },
  ],
  iapItems: [
    {
      id: 'premium', icon: '👑', name: 'PREMIUM', price: '$4.99', once: true,
      desc: 'No ads · 5 daily attempts · Aurora ship · Gold trail · +10% coins',
      grant: grantPremium,
      owned: () => save.isPremium(),
    },
    {
      id: 'starter', icon: '🚀', name: 'Starter Pack', price: '$0.99', once: true,
      desc: '300 coins · 3 rewinds · 3 slow-mo · Bolt ship',
      grant: grantStarter,
      owned: () => save.get().starterOwned,
    },
    { id: 'coins500', icon: '🪙', name: '500 Coins', desc: 'A pouch of coins', price: '$1.99', grant: () => save.addCoins(500) },
    { id: 'coins1500', icon: '💰', name: '1500 Coins', desc: 'A crate of coins', price: '$4.99', grant: () => save.addCoins(1500) },
  ],
};

function grantPremium() {
  save.setAdsRemoved(true);
  adsSetRemoved(true);
  hideBanner();
  grantShip('aurora');
  grantTrail('gold');
}

function grantStarter() {
  save.update((d) => { d.starterOwned = true; });
  save.addCoins(300);
  save.addCharges('rewind', 3);
  save.addCharges('slowmo', 3);
  grantShip('bolt');
}

// piggy bank: sold separately from the catalog rows (its card shows the fill level)
export const PIGGY_IAP = { id: 'piggy', icon: '🐷', name: 'Crack the Piggy Bank', price: '$1.99' };

// ---------------------------------------------------------------------------
// Daily Deal — one coin item at 50% off, rotating with the date (no backend)
// ---------------------------------------------------------------------------
export function todaysDeal() {
  const n = Number(todayKey().replace(/-/g, ''));
  const rng = mulberry32((n ^ 0xDEA1) >>> 0);
  const item = CATALOG.coinItems[Math.floor(rng() * CATALOG.coinItems.length)];
  return { ...item, dealPrice: Math.round(item.price / 2) };
}

export function buyWithCoins(id) {
  const item = CATALOG.coinItems.find((i) => i.id === id);
  if (!item) return false;
  const deal = todaysDeal();
  const price = deal.id === id ? deal.dealPrice : item.price;
  if (!save.spendCoins(price)) return false;
  item.grant();
  return true;
}

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export async function purchaseIAP(id) {
  const item = id === 'piggy'
    ? { ...PIGGY_IAP, grant: () => save.crackBank() }
    : CATALOG.iapItems.find((i) => i.id === id);
  if (!item) return false;
  if (item.owned && item.owned()) return false;

  if (isNative()) {
    // ── NATIVE IAP SPLICE POINT ─────────────────────────────────────────
    // Wire your billing plugin here, e.g. RevenueCat:
    //   const { customerInfo } = await Purchases.purchaseProduct(id);
    //   if (!customerInfo) return false;
    // For now, refuse silently rather than granting unpaid product.
    console.warn('Native IAP not wired for', id, '— see README "In-App Purchases"');
    return false;
    // ────────────────────────────────────────────────────────────────────
  }

  // Web / dev simulation
  const ok = window.confirm(`Simulated purchase (dev build):\n${item.name} — ${item.price}\n\nGrant it?`);
  if (!ok) return false;
  item.grant();
  return true;
}

export async function restorePurchases() {
  if (isNative()) {
    // RevenueCat: const info = await Purchases.restorePurchases(); apply entitlements.
    return false;
  }
  return false;
}

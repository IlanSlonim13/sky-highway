// Sky Highway — economy + in-app purchases.
//
// Two currencies:
//   * coins  — earned by playing (pickups + level completion), spent on
//              slow-mo charges, rewind charges and ammo.
//   * money  — real IAP for coin packs and "remove ads".
//
// The native IAP path is a single splice point (`purchaseIAP`): wire it to
// RevenueCat or cordova-plugin-purchase for store builds (see README). On web
// and in dev builds purchases are simulated behind a confirm dialog.

import { ECONOMY } from './config.js';
import { save } from './save.js';
import { setAdsRemoved as adsSetRemoved, hideBanner } from './ads.js';

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
      desc: 'Start your next runs with 6 shots banked', price: 40,
      grant: () => { pendingAmmo += 6; },
    },
  ],
  iapItems: [
    { id: 'coins500', icon: '🪙', name: '500 Coins', desc: 'A pouch of coins', price: '$1.99', grant: () => save.addCoins(500) },
    { id: 'coins1500', icon: '💰', name: '1500 Coins', desc: 'A crate of coins', price: '$4.99', grant: () => save.addCoins(1500) },
    { id: 'removeads', icon: '🚫', name: 'Remove Ads', desc: 'No more banners & interstitials, forever', price: '$2.99', grant: grantRemoveAds },
  ],
};

// Ammo bought in the store is banked and loaded into the next run.
export let pendingAmmo = 0;
export function takePendingAmmo() { const a = pendingAmmo; pendingAmmo = 0; return a; }

function grantRemoveAds() {
  save.setAdsRemoved(true);
  adsSetRemoved(true);
  hideBanner();
}

export function buyWithCoins(id) {
  const item = CATALOG.coinItems.find((i) => i.id === id);
  if (!item || !save.spendCoins(item.price)) return false;
  item.grant();
  return true;
}

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export async function purchaseIAP(id) {
  const item = CATALOG.iapItems.find((i) => i.id === id);
  if (!item) return false;

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

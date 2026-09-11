// Sky Highway — advertising abstraction.
//
// Native (Android/iOS via Capacitor): uses @capacitor-community/admob when the
// plugin is present. The IDs below are Google's official TEST ad units —
// replace them with your real AdMob unit IDs before release (see README).
//
// Web / dev: simulated DOM overlay ads so the full monetization flow is
// testable in a browser. The rewarded simulation has a real countdown and can
// be dismissed early without granting the reward, matching native behavior.

const ADMOB_TEST_IDS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

let adsRemoved = false;
let nativeAdmob = null; // resolved AdMob plugin, if running natively

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export async function initAds(removed) {
  adsRemoved = !!removed;
  if (!isNative()) return;
  try {
    const plugin = window.Capacitor?.Plugins?.AdMob;
    if (plugin) {
      nativeAdmob = plugin;
      await nativeAdmob.initialize({
        initializeForTesting: false,
        // store-compliance defaults; align with your Play/App Store rating
        maxAdContentRating: 'T',
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });
    }
  } catch (e) {
    console.warn('AdMob unavailable, ads disabled on native:', e);
    nativeAdmob = null;
  }
}

export function setAdsRemoved(v) {
  adsRemoved = v;
  if (v) hideBanner();
}

export function adsAvailable() {
  // web sim is always "available"; native requires the plugin
  return !isNative() || !!nativeAdmob;
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------
export async function showBanner() {
  if (adsRemoved) return;
  if (nativeAdmob) {
    try {
      await nativeAdmob.showBanner({ adId: ADMOB_TEST_IDS.banner, position: 'BOTTOM_CENTER', margin: 0 });
    } catch { /* no fill / not ready */ }
    return;
  }
  if (isNative()) return;
  document.getElementById('sim-banner')?.classList.add('visible');
}

export async function hideBanner() {
  if (nativeAdmob) {
    try { await nativeAdmob.hideBanner(); } catch { /* ignore */ }
    return;
  }
  document.getElementById('sim-banner')?.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Interstitial — resolves when the ad is closed.
// ---------------------------------------------------------------------------
export async function showInterstitial() {
  if (adsRemoved) return;
  if (nativeAdmob) {
    try {
      await nativeAdmob.prepareInterstitial({ adId: ADMOB_TEST_IDS.interstitial });
      await nativeAdmob.showInterstitial();
    } catch { /* no fill — never block the game on ads */ }
    return;
  }
  if (isNative()) return;
  return simOverlay({ rewarded: false });
}

// ---------------------------------------------------------------------------
// Rewarded — resolves true only if the user earned the reward.
// Rewarded ads stay available even when "remove ads" was purchased: they are
// user-initiated value exchanges, not interruptions.
// ---------------------------------------------------------------------------
export async function showRewarded() {
  if (nativeAdmob) {
    try {
      await nativeAdmob.prepareRewardVideoAd({ adId: ADMOB_TEST_IDS.rewarded });
      const result = await nativeAdmob.showRewardVideoAd();
      return !!(result && (result.type || result.amount !== undefined));
    } catch {
      return false;
    }
  }
  if (isNative()) return false;
  return simOverlay({ rewarded: true });
}

// ---------------------------------------------------------------------------
// Web simulation overlay
// ---------------------------------------------------------------------------
function simOverlay({ rewarded }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sim-ad';
    wrap.innerHTML = `
      <div class="sim-ad-card">
        <div class="sim-ad-label">${rewarded ? 'REWARDED AD' : 'ADVERTISEMENT'}</div>
        <div class="sim-ad-art">▲<br>SIMULATED AD<br><span>(dev build — AdMob replaces this on device)</span></div>
        <button class="sim-ad-close" disabled>✕</button>
        <button class="sim-ad-claim" hidden>CLAIM REWARD</button>
        <div class="sim-ad-count"></div>
      </div>`;
    document.body.appendChild(wrap);
    const closeBtn = wrap.querySelector('.sim-ad-close');
    const claimBtn = wrap.querySelector('.sim-ad-claim');
    const count = wrap.querySelector('.sim-ad-count');
    let secs = rewarded ? 5 : 3;
    count.textContent = secs;
    const timer = setInterval(() => {
      secs--;
      if (secs > 0) { count.textContent = secs; return; }
      clearInterval(timer);
      count.textContent = '';
      closeBtn.disabled = false;
      if (rewarded) claimBtn.hidden = false;
    }, 1000);
    const finish = (earned) => {
      clearInterval(timer);
      wrap.remove();
      resolve(rewarded ? earned : undefined);
    };
    closeBtn.addEventListener('click', () => finish(false));
    claimBtn.addEventListener('click', () => finish(true));
  });
}

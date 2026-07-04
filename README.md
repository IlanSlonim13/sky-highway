# Sky Highway 🛸

A **SkyRoads-style retro arcade runner** built for mobile. Pilot a neon ship down highways
suspended in space: jump gaps, weave through blocks, blast destructible barriers, and chase
the finish gate across **100 levels**.

Built as a fully self-contained HTML5 game (zero runtime dependencies) wrapped with
[Capacitor](https://capacitorjs.com) for Android and iOS.

## Features

- 🎮 **100 levels** — 10 handcrafted + 90 procedurally generated, every one *provably
  completable* (a BFS solver validates each level, including with zero shots fired)
- 🐌 **Slow motion** — purchasable charges that bend time for 6 seconds
- ⏪ **Extra life with 3-second rewind** — crash, watch a rewarded ad (or spend a purchased
  rewind charge), and the game rewinds 3 seconds so you can try the section again
- 🔫 **Destructible barriers & ammo** — pick up energy cells and blast orange barriers for
  bonus coins, or steer around them (never required to shoot)
- 🪙 **Coin economy** — collect coins on the track, buy slow-mo / rewind / ammo packs
- 📺 **Ads** — AdMob banner + interstitial + rewarded, with a "Remove Ads" IAP
- 📱 **Mobile-first** — touch steering (drag) + tap to jump, HUD buttons, safe-area aware,
  portrait & landscape, works offline

## Play in a browser (dev)

```bash
python3 -m http.server 8080 -d www     # or: npm run serve
# open http://localhost:8080
```

Controls: **drag** to steer, **tap** to jump (or the ▲ button), **⌖** fires, **🐌** slow motion.
Keyboard: arrows / A-D steer, Space jumps, F fires, P pauses.

Append `?debug` to the URL to expose `window.__shq` testing hooks.

## Build for Android

```bash
npm install
npx cap add android
npx cap sync
npx cap open android    # builds/runs from Android Studio
```

**AdMob setup (Android):**
1. Create an AdMob app + 3 ad units (banner, interstitial, rewarded).
2. Replace the test IDs in `www/js/ads.js` (`ADMOB_TEST_IDS`) with your real unit IDs.
3. Replace `appIdAndroid` in `capacitor.config.json` with your AdMob **app** ID.
4. The `@capacitor-community/admob` plugin injects the required
   `com.google.android.gms.ads.APPLICATION_ID` meta-data from that config; verify it in
   `android/app/src/main/AndroidManifest.xml` after `cap sync`.

## Build for iOS

```bash
npm install
npx cap add ios
npx cap sync
npx cap open ios        # builds/runs from Xcode
```

**iOS notes:**
- Set your AdMob app ID as `appIdIos` in `capacitor.config.json` (becomes `GADApplicationIdentifier`).
- Add `NSUserTrackingUsageDescription` to `Info.plist` if you enable personalized ads,
  and present the App Tracking Transparency prompt before loading them.

**App icons/splash for both platforms:** `npx @capacitor/assets generate --iconBackgroundColor '#050014'`
using `www/assets/icon.svg` as the source.

## In-App Purchases

The store UI and product catalog live in `www/js/store.js`. Products:

| id         | type           | grants                    | suggested price |
|------------|----------------|---------------------------|-----------------|
| `coins500` | consumable     | 500 coins                 | $1.99           |
| `coins1500`| consumable     | 1500 coins                | $4.99           |
| `removeads`| non-consumable | disables banner + interstitials | $2.99     |

On web/dev builds purchases are **simulated** behind a confirm dialog. For store builds,
wire real billing at the single splice point marked `NATIVE IAP SPLICE POINT` in
`purchaseIAP()` — [RevenueCat](https://www.revenuecat.com/docs/getting-started/installation/capacitor)
(recommended) or `cordova-plugin-purchase` both drop in cleanly. Until wired, native builds
refuse IAPs rather than granting unpaid product. Slow-mo, rewind and ammo packs are bought
with **in-game coins**, so they work everywhere with no billing setup.

## Level design

Levels are 7-lane grids, one character per cell (`www/js/levels.js`):

| char | meaning                       | char | meaning                         |
|------|-------------------------------|------|---------------------------------|
| `.`  | void (gap)                    | `C`  | floor + coin                    |
| `#`  | floor                         | `c`  | floating coin (over a gap)      |
| `^`  | low block — jump it           | `X`  | hazard floor — deadly           |
| `H`  | tall block — avoid            | `D`  | destructible barrier — shoot or avoid |
| `B`  | boost pad                     | `A`  | floor + ammo pickup (+3 shots)  |
| `J`  | bounce pad (high jump)        |      |                                 |

Levels 1–10 are handcrafted with the builder DSL; levels 11–100 come from a seeded
generator that carves a guaranteed-safe path first and decorates around it. Validate any
change with:

```bash
npm run validate     # BFS-solves all 100 levels; must print 100/100
```

## Project layout

```
www/            game (Capacitor webDir)
  js/config.js    all tuning constants
  js/levels.js    themes, 10 handcrafted levels, generator, solver
  js/game.js      simulation: physics, rewind ring buffer, slow-mo, shooting
  js/renderer.js  pseudo-3D canvas renderer
  js/main.js      screens, HUD, revive flow, wiring
  js/ads.js       AdMob abstraction + web-simulated ads
  js/store.js     coin economy + IAP splice point
tools/          validate-levels.mjs
```

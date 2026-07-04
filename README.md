# Sky Highway 🛸

A **SkyRoads-style retro arcade runner** built for mobile. Pilot a neon ship down highways
suspended in space: jump gaps, weave through blocks, blast destructible barriers, and chase
the finish gate across **100 levels**.

Built as a fully self-contained HTML5 game (zero runtime dependencies) wrapped with
[Capacitor](https://capacitorjs.com) for Android and iOS.

## Features

**Three modes**
- 🗺️ **Campaign** — 100 levels: 10 handcrafted + 90 procedurally generated, every one
  *provably completable* (a BFS solver validates each level, including with zero shots fired)
- 📅 **Today's Run** — a daily challenge where *the date is the seed*: everyone on Earth
  flies the same track each day, no server needed. 3 attempts/day (5 for Premium, +1 per
  rewarded ad), medals (🥉🥈🥇), and a **streak** with escalating rewards, 7-day chests and
  a streak-saver (ad or coins) when you miss a single day
- ∞ **Hyperdrive** — endless mode that streams track forever and keeps speeding up; the
  track rotates daily, chase your best distance & score

**The twist: 👻 Echo Ghosts — race your own past.** Every run is recorded (~3 KB/min,
all local). Your best run replays as a translucent echo ship flying beside you — and right
after a crash, your failed attempt's echo joins the next try. Beat your echo to the finish
for bonus coins. Combined with the 3-second-rewind revive, time manipulation is the game's
identity.

**Core mechanics**
- 🐌 **Slow motion** — purchasable charges that bend time for 6 seconds
- ⏪ **Extra life with 3-second rewind** — crash, watch a rewarded ad (or spend a purchased
  rewind charge), and the game rewinds 3 seconds; echoes keep flying, coins/ammo/barriers
  inside the rewound window are restored
- 🔫 **Destructible barriers & ammo** — blast orange barriers for bonus coins, or steer
  around them (never required)
- ⚡ **Flow meter** — coins, near-misses, cleared gaps and barrier kills chain a ×1–×5
  multiplier on everything you earn; crash and it's gone

**Engagement & economy**
- 🎯 **3 daily missions** (date-rotated) + **12 lifetime achievements** with coin/ship rewards
- 🛠 **Hangar** — 8 ships and 6 trails: coins, achievements, Starter Pack and Premium unlocks
- 🐷 **Piggy Bank** — 10% of all earnings pile up; crack it with an IAP or 3 rewarded ads
- 🪙 Coin sinks: slow-mo, rewinds, ammo, ships, trails, streak savers
- 📺 **Ads** — AdMob banner + interstitial + rewarded placements (extra life, double coins,
  extra daily attempt, streak saver, double mission reward, piggy bank, free coins)
- 👑 **Premium ($4.99)** — no banners/interstitials, 5 daily attempts, exclusive Aurora
  ship + Gold trail, +10% coin earnings (rewarded ads stay available by choice)
- 📱 **Mobile-first** — touch steering (drag) + tap to jump, HUD buttons, safe-area aware,
  portrait & landscape, works offline (all progress in localStorage)

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

| id         | type           | grants                                                | suggested price |
|------------|----------------|-------------------------------------------------------|-----------------|
| `premium`  | non-consumable | no ads · 5 daily attempts · Aurora ship · Gold trail · +10% coins | $4.99 |
| `starter`  | non-consumable | 300 coins · 3 rewinds · 3 slow-mo · Bolt ship         | $0.99           |
| `coins500` | consumable     | 500 coins                                             | $1.99           |
| `coins1500`| consumable     | 1500 coins                                            | $4.99           |
| `piggy`    | consumable     | cracks the piggy bank (up to 500 banked coins)        | $1.99           |

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

## Streak reminders (local notifications)

`www/js/main.js` schedules a daily 19:00 "keep your streak alive" reminder through
`@capacitor/local-notifications` (permission is requested only after the player completes
their first daily — never on first launch). Install it for native builds:

```bash
npm install @capacitor/local-notifications && npx cap sync
```

On web the call is a silent no-op. An in-app review prompt hook fires once after the 3rd
level win when a rate-app plugin is present (`RateApp.requestReview`).

## Project layout

```
www/            game (Capacitor webDir)
  js/config.js    all tuning constants
  js/levels.js    TrackBuilder, campaign/daily/endless generators, solver
  js/game.js      simulation: physics, rewind buffer, slow-mo, shooting, flow, echo feed
  js/daily.js     daily challenge: attempts, streaks, medals, missions (node-testable)
  js/echo.js      echo ghost recording/replay + packed storage (node-testable)
  js/cosmetics.js ships & trails
  js/renderer.js  pseudo-3D canvas renderer (echo ships, trails, flow glow)
  js/main.js      screens, HUD, revive/daily/results flows, achievements, wiring
  js/ads.js       AdMob abstraction + web-simulated ads
  js/store.js     coin economy, premium/starter/piggy, IAP splice point
tools/          validate-levels.mjs (solver + pinned campaign hash + daily seeds)
                test-daily-echo.mjs (unit tests)
                build-single.mjs (bundle the game into one HTML file)
```

# Sky Highway — Store Distribution Runbook

Everything needed to take this repo to the Apple App Store and Google Play. Do the
**Shared prep** once, then the platform sections.

## Shared prep

1. **Install & generate platforms**
   ```bash
   npm install
   npx cap add android && npx cap add ios
   npx @capacitor/assets generate --iconBackgroundColor '#050014'   # uses resources/icon.png + splash.png
   npx cap sync
   ```
   (Regenerate `resources/` any time with `node tools/gen-store-assets.mjs`.)
2. **Replace ad test IDs** — `www/js/ads.js` `ADMOB_TEST_IDS` (3 unit IDs) and the two
   AdMob **app** IDs in `capacitor.config.json`. Until then the game serves Google's
   official test ads (safe for review builds, NOT for release).
3. **Wire real billing** — one splice point: `purchaseIAP()` in `www/js/store.js`.
   Recommended: RevenueCat Capacitor SDK. Create these products in both stores:

   | product id | type | price |
   |---|---|---|
   | `premium`   | non-consumable | $4.99 |
   | `starter`   | non-consumable | $0.99 |
   | `coins500`  | consumable     | $1.99 |
   | `coins1500` | consumable     | $4.99 |
   | `piggy`     | consumable     | $1.99 |

4. **Host the privacy policy** — publish `PRIVACY-POLICY.md` (fill in the two
   placeholders) at a public URL (GitHub Pages is fine); both store consoles require it.
   Also update the `privacy-link` href in `www/index.html` to that URL.
5. **Version bump** — `APP_VERSION` in `www/js/config.js`, `versionName`/`versionCode`
   (Android, `android/app/build.gradle`), `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`
   (iOS, Xcode target).

## Google Play

1. **Signing**: `keytool -genkeypair -v -keystore release.keystore -alias skyhighway
   -keyalg RSA -keysize 2048 -validity 10000`; configure `signingConfigs.release` in
   `android/app/build.gradle` (keep the keystore OUT of git). Enroll in Play App Signing.
2. **Build**: Android Studio → Build → Generate Signed App Bundle (`.aab`), or
   `cd android && ./gradlew bundleRelease`.
3. **Android 13+ notifications**: `@capacitor/local-notifications` declares
   `POST_NOTIFICATIONS`; the game requests it only after the first daily completion —
   nothing else to do.
4. **Play Console — Data safety form** (matches this codebase):
   - Does your app collect or share user data? **Yes** (via AdMob SDK only).
   - Data types: *Device or other IDs* (advertising ID) — collected, shared, ads
     purposes; not processed ephemerally; collection optional? No.
   - App data itself: none collected (all progress is on-device).
   - Data encrypted in transit: Yes. Deletion: data is on-device; uninstalling deletes it.
5. **Content rating questionnaire**: arcade game; no violence against realistic humans
   (stylized ship explosions), no gambling with real money (prize wheel awards virtual
   goods with no purchase requirement), contains ads, contains IAP. Expected rating:
   **Everyone / PEGI 3-7**.
6. **Ads declaration**: Yes, contains ads (AdMob).
7. **Store listing**: copy from `STORE-LISTING.md`; screenshots per its shot list.
8. Release to **internal testing** first, then closed → production.

## Apple App Store

1. **Xcode setup** (`npx cap open ios`): set Team + bundle id `com.minols.skyhighway`;
   Signing & Capabilities → add **In-App Purchase**.
2. **Info.plist** additions:
   - `NSUserTrackingUsageDescription` — e.g. *"Your data will be used to show you more
     relevant ads."* Present the ATT prompt before loading personalized ads (the AdMob
     plugin's `requestTrackingAuthorization()` — call it once at first ad init; without
     consent AdMob serves non-personalized ads automatically).
   - `GADApplicationIdentifier` — injected from `capacitor.config.json` by the plugin;
     verify after `cap sync`.
   - **SKAdNetworkItems** — add Google's current SKAdNetwork ID list (at minimum
     `cstr6suwn9.skadnetwork`); copy the full list from
     https://developers.google.com/admob/ios/quick-start#update_your_infoplist
3. **App Privacy (nutrition label)**: Data used to track you: *Identifiers (Device ID)* —
   only if user grants ATT; Data linked to you: none; Data not linked to you:
   *Identifiers, Coarse Location (IP-derived), Usage Data* — Advertising (Google AdMob).
   The app itself collects nothing.
4. **Build & upload**: Product → Archive → Distribute → App Store Connect; test via
   TestFlight before submission.
5. **Review notes**: mention ads are AdMob test units in review builds if you haven't
   swapped IDs yet, and that no account is needed.

## Release checklist

- [ ] Real AdMob app + unit IDs in place (`ads.js`, `capacitor.config.json`)
- [ ] Billing wired (`store.js` splice point) + products created in both consoles
- [ ] Privacy policy hosted + linked in app and both listings
- [ ] `APP_VERSION` + platform version numbers bumped
- [ ] `npm test` green (level validator + unit tests)
- [ ] Icons/splash generated (`npx @capacitor/assets generate`)
- [ ] Play data-safety + rating questionnaires filed
- [ ] iOS ATT prompt verified + SKAdNetworkItems present
- [ ] Internal/TestFlight pass on real devices (test ads fill, IAP sandbox, notifications)

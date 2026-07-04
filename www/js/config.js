// Sky Highway — global tuning constants.
// All distances are in tile units (1 tile = 1 unit wide, 1 unit long).

export const TRACK_LANES = 7;          // lanes -3 .. +3
export const LANE_MIN = -3;
export const LANE_MAX = 3;

export const PHYSICS = {
  gravity: 15.0,          // units/s^2
  jumpVelocity: 5.0,      // units/s
  bouncePadVelocity: 7.4, // units/s (jump pad)
  lateralSpeed: 4.2,      // max lanes/s while steering
  lateralAccel: 26.0,     // lanes/s^2
  stepTolerance: 0.28,    // max ground height step the ship can slide up
  fallDeathY: -3.0,       // below this = fell into the void
  coyoteTime: 0.10,       // s of grace after leaving an edge
  jumpBuffer: 0.12,       // s a jump tap is remembered before landing
};

export const SHIP = {
  halfWidth: 0.30,        // collision half width in lanes
  noseAhead: 0.35,        // collision probe ahead of center
};

export const BOOST = {
  speedMultiplier: 1.55,
  duration: 1.6,          // s
};

export const SLOWMO = {
  timeScale: 0.45,
  duration: 6.0,          // s of real time
  rampTime: 0.35,         // s to ease in/out
};

export const REWIND = {
  seconds: 3.0,           // how far back a revive rewinds
  historyHz: 30,          // snapshot rate
  historySeconds: 8.0,    // ring buffer length
  resumeRamp: 1.2,        // s of slow-mo ramp after revive so player can react
};

export const CAMERA = {
  back: 5.2,              // camera distance behind ship
  height: 2.05,           // camera height above track
  horizon: 0.36,          // horizon line as fraction of screen height
  drawRows: 44,           // rows of track rendered ahead
  fovScale: 1.18,         // focal length = min(w,h) * fovScale
};

export const ECONOMY = {
  coinValue: 1,
  levelCompleteBonusBase: 20,   // + level index
  slowmoPrice: 60,              // coins per 3 charges
  slowmoPackSize: 3,
  rewindPrice: 80,              // coins per 3 charges
  rewindPackSize: 3,
  startingSlowmo: 2,            // free charges for new players
  startingRewind: 2,
};

export const ADS = {
  interstitialEveryNFails: 3,   // show interstitial after every 3rd failed run
  interstitialEveryNWins: 2,    // and after every 2nd completed level
  rewardedRewindReward: 1,      // rewind charges granted per rewarded ad
  rewardedCoinReward: 40,       // coins granted per rewarded ad
};

export const WEAPON = {
  projectileSpeed: 22,    // tiles/s, relative to track
  projectileRange: 18,    // rows before a bolt fizzles
  maxAmmo: 9,
  ammoPerPickup: 3,
  startingAmmo: 0,
  destroyReward: 5,       // coins per destroyed barrier
};

export const MAX_REVIVES_PER_RUN = 2;

export const BLOCK_HEIGHTS = { low: 0.55, tall: 1.15 };

// Cell type characters used by the level format.
export const CELL = {
  EMPTY: '.',
  FLOOR: '#',
  LOW: '^',      // low block on floor — must jump
  TALL: 'H',     // tall block — must avoid
  BOOST: 'B',    // speed pad
  PAD: 'J',      // bounce pad (high jump)
  COIN: 'C',     // floor with a coin above it
  COIN_AIR: 'c', // floating coin over the void — grab it mid-jump
  HAZARD: 'X',   // burning floor — deadly to touch
  DESTRUCTIBLE: 'D', // shootable barrier — blast it or steer around it
  AMMO: 'A',     // floor with an ammo cell above it
};

// Sky Highway — simulation core.
//
// Fixed-timestep physics (1/120s) scaled by an eased timeScale (slow-mo,
// crash ramps). A ring buffer of state snapshots powers the 3-second-rewind
// revive. The Game never touches persistence or DOM UI: main.js listens via
// the `events` callbacks and drives revive/slow-mo after charges are spent.

import {
  PHYSICS, SHIP, BOOST, SLOWMO, REWIND, CELL, BLOCK_HEIGHTS, WEAPON, FLOW, CAMERA,
  DEBRIS, RING, COMETS,
} from './config.js';
import { sfx } from './audio.js';
import { EchoRecorder } from './echo.js';

const STEP = 1 / 120;

export class Game {
  constructor(input) {
    this.input = input;
    this.events = {}; // { onCrash(type), onComplete(results), onReviveDone() }
    this.attract = false;
    this.level = null;
    this.state = 'idle';
  }

  loadLevel(level, { attract = false, startAmmo = 0, echoPlayer = null } = {}) {
    this.level = level;
    this.attract = attract;
    this.mode = level.endless ? 'endless' : level.daily ? 'daily' : 'campaign';
    this.state = attract ? 'attract' : 'ready';

    // echo ghost: replay of a past run racing beside the player
    this.echoPlayer = echoPlayer;
    this.echoClock = 0;      // advances with game time but is NOT rewound by revives
    this.echoPos = null;
    this.beatEcho = false;
    this.recorder = attract ? null : new EchoRecorder();

    // flow meter (style combo -> coin/score multiplier x1..x5)
    this.flow = 1;
    this.flowEvents = 0;
    this.flowTimer = 0;

    // per-run stat deltas, applied to missions/achievements by main.js at run end
    this.runStats = { coins: 0, airCoins: 0, barriers: 0, jumps: 0, revives: 0, slowmos: 0, maxFlow: 1, gaps: 0, nearMisses: 0, rings: 0 };
    this._holdT = 0;          // seconds the current jump has been sustained
    this._sustain = false;    // whether the current airtime responds to holding
    this.comets = [];         // incoming comet strikes (later levels)
    this._cometTimer = COMETS.basePeriodS * 0.8; // grace before the first one
    this._takeoffZ = null;
    this._nearMissRow = -1;
    this.trailPoints = [];

    this.ship = {
      x: 0, y: 0, z: 0, vy: 0, vx: 0, bank: 0,
      grounded: true, speedMul: 1, boostT: 0,
    };
    this.time = 0;             // game-time seconds since level start
    this.timeScale = 1;
    this._timeScaleTarget = 1;

    this.runCoins = 0;
    this.ammo = Math.min(WEAPON.maxAmmo, startAmmo);
    this.collected = new Set();
    this._collectedOrder = [];
    this.destroyed = new Set();
    this._destroyedOrder = [];
    this.projectiles = [];
    this.particles = [];

    this.coyote = 0;
    this.jumpBuf = 0;
    this.shake = 0;
    this.shipVisible = true;
    this.crashType = null;
    this.revivesUsed = 0;

    this.slowmoLeft = 0;       // real seconds of slow-mo remaining
    this.slowmoVisual = 0;
    this.rewindVisual = 0;
    this.rewindGhosts = null;

    this._acc = 0;
    this._crashTimer = 0;
    this._rewindAnim = null;
    this._snapAcc = 0;
    this.history = [];         // ring buffer of snapshots

    this.groundInfoForRender = this._sampleGround(0, 0);
  }

  start() {
    if (this.state !== 'ready') return;
    // drop drag/taps accumulated on the menus (incl. the launch tap itself),
    // or the first running frame would consume them as a steer/jump
    this.input.reset();
    this.state = 'running';
  }

  get progress() {
    if (!this.level || !isFinite(this.level.length)) return 0;
    return Math.min(1, this.ship.z / this.level.length);
  }

  get distance() { return Math.floor(this.ship.z); }

  get score() { return Math.floor(this.ship.z) + this.runCoins * 10; }

  get currentSpeed() {
    return this.level.speedAt ? this.level.speedAt(this.ship.z) : this.level.speed;
  }

  // one style event (coin, near-miss, barrier, cleared gap) feeds the flow combo
  _styleEvent() {
    this.flowTimer = FLOW.decaySeconds;
    if (this.flow >= FLOW.maxTier) return;
    this.flowEvents++;
    if (this.flowEvents >= FLOW.eventsPerTier) {
      this.flowEvents = 0;
      this.flow++;
      this.runStats.maxFlow = Math.max(this.runStats.maxFlow, this.flow);
      sfx.flowUp(this.flow);
    }
  }

  // ------------------------------------------------------------------
  // Frame driver — called once per rAF with real dt (seconds).
  // ------------------------------------------------------------------
  frame(dtReal) {
    dtReal = Math.min(dtReal, 0.05);
    this.input.update();

    // ease timeScale toward target
    const ease = Math.min(1, dtReal / SLOWMO.rampTime);
    this.timeScale += (this._timeScaleTarget - this.timeScale) * ease * 2.2;

    // slow-mo countdown runs on real time
    if (this.slowmoLeft > 0 && this.state === 'running') {
      this.slowmoLeft -= dtReal;
      if (this.slowmoLeft <= 0) { this.slowmoLeft = 0; this._timeScaleTarget = 1; }
    }
    this.slowmoVisual += ((this.slowmoLeft > 0 ? 1 : 0) - this.slowmoVisual) * Math.min(1, dtReal * 6);

    this.shake = Math.max(0, this.shake - dtReal * 2);

    switch (this.state) {
      case 'attract':
        this.ship.z += this.level.speed * 0.45 * dtReal;
        if (this.ship.z > this.level.length - 45) this.ship.z = 0;
        break;

      case 'running': {
        if (this.level.ensureRows) this.level.ensureRows(Math.floor(this.ship.z) + CAMERA.drawRows + 20);
        const dt = dtReal * this.timeScale;
        this._acc += dt;
        while (this._acc >= STEP && this.state === 'running') {
          this._acc -= STEP;
          this._step(STEP);
        }
        break;
      }

      case 'crashing':
        this._crashTimer -= dtReal;
        this._updateParticles(dtReal * this.timeScale);
        if (this._crashTimer <= 0) {
          this.state = 'reviveOffer';
          this.events.onCrash?.(this.crashType);
        }
        break;

      case 'rewinding':
        this._stepRewindAnim(dtReal);
        break;

      default:
        this._updateParticles(dtReal);
        break;
    }

    this.rewindVisual += ((this.state === 'rewinding' ? 1 : 0) - this.rewindVisual) * Math.min(1, dtReal * 8);
    this.groundInfoForRender = this._sampleGround(this.ship.x, this.ship.z);

    // echo ghost position for the renderer (frozen while the world is frozen)
    this.echoPos = this.echoPlayer ? this.echoPlayer.positionAt(this.echoClock) : null;

    // engine trail ribbon
    if (this.state === 'running' && this.shipVisible) {
      this.trailPoints.push({ x: this.ship.x, y: this.ship.y + 0.1, z: this.ship.z });
      if (this.trailPoints.length > 16) this.trailPoints.shift();
    } else if (this.state !== 'paused' && this.state !== 'reviveOffer') {
      if (this.trailPoints.length) this.trailPoints.shift();
    }
  }

  // ------------------------------------------------------------------
  // One physics step (dt is game-time).
  // ------------------------------------------------------------------
  _step(dt) {
    const s = this.ship;
    const level = this.level;
    this.time += dt;
    this.echoClock += dt;
    this.recorder?.feed(dt, s);

    // flow decay
    if (this.flowTimer > 0) {
      this.flowTimer -= dt;
      if (this.flowTimer <= 0 && this.flow > 1) {
        this.flow--;
        this.flowEvents = 0;
        this.flowTimer = FLOW.decaySeconds * 0.6;
      }
    }

    // --- forward ---
    if (s.boostT > 0) {
      s.boostT -= dt;
      s.speedMul = 1 + (BOOST.speedMultiplier - 1) * Math.min(1, s.boostT / (BOOST.duration * 0.6));
    } else s.speedMul = 1;
    s.z += this.currentSpeed * s.speedMul * dt;

    // --- lateral: touch drag is direct, keyboard is velocity-based ---
    const drag = this.input.consumeDrag();
    let dx = 0;
    if (drag !== 0) {
      dx = Math.max(-0.45, Math.min(0.45, drag));
      s.vx = dx / Math.max(dt, 1e-4) * 0.35; // remember momentum for banking
    } else {
      const target = this.input.axis * PHYSICS.lateralSpeed;
      s.vx += (target - s.vx) * Math.min(1, PHYSICS.lateralAccel * dt / PHYSICS.lateralSpeed);
      dx = s.vx * dt;
    }
    s.x = Math.max(-3.35, Math.min(3.35, s.x + dx));
    const bankTarget = Math.max(-1, Math.min(1, s.vx / PHYSICS.lateralSpeed));
    s.bank += (bankTarget - s.bank) * Math.min(1, dt * 10);

    // --- jump buffering ---
    if (this.input.consumeJump()) this.jumpBuf = PHYSICS.jumpBuffer;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    // --- fire ---
    if (this.input.consumeFire()) this._fire();

    // --- ground interaction ---
    const g = this._sampleGround(s.x, s.z);
    const prevY = s.y;

    if (s.grounded) {
      if (this.jumpBuf > 0) {
        this.jumpBuf = 0;
        s.vy = PHYSICS.jumpVelocity;
        s.grounded = false;
        this._holdT = 0;
        this._sustain = true; // hold the button to keep rising longer
        this.runStats.jumps++;
        this._takeoffZ = s.z;
        sfx.jump();
      } else if (g.height === -Infinity) {
        s.grounded = false;
        this.coyote = PHYSICS.coyoteTime;
        s.vy = 0;
        if (this._takeoffZ === null) this._takeoffZ = s.z;
      } else if (g.height > s.y + PHYSICS.stepTolerance) {
        return this._crash('wall');
      } else if (g.height < s.y - 0.3) {
        s.grounded = false;      // stepped off a block edge
        this.coyote = PHYSICS.coyoteTime;
        s.vy = 0;
      } else {
        s.y = g.height;
        if (g.hazard) return this._crash('burn');
        if (g.pad) { s.vy = PHYSICS.bouncePadVelocity; s.grounded = false; this._sustain = false; sfx.pad(); }
        else if (g.boost && s.boostT <= BOOST.duration * 0.3) { s.boostT = BOOST.duration; sfx.boost(); }
      }
    } else {
      // airborne
      if (this.coyote > 0) {
        this.coyote -= dt;
        if (this.jumpBuf > 0) {
          this.jumpBuf = 0; this.coyote = 0;
          s.vy = PHYSICS.jumpVelocity;
          this._holdT = 0;
          this._sustain = true;
          this.runStats.jumps++;
          this._takeoffZ = s.z;
          sfx.jump();
        }
      }
      // variable jump: reduced gravity while rising with the button held
      const rising = s.vy > 0;
      const sustained = rising && this._sustain && this.input.jumpHeld && this._holdT < PHYSICS.maxJumpHoldS;
      if (sustained) this._holdT += dt;
      s.vy -= (sustained ? PHYSICS.holdGravity : PHYSICS.gravity) * dt;
      s.y += s.vy * dt;

      if (g.height > -Infinity) {
        if (s.vy <= 0 && prevY >= g.height - 0.02 && s.y <= g.height) {
          // touchdown
          s.y = g.height; s.vy = 0; s.grounded = true;
          if (this._takeoffZ !== null && s.z - this._takeoffZ >= 2.5) {
            this.runStats.gaps++;
            this._styleEvent(); // cleared a real gap
          }
          this._takeoffZ = null;
          sfx.land();
          if (g.hazard) return this._crash('burn');
          if (g.pad) { s.vy = PHYSICS.bouncePadVelocity; s.grounded = false; this._sustain = false; sfx.pad(); }
          else if (g.boost && s.boostT <= BOOST.duration * 0.3) { s.boostT = BOOST.duration; sfx.boost(); }
        } else if (s.y < g.height - 0.05) {
          return this._crash('wall'); // flew into a block face
        }
      }
    }

    if (s.y < PHYSICS.fallDeathY) return this._crash('fall');

    // --- comet strikes (later levels): dodge the reticle before impact ---
    if (this._cometsEnabled()) {
      this._cometTimer -= dt;
      if (this._cometTimer <= 0) {
        this._cometTimer = Math.max(COMETS.minPeriodS,
          COMETS.basePeriodS - this._cometDifficulty() * (COMETS.basePeriodS - COMETS.minPeriodS));
        this._spawnComet();
      }
    }
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.t += dt;
      if (c.state === 'warn' && c.t >= COMETS.warnS) { c.state = 'strike'; c.t = 0; }
      else if (c.state === 'strike' && c.t >= COMETS.strikeS) {
        // impact
        this.shake = Math.max(this.shake, 0.6);
        this._burst(c.lane, 0.4, c.row + 0.5, '#ff8a50', 16);
        this._burst(c.lane, 0.4, c.row + 0.5, '#ffffff', 8);
        sfx.explode();
        const hit = Math.abs(s.z + SHIP.noseAhead - (c.row + 0.5)) < 1.0 &&
          Math.abs(s.x - c.lane) < COMETS.radius && s.y < 1.0;
        this.comets.splice(i, 1);
        if (hit) return this._crash('comet');
      }
    }

    // --- debris band & ring threading (center lane) ---
    {
      const row = Math.floor(s.z + SHIP.noseAhead);
      const centerLane = Math.round(s.x);
      const centerCh = this._cellAt(row, centerLane);
      if (centerCh === CELL.DEBRIS && s.y > DEBRIS.crashY) {
        return this._crash('debris'); // rose into the floating wreckage
      }
      if (centerCh === CELL.RING) {
        const key = row * 7 + (centerLane + 3);
        if (!this.collected.has(key) && Math.abs(s.y - RING.y) < RING.window) {
          this.collected.add(key); this._collectedOrder.push(key);
          const payout = RING.reward * this.flow;
          this.runCoins += payout;
          this.runStats.coins += payout;
          this.runStats.rings++;
          this._styleEvent();
          sfx.coin();
          this._burst(centerLane, RING.y, row + 0.5, '#a0f4ff', 10);
        }
      }
    }

    // --- near-miss detection (once per row) ---
    const nmRow = Math.floor(s.z + SHIP.noseAhead);
    if (nmRow !== this._nearMissRow) {
      this._nearMissRow = nmRow;
      for (let lane = -3; lane <= 3; lane++) {
        const ch = this._cellAt(nmRow, lane);
        const solid = ch === CELL.TALL ||
          (ch === CELL.DESTRUCTIBLE && !this.destroyed.has(nmRow * 7 + (lane + 3)));
        if (!solid) continue;
        const d = Math.abs(lane - s.x);
        // cell edge at 0.5, ship half-width 0.30 -> touching at d = 0.8
        if (d > 0.8 && d < 0.8 + FLOW.nearMissDist && s.y < BLOCK_HEIGHTS.tall) {
          this.runStats.nearMisses++;
          this._styleEvent();
          break;
        }
      }
    }

    // --- pickups ---
    this._collectAt(s);

    // --- projectiles ---
    this._stepProjectiles(dt);
    this._updateParticles(dt);

    // --- rewind history ---
    this._snapAcc += dt;
    if (this._snapAcc >= 1 / REWIND.historyHz) {
      this._snapAcc = 0;
      this.history.push({
        t: this.time,
        x: s.x, y: s.y, z: s.z, vy: s.vy, vx: s.vx,
        grounded: s.grounded, speedMul: s.speedMul, boostT: s.boostT,
        runCoins: this.runCoins, collectedCount: this._collectedOrder.length,
        ammo: this.ammo, destroyedCount: this._destroyedOrder.length,
      });
      const cap = REWIND.historyHz * REWIND.historySeconds;
      if (this.history.length > cap) this.history.shift();
    }

    // --- finish ---
    if (s.z >= level.length) {
      this.state = 'complete';
      // beat your echo: it was a completed-run ghost and hasn't finished yet
      this.beatEcho = !!(this.echoPlayer && this.echoPlayer.completedRun && !this.echoPlayer.finished);
      if (this.beatEcho) this.runStats.echoBeat = true;
      sfx.win();
      this.events.onComplete?.({
        coins: this.runCoins,
        levelIndex: level.index,
        beatEcho: this.beatEcho,
        runStats: this.runStats,
        time: this.time,
      });
    }
  }

  // ------------------------------------------------------------------
  _cellAt(row, lane) {
    if (row < 0 || row >= this.level.length || lane < -3 || lane > 3) return CELL.EMPTY;
    return this.level.rows[row][lane + 3];
  }

  _groundHeightOf(ch, key) {
    switch (ch) {
      case CELL.FLOOR: case CELL.BOOST: case CELL.PAD:
      case CELL.COIN: case CELL.AMMO: case CELL.HAZARD:
        return 0;
      case CELL.LOW: return BLOCK_HEIGHTS.low;
      case CELL.TALL: return BLOCK_HEIGHTS.tall;
      case CELL.HURDLE: return BLOCK_HEIGHTS.hurdle; // wall unless cleared by a HELD jump
      case CELL.DEBRIS: return 0;                    // normal floor under the wreckage
      case CELL.DESTRUCTIBLE: return this.destroyed.has(key) ? 0 : BLOCK_HEIGHTS.tall;
      default: return -Infinity;                     // includes RING (floats over the void)
    }
  }

  _sampleGround(x, z) {
    const row = Math.floor(z + SHIP.noseAhead);
    let height = -Infinity;
    const lo = Math.max(-3, Math.ceil(x - SHIP.halfWidth - 0.5));
    const hi = Math.min(3, Math.floor(x + SHIP.halfWidth + 0.5));
    for (let lane = lo; lane <= hi; lane++) {
      const h = this._groundHeightOf(this._cellAt(row, lane), row * 7 + (lane + 3));
      if (h > height) height = h;
    }
    // hazard / pad / boost react to the cell under the ship's center only
    const centerLane = Math.round(x);
    const centerCh = this._cellAt(row, centerLane);
    return {
      row, height,
      hazard: centerCh === CELL.HAZARD,
      pad: centerCh === CELL.PAD,
      boost: centerCh === CELL.BOOST,
    };
  }

  _collectAt(s) {
    const row = Math.floor(s.z + SHIP.noseAhead);
    for (let lane = -3; lane <= 3; lane++) {
      if (Math.abs(lane - s.x) > 0.55) continue;
      const ch = this._cellAt(row, lane);
      const key = row * 7 + (lane + 3);
      if (this.collected.has(key)) continue;
      if (ch === CELL.COIN && s.y < 0.9) {
        this.collected.add(key); this._collectedOrder.push(key);
        this.runCoins += this.flow;
        this.runStats.coins += this.flow;
        this._styleEvent();
        sfx.coin();
        this._burst(lane, 0.5, row + 0.5, '#ffd24a', 6);
      } else if (ch === CELL.COIN_AIR && Math.abs(s.y - 1.15) < 0.55) {
        this.collected.add(key); this._collectedOrder.push(key);
        this.runCoins += this.flow;
        this.runStats.coins += this.flow;
        this.runStats.airCoins++;
        this._styleEvent();
        sfx.coin();
        this._burst(lane, 1.15, row + 0.5, '#ffd24a', 6);
      } else if (ch === CELL.AMMO && s.y < 0.9) {
        this.collected.add(key); this._collectedOrder.push(key);
        this.ammo = Math.min(WEAPON.maxAmmo, this.ammo + WEAPON.ammoPerPickup);
        sfx.ammo();
        this._burst(lane, 0.55, row + 0.5, '#54f0ff', 6);
      }
    }
  }

  // ------------------------------------------------------------------
  // Comets: enabled deep into the campaign and Hyperdrive. Every strike is
  // telegraphed by a reticle for COMETS.warnS seconds — always dodgeable.
  _cometsEnabled() {
    if (this.mode === 'campaign') {
      return typeof this.level.index === 'number' && this.level.index >= COMETS.startLevel - 1;
    }
    if (this.mode === 'endless') return this.ship.z >= COMETS.endlessStartM;
    return false;
  }

  _cometDifficulty() {
    if (this.mode === 'endless') return Math.min(1, this.ship.z / 2000);
    return Math.min(1, (this.level.index - (COMETS.startLevel - 1)) / 300);
  }

  _spawnComet(forcedLane) {
    // land it where the ship will be when the warning runs out
    const speed = this.currentSpeed * this.ship.speedMul;
    const row = Math.floor(this.ship.z + speed * (COMETS.warnS + COMETS.strikeS));
    const rowStr = this.level.rows[row];
    if (!rowStr) return false;
    // fairness: only target rows with room to dodge (>=3 floor-ish lanes)
    const open = [];
    for (let lane = -3; lane <= 3; lane++) {
      const ch = rowStr[lane + 3];
      if (ch === CELL.FLOOR || ch === CELL.COIN || ch === CELL.BOOST || ch === CELL.AMMO || ch === CELL.DEBRIS) open.push(lane);
    }
    if (open.length < 3) return false;
    let lane = forcedLane;
    if (lane === undefined) {
      // aim near the ship's lane so it actually threatens
      const near = open.filter((l) => Math.abs(l - this.ship.x) <= 2);
      const pool = near.length ? near : open;
      lane = pool[Math.floor(Math.random() * pool.length)];
    }
    this.comets.push({ row, lane, t: 0, state: 'warn' });
    sfx.cometWarn();
    return true;
  }

  shoot() { this.input.queueFire(); }

  _fire() {
    if (this.state !== 'running' || this.ammo <= 0) return;
    this.ammo--;
    sfx.shoot();
    this.projectiles.push({ x: this.ship.x, z: this.ship.z + 0.4, born: this.ship.z });
  }

  _stepProjectiles(dt) {
    const speed = WEAPON.projectileSpeed + this.level.speed;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const prevZ = p.z;
      p.z += speed * dt;
      let dead = p.z - p.born > WEAPON.projectileRange;
      const lane = Math.round(p.x);
      for (let row = Math.ceil(prevZ - 0.5); row <= Math.floor(p.z + 0.5) && !dead; row++) {
        const ch = this._cellAt(row, lane);
        const key = row * 7 + (lane + 3);
        if (ch === CELL.DESTRUCTIBLE && !this.destroyed.has(key)) {
          this.destroyed.add(key);
          this._destroyedOrder.push(key);
          this.runCoins += WEAPON.destroyReward * this.flow;
          this.runStats.coins += WEAPON.destroyReward * this.flow;
          this.runStats.barriers++;
          this._styleEvent();
          sfx.explode();
          this.shake = Math.max(this.shake, 0.35);
          this._burst(lane, 0.6, row + 0.5, '#ff9500', 14);
          this._burst(lane, 0.6, row + 0.5, '#ffffff', 6);
          dead = true;
        } else if (ch === CELL.TALL) {
          dead = true; // absorbed by indestructible blocks
        }
      }
      if (dead) this.projectiles.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------
  activateSlowmo() {
    if (this.state !== 'running' || this.slowmoLeft > 0) return false;
    this.slowmoLeft = SLOWMO.duration;
    this._timeScaleTarget = SLOWMO.timeScale;
    this.runStats.slowmos++;
    sfx.slowmo();
    return true;
  }

  // ------------------------------------------------------------------
  _crash(type) {
    this.crashType = type;
    this.state = 'crashing';
    this._crashTimer = 0.9;
    this._timeScaleTarget = 0.25;
    this.slowmoLeft = 0;
    this.flow = 1;
    this.flowEvents = 0;
    this.shake = 1;
    this.shipVisible = false;
    this.projectiles.length = 0;
    this.comets.length = 0;
    sfx.crash();
    const s = this.ship;
    this._burst(s.x, s.y + 0.3, s.z, '#ffffff', 10);
    this._burst(s.x, s.y + 0.3, s.z, this.level.theme.glow, 14);
    this._burst(s.x, s.y + 0.3, s.z, '#ff7040', 12);
  }

  canRevive() { return this.history.length > 1; }

  // Extra life: rewind REWIND.seconds and resume. Assumes the caller already
  // paid (rewarded ad / rewind charge).
  revive() {
    if (this.state !== 'reviveOffer' || !this.canRevive()) return false;
    this.revivesUsed++;
    // target snapshot: REWIND.seconds of game time back
    const targetT = this.time - REWIND.seconds;
    let idx = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].t <= targetT) { idx = i; break; }
    }
    // never resume mid-air: keep rewinding (further back) to solid ground
    while (idx > 0 && !this.history[idx].grounded) idx--;
    this._rewindAnim = {
      fromIdx: this.history.length - 1,
      toIdx: idx,
      progress: 0,
      duration: 1.0,
    };
    this.state = 'rewinding';
    sfx.rewind();
    return true;
  }

  _stepRewindAnim(dtReal) {
    const anim = this._rewindAnim;
    anim.progress = Math.min(1, anim.progress + dtReal / anim.duration);
    const span = anim.fromIdx - anim.toIdx;
    const fi = anim.fromIdx - span * this._easeInOut(anim.progress);
    const i0 = Math.max(0, Math.floor(fi));
    const i1 = Math.min(this.history.length - 1, i0 + 1);
    const k = fi - i0;
    const a = this.history[i0], b = this.history[i1];
    // ship glides backwards along its recorded path
    this.ship.x = a.x + (b.x - a.x) * k;
    this.ship.y = a.y + (b.y - a.y) * k;
    this.ship.z = a.z + (b.z - a.z) * k;
    this.shipVisible = true;
    // ghost trail of where you'll respawn from
    const g0 = this.history[anim.toIdx];
    this.rewindGhosts = [{ x: g0.x, y: g0.y, z: g0.z, bank: 0 }];

    if (anim.progress >= 1) {
      const snap = this.history[anim.toIdx];
      const s = this.ship;
      s.x = snap.x; s.y = snap.y; s.z = snap.z;
      s.vy = snap.vy; s.vx = snap.vx; s.bank = 0;
      s.grounded = snap.grounded; s.speedMul = snap.speedMul; s.boostT = snap.boostT;
      // resurrect coins / ammo / barriers taken inside the rewound window
      while (this._collectedOrder.length > snap.collectedCount) {
        this.collected.delete(this._collectedOrder.pop());
      }
      while (this._destroyedOrder.length > snap.destroyedCount) {
        this.destroyed.delete(this._destroyedOrder.pop());
      }
      this.runCoins = snap.runCoins;
      this.ammo = snap.ammo;
      this.time = snap.t;
      this._cometTimer = COMETS.basePeriodS * 0.6; // grace after a revive
      this.runStats.revives++;
      // the echo recording is rewritten from here — but echoClock is NOT
      // restored: your rival echo keeps flying while you recover
      this.recorder?.truncateAfterZ(snap.z);
      this.history.length = anim.toIdx + 1;
      this._rewindAnim = null;
      this.rewindGhosts = null;
      this.particles.length = 0;
      this.crashType = null;
      // slow ramp back to full speed so the player can react to what killed them
      this.timeScale = 0.3;
      this._timeScaleTarget = 1;
      // everything dragged/tapped during the crash, revive modal and rewind
      // animation is stale — clear it so the restored ship isn't shoved
      this.input.reset();
      this.state = 'running';
      this.events.onReviveDone?.();
    }
  }

  giveUp() {
    if (this.state === 'reviveOffer') {
      this.state = 'failed';
      sfx.lose();
    }
  }

  pause() {
    if (this.state === 'running') { this.state = 'paused'; return true; }
    return false;
  }
  resume() {
    if (this.state === 'paused') { this.state = 'running'; this._acc = 0; }
  }

  // ------------------------------------------------------------------
  _burst(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x, y, z,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 3.5,
        vz: (Math.random() - 0.5) * 3,
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
        size: 3 + Math.random() * 5,
        color,
      });
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 7 * dt;
    }
  }

  _easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
}

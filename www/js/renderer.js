// Sky Highway — pseudo-3D canvas renderer.
//
// v3 "modern" pass: gradient-lit floor tiles with a travelling light sheen,
// ambient occlusion + additive rim lights on blocks, pre-rendered nebula sky,
// additive bloom for pickups/pads/particles, corner vignette — and the ship
// is now true 3D geometry projected in world space, so it visibly lies flat
// on the track pointing toward the vanishing point (direction of travel).
//
// Perf budget: dpr cap 2, two linear gradients per visible row, shadowBlur
// only on the ship canopy and finish gate, all big soft art pre-rendered
// into cached offscreen canvases per theme.

import { CAMERA, CELL, BLOCK_HEIGHTS, TRACK_LANES, DEBRIS, RING } from './config.js';
import { equippedShip, equippedTrail } from './cosmetics.js';

const HAZARD_A = '#ff5030';
const HAZARD_B = '#7a1400';
const BARRIER_A = '#ff9500';
const BARRIER_B = '#4a2a00';
const COIN_COLOR = '#ffd24a';
const AMMO_COLOR = '#54f0ff';
const ECHO_STYLE = { color: '#54f0ff', flame: '#a0f4ff', wing: 1.0, nose: 1.0 };
const NEAR = 0.6; // near plane: clamp geometry this close to the camera

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.stars = [];
    for (let i = 0; i < 130; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), d: 0.2 + Math.random() * 0.8, tw: Math.random() * 6.28 });
    }
    this._assets = new Map(); // themeName|WxH -> { sky, vignette }
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // pre-rendered per-theme art (nebula sky + vignette), cached per size
  _themeAssets(theme) {
    const key = `${theme.name}|${this.w}x${this.h}`;
    if (this._assets.has(key)) return this._assets.get(key);
    if (this._assets.size > 6) this._assets.delete(this._assets.keys().next().value);

    const w = Math.max(2, this.w), h = Math.max(2, this.h);
    const sky = document.createElement('canvas');
    sky.width = w; sky.height = h;
    const sc = sky.getContext('2d');
    const grad = sc.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, theme.skyTop);
    grad.addColorStop(Math.max(0.01, CAMERA.horizon), theme.skyBot);
    grad.addColorStop(1, theme.skyTop);
    sc.fillStyle = grad;
    sc.fillRect(0, 0, w, h);
    // soft nebulae
    sc.globalCompositeOperation = 'lighter';
    const blobs = [
      [0.22, 0.16, 0.45, theme.glow, 0.10],
      [0.74, 0.10, 0.38, theme.block, 0.08],
      [0.50, 0.30, 0.55, theme.floor, 0.06],
    ];
    for (const [bx, by, br, color, a] of blobs) {
      const r = br * Math.max(w, h) * 0.6;
      const g = sc.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, r);
      g.addColorStop(0, this._alpha(color, a));
      g.addColorStop(1, 'transparent');
      sc.fillStyle = g;
      sc.fillRect(bx * w - r, by * h - r, r * 2, r * 2);
    }
    // bright horizon core line
    const hy = h * CAMERA.horizon;
    const hg = sc.createLinearGradient(0, hy - 2, 0, hy + 2);
    hg.addColorStop(0, 'transparent');
    hg.addColorStop(0.5, this._alpha(theme.glow, 0.5));
    hg.addColorStop(1, 'transparent');
    sc.fillStyle = hg;
    sc.fillRect(0, hy - 2, w, 4);
    sc.globalCompositeOperation = 'source-over';

    const vignette = document.createElement('canvas');
    vignette.width = w; vignette.height = h;
    const vc = vignette.getContext('2d');
    const vg = vc.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'transparent');
    vg.addColorStop(1, 'rgba(0,0,12,0.40)');
    vc.fillStyle = vg;
    vc.fillRect(0, 0, w, h);

    const assets = { sky, vignette };
    this._assets.set(key, assets);
    return assets;
  }

  render(game, dtReal) {
    this.t += dtReal;
    const { ctx, w, h, t } = this;
    const level = game.level;
    const theme = level.theme;
    const ship = game.ship;
    const assets = this._themeAssets(theme);

    // camera
    const camX = ship.x * 0.72;
    const camY = CAMERA.height + Math.max(0, ship.y) * 0.35;
    const camZ = ship.z - CAMERA.back;
    const f = Math.min(w, h) * CAMERA.fovScale;
    const horizonY = h * CAMERA.horizon;

    const px = (x, z) => w / 2 + ((x - camX) * f) / (z - camZ);
    const py = (y, z) => horizonY + ((camY - y) * f) / (z - camZ);

    ctx.save();

    // screen shake
    if (game.shake > 0.01) {
      ctx.translate((Math.random() * 2 - 1) * game.shake * 8, (Math.random() * 2 - 1) * game.shake * 8);
    }

    // ---- sky (pre-rendered nebula) ----
    ctx.drawImage(assets.sky, -10, -10, w + 20, h + 20);

    // stars (above horizon, parallax with travel)
    for (const s of this.stars) {
      const sx = ((s.x - ship.z * 0.004 * s.d) % 1 + 1) % 1 * w;
      const sy = s.y * horizonY * 0.96;
      const a = 0.35 + 0.3 * Math.sin(t * 2 + s.tw);
      ctx.fillStyle = theme.star;
      ctx.globalAlpha = a * s.d;
      const r = s.d * 1.6;
      ctx.fillRect(sx, sy, r, r);
    }
    ctx.globalAlpha = 1;

    // ---- track rows, far to near ----
    const firstRow = Math.max(0, Math.floor(ship.z) - 5);
    const lastRow = Math.min(level.length - 1, firstRow + CAMERA.drawRows);
    const fadeStart = lastRow - 8;

    for (let row = lastRow; row >= firstRow; row--) {
      const rowStr = level.rows[row];
      const rowAlpha = row > fadeStart ? 1 - (row - fadeStart) / (lastRow - fadeStart + 1) : 1;
      if (rowAlpha <= 0.02) continue;
      ctx.globalAlpha = rowAlpha;

      let z0 = row;
      const z1 = row + 1;
      if (z1 - camZ < NEAR) continue;              // fully behind the camera
      if (z0 - camZ < NEAR) z0 = camZ + NEAR;      // partially behind: clamp

      // two gradient fills per row: checker colors A and B, lit near->far
      const yNear = py(0, z1), yFar = py(0, z0);
      const gradFor = (color) => {
        const g = ctx.createLinearGradient(0, yNear, 0, yFar);
        g.addColorStop(0, this._shade(color, 1.14));
        g.addColorStop(1, this._shade(color, 0.80));
        return g;
      };
      const gradA = gradFor(theme.floor);
      const gradB = gradFor(theme.floorAlt);

      // floor quads
      for (let lane = 0; lane < TRACK_LANES; lane++) {
        const ch = rowStr[lane];
        if (ch === CELL.EMPTY || ch === CELL.COIN_AIR) continue;
        const lx = lane - 3;
        const destroyed = ch === CELL.DESTRUCTIBLE && game.destroyed.has(row * 7 + lane);
        let fill;
        if (ch === CELL.HAZARD) {
          const flick = 0.5 + 0.5 * Math.sin(t * 14 + row * 2.1 + lane);
          fill = this._lerpColor(HAZARD_B, HAZARD_A, flick);
        } else if (destroyed) {
          fill = '#17171d'; // scorched stub
        } else {
          fill = (row + lane) % 2 === 0 ? gradA : gradB;
        }
        this._quad(ctx, px(lx - 0.5, z0), py(0, z0), px(lx + 0.5, z0), py(0, z0),
          px(lx + 0.5, z1), py(0, z1), px(lx - 0.5, z1), py(0, z1), fill);

        // special tile decals (skip when the row is clamped against the near plane)
        if (row - camZ >= NEAR) {
          if (ch === CELL.BOOST) this._boostDecal(ctx, px, py, lx, row);
          else if (ch === CELL.PAD) this._padDecal(ctx, px, py, lx, row);
        }
      }

      // section divider line every 4th row (subtle highway marking)
      if (row % 4 === 0) {
        ctx.strokeStyle = this._alpha(theme.glow, 0.16);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px(-3.5, z0), py(0, z0));
        ctx.lineTo(px(3.5, z0), py(0, z0));
        ctx.stroke();
      }

      // travelling light sheen sweeping down the highway
      const sheenPhase = ((row - t * 6) % 24 + 24) % 24;
      if (sheenPhase < 1.6) {
        ctx.globalCompositeOperation = 'lighter';
        this._quad(ctx, px(-3.5, z0), py(0, z0), px(3.5, z0), py(0, z0),
          px(3.5, z1), py(0, z1), px(-3.5, z1), py(0, z1), 'rgba(255,255,255,0.045)');
        ctx.globalCompositeOperation = 'source-over';
      }

      // blocks, outside-in relative to camera
      if (row - camZ < NEAR) { ctx.globalAlpha = 1; continue; }
      const lanes = [];
      for (let lane = 0; lane < TRACK_LANES; lane++) {
        const ch = rowStr[lane];
        if (ch === CELL.LOW || ch === CELL.TALL || ch === CELL.HURDLE || ch === CELL.DEBRIS ||
            (ch === CELL.DESTRUCTIBLE && !game.destroyed.has(row * 7 + lane))) lanes.push(lane);
      }
      lanes.sort((a, b) => Math.abs((b - 3) - camX) - Math.abs((a - 3) - camX));
      for (const lane of lanes) {
        const ch = rowStr[lane];
        if (ch === CELL.HURDLE) this._hurdle(ctx, px, py, lane - 3, row, theme, t);
        else if (ch === CELL.DEBRIS) this._debris(ctx, px, py, lane - 3, row, theme, camX, t);
        else {
          const hgt = ch === CELL.LOW ? BLOCK_HEIGHTS.low : BLOCK_HEIGHTS.tall;
          this._box(ctx, px, py, lane - 3, row, hgt, ch, theme, camX, t);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- items (coins / ammo), far to near ----
    for (let row = lastRow; row >= firstRow; row--) {
      if (row + 0.5 - camZ < NEAR) continue;
      const rowStr = level.rows[row];
      for (let lane = 0; lane < TRACK_LANES; lane++) {
        const ch = rowStr[lane];
        const key = row * 7 + lane;
        if ((ch === CELL.COIN || ch === CELL.COIN_AIR) && !game.collected.has(key)) {
          const y = ch === CELL.COIN ? 0.5 : 1.15;
          this._coin(ctx, px, py, lane - 3, row + 0.5, y + Math.sin(t * 3 + key) * 0.05, t);
        } else if (ch === CELL.AMMO && !game.collected.has(key)) {
          this._ammoCell(ctx, px, py, lane - 3, row + 0.5, 0.55 + Math.sin(t * 3 + key) * 0.06, t);
        } else if (ch === CELL.RING && !game.collected.has(key)) {
          this._ring(ctx, px, py, lane - 3, row + 0.5, t);
        }
      }
    }

    // ---- projectiles (additive bolts) ----
    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.projectiles) {
      if (p.z - camZ < NEAR) continue;
      const sx = px(p.x, p.z), sy = py(0.55, p.z);
      const s = f / (p.z - camZ);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - s * 0.03, sy - s * 0.10, s * 0.06, s * 0.20);
      ctx.fillStyle = this._alpha(AMMO_COLOR, 0.7);
      ctx.fillRect(sx - s * 0.045, sy + s * 0.08, s * 0.09, s * 0.30);
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- finish gate ----
    if (level.length <= lastRow + 2 && level.length >= firstRow) {
      this._finishGate(ctx, px, py, level.length, theme, t, f, camZ);
    }

    if (!game.attract) {
      // ---- echo ghost: your past run racing beside you ----
      if (game.echoPos) {
        this._ship(ctx, px, py, game.echoPos, theme, f, camZ, t, 0.35, game, ECHO_STYLE);
      }

      // ---- engine trail ribbon (additive) ----
      if (game.trailPoints && game.trailPoints.length > 2) {
        const trail = equippedTrail();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < game.trailPoints.length - 1; i++) {
          const p = game.trailPoints[i];
          if (p.z - camZ < NEAR) continue;
          const a = (i / game.trailPoints.length) * 0.30;
          const s = f / (p.z - camZ);
          ctx.globalAlpha = a;
          ctx.fillStyle = trail.color;
          const r = s * 0.05 * (i / game.trailPoints.length + 0.3);
          ctx.beginPath();
          ctx.arc(px(p.x, p.z), py(p.y, p.z), Math.max(0.5, r), 0, 6.29);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // ---- ship shadow (stretched along the hull) ----
      const g = game.groundInfoForRender;
      if (g && g.height > -100) {
        const sz = ship.z + 0.001;
        const sx = px(ship.x, sz), sy = py(g.height, sz);
        const s = f / (sz - camZ);
        const lift = Math.max(0, ship.y - g.height);
        const shrink = Math.max(0.35, 1 - lift * 0.35);
        ctx.fillStyle = `rgba(0,0,0,${0.4 * shrink})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, s * 0.30 * shrink, s * 0.15 * shrink, 0, 0, 6.29);
        ctx.fill();
      }

      // ---- rewind ghosts ----
      if (game.rewindGhosts) {
        const alphas = [0.14, 0.24, 0.38];
        game.rewindGhosts.forEach((gh, i) => {
          this._ship(ctx, px, py, gh, theme, f, camZ, t, alphas[i] ?? 0.2, game);
        });
      }

      // ---- ship ----
      if (game.shipVisible) this._ship(ctx, px, py, ship, theme, f, camZ, t, 1, game, equippedShip());
    }

    // ---- particles (additive) ----
    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.particles) {
      if (p.z - camZ < 0.3) continue;
      const sx = px(p.x, p.z), sy = py(p.y, p.z);
      const s = f / (p.z - camZ);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      const r = p.size * s * 0.02;
      ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();

    // ---- full-screen FX ----
    ctx.drawImage(assets.vignette, 0, 0, w, h);
    if (game.slowmoVisual > 0.01) {
      const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.75);
      v.addColorStop(0, 'transparent');
      v.addColorStop(1, `rgba(40,190,255,${0.30 * game.slowmoVisual})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
    if (game.flow > 1 && game.state === 'running') {
      // flow combo: screen-edge glow that intensifies per tier
      const k = (game.flow - 1) / 4;
      const gold = `rgba(255,210,74,${0.06 + 0.14 * k})`;
      const edge = h * (0.05 + 0.05 * k);
      for (const [x0, y0, x1, y1] of [
        [0, 0, 0, edge], [0, h, 0, h - edge], // top, bottom
      ]) {
        const gr = ctx.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, gold);
        gr.addColorStop(1, 'transparent');
        ctx.fillStyle = gr;
        ctx.fillRect(0, Math.min(y0, y1), w, edge);
      }
    }
    if (game.rewindVisual > 0.01) {
      ctx.fillStyle = `rgba(200,230,255,${0.10 * game.rewindVisual})`;
      for (let i = 0; i < 6; i++) {
        const y = ((t * 900 + i * h / 6) % h);
        ctx.fillRect(0, h - y, w, 3);
      }
      ctx.fillStyle = `rgba(255,255,255,${0.85 * game.rewindVisual})`;
      ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('◀◀', w / 2, h * 0.2);
    }
  }

  // ------------------------------------------------------------------
  _quad(ctx, x0, y0, x1, y1, x2, y2, x3, y3, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  _box(ctx, px, py, lx, row, hgt, ch, theme, camX, t) {
    const z0 = row, z1 = row + 1;
    const x0 = lx - 0.5, x1 = lx + 0.5;
    const isBarrier = ch === CELL.DESTRUCTIBLE;
    const top = isBarrier ? BARRIER_A : theme.block;
    const front = isBarrier ? BARRIER_B : theme.blockDark;

    // top face: lit gradient (near edge brighter)
    const tg = ctx.createLinearGradient(0, py(hgt, z0), 0, py(hgt, z1));
    tg.addColorStop(0, this._shade(top, 1.12));
    tg.addColorStop(1, this._shade(top, 0.86));
    this._quad(ctx, px(x0, z0), py(hgt, z0), px(x1, z0), py(hgt, z0),
      px(x1, z1), py(hgt, z1), px(x0, z1), py(hgt, z1), tg);

    // side face toward camera
    if (lx > camX + 0.5) {
      this._quad(ctx, px(x0, z0), py(hgt, z0), px(x0, z1), py(hgt, z1),
        px(x0, z1), py(0, z1), px(x0, z0), py(0, z0), this._shade(front, 0.72));
    } else if (lx < camX - 0.5) {
      this._quad(ctx, px(x1, z0), py(hgt, z0), px(x1, z1), py(hgt, z1),
        px(x1, z1), py(0, z1), px(x1, z0), py(0, z0), this._shade(front, 0.72));
    }

    // front face: vertical gradient + ambient occlusion at the base
    const fy0 = py(hgt, z0), fy1 = py(0, z0);
    const fx0 = px(x0, z0), fx1 = px(x1, z0);
    const fg = ctx.createLinearGradient(0, fy0, 0, fy1);
    fg.addColorStop(0, this._shade(front, 1.08));
    fg.addColorStop(1, this._shade(front, 0.68));
    this._quad(ctx, fx0, fy0, fx1, fy0, fx1, fy1, fx0, fy1, fg);
    const ao = ctx.createLinearGradient(0, fy1 - (fy1 - fy0) * 0.25, 0, fy1);
    ao.addColorStop(0, 'transparent');
    ao.addColorStop(1, 'rgba(0,0,0,0.38)');
    this._quad(ctx, fx0, fy1 - (fy1 - fy0) * 0.25, fx1, fy1 - (fy1 - fy0) * 0.25, fx1, fy1, fx0, fy1, ao);

    if (isBarrier) {
      // warning stripes + pulsing core on the front face
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx0, fy0, fx1 - fx0, fy1 - fy0);
      ctx.clip();
      ctx.strokeStyle = BARRIER_A;
      ctx.lineWidth = Math.max(2, (fy1 - fy0) * 0.12);
      for (let i = -2; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(fx0 + (fx1 - fx0) * (i / 4), fy1);
        ctx.lineTo(fx0 + (fx1 - fx0) * (i / 4 + 0.5), fy0);
        ctx.stroke();
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 5 + row);
      ctx.fillStyle = this._alpha('#ffd090', 0.25 + 0.35 * pulse);
      const cx = (fx0 + fx1) / 2, cy = (fy0 + fy1) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, (fx1 - fx0) * 0.16), 0, 6.29);
      ctx.fill();
      ctx.restore();
    }

    // additive rim light on the near top edge
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this._alpha(isBarrier ? '#ffc26b' : theme.glow, 0.45);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(fx0, fy0);
    ctx.lineTo(fx1, fy0);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // energy fence: two posts + a flickering additive beam at hurdle height —
  // reads as "too tall to hop, HOLD to clear"
  _hurdle(ctx, px, py, lx, row, theme, t) {
    const z = row + 0.5;
    const h = BLOCK_HEIGHTS.hurdle;
    const flick = 0.7 + 0.3 * Math.sin(t * 18 + row * 3.1);
    // posts at the cell edges
    for (const side of [-0.44, 0.44]) {
      this._quad(ctx,
        px(lx + side - 0.05, z), py(h + 0.06, z),
        px(lx + side + 0.05, z), py(h + 0.06, z),
        px(lx + side + 0.05, z), py(0, z),
        px(lx + side - 0.05, z), py(0, z),
        this._shade(theme.blockDark, 0.9));
    }
    ctx.globalCompositeOperation = 'lighter';
    // main beam
    this._quad(ctx,
      px(lx - 0.44, z), py(h, z), px(lx + 0.44, z), py(h, z),
      px(lx + 0.44, z), py(h - 0.14, z), px(lx - 0.44, z), py(h - 0.14, z),
      this._alpha('#ff5c7a', 0.55 * flick));
    // faint field below the beam
    this._quad(ctx,
      px(lx - 0.44, z), py(h - 0.14, z), px(lx + 0.44, z), py(h - 0.14, z),
      px(lx + 0.44, z), py(0, z), px(lx - 0.44, z), py(0, z),
      this._alpha('#ff5c7a', 0.10 * flick));
    ctx.globalCompositeOperation = 'source-over';
  }

  // floating wreckage beam: solid band the ship must stay UNDER
  _debris(ctx, px, py, lx, row, theme, camX, t) {
    const z0 = row, z1 = row + 1;
    const x0 = lx - 0.5, x1 = lx + 0.5;
    const yB = DEBRIS.bottom, yT = DEBRIS.top;
    // shadow patch on the floor below
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(px(lx, row + 0.5), py(0.01, row + 0.5),
      Math.abs(px(lx + 0.38, row + 0.5) - px(lx, row + 0.5)),
      Math.abs(py(0.01, row + 0.82) - py(0.01, row + 0.5)), 0, 0, 6.29);
    ctx.fill();
    // underside (what the player sees sliding beneath)
    this._quad(ctx, px(x0, z0), py(yB, z0), px(x1, z0), py(yB, z0),
      px(x1, z1), py(yB, z1), px(x0, z1), py(yB, z1), this._shade('#6a5a4a', 0.55));
    // front face: battered wreck gradient with darker chunks
    const fy0 = py(yT, z0), fy1 = py(yB, z0);
    const fx0 = px(x0, z0), fx1 = px(x1, z0);
    const fg = ctx.createLinearGradient(0, fy0, 0, fy1);
    fg.addColorStop(0, '#8a7a66');
    fg.addColorStop(0.6, '#5c5044');
    fg.addColorStop(1, '#3a322a');
    this._quad(ctx, fx0, fy0, fx1, fy0, fx1, fy1, fx0, fy1, fg);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    const seed = (row * 7 + lx) | 0;
    for (let i = 0; i < 3; i++) {
      const u = ((seed * 31 + i * 47) % 10) / 10;
      ctx.fillRect(fx0 + (fx1 - fx0) * u * 0.8, fy0 + (fy1 - fy0) * ((i + 1) / 4), (fx1 - fx0) * 0.14, (fy1 - fy0) * 0.16);
    }
    // top face
    this._quad(ctx, px(x0, z0), py(yT, z0), px(x1, z0), py(yT, z0),
      px(x1, z1), py(yT, z1), px(x0, z1), py(yT, z1), this._shade('#8a7a66', 1.05));
    // hazard blink on the underside edge
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this._alpha('#ffb060', 0.35 + 0.25 * Math.sin(t * 6 + row));
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(fx0, fy1);
    ctx.lineTo(fx1, fy1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // glowing ring floating over the void: thread it at the top of a held jump
  _ring(ctx, px, py, lx, z, t) {
    const cx = px(lx, z), cy = py(RING.y, z);
    const rx = Math.abs(px(lx + 0.42, z) - px(lx, z));
    const ry = rx * 1.15; // slightly taller than wide, facing the player
    const pulse = 0.75 + 0.25 * Math.sin(t * 5 + z);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this._alpha('#7ce8ff', 0.25 * pulse);
    ctx.lineWidth = Math.max(3, rx * 0.30);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.29);
    ctx.stroke();
    ctx.strokeStyle = this._alpha('#e8fbff', 0.9 * pulse);
    ctx.lineWidth = Math.max(1.5, rx * 0.10);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.29);
    ctx.stroke();
    ctx.restore();
  }

  _boostDecal(ctx, px, py, lx, row) {
    const phase = (this.t * 3 + row * 0.5) % 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this._alpha('#ffffff', 0.40 + 0.25 * Math.sin(phase * 6.28));
    for (let i = 0; i < 2; i++) {
      const zc = row + 0.3 + i * 0.4;
      ctx.beginPath();
      ctx.moveTo(px(lx - 0.28, zc + 0.18), py(0.01, zc + 0.18));
      ctx.lineTo(px(lx, zc), py(0.01, zc));
      ctx.lineTo(px(lx + 0.28, zc + 0.18), py(0.01, zc + 0.18));
      ctx.lineTo(px(lx, zc + 0.09), py(0.01, zc + 0.09));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _padDecal(ctx, px, py, lx, row) {
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6 + row);
    const zc = row + 0.5;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this._alpha('#ffffff', 0.30 + 0.4 * pulse);
    ctx.lineWidth = 2;
    const rx = Math.abs(px(lx + 0.3, zc) - px(lx, zc)) * (0.7 + pulse * 0.3);
    const ry = Math.abs(py(0.01, zc + 0.3) - py(0.01, zc)) * (0.7 + pulse * 0.3);
    ctx.beginPath();
    ctx.ellipse(px(lx, zc), py(0.01, zc), rx, ry, 0, 0, 6.29);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  _coin(ctx, px, py, lx, z, y, t) {
    const sx = px(lx, z), sy = py(y, z);
    const s = Math.abs(px(lx + 0.5, z) - px(lx, z));
    const wob = Math.abs(Math.cos(t * 4 + z));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // soft halo instead of shadowBlur (cheaper)
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, s * 0.45);
    halo.addColorStop(0, this._alpha(COIN_COLOR, 0.35));
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.fillRect(sx - s * 0.45, sy - s * 0.45, s * 0.9, s * 0.9);
    ctx.fillStyle = COIN_COLOR;
    ctx.beginPath();
    ctx.moveTo(sx, sy - s * 0.22);
    ctx.lineTo(sx + s * 0.16 * wob, sy);
    ctx.lineTo(sx, sy + s * 0.22);
    ctx.lineTo(sx - s * 0.16 * wob, sy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _ammoCell(ctx, px, py, lx, z, y, t) {
    const sx = px(lx, z), sy = py(y, z);
    const s = Math.abs(px(lx + 0.5, z) - px(lx, z));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, s * 0.5);
    halo.addColorStop(0, this._alpha(AMMO_COLOR, 0.35));
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.fillRect(sx - s * 0.5, sy - s * 0.5, s, s);
    ctx.translate(sx, sy);
    ctx.rotate(t * 2);
    ctx.fillStyle = AMMO_COLOR;
    ctx.fillRect(-s * 0.14, -s * 0.14, s * 0.28, s * 0.28);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-s * 0.06, -s * 0.06, s * 0.12, s * 0.12);
    ctx.restore();
  }

  _finishGate(ctx, px, py, z, theme, t, f, camZ) {
    if (z - camZ < 0.4) return;
    const pulse = 0.6 + 0.4 * Math.sin(t * 4);
    ctx.save();
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = 18 * pulse;
    ctx.fillStyle = theme.glow;
    // pillars
    for (const side of [-3.6, 3.6]) {
      this._quad(ctx, px(side - 0.15, z), py(2.2, z), px(side + 0.15, z), py(2.2, z),
        px(side + 0.15, z), py(0, z), px(side - 0.15, z), py(0, z), theme.glow);
    }
    // banner
    this._quad(ctx, px(-3.6, z), py(2.2, z), px(3.6, z), py(2.2, z),
      px(3.6, z), py(1.8, z), px(-3.6, z), py(1.8, z), this._alpha(theme.glow, 0.8));
    const bx = px(0, z), byTop = py(2.13, z), byBot = py(1.87, z);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a0a14';
    ctx.font = `bold ${Math.max(6, byBot - byTop)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', bx, (byTop + byBot) / 2);
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // The ship: true 3D geometry projected in world space. The nose extends
  // toward +z (direction of travel) and visually converges on the vanishing
  // point; banking rolls the hull about its long axis.
  // ------------------------------------------------------------------
  _ship(ctx, px, py, ship, theme, f, camZ, t, alpha, game, def) {
    const cz = ship.z;
    if (cz - camZ < 0.4) return;
    const hue = (def && def.color) || theme.glow;
    const wingK = (def && def.wing) || 1;
    const noseK = (def && def.nose) || 1;
    const bank = (ship.bank || 0) * 0.6;
    const cb = Math.cos(bank), sb = Math.sin(bank);

    // local (dx up-to-0.42, dy height, dz along travel) -> roll -> world -> screen
    const P = (dx, dy, dz) => {
      const rx = dx * cb - dy * sb;
      const ry = dy * cb + dx * sb;
      return [px(ship.x + rx, cz + dz), py(ship.y + ry + 0.05, cz + dz)];
    };
    const poly = (pts, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    };

    ctx.save();
    ctx.globalAlpha = alpha;

    // vertices
    const nose = P(0, 0.05, 0.60 * noseK);
    const bR = P(0.15, 0.06, 0.12), bL = P(-0.15, 0.06, 0.12);
    const wR = P(0.42 * wingK, 0.01, -0.30), wL = P(-0.42 * wingK, 0.01, -0.30);
    const rR = P(0.13, 0.04, -0.10), rL = P(-0.13, 0.04, -0.10);
    const tail = P(0, 0.12, -0.44);
    const tR = P(0.09, 0.02, -0.46), tL = P(-0.09, 0.02, -0.46);

    // engine flame first (behind/below the hull), additive
    const flick = 0.8 + 0.2 * Math.sin(t * 42);
    const flameLen = (0.45 + 0.3 * flick) * (game.ship.speedMul > 1.05 ? 1.8 : 1);
    ctx.globalCompositeOperation = 'lighter';
    poly([P(0.07, 0.03, -0.46), P(-0.07, 0.03, -0.46), P(0, 0.02, -0.46 - flameLen)],
      this._alpha((def && def.flame) || '#57c8ff', 0.55));
    poly([P(0.03, 0.03, -0.46), P(-0.03, 0.03, -0.46), P(0, 0.02, -0.46 - flameLen * 0.6)],
      'rgba(255,255,255,0.5)');
    ctx.globalCompositeOperation = 'source-over';

    // wings (darker underside tone)
    poly([rR, wR, tR], this._shade(hue, 0.60));
    poly([rL, wL, tL], this._shade(hue, 0.60));
    // fuselage halves: light side / shadow side for form
    poly([nose, bR, tR, tail], this._shade(hue, 0.92));
    poly([nose, bL, tL, tail], this._shade(hue, 0.68));
    // top ridge highlight
    poly([nose, P(0.05, 0.10, 0.10), tail, P(-0.05, 0.10, 0.10)], this._shade(hue, 1.18));
    // canopy (only bright glow left on the ship)
    ctx.shadowColor = '#dff4ff';
    ctx.shadowBlur = 8;
    poly([P(0, 0.13, 0.30), P(0.055, 0.12, 0.02), P(0, 0.15, -0.10), P(-0.055, 0.12, 0.02)],
      'rgba(230,246,255,0.92)');
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  // ---- color helpers ----
  _alpha(hex, a) {
    const { r, g, b } = this._rgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  _shade(hex, k) {
    const { r, g, b } = this._rgb(hex);
    return `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(b * k))})`;
  }
  _lerpColor(hexA, hexB, k) {
    const a = this._rgb(hexA), b = this._rgb(hexB);
    return `rgb(${Math.round(a.r + (b.r - a.r) * k)},${Math.round(a.g + (b.g - a.g) * k)},${Math.round(a.b + (b.b - a.b) * k)})`;
  }
  _rgb(hex) {
    if (this._rgbCache?.[hex]) return this._rgbCache[hex];
    const n = parseInt(hex.slice(1), 16);
    const v = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    (this._rgbCache ||= {})[hex] = v;
    return v;
  }
}

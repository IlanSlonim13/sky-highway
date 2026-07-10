// Sky Highway — pseudo-3D canvas renderer.
//
// v8 "classic" pass, styled after SkyRoads (1993): flat-shaded solid-color
// tiles with dark seams, chunky extruded road slabs floating in space, a
// black starfield with flat horizon band and flat-shaded planets, a small
// silver ship with a blue canopy — no gradients-per-tile, no bloom, no glow.
// The original's tile color language applies: light green = boost,
// light red = burning, blue = fuel supplies, dark gray = slippery-look floor.
//
// Perf budget: dpr cap 2, flat fills only in the row loop, zero shadowBlur,
// sky pre-rendered into a cached offscreen canvas per theme.

import { CAMERA, CELL, BLOCK_HEIGHTS, TRACK_LANES, DEBRIS, RING, COMETS } from './config.js';
import { equippedShip } from './cosmetics.js';

const HAZARD_TILE = '#d84838';   // light red burning tile
const BOOST_TILE = '#58c858';    // light green boost tile
const PAD_TILE = '#48b8c8';      // bounce pad tile
const FUEL_TILE = '#2848c8';     // blue supplies tile
const FUEL_CORE = '#4a6ce8';
const BARRIER_A = '#c87828';     // destructible barrier faces
const BARRIER_B = '#5a3810';
const COIN_COLOR = '#e8c040';
const AMMO_COLOR = '#48c8e0';
const HULL = '#b4bac4';          // default silver hull (SkyRoads gray)
const CANOPY = '#2860c8';        // blue cockpit glass
const ECHO_STYLE = { color: '#54f0ff', flame: '#a0f4ff', wing: 1.0, nose: 1.0 };
const NEAR = 0.6; // near plane: clamp geometry this close to the camera

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    // a dense field of remote stars covering the WHOLE screen (the track is
    // drawn over them, so below-horizon stars fill the void beside the road)
    this.stars = [];
    for (let i = 0; i < 460; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        d: Math.random() < 0.7 ? 0.15 + Math.random() * 0.4 : 0.55 + Math.random() * 0.45,
        tw: Math.random() * 6.28,
      });
    }
    this._assets = new Map(); // themeName|WxH -> { sky }
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

  // pre-rendered per-theme sky: black space, a flat horizon band and
  // flat-shaded planets sitting on the horizon (SkyRoads-style static scene)
  _themeAssets(theme) {
    const key = `${theme.name}|${this.w}x${this.h}`;
    if (this._assets.has(key)) return this._assets.get(key);
    if (this._assets.size > 6) this._assets.delete(this._assets.keys().next().value);

    const w = Math.max(2, this.w), h = Math.max(2, this.h);
    const sky = document.createElement('canvas');
    sky.width = w; sky.height = h;
    const sc = sky.getContext('2d');
    sc.fillStyle = theme.skyTop;
    sc.fillRect(0, 0, w, h);

    // horizon band: colored gradient that peaks at the horizon line
    const hy = h * CAMERA.horizon;
    const bandTop = hy - h * 0.30;
    const band = sc.createLinearGradient(0, bandTop, 0, hy);
    band.addColorStop(0, 'transparent');
    band.addColorStop(0.75, this._alpha(theme.skyBot, 0.55));
    band.addColorStop(1, theme.skyBot);
    sc.fillStyle = band;
    sc.fillRect(0, bandTop, w, hy - bandTop);
    // and a short mirrored falloff below the horizon into the void
    const below = sc.createLinearGradient(0, hy, 0, hy + h * 0.05);
    below.addColorStop(0, theme.skyBot);
    below.addColorStop(1, 'transparent');
    sc.fillStyle = below;
    sc.fillRect(0, hy, w, h * 0.05);

    // flat-shaded planets: solid disc + offset darker crescent, no glow.
    // positions derive from the theme name so each world has its own sky
    let seed = 0;
    for (const c of theme.name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const planet = (cx, cy, r, color) => {
      sc.save();
      sc.beginPath();
      sc.arc(cx, cy, r, 0, 6.29);
      sc.clip();
      sc.fillStyle = color;
      sc.fillRect(cx - r, cy - r, r * 2, r * 2);
      // terminator: darker offset disc carves the shaded side
      sc.fillStyle = 'rgba(0,0,6,0.55)';
      sc.beginPath();
      sc.arc(cx + r * 0.45, cy + r * 0.3, r, 0, 6.29);
      sc.fill();
      sc.restore();
    };
    // big planet resting on the horizon
    const pr = Math.min(w, h) * (0.16 + rnd() * 0.10);
    planet(w * (0.15 + rnd() * 0.7), hy - pr * (0.15 + rnd() * 0.4), pr, this._shade(theme.skyBot, 1.5));
    // small distant moon high in the sky
    const mr = Math.min(w, h) * (0.028 + rnd() * 0.02);
    planet(w * (0.1 + rnd() * 0.8), h * (0.06 + rnd() * 0.14), mr, '#9aa0ac');

    const assets = { sky };
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

    // stars: steady flat dots everywhere (the track draws over them, so the
    // void beside the road is star-speckled too — classic static space)
    ctx.fillStyle = theme.star;
    for (const s of this.stars) {
      const sx = ((s.x - ship.z * 0.004 * s.d) % 1 + 1) % 1 * w;
      const sy = s.y * h;
      ctx.globalAlpha = 0.25 + 0.55 * s.d;
      const r = 0.5 + s.d * 1.3;
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

      // flat solid tiles — SkyRoads tile color language, no gradients
      const SLAB = 0.38; // road slab thickness (world units)
      const rowPrev = row > 0 ? level.rows[row - 1] : null;
      for (let lane = 0; lane < TRACK_LANES; lane++) {
        const ch = rowStr[lane];
        if (ch === CELL.EMPTY || ch === CELL.COIN_AIR || ch === CELL.RING) continue;
        const lx = lane - 3;
        const destroyed = ch === CELL.DESTRUCTIBLE && game.destroyed.has(row * 7 + lane);
        let fill;
        if (ch === CELL.HAZARD) fill = HAZARD_TILE;
        else if (ch === CELL.BOOST) fill = BOOST_TILE;
        else if (ch === CELL.PAD) fill = PAD_TILE;
        else if (ch === CELL.FUEL) fill = FUEL_TILE;
        else if (destroyed) fill = '#26262c'; // scorched stub
        else fill = theme.floor;
        this._quad(ctx, px(lx - 0.5, z0), py(0, z0), px(lx + 0.5, z0), py(0, z0),
          px(lx + 0.5, z1), py(0, z1), px(lx - 0.5, z1), py(0, z1), fill);
        if (ch === CELL.FUEL) {
          // lighter core so the supplies strip reads from a distance
          this._quad(ctx, px(lx - 0.32, z0 + 0.15), py(0, z0 + 0.15), px(lx + 0.32, z0 + 0.15), py(0, z0 + 0.15),
            px(lx + 0.32, z1 - 0.15), py(0, z1 - 0.15), px(lx - 0.32, z1 - 0.15), py(0, z1 - 0.15), FUEL_CORE);
        }

        // extruded slab: dark outer side walls + near face at slab ends,
        // so the road reads as chunky blocks floating in space
        const sideFill = this._shade(theme.floorAlt, 0.62);
        if ((lane === 0 || rowStr[lane - 1] === CELL.EMPTY || rowStr[lane - 1] === CELL.COIN_AIR) && lx - 0.5 > camX) {
          this._quad(ctx, px(lx - 0.5, z0), py(0, z0), px(lx - 0.5, z1), py(0, z1),
            px(lx - 0.5, z1), py(-SLAB, z1), px(lx - 0.5, z0), py(-SLAB, z0), sideFill);
        }
        if ((lane === TRACK_LANES - 1 || rowStr[lane + 1] === CELL.EMPTY || rowStr[lane + 1] === CELL.COIN_AIR) && lx + 0.5 < camX) {
          this._quad(ctx, px(lx + 0.5, z0), py(0, z0), px(lx + 0.5, z1), py(0, z1),
            px(lx + 0.5, z1), py(-SLAB, z1), px(lx + 0.5, z0), py(-SLAB, z0), sideFill);
        }
        if (row - camZ >= NEAR && (!rowPrev || rowPrev[lane] === CELL.EMPTY || rowPrev[lane] === CELL.COIN_AIR)) {
          // near end of a slab facing the camera (the classic gap edge)
          this._quad(ctx, px(lx - 0.5, z0), py(0, z0), px(lx + 0.5, z0), py(0, z0),
            px(lx + 0.5, z0), py(-SLAB, z0), px(lx - 0.5, z0), py(-SLAB, z0),
            this._shade(theme.floorAlt, 0.80));
        }

        // special tile marks (flat, non-additive)
        if (row - camZ >= NEAR) {
          if (ch === CELL.BOOST) this._boostDecal(ctx, px, py, lx, row);
          else if (ch === CELL.PAD) this._padDecal(ctx, px, py, lx, row);
        }
      }

      // dark tile seams: one lateral line per row + lane dividers
      ctx.strokeStyle = 'rgba(0,0,8,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lane = 0; lane < TRACK_LANES; lane++) {
        if (rowStr[lane] === CELL.EMPTY || rowStr[lane] === CELL.COIN_AIR || rowStr[lane] === CELL.RING) continue;
        const lx = lane - 3;
        ctx.moveTo(px(lx - 0.5, z0), py(0, z0));
        ctx.lineTo(px(lx + 0.5, z0), py(0, z0));
        ctx.moveTo(px(lx - 0.5, z0), py(0, z0));
        ctx.lineTo(px(lx - 0.5, z1), py(0, z1));
        ctx.moveTo(px(lx + 0.5, z0), py(0, z0));
        ctx.lineTo(px(lx + 0.5, z1), py(0, z1));
      }
      ctx.stroke();

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

    // ---- comet strikes: target reticle -> incoming streak ----
    for (const c of game.comets || []) {
      if (c.row + 0.5 - camZ < NEAR || c.row > lastRow) continue;
      const cz = c.row + 0.5;
      if (c.state === 'warn') {
        // flat blinking reticle: darkened tile + red target square, no glow
        const prog = Math.min(1, c.t / COMETS.warnS);
        const color = prog < 0.55 ? '#e8e8e8' : '#e04030';
        const blink = Math.sin(t * (6 + prog * 22)) > 0 ? 1 : 0.25;
        this._quad(ctx,
          px(c.lane - 0.5, c.row), py(0.005, c.row), px(c.lane + 0.5, c.row), py(0.005, c.row),
          px(c.lane + 0.5, c.row + 1), py(0.005, c.row + 1), px(c.lane - 0.5, c.row + 1), py(0.005, c.row + 1),
          `rgba(20,4,4,${0.30 + 0.25 * prog})`);
        ctx.save();
        ctx.globalAlpha = blink;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const in0 = 0.36 - prog * 0.10;
        ctx.beginPath();
        ctx.moveTo(px(c.lane - in0, cz - in0), py(0.01, cz - in0));
        ctx.lineTo(px(c.lane + in0, cz - in0), py(0.01, cz - in0));
        ctx.lineTo(px(c.lane + in0, cz + in0), py(0.01, cz + in0));
        ctx.lineTo(px(c.lane - in0, cz + in0), py(0.01, cz + in0));
        ctx.closePath();
        ctx.stroke();
        // crosshair ticks
        ctx.beginPath();
        ctx.moveTo(px(c.lane - 0.5, cz), py(0.01, cz));
        ctx.lineTo(px(c.lane - in0, cz), py(0.01, cz));
        ctx.moveTo(px(c.lane + in0, cz), py(0.01, cz));
        ctx.lineTo(px(c.lane + 0.5, cz), py(0.01, cz));
        ctx.stroke();
        ctx.restore();
      } else {
        // the comet streaks in from high above
        const k = Math.min(1, c.t / COMETS.strikeS);
        const cxW = c.lane + (1 - k) * 2.2;
        const cyW = (1 - k) * 6.5;
        const czW = cz - (1 - k) * 5;
        if (czW - camZ > NEAR) {
          const hx = px(cxW, czW), hy2 = py(cyW, czW);
          const txp = px(cxW + 1.4, czW - 3), typ = py(cyW + 3.6, czW - 3);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const tail = ctx.createLinearGradient(hx, hy2, txp, typ);
          tail.addColorStop(0, 'rgba(255,255,255,0.95)');
          tail.addColorStop(0.3, 'rgba(255,170,90,0.7)');
          tail.addColorStop(1, 'transparent');
          ctx.strokeStyle = tail;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(hx, hy2);
          ctx.lineTo(txp, typ);
          ctx.stroke();
          const s = f / (czW - camZ);
          const core = ctx.createRadialGradient(hx, hy2, 0, hx, hy2, Math.max(3, s * 0.14));
          core.addColorStop(0, '#ffffff');
          core.addColorStop(0.5, '#ffb060');
          core.addColorStop(1, 'transparent');
          ctx.fillStyle = core;
          ctx.beginPath();
          ctx.arc(hx, hy2, Math.max(3, s * 0.14), 0, 6.29);
          ctx.fill();
          ctx.restore();
        }
      }
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

    // ---- projectiles (flat bolts) ----
    for (const p of game.projectiles) {
      if (p.z - camZ < NEAR) continue;
      const sx = px(p.x, p.z), sy = py(0.55, p.z);
      const s = f / (p.z - camZ);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - s * 0.03, sy - s * 0.10, s * 0.06, s * 0.20);
      ctx.fillStyle = AMMO_COLOR;
      ctx.fillRect(sx - s * 0.045, sy + s * 0.08, s * 0.09, s * 0.30);
    }

    // ---- finish gate ----
    if (level.length <= lastRow + 2 && level.length >= firstRow) {
      this._finishGate(ctx, px, py, level.length, theme, t, f, camZ);
    }

    if (!game.attract) {
      // ---- echo ghost: your past run racing beside you ----
      if (game.echoPos) {
        this._ship(ctx, px, py, game.echoPos, theme, f, camZ, t, 0.35, game, ECHO_STYLE);
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

    // flat faces: light top, dark side, medium front — classic solid shading
    this._quad(ctx, px(x0, z0), py(hgt, z0), px(x1, z0), py(hgt, z0),
      px(x1, z1), py(hgt, z1), px(x0, z1), py(hgt, z1), this._shade(top, 1.04));

    if (lx > camX + 0.5) {
      this._quad(ctx, px(x0, z0), py(hgt, z0), px(x0, z1), py(hgt, z1),
        px(x0, z1), py(0, z1), px(x0, z0), py(0, z0), this._shade(front, 0.62));
    } else if (lx < camX - 0.5) {
      this._quad(ctx, px(x1, z0), py(hgt, z0), px(x1, z1), py(hgt, z1),
        px(x1, z1), py(0, z1), px(x1, z0), py(0, z0), this._shade(front, 0.62));
    }

    const fy0 = py(hgt, z0), fy1 = py(0, z0);
    const fx0 = px(x0, z0), fx1 = px(x1, z0);
    this._quad(ctx, fx0, fy0, fx1, fy0, fx1, fy1, fx0, fy1, front);

    if (isBarrier) {
      // flat warning stripes on the front face
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
      ctx.restore();
    }

    // thin dark edge on the near top rim keeps the silhouette crisp
    ctx.strokeStyle = 'rgba(0,0,8,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx0, fy0);
    ctx.lineTo(fx1, fy0);
    ctx.stroke();
  }

  // hurdle: a flat metal crossbar on posts — jump OVER it (a held jump)
  _hurdle(ctx, px, py, lx, row, theme, t) {
    const z = row + 0.5;
    const h = BLOCK_HEIGHTS.hurdle;
    // posts
    for (const side of [-0.46, 0.46]) {
      this._quad(ctx,
        px(lx + side - 0.06, z), py(h + 0.08, z),
        px(lx + side + 0.06, z), py(h + 0.08, z),
        px(lx + side + 0.06, z), py(0, z),
        px(lx + side - 0.06, z), py(0, z),
        this._shade(theme.blockDark, 0.8));
    }
    const fx0 = px(lx - 0.46, z), fx1 = px(lx + 0.46, z);
    // hatched danger field below the bar blocks the "drive under" read
    ctx.save();
    const gy0 = py(h - 0.10, z), gy1 = py(0, z);
    ctx.globalAlpha *= 0.30;
    ctx.fillStyle = HAZARD_TILE;
    ctx.fillRect(Math.min(fx0, fx1), gy0, Math.abs(fx1 - fx0), gy1 - gy0);
    ctx.restore();
    // crossbar: flat light top strip + darker base, red/white warning ticks
    this._quad(ctx, fx0, py(h + 0.05, z), fx1, py(h + 0.05, z),
      fx1, py(h - 0.10, z), fx0, py(h - 0.10, z), '#c8ccd4');
    const blink = Math.sin(t * 6 + row) > 0;
    ctx.fillStyle = blink ? '#e04030' : '#701810';
    const wBar = fx1 - fx0;
    for (let i = 0; i < 3; i++) {
      const bx = fx0 + wBar * (0.2 + i * 0.3);
      const ly0 = py(h + 0.04, z), ly1 = py(h - 0.09, z);
      ctx.fillRect(bx - Math.abs(wBar) * 0.04, ly0, Math.abs(wBar) * 0.08, ly1 - ly0);
    }
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
    // front face: flat battered wreck tone with darker chunks
    const fy0 = py(yT, z0), fy1 = py(yB, z0);
    const fx0 = px(x0, z0), fx1 = px(x1, z0);
    this._quad(ctx, fx0, fy0, fx1, fy0, fx1, fy1, fx0, fy1, '#6a5c4c');
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    const seed = (row * 7 + lx) | 0;
    for (let i = 0; i < 3; i++) {
      const u = ((seed * 31 + i * 47) % 10) / 10;
      ctx.fillRect(fx0 + (fx1 - fx0) * u * 0.8, fy0 + (fy1 - fy0) * ((i + 1) / 4), (fx1 - fx0) * 0.14, (fy1 - fy0) * 0.16);
    }
    // top face
    this._quad(ctx, px(x0, z0), py(yT, z0), px(x1, z0), py(yT, z0),
      px(x1, z1), py(yT, z1), px(x0, z1), py(yT, z1), this._shade('#8a7a66', 1.05));
    // blinking hazard ticks on the underside edge (flat)
    ctx.fillStyle = Math.sin(t * 6 + row) > 0 ? '#e04030' : '#803020';
    const wD = fx1 - fx0;
    for (let i = 0; i < 2; i++) {
      ctx.fillRect(fx0 + wD * (0.25 + i * 0.5) - Math.abs(wD) * 0.05, fy1 - 2, Math.abs(wD) * 0.1, 3);
    }
  }

  // metal ring floating over the void: thread it at the top of a held jump
  _ring(ctx, px, py, lx, z, t) {
    const cx = px(lx, z), cy = py(RING.y, z);
    const rx = Math.abs(px(lx + 0.42, z) - px(lx, z));
    const ry = rx * 1.15; // slightly taller than wide, facing the player
    ctx.save();
    ctx.strokeStyle = '#7a828e';
    ctx.lineWidth = Math.max(3, rx * 0.26);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.29);
    ctx.stroke();
    ctx.strokeStyle = '#d8dde4';
    ctx.lineWidth = Math.max(1.5, rx * 0.09);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.29);
    ctx.stroke();
    // blinking marker so it still reads as a target
    ctx.fillStyle = Math.sin(t * 5 + z) > 0 ? '#e8c040' : '#8a7020';
    ctx.beginPath();
    ctx.arc(cx, cy - ry, Math.max(1.5, rx * 0.10), 0, 6.29);
    ctx.fill();
    ctx.restore();
  }

  _boostDecal(ctx, px, py, lx, row) {
    // flat dark-green chevrons pointing away (direction of travel)
    ctx.fillStyle = this._shade(BOOST_TILE, 0.55);
    for (let i = 0; i < 2; i++) {
      const zc = row + 0.3 + i * 0.4;
      ctx.beginPath();
      ctx.moveTo(px(lx - 0.28, zc), py(0.01, zc));
      ctx.lineTo(px(lx, zc + 0.18), py(0.01, zc + 0.18));
      ctx.lineTo(px(lx + 0.28, zc), py(0.01, zc));
      ctx.lineTo(px(lx, zc + 0.09), py(0.01, zc + 0.09));
      ctx.closePath();
      ctx.fill();
    }
  }

  _padDecal(ctx, px, py, lx, row) {
    // flat white up-arrow on the bounce pad
    const zc = row + 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(px(lx, zc + 0.26), py(0.01, zc + 0.26));
    ctx.lineTo(px(lx + 0.20, zc - 0.10), py(0.01, zc - 0.10));
    ctx.lineTo(px(lx + 0.07, zc - 0.10), py(0.01, zc - 0.10));
    ctx.lineTo(px(lx + 0.07, zc - 0.24), py(0.01, zc - 0.24));
    ctx.lineTo(px(lx - 0.07, zc - 0.24), py(0.01, zc - 0.24));
    ctx.lineTo(px(lx - 0.07, zc - 0.10), py(0.01, zc - 0.10));
    ctx.lineTo(px(lx - 0.20, zc - 0.10), py(0.01, zc - 0.10));
    ctx.closePath();
    ctx.fill();
  }

  _coin(ctx, px, py, lx, z, y, t) {
    const sx = px(lx, z), sy = py(y, z);
    const s = Math.abs(px(lx + 0.5, z) - px(lx, z));
    const wob = Math.abs(Math.cos(t * 4 + z));
    ctx.save();
    ctx.fillStyle = COIN_COLOR;
    ctx.beginPath();
    ctx.moveTo(sx, sy - s * 0.22);
    ctx.lineTo(sx + s * 0.16 * wob, sy);
    ctx.lineTo(sx, sy + s * 0.22);
    ctx.lineTo(sx - s * 0.16 * wob, sy);
    ctx.closePath();
    ctx.fill();
    // flat edge shade on the turning half
    ctx.fillStyle = this._shade(COIN_COLOR, 0.6);
    ctx.beginPath();
    ctx.moveTo(sx, sy - s * 0.22);
    ctx.lineTo(sx + s * 0.16 * wob, sy);
    ctx.lineTo(sx, sy + s * 0.22);
    ctx.lineTo(sx + s * 0.06 * wob, sy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _ammoCell(ctx, px, py, lx, z, y, t) {
    const sx = px(lx, z), sy = py(y, z);
    const s = Math.abs(px(lx + 0.5, z) - px(lx, z));
    ctx.save();
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
    ctx.save();
    // flat metal pillars with a blinking beacon on top
    for (const side of [-3.6, 3.6]) {
      this._quad(ctx, px(side - 0.15, z), py(2.2, z), px(side + 0.15, z), py(2.2, z),
        px(side + 0.15, z), py(0, z), px(side - 0.15, z), py(0, z), '#9aa2ae');
      ctx.fillStyle = Math.sin(t * 5) > 0 ? '#e04030' : '#701810';
      const bx0 = px(side - 0.10, z), bx1 = px(side + 0.10, z);
      ctx.fillRect(Math.min(bx0, bx1), py(2.35, z), Math.abs(bx1 - bx0), Math.max(2, py(2.2, z) - py(2.35, z)));
    }
    // banner
    this._quad(ctx, px(-3.6, z), py(2.2, z), px(3.6, z), py(2.2, z),
      px(3.6, z), py(1.8, z), px(-3.6, z), py(1.8, z), theme.glow);
    const bx = px(0, z), byTop = py(2.13, z), byBot = py(1.87, z);
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
    const hue = (def && def.color) || HULL; // default: SkyRoads silver-gray
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

    // small flat exhaust: a short orange triangle, brighter under boost
    const flameLen = 0.16 * (game.ship.speedMul > 1.05 ? 2.2 : 1);
    poly([P(0.06, 0.04, -0.46), P(-0.06, 0.04, -0.46), P(0, 0.03, -0.46 - flameLen)],
      (def && def.flame) || '#e87828');

    // flat-shaded hull: light half / shadow half, darker wings — no glow
    poly([rR, wR, tR], this._shade(hue, 0.55));
    poly([rL, wL, tL], this._shade(hue, 0.55));
    poly([nose, bR, tR, tail], this._shade(hue, 0.95));
    poly([nose, bL, tL, tail], this._shade(hue, 0.66));
    // top ridge plate
    poly([nose, P(0.05, 0.10, 0.10), tail, P(-0.05, 0.10, 0.10)], this._shade(hue, 1.15));
    // blue cockpit canopy: flat two-tone glass
    poly([P(0, 0.13, 0.30), P(0.055, 0.12, 0.02), P(0, 0.15, -0.10), P(-0.055, 0.12, 0.02)],
      CANOPY);
    poly([P(0, 0.13, 0.30), P(0.03, 0.125, 0.10), P(0, 0.14, -0.02), P(-0.03, 0.125, 0.10)],
      this._shade(CANOPY, 1.6));
    // thin dark outline keeps the silhouette crisp against bright floors
    ctx.strokeStyle = 'rgba(8,10,16,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const o1 = nose, o2 = wR, o3 = tR, o4 = tL, o5 = wL;
    ctx.moveTo(o1[0], o1[1]); ctx.lineTo(o2[0], o2[1]); ctx.lineTo(o3[0], o3[1]);
    ctx.lineTo(o4[0], o4[1]); ctx.lineTo(o5[0], o5[1]); ctx.closePath();
    ctx.stroke();

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
  _rgb(color) {
    if (this._rgbCache?.[color]) return this._rgbCache[color];
    let v;
    if (color[0] === '#') {
      const n = parseInt(color.slice(1), 16);
      v = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    } else {
      // accepts rgb(r,g,b) / rgba(r,g,b,a) — lets helpers compose (_alpha of _lerpColor)
      const m = color.match(/([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      v = m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 255, g: 255, b: 255 };
    }
    (this._rgbCache ||= {})[color] = v;
    return v;
  }
}

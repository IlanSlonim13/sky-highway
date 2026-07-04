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

import { CAMERA, CELL, BLOCK_HEIGHTS, TRACK_LANES, DEBRIS, RING, COMETS } from './config.js';
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
    // 3D space dust surrounding the track (never over the playfield: |x| > 4.5)
    this.dust = [];
    for (let i = 0; i < 150; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.dust.push({
        x: side * (4.5 + Math.random() * 13),
        y: -3 + Math.random() * 7,
        zSeed: Math.random() * 70,
        s: 0.5 + Math.random() * 1.4,
        tw: Math.random() * 6.28,
      });
    }
    // distant scenery drifting past: asteroids and derelict pylons
    this.scenery = [];
    for (let i = 0; i < 9; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.scenery.push({
        x: side * (7 + Math.random() * 9),
        y: -1 + Math.random() * 4,
        zSeed: Math.random() * 130,
        size: 0.8 + Math.random() * 1.8,
        kind: Math.random() < 0.65 ? 'rock' : 'pylon',
        spin: Math.random() * 6.28,
      });
    }
    this._meteor = null;       // occasional shooting star in the sky
    this._meteorNext = 3;
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
    // galaxy band: a soft tilted streak of light across the upper sky
    sc.save();
    sc.translate(w * 0.5, h * 0.16);
    sc.rotate(-0.22);
    const band = sc.createLinearGradient(0, -h * 0.055, 0, h * 0.055);
    band.addColorStop(0, 'transparent');
    band.addColorStop(0.5, this._alpha(theme.star, 0.10));
    band.addColorStop(1, 'transparent');
    sc.fillStyle = band;
    sc.fillRect(-w, -h * 0.055, w * 2, h * 0.11);
    sc.restore();

    // a distant planet with a lit limb and thin ring
    const pr = Math.min(w, h) * 0.085;
    const pcx = w * 0.80, pcy = h * 0.13;
    const pg = sc.createRadialGradient(pcx - pr * 0.4, pcy - pr * 0.4, pr * 0.1, pcx, pcy, pr);
    pg.addColorStop(0, this._alpha(theme.glow, 0.85));
    pg.addColorStop(0.55, this._alpha(theme.floorAlt, 0.65));
    pg.addColorStop(1, 'rgba(4,2,12,0.9)');
    sc.globalCompositeOperation = 'source-over';
    sc.fillStyle = pg;
    sc.beginPath();
    sc.arc(pcx, pcy, pr, 0, 6.29);
    sc.fill();
    sc.globalCompositeOperation = 'lighter';
    sc.strokeStyle = this._alpha(theme.star, 0.30);
    sc.lineWidth = Math.max(1.5, pr * 0.07);
    sc.beginPath();
    sc.ellipse(pcx, pcy, pr * 1.65, pr * 0.42, -0.35, 0, 6.29);
    sc.stroke();

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

    // stars everywhere (full screen, parallax with travel; the track draws
    // over them, so the deep void beside the road twinkles too)
    for (const s of this.stars) {
      const sx = ((s.x - ship.z * 0.004 * s.d) % 1 + 1) % 1 * w;
      const sy = s.y * h;
      const a = 0.35 + 0.3 * Math.sin(t * 2 + s.tw);
      ctx.fillStyle = theme.star;
      ctx.globalAlpha = a * s.d;
      const r = 0.5 + s.d * 1.5;
      ctx.fillRect(sx, sy, r, r);
      if (s.d > 0.85) {
        // bright stars get a little cross glint
        ctx.globalAlpha = a * 0.4;
        ctx.fillRect(sx - r * 1.6, sy + r * 0.25, r * 4.2, r * 0.5);
        ctx.fillRect(sx + r * 0.25, sy - r * 1.6, r * 0.5, r * 4.2);
      }
    }
    ctx.globalAlpha = 1;

    // ---- occasional shooting star across the sky ----
    this._meteorNext -= dtReal;
    if (this._meteorNext <= 0 && !this._meteor) {
      this._meteor = { x: Math.random() * 0.7 + 0.1, y: Math.random() * 0.5, a: 2.5 + Math.random() * 0.6, life: 0.7 };
      this._meteorNext = 4 + Math.random() * 6;
    }
    if (this._meteor) {
      const m = this._meteor;
      m.life -= dtReal;
      if (m.life <= 0) this._meteor = null;
      else {
        const prog = 1 - m.life / 0.7;
        const mx = (m.x + Math.cos(m.a) * prog * 0.3) * w;
        const my = (m.y + Math.sin(m.a) * -prog * 0.25) * horizonY;
        ctx.globalCompositeOperation = 'lighter';
        const tail = ctx.createLinearGradient(mx, my, mx - Math.cos(m.a) * 60, my + Math.sin(m.a) * 50);
        tail.addColorStop(0, `rgba(255,255,255,${0.8 * m.life})`);
        tail.addColorStop(1, 'transparent');
        ctx.strokeStyle = tail;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - Math.cos(m.a) * 60, my + Math.sin(m.a) * 50);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // ---- 3D space dust + drifting scenery surrounding the track ----
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.dust) {
      const zRel = ((p.zSeed - ship.z) % 55 + 55) % 55;
      const zW = camZ + NEAR + 0.4 + zRel;
      const sx = px(p.x, zW), sy = py(p.y, zW);
      if (sy < -20 || sy > h + 20 || sx < -20 || sx > w + 20) continue;
      const depth = 1 - zRel / 55;
      ctx.globalAlpha = (0.25 + 0.5 * depth) * (0.6 + 0.4 * Math.sin(t * 2 + p.tw));
      ctx.fillStyle = theme.star;
      const r = p.s * (0.6 + depth * 2.2);
      ctx.fillRect(sx, sy, r, r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const o of this.scenery) {
      const zRel = ((o.zSeed - ship.z * 0.85) % 130 + 130) % 130;
      const zW = camZ + 3 + zRel;
      const sx = px(o.x, zW), sy = py(o.y, zW);
      if (sy < -60 || sy > h + 60 || sx < -80 || sx > w + 80) continue;
      const s = (f / (zW - camZ)) * o.size;
      ctx.save();
      ctx.translate(sx, sy);
      if (o.kind === 'rock') {
        ctx.rotate(o.spin + t * 0.15);
        const rg = ctx.createRadialGradient(-s * 0.1, -s * 0.1, 0, 0, 0, s * 0.35);
        rg.addColorStop(0, '#6a6274');
        rg.addColorStop(1, '#221e2e');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.moveTo(s * 0.32, 0);
        for (let k = 1; k < 7; k++) {
          const ang = (k / 7) * 6.28;
          const rr = s * (0.24 + 0.10 * Math.sin(o.spin * 7 + k * 3));
          ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // derelict pylon: slim monolith with a blinking beacon
        ctx.fillStyle = '#1c1830';
        ctx.fillRect(-s * 0.05, -s * 0.5, s * 0.1, s * 0.9);
        ctx.fillStyle = this._alpha(theme.glow, 0.3 + 0.5 * (Math.sin(t * 3 + o.spin) > 0.6 ? 1 : 0));
        ctx.fillRect(-s * 0.035, -s * 0.55, s * 0.07, s * 0.07);
      }
      ctx.restore();
    }

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

    // ---- energy rails along the track edges (pulses race forward) ----
    ctx.globalCompositeOperation = 'lighter';
    const railStart = Math.max(firstRow, Math.ceil(camZ + NEAR + 0.2));
    for (const railX of [-3.62, 3.62]) {
      for (let row = railStart; row < lastRow - 2; row += 2) {
        const pulse = ((row - t * 10) % 14 + 14) % 14 < 2.2;
        const fade = row > fadeStart ? 1 - (row - fadeStart) / 9 : 1;
        if (fade <= 0.05) continue;
        ctx.strokeStyle = this._alpha(theme.glow, (pulse ? 0.55 : 0.14) * fade);
        ctx.lineWidth = pulse ? 2.2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(px(railX, row), py(0.04, row));
        ctx.lineTo(px(railX, row + 2), py(0.04, row + 2));
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- comet strikes: target reticle -> incoming streak ----
    for (const c of game.comets || []) {
      if (c.row + 0.5 - camZ < NEAR || c.row > lastRow) continue;
      const cz = c.row + 0.5;
      if (c.state === 'warn') {
        // reticle shifts cyan -> gold -> red as impact nears
        const prog = Math.min(1, c.t / COMETS.warnS);
        const color = prog < 0.55
          ? this._lerpColor('#54f0ff', '#ffd24a', prog / 0.55)
          : this._lerpColor('#ffd24a', '#ff3b30', (prog - 0.55) / 0.45);
        const blink = prog > 0.8 ? (Math.sin(t * 30) > 0 ? 1 : 0.35) : 1;
        const rx = Math.abs(px(c.lane + 0.45, cz) - px(c.lane, cz)) * (1.15 - prog * 0.35);
        const ry = Math.abs(py(0.01, cz + 0.45) - py(0.01, cz)) * (1.15 - prog * 0.35);
        ctx.save();
        // darken the doomed tile so the reticle pops on bright floors
        this._quad(ctx,
          px(c.lane - 0.5, c.row), py(0.005, c.row), px(c.lane + 0.5, c.row), py(0.005, c.row),
          px(c.lane + 0.5, c.row + 1), py(0.005, c.row + 1), px(c.lane - 0.5, c.row + 1), py(0.005, c.row + 1),
          `rgba(10,0,8,${0.30 + 0.25 * prog})`);
        ctx.globalCompositeOperation = 'lighter';
        // beacon column so the target reads from far away
        const bx0 = px(c.lane - 0.20, cz), bx1 = px(c.lane + 0.20, cz);
        const byTop = py(3.6, cz), byBot = py(0.02, cz);
        const beam = ctx.createLinearGradient(0, byTop, 0, byBot);
        beam.addColorStop(0, 'transparent');
        beam.addColorStop(1, this._alpha(color, (0.45 + 0.20 * Math.sin(t * 8)) * blink));
        ctx.fillStyle = beam;
        ctx.fillRect(Math.min(bx0, bx1), byTop, Math.abs(bx1 - bx0), byBot - byTop);
        ctx.strokeStyle = this._alpha(color, blink);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(px(c.lane, cz), py(0.01, cz), rx, ry, 0, 0, 6.29);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(px(c.lane, cz), py(0.01, cz), rx * 0.45, ry * 0.45, 0, 0, 6.29);
        ctx.stroke();
        // crosshair ticks
        ctx.beginPath();
        ctx.moveTo(px(c.lane - 0.55, cz), py(0.01, cz));
        ctx.lineTo(px(c.lane - 0.30, cz), py(0.01, cz));
        ctx.moveTo(px(c.lane + 0.30, cz), py(0.01, cz));
        ctx.lineTo(px(c.lane + 0.55, cz), py(0.01, cz));
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

  // electric fence: crackling lightning fills the WHOLE space from the floor
  // to the top rail — unmistakably a wall you must jump OVER, never under
  _hurdle(ctx, px, py, lx, row, theme, t) {
    const z = row + 0.5;
    const h = BLOCK_HEIGHTS.hurdle;
    const flick = 0.7 + 0.3 * Math.sin(t * 18 + row * 3.1);
    // cheap deterministic hash for jittering bolts (reseeds ~12x/sec)
    const seed0 = row * 131 + ((t * 12) | 0) * 977;
    const rnd = (n) => {
      const v = Math.sin(seed0 + n * 127.1) * 43758.5453;
      return v - Math.floor(v);
    };

    // posts with glowing caps
    for (const side of [-0.46, 0.46]) {
      this._quad(ctx,
        px(lx + side - 0.06, z), py(h + 0.10, z),
        px(lx + side + 0.06, z), py(h + 0.10, z),
        px(lx + side + 0.06, z), py(0, z),
        px(lx + side - 0.06, z), py(0, z),
        this._shade(theme.blockDark, 0.9));
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // charged field haze floor-to-rail (blocks the "drive under" read)
    const fy0 = py(h, z), fy1 = py(0, z);
    const fx0 = px(lx - 0.46, z), fx1 = px(lx + 0.46, z);
    const field = ctx.createLinearGradient(0, fy0, 0, fy1);
    field.addColorStop(0, this._alpha('#8ae2ff', 0.30 * flick));
    field.addColorStop(0.5, this._alpha('#4da8ff', 0.16 * flick));
    field.addColorStop(1, this._alpha('#8ae2ff', 0.26 * flick));
    this._quad(ctx, fx0, fy0, fx1, fy0, fx1, fy1, fx0, fy1, field);

    // jagged lightning bolts spanning top rail -> floor
    for (let b = 0; b < 3; b++) {
      const xa = lx - 0.36 + rnd(b) * 0.72;         // start x at the rail
      const xb = lx - 0.36 + rnd(b + 10) * 0.72;    // end x at the floor
      ctx.beginPath();
      ctx.moveTo(px(xa, z), py(h - 0.02, z));
      const segs = 4;
      for (let k = 1; k <= segs; k++) {
        const yy = (h - 0.02) * (1 - k / segs);
        const xx = xa + (xb - xa) * (k / segs) + (rnd(b * 7 + k) - 0.5) * 0.22;
        ctx.lineTo(px(xx, z), py(Math.max(0.01, yy), z));
      }
      ctx.strokeStyle = this._alpha('#e8fbff', 0.85 * flick);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = this._alpha('#54c8ff', 0.35 * flick);
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // top rail: hot core + glow
    this._quad(ctx, fx0, py(h + 0.03, z), fx1, py(h + 0.03, z),
      fx1, py(h - 0.09, z), fx0, py(h - 0.09, z),
      this._alpha('#ffffff', 0.75 * flick));
    this._quad(ctx, fx0, py(h + 0.09, z), fx1, py(h + 0.09, z),
      fx1, py(h - 0.16, z), fx0, py(h - 0.16, z),
      this._alpha('#54c8ff', 0.35 * flick));

    // spark caps on the posts
    for (const side of [-0.46, 0.46]) {
      const sx = px(lx + side, z), sy = py(h + 0.10, z);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 6);
      g.addColorStop(0, `rgba(232,251,255,${0.9 * flick})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 6, sy - 6, 12, 12);
    }

    ctx.restore();
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
    // chevrons point AWAY from the camera (+z), the direction of travel
    const phase = (this.t * 3 + row * 0.5) % 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this._alpha('#ffffff', 0.40 + 0.25 * Math.sin(phase * 6.28));
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

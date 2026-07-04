// Sky Highway — pseudo-3D canvas renderer (SkyRoads-style perspective).
//
// Pure function of game state: render(game, dtReal). Owns only cosmetic
// state (starfield, animation clock). Painter's algorithm: sky, then track
// rows far-to-near (floor quads, then boxes sorted outside-in per row),
// items, finish gate, ship shadow, ship, particles, FX overlays.

import { CAMERA, CELL, BLOCK_HEIGHTS, TRACK_LANES } from './config.js';
import { equippedShip, equippedTrail } from './cosmetics.js';

const ECHO_STYLE = { color: '#54f0ff', flame: '#a0f4ff', wing: 1.0, nose: 1.0 };

const HAZARD_A = '#ff5030';
const HAZARD_B = '#7a1400';
const BARRIER_A = '#ff9500';
const BARRIER_B = '#4a2a00';
const COIN_COLOR = '#ffd24a';
const AMMO_COLOR = '#54f0ff';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.stars = [];
    for (let i = 0; i < 130; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), d: 0.2 + Math.random() * 0.8, tw: Math.random() * 6.28 });
    }
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

  render(game, dtReal) {
    this.t += dtReal;
    const { ctx, w, h, t } = this;
    const level = game.level;
    const theme = level.theme;
    const ship = game.ship;

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

    // ---- sky ----
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(Math.max(0.01, CAMERA.horizon), theme.skyBot);
    sky.addColorStop(1, theme.skyTop);
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, w + 40, h + 40);

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

    // horizon glow
    const glow = ctx.createLinearGradient(0, horizonY - h * 0.09, 0, horizonY + h * 0.05);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(0.7, this._alpha(theme.glow, 0.28));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizonY - h * 0.09, w, h * 0.14);

    // ---- track rows, far to near ----
    // start 5 rows behind the ship: the camera sits 5.2 back and can see
    // down to ~ship.z - 3.5 at the bottom edge of the screen
    const firstRow = Math.max(0, Math.floor(ship.z) - 5);
    const lastRow = Math.min(level.length - 1, firstRow + CAMERA.drawRows);
    const fadeStart = lastRow - 8;

    const NEAR = 0.6; // near plane: clamp geometry this close to the camera

    for (let row = lastRow; row >= firstRow; row--) {
      const rowStr = level.rows[row];
      const rowAlpha = row > fadeStart ? 1 - (row - fadeStart) / (lastRow - fadeStart + 1) : 1;
      if (rowAlpha <= 0.02) continue;
      ctx.globalAlpha = rowAlpha;

      let z0 = row;
      const z1 = row + 1;
      if (z1 - camZ < NEAR) continue;              // fully behind the camera
      if (z0 - camZ < NEAR) z0 = camZ + NEAR;      // partially behind: clamp

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
          fill = '#1a1a1f'; // scorched stub
        } else {
          fill = (row + lane) % 2 === 0 ? theme.floor : theme.floorAlt;
        }
        this._quad(ctx, px(lx - 0.5, z0), py(0, z0), px(lx + 0.5, z0), py(0, z0),
          px(lx + 0.5, z1), py(0, z1), px(lx - 0.5, z1), py(0, z1), fill);

        // neon edge on outermost lanes + near edge line
        ctx.strokeStyle = this._alpha(theme.glow, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px(lx - 0.5, z0), py(0, z0));
        ctx.lineTo(px(lx + 0.5, z0), py(0, z0));
        ctx.stroke();

        // special tile decals (skip when the row is clamped against the near plane)
        if (row - camZ >= NEAR) {
          if (ch === CELL.BOOST) this._boostDecal(ctx, px, py, lx, row);
          else if (ch === CELL.PAD) this._padDecal(ctx, px, py, lx, row);
        }
      }

      // blocks, outside-in relative to camera
      if (row - camZ < NEAR) { ctx.globalAlpha = 1; continue; }
      const lanes = [];
      for (let lane = 0; lane < TRACK_LANES; lane++) {
        const ch = rowStr[lane];
        if (ch === CELL.LOW || ch === CELL.TALL ||
            (ch === CELL.DESTRUCTIBLE && !game.destroyed.has(row * 7 + lane))) lanes.push(lane);
      }
      lanes.sort((a, b) => Math.abs((b - 3) - camX) - Math.abs((a - 3) - camX));
      for (const lane of lanes) {
        const ch = rowStr[lane];
        const hgt = ch === CELL.LOW ? BLOCK_HEIGHTS.low : BLOCK_HEIGHTS.tall;
        this._box(ctx, px, py, lane - 3, row, hgt, ch, theme, camX, t);
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
        }
      }
    }

    // ---- projectiles ----
    for (const p of game.projectiles) {
      const sx = px(p.x, p.z), sy = py(0.55, p.z);
      const s = f / (p.z - camZ);
      ctx.save();
      ctx.shadowColor = AMMO_COLOR;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - s * 0.03, sy - s * 0.10, s * 0.06, s * 0.20);
      ctx.fillStyle = this._alpha(AMMO_COLOR, 0.6);
      ctx.fillRect(sx - s * 0.02, sy + s * 0.10, s * 0.04, s * 0.25);
      ctx.restore();
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

      // ---- engine trail ribbon ----
      if (game.trailPoints && game.trailPoints.length > 2) {
        const trail = equippedTrail();
        for (let i = 0; i < game.trailPoints.length - 1; i++) {
          const p = game.trailPoints[i];
          if (p.z - camZ < 0.6) continue;
          const a = (i / game.trailPoints.length) * 0.35;
          const s = f / (p.z - camZ);
          ctx.globalAlpha = a;
          ctx.fillStyle = trail.color;
          const r = s * 0.05 * (i / game.trailPoints.length + 0.3);
          ctx.beginPath();
          ctx.arc(px(p.x, p.z), py(p.y, p.z), Math.max(0.5, r), 0, 6.29);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // ---- ship shadow ----
      const g = game.groundInfoForRender;
      if (g && g.height > -100) {
        const sz = ship.z + 0.001;
        const sx = px(ship.x, sz), sy = py(g.height, sz);
        const s = f / (sz - camZ);
        const lift = Math.max(0, ship.y - g.height);
        const shrink = Math.max(0.35, 1 - lift * 0.35);
        ctx.fillStyle = `rgba(0,0,0,${0.4 * shrink})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, s * 0.30 * shrink, s * 0.085 * shrink, 0, 0, 6.29);
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

    // ---- particles ----
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

    // top face
    this._quad(ctx, px(x0, z0), py(hgt, z0), px(x1, z0), py(hgt, z0),
      px(x1, z1), py(hgt, z1), px(x0, z1), py(hgt, z1), top);
    // side face toward camera
    if (lx > camX + 0.5) {
      this._quad(ctx, px(x0, z0), py(hgt, z0), px(x0, z1), py(hgt, z1),
        px(x0, z1), py(0, z1), px(x0, z0), py(0, z0), this._shade(front, 0.75));
    } else if (lx < camX - 0.5) {
      this._quad(ctx, px(x1, z0), py(hgt, z0), px(x1, z1), py(hgt, z1),
        px(x1, z1), py(0, z1), px(x1, z0), py(0, z0), this._shade(front, 0.75));
    }
    // front face (toward camera at z0)
    this._quad(ctx, px(x0, z0), py(hgt, z0), px(x1, z0), py(hgt, z0),
      px(x1, z0), py(0, z0), px(x0, z0), py(0, z0), front);

    if (isBarrier) {
      // warning stripes + pulsing core on the front face
      const fy0 = py(hgt, z0), fy1 = py(0, z0);
      const fx0 = px(x0, z0), fx1 = px(x1, z0);
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
    } else {
      // glow silhouette on top edge
      ctx.strokeStyle = this._alpha(theme.glow, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(x0, z0), py(hgt, z0));
      ctx.lineTo(px(x1, z0), py(hgt, z0));
      ctx.stroke();
    }
  }

  _boostDecal(ctx, px, py, lx, row) {
    const phase = (this.t * 3 + row * 0.5) % 1;
    ctx.fillStyle = this._alpha('#ffffff', 0.55 + 0.3 * Math.sin(phase * 6.28));
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
  }

  _padDecal(ctx, px, py, lx, row) {
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6 + row);
    const zc = row + 0.5;
    ctx.strokeStyle = this._alpha('#ffffff', 0.4 + 0.5 * pulse);
    ctx.lineWidth = 2;
    const rx = Math.abs(px(lx + 0.3, zc) - px(lx, zc)) * (0.7 + pulse * 0.3);
    const ry = Math.abs(py(0.01, zc + 0.3) - py(0.01, zc)) * (0.7 + pulse * 0.3);
    ctx.beginPath();
    ctx.ellipse(px(lx, zc), py(0.01, zc), rx, ry, 0, 0, 6.29);
    ctx.stroke();
  }

  _coin(ctx, px, py, lx, z, y, t) {
    const sx = px(lx, z), sy = py(y, z);
    const s = Math.abs(px(lx + 0.5, z) - px(lx, z));
    const wob = Math.abs(Math.cos(t * 4 + z));
    ctx.save();
    ctx.shadowColor = COIN_COLOR;
    ctx.shadowBlur = 10;
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
    ctx.translate(sx, sy);
    ctx.rotate(t * 2);
    ctx.shadowColor = AMMO_COLOR;
    ctx.shadowBlur = 12;
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

  _ship(ctx, px, py, ship, theme, f, camZ, t, alpha, game, def) {
    const sz = ship.z;
    if (sz - camZ < 0.4) return;
    const sx = px(ship.x, sz), sy = py(ship.y + 0.12, sz);
    const u = (f / (sz - camZ)) * 0.5; // px per world-unit at ship depth, halved for sprite scale
    const hue = (def && def.color) || theme.glow;   // 'adaptive' ships use the theme
    const wing = (def && def.wing) || 1;
    const nose = (def && def.nose) || 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.rotate((ship.bank || 0) * 0.5);

    // engine flame
    const flick = 0.75 + 0.25 * Math.sin(t * 40) + (game.ship.speedMul > 1.05 ? 0.5 : 0);
    const flameLen = u * (0.55 + 0.25 * flick);
    const flameColor = (def && def.flame) || '#57c8ff';
    const fg = ctx.createLinearGradient(0, u * 0.3, 0, u * 0.3 + flameLen);
    fg.addColorStop(0, '#bff4ff');
    fg.addColorStop(0.4, flameColor);
    fg.addColorStop(1, 'transparent');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-u * 0.13, u * 0.28);
    ctx.lineTo(u * 0.13, u * 0.28);
    ctx.lineTo(0, u * 0.3 + flameLen);
    ctx.closePath();
    ctx.fill();

    // body
    ctx.shadowColor = hue;
    ctx.shadowBlur = 12;
    const body = ctx.createLinearGradient(0, -u * 0.5, 0, u * 0.35);
    body.addColorStop(0, '#f2f6ff');
    body.addColorStop(0.45, hue);
    body.addColorStop(1, this._shade(hue, 0.45));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, -u * 0.52 * nose);          // nose
    ctx.lineTo(u * 0.14, -u * 0.10);
    ctx.lineTo(u * 0.42 * wing, u * 0.26);    // right wing tip
    ctx.lineTo(u * 0.16, u * 0.20);
    ctx.lineTo(u * 0.10, u * 0.30);           // right tail
    ctx.lineTo(-u * 0.10, u * 0.30);          // left tail
    ctx.lineTo(-u * 0.16, u * 0.20);
    ctx.lineTo(-u * 0.42 * wing, u * 0.26);   // left wing tip
    ctx.lineTo(-u * 0.14, -u * 0.10);
    ctx.closePath();
    ctx.fill();

    // cockpit
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, -u * 0.16, u * 0.06, u * 0.12, 0, 0, 6.29);
    ctx.fill();

    ctx.restore();
  }

  // ---- color helpers ----
  _alpha(hex, a) {
    const { r, g, b } = this._rgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  _shade(hex, k) {
    const { r, g, b } = this._rgb(hex);
    return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
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

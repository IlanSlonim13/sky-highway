#!/usr/bin/env node
// Generates the store source assets Capacitor's asset pipeline consumes:
//   resources/icon.png    1024x1024  (from www/assets/icon.svg)
//   resources/splash.png  2732x2732  (dark brand splash)
// Then: npx @capacitor/assets generate --iconBackgroundColor '#050014'
//
// Uses the locally installed Chromium (playwright-core devDependency).

import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from './imgsize.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'resources'), { recursive: true });

const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const svg = readFileSync(join(root, 'www/assets/icon.svg'), 'utf8');
const svgData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// ---- icon 1024x1024 ----
{
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(`<body style="margin:0"><img src="${svgData}" style="width:1024px;height:1024px;display:block"></body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, 'resources/icon.png') });
  await page.close();
}

// ---- splash 2732x2732 ----
{
  const page = await (await browser.newContext({ viewport: { width: 2732, height: 2732 }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(`<body style="margin:0;width:2732px;height:2732px;background:#050014;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Courier New',monospace">
    <img src="${svgData}" style="width:1000px;height:1000px">
    <div style="margin-top:60px;font-size:150px;font-weight:bold;letter-spacing:0.1em;color:#fff;text-shadow:0 0 40px #c86bff,0 0 120px #c86bff">SKY HIGHWAY</div>
  </body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, 'resources/splash.png') });
  await page.close();
}

await browser.close();

for (const [file, want] of [['resources/icon.png', 1024], ['resources/splash.png', 2732]]) {
  const { width, height } = imageSize(join(root, file));
  if (width !== want || height !== want) throw new Error(`${file}: ${width}x${height}, expected ${want}x${want}`);
  console.log(`${file}  ${width}x${height} ✓`);
}

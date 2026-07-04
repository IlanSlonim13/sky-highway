#!/usr/bin/env node
// Bundles the whole game into one self-contained HTML file (dist/sky-highway.html)
// suitable for hosting anywhere a single page can be served — including as a
// claude.ai Artifact (strict CSP: no external requests; everything inlined).
//
// The output intentionally has no <!doctype>/<html>/<head>/<body> skeleton —
// the Artifact wrapper supplies those. Serve-anywhere copies can still open it
// directly in a browser (browsers synthesize the skeleton).
//
// Usage: node tools/build-single.mjs

import { rollup } from 'rollup';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const bundle = await rollup({
  input: join(root, 'www/js/main.js'),
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
});
const { output } = await bundle.generate({ format: 'iife', name: 'SkyHighway' });
await bundle.close();
const js = output[0].code;

const css = readFileSync(join(root, 'www/css/style.css'), 'utf8');
const indexHtml = readFileSync(join(root, 'www/index.html'), 'utf8');

const bodyMatch = indexHtml.match(/<body>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error('could not find <body> in www/index.html');
const body = bodyMatch[1]
  .replace(/\s*<script[^>]*src=[^>]*><\/script>/g, '');

const html = `<title>Sky Highway</title>
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/sky-highway.html');
writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KB)`);

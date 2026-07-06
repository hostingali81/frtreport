/**
 * Renders the FRT Calling app icon + splash assets from inline SVG using
 * headless Chrome (puppeteer). Outputs 1024/512/1152px PNGs into
 * mobile/assets/icon/, which flutter_launcher_icons and flutter_native_splash
 * then fan out into every Android density.
 *
 *   node scripts/render-icons.mjs
 */

import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const OUT = path.resolve('mobile/assets/icon');
mkdirSync(OUT, { recursive: true });

// Material "call" glyph (24u viewbox) + a clean custom bolt.
const HANDSET =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';
const BOLT = 'M13.6 1 L5.2 14 H10.2 L8.9 23 L18.4 9.6 H12.6 Z';

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366F1"/>
      <stop offset="0.55" stop-color="#4F46E5"/>
      <stop offset="1" stop-color="#3730A3"/>
    </linearGradient>
    <linearGradient id="boltg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FDE68A"/>
      <stop offset="1" stop-color="#F59E0B"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.25" cy="0.2" r="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

// The glyph cluster: handset bottom-left, bolt tucked into the empty
// top-right of the handset's diagonal. `s` scales the whole cluster around
// the canvas centre (512,512 on a 1024 canvas).
function cluster(s = 1) {
  return `
  <g transform="translate(512 512) scale(${s}) translate(-512 -512)">
    <path d="${HANDSET}" fill="#FFFFFF" transform="translate(262 282) scale(20.8)"/>
    <path d="${BOLT}" fill="url(#boltg)" stroke="#4F46E5" stroke-width="1.4" stroke-linejoin="round"
          transform="translate(560 170) scale(13)"/>
  </g>`;
}

function svgFull(size, radiusPct, clusterScale) {
  const r = Math.round((size * radiusPct) / 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${DEFS}
  <rect width="1024" height="1024" rx="${Math.round((1024 * radiusPct) / 100)}" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="${Math.round((1024 * radiusPct) / 100)}" fill="url(#sheen)"/>
  ${cluster(clusterScale)}
</svg>`;
}

function svgForeground() {
  // Adaptive foreground: transparent, cluster shrunk into the centre safe
  // zone (launchers may mask to a circle ~66% of the canvas).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${DEFS}
  ${cluster(0.66)}
</svg>`;
}

function svgBackground() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${DEFS}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#sheen)"/>
</svg>`;
}

function svgSplashBadge(size) {
  // Rounded-square badge on transparent — centred by flutter_native_splash
  // on the app's light background.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${DEFS}
  <rect x="112" y="112" width="800" height="800" rx="180" fill="url(#bg)"/>
  <rect x="112" y="112" width="800" height="800" rx="180" fill="url(#sheen)"/>
  ${cluster(0.62)}
</svg>`;
}

function svgAndroid12() {
  // Android 12+ splash icon: 1152px canvas, content must sit inside the
  // centre 768px circle (the system masks it).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1152" height="1152" viewBox="0 0 1152 1152">
  ${DEFS}
  <circle cx="576" cy="576" r="384" fill="url(#bg)"/>
  <circle cx="576" cy="576" r="384" fill="url(#sheen)"/>
  <g transform="translate(576 576) scale(0.6) translate(-512 -512)">
    <path d="${HANDSET}" fill="#FFFFFF" transform="translate(262 282) scale(20.8)"/>
    <path d="${BOLT}" fill="url(#boltg)" stroke="#4F46E5" stroke-width="1.4" stroke-linejoin="round"
          transform="translate(560 170) scale(13)"/>
  </g>
</svg>`;
}

const ASSETS = [
  { file: 'icon.png', svg: svgFull(1024, 0, 0.92), w: 1024, h: 1024 }, // legacy launcher (square, launcher masks it)
  { file: 'icon_fg.png', svg: svgForeground(), w: 1024, h: 1024 },
  { file: 'icon_bg.png', svg: svgBackground(), w: 1024, h: 1024 },
  { file: 'splash.png', svg: svgSplashBadge(512), w: 512, h: 512 },
  { file: 'splash_android12.png', svg: svgAndroid12(), w: 1152, h: 1152 },
  { file: 'preview.png', svg: svgFull(1024, 22, 0.92), w: 1024, h: 1024 }, // rounded preview, for eyeballing only
];

async function launch() {
  try {
    return await puppeteer.launch();
  } catch {
    return await puppeteer.launch({ channel: 'chrome' });
  }
}

const browser = await launch();
const page = await browser.newPage();
for (const a of ASSETS) {
  await page.setViewport({ width: a.w, height: a.h, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>*{margin:0;padding:0}body{background:transparent}</style>${a.svg}`,
  );
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: a.w, height: a.h } });
  writeFileSync(path.join(OUT, a.file), buf);
  console.log(`✓ ${a.file}`);
}
await browser.close();
console.log(`Done → ${OUT}`);

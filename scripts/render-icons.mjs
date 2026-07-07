import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const OUT = path.resolve('mobile/assets/icon');
mkdirSync(OUT, { recursive: true });

const HANDSET =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';

const DEFS = `
  <defs>
    <!-- Deep Navy/Royal Blue Gradient for background -->
    <radialGradient id="bg" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#0b326b"/>
      <stop offset="60%" stop-color="#041d3d"/>
      <stop offset="100%" stop-color="#010e21"/>
    </radialGradient>
    
    <!-- Cyan/Sky Blue Gradient for the calling waves -->
    <linearGradient id="waveg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    
    <!-- Drop Shadow for Handset and Waves -->
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
    
    <!-- Glow/Highlight for Text -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.2"/>
    </filter>
  </defs>`;

function getWavePaths(cx, cy) {
  const radii = [60, 100, 140, 180];
  const startAngleDeg = -10;
  const endAngleDeg = -80;
  const strokeWidth = 18;
  const strokeColor = 'url(#waveg)';
  
  let paths = '';
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;
  
  for (const r of radii) {
    const x1 = (cx + r * Math.cos(startRad)).toFixed(1);
    const y1 = (cy + r * Math.sin(startRad)).toFixed(1);
    const x2 = (cx + r * Math.cos(endRad)).toFixed(1);
    const y2 = (cy + r * Math.sin(endRad)).toFixed(1);
    
    paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 0 0 ${x2} ${y2}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" />\n`;
  }
  return paths;
}

function cluster(s = 1) {
  const cx = 624.5;
  const cy = 295.0;
  const waves = getWavePaths(cx, cy);
  return `
  <g transform="translate(512 512) scale(${s}) translate(-512 -512)">
    <g filter="url(#shadow)">
      <!-- Handset receiver, mirrored horizontally to tilt from bottom-left to top-right -->
      <path d="${HANDSET}"
            fill="#FFFFFF"
            transform="translate(480 430) scale(15) scale(-1, 1) translate(-12 -12)" />
      <!-- Calling waves -->
      ${waves}
    </g>
    
    <!-- Brand Texts -->
    <text x="512" y="750" 
          font-family="'Montserrat', sans-serif" 
          font-weight="900" 
          font-style="italic" 
          font-size="140" 
          fill="#FFFFFF" 
          text-anchor="middle"
          filter="url(#glow)">FRT</text>
    
    <g filter="url(#glow)">
      <text x="512" y="830" 
            font-family="'Outfit', sans-serif" 
            font-weight="700" 
            font-size="44" 
            fill="#38bdf8" 
            text-anchor="middle"
            letter-spacing="8">CALLING</text>
      <line x1="250" y1="815" x2="350" y2="815" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" />
      <line x1="674" y1="815" x2="774" y2="815" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" />
    </g>
  </g>`;
}

function svgFull(size, radiusPct, clusterScale) {
  const r = Math.round((1024 * radiusPct) / 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${DEFS}
  <rect width="1024" height="1024" rx="${r}" fill="url(#bg)"/>
  ${cluster(clusterScale)}
</svg>`;
}

function svgForeground() {
  // Adaptive foreground: Maximize size up to safe zone boundary
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${DEFS}
  ${cluster(1.05)}
</svg>`;
}

function svgBackground() {
  // Adaptive background: just the gradient
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${DEFS}
  <rect width="1024" height="1024" fill="url(#bg)"/>
</svg>`;
}

function svgSplash() {
  // Splash badge: Scale up even more for splash screen
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1024 1024">
  ${DEFS}
  ${cluster(1.25)}
</svg>`;
}

function svgAndroid12() {
  // Android 12+ splash icon: 1152px canvas. Content must fit in 768px circle
  // Scaled up heavily for prominence.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1152" height="1152" viewBox="0 0 1152 1152">
  ${DEFS}
  <g transform="translate(576 576) scale(1.15) translate(-512 -512)">
    ${cluster(1.0)}
  </g>
</svg>`;
}

const ASSETS = [
  { file: 'icon.png', svg: svgFull(1024, 0, 0.92), w: 1024, h: 1024 },
  { file: 'icon_fg.png', svg: svgForeground(), w: 1024, h: 1024 },
  { file: 'icon_bg.png', svg: svgBackground(), w: 1024, h: 1024 },
  { file: 'splash.png', svg: svgSplash(), w: 512, h: 512 },
  { file: 'splash_android12.png', svg: svgAndroid12(), w: 1152, h: 1152 },
  { file: 'preview.png', svg: svgFull(1024, 22, 0.92), w: 1024, h: 1024 },
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
  
  // HTML containing google fonts to ensure professional rendering
  const html = `<!doctype html>
  <html>
  <head>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,700;1,900&family=Outfit:wght@700&display=swap" rel="stylesheet">
    <style>
      * { margin:0; padding:0; }
      body { background:transparent; }
    </style>
  </head>
  <body>
    ${a.svg}
  </body>
  </html>`;

  await page.setContent(html);
  // Wait for fonts to load before screenshot
  await page.evaluateHandle(() => document.fonts.ready);
  
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: a.w, height: a.h } });
  writeFileSync(path.join(OUT, a.file), buf);
  console.log(`✓ ${a.file}`);
}
await browser.close();
console.log(`Done → ${OUT}`);

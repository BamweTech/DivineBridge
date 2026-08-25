/**
 * Generates all required app icon PNGs from the DivineBridge SVG logo.
 * Run with: node scripts/generate-icons.mjs
 */

import sharp from 'sharp';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { Buffer } from 'node:buffer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'assets');

// The raw SVG paths from assets/logos/LogoOnly1.svg
// viewBox "0 0 41.34218 45.052022", group translated by (-69.531391,-70.903428)
const LOGO_PATHS = `
  <path d="M 83.488159,98.975444 H 69.531388 V 115.95545 H 90.26604 c 2.485261,0 5.257993,-0.40936 8.318355,-1.22886 2.238785,-0.59414 4.333645,-1.78274 6.284885,-3.56516 1.95124,-1.80291 3.47135,-4.02543 4.55993,-6.66833 0.70925,-1.70314 1.18872,-2.93472 1.44436,-5.517656 H 96.830497 c -0.174322,1.375766 -0.440514,1.573216 -0.803051,2.413456 -0.698338,1.59803 -1.664104,2.72507 -2.896464,3.38067 -1.232361,0.63512 -3.306806,0.9524 -6.223393,0.9524 h -3.41943 z" fill="FILL_COLOR"/>
  <path d="m 69.531388,70.903424 v 15.37016 h 13.956771 v -5.16716 h 3.481442 c 3.614925,0 6.202876,0.8808 7.763867,2.64273 0.735039,0.82966 1.293423,1.02256 1.680001,2.52443 h 14.162441 c -0.15907,-0.91803 -0.35436,-0.8424 -0.59221,-1.72551 -0.73942,-2.74534 -1.9308,-5.15254 -3.57394,-7.22178 -1.64315,-2.06925 -3.72754,-3.65669 -6.25388,-4.76302 -2.505805,-1.10633 -5.80251,-1.65985 -9.88984,-1.65985 z" fill="FILL_COLOR"/>
`;

/**
 * Build an SVG string with the logo paths centered on a given canvas.
 * @param {number} size       - Output canvas size in px
 * @param {string} logoColor  - Fill color for the logo paths
 * @param {string|null} bgColor - Background rect color, or null for transparent
 * @param {number} padding    - Fraction of size to use as padding (0–0.5)
 */
function buildSvg(size, logoColor, bgColor = null, padding = 0.18) {
  const paths = LOGO_PATHS.replaceAll('FILL_COLOR', logoColor);
  const pad = size * padding;
  const inner = size - pad * 2;

  // Original logo viewBox dims
  const origW = 41.34218;
  const origH = 45.052022;
  const scale = Math.min(inner / origW, inner / origH);
  const logoW = origW * scale;
  const logoH = origH * scale;
  const offsetX = (size - logoW) / 2;
  const offsetY = (size - logoH) / 2;

  const bg = bgColor
    ? `<rect width="${size}" height="${size}" fill="${bgColor}"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  <g transform="translate(${offsetX},${offsetY}) scale(${scale}) translate(-69.531391,-70.903428)">
    ${paths}
  </g>
</svg>`;
}

async function generate(filename, size, logoColor, bgColor, padding) {
  const svg = buildSvg(size, logoColor, bgColor, padding);
  const outPath = path.join(ASSETS, filename);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`✓ ${filename} (${size}×${size})`);
}

async function main() {
  if (!existsSync(ASSETS)) await mkdir(ASSETS, { recursive: true });

  const GOLD = '#b07d20';
  const CREAM = '#faf6ef';

  // iOS app icon — 1024×1024, gold bg, white logo
  await generate('icon.png', 1024, '#ffffff', GOLD, 0.18);

  // Android adaptive icon foreground — 1024×1024, transparent bg, gold logo
  await generate('adaptive-icon.png', 1024, GOLD, null, 0.18);

  // Splash screen icon — 512×512, gold logo on cream bg
  await generate('splash-icon.png', 512, GOLD, CREAM, 0.14);

  // Android notification icon — 96×96, white on transparent
  await generate('notification-icon.png', 96, '#ffffff', null, 0.12);

  // Web favicon — 48×48, gold bg, white logo
  await generate('favicon.png', 48, '#ffffff', GOLD, 0.16);

  // Android adaptive icon foreground pieces
  await generate('android-icon-foreground.png', 1024, '#ffffff', null, 0.18);
  await generate('android-icon-background.png', 1024, GOLD, GOLD, 0.5);
  await generate('android-icon-monochrome.png', 1024, '#ffffff', null, 0.18);

  console.log('\nAll icons generated in mobile/assets/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

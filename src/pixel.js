'use strict';
// Pixel-art helpers (Jimp comes from the engine's node_modules, installed during first setup).
const { jimpLib } = require('./engine');

const SIZE = 512;

function hexToRgb(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function hslToRgb(h, s, l) {
  h /= 360;
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [f(0), f(8), f(4)];
}
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function fromCells(Jimp, w, h, cellFn) {
  const img = new Jimp(w, h, 0x00000000);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = cellFn(x, y);
    img.setPixelColor(Jimp.rgbaToInt(c[0], c[1], c[2], 255), x, y);
  }
  img.resize(SIZE, SIZE, Jimp.RESIZE_NEAREST_NEIGHBOR);
  return img.getBufferAsync(Jimp.MIME_PNG);
}

// Built-in generator (no API key): a symmetric pixel sprite whose look is decided by the app name.
async function procedural(name) {
  const Jimp = jimpLib();
  const N = 16, R = rng(hash(name || 'shell'));
  const hue = R() * 360;
  const bg = hslToRgb(hue, 0.45, 0.14), body = hslToRgb(hue, 0.75, 0.55), accent = hslToRgb((hue + 150) % 360, 0.85, 0.65), line = hslToRgb(hue, 0.6, 0.05);
  const mask = Array.from({ length: N }, () => Array(N).fill(0));
  const margin = 2, half = N / 2;
  for (let y = margin; y < N - margin; y++) for (let x = margin; x < half; x++) {
    const centerBias = 1 - Math.abs(y - N / 2) / (N / 2);
    const v = R() < 0.35 + 0.3 * centerBias + 0.1 * (x / half) ? (R() < 0.2 ? 2 : 1) : 0;
    mask[y][x] = v; mask[y][N - 1 - x] = v;
  }
  // eyes
  const ey = Math.floor(N / 2) - 1;
  mask[ey][half - 3 > margin ? half - 3 : margin + 1] = 3; mask[ey][N - 1 - (half - 3 > margin ? half - 3 : margin + 1)] = 3;
  return fromCells(Jimp, N, N, (x, y) => {
    const v = mask[y][x];
    if (v === 1) return body;
    if (v === 2) return accent;
    if (v === 3) return [255, 255, 255];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (mask[y + dy] || [])[x + dx]);
    return nb ? line : bg;
  });
}

// AI text-model route: draw the palette grid the model returned.
async function fromGrid({ palette, rows }) {
  const Jimp = jimpLib();
  const N = Math.min(32, Math.max(8, rows.length, ...rows.map((r) => r.length)));
  const pal = palette.map(hexToRgb);
  return fromCells(Jimp, N, N, (x, y) => {
    const ch = (rows[y] || '')[x];
    const i = ch === undefined ? 0 : Math.min(pal.length - 1, Math.max(0, parseInt(ch, 36) || 0));
    return pal[i];
  });
}

// AI image route: crop to square, shrink to a 32x32 grid, blow back up with hard pixels.
async function pixelate(buffer, cells = 32) {
  const Jimp = jimpLib();
  const img = await Jimp.read(buffer);
  img.cover(cells, cells, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE, Jimp.RESIZE_BILINEAR);
  img.resize(SIZE, SIZE, Jimp.RESIZE_NEAREST_NEIGHBOR);
  return img.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { procedural, fromGrid, pixelate };

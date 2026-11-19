// SPDX-License-Identifier: MIT
// news-image-20261119 — make.fun entry.
// Draws a one-page newspaper front page summing up the world news of
// Thursday 19 November 2026 as a 1024x1024 PNG, with Node's standard
// library only. No network, no randomness, no clock: two runs write
// identical bytes. Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---- palette ----
type RGB = [number, number, number];
const PAPER: RGB = [246, 241, 229];
const WHITE: RGB = [255, 253, 246];
const INK: RGB = [26, 26, 26];
const NAVY: RGB = [22, 35, 63];
const GOLD: RGB = [201, 162, 39];
const RED: RGB = [179, 38, 30];
const BLUE: RGB = [46, 95, 163];
const SKY: RGB = [207, 227, 242];
const TEAL: RGB = [31, 122, 109];
const GREY: RGB = [110, 110, 104];
const SMOKE: RGB = [168, 168, 160];
const ORANGE: RGB = [214, 110, 44];
const GREEN: RGB = [46, 125, 50];
const DARKRED: RGB = [140, 20, 16];
const CREAM: RGB = [232, 222, 196];

// ---- framebuffer ----
const fb = new Uint8Array(W * H * 3);
function fillAll(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    fb[i * 3] = c[0];
    fb[i * 3 + 1] = c[1];
    fb[i * 3 + 2] = c[2];
  }
}
function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 3;
      fb[i] = c[0];
      fb[i + 1] = c[1];
      fb[i + 2] = c[2];
    }
  }
}
function frame(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}
function hline(x: number, y: number, w: number, c: RGB, t = 1): void {
  rect(x, y, w, t, c);
}
function vline(x: number, y: number, h: number, c: RGB, t = 1): void {
  rect(x, y, t, h, c);
}
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    px(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}
function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -half; x <= half; x++) px(cx + x, cy + y, c);
  }
}
function ring(cx: number, cy: number, r: number, c: RGB, t = 2): void {
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      px(Math.round(cx + (r + k) * Math.cos(rad)), Math.round(cy + (r + k) * Math.sin(rad)), c);
    }
  }
}
function arc(cx: number, cy: number, r: number, a0: number, a1: number, c: RGB, t = 3): void {
  for (let a = a0; a <= a1; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      px(Math.round(cx + (r + k) * Math.cos(rad)), Math.round(cy + (r + k) * Math.sin(rad)), c);
    }
  }
}
function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.max(0, Math.min(x0, x1, x2));
  const maxX = Math.min(W - 1, Math.max(x0, x1, x2));
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / d;
      const w1 = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) px(x, y, c);
    }
  }
}

// ---- PNG encoder (CRC32 + zlib deflate, filter 0) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(fb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 5x7 bitmap font (glyphs drawn by hand for this entry) ----
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '+': ['00000', '00100', '00100', '01110', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
  '*': ['00000', '00100', '01110', '01110', '01110', '00100', '00000'],
};
function glyphWidth(s: number): number {
  return 6 * s;
}
function textWidth(text: string, s: number): number {
  return text.length * glyphWidth(s) - s;
}
function drawChar(ch: string, x: number, y: number, s: number, c: RGB): void {
  const g = GLYPHS[ch] ?? GLYPHS['?'];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === '1') rect(x + col * s, y + r * s, s, s, c);
    }
  }
}
function drawText(text: string, x: number, y: number, s: number, c: RGB): void {
  for (let i = 0; i < text.length; i++) {
    drawChar(text[i], x + i * glyphWidth(s), y, s, c);
  }
}
function drawTextCentered(text: string, cx: number, y: number, s: number, c: RGB): void {
  drawText(text, cx - Math.floor(textWidth(text, s) / 2), y, s, c);
}
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}
function drawPara(text: string, x: number, y: number, w: number, s: number, c: RGB, lh: number): number {
  const maxChars = Math.max(1, Math.floor((w + s) / glyphWidth(s)));
  const lines = wrapText(text.toUpperCase(), maxChars);
  lines.forEach((ln, i) => drawText(ln, x, y + i * lh, s, c));
  return y + lines.length * lh;
}

// ---- pictograms (all drawn by hand for this entry) ----

// Three flags on poles: USA, China, Russia. x,y is the top-left of the row.
function drawFlags(x: number, y: number, fw: number, fh: number): void {
  const gap = 28;
  const poles: RGB[] = [INK, INK, INK];
  for (let f = 0; f < 3; f++) {
    const fx = x + f * (fw + gap);
    // pole
    rect(fx - 4, y - 14, 4, fh + 14, poles[f]);
    disc(fx - 2, y - 16, 4, GOLD);
    if (f === 0) {
      // USA: red/white stripes, blue canton with star dots
      const sh = Math.floor(fh / 13);
      for (let s = 0; s < 13; s++) rect(fx, y + s * sh, fw, sh, s % 2 === 0 ? RED : WHITE);
      rect(fx, y, Math.floor(fw * 0.42), sh * 7, NAVY);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) {
          disc(fx + 8 + c * 14, y + 6 + r * 11, 2, WHITE);
        }
      }
    } else if (f === 1) {
      // China: red field, one big yellow star + small stars
      rect(fx, y, fw, fh, DARKRED);
      const cx = fx + 26;
      const cy = y + 26;
      for (let a = 0; a < 5; a++) {
        const ang = (-90 + a * 72) * (Math.PI / 180);
        const ang2 = (-90 + 36 + a * 72) * (Math.PI / 180);
        line(cx, cy, Math.round(cx + 16 * Math.cos(ang)), Math.round(cy + 16 * Math.sin(ang)), GOLD);
        line(
          Math.round(cx + 16 * Math.cos(ang)),
          Math.round(cy + 16 * Math.sin(ang)),
          Math.round(cx + 7 * Math.cos(ang2)),
          Math.round(cy + 7 * Math.sin(ang2)),
          GOLD,
        );
      }
      disc(cx, cy, 6, GOLD);
      disc(fx + 62, y + 14, 3, GOLD);
      disc(fx + 76, y + 26, 3, GOLD);
      disc(fx + 76, y + 42, 3, GOLD);
      disc(fx + 62, y + 54, 3, GOLD);
    } else {
      // Russia: white / blue / red horizontal bands
      const bh = Math.floor(fh / 3);
      rect(fx, y, fw, bh, WHITE);
      rect(fx, y + bh, fw, bh, BLUE);
      rect(fx, y + 2 * bh, fw, fh - 2 * bh, RED);
    }
    frame(fx, y, fw, fh, INK, 2);
  }
}

// Scales of justice. cx,cy is the top of the post.
function drawScales(cx: number, top: number, h: number): void {
  const base = top + h;
  rect(cx - 2, top, 4, h - 14, INK);
  rect(cx - 34, base - 14, 68, 8, INK);
  rect(cx - 46, base - 6, 92, 6, INK);
  disc(cx, top - 6, 6, GOLD);
  const beamY = top + 16;
  rect(cx - 62, beamY, 124, 4, INK);
  for (const side of [-1, 1]) {
    const px0 = cx + side * 58;
    line(cx + side * 58, beamY + 4, px0 - 26, beamY + 44, INK);
    line(cx + side * 58, beamY + 4, px0 + 26, beamY + 44, INK);
    line(cx + side * 58, beamY + 4, px0, beamY + 44, INK);
    // pan: shallow bowl
    for (let k = 0; k <= 12; k++) {
      const yy = beamY + 44 + Math.floor((k * k) / 14);
      rect(px0 - 30 + k * 5, yy, 5, 3, GOLD);
    }
    rect(px0 - 30, beamY + 44, 60, 3, GOLD);
  }
  disc(cx, beamY + 2, 5, GOLD);
}

// City skyline at dusk with a big VI. x,y top-left of the panel.
function drawSkyline(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, NAVY);
  disc(x + 36, y + 30, 20, GOLD);
  const base = y + h;
  const towers: Array<[number, number, number]> = [
    [0, 62, 40],
    [44, 46, 52],
    [100, 74, 36],
    [140, 40, 56],
    [200, 62, 40],
    [244, 48, 36],
  ];
  for (const [tx, th, tw] of towers) {
    rect(x + tx, base - th, tw, th, INK);
    for (let wy = base - th + 12; wy < base - 14; wy += 22) {
      for (let wx = x + tx + 10; wx < x + tx + tw - 10; wx += 20) {
        if ((wx + wy) % 40 < 20) rect(wx, wy, 7, 9, GOLD);
      }
    }
  }
  // water reflection band
  rect(x, base - 8, w, 8, BLUE);
  // big VI letters
  drawText('VI', x + w - 66, y + 8, 5, WHITE);
}

// Voyager-style probe among stars. x,y top-left of the panel.
function drawVoyager(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, NAVY);
  const stars: Array<[number, number, number]> = [
    [20, 12, 2], [70, 30, 1], [120, 10, 2], [180, 40, 1], [240, 16, 2],
    [250, 50, 1], [40, 62, 1], [150, 70, 2], [210, 78, 1], [260, 30, 2],
    [90, 84, 1], [230, 88, 2], [30, 92, 2], [190, 92, 1], [120, 94, 1],
  ];
  for (const [sx, sy, sr] of stars) disc(x + sx, y + sy, sr, WHITE);
  const cx = x + 150;
  const cy = y + 52;
  // dish (gold cone seen from the side)
  tri(cx - 8, cy - 26, cx - 8, cy + 26, cx + 46, cy, GOLD);
  line(cx - 8, cy - 26, cx + 46, cy, WHITE);
  line(cx - 8, cy + 26, cx + 46, cy, WHITE);
  // bus body
  rect(cx - 52, cy - 16, 46, 32, WHITE);
  frame(cx - 52, cy - 16, 46, 32, INK, 2);
  rect(cx - 44, cy - 8, 12, 8, BLUE);
  rect(cx - 44, cy + 6, 12, 8, RED);
  // boom + magnetometer
  line(cx - 52, cy, cx - 96, cy - 30, WHITE);
  disc(cx - 96, cy - 30, 5, GOLD);
  // RTG boom
  line(cx - 52, cy + 8, cx - 92, cy + 34, WHITE);
  rect(cx - 104, cy + 28, 16, 12, SMOKE);
  // signal rings from the dish
  arc(cx + 46, cy, 18, -50, 50, SKY, 2);
  arc(cx + 46, cy, 30, -50, 50, SKY, 2);
}

// Cyclone spiral over a coastline. x,y top-left of the panel.
function drawCyclone(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, SKY);
  const cx = x + Math.floor(w * 0.42);
  const cy = y + Math.floor(h * 0.52);
  // spiral arms
  for (let r = 10; r <= 43; r += 11) {
    arc(cx, cy, r, 20 + r * 2, 300 + r * 2, WHITE, 5);
  }
  disc(cx, cy, 12, NAVY);
  ring(cx, cy, 12, WHITE, 2);
  // rain slashes
  for (let i = 0; i < 14; i++) {
    const rx = x + 12 + ((i * 37) % (w - 24));
    const ry = y + 10 + ((i * 23) % 40);
    line(rx, ry, rx - 6, ry + 16, BLUE);
    line(rx + 10, ry + 26, rx + 4, ry + 42, BLUE);
  }
  // coastline at the bottom
  rect(x, y + h - 26, w, 26, TEAL);
  tri(x, y + h - 26, x + 90, y + h - 26, x, y + h, GREEN);
  tri(x + w, y + h - 26, x + w - 110, y + h - 26, x + w, y + h, GREEN);
  drawText('INDIA', x + 14, y + h - 22, 2, WHITE);
}

// ---- story box helper ----
function storyBox(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, WHITE);
  frame(x, y, w, h, INK, 2);
}
function kicker(text: string, x: number, y: number, c: RGB): void {
  drawText(text, x, y, 2, c);
  hline(x, y + 18, textWidth(text, 2), c, 2);
}

// ---- layout: one newspaper front page ----
function build(): void {
  fillAll(PAPER);

  // Masthead
  rect(24, 14, 976, 5, NAVY);
  drawTextCentered('THE WORLD IN ONE DAY', 512, 30, 5, NAVY);
  drawTextCentered('THURSDAY 19 NOVEMBER 2026', 512, 88, 3, INK);
  hline(24, 122, 976, INK, 3);
  hline(24, 128, 976, INK, 1);

  // Lead story: Shenzhen trilateral
  storyBox(24, 140, 632, 330);
  kicker('SHENZHEN - DIPLOMACY', 40, 156, RED);
  drawText('TRUMP, XI AND PUTIN', 40, 186, 3, INK);
  drawText('MEET IN SHENZHEN', 40, 212, 3, INK);
  drawText('FIRST TRILATERAL', 40, 238, 3, INK);
  drawFlags(87, 296, 150, 78);
  drawPara(
    'THE PRESIDENTS OF THE US, CHINA AND RUSSIA MEET FOR THE FIRST TIME TOGETHER, ON THE SIDELINES OF THE APEC SUMMIT.',
    40, 392, 600, 2, INK, 20,
  );

  // Second story: ICJ ruling
  storyBox(672, 140, 328, 330);
  kicker('THE HAGUE - JUSTICE', 688, 156, RED);
  drawText('WORLD COURT', 688, 186, 3, INK);
  drawText('RULES TODAY', 688, 212, 3, INK);
  drawScales(836, 252, 108);
  drawPara(
    "THE ICJ DELIVERS ITS JUDGMENT ON WHETHER MYANMAR COMMITTED GENOCIDE AGAINST THE ROHINGYA.",
    688, 372, 296, 2, INK, 19,
  );

  // Middle row: GTA VI
  storyBox(24, 486, 312, 306);
  kicker('CULTURE', 40, 502, RED);
  drawText('VICE CITY', 40, 528, 3, INK);
  drawText('OPENS', 40, 554, 3, INK);
  drawSkyline(40, 584, 280, 104);
  drawPara(
    'GRAND THEFT AUTO VI LAUNCHES WORLDWIDE TODAY, SCORING 99 ON METACRITIC.',
    40, 700, 280, 2, INK, 19,
  );

  // Middle row: Voyager 1
  storyBox(356, 486, 312, 306);
  kicker('SPACE', 372, 502, RED);
  drawText('A LIGHT-DAY', 372, 528, 3, INK);
  drawText('FROM HOME', 372, 554, 3, INK);
  drawVoyager(372, 584, 280, 104);
  drawPara(
    'NASA CONFIRMS VOYAGER 1 IS ONE LIGHT-DAY FROM EARTH - 16 BILLION MILES OUT.',
    372, 700, 280, 2, INK, 19,
  );

  // Middle row: Cyclone Akvan
  storyBox(688, 486, 312, 306);
  kicker('WEATHER', 704, 502, RED);
  drawText('STORM BEARS', 704, 528, 3, INK);
  drawText('DOWN ON INDIA', 704, 554, 3, INK);
  drawCyclone(704, 584, 280, 104);
  drawPara(
    "SEVERE CYCLONE AKVAN CLOSES ON INDIA'S EAST COAST; EXTREMELY HEAVY RAIN IS FORECAST.",
    704, 700, 280, 2, INK, 19,
  );

  // The day in numbers
  storyBox(24, 808, 976, 144);
  drawTextCentered('THE DAY IN NUMBERS', 512, 822, 2, RED);
  const nums: Array<[string, string]> = [
    ['3', 'PRESIDENTS AT ONE TABLE IN SHENZHEN'],
    ['16BN', 'MILES TO VOYAGER 1'],
    ['99', 'GTA VI SCORE ON METACRITIC'],
    ['730,000', 'ROHINGYA DRIVEN FROM MYANMAR IN 2017'],
    ['100', "KM/H: AKVAN'S WINDS AT LANDFALL"],
  ];
  nums.forEach(([n, cap], i) => {
    const cx = 40 + i * 192;
    drawText(n, cx, 850, 3, NAVY);
    drawPara(cap, cx, 882, 180, 2, INK, 18);
  });

  // Footer
  drawTextCentered('DRAWN FROM REPORTS OF THURSDAY 19 NOVEMBER 2026', 512, 972, 2, GREY);
}

function main(): void {
  build();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? 'out';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePNG());
}

main();

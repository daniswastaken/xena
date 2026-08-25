/**
 * Generates Xena placeholder sprites — simple face states + number badge:
 *   idle.png  (1) eyes open, mouth closed
 *   talk.png  (2) eyes open, mouth open
 *   blink.png (3) eyes closed, mouth closed
 * Pure Node (zlib) — no deps. Real art later replaces these one-to-one.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "stage-xena", "assets");

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const DIGIT_SEGMENTS = {
  0: [1, 1, 1, 1, 1, 1, 0],
  1: [0, 1, 1, 0, 0, 0, 0],
  2: [1, 1, 0, 1, 1, 0, 1],
  3: [1, 1, 1, 1, 0, 0, 1],
};

function createCanvas(bg) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const radius = 96;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.max(radius - x, x - (SIZE - 1 - radius), 0);
      const cy = Math.max(radius - y, y - (SIZE - 1 - radius), 0);
      if (cx * cx + cy * cy > radius * radius) continue;
      const i = (y * SIZE + x) * 4;
      px[i] = bg[0];
      px[i + 1] = bg[1];
      px[i + 2] = bg[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

function fillCircle(px, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * SIZE + x) * 4;
        px[i] = color[0];
        px[i + 1] = color[1];
        px[i + 2] = color[2];
        px[i + 3] = 255;
      }
    }
  }
}

function fillEllipse(px, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const i = (y * SIZE + x) * 4;
        px[i] = color[0];
        px[i + 1] = color[1];
        px[i + 2] = color[2];
        px[i + 3] = 255;
      }
    }
  }
}

function fillRect(px, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const i = (y * SIZE + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

/** 7-seg digit, scaled; (x,y) = top-left of digit box. */
function drawDigit(px, number, x, y, dw, dh, t, color) {
  const segs = DIGIT_SEGMENTS[number];
  if (!segs) throw new Error(`no glyph for ${number}`);
  const [a, b, c, d, e, f, g] = segs;
  if (a) fillRect(px, x + 6, y, dw - 12, t, color);
  if (g) fillRect(px, x + 6, y + dh / 2 - t / 2, dw - 12, t, color);
  if (d) fillRect(px, x + 6, y + dh - t, dw - 12, t, color);
  if (f) fillRect(px, x, y + 6, t, dh / 2 - 6, color);
  if (b) fillRect(px, x + dw - t, y + 6, t, dh / 2 - 6, color);
  if (e) fillRect(px, x, y + dh / 2, t, dh / 2 - 6, color);
  if (c) fillRect(px, x + dw - t, y + dh / 2, t, dh / 2 - 6, color);
}

function drawBadge(px, number, bg, fg) {
  const cx = 428;
  const cy = 84;
  const r = 40;
  fillCircle(px, cx, cy, r, fg);
  fillCircle(px, cx, cy, r - 6, bg);
  drawDigit(px, number, cx - 26, cy - 42, 52, 84, 12, fg);
}

const WHITE = [255, 255, 255];

function face({ bg, eyes, mouth, number }) {
  const px = createCanvas(bg);
  if (eyes === "open") {
    fillCircle(px, 178, 196, 40, WHITE);
    fillCircle(px, 334, 196, 40, WHITE);
  } else {
    fillRect(px, 138, 188, 80, 16, WHITE);
    fillRect(px, 294, 188, 80, 16, WHITE);
  }
  if (mouth === "open") fillEllipse(px, 256, 348, 74, 48, WHITE);
  else fillRect(px, 196, 340, 120, 16, WHITE);
  drawBadge(px, number, bg, WHITE);
  return encodePng(SIZE, SIZE, px);
}

mkdirSync(outDir, { recursive: true });
const sprites = [
  ["idle.png", { bg: [46, 134, 222], eyes: "open", mouth: "closed", number: 1 }],
  ["talk.png", { bg: [46, 134, 222], eyes: "open", mouth: "open", number: 2 }],
  ["blink.png", { bg: [46, 134, 222], eyes: "closed", mouth: "closed", number: 3 }],
];
for (const [name, spec] of sprites) {
  writeFileSync(join(outDir, name), face(spec));
  console.log("wrote", name);
}

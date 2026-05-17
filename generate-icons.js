/**
 * Generates ToonReader PWA icons (192x192 and 512x512) as PNG files
 * using only Node.js built-ins — no extra dependencies needed.
 *
 * Run once: node generate-icons.js
 */

const fs   = require('fs');
const path = require('path');

// Minimal PNG encoder — writes a solid-color square with an SVG-style book icon
// drawn as white strokes on the accent purple background.

function writePNG(filePath, size) {
  // We'll build a raw RGBA pixel buffer and encode it as PNG manually.
  const width  = size;
  const height = size;
  const buf    = Buffer.alloc(width * height * 4);

  // Background color: #7c6af7 (accent purple)
  const bgR = 0x7c, bgG = 0x6a, bgB = 0xf7;

  // Fill background
  for (let i = 0; i < width * height; i++) {
    buf[i * 4 + 0] = bgR;
    buf[i * 4 + 1] = bgG;
    buf[i * 4 + 2] = bgB;
    buf[i * 4 + 3] = 255;
  }

  // Draw a simple open-book icon (white) scaled to the icon size
  // The icon occupies roughly the center 60% of the image
  const scale  = size / 24;   // SVG viewBox is 0 0 24 24
  const stroke = Math.max(1, Math.round(size / 48));

  function setPixel(x, y) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= width || yi < 0 || yi >= height) return;
    const idx = (yi * width + xi) * 4;
    buf[idx]     = 255;
    buf[idx + 1] = 255;
    buf[idx + 2] = 255;
    buf[idx + 3] = 255;
  }

  function drawLine(x0, y0, x1, y1) {
    // Bresenham's line with stroke width
    x0 *= scale; y0 *= scale; x1 *= scale; y1 *= scale;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0, cy = y0;
    for (let i = 0; i < 2000; i++) {
      for (let tx = -stroke; tx <= stroke; tx++)
        for (let ty = -stroke; ty <= stroke; ty++)
          setPixel(cx + tx, cy + ty);
      if (Math.abs(cx - x1) < 0.5 && Math.abs(cy - y1) < 0.5) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 <  dx) { err += dx; cy += sy; }
    }
  }

  // Approximate the open-book SVG paths with line segments
  // Left page: M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z
  drawLine(2, 3, 8, 3);
  drawLine(8, 3, 10, 5);   // curve approx
  drawLine(10, 5, 12, 7);
  drawLine(12, 7, 12, 21);
  drawLine(12, 21, 9, 18);
  drawLine(9, 18, 2, 18);
  drawLine(2, 18, 2, 3);

  // Right page: M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z
  drawLine(22, 3, 16, 3);
  drawLine(16, 3, 14, 5);
  drawLine(14, 5, 12, 7);
  drawLine(12, 7, 12, 21);
  drawLine(12, 21, 15, 18);
  drawLine(15, 18, 22, 18);
  drawLine(22, 18, 22, 3);

  // Encode as PNG
  const png = encodePNG(buf, width, height);
  fs.writeFileSync(filePath, png);
  console.log(`Written: ${filePath} (${size}x${size})`);
}

// ─── Minimal PNG encoder ──────────────────────────────────────────────────────
function encodePNG(rgba, width, height) {
  const zlib = require('zlib');

  // Build raw image data with filter bytes
  const rowSize = width * 4;
  const raw = Buffer.alloc((rowSize + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4);
    crc.writeInt32BE(crc32(crcBuf), 0);
    return Buffer.concat([len, typeB, data, crc]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// CRC-32 table
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1);
}

// ─── Generate ─────────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

writePNG(path.join(outDir, 'icon-192.png'), 192);
writePNG(path.join(outDir, 'icon-512.png'), 512);

console.log('Done! Icons saved to public/icons/');

// Generates the extension's PNG icons (no image deps; hand-rolls PNG via zlib).
// A white "person" glyph on a rounded square in the Regulations.gov blue —
// nods to the extension's purpose (showing who commented).
//
//   node scripts/make-icons.js
//
// Writes icons/icon{16,32,48,128}.png.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BLUE = [0x00, 0x5e, 0xa2]; // #005ea2
const WHITE = [0xff, 0xff, 0xff];

// Geometry in normalized [0,1] coordinates.
const CORNER = 0.18; // rounded-square corner radius
const HEAD = { cx: 0.5, cy: 0.34, r: 0.16 };
const SHOULDER = { cx: 0.5, cy: 1.06, rx: 0.34, ry: 0.46, topCut: 0.56 };

function inRoundedSquare(nx, ny) {
  const cx = Math.min(Math.max(nx, CORNER), 1 - CORNER);
  const cy = Math.min(Math.max(ny, CORNER), 1 - CORNER);
  const dx = nx - cx;
  const dy = ny - cy;
  return dx * dx + dy * dy <= CORNER * CORNER;
}

function inGlyph(nx, ny) {
  const hd = (nx - HEAD.cx) ** 2 + (ny - HEAD.cy) ** 2 <= HEAD.r * HEAD.r;
  if (hd) return true;
  const e = ((nx - SHOULDER.cx) / SHOULDER.rx) ** 2 + ((ny - SHOULDER.cy) / SHOULDER.ry) ** 2 <= 1;
  return e && ny >= SHOULDER.topCut;
}

// Returns [r,g,b,a] for a sub-sample point. Outside the square keeps the blue
// rgb (a=0) so anti-aliased edges blend to blue, not black.
function sample(nx, ny) {
  if (!inRoundedSquare(nx, ny)) return [BLUE[0], BLUE[1], BLUE[2], 0];
  const c = inGlyph(nx, ny) ? WHITE : BLUE;
  return [c[0], c[1], c[2], 255];
}

function renderPixel(px, py, size, ss) {
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  for (let i = 0; i < ss; i++) {
    for (let j = 0; j < ss; j++) {
      const nx = (px + (i + 0.5) / ss) / size;
      const ny = (py + (j + 0.5) / ss) / size;
      const s = sample(nx, ny);
      r += s[0];
      g += s[1];
      b += s[2];
      a += s[3];
    }
  }
  const n = ss * ss;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

function rawImage(size) {
  const ss = 4; // supersampling for smooth edges
  const row = size * 4 + 1; // +1 filter byte per row
  const buf = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    buf[y * row] = 0; // filter type 0 (None)
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = renderPixel(x, y, size, ss);
      const o = y * row + 1 + x * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = a;
    }
  }
  return buf;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = zlib.deflateSync(rawImage(size), { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png(size));
  console.log(`wrote icons/icon${size}.png`);
}

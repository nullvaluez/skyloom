/**
 * R24 fixture — minimal RGBA8 PNG encoder (node zlib only, zero deps).
 *
 * WHY hand-rolled: the fixture must add as little dependency surface as
 * possible (per-source licensing is a standing rule of this repo), and a
 * baseline RGBA8/no-interlace encoder is ~40 lines. `pngjs` would have been
 * the alternative; it buys nothing here because we never DECODE a PNG.
 *
 * Everything downstream (three's ImageLoader for imagery, three-tile's
 * terrain-rgb loader for the DEM) reads these through the browser's own PNG
 * decoder, so only spec-correctness matters — not compression ratio. We
 * deflate at level 3: the bytes are deterministic for a given input either
 * way, and the fixture serves thousands of tiles per boot.
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {Uint8Array} rgba width*height*4, row-major, top-left origin
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} a complete PNG file
 */
export function encodePNG(rgba, width, height) {
  const stride = width * 4;
  // Filter type 0 (None) on every scanline — the decoder cost is nil and the
  // encoder stays branch-free.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

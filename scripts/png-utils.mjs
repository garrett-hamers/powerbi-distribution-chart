import { deflateSync, inflateSync } from "node:zlib";

/**
 * Dependency-free PNG helpers shared by the submission asset scripts. Only the
 * subset needed for Partner Center listing assets is implemented: 8-bit,
 * non-interlaced images.
 */

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function hasPngSignature(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** Reads IHDR without decoding pixels. */
export function readPngHeader(buffer) {
  if (!hasPngSignature(buffer)) {
    throw new Error("Buffer is not a PNG: signature mismatch.");
  }
  if (buffer.length < 33 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("Buffer is not a PNG: missing IHDR chunk.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  };
}

function readChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") {
      break;
    }
  }
  return chunks;
}

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/** @returns {{ width: number, height: number, data: Buffer }} RGBA pixels. */
export function decodePng(buffer) {
  const header = readPngHeader(buffer);
  if (header.bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${header.bitDepth}; expected 8.`);
  }
  if (header.interlace !== 0) {
    throw new Error("Unsupported interlaced PNG.");
  }
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (!channels) {
    throw new Error(`Unsupported PNG color type ${header.colorType}.`);
  }

  const chunks = readChunks(buffer);
  const palette = chunks.find((chunk) => chunk.type === "PLTE")?.data;
  const transparency = chunks.find((chunk) => chunk.type === "tRNS")?.data;
  const raw = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));

  const { width, height } = header;
  const stride = width * channels;
  const scanlines = Buffer.alloc(height * stride);
  let position = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[position];
    position += 1;
    const target = row * stride;
    const previous = target - stride;
    for (let index = 0; index < stride; index += 1) {
      const value = raw[position + index];
      const left = index >= channels ? scanlines[target + index - channels] : 0;
      const up = row > 0 ? scanlines[previous + index] : 0;
      const upperLeft = row > 0 && index >= channels ? scanlines[previous + index - channels] : 0;
      let restored;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + left; break;
        case 2: restored = value + up; break;
        case 3: restored = value + ((left + up) >> 1); break;
        case 4: restored = value + paethPredictor(left, up, upperLeft); break;
        default: throw new Error(`Unsupported PNG filter type ${filter}.`);
      }
      scanlines[target + index] = restored & 0xff;
    }
    position += stride;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    switch (header.colorType) {
      case 0:
        rgba.fill(scanlines[source], target, target + 3);
        rgba[target + 3] = 255;
        break;
      case 2:
        scanlines.copy(rgba, target, source, source + 3);
        rgba[target + 3] = 255;
        break;
      case 3: {
        const index = scanlines[source] * 3;
        if (!palette || index + 2 >= palette.length) {
          throw new Error("Palette PNG is missing PLTE entries.");
        }
        palette.copy(rgba, target, index, index + 3);
        rgba[target + 3] = transparency?.[scanlines[source]] ?? 255;
        break;
      }
      case 4:
        rgba.fill(scanlines[source], target, target + 3);
        rgba[target + 3] = scanlines[source + 1];
        break;
      default:
        scanlines.copy(rgba, target, source, source + 4);
        break;
    }
  }

  return { width, height, data: rgba };
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encodes 8-bit RGBA pixels as a non-interlaced PNG. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (stride + 1)] = 0;
    rgba.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Returns a PNG of exactly `targetWidth` x `targetHeight`, cropping overflow from the
 * bottom/right and padding any shortfall with `background`. Used only as a rescue path
 * when a browser emits an off-by-device-pixel-ratio capture; it never invents content.
 */
export function cropOrPadPng(buffer, targetWidth, targetHeight, background = [255, 255, 255, 255]) {
  const source = decodePng(buffer);
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let index = 0; index < output.length; index += 4) {
    output[index] = background[0];
    output[index + 1] = background[1];
    output[index + 2] = background[2];
    output[index + 3] = background[3];
  }
  const copyWidth = Math.min(source.width, targetWidth);
  const copyHeight = Math.min(source.height, targetHeight);
  for (let row = 0; row < copyHeight; row += 1) {
    const from = row * source.width * 4;
    source.data.copy(output, row * targetWidth * 4, from, from + copyWidth * 4);
  }
  return encodePng(targetWidth, targetHeight, output);
}

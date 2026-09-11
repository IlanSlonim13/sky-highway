// Minimal PNG dimension reader (IHDR chunk) — avoids an image library dep.
import { readFileSync } from 'fs';

export function imageSize(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(12) !== 0x49484452) throw new Error(`${path}: not a PNG (no IHDR)`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

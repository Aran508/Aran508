import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || './uploads');

const SIGS: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'image/heic', ext: 'heic', test: (b) => b.subarray(4, 8).toString() === 'ftyp' && /hei|mif|heix|hevc/.test(b.subarray(8, 12).toString()) },
];

/** Identify the real file type from its first bytes (the browser-sent type is not trusted). */
export function sniffImage(b: Buffer) {
  return SIGS.find((s) => s.test(b)) ?? null;
}

export async function storeFile(buf: Buffer, ext: string) {
  const now = new Date();
  const rel = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), `${crypto.randomUUID()}.${ext}`);
  const abs = path.join(uploadRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf, { mode: 0o640 });
  return { key: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

export function resolveKey(key: string) {
  const abs = path.resolve(uploadRoot(), key);
  if (!abs.startsWith(uploadRoot() + path.sep)) throw new Error('bad path');
  return abs;
}

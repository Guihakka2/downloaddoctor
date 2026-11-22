// downloaddoctor core: read-only checks for broken, incomplete and duplicate downloads.
import { openSync, readSync, closeSync, fstatSync, createReadStream, readdirSync, lstatSync, readFileSync } from 'node:fs';
import { createInflateRaw, createGunzip } from 'node:zlib';
import * as zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { join, basename, extname } from 'node:path';

export const printable = (s) => String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, '?');

// zlib.crc32 exists from Node 20.15 / 22.2; small fallback for older 20.x.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = zlib.crc32 ?? ((buf, prev = 0) => { let c = ~prev >>> 0; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; });

function readAt(fd, pos, len) { const b = Buffer.alloc(len); const n = readSync(fd, b, 0, len, pos); return b.subarray(0, n); }

export const PARTIAL = /\.(crdownload|part|partial|download|opdownload|!ut|tmp)$/i;

// Checks every entry of a zip: structure, sizes and CRC-32, streaming (no extraction to disk).
export async function checkZip(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const tail = readAt(fd, Math.max(0, size - 65557), Math.min(size, 65557));
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) return { ok: false, problem: 'zip is truncated (no central directory)' };
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    if (cdOff === 0xffffffff || count === 0xffff) return { ok: true, note: 'zip64: structure not checked' };
    if (cdOff + cdSize > size) return { ok: false, problem: 'zip is truncated (central directory past end of file)' };
    const cd = readAt(fd, cdOff, cdSize);
    let p = 0, checked = 0, encrypted = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) return { ok: false, problem: 'corrupt central directory' };
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
      const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), lho = cd.readUInt32LE(p + 42);
      const name = printable(cd.toString('utf8', p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      if (flags & 1) { encrypted++; continue; }
      const lh = readAt(fd, lho, 30);
      if (lh.length < 30 || lh.readUInt32LE(0) !== 0x04034b50) return { ok: false, problem: `missing data for ${name}` };
      const start = lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      if (start + csize > size) return { ok: false, problem: `zip is truncated (${name} is cut off)` };
      if (method !== 0 && method !== 8) continue; // other compression methods: structure only
      let got = 0, c = 0;
      const sink = async (src) => { for await (const chunk of src) { got += chunk.length; if (got > usize) throw new Error('size'); c = crc32(chunk, c); } };
      try {
        const src = csize ? createReadStream(path, { start, end: start + csize - 1 }) : [];
        await (method === 8 ? pipeline(src, createInflateRaw(), sink) : pipeline(src, sink));
      } catch { return { ok: false, problem: `${name} is corrupt (cannot decompress)` }; }
      if (got !== usize || c !== crc) return { ok: false, problem: `${name} is corrupt (CRC mismatch)` };
      checked++;
    }
    return { ok: true, note: `${checked} files verified${encrypted ? `, ${encrypted} encrypted not checked` : ''}` };
  } finally { closeSync(fd); }
}

export async function checkGzip(path) {
  try { await pipeline(createReadStream(path), createGunzip(), async (src) => { for await (const _ of src); }); return { ok: true }; } catch (e) {
    return { ok: false, problem: /unexpected end/i.test(e.message) || e.code === 'Z_BUF_ERROR' ? 'gzip is truncated' : 'gzip is corrupt' };
  }
}

// Cheap end-of-file markers: truncated downloads lose their last bytes.
export function checkEnding(path, kind) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const end = readAt(fd, Math.max(0, size - 2048), Math.min(size, 2048));
    if (kind === 'pdf') return end.includes('%%EOF') ? { ok: true } : { ok: false, problem: 'PDF is truncated (no %%EOF)' };
    if (kind === 'png') return end.includes(Buffer.from('IEND')) ? { ok: true } : { ok: false, problem: 'PNG is truncated (no IEND)' };
    if (kind === 'jpg') return end.includes(Buffer.from([0xff, 0xd9])) ? { ok: true } : { ok: false, problem: 'JPEG is truncated (no end marker)' };
    return { ok: true };
  } finally { closeSync(fd); }
}

const MAGIC = [
  ['zip', (b) => b.readUInt32LE(0) === 0x04034b50 || b.readUInt32LE(0) === 0x06054b50],
  ['gz', (b) => b[0] === 0x1f && b[1] === 0x8b],
  ['pdf', (b) => b.toString('latin1', 0, 5) === '%PDF-'],
  ['png', (b) => b.readUInt32BE(0) === 0x89504e47],
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['html', (b) => /^\s*<(!doctype html|html)/i.test(b.toString('latin1', 0, 64))],
];
const EXPECT = { '.zip': 'zip', '.jar': 'zip', '.apk': 'zip', '.docx': 'zip', '.xlsx': 'zip', '.pptx': 'zip', '.epub': 'zip', '.gz': 'gz', '.tgz': 'gz', '.pdf': 'pdf', '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg' };

export async function checkFile(path, size) {
  if (PARTIAL.test(path)) return { status: 'incomplete', problem: 'unfinished download (browser temp file)' };
  if (size === 0) return { status: 'broken', problem: 'empty file (0 bytes)' };
  const fd = openSync(path, 'r');
  let head;
  try { head = readAt(fd, 0, 64); } finally { closeSync(fd); }
  if (head.length < 4) return { status: 'ok' };
  const kind = MAGIC.find(([, test]) => test(head))?.[0];
  const expected = EXPECT[extname(path).toLowerCase()];
  // A .zip/.pdf that is really an HTML page = a login/error page was saved instead of the file.
  if (expected && kind === 'html') return { status: 'broken', problem: `this ${extname(path)} is actually an HTML page (error or login page saved instead)` };
  if (expected && kind !== expected) return { status: 'broken', problem: `not a real ${extname(path)} file (content doesn't match)` };
  const r = kind === 'zip' ? await checkZip(path) : kind === 'gz' ? await checkGzip(path) : ['pdf', 'png', 'jpg'].includes(kind) ? checkEnding(path, kind) : { ok: true };
  return r.ok ? { status: 'ok', ...(r.note && { note: r.note }) } : { status: 'broken', problem: r.problem };
}

export async function sha256(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), async (src) => { for await (const c of src) h.update(c); });
  return h.digest('hex');
}

// "SHA256SUMS", "file.sha256", "*.sha256sum" files in the folder: { filename: hash }
export function readChecksums(dir, names) {
  const sums = {};
  for (const n of names) {
    if (!/(^sha256sums(\.txt)?$|\.sha256(sum)?$|^checksums?(\.txt)?$)/i.test(n)) continue;
    let text;
    try { const p = join(dir, n); if (lstatSync(p).size > 1_000_000) continue; text = readFileSync(p, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const gnu = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line); // "<hash>  file" (sha256sum)
      const bsd = /^SHA256 \((.+)\) = ([a-f0-9]{64})\s*$/i.exec(line); // "SHA256 (file) = <hash>" (macOS shasum --tag)
      if (gnu) sums[basename(gnu[2])] = gnu[1].toLowerCase();
      else if (bsd) sums[basename(bsd[1])] = bsd[2].toLowerCase();
      else if (/\.sha256(sum)?$/i.test(n) && /^[a-f0-9]{64}$/i.test(line.trim())) sums[n.replace(/\.sha256(sum)?$/i, '')] = line.trim().toLowerCase(); // bare hash in file.sha256
    }
  }
  return sums;
}

export function listFiles(root, { recursive = false, max = 20000 } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (recursive && !e.name.startsWith('.') && depth < 20) walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      try { out.push({ path: p, name: e.name, dir, size: lstatSync(p).size }); } catch {}
    }
  };
  walk(root, 0);
  return out;
}


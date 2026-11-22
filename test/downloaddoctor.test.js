import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkZip, checkFile, readChecksums, crc32 } from '../src/index.js';

const BIN = new URL('../bin/downloaddoctor.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const run = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
const fresh = () => mkdtempSync(join(tmpdir(), 'dd-'));

// Minimal zip writer (deflate) for tests.
function zip(entries) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text), comp = deflateRawSync(data), n = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, comp); central.push(ch, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const GOOD_ZIP = zip([['a.txt', 'hello '.repeat(500)], ['dir/b.txt', 'world']]);

test('crc32 fallback matches known value', () => assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926));

test('zip: verified, truncated, corrupt data', async () => {
  const d = fresh();
  const p = (n, b) => { const f = join(d, n); writeFileSync(f, b); return f; };
  assert.deepEqual(await checkZip(p('ok.zip', GOOD_ZIP)), { ok: true, note: '2 files verified' });
  assert.match((await checkZip(p('cut.zip', GOOD_ZIP.subarray(0, 60)))).problem, /truncated/);
  const bad = Buffer.from(GOOD_ZIP); bad[40] ^= 0xff;
  assert.match((await checkZip(p('bad.zip', bad))).problem, /a\.txt is corrupt/);
});

test('checkFile: partials, empty, html-instead-of-file, wrong type, truncated pdf/png/jpg/gz', async () => {
  const d = fresh();
  const p = (n, b) => { const f = join(d, n); writeFileSync(f, b); return f; };
  const chk = (n, b) => checkFile(p(n, b), Buffer.byteLength(b));
  assert.equal((await chk('movie.mp4.crdownload', 'x')).status, 'incomplete');
  assert.equal((await chk('a.part', 'x')).status, 'incomplete');
  assert.match((await chk('empty.zip', '')).problem, /empty/);
  assert.match((await chk('report.pdf', '<!DOCTYPE html><html>Sign in</html>')).problem, /actually an HTML page/);
  assert.match((await chk('photo.png', 'GIF89a.......')).problem, /not a real \.png/);
  assert.equal((await chk('doc.pdf', '%PDF-1.7\n...\n%%EOF\n')).status, 'ok');
  assert.match((await chk('doc2.pdf', '%PDF-1.7\n...half')).problem, /PDF is truncated/);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20), Buffer.from('IEND'), Buffer.alloc(4)]);
  assert.equal((await chk('i.png', png)).status, 'ok');
  assert.match((await chk('i2.png', png.subarray(0, 20))).problem, /PNG is truncated/);
  assert.match((await chk('j.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).problem, /JPEG is truncated/);
  const gz = gzipSync('x'.repeat(10000));
  assert.equal((await chk('a.gz', gz)).status, 'ok');
  assert.match((await chk('b.gz', gz.subarray(0, gz.length - 10))).problem, /gzip is truncated/);
  assert.equal((await chk('notes.txt', 'plain text is fine')).status, 'ok');
});

test('checksum files: GNU, BSD tag and bare hash formats', () => {
  const d = fresh();
  const h = 'a'.repeat(64), h2 = 'b'.repeat(64), h3 = 'c'.repeat(64);
  writeFileSync(join(d, 'SHA256SUMS'), `${h}  app.zip\n${h2} *tool.exe\n`);
  writeFileSync(join(d, 'iso.img.sha256'), `${h3}\n`);
  writeFileSync(join(d, 'mac.sha256'), `SHA256 (mac.dmg) = ${'d'.repeat(64)}\n`);
  assert.deepEqual(readChecksums(d, ['SHA256SUMS', 'iso.img.sha256', 'mac.sha256', 'other.txt']), { 'app.zip': h, 'tool.exe': h2, 'iso.img': h3, 'mac.dmg': 'd'.repeat(64) });
});

test('CLI: folder scan, checksum mismatch, --sha256, --dupes, read-only, errors', () => {
  const d = fresh();
  writeFileSync(join(d, 'good.zip'), GOOD_ZIP);
  writeFileSync(join(d, 'copy of good.zip'), GOOD_ZIP);
  writeFileSync(join(d, 'big.iso.crdownload'), 'partial');
  writeFileSync(join(d, 'tool.bin'), 'binary v1');
  const real = createHash('sha256').update('binary v1').digest('hex');
  writeFileSync(join(d, 'SHA256SUMS'), `${'0'.repeat(64)}  tool.bin\n${createHash('sha256').update(GOOD_ZIP).digest('hex')}  good.zip\n`);
  mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'x.pdf'), '%PDF-1.4 cut');
  const r = run([d, '--dupes']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /5 files checked · 2 with problems/);
  assert.match(r.stdout, /… big\.iso\.crdownload/);
  assert.match(r.stdout, /✗ tool\.bin .*\n +SHA-256 does not match/);
  assert.match(r.stdout, /✓ good\.zip {2}SHA-256 matches/);
  assert.match(r.stdout, /1 sets of duplicates/);
  assert.match(r.stdout, /copy of good\.zip {2}= {2}good\.zip|good\.zip {2}= {2}copy of good\.zip/);
  assert.match(run([d, '-r']).stdout, /sub.x\.pdf/);
  assert.ok(existsSync(join(d, 'big.iso.crdownload')), 'nothing deleted');
  assert.equal(run([join(d, 'tool.bin'), '--sha256', real]).status, 0);
  assert.equal(run([join(d, 'tool.bin'), '--sha256', 'f'.repeat(64)]).status, 1);
  assert.equal(run([d, '--sha256', 'xyz']).status, 2);
  assert.equal(run([join(d, 'nope')]).status, 2);
  const j = JSON.parse(run([d, '--json']).stdout);
  assert.equal(j.ok, false); assert.equal(j.checked, 5);
  const typo = run([d, '--dupe']);
  assert.equal(typo.status, 2); assert.match(typo.stderr, /did you mean --dupes/);
});

test('standalone bundle (used for the executables) behaves like the CLI', () => {
  const build = spawnSync(process.execPath, [new URL('../scripts/build-exe.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), '--bundle-only'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const bundle = new URL('../dist/downloaddoctor.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
  const d = fresh();
  writeFileSync(join(d, 'good.zip'), GOOD_ZIP);
  writeFileSync(join(d, 'bad.pdf'), '<html>login</html>');
  const viaBundle = spawnSync(process.execPath, [bundle, d, '--json'], { encoding: 'utf8' });
  const viaCli = run([d, '--json']);
  assert.equal(viaBundle.status, 1);
  assert.deepEqual(JSON.parse(viaBundle.stdout), JSON.parse(viaCli.stdout));
  assert.equal(spawnSync(process.execPath, [bundle, '--version'], { encoding: 'utf8' }).stdout.trim(), JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
});

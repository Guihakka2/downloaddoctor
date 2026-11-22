#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { listFiles, checkFile, sha256, readChecksums, printable } from '../src/index.js';

const HELP = `Usage: downloaddoctor [folder-or-file ...] [options]

Finds broken downloads: unfinished browser temp files, empty files, truncated or
corrupt zip/gz/pdf/png/jpg, "files" that are really an HTML error page, duplicates,
and files that don't match a SHA256SUMS / *.sha256 file next to them.
Read-only: never moves or deletes anything. Default folder: ~/Downloads.

Options:
  --sha256 HASH   Verify a single file against this SHA-256
  --dupes         Also list duplicate files (same content)
  -r, --recursive Include subfolders
  --json          Machine-readable output
  -h, --help      Show help
  -v, --version   Show version

Exit codes: 0 = all fine, 1 = problems found, 2 = usage error`;

const OPTIONS = { sha256: { type: 'string' }, dupes: { type: 'boolean' }, recursive: { type: 'boolean', short: 'r' }, json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } };
const die = (msg) => { process.stderr.write(`downloaddoctor: ${printable(msg)}\n`); process.exit(2); };

let args;
try { args = parseArgs({ allowPositionals: true, options: OPTIONS }); } catch (e) {
  const bad = /'(--?[\w-]+)'/.exec(e.message)?.[1];
  const near = bad && Object.keys(OPTIONS).find((k) => bad.length > 3 && `--${k}`.startsWith(bad.slice(0, 4)));
  die(`${bad ? `unknown option ${bad}` : e.message}${near ? ` (did you mean --${near}?)` : ''}. See --help.`);
}
const { values: o, positionals } = args;
if (o.help) { console.log(HELP); process.exit(0); }
if (o.version) { console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); process.exit(0); }
if (o.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(o.sha256)) die('--sha256 needs a 64-character hex hash');

const roots = positionals.length ? positionals : [join(homedir(), 'Downloads')];
let files = [];
for (const r of roots) {
  let st;
  try { st = statSync(r); } catch { die(`cannot read ${r}`); }
  if (st.isFile()) files.push({ path: r, name: basename(r), dir: join(r, '..'), size: st.size, root: join(r, '..') });
  else files.push(...listFiles(r, { recursive: o.recursive }).map((f) => ({ ...f, root: r })));
}
if (o.sha256 && files.length !== 1) die('--sha256 works with a single file');

const results = [];
const sumsByDir = new Map();
for (const f of files) {
  const r = { file: printable(relative(f.root, f.path) || f.name), size: f.size, ...(await checkFile(f.path, f.size)) };
  if (!sumsByDir.has(f.dir)) sumsByDir.set(f.dir, readChecksums(f.dir, files.filter((x) => x.dir === f.dir).map((x) => x.name)));
  const expected = o.sha256?.toLowerCase() ?? sumsByDir.get(f.dir)[f.name];
  if (expected && r.status !== 'incomplete') {
    const got = await sha256(f.path);
    r.checksum = got === expected ? 'match' : 'MISMATCH';
    if (got !== expected) { r.status = 'broken'; r.problem = 'SHA-256 does not match the published checksum'; }
  }
  results.push(r);
}

let dupes = [];
if (o.dupes) {
  const bySize = new Map();
  for (const f of files) if (f.size > 0) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
  const byHash = new Map();
  for (const group of bySize.values()) if (group.length > 1) for (const f of group) { const h = await sha256(f.path); byHash.set(h, [...(byHash.get(h) ?? []), f]); }
  dupes = [...byHash.values()].filter((g) => g.length > 1).map((g) => ({ size: g[0].size, files: g.map((f) => printable(relative(f.root, f.path))) }));
}

const bad = results.filter((r) => r.status !== 'ok');
const failed = bad.length > 0;
if (o.json) console.log(JSON.stringify({ ok: !failed, checked: results.length, problems: bad, duplicates: dupes, results }, null, 2));
else {
  const color = (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
  console.log(`${c(1, 'downloaddoctor')}  ${results.length} files checked · ${failed ? c(31, `${bad.length} with problems`) : c(32, 'no problems')}\n`);
  for (const r of bad) console.log(`  ${r.status === 'incomplete' ? c(33, '…') : c(31, '✗')} ${r.file}  ${c(2, mb(r.size))}\n      ${printable(r.problem)}`);
  for (const r of results.filter((x) => x.checksum === 'match')) console.log(`  ${c(32, '✓')} ${r.file}  ${c(2, 'SHA-256 matches')}`);
  if (dupes.length) {
    const wasted = dupes.reduce((s, d) => s + d.size * (d.files.length - 1), 0);
    console.log(`\n  ${c(1, `${dupes.length} sets of duplicates`)} ${c(2, `(${mb(wasted)} could be freed)`)}`);
    for (const d of dupes.slice(0, 20)) console.log(`    ${d.files.join(c(2, '  =  '))}`);
  }
  if (!failed && !dupes.length) console.log(c(32, '  ✓ everything looks complete'));
}
process.exit(failed ? 1 : 0);

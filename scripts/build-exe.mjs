// Builds a standalone downloaddoctor executable with Node's Single Executable Applications (node --build-sea).
// No bundler dependency: src/index.js and bin/downloaddoctor.js only import node: builtins and each other,
// so they are merged into one ES module here. Needs Node 25.5+ (ESM main for SEA).
//   node scripts/build-exe.mjs               -> dist/downloaddoctor[.exe]
//   node scripts/build-exe.mjs --bundle-only -> dist/downloaddoctor.mjs (used by the tests)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const dist = join(new URL('dist', root).pathname.replace(/^\/(\w:)/, '$1'));
const version = JSON.parse(read('package.json')).version;

// Collect "import { a, b } from 'node:x';" and "import * as y from 'node:x';" lines, merge them, drop them from the code.
const named = new Map(), namespaces = [];
function strip(code, file) {
  return code.replace(/^import (.+?) from '([^']+)';\n/gm, (line, what, from) => {
    if (from === '../src/index.js') return '';
    if (!from.startsWith('node:')) throw new Error(`${file}: only node: imports can be bundled (${from})`);
    const ns = /^\* as (\w+)$/.exec(what);
    if (ns) { namespaces.push(`import * as ${ns[1]} from '${from}';`); return ''; }
    const names = /^\{([^}]+)\}$/.exec(what);
    if (!names) throw new Error(`${file}: unsupported import: ${line}`);
    const set = named.get(from) ?? new Set();
    for (const n of names[1].split(',').map((s) => s.trim()).filter(Boolean)) set.add(n);
    named.set(from, set);
    return '';
  });
}

const lib = strip(read('src/index.js'), 'src/index.js').replace(/^export (?=(const|function|async function) )/gm, '');
const versionRead = "JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version";
let cli = strip(read('bin/downloaddoctor.js'), 'bin/downloaddoctor.js').replace(/^#!.*\n/, '');
if (!cli.includes(versionRead)) throw new Error('version lookup not found in bin');
cli = cli.replace(versionRead, JSON.stringify(version));
if (/^export /m.test(lib) || /\bimport\.meta\b/.test(lib + cli)) throw new Error('code the bundle cannot handle is left (export or import.meta)');

const imports = [...named].map(([from, set]) => `import { ${[...set].join(', ')} } from '${from}';`).concat(namespaces).join('\n');
const bundle = `// downloaddoctor ${version} (bundled for a standalone executable; source: github.com/Guihakka2/downloaddoctor)\n${imports}\n${lib}\n${cli}`;
mkdirSync(dist, { recursive: true });
const bundlePath = join(dist, 'downloaddoctor.mjs');
writeFileSync(bundlePath, bundle);
execFileSync(process.execPath, ['--check', bundlePath]);
console.log(`bundle: ${bundlePath}`);
if (process.argv.includes('--bundle-only')) process.exit(0);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 25 || (major === 25 && minor < 5)) throw new Error(`node --build-sea with an ES module needs Node 25.5+, this is ${process.version}`);
const exe = join(dist, process.platform === 'win32' ? 'downloaddoctor.exe' : 'downloaddoctor');
const config = join(dist, 'sea-config.json');
writeFileSync(config, JSON.stringify({ main: bundlePath, mainFormat: 'module', output: exe, disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', '--force', exe], { stdio: 'inherit' }); // ad-hoc signature so macOS runs it
console.log(`executable: ${exe}`);

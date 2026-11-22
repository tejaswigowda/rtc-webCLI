// Bundles the pinned dependencies into docs/lib/ and pins their SHA-256 into docs/index.html.
// The page refuses to start if the fetched bytes do not match the pinned hashes (RT17).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(root, 'docs', 'lib');
mkdirSync(lib, { recursive: true });

const pkgVersion = (name) =>
  JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

const entries = [
  {
    file: 'trystero-nostr.js',
    pkg: '@trystero-p2p/nostr',
    // schnorr is the signing primitive Trystero already bundles; the relay probe uses it to sign its test event.
    contents: "export { joinRoom, getRelaySockets, defaultRelayUrls } from '@trystero-p2p/nostr'; export { schnorr } from '@noble/secp256k1';",
  },
  {
    file: 'qrcode.js',
    pkg: 'qrcode-generator',
    contents: "import qrcode from 'qrcode-generator'; export default qrcode;",
  },
];

const pins = {};
for (const e of entries) {
  const out = path.join(lib, e.file);
  await build({
    stdin: { contents: e.contents, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    legalComments: 'inline',
    outfile: out,
    logLevel: 'error',
  });
  const hash = createHash('sha256').update(readFileSync(out)).digest('hex');
  pins[e.file] = { version: pkgVersion(e.pkg), sha256: hash, package: e.pkg };
}

writeFileSync(path.join(lib, 'PINS.json'), JSON.stringify(pins, null, 2) + '\n');

const htmlPath = path.join(root, 'docs', 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const marker = /\/\*PINS\*\/[\s\S]*?\/\*END-PINS\*\//;
if (!marker.test(html)) throw new Error('PINS marker not found in docs/index.html');
html = html.replace(marker, `/*PINS*/${JSON.stringify(pins)}/*END-PINS*/`);
writeFileSync(htmlPath, html);

for (const [f, p] of Object.entries(pins)) console.log(`${f}  ${p.package}@${p.version}  sha256:${p.sha256}`);

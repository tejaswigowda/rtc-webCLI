// Self-signed certificate for the local server, so other devices on the LAN get a secure origin
// (browsers block camera, microphone and the crypto this app needs on plain http://<LAN IP>).
// Covers localhost, 127.0.0.1 and this machine's LAN addresses; regenerated when those change.
import selfsigned from 'selfsigned';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const certDir = path.join(root, '.certs');

export async function ensureCert(addresses = [], dir = certDir) {
  mkdirSync(dir, { recursive: true });
  const names = [...new Set(['localhost', '127.0.0.1', ...addresses])].sort();
  const files = { key: path.join(dir, 'key.pem'), cert: path.join(dir, 'cert.pem'), meta: path.join(dir, 'meta.json') };
  if (Object.values(files).every(existsSync)) {
    try {
      const meta = JSON.parse(readFileSync(files.meta, 'utf8'));
      if (meta.names.join() === names.join() && Date.now() < meta.expires - 7 * 86400e3) {
        return { key: readFileSync(files.key), cert: readFileSync(files.cert), files, names, fresh: false };
      }
    } catch { /* regenerate */ }
  }
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'rtc-webCLI (local)' }], {
    days: 365, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: names.map((n) => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n })) }],
  });
  writeFileSync(files.key, pems.private, { mode: 0o600 });
  writeFileSync(files.cert, pems.cert);
  writeFileSync(files.meta, JSON.stringify({ names, expires: Date.now() + 365 * 86400e3 }));
  return { key: pems.private, cert: pems.cert, files, names, fresh: true };
}

// `npm run cert` writes the files and prints the VS Code Live Server settings that use them.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const os = await import('node:os');
  const addrs = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const c = await ensureCert(addrs);
  console.log(`${c.fresh ? 'Created' : 'Using existing'} certificate for: ${c.names.join(', ')}\n  ${c.files.cert}\n  ${c.files.key}\n`);
  console.log('VS Code Live Server (settings.json):');
  console.log(JSON.stringify({ 'liveServer.settings.https': { enable: true, cert: c.files.cert, key: c.files.key, passphrase: '' } }, null, 2));
}

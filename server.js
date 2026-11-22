// Local static server for docs/. Serves files only; it never sees the invite secret
// (the secret lives in the URL fragment, which browsers do not send).
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs');
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const tls = process.env.TLS_KEY && process.env.TLS_CERT
  ? { key: readFileSync(process.env.TLS_KEY), cert: readFileSync(process.env.TLS_CERT) }
  : null;

// Private IPv4 addresses first, so invite links point at an address other devices can reach.
function lanAddresses() {
  const rank = (a) => (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a) ? 0 : 1);
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b));
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const handler = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/lan.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ addresses: lanAddresses(), port, protocol: tls ? 'https:' : 'http:' }));
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
};
const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

server.listen(port, host, () => {
  const scheme = tls ? 'https' : 'http';
  console.log(`rtc-webCLI on ${scheme}://localhost:${port}/`);
  for (const a of lanAddresses()) console.log(`  on your network: ${scheme}://${a}:${port}/`);
  if (!tls) console.log('Note: other devices opening the LAN address over plain http cannot use camera/mic (RT20). Set TLS_KEY and TLS_CERT to serve https.');
});

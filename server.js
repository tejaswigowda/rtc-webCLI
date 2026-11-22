// Local static server for docs/. Serves files only; it never sees the invite secret
// (the secret lives in the URL fragment, which browsers do not send).
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { ensureCert } from './scripts/cert.mjs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs');
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const httpsPort = Number(process.env.HTTPS_PORT) || 8443;

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

// https is on by default (self-signed) so other devices on the LAN get a secure origin. NO_HTTPS=1 turns it off;
// TLS_KEY and TLS_CERT use your own certificate instead.
let tls = null;
if (!process.env.NO_HTTPS) {
  tls = process.env.TLS_KEY && process.env.TLS_CERT
    ? { key: readFileSync(process.env.TLS_KEY), cert: readFileSync(process.env.TLS_CERT), own: true }
    : await ensureCert(lanAddresses());
}

const handler = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/whoami') {
      // The address this request came from, so a browser that hides its own local address can still share it.
      let ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (ip === '::1' || ip.startsWith('127.')) ip = lanAddresses()[0] || null;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ip }));
      return;
    }
    if (url.pathname === '/lan.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ addresses: lanAddresses(), port: tls ? httpsPort : port, protocol: tls ? 'https:' : 'http:', httpPort: port, httpsPort: tls ? httpsPort : null }));
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
const servers = [http.createServer(handler).listen(port, host)];
if (tls) servers.push(https.createServer({ key: tls.key, cert: tls.cert }, handler).listen(httpsPort, host));

servers[0].on('listening', () => {
  console.log(`rtc-webCLI on http://localhost:${port}/`);
  if (tls) {
    console.log(`  https (for other devices): https://localhost:${httpsPort}/`);
    for (const a of lanAddresses()) console.log(`  on your network: https://${a}:${httpsPort}/   (accept the certificate warning once per device)`);
    if (tls.fresh) console.log(`  created a self-signed certificate in ${tls.files.cert.replace(/cert\.pem$/, '')}`);
  } else {
    for (const a of lanAddresses()) console.log(`  on your network: http://${a}:${port}/   (camera and microphone will be blocked there; unset NO_HTTPS)`);
  }
});

// Pure helpers for the local server: which local address to advertise, and what /whoami may answer.
// Kept free of I/O so they can be unit-tested.

const V4 = /^\d{1,3}(\.\d{1,3}){3}$/;
export const isDocker = (a) => /^172\.17\./.test(a);
export const isPrivateV4 = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
// An address worth sharing with peers: private, and not the default Docker bridge.
export const isUsablePrivate = (a) => isPrivateV4(a) && !isDocker(a);

// 192.168.* first (home Wi-Fi), then 10.*, then 172.16-31.*, then anything else, Docker's bridge last.
export function rankLan(addrs) {
  const rank = (a) => (/^192\.168\./.test(a) ? 0 : /^10\./.test(a) ? 1 : isDocker(a) ? 9 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 5);
  return [...addrs].sort((a, b) => rank(a) - rank(b));
}

const FORWARDING = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'cf-connecting-ip', 'x-real-ip', 'true-client-ip'];

// Answer with an address only when it is certainly the caller's own local address. Behind a tunnel or proxy the
// socket peer is the tunnel agent, not the caller, so the honest answer is "unknown".
export function answerWhoami({ remoteAddress = '', headers = {}, lan = [] }) {
  for (const h of FORWARDING) if (headers[h]) return { ip: null, reason: `request was forwarded (${h})` };
  const host = String(headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  const hostIsLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const hostIsLocal = hostIsLoopback || isPrivateV4(host) || host.endsWith('.local');
  if (!hostIsLocal) return { ip: null, reason: 'the page was not opened by a local address' };
  const ip = String(remoteAddress).replace(/^::ffff:/, '');
  if (ip === '::1' || ip.startsWith('127.')) {
    if (!hostIsLoopback) return { ip: null, reason: 'loopback request for a non-loopback host' };
    const own = lan.find(isUsablePrivate);
    return own ? { ip: own } : { ip: null, reason: 'this machine has no usable local address' };
  }
  if (!V4.test(ip) || !isUsablePrivate(ip)) return { ip: null, reason: 'the caller is not on a private IPv4 address' };
  return { ip };
}

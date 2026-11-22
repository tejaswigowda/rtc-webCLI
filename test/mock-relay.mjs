// Minimal in-process Nostr relay for tests: REQ / EVENT / CLOSE, kind + #x filters.
// Modes: normal | drop (accept, never forward) | reject (refuse every event) | oneway (drop messages that
// only one connection subscribes to, i.e. per-peer answers, while root announcements still flow).
import { WebSocketServer } from 'ws';

const PROBE_KIND = 29423;

export function startMockRelay({ mode = 'normal' } = {}) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => {
      const subs = new Map(); // ws -> Map(subId -> filters)
      const events = [];
      const frames = []; // every text frame seen, both directions, for leak checks
      const state = { mode, delayMs: 0 };

      const matches = (f, ev) =>
        (!f.kinds || f.kinds.includes(ev.kind)) &&
        (!f['#x'] || ev.tags.some((t) => t[0] === 'x' && f['#x'].includes(t[1])));

      const send = (ws, msg) => {
        const s = JSON.stringify(msg);
        frames.push(s);
        const go = () => { if (ws.readyState === 1) ws.send(s); };
        if (state.delayMs) setTimeout(go, state.delayMs); else go();
      };

      const subscribers = (ev) => {
        const out = [];
        for (const [other, m] of subs) for (const [id, filters] of m) if (filters.some((f) => matches(f, ev))) out.push([other, id]);
        return out;
      };

      wss.on('connection', (ws) => {
        subs.set(ws, new Map());
        ws.on('message', (raw) => {
          const text = raw.toString();
          frames.push(text);
          let msg;
          try { msg = JSON.parse(text); } catch { return; }
          if (msg[0] === 'REQ') {
            const [, id, ...filters] = msg;
            subs.get(ws).set(id, filters);
            if (state.mode === 'normal') for (const ev of events) if (filters.some((f) => matches(f, ev))) send(ws, ['EVENT', id, ev]);
            send(ws, ['EOSE', id]);
          } else if (msg[0] === 'CLOSE') {
            subs.get(ws).delete(msg[1]);
          } else if (msg[0] === 'EVENT') {
            const ev = msg[1];
            if (state.mode === 'reject') { send(ws, ['OK', ev.id, false, 'blocked: not allowed']); return; }
            send(ws, ['OK', ev.id, true, '']);
            if (state.mode === 'drop') return;
            events.push(ev);
            if (events.length > 500) events.shift();
            const targets = subscribers(ev);
            if (state.mode === 'oneway' && ev.kind !== PROBE_KIND && new Set(targets.map(([w]) => w)).size <= 1) return;
            for (const [other, id] of targets) send(other, ['EVENT', id, ev]);
          }
        });
        ws.on('close', () => subs.delete(ws));
      });

      resolve({
        url: `ws://127.0.0.1:${wss.address().port}`,
        frames,
        setMode: (m) => { state.mode = m; },
        setDelay: (ms) => { state.delayMs = ms; },
        close: () => wss.close(),
      });
    });
  });
}

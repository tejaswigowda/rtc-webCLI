// Minimal in-process Nostr relay for tests: REQ / EVENT / CLOSE, kind + #x filters.
import { WebSocketServer } from 'ws';

export function startMockRelay() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => {
      const subs = new Map(); // ws -> Map(subId -> filter)
      const events = [];
      const frames = []; // every text frame seen, both directions, for leak checks

      const matches = (f, ev) =>
        (!f.kinds || f.kinds.includes(ev.kind)) &&
        (!f['#x'] || ev.tags.some((t) => t[0] === 'x' && f['#x'].includes(t[1])));

      const send = (ws, msg) => { const s = JSON.stringify(msg); frames.push(s); ws.send(s); };

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
            for (const ev of events) if (filters.some((f) => matches(f, ev))) send(ws, ['EVENT', id, ev]);
            send(ws, ['EOSE', id]);
          } else if (msg[0] === 'CLOSE') {
            subs.get(ws).delete(msg[1]);
          } else if (msg[0] === 'EVENT') {
            const ev = msg[1];
            events.push(ev);
            if (events.length > 500) events.shift();
            send(ws, ['OK', ev.id, true, '']);
            for (const [other, m] of subs) {
              for (const [id, filters] of m) if (filters.some((f) => matches(f, ev))) send(other, ['EVENT', id, ev]);
            }
          }
        });
        ws.on('close', () => subs.delete(ws));
      });

      resolve({ url: `ws://127.0.0.1:${wss.address().port}`, frames, close: () => wss.close() });
    });
  });
}

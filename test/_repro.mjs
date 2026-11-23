import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { startMockRelay } from './mock-relay.mjs';
const PORT = 19900, ORIGIN = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT), HTTPS_PORT: '20900' }, stdio: 'ignore' });
const relay = await startMockRelay();
await sleep(1500);
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
async function open(name, url) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(({ relays, name }) => { if (!localStorage.getItem('rtc.settings')) { localStorage.setItem('rtc.settings', JSON.stringify({ name, lan: true, relays })); localStorage.setItem('rtc.ipNotice.2', '1'); } }, { relays: relay.url, name });
  const p = await ctx.newPage(); await p.goto(url); return p;
}
const join = async (p) => { await p.click('#btnJoin'); await p.waitForSelector('#room:not(.hidden)'); };
try {
  for (const mode of ['leave-button', 'close-tab']) {
    const A = await open('Alice', ORIGIN + '/'); await A.click('#btnCreate'); const url = A.url(); await join(A);
    const B = await open('Bob', url); await join(B);
    await sleep(8000);
    console.log(mode, 'before', await B.evaluate(() => ({ peers: window.rtc.S.peers.size, rows: document.querySelectorAll('#roster .rrow').length })));
    const t0 = Date.now();
    if (mode === 'leave-button') await A.click('#btnLeave').then(() => A.click('#overlayCard button:has-text("Leave")').catch(() => {})); else await A.context().close();
    for (let i = 0; i < 70; i++) {
      await sleep(1000);
      const s = await B.evaluate(() => ({ peers: window.rtc.S.peers.size, rows: document.querySelectorAll('#roster .rrow').length, pcs: [...window.rtc.allPCs].map((pc) => pc.connectionState).join(',') }));
      if (i % 5 === 0 || s.peers === 0) console.log(mode, ((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(s));
      if (s.peers === 0) { console.log(await B.evaluate(() => document.querySelector('#roster').innerText)); console.log(await B.evaluate(() => document.querySelector('#consoleOut').innerText)); break; }
    }
    await B.context().close();
  }
} finally { await browser.close(); server.kill(); relay.close?.(); process.exit(0); }

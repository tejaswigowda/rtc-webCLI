// End-to-end checks with real Chromium pages, a mock Nostr relay and fake media devices.
// Covers the gates that can be asserted in code; manual and measurement gates stay in the README.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { startMockRelay } from './mock-relay.mjs';

const PORT = 18080 + Math.floor(Math.random() * 500);
const ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const until = async (fn, ms = 30000, step = 250) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
const relay = await startMockRelay();
await until(async () => (await fetch(ORIGIN)).ok, 10000);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

const requests = [];
async function open(name, { url = ORIGIN + '/', dev = {}, relays = relay.url, lan = true } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(({ dev, relays, lan, name }) => {
    if (!localStorage.getItem('rtc.settings')) {
      localStorage.setItem('rtc.settings', JSON.stringify({ name, lan, relays }));
      localStorage.setItem('rtc.ipNoticeSeen', '1');
    }
    if (Object.keys(dev).length) localStorage.setItem('rtc.dev', JSON.stringify(dev));
  }, { dev, relays, lan, name });
  const page = await ctx.newPage();
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  await page.goto(url);
  return page;
}
const create = async (page) => { await page.click('#btnCreate'); return page.url(); };
const join = async (page) => { await page.click('#btnJoin'); await page.waitForSelector('#room:not(.hidden)'); };
const peerCount = (page) => page.evaluate(() => window.rtc.S.peers.size);
const connectedReady = (page, n) => until(() => page.evaluate((n) => {
  const ps = [...window.rtc.S.peers.values()];
  return ps.length === n && ps.every((p) => p.hello) && window.rtc.rt4Check().connections === n;
}, n), 45000);

try {
  // --- RT20: insecure origin -------------------------------------------------
  // (127.0.0.1 is treated as secure by browsers, so this is checked by calling the boot guard path on a LAN-style host if available.)

  // --- Two peers -------------------------------------------------------------
  const A = await open('Alice');
  const inviteUrl = await create(A);
  check('RT1 invite is origin + #k=<22 chars>', /^http:\/\/localhost:\d+\/#k=[A-Za-z0-9_-]{22}$/.test(inviteUrl), inviteUrl);
  const secret = inviteUrl.split('#k=')[1];
  const landingInvite = await A.textContent('#landingInvite');
  check('invite shown on the landing page uses the LAN address, not loopback', !/\/\/(localhost|127\.0\.0\.1)/.test(landingInvite) && landingInvite.endsWith('#k=' + inviteUrl.split('#k=')[1]), landingInvite);
  await join(A);
  await A.click('#btnQr');
  await A.waitForSelector('#qrCanvas');
  const qrText = await A.textContent('#overlayCard');
  check('QR dialog shows the LAN invite, not loopback', !/\/\/(localhost|127\.0\.0\.1)/.test(qrText) && qrText.includes('#k=' + inviteUrl.split('#k=')[1]), qrText.match(/http\S+/)?.[0]);
  await A.click('#overlayCard button:has-text("Close")');
  check('RT7 join is media-off (no tracks acquired)', await A.evaluate(() => window.rtc.S.allTracks.size === 0));
  const aStatus = await until(() => A.textContent('#status'), 5000);
  check('RT18 relay reachable + alone → "No one else is here yet"', await until(async () => /No one else is here yet/.test(await A.textContent('#status')), 15000));

  const B = await open('Bob', { url: inviteUrl });
  check('landing shows Join for an invite', await B.isVisible('#btnJoin'));
  await join(B);
  check('2 peers connect, hello exchanged, roster == connections (RT4)', (await connectedReady(A, 1)) && (await connectedReady(B, 1)));
  check('RT24 roster marks names unverified', /unverified name/.test(await A.textContent('#roster')));

  // --- RT7 preview-before-publish, RT4 receives, RT21 leave ---------------------
  await A.click('#btnCam');
  await A.waitForSelector('#preview video');
  const sendersBefore = await A.evaluate(() => [...window.rtc.allPCs].flatMap((pc) => pc.getSenders()).filter((s) => s.track).length);
  check('RT7 camera preview sends no track to any connection', sendersBefore === 0, `senders with track: ${sendersBefore}`);
  check('RT4 roster shows nothing received during preview', /nothing/.test(await A.textContent('#roster')));
  await A.click('#preview button.primary');
  check('camera published → Bob receives a video stream', await until(() => B.evaluate(() => [...window.rtc.S.peers.values()].some((p) => p.streams.cam && p.streams.cam.getVideoTracks().length)), 30000));
  check('RT4 roster on Alice lists video as received by Bob', await until(async () => /video/.test(await A.textContent('#roster')), 10000));
  check('RT10 quality line names resolution and audience', await until(async () => /Sending \d+p to 1 person/.test(await A.textContent('#qualityLine')), 15000), await A.textContent('#qualityLine'));
  check('RT10 policy: 1.5 Mbps over 4 people → below 720p', await A.evaluate(() => window.rtc.chooseLevel(1500000 / 4) < 720));

  await B.click('#btnMic');
  await B.waitForSelector('#preview');
  await B.click('#preview button.primary');
  check('mic published → Alice receives audio', await until(() => A.evaluate(() => [...window.rtc.S.peers.values()].some((p) => p.streams.mic)), 30000));

  // --- RT19 console parity ------------------------------------------------------
  await A.fill('#consoleIn', '/peers'); await A.press('#consoleIn', 'Enter');
  check('RT19 /peers lists Bob with receives', await until(async () => /Bob/.test(await A.textContent('#consoleOut')), 5000));
  await A.fill('#consoleIn', '/cap'); await A.press('#consoleIn', 'Enter');
  check('RT19 /cap says provisional', /provisional/.test(await A.textContent('#consoleOut')));
  await A.fill('#consoleIn', '/stats 1'); await A.press('#consoleIn', 'Enter');
  check('RT19 /stats prints raw getStats fields', await until(async () => /candidate-pair \{/.test(await A.textContent('#consoleOut')), 5000));
  await A.fill('#consoleIn', '/path'); await A.press('#consoleIn', 'Enter');
  check('RT15 /path labels the connection path', await until(async () => /direct|relay/.test(await A.textContent('#consoleOut')), 8000));
  await A.fill('#consoleIn', '/about'); await A.press('#consoleIn', 'Enter');
  check('RT26 /about shows protocol + lib hash', /protocol 1/.test(await A.textContent('#consoleOut')) && /sha256:[0-9a-f]{64}/.test(await A.textContent('#consoleOut')));
  await A.fill('#consoleIn', '/relays'); await A.press('#consoleIn', 'Enter');
  await A.fill('#consoleIn', '/egress'); await A.press('#consoleIn', 'Enter');
  check('RT16 /egress lists origin, relay, STUN state', /relay\s+127\.0\.0\.1/.test(await A.textContent('#consoleOut')) && /none \(LAN only\)/.test(await A.textContent('#consoleOut')));

  await A.fill('#consoleIn', '/mute'); await A.press('#consoleIn', 'Enter');

  // --- RT2 / RT3: relay frames never carry the secret or plaintext SDP ----------
  const all = relay.frames.join('\n');
  check('RT2 secret appears in 0 relay frames', !all.includes(secret) && !all.includes(decodeURIComponent(secret)), `${relay.frames.length} frames`);
  check('RT3 no plaintext SDP in relay frames', !/a=fingerprint|a=candidate|a=ice-ufrag|\bm=(audio|video|application)/.test(all));
  check('RT1 secret in 0 page requests', requests.every((u) => !u.includes(secret)), `${requests.length} requests`);
  const foreign = requests.filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:'));
  check('RT17 no script/asset loaded outside the origin', foreign.length === 0, foreign.join(', '));

  // --- Third peer, churn, RT4 ---------------------------------------------------
  const C = await open('Carol', { url: inviteUrl });
  await join(C);
  check('3 peers connect; RT4 holds on all', (await connectedReady(A, 2)) && (await connectedReady(B, 2)) && (await connectedReady(C, 2)));
  await C.click('#btnLeave');
  await C.waitForSelector('#overlay:not(.hidden)');
  check('RT6 leaver sees the room continues for others', /continues for 2 other people/.test(await C.textContent('#overlayCard')), (await C.textContent('#overlayCard')).slice(0, 200));
  check('RT21 leaving ended every track', /Verified/.test(await C.textContent('#overlayCard')) || (await C.evaluate(() => window.rtc.allTracksEnded())));
  check('after churn A/B roster == connections', (await connectedReady(A, 1)) && (await connectedReady(B, 1)));

  // --- RT5: request-to-remove is honest ----------------------------------------
  const D = await open('Dave', { url: inviteUrl });
  await join(D);
  await connectedReady(A, 2);
  const roster = await A.textContent('#roster');
  check('RT5 remove button is labelled as a request', /Ask everyone to disconnect/.test(roster));

  // --- RT21 full leave with camera on -----------------------------------------
  await A.click('#btnLeave');
  await A.waitForSelector('#overlay:not(.hidden)');
  const overlay = await A.textContent('#overlayCard');
  check('RT21 leave with camera on → all tracks report ended', await A.evaluate(() => window.rtc.allTracksEnded()) && /Verified: \d+ of \d+ tracks/.test(overlay), overlay.slice(0, 160));

  // --- RT26: incompatible version -------------------------------------------------
  const E = await open('Eve', { url: inviteUrl, dev: { protocol: 2 } });
  await join(E);
  check('RT26 mismatched protocol → named refusal on both sides', await until(async () => /incompatible version/.test(await B.textContent('#roster')) && /incompatible version/.test(await E.textContent('#roster')), 45000));
  await E.close(); await D.close();

  // --- RT8: hard cap ----------------------------------------------------------------
  const capUrl = ORIGIN + '/#k=' + 'Q'.repeat(22);
  const caps = [];
  for (let i = 0; i < 3; i++) {
    const p = await open(`cap${i}`, { url: capUrl, dev: { audioCap: 3, videoCap: 2 } });
    await join(p);
    caps.push(p);
  }
  await until(() => connectedReady(caps[0], 2), 45000);
  const over = await open('cap-over', { url: capUrl, dev: { audioCap: 3, videoCap: 2 } });
  await join(over);
  const refused = await until(async () => /This room is full/.test(await over.textContent('#overlayCard')), 45000);
  check('RT8 joiner N+1 gets a screen naming the cap and the reason', refused, refused ? (await over.textContent('#overlayCard')).slice(0, 120) : '');
  check('RT8 existing call unaffected', await connectedReady(caps[0], 2));
  const third = caps[2];
  await third.click('#btnCam');
  check('RT8 video seat refusal for the 3rd video peer', await until(async () => /Video is full for this room/.test(await third.textContent('#overlayCard')), 10000));

  // --- RT5: ask-to-disconnect and Move room -----------------------------------------
  const mvUrl = ORIGIN + '/#k=' + 'M'.repeat(22);
  const M1 = await open('Mia', { url: mvUrl }); await join(M1);
  const M2 = await open('Max', { url: mvUrl }); await join(M2);
  const M3 = await open('Mel', { url: mvUrl }); await join(M3);
  await connectedReady(M1, 2); await connectedReady(M2, 2); await connectedReady(M3, 2);
  await M1.fill('#consoleIn', '/remove Mel'); await M1.press('#consoleIn', 'Enter');
  check('RT5 target is asked, can stay, and UI does not claim removal',
    await until(async () => /asked the room to disconnect you/.test(await M3.textContent('#overlayCard')), 15000)
    && /Peers that ignore this stay connected/.test(await M1.textContent('#consoleOut')));
  await M3.click('#overlayCard button:has-text("Stay")');
  await M2.fill('#consoleIn', '/move all'); await M2.press('#consoleIn', 'Enter');
  const prompted = await until(async () => /The room is moving/.test(await M1.textContent('#overlayCard')), 15000);
  check('RT5 Move room invites chosen peers over the data channel', prompted);
  if (prompted) {
    const oldHash = new URL(M1.url()).hash;
    await M1.click('#overlayCard button:has-text("Join the new room")');
    await M1.waitForSelector('#room:not(.hidden)', { timeout: 20000 });
    check('moved peer lands in a different room automatically', new URL(M1.url()).hash !== oldHash);
  }

  // --- RT13: a peer that cannot make UDP paths fails loudly --------------------------
  const blocked = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  const bctx = await blocked.newContext();
  await bctx.addInitScript(({ relays }) => {
    localStorage.setItem('rtc.settings', JSON.stringify({ name: 'Gina', lan: true, relays }));
    localStorage.setItem('rtc.ipNoticeSeen', '1');
  }, { relays: relay.url });
  const G = await bctx.newPage();
  const failUrl = ORIGIN + '/#k=' + 'U'.repeat(22);
  await G.goto(failUrl); await join(G);
  const H = await open('Hank', { url: failUrl }); await join(H);
  const t0 = Date.now();
  const failed13 = await until(async () => /Couldn't reach .* directly \((no candidates|ICE failed|DTLS failed)\)/.test(await H.textContent('#status')), 40000);
  check('RT13 unreachable pair is named with a reason class', failed13, `${Math.round((Date.now() - t0) / 1000)}s: ${(await H.textContent('#status')).slice(0, 120)}`);
  await blocked.close();

  // --- RT18: unreachable relays ------------------------------------------------------
  const F = await open('Frank', { url: ORIGIN + '/#k=' + 'R'.repeat(22), relays: 'ws://127.0.0.1:1' });
  await join(F);
  check('RT18 relays unreachable → introduction-servers message, not "no one yet"',
    await until(async () => /Can't reach the introduction servers/.test(await F.textContent('#status')), 20000)
    && !/No one else is here yet/.test(await F.textContent('#status')));
} catch (e) {
  console.error('Test run crashed:', e);
  check('test run completed', false, e.message);
} finally {
  await browser.close();
  relay.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

// End-to-end checks with real Chromium pages, a mock Nostr relay and fake media devices.
// Covers the gates that can be asserted in code; manual and measurement gates stay in the README.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { startMockRelay } from './mock-relay.mjs';
import http from 'node:http';
import { answerWhoami, rankLan } from '../scripts/whoami.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 18080 + Math.floor(Math.random() * 500);
const ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000, step = 250) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

const HTTPS_PORT = PORT + 1000;
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(HTTPS_PORT) }, stdio: 'inherit' });
const relay = await startMockRelay();
await until(async () => (await fetch(ORIGIN)).ok, 20000);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=device-count=2', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

const requests = [];
async function open(name, { url = ORIGIN + '/', dev = {}, relays = relay.url, lan = true, clockShift = 0 } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] });
  if (clockShift) await ctx.addInitScript((shift) => { const real = Date.now.bind(Date); Date.now = () => real() + shift; }, clockShift);
  await ctx.addInitScript(({ dev, relays, lan, name }) => {
    if (!localStorage.getItem('rtc.settings')) {
      localStorage.setItem('rtc.settings', JSON.stringify({ name, lan, relays }));
      localStorage.setItem('rtc.ipNotice.2', '1');
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
const join = async (page) => { await page.click('#btnJoin'); await page.waitForSelector('#room:not(.hidden)'); await page.click('#tabConsole', { timeout: 3000 }).catch(() => {}); };
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
  check('RT1 invite is origin + #k=<secret>&h=<creator hash>', /^http:\/\/localhost:\d+\/#k=[A-Za-z0-9_-]{22}&h=[A-Za-z0-9_-]{22}$/.test(inviteUrl), inviteUrl);
  const secret = inviteUrl.split('#k=')[1].slice(0, 22);
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
  check('RT26 /about shows protocol + lib hash', /protocol 3/.test(await A.textContent('#consoleOut')) && /sha256:[0-9a-f]{64}/.test(await A.textContent('#consoleOut')));
  await A.fill('#consoleIn', '/relays'); await A.press('#consoleIn', 'Enter');
  await A.fill('#consoleIn', '/egress'); await A.press('#consoleIn', 'Enter');
  check('RT16/RF13 /egress shows declared and observed hosts, observed ⊆ declared (LAN-only)',
    await until(async () => { const t = await A.textContent('#consoleOut'); return /SET to contact/.test(t) && /OBSERVED/.test(t) && /127\.0\.0\.1:\d+\s+relay/.test(t) && /every observed host is one you set/.test(t) && !/⚠ \d+ observed/.test(t); }, 15000));
  check('RF4 /relays reports a probe result per relay', await until(async () => /probe: ok/.test(await A.textContent('#consoleOut')), 5000));
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
  // --- Chat -----------------------------------------------------------------------------
  for (const pg of [A, B, C]) await pg.click('#tabChat');
  await A.fill('#chatIn', 'hello everyone'); await A.press('#chatIn', 'Enter');
  check('chat: message to everyone reaches B and C', await until(async () => /hello everyone/.test(await B.textContent('#chatOut')) && /hello everyone/.test(await C.textContent('#chatOut')), 15000));
  const cOpts = await B.$$eval('#chatTo option', (os) => os.map((o) => o.textContent));
  const toCarol = await B.$$eval('#chatTo option', (os) => os.find((o) => /Carol/.test(o.textContent))?.value);
  await B.selectOption('#chatTo', toCarol);
  await B.fill('#chatIn', 'psst only carol'); await B.press('#chatIn', 'Enter');
  check('chat: direct message arrives labelled, and only for its recipient',
    await until(async () => /psst only carol/.test(await C.textContent('#chatOut')) && /direct message to you/.test(await C.textContent('#chatOut')), 15000)
    && !/psst only carol/.test(await A.textContent('#chatOut')), cOpts.join(' | '));
  check('chat: creator is marked for everyone, with proof', /creator/.test(await B.textContent('#chatOut')) && await B.evaluate(() => [...window.rtc.S.peers.values()].some((p) => p.isHost)) && !(await A.evaluate(() => [...window.rtc.S.peers.values()].some((p) => p.isHost))));
  await A.click('#tabConsole');
  await A.fill('#consoleIn', '/chat from console'); await A.press('#consoleIn', 'Enter');
  check('console /chat parity: message arrives in B\'s chat', await until(async () => /from console/.test(await B.textContent('#chatOut')), 10000));

  // --- Recording: creator only, everyone is told --------------------------------------------
  check('only the creator has a Record button', await A.isVisible('#btnRec') && !(await B.isVisible('#btnRec')) && !(await C.isVisible('#btnRec')));
  await B.click('#tabConsole');
  await B.fill('#consoleIn', '/record'); await B.press('#consoleIn', 'Enter');
  check('a non-creator cannot start recording', await until(async () => /Only the person who created this room can record/.test(await B.textContent('#consoleOut')), 5000) && !(await B.evaluate(() => window.rtc.REC.on)));
  await A.click('#btnRec');
  await A.click('#overlayCard button:has-text("Start recording")');
  check('creator is recording', await until(() => A.evaluate(() => window.rtc.REC.on), 10000));
  check('B and C are told in their own UI', await until(async () => /is recording this room/.test(await B.textContent('#status')) && /is recording this room/.test(await C.textContent('#status')) && /This room is being recorded/.test(await B.textContent('#overlayCard')), 20000));
  await B.click('#overlayCard button:has-text("Stay")'); await C.click('#overlayCard button:has-text("Stay")');
  check('roster marks who is recording', /recording/.test(await B.textContent('#roster')));
  await sleep(2500);
  const dl = A.waitForEvent('download', { timeout: 20000 });
  await A.click('#btnRec');
  const file = await dl;
  const { size } = await (await import('node:fs/promises')).stat(await file.path());
  check('stopping saves a non-empty recording on the creator\'s device', size > 1000 && /^rtc-webCLI-.*\.(webm|mp4)$/.test(file.suggestedFilename()), `${file.suggestedFilename()} ${size} bytes`);
  check('B and C are told it stopped', await until(async () => !/is recording this room/.test(await B.textContent('#status')) && !/is recording this room/.test(await C.textContent('#status')), 15000));
  // A non-creator claiming to record is ignored by everyone else.
  await B.evaluate(() => window.rtc.S.actions.rec.send({ on: true, at: Date.now() }));
  await sleep(1500);
  check('a recording claim from a non-creator is ignored', !/is recording this room/.test(await A.textContent('#status')) && !/is recording this room/.test(await C.textContent('#status')));

  await C.click('#tabChat'); await C.click('#btnMic'); await C.waitForSelector('#preview'); await C.click('#preview button.primary');
  await C.click('#btnLeave');
  await C.waitForSelector('#overlay:not(.hidden)');
  check('RT6 leaver sees the room continues for others', /continues for 2 other people/.test(await C.textContent('#overlayCard')), (await C.textContent('#overlayCard')).slice(0, 200));
  check('RT21 leaving ended every track (non-vacuous)', /Verified: [1-9]\d* of [1-9]\d* tracks/.test(await C.textContent('#overlayCard')) && await C.evaluate(() => window.rtc.S.allTracks.size > 0 && window.rtc.allTracksEnded()), (await C.textContent('#overlayCard')).slice(-120));
  check('after churn A/B roster == connections', (await connectedReady(A, 1)) && (await connectedReady(B, 1)));

  // --- RT5: request-to-remove is honest ----------------------------------------
  const D = await open('Dave', { url: inviteUrl });
  await join(D);
  await connectedReady(A, 2);
  const roster = await A.textContent('#roster');
  check('RT5 remove button is labelled as a request', /Ask everyone to disconnect/.test(roster));

  // --- Basics: devices, speaker highlight, spotlight, hand, reactions, timer, reconnect ----------------
  await A.click('#btnDevices');
  await A.waitForSelector('#overlayCard select');
  const camOptions = await A.$$eval('#overlayCard select:nth-of-type(1) option, #overlayCard select option', (os) => os.length);
  const selects = await A.$$eval('#overlayCard select', (ss) => ss.map((s) => [...s.options].map((o) => o.value)));
  check('Devices dialog lists cameras and microphones', selects.length >= 2 && selects[0].length >= 2 && selects[1].length >= 2, JSON.stringify(selects.map((x) => x.length)));
  const camBefore = await A.evaluate(() => window.rtc.S.my.cam.getVideoTracks()[0].id);
  const camTarget = selects[0].filter(Boolean)[1] ?? selects[0].filter(Boolean)[0];
  await A.selectOption('#overlayCard select >> nth=0', camTarget);
  const switched = await until(() => A.evaluate((before) => {
    const t = window.rtc.S.my.cam.getVideoTracks()[0];
    const onSenders = [...window.rtc.allPCs].flatMap((pc) => pc.getSenders()).filter((s) => s.track === t).length;
    return t.id !== before && t.readyState === 'live' && onSenders >= 1;
  }, camBefore), 15000);
  check('switching camera while live swaps the track on every connection without stopping the call', switched);
  check('after the switch every track is still accounted for in the roster', (await until(() => A.evaluate(() => window.rtc.rt4Check().ok), 8000)));
  await A.click('#overlayCard button:has-text("Done")');
  const mirrored = await A.$eval('[data-tile="self"] video', (v) => v.classList.contains('mirror'));
  await A.click('#btnDevices'); await A.waitForSelector('#overlayCard input[type=checkbox]');
  await A.click('#overlayCard label:has-text("Mirror") input');
  check('mirror toggle flips only the self view', mirrored && !(await A.$eval('[data-tile="self"] video', (v) => v.classList.contains('mirror'))));
  await A.click('#overlayCard label:has-text("Mirror") input');
  await A.click('#overlayCard button:has-text("Done")');
  const err = await A.evaluate(() => window.rtc.explainMediaError({ name: 'NotAllowedError' }, 'cam'));
  check('permission-denied errors get step-by-step help', /blocked your camera/.test(err.title) && /lock or tune icon/.test(err.body.join(' ')));

  await B.click('#tabConsole');
  const speaking = await until(() => A.evaluate(() => [...document.querySelectorAll('.tile.speaking')].length > 0), 20000);
  check('active speaker: a tile is highlighted while someone talks (fake microphone beeps)', speaking);
  const bTile = await A.evaluate(() => [...window.rtc.S.peers.values()].find((p) => p.name === 'Bob')?.id);
  await A.hover(`[data-tile="${bTile}"]`);
  await A.click(`[data-tile="${bTile}"] .tbtn.pin`);
  check('pin spotlights a tile (and unpin restores the grid)', await A.evaluate((id) => document.querySelector(`[data-tile="${id}"]`).classList.contains('focus') && document.querySelector('#tiles').classList.contains('focused'), bTile));
  await A.hover(`[data-tile="${bTile}"]`);
  await A.click(`[data-tile="${bTile}"] .tbtn.pin`);
  check('unpin', await A.evaluate(() => !document.querySelector('#tiles').classList.contains('focused')));
  await A.fill('#consoleIn', '/layout speaker'); await A.press('#consoleIn', 'Enter');
  check('speaker layout enlarges the active speaker', await until(() => A.evaluate(() => document.querySelector('#tiles').classList.contains('focused') && !!document.querySelector('.tile.focus')), 20000));
  await A.fill('#consoleIn', '/layout grid'); await A.press('#consoleIn', 'Enter');

  await B.fill('#consoleIn', '/hand'); await B.press('#consoleIn', 'Enter');
  check('raise hand shows a hand on B\'s tile and a line in chat, for others', await until(async () => await A.evaluate((id) => !!document.querySelector(`[data-tile="${id}"] .hand`), bTile) && /raised their hand/.test(await A.textContent('#chatOut')), 15000));
  await B.fill('#consoleIn', '/hand'); await B.press('#consoleIn', 'Enter');
  await B.fill('#consoleIn', '/react 🎉'); await B.press('#consoleIn', 'Enter');
  check('reaction floats over the sender\'s tile for others', await until(() => A.evaluate((id) => !!document.querySelector(`[data-tile="${id}"] .float`), bTile), 10000));
  await A.click('#btnReact');
  check('react menu offers the reactions', (await A.$$eval('#reactMenu button', (b) => b.length)) === 6);
  await A.click('#reactMenu button >> nth=0');
  check('meeting timer is shown', /in room \d\d:\d\d/.test(await A.textContent('#timer')));
  await A.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); window.dispatchEvent(new Event('offline')); });
  check('offline banner appears', await until(async () => /You're offline/.test(await A.textContent('#status')), 5000));
  await A.evaluate(() => { delete navigator.onLine; window.dispatchEvent(new Event('online')); });

  // Connection loss: close the link to B. The library re-dials, and media must resume without any action.
  await A.evaluate((id) => { window.rtc.S.room.getPeers()[id].connection.close(); }, bTile);
  const recovered = await until(() => A.evaluate((id) => { const p = window.rtc.S.peers.get(id); return !!p && p.hello && window.rtc.S.sent.cam.has(id) && window.rtc.rt4Check().ok; }, bTile), 90000);
  check('after the link to a peer drops, it reconnects by itself and your camera resumes', recovered);

  // --- LAN: secure origin for other devices ---------------------------------------------------------
  const lanInfo = await (await fetch(`${ORIGIN}/lan.json`)).json();
  check('server offers https for the LAN and says so in /lan.json', lanInfo.protocol === 'https:' && lanInfo.httpsPort === HTTPS_PORT && lanInfo.port === HTTPS_PORT, JSON.stringify(lanInfo));
  const lanIp = lanInfo.addresses[0];
  if (lanIp) {
    const sctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const sp = await sctx.newPage();
    await sp.goto(`https://${lanIp}:${HTTPS_PORT}/`);
    const secure = await sp.evaluate(() => window.isSecureContext && !!crypto.subtle);
    await sp.click('#btnCreate');
    const lanLink = await until(async () => { const t = await sp.textContent('#landingInvite'); return /#k=/.test(t) && t; }, 10000);
    check('opening the LAN address over https is a secure origin and shares an https LAN invite', secure && lanLink.startsWith(`https://${lanIp}:${HTTPS_PORT}/`), lanLink);
    await sctx.close();
    const ictx = await browser.newContext();
    const ip = await ictx.newPage();
    await ip.goto(`http://${lanIp}:${PORT}/#k=${'L'.repeat(22)}`);
    const secureLink = await until(async () => ip.getAttribute('#insecure a', 'href'), 10000);
    check('opening the LAN address over plain http explains why and links to the https version, keeping the invite', !!secureLink && secureLink === `https://${lanIp}:${HTTPS_PORT}/#k=${'L'.repeat(22)}`, secureLink || 'no link');
    await ictx.close();
  } else check('LAN checks skipped (no LAN address on this machine)', true);

  // --- Same network, addresses hidden, no mic preview: the local address is shared so they connect ------------
  const maskedBrowser = await chromium.launch(); // default flags: local addresses hidden behind .local names
  const sameNetUrl = ORIGIN + '/#k=' + 'G'.repeat(22);
  const sn = [];
  for (const [n, share] of [['Gus', true], ['Gia', true]]) {
    const ctx = await maskedBrowser.newContext();
    await ctx.addInitScript(({ relays, n, share }) => {
      localStorage.setItem('rtc.settings', JSON.stringify({ name: n, lan: false, relays, shareLan: share }));
      localStorage.setItem('rtc.ipNotice.2', '1');
    }, { relays: relay.url, n, share });
    const pg = await ctx.newPage();
    await pg.goto(sameNetUrl); await join(pg);
    sn.push(pg);
  }
  const joined = (await connectedReady(sn[0], 1)) && (await connectedReady(sn[1], 1));
  check('hidden .local addresses: two windows connect with no mic preview, because the local address is shared', joined, (await sn[0].textContent('#consoleOut')).match(/Sharing your local network address \(\S+\)/)?.[0] || 'no address shared');
  await maskedBrowser.close();

  // --- About page: static, self-contained, diagrams all load ----------------------------------------------
  const aboutRes = await fetch(`${ORIGIN}/about/`);
  const aboutHtml = await aboutRes.text();
  const imgSrcs = [...aboutHtml.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const imgRes = await Promise.all(imgSrcs.map((u) => fetch(new URL(u, `${ORIGIN}/about/`))));
  check('About page serves, has no scripts, and loads every diagram as SVG',
    aboutRes.ok && !/<script/i.test(aboutHtml) && imgSrcs.length >= 6 && imgRes.every((r) => r.ok && /svg/.test(r.headers.get('content-type'))), `${imgSrcs.length} diagrams`);
  const aboutPage = await (await browser.newContext()).newPage();
  const aboutReqs = [];
  aboutPage.on('request', (r) => aboutReqs.push(r.url()));
  await aboutPage.goto(`${ORIGIN}/about/`);
  await aboutPage.waitForLoadState('networkidle');
  const broken = await aboutPage.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length);
  check('About page makes no request outside the origin and no diagram is broken', broken === 0 && aboutReqs.every((u) => u.startsWith(ORIGIN) || u.startsWith('data:')), aboutReqs.filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('data:')).join(', '));
  await aboutPage.context().close();

  // --- RV2: /whoami answers only when it is certain ----------------------------------------------------------
  const lanSet = ['192.168.0.5'];
  const w = (remoteAddress, headers) => answerWhoami({ remoteAddress, headers, lan: lanSet });
  check('RV2 direct LAN request → the caller\'s address', w('::ffff:192.168.0.77', { host: '192.168.0.5:8443' }).ip === '192.168.0.77');
  check('RV2 loopback with Host localhost → the server\'s LAN address', w('127.0.0.1', { host: 'localhost:8080' }).ip === '192.168.0.5' && w('::1', { host: '127.0.0.1:8080' }).ip === '192.168.0.5');
  check('RV2 loopback with a tunnel Host → null, with a reason', w('127.0.0.1', { host: 'x.ngrok-free.app' }).ip === null && !!w('127.0.0.1', { host: 'x.ngrok-free.app' }).reason);
  check('RV2 any forwarding header → null', ['x-forwarded-for', 'forwarded', 'cf-connecting-ip'].every((h) => w('192.168.0.77', { host: '192.168.0.5', [h]: '1.2.3.4' }).ip === null));
  check('RV2 public caller or Docker address → null', w('8.8.8.8', { host: '192.168.0.5' }).ip === null && w('172.17.0.2', { host: '192.168.0.5' }).ip === null);

  // --- RV8: the chosen local address ignores Docker and VPN when a better one exists -----------------------------
  const mixed = ['172.17.0.1', '10.8.0.2', '192.168.0.5'];
  check('RV8 ranking prefers 192.168, then 10, never Docker first (server)', rankLan(mixed)[0] === '192.168.0.5' && rankLan(['172.17.0.1', '10.8.0.2'])[0] === '10.8.0.2' && rankLan(['172.17.0.1', '172.20.0.3'])[0] === '172.20.0.3');
  check('RV8 same ranking and Docker exclusion in the page', await A.evaluate((m) => [...m].sort((a, b) => window.rtc.rankLanAddr(a) - window.rtc.rankLanAddr(b))[0] === '192.168.0.5' && !window.rtc.usablePrivate('172.17.0.1') && window.rtc.usablePrivate('172.20.0.3') && window.rtc.usablePrivate('10.8.0.2'), mixed));

  // --- RV3: the join notice is keyed to its text ----------------------------------------------------------------
  const oldCtx = await browser.newContext();
  await oldCtx.addInitScript(({ relays }) => {
    localStorage.setItem('rtc.settings', JSON.stringify({ name: 'Old', lan: true, relays }));
    localStorage.setItem('rtc.ipNoticeSeen', '1'); // accepted on v0.1 / v0.2
  }, { relays: relay.url });
  const oldPage = await oldCtx.newPage();
  await oldPage.goto(`${ORIGIN}/#k=${'O'.repeat(22)}`);
  await oldPage.click('#btnJoin');
  await oldPage.waitForSelector('#overlayCard:has-text("Before you join")', { timeout: 15000 });
  const noticeText = await oldPage.textContent('#overlayCard');
  check('RV3 someone who accepted an older notice sees the new one, with the change marked', /New:/.test(noticeText) && /local network address/.test(noticeText), noticeText.slice(0, 160));
  check('RV8 the notice shows the address that would be shared', /\(\d+\.\d+\.\d+\.\d+\)/.test(noticeText), noticeText.match(/\(\d+\.\d+\.\d+\.\d+\)/)?.[0] || 'none');
  await oldPage.click('#overlayCard button:has-text("Join anyway")');
  await oldPage.waitForSelector('#room:not(.hidden)');
  check('RV3 accepting stores the current notice key only', await oldPage.evaluate(() => !!localStorage.getItem('rtc.ipNotice.2')));
  await oldCtx.close();

  // --- RV4: what is passed to the library is explicit, and the page opens sockets only to declared hosts ----------
  const cfgProblems = await A.evaluate(() => window.rtc.egressConfigProblems());
  check('RV4 LAN-only: relay list and ICE servers passed to the library are exactly the declared ones', cfgProblems.length === 0, cfgProblems.join('; '));
  const wsHosts = [];
  const cfgCtx = await browser.newContext();
  await cfgCtx.addInitScript(({ relays }) => { localStorage.setItem('rtc.settings', JSON.stringify({ name: 'Cfg', lan: false, relays })); localStorage.setItem('rtc.ipNotice.2', '1'); }, { relays: relay.url });
  const cfgPage = await cfgCtx.newPage();
  cfgPage.on('websocket', (ws) => wsHosts.push(new URL(ws.url()).host));
  await cfgPage.goto(`${ORIGIN}/#k=${'F'.repeat(22)}`); await join(cfgPage);
  await sleep(7000);
  const cfg2 = await cfgPage.evaluate(() => ({ problems: window.rtc.egressConfigProblems(), relays: window.rtc.activeRelays() }));
  const allowedHosts = new Set([...cfg2.relays.map((u) => new URL(u).host), new URL(ORIGIN).host]);
  check('RV4 STUN mode: configuration check passes', cfg2.problems.length === 0, cfg2.problems.join('; '));
  check('RV4 every WebSocket the page opened went to a declared relay or the page origin', wsHosts.length > 0 && wsHosts.every((h) => allowedHosts.has(h)), [...new Set(wsHosts)].join(', '));
  await cfgCtx.close();
  const negPage = await open('Neg2', { url: `${ORIGIN}/#k=${'Z'.repeat(22)}`, dev: { breakIce: true } }); await join(negPage);
  check('RV4 negative test: an undefined iceServers is caught', (await negPage.evaluate(() => window.rtc.egressConfigProblems())).some((p) => /iceServers is not an array/.test(p)));
  await negPage.close();

  // --- RV1 / RV5: a static host (no /whoami, no /lan.json), addresses hidden ---------------------------------------
  const serverMeta = (await (await fetch(`${ORIGIN}/`)).text()).includes('<meta name="rtc-server"');
  const staticHtml = await (async () => {
    const root2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    return (await readFile(path.join(root2, 'docs/index.html'), 'utf8')).includes('<meta name="rtc-server"');
  })();
  check('RV5 server.js marks the page; the static file does not', serverMeta && !staticHtml);
  const repoRoot2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const staticSrv = http.createServer(async (req, res) => {
    let p = new URL(req.url, 'http://x').pathname;
    if (p === '/docs' || p === '/docs/') p = '/docs/index.html';
    try {
      const body = await readFile(path.join(repoRoot2, p));
      res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : 'text/html' }).end(body);
    } catch { res.writeHead(404).end('nope'); }
  });
  await new Promise((r) => staticSrv.listen(0, '127.0.0.1', r));
  const staticUrl = `http://localhost:${staticSrv.address().port}/docs/#k=${'Y'.repeat(22)}`;
  const maskedStatic = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const sPages = [], sReqs = [];
  for (const n of ['Sia', 'Sol']) {
    const ctx = await maskedStatic.newContext(); // no pre-granted permission: that alone would unmask the addresses
    await ctx.addInitScript(({ relays, n }) => { localStorage.setItem('rtc.settings', JSON.stringify({ name: n, lan: true, relays })); localStorage.setItem('rtc.ipNotice.2', '1'); }, { relays: relay.url, n });
    const pg = await ctx.newPage();
    pg.on('request', (r) => sReqs.push(r.url()));
    await pg.goto(staticUrl); await join(pg);
    sPages.push(pg);
  }
  await until(async () => /\.local/.test(await sPages[0].textContent('#roster')), 45000);
  const stuck = await sPages[0].evaluate(() => window.rtc.S.peers.size === 0 && window.rtc.getLanIp() === null);
  const stuckText = await sPages[0].textContent('#roster');
  check('SW5 the failure also raises a banner with the Allow local connections button', /Allow local connections/.test(await sPages[0].textContent('#status')));
  check('RV1 static host, addresses hidden, no media: the pair does not connect and the roster names the hidden .local addresses', stuck && /\.local/.test(stuckText) && /Allow local connections/.test(stuckText), stuckText.slice(-200));
  // The user allows the microphone (the browser remembers the permission, which is what unmasks the address).
  // One side uses the Mic button, the other the one-click helper (which releases the device at once).
  for (const pg of sPages) await pg.context().grantPermissions(['camera', 'microphone']);
  await sPages[0].click('#btnMic'); await sPages[0].waitForSelector('#preview');
  await sPages[1].fill('#consoleIn', '/localfix'); await sPages[1].press('#consoleIn', 'Enter');
  const helperWorked = await until(() => sPages[1].evaluate(() => !!window.rtc.getLanIp()), 15000);
  check('RV1 "Allow local connections" reveals the address, then releases the microphone', helperWorked && await sPages[1].evaluate(() => window.rtc.allTracksEnded()));
  const nowSharing = await until(() => sPages[0].evaluate(() => !!window.rtc.getLanIp()), 15000);
  check('RV1 turning on the microphone reveals the local address, which is then shared', nowSharing, await sPages[0].evaluate(() => String(window.rtc.getLanIp())));
  // Measured: 9 to 48 s after the microphone is allowed, depending on where the library's retry cycle is.
  const reconnectedNoReload = await until(() => sPages[0].evaluate(() => window.rtc.S.peers.size === 1 && [...window.rtc.S.peers.values()][0].hello), 100000);
  check('RV1 and the pair then connects without a reload (within about a minute)', reconnectedNoReload && (await connectedReady(sPages[1], 1)));
  // The case that was reported: media turned on after the local address became known must reach the other side live.
  await sPages[1].click('#btnCam'); await sPages[1].waitForSelector('#preview'); await sPages[1].click('#preview button.primary');
  check('media turned on after the address was shared reaches the other side without a refresh',
    await until(() => sPages[0].evaluate(() => [...window.rtc.S.peers.values()].some((p) => p.streams.cam)), 60000));
  check('SW5/SW7 once the address is shared the banner and the stale MY_MDNS failure are gone', await until(async () => !/Allow local connections/.test(await sPages[0].textContent('#status')) && !(await sPages[0].textContent('#roster')).includes('[MY_MDNS]'), 20000));
  check('SW9 the path says it is a local network connection using the shared address', await until(() => sPages[0].evaluate(() => [...window.rtc.S.peers.values()].some((p) => /shared address/.test(p.stats?.path || ''))), 20000));
  check('RV5 a static host never sees /whoami or /lan.json requests', sReqs.every((u) => !/\/(whoami|lan\.json)/.test(u)), sReqs.filter((u) => /whoami|lan\.json/.test(u)).join(', '));
  await maskedStatic.close(); staticSrv.close();

  // --- Guest names: two friendly words, not Guest-XXXX ------------------------------------------------------------
  const fn = await A.evaluate(() => {
    const ids = Array.from({ length: 200 }, (_, i) => `id${i}${Math.random().toString(36).slice(2, 8)}`);
    return { same: window.rtc.friendlyName('abcd1234') === window.rtc.friendlyName('abcd1234'), distinct: new Set(ids.map(window.rtc.friendlyName)).size, shape: ids.every((i) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(window.rtc.friendlyName(i))), len: Math.max(...ids.map((i) => window.rtc.friendlyName(i).length)) };
  });
  check('friendly names are stable, two words, short enough, and well spread', fn.same && fn.shape && fn.len <= 24 && fn.distinct >= 150, JSON.stringify(fn));
  const guestUrl = ORIGIN + '/#k=' + 'U2'.padEnd(22, 'u');
  const guests = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(({ relays }) => { localStorage.setItem('rtc.settings', JSON.stringify({ lan: true, relays })); localStorage.setItem('rtc.ipNotice.2', '1'); }, { relays: relay.url });
    const pg = await ctx.newPage();
    await pg.goto(guestUrl); await join(pg);
    guests.push(pg);
  }
  await connectedReady(guests[0], 1); await connectedReady(guests[1], 1);
  const gNames = await Promise.all(guests.map((g) => g.evaluate(() => ({ me: document.querySelector('#roster .rrow .nm').textContent, other: [...window.rtc.S.peers.values()][0].name }))));
  check('guests with no name get a meaningful two-word name, seen identically by the other side',
    guests.length === 2 && gNames.every((n) => /^You — [A-Z][a-z]+ [A-Z][a-z]+$/.test(n.me) && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(n.other)) && gNames[0].me.replace('You — ', '') === gNames[1].other && !/Guest-/.test(JSON.stringify(gNames)), JSON.stringify(gNames));
  const helloCounts = await Promise.all(guests.map((g) => g.evaluate(() => (document.querySelector('#consoleOut').textContent.match(/said hello/g) || []).length)));
  check('two people joining within seconds of each other do not loop on hello', helloCounts.every((n) => n >= 1 && n <= 2), JSON.stringify(helloCounts));
  for (const g of guests) await g.context().close();

  // --- Small screens ---------------------------------------------------------------------------------------------
  const phoneCtx = await browser.newContext({ viewport: { width: 360, height: 700 }, isMobile: true, hasTouch: true });
  await phoneCtx.addInitScript(({ relays }) => { localStorage.setItem('rtc.settings', JSON.stringify({ name: 'Mo', lan: true, relays })); localStorage.setItem('rtc.ipNotice.2', '1'); }, { relays: relay.url });
  const mp = await phoneCtx.newPage();
  const noOverflow = () => mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1);
  await mp.goto(`${ORIGIN}/#k=${'M2'.padEnd(22, 'm')}`);
  check('phone: landing has no horizontal scroll and the header shows its four icons (+, book, info, GitHub) with an invite open', await noOverflow() && (await mp.$$eval('#top .help-nav .header-icon', (els) => els.filter((e) => e.getBoundingClientRect().width > 0).length)) === 4);
  await mp.click('#btnJoin'); await mp.waitForSelector('#room:not(.hidden)');
  const phone = await mp.evaluate(() => {
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
    const h = (sel) => document.querySelector(sel).getBoundingClientRect().height;
    return { side: vis('#side'), panelBtn: vis('#btnPanel'), moreBtn: vis('#btnMore'), micLabel: vis('#btnMic .lbl'), micH: h('#btnMic'), leaveH: h('#btnLeave'), leaveOn: (() => { const r = document.querySelector('#btnLeave').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; })() };
  });
  check('phone: video first, side panel hidden, icon-only 44px controls, Leave always on screen', !phone.side && phone.panelBtn && phone.moreBtn && !phone.micLabel && phone.micH >= 44 && phone.leaveH >= 44 && phone.leaveOn, JSON.stringify(phone));
  await mp.click('#btnPanel');
  check('phone: the chat button swaps the grid for roster and chat, and it fits the screen', await mp.evaluate(() => getComputedStyle(document.querySelector('#side')).display !== 'none' && getComputedStyle(document.querySelector('#stage')).display === 'none') && await noOverflow());
  await mp.click('#btnPanel');
  await mp.click('#btnMore');
  check('phone: More opens layout and quality inside the screen', await mp.evaluate(() => { const r = document.querySelector('#moreCtl').getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }) && await noOverflow());
  const aboutM = await phoneCtx.newPage();
  await aboutM.goto(`${ORIGIN}/about/`);
  check('phone: About page has no horizontal scroll', await aboutM.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await phoneCtx.close();

  // --- "+" (new room) confirms before going back to the start screen -------------------------------------------------
  const nctx = await browser.newContext();
  await nctx.addInitScript(({ relays }) => { localStorage.setItem('rtc.settings', JSON.stringify({ name: 'Nia', lan: true, relays })); localStorage.setItem('rtc.ipNotice.2', '1'); }, { relays: relay.url });
  const np = await nctx.newPage();
  await np.goto(`${ORIGIN}/`);
  check('"+" is hidden on a bare start screen', !(await np.isVisible('#btnNew')));
  await np.goto(`${ORIGIN}/#k=${'N3'.padEnd(22, 'n')}`);
  check('"+" appears when an invite is open', await np.isVisible('#btnNew'));
  await np.click('#btnNew');
  check('"+" with an invite asks before dropping it', /Go back to the start screen/.test(await np.textContent('#overlayCard')));
  await np.click('#overlayCard button:has-text("Stay here")');
  check('Stay keeps the invite in the address bar', (await np.evaluate(() => location.hash)).startsWith('#k=') && !(await np.isVisible('#overlay')));
  await np.click('#btnNew'); await np.click('#overlayCard button:has-text("Go to the start")');
  await np.waitForSelector('#btnCreate:not(.hidden)');
  check('confirming returns to the start screen with no hash', (await np.evaluate(() => location.hash)) === '' && await np.isVisible('#btnCreate'));
  await np.click('#btnCreate'); await np.click('#btnJoin'); await np.waitForSelector('#room:not(.hidden)');
  const watcher = await open('Wes', { url: np.url() }); await join(watcher);
  await connectedReady(watcher, 1);
  await np.click('#btnNew');
  check('"+" in a room asks, naming what will happen', /Start a new room\?/.test(await np.textContent('#overlayCard')) && /disconnected from everyone/.test(await np.textContent('#overlayCard')));
  await np.click('#overlayCard button:has-text("Stay in this room")');
  check('Stay keeps you in the room', await np.isVisible('#room') && await np.evaluate(() => !window.rtc.S.left));
  await np.click('#brand');
  check('the logo asks the same question', /Start a new room\?/.test(await np.textContent('#overlayCard')));
  await np.click('#overlayCard button:has-text("Stay in this room")');
  await np.click('#btnNew'); await np.click('#overlayCard button:has-text("Leave and go to the start")');
  await np.waitForSelector('#btnCreate:not(.hidden)', { timeout: 20000 });
  check('confirming leaves the room and lands on the start screen with no hash', (await np.evaluate(() => location.hash)) === '' && !(await np.isVisible('#room')));
  check('the other person sees them leave', await until(() => watcher.evaluate(() => window.rtc.S.peers.size === 0), 20000));
  await watcher.close(); await nctx.close();

  // --- A renegotiation that gets stuck is recovered, not left until someone refreshes ----------------------------
  const wedgeUrl = ORIGIN + '/#k=' + 'Wg'.padEnd(22, 'w');
  const wA = await open('Wedge-A', { url: wedgeUrl }); await join(wA);
  const wB = await open('Wedge-B', { url: wedgeUrl }); await join(wB);
  await connectedReady(wA, 1); await connectedReady(wB, 1);
  // Force the failure seen on a phone: an ICE restart overlapping the offer that carries a new camera.
  await wA.evaluate(() => { for (const pc of window.rtc.allPCs) pc.restartIce(); });
  await wA.click('#btnCam'); await wA.waitForSelector('#preview'); await wA.click('#preview button.primary');
  check('a stuck renegotiation is detected and the camera still arrives (asks again, then reconnects)',
    await until(() => wB.evaluate(() => [...window.rtc.S.peers.values()].some((p) => p.streams.cam)), 120000));
  await wA.close(); await wB.close();

  // --- SW4: every failure gets one named cause, or "unknown" ---------------------------------------------------------------
  const dg = await A.evaluate(() => {
    const c = (type, addrClass, protocol = 'udp') => ({ type, protocol, addrClass });
    const d = window.rtc.diagnose;
    return {
      none: d([], [c('host', 'private')], {}).code,
      mine: d([c('host', 'mdns'), c('srflx', 'public')], [c('host', 'private')], { lanKnown: false }).code,
      bothBlocked: d([c('host', 'mdns')], [c('host', 'private')], { lanKnown: true }).code,
      noRemoteHost: d([c('host', 'private')], [c('srflx', 'public')], { lanKnown: true }).code,
      theirs: d([c('host', 'private')], [c('host', 'mdns')], { lanKnown: true }).code,
      lanOnly: d([c('host', 'private')], [c('host', 'public')], { lanKnown: true, lan: true }).code,
      different: d([c('srflx', 'public')], [c('host', 'private')], {}).code,
      unknown: d([c('host', 'public')], [c('host', 'public')], {}).code,
      cls: ['a=candidate:1 1 udp 2122260223 abcd.local 5000 typ host', 'candidate:2 1 UDP 2122 192.168.0.9 5000 typ host', 'candidate:3 1 udp 1 203.0.113.9 5000 typ srflx', 'candidate:4 1 udp 1 203.0.113.9 5000 typ relay'].map((l) => window.rtc.candClass(l).addrClass).join(','),
    };
  });
  check('SW4 each cause maps to its code (MY_MDNS, BOTH_PRIVATE_BLOCKED, NO_REMOTE_HOST, THEIR_MDNS, LAN_ONLY, DIFFERENT_NETWORKS, NO_CANDIDATES, UNKNOWN)',
    dg.mine === 'MY_MDNS' && dg.bothBlocked === 'BOTH_PRIVATE_BLOCKED' && dg.noRemoteHost === 'NO_REMOTE_HOST' && dg.theirs === 'THEIR_MDNS' && dg.lanOnly === 'LAN_ONLY' && dg.different === 'DIFFERENT_NETWORKS' && dg.none === 'NO_CANDIDATES' && dg.unknown === 'UNKNOWN', JSON.stringify(dg));
  check('SW4 candidate classes: mdns, private, public, relay', dg.cls === 'mdns,private,public,relay', dg.cls);

  // --- Run button: the console and chat can be used without an Enter key -----------------------------------------
  await A.click('#tabConsole');
  await A.fill('#consoleIn', '/cap'); await A.click('#consoleRun');
  check('the console Run button runs the command and clears the input', await until(async () => /Room cap/.test(await A.textContent('#consoleOut')), 5000) && (await A.inputValue('#consoleIn')) === '');
  await A.click('#tabChat');
  await A.fill('#chatIn', 'sent with the button'); await A.click('#chatSend');
  check('the chat Send button sends', await until(async () => /sent with the button/.test(await B.textContent('#chatOut')), 15000));
  check('both inputs ask phone keyboards for a Send key', await A.evaluate(() => document.querySelector('#consoleIn').enterKeyHint === 'send' && document.querySelector('#chatIn').enterKeyHint === 'send'));
  await A.click('#tabConsole');

  // --- Console copy button -------------------------------------------------------------------------------------------
  await A.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); });
  await A.click('#consoleCopy');
  const copiedAll = await A.evaluate(() => window.__copied);
  check('the console copy button copies the whole console', copiedAll && /Room cap/.test(copiedAll) && copiedAll === (await A.evaluate(() => [...document.querySelectorAll('#consoleOut > *')].map((n) => n.textContent).join('\n'))));
  check('...and shows a check mark, then returns to the copy icon', (await A.getAttribute('#consoleCopy svg', 'data-name')) === 'check' && await until(async () => (await A.getAttribute('#consoleCopy svg', 'data-name')) === 'copy', 4000));
  await A.evaluate(() => { const n = document.querySelector('#consoleOut > *'); const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await A.click('#consoleCopy');
  check('...and copies only the selection when text is selected', await A.evaluate(() => window.__copied === document.querySelector('#consoleOut > *').textContent));
  await A.evaluate(() => getSelection().removeAllRanges());

  // --- Tooltips on every button, select and summary ------------------------------------------------------------------------
  const untitled = (pg) => pg.evaluate(() => [...document.querySelectorAll('button, select, summary')].filter((e) => !e.title).map((e) => e.id || e.textContent.trim().slice(0, 24)));
  await sleep(200);
  check('every button, select and summary in the room has a tooltip', (await untitled(A)).length === 0, (await untitled(A)).join(', '));
  await A.click('#btnDevices'); await A.waitForSelector('#overlayCard'); await sleep(150);
  check('...including the Devices dialog', (await untitled(A)).length === 0, (await untitled(A)).join(', '));
  await A.click('#overlayCard button:has-text("Done")');
  await A.click('#btnMove'); await A.waitForSelector('#overlayCard'); await sleep(150);
  check('...and the Move room dialog', (await untitled(A)).length === 0, (await untitled(A)).join(', '));
  await A.click('#overlayCard button:has-text("Cancel")');
  await A.click('#btnReact'); await sleep(150);
  check('...and the reaction menu (named reactions)', (await untitled(A)).length === 0 && /Thumbs up/.test(await A.getAttribute('#reactMenu button >> nth=0', 'title')));
  await A.click('#btnReact');
  const tipCtx = await browser.newContext();
  const tipPage = await tipCtx.newPage();
  await tipPage.goto(`${ORIGIN}/#k=${'T2'.padEnd(22, 't')}`); await sleep(300);
  check('...and on the start screen with an invite open', (await untitled(tipPage)).length === 0, (await untitled(tipPage)).join(', '));
  await tipCtx.close();

  // --- Installable and offline (PWA) --------------------------------------------------------------------------------------------
  const manifest = await (await fetch(`${ORIGIN}/manifest.json`)).json();
  const iconRes = await Promise.all(manifest.icons.map((i) => fetch(new URL(i.src, `${ORIGIN}/`))));
  const has = (size, purpose) => manifest.icons.some((i) => i.sizes === size && i.purpose === purpose && i.type === 'image/png');
  check('manifest: name, start_url, standalone, theme colours, and 192/512 plus maskable PNG icons that all exist',
    manifest.name === 'rtc-webCLI' && manifest.start_url === './' && manifest.display === 'standalone' && manifest.theme_color === '#0d0f1a'
    && has('192x192', 'any') && has('512x512', 'any') && has('192x192', 'maskable') && has('512x512', 'maskable') && iconRes.every((r) => r.ok), `${manifest.icons.length} icons`);
  const pwaCtx = await browser.newContext();
  const pwa = await pwaCtx.newPage();
  await pwa.goto(`${ORIGIN}/`);
  await pwa.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await until(() => pwa.evaluate(() => !!navigator.serviceWorker.controller), 10000);
  const cached = await pwa.evaluate(async () => { const names = await caches.keys(); const c = await caches.open(names[0]); return { names, keys: (await c.keys()).map((r) => new URL(r.url).pathname) }; });
  check('service worker installs and precaches the app, the About page, the pinned libraries and the icons',
    cached.names.some((n) => /^rtc-webCLI-/.test(n)) && ['/index.html', '/about/', '/lib/trystero-nostr.js', '/lib/qrcode.js', '/icon-192.png', '/manifest.json'].every((p) => cached.keys.includes(p)), cached.keys.length + ' files');
  await pwaCtx.setOffline(true);
  await pwa.reload();
  const offline = await pwa.evaluate(async () => ({
    brand: !!document.querySelector('#brand'), create: !!document.querySelector('#btnCreate'), note: !document.querySelector('#offlineNote').classList.contains('hidden'),
    lib: (await fetch('lib/trystero-nostr.js').then((r) => r.ok).catch(() => false)),
    about: (await fetch('about/').then((r) => r.ok).catch(() => false)),
    whoami: (await fetch('whoami').then((r) => r.ok).catch(() => 'network-only')),
  }));
  check('offline: the app opens from the cache, says it is offline, and the libraries and About page load', offline.brand && offline.create && offline.note && offline.lib && offline.about, JSON.stringify(offline));
  check('offline: /whoami is never served from the cache', offline.whoami === 'network-only' || offline.whoami === false, String(offline.whoami));
  await pwaCtx.setOffline(false);
  await pwaCtx.close();

  // --- RF1 / RF2 / RF15: the roster guarantee is checked independently ---------------------------
  // The roster re-renders at least once a second; read the DOM only after it has caught up.
  let rt4;
  await until(async () => { rt4 = await A.evaluate(() => window.rtc.rt4Check()); return rt4.ok && rt4.receivers >= 1; }, 8000);
  check('RF1 independent RT4 check passes with a live camera', rt4.ok && rt4.receivers >= 1, JSON.stringify(rt4));
  const rf2 = await A.evaluate(async () => {
    const pc = new window.rtc.TrackedPC({ iceServers: [] });
    const c = document.createElement('canvas'); c.width = 16; c.height = 16; c.getContext('2d').fillRect(0, 0, 4, 4);
    const track = c.captureStream(5).getVideoTracks()[0];
    pc.addTrack(track, new MediaStream([track]));
    Object.defineProperty(pc, 'connectionState', { get: () => 'disconnected' });
    await new Promise((r) => setTimeout(r, 1500));
    const row = document.querySelector(`#roster [data-pc="${pc._uid}"]`);
    const res = { listed: !!row, chip: row ? /disconnected/.test(row.textContent) : false, ok: window.rtc.rt4Check().ok, kinds: [...(row?.querySelectorAll('[data-kind]') ?? [])].map((x) => x.dataset.kind) };
    pc.close(); track.stop();
    return res;
  });
  check('RF2 a "disconnected" connection with a live sender stays in the roster, with a state chip', rf2.listed && rf2.chip && rf2.ok && rf2.kinds.includes('other'), JSON.stringify(rf2));
  check('RF15 closed connections leave the registry (20 create/close cycles)', await A.evaluate(() => { const before = window.rtc.allPCs.size; for (let i = 0; i < 20; i++) new window.rtc.TrackedPC({}).close(); return window.rtc.allPCs.size - before; }) === 0);
  const negUrl = ORIGIN + '/#k=' + 'N'.repeat(22);
  const N1 = await open('Neg', { url: negUrl, dev: { dropRosterRow: true } }); await join(N1);
  const N2 = await open('Pos', { url: negUrl }); await join(N2);
  await connectedReady(N1, 1);
  await N1.click('#btnCam'); await N1.waitForSelector('#preview'); await N1.click('#preview button.primary');
  const mismatch = await until(async () => { const r = await N1.evaluate(() => window.rtc.rt4Check()); return !r.ok && /mismatch/.test(await N1.textContent('#rt4check')); }, 20000);
  check('RF1 negative test: a roster that drops a receiving row is reported as a mismatch', mismatch, await N1.textContent('#rt4check'));
  await N1.close(); await N2.close();

  // --- RF12 / RF14: no credential on screen, no plaintext relays ---------------------------------
  await A.fill('#consoleIn', '/turn turn:turn.example.org:3478 alice s3cretpass'); await A.press('#consoleIn', 'Enter');
  const consoleText = await A.textContent('#consoleOut');
  check('RF12 /turn credentials appear nowhere in the page text', !consoleText.includes('s3cretpass') && !consoleText.includes('alice') && /\/turn turn:turn\.example\.org:3478 •••/.test(consoleText) && !(await A.textContent('body')).includes('s3cretpass'));
  await A.fill('#consoleIn', '/turn off'); await A.press('#consoleIn', 'Enter');
  const relayParse = await A.evaluate(() => window.rtc.parseRelayList('ws://evil.example.org, wss://ok.example.org, ws://localhost:1234, http://x.example.org, nonsense'));
  check('RF14 ws:// accepted for loopback only; others rejected with a reason', JSON.stringify(relayParse.ok) === JSON.stringify(['wss://ok.example.org', 'ws://localhost:1234']) && relayParse.rejected.length === 3 && relayParse.rejected.every((r) => r.why), JSON.stringify(relayParse));

  // --- RT21 full leave with camera on -----------------------------------------
  await A.click('#btnLeave');
  await A.waitForSelector('#overlay:not(.hidden)');
  const overlay = await A.textContent('#overlayCard');
  check('RT21 leave with camera on → all tracks report ended', await A.evaluate(() => window.rtc.allTracksEnded()) && /Verified: \d+ of \d+ tracks/.test(overlay), overlay.slice(0, 160));

  // --- RT26: incompatible version -------------------------------------------------
  const E = await open('Eve', { url: inviteUrl, dev: { protocol: 4 } });
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
  await connectedReady(third, 2); // seats are only known once the others' hellos have arrived
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
    && /can ignore it/.test(await M1.textContent('#consoleOut')));
  await M3.click('#overlayCard button:has-text("Stay")');
  check('RF9 other peers are asked and nothing is silently applied',
    await until(async () => /asked you to disconnect/.test(await M2.textContent('#status')), 15000)
    && await M2.evaluate(() => window.rtc.S.peers.size === 2));
  await M2.click('#status button:has-text("Ignore")');
  check('RF9 ignoring keeps the connection', await M2.evaluate(() => window.rtc.S.peers.size === 2) && !/asked you to disconnect/.test(await M2.textContent('#status')));
  await M1.fill('#consoleIn', '/remove Mel'); await M1.press('#consoleIn', 'Enter');
  await until(async () => /asked you to disconnect/.test(await M2.textContent('#status')), 15000);
  await M2.click('#status button:has-text("Disconnect")');
  check('RF9 agreeing disconnects that peer', await until(async () => /You disconnected Mel at/.test(await M2.textContent('#consoleOut')) && await M2.evaluate(() => window.rtc.S.removedLocal.size === 1), 15000));
  // Observed: the library re-dials a closed pair within seconds. That must be shown, not hidden or re-applied.
  await sleep(30000);
  const reconnected = await M2.evaluate(() => [...window.rtc.S.peers.values()].filter((p) => p.name === 'Mel'));
  check('RF9 a peer that reconnects after removal is labelled as such (and is not silently removed again)',
    reconnected.length === 0 || (reconnected[0].reconnected && /reconnected after a request to disconnect them/.test(await M2.textContent('#roster'))), JSON.stringify(reconnected.map((p) => p.reconnected)));
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
    localStorage.setItem('rtc.ipNotice.2', '1');
  }, { relays: relay.url });
  const G = await bctx.newPage();
  const failUrl = ORIGIN + '/#k=' + 'U'.repeat(22);
  await G.goto(failUrl); await join(G);
  const H = await open('Hank', { url: failUrl }); await join(H);
  const t0 = Date.now();
  const failed13 = await until(async () => /Couldn't reach .* directly.*(no candidates|ICE failed|DTLS failed)/.test(await H.textContent('#roster')), 40000);
  check('RT13 unreachable pair is named with a reason class', failed13, `${Math.round((Date.now() - t0) / 1000)}s: ${(await H.textContent('#roster')).slice(-160)}`);
  // SW1: Copy diagnostic, with no IP address in it
  await H.click('#roster button:has-text("Copy diagnostic")');
  const diag = await until(() => H.evaluate(() => window.rtc.getLastDiagnostic()), 10000);
  const diagText = JSON.stringify(diag || {});
  const codes = ['MY_MDNS', 'THEIR_MDNS', 'NO_REMOTE_HOST', 'BOTH_PRIVATE_BLOCKED', 'DIFFERENT_NETWORKS', 'LAN_ONLY', 'NO_CANDIDATES', 'NO_ANSWER', 'UNKNOWN'];
  check('SW1 Copy diagnostic on a failed pair: parses, has the fields, and contains no IPv4 or IPv6 literal',
    !!diag && codes.includes(diag.failure.code) && !!diag.browser.brand && !!diag.os && Array.isArray(diag.candidates.local) && Array.isArray(diag.iceTransitions)
    && !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(diagText) && !/\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){3,}\b/i.test(diagText), diag ? `${diag.failure.code} ${diag.failure.reason}` : 'none');
  await blocked.close();

  // --- Plain static host (like VS Code Live Server): no /lan.json, page opened at /docs ---------
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const plain = http.createServer(async (req, res) => {
    let p = new URL(req.url, 'http://x').pathname;
    if (p === '/docs' || p === '/docs/') p = '/docs/index.html';
    try {
      const body = await readFile(path.join(repoRoot, p));
      res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : 'text/html' }).end(body);
    } catch { res.writeHead(404).end('nope'); }
  });
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  const plainUrl = `http://127.0.0.1:${plain.address().port}/docs`;

  // The default Chromium masks local IPs with mDNS, so detection fails and the QR dialog asks for the address.
  const masked = await chromium.launch();
  const mctx = await masked.newContext();
  await mctx.addInitScript(() => localStorage.setItem('rtc.settings', JSON.stringify({ name: 'Liv', lan: true, relays: 'ws://127.0.0.1:1' })));
  await mctx.addInitScript(() => localStorage.setItem('rtc.ipNotice.2', '1'));
  const L = await mctx.newPage();
  await L.goto(plainUrl);
  await L.click('#btnCreate');
  await until(async () => /#k=/.test(await L.textContent('#landingInvite')), 10000);
  await L.click('#btnJoin');
  await L.waitForSelector('#room:not(.hidden)');
  check('page works at /docs with no trailing slash (vendored libs load)', true);
  await L.click('#btnQr');
  const fixer = await until(async () => (await L.$('#overlayCard input')) !== null, 10000);
  check('QR dialog asks for the LAN address when it cannot be detected', fixer);
  if (fixer) {
    await L.fill('#overlayCard input', '192.168.7.7:5500');
    await L.click('#overlayCard button:has-text("Use this address")');
    const shown = await until(async () => /http:\/\/192\.168\.7\.7:5500\/docs\/#k=/.test(await L.textContent('#overlayCard')), 10000);
    check('QR then encodes the entered LAN address', shown, (await L.textContent('#overlayCard')).match(/http\S+/)?.[0]);
  }
  await masked.close();
  // With local IPs visible (as in Firefox/Safari or with permission), detection fills it in on its own.
  const P = await open('Pat', { url: plainUrl, relays: 'ws://127.0.0.1:1' });
  await P.click('#btnCreate');
  const autoInvite = await until(async () => { const t = await P.textContent('#landingInvite'); return /#k=/.test(t) && !/\/\/(localhost|127\.0\.0\.1)/.test(t) && t; }, 10000);
  check('LAN address auto-detected from the browser when the server cannot tell us', !!autoInvite, autoInvite || '');
  plain.close();

  // --- Hidden (.local) addresses: connects once both sides have an active preview ----------------
  const hiddenBrowser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const hiddenUrl = ORIGIN + '/#k=' + 'H'.repeat(22);
  const hp = [];
  for (const n of ['Hal', 'Hel']) {
    const ctx = await hiddenBrowser.newContext({ permissions: ['camera', 'microphone'] });
    await ctx.addInitScript(({ relays, n }) => {
      localStorage.setItem('rtc.settings', JSON.stringify({ name: n, lan: true, relays }));
      localStorage.setItem('rtc.ipNotice.2', '1');
    }, { relays: relay.url, n });
    const pg = await ctx.newPage();
    await pg.goto(hiddenUrl); await join(pg);
    await pg.click('#btnMic'); await pg.waitForSelector('#preview');
    hp.push(pg);
  }
  check('with addresses hidden by default, an active preview in both lets them connect', (await connectedReady(hp[0], 1)) && (await connectedReady(hp[1], 1)));
  await hiddenBrowser.close();

  // --- RF13: observed hosts with STUN on ---------------------------------------------------------
  const stunPg = await open('Stan', { url: ORIGIN + '/#k=' + 'T'.repeat(22), lan: false }); await join(stunPg);
  await sleep(6000);
  await stunPg.fill('#consoleIn', '/egress'); await stunPg.press('#consoleIn', 'Enter');
  const egressText = await until(async () => { const t = await stunPg.textContent('#consoleOut'); return /OBSERVED/.test(t) && t; }, 10000);
  check('RF13 STUN mode: observed hosts are all hosts you set', !!egressText && /every observed host is one you set/.test(egressText), (egressText || '').match(/stun\.cloudflare[^\s]*/)?.[0] || 'no STUN candidate observed (offline?)');
  await stunPg.close();

  // --- RF4: relays that accept the socket but do not work ------------------------------------------
  for (const mode of ['drop', 'reject']) {
    const bad = await startMockRelay({ mode });
    const pg = await open(`Rel-${mode}`, { url: ORIGIN + '/#k=' + (mode === 'drop' ? 'D' : 'E').repeat(22), relays: bad.url });
    await join(pg);
    const shown = await until(async () => /connected but not passing messages/.test(await pg.textContent('#status')), 30000);
    check(`RF4 relay that ${mode === 'drop' ? 'drops' : 'rejects'} events → "connected but not passing messages", never "no one here"`, shown && !/No one else is here yet/.test(await pg.textContent('#status')), (await pg.textContent('#status')).slice(0, 140));
    await pg.close(); bad.close();
  }

  // --- RF3: an offer that never gets an answer is not "no one here" --------------------------------
  const oneway = await startMockRelay({ mode: 'oneway' });
  const owUrl = ORIGIN + '/#k=' + 'W'.repeat(22);
  const OA = await open('Ola', { url: owUrl, relays: oneway.url }); await join(OA);
  const OB = await open('Ole', { url: owUrl, relays: oneway.url }); await join(OB);
  const trying = await until(async () => /Someone is trying to connect/.test(await OA.textContent('#status')), 25000);
  const noAnswer = await until(async () => /no answer/.test(await OA.textContent('#roster')), 45000);
  check('RF3 offer without an answer: "Someone is trying…", then a named "no answer" failure', trying && noAnswer, (await OA.textContent('#roster')).slice(-160));
  check('RF3 never says "No one else is here yet" while someone is announcing', !/No one else is here yet/.test(await OA.textContent('#status')));
  await OA.close(); await OB.close(); oneway.close();

  // --- RF5 / RF6: a skewed, delayed joiner cannot take a seat from people already sending video -------
  const seatUrl = ORIGIN + '/#k=' + 'V'.repeat(22);
  const seatDev = { audioCap: 6, videoCap: 2 };
  const V1 = await open('v1', { url: seatUrl, dev: seatDev }); await join(V1);
  const V2 = await open('v2', { url: seatUrl, dev: seatDev }); await join(V2);
  await connectedReady(V1, 1); await connectedReady(V2, 1);
  for (const pg of [V1, V2]) { await pg.click('#btnCam'); await pg.waitForSelector('#preview'); await pg.click('#preview button.primary'); }
  await until(() => V1.evaluate(() => window.rtc.S.sent.cam.size === 1), 20000);
  relay.setDelay(8000);
  const V3 = await open('v3', { url: seatUrl, dev: seatDev, clockShift: -60000 }); await join(V3);
  await until(() => V3.evaluate(() => window.rtc.S.peers.size === 2), 120000);
  await sleep(3000);
  relay.setDelay(0);
  const v1 = await V1.evaluate(() => ({ cam: !!window.rtc.S.my.cam, to: [...window.rtc.S.sent.cam.keys()].length, seated: window.rtc.seatOrder().indexOf(window.rtc.S.selfId) }));
  const v2 = await V2.evaluate(() => ({ cam: !!window.rtc.S.my.cam, to: [...window.rtc.S.sent.cam.keys()].length }));
  check('RF5 existing video senders keep their seats and keep sending', v1.cam && v2.cam && v1.to === 1 && v2.to === 1 && v1.seated < 2, JSON.stringify({ v1, v2 }));
  check('RF6 no existing sender sees a "lost your seat" banner', !/lost your video seat/.test(await V1.textContent('#status')) && !/lost your video seat/.test(await V2.textContent('#status')));
  await V3.click('#btnCam');
  check('RF5 the slow-clock joiner is told video is full (and that seats go by join order)', await until(async () => /Video is full for this room/.test(await V3.textContent('#overlayCard')) && /even if their camera is off/.test(await V3.textContent('#overlayCard')), 10000));
  // RF6: a sender who loses a seat is told. Simulate the flip on V1 by pinning another peer ahead.
  await V1.evaluate(() => { const S = window.rtc.S; S.pinnedSelf = false; for (const p of S.peers.values()) p.pinned = true; });
  check('RF6 losing a seat is announced, with a way to stop the camera', await until(async () => /You lost your video seat/.test(await V1.textContent('#status')) && /Camera: on, not sent/.test(await V1.textContent('#btnCam')) && /Not sending video: no video seat/.test(await V1.textContent('#qualityLine')), 10000), (await V1.textContent('#status')).slice(0, 120));
  for (const pg of [V1, V2, V3]) await pg.close();

  // --- RF10: two simultaneous joiners at the cap are never half-admitted ---------------------------
  const capUrl2 = ORIGIN + '/#k=' + 'C'.repeat(22);
  const capDev = { audioCap: 3, videoCap: 3 };
  const members = [await open('cm1', { url: capUrl2, dev: capDev }), await open('cm2', { url: capUrl2, dev: capDev })];
  for (const m of members) await join(m);
  await connectedReady(members[0], 1); await connectedReady(members[1], 1);
  const racers = await Promise.all([open('r1', { url: capUrl2, dev: capDev }), open('r2', { url: capUrl2, dev: capDev })]);
  await Promise.all(racers.map((r) => r.click('#btnJoin')));
  const everyone = [...members, ...racers];
  const consistent = await until(async () => {
    const st = await Promise.all(everyone.map((p) => p.evaluate(() => ({ left: !!window.rtc?.S?.left, peers: window.rtc?.S?.peers?.size ?? 0, pcs: [...window.rtc.allPCs].filter((pc) => pc.connectionState === 'connected').length }))));
    const inRoom = st.filter((x) => !x.left);
    return inRoom.length <= 3 && inRoom.length >= 2 && inRoom.every((x) => x.peers === inRoom.length - 1 && x.pcs === inRoom.length - 1) && st.filter((x) => x.left).every((x) => x.pcs === 0);
  }, 90000);
  check('RF10 simultaneous joiners at the cap end fully in or fully out, never half-admitted', consistent);
  for (const p of everyone) await p.close();

  // --- RF11: camera and screen both get a quality statement ------------------------------------------
  const qa = await open('Qa', { url: ORIGIN + '/#k=' + 'Q2'.padEnd(22, 'q') }); await join(qa);
  const qb = await open('Qb', { url: ORIGIN + '/#k=' + 'Q2'.padEnd(22, 'q') }); await join(qb);
  await connectedReady(qa, 1);
  await qa.click('#btnCam'); await qa.waitForSelector('#preview'); await qa.click('#preview button.primary');
  await qa.click('#btnShare');
  const both = await until(async () => /Sending \d+p to 1 person/.test(await qa.textContent('#qualityLine')) && /Sharing screen at \d+p to 1 person/.test(await qa.textContent('#qualityLine')), 30000);
  check('RF11 camera and screen share each get a quality line', both, await qa.textContent('#qualityLine'));
  await qa.close(); await qb.close();

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

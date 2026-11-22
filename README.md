# rtc webCLI

[![GitHub stars](https://img.shields.io/github/stars/tejaswigowda/rtc-webCLI?style=social)](https://github.com/tejaswigowda/rtc-webCLI/stargazers)

A browser-based room for audio, video and screen share, opened with an invite link. **Link in, live call out.** <b><ins>No accounts, and no media server of ours. Audio, video and screen go directly between participants</ins></b>, encrypted, using WebRTC and [Trystero](https://github.com/dmotz/trystero) for introductions.

▶ **Live app:** https://tejaswigowda.com/rtc-webCLI/

> Part of the **webCLI** family of browser tools. Same look and feel, same discipline about what leaves your device, with one difference stated up front: **a call has to send**. Your media goes to the other people in the room, and the introduction relays and a STUN server are contacted to set that up. Every host is listed in the [egress table](#privacy--egress), and nothing is claimed beyond it.

**Status: v0.1.0, not yet validated on real devices.** Checks that code can make are automated (`npm test`). Measurement and device-matrix gates are open, and listed under [Tests and Gates](#tests-and-gates) rather than hidden.

---

## Paper

This tool follows the **Web-CLI** architecture, described in:

> **The Web-CLI: Verifiable Privacy for Tools, Models, and Inference Engines in the Browser**
> Tejaswi Gowda, Arizona State University.
> arXiv: https://arxiv.org/abs/2608.28950

The paper defines the four properties (fidelity, progressive disclosure, offline-first, zero egress). This tool cannot be zero-egress, because a call has to send. It keeps the part that still applies: every request is declared and checkable in DevTools, and the exceptions are named instead of implied.

---

## At a Glance

| | |
|---|---|
| **in** | an invite link (or create a room), plus your camera, microphone or screen if you choose to share them |
| **out** | a live peer-to-peer call; no file or artifact |
| **not** | a hosted meeting service. No server relays media, so there is no host, no recording, no waiting room and no large rooms |
| **egress** | your media: only to the people in the room. Setup: the introduction relays and STUN server listed below |
| **fetches** | code: none from a CDN (self-hosted, hash-pinned); relays and STUN per the egress table |
| **repro** | not applicable |

There is no `run=` agent surface and no `window.__webcli_result` yet.

---

## Key Features

- **Invite-Link Rooms**: `https://<origin>/#k=<128-bit secret>`. The secret lives after the `#`, which browsers never send to a server. A new room is a new secret; there is no other room identity

- **Audio, Video and Screen Share**: one WebRTC connection per other person (a mesh), encrypted with DTLS-SRTP. No account

- **Media-Off Join**: camera and microphone stay off until you turn them on, and each starts with a local preview that nobody can see until you press Send

- **A Roster You Can Trust**: every connection that can receive your media is listed, with what it receives (video, audio, screen). The roster is checked against the real connections on every render, and the top bar shows the result

- **Loud Failures**: if a pair of people cannot connect within 15 seconds, the roster names it and the reason class (no candidates, ICE failed, DTLS failed). No endless spinner

- **Empty vs. Broken**: "No one else is here yet" and "Can't reach the introduction servers" are different messages, so nobody waits forever on a dead relay

- **Hard Caps With Refusal**: a room has a person limit and a video limit. The person who would exceed it gets a screen naming the cap and the reason. The caps are provisional and **not yet measured**

- **Honest Quality**: when your uplink is short, the page lowers your send resolution and says so ("Sending 360p to 4 people")

- **Honest Removal**: "Ask everyone to disconnect X" is a request that peers may ignore. **Move room** (new secret, chosen people re-invited over the encrypted connection) is the only real removal

- **Visible Network Settings**: STUN is named and can be turned off ("LAN only"). TURN is never built in; you can add your own, and the path then shows **relay** and names the host

- **Console With GUI Parity**: `/peers`, `/path`, `/stats <peer>` (raw `getStats()`), `/cap`, `/mic`, `/mute`, `/cam`, `/share`, `/send`, `/cancel`, `/res`, `/remove`, `/move`, `/invite`, `/qr`, `/lan`, `/turn`, `/relays`, `/egress`, `/about`, `/leave`. Each is a button or setting in the GUI, and the other way round

- **Verified Library**: Trystero and the QR generator are vendored in `docs/lib/`. The page checks each file's SHA-256 against the value pinned in `docs/index.html` and refuses to run on a mismatch

- **Version Check**: a peer on a different protocol version is shown as "X is on an incompatible version"; it is never a silent failure to connect

---

## When to Use This

| Scenario | Why this instead of a hosted meeting service? |
|---|---|
| **A quick call with a few people** | Make a room, send the link. No account, nothing to install |
| **You want your media off someone else's servers** | Audio, video and screen go between the participants. No media server of ours exists |
| **A workshop or session on a known network** | LAN-only mode skips even the STUN server |

**The tradeoff:** every person uploads their video once per other person, so rooms stay small, and anything larger needs a server that relays media, which this tool deliberately has none of. There is no host who can lock or remove anyone: anyone with the link is a peer. Rooms exist only while someone is in them.

**The privacy difference, and its limits:** media does not pass through a server of ours. But people in the room see each other's IP addresses, the introduction relays see them too, and the relays are third parties. This is disclosed before you first join.

---

## Usage

### ▤ 1 · Create or Open a Room
**Create a room**, or open an invite link. Pick a display name. Names are self-asserted and shown as unverified.

### ⚙ 2 · Network Settings (optional)
Under **Network settings**: LAN only (no STUN), the STUN server, your own TURN server, and a custom relay list.

### ▶ 3 · Join
The first time, you are told that others in the room can see your IP address. You join with camera and microphone off.

### ◉ 4 · Turn Things On
**Camera** and **Mic** open a local preview. Press **Send to the room** to publish, or **Cancel** to release the device. **Share screen** uses the browser's own picker. Screen audio is offered only where the browser supports it.

### ✎ 5 · Watch the Roster
The roster shows each person, how you are connected (direct or relay), what they receive from you, and what they send you. Failures to connect appear there too.

### ↗ 6 · Invite, Move or Leave
**Copy invite** and **QR** produce the same link. **Move room** invites the people you tick into a new room. **Leave** stops every track and confirms each one ended.

---

## Rooms, Caps and Seats

- **Total cap:** a joiner past the cap is refused with an explanation. Provisional: 8.
- **Video cap:** the first participants by join time get video seats; the rest are audio-only and are told why. Provisional: 4.
- Both numbers are safety stops, **not measured capabilities**. The measurement table is below and is empty until it has been run.
- Video seats are decided by join time. Clock skew can misorder a joiner, so each joiner lifts its own time above anyone it meets in its first seconds. Two people joining at the same instant can briefly disagree.

---

## How It Works

1. **Derive the room.** From the 16-byte secret: the relay topic is `SHA-256("rtc-webCLI/v1/topic" ‖ secret)`, and the SDP encryption password is `HKDF-SHA-256(secret, info = "rtc-webCLI/v1/sdp")`.
2. **Introduce.** Trystero publishes encrypted offers and answers over Nostr relays. Relays see the topic hash and ciphertext, not the secret.
3. **Connect.** Each pair of people opens a WebRTC connection. Media is encrypted by the browser (DTLS-SRTP).
4. **Handshake.** Peers exchange `hello` (protocol, version, name, join time) and `state` (what each is sending) over the data channel.
5. **Send only what was published.** Nothing is attached to a connection until you press Send. A peer on another protocol version, or without a video seat, gets no video.
6. **Track every connection.** Every `RTCPeerConnection` the library creates is registered, so the roster, failures and path labels come from the real connections instead of the library's own view.

---

## Privacy & Egress

The family's tools mostly send nothing. **This one has to.** The principle here is the one in the paper's wider form: nothing leaves except what the call needs, and every destination is declared.

Every host the page contacts (`/egress` prints the live version for your settings):

| Purpose | Host | Notes |
|---|---|---|
| Page and `lib/` | the origin you loaded the page from | |
| Introduction relay | `no.str.cr` | Nostr, `wss://` |
| Introduction relay | `relay.wavlake.com` | Nostr, `wss://` |
| Introduction relay | `nostr.hifish.org` | Nostr, `wss://` |
| Introduction relay | `relay.notoshi.win` | Nostr, `wss://` |
| Introduction relay | `relay.dwadziesciajeden.pl` | Nostr, `wss://` |
| STUN | `stun.cloudflare.com:3478` | Default on. Off with **LAN only** (`/lan on`) |
| TURN | none | Never built in. Only a server you configure; then the path shows **relay** and the UI names the host |
| Peers | each connected peer, directly | Peer-to-peer media, not a service |

The five relays are the first five of Trystero 0.27.0's default list for this app id, pinned in `docs/index.html` so a library update cannot silently change them. A custom relay list in the network settings replaces them; the table then differs by exactly that list.

**What each party can see**
- **Other participants:** your media (what you chose to send), your IP address, your self-asserted name.
- **Introduction relays:** your IP address, a hash of the room topic and encrypted connection data. Not the secret, not your media.
- **The STUN server:** your IP address, unless LAN only is on.
- **The page host:** that you loaded the page. Never the secret, which is in the URL fragment.

**Verification in DevTools**
1. Open DevTools (F12) → Network.
2. Create a room and join. Requests: GETs to the page origin for `index.html`, `lib/` and `lan.json` (local server only). WebSocket connections to the relays listed above.
3. Open `chrome://webrtc-internals` to see the STUN server and the chosen path for each peer.
4. Search the Network log for your secret (the characters after `#k=`). It appears in no request URL, header or body.

`npm test` checks the same things against a mock relay: the secret appears in zero relay frames and zero page requests, relay frames carry no plaintext SDP (`a=fingerprint`, `a=candidate`, `m=`), and nothing loads from outside the origin.

**Data storage:** your display name and network settings are kept in `localStorage`. Nothing about a room is stored. A TURN credential, if you enter one, is kept in `localStorage` in plain text.

---

## Running Locally

### Prerequisites
- Node.js 20+ (only for the dev server, the vendoring script and tests)
- A modern browser (Chrome, Edge, Firefox, Safari)

### Setup

```bash
git clone https://github.com/tejaswigowda/rtc-webCLI.git
cd rtc-webCLI
npm install        # dev dependencies only; the app has no runtime dependencies
npm start          # http://localhost:8080/
```

The server listens on all interfaces and prints your network address. When the page is opened on `localhost`, **Copy invite** and **QR** use that LAN address (from `/lan.json`) instead of `127.0.0.1`, so other devices can open them.

Camera, microphone, screen capture and the cryptography need `https://` or `http://localhost`. Over plain `http://<LAN IP>` the page explains this instead of failing with a permission error. For a working LAN session serve https:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=rtc-webCLI" -keyout key.pem -out cert.pem
TLS_KEY=key.pem TLS_CERT=cert.pem npm start     # each device accepts the self-signed certificate once
```

### Deployment

Deploy the `docs/` folder to any static host over https. **GitHub Pages** works; no special headers are needed.

### Upgrading the vendored libraries

```bash
npm run vendor     # rebuilds docs/lib/ and re-pins the SHA-256 values in docs/index.html
```

| File | Package | Version | SHA-256 |
|---|---|---|---|
| `trystero-nostr.js` | `@trystero-p2p/nostr` (Trystero) | 0.27.0 | `6a6178fe91676060d83288ad57b18257a457e7512d07ff8157e43beded27459b` |
| `qrcode.js` | `qrcode-generator` | 1.5.2 | `065509cfd450f89dbffccc8e37d16f5cb03099aef7c36ab2a23d27611bd97b03` |

`/about` shows the same values and the protocol version.

### Tests and Gates

```bash
npm test           # end-to-end: real Chromium, a mock Nostr relay and fake cameras (Playwright)
npx playwright install chromium    # first time only
```

| Gate | Check | Status |
|---|---|---|
| RT1 | invite secret only in the URL fragment; copy-invite and QR share one format | `npm test` |
| RT2 | relay frames contain no secret | `npm test` |
| RT3 | relay frames contain no plaintext SDP | `npm test` |
| RT4 | roster equals the real connections after joins and leaves | `npm test` (and shown live in the top bar) |
| RT5 | removal is labelled as a request; Move room invites chosen peers | `npm test` |
| RT6 | room lifetime wording | `npm test`; wording review open |
| RT7 | media-off join; no sender carries a track until Send | `npm test` |
| RT8 | joiner past the cap gets a refusal naming the cap; existing call unaffected | `npm test`, with a test-only lower cap |
| RT9 | **measured** cap | **open** (table below) |
| RT10 | quality label and policy | `npm test`; **throttled-uplink test open** |
| RT11, RT12 | screen share and screen audio where supported | built; **device matrix open** |
| RT13 | per-peer failure named with a reason within 15 s | `npm test` (Chromium with UDP blocked) |
| RT14 | STUN visible; LAN-only | built; **HAR check open** |
| RT15 | TURN labelled as relay when used | built; **needs a real coturn run** |
| RT16 | egress table equals the HAR host set | table written; **HAR comparison open** |
| RT17 | vendored, hash-pinned, nothing loads from outside the origin | `npm test` |
| RT18 | empty room vs. unreachable relays | `npm test` |
| RT19 | console parity | `npm test` for core commands |
| RT20 | non-secure origin explained | built; **manual check on a LAN IP open** |
| RT21 | leaving ends every track | `npm test`; manual camera-light check open |
| RT22 | browser-pair matrix | **open** (table below) |
| RT24 | names labelled unverified | `npm test` |
| RT25 | IP disclosure before first join | built; review open |
| RT26 | incompatible versions refused by name | `npm test` |

**RT9 measurement (open)**

| Date | Device | Resolution | Upload per peer | CPU | Largest N with no freeze over 10 min |
|---|---|---|---|---|---|
| not yet measured | | | | | |

**RT22 browser-pair matrix (open)**

Chrome, Firefox, Safari on macOS, iOS Safari and Android Chrome, every pair, audio and video both ways. Not yet run. Any failing pair will be listed here.

---

## Project Structure

```
docs/
├── index.html              # The whole app (UI, rooms, roster, console)
└── lib/
    ├── trystero-nostr.js   # Vendored Trystero (Nostr strategy), hash-pinned
    ├── qrcode.js           # Vendored QR generator, hash-pinned
    └── PINS.json           # Versions and SHA-256 values

server.js                   # Node.js static dev server (+ /lan.json, optional https)
scripts/vendor.mjs          # Bundles docs/lib/ and pins hashes into docs/index.html
test/
├── e2e.mjs                 # End-to-end gates
└── mock-relay.mjs          # In-process Nostr relay for the tests
```

---

## Dependencies

**None at runtime** beyond the vendored Trystero and QR bundles. Dev only: esbuild (vendoring), Playwright and ws (tests).

---

## Out of Scope

Each of these is logged, with a trigger for building it:

- **Rooms larger than the cap** (an SFU). Never inside this tool; a server would hold media.
- **Host controls, lock, waiting room.** Not enforceable without a server, so not faked.
- **Text chat.** Cheap over a data channel; built when someone in a real session asks.
- **Local recording.** Needs a visible all-party recording indicator first.
- **Zero-relay calls by manual QR exchange** (exactly two people).
- **Background blur and noise suppression** beyond what the browser provides.
- **A `run=` agent surface** (`window.__webcli_result`).

---

## Part of the Web-CLI family

A family of browser tools that process your content on your device, with each tool declaring what it fetches and sends. All free and open source.

- **[ffmpeg-webCLI](https://github.com/tejaswigowda/ffmpeg-webCLI)** - full FFmpeg in the browser: trim, convert, compress, caption, and 30+ video operations. ([live](https://tejaswigowda.com/ffmpeg-webCLI/))
- **[whisper-webCLI](https://github.com/tejaswigowda/whisper-webCLI)** - speech-to-text with Whisper (Transformers.js), ~99 languages, on-device. ([live](https://tejaswigowda.com/whisper-webCLI/))
- **[chat-webCLI](https://github.com/tejaswigowda/chat-webCLI)** - local LLM chat via WebLLM/WebGPU; prompts never leave the device. ([live](https://tejaswigowda.com/chat-webCLI/))
- **[3mf-webCLI](https://github.com/tejaswigowda/3mf-webCLI)** - GLB to multi-material 3MF for AMS/MMU 3D printing, client-side. ([live](https://tejaswigowda.com/3mf-webCLI/))
- **[dub-webCLI](https://github.com/tejaswigowda/dub-webCLI)** - SRT in, timed speech WAV out, on-device.
- **[hls-webCLI](https://github.com/tejaswigowda/hls-webCLI)** - versioned adaptive-streaming releases committed to your repository.

All tools: [webcli.app](https://webcli.app) · Architecture paper: [arXiv:2608.28950](https://arxiv.org/abs/2608.28950)

---

## Acknowledgments

- **Trystero** - Dan Motzenbecker (MIT); WebRTC matchmaking over Nostr
- **Nostr relays** - the public relays listed above, run by their operators
- **qrcode-generator** - Kazuhiko Arase (MIT)
- **Playwright** and **ws** - used only by the tests
- **ffmpeg-webCLI**, **whisper-webCLI** - sibling projects and design inspiration

---

## License

GPL-3.0 - see [LICENSE](LICENSE). The vendored libraries keep their own licenses: Trystero and qrcode-generator are MIT, which is compatible with GPL-3.0.

---

**Questions?** Open an [issue](https://github.com/tejaswigowda/rtc-webCLI/issues) or submit a PR.

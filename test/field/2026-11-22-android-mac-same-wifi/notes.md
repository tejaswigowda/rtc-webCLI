# 2026-11-22: Android Chrome 157 ↔ macOS Chromium 160, same home Wi-Fi (v0.3.0)

Both on 192.168.0.x. Both sides shared a real local address; 5 of 5 relays passing on both.

| Check | Result |
|---|---|
| Joining with address sharing on, mic allowed on the Mac | **fail**, `BOTH_PRIVATE_BLOCKED` |
| Same, with the phone's mobile data off | **fail**, same |
| Phone opens `http://<Mac IP>:8080` (plain HTTP, no WebRTC) | **fail**: the page does not load |
| Phone on cellular ↔ Mac on Wi-Fi | connects, video both ways |
| iPhone ↔ Mac on the same Wi-Fi | connected, but the path was not recorded, so it does not rule out isolation or the Mac's firewall |
| iPhone opens `http://<Mac IP>:8080` | **not yet run** (DX7) |

Phone `/diag`: `localAddress.known: true`, `source: probe`, `microphonePermission: prompt`.

## Files to add

- `mac.json` and `android.json`: the two `/diag` dumps from 17:29. **They are not in the repository yet.** They were
  taken before the diagnostic kept a snapshot of the connectivity checks, so `candidatePairs` in the Mac dump is all
  zeros because the connection was already closed when the stats were read. That is the DX1 defect, not a measurement:
  note it next to the file when it is added.
- Both must contain no IP addresses (`npm test` checks this). The console logs from that run contain
  `192.168.0.x` and are not to be committed as they are.

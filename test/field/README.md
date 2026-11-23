# Field diagnostics

One file per real-device run from the RT22 matrix, named `YYYY-MM-DD-<run>-<side>.json` (for example
`2026-11-22-T1-phone.json` and `2026-11-22-T1-laptop.json`).

Each file is the output of **Copy diagnostic** (or `/diag`) on that device after the failure. It contains the app
version, browser brand and major version, OS family, whether and from where the local address was known, the
microphone permission state, the cause code, local and remote candidates as `{type, protocol, addrClass}`,
the candidate pairs (state, local and remote type and address class, checks sent and answered, bytes) read while the checks ran and when they were read (`statsTakenAtMs`) or the text `unavailable (...)`, never zeros it did not measure, the selected pair, how many times ICE was restarted on that connection and the ICE state transitions. It contains **no IP addresses**.

Alongside the files, add a line to the RT22 table in the main README: the date, the pair, the network, what was
pressed before it connected (nothing, Allow local connections, Mic), the path shown, and the cause code.

A test (`npm test`, check DX5) fails if any `.json` file under this folder contains something that looks like an IP
address. Console logs are not stored: they contain local addresses.

Folders by run: [`2026-11-22-android-mac-same-wifi/`](2026-11-22-android-mac-same-wifi/).

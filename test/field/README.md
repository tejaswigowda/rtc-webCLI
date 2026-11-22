# Field diagnostics

One file per real-device run from the RT22 matrix, named `YYYY-MM-DD-<run>-<side>.json` (for example
`2026-11-22-T1-phone.json` and `2026-11-22-T1-laptop.json`).

Each file is the output of **Copy diagnostic** (or `/diag`) on that device after the failure. It contains the app
version, browser brand and major version, OS family, whether and from where the local address was known, the
microphone permission state, the cause code, local and remote candidates as `{type, protocol, addrClass}`,
candidate-pair counts, the selected pair types and the ICE state transitions. It contains **no IP addresses**.

Alongside the files, add a line to the RT22 table in the main README: the date, the pair, the network, what was
pressed before it connected (nothing, Allow local connections, Mic), the path shown, and the cause code.

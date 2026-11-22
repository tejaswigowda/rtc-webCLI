// node_modules/@trystero-p2p/core/dist/primitives.mjs
var encoder = /* @__PURE__ */ new TextEncoder();
var decoder = /* @__PURE__ */ new TextDecoder();
var libName = "Trystero";
var libId = "trystero";
var domainTag = (name, version) => `${libId}:${name}:v${version}`;
var socketInitialFailureSymbol = /* @__PURE__ */ Symbol.for(`${libId}.socketInitialFailure`);
var pluginSlotSymbol = /* @__PURE__ */ Symbol.for(`${libId}.slot`);
var mkErr = (msg) => /* @__PURE__ */ new Error(`${libName}: ${msg}`);
var unreachable = (x) => {
  throw mkErr(x);
};
var toJson = JSON.stringify;
var fromJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    throw mkErr(`failed to parse JSON (${s.length} bytes)`);
  }
};
var encodeBytes = (txt) => encoder.encode(txt);
var encodeBytesInto = (txt, dest) => encoder.encodeInto(txt, dest);
var utf8ByteLength = (txt) => {
  let bytes = 0;
  for (let i = 0; i < txt.length; i++) {
    const code = txt.charCodeAt(i);
    if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 55296 && code <= 56319 && i + 1 < txt.length && (txt.charCodeAt(i + 1) & 64512) === 56320) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
};
var decodeBytes = (buf) => decoder.decode(buf);
var b64UrlEncodeOpts = {
  alphabet: "base64url",
  omitPadding: true
};
var b64UrlDecodeOpts = { alphabet: "base64url" };
var nativeToBase64 = Uint8Array.prototype.toBase64;
var nativeFromBase64 = Uint8Array.fromBase64;
var toBase64Url = typeof nativeToBase64 === "function" ? (bytes) => nativeToBase64.call(bytes, b64UrlEncodeOpts) : (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
var fromBase64Url = typeof nativeFromBase64 === "function" ? (b64url) => nativeFromBase64(b64url, b64UrlDecodeOpts) : (b64url) => {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
var base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var base64UrlRe = /^[A-Za-z0-9_-]+$/;
var bytesToBigInt = (bytes) => {
  let res = 0n;
  for (const b of bytes) res = res << 8n | BigInt(b);
  return res;
};
var bytesMatch = (a, b) => {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
};
var hash32 = (str) => {
  const bytes = encodeBytes(str);
  let h = 2166136261;
  for (let i = 0; i < bytes.byteLength; i++) h = Math.imul(h ^ bytes[i], 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  return (h ^ h >>> 16) >>> 0;
};
var createBoundedCache = (maxSize = 4096) => {
  const map = /* @__PURE__ */ new Map();
  return {
    get size() {
      return map.size;
    },
    get: (key) => {
      if (!map.has(key)) return;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    has: (key) => map.has(key),
    set: (key, value) => {
      if (map.has(key)) map.delete(key);
      else if (map.size >= maxSize) {
        const oldest = map.keys().next().value;
        if (oldest !== void 0) map.delete(oldest);
      }
      map.set(key, value);
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    keys: () => [...map.keys()],
    entries: () => [...map.entries()]
  };
};

// node_modules/@trystero-p2p/core/dist/emitter.mjs
var noOp = () => {
};
var logHandlerErr = (kind, err) => console.error(`${libName} ${kind} error:`, err);
var createEventEmitter = (kind, onActiveChange) => {
  const subs = /* @__PURE__ */ new Set();
  let clearEpoch = 0;
  const invoke = (handler, args) => {
    try {
      const res = handler(...args);
      if (res && typeof res.then === "function") Promise.resolve(res).catch((err) => logHandlerErr(kind, err));
    } catch (err) {
      logHandlerErr(kind, err);
    }
  };
  return [
    (handler, options, getReplayItems) => {
      if (typeof handler !== "function") throw mkErr(`${kind.endsWith("handler") ? kind : `${kind} handler`} must be a function`);
      const signal = options?.signal;
      if (signal?.aborted) return noOp;
      const once = Boolean(options?.once);
      const abortCleanup = signal ? new AbortController() : null;
      let state;
      const unsub = () => {
        switch (state.phase) {
          case "closed":
            return;
          case "replaying": {
            const cleanup = state.abortCleanup;
            state = { phase: "closed" };
            cleanup?.abort();
            return;
          }
          case "live": {
            const { entry: liveEntry, abortCleanup: cleanup } = state;
            state = { phase: "closed" };
            cleanup?.abort();
            if (subs.delete(liveEntry) && subs.size === 0) onActiveChange?.(false);
            return;
          }
          default:
            unreachable(state);
        }
      };
      const entry = [(...args) => {
        if (state.phase !== "live") return;
        if (once) unsub();
        invoke(handler, args);
      }, unsub];
      const activateAfterReplay = () => {
        switch (state.phase) {
          case "replaying": {
            if (state.epoch !== clearEpoch) {
              unsub();
              return;
            }
            const wasEmpty = subs.size === 0;
            state = {
              phase: "live",
              entry,
              abortCleanup: state.abortCleanup
            };
            subs.add(entry);
            if (wasEmpty) onActiveChange?.(true);
            return;
          }
          case "live":
          case "closed":
            return;
          default:
            unreachable(state);
        }
      };
      state = {
        phase: "replaying",
        epoch: clearEpoch,
        abortCleanup
      };
      if (abortCleanup && signal) signal.addEventListener("abort", unsub, {
        once: true,
        signal: abortCleanup.signal
      });
      if (options?.replay && getReplayItems) {
        const currentPhase = () => state;
        for (const item of getReplayItems()) {
          const cur = currentPhase();
          if (cur.phase !== "replaying" || cur.epoch !== clearEpoch) {
            unsub();
            break;
          }
          if (once) unsub();
          invoke(handler, item);
        }
      }
      activateAfterReplay();
      return unsub;
    },
    (...args) => {
      for (const sub of Array.from(subs)) sub[0](...args);
    },
    () => {
      clearEpoch++;
      for (const sub of Array.from(subs)) sub[1]();
    },
    () => subs.size > 0
  ];
};
var initSingleHandler = (name, onChange) => {
  let current = null;
  return [
    (handler, options) => {
      if (typeof handler !== "function") throw mkErr(`${name} handler must be a function`);
      const signal = options?.signal;
      if (signal?.aborted) return noOp;
      if (current) throw mkErr(`${name} handler already registered; unsubscribe first`);
      const once = Boolean(options?.once);
      const abortCleanup = signal ? new AbortController() : null;
      let active = true;
      const unsub = () => {
        if (!active) return;
        active = false;
        abortCleanup?.abort();
        if (current?.[1] === unsub) {
          current = null;
          onChange?.(null);
        }
      };
      const call = ((...args) => {
        if (!active) return;
        if (once) unsub();
        return handler(...args);
      });
      current = [call, unsub];
      if (abortCleanup && signal) signal.addEventListener("abort", unsub, {
        once: true,
        signal: abortCleanup.signal
      });
      onChange?.(call);
      return unsub;
    },
    () => current?.[0] ?? null,
    () => current?.[1]()
  ];
};

// node_modules/@trystero-p2p/core/dist/utils.mjs
var lockMethods = (target, methodNames) => {
  for (const name of methodNames) {
    const fn = target[name];
    Object.defineProperty(target, name, {
      get: () => fn,
      set: () => {
        throw new TypeError(`${libName}: ${name} is a method; call ${name}(handler), which returns an unsubscribe function`);
      },
      enumerable: true,
      configurable: true
    });
  }
  return target;
};
var authMetaKey = `__${libId}Auth`;
var cmpStr = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var warn = (msg) => console.warn(`${libName}: ${msg}`);
var warnNoPeer = (id) => warn(`no peer with id ${id} found`);
var warnEphemeralAdmin = () => warn("roles({selfAsAdmin: true}) with an ephemeral identity orphans the room on close; use identity: 'local' or an imported UserIdentity");
var logErr = (kind, err) => console.error(`${libName} ${kind} error:`, err);
var logActionHandlerErr = (err) => logErr("action handler", err);
var peerDisconnectedMsg = "peer disconnected";
var peerDisconnectedErr = /* @__PURE__ */ mkErr(peerDisconnectedMsg);
var peerBannedMsg = "peer banned";
var peerBannedErr = /* @__PURE__ */ mkErr(peerBannedMsg);
var mkBannedErr = (reason, peerId) => ({
  code: "banned",
  message: reason ? `${peerBannedMsg}: ${reason}` : peerBannedMsg,
  ...reason !== void 0 ? { reason } : {},
  ...peerId ? { peerId } : {}
});
var peerLeftRoomErr = /* @__PURE__ */ mkErr("peer left room");
var roomLeftErr = /* @__PURE__ */ mkErr("room left");
var roomFullMsg = "room full";
var roomFullErr = /* @__PURE__ */ mkErr(roomFullMsg);
var operationAbortedMsg = "operation aborted";
var insufficientAuthPrefix = "insufficient authority";
var invalidP256KeyErr = /* @__PURE__ */ mkErr("invalid ECDSA P-256 public key");
var posSafeIntErr = (name) => mkErr(`${name} must be a positive safe integer`);
var requiresRolesErr = (feature) => mkErr(`${feature} requires roles() in joinRoom config`);
var selfCertRoomRolesErr = /* @__PURE__ */ requiresRolesErr("self-certifying room ID");
var actionRedefinedErr = (type) => mkErr(`action type "${type}" cannot be redefined`);
var invalidActionMsg = (what) => `invalid action ${what}`;
var noActivePeerMsg = (id) => `no active peer with id ${id}`;
var requiredErr = (field) => mkErr(`${field} is required`);
var { floor } = Math;
var alloc = (n, f) => Array(n).fill(void 0).map(f);
var base62UnbiasedLimit = 248;
var genId = (n) => {
  if (n <= 0) return "";
  const buf = new Uint8Array(Math.ceil(n * 1.15) + 4);
  let out = "";
  while (out.length < n) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.byteLength && out.length < n; i++) {
      const b = buf[i];
      if (b < base62UnbiasedLimit) out += base62Alphabet[b % 62];
    }
  }
  return out;
};
var all = /* @__PURE__ */ Promise.all.bind(Promise);
var isBrowser = typeof window !== "undefined";
var entries = Object.entries;
var fromEntries = Object.fromEntries;
var keys = Object.keys;
var values = Object.values;
var noOp2 = () => {
};
var candidateType = "candidate";
var resetTimer = (timer) => {
  if (timer !== null && timer !== void 0) clearTimeout(timer);
  return null;
};
var unrefTimer = (t) => {
  t?.unref?.();
};
var toErrorMessage = (reason, fallback) => {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return toJson(reason ?? fallback);
};
var toError = (reason, fallback) => reason instanceof Error ? reason : mkErr(toErrorMessage(reason, fallback));
var topicPath = (...parts) => toJson(parts);
var shuffle = (xs, seed) => {
  const a = [...xs];
  let state = (Math.trunc(seed) || 1) >>> 0;
  const rand = () => {
    state = state + 1831565813 >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  let i = a.length;
  while (i) {
    const j = floor(rand() * i--);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
};
var strToNum = (str, limit = Number.MAX_SAFE_INTEGER) => hash32(str) % limit;
var protocolViolations = /* @__PURE__ */ new WeakSet();
var markProtocolViolation = (err) => {
  protocolViolations.add(err);
  return err;
};
var mkViolationErr = (msg) => markProtocolViolation(mkErr(msg));
var userIdRegex = /* @__PURE__ */ new RegExp(`^[0-9A-Za-z]{${22}}$`);
var selfCertifyingRoomRegex = /* @__PURE__ */ new RegExp(`^(.+)~([0-9A-Za-z]{${22}})$`);
var splitSelfCertRoom = (roomId) => {
  const match = selfCertifyingRoomRegex.exec(roomId);
  return match?.[1] && match[2] ? [match[1], match[2]] : [roomId, null];
};
var formatSelfCertifyingRoomId = (base, userId) => `${splitSelfCertRoom(base)[0]}~${userId}`;
var toPayloadSource = (data) => {
  if (typeof Blob !== "undefined" && data instanceof Blob) return [2, data];
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return [2, data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)];
  const isText = typeof data === "string";
  return [isText ? 0 : 1, encodeBytes(isText ? data : toJson(data))];
};
var hasIceUrl = (servers, pattern) => servers.some(({ urls }) => [urls].flat().some((url) => pattern.test(url)));
var isObj = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var isStr = (v) => typeof v === "string" && v.length > 0;
var isPosSafeInt = (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
var isValidSig = (s) => typeof s === "string" && s.length >= 64 && s.length <= 128;
var validateRoleCertificateShape = (c) => isObj(c) && c["v"] === 1 && isStr(c["certId"]) && isStr(c["issuerPubKey"]) && isStr(c["subUserId"]) && isStr(c["appId"]) && isStr(c["roomId"]) && Array.isArray(c["roles"]) && c["roles"].length > 0 && c["roles"].every(isStr) && isPosSafeInt(c["seq"]) && isPosSafeInt(c["iat"]) && isValidSig(c["sig"]);
var createWindowCounter = (maxEntries, limit, windowMs = 3e4) => {
  const map = createBoundedCache(maxEntries);
  return [
    (id) => {
      const now2 = Date.now();
      let cur = map.get(id);
      if (!cur || now2 - cur[1] > windowMs) {
        cur = [0, now2];
        map.set(id, cur);
      }
      return ++cur[0] >= limit;
    },
    (id) => {
      map.delete(id);
    },
    (id) => {
      const cur = map.get(id);
      return Boolean(cur && Date.now() - cur[1] <= windowMs && cur[0] >= limit);
    }
  ];
};

// node_modules/@trystero-p2p/core/dist/anti-entropy.mjs
var defaultFanout = 2;
var defaultPullTimeoutMs = 1500;
var defaultPeriodicIntervalMs = 15e3;
var defaultMaxPages = 32;
var timeoutCooldownMs = 1e4;
var isValidSyncCursor = (c) => c === void 0 || typeof c === "string" && c.length <= 512;
var hashWithSeed = (value, seed) => {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
};
var occupiesFanoutSlot = (state) => state.phase === "in-flight" || state.phase === "completed";
var createAntiEntropySync = ({ fanout = defaultFanout, pullTimeoutMs = defaultPullTimeoutMs, periodicIntervalMs = defaultPeriodicIntervalMs, maxPages = defaultMaxPages, canSync = () => true, getDirectPeers, isPeerSendable, sendPull }) => {
  const seed = crypto.getRandomValues(/* @__PURE__ */ new Uint32Array(1))[0];
  const peerStates = /* @__PURE__ */ new Map();
  let schedulerPhase = "active";
  let periodicCursor = 0;
  const countCompleted = () => {
    let count = 0;
    for (const state of peerStates.values()) if (state.phase === "completed") count++;
    return count;
  };
  const countActiveOrCompleted = () => {
    let count = 0;
    for (const state of peerStates.values()) if (occupiesFanoutSlot(state)) count++;
    return count;
  };
  const hasInFlight = () => {
    for (const state of peerStates.values()) if (state.phase === "in-flight") return true;
    return false;
  };
  const clearPeerState = (peerId) => {
    const cur = peerStates.get(peerId);
    if (!cur) return;
    switch (cur.phase) {
      case "in-flight":
        resetTimer(cur.timer);
        peerStates.delete(peerId);
        return;
      case "completed":
      case "cooldown":
        peerStates.delete(peerId);
        return;
      default:
        unreachable(cur);
    }
  };
  const isCoolingDown = (peerId, now2) => {
    const cur = peerStates.get(peerId);
    if (cur?.phase !== "cooldown") return false;
    if (now2 >= cur.until) {
      peerStates.delete(peerId);
      return false;
    }
    return true;
  };
  const selectRankedPeers = (skipCooldown = true) => {
    const now2 = Date.now();
    return getDirectPeers().filter((id) => isPeerSendable(id) && (!skipCooldown || !isCoolingDown(id, now2))).map((id) => [id, hashWithSeed(id, seed)]).sort((a, b) => a[1] - b[1] || cmpStr(a[0], b[0])).map(([id]) => id);
  };
  const transitionFailedPull = (peerId, pullId) => {
    const cur = peerStates.get(peerId);
    if (schedulerPhase === "closed" || cur?.phase !== "in-flight" || cur.pullId !== pullId) return;
    resetTimer(cur.timer);
    if (isPeerSendable(peerId)) peerStates.set(peerId, {
      phase: "cooldown",
      until: Date.now() + timeoutCooldownMs
    });
    else peerStates.delete(peerId);
    if (countCompleted() < fanout) fillFanout();
  };
  const makePullTimer = (peerId, pullId) => {
    const timer = setTimeout(() => transitionFailedPull(peerId, pullId), pullTimeoutMs);
    unrefTimer(timer);
    return timer;
  };
  const startPull = (peerId, cursor, pages = 0, preserveStaleDigest = false) => {
    if (schedulerPhase === "closed" || !canSync() || pages >= maxPages || !isPeerSendable(peerId)) {
      clearPeerState(peerId);
      return false;
    }
    const prev = peerStates.get(peerId);
    if (prev?.phase === "in-flight") resetTimer(prev.timer);
    const pullId = Symbol();
    const timer = makePullTimer(peerId, pullId);
    peerStates.set(peerId, {
      phase: "in-flight",
      pullId,
      timer,
      pages: pages + 1,
      staleDigest: preserveStaleDigest
    });
    Promise.resolve().then(() => sendPull(peerId, cursor)).catch(() => transitionFailedPull(peerId, pullId));
    return true;
  };
  const fillFanout = () => {
    if (schedulerPhase === "closed" || !canSync()) return;
    let activeOrCompleted = countActiveOrCompleted();
    for (const candidate of selectRankedPeers()) {
      if (activeOrCompleted >= fanout) break;
      if (!peerStates.has(candidate) && startPull(candidate)) activeOrCompleted++;
    }
  };
  const pullPeer = (peerId, force = false) => {
    if (schedulerPhase === "closed" || !canSync()) return;
    const cur = peerStates.get(peerId);
    if (!cur) {
      startPull(peerId);
      return;
    }
    switch (cur.phase) {
      case "in-flight":
        if (force && !cur.staleDigest) peerStates.set(peerId, {
          ...cur,
          staleDigest: true
        });
        return;
      case "completed":
        if (force) startPull(peerId);
        return;
      case "cooldown":
        startPull(peerId);
        return;
      default:
        unreachable(cur);
    }
  };
  const onSyncPage = (fromPeerId, nextCursor) => {
    const cur = peerStates.get(fromPeerId);
    if (schedulerPhase === "closed" || cur?.phase !== "in-flight") return;
    if (nextCursor && cur.pages < maxPages) {
      startPull(fromPeerId, nextCursor, cur.pages, cur.staleDigest);
      return;
    }
    resetTimer(cur.timer);
    if (cur.staleDigest) {
      peerStates.delete(fromPeerId);
      startPull(fromPeerId);
      return;
    }
    peerStates.set(fromPeerId, { phase: "completed" });
  };
  const onPeerJoined = (peerId, forcePull = false) => {
    if (schedulerPhase === "closed") return;
    const cur = peerStates.get(peerId);
    if (cur?.phase === "in-flight") {
      if (!cur.staleDigest) peerStates.set(peerId, {
        ...cur,
        staleDigest: true
      });
    } else peerStates.delete(peerId);
    if (forcePull) pullPeer(peerId, true);
    fillFanout();
  };
  const onPeerDisconnected = (peerId) => {
    clearPeerState(peerId);
    if (schedulerPhase !== "closed" && countCompleted() < fanout) fillFanout();
  };
  const scheduleRepull = () => {
    if (schedulerPhase !== "active" || getDirectPeers().length === 0) return;
    schedulerPhase = "repull-queued";
    queueMicrotask(() => {
      if (schedulerPhase !== "repull-queued") return;
      schedulerPhase = "active";
      if (!canSync()) return;
      for (const [pid, state] of peerStates) switch (state.phase) {
        case "completed":
          peerStates.delete(pid);
          break;
        case "in-flight":
          if (!state.staleDigest) peerStates.set(pid, {
            ...state,
            staleDigest: true
          });
          break;
        case "cooldown":
          break;
        default:
          unreachable(state);
      }
      fillFanout();
    });
  };
  const periodicTimer = periodicIntervalMs > 0 ? setInterval(() => {
    if (schedulerPhase === "closed" || !canSync() || hasInFlight()) return;
    let ranked = selectRankedPeers();
    if (ranked.length === 0) ranked = selectRankedPeers(false);
    if (ranked.length === 0) return;
    const pick = ranked[periodicCursor++ % ranked.length];
    startPull(pick);
  }, periodicIntervalMs) : void 0;
  unrefTimer(periodicTimer);
  const destroy = () => {
    schedulerPhase = "closed";
    if (periodicTimer !== void 0) clearInterval(periodicTimer);
    for (const state of peerStates.values()) if (state.phase === "in-flight") resetTimer(state.timer);
    peerStates.clear();
  };
  return {
    pullPeer,
    onSyncPage,
    onPeerJoined,
    onPeerDisconnected,
    scheduleRepull,
    isPullInFlight: (peerId) => peerStates.get(peerId)?.phase === "in-flight",
    destroy
  };
};

// node_modules/@trystero-p2p/core/dist/crypto.mjs
var ecdsaKeyAlgo = {
  name: "ECDSA",
  namedCurve: "P-256"
};
var ecdsaSignAlgo = {
  name: "ECDSA",
  hash: "SHA-256"
};
var algo = "AES-GCM";
var gcmIvBytes = 12;
var hmacAlgo = "HMAC";
var pbkdf2Iterations = 6e5;
var emptyHkdfSalt = /* @__PURE__ */ new Uint8Array(32);
var roomAesInfo = /* @__PURE__ */ encodeBytes(domainTag("room-aes", 3));
var roomHmacInfo = /* @__PURE__ */ encodeBytes(domainTag("room-hmac", 3));
var topicHashCache = /* @__PURE__ */ createBoundedCache(4096);
var derivedRoomKeysCache = /* @__PURE__ */ createBoundedCache(64);
var p256N = 115792089210356248762697446949407573529996955224135760342422259061068512044369n;
var p256HalfN = p256N >> 1n;
var normalizeLowSP256Signature = (sig) => {
  if (sig.byteLength !== 64) return sig;
  const s = bytesToBigInt(sig.subarray(32, 64));
  if (s <= p256HalfN) return sig;
  const out = sig.slice();
  let lowS = p256N - s;
  for (let i = 63; i >= 32; i--) {
    out[i] = Number(lowS & 255n);
    lowS >>= 8n;
  }
  return out;
};
var isLowSP256Signature = (sig) => {
  if (sig.byteLength !== 64) return false;
  const r = bytesToBigInt(sig.subarray(0, 32));
  const s = bytesToBigInt(sig.subarray(32, 64));
  return r > 0n && r < p256N && s > 0n && s <= p256HalfN;
};
var sha256 = async (input) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof input === "string" ? encodeBytes(input) : input));
var ecdsaSign = async (privateKey, data) => normalizeLowSP256Signature(new Uint8Array(await crypto.subtle.sign(ecdsaSignAlgo, privateKey, data)));
var ecdsaVerify = (publicKey, sig, data) => crypto.subtle.verify(ecdsaSignAlgo, publicKey, sig, data);
var hashTopic = async (str) => {
  const cached = topicHashCache.get(str);
  if (cached !== void 0) return cached;
  const digest = toBase64Url(await sha256(str));
  topicHashCache.set(str, digest);
  return digest;
};
var derivePasswordRoomKeys = (secret, appId, roomId) => {
  const cacheKey = toJson([
    secret,
    appId,
    roomId
  ]);
  const existing = derivedRoomKeysCache.get(cacheKey);
  if (existing) return existing;
  const deriveP = (async () => {
    const [baseKey, salt] = await Promise.all([crypto.subtle.importKey("raw", encodeBytes(secret), "PBKDF2", false, ["deriveBits"]), sha256(toJson([
      domainTag("pbkdf2-master", 3),
      appId,
      roomId
    ]))]);
    const masterBits = new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt,
      iterations: pbkdf2Iterations,
      hash: "SHA-256"
    }, baseKey, 256));
    try {
      const hkdfKey = await crypto.subtle.importKey("raw", masterBits, "HKDF", false, ["deriveKey"]);
      const [aesKey, hmacKey] = await Promise.all([crypto.subtle.deriveKey({
        name: "HKDF",
        hash: "SHA-256",
        salt: emptyHkdfSalt,
        info: roomAesInfo
      }, hkdfKey, {
        name: algo,
        length: 256
      }, false, ["encrypt", "decrypt"]), crypto.subtle.deriveKey({
        name: "HKDF",
        hash: "SHA-256",
        salt: emptyHkdfSalt,
        info: roomHmacInfo
      }, hkdfKey, {
        name: hmacAlgo,
        hash: "SHA-256",
        length: 256
      }, false, ["sign", "verify"])]);
      return {
        aesKey,
        hmacKey
      };
    } finally {
      masterBits.fill(0);
    }
  })();
  deriveP.catch(() => {
    derivedRoomKeysCache.delete(cacheKey);
  });
  derivedRoomKeysCache.set(cacheKey, deriveP);
  return deriveP;
};
var genKey = async (secret, appId, roomId) => {
  if (!secret) {
    const aesRaw = await sha256(toJson([
      domainTag("room-aes", 3),
      appId,
      roomId
    ]));
    return crypto.subtle.importKey("raw", aesRaw, { name: algo }, false, ["encrypt", "decrypt"]);
  }
  return (await derivePasswordRoomKeys(secret, appId, roomId)).aesKey;
};
var gcmParams = (iv, aad) => aad === void 0 ? {
  name: algo,
  iv
} : {
  name: algo,
  iv,
  additionalData: encodeBytes(aad)
};
var encrypt = async (keyP, plaintext, aad) => {
  const iv = crypto.getRandomValues(new Uint8Array(gcmIvBytes));
  const ct = new Uint8Array(await crypto.subtle.encrypt(gcmParams(iv, aad), await keyP, encodeBytes(plaintext)));
  const packed = new Uint8Array(gcmIvBytes + ct.byteLength);
  packed.set(iv, 0);
  packed.set(ct, gcmIvBytes);
  return toBase64Url(packed);
};
var decrypt = async (keyP, raw, aad) => {
  if (typeof raw !== "string" || !base64UrlRe.test(raw)) throw mkErr("invalid ciphertext");
  const packed = fromBase64Url(raw);
  if (packed.byteLength < 28 || toBase64Url(packed) !== raw) throw mkErr("invalid ciphertext");
  return decodeBytes(await crypto.subtle.decrypt(gcmParams(packed.subarray(0, gcmIvBytes), aad), await keyP, packed.subarray(gcmIvBytes)));
};

// node_modules/@trystero-p2p/core/dist/identity-idb.mjs
var lockPrefix = `${libId}:user_identity:v1:`;
var idbDbName = `${libId}_identity_v1`;
var idbStoreName = "identities";
var idbErr = (op) => mkErr(`IndexedDB ${op} failed`);
var idbProbeBytes = /* @__PURE__ */ encodeBytes(domainTag("idb-key-probe", 1));
var buildUserIdentityFromIdbRecord = (rec) => ({
  userId: rec.userId,
  signPubJwk: rec.signPubJwk,
  sign: (payload) => ecdsaSign(rec.privateKey, payload)
});
var openIdentityDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(idbDbName, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(idbStoreName)) db.createObjectStore(idbStoreName);
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? idbErr("open"));
});
var idbGetRecord = (db, appId) => new Promise((resolve, reject) => {
  const req = db.transaction(idbStoreName, "readonly").objectStore(idbStoreName).get(appId);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? idbErr("get"));
});
var idbWriteTx = (db, run, op) => new Promise((resolve, reject) => {
  const tx = db.transaction(idbStoreName, "readwrite");
  let state;
  const stageResult = (value) => {
    switch (state.phase) {
      case "pending":
      case "staged":
        state = {
          phase: "staged",
          value
        };
        return;
      case "done":
        return;
      default:
        unreachable(state);
    }
  };
  const fail = (err) => {
    switch (state.phase) {
      case "pending":
      case "staged":
        state = { phase: "done" };
        reject(err instanceof Error ? err : tx.error ?? idbErr(op));
        return;
      case "done":
        return;
      default:
        unreachable(state);
    }
  };
  state = { phase: "pending" };
  tx.oncomplete = () => {
    switch (state.phase) {
      case "staged": {
        const { value } = state;
        state = { phase: "done" };
        resolve(value);
        return;
      }
      case "pending":
        state = { phase: "done" };
        reject(idbErr(op));
        return;
      case "done":
        return;
      default:
        unreachable(state);
    }
  };
  tx.onabort = () => fail(tx.error);
  tx.onerror = (event) => fail(event?.target?.error ?? tx.error);
  try {
    run(tx.objectStore(idbStoreName), stageResult);
  } catch (err) {
    fail(err);
  }
});
var idbPutRecord = (db, appId, candidate) => idbWriteTx(db, (store, setResult) => {
  setResult(candidate);
  store.put(candidate, appId);
}, "put");
var checkThenAddIdbRecord = (db, idbKey, candidate) => idbWriteTx(db, (store, setResult) => {
  const getReq = store.get(idbKey);
  getReq.onsuccess = () => {
    const found = getReq.result;
    if (found !== void 0) {
      setResult([found, true]);
      return;
    }
    setResult([candidate, false]);
    store.add(candidate, idbKey);
  };
}, "add");
var isValidStoredIdbRecord = async (rec, verifyUserIdKey2, verifyWithP2562) => {
  if (!rec || typeof rec !== "object" || !rec.userId || !rec.signPubJwk || !rec.privateKey || !await verifyUserIdKey2(rec.userId, rec.signPubJwk)) return false;
  try {
    return await verifyWithP2562(await ecdsaSign(rec.privateKey, idbProbeBytes), idbProbeBytes, rec.signPubJwk);
  } catch {
    return false;
  }
};
var withNavigatorLock = async (appId, fn) => {
  const lockName = `${lockPrefix}${appId}`;
  const run = async () => {
    const db = await openIdentityDb();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : void 0;
  return typeof locks?.request === "function" ? locks.request(lockName, run) : run();
};
var loadOrCreateIdbIdentity = (idbKey, generateRecord, verifyUserIdKey2, verifyWithP2562) => withNavigatorLock(idbKey, async (db) => {
  const validateOrRepair = async (rec) => await isValidStoredIdbRecord(rec, verifyUserIdKey2, verifyWithP2562) ? rec : idbPutRecord(db, idbKey, await generateRecord());
  const existing = await idbGetRecord(db, idbKey);
  if (existing !== void 0) return buildUserIdentityFromIdbRecord(await validateOrRepair(existing));
  const candidate = await generateRecord();
  const [record, wasExisting] = await checkThenAddIdbRecord(db, idbKey, candidate);
  return buildUserIdentityFromIdbRecord(wasExisting ? await validateOrRepair(record) : record);
});

// node_modules/@trystero-p2p/core/dist/identity.mjs
var base62Radix = 62n;
var userKeyPrefix = `${libId}_uk_`;
var maxCachedSigPayloadBytes = 4096;
var maxSigCacheTotalBytes = 2097152;
var maxSigCacheEntries = 8192;
var keyPairTestPayload = /* @__PURE__ */ encodeBytes(domainTag("identity-self-test", 1));
var userIdMismatchErr = /* @__PURE__ */ mkErr("invalid custom user identity; userId does not match signPubJwk");
var invalidCustomIdentityErr = /* @__PURE__ */ mkErr('invalid custom user identity; use "local", "none", loader, or importUserIdentity()');
var invalidCustomSignatureErr = /* @__PURE__ */ mkErr("invalid custom user identity signature; sign() must return a valid 64-byte IEEE P1363 ECDSA P-256 SHA-256 signature");
var encodeBase62 = (bytes, length) => {
  const modulus = base62Radix ** BigInt(length);
  let val = bytesToBigInt(bytes) % modulus;
  let out = "";
  for (let i = 0; i < length; i++) {
    out = base62Alphabet[Number(val % base62Radix)] + out;
    val /= base62Radix;
  }
  return out;
};
var pubJwkToUncompressedBytes = (pubKeyOrJwk) => {
  let x;
  let y;
  if (typeof pubKeyOrJwk === "string") {
    if (pubKeyOrJwk.length !== 87 || pubKeyOrJwk[43] !== ".") return null;
    x = pubKeyOrJwk.slice(0, 43);
    y = pubKeyOrJwk.slice(44);
  } else {
    if (!pubKeyOrJwk || typeof pubKeyOrJwk !== "object" || pubKeyOrJwk.d !== void 0 || pubKeyOrJwk.kty && pubKeyOrJwk.kty !== "EC" || pubKeyOrJwk.crv && pubKeyOrJwk.crv !== "P-256" || typeof pubKeyOrJwk.x !== "string" || typeof pubKeyOrJwk.y !== "string" || !pubKeyOrJwk.x || !pubKeyOrJwk.y) return null;
    x = pubKeyOrJwk.x;
    y = pubKeyOrJwk.y;
  }
  try {
    const xBytes = fromBase64Url(x);
    const yBytes = fromBase64Url(y);
    if (xBytes.byteLength !== 32 || yBytes.byteLength !== 32 || toBase64Url(xBytes) !== x || toBase64Url(yBytes) !== y) return null;
    const uncompressed = /* @__PURE__ */ new Uint8Array(65);
    uncompressed[0] = 4;
    uncompressed.set(xBytes, 1);
    uncompressed.set(yBytes, 33);
    return uncompressed;
  } catch {
    return null;
  }
};
var makeP256Jwk = (x = "", y = "", crv = "P-256", kty = "EC") => ({
  crv,
  kty,
  x,
  y
});
var toCompactPub = (pubKeyOrJwk) => {
  if (typeof pubKeyOrJwk === "object" && pubKeyOrJwk !== null) {
    const byRef = cleanJwkRecordCache.get(pubKeyOrJwk);
    if (byRef) return byRef.compactPub;
  }
  if (!pubJwkToUncompressedBytes(pubKeyOrJwk)) return null;
  return typeof pubKeyOrJwk === "string" ? pubKeyOrJwk : `${pubKeyOrJwk.x}.${pubKeyOrJwk.y}`;
};
var jwkToCompactPub = (pubKeyOrJwk) => {
  const compact = toCompactPub(pubKeyOrJwk);
  if (!compact) throw invalidP256KeyErr;
  return compact;
};
var compactPubToJwk = (pub) => typeof pub === "string" && pubJwkToUncompressedBytes(pub) ? makeP256Jwk(pub.slice(0, 43), pub.slice(44)) : null;
var resolvedPubKeyCache = /* @__PURE__ */ createBoundedCache();
var cleanJwkRecordCache = /* @__PURE__ */ new WeakMap();
var pendingPubKeyCache = /* @__PURE__ */ new Map();
var getCachedPubKeyRecord = (pubKeyOrJwk) => {
  if (typeof pubKeyOrJwk === "object" && pubKeyOrJwk !== null) {
    const byRef = cleanJwkRecordCache.get(pubKeyOrJwk);
    if (byRef) return byRef;
  }
  const compactPub = toCompactPub(pubKeyOrJwk);
  return compactPub ? resolvedPubKeyCache.get(compactPub) : void 0;
};
var getVerifiedPubKeyRecord = (pubKeyOrJwk, preimportedVerifyKey) => {
  if (typeof pubKeyOrJwk === "object" && pubKeyOrJwk !== null) {
    const byRef = cleanJwkRecordCache.get(pubKeyOrJwk);
    if (byRef) return Promise.resolve(byRef);
  }
  const uncompressed = pubJwkToUncompressedBytes(pubKeyOrJwk);
  if (!uncompressed) return Promise.resolve(null);
  const x = typeof pubKeyOrJwk === "string" ? pubKeyOrJwk.slice(0, 43) : pubKeyOrJwk.x;
  const y = typeof pubKeyOrJwk === "string" ? pubKeyOrJwk.slice(44) : pubKeyOrJwk.y;
  const compactPub = `${x}.${y}`;
  const existing = resolvedPubKeyCache.get(compactPub);
  if (existing) return Promise.resolve(existing);
  const inflight = pendingPubKeyCache.get(compactPub);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const [verifyKey, peerDigest, userDigest] = await Promise.all([
        preimportedVerifyKey ? Promise.resolve(preimportedVerifyKey) : crypto.subtle.importKey("raw", uncompressed, ecdsaKeyAlgo, false, ["verify"]),
        sha256(`${domainTag("pid", 1)}:${compactPub}`),
        sha256(`${domainTag("uid", 1)}:${compactPub}`)
      ]);
      const cleanJwk = Object.freeze(makeP256Jwk(x, y));
      const record = {
        compactPub,
        cleanJwk,
        verifyKey,
        peerId: encodeBase62(peerDigest, 20),
        userId: encodeBase62(userDigest, 22)
      };
      cleanJwkRecordCache.set(cleanJwk, record);
      resolvedPubKeyCache.set(compactPub, record);
      return record;
    } catch {
      return null;
    } finally {
      pendingPubKeyCache.delete(compactPub);
    }
  })();
  pendingPubKeyCache.set(compactPub, p);
  return p;
};
var isValidUserId = (id) => typeof id === "string" && userIdRegex.test(id);
var createByteBoundedPayloadCache = () => {
  const map = /* @__PURE__ */ new Map();
  let totalBytes = 0;
  return {
    get: (key) => {
      const val = map.get(key);
      if (val !== void 0) {
        map.delete(key);
        map.set(key, val);
      }
      return val;
    },
    set: (key, val) => {
      const prev = map.get(key);
      if (prev !== void 0) {
        totalBytes -= prev.byteLength;
        map.delete(key);
      }
      while (map.size >= maxSigCacheEntries || map.size > 0 && totalBytes + val.byteLength > maxSigCacheTotalBytes) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === void 0) break;
        const oldestVal = map.get(oldestKey);
        if (oldestVal) totalBytes -= oldestVal.byteLength;
        map.delete(oldestKey);
      }
      map.set(key, val);
      totalBytes += val.byteLength;
    }
  };
};
var verifiedSigPayloads = /* @__PURE__ */ createByteBoundedPayloadCache();
var inFlightSigVerifies = /* @__PURE__ */ new Map();
var verifyWithP256 = (sigBytes, payload, pubKeyOrJwk) => {
  if (!sigBytes || sigBytes.byteLength !== 64) return false;
  const cachedRec = getCachedPubKeyRecord(pubKeyOrJwk);
  if (cachedRec && payload.byteLength <= maxCachedSigPayloadBytes) {
    const cached = verifiedSigPayloads.get(`${cachedRec.compactPub}:${toBase64Url(sigBytes)}`);
    if (cached) return bytesMatch(cached, payload);
  }
  return verifyWithP256Async(sigBytes, payload, pubKeyOrJwk, cachedRec);
};
var verifyWithP256Async = async (sigBytes, payload, pubKeyOrJwk, cachedRec) => {
  const rec = cachedRec ?? await getVerifiedPubKeyRecord(pubKeyOrJwk);
  if (!rec) return false;
  if (payload.byteLength > maxCachedSigPayloadBytes) {
    if (!isLowSP256Signature(sigBytes)) return false;
    try {
      return await ecdsaVerify(rec.verifyKey, sigBytes, payload);
    } catch {
      return false;
    }
  }
  const cacheKey = `${rec.compactPub}:${toBase64Url(sigBytes)}`;
  const cached = verifiedSigPayloads.get(cacheKey);
  if (cached) return bytesMatch(cached, payload);
  if (!isLowSP256Signature(sigBytes)) return false;
  const inFlight = inFlightSigVerifies.get(cacheKey);
  if (inFlight && bytesMatch(inFlight[0], payload)) return inFlight[1];
  const snapshot = payload.slice();
  const promise = ecdsaVerify(rec.verifyKey, sigBytes, snapshot).then((ok) => {
    if (ok) {
      verifiedSigPayloads.set(cacheKey, snapshot);
      if (inFlightSigVerifies.get(cacheKey)?.[1] === promise) inFlightSigVerifies.delete(cacheKey);
      return true;
    }
    if (inFlightSigVerifies.get(cacheKey)?.[1] === promise) inFlightSigVerifies.delete(cacheKey);
    return false;
  }, () => {
    if (inFlightSigVerifies.get(cacheKey)?.[1] === promise) inFlightSigVerifies.delete(cacheKey);
    return false;
  });
  inFlightSigVerifies.set(cacheKey, [snapshot, promise]);
  return promise;
};
var verifyIdKey = (id, pubKeyOrJwk, field) => {
  const cached = getCachedPubKeyRecord(pubKeyOrJwk);
  return cached ? cached[field] === id : getVerifiedPubKeyRecord(pubKeyOrJwk).then((rec) => Boolean(rec && rec[field] === id));
};
var verifyPeerIdKey = (peerId, pubKeyOrJwk) => Boolean(peerId && typeof peerId === "string") && verifyIdKey(peerId, pubKeyOrJwk, "peerId");
var verifyUserIdKey = (userId, pubKeyOrJwk) => isValidUserId(userId) && verifyIdKey(userId, pubKeyOrJwk, "userId");
var generateP256KeyMaterial = async (extractable) => {
  const keyPair = await crypto.subtle.generateKey(ecdsaKeyAlgo, extractable, ["sign", "verify"]);
  const rawJwk = await crypto.subtle.exportKey("jwk", extractable ? keyPair.privateKey : keyPair.publicKey);
  const rec = await getVerifiedPubKeyRecord(makeP256Jwk(rawJwk.x, rawJwk.y), keyPair.publicKey);
  if (!rec) throw invalidP256KeyErr;
  return [
    keyPair,
    rawJwk,
    rec
  ];
};
var defaultAppKey = "__default__";
var maxEpochResolveRetries = 8;
var normalizeAppId = (appId) => appId || defaultAppKey;
var appControllers = /* @__PURE__ */ new Map();
var appEndpointCache = /* @__PURE__ */ createBoundedCache();
var runtimeUserIdentityBySlot = /* @__PURE__ */ createBoundedCache();
var getAppController = (appKey) => {
  let ctrl = appControllers.get(appKey);
  if (!ctrl) {
    ctrl = {
      epoch: 0,
      inFlightLoad: null,
      opTail: Promise.resolve()
    };
    appControllers.set(appKey, ctrl);
  }
  return ctrl;
};
var enqueueControllerOp = (ctrl, fn) => {
  const next = ctrl.opTail.catch(noOp2).then(fn);
  ctrl.opTail = next.catch(noOp2);
  return next;
};
var nextIdentityClientSeq = 0;
var createIdentityClientId = () => `c${++nextIdentityClientSeq}`;
var slotForAppKey = (appKey, clientId = "", epoch = getAppController(appKey).epoch) => `${clientId}\0${epoch}\0${appKey}`;
var createEndpointIdentity = () => generateP256KeyMaterial(false).then(([keyPair, , rec]) => ({
  peerId: rec.peerId,
  signPrivateKey: keyPair.privateKey,
  signPublicKey: keyPair.publicKey,
  signPubJwk: rec.cleanJwk,
  sign: (payload) => ecdsaSign(keyPair.privateKey, payload)
}));
var getDefaultEndpointIdentity = (appId, clientId) => {
  const appKey = normalizeAppId(appId);
  const slot = slotForAppKey(appKey, clientId);
  const existing = appEndpointCache.get(slot);
  if (existing) return existing;
  const created = createEndpointIdentity();
  created.catch(() => {
    if (appEndpointCache.get(slot) === created) appEndpointCache.delete(slot);
  });
  appEndpointCache.set(slot, created);
  return created;
};
var extractableUserKeys = /* @__PURE__ */ new WeakMap();
var trustedUserIdentities = /* @__PURE__ */ new WeakSet();
var generateNonExtractableIdbRecord = async () => {
  const [keyPair, , rec] = await generateP256KeyMaterial(false);
  return {
    userId: rec.userId,
    signPubJwk: rec.cleanJwk,
    privateKey: keyPair.privateKey
  };
};
var createNonExtractableUserIdentity = () => generateNonExtractableIdbRecord().then((rec) => {
  const id = buildUserIdentityFromIdbRecord(rec);
  trustedUserIdentities.add(id);
  return id;
});
var isUserIdentityObjectStructural = (val) => Boolean(val && typeof val === "object" && typeof val.userId === "string" && isValidUserId(val.userId) && val.signPubJwk && pubJwkToUncompressedBytes(val.signPubJwk) && typeof val.sign === "function");
var withPersistence = (val, persistence, cleanJwk = val.signPubJwk) => {
  const isKnownTrusted = trustedUserIdentities.has(val);
  const wrapped = {
    userId: val.userId,
    signPubJwk: cleanJwk,
    sign: isKnownTrusted ? val.sign : async (payload) => normalizeLowSP256Signature(new Uint8Array(await val.sign(payload))),
    persistence
  };
  const userKey = extractableUserKeys.get(val);
  if (userKey !== void 0) extractableUserKeys.set(wrapped, userKey);
  if (isKnownTrusted) trustedUserIdentities.add(wrapped);
  return wrapped;
};
var coerceCustomUserIdentity = async (val) => {
  if (!isUserIdentityObjectStructural(val)) throw invalidCustomIdentityErr;
  const rec = await getVerifiedPubKeyRecord(val.signPubJwk);
  if (!rec || rec.userId !== val.userId) throw userIdMismatchErr;
  if (!trustedUserIdentities.has(val)) {
    let rawSig;
    try {
      rawSig = new Uint8Array(await val.sign(keyPairTestPayload.slice()));
    } catch (cause) {
      throw mkErr(`custom user identity sign() failed startup check: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const normalizedSig = normalizeLowSP256Signature(rawSig);
    if (normalizedSig.byteLength !== 64 || !await ecdsaVerify(rec.verifyKey, normalizedSig, keyPairTestPayload)) throw invalidCustomSignatureErr;
  }
  return withPersistence(val, val.persistence ?? "custom", rec.cleanJwk);
};
var hasIndexedDB = () => {
  try {
    return typeof globalThis !== "undefined" && "indexedDB" in globalThis && Boolean(globalThis.indexedDB);
  } catch {
    return false;
  }
};
var isEphemeralIdentityConfig = (identity) => identity === "none" || (identity === void 0 || identity === "local") && !hasIndexedDB();
var validateIdentityConfig = (config) => {
  const raw = config?.identity;
  if (raw === void 0 || raw === "none" || raw === "local" || typeof raw === "function") return;
  if (isUserIdentityObjectStructural(raw)) {
    const cached = getCachedPubKeyRecord(raw.signPubJwk);
    if (cached && cached.userId !== raw.userId) throw userIdMismatchErr;
    return;
  }
  throw invalidCustomIdentityErr;
};
var getOrCreateEphemeralIdentity = (appKey, clientId = "", epoch = getAppController(appKey).epoch) => {
  const slot = slotForAppKey(appKey, clientId, epoch);
  const existing = runtimeUserIdentityBySlot.get(slot);
  if (existing) return existing;
  const created = createNonExtractableUserIdentity().then((id) => withPersistence(id, "none"));
  created.catch(() => {
    if (runtimeUserIdentityBySlot.get(slot) === created) runtimeUserIdentityBySlot.delete(slot);
  });
  runtimeUserIdentityBySlot.set(slot, created);
  return created;
};
var epochSupersededErr = /* @__PURE__ */ mkErr("identity epoch superseded by clearUserIdentity");
var startAppLocalLoad = (appKey, ctrl, targetEpoch) => {
  const promise = enqueueControllerOp(ctrl, async () => {
    if (ctrl.epoch !== targetEpoch) throw epochSupersededErr;
    const id = await loadOrCreateIdbIdentity(appKey, generateNonExtractableIdbRecord, verifyUserIdKey, verifyWithP256);
    trustedUserIdentities.add(id);
    return withPersistence(id, "local");
  }).finally(() => {
    if (ctrl.inFlightLoad?.promise === promise) ctrl.inFlightLoad = null;
  });
  ctrl.inFlightLoad = {
    epoch: targetEpoch,
    promise
  };
  return promise;
};
var resolveUserIdentity = async (appId, roomId, config, clientId) => {
  const raw = config?.identity;
  if (typeof raw === "function") return coerceCustomUserIdentity(await raw({
    appId,
    roomId
  }));
  if (raw !== void 0 && raw !== "none" && raw !== "local") return coerceCustomUserIdentity(raw);
  const appKey = normalizeAppId(appId);
  const ctrl = getAppController(appKey);
  if ((raw === "none" || raw === "local" ? raw : hasIndexedDB() ? "local" : "none") === "none") return getOrCreateEphemeralIdentity(appKey, clientId, ctrl.epoch);
  if (!hasIndexedDB()) {
    warn("IndexedDB unavailable; falling back to identity: 'none'");
    return getOrCreateEphemeralIdentity(appKey, clientId, ctrl.epoch);
  }
  for (let attempt = 0; attempt < maxEpochResolveRetries; attempt++) {
    const targetEpoch = ctrl.epoch;
    const loadPromise = ctrl.inFlightLoad?.epoch === targetEpoch ? ctrl.inFlightLoad.promise : startAppLocalLoad(appKey, ctrl, targetEpoch);
    try {
      const resolved = await loadPromise;
      if (ctrl.epoch === targetEpoch) return resolved;
    } catch {
      if (ctrl.epoch !== targetEpoch) continue;
      warn("IndexedDB unavailable; falling back to identity: 'none'");
      return getOrCreateEphemeralIdentity(appKey, clientId, targetEpoch);
    }
  }
  return getOrCreateEphemeralIdentity(appKey, clientId, ctrl.epoch);
};

// node_modules/@trystero-p2p/core/dist/signed-record.mjs
var zeroHlc = [0, 0];
var defaultMaxClockSkewMs = 6e4;
var stateMaxFutureSkewMs = 1e4;
var maxObservedClockDragMs = 5e3;
var maxJsonDepth = 64;
var canonTag = (tag, items, version = 1) => toJson([domainTag(tag, version), ...items]);
var isValidHlc = (v) => Array.isArray(v) && v.length === 2 && isPosSafeInt(v[0]) && typeof v[1] === "number" && Number.isSafeInteger(v[1]) && v[1] >= 0;
var compareHlc = (a, b) => a[0] - b[0] || a[1] - b[1];
var signWith = async (signer, payload) => {
  const bytes = encodeBytes(payload);
  const signature = typeof signer === "function" ? normalizeLowSP256Signature(await signer(bytes)) : await ecdsaSign(signer, bytes);
  return toBase64Url(signature);
};
var verifySig = (pub, payload, sig) => {
  try {
    const res = verifyWithP256(fromBase64Url(sig), encodeBytes(payload), pub);
    return typeof res === "boolean" ? res : res.catch(() => false);
  } catch {
    return false;
  }
};
var canonicalizeAndMeasureJson = (value, maxBytes = Number.POSITIVE_INFINITY) => {
  const seen = /* @__PURE__ */ new Set();
  const walk = (item, depth) => {
    if (depth > maxJsonDepth) return null;
    if (item === null || typeof item === "boolean") return String(item);
    if (typeof item === "number") return Number.isFinite(item) ? toJson(item) : null;
    if (typeof item === "string") return toJson(item);
    if (typeof item !== "object") return null;
    const obj = item;
    if (seen.has(obj)) return null;
    const isArr = Array.isArray(obj);
    if (!isArr) {
      const proto = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) return null;
    }
    seen.add(obj);
    try {
      if (isArr) {
        const parts2 = [];
        for (let i = 0; i < obj.length; i++) {
          const serialized = walk(obj[i], depth + 1);
          if (serialized === null) return null;
          parts2.push(serialized);
        }
        return `[${parts2.join(",")}]`;
      }
      const record = obj;
      const sortedKeys = keys(record).sort();
      const parts = [];
      for (let i = 0; i < sortedKeys.length; i++) {
        const key = sortedKeys[i];
        const prop = record[key];
        if (prop === void 0) continue;
        const serialized = walk(prop, depth + 1);
        if (serialized === null) return null;
        parts.push(`${toJson(key)}:${serialized}`);
      }
      return `{${parts.join(",")}}`;
    } finally {
      seen.delete(obj);
    }
  };
  const json = walk(value, 0);
  if (json === null) return 0;
  const bytes = utf8ByteLength(json);
  return bytes > maxBytes ? 1 : [json, bytes];
};
var canonicalizeJson = (value) => {
  const res = canonicalizeAndMeasureJson(value);
  if (!Array.isArray(res)) throw mkErr("value must be valid finite JSON");
  return res[0];
};
var createMonotonicClock = (initial = 0) => {
  let lastWall = initial;
  let lastCounter = 0;
  return {
    peek: () => lastWall,
    observe: (ts, maxForwardMs = maxObservedClockDragMs) => {
      const bounded = Math.min(ts, Date.now() + maxForwardMs);
      if (bounded > lastWall) {
        lastWall = bounded;
        lastCounter = 0;
      }
    },
    next: (minTs = 0) => {
      const now2 = Date.now();
      const target = Math.max(now2, lastWall + 1, minTs);
      const maxGlobal = now2 + maxObservedClockDragMs;
      if (target <= maxGlobal) lastWall = target;
      else if (maxGlobal > lastWall) lastWall = maxGlobal;
      lastCounter = 0;
      return target;
    },
    nextHlc: (ns, minHlc = zeroHlc, maxSkewMs = stateMaxFutureSkewMs) => {
      const now2 = Date.now();
      const targetWall = Math.max(now2, lastWall, minHlc[0]);
      if (targetWall > now2 + maxSkewMs) throw mkErr(`state clock skew exceeded for "${ns}"`);
      const counter = targetWall > lastWall && targetWall > minHlc[0] ? 0 : Math.max(targetWall === lastWall ? lastCounter : -1, targetWall === minHlc[0] ? minHlc[1] : -1) + 1;
      const maxGlobal = now2 + maxObservedClockDragMs;
      if (targetWall <= maxGlobal) {
        lastWall = targetWall;
        lastCounter = counter;
      } else if (maxGlobal > lastWall) {
        lastWall = maxGlobal;
        lastCounter = 0;
      }
      return [targetWall, counter];
    }
  };
};
var createTokenBucketLimiter = (ratePerSec, burst, maxKeys = 512) => {
  const buckets = createBoundedCache(maxKeys);
  return {
    consume: (key, cost = 1) => {
      const now2 = Date.now();
      const cur = buckets.get(key);
      if (!cur) {
        if (burst < cost) return false;
        buckets.set(key, [burst - cost, now2]);
        return true;
      }
      const elapsedSec = Math.max(0, now2 - cur[1]) / 1e3;
      if (elapsedSec > 0) {
        cur[0] = Math.min(burst, cur[0] + elapsedSec * ratePerSec);
        cur[1] = now2;
      }
      if (cur[0] < cost) return false;
      cur[0] -= cost;
      return true;
    },
    delete: (key) => {
      buckets.delete(key);
    },
    clear: () => {
      buckets.clear();
    }
  };
};

// node_modules/@trystero-p2p/core/dist/relay-manager.mjs
var { min } = Math;
var defaultRetryMs = 3333;
var maxRetryMs = 6e4;
var socketClosedErr = /* @__PURE__ */ mkErr("relay socket closed");
var socketRetryPeriods = /* @__PURE__ */ createBoundedCache(256);
var hasLiveSocket = (s) => s.phase === "connecting" || s.phase === "open";
var isSocketDormant = (s) => s.phase === "backoff-wait" || s.phase === "parked-offline";
var socketControllers = /* @__PURE__ */ new Set();
var socketWakeFns = /* @__PURE__ */ new WeakMap();
var defaultIsRelayClosed = (relay) => Boolean(relay.isClosed);
var relayConnectivity = "auto";
var isRelayOffline = false;
var stopWatchingOnline = null;
var getRelays = (config, defaults, defaultN, deriveFromAppId = false) => config.relayConfig?.urls || (deriveFromAppId ? shuffle(defaults, strToNum(config.appId)) : defaults).slice(0, config.relayConfig?.redundancy ?? defaultN);
var holdRelaySockets = () => {
  isRelayOffline = true;
  socketControllers.forEach((c) => c[0]());
};
var reconnectRelaySockets = () => {
  isRelayOffline = false;
  socketRetryPeriods.clear();
  socketControllers.forEach((c) => c[1]());
};
var attachOnlineWatcher = () => {
  if (stopWatchingOnline || typeof addEventListener !== "function") return;
  const controller = new AbortController();
  const { signal } = controller;
  addEventListener("online", reconnectRelaySockets, { signal });
  addEventListener("offline", holdRelaySockets, { signal });
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("visibilitychange", () => {
    if (!isRelayOffline && document.visibilityState === "visible") reconnectRelaySockets();
  }, { signal });
  stopWatchingOnline = () => controller.abort();
};
var detachWebSocket = (socket) => {
  socket.onopen = socket.onclose = socket.onmessage = null;
  socket.close();
};
var makeSocket = (url, onMessage, onReconnect) => {
  const client = {
    url,
    isClosed: false,
    send: noOp2
  };
  const failureWaiters = /* @__PURE__ */ new Set();
  let lifecycle = {
    phase: "parked-offline",
    didOpen: false
  };
  const settleAttempt = (err) => {
    failureWaiters.forEach((w) => w(err));
    failureWaiters.clear();
  };
  const createReadyGate = () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    promise.catch(noOp2);
    Object.defineProperty(promise, socketInitialFailureSymbol, {
      value: () => {
        if (lifecycle.phase === "open" || lifecycle.phase === "closed" || isRelayOffline) return Promise.resolve(null);
        if (lifecycle.phase === "backoff-wait" && lifecycle.attemptFailure) return Promise.resolve(lifecycle.attemptFailure);
        return new Promise((res) => {
          failureWaiters.add(res);
        });
      },
      enumerable: false,
      configurable: true
    });
    return {
      promise,
      resolve,
      reject
    };
  };
  let readyGate = createReadyGate();
  client.ready = readyGate.promise;
  const rotateReadyGateAfterDisconnect = () => {
    readyGate = createReadyGate();
    client.ready = readyGate.promise;
  };
  if (relayConnectivity === "auto") attachOnlineWatcher();
  const getDidOpen = (state) => state.phase === "open" ? true : state.didOpen;
  const init = () => {
    switch (lifecycle.phase) {
      case "closed":
      case "connecting":
      case "open":
        return;
      case "backoff-wait":
        clearTimeout(lifecycle.timer);
        if (isRelayOffline) {
          lifecycle = {
            phase: "parked-offline",
            didOpen: lifecycle.didOpen
          };
          return;
        }
        break;
      case "parked-offline":
        if (isRelayOffline) return;
        break;
      default:
        unreachable(lifecycle);
    }
    const didOpen = lifecycle.didOpen;
    const socket = new WebSocket(url);
    client.socket = socket;
    client.url = socket.url ?? url;
    lifecycle = {
      phase: "connecting",
      socket,
      didOpen
    };
    socket.onclose = () => {
      if (!hasLiveSocket(lifecycle) || lifecycle.socket !== socket) return;
      const wasOpen = lifecycle.phase === "open";
      const nextDidOpen = getDidOpen(lifecycle);
      client.send = noOp2;
      if (wasOpen) rotateReadyGateAfterDisconnect();
      if (isRelayOffline) {
        lifecycle = {
          phase: "parked-offline",
          didOpen: nextDidOpen
        };
        if (!wasOpen) settleAttempt(null);
        return;
      }
      const attemptFailure = wasOpen ? null : mkErr(`failed to connect to relay ${client.url}`);
      if (attemptFailure) settleAttempt(attemptFailure);
      const period = socketRetryPeriods.get(url) ?? defaultRetryMs;
      socketRetryPeriods.set(url, period);
      const timer = setTimeout(init, Math.random() * period);
      socketRetryPeriods.set(url, min(period * 2, maxRetryMs));
      lifecycle = {
        phase: "backoff-wait",
        didOpen: nextDidOpen,
        timer,
        attemptFailure
      };
    };
    socket.onmessage = (e) => {
      try {
        onMessage(String(e.data));
      } catch {
      }
    };
    socket.onopen = () => {
      if (lifecycle.phase !== "connecting" || lifecycle.socket !== socket) return;
      const isReconnect = lifecycle.didOpen;
      lifecycle = {
        phase: "open",
        socket
      };
      settleAttempt(null);
      readyGate.resolve(client);
      socketRetryPeriods.set(url, defaultRetryMs);
      if (isReconnect) onReconnect?.();
    };
    client.send = (data) => {
      if (socket.readyState === 1) socket.send(data);
    };
  };
  const controller = [() => {
    switch (lifecycle.phase) {
      case "closed":
      case "parked-offline":
        return;
      case "backoff-wait":
        clearTimeout(lifecycle.timer);
        lifecycle = {
          phase: "parked-offline",
          didOpen: lifecycle.didOpen
        };
        settleAttempt(null);
        return;
      case "connecting":
      case "open": {
        const wasOpen = lifecycle.phase === "open";
        const didOpen = getDidOpen(lifecycle);
        const activeSocket = lifecycle.socket;
        client.send = noOp2;
        lifecycle = {
          phase: "parked-offline",
          didOpen
        };
        if (wasOpen) rotateReadyGateAfterDisconnect();
        settleAttempt(null);
        detachWebSocket(activeSocket);
        return;
      }
      default:
        unreachable(lifecycle);
    }
  }, () => {
    if (lifecycle.phase === "closed") return;
    socketRetryPeriods.set(url, defaultRetryMs);
    if (isSocketDormant(lifecycle)) init();
  }];
  socketControllers.add(controller);
  socketWakeFns.set(client, () => {
    if (!isRelayOffline && isSocketDormant(lifecycle)) controller[1]();
  });
  client.close = () => {
    if (lifecycle.phase === "closed") return;
    const prev = lifecycle;
    client.isClosed = true;
    client.send = noOp2;
    lifecycle = { phase: "closed" };
    settleAttempt(null);
    readyGate.reject(socketClosedErr);
    socketControllers.delete(controller);
    socketWakeFns.delete(client);
    socketRetryPeriods.delete(url);
    switch (prev.phase) {
      case "parked-offline":
        break;
      case "backoff-wait":
        clearTimeout(prev.timer);
        break;
      case "connecting":
      case "open":
        detachWebSocket(prev.socket);
        break;
      default:
        unreachable(prev);
    }
  };
  if (!isRelayOffline) init();
  return client;
};
var createRelayScopedStore = () => {
  const store = /* @__PURE__ */ new WeakMap();
  return { forRelay: (relay) => {
    let map = store.get(relay);
    if (!map) {
      map = /* @__PURE__ */ Object.create(null);
      store.set(relay, map);
    }
    return map;
  } };
};
var relayLeaseReleases = /* @__PURE__ */ new WeakMap();
var releaseRelayLease = (leaseTarget) => {
  if (leaseTarget && typeof leaseTarget === "object") {
    const release = relayLeaseReleases.get(leaseTarget);
    if (release) {
      relayLeaseReleases.delete(leaseTarget);
      release();
    }
  }
};
var createRelayManager = (getSocket, closeRelay, isRelayClosed) => {
  const pooledByKey = /* @__PURE__ */ new Map();
  const relayKeys = /* @__PURE__ */ new WeakMap();
  const leaseCounts = /* @__PURE__ */ new WeakMap();
  const closedRelays = /* @__PURE__ */ new WeakSet();
  const checkClosed = isRelayClosed ?? defaultIsRelayClosed;
  const unpool = (relay) => {
    const key = relayKeys.get(relay);
    if (key !== void 0 && pooledByKey.get(key) === relay) pooledByKey.delete(key);
  };
  return {
    register: (key, createRelay) => {
      let relay = pooledByKey.get(key);
      if (relay && checkClosed(relay)) {
        unpool(relay);
        leaseCounts.delete(relay);
        relay = void 0;
      }
      if (!relay) {
        relay = createRelay();
        pooledByKey.set(key, relay);
        relayKeys.set(relay, key);
      } else socketWakeFns.get(relay)?.();
      return relay;
    },
    lease: (relay, readyP) => {
      socketWakeFns.get(relay)?.();
      leaseCounts.set(relay, (leaseCounts.get(relay) ?? 0) + 1);
      const leasedP = Promise.resolve(readyP).then((r) => r);
      leasedP.catch(noOp2);
      const getInitialFailure = readyP[socketInitialFailureSymbol];
      if (typeof getInitialFailure === "function") Object.defineProperty(leasedP, socketInitialFailureSymbol, {
        value: getInitialFailure,
        enumerable: false,
        configurable: true
      });
      let released = false;
      relayLeaseReleases.set(leasedP, () => {
        if (released) return;
        released = true;
        const prev = leaseCounts.get(relay);
        if (!prev || prev <= 0) return;
        if (prev > 1) {
          leaseCounts.set(relay, prev - 1);
          return;
        }
        leaseCounts.delete(relay);
        unpool(relay);
        if (!closedRelays.has(relay) && !checkClosed(relay)) {
          closedRelays.add(relay);
          closeRelay?.(relay);
        }
      });
      return leasedP;
    },
    evict: unpool,
    getSockets: () => fromEntries([...pooledByKey.entries()].flatMap(([key, relay]) => {
      const socket = checkClosed(relay) ? void 0 : getSocket(relay);
      return socket ? [[key, socket]] : [];
    }))
  };
};

// node_modules/@trystero-p2p/core/dist/data-limits.mjs
var maxActionFrameBytes = 16384;
var maxBulkFrameBytes = 65536;
var maxRoomFrameBytes = 17408;
var pendingDataTimeoutMs = 1e4;
var transferTimeoutMs = 12e4;

// node_modules/@trystero-p2p/core/dist/action-wire.mjs
var inlineKind = 0;
var offerKind = 1;
var chunkKind = 2;
var acceptedKind = 3;
var rejectedKind = 4;
var cancelledKind = 5;
var wideBulkFlag = 64;
var inlineHeaderSize = 36;
var offerHeaderSize = 48;
var controlHeaderSize = 6;
var chunkHeaderSize = 14;
var minChunkSize = maxActionFrameBytes - chunkHeaderSize;
var maxChunkSize = maxBulkFrameBytes - chunkHeaderSize;
var defaultMaxReceiveBytes = 256 * 1024 ** 2;
var maxControlBufferedBytes = 1024 ** 2;
var maxPendingTransfers = 1024;
var maxPendingPerPeer = 64;
var maxDecisions = 128;
var maxDecisionsPerPeer = 8;
var maxPreListenerMessages = 32;
var sizeLimitMsg = "payload exceeds receiver size limit";
var invalidPayloadMsg = invalidActionMsg("payload");
var textFormat = 0;
var jsonFormat = 1;
var binaryFormat = 2;
var bulkPhaseClass = {
  pending: {
    waiting: true,
    reserved: false,
    active: false,
    admitted: false
  },
  deciding: {
    waiting: true,
    reserved: false,
    active: false,
    admitted: false
  },
  queued: {
    waiting: true,
    reserved: false,
    active: false,
    admitted: true
  },
  accepted: {
    waiting: false,
    reserved: true,
    active: true,
    admitted: true
  },
  receiving: {
    waiting: false,
    reserved: true,
    active: true,
    admitted: true
  },
  buffered: {
    waiting: false,
    reserved: true,
    active: false,
    admitted: true
  },
  closed: {
    waiting: false,
    reserved: false,
    active: false,
    admitted: false
  }
};
var isBulkSettled = (s) => s.phase === "failed" || s.phase === "done";
var makeActionError = (kind, message) => {
  const error = Object.assign(mkErr(message), { kind });
  if (kind === "aborted") error.name = "AbortError";
  return error;
};
var throwIfAborted = (signal) => {
  if (signal?.aborted) throw makeActionError("aborted", operationAbortedMsg);
};
var viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
var buildControlPacket = (kind, id, size = controlHeaderSize) => {
  const bytes = new Uint8Array(size);
  bytes[0] = 3;
  bytes[1] = kind;
  viewOf(bytes).setUint32(2, id);
  return bytes;
};
var startIdleTimer = (getLast, onTimeout, onReschedule) => {
  const tick = () => {
    const remaining = transferTimeoutMs - (Date.now() - getLast());
    if (remaining > 0) {
      const next = setTimeout(tick, remaining);
      unrefTimer(next);
      onReschedule(next);
    } else onTimeout();
  };
  const initial = setTimeout(tick, transferTimeoutMs);
  unrefTimer(initial);
  return initial;
};
var decodeActionType = (frame) => decodeBytes(frame.subarray(2, 34)).replaceAll("\0", "");
var decideReceive = (decide, settle) => {
  let result;
  try {
    result = decide();
  } catch {
    return settle(false);
  }
  return typeof result === "boolean" ? settle(result) : Promise.resolve(result).then((value) => settle(value === true), () => settle(false));
};
var decodePayload = (bytes, format, copy) => format === binaryFormat ? copy ? bytes.slice() : bytes : format === jsonFormat ? fromJson(decodeBytes(bytes)) : decodeBytes(bytes);
var emitRxProgress = (registration, value, peerId, metadata) => {
  try {
    registration.onProgress(value, peerId, metadata);
  } catch (error) {
    logErr("progress handler", error);
  }
};
var deliverPayload = (registration, data, peerId, metadata) => {
  emitRxProgress(registration, 1, peerId, metadata);
  try {
    registration.receiver?.(data, peerId, metadata);
  } catch (error) {
    logActionHandlerErr(error);
  }
};
var createActionWireManager = ({ resolveTransport, getPeerIds, canReceiveFromPeer, onPeerError, broadcastInline, checkAborted = throwIfAborted, onUnknownType, maxReceiveBytes = defaultMaxReceiveBytes }) => {
  if (!Number.isSafeInteger(maxReceiveBytes) || maxReceiveBytes <= 0) throw posSafeIntErr("maxReceiveBytes");
  const actions = /* @__PURE__ */ new Map();
  const rxActions = /* @__PURE__ */ new Map();
  const outgoing = /* @__PURE__ */ new Map();
  const outgoingInlineQueues = /* @__PURE__ */ new Map();
  const peers = /* @__PURE__ */ new Map();
  const preListenerQueues = /* @__PURE__ */ new Map();
  const waitingBulk = /* @__PURE__ */ new Set();
  const decisions = /* @__PURE__ */ new Map();
  const failedTransports = /* @__PURE__ */ new WeakSet();
  let preListenerSweepTimer = null;
  let nextTransferId = 0;
  let pendingCount = 0;
  let decisionCount = 0;
  let reservedBytes = 0;
  let draining = false;
  let drainDirty = false;
  const disconnectedTransferErr = () => makeActionError("disconnected", peerDisconnectedMsg);
  const invalidFrameMsg = invalidActionMsg("frame");
  const isCurrent = (transfer) => transfer.state.phase !== "closed";
  const payloadLimit = (registration) => Math.min(maxReceiveBytes, registration?.maxPayloadBytes ?? maxReceiveBytes);
  const markDrainDirty = () => {
    if (draining) drainDirty = true;
  };
  const failPeer = (peerId, reason, protocolViolation = true) => {
    const target = resolveTransport(peerId, true);
    if (target && !failedTransports.has(target)) {
      failedTransports.add(target);
      warn(`${reason}; disconnecting peer ${peerId}`);
      onPeerError(peerId, protocolViolation ? mkViolationErr(reason) : mkErr(reason));
    }
  };
  const sendControlFrame = (peerId, target, id, kind, reason = "") => {
    if (!target || !target.isOpen) return;
    const text = encodeBytes(reason).subarray(0, 200);
    const bytes = buildControlPacket(kind, id, controlHeaderSize + text.length);
    bytes.set(text, controlHeaderSize);
    try {
      if (target.bufferedAmount > maxControlBufferedBytes) throw mkErr("control send buffer is full");
      target.sendFrame(bytes, id);
    } catch {
      failPeer(peerId, "unable to send action control", false);
    }
  };
  const sendControl = (peerId, id, kind, reason = "") => {
    sendControlFrame(peerId, resolveTransport(peerId, true), id, kind, reason);
  };
  const notifyRejected = (message, reason, scope, bulkId) => {
    scope?.[3](reason);
    rxActions.get(message.type)?.onReject?.(message.peerId, message.metadata, reason);
    if (bulkId !== void 0) sendControl(message.peerId, bulkId, rejectedKind, reason);
  };
  const rotateWaitingForPeer = (peerId) => {
    for (const queued of Array.from(waitingBulk)) if (queued.message.peerId === peerId) {
      waitingBulk.delete(queued);
      waitingBulk.add(queued);
    }
  };
  const releaseDecisionSlot = (peerId) => {
    decisionCount--;
    const count = (decisions.get(peerId) ?? 1) - 1;
    if (count > 0) decisions.set(peerId, count);
    else decisions.delete(peerId);
  };
  const transitionBulk = (transfer, next) => {
    const from = bulkPhaseClass[transfer.state.phase];
    const to = bulkPhaseClass[next.phase];
    const { peerId, size } = transfer.message;
    const peer = peers.get(peerId);
    if (from.reserved !== to.reserved) {
      reservedBytes += to.reserved ? size : -size;
      if (!to.reserved) markDrainDirty();
    }
    if (from.waiting !== to.waiting) {
      if (to.waiting) waitingBulk.add(transfer);
      else waitingBulk.delete(transfer);
    }
    if (from.active !== to.active && peer) {
      if (to.active) peer.activeBulk = transfer;
      else if (peer.activeBulk === transfer) {
        peer.activeBulk = null;
        rotateWaitingForPeer(peerId);
      }
    }
    transfer.state = next;
    if (next.phase === "buffered") markDrainDirty();
  };
  const releaseTransfer = (transfer) => {
    if (transfer.state.phase === "closed") return false;
    const { peerId } = transfer.message;
    const peer = peers.get(peerId);
    transfer.unbindScopeAbort?.();
    transfer.unbindScopeAbort = null;
    transfer.timer = resetTimer(transfer.timer);
    const admissionController = transfer.controller;
    transfer.controller = null;
    if (transfer.kind === "inline") {
      transfer.state = { phase: "closed" };
      const queue = peer?.inlineQueues.get(transfer.queueKey);
      if (queue) {
        const idx = queue.indexOf(transfer);
        if (idx >= 0) queue.splice(idx, 1);
        if (!queue.length) peer.inlineQueues.delete(transfer.queueKey);
      }
    } else {
      peer?.bulkTransfers.delete(transfer.transferId);
      transitionBulk(transfer, { phase: "closed" });
    }
    if (peer) {
      peer.pendingCount--;
      pendingCount--;
      if (!peer.pendingCount) peers.delete(peerId);
    }
    admissionController?.abort();
    return true;
  };
  const rejectRx = (transfer, reason) => {
    if (!releaseTransfer(transfer)) return;
    notifyRejected(transfer.message, reason, transfer.scope, transfer.kind === "bulk" ? transfer.transferId : void 0);
  };
  const enterDeciding = (transfer) => {
    if (transfer.state.phase !== "pending") return null;
    const { peerId } = transfer.message;
    if (decisionCount >= maxDecisions || (decisions.get(peerId) ?? 0) >= maxDecisionsPerPeer) {
      rejectRx(transfer, "too many pending receive decisions");
      return null;
    }
    const controller = new AbortController();
    transfer.controller = controller;
    decisionCount++;
    decisions.set(peerId, (decisions.get(peerId) ?? 0) + 1);
    if (transfer.kind === "inline") transfer.state = {
      phase: "deciding",
      data: transfer.state.data
    };
    else transitionBulk(transfer, { phase: "deciding" });
    return controller;
  };
  const enterReady = (transfer) => {
    if (transfer.kind === "inline") switch (transfer.state.phase) {
      case "pending":
      case "deciding":
        transfer.state = {
          phase: "ready",
          data: transfer.state.data
        };
        return true;
      case "ready":
        return true;
      case "closed":
        return false;
      default:
        return unreachable(transfer.state);
    }
    switch (transfer.state.phase) {
      case "pending":
      case "deciding":
        transitionBulk(transfer, { phase: "queued" });
        return true;
      case "queued":
      case "accepted":
      case "receiving":
      case "buffered":
        return true;
      case "closed":
        return false;
      default:
        return unreachable(transfer.state);
    }
  };
  const acceptBulk = (transfer) => {
    if (transfer.state.phase !== "queued") return;
    const peer = peers.get(transfer.message.peerId);
    if (!peer || peer.activeBulk !== null || reservedBytes + transfer.message.size > maxReceiveBytes) return;
    transfer.lastSeenAt = Date.now();
    transitionBulk(transfer, { phase: "accepted" });
    sendControl(transfer.message.peerId, transfer.transferId, acceptedKind);
  };
  const beginReceivingChunks = (transfer) => {
    switch (transfer.state.phase) {
      case "receiving":
        return transfer.state;
      case "accepted": {
        const totalSize = transfer.message.size;
        try {
          const nextState = {
            phase: "receiving",
            data: new Uint8Array(totalSize),
            seenChunks: new Uint8Array(Math.ceil(Math.ceil(totalSize / transfer.chunkSize) / 8)),
            offset: 0
          };
          transitionBulk(transfer, nextState);
          return nextState;
        } catch {
          rejectRx(transfer, "unable to allocate receive buffer");
          drain();
          return null;
        }
      }
      case "pending":
      case "deciding":
      case "queued":
      case "buffered":
      case "closed":
        return null;
      default:
        return unreachable(transfer.state);
    }
  };
  const parkCompletedBulk = (transfer) => {
    if (transfer.state.phase !== "receiving") return;
    const { data } = transfer.state;
    transitionBulk(transfer, {
      phase: "buffered",
      data
    });
  };
  const isAdmittedTransfer = (transfer) => transfer.kind === "inline" ? transfer.state.phase === "ready" : bulkPhaseClass[transfer.state.phase].admitted;
  const admit = (transfer, registration) => {
    if (transfer.state.phase !== "pending") return isAdmittedTransfer(transfer);
    if (transfer.message.size > payloadLimit(registration)) {
      rejectRx(transfer, sizeLimitMsg);
      return false;
    }
    const receive = transfer.scope ? transfer.scope[2] : registration.receiveGate;
    if (!receive) {
      if (!registration.receiver) return false;
      return enterReady(transfer);
    }
    const controller = enterDeciding(transfer);
    if (!controller) return false;
    const { peerId } = transfer.message;
    let settled = false;
    const result = decideReceive(() => receive({
      byteLength: transfer.message.size,
      peerId,
      signal: controller.signal,
      ...transfer.message.metadata === void 0 ? {} : { metadata: transfer.message.metadata }
    }), (allow) => {
      if (!settled) {
        settled = true;
        releaseDecisionSlot(peerId);
      }
      if (transfer.state.phase !== "deciding") return false;
      if (allow) return enterReady(transfer);
      rejectRx(transfer, "payload rejected by receiver");
      return false;
    });
    if (typeof result === "boolean") return result;
    result.then(() => drain());
    return false;
  };
  const complete = (transfer, registration, bytes, copyBinary) => {
    let payload;
    try {
      payload = decodePayload(bytes, transfer.message.format, copyBinary);
    } catch {
      releaseTransfer(transfer);
      failPeer(transfer.message.peerId, invalidPayloadMsg);
      return;
    }
    releaseTransfer(transfer);
    deliverPayload(registration, payload, transfer.message.peerId, transfer.message.metadata);
  };
  const tryInline = (transfer) => {
    const registration = rxActions.get(transfer.message.type);
    if (!registration) return;
    if (transfer.state.phase === "pending" && !admit(transfer, registration)) return;
    if (transfer.state.phase !== "ready") return;
    if (registration.receiver) complete(transfer, registration, transfer.state.data, true);
    else if (!transfer.scope) {
      const { data } = transfer.state;
      const { lastSeenAt, message } = transfer;
      releaseTransfer(transfer);
      bufferPreListenerInline(message, data, true, true, lastSeenAt);
    }
  };
  const tryBulk = (transfer) => {
    const registration = rxActions.get(transfer.message.type);
    if (!registration) return;
    switch (transfer.state.phase) {
      case "pending":
        if (admit(transfer, registration) && registration.receiver) acceptBulk(transfer);
        return;
      case "queued":
        if (registration.receiver) acceptBulk(transfer);
        return;
      case "buffered":
        if (registration.receiver) complete(transfer, registration, transfer.state.data, false);
        return;
      case "deciding":
      case "accepted":
      case "receiving":
      case "closed":
        return;
      default:
        unreachable(transfer.state);
    }
  };
  const drainInline = (peerId, queueKey) => {
    const queue = peers.get(peerId)?.inlineQueues.get(queueKey);
    while (queue?.[0]) {
      const head = queue[0];
      tryInline(head);
      if (isCurrent(head)) break;
    }
  };
  const drain = () => {
    if (draining) {
      drainDirty = true;
      return;
    }
    draining = true;
    try {
      do {
        drainDirty = false;
        for (const transfer of waitingBulk) tryBulk(transfer);
        for (const [id, peer] of peers) {
          for (const transfer of peer.bulkTransfers.values()) if (transfer.state.phase === "buffered") tryBulk(transfer);
          for (const key of peer.inlineQueues.keys()) drainInline(id, key);
        }
      } while (drainDirty);
    } finally {
      draining = false;
      drainDirty = false;
    }
  };
  const ensurePreListenerSweepTimer = () => {
    if (!preListenerSweepTimer) {
      preListenerSweepTimer = setTimeout(sweepPreListenerQueues, pendingDataTimeoutMs);
      unrefTimer(preListenerSweepTimer);
    }
  };
  const sweepPreListenerQueues = () => {
    preListenerSweepTimer = resetTimer(preListenerSweepTimer);
    const now2 = Date.now();
    let hasRemaining = false;
    for (const [peerId, byType] of preListenerQueues) {
      for (const [type, ring] of byType) {
        while (ring.length > 0 && now2 - ring[0].receivedAt > 1e4) ring.shift();
        if (ring.length === 0) byType.delete(type);
        else hasRemaining = true;
      }
      if (byType.size === 0) preListenerQueues.delete(peerId);
    }
    if (hasRemaining) ensurePreListenerSweepTimer();
  };
  const bufferPreListenerInline = (message, dataSlice, admitted = false, alreadyOwned = false, receivedAt = Date.now()) => {
    const now2 = Date.now();
    let byType = preListenerQueues.get(message.peerId);
    if (!byType) {
      byType = /* @__PURE__ */ new Map();
      preListenerQueues.set(message.peerId, byType);
    }
    let ring = byType.get(message.type);
    if (!ring) {
      ring = [];
      byType.set(message.type, ring);
    }
    while (ring.length > 0 && now2 - ring[0].receivedAt > 1e4) ring.shift();
    if (ring.length >= maxPreListenerMessages) ring.shift();
    ring.push({
      admitted,
      message,
      data: alreadyOwned ? dataSlice : dataSlice.slice(),
      receivedAt
    });
    ensurePreListenerSweepTimer();
  };
  const createTransferBase = (message, scope) => ({
    message,
    scope,
    unbindScopeAbort: null,
    controller: null,
    lastSeenAt: Date.now(),
    timer: null
  });
  const ensureIdleTimer = (transfer) => {
    if (!isCurrent(transfer) || transfer.timer) return;
    transfer.timer = startIdleTimer(() => transfer.lastSeenAt, () => {
      rejectRx(transfer, "action transfer timed out");
      drain();
    }, (nextTimer) => {
      if (isCurrent(transfer)) transfer.timer = nextTimer;
      else clearTimeout(nextTimer);
    });
  };
  const enqueueTransfer = (transfer, deferTimer = false) => {
    const { peerId } = transfer.message;
    let peer = peers.get(peerId);
    if (pendingCount >= maxPendingTransfers || (peer?.pendingCount ?? 0) >= maxPendingPerPeer) {
      notifyRejected(transfer.message, "too many pending transfers", transfer.scope, transfer.kind === "bulk" ? transfer.transferId : void 0);
      return false;
    }
    if (!peer) {
      peer = {
        bulkTransfers: /* @__PURE__ */ new Map(),
        inlineQueues: /* @__PURE__ */ new Map(),
        activeBulk: null,
        pendingCount: 0
      };
      peers.set(peerId, peer);
    }
    peer.pendingCount++;
    pendingCount++;
    if (transfer.kind === "inline") {
      const queue = peer.inlineQueues.get(transfer.queueKey) ?? [];
      queue.push(transfer);
      peer.inlineQueues.set(transfer.queueKey, queue);
    } else {
      peer.bulkTransfers.set(transfer.transferId, transfer);
      transitionBulk(transfer, { phase: "pending" });
    }
    if (!deferTimer) ensureIdleTimer(transfer);
    if (transfer.scope) {
      const sig = transfer.scope[1];
      const cancel = () => {
        rejectRx(transfer, "receive cancelled");
        drain();
      };
      if (sig.aborted) {
        cancel();
        return false;
      }
      const ac = new AbortController();
      sig.addEventListener("abort", cancel, {
        once: true,
        signal: ac.signal
      });
      transfer.unbindScopeAbort = () => ac.abort();
    }
    return true;
  };
  const flushPreListenerType = (type, registration) => {
    const isFlushable = () => Boolean(registration.receiver || registration.receiveGate);
    if (!isFlushable()) return;
    const now2 = Date.now();
    for (const peerId of Array.from(preListenerQueues.keys())) {
      if (!isFlushable()) break;
      while (isFlushable()) {
        const byType = preListenerQueues.get(peerId);
        const ring = byType?.get(type);
        if (!ring || ring.length === 0) {
          if (byType) {
            byType.delete(type);
            if (byType.size === 0) preListenerQueues.delete(peerId);
          }
          break;
        }
        if (now2 - ring[0].receivedAt > 1e4) {
          ring.shift();
          continue;
        }
        if (ring[0].admitted && !registration.receiver) break;
        const entry = ring.shift();
        if (ring.length === 0) {
          byType.delete(type);
          if (byType.size === 0) preListenerQueues.delete(peerId);
        }
        if (entry.message.size > payloadLimit(registration)) {
          notifyRejected(entry.message, sizeLimitMsg);
          continue;
        }
        if (entry.admitted || registration.receiver && !registration.receiveGate && !peers.get(peerId)?.inlineQueues.has(type)) {
          let payload;
          try {
            payload = decodePayload(entry.data, entry.message.format, false);
          } catch {
            if (byType) {
              byType.delete(type);
              if (byType.size === 0) preListenerQueues.delete(peerId);
            }
            failPeer(peerId, invalidPayloadMsg);
            break;
          }
          deliverPayload(registration, payload, peerId, entry.message.metadata);
        } else {
          const transfer = {
            ...createTransferBase(entry.message),
            kind: "inline",
            queueKey: type,
            state: {
              phase: "pending",
              data: entry.data
            }
          };
          if (enqueueTransfer(transfer, true)) {
            drainInline(peerId, type);
            ensureIdleTimer(transfer);
          }
        }
      }
    }
  };
  const resolveAdmission = (message, bulkId) => {
    const registration = rxActions.get(message.type);
    if (!registration) {
      if (bulkId !== void 0) sendControl(message.peerId, bulkId, rejectedKind, "unregistered action");
      return null;
    }
    const scope = registration.receiveScope?.(message.peerId, message.metadata);
    if (scope === null || scope?.[1].aborted) {
      if (bulkId !== void 0) sendControl(message.peerId, bulkId, rejectedKind, "unexpected response");
      return null;
    }
    if (message.size > payloadLimit(registration)) {
      notifyRejected(message, sizeLimitMsg, scope, bulkId);
      return null;
    }
    return [registration, scope];
  };
  const clearPeer = (peerId) => {
    for (const transfer of outgoing.get(peerId)?.values() ?? []) transfer.fail(disconnectedTransferErr());
    outgoing.delete(peerId);
    outgoingInlineQueues.delete(peerId);
    preListenerQueues.delete(peerId);
    const peer = peers.get(peerId);
    if (peer) {
      for (const transfer of Array.from(peer.bulkTransfers.values())) releaseTransfer(transfer);
      for (const queue of Array.from(peer.inlineQueues.values())) queue.slice().forEach((transfer) => {
        releaseTransfer(transfer);
      });
    }
    drain();
  };
  const raceAbort = (p, signal) => new Promise((resolve, reject) => {
    const onAbort = () => {
      try {
        checkAborted(signal);
      } catch (err) {
        reject(err);
      }
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    const ac = new AbortController();
    signal.addEventListener("abort", onAbort, {
      once: true,
      signal: ac.signal
    });
    p.then(resolve, reject).finally(() => {
      ac.abort();
    });
  });
  const sendFrameToTransport = async (transport, bytes, check, signal, transferId, isOffer, initialDrain, onBeforeSend, onSendFailed) => {
    check();
    const drainRes = initialDrain ?? transport.waitForDrain(signal);
    if (drainRes !== true) {
      if (!await drainRes) {
        checkAborted(signal);
        throw makeActionError("disconnected", "data channel stopped draining");
      }
      check();
    }
    onBeforeSend?.();
    try {
      transport.sendFrame(bytes, transferId, isOffer);
    } catch {
      const err = disconnectedTransferErr();
      onSendFailed?.(err);
      throw err;
    }
  };
  const sendBulkToPeer = async (peerId, transport, offerFrame, transferId, source, size, metadata, progressCb, signal) => {
    const { promise: permission, resolve: acceptOffer, reject: rejectOffer } = Promise.withResolvers();
    permission.catch(noOp2);
    const transfers = outgoing.get(peerId) ?? /* @__PURE__ */ new Map();
    if (transfers.has(transferId)) throw mkErr("action transfer id in use");
    outgoing.set(peerId, transfers);
    const failTransfer = (error, fromReceiver = false, didSendOfferOverride) => {
      if (isBulkSettled(bulkState)) return;
      let didSendOffer = true;
      if (bulkState.phase === "offering") {
        didSendOffer = bulkState.sent;
        clearTimeout(bulkState.timer);
        bulkState = {
          phase: "failed",
          error,
          fromReceiver,
          didSendOffer: didSendOfferOverride ?? didSendOffer
        };
        rejectOffer(error);
        return;
      }
      bulkState = {
        phase: "failed",
        error,
        fromReceiver,
        didSendOffer: didSendOfferOverride ?? didSendOffer
      };
    };
    let bulkState = {
      phase: "offering",
      sent: false,
      timer: startIdleTimer(() => bulkState.phase === "offering" ? bulkState.lastSeen : 0, () => failTransfer(makeActionError("timeout", "action offer timed out")), (nextTimer) => {
        if (bulkState.phase === "offering") bulkState.timer = nextTimer;
        else clearTimeout(nextTimer);
      }),
      lastSeen: Date.now()
    };
    const currentBulkState = () => bulkState;
    const check = () => {
      if (bulkState.phase === "failed") throw bulkState.error;
      try {
        checkAborted(signal);
        if (!transport.isOpen) throw disconnectedTransferErr();
      } catch (err) {
        failTransfer(err);
        throw err;
      }
    };
    transfers.set(transferId, {
      accept: () => {
        if (bulkState.phase === "offering" && bulkState.sent) {
          clearTimeout(bulkState.timer);
          bulkState = { phase: "streaming" };
          acceptOffer();
          return true;
        }
        return false;
      },
      fail: (error, fromReceiver = false) => {
        failTransfer(error, fromReceiver);
      },
      touch: () => {
        if (bulkState.phase === "offering") bulkState.lastSeen = Date.now();
      }
    });
    const abortCleanup = signal ? new AbortController() : null;
    if (abortCleanup && signal) signal.addEventListener("abort", () => {
      try {
        checkAborted(signal);
      } catch (error) {
        failTransfer(error);
      }
    }, {
      once: true,
      signal: abortCleanup.signal
    });
    try {
      const useWideChunks = (transport.maxBulkFrameBytes ?? 16384) >= maxBulkFrameBytes;
      const txChunkSize = useWideChunks ? maxChunkSize : minChunkSize;
      let peerOfferFrame = offerFrame;
      if (useWideChunks) {
        peerOfferFrame = offerFrame.slice();
        peerOfferFrame[1] = peerOfferFrame[1] | wideBulkFlag;
      }
      await sendFrameToTransport(transport, peerOfferFrame, check, signal, transferId, true, void 0, () => {
        if (bulkState.phase === "offering") bulkState.sent = true;
      }, (err) => {
        failTransfer(err, false, false);
      });
      await permission;
      for (let offset = 0; offset < size; offset += txChunkSize) {
        check();
        const length = Math.min(txChunkSize, size - offset);
        const bytes = buildControlPacket(chunkKind, transferId, chunkHeaderSize + length);
        viewOf(bytes).setFloat64(controlHeaderSize, offset);
        bytes.set(source instanceof Uint8Array ? source.subarray(offset, offset + length) : new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()), chunkHeaderSize);
        await sendFrameToTransport(transport, bytes, check, signal, transferId);
        transfers.forEach((t) => t.touch());
        progressCb?.((offset + length) / size, peerId, metadata);
      }
      check();
      if (currentBulkState().phase === "streaming") bulkState = { phase: "done" };
    } catch (error) {
      failTransfer(error);
      const failedState = currentBulkState();
      if (failedState.phase === "failed" && failedState.didSendOffer && !failedState.fromReceiver && transport.isOpen && transport.bufferedAmount <= maxControlBufferedBytes) sendControlFrame(peerId, transport, transferId, cancelledKind);
      throw failedState.phase === "failed" ? failedState.error : error;
    } finally {
      const finalState = currentBulkState();
      if (finalState.phase === "offering") clearTimeout(finalState.timer);
      abortCleanup?.abort();
      transfers.delete(transferId);
      if (!transfers.size && outgoing.get(peerId) === transfers) outgoing.delete(peerId);
    }
  };
  const handleControlOrChunk = (peerId, bytes, kind, view) => {
    if (bytes.length < controlHeaderSize || (kind === acceptedKind || kind === cancelledKind) && bytes.length !== controlHeaderSize || kind === rejectedKind && bytes.length > 206) {
      failPeer(peerId, invalidActionMsg("control"));
      return;
    }
    const id = view.getUint32(2);
    if (kind === acceptedKind) {
      const transfers = outgoing.get(peerId);
      if (transfers?.get(id)?.accept()) transfers.forEach((t) => t.touch());
      return;
    }
    if (kind === rejectedKind) {
      outgoing.get(peerId)?.get(id)?.fail(makeActionError("rejected", decodeBytes(bytes.subarray(controlHeaderSize))), true);
      return;
    }
    if (kind === cancelledKind) {
      const transfer2 = peers.get(peerId)?.bulkTransfers.get(id);
      if (transfer2) {
        releaseTransfer(transfer2);
        transfer2.scope?.[3]("response cancelled by sender");
      }
      drain();
      return;
    }
    const offset = bytes.length >= chunkHeaderSize ? view.getFloat64(controlHeaderSize) : NaN;
    const chunkData = bytes.subarray(chunkHeaderSize);
    const transfer = peers.get(peerId)?.bulkTransfers.get(id);
    if (!transfer) return;
    const totalSize = transfer.message.size;
    const rxChunkSize = transfer.chunkSize;
    if (!bulkPhaseClass[transfer.state.phase].active || !Number.isSafeInteger(offset) || offset < 0 || offset >= totalSize || offset % rxChunkSize !== 0 || !chunkData.length || chunkData.length !== Math.min(rxChunkSize, totalSize - offset)) {
      failPeer(peerId, invalidActionMsg("chunk"));
      return;
    }
    const rxState = beginReceivingChunks(transfer);
    if (!rxState) return;
    const chunkIdx = offset / rxChunkSize;
    const byteIdx = chunkIdx >>> 3;
    const bitMask = 1 << (chunkIdx & 7);
    if ((rxState.seenChunks[byteIdx] & bitMask) !== 0) {
      failPeer(peerId, invalidActionMsg("chunk"));
      return;
    }
    rxState.seenChunks[byteIdx] |= bitMask;
    rxState.data.set(chunkData, offset);
    rxState.offset += chunkData.length;
    const now2 = Date.now();
    transfer.lastSeenAt = now2;
    for (const queued of waitingBulk) if (queued.state.phase === "queued" && rxActions.get(queued.message.type)?.receiver) queued.lastSeenAt = now2;
    if (rxState.offset === totalSize) {
      const registration = rxActions.get(transfer.message.type);
      if (registration?.receiver) complete(transfer, registration, rxState.data, false);
      else parkCompletedBulk(transfer);
      drain();
    } else {
      const registration = rxActions.get(transfer.message.type);
      if (registration) emitRxProgress(registration, rxState.offset / totalSize, peerId, transfer.message.metadata);
    }
  };
  const makeWireAction = (type, options = {}) => {
    const sendToPending = Boolean(options.sendToPending);
    const receiveWhilePending = Boolean(options.receiveWhilePending);
    const { maxPayloadBytes, receiveScope } = options;
    const cached = actions.get(type);
    if (cached) {
      if (cached.sendToPending !== sendToPending || cached.receiveWhilePending !== receiveWhilePending || cached.maxPayloadBytes !== maxPayloadBytes || cached.receiveScope !== receiveScope) throw actionRedefinedErr(type);
      return cached.action;
    }
    const typeBytes = encodeBytes(type);
    if (!type || type.includes("\0") || typeBytes.length > 32) throw mkErr("action type must be 1\u201332 non-null UTF-8 bytes");
    const registration = {
      ...maxPayloadBytes === void 0 ? {} : { maxPayloadBytes },
      ...receiveScope ? { receiveScope } : {},
      receiver: null,
      receiveGate: null,
      onReject: null,
      onProgress: noOp2
    };
    rxActions.set(type, registration);
    const actionObj = {
      onMessage: (handler) => {
        registration.receiver = handler;
        flushPreListenerType(type, registration);
        drain();
      },
      onReceive: (handler) => {
        registration.receiveGate = handler;
        if (handler) flushPreListenerType(type, registration);
        drain();
      },
      onReject: (handler) => {
        registration.onReject = handler;
      },
      onProgress: (handler) => {
        registration.onProgress = handler;
      },
      send: async (data, targets, metadata, progressCb, signal) => {
        checkAborted(signal);
        if (data === void 0) throw mkErr("action data cannot be undefined");
        const [format, source] = toPayloadSource(data);
        const size = source instanceof Uint8Array ? source.byteLength : source.size;
        const metaJson = metadata === void 0 ? "" : toJson(metadata);
        const metaByteLen = metadata === void 0 ? 0 : utf8ByteLength(metaJson);
        if (metaByteLen > 16384 - offerHeaderSize) throw mkErr("action metadata is too large");
        const isSmall = inlineHeaderSize + metaByteLen + size <= maxActionFrameBytes;
        const transferId = isSmall ? 0 : nextTransferId++ >>> 0;
        const headerSize = isSmall ? inlineHeaderSize : offerHeaderSize;
        const startFrame = new Uint8Array(headerSize + metaByteLen + (isSmall ? size : 0));
        startFrame[0] = 3;
        startFrame[1] = (isSmall ? inlineKind : offerKind) | format << 4;
        startFrame.set(typeBytes, 2);
        const view = viewOf(startFrame);
        view.setUint16(34, metaByteLen);
        if (!isSmall) {
          view.setUint32(36, transferId);
          view.setFloat64(40, size);
        }
        if (metaByteLen > 0) encodeBytesInto(metaJson, startFrame.subarray(headerSize, headerSize + metaByteLen));
        if (isSmall) startFrame.set(source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer()), headerSize + metaByteLen);
        const isExplicitTarget = targets !== void 0 && targets !== null;
        if (!isExplicitTarget && isSmall && !sendToPending && broadcastInline) {
          const bcastResult = broadcastInline(startFrame, (peerId) => progressCb?.(1, peerId, metadata), signal);
          if (typeof bcastResult === "boolean" ? bcastResult : await bcastResult) return;
        }
        const rawIds = isExplicitTarget ? [targets].flat() : getPeerIds(sendToPending);
        const uniqueIds = [...new Set(rawIds)];
        if (isExplicitTarget && uniqueIds.length === 0) throw makeActionError("disconnected", "target peer list must not be empty");
        const resolvedTargets = [];
        for (const peerId of uniqueIds) {
          const transport = resolveTransport(peerId, sendToPending);
          if (!transport || !transport.isOpen) {
            if (isExplicitTarget) throw makeActionError("disconnected", noActivePeerMsg(peerId));
            continue;
          }
          resolvedTargets.push([peerId, transport]);
        }
        const pendingPromises = [];
        const pushPending = (p) => {
          p.catch(noOp2);
          pendingPromises.push(p);
        };
        for (const [peerId, transport] of resolvedTargets) if (isSmall) {
          checkAborted(signal);
          const prevQueue = outgoingInlineQueues.get(peerId);
          const drainRes = prevQueue ? void 0 : transport.waitForDrain(signal);
          if (drainRes === true) {
            try {
              transport.sendFrame(startFrame);
            } catch {
              throw disconnectedTransferErr();
            }
            progressCb?.(1, peerId, metadata);
            continue;
          }
          const task = (async () => {
            await prevQueue;
            await sendFrameToTransport(transport, startFrame, () => {
              checkAborted(signal);
              if (!transport.isOpen) throw disconnectedTransferErr();
            }, signal, void 0, void 0, drainRes);
            progressCb?.(1, peerId, metadata);
          })();
          const tail = task.catch(noOp2).finally(() => {
            if (outgoingInlineQueues.get(peerId) === tail) outgoingInlineQueues.delete(peerId);
          });
          outgoingInlineQueues.set(peerId, tail);
          pushPending(prevQueue && signal ? raceAbort(task, signal) : task);
        } else pushPending(sendBulkToPeer(peerId, transport, startFrame, transferId, source, size, metadata, progressCb, signal));
        if (pendingPromises.length > 0) await all(pendingPromises);
      }
    };
    actions.set(type, {
      sendToPending,
      receiveWhilePending,
      maxPayloadBytes,
      receiveScope,
      action: actionObj
    });
    return actionObj;
  };
  const handleData = (peerId, data) => {
    if (data.byteLength < 2 || data.byteLength > 65536) {
      failPeer(peerId, invalidFrameMsg);
      return;
    }
    const bytes = new Uint8Array(data);
    if (bytes[0] !== 3) {
      failPeer(peerId, "incompatible action protocol version");
      return;
    }
    const kind = bytes[1] & 15;
    const format = bytes[1] >>> 4 & 3;
    const flags = bytes[1] >>> 6;
    const view = viewOf(bytes);
    if (kind > cancelledKind || format > binaryFormat || flags > (kind === offerKind ? 1 : 0) || kind > offerKind && format !== textFormat || kind !== chunkKind && bytes.length > 16384) {
      failPeer(peerId, invalidFrameMsg);
      return;
    }
    if (kind >= chunkKind) {
      handleControlOrChunk(peerId, bytes, kind, view);
      return;
    }
    const headerSize = kind === inlineKind ? inlineHeaderSize : offerHeaderSize;
    if (bytes.length < headerSize) {
      failPeer(peerId, invalidActionMsg("header"));
      return;
    }
    const type = decodeActionType(bytes);
    let registered = actions.get(type);
    if (!registered && onUnknownType) {
      onUnknownType(type);
      registered = actions.get(type);
    }
    if (!canReceiveFromPeer(peerId, Boolean(registered?.receiveWhilePending))) return;
    const metaLength = view.getUint16(34);
    const payloadIndex = headerSize + metaLength;
    const size = kind === inlineKind ? bytes.length - payloadIndex : view.getFloat64(40);
    const transferId = kind === offerKind ? view.getUint32(36) : 0;
    if (!type || payloadIndex > bytes.length || !Number.isSafeInteger(size) || size < 0 || kind === offerKind && (size === 0 || payloadIndex !== bytes.length)) {
      failPeer(peerId, invalidActionMsg("proposal"));
      return;
    }
    let metadata;
    try {
      if (metaLength) metadata = fromJson(decodeBytes(bytes.subarray(headerSize, payloadIndex)));
    } catch {
      failPeer(peerId, invalidActionMsg("metadata"));
      return;
    }
    const message = {
      peerId,
      type,
      format,
      size,
      metadata
    };
    if (kind === inlineKind) {
      const dataSlice = bytes.subarray(payloadIndex);
      const resolved2 = resolveAdmission(message);
      if (!resolved2) return;
      const [registration, scope] = resolved2;
      const queueKey = scope ? `${type}\0${scope[0]}` : type;
      const hasGate = Boolean(scope ? scope[2] : registration.receiveGate);
      if (registration.receiver && !hasGate && !peers.get(peerId)?.inlineQueues.has(queueKey)) {
        let payload;
        try {
          payload = decodePayload(dataSlice, format, true);
        } catch {
          failPeer(peerId, invalidPayloadMsg);
          return;
        }
        deliverPayload(registration, payload, peerId, metadata);
        return;
      }
      if (!registration.receiver && !hasGate && !peers.get(peerId)?.inlineQueues.has(queueKey)) {
        bufferPreListenerInline(message, dataSlice);
        return;
      }
      const transfer2 = {
        ...createTransferBase(message, scope),
        kind: "inline",
        queueKey,
        state: {
          phase: "pending",
          data: dataSlice.slice()
        }
      };
      if (enqueueTransfer(transfer2, true)) {
        drainInline(peerId, queueKey);
        ensureIdleTimer(transfer2);
      }
      return;
    }
    if (peers.get(peerId)?.bulkTransfers.has(transferId)) {
      failPeer(peerId, "duplicate action offer");
      return;
    }
    const resolved = resolveAdmission(message, transferId);
    if (!resolved) return;
    const transfer = {
      ...createTransferBase(message, resolved[1]),
      kind: "bulk",
      transferId,
      chunkSize: flags === 1 ? maxChunkSize : minChunkSize,
      state: { phase: "closed" }
    };
    if (enqueueTransfer(transfer)) drain();
  };
  return {
    makeWireAction,
    handleData,
    clearPeer
  };
};

// node_modules/@trystero-p2p/core/dist/peer-transport.mjs
var backpressureWaitTimeoutMs = 1e4;
var waitForBufferedAmountLow = (channel, signal, timeoutMs = backpressureWaitTimeoutMs) => {
  if (signal?.aborted) return false;
  if (channel.readyState !== "open" || channel.bufferedAmount <= (channel.bufferedAmountLowThreshold ?? 0)) return channel.readyState === "open";
  return new Promise((res) => {
    let settled = false;
    let timeout = null;
    const abortCleanup = new AbortController();
    const onBufferLow = () => finish(true);
    const onCloseOrError = () => finish(false);
    const toggleChannel = (op) => {
      channel[op]("bufferedamountlow", onBufferLow);
      channel[op]("close", onCloseOrError);
      channel[op]("error", onCloseOrError);
    };
    const finish = (didDrain) => {
      if (settled) return;
      settled = true;
      toggleChannel("removeEventListener");
      abortCleanup.abort();
      timeout = resetTimer(timeout);
      res(didDrain);
    };
    timeout = setTimeout(() => finish(false), timeoutMs);
    unrefTimer(timeout);
    toggleChannel("addEventListener");
    signal?.addEventListener("abort", onCloseOrError, {
      once: true,
      signal: abortCleanup.signal
    });
    if (channel.readyState !== "open" || signal?.aborted) {
      finish(false);
      return;
    }
    if (channel.bufferedAmount <= (channel.bufferedAmountLowThreshold ?? 0)) finish(true);
  });
};
var destroyAfterFlush = (peer, graceMs = 40, capMs = 150, onDone) => {
  if (peer.isDead) {
    onDone?.();
    return noOp2;
  }
  peer.setHandlers({
    connect: noOp2,
    data: noOp2,
    stream: noOp2,
    close: noOp2,
    error: noOp2
  });
  const channel = peer.channel;
  if (!channel || channel.readyState !== "open") {
    peer.destroy();
    onDone?.();
    return noOp2;
  }
  const hasEventTarget = typeof channel.addEventListener === "function";
  let state;
  const finish = () => {
    switch (state.phase) {
      case "done":
        return;
      case "grace-hold":
        resetTimer(state.graceTimer);
        resetTimer(state.capTimer);
        break;
      case "draining":
        resetTimer(state.capTimer);
        break;
      default:
        unreachable(state);
    }
    state = { phase: "done" };
    if (hasEventTarget) {
      channel.removeEventListener("bufferedamountlow", maybeFinish);
      channel.removeEventListener("close", finish);
      channel.removeEventListener("error", finish);
    }
    peer.destroy();
    onDone?.();
  };
  const isBufferDrained = () => channel.readyState !== "open" || typeof channel.bufferedAmount !== "number" || channel.bufferedAmount <= 0;
  const maybeFinish = () => {
    if (state.phase === "draining" && isBufferDrained()) finish();
  };
  const capTimer = setTimeout(finish, Math.max(graceMs, capMs));
  unrefTimer(capTimer);
  if (graceMs > 0) {
    const graceTimer = setTimeout(() => {
      if (state.phase === "grace-hold") {
        state = {
          phase: "draining",
          capTimer: state.capTimer
        };
        maybeFinish();
      }
    }, graceMs);
    unrefTimer(graceTimer);
    state = {
      phase: "grace-hold",
      graceTimer,
      capTimer
    };
  } else state = {
    phase: "draining",
    capTimer
  };
  if (hasEventTarget) {
    try {
      channel.bufferedAmountLowThreshold = 0;
    } catch {
    }
    channel.addEventListener("bufferedamountlow", maybeFinish);
    channel.addEventListener("close", finish);
    channel.addEventListener("error", finish);
  }
  if (graceMs <= 0) maybeFinish();
  return finish;
};
var createDirectPeerTransport = (peer, isCurrent) => ({
  get isOpen() {
    const channelState = peer.channel?.readyState;
    return (!isCurrent || isCurrent()) && !peer.isDead && channelState !== "closing" && channelState !== "closed";
  },
  get bufferedAmount() {
    return typeof peer.channel?.bufferedAmount === "number" ? peer.channel.bufferedAmount : 0;
  },
  get maxBulkFrameBytes() {
    const sctpMax = peer.connection?.sctp?.maxMessageSize;
    return typeof sctpMax === "number" && Number.isFinite(sctpMax) && sctpMax >= 65536 ? maxBulkFrameBytes : maxActionFrameBytes;
  },
  sendFrame: (bytes) => {
    peer.sendData(bytes);
  },
  waitForDrain: (signal) => {
    if (signal?.aborted || isCurrent && !isCurrent() || peer.isDead) return false;
    if (!peer.channel) return true;
    return waitForBufferedAmountLow(peer.channel, signal);
  },
  close: () => peer.destroy()
});

// node_modules/@trystero-p2p/core/dist/signal-handler.mjs
var signalKeys = [
  "offer",
  "answer",
  "candidate"
];
var maxSignalMessageChars = 131072;
var maxSignalOfferIdChars = 64;
var maxSignalSdpChars = 65536;
var maxSignalCandidateChars = 4096;
var maxTrackedSignalPeers = 256;
var decryptErrDedupeTtlMs = 6e4;
var signalPeerIdPattern = /^[0-9A-Za-z]{20}$/;
var signalIdPattern = /^[\w.~:!-]{1,64}$/;
var buildSignalAad = (type, peerId, offerId) => `${type}|${peerId}|${offerId}`;
var isValidSignalId = (value, maxLen) => typeof value === "string" && value.length > 0 && value.length <= maxLen && signalIdPattern.test(value);
var isValidSignalPeerId = (value) => typeof value === "string" && signalPeerIdPattern.test(value);
var isValidSignalOfferId = (value) => isValidSignalId(value, maxSignalOfferIdChars);
var toPayload = (msg) => {
  if (typeof msg === "string") {
    if (msg.length > maxSignalMessageChars) return null;
    try {
      const parsed = fromJson(msg);
      return isObj(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isObj(msg) ? msg : null;
};
var getString = (payload, key) => typeof payload[key] === "string" && payload[key] ? payload[key] : void 0;
var isPeerHandle = (value) => Boolean(value && typeof value === "object" && typeof value.signal === "function" && typeof value.destroy === "function" && typeof value.setHandlers === "function");
var parseSignalEnvelope = (msg) => {
  const payload = toPayload(msg);
  if (!payload) return null;
  const isRawString = typeof msg === "string";
  const hasSignalContent = signalKeys.some((k) => k in payload);
  if ("peerId" in payload && !isValidSignalPeerId(payload["peerId"]) || (hasSignalContent || payload["offerId"] !== void 0) && !isValidSignalOfferId(payload["offerId"]) || signalKeys.some((k) => {
    if (!(k in payload)) return false;
    const val = payload[k];
    return typeof val !== "string" || val === "" || val.length > (k === "candidate" ? maxSignalCandidateChars : maxSignalSdpChars);
  }) || "peer" in payload && (isRawString || payload["peer"] !== void 0 && !isPeerHandle(payload["peer"]))) return null;
  return [
    getString(payload, "peerId") ?? "",
    getString(payload, "offer"),
    getString(payload, "answer"),
    getString(payload, "candidate"),
    getString(payload, "offerId"),
    isPeerHandle(payload["peer"]) ? payload["peer"] : void 0
  ];
};
var hasTurnServer = (config) => hasIceUrl([...config.turnConfig ?? [], ...config.rtcConfig?.iceServers ?? []], /^turns?:/i);
var isDeadConnState = (s) => s === "closed" || s === "failed";
var getConnectedPeerHealth = (peer) => {
  const { connection: pc, channel: ch } = peer;
  return peer.isDead || isDeadConnState(pc.connectionState) || isDeadConnState(pc.iceConnectionState) || ch?.readyState === "closing" || ch?.readyState === "closed" ? "stale" : !ch || ch.readyState !== "open" ? "transient" : "live";
};
var offerPostAnswerTtlMs = 23333;
var offerTtl = 57333;
var offerIdSize = 12;
var disconnectedPeerGraceMs = 7533;
var answeringTtlMs = 23333;
var isSlotAnnounceable = (slot) => !slot || slot.phase === "exhausted";
var hasCandidateSender = (slot) => slot?.phase === "retrying" || slot?.phase === "exhausted";
var clearRelaySlots = (slots) => {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot?.phase === "retrying") resetTimer(slot.retryTimer);
    slots[i] = void 0;
  }
  slots.length = 0;
};
var freezeRelayRetriesKeepSenders = (slots) => {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) continue;
    switch (slot.phase) {
      case "reserved":
        slots[i] = void 0;
        break;
      case "retrying":
        resetTimer(slot.retryTimer);
        slots[i] = {
          phase: "exhausted",
          sendCandidate: slot.sendCandidate
        };
        break;
      case "exhausted":
        break;
      default:
        unreachable(slot);
    }
  }
};
var clearOfferRelaySlot = (state, relayId) => {
  const current = state.relaySlots[relayId];
  if (!current) return;
  if (current.phase === "retrying") resetTimer(current.retryTimer);
  state.relaySlots[relayId] = void 0;
};
var clearOfferRelayIfReserved = (state, relayId) => {
  if (state?.relaySlots[relayId]?.phase === "reserved") state.relaySlots[relayId] = void 0;
};
var hasLiveOutboundOffer = (state, peer, offerId) => (state.outbound.phase === "advertising" || state.outbound.phase === "answered") && (!peer || state.outbound.peer === peer) && (offerId === void 0 || state.outbound.offerId === offerId);
var hasOutboundActivity = (state) => {
  switch (state.outbound.phase) {
    case "idle":
      return state.relaySlots.some(Boolean);
    case "allocating":
    case "advertising":
    case "answered":
      return true;
    default:
      return unreachable(state.outbound);
  }
};
var countPendingPeerConnections = (peerStates, excludePeerId) => {
  let count = 0;
  for (const [id, s] of peerStates) {
    if (id === excludePeerId || s.connection.phase === "connected") continue;
    if (s.outbound.phase === "allocating" || hasLiveOutboundOffer(s) && !s.outbound.peer.isDead) count++;
    if (s.inbound.phase === "answering" && !s.inbound.peer.isDead) count++;
  }
  return count;
};
var isPeerStateIdle = (s) => s.connection.phase === "disconnected" && s.inbound.phase === "idle" && !hasOutboundActivity(s);
var prunePeerStates = (peerStates) => {
  for (const [peerId, s] of peerStates) if (isPeerStateIdle(s)) peerStates.delete(peerId);
};
var counterAnnounceTimestamps = /* @__PURE__ */ new WeakMap();
var destroyAlive = (peer) => {
  if (peer && !peer.isDead) peer.destroy();
};
var resetAnsweringState = (state) => {
  counterAnnounceTimestamps.delete(state);
  if (state.inbound.phase === "answering") resetTimer(state.inbound.expiryTimer);
  state.inbound = { phase: "idle" };
};
var clearAnswering = (state, peer) => {
  if (state.inbound.phase === "answering" && state.inbound.peer === peer) {
    resetAnsweringState(state);
    if (state.connectedPeer !== peer) destroyAlive(peer);
  }
};
var markPeerConnected = (state, physical) => {
  if (state.inbound.phase === "answering" && state.inbound.peer !== physical) destroyAlive(state.inbound.peer);
  resetAnsweringState(state);
  state.connection = {
    phase: "connected",
    peer: physical,
    unhealthySince: null
  };
};
var detachConnectedPeer = (state, physical) => {
  if (state?.connection.phase === "connected" && state.connection.peer === physical) state.connection = { phase: "disconnected" };
};
var clearConnectedPeer = (state) => {
  if (state.connection.phase !== "connected") return;
  const { peer } = state.connection;
  state.connection = { phase: "disconnected" };
  destroyAlive(peer);
};
var resetOfferState = (state) => {
  counterAnnounceTimestamps.delete(state);
  clearRelaySlots(state.relaySlots);
  switch (state.outbound.phase) {
    case "idle":
    case "allocating":
      break;
    case "advertising":
    case "answered":
      resetTimer(state.outbound.expiryTimer);
      if (state.outbound.peer !== state.connectedPeer) destroyAlive(state.outbound.peer);
      break;
    default:
      unreachable(state.outbound);
  }
  state.outbound = { phase: "idle" };
  state.didReportFailure = false;
};
var createPeerState = () => ({
  outbound: { phase: "idle" },
  inbound: { phase: "idle" },
  connection: { phase: "disconnected" },
  relaySlots: [],
  didReportFailure: false,
  get offerPeer() {
    return hasLiveOutboundOffer(this) ? this.outbound.peer : null;
  },
  get answeringPeer() {
    return this.inbound.phase === "answering" ? this.inbound.peer : null;
  },
  get connectedPeer() {
    return this.connection.phase === "connected" ? this.connection.peer : null;
  }
});
var getState = (peerStates, peerId) => {
  const existing = peerStates.get(peerId);
  if (existing) return existing;
  if (peerStates.size >= maxTrackedSignalPeers) {
    let evictKey;
    let fallbackKey;
    for (const [k, s] of peerStates) {
      if (isPeerStateIdle(s)) {
        evictKey = k;
        break;
      }
      if (fallbackKey === void 0 && s.connection.phase === "disconnected") fallbackKey = k;
    }
    const targetKey = evictKey ?? fallbackKey;
    if (targetKey !== void 0) {
      const evicted = peerStates.get(targetKey);
      if (evicted) {
        destroyAlive(evicted.answeringPeer);
        resetOfferState(evicted);
        resetAnsweringState(evicted);
      }
      peerStates.delete(targetKey);
    }
  }
  const created = createPeerState();
  peerStates.set(peerId, created);
  return created;
};
var createSignalHandler = (ctx) => {
  const { appId, getRoomId, config, peerStates, getRootTopicPlaintext, rootTopicP, selfTopicP, toPlain, toCipher, isLeaving, onError, checkoutOffers, claimLeasedOffer, reclaimLeasedOffer, encryptOffer, initPeer: initPeerFn, connectPeer, disconnectPeer, announceIntervals, announceIntervalMs: announceIntervalMs2, getSelfIdNow, selfIdP, onPeerDiscovered, shouldConnectPeer } = ctx;
  const relaySignalPeers = [];
  const recentDecryptErrors = createBoundedCache(512);
  const dialBackoffs = createBoundedCache(512);
  const inFlightOfferDecrypts = /* @__PURE__ */ new Map();
  const getSelfId = () => selfIdP;
  const peerTopicOf = (peerId) => hashTopic(topicPath(getRootTopicPlaintext(), peerId));
  const atPendingCap = (peerId) => countPendingPeerConnections(peerStates, peerId) >= 64;
  const reportSdpFailure = (state, peerId) => {
    if (isLeaving() || state.connection.phase === "connected" || state.didReportFailure) return;
    state.didReportFailure = true;
    const turnConfigured = hasTurnServer(config);
    onError?.({
      code: "peer-connect-failed",
      peerId,
      turnConfigured,
      message: `could not connect to peer ${peerId} after exchanging SDP; ${turnConfigured ? "verify TURN server URLs and credentials" : "configure TURN via turnConfig or rtcConfig.iceServers"}`,
      appId,
      roomId: getRoomId()
    });
  };
  const reportDecryptErr = (peerId, stage, cause) => {
    const key = `${peerId}:${stage}`;
    const now2 = Date.now();
    const prev = recentDecryptErrors.get(key);
    if (prev !== void 0 && now2 - prev < decryptErrDedupeTtlMs) return;
    recentDecryptErrors.set(key, now2);
    onError?.({
      code: "decrypt-failed",
      peerId,
      stage,
      message: `failed to decrypt ${stage} (incorrect password or corrupted signal)`,
      appId,
      roomId: getRoomId(),
      cause
    });
  };
  const createAnsweringExpiryTimer = (peerId, peer) => {
    const timer = setTimeout(() => {
      const current = peerStates.get(peerId);
      if (!current || current.connection.phase === "connected" || current.inbound.phase !== "answering" || current.inbound.peer !== peer) return;
      if (current.inbound.didSendAnswer) reportSdpFailure(current, peerId);
      clearAnswering(current, peer);
      prunePeerStates(peerStates);
    }, answeringTtlMs);
    unrefTimer(timer);
    return timer;
  };
  const createOfferExpiryTimer = (peerId, offerId, ttlMs = offerTtl) => {
    const timer = setTimeout(() => {
      const current = peerStates.get(peerId);
      if (!current || current.connection.phase === "connected" || !hasLiveOutboundOffer(current, void 0, offerId)) return;
      if (current.outbound.phase === "answered") reportSdpFailure(current, peerId);
      resetOfferState(current);
      prunePeerStates(peerStates);
    }, ttlMs);
    unrefTimer(timer);
    return timer;
  };
  const bindOfferPeerHandlers = (state, peerId, peer, onSignal) => {
    const onClosedOrError = () => {
      if (state.offerPeer === peer && state.connection.phase !== "connected") {
        if (state.outbound.phase === "answered") reportSdpFailure(state, peerId);
        resetOfferState(state);
      }
      disconnectPeer(peer, peerId);
      prunePeerStates(peerStates);
    };
    peer.setHandlers({
      connect: () => {
        dialBackoffs.delete(peerId);
        connectPeer(peer, peerId);
      },
      ...onSignal ? { signal: onSignal } : {},
      close: onClosedOrError,
      error: onClosedOrError
    });
  };
  const ensureOffer = (state, peerId) => {
    switch (state.outbound.phase) {
      case "advertising":
        return Promise.resolve([
          state.outbound.peer,
          state.outbound.offerSdp,
          state.outbound.offerId
        ]);
      case "allocating":
        return state.outbound.promise;
      case "answered":
        return Promise.resolve(null);
      case "idle":
        break;
      default:
        return unreachable(state.outbound);
    }
    if (atPendingCap(peerId)) return Promise.resolve(null);
    const isAllocCanceled = () => isLeaving() || state.outbound.phase !== "allocating" || state.outbound.promise !== pending;
    const allocateOffer = async () => {
      const localSelfId = getSelfIdNow() ?? await getSelfId();
      let firstOffer;
      try {
        firstOffer = (await checkoutOffers(1, false, (peer2, oid) => encryptOffer(peer2, localSelfId, oid), offerIdSize))[0];
      } catch (error) {
        if (isAllocCanceled()) return null;
        throw error;
      }
      if (!firstOffer) {
        if (isAllocCanceled()) return null;
        throw mkErr("failed to allocate offer peer");
      }
      const { peer, offer } = firstOffer;
      const offerId = firstOffer.offerId || genId(offerIdSize);
      if (isAllocCanceled()) {
        peer.destroy();
        return null;
      }
      const bufferedCandidates = [];
      const expiryTimer = createOfferExpiryTimer(peerId, offerId);
      state.didReportFailure = false;
      state.outbound = {
        phase: "advertising",
        peer,
        offerId,
        offerSdp: offer,
        expiryTimer,
        bufferedCandidates
      };
      bindOfferPeerHandlers(state, peerId, peer, (signal) => {
        if (state.connection.phase !== "connected" && hasLiveOutboundOffer(state, peer, offerId)) {
          state.outbound.bufferedCandidates.push(signal);
          for (const slot of state.relaySlots) if (hasCandidateSender(slot)) slot.sendCandidate(signal);
        }
      });
      return [
        peer,
        offer,
        offerId
      ];
    };
    const pending = allocateOffer().finally(() => {
      if (state.outbound.phase === "allocating" && state.outbound.promise === pending) state.outbound = { phase: "idle" };
    });
    state.outbound = {
      phase: "allocating",
      promise: pending
    };
    return pending;
  };
  const transitionOutboundToAnswered = (state, peerId, peer, offerId) => {
    let bufferedCandidates = [];
    if (hasLiveOutboundOffer(state)) {
      resetTimer(state.outbound.expiryTimer);
      if (state.outbound.peer === peer && state.outbound.offerId === offerId) {
        bufferedCandidates = state.outbound.bufferedCandidates;
        freezeRelayRetriesKeepSenders(state.relaySlots);
      } else {
        clearRelaySlots(state.relaySlots);
        if (state.connectedPeer !== state.outbound.peer) destroyAlive(state.outbound.peer);
      }
    } else clearRelaySlots(state.relaySlots);
    state.outbound = {
      phase: "answered",
      peer,
      offerId,
      expiryTimer: createOfferExpiryTimer(peerId, offerId, offerPostAnswerTtlMs),
      bufferedCandidates
    };
  };
  const handleAnnouncement = async (relayId, peerId, signalPeer, retryAttempt = 0) => {
    const state = peerStates.get(peerId);
    if (!state || state.connection.phase === "connected" || state.inbound.phase !== "idle" || state.outbound.phase === "answered") {
      clearOfferRelayIfReserved(state, relayId);
      return;
    }
    if (state.relaySlots[relayId]?.phase !== "reserved") return;
    let peerTopic;
    let offerInfo;
    let localSelfId;
    try {
      [peerTopic, offerInfo, localSelfId] = await all([
        peerTopicOf(peerId),
        ensureOffer(state, peerId),
        getSelfId()
      ]);
    } catch (err) {
      clearOfferRelayIfReserved(state, relayId);
      prunePeerStates(peerStates);
      throw err;
    }
    if (!offerInfo) {
      clearOfferRelayIfReserved(state, relayId);
      return;
    }
    if (isLeaving()) {
      resetOfferState(state);
      return;
    }
    const isStateConnected = (s) => s.connection.phase === "connected";
    if (isStateConnected(state) || state.inbound.phase !== "idle" || state.outbound.phase !== "advertising" || state.relaySlots[relayId]?.phase !== "reserved") {
      clearOfferRelayIfReserved(state, relayId);
      return;
    }
    const [offerPeer, offerSdp, offerId] = offerInfo;
    const sendCandidate = (signal) => {
      if (isLeaving() || state.connection.phase === "connected" || !hasLiveOutboundOffer(state, offerPeer, offerId) || signal.type !== "candidate") return;
      toCipher(signal, localSelfId, offerId).then((enc) => {
        if (!isLeaving() && state.connection.phase !== "connected" && hasLiveOutboundOffer(state, offerPeer, offerId)) signalPeer(peerTopic, toJson({
          peerId: localSelfId,
          offerId,
          candidate: enc.sdp
        }));
      }).catch(noOp2);
    };
    const retryTimer = setTimeout(() => {
      if (retryAttempt >= 2 || isLeaving() || state.connection.phase === "connected" || state.inbound.phase !== "idle" || state.outbound.phase !== "advertising" || state.outbound.peer !== offerPeer || state.outbound.offerId !== offerId) {
        const cur = peerStates.get(peerId);
        if (cur && cur.connection.phase !== "connected") {
          if (retryAttempt >= 2 && hasLiveOutboundOffer(cur, offerPeer, offerId)) cur.relaySlots[relayId] = {
            phase: "exhausted",
            sendCandidate
          };
          else clearOfferRelaySlot(cur, relayId);
          prunePeerStates(peerStates);
        }
        return;
      }
      state.relaySlots[relayId] = { phase: "reserved" };
      handleAnnouncement(relayId, peerId, signalPeer, retryAttempt + 1).catch((err) => {
        if (!isLeaving()) logErr("signal", err);
      });
    }, retryAttempt === 0 && announceIntervals[relayId] === void 0 ? 2e3 : (announceIntervals[relayId] ?? announceIntervalMs2) * 0.9);
    unrefTimer(retryTimer);
    signalPeer(peerTopic, toJson({
      peerId: localSelfId,
      offerId,
      offer: offerSdp
    }));
    state.relaySlots[relayId] = {
      phase: "retrying",
      retryTimer,
      sendCandidate
    };
    state.outbound.bufferedCandidates.forEach(sendCandidate);
  };
  const replayExistingAnswerIfMatch = async (state, relayId, peerId, offer, offerId, signalPeer) => {
    if (state.inbound.phase !== "answering" || state.inbound.peer.isDead || state.inbound.replay.offer !== offer || state.inbound.replay.offerId !== offerId) return;
    const { replay } = state.inbound;
    const lastSentAt = replay.lastSentAt[relayId];
    if (lastSentAt !== void 0 && Date.now() - lastSentAt < 1e3) return;
    replay.lastSentAt[relayId] = Date.now();
    const peerTopic = await peerTopicOf(peerId);
    if (!isLeaving() && state.connection.phase !== "connected" && state.inbound.phase === "answering" && state.inbound.replay === replay) {
      const send = (message) => {
        signalPeer(peerTopic, message);
      };
      replay.relays[relayId] = send;
      replay.messages.forEach(send);
    }
  };
  const decryptOfferDeduped = (peerId, offer, offerId) => {
    const key = `${peerId}|${offerId}|${offer}`;
    const existing = inFlightOfferDecrypts.get(key);
    if (existing) return existing;
    const task = toPlain({
      type: "offer",
      sdp: offer
    }, peerId, offerId).catch((err) => {
      reportDecryptErr(peerId, "offer", err);
      return null;
    }).finally(() => {
      inFlightOfferDecrypts.delete(key);
    });
    inFlightOfferDecrypts.set(key, task);
    return task;
  };
  const handleOffer = async (relayId, peerId, offer, offerId, signalPeer) => {
    if (!offerId) return;
    const localSelfId = getSelfIdNow() ?? await getSelfId();
    if (shouldConnectPeer && !shouldConnectPeer(peerId, "inbound")) return;
    const existingState = peerStates.get(peerId);
    if (existingState && (existingState.inbound.phase === "answering" || existingState.outbound.phase === "answered")) return replayExistingAnswerIfMatch(existingState, relayId, peerId, offer, offerId, signalPeer);
    if (existingState && hasOutboundActivity(existingState) && localSelfId < peerId) return;
    if (atPendingCap(peerId)) return;
    const plainOffer = await decryptOfferDeduped(peerId, offer, offerId);
    if (!plainOffer || isLeaving()) return;
    const state = getState(peerStates, peerId);
    if (state.connection.phase === "connected") return;
    if (state.inbound.phase === "answering" || state.outbound.phase === "answered") return replayExistingAnswerIfMatch(state, relayId, peerId, offer, offerId, signalPeer);
    if (hasOutboundActivity(state)) {
      if (localSelfId < peerId) return;
      resetOfferState(state);
    }
    if (atPendingCap(peerId)) {
      prunePeerStates(peerStates);
      return;
    }
    const answerPeer = initPeerFn(false, config);
    const replay = {
      offer,
      offerId,
      messages: [],
      lastSentAt: [],
      relays: []
    };
    replay.lastSentAt[relayId] = Date.now();
    const expiryTimer = createAnsweringExpiryTimer(peerId, answerPeer);
    let preAnswerCandidates = [];
    state.didReportFailure = false;
    state.inbound = {
      phase: "answering",
      peer: answerPeer,
      offerId,
      expiryTimer,
      didSendAnswer: false,
      replay
    };
    const isActiveAnswering = (s) => !isLeaving() && s.inbound.phase === "answering" && s.inbound.peer === answerPeer && !answerPeer.isDead;
    const onClosedOrError = () => {
      if (state.inbound.phase === "answering" && state.inbound.peer === answerPeer && state.connection.phase !== "connected" && state.inbound.didSendAnswer) reportSdpFailure(state, peerId);
      clearAnswering(state, answerPeer);
      disconnectPeer(answerPeer, peerId);
      prunePeerStates(peerStates);
    };
    answerPeer.setHandlers({
      connect: () => {
        dialBackoffs.delete(peerId);
        connectPeer(answerPeer, peerId);
      },
      close: onClosedOrError,
      error: onClosedOrError
    });
    if (answerPeer.isDead) {
      clearAnswering(state, answerPeer);
      prunePeerStates(peerStates);
      return;
    }
    const peerTopic = await peerTopicOf(peerId);
    if (!isActiveAnswering(state) || state.inbound.replay !== replay) return;
    replay.relays[relayId] = (message) => {
      signalPeer(peerTopic, message);
    };
    let publishQueue = Promise.resolve();
    const enqueueEncryptedPublish = (signal) => {
      publishQueue = publishQueue.then(async () => {
        const enc = await toCipher(signal, localSelfId, offerId);
        if (!isActiveAnswering(state)) return;
        const isAnswer = signal.type === "answer";
        const message = toJson({
          peerId: localSelfId,
          offerId,
          ...isAnswer ? { answer: enc.sdp } : { candidate: enc.sdp }
        });
        const now2 = Date.now();
        replay.messages.push(message);
        replay.relays.forEach((send, id) => {
          if (send) {
            replay.lastSentAt[id] = now2;
            send(message);
          }
        });
        if (isAnswer && preAnswerCandidates) {
          state.inbound.didSendAnswer = true;
          const queued = preAnswerCandidates;
          preAnswerCandidates = null;
          queued.forEach(enqueueEncryptedPublish);
        }
      }).catch(noOp2);
    };
    answerPeer.setHandlers({ signal: (signal) => {
      if (!isActiveAnswering(state) || signal.type !== "answer" && signal.type !== "candidate") return;
      if (signal.type === "candidate" && preAnswerCandidates) preAnswerCandidates.push(signal);
      else enqueueEncryptedPublish(signal);
    } });
    await answerPeer.signal(plainOffer);
  };
  const handleCandidate = async (peerId, candidate, offerId, peer) => {
    if (!offerId) return;
    const state = peerStates.get(peerId);
    if (!peer && !state?.offerPeer && !state?.answeringPeer) return;
    let plainCandidate;
    try {
      plainCandidate = await toPlain({
        type: candidateType,
        sdp: candidate
      }, peerId, offerId);
    } catch {
      return;
    }
    const currentState = peerStates.get(peerId);
    const targetPeer = peer && !peer.isDead ? peer : currentState && hasLiveOutboundOffer(currentState, void 0, offerId) ? currentState.outbound.peer : currentState?.inbound.phase === "answering" && currentState.inbound.offerId === offerId ? currentState.inbound.peer : null;
    if (targetPeer && !targetPeer.isDead) targetPeer.signal(plainCandidate);
  };
  const handleAnswer = async (peerId, answer, offerId, peer) => {
    if (!offerId) return;
    if (shouldConnectPeer && !shouldConnectPeer(peerId, peer ? "outbound" : "inbound")) {
      if (peer) {
        reclaimLeasedOffer(peer);
        destroyAlive(peer);
      } else {
        const currentState = peerStates.get(peerId);
        if (currentState && hasLiveOutboundOffer(currentState, void 0, offerId)) resetOfferState(currentState);
      }
      return;
    }
    const localSelfId = getSelfIdNow() ?? await getSelfId();
    let plainAnswer;
    try {
      plainAnswer = await toPlain({
        type: "answer",
        sdp: answer
      }, peerId, offerId);
    } catch (err) {
      if (peer) {
        reclaimLeasedOffer(peer);
        destroyAlive(peer);
      }
      reportDecryptErr(peerId, "answer", err);
      return;
    }
    if (peer) {
      if (!claimLeasedOffer(peer) || peer.isDead) {
        destroyAlive(peer);
        return;
      }
      const state2 = getState(peerStates, peerId);
      if (state2.connection.phase === "connected" || state2.outbound.phase === "answered" || state2.inbound.phase === "answering" && !state2.inbound.peer.isDead && localSelfId > peerId) {
        peer.destroy();
        return;
      }
      if (state2.inbound.phase === "answering") clearAnswering(state2, state2.inbound.peer);
      resetOfferState(state2);
      transitionOutboundToAnswered(state2, peerId, peer, offerId);
      bindOfferPeerHandlers(state2, peerId, peer);
      peer.signal(plainAnswer);
      return;
    }
    const state = peerStates.get(peerId);
    if (!state || state.outbound.phase !== "advertising" || state.outbound.offerId !== offerId || state.outbound.peer.isDead) return;
    const offerPeer = state.outbound.peer;
    transitionOutboundToAnswered(state, peerId, offerPeer, offerId);
    offerPeer.signal(plainAnswer);
  };
  const sendDirectPing = (peerId, localSelfId, state, signalPeer) => peerTopicOf(peerId).then((peerSelfTopic) => {
    if (!isLeaving() && state.connection.phase !== "connected" && state.inbound.phase === "idle" && state.outbound.phase !== "answered") signalPeer(peerSelfTopic, toJson({ peerId: localSelfId }));
  });
  return {
    handleMessage: (relayId) => async (topic, msg, signalPeer) => {
      try {
        if (isLeaving()) return;
        relaySignalPeers[relayId] = signalPeer;
        const parsed = parseSignalEnvelope(msg);
        if (!parsed) return;
        const [peerId, offer, answer, candidate, offerId, peer] = parsed;
        const knownSelfId = getSelfIdNow();
        if (!peerId || knownSelfId && peerId === knownSelfId) return;
        const [rootTopic, selfTopic, localSelfId] = await all([
          rootTopicP,
          selfTopicP,
          getSelfId()
        ]);
        if (peerId === localSelfId || isLeaving() || topic !== rootTopic && topic !== selfTopic) return;
        onPeerDiscovered?.(peerId, relayId, signalPeer);
        const state = peerStates.get(peerId);
        if (state?.connection.phase === "connected") {
          const health = getConnectedPeerHealth(state.connection.peer);
          if (health === "live") {
            state.connection.unhealthySince = null;
            return;
          }
          if (health === "stale") clearConnectedPeer(state);
          else {
            const nowMs = Date.now();
            if (nowMs - (state.connection.unhealthySince ??= nowMs) < disconnectedPeerGraceMs) return;
            clearConnectedPeer(state);
          }
        }
        if (!offer && !answer && !candidate) {
          if (shouldConnectPeer && !shouldConnectPeer(peerId, "outbound") || !peerStates.has(peerId) && atPendingCap(peerId)) return;
          const announceState = getState(peerStates, peerId);
          if (announceState.inbound.phase !== "idle" || announceState.connection.phase === "connected" || announceState.outbound.phase === "answered") return;
          if (localSelfId >= peerId && !announceState.offerPeer) {
            let lastSentByRelay = counterAnnounceTimestamps.get(announceState);
            if (!lastSentByRelay) {
              lastSentByRelay = [];
              counterAnnounceTimestamps.set(announceState, lastSentByRelay);
            }
            const lastSentAt = lastSentByRelay[relayId];
            if (lastSentAt !== void 0 && Date.now() - lastSentAt < 1e3) return;
            lastSentByRelay[relayId] = Date.now();
            await sendDirectPing(peerId, localSelfId, announceState, signalPeer);
            return;
          }
          if (isSlotAnnounceable(announceState.relaySlots[relayId])) {
            announceState.relaySlots[relayId] = { phase: "reserved" };
            await handleAnnouncement(relayId, peerId, signalPeer);
          }
          return;
        }
        if (offer) {
          await handleOffer(relayId, peerId, offer, offerId, signalPeer);
          return;
        }
        if (candidate) {
          await handleCandidate(peerId, candidate, offerId, peer);
          return;
        }
        if (answer) await handleAnswer(peerId, answer, offerId, peer);
      } catch (err) {
        if (!isLeaving()) logErr("signal", err);
      }
    },
    dialPeer: (peerId) => {
      if (!isValidSignalPeerId(peerId)) return;
      getSelfId().then((localSelfId) => {
        if (isLeaving() || !peerId || peerId === localSelfId || shouldConnectPeer && !shouldConnectPeer(peerId, "outbound") || !peerStates.has(peerId) && atPendingCap(peerId)) return;
        const state = getState(peerStates, peerId);
        if (state.connection.phase === "connected" || state.inbound.phase !== "idle" || state.outbound.phase !== "idle" || !relaySignalPeers.some(Boolean)) return;
        const now2 = Date.now();
        const backoff = dialBackoffs.get(peerId);
        if (backoff && now2 < backoff[1]) return;
        const attempts = (backoff?.[0] ?? 0) + 1;
        dialBackoffs.set(peerId, [attempts, now2 + Math.min(6e4, 2e3 * 2 ** (attempts - 1))]);
        relaySignalPeers.forEach((signalPeer, relayId) => {
          if (!signalPeer) return;
          if (localSelfId < peerId) {
            if (state.outbound.phase !== "answered" && isSlotAnnounceable(state.relaySlots[relayId])) {
              state.relaySlots[relayId] = { phase: "reserved" };
              handleAnnouncement(relayId, peerId, signalPeer).catch((err) => {
                if (!isLeaving()) logErr("signal", err);
              });
            }
          } else sendDirectPing(peerId, localSelfId, state, signalPeer).catch(noOp2);
        });
      }).catch((err) => {
        if (!isLeaving()) logErr("signal", err);
      });
    }
  };
};

// node_modules/@trystero-p2p/core/dist/offer-manager.mjs
var offerLeaseTtlMs = 18e4;
var defaultOfferIdSize = 20;
var offerRoomLeftErr = /* @__PURE__ */ mkErr("room left while preparing offer");
var createOfferManager = (makeOffer) => {
  const leaseStates = /* @__PURE__ */ new WeakMap();
  const activeLeases = /* @__PURE__ */ new Set();
  let destroyed = false;
  const closeLease = (peer) => {
    const entry = leaseStates.get(peer);
    if (entry?.phase === "leased") resetTimer(entry.timer);
    activeLeases.delete(peer);
    leaseStates.set(peer, { phase: "closed" });
    peer.destroy();
  };
  const claimLeased = (peer) => {
    if (destroyed || peer.isDead) return false;
    const entry = leaseStates.get(peer);
    if (!entry) return true;
    switch (entry.phase) {
      case "leased":
        resetTimer(entry.timer);
        activeLeases.delete(peer);
        leaseStates.set(peer, { phase: "claimed" });
        return true;
      case "claimed":
        return true;
      case "closed":
        return false;
      default:
        return unreachable(entry);
    }
  };
  const reclaimLeased = (peer) => {
    if (leaseStates.get(peer)?.phase === "leased") closeLease(peer);
  };
  const checkout = (n, leaseOffers, encryptOffer, offerIdSize2 = defaultOfferIdSize) => {
    const toRecord = async (didRetry = false) => {
      if (destroyed) throw offerRoomLeftErr;
      const peer = makeOffer();
      const offerId = genId(offerIdSize2);
      try {
        const offer = await encryptOffer(peer, offerId);
        if (destroyed) throw offerRoomLeftErr;
        if (leaseOffers) {
          const timer = setTimeout(() => {
            if (leaseStates.get(peer)?.phase === "leased") closeLease(peer);
          }, offerLeaseTtlMs);
          unrefTimer(timer);
          leaseStates.set(peer, {
            phase: "leased",
            timer
          });
          activeLeases.add(peer);
          return {
            peer,
            offer,
            offerId,
            claim: () => {
              claimLeased(peer);
            },
            reclaim: () => reclaimLeased(peer)
          };
        }
        return {
          peer,
          offer,
          offerId
        };
      } catch (error) {
        peer.destroy();
        if (!didRetry && !destroyed) return toRecord(true);
        throw error;
      }
    };
    return all(alloc(n, () => toRecord()));
  };
  return {
    checkout,
    getOffers: (n, encryptOffer) => checkout(n, true, encryptOffer),
    claimLeased,
    reclaimLeased,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const peer of Array.from(activeLeases)) closeLease(peer);
    }
  };
};

// node_modules/@trystero-p2p/core/dist/peer.mjs
var iceTimeout = 15e3;
var iceCandidateSettleMs = 150;
var disconnectedCloseDelayMs = 5e3;
var iceCandidateEvent = "icecandidate";
var iceStateEvent = "icegatheringstatechange";
var iceConnectionStateEvent = "iceconnectionstatechange";
var offerType = "offer";
var answerType = "answer";
var outOfRangePattern = /out of range/i;
var maxPendingRemoteCandidates = 128;
var maxRemoteCandidateSdpLength = 8192;
var peer_default = (initiator, config) => {
  const { trickleIce, rtcConfig, rtcPolyfill, turnConfig } = config;
  const iceServers = [...rtcConfig?.iceServers ?? defaultIceServers, ...turnConfig ?? []];
  const pc = new (rtcPolyfill ?? RTCPeerConnection)({
    ...rtcConfig,
    iceServers
  });
  let connectHandler;
  let closeHandler;
  let errorHandler;
  const pendingIceGathering = /* @__PURE__ */ new Set();
  const shouldTrickleIce = trickleIce !== false;
  const pendingRemoteCandidates = [];
  let activeCandidateFlush = null;
  const streamSenders = /* @__PURE__ */ new WeakMap();
  const trackSender = (stream, sender) => {
    let senders = streamSenders.get(stream);
    if (!senders) {
      senders = /* @__PURE__ */ new Set();
      streamSenders.set(stream, senders);
    }
    senders.add(sender);
  };
  let lifecycle = { phase: "open" };
  let negotiation = { phase: "idle" };
  let offerGeneration = 0;
  let dataState = { phase: "unbound-idle" };
  let signalHandler;
  const pendingSignals = [];
  let streamHandler;
  const pendingStreams = [];
  let dataChannel = null;
  let settledOffer;
  let resolveInitialOffer = null;
  const initialOfferP = initiator ? new Promise((resolve) => {
    resolveInitialOffer = resolve;
  }) : void 0;
  const settleInitialOffer = (signal) => {
    if (resolveInitialOffer) {
      const resolve = resolveInitialOffer;
      resolveInitialOffer = null;
      settledOffer = signal;
      resolve(signal);
    }
  };
  const clearDisconnectedGrace = () => {
    if (lifecycle.phase === "disconnected-grace") {
      resetTimer(lifecycle.timer);
      lifecycle = { phase: "open" };
    }
  };
  const emitClose = () => {
    if (lifecycle.phase === "closed") return;
    if (lifecycle.phase === "disconnected-grace") resetTimer(lifecycle.timer);
    lifecycle = { phase: "closed" };
    offerGeneration += 1;
    negotiation = { phase: "idle" };
    settleInitialOffer();
    if (dataState.phase === "unbound-buffering") {
      resetTimer(dataState.deadlineTimer);
      dataState.queue.length = 0;
    }
    dataState = { phase: "closed" };
    signalHandler = void 0;
    pendingSignals.length = 0;
    streamHandler = void 0;
    pendingStreams.length = 0;
    pendingRemoteCandidates.length = 0;
    pendingIceGathering.forEach((finish) => finish());
    closeHandler?.();
  };
  const isClosed = () => {
    if (lifecycle.phase !== "closed" && pc.connectionState === "closed") emitClose();
    return lifecycle.phase === "closed";
  };
  const emitSignal = (signal) => {
    if (isClosed()) return;
    if (signal.type === offerType) {
      const wasInitialOfferPending = resolveInitialOffer !== null;
      settleInitialOffer(signal);
      if (wasInitialOfferPending && !signalHandler && !pc.remoteDescription) return;
    }
    if (signalHandler) signalHandler(signal);
    else pendingSignals.push(signal);
  };
  const appendSignalHandler = (handler) => {
    if (isClosed()) return;
    if (signalHandler) {
      const prev = signalHandler;
      signalHandler = (sig) => {
        prev(sig);
        handler(sig);
      };
      return;
    }
    signalHandler = handler;
    for (const queued of pendingSignals.splice(0)) {
      if (isClosed() || !signalHandler) break;
      signalHandler(queued);
    }
  };
  const localDescriptionSignal = (peerConnection) => ({
    type: peerConnection.localDescription?.type ?? offerType,
    sdp: peerConnection.localDescription?.sdp ?? ""
  });
  const getRemoteUfrag = () => pc.remoteDescription?.sdp?.match(/a=ice-ufrag:(\S+)/)?.[1] ?? null;
  const canApplyRemoteCandidate = (candidate) => {
    if (!pc.remoteDescription) return false;
    const remoteMLineCount = (pc.remoteDescription.sdp?.match(/^m=/gm) ?? []).length;
    if (typeof candidate.sdpMLineIndex === "number" && remoteMLineCount > 0 && candidate.sdpMLineIndex >= remoteMLineCount) return false;
    const remoteUfrag = getRemoteUfrag();
    return !(remoteUfrag && candidate.usernameFragment && candidate.usernameFragment !== remoteUfrag);
  };
  const addIceCandidateSafe = async (candidate) => {
    try {
      await pc.addIceCandidate(candidate);
      return true;
    } catch (err) {
      if (err instanceof Error && outOfRangePattern.test(err.message) && typeof candidate.sdpMLineIndex === "number") return false;
      throw err;
    }
  };
  const queueRemoteCandidate = (candidate) => {
    if (isClosed()) return;
    if (pendingRemoteCandidates.length >= maxPendingRemoteCandidates) pendingRemoteCandidates.shift();
    pendingRemoteCandidates.push(candidate);
  };
  const flushPendingRemoteCandidates = async () => {
    if (isClosed() || !pc.remoteDescription) return;
    if (activeCandidateFlush) {
      await activeCandidateFlush;
      if (isClosed() || !pc.remoteDescription) return;
    }
    if (!pendingRemoteCandidates.length) return;
    const runFlush = (async () => {
      const stillPending = [];
      try {
        while (!isClosed() && pc.remoteDescription && pendingRemoteCandidates.length > 0) {
          const remoteUfrag = getRemoteUfrag();
          for (const candidate of pendingRemoteCandidates.splice(0)) {
            if (isClosed()) return;
            if (remoteUfrag && candidate.usernameFragment && candidate.usernameFragment !== remoteUfrag) continue;
            if (!canApplyRemoteCandidate(candidate) || !await addIceCandidateSafe(candidate)) stillPending.push(candidate);
          }
        }
      } finally {
        if (!isClosed() && stillPending.length > 0) {
          const tail = pendingRemoteCandidates.splice(0);
          for (const item of [...stillPending, ...tail]) queueRemoteCandidate(item);
        }
        activeCandidateFlush = null;
      }
    })();
    activeCandidateFlush = runFlush;
    await runFlush;
  };
  const addRemoteCandidate = async (candidate) => {
    if (activeCandidateFlush || !canApplyRemoteCandidate(candidate)) {
      queueRemoteCandidate(candidate);
      return;
    }
    if (!await addIceCandidateSafe(candidate)) queueRemoteCandidate(candidate);
  };
  const setupDataChannel = (channel) => {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 65535;
    const failData = () => {
      warn("excessive pre-handler data; disconnecting peer");
      channel.close();
      pc.close();
      emitClose();
    };
    channel.onmessage = (e) => {
      if (dataChannel !== channel || dataState.phase === "closed") return;
      const data = e.data;
      const maxFrameBytes = dataState.phase === "bound" ? maxBulkFrameBytes : maxRoomFrameBytes;
      if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) || data.byteLength > maxFrameBytes) {
        failData();
        return;
      }
      switch (dataState.phase) {
        case "bound":
          dataState.handler(data);
          break;
        case "unbound-idle": {
          const deadlineTimer = setTimeout(failData, pendingDataTimeoutMs);
          unrefTimer(deadlineTimer);
          dataState = {
            phase: "unbound-buffering",
            queue: [data],
            deadlineTimer
          };
          break;
        }
        case "unbound-buffering":
          if (dataState.queue.length >= 64) {
            failData();
            return;
          }
          dataState.queue.push(data);
          break;
        default:
          unreachable(dataState);
      }
    };
    channel.onopen = () => {
      if (dataChannel === channel && !isClosed()) connectHandler?.();
    };
    channel.onclose = () => {
      if (dataChannel === channel) emitClose();
    };
    channel.onerror = ({ error }) => {
      if (dataChannel !== channel || isClosed() || error?.errorDetail === "sctp-failure" && (error.sctpCauseCode === 12 || /^User-Initiated Abort\b/.test(error.message))) return;
      errorHandler?.(toError(error, "data channel error"));
    };
  };
  const expectsTurnCandidate = hasIceUrl(iceServers, /^turns?:/i);
  const expectsStunCandidate = !expectsTurnCandidate && hasIceUrl(iceServers, /^stuns?:/i);
  const targetCandidatePattern = expectsTurnCandidate ? /\btyp relay\b/ : expectsStunCandidate ? /\btyp (?:srflx|relay|prflx)\b/ : /\btyp (?:host|srflx|relay|prflx)\b/;
  const waitForIceGathering = async (peerConnection) => {
    await new Promise((resolve) => {
      let done = false;
      let settleTimeout = null;
      const finish = () => {
        if (done) return;
        done = true;
        resetTimer(timeout);
        resetTimer(settleTimeout);
        peerConnection.removeEventListener(iceStateEvent, checkState);
        peerConnection.removeEventListener(iceCandidateEvent, onCandidate);
        pendingIceGathering.delete(finish);
        resolve();
      };
      const scheduleSettle = (candidateLine = "") => {
        if (done) return;
        const sdp = `${peerConnection.localDescription?.sdp ?? ""}
${candidateLine}`;
        if (targetCandidatePattern.test(sdp)) {
          resetTimer(settleTimeout);
          settleTimeout = setTimeout(finish, iceCandidateSettleMs);
          unrefTimer(settleTimeout);
        }
      };
      const checkState = () => {
        if (peerConnection.iceGatheringState === "complete" || isClosed()) finish();
        else scheduleSettle();
      };
      const onCandidate = (event) => {
        const { candidate } = event;
        if (candidate) scheduleSettle(candidate.candidate);
        else finish();
      };
      const timeout = setTimeout(finish, iceTimeout);
      unrefTimer(timeout);
      pendingIceGathering.add(finish);
      peerConnection.addEventListener(iceStateEvent, checkState);
      peerConnection.addEventListener(iceCandidateEvent, onCandidate);
      checkState();
    });
    return localDescriptionSignal(peerConnection);
  };
  const readLocalDescription = () => shouldTrickleIce ? localDescriptionSignal(pc) : waitForIceGathering(pc);
  const emitLocalDescriptionSignal = async (expectedGen) => {
    const signal = await readLocalDescription();
    if (isClosed() || expectedGen !== void 0 && offerGeneration !== expectedGen) return;
    emitSignal(signal);
    return signal;
  };
  if (initiator) {
    dataChannel = pc.createDataChannel("data");
    setupDataChannel(dataChannel);
  } else pc.ondatachannel = ({ channel }) => {
    if (dataChannel && dataChannel !== channel) {
      dataChannel.onopen = dataChannel.onclose = dataChannel.onmessage = dataChannel.onerror = null;
      dataChannel.close();
    }
    dataChannel = channel;
    setupDataChannel(channel);
  };
  const createOffer = async () => {
    if (isClosed() || negotiation.phase !== "idle" || pc.signalingState !== "stable") {
      if (isClosed()) settleInitialOffer();
      return;
    }
    const gen = ++offerGeneration;
    negotiation = {
      phase: "making-offer",
      gen
    };
    try {
      await pc.setLocalDescription();
      if (isClosed() || offerGeneration !== gen) return;
      return await emitLocalDescriptionSignal(gen);
    } catch (err) {
      if (offerGeneration !== gen) return;
      settleInitialOffer();
      errorHandler?.(toError(err, "failed to create local offer"));
    } finally {
      if (negotiation.phase === "making-offer" && negotiation.gen === gen) negotiation = { phase: "idle" };
    }
  };
  pc.onnegotiationneeded = () => {
    createOffer();
  };
  pc.onicecandidate = ({ candidate }) => {
    if (!shouldTrickleIce || !candidate || isClosed()) return;
    const candidatePayload = typeof candidate.toJSON === "function" ? candidate.toJSON() : {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment
    };
    emitSignal({
      type: candidateType,
      sdp: JSON.stringify(candidatePayload)
    });
  };
  const isDisconnectedState = () => pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected";
  const handleConnectionStateChange = () => {
    if (lifecycle.phase === "closed") return;
    const cs = pc.connectionState;
    const is = pc.iceConnectionState;
    if (cs === "failed" || cs === "closed" || is === "failed" || is === "closed") {
      emitClose();
      return;
    }
    if (cs === "connected" || cs === "connecting" || is === "connected" || is === "completed" || is === "checking") {
      clearDisconnectedGrace();
      return;
    }
    if (isDisconnectedState() && lifecycle.phase === "open") {
      const timer = setTimeout(() => {
        if (lifecycle.phase !== "disconnected-grace") return;
        lifecycle = { phase: "open" };
        if (isDisconnectedState()) emitClose();
      }, disconnectedCloseDelayMs);
      unrefTimer(timer);
      lifecycle = {
        phase: "disconnected-grace",
        timer
      };
    }
  };
  pc.onconnectionstatechange = handleConnectionStateChange;
  pc.addEventListener(iceConnectionStateEvent, handleConnectionStateChange);
  pc.ontrack = (e) => {
    const stream = e.streams[0];
    if (stream && !isClosed()) {
      if (streamHandler) streamHandler(stream);
      else pendingStreams.push(stream);
    }
  };
  if (initiator) queueMicrotask(() => {
    if (!isClosed() && negotiation.phase === "idle" && pc.signalingState === "stable" && !pc.localDescription) pc.onnegotiationneeded?.(new Event("negotiationneeded"));
  });
  return {
    connection: pc,
    get channel() {
      return dataChannel;
    },
    get isDead() {
      return isClosed();
    },
    getOffer: async () => {
      if (!initiator) return;
      if (resolveInitialOffer !== null) return initialOfferP;
      if (settledOffer && !pc.remoteDescription) return settledOffer;
      return pc.localDescription?.type === offerType ? readLocalDescription() : settledOffer;
    },
    async signal(sdp) {
      if (isClosed()) return;
      if (sdp.type === "candidate") {
        if (sdp.sdp.length > maxRemoteCandidateSdpLength) return;
        try {
          const candidate = JSON.parse(sdp.sdp);
          if (candidate && typeof candidate === "object") await addRemoteCandidate(candidate);
        } catch (err) {
          errorHandler?.(toError(err, "failed to parse remote candidate"));
        }
        return;
      }
      if (dataChannel?.readyState === "open" && !sdp.sdp?.includes("a=rtpmap")) return;
      try {
        const rtcSdp = { ...sdp };
        if (sdp.type === offerType) {
          const isCollision = negotiation.phase === "making-offer" || pc.signalingState !== "stable" && negotiation.phase !== "applying-remote-answer";
          if (isCollision && initiator) return;
          offerGeneration += 1;
          if (negotiation.phase === "making-offer") negotiation = { phase: "idle" };
          if (isCollision && pc.signalingState !== "stable") await all([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(rtcSdp)]);
          else await pc.setRemoteDescription(rtcSdp);
          await flushPendingRemoteCandidates();
          await pc.setLocalDescription();
          return await emitLocalDescriptionSignal();
        }
        if (sdp.type === answerType) {
          negotiation = { phase: "applying-remote-answer" };
          try {
            await pc.setRemoteDescription(rtcSdp);
            await flushPendingRemoteCandidates();
          } finally {
            if (negotiation.phase === "applying-remote-answer") negotiation = { phase: "idle" };
          }
        }
      } catch (err) {
        if (!isClosed()) errorHandler?.(toError(err, "failed to apply remote signal"));
      }
    },
    sendData: (data) => {
      if (isClosed() || !dataChannel || dataChannel.readyState === "closing" || dataChannel.readyState === "closed") throw mkErr(peerDisconnectedMsg);
      dataChannel.send(data);
    },
    destroy: () => {
      clearDisconnectedGrace();
      settleInitialOffer();
      dataChannel?.close();
      if (pc.connectionState !== "closed") pc.close();
      emitClose();
    },
    setHandlers: (newHandlers) => {
      if ("connect" in newHandlers) connectHandler = newHandlers.connect;
      if ("close" in newHandlers) closeHandler = newHandlers.close;
      if ("error" in newHandlers) errorHandler = newHandlers.error;
      if ("data" in newHandlers && dataState.phase !== "closed") {
        const nextDataHandler = newHandlers.data;
        if (nextDataHandler) {
          let queuedData = [];
          if (dataState.phase === "unbound-buffering") {
            resetTimer(dataState.deadlineTimer);
            queuedData = dataState.queue.splice(0);
          }
          dataState = {
            phase: "bound",
            handler: nextDataHandler
          };
          for (const frame of queuedData) {
            if (dataState.phase !== "bound") break;
            dataState.handler(frame);
          }
        } else {
          if (dataState.phase === "unbound-buffering") resetTimer(dataState.deadlineTimer);
          dataState = { phase: "unbound-idle" };
        }
      }
      if (newHandlers.signal) appendSignalHandler(newHandlers.signal);
      if ("stream" in newHandlers && !isClosed()) {
        streamHandler = newHandlers.stream;
        if (streamHandler) for (const stream of pendingStreams.splice(0)) {
          if (isClosed() || !streamHandler) break;
          streamHandler(stream);
        }
      }
    },
    addStream: (stream) => {
      stream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, stream);
        if (sender) trackSender(stream, sender);
      });
    },
    removeStream: (stream) => {
      const senders = streamSenders.get(stream);
      if (senders) {
        streamSenders.delete(stream);
        senders.forEach((sender) => pc.removeTrack(sender));
        return;
      }
      const tracks = stream.getTracks();
      pc.getSenders().forEach((sender) => {
        if (sender.track && tracks.includes(sender.track)) pc.removeTrack(sender);
      });
    },
    addTrack: (track, stream) => {
      const sender = pc.addTrack(track, stream);
      if (sender && stream) trackSender(stream, sender);
    },
    removeTrack: (track, stream) => {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) {
        if (stream) streamSenders.get(stream)?.delete(sender);
        pc.removeTrack(sender);
      }
    },
    replaceTrack: (oldTrack, newTrack) => {
      const sender = pc.getSenders().find((s) => s.track === oldTrack);
      if (sender) return sender.replaceTrack(newTrack);
    }
  };
};
var defaultIceServers = [...alloc(3, (_, i) => `stun:stun${i || ""}.l.google.com:19302`), "stun:stun.cloudflare.com:3478"].map((url) => ({ urls: url }));

// node_modules/@trystero-p2p/core/dist/actions.mjs
var maxConcurrentRequestsPerPeer = 64;
var requestFailedMsg = "request failed";
var getEnvelopeRecord = (metadata) => isObj(metadata) && typeof metadata["r"] === "string" ? metadata : null;
var getRequestMetadata = (metadata) => {
  const record = getEnvelopeRecord(metadata);
  return record ? [record.r, Object.hasOwn(record, "m") ? record.m : void 0] : null;
};
var getResponseMetadata = (metadata) => {
  const record = getEnvelopeRecord(metadata);
  return record ? [record.r, typeof record.e === "string" ? record.e : void 0] : null;
};
var withMetadata = (context, metadata) => metadata === void 0 ? context : {
  ...context,
  metadata
};
var wrapAuthMetadata = (cert, userMetadata) => cert ? {
  [authMetaKey]: cert,
  ...userMetadata === void 0 ? {} : { m: userMetadata }
} : userMetadata;
var extractAuthMetadata = (wireMeta) => {
  if (isObj(wireMeta) && authMetaKey in wireMeta) {
    const rawCert = wireMeta[authMetaKey];
    return [validateRoleCertificateShape(rawCert) ? rawCert : void 0, Object.hasOwn(wireMeta, "m") ? wireMeta["m"] : void 0];
  }
  return [void 0, wireMeta];
};
var normalizeRequiredRoles = (roles2) => {
  if (roles2 === void 0) return [];
  const list = [roles2].flat().filter(Boolean);
  if (list.length === 0) throw mkErr("action roles must contain at least one non-empty role name");
  return [...new Set(list)].sort();
};
var sameSortedRoles = (a, b) => a.length === b.length && a.every((role, idx) => role === b[idx]);
var createActionManager = (deps) => {
  const resolveTransport = deps.getTransport;
  const userIdOf = (peerId) => deps.getPeerUserId ? deps.getPeerUserId(peerId) : peerId;
  const rolesOf = (peerId) => deps.getPeerRoles ? [...deps.getPeerRoles(peerId)] : [];
  const hasActivePeer = (peerId) => Boolean(resolveTransport(peerId, false)?.isOpen);
  const publicActions = /* @__PURE__ */ Object.create(null);
  const internalActions = /* @__PURE__ */ new Map();
  const requestWaiters = /* @__PURE__ */ new Map();
  const activeRequestControllers = /* @__PURE__ */ new Map();
  const { makeWireAction, handleData, clearPeer: clearWirePeer } = createActionWireManager({
    resolveTransport,
    getPeerIds: deps.getPeerIds,
    canReceiveFromPeer: deps.canReceiveFromPeer,
    onPeerError: deps.onPeerError,
    ...deps.broadcastInline ? { broadcastInline: deps.broadcastInline } : {},
    ...deps.onUnknownType ? { onUnknownType: deps.onUnknownType } : {},
    ...deps.maxReceiveBytes === void 0 ? {} : { maxReceiveBytes: deps.maxReceiveBytes }
  });
  const toProgressBridge = (handler, metadata) => handler ? (progress, peerId) => {
    const res = handler(progress, withMetadata({
      peerId,
      userId: userIdOf(peerId)
    }, metadata));
    if (res && typeof res.then === "function") Promise.resolve(res).catch((err) => logErr("progress handler", err));
  } : void 0;
  const makeInternalAction = (type, options = {}) => {
    const wireType = type.startsWith("@_") ? type : `${"@_"}${type}`;
    const sendToPending = Boolean(options.sendToPending);
    const wireAction = makeWireAction(wireType, options);
    const existing = internalActions.get(wireType);
    if (existing) return existing;
    const [subProgress, emitProgress, , hasProgressListeners] = createEventEmitter("progress handler");
    const [subMessage, emitMessage] = createEventEmitter("internal action handler", (active) => {
      wireAction.onMessage(active ? (payload, peerId, metadata) => {
        emitMessage(payload, withMetadata({
          peerId,
          userId: userIdOf(peerId)
        }, metadata));
      } : null);
    });
    const [setReceiveGate, getReceiveGate] = initSingleHandler("onReceive", (handler) => {
      wireAction.onReceive(handler ? (ctx) => handler(withMetadata({
        peerId: ctx.peerId,
        userId: userIdOf(ctx.peerId),
        byteLength: ctx.byteLength,
        signal: ctx.signal
      }, ctx.metadata)) : null);
    });
    wireAction.onProgress((progress, peerId, metadata) => {
      if (hasProgressListeners()) emitProgress(progress, withMetadata({
        peerId,
        userId: userIdOf(peerId)
      }, metadata));
    });
    const action = lockMethods({
      send: (data, sendOpts = {}) => wireAction.send(data, deps.resolveSendTarget ? deps.resolveSendTarget(sendOpts.target, sendToPending) : sendOpts.target, sendOpts.metadata, toProgressBridge(sendOpts.onProgress, sendOpts.metadata), sendOpts.signal),
      onMessage: (handler, listenerOpts) => subMessage(handler, listenerOpts),
      onReceiveProgress: (handler, listenerOpts) => subProgress(handler, listenerOpts),
      onReceive: (handler, listenerOpts) => setReceiveGate(handler ?? getReceiveGate(), listenerOpts)
    }, [
      "onMessage",
      "onReceive",
      "onReceiveProgress"
    ]);
    internalActions.set(wireType, action);
    return action;
  };
  const closeWaiter = (waiter) => {
    const prev = waiter.state;
    switch (prev.phase) {
      case "done":
        return false;
      case "preparing":
        waiter.state = { phase: "done" };
        requestWaiters.delete(waiter.requestId);
        prev.controller.abort();
        return true;
      case "active":
        waiter.state = { phase: "done" };
        resetTimer(prev.timer);
        requestWaiters.delete(waiter.requestId);
        prev.controller.abort();
        return true;
      default:
        return unreachable(prev);
    }
  };
  const isWaiterSettled = (waiter) => waiter.state.phase === "done";
  const activateWaiter = (waiter, timeoutMs) => {
    if (waiter.state.phase !== "preparing") return false;
    let timer = null;
    if (timeoutMs !== void 0) {
      timer = setTimeout(() => {
        if (waiter.state.phase === "active") waiter.reject(makeActionError("timeout", "request timed out"));
      }, timeoutMs);
      unrefTimer(timer);
    }
    waiter.state = {
      phase: "active",
      controller: waiter.state.controller,
      timer
    };
    return true;
  };
  const clearPeer = (id, error) => {
    clearWirePeer(id);
    const controllers = activeRequestControllers.get(id);
    if (controllers) {
      activeRequestControllers.delete(id);
      controllers.forEach((controller) => controller.abort());
    }
    const disconnectedErr = makeActionError("disconnected", toErrorMessage(error, peerDisconnectedMsg));
    for (const waiter of Array.from(requestWaiters.values())) {
      if (waiter.peerId !== id) continue;
      switch (waiter.state.phase) {
        case "preparing":
        case "active":
          waiter.reject(disconnectedErr);
          break;
        case "done":
          break;
        default:
          unreachable(waiter.state);
      }
    }
  };
  const matchResponseWaiter = (peerId, metadata) => {
    const parsed = getResponseMetadata(metadata);
    const waiter = parsed ? requestWaiters.get(parsed[0]) : void 0;
    return parsed && waiter && waiter.state.phase === "active" && waiter.peerId === peerId ? [parsed, waiter] : null;
  };
  const responseAction = makeWireAction(`${"@_"}response`, { receiveScope: (peerId, metadata) => {
    const matched = matchResponseWaiter(peerId, metadata);
    if (!matched) return null;
    const [parsed, waiter] = matched;
    if (waiter.state.phase !== "active") return null;
    const receive = parsed[1] === void 0 ? waiter.getReceive() : null;
    return [
      parsed[0],
      waiter.state.controller.signal,
      receive ? (context) => receive({
        byteLength: context.byteLength,
        peerId: context.peerId,
        userId: userIdOf(context.peerId),
        kind: "response",
        signal: context.signal,
        roles: rolesOf(context.peerId)
      }) : null,
      (reason) => {
        waiter.reject(makeActionError("rejected", reason));
      }
    ];
  } });
  responseAction.onProgress((progress, id, metadata) => {
    const matched = matchResponseWaiter(id, metadata);
    if (matched && matched[0][1] === void 0) matched[1].emitReceiveProgress(progress, {
      peerId: id,
      userId: userIdOf(id)
    });
  });
  responseAction.onMessage((payload, id, metadata) => {
    const matched = matchResponseWaiter(id, metadata);
    if (!matched) return;
    const [parsed, waiter] = matched;
    if (parsed[1] !== void 0) waiter.reject(makeActionError("rejected", parsed[1]));
    else waiter.resolve(payload);
  });
  const makeActionCore = (type, config, internal) => {
    if (!internal && type.startsWith("@_")) throw mkErr(`action namespace "${type}" is reserved for internal protocol use`);
    if (config && ("onMessage" in config || "onRequest" in config || "onReceive" in config || "onReceiveProgress" in config)) throw mkErr("makeAction config does not accept event handlers; subscribe via action.on*(fn)");
    const kind = config?.kind ?? "message";
    const requiredRoles = normalizeRequiredRoles(config?.roles);
    const hasRoleGuard = requiredRoles.length > 0;
    const existing = publicActions[type];
    if (existing) {
      if (existing.kind !== kind || existing.internal !== internal || !sameSortedRoles(existing.requiredRoles, requiredRoles)) throw actionRedefinedErr(type);
      return existing.action;
    }
    if (hasRoleGuard) deps.registerActionAuthority?.(type, requiredRoles);
    const rawAction = makeWireAction(type);
    const [subProgress, emitProgress, clearProgress, hasProgressListeners] = createEventEmitter("progress handler");
    const extractWireMeta = (metadata) => extractAuthMetadata(kind === "request" ? getRequestMetadata(metadata)?.[1] : metadata);
    const resolveReqPeer = (target) => (deps.resolveRequestTarget ? deps.resolveRequestTarget(target, false) : target) ?? target;
    const buildPeerContext = (peerId, userMeta) => withMetadata({
      peerId,
      userId: userIdOf(peerId),
      roles: rolesOf(peerId)
    }, userMeta);
    const buildGateContext = (context, userMeta) => ({
      ...buildPeerContext(context.peerId, userMeta),
      byteLength: context.byteLength,
      signal: context.signal,
      kind
    });
    const syncReceiveGate = () => {
      if (!Boolean(getReceiveGate()) && !hasRoleGuard) {
        rawAction.onReceive(null);
        return;
      }
      rawAction.onReceive((context) => {
        const [inlineCert, userMeta] = extractWireMeta(context.metadata);
        if (!hasRoleGuard) {
          const gate = getReceiveGate();
          return gate ? gate(buildGateContext(context, userMeta)) : true;
        }
        if (!deps.authorizePeerAction) return false;
        const authRes = deps.authorizePeerAction(context.peerId, requiredRoles, inlineCert);
        const afterAuth = (allowed) => {
          if (!allowed) return false;
          const gate = getReceiveGate();
          return gate ? gate(buildGateContext(context, userMeta)) : true;
        };
        return typeof authRes === "boolean" ? afterAuth(authRes) : authRes.then(afterAuth, () => false);
      });
    };
    const [setReceiveGate, getReceiveGate, clearReceiveGate] = initSingleHandler("onReceive", () => syncReceiveGate());
    syncReceiveGate();
    rawAction.onProgress((progress, peerId, metadata) => {
      if (hasProgressListeners()) {
        const [, userMeta] = extractWireMeta(metadata);
        emitProgress(progress, withMetadata({
          peerId,
          userId: userIdOf(peerId)
        }, userMeta));
      }
    });
    const prepareSendMeta = async (userMeta) => {
      if (!hasRoleGuard) return userMeta;
      if (!deps.getLocalActionCert) throw mkErr(`${insufficientAuthPrefix} for action "${type}": requires [${requiredRoles.join(", ")}]`);
      const cert = await deps.getLocalActionCert(requiredRoles, type);
      return wrapAuthMetadata(cert, userMeta);
    };
    if (kind === "message") {
      const receiveMessage = (payload, peerId, metadata) => {
        if (hasRoleGuard && (!deps.authorizePeerAction || deps.authorizePeerAction(peerId, requiredRoles) !== true)) return;
        const [, userMeta] = extractAuthMetadata(metadata);
        emitMessage(payload, buildPeerContext(peerId, userMeta));
      };
      const [subMessage, emitMessage, clearMessage] = createEventEmitter("action handler", (active) => rawAction.onMessage(active ? receiveMessage : null));
      const action = lockMethods({
        send: async (data, options = {}) => {
          throwIfAborted(options.signal);
          const wireMetadata = hasRoleGuard ? await prepareSendMeta(options.metadata) : options.metadata;
          await rawAction.send(data, deps.resolveSendTarget ? deps.resolveSendTarget(options.target, false) : options.target, wireMetadata, toProgressBridge(options.onProgress, options.metadata), options.signal);
        },
        onMessage: (handler, options) => subMessage(handler, options),
        onReceive: (handler, options) => setReceiveGate(handler, options),
        onReceiveProgress: (handler, options) => subProgress(handler, options)
      }, [
        "onMessage",
        "onReceive",
        "onReceiveProgress"
      ]);
      publicActions[type] = {
        kind,
        requiredRoles,
        action,
        internal,
        clear: () => {
          clearMessage();
          clearReceiveGate();
          clearProgress();
        }
      };
      return action;
    }
    rawAction.onReject((peerId, metadata, reason) => {
      const parsed = getRequestMetadata(metadata);
      if (parsed) responseAction.send(null, peerId, {
        r: parsed[0],
        e: reason
      }).catch(noOp2);
    });
    const receiveRequest = (payload, peerId, metadata) => {
      const parsed = getRequestMetadata(metadata);
      if (!parsed) return;
      const requestId = parsed[0];
      let peerControllers = activeRequestControllers.get(peerId);
      if ((peerControllers?.size ?? 0) >= maxConcurrentRequestsPerPeer) {
        responseAction.send(null, peerId, {
          r: requestId,
          e: "too many concurrent requests"
        }).catch(noOp2);
        return;
      }
      const controller = new AbortController();
      if (!peerControllers) {
        peerControllers = /* @__PURE__ */ new Set();
        activeRequestControllers.set(peerId, peerControllers);
      }
      peerControllers.add(controller);
      const runHandler = async () => {
        if (hasRoleGuard && (!deps.authorizePeerAction || await deps.authorizePeerAction(peerId, requiredRoles) !== true)) throw mkErr(`${insufficientAuthPrefix} for request`);
        const handler = getRequestGate();
        if (!handler) throw mkErr("no active request handler");
        const [, userMeta] = extractAuthMetadata(parsed[1]);
        const response = await handler(payload, {
          ...buildPeerContext(peerId, userMeta),
          signal: controller.signal
        });
        if (response === void 0) throw mkErr("request handler returned undefined");
        return response;
      };
      runHandler().then((response) => controller.signal.aborted ? void 0 : responseAction.send(response, peerId, { r: requestId }, void 0, controller.signal), (error) => controller.signal.aborted ? void 0 : responseAction.send(null, peerId, {
        r: requestId,
        e: toErrorMessage(error, requestFailedMsg).slice(0, 512)
      }, void 0, controller.signal)).catch(noOp2).finally(() => {
        const set = activeRequestControllers.get(peerId);
        set?.delete(controller);
        if (set && !set.size) activeRequestControllers.delete(peerId);
        controller.abort();
      });
    };
    const [setRequestGate, getRequestGate, clearRequestGate] = initSingleHandler("onRequest", (handler) => rawAction.onMessage(handler ? receiveRequest : null));
    const requestToResolvedPeer = async (data, resolvedTarget, displayTarget, options) => {
      const { metadata, onProgress, signal, timeoutMs } = options;
      throwIfAborted(signal);
      if (!hasActivePeer(resolvedTarget)) throw makeActionError("disconnected", noActivePeerMsg(displayTarget));
      const requestId = crypto.randomUUID();
      const controller = new AbortController();
      const { promise: responsePromise, resolve, reject } = Promise.withResolvers();
      responsePromise.catch(noOp2);
      const waiter = {
        requestId,
        peerId: resolvedTarget,
        state: {
          phase: "preparing",
          controller
        },
        getReceive: getReceiveGate,
        emitReceiveProgress: emitProgress,
        resolve: (payload) => {
          if (closeWaiter(waiter)) resolve(payload);
        },
        reject: (err) => {
          if (closeWaiter(waiter)) reject(err);
        }
      };
      requestWaiters.set(requestId, waiter);
      if (signal) {
        const rejectAsAborted = () => {
          waiter.reject(makeActionError("aborted", operationAbortedMsg));
        };
        if (signal.aborted) rejectAsAborted();
        else signal.addEventListener("abort", rejectAsAborted, {
          once: true,
          signal: controller.signal
        });
      }
      if (isWaiterSettled(waiter)) return await responsePromise;
      let innerMeta = metadata;
      if (hasRoleGuard) {
        try {
          innerMeta = await prepareSendMeta(metadata);
        } catch (err) {
          waiter.reject(toError(err, requestFailedMsg));
          return await responsePromise;
        }
        if (isWaiterSettled(waiter)) return await responsePromise;
        if (!hasActivePeer(resolvedTarget)) {
          waiter.reject(makeActionError("disconnected", noActivePeerMsg(displayTarget)));
          return await responsePromise;
        }
      }
      if (!activateWaiter(waiter, timeoutMs)) return await responsePromise;
      try {
        const sendSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        rawAction.send(data, resolvedTarget, innerMeta === void 0 ? { r: requestId } : {
          r: requestId,
          m: innerMeta
        }, toProgressBridge(onProgress, metadata), sendSignal).catch((err) => {
          waiter.reject(toError(err, requestFailedMsg));
        });
        return await responsePromise;
      } finally {
        waiter.reject(makeActionError("aborted", operationAbortedMsg));
      }
    };
    const requestOne = (data, options) => {
      const { target, ...rest } = options;
      return requestToResolvedPeer(data, resolveReqPeer(target), target, rest);
    };
    const lockedAction = lockMethods({
      request: requestOne,
      requestMany: async (data, options) => {
        const { targets, onResult, ...requestOptions } = options;
        throwIfAborted(requestOptions.signal);
        return all(targets.map(async (target) => {
          const resolvedTarget = resolveReqPeer(target);
          const base = {
            peerId: resolvedTarget,
            userId: userIdOf(resolvedTarget) || target
          };
          let result;
          try {
            result = {
              ...base,
              status: "fulfilled",
              value: await requestToResolvedPeer(data, resolvedTarget, target, requestOptions)
            };
          } catch (err) {
            const error = toError(err, requestFailedMsg);
            if (error.kind === "aborted" || !error.kind) throw error;
            result = error.kind === "timeout" || error.kind === "disconnected" ? {
              ...base,
              status: error.kind
            } : {
              ...base,
              status: "rejected",
              error
            };
          }
          onResult?.(result);
          return result;
        }));
      },
      onRequest: (handler, options) => setRequestGate(handler, options),
      onReceive: (handler, options) => setReceiveGate(handler, options),
      onReceiveProgress: (handler, options) => subProgress(handler, options)
    }, [
      "onRequest",
      "onReceive",
      "onReceiveProgress"
    ]);
    publicActions[type] = {
      kind,
      requiredRoles,
      action: lockedAction,
      internal,
      clear: () => {
        clearRequestGate();
        clearReceiveGate();
        clearProgress();
      }
    };
    return lockedAction;
  };
  return {
    makeAction: ((type, config) => makeActionCore(type, config, false)),
    makeInternalAction,
    makeInternalRequestAction: (type) => {
      const wireType = type.startsWith("@_") ? type : `${"@_"}${type}`;
      return makeActionCore(wireType, { kind: "request" }, true);
    },
    handleData,
    clearPeer,
    clearListeners: () => {
      values(publicActions).forEach((entry) => {
        if (!entry.internal) entry.clear();
      });
    }
  };
};

// node_modules/@trystero-p2p/core/dist/handshake.mjs
var peerIdentityErr = /* @__PURE__ */ mkErr("peer identity verification failed");
var handshakeDisconnectErr = /* @__PURE__ */ mkErr("peer disconnected during handshake");
var defaultHandshakeTimeoutMs = 1e4;
var maxBufferedHandshakeMessages = 16;
var hsStepKey = `__${libId}_id`;
var hsDomain = /* @__PURE__ */ domainTag("id-hs", 2);
var extractDtlsFingerprints = (sdp) => {
  if (!sdp || typeof sdp !== "string") return [];
  const matches = sdp.matchAll(/^a=fingerprint:([^\r\n]+)$/gm);
  const set = /* @__PURE__ */ new Set();
  for (const m of matches) {
    const val = m[1]?.trim().toLowerCase();
    if (val) set.add(val);
  }
  return [...set].sort();
};
var parseAndVerifyPeerIdentityClaims = async (raw, expectedStep, remotePeerId, expectedRemoteDtls, localDtls = []) => {
  if (!raw || typeof raw !== "object") throw peerIdentityErr;
  const msg = raw;
  if (msg[hsStepKey] !== expectedStep || typeof msg.n !== "string" || msg.n.length < 16 || !Array.isArray(msg.dtls) || !isStr(msg.uid) || typeof msg.pk !== "string" || typeof msg.uk !== "string" || expectedStep === 2 && (typeof msg.ps !== "string" || typeof msg.us !== "string")) throw peerIdentityErr;
  const dtls = msg.dtls.filter((x) => typeof x === "string");
  if (expectedRemoteDtls.length > 0 && expectedRemoteDtls.join(",") !== dtls.join(",") || localDtls.length > 0 && dtls.length === 0) throw mkErr("DTLS fingerprint mismatch");
  const peerPubJwk = compactPubToJwk(msg.pk);
  const userPubJwk = compactPubToJwk(msg.uk);
  if (!peerPubJwk || !userPubJwk) throw peerIdentityErr;
  const [peerOk, userOk] = await all([verifyPeerIdKey(remotePeerId, peerPubJwk), verifyUserIdKey(msg.uid, userPubJwk)]);
  if (!peerOk || !userOk) throw peerIdentityErr;
  return [
    msg.n,
    dtls,
    msg.uid,
    peerPubJwk,
    userPubJwk,
    typeof msg.ps === "string" ? msg.ps : void 0,
    typeof msg.us === "string" ? msg.us : void 0
  ];
};
var verifyTranscriptDualSignatures = async (transcriptBytes, peerSigB64, userSigB64, peerPubJwk, userPubJwk) => {
  const [peerOk, userOk] = await all([verifyWithP256(fromBase64Url(peerSigB64), transcriptBytes, peerPubJwk), verifyWithP256(fromBase64Url(userSigB64), transcriptBytes, userPubJwk)]);
  if (!peerOk || !userOk) throw peerIdentityErr;
};
var createIdentityHandshake = (deps) => {
  const { endpointIdentityP, appId, roomId, getUserIdentity, onVerified } = deps;
  const signTranscript = async (transcriptBytes, localUser) => {
    const localEndpoint = await endpointIdentityP;
    const [psBytes, usBytes] = await all([localEndpoint.sign(transcriptBytes), localUser.sign(transcriptBytes)]);
    return {
      ps: toBase64Url(psBytes),
      us: toBase64Url(new Uint8Array(usBytes))
    };
  };
  const encodeTranscript = (resolvedRoomId, initPeerId, respPeerId, initNonce, respNonce, initDtls, respDtls, initUid, respUid) => encodeBytes(toJson([
    hsDomain,
    appId,
    resolvedRoomId,
    initPeerId,
    respPeerId,
    initNonce,
    respNonce,
    initDtls,
    respDtls,
    initUid,
    respUid
  ]));
  const run = async (remotePeerId, send, receive, isInitiator, peerHandle) => {
    const [resolvedRoomId, localUser, localEndpoint] = await all([
      roomId,
      getUserIdentity(),
      endpointIdentityP
    ]);
    const effectiveSelfId = localEndpoint.peerId;
    const peer = peerHandle ?? deps.getPeerHandle?.(remotePeerId);
    const localDtls = extractDtlsFingerprints(peer?.connection?.localDescription?.sdp);
    const remoteDtls = extractDtlsFingerprints(peer?.connection?.remoteDescription?.sdp);
    if (peer?.connection && (!localDtls.length || !remoteDtls.length)) throw mkErr("DTLS fingerprint missing");
    const sendClaims = (step, n, extra) => send({
      [hsStepKey]: step,
      n,
      dtls: localDtls,
      uid: localUser.userId,
      pk: jwkToCompactPub(localEndpoint.signPubJwk),
      uk: jwkToCompactPub(localUser.signPubJwk),
      ...extra
    });
    const verifyStep = (raw, step) => parseAndVerifyPeerIdentityClaims(raw, step, remotePeerId, remoteDtls, localDtls);
    const resolveRemoteDtls = (claimed) => remoteDtls.length > 0 ? remoteDtls : claimed;
    const toVerified = (userId, peerPubKey, userPubKey) => ({
      userId,
      peerPubKey,
      userPubKey
    });
    if (isInitiator) {
      const initNonce = crypto.randomUUID();
      await sendClaims(1, initNonce);
      const { data: step2 } = await receive();
      const [rNonce, rDtls, rUid, rPeerPub, rUserPub, rPs, rUs] = await verifyStep(step2, 2);
      const transcriptBytes2 = encodeTranscript(resolvedRoomId, effectiveSelfId, remotePeerId, initNonce, rNonce, localDtls, resolveRemoteDtls(rDtls), localUser.userId, rUid);
      await verifyTranscriptDualSignatures(transcriptBytes2, rPs, rUs, rPeerPub, rUserPub);
      const sigs = await signTranscript(transcriptBytes2, localUser);
      const sendStep3 = () => send({
        [hsStepKey]: 3,
        ...sigs
      });
      const verified2 = toVerified(rUid, rPeerPub, rUserPub);
      try {
        onVerified?.(remotePeerId, verified2, peer);
      } catch (err) {
        if (err === peerBannedErr) await sendStep3();
        throw err;
      }
      await sendStep3();
      return verified2;
    }
    const { data: step1 } = await receive();
    const [iNonce, iDtls, iUid, iPeerPub, iUserPub] = await verifyStep(step1, 1);
    const respNonce = crypto.randomUUID();
    const transcriptBytes = encodeTranscript(resolvedRoomId, remotePeerId, effectiveSelfId, iNonce, respNonce, resolveRemoteDtls(iDtls), localDtls, iUid, localUser.userId);
    await sendClaims(2, respNonce, await signTranscript(transcriptBytes, localUser));
    const { data: step3 } = await receive();
    if (!step3 || typeof step3 !== "object") throw peerIdentityErr;
    const msg3 = step3;
    if (msg3[hsStepKey] !== 3 || typeof msg3.ps !== "string" || typeof msg3.us !== "string") throw peerIdentityErr;
    await verifyTranscriptDualSignatures(transcriptBytes, msg3.ps, msg3.us, iPeerPub, iUserPub);
    const verified = toVerified(iUid, iPeerPub, iUserPub);
    onVerified?.(remotePeerId, verified, peer);
    return verified;
  };
  return { run };
};
var clearQueue = (queue, error) => {
  queue.messages.length = 0;
  for (const [, reject] of queue.waiters.splice(0)) reject(error);
};
var clearEntryTimer = (entry) => {
  if ("timer" in entry) resetTimer(entry.timer);
};
var createHandshakeManager = (deps) => {
  const { selfIdP, onPeerHandshake, onHandshakeError, deferResponderReady, sendHandshakeData, sendHandshakeReady, onLocalHandshakePassed, acquireAdmissionSlot, beforeSendHandshakeReady, onActivate, onFailure } = deps;
  const peerStates = /* @__PURE__ */ new Map();
  const getCurrentPending = (id, peer) => {
    const entry = peerStates.get(id);
    if (!entry || entry.phase === "active" || peer && entry.peer !== peer) return;
    return entry;
  };
  const activatePeer = (id, entry) => {
    clearEntryTimer(entry);
    peerStates.set(id, {
      phase: "active",
      peer: entry.peer
    });
    onActivate(id, entry.peer);
  };
  const failPeerHandshake = (id, peer, reason) => {
    const entry = peerStates.get(id);
    if (!entry || entry.peer !== peer) return;
    clearEntryTimer(entry);
    onHandshakeError?.(id, reason);
    onFailure(id, peer, reason);
  };
  const beginPreparingReady = (id, peer, timer, remoteReady) => {
    if (!acquireAdmissionSlot(id, peer)) return;
    const current = getCurrentPending(id, peer);
    if (!current) return;
    const nextRemoteReady = remoteReady || current.phase === "awaiting-remote-ready" || "remoteReady" in current && current.remoteReady;
    peerStates.set(id, {
      phase: "preparing-ready",
      peer,
      timer,
      remoteReady: nextRemoteReady
    });
    const finishReady = (payload) => {
      const preparing = peerStates.get(id);
      if (!preparing || preparing.phase !== "preparing-ready" || preparing.peer !== peer) return;
      const isRemoteReady = preparing.remoteReady;
      if (isRemoteReady) {
        clearEntryTimer(preparing);
        peerStates.set(id, {
          phase: "active",
          peer
        });
      } else peerStates.set(id, {
        phase: "awaiting-peer-ready",
        peer,
        timer: preparing.timer
      });
      sendHandshakeReady(payload || "", id).catch((err) => failPeerHandshake(id, peer, mkErr(`handshake ready send failed: ${toErrorMessage(err, "send failed")}`)));
      if (isRemoteReady) onActivate(id, peer);
    };
    let prep;
    try {
      prep = beforeSendHandshakeReady(id, peer);
    } catch {
      prep = void 0;
    }
    if (prep) {
      prep.then(finishReady, () => finishReady());
      return;
    }
    finishReady();
  };
  const clearPeerInternal = (id, error) => {
    const entry = peerStates.get(id);
    if (!entry) return;
    clearEntryTimer(entry);
    if ("queue" in entry) clearQueue(entry.queue, error);
    peerStates.delete(id);
  };
  return {
    addPeer: (id, peer) => {
      if (peerStates.has(id)) clearPeerInternal(id, handshakeDisconnectErr);
      peerStates.set(id, {
        phase: "added",
        peer,
        queue: {
          messages: [],
          waiters: []
        },
        remoteReady: false
      });
    },
    clearPeer: clearPeerInternal,
    canReceiveFromPeer: (id, receiveWhilePending) => {
      const entry = peerStates.get(id);
      return Boolean(entry && (entry.phase === "active" || receiveWhilePending));
    },
    start: (id, peer) => {
      const existing = peerStates.get(id);
      if (!existing || existing.phase !== "added" || existing.peer !== peer) return;
      const timer = setTimeout(() => failPeerHandshake(id, peer, mkErr(`handshake timed out after ${defaultHandshakeTimeoutMs}ms`)), defaultHandshakeTimeoutMs);
      unrefTimer(timer);
      peerStates.set(id, {
        phase: "running-steps",
        peer,
        timer,
        role: "resolving",
        queue: existing.queue,
        remoteReady: existing.remoteReady
      });
      const sendHandshake = async (data, metadata) => {
        if (peerStates.get(id)?.peer !== peer) throw handshakeDisconnectErr;
        await sendHandshakeData(data, id, metadata);
      };
      const receiveHandshake = () => new Promise((resolve, reject) => {
        const current = peerStates.get(id);
        if (!current || current.peer !== peer || current.phase !== "running-steps") {
          reject(handshakeDisconnectErr);
          return;
        }
        const buffered = current.queue.messages.shift();
        if (buffered) {
          resolve(buffered);
          return;
        }
        current.queue.waiters.push([resolve, reject]);
      });
      selfIdP.then((effectiveSelfId) => {
        const isInitiator = effectiveSelfId < id;
        const current = peerStates.get(id);
        if (current?.phase === "running-steps" && current.peer === peer) peerStates.set(id, {
          ...current,
          role: isInitiator ? "initiator" : "responder"
        });
        return onPeerHandshake(id, sendHandshake, receiveHandshake, isInitiator, peer);
      }).then(() => {
        const current = peerStates.get(id);
        if (!current || current.phase !== "running-steps" || current.peer !== peer) return;
        clearQueue(current.queue, handshakeDisconnectErr);
        if (!onLocalHandshakePassed(id, peer)) return;
        const latest = peerStates.get(id);
        if (!latest || latest.phase !== "running-steps" || latest.peer !== peer) return;
        if (deferResponderReady && latest.role === "responder" && !latest.remoteReady) {
          peerStates.set(id, {
            phase: "awaiting-remote-ready",
            peer,
            timer: latest.timer
          });
          return;
        }
        beginPreparingReady(id, peer, latest.timer, latest.remoteReady);
      }).catch((err) => failPeerHandshake(id, peer, toError(err, "handshake failed")));
    },
    receiveData: (data, id, metadata) => {
      const entry = peerStates.get(id);
      if (!entry || !("queue" in entry)) return;
      const payload = metadata === void 0 ? { data } : {
        data,
        metadata
      };
      const waiter = entry.queue.waiters.shift();
      if (waiter) {
        waiter[0](payload);
        return;
      }
      if (entry.queue.messages.length >= maxBufferedHandshakeMessages) {
        failPeerHandshake(id, entry.peer, mkErr("too many pending handshake messages"));
        return;
      }
      entry.queue.messages.push(payload);
    },
    receiveReady: (id) => {
      const entry = peerStates.get(id);
      if (!entry || entry.phase === "active") return;
      switch (entry.phase) {
        case "added":
        case "running-steps":
        case "preparing-ready":
          peerStates.set(id, {
            ...entry,
            remoteReady: true
          });
          return;
        case "awaiting-remote-ready":
          beginPreparingReady(id, entry.peer, entry.timer, true);
          return;
        case "awaiting-peer-ready":
          activatePeer(id, entry);
          return;
        default:
          unreachable(entry);
      }
    },
    getPeer: (id) => peerStates.get(id)?.peer
  };
};

// node_modules/@trystero-p2p/core/dist/media.mjs
var isStreamTracked = (entry) => entry?.phase === "waiting" || entry?.phase === "active";
var toParsedMediaMeta = (value) => {
  if (!isObj(value) || typeof value["k"] !== "string") return null;
  const rawTrackCount = value["t"];
  const hasMetadata = Object.hasOwn(value, "m");
  return {
    key: value["k"],
    streamId: typeof value["s"] === "string" ? value["s"] : void 0,
    expectedTrackCount: typeof rawTrackCount === "number" && Number.isInteger(rawTrackCount) && rawTrackCount >= 0 ? rawTrackCount : void 0,
    hasMetadata,
    metadata: hasMetadata ? value["m"] : void 0
  };
};
var tracksOf = (stream) => stream?.getTracks?.() ?? [];
var streamIdOf = (stream) => typeof stream.id === "string" ? stream.id : void 0;
var waitingForTracks = (expectedCount, currentTracks) => expectedCount !== void 0 && expectedCount > 0 && currentTracks.length < expectedCount;
var bindTargetEvent = (target, event, listener, cleanups) => {
  if (typeof target.addEventListener === "function" && typeof target.removeEventListener === "function") {
    target.addEventListener(event, listener);
    cleanups.push(() => {
      target.removeEventListener?.(event, listener);
    });
  }
};
var makeStreamKeyGetter = () => {
  const localStreamKeys = /* @__PURE__ */ new WeakMap();
  return (stream) => {
    let key = localStreamKeys.get(stream);
    if (!key) {
      key = crypto.randomUUID();
      localStreamKeys.set(stream, key);
    }
    return key;
  };
};
var createMediaIdentityCache = () => {
  const remoteStreamsByKey = /* @__PURE__ */ new Map();
  const remoteStreamsById = /* @__PURE__ */ new Map();
  const remoteStreamKeys = /* @__PURE__ */ new WeakMap();
  return {
    getStreamKey: makeStreamKeyGetter(),
    rememberRemoteStream: (key, stream, streamId) => {
      const previous = remoteStreamKeys.get(stream);
      if (previous !== void 0 && remoteStreamsByKey.get(previous) === stream) remoteStreamsByKey.delete(previous);
      remoteStreamKeys.set(stream, key);
      remoteStreamsByKey.set(key, stream);
      if (streamId) remoteStreamsById.set(streamId, stream);
    },
    getRemoteStream: (key, streamId) => remoteStreamsByKey.get(key) ?? (streamId ? remoteStreamsById.get(streamId) : void 0),
    hasRemoteMedia: () => remoteStreamsByKey.size > 0,
    clearRemote: () => {
      remoteStreamsByKey.clear();
      remoteStreamsById.clear();
    }
  };
};
var findWaitingStream = (peerState, streamId) => {
  for (const [stream, record] of peerState.streams) if (record.phase === "waiting" && (!streamId || stream.id === streamId)) return stream;
};
var countWaitingStreams = (peerState) => {
  let count = 0;
  for (const record of peerState.streams.values()) if (record.phase === "waiting") count++;
  return count;
};
var createMediaManager = ({ iterate, isActive, preparePeer, getPeerUserId, onPeerError, onPeerMediaPinChange }) => {
  const peerRemoteMedia = /* @__PURE__ */ new Map();
  const peerLocalMedia = /* @__PURE__ */ new Map();
  const [subStream, emitStreamEvt, clearStreamEvt] = createEventEmitter("peer stream handler");
  const getLocalStreamKey = makeStreamKeyGetter();
  const localStreamMetas = /* @__PURE__ */ new WeakMap();
  const localStreamRawTracks = /* @__PURE__ */ new WeakMap();
  const globalReplacedTracks = /* @__PURE__ */ new WeakMap();
  let nextLocalSyncGen = 0;
  const ensurePeerRemoteMedia = (id) => {
    let state = peerRemoteMedia.get(id);
    if (!state) {
      state = {
        identityCache: createMediaIdentityCache(),
        metaQueue: [],
        streams: /* @__PURE__ */ new Map()
      };
      peerRemoteMedia.set(id, state);
    }
    return state;
  };
  const ensurePeerLocalMedia = (id) => {
    let state = peerLocalMedia.get(id);
    if (!state) {
      state = { streams: /* @__PURE__ */ new Map() };
      peerLocalMedia.set(id, state);
    }
    return state;
  };
  const hasActiveRemoteMediaForPeer = (id) => {
    const remote = peerRemoteMedia.get(id);
    if (!remote) return false;
    for (const record of remote.streams.values()) if (record.phase === "active") return true;
    return false;
  };
  const hasSyncedLocalMediaForPeer = (id) => Boolean(peerLocalMedia.get(id)?.streams.size);
  const updatePeerPin = (id) => {
    onPeerMediaPinChange?.(id, hasActiveRemoteMediaForPeer(id) || hasSyncedLocalMediaForPeer(id));
  };
  const getMediaPeer = async (id, directPeer) => {
    const mediaPeer = directPeer ?? (preparePeer ? await preparePeer(id) : void 0);
    if (!mediaPeer) throw peerDisconnectedErr;
    return mediaPeer;
  };
  const resolveTrack = (track) => {
    let current = track;
    const seen = /* @__PURE__ */ new Set();
    while (!seen.has(current)) {
      const next = globalReplacedTracks.get(current);
      if (!next) break;
      seen.add(current);
      current = next;
    }
    return current;
  };
  const resolveStreamTracks = (stream) => {
    const rawTracks = tracksOf(stream);
    const prevRaw = localStreamRawTracks.get(stream);
    if (prevRaw) {
      for (const track of rawTracks) if (!prevRaw.has(track)) globalReplacedTracks.delete(track);
    }
    localStreamRawTracks.set(stream, new Set(rawTracks));
    return rawTracks.map(resolveTrack);
  };
  const isRemoteStreamActive = (stream, hadTracks) => {
    if ("active" in stream && stream.active === false) return false;
    const tracks = stream.getTracks?.();
    if (!tracks) return true;
    if (hadTracks && tracks.length === 0) return false;
    return tracks.length === 0 || !tracks.every((t) => t?.readyState === "ended");
  };
  const deactivateRemoteStream = (id, peerState, stream, entry) => {
    if (peerState.streams.get(stream) !== entry) return;
    entry.cleanup();
    peerState.streams.set(stream, {
      phase: "inactive",
      key: entry.key
    });
    updatePeerPin(id);
  };
  const deactivateAllPeerRemoteStreams = (peerState) => {
    for (const [stream, record] of Array.from(peerState.streams.entries())) switch (record.phase) {
      case "waiting":
        record.cleanup();
        peerState.streams.delete(stream);
        break;
      case "active":
        record.cleanup();
        peerState.streams.set(stream, {
          phase: "inactive",
          key: record.key
        });
        break;
      case "inactive":
        break;
      default:
        unreachable(record);
    }
  };
  const toMediaCtx = (id, hasMetadata, metadata) => {
    const userId = getPeerUserId ? getPeerUserId(id) : id;
    return hasMetadata && metadata !== void 0 ? {
      peerId: id,
      userId,
      metadata
    } : {
      peerId: id,
      userId
    };
  };
  const matchQueuedMetaForStream = (peerState, stream) => {
    if (!peerState.metaQueue.length) return null;
    const streamId = streamIdOf(stream);
    const index = streamId ? peerState.metaQueue.findIndex((meta) => !meta.streamId || meta.streamId === streamId) : 0;
    if (index < 0) return null;
    const candidate = peerState.metaQueue[index];
    if (waitingForTracks(candidate.expectedTrackCount, tracksOf(stream))) return null;
    peerState.metaQueue.splice(index, 1);
    return candidate;
  };
  const tryPromoteStreamFromQueuedMeta = (id, stream) => {
    if (!isActive(id)) return false;
    const peerState = peerRemoteMedia.get(id);
    if (!peerState) return false;
    const matched = matchQueuedMetaForStream(peerState, stream);
    if (!matched) return false;
    activateRemoteStream(id, peerState, matched.key, stream, matched.hasMetadata, matched.metadata);
    return true;
  };
  const ensureWaitingStream = (id, peerState, stream) => {
    const existing = peerState.streams.get(stream);
    if (isStreamTracked(existing)) return;
    if (countWaitingStreams(peerState) >= 64) return;
    const cleanups = [];
    bindTargetEvent(stream, "addtrack", () => {
      tryPromoteStreamFromQueuedMeta(id, stream);
    }, cleanups);
    peerState.streams.set(stream, {
      phase: "waiting",
      cleanup: () => {
        while (cleanups.length > 0) cleanups.pop()();
      }
    });
  };
  const activateRemoteStream = (id, peerState, key, stream, hasMetadata, metadata) => {
    if (!isActive(id)) return;
    peerState.identityCache.rememberRemoteStream(key, stream, streamIdOf(stream));
    const prev = peerState.streams.get(stream);
    if (isStreamTracked(prev)) prev.cleanup();
    const curTracks = tracksOf(stream);
    let hadTracks = Boolean(prev?.phase === "active" && prev.hadTracks || curTracks.length > 0);
    if (!isRemoteStreamActive(stream, hadTracks)) {
      peerState.streams.set(stream, {
        phase: "inactive",
        key
      });
      if (prev?.phase === "active") updatePeerPin(id);
      return;
    }
    const metaSig = hasMetadata && metadata !== void 0 ? `m:${toJson(metadata)}` : "";
    const prevEmittedSig = prev?.phase === "active" ? prev.emittedSig : void 0;
    const cleanups = [];
    const observedTracks = /* @__PURE__ */ new Set();
    const cleanup = () => {
      while (cleanups.length > 0) cleanups.pop()();
    };
    let currentEntry = {
      phase: "active",
      key,
      hasMetadata,
      metadata,
      emittedSig: metaSig,
      hadTracks,
      cleanup
    };
    const pruneIfInactive = () => {
      if (!isRemoteStreamActive(stream, hadTracks)) deactivateRemoteStream(id, peerState, stream, currentEntry);
    };
    const observeTrack = (track) => {
      if (!track || observedTracks.has(track)) return;
      observedTracks.add(track);
      if (!hadTracks) {
        hadTracks = true;
        if (peerState.streams.get(stream) === currentEntry) {
          currentEntry = {
            ...currentEntry,
            hadTracks: true
          };
          peerState.streams.set(stream, currentEntry);
        }
      }
      bindTargetEvent(track, "ended", pruneIfInactive, cleanups);
    };
    const onDynamicTrackAdded = () => {
      if (peerState.streams.get(stream) !== currentEntry) return;
      for (const track of tracksOf(stream)) observeTrack(track);
      if (!tryPromoteStreamFromQueuedMeta(id, stream)) pruneIfInactive();
    };
    bindTargetEvent(stream, "removetrack", pruneIfInactive, cleanups);
    bindTargetEvent(stream, "inactive", pruneIfInactive, cleanups);
    bindTargetEvent(stream, "addtrack", onDynamicTrackAdded, cleanups);
    for (const track of curTracks) observeTrack(track);
    currentEntry = {
      ...currentEntry,
      hadTracks
    };
    peerState.streams.set(stream, currentEntry);
    updatePeerPin(id);
    if (prevEmittedSig !== metaSig) emitStreamEvt(stream, toMediaCtx(id, hasMetadata, metadata));
  };
  return {
    addStream: async (stream, options, sendMeta) => {
      const key = getLocalStreamKey(stream);
      const metadata = Object.hasOwn(options, "metadata") ? (localStreamMetas.set(stream, options.metadata), options.metadata) : localStreamMetas.get(stream);
      const initialEffectiveTracks = resolveStreamTracks(stream);
      await all(iterate(options.target, async (id, directPeer) => {
        const opGen = ++nextLocalSyncGen;
        const peerLocal = ensurePeerLocalMedia(id);
        const prevEntry = peerLocal.streams.get(stream);
        peerLocal.streams.set(stream, prevEntry?.phase === "synced" ? {
          phase: "synced",
          syncGen: opGen,
          appliedTracks: prevEntry.appliedTracks
        } : {
          phase: "syncing-initial",
          syncGen: opGen
        });
        updatePeerPin(id);
        const rollbackInitialIfCurrent = () => {
          const curLocal = peerLocalMedia.get(id);
          const cur = curLocal?.streams.get(stream);
          if (cur?.syncGen === opGen && cur.phase === "syncing-initial") {
            curLocal.streams.delete(stream);
            if (!curLocal.streams.size) peerLocalMedia.delete(id);
            updatePeerPin(id);
          }
        };
        let mediaPeer;
        try {
          mediaPeer = await getMediaPeer(id, directPeer);
        } catch (err) {
          rollbackInitialIfCurrent();
          throw err;
        }
        if (peerLocalMedia.get(id)?.streams.get(stream)?.syncGen !== opGen) return;
        try {
          await sendMeta({
            k: key,
            s: stream.id,
            ...initialEffectiveTracks.length > 0 ? { t: initialEffectiveTracks.length } : {},
            ...metadata === void 0 ? {} : { m: metadata }
          }, { target: id });
        } catch (err) {
          rollbackInitialIfCurrent();
          throw err;
        }
        const current = peerLocalMedia.get(id)?.streams.get(stream);
        if (!current || current.syncGen !== opGen) return;
        const latestRawTracks = tracksOf(stream);
        const latestEffectiveTracks = latestRawTracks.map(resolveTrack);
        switch (current.phase) {
          case "syncing-initial":
            peerLocalMedia.get(id)?.streams.set(stream, {
              phase: "synced",
              syncGen: opGen,
              appliedTracks: new Set(latestEffectiveTracks)
            });
            if (latestEffectiveTracks.length !== latestRawTracks.length || latestEffectiveTracks.some((track, index) => track !== latestRawTracks[index])) latestEffectiveTracks.forEach((track) => mediaPeer.addTrack(track, stream));
            else mediaPeer.addStream(stream);
            return;
          case "synced": {
            const nextSet = new Set(latestEffectiveTracks);
            for (const prevTrack of current.appliedTracks.difference(nextSet)) {
              mediaPeer.removeTrack(prevTrack, stream);
              current.appliedTracks.delete(prevTrack);
            }
            for (const nextTrack of nextSet.difference(current.appliedTracks)) {
              mediaPeer.addTrack(nextTrack, stream);
              current.appliedTracks.add(nextTrack);
            }
            return;
          }
          default:
            unreachable(current);
        }
      }));
    },
    removeStream: (stream, target) => {
      if (!target) {
        localStreamMetas.delete(stream);
        localStreamRawTracks.delete(stream);
      }
      iterate(target, (id, directPeer) => {
        const peerLocal = peerLocalMedia.get(id);
        const prevEntry = peerLocal?.streams.get(stream);
        if (peerLocal) {
          peerLocal.streams.delete(stream);
          if (!peerLocal.streams.size) peerLocalMedia.delete(id);
        }
        updatePeerPin(id);
        if (!directPeer || prevEntry?.phase === "syncing-initial") return;
        directPeer.removeStream(stream);
        if (prevEntry?.phase === "synced") for (const track of prevEntry.appliedTracks.difference(new Set(tracksOf(stream)))) directPeer.removeTrack(track, stream);
      });
    },
    replaceTrack: async (oldTrack, newTrack, target) => {
      globalReplacedTracks.set(oldTrack, newTrack);
      globalReplacedTracks.delete(newTrack);
      await all(iterate(target, async (id, directPeer) => {
        const peerLocal = peerLocalMedia.get(id);
        let hasMatchingStream = false;
        if (peerLocal) {
          for (const [stream, streamEntry] of peerLocal.streams.entries()) if (streamEntry.phase === "synced" && streamEntry.appliedTracks.has(oldTrack)) {
            streamEntry.appliedTracks.delete(oldTrack);
            streamEntry.appliedTracks.add(newTrack);
            hasMatchingStream = true;
          } else if (streamEntry.phase === "syncing-initial" && tracksOf(stream).some((raw) => raw === oldTrack || resolveTrack(raw) === newTrack)) hasMatchingStream = true;
        }
        if (!hasMatchingStream && !directPeer) return;
        await (await getMediaPeer(id, directPeer)).replaceTrack(oldTrack, newTrack);
      }));
    },
    receiveStreamMeta: (meta, id) => {
      if (!isActive(id)) return;
      const parsed = toParsedMediaMeta(meta);
      if (!parsed) return;
      const peerState = ensurePeerRemoteMedia(id);
      const waitingStream = findWaitingStream(peerState, parsed.streamId);
      const candidateStream = waitingStream ?? peerState.identityCache.getRemoteStream(parsed.key, parsed.streamId);
      const candidateTracks = tracksOf(candidateStream);
      if (candidateStream && (waitingStream !== void 0 || candidateTracks.length > 0) && !waitingForTracks(parsed.expectedTrackCount, candidateTracks)) {
        const staleMetaIdx = peerState.metaQueue.findIndex((item) => item.key === parsed.key);
        if (staleMetaIdx >= 0) peerState.metaQueue.splice(staleMetaIdx, 1);
        activateRemoteStream(id, peerState, parsed.key, candidateStream, parsed.hasMetadata, parsed.metadata);
        return;
      }
      if (candidateStream && waitingForTracks(parsed.expectedTrackCount, candidateTracks)) ensureWaitingStream(id, peerState, candidateStream);
      const existingIdx = peerState.metaQueue.findIndex((item) => item.key === parsed.key);
      if (existingIdx >= 0) {
        peerState.metaQueue[existingIdx] = parsed;
        return;
      }
      if (peerState.metaQueue.length >= 64) {
        warn("too many pending stream metadata messages");
        onPeerError(id, mkErr("too many pending media metadata messages"));
        return;
      }
      peerState.metaQueue.push(parsed);
    },
    receiveRemoteStream: (id, stream) => {
      if (!isActive(id)) return;
      const peerState = ensurePeerRemoteMedia(id);
      const matched = matchQueuedMetaForStream(peerState, stream);
      if (matched) {
        activateRemoteStream(id, peerState, matched.key, stream, matched.hasMetadata, matched.metadata);
        return;
      }
      ensureWaitingStream(id, peerState, stream);
    },
    clearPeer: (id) => {
      const remote = peerRemoteMedia.get(id);
      if (remote) {
        deactivateAllPeerRemoteStreams(remote);
        peerRemoteMedia.delete(id);
      }
      peerLocalMedia.delete(id);
      onPeerMediaPinChange?.(id, false);
    },
    clearListeners: () => {
      clearStreamEvt();
      for (const [id, peerState] of peerRemoteMedia) {
        deactivateAllPeerRemoteStreams(peerState);
        updatePeerPin(id);
      }
    },
    onPeerStream: (handler, options) => subStream(handler, options, () => {
      const items = [];
      for (const [id, peerState] of peerRemoteMedia) {
        if (!isActive(id)) {
          deactivateAllPeerRemoteStreams(peerState);
          updatePeerPin(id);
          continue;
        }
        for (const [stream, record] of Array.from(peerState.streams.entries())) {
          if (record.phase !== "active") continue;
          if (!isRemoteStreamActive(stream, record.hadTracks)) {
            deactivateRemoteStream(id, peerState, stream, record);
            continue;
          }
          items.push([stream, toMediaCtx(id, record.hasMetadata, record.metadata)]);
        }
      }
      return items;
    })
  };
};

// node_modules/@trystero-p2p/core/dist/state.mjs
var defaultMaxStateBytes = 16384;
var maxAllowedStateBytes = 65536;
var maxUserStateBytesPerUser = 65536;
var minSlotBroadcastIntervalMs = 40;
var maxLiveRecordsPerSec = 60;
var maxLiveRecordBurst = 120;
var maxSyncRecordsPerBatch = 1024;
var maxPullPages = 16;
var maxSyncChunkBytes = 184320;
var maxHandshakeStateBytes = 61440;
var handshakeStateDeadlineMs = 400;
var offlineStagingTtlMs = 5e3;
var maxFlushRetries = 8;
var tombstoneBytes = 32;
var allowedRecordKeys = /* @__PURE__ */ new Set([
  "v",
  "k",
  "appId",
  "roomId",
  "ns",
  "hlc",
  "peerId",
  "userId",
  "pub",
  "val",
  "del",
  "cert",
  "sig"
]);
var stateRecordPayload = (record, canonVal) => canonTag("state", [
  record.v,
  record.k,
  record.appId,
  record.roomId,
  record.ns,
  record.hlc,
  record.peerId,
  record.userId,
  record.pub,
  record.del === true ? null : canonVal ?? canonicalizeJson(record.val),
  record.del === true ? 1 : 0,
  record.cert?.sig ?? ""
]);
var validateAndMeasureRecord = (raw, maxBytes = Number.POSITIVE_INFINITY) => {
  if (!isObj(raw) || keys(raw).some((k) => !allowedRecordKeys.has(k))) return null;
  if (raw["v"] !== 1 || raw["k"] !== "s" && raw["k"] !== "u" || !isStr(raw["appId"]) || !isStr(raw["roomId"]) || !isStr(raw["ns"]) || raw["ns"].length > 256 || !isValidHlc(raw["hlc"]) || !isValidSignalPeerId(raw["peerId"]) || !isValidUserId(raw["userId"]) || typeof raw["pub"] !== "string" || !compactPubToJwk(raw["pub"]) || !isValidSig(raw["sig"]) || raw["cert"] !== void 0 && !validateRoleCertificateShape(raw["cert"])) return null;
  if (raw["del"] !== void 0) return raw["del"] === true && raw["k"] === "u" && raw["val"] === void 0 ? {
    rec: raw,
    bytes: tombstoneBytes,
    canonVal: void 0
  } : null;
  if (!("val" in raw) || raw["val"] === void 0) return null;
  const measured = canonicalizeAndMeasureJson(raw["val"], maxBytes);
  return Array.isArray(measured) ? {
    rec: raw,
    bytes: measured[1],
    canonVal: measured[0]
  } : null;
};
var signStateRecord = async (signer, pubJwk, params, canonVal) => {
  const hlc = typeof params.hlc === "number" ? [params.hlc, 0] : params.hlc ?? [Date.now(), 0];
  const base = {
    v: 1,
    appId: params.appId,
    roomId: params.roomId,
    ns: params.ns,
    hlc,
    peerId: params.peerId,
    userId: params.userId,
    pub: jwkToCompactPub(pubJwk),
    ...params.cert ? { cert: params.cert } : {}
  };
  const unsigned = params.del === true ? {
    ...base,
    k: "u",
    del: true
  } : {
    ...base,
    k: params.kind ?? "s",
    val: params.val
  };
  const sig = await signWith(signer, stateRecordPayload(unsigned, canonVal));
  return {
    ...unsigned,
    sig
  };
};
var compareStateRecords = (a, b) => compareHlc(a.hlc, b.hlc) || cmpStr(a.userId, b.userId) || cmpStr(a.peerId, b.peerId) || cmpStr(a.sig, b.sig);
var maxHlc = (a, b) => compareHlc(a, b) >= 0 ? a : b;
var toWireRecord = (rec, includePub) => ({
  v: rec.v,
  k: rec.k,
  ns: rec.ns,
  hlc: rec.hlc,
  peerId: rec.peerId,
  userId: rec.userId,
  ...includePub ? { pub: rec.pub } : {},
  ...rec.del === true ? { del: true } : { val: rec.val },
  ...rec.cert !== void 0 ? { cert: rec.cert } : {},
  sig: rec.sig
});
var fromWireRecord = (raw, appId, roomId, pubMap) => {
  if (!isObj(raw) || "appId" in raw || "roomId" in raw) return null;
  const uid = raw["userId"];
  const pub = raw["pub"] === void 0 && isStr(uid) ? pubMap?.[uid] : raw["pub"];
  return {
    ...raw,
    appId,
    roomId,
    pub
  };
};
var validateSlotArgs = (ns, initialValue, maxBytes, rolesOpt, rolesLoaded, defaultClosed, fnName, roleLabel) => {
  if (!isStr(ns) || ns.length > 256) throw mkErr(`${fnName} requires a non-empty namespace string`);
  const measuredInit = canonicalizeAndMeasureJson(initialValue === void 0 ? null : initialValue);
  if (!Array.isArray(measuredInit)) throw mkErr(`state "${ns}" initialValue must be valid JSON`);
  const initVal = fromJson(measuredInit[0]);
  if (maxBytes !== void 0 && (!isPosSafeInt(maxBytes) || maxBytes > maxAllowedStateBytes)) throw mkErr(`state "${ns}" maxBytes must be a positive integer <= ${maxAllowedStateBytes}`);
  if (rolesOpt !== void 0 && !rolesLoaded) throw requiresRolesErr(roleLabel);
  let reqRoles = null;
  if (rolesLoaded) {
    if (rolesOpt === void 0) reqRoles = defaultClosed ? ["admin"] : null;
    else {
      const raw = [rolesOpt].flat();
      if (!raw.includes("*")) {
        const list = raw.filter(Boolean);
        if (!list.length) throw mkErr(`${roleLabel} roles must not be empty; use "*" for open`);
        reqRoles = list;
      }
    }
  }
  return [
    initVal,
    maxBytes ?? defaultMaxStateBytes,
    reqRoles
  ];
};
var getLiveEntry = (slot, key) => {
  const entry = slot.entries.get(key);
  return entry && !entry.rec.del ? entry : void 0;
};
var estimateWireRecordBytes = (wire) => encodeBytes(toJson(wire)).byteLength + 120;
var sig8 = (rec) => rec.sig.slice(0, 8);
var quotaErr = (ns) => mkErr(`state "${ns}" exceeds user quota`);
var createStateManager = ({ appId, getRoomId, getSelfId, getLocalUserId, ensureReady, hasRolesPlugin, getRolesProvider, getScaleProvider, isPeerActive, isPeerPendingHandshake, isDirectPeer, getDirectPeerIds, isUserOnline, getKnownPeerUserId, isPeerBanned, getPeerRoles, makeInternalAction, onInvalidRecord }) => {
  const slots = /* @__PURE__ */ new Map();
  const liveRateLimiter = createTokenBucketLimiter(maxLiveRecordsPerSec, maxLiveRecordBurst, 512);
  const [hitSyncQuota] = createWindowCounter(512, 96);
  const [hitFwdSyncQuota] = createWindowCounter(512, 96);
  const stagedHandshake = /* @__PURE__ */ new Map();
  const sentHandshakeSigs = /* @__PURE__ */ new Map();
  const pendingOfflineUserRecs = createBoundedCache(128);
  const onlineEpoch = /* @__PURE__ */ new Map();
  const activeOnlineUsers = /* @__PURE__ */ new Set();
  const pendingJoinWaiters = /* @__PURE__ */ new Map();
  const clock = createMonotonicClock();
  let destroyed = false;
  const isDestroyed = () => destroyed;
  const isPeerLiveOrPending = (peerId) => isPeerActive(peerId) || Boolean(isPeerPendingHandshake?.(peerId));
  const getOnlineEpoch = (uid) => onlineEpoch.get(uid) ?? 0;
  const bumpOnlineEpoch = (uid) => {
    if (!uid) return;
    const next = getOnlineEpoch(uid) + 1;
    if (!onlineEpoch.has(uid) && onlineEpoch.size >= 4096) {
      for (const k of onlineEpoch.keys()) if (!activeOnlineUsers.has(k) && !isUserOnline(k)) {
        onlineEpoch.delete(k);
        break;
      }
    }
    onlineEpoch.set(uid, next);
  };
  const setUserPresence = (userId, online) => {
    if (isDestroyed() || !userId) return;
    if (online) {
      if (!activeOnlineUsers.has(userId)) {
        activeOnlineUsers.add(userId);
        bumpOnlineEpoch(userId);
      }
    } else if (activeOnlineUsers.delete(userId)) bumpOnlineEpoch(userId);
  };
  const setSlotOptimistic = (slot, next) => {
    slot.optimistic = next;
    slot.snapshot = null;
  };
  const clearSlotOptimistic = (slot) => {
    if (slot.optimistic !== null) {
      slot.optimistic = null;
      slot.snapshot = null;
    }
  };
  const enqueuePendingOp = (slot, fields) => {
    const { promise, resolve, reject } = Promise.withResolvers();
    slot.ops.push({
      ...fields,
      promise,
      resolve,
      reject
    });
    flushSlot(slot);
    return promise;
  };
  const isScaleActive = () => Boolean(getScaleProvider?.());
  const resolvePendingJoin = (peerId, ok) => {
    const waiter = pendingJoinWaiters.get(peerId);
    if (waiter) {
      pendingJoinWaiters.delete(peerId);
      waiter.resolve(ok);
    }
  };
  const waitPeerReady = (peerId) => {
    if (!isPeerPendingHandshake?.(peerId)) return isPeerActive(peerId) ? null : false;
    let waiter = pendingJoinWaiters.get(peerId);
    if (!waiter) {
      const { promise, resolve } = Promise.withResolvers();
      waiter = {
        promise,
        resolve,
        count: 0
      };
      pendingJoinWaiters.set(peerId, waiter);
    }
    if (waiter.count >= 8) return false;
    waiter.count++;
    return waiter.promise;
  };
  const readyRoomForPeer = async (peerId, waitP) => {
    if (waitP && !await waitP) return null;
    let roomId;
    try {
      ({ roomId } = await ensureReady());
    } catch {
      return null;
    }
    return isDestroyed() || !isPeerActive(peerId) || isPeerBanned(peerId) ? null : roomId;
  };
  const withinUserQuota = (uid, target, nextBytes) => {
    let count = 0;
    let bytes = nextBytes;
    for (const slot of slots.values()) {
      if (slot.kind !== "u" || slot === target) continue;
      if (slot.optimistic && uid === getLocalUserId()) {
        count++;
        bytes += slot.optimistic.bytes;
        continue;
      }
      const entry = uid ? slot.entries.get(uid) : void 0;
      if (entry) {
        count++;
        bytes += entry.bytes;
      }
    }
    return count < 32 && bytes <= maxUserStateBytesPerUser;
  };
  const mkCtxBase = (prev, peerId, userId, roles2, timestamp) => ({
    prev,
    peerId,
    userId,
    roles: [...roles2],
    timestamp
  });
  const toSharedCtx = (rec, prev, roles2) => mkCtxBase(prev, rec.peerId, rec.userId, roles2, rec.hlc[0]);
  const toUserCtx = (rec, prev, roles2, removed, ts = rec.hlc[0], online = isUserOnline(rec.userId)) => {
    const localUid = getLocalUserId();
    return {
      ...mkCtxBase(prev, rec.peerId, rec.userId, roles2, ts),
      self: Boolean(localUid && rec.userId === localUid),
      online,
      removed
    };
  };
  const isRecordAuthorizedNow = (rec, reqRoles) => {
    if (isPeerBanned(rec.userId)) return false;
    if (!reqRoles) return true;
    const rp = getRolesProvider();
    if (!rp) return false;
    const active = rp.getPeerRoles(rec.userId);
    if (rec.cert) return reqRoles.some((r) => rec.cert.roles.includes(r) && active.includes(r));
    return reqRoles.some((r) => active.includes(r));
  };
  const evictEntry = (slot, key, entry, now2, roles2) => {
    slot.entries.delete(key);
    slot.snapshot = null;
    if (slot.kind === "s") slot.emit(slot.initialValue, mkCtxBase(entry.value, getSelfId(), entry.rec.userId, roles2, now2));
    else if (!entry.rec.del) slot.emit(void 0, toUserCtx(entry.rec, entry.value, roles2, true, now2, false));
  };
  const stateAction = makeInternalAction ? makeInternalAction("state", {
    receiveWhilePending: true,
    maxPayloadBytes: 262144
  }) : null;
  const sendState = (msg, targets) => {
    if (stateAction) stateAction.send(msg, targets === void 0 ? void 0 : { target: targets }).catch(noOp2);
  };
  const broadcastLiveRecord = (rec) => {
    sendState({
      t: "rec",
      r: toWireRecord(rec, true)
    });
  };
  const verifyParsedRecord = async ({ rec, bytes, canonVal }, reqRoles, fromPeerId) => {
    const roomId = getRoomId();
    if (rec.appId !== appId || rec.roomId !== roomId || rec.cert && rec.cert.subUserId !== rec.userId) return "invalid";
    const signer = await getVerifiedPubKeyRecord(rec.pub);
    if (!signer || signer.userId !== rec.userId) return "invalid";
    if (!await verifySig(rec.pub, stateRecordPayload(rec, canonVal), rec.sig)) return "invalid";
    const now2 = Date.now();
    const existingWall = slots.get(`${rec.k}:${rec.ns}`)?.entries.get(rec.k === "s" ? "" : rec.userId)?.rec.hlc[0] ?? 0;
    const maxFutureWall = Math.min(now2 + defaultMaxClockSkewMs, Math.max(now2 + stateMaxFutureSkewMs, rec.cert ? rec.cert.iat + stateMaxFutureSkewMs : 0, existingWall));
    if (rec.hlc[0] > maxFutureWall || rec.cert && rec.hlc[0] < rec.cert.iat) return "drop";
    if (isPeerBanned(rec.userId)) return "drop";
    const rp = getRolesProvider();
    if (rp) {
      const roleRes = await rp.verifyStateRecordRoles(rec, reqRoles, fromPeerId);
      if (!roleRes.valid) return "drop";
      clock.observe(rec.hlc[0]);
      return {
        rec,
        roles: roleRes.roles,
        bytes
      };
    }
    if (reqRoles && reqRoles.length > 0) return "drop";
    clock.observe(rec.hlc[0]);
    return {
      rec,
      roles: [],
      bytes
    };
  };
  const stageOfflineUserRecord = (slot, rec, roles2, bytes) => {
    if (bytes > slot.maxBytes) return;
    const now2 = Date.now();
    let byNs = pendingOfflineUserRecs.get(rec.userId);
    if (!byNs) {
      byNs = /* @__PURE__ */ new Map();
      pendingOfflineUserRecs.set(rec.userId, byNs);
    } else if (!byNs.has(slot.namespace) && byNs.size >= 32) return;
    const prev = byNs.get(slot.namespace);
    if (prev && now2 - prev.seenAt < offlineStagingTtlMs && compareStateRecords(rec, prev.rec) <= 0) return;
    let totalBytes = bytes;
    for (const [ns, entry] of byNs) if (ns !== slot.namespace) totalBytes += entry.bytes;
    if (totalBytes > maxUserStateBytesPerUser) return;
    byNs.set(slot.namespace, {
      slot,
      rec,
      roles: [...roles2],
      bytes,
      seenAt: now2
    });
  };
  const commitEntry = (slot, rec, roles2, bytes, skipValidate = false, allowStageOffline = false, silentCommit = false) => {
    if (isDestroyed()) return null;
    const key = slot.kind === "s" ? "" : rec.userId;
    if (slot.kind === "u" && !isUserOnline(key)) {
      if (allowStageOffline) stageOfflineUserRecord(slot, rec, roles2, bytes);
      return null;
    }
    const curRaw = slot.entries.get(key);
    if (curRaw && compareStateRecords(rec, curRaw.rec) <= 0) return null;
    const curLive = curRaw && !curRaw.rec.del ? curRaw : void 0;
    const prevVal = curLive ? curLive.value : slot.initialValue;
    const isLocalTarget = slot.kind === "s" || getLocalUserId() !== "" && rec.userId === getLocalUserId();
    const suppressForPendingOptimistic = !skipValidate && isLocalTarget && slot.optimistic !== null && (slot.ops.length > 0 || slot.flushState.phase === "stepping" && compareHlc(rec.hlc, slot.flushState.signingHlc ?? [slot.optimistic.timestamp, 0]) <= 0) && rec.hlc[0] <= Date.now() + 1e4;
    if (rec.del) {
      if (slot.kind !== "u" || !withinUserQuota(key, slot, bytes)) return null;
      const next2 = {
        rec,
        value: slot.initialValue,
        prev: prevVal,
        roles: [...roles2],
        bytes
      };
      slot.entries.set(key, next2);
      if (suppressForPendingOptimistic) {
        slot.optimistic.prev = slot.initialValue;
        return next2;
      }
      if (!skipValidate && isLocalTarget) clearSlotOptimistic(slot);
      slot.snapshot = null;
      if (!silentCommit && curLive) slot.emit(void 0, toUserCtx(rec, prevVal, roles2, true));
      return next2;
    }
    if (bytes > slot.maxBytes || slot.kind === "u" && !withinUserQuota(key, slot, bytes)) return null;
    const nextVal = rec.val;
    const next = {
      rec,
      value: nextVal,
      prev: prevVal,
      roles: [...roles2],
      bytes
    };
    if (slot.kind === "s") {
      const emitPrev2 = !skipValidate && slot.optimistic !== null && !suppressForPendingOptimistic ? slot.optimistic.value : prevVal;
      const ctx2 = toSharedCtx(rec, prevVal, roles2);
      if (!skipValidate && slot.validate) {
        let valid = false;
        try {
          valid = slot.validate(nextVal, ctx2);
        } catch {
          valid = false;
        }
        if (!valid) return null;
      }
      slot.entries.set(key, next);
      if (suppressForPendingOptimistic) {
        slot.optimistic.prev = nextVal;
        return next;
      }
      if (!skipValidate) clearSlotOptimistic(slot);
      slot.snapshot = null;
      if (!silentCommit) slot.emit(nextVal, emitPrev2 === prevVal ? ctx2 : toSharedCtx(rec, emitPrev2, roles2));
      return next;
    }
    const emitPrev = !skipValidate && isLocalTarget && slot.optimistic !== null && !suppressForPendingOptimistic ? slot.optimistic.value : prevVal;
    const ctx = toUserCtx(rec, prevVal, roles2, false);
    if (!skipValidate && slot.validate) {
      let valid = false;
      try {
        valid = slot.validate(nextVal, ctx);
      } catch {
        valid = false;
      }
      if (!valid) return null;
    }
    slot.entries.set(key, next);
    if (suppressForPendingOptimistic) {
      slot.optimistic.prev = nextVal;
      return next;
    }
    if (!skipValidate && isLocalTarget) clearSlotOptimistic(slot);
    slot.snapshot = null;
    if (!silentCommit) slot.emit(nextVal, emitPrev === prevVal ? ctx : toUserCtx(rec, emitPrev, roles2, false));
    return next;
  };
  const captureUserIngress = (uid) => ({
    startedOnline: isUserOnline(uid),
    startEpoch: getOnlineEpoch(uid)
  });
  const applyIncoming = async (rawRec, fromPeerId, allowStageOffline = false, ingressSnapshot) => {
    if (isDestroyed()) return null;
    const parsed = validateAndMeasureRecord(rawRec, maxAllowedStateBytes);
    if (!parsed) {
      onInvalidRecord?.(fromPeerId);
      return null;
    }
    if (isPeerBanned(parsed.rec.userId)) return null;
    const slot = slots.get(`${parsed.rec.k}:${parsed.rec.ns}`);
    if (!slot) return null;
    if (!parsed.rec.del && parsed.bytes > slot.maxBytes) return null;
    const entryKey = slot.kind === "s" ? "" : parsed.rec.userId;
    const { startedOnline, startEpoch } = slot.kind === "u" ? ingressSnapshot ?? captureUserIngress(entryKey) : {
      startedOnline: true,
      startEpoch: 0
    };
    if (slot.kind === "s" || startedOnline) {
      const curRaw = slot.entries.get(entryKey);
      if (curRaw && compareStateRecords(parsed.rec, curRaw.rec) <= 0) return null;
      if (!withinUserQuota(entryKey, slot, parsed.bytes) && slot.kind === "u") return null;
    }
    const verified = await verifyParsedRecord(parsed, slot.requiredRoles, fromPeerId);
    if (isDestroyed()) return null;
    if (verified === "invalid") {
      onInvalidRecord?.(fromPeerId);
      return null;
    }
    if (verified === "drop" || isPeerBanned(verified.rec.userId)) return null;
    if (slot.kind === "u") {
      const curEpoch = getOnlineEpoch(entryKey);
      if (startedOnline) {
        if (curEpoch !== startEpoch) return null;
      } else {
        const joinedOnceWithoutLeaving = isUserOnline(entryKey) && curEpoch === startEpoch + 1;
        if (curEpoch !== startEpoch && !joinedOnceWithoutLeaving) return null;
      }
    }
    return commitEntry(slot, verified.rec, verified.roles, verified.bytes, false, allowStageOffline && !startedOnline && getOnlineEpoch(entryKey) === startEpoch);
  };
  const getAuthorizedEntriesSorted = () => {
    const list = [];
    for (const slot of slots.values()) for (const [entryKey, entry] of slot.entries) {
      if (slot.kind === "u" && !isUserOnline(entryKey)) continue;
      if (isRecordAuthorizedNow(entry.rec, slot.requiredRoles)) list.push([slot.kind === "s" ? `s:${slot.namespace}` : `u:${slot.namespace}\0${entryKey}`, entry]);
    }
    list.sort((a, b) => cmpStr(a[0], b[0]));
    return list;
  };
  const buildDigestMap = (cursor) => {
    const digest = {};
    let count = 0;
    for (const [dKey, entry] of getAuthorizedEntriesSorted()) {
      if (cursor !== void 0 && cmpStr(dKey, cursor) <= 0) continue;
      if (count >= maxSyncRecordsPerBatch) break;
      digest[dKey] = [entry.rec.hlc, sig8(entry.rec)];
      count++;
    }
    return digest;
  };
  const sendSyncBatches = (peerId, records, nextCursor, forwarded = false) => {
    if (!stateAction || isDestroyed() || !isPeerActive(peerId)) return;
    const sendSyncMsg = (p, r, includeCursor) => sendState({
      t: "sync",
      p,
      r,
      ...includeCursor && nextCursor ? { n: nextCursor } : {},
      ...forwarded ? { f: 1 } : {}
    }, peerId);
    if (!records.length) {
      if (!forwarded) sendSyncMsg({}, [], true);
      return;
    }
    const chunks = [];
    let curP = {};
    let curR = [];
    let curBytes = 0;
    for (const rec of records) {
      const wire = toWireRecord(rec, false);
      const est = estimateWireRecordBytes(wire);
      if (curR.length > 0 && curBytes + est > maxSyncChunkBytes) {
        chunks.push([curP, curR]);
        curP = {};
        curR = [];
        curBytes = 0;
      }
      curP[rec.userId] = rec.pub;
      curR.push(wire);
      curBytes += est;
    }
    if (curR.length > 0) chunks.push([curP, curR]);
    chunks.forEach(([p, r], i) => {
      sendSyncMsg(p, r, i === chunks.length - 1);
    });
  };
  const forwardAppliedToDirectOthers = (records, excludePeerId) => {
    if (!stateAction || !records.length || !isScaleActive()) return;
    for (const pid of getDirectPeerIds()) if (pid !== excludePeerId && !isPeerBanned(pid)) sendSyncBatches(pid, records, void 0, true);
  };
  const isDirectSendable = (peerId) => isDirectPeer(peerId) && !isPeerBanned(peerId);
  const antiEntropy = createAntiEntropySync({
    maxPages: maxPullPages,
    canSync: () => Boolean(stateAction) && slots.size > 0,
    getDirectPeers: getDirectPeerIds,
    isPeerSendable: isDirectSendable,
    sendPull: async (peerId, cursor) => {
      if (!stateAction || isDestroyed() || !isDirectSendable(peerId)) return;
      const msg = {
        t: "pull",
        d: buildDigestMap(cursor),
        ...cursor !== void 0 ? { c: cursor } : {}
      };
      await stateAction.send(msg, { target: peerId });
    }
  });
  if (stateAction) {
    const runWhenReady = (peerId, fn) => {
      const waitP = waitPeerReady(peerId);
      if (waitP === false) return;
      readyRoomForPeer(peerId, waitP).then((rid) => rid !== null ? fn(rid) : void 0).catch(noOp2);
    };
    stateAction.onMessage((raw, { peerId: fromPeerId }) => {
      if (isDestroyed() || isPeerBanned(fromPeerId) || !isObj(raw)) return;
      const msg = raw;
      if (msg.t === "rec") {
        if (!liveRateLimiter.consume(fromPeerId)) return;
        const rawUid = isObj(msg.r) && isStr(msg.r["userId"]) ? msg.r["userId"] : void 0;
        const ingress = rawUid ? captureUserIngress(rawUid) : void 0;
        runWhenReady(fromPeerId, async (roomId) => {
          const rec = fromWireRecord(msg.r, appId, roomId);
          if (!rec) {
            onInvalidRecord?.(fromPeerId);
            return;
          }
          if (isDirectPeer(fromPeerId) && rec.peerId === fromPeerId) {
            const knownUid = getKnownPeerUserId(fromPeerId);
            if (knownUid && knownUid !== rec.userId) {
              onInvalidRecord?.(fromPeerId);
              return;
            }
          }
          await applyIncoming(rec, fromPeerId, true, ingress);
        });
        return;
      }
      if (msg.t === "pull") {
        if (hitSyncQuota(fromPeerId) || !isObj(msg.d)) return;
        if (!isValidSyncCursor(msg.c)) {
          onInvalidRecord?.(fromPeerId);
          return;
        }
        const dEntries = entries(msg.d);
        if (dEntries.length > maxSyncRecordsPerBatch) {
          onInvalidRecord?.(fromPeerId);
          return;
        }
        const remoteDigest = /* @__PURE__ */ new Map();
        for (const [k, v] of dEntries) {
          if (!Array.isArray(v) || v.length !== 2 || !isValidHlc(v[0]) || typeof v[1] !== "string" || v[1].length > 16) {
            onInvalidRecord?.(fromPeerId);
            return;
          }
          remoteDigest.set(k, [v[0], v[1]]);
        }
        const cursor = msg.c;
        runWhenReady(fromPeerId, () => {
          const afterCursor = getAuthorizedEntriesSorted().filter(([k]) => cursor === void 0 || cmpStr(k, cursor) > 0);
          const page = afterCursor.slice(0, maxSyncRecordsPerBatch);
          const nextCursor = afterCursor.length > maxSyncRecordsPerBatch ? page[page.length - 1][0] : void 0;
          const isNewerDigest = (hA, sA, hB, sB) => {
            const cmp = compareHlc(hA, hB);
            return cmp > 0 || cmp === 0 && sA !== sB;
          };
          const toSend = [];
          for (const [k, entry] of page) {
            const localRec = entry.rec;
            const rem = remoteDigest.get(k);
            if (!rem || isNewerDigest(localRec.hlc, sig8(localRec), rem[0], rem[1])) toSend.push(localRec);
          }
          sendSyncBatches(fromPeerId, toSend, nextCursor);
          if (cursor === void 0 && !antiEntropy.isPullInFlight(fromPeerId)) for (const [k, rem] of remoteDigest) {
            let slot;
            let entryKey = "";
            if (k.startsWith("s:")) {
              const candidate = slots.get(k);
              if (candidate?.kind === "s") slot = candidate;
            } else if (k.startsWith("u:")) {
              const sep = k.indexOf("\0");
              if (sep > 2) {
                const uid = k.slice(sep + 1);
                const candidate = slots.get(k.slice(0, sep));
                if (candidate?.kind === "u" && isUserOnline(uid)) {
                  slot = candidate;
                  entryKey = uid;
                }
              }
            }
            if (!slot) continue;
            const localEntry = slot.entries.get(entryKey);
            const validLocal = localEntry && isRecordAuthorizedNow(localEntry.rec, slot.requiredRoles) ? localEntry.rec : void 0;
            if (!validLocal || isNewerDigest(rem[0], rem[1], validLocal.hlc, sig8(validLocal))) {
              antiEntropy.pullPeer(fromPeerId, true);
              break;
            }
          }
        });
        return;
      }
      if (msg.t === "sync") {
        if (msg.f && !isScaleActive() || (msg.f ? hitFwdSyncQuota : hitSyncQuota)(fromPeerId) || !isObj(msg.p) || !Array.isArray(msg.r)) return;
        if (msg.r.length > maxSyncRecordsPerBatch || !isValidSyncCursor(msg.n)) {
          onInvalidRecord?.(fromPeerId);
          return;
        }
        if (!msg.f) antiEntropy.onSyncPage(fromPeerId, msg.n);
        const pubMap = msg.p;
        const ingressByUid = /* @__PURE__ */ new Map();
        for (const wireRec of msg.r) if (isObj(wireRec) && wireRec["k"] === "u" && isStr(wireRec["userId"])) {
          const uid = wireRec["userId"];
          if (!ingressByUid.has(uid)) ingressByUid.set(uid, captureUserIngress(uid));
        }
        runWhenReady(fromPeerId, async (roomId) => {
          const newlyApplied = [];
          for (const wireRec of msg.r) {
            if (isDestroyed() || isPeerBanned(fromPeerId)) return;
            const fullRec = fromWireRecord(wireRec, appId, roomId, pubMap);
            if (!fullRec) {
              onInvalidRecord?.(fromPeerId);
              return;
            }
            const applied = await applyIncoming(fullRec, fromPeerId, true, fullRec.k === "u" ? ingressByUid.get(fullRec.userId) : void 0);
            if (applied) newlyApplied.push(applied.rec);
          }
          forwardAppliedToDirectOthers(newlyApplied, fromPeerId);
        });
      }
    });
  }
  const obtainWriteAuth = async (reqRoles, ns, uid) => {
    const rp = getRolesProvider();
    if (rp) {
      const res = await rp.getStateWriteCert(reqRoles, ns);
      return [res.cert, res.roles];
    }
    if (reqRoles && reqRoles.length > 0) throw mkErr(`${insufficientAuthPrefix} to update state "${ns}": requires [${reqRoles.join(", ")}]`);
    return [null, [...getPeerRoles(uid)]];
  };
  const resolveOps = (ops) => {
    for (const op of ops) op.resolve();
  };
  const rejectOps = (ops, err) => {
    for (const op of ops) op.reject(err);
  };
  const rollbackOptimisticIfIdle = (slot, uid) => {
    if (!slot.optimistic || slot.ops.length > 0) return;
    const prevOpt = slot.optimistic;
    clearSlotOptimistic(slot);
    const now2 = Date.now();
    const selfId = getSelfId();
    const roles2 = uid ? [...getPeerRoles(uid)] : [];
    if (slot.kind === "s") {
      const curVal = slot.entries.get("")?.value ?? slot.initialValue;
      if (curVal !== prevOpt.value) slot.emit(curVal, mkCtxBase(prevOpt.value, selfId, uid, roles2, now2));
    } else {
      const curLive = uid ? getLiveEntry(slot, uid) : void 0;
      if (curLive) {
        if (prevOpt.del || curLive.value !== prevOpt.value) slot.emit(curLive.value, {
          ...mkCtxBase(prevOpt.del ? slot.initialValue : prevOpt.value, selfId, uid, roles2, now2),
          self: true,
          online: true,
          removed: false
        });
      } else if (!prevOpt.del) slot.emit(void 0, {
        ...mkCtxBase(prevOpt.value, selfId, uid, roles2, now2),
        self: true,
        online: true,
        removed: true
      });
    }
  };
  const settleAbortedOrFailedBatch = (slot, ops, err, uid) => {
    if (isDestroyed()) {
      resolveOps(ops);
      return;
    }
    rollbackOptimisticIfIdle(slot, uid);
    rejectOps(ops, err);
  };
  const measureErr = (slot, cand, code) => code === 1 && Array.isArray(canonicalizeAndMeasureJson(cand)) ? mkErr(`state "${slot.namespace}" exceeds maxBytes (${slot.maxBytes})`) : mkErr(`state "${slot.namespace}" value must contain only finite JSON numbers`);
  const flushSlot = (slot) => {
    switch (slot.flushState.phase) {
      case "pacing":
      case "stepping":
        return slot.flushState.flushPromise;
      case "idle":
        break;
      default:
        return unreachable(slot.flushState);
    }
    const { promise: flushPromise, resolve: doneFlush } = Promise.withResolvers();
    (async () => {
      try {
        while (!isDestroyed() && slot.ops.length > 0) {
          if (!(slot.ops.some((op) => Boolean(op.urgent)) || !Number.isFinite(slot.lastBroadcastAt) || isDestroyed())) {
            const waitMs = Math.min(minSlotBroadcastIntervalMs, minSlotBroadcastIntervalMs - (performance.now() - slot.lastBroadcastAt));
            if (waitMs > 0) await new Promise((resolve) => {
              let finished = false;
              const finish = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolve();
              };
              const timer = setTimeout(finish, waitMs);
              unrefTimer(timer);
              slot.flushState = {
                phase: "pacing",
                flushPromise,
                wake: finish
              };
            });
          }
          if (isDestroyed() || slot.ops.length === 0) break;
          const { promise: stepPromise, resolve: doneStep } = Promise.withResolvers();
          const stepState = {
            phase: "stepping",
            flushPromise,
            stepPromise,
            signingHlc: null,
            activeOps: []
          };
          slot.flushState = stepState;
          try {
            let readySelfId;
            let readyUser;
            let readyRoomId;
            let authCert;
            let authRoles;
            try {
              ({ selfId: readySelfId, user: readyUser, roomId: readyRoomId } = await ensureReady());
              if (isDestroyed()) {
                resolveOps(slot.ops.splice(0));
                break;
              }
              [authCert, authRoles] = await obtainWriteAuth(slot.requiredRoles, slot.namespace, readyUser.userId);
            } catch (err) {
              settleAbortedOrFailedBatch(slot, slot.ops.splice(0), err, getLocalUserId());
              continue;
            }
            if (isDestroyed()) {
              resolveOps(slot.ops.splice(0));
              break;
            }
            if (authCert) clock.observe(authCert.iat);
            let remainingOps = slot.ops.splice(0);
            if (!remainingOps.length) continue;
            stepState.activeOps.push(...remainingOps);
            const uid = readyUser.userId;
            const entryKey = slot.kind === "s" ? "" : uid;
            for (let attempt = 0; attempt < maxFlushRetries && remainingOps.length > 0; attempt++) {
              if (isDestroyed()) {
                resolveOps(remainingOps);
                remainingOps = [];
                break;
              }
              const curRaw = slot.entries.get(entryKey);
              const curLive = curRaw && !curRaw.rec.del ? curRaw : void 0;
              let simVal = curLive ? curLive.value : slot.initialValue;
              let finalMode = null;
              let finalBytes = 0;
              let finalCanonJson;
              const accepted = [];
              const minHlcVal = maxHlc(curRaw?.rec.hlc ?? zeroHlc, [authCert?.iat ?? 0, 0]);
              const tentativeTs = Math.max(Date.now(), clock.peek(), minHlcVal[0]);
              for (const op of remainingOps) {
                const baseUnchanged = curRaw?.rec.sig === op.baseSig;
                if (op.optimisticGen !== void 0 && (baseUnchanged || !op.updater)) {
                  if (op.del) {
                    simVal = slot.initialValue;
                    finalMode = "del";
                    finalBytes = op.prevalidatedBytes ?? tombstoneBytes;
                    finalCanonJson = void 0;
                  } else {
                    simVal = op.next;
                    finalMode = "set";
                    finalBytes = op.prevalidatedBytes ?? 0;
                    finalCanonJson = op.prevalidatedJson;
                  }
                  accepted.push(op);
                  continue;
                }
                if (op.del) {
                  if (!withinUserQuota(uid, slot, tombstoneBytes)) {
                    op.reject(quotaErr(slot.namespace));
                    continue;
                  }
                  simVal = slot.initialValue;
                  finalMode = "del";
                  finalBytes = tombstoneBytes;
                  finalCanonJson = void 0;
                  accepted.push(op);
                  continue;
                }
                const fnOrVal = op.updater ?? op.next;
                let cand;
                try {
                  cand = typeof fnOrVal === "function" ? fnOrVal(simVal) : fnOrVal;
                } catch (err) {
                  op.reject(err);
                  continue;
                }
                const measured = canonicalizeAndMeasureJson(cand, slot.maxBytes);
                if (typeof measured === "number") {
                  op.reject(measureErr(slot, cand, measured));
                  continue;
                }
                const [json, bytes] = measured;
                cand = fromJson(json);
                if (slot.kind === "u" && !withinUserQuota(uid, slot, bytes)) {
                  op.reject(quotaErr(slot.namespace));
                  continue;
                }
                if (slot.validate) {
                  const baseCtx = mkCtxBase(simVal, readySelfId, uid, authRoles, tentativeTs);
                  let isValid = false;
                  try {
                    isValid = slot.kind === "s" ? slot.validate(cand, baseCtx) : slot.validate(cand, {
                      ...baseCtx,
                      self: true,
                      online: true,
                      removed: false
                    });
                  } catch (err) {
                    op.reject(err);
                    continue;
                  }
                  if (!isValid) {
                    op.reject(mkErr(`state validation failed for "${slot.namespace}"`));
                    continue;
                  }
                }
                simVal = cand;
                finalMode = "set";
                finalBytes = bytes;
                finalCanonJson = json;
                accepted.push(op);
              }
              if (!accepted.length || !finalMode) {
                remainingOps = [];
                break;
              }
              const allowedSkewMs = Math.min(defaultMaxClockSkewMs, Math.max(stateMaxFutureSkewMs, authCert ? authCert.iat - Date.now() + 1e3 : 0, curRaw ? curRaw.rec.hlc[0] - Date.now() + 1e3 : 0));
              let rec;
              try {
                const nextHlcVal = clock.nextHlc(slot.namespace, minHlcVal, allowedSkewMs);
                stepState.signingHlc = nextHlcVal;
                rec = await signStateRecord(readyUser.sign, readyUser.signPubJwk, {
                  kind: slot.kind,
                  appId,
                  roomId: readyRoomId,
                  ns: slot.namespace,
                  hlc: nextHlcVal,
                  peerId: readySelfId,
                  userId: uid,
                  ...finalMode === "del" ? { del: true } : { val: simVal },
                  cert: authCert
                }, finalCanonJson);
              } catch (err) {
                settleAbortedOrFailedBatch(slot, accepted, err, uid);
                remainingOps = [];
                break;
              } finally {
                stepState.signingHlc = null;
              }
              if (isDestroyed()) {
                clearSlotOptimistic(slot);
                resolveOps(accepted);
                remainingOps = [];
                break;
              }
              if (!isRecordAuthorizedNow(rec, slot.requiredRoles)) {
                rollbackOptimisticIfIdle(slot, uid);
                rejectOps(accepted, mkErr(`${insufficientAuthPrefix} to update state "${slot.namespace}"`));
                remainingOps = [];
                break;
              }
              const latestRaw = slot.entries.get(entryKey);
              if (latestRaw && compareStateRecords(rec, latestRaw.rec) <= 0) {
                clock.observe(latestRaw.rec.hlc[0]);
                if (accepted.some((op) => Boolean(op.updater))) {
                  remainingOps = accepted;
                  continue;
                }
                rollbackOptimisticIfIdle(slot, uid);
                resolveOps(accepted);
                remainingOps = [];
                break;
              }
              const lastGen = accepted[accepted.length - 1]?.optimisticGen;
              const wasCurrentOptimistic = lastGen !== void 0 && slot.optimistic?.gen === lastGen;
              const wasStaleOptimistic = lastGen !== void 0 && slot.optimistic !== null && slot.optimistic.gen > lastGen;
              if (wasCurrentOptimistic) clearSlotOptimistic(slot);
              if (commitEntry(slot, rec, authRoles, finalBytes, true, false, wasCurrentOptimistic || wasStaleOptimistic)) {
                slot.lastBroadcastAt = performance.now();
                broadcastLiveRecord(rec);
              }
              resolveOps(accepted);
              remainingOps = [];
              break;
            }
            if (remainingOps.length > 0) settleAbortedOrFailedBatch(slot, remainingOps, mkErr(`concurrent state contention exceeded for "${slot.namespace}"`), uid);
          } finally {
            stepState.activeOps.length = 0;
            doneStep();
          }
        }
      } finally {
        slot.flushState = { phase: "idle" };
        doneFlush();
      }
    })();
    return flushPromise;
  };
  const getEffectiveLocalValue = (slot) => {
    if (slot.optimistic) return slot.optimistic.del ? slot.initialValue : slot.optimistic.value;
    if (slot.kind === "s") return slot.entries.get("")?.value ?? slot.initialValue;
    const uid = getLocalUserId();
    return uid ? getLiveEntry(slot, uid)?.value ?? slot.initialValue : slot.initialValue;
  };
  const resolveOptimisticMode = (slot) => {
    if (isDestroyed()) return "noop";
    const localUid = getLocalUserId();
    if (!localUid) return "defer";
    if (isPeerBanned(localUid)) return mkErr(`${insufficientAuthPrefix} to update state "${slot.namespace}"`);
    if (slot.requiredRoles === null || slot.requiredRoles.length === 0) return "sync";
    const rp = getRolesProvider();
    if (!rp) return hasRolesPlugin() ? "defer" : mkErr(`${insufficientAuthPrefix} to update state "${slot.namespace}": requires [${slot.requiredRoles.join(", ")}]`);
    if (!rp.isAuthorityResolved()) return "defer";
    const held = rp.getPeerRoles(localUid);
    if (!slot.requiredRoles.some((r) => held.includes(r))) return mkErr(`${insufficientAuthPrefix} to update state "${slot.namespace}": requires [${slot.requiredRoles.join(", ")}]`);
    return "sync";
  };
  const enqueueSlotOp = (slot, del, next) => {
    const mode = resolveOptimisticMode(slot);
    if (mode === "noop") return Promise.resolve();
    if (mode instanceof Error) return Promise.reject(mode);
    if (mode === "defer") return enqueuePendingOp(slot, {
      del,
      next
    });
    const localUid = getLocalUserId();
    const selfId = getSelfId();
    const roles2 = localUid ? [...getPeerRoles(localUid)] : [];
    const prevVal = getEffectiveLocalValue(slot);
    const now2 = Math.max(Date.now(), clock.peek());
    if (del) {
      if (!withinUserQuota(localUid, slot, tombstoneBytes)) return Promise.reject(quotaErr(slot.namespace));
      const wasLive = slot.optimistic ? !slot.optimistic.del : Boolean(localUid && getLiveEntry(slot, localUid));
      const gen2 = ++slot.optGen;
      setSlotOptimistic(slot, {
        gen: gen2,
        del: true,
        value: slot.initialValue,
        prev: prevVal,
        bytes: tombstoneBytes,
        timestamp: now2
      });
      if (wasLive && slot.kind === "u") slot.emit(void 0, {
        ...mkCtxBase(prevVal, selfId, localUid, roles2, now2),
        self: true,
        online: true,
        removed: true
      });
      return enqueuePendingOp(slot, {
        del: true,
        next: void 0,
        optimisticGen: gen2,
        prevalidatedBytes: tombstoneBytes
      });
    }
    let cand;
    try {
      cand = typeof next === "function" ? next(prevVal) : next;
    } catch (err) {
      return Promise.reject(err);
    }
    const measured = canonicalizeAndMeasureJson(cand, slot.maxBytes);
    if (typeof measured === "number") return Promise.reject(measureErr(slot, cand, measured));
    const [json, bytes] = measured;
    cand = fromJson(json);
    if (slot.kind === "u" && !withinUserQuota(localUid, slot, bytes)) return Promise.reject(quotaErr(slot.namespace));
    const baseCtx = mkCtxBase(prevVal, selfId, localUid, roles2, now2);
    if (slot.validate) {
      let isValid = false;
      try {
        isValid = slot.kind === "s" ? slot.validate(cand, baseCtx) : slot.validate(cand, {
          ...baseCtx,
          self: true,
          online: true,
          removed: false
        });
      } catch (err) {
        return Promise.reject(err);
      }
      if (!isValid) return Promise.reject(mkErr(`state validation failed for "${slot.namespace}"`));
    }
    const gen = ++slot.optGen;
    setSlotOptimistic(slot, {
      gen,
      del: false,
      value: cand,
      prev: prevVal,
      bytes,
      timestamp: now2
    });
    if (slot.kind === "s") slot.emit(cand, baseCtx);
    else slot.emit(cand, {
      ...baseCtx,
      self: true,
      online: true,
      removed: false
    });
    const curEntryKey = slot.kind === "s" ? "" : localUid;
    const baseSig = slot.entries.get(curEntryKey)?.rec.sig;
    return enqueuePendingOp(slot, {
      del: false,
      next: cand,
      ...typeof next === "function" ? { updater: next } : {},
      ...baseSig !== void 0 ? { baseSig } : {},
      optimisticGen: gen,
      prevalidatedJson: json,
      prevalidatedBytes: bytes
    });
  };
  const createSlotBase = (namespace, initialValue, requiredRoles, maxBytes, clearListeners) => ({
    namespace,
    initialValue,
    requiredRoles,
    maxBytes,
    entries: /* @__PURE__ */ new Map(),
    optimistic: null,
    optGen: 0,
    snapshot: null,
    clearListeners,
    api: null,
    ops: [],
    flushState: { phase: "idle" },
    lastBroadcastAt: -Infinity
  });
  const registerSlot = (mapKey, slot, api) => {
    slot.api = api;
    if (!isDestroyed()) {
      slots.set(mapKey, slot);
      antiEntropy.scheduleRepull();
    }
    return api;
  };
  const makeState = ((namespace, initialValue, config) => {
    const mapKey = `s:${namespace}`;
    const existing = slots.get(mapKey);
    if (existing) return existing.api;
    const [initVal, maxBytes, reqRoles] = validateSlotArgs(namespace, initialValue, config?.maxBytes, config?.roles, hasRolesPlugin() || Boolean(getRolesProvider()), true, "makeState", "state role gating");
    const [subEmitter, emitEmitter, clearEmitter] = createEventEmitter("state handler");
    const validate = config?.validate;
    const slot = {
      ...createSlotBase(namespace, initVal, reqRoles, maxBytes, clearEmitter),
      kind: "s",
      ...validate ? { validate } : {},
      emit: emitEmitter
    };
    const currentMeta = () => {
      if (slot.optimistic) {
        const uid = getLocalUserId();
        return mkCtxBase(slot.optimistic.prev, getSelfId(), uid, uid ? [...getPeerRoles(uid)] : [], slot.optimistic.timestamp);
      }
      const entry = slot.entries.get("");
      return entry ? toSharedCtx(entry.rec, entry.prev, entry.roles) : null;
    };
    return registerSlot(mapKey, slot, lockMethods({
      get: () => getEffectiveLocalValue(slot),
      set: (next) => enqueueSlotOp(slot, false, next),
      getMeta: currentMeta,
      onChange: (handler, options) => subEmitter(handler, options, () => {
        const meta = currentMeta();
        return meta ? [[getEffectiveLocalValue(slot), meta]] : [];
      })
    }, ["onChange"]));
  });
  const makeUserState = ((namespace, initialValue, config) => {
    const mapKey = `u:${namespace}`;
    const existing = slots.get(mapKey);
    if (existing) return existing.api;
    const [initVal, maxBytes, reqRoles] = validateSlotArgs(namespace, initialValue, config?.maxBytes, config?.roles, hasRolesPlugin() || Boolean(getRolesProvider()), false, "makeUserState", "user state role gating");
    const [subEmitter, emitEmitter, clearEmitter] = createEventEmitter("user state handler");
    const validate = config?.validate;
    const slot = {
      ...createSlotBase(namespace, initVal, reqRoles, maxBytes, clearEmitter),
      kind: "u",
      ...validate ? { validate } : {},
      emit: emitEmitter
    };
    const resolveTarget = (args) => {
      const localUid = getLocalUserId();
      if (args.length === 0) return [true, localUid || void 0];
      const id = args[0];
      if (!id) return [false, void 0];
      const selfId = getSelfId();
      if (selfId !== "" && id === selfId || localUid !== "" && id === localUid) return [true, localUid || void 0];
      const mapped = getLiveEntry(slot, id) ? id : getKnownPeerUserId(id) ?? id;
      return [localUid !== "" && mapped === localUid, mapped];
    };
    const localOptMeta = () => {
      if (!slot.optimistic || slot.optimistic.del) return null;
      const uid = getLocalUserId();
      return {
        ...mkCtxBase(slot.optimistic.prev, getSelfId(), uid, uid ? [...getPeerRoles(uid)] : [], slot.optimistic.timestamp),
        self: true,
        online: true,
        removed: false
      };
    };
    return registerSlot(mapKey, slot, lockMethods({
      get: (...args) => {
        const [isSelf, uid] = resolveTarget(args);
        if (isSelf && slot.optimistic) return slot.optimistic.del ? slot.initialValue : slot.optimistic.value;
        return uid !== void 0 ? getLiveEntry(slot, uid)?.value ?? slot.initialValue : slot.initialValue;
      },
      getAll: () => {
        if (!slot.snapshot) {
          const out = {};
          for (const [uid, entry] of slot.entries) if (!entry.rec.del) out[uid] = entry.value;
          const localUid = getLocalUserId();
          if (slot.optimistic && localUid) {
            if (slot.optimistic.del) delete out[localUid];
            else out[localUid] = slot.optimistic.value;
          }
          slot.snapshot = Object.freeze(out);
        }
        return slot.snapshot;
      },
      has: (...args) => {
        const [isSelf, uid] = resolveTarget(args);
        if (isSelf && slot.optimistic) return !slot.optimistic.del;
        return Boolean(uid !== void 0 && getLiveEntry(slot, uid));
      },
      set: (next) => enqueueSlotOp(slot, false, next),
      clear: () => enqueueSlotOp(slot, true),
      getMeta: (...args) => {
        const [isSelf, uid] = resolveTarget(args);
        if (isSelf && slot.optimistic) return localOptMeta();
        const entry = uid ? getLiveEntry(slot, uid) : void 0;
        return entry ? toUserCtx(entry.rec, entry.prev, entry.roles, false) : null;
      },
      onChange: (handler, options) => subEmitter(handler, options, () => {
        const items = [];
        const localUid = getLocalUserId();
        let includedLocalOpt = false;
        for (const [uid, entry] of slot.entries) {
          if (slot.optimistic && localUid && uid === localUid) {
            includedLocalOpt = true;
            const optMeta = localOptMeta();
            if (optMeta) items.push([slot.optimistic.value, optMeta]);
            continue;
          }
          if (!entry.rec.del) items.push([entry.value, toUserCtx(entry.rec, entry.prev, entry.roles, false)]);
        }
        if (slot.optimistic && !includedLocalOpt) {
          const optMeta = localOptMeta();
          if (optMeta) items.push([slot.optimistic.value, optMeta]);
        }
        return items;
      })
    }, ["onChange"]));
  });
  const prepareHandshakeReady = (peerId) => {
    if (isDestroyed() || !isPeerLiveOrPending(peerId) || isPeerBanned(peerId)) return;
    const localUid = getLocalUserId();
    let hasUserWork = false;
    for (const slot of slots.values()) if (slot.kind === "u" && (slot.flushState.phase !== "idle" || slot.ops.length > 0 || Boolean(localUid && getLiveEntry(slot, localUid)))) {
      hasUserWork = true;
      break;
    }
    if (!hasUserWork) return;
    return (async () => {
      try {
        const steps = [];
        for (const slot of slots.values()) {
          if (slot.kind !== "u") continue;
          const hasQueuedOps = slot.ops.length > 0;
          if (hasQueuedOps) for (const op of slot.ops) {
            op.urgent = true;
            steps.push(op.promise.then(noOp2, noOp2));
          }
          switch (slot.flushState.phase) {
            case "pacing":
              if (hasQueuedOps) slot.flushState.wake();
              break;
            case "idle":
              if (hasQueuedOps) flushSlot(slot);
              break;
            case "stepping":
              if (!hasQueuedOps) steps.push(slot.flushState.stepPromise);
              break;
            default:
              unreachable(slot.flushState);
          }
        }
        if (steps.length > 0) {
          let timer;
          await Promise.race([Promise.allSettled(steps), new Promise((r2) => {
            timer = setTimeout(r2, handshakeStateDeadlineMs);
            unrefTimer(timer);
          })]);
          if (timer !== void 0) clearTimeout(timer);
        }
        const uid = getLocalUserId();
        if (!uid || isDestroyed() || !isPeerLiveOrPending(peerId) || isPeerBanned(peerId)) return;
        const p = {};
        const r = [];
        const sentSigs = /* @__PURE__ */ new Set();
        let usedBytes = 0;
        for (const slot of slots.values()) {
          if (slot.kind !== "u") continue;
          const entry = getLiveEntry(slot, uid);
          if (!entry) continue;
          const wire = toWireRecord(entry.rec, false);
          const est = estimateWireRecordBytes(wire);
          if (usedBytes + est > maxHandshakeStateBytes) continue;
          p[entry.rec.userId] = entry.rec.pub;
          r.push(wire);
          sentSigs.add(entry.rec.sig);
          usedBytes += est;
        }
        if (sentSigs.size > 0) sentHandshakeSigs.set(peerId, sentSigs);
        return r.length > 0 ? {
          ok: true,
          p,
          r
        } : void 0;
      } catch {
        return;
      }
    })();
  };
  const shouldAbortStaging = (peerId) => isDestroyed() || !isPeerLiveOrPending(peerId) || isPeerBanned(peerId);
  const stageHandshakeUserState = async (fromPeerId, payload, onReady) => {
    try {
      const badShape = !isObj(payload.p) || !Array.isArray(payload.r) || payload.r.length > 32;
      if (shouldAbortStaging(fromPeerId) || badShape) {
        if (!isDestroyed() && badShape) onInvalidRecord?.(fromPeerId);
        return;
      }
      let roomId;
      try {
        ({ roomId } = await ensureReady());
      } catch {
        return;
      }
      if (shouldAbortStaging(fromPeerId)) return;
      const pubMap = payload.p;
      const knownUid = getKnownPeerUserId(fromPeerId);
      const staged = [];
      let totalBytes = 0;
      const now2 = Date.now();
      for (const wireRec of payload.r) {
        if (shouldAbortStaging(fromPeerId)) return;
        const rec = fromWireRecord(wireRec, appId, roomId, pubMap);
        const parsed = rec && rec.k === "u" ? validateAndMeasureRecord(rec, maxAllowedStateBytes) : null;
        if (!parsed || knownUid && parsed.rec.userId !== knownUid) {
          onInvalidRecord?.(fromPeerId);
          return;
        }
        const slot = slots.get(`u:${parsed.rec.ns}`);
        if (!slot || slot.kind !== "u") continue;
        if (parsed.bytes > slot.maxBytes) continue;
        const res = await verifyParsedRecord(parsed, slot.requiredRoles, fromPeerId);
        if (shouldAbortStaging(fromPeerId)) return;
        if (res === "invalid") {
          onInvalidRecord?.(fromPeerId);
          return;
        }
        if (res === "drop") continue;
        totalBytes += res.bytes;
        if (totalBytes > maxUserStateBytesPerUser) return;
        staged.push({
          slot,
          rec: res.rec,
          roles: res.roles,
          bytes: res.bytes,
          seenAt: now2
        });
      }
      if (!shouldAbortStaging(fromPeerId) && staged.length > 0) stagedHandshake.set(fromPeerId, staged);
    } finally {
      onReady?.();
    }
  };
  const sendLocalRecordsToPeer = (peerId, alreadySent) => {
    const localUid = getLocalUserId();
    if (!localUid || !stateAction || isDestroyed()) return;
    const localRecords = [];
    for (const slot of slots.values()) {
      const entry = slot.entries.get(slot.kind === "s" ? "" : localUid);
      if (entry && entry.rec.userId === localUid && !alreadySent?.has(entry.rec.sig) && isRecordAuthorizedNow(entry.rec, slot.requiredRoles)) localRecords.push(entry.rec);
    }
    if (localRecords.length === 0) return;
    if (isScaleActive()) sendSyncBatches(peerId, localRecords, void 0, true);
    else for (const rec of localRecords) sendState({
      t: "rec",
      r: toWireRecord(rec, true)
    }, peerId);
  };
  const onPeerJoined = (peerId, userId, isDirect) => {
    if (isDestroyed()) return;
    const alreadySent = sentHandshakeSigs.get(peerId);
    sentHandshakeSigs.delete(peerId);
    const staged = stagedHandshake.get(peerId);
    if (staged) {
      stagedHandshake.delete(peerId);
      const appliedHandshake = [];
      for (const item of staged) if (item.rec.userId === userId) {
        const entry = commitEntry(item.slot, item.rec, item.roles, item.bytes);
        if (entry) appliedHandshake.push(entry.rec);
      } else onInvalidRecord?.(peerId);
      forwardAppliedToDirectOthers(appliedHandshake, peerId);
    }
    const stagedOffline = pendingOfflineUserRecs.get(userId);
    if (stagedOffline) {
      pendingOfflineUserRecs.delete(userId);
      const now2 = Date.now();
      const appliedOffline = [];
      for (const item of stagedOffline.values()) if (now2 - item.seenAt < offlineStagingTtlMs && slots.get(`u:${item.slot.namespace}`) === item.slot && isRecordAuthorizedNow(item.rec, item.slot.requiredRoles)) {
        const entry = commitEntry(item.slot, item.rec, item.roles, item.bytes);
        if (entry) appliedOffline.push(entry.rec);
      }
      forwardAppliedToDirectOthers(appliedOffline, peerId);
    }
    resolvePendingJoin(peerId, true);
    if (isDirect && stateAction && slots.size > 0) {
      sendLocalRecordsToPeer(peerId, alreadySent);
      antiEntropy.onPeerJoined(peerId, isScaleActive());
    }
  };
  const clearPeer = (peerId) => {
    stagedHandshake.delete(peerId);
    sentHandshakeSigs.delete(peerId);
    liveRateLimiter.delete(peerId);
    resolvePendingJoin(peerId, false);
    antiEntropy.onPeerDisconnected(peerId);
  };
  const onPeerDisconnected = (peerId) => {
    clearPeer(peerId);
  };
  const onUserLeft = (userId) => {
    if (isDestroyed() || isUserOnline(userId)) return;
    pendingOfflineUserRecs.delete(userId);
    const now2 = Date.now();
    for (const slot of slots.values()) if (slot.kind === "u") {
      const entry = slot.entries.get(userId);
      if (entry) evictEntry(slot, userId, entry, now2, [...entry.roles]);
    }
  };
  const purgeBannedUser = (bannedUid) => {
    if (isDestroyed()) return;
    setUserPresence(bannedUid, false);
    pendingOfflineUserRecs.delete(bannedUid);
    const localUid = getLocalUserId();
    const now2 = Date.now();
    let evictedShared = false;
    for (const slot of slots.values()) {
      if (localUid && bannedUid === localUid) clearSlotOptimistic(slot);
      const key = slot.kind === "s" ? "" : bannedUid;
      const entry = slot.entries.get(key);
      if (entry && (slot.kind === "u" || entry.rec.userId === bannedUid)) {
        evictEntry(slot, key, entry, now2, []);
        if (slot.kind === "s") evictedShared = true;
      }
    }
    if (evictedShared) antiEntropy.scheduleRepull();
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    antiEntropy.destroy();
    stagedHandshake.clear();
    sentHandshakeSigs.clear();
    pendingOfflineUserRecs.clear();
    activeOnlineUsers.clear();
    onlineEpoch.clear();
    liveRateLimiter.clear();
    pendingJoinWaiters.forEach((waiter) => waiter.resolve(false));
    pendingJoinWaiters.clear();
    slots.forEach((slot) => {
      clearSlotOptimistic(slot);
      const queuedOps = slot.ops.splice(0);
      let inFlightOps = [];
      switch (slot.flushState.phase) {
        case "pacing":
          slot.flushState.wake();
          slot.flushState = { phase: "idle" };
          break;
        case "stepping":
          inFlightOps = slot.flushState.activeOps.splice(0);
          break;
        case "idle":
          break;
        default:
          unreachable(slot.flushState);
      }
      resolveOps(inFlightOps);
      resolveOps(queuedOps);
      slot.clearListeners();
    });
  };
  return {
    makeState,
    makeUserState,
    verifyAndApplyStateRecord: async (rec, fromPeerId) => Boolean(await applyIncoming(rec, fromPeerId)),
    prepareHandshakeReady,
    stageHandshakeUserState,
    setUserPresence,
    onPeerJoined,
    onPeerDisconnected,
    onUserLeft,
    purgeBannedUser,
    clearPeer,
    destroy
  };
};

// node_modules/@trystero-p2p/core/dist/room.mjs
var leaveFlushGraceMs = 50;
var unloadEvent = "beforeunload";
var beforeUnloadRoomCleanups = /* @__PURE__ */ new Set();
var frozenEmptyRoles = Object.freeze([]);
var cleanupActiveRoomsOnBeforeUnload = () => beforeUnloadRoomCleanups.forEach((cleanup) => cleanup());
var registerBeforeUnloadCleanup = (cleanup) => {
  beforeUnloadRoomCleanups.add(cleanup);
  if (beforeUnloadRoomCleanups.size === 1) addEventListener(unloadEvent, cleanupActiveRoomsOnBeforeUnload);
  return () => {
    beforeUnloadRoomCleanups.delete(cleanup);
    if (!beforeUnloadRoomCleanups.size) removeEventListener(unloadEvent, cleanupActiveRoomsOnBeforeUnload);
  };
};
var isPromiseLike = (val) => Boolean(val && typeof val === "object" && typeof val.then === "function");
var extractPluginSlots = (use, initialRoomId, identity) => {
  if (use !== void 0 && !Array.isArray(use)) throw mkErr("use must be an array of room plugins");
  let rolesSlot = null;
  let scaleSlot = null;
  for (const item of use ?? []) {
    const slot = item && typeof item === "object" ? item[pluginSlotSymbol] : void 0;
    if (!slot) throw mkErr("invalid plugin in use[]; expected roles() or scale()");
    if (slot.kind === "roles") {
      if (rolesSlot) throw mkErr('duplicate plugin "roles" in use[]');
      rolesSlot = slot;
    } else {
      if (scaleSlot) throw mkErr('duplicate plugin "scale" in use[]');
      scaleSlot = slot;
    }
  }
  if (!rolesSlot && selfCertifyingRoomRegex.test(initialRoomId)) throw selfCertRoomRolesErr;
  if (rolesSlot?.selfAsAdmin && isEphemeralIdentityConfig(identity)) warnEphemeralAdmin();
  return [rolesSlot, scaleSlot];
};
var isRoomLeavingOrLeft = (state) => state.phase === "leaving" || state.phase === "left";
var isPendingDirectSession = (session) => session.phase === "direct-pending" || session.phase === "virtual-upgrading";
var hasVirtualSession = (session) => session.phase === "virtual-only" || session.phase === "virtual-upgrading";
var createRoomWithBridge = (onPeer, onPeerLeave, onSelfLeave, roomOptions = {}) => {
  const { endpointIdentity, clientId, appId = "", roomId: initialRoomId = "", password = "", maxUsers, identity, maxReceiveBytes, onBeforeLeave } = roomOptions;
  if (maxUsers !== void 0 && !isPosSafeInt(maxUsers)) throw posSafeIntErr("maxUsers");
  if (identity !== void 0) validateIdentityConfig({ identity });
  const [rolesSlot, scaleSlot] = extractPluginSlots(roomOptions.use, initialRoomId, identity);
  const hasRolesPlugin = Boolean(rolesSlot);
  const syncEndpoint = endpointIdentity && !isPromiseLike(endpointIdentity) ? endpointIdentity : void 0;
  const effectiveClientId = clientId ?? (syncEndpoint ? syncEndpoint.peerId : createIdentityClientId());
  let localSelfId = syncEndpoint ? syncEndpoint.peerId : "";
  let localUserId = "";
  let roomLifecycle = { phase: "active" };
  let didReportSetupError = false;
  let effectiveRoomId = initialRoomId;
  let rolesProvider = null;
  let scaleProvider = null;
  let cachedUsersSnapshot = null;
  const getLocalSelfId = () => localSelfId;
  const getLocalUserId = () => localUserId;
  const isLeavingOrLeft = () => isRoomLeavingOrLeft(roomLifecycle);
  const canAcceptPeers = () => roomLifecycle.phase === "active";
  const invalidateUsersSnapshot = () => {
    cachedUsersSnapshot = null;
  };
  const pendingFlushDestroys = /* @__PURE__ */ new Set();
  const cleanups = [];
  const mkEv = (name) => {
    const [sub, emit, clear] = createEventEmitter(name);
    cleanups.push(clear);
    return [sub, emit];
  };
  const [subPeerActivated, emitPeerActivated] = mkEv("onPeerActivated");
  const [subPeerDeactivated, emitPeerDeactivated] = mkEv("onPeerDeactivated");
  const [subRoomIdChanged, emitRoomIdChanged] = mkEv("onRoomIdChanged");
  const [subLeave, emitLeave] = mkEv("onLeave");
  const [subPeerJoin, emitPeerJoin] = mkEv("onPeerJoin");
  const [subPeerLeave, emitPeerLeave] = mkEv("onPeerLeave");
  const [subUserJoin, emitUserJoin] = mkEv("onUserJoin");
  const [subUserLeave, emitUserLeave] = mkEv("onUserLeave");
  const [subError, emitError] = mkEv("onError");
  const emitRoomError = (error) => {
    if (!isLeavingOrLeft()) emitError({
      ...error,
      appId,
      roomId: effectiveRoomId
    });
  };
  const failSetup = (error) => {
    if (didReportSetupError || roomLifecycle.phase !== "active") return;
    didReportSetupError = true;
    roomLifecycle = { phase: "setup-failed" };
    queueMicrotask(() => {
      emitRoomError(error);
      leave();
    });
  };
  const localEndpointP = (endpointIdentity ? Promise.resolve(endpointIdentity) : getDefaultEndpointIdentity(appId, effectiveClientId)).then((ep) => {
    localSelfId = ep.peerId;
    return ep;
  }, (err) => {
    failSetup({
      code: "identity-failed",
      message: toErrorMessage(err, "endpoint identity resolution failed"),
      cause: err
    });
    throw err;
  });
  localEndpointP.catch(noOp2);
  const localSelfIdP = localSelfId ? Promise.resolve(localSelfId) : localEndpointP.then((ep) => ep.peerId);
  localSelfIdP.catch(noOp2);
  const setEffectiveRoomId = (rid) => {
    if (rid && rid !== effectiveRoomId) {
      effectiveRoomId = rid;
      emitRoomIdChanged(rid);
    }
  };
  const peerEntries = /* @__PURE__ */ new Map();
  const resolvedUserIdentityP = resolveUserIdentity(appId, initialRoomId, identity === void 0 ? void 0 : { identity }, effectiveClientId).then((resolvedId) => {
    localUserId = resolvedId.userId;
    if (!isLeavingOrLeft()) stateMgr?.setUserPresence(localUserId, true);
    invalidateUsersSnapshot();
    return resolvedId;
  }, (err) => {
    failSetup({
      code: "identity-failed",
      message: toErrorMessage(err, "identity resolution failed"),
      cause: err
    });
    throw err;
  });
  resolvedUserIdentityP.catch(noOp2);
  const effectiveRoomIdP = rolesSlot?.selfAsAdmin && !selfCertifyingRoomRegex.test(initialRoomId) ? resolvedUserIdentityP.then((u) => {
    const rid = formatSelfCertifyingRoomId(initialRoomId, u.userId);
    if (!isLeavingOrLeft()) setEffectiveRoomId(rid);
    return rid;
  }) : void 0;
  effectiveRoomIdP?.catch(noOp2);
  const isActiveEntry = (entry) => Boolean(entry && entry.session.phase !== "direct-pending");
  const hasSessionEntry = (entry, includePending) => includePending ? Boolean(entry) : isActiveEntry(entry);
  const isEntryVerified = (entry) => entry.session.phase === "direct-active" || isPendingDirectSession(entry.session) && entry.session.verified;
  const getPeerUserId = (id) => {
    const selfId = getLocalSelfId();
    return selfId && id === selfId ? getLocalUserId() : peerEntries.get(id)?.userId ?? scaleProvider?.getPeerUserId(id) ?? id;
  };
  const getKnownPeerUserId = (id) => {
    const selfId = getLocalSelfId();
    return selfId && id === selfId ? getLocalUserId() || void 0 : peerEntries.get(id)?.userId ?? scaleProvider?.getPeerUserId(id);
  };
  const countActivePeersForUser = (uid, excludePeerId) => {
    let count = 0;
    for (const [pid, entry] of peerEntries) if (pid !== excludePeerId && isActiveEntry(entry) && getPeerUserId(pid) === uid) count++;
    return count;
  };
  const reconcileUserChangeOnActiveEntry = (peerId, entry, nextUid) => {
    const prevEmitted = entry.emittedUserId;
    if (!prevEmitted || prevEmitted === nextUid) {
      entry.emittedUserId = nextUid;
      if (!prevEmitted && !isLeavingOrLeft()) stateMgr?.setUserPresence(nextUid, true);
      return;
    }
    const localUid = getLocalUserId();
    const wasLastForPrev = countActivePeersForUser(prevEmitted, peerId) === 0;
    const isFirstForNext = countActivePeersForUser(nextUid, peerId) === 0;
    entry.emittedUserId = nextUid;
    if (!isLeavingOrLeft()) {
      if (wasLastForPrev && (!localUid || prevEmitted !== localUid)) {
        emitUserLeave({
          userId: prevEmitted,
          peerId
        });
        stateMgr?.setUserPresence(prevEmitted, false);
        stateMgr?.onUserLeft(prevEmitted);
      }
      if (isFirstForNext && (!localUid || nextUid !== localUid)) {
        stateMgr?.setUserPresence(nextUid, true);
        stateMgr?.onPeerJoined(peerId, nextUid, isDirectPeer(peerId));
        emitUserJoin({
          userId: nextUid,
          peerId,
          roles: getPeerRoles(peerId)
        });
      }
    }
  };
  const setPeerUserId = (id, uid) => {
    if (!uid) return;
    const entry = peerEntries.get(id);
    if (!entry || isEntryVerified(entry)) return;
    if (entry.userId !== uid) {
      entry.userId = uid;
      invalidateUsersSnapshot();
      if (isActiveEntry(entry)) reconcileUserChangeOnActiveEntry(id, entry, uid);
    }
  };
  const isDirectPeer = (id) => peerEntries.get(id)?.session.phase === "direct-active";
  const isPeerActive = (id) => isActiveEntry(peerEntries.get(id));
  const hasAnyPeer = (id) => peerEntries.has(id);
  const getDirectPeer = (id, includePending = false) => {
    const session = peerEntries.get(id)?.session;
    if (!session || session.phase === "virtual-only") return;
    if (session.phase === "direct-active") return session.peer;
    return includePending ? session.peer : void 0;
  };
  const getPeerIds = (includePending = false) => {
    const ids = [];
    for (const [id, entry] of peerEntries) if (hasSessionEntry(entry, includePending)) ids.push(id);
    return ids;
  };
  const getDirectPeerEntries = (activeOnly = true) => {
    const list = [];
    for (const id of peerEntries.keys()) {
      const peer = getDirectPeer(id, !activeOnly);
      if (peer) list.push([id, peer]);
    }
    return list;
  };
  const getDirectPeerIds = (activeOnly = true) => getDirectPeerEntries(activeOnly).map((pair) => pair[0]);
  const resetDirectSessionOnEntry = (id, entry) => {
    delete entry.deferredReady;
    switch (entry.session.phase) {
      case "virtual-upgrading":
        entry.session = {
          phase: "virtual-only",
          virtual: entry.session.virtual
        };
        invalidateUsersSnapshot();
        return;
      case "direct-pending":
      case "direct-active":
        peerEntries.delete(id);
        invalidateUsersSnapshot();
        return;
      case "virtual-only":
        return;
      default:
        unreachable(entry.session);
    }
  };
  const findPeersForUser = (uid, includePending) => {
    const matching = [];
    for (const [pid, entry] of peerEntries) if (hasSessionEntry(entry, includePending) && getPeerUserId(pid) === uid) matching.push(pid);
    return matching;
  };
  const getUserPeerIds = (uid) => {
    const active = findPeersForUser(uid, false);
    return active.length ? active : findPeersForUser(uid, true);
  };
  const resolveSendTarget = (targets, includePending = false) => {
    if (!targets) return;
    const resolved = [];
    const seen = /* @__PURE__ */ new Set();
    const addPeer = (pid) => {
      if (!seen.has(pid)) {
        seen.add(pid);
        resolved.push(pid);
      }
    };
    for (const id of Array.isArray(targets) ? targets : [targets]) if (hasSessionEntry(peerEntries.get(id), includePending)) addPeer(id);
    else {
      const matched = findPeersForUser(id, includePending);
      if (matched.length) matched.forEach(addPeer);
      else addPeer(id);
    }
    return resolved;
  };
  const resolveRequestTarget = (target, includePending = false) => hasSessionEntry(peerEntries.get(target), includePending) ? target : findPeersForUser(target, includePending).sort((a, b) => {
    const aDirect = isDirectPeer(a);
    return aDirect !== isDirectPeer(b) ? aDirect ? -1 : 1 : cmpStr(a, b);
  })[0];
  const isPeerBanned = (id) => Boolean(id && rolesProvider?.isPeerBanned(id));
  const getPeerRoles = (id = getLocalSelfId()) => rolesProvider?.getPeerRoles(id) ?? frozenEmptyRoles;
  let stateMgr = null;
  const emitActivatedEvents = (peerId, uid, isFirstForUser) => {
    if (isLeavingOrLeft()) return;
    const localUid = getLocalUserId();
    if (isFirstForUser && (!localUid || uid !== localUid)) stateMgr?.setUserPresence(uid, true);
    stateMgr?.onPeerJoined(peerId, uid, isDirectPeer(peerId));
    const roles2 = getPeerRoles(peerId);
    emitPeerJoin({
      peerId,
      userId: uid,
      roles: roles2
    });
    if (isFirstForUser && (!localUid || uid !== localUid)) emitUserJoin({
      userId: uid,
      peerId,
      roles: roles2
    });
  };
  const emitDeactivatedEvents = (peerId, wasActive, isLastForUser, uid) => {
    if (!wasActive) return;
    const localUid = getLocalUserId();
    stateMgr?.onPeerDisconnected(peerId);
    emitPeerDeactivated(peerId);
    if (!isLeavingOrLeft()) {
      emitPeerLeave({
        peerId,
        userId: uid
      });
      if (isLastForUser && (!localUid || uid !== localUid)) {
        emitUserLeave({
          userId: uid,
          peerId
        });
        stateMgr?.setUserPresence(uid, false);
        stateMgr?.onUserLeft(uid);
      }
    }
  };
  let unregisterBeforeUnloadCleanup = noOp2;
  const iterate = (targets, f) => {
    const resolvedTargets = resolveSendTarget(targets);
    return (resolvedTargets ? Array.isArray(resolvedTargets) ? resolvedTargets : [resolvedTargets] : getPeerIds(false)).flatMap((id) => {
      if (!isPeerActive(id)) {
        warnNoPeer(id);
        return [];
      }
      return [Promise.resolve(f(id, getDirectPeer(id, false)))];
    });
  };
  const scheduleFlushDestroy = (peer) => {
    let completed = false;
    const finishNow = () => {
      cancel();
    };
    const cancel = destroyAfterFlush(peer, 40, 150, () => {
      completed = true;
      pendingFlushDestroys.delete(finishNow);
    });
    if (!completed) pendingFlushDestroys.add(finishNow);
  };
  const kickPeer = (id, peer, reason) => {
    const cur = getDirectPeer(id, true);
    if (cur && (!peer || cur === peer || reason === peerBannedErr)) leaveAction.send("", { target: id }).catch(noOp2);
    exitPeer(id, peer, reason);
  };
  const reportPeerError = (id, error) => {
    if (error !== peerBannedErr) emitRoomError({
      code: "peer-error",
      peerId: id,
      message: toErrorMessage(error, "peer error"),
      cause: error
    });
  };
  const onPeerError = (id, error) => {
    if (hasAnyPeer(id)) reportPeerError(id, error);
    kickPeer(id, void 0, error);
  };
  const mediaManager = createMediaManager({
    iterate,
    isActive: isPeerActive,
    onPeerError,
    preparePeer: (id) => {
      const direct = getDirectPeer(id, false);
      return direct ? Promise.resolve(direct) : scaleProvider ? scaleProvider.prepareMediaPeer(id) : Promise.reject(peerDisconnectedErr);
    },
    getPeerUserId,
    onPeerMediaPinChange: (id, pinned) => {
      scaleProvider?.setPeerMediaPinned(id, pinned);
    }
  });
  const getEntryTransport = (id, includePending) => {
    const session = peerEntries.get(id)?.session;
    if (!session) return;
    switch (session.phase) {
      case "direct-active":
        return session.transport;
      case "direct-pending":
        return includePending ? session.transport : void 0;
      case "virtual-upgrading":
        return includePending ? session.transport : session.virtual;
      case "virtual-only":
        return session.virtual;
      default:
        return unreachable(session);
    }
  };
  const { makeAction, makeInternalAction, makeInternalRequestAction, handleData, clearPeer: clearActionPeer, clearListeners: clearActionListeners } = createActionManager({
    getPeerIds,
    canReceiveFromPeer: (id, receiveWhilePending) => !isPeerBanned(id) && (isPeerActive(id) || hs.canReceiveFromPeer(id, receiveWhilePending)),
    onPeerError,
    getTransport: getEntryTransport,
    broadcastInline: (frame, onProgress, signal) => scaleProvider ? scaleProvider.broadcastInline(frame, onProgress, signal) : false,
    registerActionAuthority: (namespace, roles2) => {
      if (!rolesProvider) throw requiresRolesErr("action role gating");
      scaleProvider?.registerActionAuthority(namespace, roles2);
    },
    getLocalActionCert: (requiredRoles, namespace) => rolesProvider ? rolesProvider.getLocalActionCert(requiredRoles, namespace) : Promise.resolve(null),
    authorizePeerAction: (peerId, requiredRoles, inlineCert) => rolesProvider ? rolesProvider.authorizePeerAction(peerId, requiredRoles, inlineCert) : false,
    getPeerRoles: (peerId) => getPeerRoles(peerId),
    getPeerUserId,
    resolveSendTarget,
    resolveRequestTarget,
    onUnknownType: (type) => {
      if (type === "@_state" && !isLeavingOrLeft()) ensureStateManager();
    },
    ...maxReceiveBytes === void 0 ? {} : { maxReceiveBytes }
  });
  const awaitSelfState = async () => {
    await roomReadyP;
    return [await resolvedUserIdentityP, await rolesProvider?.getAuthorityInfo()];
  };
  const [hitStatePenalty, resetStatePenalty] = createWindowCounter(512, 8);
  const ensureStateManager = () => {
    if (!stateMgr) {
      const created = createStateManager({
        appId,
        getRoomId: () => effectiveRoomId,
        getSelfId: getLocalSelfId,
        getLocalUserId,
        ensureReady: async () => {
          const [user, info] = await awaitSelfState();
          return {
            selfId: getLocalSelfId(),
            user,
            roomId: info?.roomId ?? effectiveRoomId
          };
        },
        hasRolesPlugin: () => hasRolesPlugin,
        getRolesProvider: () => rolesProvider,
        getScaleProvider: () => scaleProvider,
        isPeerActive,
        isPeerPendingHandshake: (peerId) => Boolean(hs.getPeer(peerId) && !isDirectPeer(peerId)),
        isDirectPeer,
        getDirectPeerIds: () => getDirectPeerIds(true),
        isUserOnline: (uid) => {
          const localUid = getLocalUserId();
          return Boolean(localUid && uid === localUid || countActivePeersForUser(uid) > 0);
        },
        getKnownPeerUserId,
        isPeerBanned: (peerOrUserId) => Boolean(peerOrUserId && isPeerBanned(peerOrUserId)),
        getPeerRoles: (peerOrUserId) => getPeerRoles(peerOrUserId),
        makeInternalAction,
        onInvalidRecord: (fromPeerId) => {
          const selfId = getLocalSelfId();
          if (!fromPeerId || fromPeerId === selfId) return;
          if (hitStatePenalty(fromPeerId)) {
            resetStatePenalty(fromPeerId);
            onPeerError(fromPeerId, mkViolationErr("excessive invalid state records"));
          }
        }
      });
      if (isLeavingOrLeft()) created.destroy();
      else {
        if (localUserId) created.setUserPresence(localUserId, true);
        for (const [pid, entry] of peerEntries) if (isActiveEntry(entry)) created.setUserPresence(getPeerUserId(pid), true);
      }
      stateMgr = created;
    }
    return stateMgr;
  };
  const removePeerEntry = (id) => {
    const entry = peerEntries.get(id);
    if (!entry) return [
      false,
      false,
      getPeerUserId(id),
      void 0
    ];
    const wasActive = isActiveEntry(entry);
    const uid = entry.emittedUserId ?? entry.userId ?? scaleProvider?.getPeerUserId(id) ?? id;
    const directPeer = entry.session.phase === "virtual-only" ? void 0 : entry.session.peer;
    const virtualTransport = hasVirtualSession(entry.session) ? entry.session.virtual : null;
    peerEntries.delete(id);
    virtualTransport?.close?.();
    const isLast = wasActive && countActivePeersForUser(uid, id) === 0;
    if (wasActive) invalidateUsersSnapshot();
    return [
      wasActive,
      isLast,
      uid,
      directPeer
    ];
  };
  const clearSubsystems = (id, err) => {
    stateMgr?.clearPeer(id);
    clearActionPeer(id, err);
    mediaManager.clearPeer(id);
  };
  const exitPeer = (id, peer, reason) => {
    const err = reason === void 0 ? peerDisconnectedErr : toError(reason, peerDisconnectedMsg);
    const banned = err === peerBannedErr;
    const currentDirect = getDirectPeer(id, true);
    if (peer) {
      if (currentDirect !== peer) {
        if (banned) {
          scaleProvider?.markPeerBanned(id);
          if (!hasAnyPeer(id)) return;
        } else return;
      }
    } else if (!hasAnyPeer(id)) {
      if (banned) scaleProvider?.markPeerBanned(id);
      return;
    }
    const existingEntry = peerEntries.get(id);
    if (!banned && currentDirect && existingEntry?.session.phase === "virtual-upgrading") {
      clearPendingPeer(id, err);
      stateMgr?.clearPeer(id);
      resetDirectSessionOnEntry(id, existingEntry);
      currentDirect.destroy();
      scaleProvider?.removeDirectPeer(id, currentDirect, err);
      onPeerLeave(id, false);
      return;
    }
    if (banned) scaleProvider?.markPeerBanned(id);
    clearPendingPeer(id, err);
    clearSubsystems(id, err);
    const [wasActive, isLast, uid, directPeer] = removePeerEntry(id);
    emitDeactivatedEvents(id, wasActive, isLast, uid);
    if (directPeer) {
      if ((banned || reason === roomFullErr) && !isLeavingOrLeft()) scheduleFlushDestroy(directPeer);
      else directPeer.destroy();
      scaleProvider?.removeDirectPeer(id, directPeer, err);
      onPeerLeave(id, !banned && reason !== roomFullErr);
    } else if (wasActive) scaleProvider?.removeDirectPeer(id, void 0, err);
  };
  const leave = () => {
    if (isRoomLeavingOrLeft(roomLifecycle)) return roomLifecycle.promise;
    const { promise, resolve, reject } = Promise.withResolvers();
    roomLifecycle = {
      phase: "leaving",
      promise
    };
    (async () => {
      onBeforeLeave?.();
      reservedAdmissionUsers.clear();
      for (const id of getPeerIds(true)) hs.clearPeer(id, roomLeftErr);
      emitLeave();
      const leaveTargets = scaleProvider ? getDirectPeerIds(false).filter((id) => {
        const session = peerEntries.get(id)?.session;
        return session && session.phase !== "virtual-only" && session.transport.isOpen;
      }) : void 0;
      const hasOpenPeers = peerEntries.size > 0 && (!leaveTargets || leaveTargets.length > 0);
      const controller = new AbortController();
      if (hasOpenPeers) leaveAction.send("", {
        ...leaveTargets ? { target: leaveTargets } : {},
        signal: controller.signal
      }).catch(noOp2);
      if (scaleProvider) await scaleProvider.announceLeave();
      if (hasOpenPeers) await new Promise((res) => {
        setTimeout(res, leaveFlushGraceMs);
      });
      controller.abort();
      try {
        scaleProvider?.destroy();
        for (const flushNow of pendingFlushDestroys) flushNow();
        pendingFlushDestroys.clear();
        const allPeerIds = getPeerIds(true);
        for (const id of allPeerIds) {
          const cur = peerEntries.get(id);
          if (!cur) continue;
          const direct = cur.session.phase === "virtual-only" ? null : cur.session.peer;
          const virtual = hasVirtualSession(cur.session) ? cur.session.virtual : null;
          peerEntries.delete(id);
          direct?.destroy();
          virtual?.close?.();
        }
        peerEntries.clear();
        invalidateUsersSnapshot();
        for (const id of allPeerIds) clearSubsystems(id, roomLeftErr);
      } finally {
        roomLifecycle = {
          phase: "left",
          promise
        };
        for (const fn of [
          ...cleanups,
          mediaManager.clearListeners,
          clearActionListeners,
          () => stateMgr?.destroy()
        ]) fn();
        try {
          unregisterBeforeUnloadCleanup();
        } finally {
          onSelfLeave();
        }
      }
    })().then(resolve, reject);
    return promise;
  };
  const pingAction = makeInternalRequestAction("ping");
  pingAction.onRequest(() => "");
  const signalAction = makeInternalAction("signal");
  const streamMetaAction = makeInternalAction("stream", { maxPayloadBytes: 65536 });
  const leaveAction = makeInternalAction("leave", {
    sendToPending: true,
    receiveWhilePending: true
  });
  const handshakeDataAction = makeInternalAction("hsdata", {
    sendToPending: true,
    receiveWhilePending: true,
    maxPayloadBytes: 65536
  });
  const handshakeReadyAction = makeInternalAction("hsready", {
    sendToPending: true,
    receiveWhilePending: true,
    maxPayloadBytes: 131072
  });
  const reservedAdmissionUsers = /* @__PURE__ */ new Map();
  const rejectedFullPeerUsers = createBoundedCache(256);
  const getUsersSet = (includeReserved = false, excludePeerId) => {
    const users = /* @__PURE__ */ new Set([getLocalUserId()]);
    for (const [pid, entry] of peerEntries) if (isActiveEntry(entry)) users.add(getPeerUserId(pid));
    if (includeReserved) {
      for (const [pid, uid] of reservedAdmissionUsers) if (pid !== excludePeerId) users.add(uid);
    }
    return users;
  };
  const isFullForPeer = (id, includeReserved = false) => {
    if (maxUsers === void 0 || isPeerActive(id)) return false;
    const users = getUsersSet(includeReserved, id);
    const candidateUid = peerEntries.get(id)?.userId ?? scaleProvider?.getPeerUserId(id) ?? rejectedFullPeerUsers.get(id) ?? id;
    return !users.has(candidateUid) && users.size >= maxUsers;
  };
  const canConnectPeer = (peerId) => {
    const knownUid = peerEntries.get(peerId)?.userId ?? scaleProvider?.getPeerUserId(peerId) ?? rejectedFullPeerUsers.get(peerId);
    return !isPeerBanned(getLocalSelfId()) && !isPeerBanned(peerId) && !(knownUid !== void 0 && isFullForPeer(peerId, true));
  };
  const rejectPeer = (id, peer, err) => {
    if (getDirectPeer(id, true) !== peer) return;
    const isBan = err === peerBannedMsg;
    const errObj = isBan ? peerBannedErr : roomFullErr;
    if (isBan) scaleProvider?.markPeerBanned(id);
    else {
      const knownUid = peerEntries.get(id)?.userId ?? scaleProvider?.getPeerUserId(id);
      if (knownUid) rejectedFullPeerUsers.set(id, knownUid);
    }
    const banReason = isBan ? rolesProvider?.getBanReason(getPeerUserId(id)) ?? rolesProvider?.getBanReason(id) : void 0;
    hs.clearPeer(id, errObj);
    stateMgr?.clearPeer(id);
    reservedAdmissionUsers.delete(id);
    handshakeReadyAction.send({
      ok: false,
      err,
      ...banReason !== void 0 ? { reason: banReason } : {}
    }, { target: id }).catch(noOp2).finally(() => {
      if (getDirectPeer(id, true) !== peer) return;
      exitPeer(id, peer, errObj);
    });
  };
  const tryAdmitPeer = (id, peer) => {
    if (isPeerBanned(id)) {
      rejectPeer(id, peer, peerBannedMsg);
      return false;
    }
    if (maxUsers === void 0 || isPeerActive(id)) return true;
    if (isFullForPeer(id, true)) {
      rejectPeer(id, peer, roomFullMsg);
      return false;
    }
    reservedAdmissionUsers.set(id, getPeerUserId(id));
    return true;
  };
  const clearPendingPeer = (id, reason) => {
    hs.clearPeer(id, reason);
    reservedAdmissionUsers.delete(id);
  };
  const deliverHandshakeReady = (data, id) => {
    if (data && typeof data === "object" && data.ok === true) {
      if (hs.getPeer(id) && !isDirectPeer(id) && !isPeerBanned(id) && !isFullForPeer(id)) {
        ensureStateManager().stageHandshakeUserState(id, data, () => {
          if (!isLeavingOrLeft() && hs.getPeer(id)) processHandshakeReady("", id);
        });
        return;
      }
      processHandshakeReady("", id);
      return;
    }
    processHandshakeReady(data, id);
  };
  const onPeerIdentityVerified = (peerId, verified, peer) => {
    if (peer && getDirectPeer(peerId, true) !== peer) return;
    const entry = peerEntries.get(peerId);
    if (!entry || !isPendingDirectSession(entry.session)) return;
    entry.userId = verified.userId;
    invalidateUsersSnapshot();
    if (isPeerBanned(peerId) || isPeerBanned(verified.userId)) {
      scaleProvider?.markPeerBanned(peerId);
      throw peerBannedErr;
    }
    const deferredReady = entry.deferredReady;
    delete entry.deferredReady;
    entry.session = {
      ...entry.session,
      verified: true
    };
    scaleProvider?.setPeerSignPublicKey(peerId, verified.peerPubKey);
    if (deferredReady !== void 0) queueMicrotask(() => {
      const cur = peerEntries.get(peerId);
      if (cur && isEntryVerified(cur) && (!peer || getDirectPeer(peerId, true) === peer)) deliverHandshakeReady(deferredReady, peerId);
    });
  };
  const internalKernel = {
    get selfId() {
      return getLocalSelfId();
    },
    appId,
    initialRoomId,
    password,
    ...maxUsers === void 0 ? {} : { maxUsers },
    getRoomId: () => effectiveRoomId,
    setEffectiveRoomId,
    getLocalEndpointIdentity: () => localEndpointP,
    getLocalUserIdentity: () => resolvedUserIdentityP,
    getPeerUserId,
    getKnownPeerUserId,
    getUserPeerIds,
    setPeerUserId,
    getActivePeerIds: () => getPeerIds(false),
    getDirectActivePeerIds: () => getDirectPeerIds(true),
    getAllPeerIds: () => getPeerIds(true),
    isPeerActive,
    getPeerHandle: getDirectPeer,
    kickPeer: (peerId, reason) => kickPeer(peerId, void 0, reason),
    emitError: emitRoomError,
    makeInternalAction,
    deliverRawData: (originPeerId, data) => {
      if (isPeerBanned(originPeerId)) return;
      handleData(originPeerId, data);
    },
    getRolesProvider: () => rolesProvider,
    getScaleProvider: () => scaleProvider,
    activateVirtualPeer: (peerId, transport) => {
      if (!canAcceptPeers() || isPeerBanned(peerId) || isFullForPeer(peerId, true)) {
        transport.close?.();
        return false;
      }
      if (isDirectPeer(peerId)) {
        transport.close?.();
        return true;
      }
      const existing = peerEntries.get(peerId);
      const wasActive = isActiveEntry(existing);
      const uid = existing?.userId ?? scaleProvider?.getPeerUserId(peerId) ?? peerId;
      const isFirst = !wasActive && countActivePeersForUser(uid, peerId) === 0;
      if (!existing) peerEntries.set(peerId, {
        session: {
          phase: "virtual-only",
          virtual: transport
        },
        userId: uid,
        emittedUserId: uid
      });
      else {
        existing.userId = uid;
        switch (existing.session.phase) {
          case "virtual-only":
            if (existing.session.virtual !== transport) existing.session.virtual.close?.();
            existing.session = {
              phase: "virtual-only",
              virtual: transport
            };
            break;
          case "virtual-upgrading":
            if (existing.session.virtual !== transport) existing.session.virtual.close?.();
            existing.session = {
              ...existing.session,
              virtual: transport
            };
            break;
          case "direct-pending":
            existing.session = {
              phase: "virtual-upgrading",
              virtual: transport,
              peer: existing.session.peer,
              transport: existing.session.transport,
              verified: existing.session.verified
            };
            existing.emittedUserId = uid;
            break;
          case "direct-active":
            break;
          default:
            unreachable(existing.session);
        }
      }
      invalidateUsersSnapshot();
      if (!wasActive) emitActivatedEvents(peerId, uid, isFirst);
      return true;
    },
    deactivateVirtualPeer: (peerId, reason) => {
      if (isDirectPeer(peerId)) return;
      const entry = peerEntries.get(peerId);
      if (!entry || !hasVirtualSession(entry.session)) return;
      const err = toError(reason, peerDisconnectedMsg);
      const uid = entry.emittedUserId ?? entry.userId ?? scaleProvider?.getPeerUserId(peerId) ?? peerId;
      const vt = entry.session.virtual;
      if (entry.session.phase === "virtual-upgrading") {
        entry.session = {
          phase: "direct-pending",
          peer: entry.session.peer,
          transport: entry.session.transport,
          verified: entry.session.verified
        };
        delete entry.emittedUserId;
      } else peerEntries.delete(peerId);
      vt.close?.();
      const isLast = countActivePeersForUser(uid, peerId) === 0;
      invalidateUsersSnapshot();
      if (!hasAnyPeer(peerId)) clearSubsystems(peerId, err);
      emitDeactivatedEvents(peerId, true, isLast, uid);
    },
    purgeBannedUserState: (userId) => {
      stateMgr?.purgeBannedUser(userId);
    },
    onRolesChanged: invalidateUsersSnapshot,
    onPeerActivated: (cb, options) => subPeerActivated(cb, options, () => getDirectPeerEntries(true)),
    onPeerDeactivated: subPeerDeactivated,
    onRoomIdChanged: subRoomIdChanged,
    onLeave: subLeave
  };
  const identityHandshake = createIdentityHandshake({
    endpointIdentityP: localEndpointP,
    appId,
    roomId: effectiveRoomIdP ?? initialRoomId,
    getUserIdentity: () => resolvedUserIdentityP,
    onVerified: onPeerIdentityVerified
  });
  const hs = createHandshakeManager({
    selfIdP: localSelfIdP,
    onPeerHandshake: identityHandshake.run,
    onHandshakeError: (peerId, reason) => {
      if (reason === peerBannedErr || isPeerBanned(peerId)) return;
      emitRoomError({
        code: "handshake-failed",
        peerId,
        message: toErrorMessage(reason, "handshake failed"),
        cause: reason
      });
    },
    deferResponderReady: maxUsers !== void 0,
    sendHandshakeData: (data, peerId, metadata) => handshakeDataAction.send(data, {
      target: peerId,
      ...metadata === void 0 ? {} : { metadata }
    }),
    sendHandshakeReady: (data, peerId) => handshakeReadyAction.send(data, { target: peerId }),
    onLocalHandshakePassed: (id, peer) => {
      if (isPeerBanned(id)) {
        rejectPeer(id, peer, peerBannedMsg);
        return false;
      }
      if (isFullForPeer(id)) {
        rejectPeer(id, peer, roomFullMsg);
        return false;
      }
      return true;
    },
    acquireAdmissionSlot: (id, peer) => {
      if (getDirectPeer(id, true) !== peer || isLeavingOrLeft()) return false;
      return tryAdmitPeer(id, peer);
    },
    beforeSendHandshakeReady: (id, peer) => getDirectPeer(id, true) === peer && !isPeerBanned(id) && stateMgr ? stateMgr.prepareHandshakeReady(id) : void 0,
    onActivate: (id, peer) => {
      if (isPeerBanned(id)) {
        reservedAdmissionUsers.delete(id);
        kickPeer(id, peer, peerBannedErr);
        return;
      }
      if (isFullForPeer(id)) {
        rejectPeer(id, peer, roomFullMsg);
        return;
      }
      const entry = peerEntries.get(id);
      reservedAdmissionUsers.delete(id);
      if (!entry || !isPendingDirectSession(entry.session) || entry.session.peer !== peer) return;
      const wasActive = entry.session.phase === "virtual-upgrading";
      const prevVirtual = entry.session.phase === "virtual-upgrading" ? entry.session.virtual : null;
      const uid = entry.userId ?? id;
      entry.userId = uid;
      delete entry.deferredReady;
      const isFirst = !wasActive && countActivePeersForUser(uid, id) === 0;
      entry.session = {
        phase: "direct-active",
        peer,
        transport: entry.session.transport
      };
      prevVirtual?.close?.();
      invalidateUsersSnapshot();
      scaleProvider?.addDirectPeer(id, peer);
      emitPeerActivated(id, peer);
      peer.setHandlers({ signal: (sdp) => {
        if (getDirectPeer(id, false) === peer) signalAction.send(sdp, { target: id }).catch(noOp2);
      } });
      if (!wasActive) {
        entry.emittedUserId = uid;
        emitActivatedEvents(id, uid, isFirst);
      } else {
        reconcileUserChangeOnActiveEntry(id, entry, uid);
        stateMgr?.onPeerJoined(id, uid, true);
      }
    },
    onFailure: (id, peer, reason) => {
      reservedAdmissionUsers.delete(id);
      if (reason === peerBannedErr) {
        rejectPeer(id, peer, peerBannedMsg);
        return;
      }
      kickPeer(id, peer, reason);
    }
  });
  let rolesApi;
  let scaleApi;
  let pluginSetupFailure = null;
  if (rolesSlot) try {
    const res = rolesSlot.setup(internalKernel, effectiveRoomIdP);
    rolesProvider = res.provider;
    rolesApi = res.api;
  } catch (err) {
    pluginSetupFailure = { error: err };
    failSetup({
      code: "plugin-failed",
      plugin: "roles",
      message: toErrorMessage(err, "roles setup failed"),
      cause: err
    });
  }
  if (scaleSlot && !pluginSetupFailure) try {
    const res = scaleSlot.setup(internalKernel);
    scaleProvider = res.provider;
    scaleApi = res.api;
  } catch (err) {
    pluginSetupFailure = { error: err };
    failSetup({
      code: "plugin-failed",
      plugin: "scale",
      message: toErrorMessage(err, "scale setup failed"),
      cause: err
    });
  }
  const roomReadyP = pluginSetupFailure ? Promise.reject(pluginSetupFailure.error) : all([
    localEndpointP,
    resolvedUserIdentityP,
    ...effectiveRoomIdP ? [effectiveRoomIdP] : []
  ]).then(noOp2);
  roomReadyP.catch(noOp2);
  if (scaleProvider && !pluginSetupFailure) ensureStateManager();
  const processHandshakeReady = (data, id) => {
    if (isLeavingOrLeft()) return;
    if (data && typeof data === "object" && data.ok === false) {
      if (!hs.getPeer(id) || isDirectPeer(id)) return;
      if (data.err === "room full") {
        hs.clearPeer(id, roomFullErr);
        emitRoomError({
          code: "room-full",
          peerId: id,
          message: roomFullMsg
        });
        exitPeer(id, getDirectPeer(id, true), roomFullErr);
        return;
      }
      if (data.err === "peer banned") {
        const reason = typeof data.reason === "string" && data.reason.length <= 512 ? data.reason : void 0;
        hs.clearPeer(id, peerBannedErr);
        emitRoomError(mkBannedErr(reason, id));
        kickPeer(id, getDirectPeer(id, true), peerBannedErr);
        return;
      }
    }
    hs.receiveReady(id);
  };
  signalAction.onMessage((sdp, { peerId: id }) => {
    getDirectPeer(id, false)?.signal(sdp);
  });
  streamMetaAction.onMessage((meta, { peerId: id }) => {
    mediaManager.receiveStreamMeta(meta, id);
  });
  leaveAction.onMessage((_, { peerId: id }) => exitPeer(id, void 0, peerLeftRoomErr));
  handshakeDataAction.onMessage((data, { peerId: id, metadata }) => {
    if (!isLeavingOrLeft()) hs.receiveData(data, id, metadata);
  });
  handshakeReadyAction.onMessage((data, { peerId: id }) => {
    if (isLeavingOrLeft()) return;
    const entry = peerEntries.get(id);
    if (!entry || !isEntryVerified(entry)) {
      if (entry && isPendingDirectSession(entry.session) && !entry.session.verified && hs.getPeer(id)) entry.deferredReady = data;
      return;
    }
    deliverHandshakeReady(data, id);
  });
  onPeer((peer, id) => {
    if (!canAcceptPeers()) {
      peer.destroy();
      return;
    }
    if (!canConnectPeer(id)) {
      peer.destroy();
      return;
    }
    const existing = peerEntries.get(id);
    if (existing) switch (existing.session.phase) {
      case "virtual-only":
        stateMgr?.clearPeer(id);
        break;
      case "direct-pending":
      case "virtual-upgrading": {
        const existingDirect = existing.session.peer;
        if (existingDirect === peer) return;
        const replacedErr = mkErr("peer replaced");
        existingDirect.destroy();
        clearPendingPeer(id, replacedErr);
        stateMgr?.clearPeer(id);
        const ex = peerEntries.get(id);
        if (ex && getDirectPeer(id, true) === existingDirect) resetDirectSessionOnEntry(id, ex);
        break;
      }
      case "direct-active": {
        const existingDirect = existing.session.peer;
        if (existingDirect === peer) return;
        const replacedErr = mkErr("peer replaced");
        existingDirect.destroy();
        clearPendingPeer(id, replacedErr);
        const [wasActive, isLast, uid] = removePeerEntry(id);
        clearSubsystems(id, replacedErr);
        emitDeactivatedEvents(id, wasActive, isLast, uid);
        scaleProvider?.removeDirectPeer(id, existingDirect, replacedErr);
        break;
      }
      default:
        unreachable(existing.session);
    }
    const transport = createDirectPeerTransport(peer, () => {
      const curSession = peerEntries.get(id)?.session;
      return Boolean(curSession && curSession.phase !== "virtual-only" && curSession.transport === transport);
    });
    const existingEntry = peerEntries.get(id);
    if (existingEntry?.session.phase === "virtual-only") {
      delete existingEntry.deferredReady;
      existingEntry.session = {
        phase: "virtual-upgrading",
        virtual: existingEntry.session.virtual,
        peer,
        transport,
        verified: false
      };
    } else peerEntries.set(id, { session: {
      phase: "direct-pending",
      peer,
      transport,
      verified: false
    } });
    hs.addPeer(id, peer);
    peer.setHandlers({
      data: (d) => {
        if (getDirectPeer(id, true) === peer && !isPeerBanned(id)) {
          if (!scaleProvider?.handleFrame(id, d)) handleData(id, d);
        }
      },
      stream: (stream) => {
        if (!isPeerBanned(id)) mediaManager.receiveRemoteStream(id, stream);
      },
      close: () => exitPeer(id, peer, peerDisconnectedErr),
      error: (err) => {
        logErr("peer", err);
        if (getDirectPeer(id, true) === peer) reportPeerError(id, err);
        exitPeer(id, peer, err);
      }
    });
    hs.start(id, peer);
  });
  if (isBrowser) unregisterBeforeUnloadCleanup = registerBeforeUnloadCleanup(() => {
    leave().catch(noOp2);
  });
  const roomInstance = {
    ready: roomReadyP,
    makeAction,
    makeState: ((namespace, initialValue, config) => ensureStateManager().makeState(namespace, initialValue, config)),
    makeUserState: ((namespace, initialValue, config) => ensureStateManager().makeUserState(namespace, initialValue, config)),
    leave,
    ping: async (target) => {
      const start = Date.now();
      await pingAction.request("", { target });
      return Date.now() - start;
    },
    getSelf: async () => {
      const [user, info] = await awaitSelfState();
      return {
        peerId: getLocalSelfId(),
        userId: user.userId,
        identityPersistence: user.persistence ?? "none",
        roomId: info?.roomId ?? effectiveRoomId,
        baseRoomId: info?.baseRoomId ?? initialRoomId,
        isAdmin: info?.isAdmin ?? false,
        roles: info?.roles ?? []
      };
    },
    getPeers: () => fromEntries(getPeerIds(false).map((id) => {
      const directPeer = getDirectPeer(id, false);
      const direct = Boolean(directPeer);
      return [id, {
        userId: getPeerUserId(id),
        connection: directPeer ? directPeer.connection : null,
        direct,
        hops: direct ? 1 : scaleProvider?.getRoute(id)?.hops ?? 2,
        roles: [...getPeerRoles(id)]
      }];
    })),
    getUsers: () => {
      if (cachedUsersSnapshot) return cachedUsersSnapshot;
      const localUid = getLocalUserId();
      const raw = {};
      for (const peerId of getPeerIds(false)) {
        const userId = getPeerUserId(peerId);
        if (localUid && userId === localUid) continue;
        (raw[userId] ??= {
          peerIds: [],
          roles: getPeerRoles(userId)
        }).peerIds.push(peerId);
      }
      const frozen = {};
      for (const [uid, info] of entries(raw)) frozen[uid] = Object.freeze({
        peerIds: Object.freeze(info.peerIds),
        roles: Object.isFrozen(info.roles) ? info.roles : Object.freeze([...info.roles])
      });
      cachedUsersSnapshot = Object.freeze(frozen);
      return cachedUsersSnapshot;
    },
    addStream: (stream, options = {}) => mediaManager.addStream(stream, options, streamMetaAction.send),
    removeStream: (stream, options = {}) => {
      mediaManager.removeStream(stream, options.target);
    },
    replaceTrack: (oldTrack, newTrack, options = {}) => mediaManager.replaceTrack(oldTrack, newTrack, options.target),
    ...rolesApi,
    ...scaleApi,
    onPeerJoin: (handler, options) => subPeerJoin(handler, options, () => getPeerIds(false).map((peerId) => [{
      peerId,
      userId: getPeerUserId(peerId),
      roles: [...getPeerRoles(peerId)]
    }])),
    onPeerLeave: subPeerLeave,
    onUserJoin: (handler, options) => subUserJoin(handler, options, () => {
      const localUid = getLocalUserId();
      const items = [];
      const seenUsers = /* @__PURE__ */ new Set();
      for (const peerId of getPeerIds(false)) {
        const userId = getPeerUserId(peerId);
        if ((!localUid || userId !== localUid) && !seenUsers.has(userId)) {
          seenUsers.add(userId);
          items.push([{
            userId,
            peerId,
            roles: [...getPeerRoles(peerId)]
          }]);
        }
      }
      return items;
    }),
    onUserLeave: subUserLeave,
    onPeerStream: mediaManager.onPeerStream,
    onError: subError
  };
  lockMethods(roomInstance, [
    "onPeerJoin",
    "onPeerLeave",
    "onUserJoin",
    "onUserLeave",
    "onPeerStream",
    "onError",
    ...rolesApi ? ["onRoleChange"] : []
  ]);
  return [roomInstance, {
    localEndpointP,
    effectiveRoomIdP,
    hasSetupFailed: () => didReportSetupError,
    getScaleProvider: () => scaleProvider,
    setOnScaleTargetsChanged: (cb) => {
      scaleProvider?.setOnTargetsChanged(cb);
    },
    canConnectPeer,
    emitError: (err) => {
      if (!isLeavingOrLeft()) emitError(err);
    }
  }];
};

// node_modules/@trystero-p2p/core/dist/strategy.mjs
var announceIntervalMs = 5333;
var announceWarmupIntervalsMs = [
  233,
  533,
  1333
];
var mergeDefaultConfig = (defaults, overrides) => {
  const merged = { ...defaults };
  for (const [k, v] of entries(overrides)) if (v !== void 0) merged[k] = v;
  return merged;
};
var getOrCreateAppMap = (map, appId) => {
  let appMap = map.get(appId);
  if (!appMap) {
    appMap = /* @__PURE__ */ new Map();
    map.set(appId, appMap);
  }
  return appMap;
};
var strategy_default = ({ defaultConfig, init, subscribe, announce }) => {
  const clientId = createIdentityClientId();
  const roomRegistry = /* @__PURE__ */ new Map();
  return ((config, roomId, ...extra) => {
    if (!config) throw mkErr("config map required");
    if (extra.length > 0 && extra[0] !== void 0) throw mkErr("joinRoom takes 2 arguments; register error listeners via room.onError(fn)");
    const effectiveConfig = defaultConfig ? mergeDefaultConfig(defaultConfig, config) : config;
    const { appId } = effectiveConfig;
    if (!appId) throw requiredErr("appId");
    if (!roomId) throw requiredErr("roomId");
    if (effectiveConfig.maxReceiveBytes !== void 0 && !isPosSafeInt(effectiveConfig.maxReceiveBytes)) throw posSafeIntErr("maxReceiveBytes");
    if (effectiveConfig.maxUsers !== void 0 && !isPosSafeInt(effectiveConfig.maxUsers)) throw posSafeIntErr("maxUsers");
    validateIdentityConfig(effectiveConfig);
    const existingSlot = roomRegistry.get(appId)?.get(roomId);
    if (existingSlot?.phase === "occupied") throw mkErr(`already joined room "${roomId}" for appId "${appId}"`);
    if (existingSlot?.phase === "leaving") existingSlot.finalizeCleanup();
    let roomState = { phase: "active" };
    let relayHealthState = "unconfirmed";
    let effectiveRoomId = roomId;
    let resolvedSelfId;
    let onPeerConnect = noOp2;
    let reannounceAfterDisconnect = noOp2;
    let stopRelays = noOp2;
    const isRoomInactive = () => roomState.phase !== "active";
    const peerStates = /* @__PURE__ */ new Map();
    const announceIntervals = [];
    const topicFor = (rid) => topicPath(libName, appId, rid);
    const deleteRegistrySlotMatching = (predicate) => {
      const appMap = roomRegistry.get(appId);
      if (!appMap) return;
      const initialSlot = appMap.get(roomId);
      if (initialSlot && predicate(initialSlot)) appMap.delete(roomId);
      if (effectiveRoomId !== roomId) {
        const effectiveSlot = appMap.get(effectiveRoomId);
        if (effectiveSlot && predicate(effectiveSlot)) appMap.delete(effectiveRoomId);
      }
      if (appMap.size === 0) roomRegistry.delete(appId);
    };
    const cleanupRoom = () => {
      if (roomState.phase === "left") return;
      roomState = {
        phase: "left",
        relaysStopped: false
      };
      onPeerConnect = noOp2;
      deleteRegistrySlotMatching((slot) => slot.phase === "occupied" && slot.room === joinedRoom || slot.phase === "leaving" && slot.finalizeCleanup === cleanupRoom);
      for (const state of peerStates.values()) {
        if (state.connectedPeer && !state.connectedPeer.isDead) state.connectedPeer.destroy();
        if (state.answeringPeer && !state.answeringPeer.isDead) state.answeringPeer.destroy();
        resetOfferState(state);
        resetAnsweringState(state);
        state.connection = { phase: "disconnected" };
      }
      peerStates.clear();
      stopRelays();
    };
    const cancelAllAnnounceTimers = (slots) => {
      for (const slot of slots) if (slot.announce.phase === "active") slot.announce.timer = resetTimer(slot.announce.timer);
    };
    let relaySlots = [];
    const [joinedRoom, bridge] = createRoomWithBridge((f) => {
      onPeerConnect = f;
    }, (id, shouldReannounce = true) => {
      if (roomState.phase === "left") return;
      const state = peerStates.get(id);
      if (state?.connectedPeer) detachConnectedPeer(state, state.connectedPeer);
      prunePeerStates(peerStates);
      if (shouldReannounce) reannounceAfterDisconnect();
    }, cleanupRoom, {
      clientId,
      appId,
      roomId,
      ...effectiveConfig.password === void 0 ? {} : { password: effectiveConfig.password },
      ...effectiveConfig.maxUsers === void 0 ? {} : { maxUsers: effectiveConfig.maxUsers },
      ...effectiveConfig.use === void 0 ? {} : { use: effectiveConfig.use },
      ...effectiveConfig.identity === void 0 ? {} : { identity: effectiveConfig.identity },
      ...effectiveConfig.maxReceiveBytes === void 0 ? {} : { maxReceiveBytes: effectiveConfig.maxReceiveBytes },
      onBeforeLeave: () => {
        if (roomState.phase === "active") roomState = { phase: "leaving-flush" };
        cancelAllAnnounceTimers(relaySlots);
        const appSlots = getOrCreateAppMap(roomRegistry, appId);
        const leavingSlot = {
          phase: "leaving",
          finalizeCleanup: cleanupRoom
        };
        const curInitial = appSlots.get(roomId);
        if (!curInitial || curInitial.phase !== "occupied" || curInitial.room === joinedRoom) appSlots.set(roomId, leavingSlot);
        if (effectiveRoomId !== roomId) {
          const curEffective = appSlots.get(effectiveRoomId);
          if (!curEffective || curEffective.phase !== "occupied" || curEffective.room === joinedRoom) appSlots.set(effectiveRoomId, leavingSlot);
        }
      }
    });
    try {
      const selfIdP = bridge.localEndpointP.then((ep) => ep.peerId);
      selfIdP.catch(noOp2);
      const emitError = (error) => {
        if (roomState.phase !== "left") bridge.emitError(error);
      };
      const strategyContext = {
        config: effectiveConfig,
        appId,
        roomId,
        peerId: ""
      };
      const effectiveRoomIdP = bridge.effectiveRoomIdP?.then((rid) => {
        effectiveRoomId = rid;
        strategyContext.roomId = rid;
        if (rid !== roomId && roomState.phase === "active") {
          const appSlots = getOrCreateAppMap(roomRegistry, appId);
          const existingEffective = appSlots.get(rid);
          if (existingEffective?.phase === "leaving") existingEffective.finalizeCleanup();
          if (!appSlots.has(rid)) appSlots.set(rid, {
            phase: "occupied",
            room: joinedRoom
          });
        }
        return rid;
      });
      effectiveRoomIdP?.catch(noOp2);
      const whenRoomId = (fn) => {
        const p = effectiveRoomIdP ? effectiveRoomIdP.then(fn) : fn(roomId);
        p.catch(noOp2);
        return p;
      };
      const rootTopicP = whenRoomId((rid) => hashTopic(topicFor(rid)));
      const selfTopicP = all([effectiveRoomIdP ?? Promise.resolve(roomId), selfIdP]).then(([rid, peerId]) => {
        resolvedSelfId = peerId;
        strategyContext.peerId = peerId;
        return hashTopic(topicPath(topicFor(rid), peerId));
      });
      selfTopicP.catch(noOp2);
      const key = whenRoomId((rid) => genKey(effectiveConfig.password ?? "", appId, rid));
      const withKey = (f) => async (signal, peerId, offerId) => ({
        type: signal.type,
        sdp: await f(key, signal.sdp, buildSignalAad(signal.type, peerId, offerId))
      });
      const toPlain = withKey(decrypt);
      const toCipher = withKey(encrypt);
      let disconnectReannounceEnabled = false;
      let disconnectReannounceQueued = false;
      const { checkout: checkoutOffers, getOffers, claimLeased: claimLeasedOffer, reclaimLeased: reclaimLeasedOffer, destroy: destroyOffers } = createOfferManager(() => peer_default(true, effectiveConfig));
      const encryptOffer = async (peer, peerId, offerId) => {
        const plainOffer = await peer.getOffer();
        if (!plainOffer || plainOffer.type !== "offer") throw mkErr("failed to get offer for peer");
        return (await toCipher(plainOffer, peerId, offerId)).sdp;
      };
      const connectPeer = (peer, peerId) => {
        if (isRoomInactive()) {
          peer.destroy();
          return;
        }
        const state = getState(peerStates, peerId);
        if (state.connectedPeer && state.connectedPeer !== peer) {
          if (getConnectedPeerHealth(state.connectedPeer) !== "stale") {
            peer.destroy();
            return;
          }
          clearConnectedPeer(state);
        }
        markPeerConnected(state, peer);
        onPeerConnect(peer, peerId);
        resetOfferState(state);
        if (peer.isDead && state.connectedPeer === peer) {
          detachConnectedPeer(state, peer);
          prunePeerStates(peerStates);
        }
      };
      const isPassive = Boolean(effectiveConfig.passive);
      let syncOverlayNeighbors = noOp2;
      let requeueAnnounce = noOp2;
      reannounceAfterDisconnect = () => {
        syncOverlayNeighbors();
        if (isPassive || !disconnectReannounceEnabled || disconnectReannounceQueued) return;
        disconnectReannounceQueued = true;
        queueMicrotask(() => {
          disconnectReannounceQueued = false;
          if (roomState.phase === "active") requeueAnnounce();
        });
      };
      const disconnectPeer = (peer, peerId) => {
        if (roomState.phase === "left") return;
        const state = peerStates.get(peerId);
        if (state?.connectedPeer === peer) {
          clearConnectedPeer(state);
          prunePeerStates(peerStates);
          reannounceAfterDisconnect();
        }
      };
      const { handleMessage, dialPeer } = createSignalHandler({
        appId,
        getRoomId: () => effectiveRoomId,
        config: effectiveConfig,
        peerStates,
        getRootTopicPlaintext: () => topicFor(effectiveRoomId),
        rootTopicP,
        selfTopicP,
        toPlain,
        toCipher,
        isLeaving: isRoomInactive,
        onError: emitError,
        checkoutOffers,
        claimLeasedOffer,
        reclaimLeasedOffer,
        encryptOffer,
        initPeer: peer_default,
        connectPeer,
        disconnectPeer,
        announceIntervals,
        announceIntervalMs,
        getSelfIdNow: () => resolvedSelfId,
        selfIdP,
        onPeerDiscovered: (peerId) => {
          if (bridge.canConnectPeer(peerId) && bridge.getScaleProvider()?.notePeerDiscovered(peerId)) syncOverlayNeighbors();
        },
        shouldConnectPeer: (peerId, direction) => bridge.canConnectPeer(peerId) && (bridge.getScaleProvider()?.shouldConnectPeer(peerId, direction) ?? true)
      });
      syncOverlayNeighbors = () => {
        const scaleProvider = bridge.getScaleProvider();
        if (isRoomInactive() || isPassive || !scaleProvider) return;
        for (const targetId of scaleProvider.getTargetNeighbors()) dialPeer(targetId);
      };
      const initRes = init(effectiveConfig);
      relaySlots = (Array.isArray(initRes) ? initRes : [initRes]).map((rawItem) => {
        const relayP = Promise.resolve(rawItem);
        relayP.catch(noOp2);
        return {
          rawItem,
          relayP,
          leaseReleased: false,
          subscription: { phase: "booting" },
          announce: { phase: "waiting" },
          gen: 0,
          intervalMs: announceIntervalMs,
          attempts: 0,
          errors: 0,
          initial: "pending"
        };
      });
      const releaseSlotLease = (slot) => {
        if (!slot.leaseReleased) {
          slot.leaseReleased = true;
          releaseRelayLease(slot.rawItem);
        }
      };
      stopRelays = () => {
        if (roomState.phase === "left" && roomState.relaysStopped) return;
        roomState = {
          phase: "left",
          relaysStopped: true
        };
        cancelAllAnnounceTimers(relaySlots);
        for (const slot of relaySlots) {
          const prevSub = slot.subscription;
          slot.subscription = { phase: "closed" };
          slot.gen += 1;
          slot.announce = { phase: "closed" };
          if (prevSub.phase === "subscribed") prevSub.unsub();
          if (prevSub.phase !== "subscribing") releaseSlotLease(slot);
        }
        destroyOffers();
      };
      const totalRelays = relaySlots.length;
      const reportAllRelaysFailed = (cause) => {
        if (relayHealthState === "error-reported" || bridge.hasSetupFailed() || isRoomInactive()) return;
        relayHealthState = "error-reported";
        queueMicrotask(() => {
          if (!isRoomInactive() && !bridge.hasSetupFailed()) emitError({
            code: "relay-failed",
            message: toErrorMessage(cause, "all signaling relays failed"),
            appId,
            roomId: effectiveRoomId,
            ...cause !== void 0 ? { cause } : {}
          });
        });
      };
      const maybeReportAllBootFailed = (err) => {
        if (relayHealthState === "unconfirmed" && totalRelays > 0 && relaySlots.every((s) => s.subscription.phase === "boot-failed")) reportAllRelaysFailed(err);
      };
      const markRelayBootFailed = (slot, err) => {
        switch (slot.subscription.phase) {
          case "booting":
          case "subscribing":
            slot.subscription = { phase: "boot-failed" };
            maybeReportAllBootFailed(err);
            return;
          case "subscribed":
          case "closed":
          case "boot-failed":
            return;
          default:
            unreachable(slot.subscription);
        }
      };
      relaySlots.forEach((slot) => {
        const getInitialFailure = slot.relayP[socketInitialFailureSymbol];
        if (typeof getInitialFailure === "function") getInitialFailure().then((err) => {
          if (err) markRelayBootFailed(slot, err);
        });
      });
      const unsubFns = relaySlots.map(async (slot, i) => {
        let rootTopic;
        let selfTopic;
        try {
          [rootTopic, selfTopic] = await all([rootTopicP, selfTopicP]);
        } catch {
          slot.subscription = { phase: "closed" };
          releaseSlotLease(slot);
          return noOp2;
        }
        if (isRoomInactive()) {
          slot.subscription = { phase: "closed" };
          releaseSlotLease(slot);
          return noOp2;
        }
        let relay;
        try {
          relay = await slot.relayP;
        } catch (err) {
          markRelayBootFailed(slot, err);
          releaseSlotLease(slot);
          return noOp2;
        }
        if (isRoomInactive()) {
          slot.subscription = { phase: "closed" };
          releaseSlotLease(slot);
          return noOp2;
        }
        slot.subscription = { phase: "subscribing" };
        try {
          const unsub = await subscribe(relay, rootTopic, selfTopic, handleMessage(i), (n) => selfIdP.then((sid) => getOffers(n, (peer, offerId) => encryptOffer(peer, sid, offerId))), strategyContext);
          const isClosedAfterAwait = (s) => s.subscription.phase === "closed";
          if (isRoomInactive() || isClosedAfterAwait(slot)) {
            unsub();
            slot.subscription = { phase: "closed" };
            releaseSlotLease(slot);
            return noOp2;
          }
          slot.subscription = {
            phase: "subscribed",
            unsub
          };
          if (relayHealthState === "unconfirmed") relayHealthState = "healthy";
          return unsub;
        } catch (err) {
          slot.subscription = { phase: "boot-failed" };
          releaseSlotLease(slot);
          maybeReportAllBootFailed(err);
          return noOp2;
        }
      });
      if (!isPassive) all([rootTopicP, selfTopicP]).then(([rootTopic, selfTopic]) => {
        if (isRoomInactive()) return;
        const isSlotActive = (slot, gen) => !isRoomInactive() && slot.announce.phase === "active" && slot.gen === gen;
        const queueAnnounce = async (relay, slot, i, gen) => {
          if (!isSlotActive(slot, gen)) return;
          let announceResult = void 0;
          const isInitial = slot.initial === "pending";
          try {
            announceResult = await announce(relay, rootTopic, selfTopic, strategyContext);
            slot.errors = 0;
            if (isInitial) slot.initial = "succeeded";
          } catch (error) {
            if (isRoomInactive() || slot.announce.phase === "closed") return;
            if (slot.errors === 0 && effectiveConfig.relayConfig?.warnOnRelayFailure !== false) warn(`announce failed - ${toErrorMessage(error, "")}`);
            slot.errors += 1;
            if (isInitial) {
              slot.initial = "failed";
              const anyInitialSucceeded = relaySlots.some((s) => s.initial === "succeeded");
              const allSettledOrBootFailed = totalRelays > 0 && relaySlots.every((s) => s.subscription.phase === "boot-failed" || s.announce.phase !== "waiting" && s.initial !== "pending");
              if (!anyInitialSucceeded && allSettledOrBootFailed) reportAllRelaysFailed(error);
            }
          }
          if (!isSlotActive(slot, gen)) return;
          if (typeof announceResult === "number") {
            announceIntervals[i] = announceResult;
            slot.intervalMs = announceResult;
          } else if (typeof announceResult === "object" && announceResult !== null) {
            if ("stopAnnouncing" in announceResult) {
              slot.announce = { phase: "closed" };
              return;
            }
            slot.intervalMs = announceResult.nextAnnounceMs;
            disconnectReannounceEnabled ||= announceResult.reannounceOnDisconnect === true;
          }
          const attempt = slot.attempts++;
          const warmupDelay = announceWarmupIntervalsMs[attempt] ?? (attempt === 3 && typeof announceResult === "object" ? announceIntervalMs : void 0);
          const delayMs = typeof warmupDelay === "number" ? Math.min(slot.intervalMs, warmupDelay) : slot.intervalMs;
          const timer = setTimeout(() => {
            if (slot.announce.phase === "active" && slot.announce.timer === timer) slot.announce.timer = null;
            queueAnnounce(relay, slot, i, gen);
          }, delayMs);
          unrefTimer(timer);
          if (slot.announce.phase === "active") slot.announce.timer = timer;
          else clearTimeout(timer);
        };
        requeueAnnounce = () => {
          cancelAllAnnounceTimers(relaySlots);
          relaySlots.forEach((slot, i) => {
            if (slot.subscription.phase !== "subscribed" || slot.announce.phase === "closed") return;
            const nextGen = ++slot.gen;
            slot.attempts = 0;
            slot.announce = {
              phase: "active",
              timer: null
            };
            slot.relayP.then((relay) => {
              if (relay && isSlotActive(slot, nextGen)) queueAnnounce(relay, slot, i, nextGen);
            }, noOp2);
          });
        };
        unsubFns.forEach((didSub, i) => {
          const slot = relaySlots[i];
          if (!slot) return;
          didSub.then((cleanup) => {
            if (isRoomInactive() || cleanup === noOp2 || slot.announce.phase !== "waiting") return;
            const { gen } = slot;
            slot.announce = {
              phase: "active",
              timer: null
            };
            slot.relayP.then((relay) => {
              if (relay && isSlotActive(slot, gen)) queueAnnounce(relay, slot, i, gen);
            }, noOp2);
          }, noOp2);
        });
      }, noOp2);
      bridge.setOnScaleTargetsChanged((targetIds) => {
        if (!isRoomInactive() && !isPassive) for (const targetId of targetIds) dialPeer(targetId);
      });
      getOrCreateAppMap(roomRegistry, appId).set(roomId, {
        phase: "occupied",
        room: joinedRoom
      });
      return joinedRoom;
    } catch (err) {
      roomState = {
        phase: "left",
        relaysStopped: false
      };
      stopRelays();
      joinedRoom.leave().catch(noOp2);
      throw err;
    }
  });
};

// node_modules/@trystero-p2p/core/dist/topic-strategy.mjs
var defaultSteadyAnnounceIntervalMs = 6e4;
var makeTopicContext = (context, kind, rootTopic, selfTopic) => ({
  kind,
  appId: context.appId,
  roomId: context.roomId,
  rootTopic,
  selfTopic,
  peerId: context.peerId
});
var topic_strategy_default = ({ defaultConfig, steadyAnnounceIntervalMs: steadyAnnounceIntervalMs2 = defaultSteadyAnnounceIntervalMs, reannounceOnDisconnect = true, init, subscribeTopic, publishTopic }) => strategy_default({
  ...defaultConfig === void 0 ? {} : { defaultConfig },
  init,
  subscribe: async (relay, rootTopic, selfTopic, onMessage, _getOffers, context) => {
    let closed = false;
    const signalPeer = (peerTopic, signal) => {
      if (closed) return;
      try {
        Promise.resolve(publishTopic(relay, peerTopic, signal, makeTopicContext(context, "signal", rootTopic, selfTopic))).catch(noOp2);
      } catch {
      }
    };
    const forwardMessage = (topic, msg) => {
      if (!closed) return onMessage(topic, msg, signalPeer);
    };
    const selfCleanup = await subscribeTopic(relay, selfTopic, forwardMessage, makeTopicContext(context, "self", rootTopic, selfTopic));
    let rootCleanup;
    try {
      rootCleanup = await subscribeTopic(relay, rootTopic, forwardMessage, makeTopicContext(context, "root", rootTopic, selfTopic));
    } catch (err) {
      closed = true;
      selfCleanup();
      throw err;
    }
    return () => {
      if (closed) return;
      closed = true;
      selfCleanup();
      rootCleanup();
    };
  },
  announce: async (relay, rootTopic, selfTopic, context) => {
    const result = await publishTopic(relay, rootTopic, { peerId: context.peerId }, makeTopicContext(context, "announce", rootTopic, selfTopic));
    if (typeof result === "number") return result;
    if (typeof result === "object" && result !== null) {
      if ("stopAnnouncing" in result) return result;
      return {
        nextAnnounceMs: result.nextAnnounceMs ?? steadyAnnounceIntervalMs2,
        reannounceOnDisconnect: result.reannounceOnDisconnect ?? reannounceOnDisconnect
      };
    }
    return {
      nextAnnounceMs: steadyAnnounceIntervalMs2,
      reannounceOnDisconnect
    };
  }
});

// node_modules/@noble/secp256k1/index.js
/*! noble-secp256k1 - MIT License (c) 2019 Paul Miller (paulmillr.com) */
var freeze = Object.freeze;
var P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
var N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
var Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
var Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
var secp256k1_CURVE = freeze({
  p: P,
  n: N,
  h: 1n,
  a: 0n,
  b: 7n,
  Gx,
  Gy
});
var L = 32;
var isBytes = (a) => {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && a.BYTES_PER_ELEMENT === 1;
};
var abytes = (value, length, title = "") => {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = (title ? `"${title}" ` : "") + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
};
var cloneBytes = (value) => Uint8Array.from(value);
var snapshotBytes = (value, title, length) => cloneBytes(abytes(value, length, title));
var padh = (n, pad) => n.toString(16).padStart(pad, "0");
var bytesToHex = (bytes) => {
  let hex = "";
  for (const byte of abytes(bytes))
    hex += padh(byte, 2);
  return hex;
};
var hexToBytes = (hex) => {
  const e = "hex invalid";
  if (typeof hex !== "string")
    throw new TypeError(e);
  if (hex.length % 2 || !/^[\da-f]*$/i.test(hex))
    throw new RangeError(e);
  const array = new Uint8Array(hex.length / 2);
  for (let ai = 0, hi = 0; ai < array.length; ai++, hi += 2) {
    const n1 = hex.charCodeAt(hi);
    const n2 = hex.charCodeAt(hi + 1);
    array[ai] = ((n1 & 15) + (n1 >> 6) * 9) * 16 + (n2 & 15) + (n2 >> 6) * 9;
  }
  return array;
};
var subtle = () => {
  const s = globalThis?.crypto?.subtle;
  if (s)
    return s;
  throw new Error("crypto.subtle must be defined, consider polyfill");
};
var concatBytes = (...arrays) => {
  let sum = 0;
  for (const a of arrays)
    sum += abytes(a).length;
  const res = new Uint8Array(sum);
  let pad = 0;
  for (const a of arrays) {
    res.set(a, pad);
    pad += a.length;
  }
  return res;
};
var randomBytes = (len = L) => {
  const c = globalThis?.crypto;
  if (typeof c?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined, consider polyfill");
  return c.getRandomValues(new Uint8Array(len));
};
var big = BigInt;
var arange = (n, min2, max, msg = "bad number: out of range") => {
  if (typeof n !== "bigint")
    throw new TypeError(msg);
  if (min2 <= n && n < max)
    return n;
  throw new RangeError(msg);
};
var M = (a, b = P) => (a %= b) >= 0n ? a : b + a;
var modN = (a) => M(a, N);
var invert = (number, modulo) => {
  if (number === 0n)
    throw new Error("invert: expected non-zero number");
  if (modulo <= 1n)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = M(number, modulo);
  let b = modulo;
  let x = 0n, u = 1n;
  while (a !== 0n) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== 1n)
    throw new Error("invert: does not exist");
  return M(x, modulo);
};
var _hash = (name) => {
  const fn = hashes[name];
  if (typeof fn !== "function")
    throw new Error("hashes." + name + " not set");
  return fn;
};
var callHash = (name, a, b) => abytes(_hash(name)(a, b), L, "digest");
var callHashAsync = async (name, a, b) => abytes(await _hash(name)(a, b), L, "digest");
var apoint = (p) => {
  if (p instanceof Point)
    return p;
  throw new TypeError("Point expected");
};
var E_BADPOINT = "bad point: not on curve";
var koblitz = (x) => M(M(x * x) * x + 7n);
var FpIsValid = (n) => arange(n, 0n, P);
var FpIsValidNot0 = (n) => arange(n, 1n, P);
var FnIsValidNot0 = (n) => arange(n, 1n, N);
var isEven = (y) => !(y & 1n);
var getPrefix = (y) => Uint8Array.of(isEven(y) ? 2 : 3);
var lift_x = (x) => {
  const c = koblitz(FpIsValidNot0(x));
  let r = 1n;
  for (let num = c, e = (P + 1n) / 4n; e > 0n; e >>= 1n) {
    if (e & 1n)
      r = r * num % P;
    num = num * num % P;
  }
  if (M(r * r) !== c)
    throw new Error("sqrt invalid");
  return new Point(x, isEven(r) ? r : M(-r), 1n);
};
var Point = class _Point {
  static BASE;
  static ZERO;
  X;
  Y;
  Z;
  constructor(X, Y, Z) {
    this.X = FpIsValid(X);
    this.Y = FpIsValidNot0(Y);
    this.Z = FpIsValid(Z);
    freeze(this);
  }
  /** Returns the shared curve metadata object by reference.
   * It is readonly only at type level, and mutating it won't retarget arithmetic,
   * which already uses module-load snapshots. */
  static CURVE() {
    return secp256k1_CURVE;
  }
  /** Create 3d xyz point from 2d xy. (0, 0) => (0, 1, 0), not (0, 0, 1) */
  static fromAffine(ap) {
    const { x, y } = ap;
    return x === 0n && y === 0n ? I : new _Point(x, y, 1n);
  }
  /** Convert Uint8Array or hex string to Point. */
  static fromBytes(bytes) {
    abytes(bytes);
    const length = bytes.length;
    const head = bytes[0];
    const x = sliceBytesNumBE(bytes, 1, 33);
    try {
      if (length === 33 && (head === 2 || head === 3)) {
        const p = lift_x(x);
        return head === 3 ? p.negate() : p;
      }
      if (length === 65 && head === 4)
        return new _Point(x, sliceBytesNumBE(bytes, 33, 65), 1n).assertValidity();
    } catch (error) {
      throw new Error(E_BADPOINT);
    }
    throw new Error(E_BADPOINT);
  }
  static fromHex(hex) {
    return _Point.fromBytes(hexToBytes(hex));
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  /** Equality check: compare points P&Q. */
  equals(other) {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
    return M(X1 * Z2) === M(X2 * Z1) && M(Y1 * Z2) === M(Y2 * Z1);
  }
  is0() {
    return this.Z === 0n;
  }
  /** Flip point over y coordinate. */
  negate() {
    return new _Point(this.X, M(-this.Y), this.Z);
  }
  /** Point doubling: P+P, complete formula. */
  double() {
    return this.add(this);
  }
  /**
   * Point addition: P+Q, complete, exception-free formula
   * (Renes-Costello-Batina, algo 1 of [2015/1060](https://eprint.iacr.org/2015/1060)).
   * Cost: `12M + 0S + 3*a + 3*b3 + 23add`.
   */
  // prettier-ignore
  add(other) {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
    const a = 0n;
    const b = 7n;
    let X3 = 0n, Y3 = 0n, Z3 = 0n;
    const b3 = M(b * 3n);
    let t0 = M(X1 * X2), t1 = M(Y1 * Y2), t2 = M(Z1 * Z2), t3 = M(X1 + Y1);
    let t4 = M(X2 + Y2);
    t3 = M(t3 * t4);
    t4 = M(t0 + t1);
    t3 = M(t3 - t4);
    t4 = M(X1 + Z1);
    let t5 = M(X2 + Z2);
    t4 = M(t4 * t5);
    t5 = M(t0 + t2);
    t4 = M(t4 - t5);
    t5 = M(Y1 + Z1);
    X3 = M(Y2 + Z2);
    t5 = M(t5 * X3);
    X3 = M(t1 + t2);
    t5 = M(t5 - X3);
    Z3 = M(a * t4);
    X3 = M(b3 * t2);
    Z3 = M(X3 + Z3);
    X3 = M(t1 - Z3);
    Z3 = M(t1 + Z3);
    Y3 = M(X3 * Z3);
    t1 = M(t0 + t0);
    t1 = M(t1 + t0);
    t2 = M(a * t2);
    t4 = M(b3 * t4);
    t1 = M(t1 + t2);
    t2 = M(t0 - t2);
    t2 = M(a * t2);
    t4 = M(t4 + t2);
    t0 = M(t1 * t4);
    Y3 = M(Y3 + t0);
    t0 = M(t5 * t4);
    X3 = M(t3 * X3);
    X3 = M(X3 - t0);
    t0 = M(t3 * t1);
    Z3 = M(t5 * Z3);
    Z3 = M(Z3 + t0);
    return new _Point(X3, Y3, Z3);
  }
  subtract(other) {
    return this.add(apoint(other).negate());
  }
  /**
   * Point-by-scalar multiplication. Scalar must be in range 1 <= n < CURVE.n.
   * Uses {@link wNAF} for base point.
   * Uses fake point to mitigate leakage shape in JS, not as a hard constant-time guarantee.
   * @param n scalar by which point is multiplied
   * @param safe safe mode guards against timing attacks; unsafe mode is faster
   */
  multiply(n, safe = true) {
    if (!safe && n === 0n)
      return I;
    FnIsValidNot0(n);
    if (n === 1n)
      return this;
    if (this.equals(G))
      return wNAF(n).p;
    let p = I;
    let f = G;
    let d = this;
    for (let i = 0; safe ? i < 256 : n > 0n; i++) {
      if (n & 1n)
        p = p.add(d);
      else if (safe)
        f = f.add(d);
      d = d.double();
      n >>= 1n;
    }
    return p;
  }
  multiplyUnsafe(scalar) {
    return this.multiply(scalar, false);
  }
  /** Convert point to 2d xy affine point. (X, Y, Z) ∋ (x=X/Z, y=Y/Z) */
  toAffine() {
    const { X: x, Y: y, Z: z } = this;
    if (z === 0n)
      return { x: 0n, y: 0n };
    if (z === 1n)
      return { x, y };
    const iz = invert(z, P);
    if (M(z * iz) !== 1n)
      throw new Error("inverse invalid");
    return { x: M(x * iz), y: M(y * iz) };
  }
  /** Checks if the point is valid and on-curve. */
  assertValidity() {
    const { x, y } = this.toAffine();
    FpIsValidNot0(x);
    FpIsValidNot0(y);
    if (M(y * y) !== koblitz(x))
      throw new Error(E_BADPOINT);
    return this;
  }
  /** Converts point to 33/65-byte Uint8Array. */
  toBytes(isCompressed = true) {
    const { x, y } = this.assertValidity().toAffine();
    const x32b = numTo32b(x);
    if (isCompressed)
      return concatBytes(getPrefix(y), x32b);
    return concatBytes(Uint8Array.of(4), x32b, numTo32b(y));
  }
  toHex(isCompressed) {
    return bytesToHex(this.toBytes(isCompressed));
  }
};
var G = new Point(Gx, Gy, 1n);
var I = new Point(0n, 1n, 0n);
Point.BASE = G;
Point.ZERO = I;
var doubleScalarMulUns = (R, u1, u2) => {
  return G.multiply(u1, false).add(R.multiply(u2, false)).assertValidity();
};
var bytesToNumBE = (b) => big("0x" + (bytesToHex(b) || "0"));
var sliceBytesNumBE = (b, from, to) => bytesToNumBE(b.subarray(from, to));
var numTo32b = (num) => hexToBytes(padh(arange(num, 0n, 2n ** 256n), L * 2));
var secretKeyToScalar = (secretKey) => {
  const num = bytesToNumBE(abytes(secretKey, L, "secret key"));
  return arange(num, 1n, N, "invalid secret key: outside of range");
};
var _sha = "SHA-256";
var hashes = {
  hmacSha256Async: async (key, message) => {
    const s = subtle();
    const k = await s.importKey("raw", key, { name: "HMAC", hash: _sha }, false, ["sign"]);
    return new Uint8Array(await s.sign("HMAC", k, message));
  },
  hmacSha256: void 0,
  sha256Async: async (msg) => new Uint8Array(await subtle().digest(_sha, msg)),
  sha256: void 0
};
var randomSecretKey = (seed) => {
  seed = seed === void 0 ? randomBytes(48) : seed;
  abytes(seed);
  if (seed.length < 48 || seed.length > 1024)
    throw new RangeError("expected 48-1024b");
  const num = M(bytesToNumBE(seed), N - 1n);
  return numTo32b(num + 1n);
};
var createKeygen = (getPublicKey) => (seed) => {
  const secretKey = randomSecretKey(seed);
  return { secretKey, publicKey: getPublicKey(secretKey) };
};
var getTag = (tag) => Uint8Array.from("BIP0340/" + tag, (c) => c.charCodeAt(0));
var taggedHash = (tag, ...messages) => {
  const tagH = callHash("sha256", getTag(tag));
  return callHash("sha256", concatBytes(tagH, tagH, ...messages));
};
var taggedHashAsync = (tag, ...messages) => callHashAsync("sha256Async", getTag(tag)).then((tagH) => callHashAsync("sha256Async", concatBytes(tagH, tagH, ...messages)));
var extpubSchnorr = (priv) => {
  const d_ = secretKeyToScalar(priv);
  const p = G.multiply(d_);
  const { x, y } = p.assertValidity().toAffine();
  const d = isEven(y) ? d_ : modN(-d_);
  const px = numTo32b(x);
  return { d, px };
};
var bytesModN = (bytes) => modN(bytesToNumBE(bytes));
var challenge = (...args) => bytesModN(taggedHash("challenge", ...args));
var challengeAsync = async (...args) => bytesModN(await taggedHashAsync("challenge", ...args));
var pubSchnorr = (secretKey) => {
  return extpubSchnorr(secretKey).px;
};
var keygenSchnorr = /* @__PURE__ */ createKeygen(pubSchnorr);
var prepSigSchnorr = (message, secretKey, auxRand) => {
  const m = snapshotBytes(message, "message");
  const { px, d } = extpubSchnorr(secretKey);
  return { m, px, d, a: abytes(auxRand, L) };
};
var extractK = (rand) => {
  const k_ = bytesModN(rand);
  if (k_ === 0n)
    throw new Error("sign failed: k is zero");
  const { px, d } = extpubSchnorr(numTo32b(k_));
  return { rx: px, k: d };
};
var createSigSchnorr = (k, px, e, d) => {
  return concatBytes(px, numTo32b(modN(k + e * d)));
};
var E_INVSIG = "invalid signature produced";
var signSchnorr = (message, secretKey, auxRand = randomBytes(L)) => {
  const { m, px, d, a } = prepSigSchnorr(message, secretKey, auxRand);
  const t = numTo32b(d ^ bytesToNumBE(taggedHash("aux", a)));
  const { rx, k } = extractK(taggedHash("nonce", t, px, m));
  const sig = createSigSchnorr(k, rx, challenge(rx, px, m), d);
  if (!verifySchnorr(sig, m, px))
    throw new Error(E_INVSIG);
  return sig;
};
var signSchnorrAsync = async (message, secretKey, auxRand = randomBytes(L)) => {
  const { m, px, d, a } = prepSigSchnorr(message, secretKey, auxRand);
  const t = numTo32b(d ^ bytesToNumBE(await taggedHashAsync("aux", a)));
  const { rx, k } = extractK(await taggedHashAsync("nonce", t, px, m));
  const sig = createSigSchnorr(k, rx, await challengeAsync(rx, px, m), d);
  if (!await verifySchnorrAsync(sig, m, px))
    throw new Error(E_INVSIG);
  return sig;
};
var callSyncAsyncFn = (res, later) => {
  return res instanceof Promise ? res.then(later) : later(res);
};
var _verifSchnorr = (signature, message, publicKey, challengeFn) => {
  const sig = abytes(signature, 64, "signature");
  const msg = abytes(message, void 0, "message");
  const pub = abytes(publicKey, L, "publicKey");
  let P_;
  let r;
  let s;
  let chalInput;
  try {
    const x = bytesToNumBE(pub);
    P_ = lift_x(x);
    r = FpIsValidNot0(sliceBytesNumBE(sig, 0, L));
    s = FnIsValidNot0(sliceBytesNumBE(sig, L, 64));
    chalInput = concatBytes(numTo32b(r), pub, msg);
  } catch (error) {
    return false;
  }
  return callSyncAsyncFn(challengeFn(chalInput), (e) => {
    try {
      const { x, y } = doubleScalarMulUns(P_, s, modN(-e)).toAffine();
      if (!isEven(y) || x !== r)
        return false;
      return true;
    } catch (error) {
      return false;
    }
  });
};
var verifySchnorr = (s, m, p) => _verifSchnorr(s, m, p, challenge);
var verifySchnorrAsync = async (s, m, p) => _verifSchnorr(s, m, p, challengeAsync);
var schnorr = /* @__PURE__ */ freeze({
  keygen: keygenSchnorr,
  getPublicKey: pubSchnorr,
  sign: signSchnorr,
  verify: verifySchnorr,
  signAsync: signSchnorrAsync,
  verifyAsync: verifySchnorrAsync
});
var precompute = () => {
  const points = [];
  let p = G;
  let b = p;
  for (let w = 0; w < 33; w++) {
    b = p;
    points.push(b);
    for (let i = 1; i < 128; i++) {
      b = b.add(p);
      points.push(b);
    }
    p = b.double();
  }
  return points;
};
var Gpows = void 0;
var ctneg = (cnd, p) => {
  const n = p.negate();
  return cnd ? n : p;
};
var wNAF = (n) => {
  const comp = Gpows || (Gpows = precompute());
  let p = I;
  let f = G;
  for (let w = 0; w < 33; w++) {
    let wbits = Number(n & 255n);
    n >>= 8n;
    if (wbits > 128) {
      wbits -= 256;
      n += 1n;
    }
    const off = w * 128;
    const offP = off + Math.abs(wbits) - 1;
    const isOddW = w % 2 !== 0;
    const isNeg = wbits < 0;
    if (wbits === 0) {
      f = f.add(ctneg(isOddW, comp[off]));
    } else {
      p = p.add(ctneg(isNeg, comp[offP]));
    }
  }
  if (n !== 0n)
    throw new Error("invalid wnaf");
  return { p, f };
};

// node_modules/@trystero-p2p/nostr/dist/protocol.mjs
var eventMsgType = "EVENT";
var subscribeClockSkewSeconds = 60;
var nativeToHex = Uint8Array.prototype.toHex;
var toHex = typeof nativeToHex === "function" ? (bytes) => nativeToHex.call(bytes) : (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
var now = () => Math.floor(Date.now() / 1e3);
var subscribeSince = () => Math.max(0, now() - subscribeClockSkewSeconds);
var createSigner = () => {
  const { secretKey, publicKey } = schnorr.keygen();
  return {
    secretKey,
    pubkey: toHex(publicKey)
  };
};
var topicToKind = (topic) => {
  let h = 2166136261;
  for (let i = 0; i < topic.length; i++) h = Math.imul(h ^ topic.charCodeAt(i), 16777619);
  return (h >>> 0) % 1e4 + 2e4;
};
var createEvent = async (topic, content, signer) => {
  const payload = {
    kind: topicToKind(topic),
    tags: [["x", topic]],
    created_at: now(),
    content,
    pubkey: signer.pubkey
  };
  const id = new Uint8Array(await crypto.subtle.digest("SHA-256", encodeBytes(toJson([
    0,
    payload.pubkey,
    payload.created_at,
    payload.kind,
    payload.tags,
    payload.content
  ]))));
  return toJson([eventMsgType, {
    ...payload,
    id: toHex(id),
    sig: toHex(await schnorr.signAsync(id, signer.secretKey))
  }]);
};

// node_modules/@trystero-p2p/nostr/dist/index.mjs
var unreachable2 = (x) => {
  throw mkErr(`unreachable: ${String(x)}`);
};
var cancelTimer = (timer) => {
  if (timer !== null) clearTimeout(timer);
  return null;
};
var relayManager = /* @__PURE__ */ createRelayManager((client) => client.socket, (client) => {
  cleanupClientBatcher(client);
  client.close?.();
});
var defaultRedundancy = 5;
var maxTopicsPerSubscription = 250;
var steadyAnnounceIntervalMs = 6e4;
var maxRelayBackoffMs = 9e5;
var subscriptionRetryMs = 5333;
var roomSigners = /* @__PURE__ */ new Map();
var relayHealth = /* @__PURE__ */ new WeakMap();
var announcementMessages = /* @__PURE__ */ createRelayScopedStore();
var batchers = /* @__PURE__ */ new WeakMap();
var getRoomKey = (rootTopic, selfTopic) => `${rootTopic}\0${selfTopic}`;
var getRoomSigner = (key) => {
  const entry = roomSigners.get(key);
  if (!entry) return createSigner();
  return entry.signer ??= createSigner();
};
var getRelayHealth = (client) => {
  const state = relayHealth.get(client);
  if (!state) return { phase: "healthy" };
  if (state.phase === "cooldown" && Date.now() >= state.untilMs) {
    const next = {
      phase: "probation",
      lastDelayMs: state.delayMs
    };
    relayHealth.set(client, next);
    return next;
  }
  return state;
};
var backoffRelay = (client) => {
  const current = getRelayHealth(client);
  switch (current.phase) {
    case "retired":
      return maxRelayBackoffMs;
    case "healthy": {
      const delayMs = steadyAnnounceIntervalMs;
      relayHealth.set(client, {
        phase: "cooldown",
        delayMs,
        untilMs: Date.now() + delayMs
      });
      return delayMs;
    }
    case "cooldown":
    case "probation": {
      const prevDelay = current.phase === "cooldown" ? current.delayMs : current.lastDelayMs;
      const delayMs = Math.min(Math.max(steadyAnnounceIntervalMs, prevDelay * 2), maxRelayBackoffMs);
      relayHealth.set(client, {
        phase: "cooldown",
        delayMs,
        untilMs: Date.now() + delayMs
      });
      return delayMs;
    }
    default:
      return unreachable2(current);
  }
};
var acknowledgeRelaySuccess = (client) => {
  if (getRelayHealth(client).phase === "probation") relayHealth.set(client, { phase: "healthy" });
};
var getRelayCooldownMs = (client) => {
  const current = getRelayHealth(client);
  return current.phase === "cooldown" ? Math.max(0, current.untilMs - Date.now()) : 0;
};
var nextAnnounce = (nextAnnounceMs) => ({ nextAnnounceMs });
var stopAnnouncing = { stopAnnouncing: true };
var retireRelay = (client) => {
  if (getRelayHealth(client).phase === "retired") return false;
  relayHealth.set(client, { phase: "retired" });
  relayManager.evict(client);
  cleanupClientBatcher(client);
  client.close?.();
  return true;
};
var resolveBatchFlush = (batcher) => {
  batcher.flushWaiters.forEach((resolve) => resolve());
  batcher.flushWaiters.clear();
};
var cleanupClientBatcher = (client) => {
  const batcher = batchers.get(client);
  if (!batcher) return;
  batcher.flushTimer = cancelTimer(batcher.flushTimer);
  batcher.retryTimer = cancelTimer(batcher.retryTimer);
  batcher.sync = { phase: "unsynced" };
  resolveBatchFlush(batcher);
  batchers.delete(client);
};
var batchAdd = (client, topic, handler) => {
  let batcher = batchers.get(client);
  if (!batcher) {
    batcher = {
      subIds: [],
      topics: /* @__PURE__ */ new Map(),
      flushTimer: null,
      flushWaiters: /* @__PURE__ */ new Set(),
      sync: { phase: "unsynced" },
      retryTimer: null,
      retryMs: subscriptionRetryMs
    };
    batchers.set(client, batcher);
  }
  let handlers = batcher.topics.get(topic);
  const isNewTopic = !handlers;
  if (!handlers) {
    handlers = /* @__PURE__ */ new Set();
    batcher.topics.set(topic, handlers);
  }
  handlers.add(handler);
  if (isNewTopic || batcher.sync.phase === "unsynced") scheduleBatchFlush(client, batcher);
};
var batchRemove = (client, topic, handler) => {
  const batcher = batchers.get(client);
  if (!batcher) return false;
  const handlers = batcher.topics.get(topic);
  if (!handlers || !handlers.delete(handler)) return false;
  if (handlers.size > 0) return true;
  batcher.topics.delete(topic);
  delete announcementMessages.forRelay(client)[topic];
  if (batcher.topics.size === 0) {
    batcher.subIds.forEach((subId) => client.send(toJson(["CLOSE", subId])));
    cleanupClientBatcher(client);
    return true;
  }
  scheduleBatchFlush(client, batcher);
  return true;
};
var scheduleBatchFlush = (client, batcher) => {
  if (batcher.flushTimer !== null) return;
  batcher.flushTimer = setTimeout(() => {
    batcher.flushTimer = null;
    try {
      flushBatch(client);
    } finally {
      resolveBatchFlush(batcher);
    }
  }, 0);
};
var waitForBatchFlush = (client) => {
  const batcher = batchers.get(client);
  if (!batcher || batcher.flushTimer === null) return Promise.resolve();
  return new Promise((resolve) => {
    batcher.flushWaiters.add(resolve);
  });
};
var flushBatch = (client) => {
  const batcher = batchers.get(client);
  if (!batcher || batcher.topics.size === 0) return;
  batcher.flushTimer = cancelTimer(batcher.flushTimer);
  batcher.retryTimer = cancelTimer(batcher.retryTimer);
  const topics = [...batcher.topics.keys()];
  const chunks = [];
  const since = subscribeSince();
  for (let i = 0; i < topics.length; i += maxTopicsPerSubscription) chunks.push(topics.slice(i, i + maxTopicsPerSubscription));
  while (batcher.subIds.length > chunks.length) {
    const subId = batcher.subIds.pop();
    if (subId) client.send(toJson(["CLOSE", subId]));
  }
  const pendingSubIds = /* @__PURE__ */ new Set();
  const requestedAt = Date.now();
  chunks.forEach((chunk, i) => {
    const subId = batcher.subIds[i] ??= genId(64);
    pendingSubIds.add(subId);
    client.send(toJson([
      "REQ",
      subId,
      {
        kinds: [...new Set(chunk.map(topicToKind))],
        since,
        ["#x"]: chunk
      }
    ]));
  });
  batcher.sync = {
    phase: "awaiting-eose",
    pendingSubIds,
    requestedAt
  };
  resolveBatchFlush(batcher);
};
var resubscribeOnReconnect = (client) => {
  const batcher = batchers.get(client);
  if (batcher && batcher.topics.size > 0 && !client.isClosed) {
    if (getRelayCooldownMs(client) > 0) {
      retrySubscription(client, true);
      return;
    }
    flushBatch(client);
    replayAnnouncements(client);
  }
};
var replayAnnouncements = (client) => {
  Object.entries(announcementMessages.forRelay(client)).forEach(([topic, { payload, getSigner }]) => {
    publishMessage(client, topic, payload, true, getSigner);
  });
};
var getPublishBlockedResult = (client, isAnnouncement) => {
  const health = getRelayHealth(client);
  if (health.phase === "retired" || client.isClosed) return isAnnouncement ? stopAnnouncing : void 0;
  const remaining = health.phase === "cooldown" ? Math.max(0, health.untilMs - Date.now()) : 0;
  if (remaining > 0 || client.socket?.readyState !== 1) return isAnnouncement ? nextAnnounce(Math.max(steadyAnnounceIntervalMs, remaining)) : void 0;
  return null;
};
var publishMessage = async (client, topic, payload, isAnnouncement, getSigner) => {
  const preBlocked = getPublishBlockedResult(client, isAnnouncement);
  if (preBlocked !== null) return preBlocked;
  const event = await createEvent(topic, isAnnouncement ? toJson({
    ...fromJson(payload),
    nonce: genId(8)
  }) : payload, getSigner());
  const postBlocked = getPublishBlockedResult(client, isAnnouncement);
  if (postBlocked !== null) return postBlocked;
  if (isAnnouncement && !batchers.get(client)?.topics.has(topic)) return nextAnnounce(steadyAnnounceIntervalMs);
  client.send(event);
  return isAnnouncement ? nextAnnounce(steadyAnnounceIntervalMs) : void 0;
};
var retrySubscription = (client, rateLimited) => {
  const batcher = batchers.get(client);
  if (!batcher || batcher.topics.size === 0 || client.isClosed) return;
  if (batcher.retryTimer !== null && !rateLimited) return;
  const delay = rateLimited ? getRelayCooldownMs(client) : batcher.retryMs;
  batcher.retryMs = Math.min(batcher.retryMs * 2, steadyAnnounceIntervalMs);
  if (batcher.sync.phase === "synced") batcher.sync = { phase: "unsynced" };
  batcher.retryTimer = cancelTimer(batcher.retryTimer);
  batcher.retryTimer = setTimeout(() => {
    batcher.retryTimer = null;
    resubscribeOnReconnect(client);
  }, Math.max(delay, subscriptionRetryMs));
  unrefTimer(batcher.retryTimer);
};
var joinRoom = /* @__PURE__ */ topic_strategy_default({
  init: (config) => getRelays(config, defaultRelayUrls, defaultRedundancy, true).map((url) => {
    const client = relayManager.register(url, () => {
      const created = makeSocket(url, (data) => {
        const parsed = fromJson(data);
        if (!Array.isArray(parsed)) return;
        const [msgType, subId, payload, relayMsg] = parsed;
        if (msgType !== "EVENT") {
          if (msgType === "CLOSED" && !batchers.get(created)?.subIds.includes(subId)) return;
          const prefix = `${libName}: relay failure from ${created.url} - `;
          const rejectionReason = msgType === "CLOSED" && typeof payload === "string" ? payload : relayMsg;
          const didRejectEvent = msgType === "OK" && payload === false;
          const isRateLimited = (didRejectEvent || msgType === "CLOSED") && rejectionReason?.startsWith("rate-limited:");
          const isDuplicate = didRejectEvent && rejectionReason?.startsWith("duplicate:");
          const isTerminalRejection = rejectionReason && /^(blocked|restricted|auth-required|pow):/.test(rejectionReason);
          if (msgType === "OK" && payload === true) acknowledgeRelaySuccess(created);
          if ((didRejectEvent || msgType === "CLOSED") && isTerminalRejection && !retireRelay(created)) return;
          if (isRateLimited) backoffRelay(created);
          else if (msgType === "EOSE") {
            const batcher = batchers.get(created);
            if (batcher && batcher.sync.phase === "awaiting-eose" && batcher.sync.pendingSubIds.delete(subId) && batcher.sync.pendingSubIds.size === 0) {
              const { requestedAt } = batcher.sync;
              batcher.retryTimer = cancelTimer(batcher.retryTimer);
              batcher.retryMs = subscriptionRetryMs;
              batcher.sync = { phase: "synced" };
              if (Date.now() - requestedAt >= 1e3) replayAnnouncements(created);
            }
          }
          if (msgType === "CLOSED" && !isTerminalRejection) retrySubscription(created, Boolean(isRateLimited));
          if (!isDuplicate && config.relayConfig?.warnOnRelayFailure !== false) {
            if (msgType === "NOTICE") console.warn(prefix + subId);
            else if (didRejectEvent || msgType === "CLOSED") console.warn(prefix + rejectionReason);
          }
          return;
        }
        if (payload && typeof payload === "object" && "content" in payload) {
          const batcher = batchers.get(created);
          if (batcher?.subIds.includes(subId) && payload.tags) {
            const topicTag = payload.tags.find((t) => Array.isArray(t) && t[0] === "x");
            if (topicTag?.[1]) {
              const matchedTopic = topicTag[1];
              batcher.topics.get(matchedTopic)?.forEach((handler) => {
                handler(matchedTopic, payload.content);
              });
            }
          }
        }
      }, () => resubscribeOnReconnect(created));
      return created;
    });
    return relayManager.lease(client, client.ready);
  }),
  subscribeTopic: (client, topic, onMessage, context) => {
    const key = getRoomKey(context.rootTopic, context.selfTopic);
    const existingSigner = roomSigners.get(key);
    if (existingSigner) existingSigner.refs += 1;
    else roomSigners.set(key, {
      refs: 1,
      signer: null
    });
    let released = false;
    const handler = (receivedTopic, data) => void onMessage(receivedTopic, data);
    batchAdd(client, topic, handler);
    const cleanup = () => {
      if (released) return;
      released = true;
      const entry = roomSigners.get(key);
      if (entry) {
        if (entry.refs <= 1) roomSigners.delete(key);
        else entry.refs -= 1;
      }
      batchRemove(client, topic, handler);
    };
    return context.kind === "root" ? waitForBatchFlush(client).then(() => cleanup) : cleanup;
  },
  publishTopic: (client, topic, msg, { kind, rootTopic, selfTopic }) => {
    const payload = typeof msg === "string" ? msg : toJson(msg);
    const key = getRoomKey(rootTopic, selfTopic);
    const getSigner = () => getRoomSigner(key);
    if (kind === "announce" && batchers.get(client)?.topics.has(topic)) announcementMessages.forRelay(client)[topic] = {
      payload,
      getSigner
    };
    return publishMessage(client, topic, payload, kind === "announce", getSigner);
  }
});
var getRelaySockets = () => relayManager.getSockets();
var defaultRelayUrls = [
  "wss://bucket.coracle.social",
  "wss://fanfares.nostr1.com",
  "wss://no.str.cr",
  "wss://nostr-01.yakihonne.com",
  "wss://nostr-pub.wellorder.net",
  "wss://nostr.azzamo.net",
  "wss://nostr.chaima.info",
  "wss://nostr.data.haus",
  "wss://nostr.hifish.org",
  "wss://nostr.liberty.fans",
  "wss://nostr.overmind.lol",
  "wss://nostr.sathoarder.com",
  "wss://nostrelay.circum.space",
  "wss://relay.angor.io",
  "wss://relay.ditto.pub",
  "wss://relay.dwadziesciajeden.pl",
  "wss://relay.fundstr.me",
  "wss://relay.guggero.org",
  "wss://relay.masize.com",
  "wss://relay.minibolt.info",
  "wss://relay.mostro.network",
  "wss://relay.nostr.com",
  "wss://relay.nostr.net",
  "wss://relay.nostrhub.fr",
  "wss://relay.notoshi.win",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://relay.wavlake.com",
  "wss://soloco.nl",
  "wss://yabu.me"
];
export {
  defaultRelayUrls,
  getRelaySockets,
  joinRoom,
  schnorr
};

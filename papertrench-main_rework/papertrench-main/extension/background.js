/* PaperTrench â€” background service worker (paper-trading core only).
 *
 * ELI5: The mailroom behind the extension. Tabs and the popup send letters
 * (messages) asking for prices, wallet saves, or rug checks; this worker
 * answers without touching any webpage. It keeps the shared notebook in
 * Chrome storage, talks to Solana RPC, and re-injects the overlay when you
 * update the extension.
 *
 * Affects: every content-script tab that talks to chrome.runtime.
 * Does NOT touch the DOM â€” only storage, RPC, and message routing.
 *
 * Responsibilities:
 *   1. Price resolution (resolver.js) for token pages
 *   2. On-chain pool watch / live quotes (onchain-feed.js)
 *   3. Serialized wallet writes (pt_state_commit) so multi-tab fills don't clash
 *   4. Re-inject content scripts after extension install/update
 */

/* â”€â”€ Shared modules (loaded into the service worker global) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Helper scripts Chrome loads into this worker before we run. */

if (typeof importScripts === 'function') {
  importScripts('quote.js', 'resolver.js', 'onchain.js', 'rpc-pool.js', 'onchain-feed.js');
}

/** ELI5: Price lookup desk â€” answers "what is this token worth?" messages. */
const R = self.PaperTrenchResolver;

/** ELI5: Live pool watcher â€” streams fresh on-chain prices over WebSocket. */
const FEED = self.PTOnchainFeed;

/* â”€â”€ Settings revision (must match engine.js SETTINGS_REVISION) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Version stamp for settings â€” background only floors it; engine migrates.
 * Background only floors stored revision; engine.js runs the real migrations. */

const SETTINGS_REVISION = 8;

/* â”€â”€ Settings defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Factory defaults for the settings notebook â€” merged when storage is read.
 * Merged with chrome.storage.local.pt_settings when readSettings() runs.
 * Affects: overlay visibility, presets, fees, positions bar, RPC endpoint.
 * engine.js owns the full schema; these are fallbacks if storage is empty. */

const DEFAULTS = {
  appEnabled: true,              // master switch â€” content script tears down when false
  balanceStartSol: 10,           // starting paper wallet (SOL)
  presetsBuy: [0.01, 0.1, 0.25, 0.5, 0.75, 1.5, 2.5, 5],
  presetsBuyUsd: [10, 100, 500, 1000], // EVM-chain quick-buy amounts ($)
  sellPcts: [2, 50, 75, 100, 2, 5, 10, 15],
  buySlippagePct: 30,            // shown in panel meta row (buy)
  sellSlippagePct: 70,           // shown in panel meta row (sell)
  panelBuyEnabled: true,         // hide buy controls when false
  panelPresetsEnabled: true,     // hide preset pill row when false
  feeBps: 100,                   // simulated fee per side (1%)
  slippageBps: 0,                // extra simulated slippage on fills
  overlayEnabled: true,          // show/hide the trade panel
  overlayHideWhenNoToken: true,  // auto-hide panel on non-token pages
  overlayWidth: null,            // saved panel width (px); null = CSS default
  overlayHeight: null,           // saved panel height cap (px)
  averagePriceLinesEnabled: true, // avg buy/sell lines on chart
  positionsBarEnabled: true,     // floating positions rail
  positionsBarHidden: false,     // user collapsed the rail
  instantBuyEnabled: true,       // preset tap = immediate buy
  panelFocusMode: false,         // legacy compact layout flag
  settingsRevision: SETTINGS_REVISION,
  rpcUrl: '',                    // custom Solana RPC; empty = public pool
};


/* â”€â”€ Address / chain validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Bouncers â€” reject malformed mints/pools before any handler runs.
 * Guards every handler that accepts mints, pools, or token objects. */

const BASE58_ADDR_MIN_LEN = 32;
const BASE58_ADDR_MAX_LEN = 44;
const EVM_ADDR_HEX_LEN = 40;
const MAX_MINTS_PER_BATCH = 100;    // pt_batch_prices cap

const MS_PER_MINUTE = 60_000;

const BASE58_RE = new RegExp(`^[A-HJ-NP-Za-km-z1-9]{${BASE58_ADDR_MIN_LEN},${BASE58_ADDR_MAX_LEN}}$`);
const EVM_ADDR_RE = new RegExp(`^0x[0-9a-fA-F]{${EVM_ADDR_HEX_LEN}}$`);
const KNOWN_CHAINS = ['solana', 'base', 'monad', 'bnb', 'ethereum', 'hyperliquid', 'robinhood'];

/* â”€â”€ Slow-RPC notice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Affects: chrome.storage.local.pt_rpc_notice â†’ content.js toast once. */

const SLOW_POOL_MS = 750;              // best latency above this triggers notice
const SLOW_POOL_MIN_SAMPLES = 12;      // pool must have this many measurements first

/* â”€â”€ Handler fallbacks (error / missing-data replies) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const SOL_USD_FALLBACK = 0;            // pt_sol_usd when resolver throws
const ONCHAIN_WATCH_DEAD = { live: false }; // pt_onchain_watch when feed/address invalid
const EMPTY_BATCH_PRICES = {};         // pt_batch_prices when mint list is empty
const STATE_SEQ_FALLBACK = 0;          // missing seq on compare-and-swap

/* â”€â”€ Legacy message acks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Stripped UI / old content.js paths still send these; worker returns { ok: true }. */

const LEGACY_ACK_TYPES = new Set([
  'pt_settings_changed',   // popup saved settings
]);

/* â”€â”€ Mutable worker state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: In-memory scratch pad â€” wallet write queue, reinject lock. */

const stateCommitQueue = Promise.resolve(); // serializes pt_state_commit across tabs
let reinjectInFlight = false;       // debounce concurrent onInstalled runs

/* â”€â”€ Storage I/O (single chrome.storage.local wrapper) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Read/write the shared notebook â€” settings and wallet state. */

/** ELI5: Read one or more keys from Chrome storage; null on error. */
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (value) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(value || {});
    });
  });
}

/** ELI5: Write a patch into Chrome storage. */
function storageSet(patch) {
  return new Promise((resolve) => {
    chrome.storage.local.set(patch, () => resolve());
  });
}

/** Bump stored revision if older than worker minimum. Affects: merged settings shape. */
function migrateBackgroundSettings(settings) {
  const revision = Number(settings.settingsRevision) || STATE_SEQ_FALLBACK;
  if (revision < SETTINGS_REVISION) settings.settingsRevision = SETTINGS_REVISION;
  return settings;
}

/** ELI5: Merge saved settings with defaults and bump revision if needed. */
async function readSettings() {
  const stored = await storageGet(['pt_settings']);
  if (!stored) return migrateBackgroundSettings({ ...DEFAULTS });
  return migrateBackgroundSettings({ ...DEFAULTS, ...(stored.pt_settings || {}) });
}

/** Read pt_state (wallet) from storage. Used by handleStateCommit compare-and-swap. */
async function readState() {
  const stored = await storageGet(['pt_state']);
  if (!stored) return null;
  return stored.pt_state || null;
}

/* â”€â”€ Response helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Safe ways to reply to tabs â€” success ack or catch errors so nothing hangs. */

/** ELI5: Send a success payload (default { ok: true }). */
function ack(sendResponse, payload = { ok: true }) {
  sendResponse(payload);
}

/** Run async work; on throw, reply with fallback instead of hanging the tab. */
async function safe(sendResponse, work, fallback) {
  try {
    sendResponse(await work());
  } catch (_) {
    sendResponse(fallback);
  }
}

/* â”€â”€ Input sanitizers (message-handler guards) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Shape-check every address and mint list before handlers trust them. */

/** ELI5: True if string looks like a Solana address. */
function isSolanaAddress(s) {
  return typeof s === 'string' && BASE58_RE.test(s);
}

/** True if string looks like an EVM address. */
function isEvmAddress(s) {
  return typeof s === 'string' && EVM_ADDR_RE.test(s);
}

/** Return address if valid Solana shape, else null. Used by prewatch. */
function solAddrOrNull(s) {
  return isSolanaAddress(s) ? s : null;
}

/** Normalize chain claim from content script; null if unknown. */
function chainOfClaim(chain) {
  return typeof chain === 'string' && KNOWN_CHAINS.indexOf(chain) >= 0 ? chain : null;
}

/** Pick Solana vs EVM validator based on chain. */
function isAddressForChain(s, chain) {
  return chain === 'solana' || !chain ? isSolanaAddress(s) : isEvmAddress(s);
}

/** Validate pool/pair address for the token's chain. */
function isPairAddressForChain(addr, chain) {
  return isSolanaAddress(addr) || (chain !== 'solana' && isEvmAddress(addr));
}

/** Filter + cap mint list for pt_batch_prices. */
function sanitizeMints(list) {
  if (!Array.isArray(list)) return null;
  const clean = list.filter((m) => isSolanaAddress(m) || isEvmAddress(m));
  return clean.length ? clean.slice(0, MAX_MINTS_PER_BATCH) : null;
}

/** Build per-mint chain map for non-Solana batch price lookups. */
function sanitizeChains(map, mints) {
  if (!map || typeof map !== 'object' || !Array.isArray(mints)) return undefined;
  const out = {};
  for (const mint of mints) {
    const chain = chainOfClaim(map[mint]);
    if (chain && chain !== 'solana' && isEvmAddress(mint)) out[mint] = chain;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Validate token object shape before pt_refresh. */
function isValidTokenForRefresh(t) {
  if (!t || typeof t !== 'object') return false;
  const chain = chainOfClaim(t.chain) || 'solana';
  if (!isAddressForChain(t.mint, chain)) return false;
  if (t.pairAddress && !isPairAddressForChain(t.pairAddress, chain)) return false;
  return true;
}


/* â”€â”€ RPC health notice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: If public RPC is slow, leave a one-time note so the UI can toast the user. */

/**
 * ELI5: Write pt_rpc_notice when the free pool is consistently laggy.
 * Affects: pt_rpc_notice / pt_rpc_slow_told â†’ content.js shows a toast.
 * Skipped when the user already set settings.rpcUrl.
 */
async function maybeNoteSlowPool(settings) {
  try {
    if (settings && settings.rpcUrl) return;
    if (!self.PTRpcPool || typeof PTRpcPool.poolLatency !== 'function') return;
    const measured = PTRpcPool.poolLatency();
    if (!measured || measured.samples < SLOW_POOL_MIN_SAMPLES) return;
    if (measured.bestMs <= SLOW_POOL_MS) return;
    const flags = await storageGet(['pt_rpc_slow_told']);
    if (!flags || flags.pt_rpc_slow_told) return;
    await storageSet({
      pt_rpc_slow_told: Date.now(),
      pt_rpc_notice: { bestMs: measured.bestMs, samples: measured.samples, at: Date.now() },
    });
  } catch (_) {}
}

/* â”€â”€ On-chain feed (shared configure + slow-pool notice) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Wire user RPC URL into the live feed before watch/prewatch handlers run. */

/** ELI5: Point the pool feed at the user's RPC (or public pool). */
function configureFeed(settings) {
  if (!FEED) return false;
  FEED.configure({ rpcUrl: (settings && settings.rpcUrl) || null });
  return true;
}

/** Configure feed, run work, then maybe write slow-pool notice. Used by watch/prewatch. */
async function withFeed(settings, work) {
  if (!configureFeed(settings)) return null;
  const result = await work();
  maybeNoteSlowPool(settings).catch(() => {});
  return result;
}

/* â”€â”€ Content-script survival â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: After an extension update, poke dead tabs and re-inject the overlay. */

/**
 * ELI5: Tiny probe injected into a tab â€” "is the overlay still alive?"
 * Affects: reinjectOpenTabs â€” skip tabs that already have a working overlay.
 */
function ptLivenessProbe() {
  try {
    return typeof window.__ptAlive === 'function' && window.__ptAlive() === true;
  } catch (_) {
    return false;
  }
}

/** List open tabs matching manifest content-script URL patterns. */
function reinjectQueryTabs(matches) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ url: matches }, (tabs) => {
        if (chrome.runtime && chrome.runtime.lastError) { resolve([]); return; }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (_) {
      resolve([]);
    }
  });
}

/**
 * ELI5: Walk open chart tabs after install/update and re-inject scripts that died.
 * After install/update, re-inject ISOLATED content scripts into dead tabs.
 * Affects: chart tabs where the overlay stopped responding post-reload.
 */
async function reinjectOpenTabs(reason) {
  if (reinjectInFlight) return { reason, skipped: 'in-flight' };
  reinjectInFlight = true;
  const report = { reason, alive: 0, injected: 0, failed: 0 };
  try {
    const manifest = chrome.runtime.getManifest();
    const entries = (manifest.content_scripts || [])
      .filter((entry) => !entry.world || entry.world === 'ISOLATED')
      .filter((entry) => Array.isArray(entry.js) && entry.js.length);

    for (const entry of entries) {
      const tabs = await reinjectQueryTabs(entry.matches || []);
      for (const tab of tabs) {
        if (!tab || !tab.id) continue;
        let alive = false;
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: ptLivenessProbe,
            world: 'ISOLATED',
          });
          alive = result === true;
        } catch (_) {}
        if (alive) { report.alive++; continue; }
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: entry.js,
            world: 'ISOLATED',
          });
          if (entry.css && entry.css.length) {
            await chrome.scripting.insertCSS({
              target: { tabId: tab.id },
              files: entry.css,
            });
          }
          report.injected++;
        } catch (_) {
          report.failed++;
        }
      }
    }
  } catch (_) {}
  reinjectInFlight = false;
  return report;
}

/* â”€â”€ Message handlers (one function per pt_* type) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Each letter type gets its own clerk â€” resolve, refresh, wallet commit, etc.
 * Each handler receives (message, sendResponse, settings).
 * settings is loaded once per message by the router below. */

/** ELI5: Save wallet state one tab at a time (compare-and-swap on seq). */
async function handleStateCommit(message, sendResponse) {
  const job = async () => {
    const incoming = message.state;
    if (!incoming || typeof incoming !== 'object') return { ok: false, reason: 'bad-state' };
    const stored = await readState();
    if (!message.force) {
      const baseSeq = Number(message.expectedSeq) || STATE_SEQ_FALLBACK;
      const storedSeq = stored ? (Number(stored.seq) || STATE_SEQ_FALLBACK) : STATE_SEQ_FALLBACK;
      if (stored && storedSeq !== baseSeq) {
        return { ok: false, reason: 'stale', current: stored };
      }
    }
    await storageSet({ pt_state: incoming });
    return { ok: true, seq: Number(incoming.seq) || STATE_SEQ_FALLBACK };
  };
  const run = stateCommitQueue.then(job, job);
  stateCommitQueue = run.catch(() => {});
  sendResponse(await run);
}

/** pt_resolve â€” token metadata + cached price on page load. */
function handleResolve(message, sendResponse) {
  const chain = chainOfClaim(message.chain) || 'solana';
  if (!isAddressForChain(message.address, chain)) { sendResponse(null); return; }
  const maxAgeMs = Number(message.maxAgeMs);
  const opts = {};
  if (Number.isFinite(maxAgeMs) && maxAgeMs >= 0) opts.maxAgeMs = maxAgeMs;
  if (chain !== 'solana') opts.chain = chain;
  safe(sendResponse, () => R.resolve(message.address, opts), null);
}

/** pt_sol_usd â€” SOL/USD rate for panel balance display. */
function handleSolUsd(_message, sendResponse) {
  safe(sendResponse, () => R.solUsd(), SOL_USD_FALLBACK);
}

/** pt_refresh â€” force-refresh price for the active token (requote loop). */
function handleRefresh(message, sendResponse) {
  if (!isValidTokenForRefresh(message.token)) { sendResponse(null); return; }
  safe(sendResponse, () => R.refresh(message.token), null);
}

/** pt_batch_prices â€” bulk prices for positions bar live PnL. */
function handleBatchPrices(message, sendResponse) {
  const mints = sanitizeMints(message.mints);
  if (!mints) { sendResponse(EMPTY_BATCH_PRICES); return; }
  const chains = sanitizeChains(message.chains, mints);
  safe(sendResponse, () => R.batchPrices(mints, chains), EMPTY_BATCH_PRICES);
}

/** pt_onchain_watch â€” subscribe to live pool updates (onchainLive + fill price). */
async function handleOnchainWatch(message, sendResponse, settings) {
  if (!FEED || !isSolanaAddress(message.mint) || !isSolanaAddress(message.pool)) {
    sendResponse(ONCHAIN_WATCH_DEAD);
    return;
  }
  await safe(sendResponse, async () => ({
    live: Boolean(await withFeed(settings, () => FEED.watch(message.mint, message.pool))),
  }), ONCHAIN_WATCH_DEAD);
}

/** pt_onchain_unwatch â€” tear down pool subscription when leaving a token page. */
function handleOnchainUnwatch(message, sendResponse) {
  if (FEED && isSolanaAddress(message.mint)) FEED.unwatch(message.mint);
  ack(sendResponse);
}

/** pt_onchain_prewatch â€” resolve pool/mint from URL before token detection lands. */
async function handleOnchainPrewatch(message, sendResponse, settings) {
  const pool = solAddrOrNull(message.pool);
  const mint = solAddrOrNull(message.mint);
  if (!FEED || (!pool && !mint)) { sendResponse(null); return; }
  await safe(sendResponse, () => withFeed(settings, () => FEED.prewatch({ pool, mint })), null);
}

/** pt_onchain_quote â€” latest on-chain quote without a network round-trip. */
function handleOnchainQuote(message, sendResponse) {
  if (!FEED || !isSolanaAddress(message.mint)) { sendResponse(null); return; }
  sendResponse(FEED.currentQuote(message.mint));
}

/* â”€â”€ Message router (content.js / popup â†’ background) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * ELI5: Front desk â€” read message.type, load settings, call the right handler. */

/** ELI5: Lookup table from message.type â†’ handler function. */
const MESSAGE_HANDLERS = {
  pt_state_commit: handleStateCommit,
  pt_resolve: handleResolve,
  pt_sol_usd: handleSolUsd,
  pt_refresh: handleRefresh,
  pt_batch_prices: handleBatchPrices,
  pt_onchain_watch: handleOnchainWatch,
  pt_onchain_unwatch: handleOnchainUnwatch,
  pt_onchain_prewatch: handleOnchainPrewatch,
  pt_onchain_quote: handleOnchainQuote,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  (async () => {
    if (LEGACY_ACK_TYPES.has(message.type)) {
      ack(sendResponse);
      return;
    }
    const handler = MESSAGE_HANDLERS[message.type];
    if (!handler) {
      sendResponse({ error: 'unknown message type' });
      return;
    }
    const settings = await readSettings();
    await handler(message, sendResponse, settings);
  })().catch((error) => sendResponse({ error: error.message }));

  return true; // keep channel open for async sendResponse
});

/* Re-inject into open chart tabs when the extension is installed or updated. */
chrome.runtime.onInstalled.addListener((details) => {
  reinjectOpenTabs((details && details.reason) || 'installed').catch(() => {});
});

/* PaperTrench — content script.
 *
 * ELI5: The boss of the whole overlay. This file doesn't do much heavy lifting
 * itself — it wires together all the helpers (panel, price, trades, storage)
 * and tells them who shares what. Think of it as the conductor of an orchestra:
 * it holds the shared notebook (wallet state), mounts the floating panel on the
 * page, and passes messages between every musician.
 *
 * Injected on supported trading sites. Detects the token on screen, pulls the
 * live price from the page (price-bridge.js in MAIN world), and renders a
 * Shadow-DOM quick-trade panel. Zero paid API calls.
 */
(() => {
  'use strict';

  /* ── Module refs (loaded by manifest before this script) ───────────────────
   * ELI5: Pointers to every helper script Chrome loaded before us. */

  /** Portfolio engine — wallet state, fills, settings schema. */
  const E = window.PaperEngine;
  /** Per-site token detection + row quick-buy hooks. */
  const S = window.PaperTrenchSites;
  /** Price/mcap formatting, tick validation, fill witness helpers. */
  const Q = window.PaperQuote;
  /** In-page resolver — kept for wiring tests; live calls go through R → background. */
  const resolver = window.PaperTrenchResolver;
  /** SVG chart-marker rail fallback (chart-markers.js). */
  const CM = window.PTChartMarkers;
  /** Presentational panel theme, CSS, icons, and shadow shell HTML. */
  const PanelUI = window.PTPanelUI;
  /** Panel position clamp + makeDraggable helpers. */
  const PanelDrag = window.PTPanelDrag;
  /** Panel toast stack (queued slots under the overlay). */
  const PanelToast = window.PTPanelToast;
  /** Padre-style positions bar (chips + off-screen poll). */
  const PanelBar = window.PTPanelBar;
  /** Open-position card. */
  const PanelPosition = window.PTPanelPosition;
  /** Panel mount, bind, and render helpers. */
  const PanelControls = window.PTPanelControls;
  /** Price / market-cap formatters for the overlay. */
  const PanelFormat = window.PTPanelFormat;
  /** Overlay mount / teardown lifecycle. */
  const PanelOverlay = window.PTPanelOverlay;
  /** Chart fill markers + average-price lines. */
  const PanelChartFills = window.PTPanelChartFills;
  /** Native vs SVG chart routing + bridge postMessage. */
  const PanelChartRouting = window.PTPanelChartRouting;
  /** Action-time quotes, buy/sell fills, and trade receipts. */
  const ContentTrade = window.PTContentTrade;
  /** Wallet state persistence + cross-tab CAS sync. */
  const ContentStorage = window.PTContentStorage;
  /** MAIN-world bridge postMessage handler. */
  const ContentBridge = window.PTContentBridge;
  /** Token detection, rug guard, setToken lifecycle. */
  const ContentDetect = window.PTContentDetect;
  /** Page tick validation + price heartbeat. */
  const ContentPrice = window.PTContentPrice;

  /* ── DOM ids ─────────────────────────────────────────────────────────────── */

  const HOST_ID = 'papertrench-host';

  /* ── Time units ──────────────────────────────────────────────────────────── */

  const MS_PER_SECOND = 1000;
  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;

  /* ── Timing: detection + overlay loops ───────────────────────────────────── */

  const DETECT_MS = 800;                 // token re-detect poll while on a page
  const FAST_RETRY_MS = 250;             // fresh-launch resolve retry
  const FAST_RETRY_WINDOW_MS = 90_000;   // how long fast retry stays aggressive
  const BAR_SCAN_MS = MS_PER_SECOND;     // positions-bar poll cadence while overlay is on
  const CLOSED_AGO_JUST_NOW_SEC = 5;   // "just now" threshold on closed PnL card

  /* ── Limits + caps (spine-owned; passed into modules via ctx) ────────────── */

  const SERIES_CAP = 2400;               // in-memory price series per token
  const SOL_USD_FALLBACK = 0;            // pt_sol_usd when background throws

  /* ── Background message facade ─────────────────────────────────────────────
   * ELI5: Phone line to the background worker — prices, blockchain reads, and
   * rug checks all go through here (the page itself can't call those APIs). */

  /** True when background returned a payload, not { error: ... }. */
  function okOrNull(reply) {
    return (reply && typeof reply === 'object' && !reply.error) ? reply : null;
  }

  const R = {
    resolve: (address, opts) => sendMessage({ type: 'pt_resolve', address, maxAgeMs: opts && opts.maxAgeMs, chain: opts && opts.chain }).then(okOrNull),
    refresh: (token) => sendMessage({ type: 'pt_refresh', token }).then(okOrNull),
    solUsd: () => sendMessage({ type: 'pt_sol_usd' }).then((r) => (typeof r === 'number' && r > 0 ? r : SOL_USD_FALLBACK)).catch(() => SOL_USD_FALLBACK),
    onchainWatch: (mint, pool) => sendMessage({ type: 'pt_onchain_watch', mint, pool }).then(okOrNull),
    onchainPrewatch: (ids) => sendMessage({ type: 'pt_onchain_prewatch', pool: ids.pool || null, mint: ids.mint || null }).then(okOrNull),
    // rugCheck: (mint) => sendMessage({ type: 'pt_rug_check', mint }).then(okOrNull),
    onchainUnwatch: (mint) => sendMessage({ type: 'pt_onchain_unwatch', mint }).catch(() => null),
    onchainQuote: (mint) => sendMessage({ type: 'pt_onchain_quote', mint }).then(okOrNull),
    batchPrices: (mints, chains) => sendMessage({ type: 'pt_batch_prices', mints, chains }).then((r) => (r && typeof r === 'object' && !r.error) ? r : {}),
    clearCache: () => { if (resolver && typeof resolver.clearCache === 'function') resolver.clearCache(); },
  };

  /* ── Mutable module state ────────────────────────────────────────────────────
   * ELI5: The shared whiteboard everyone reads and writes. settings + state
   * persist to chrome.storage; token + series reset when you change coins. */

  let settings = E.defaultSettings();
  let state = E.defaultState(settings);
  let site = null;                      // active PaperTrenchSites adapter
  let token = null;                     // {kind, address, mint, pairAddress, symbol, priceNative, …}
  let series = [];                      // {t, p, usd} price history for sparkline
  let marks = [];                       // legacy mark list (native bridge consumes journal)
  const drawnFillIds = new Set();       // journal replay dedup for chart markers

  let onchainLive = false;              // pool subscription active for current mint
  let pendingSolUsd = 0;                // warmed SOL/USD for bootstrapping USD ticks
  let host = null;                      // #papertrench-host shadow root anchor
  let shadow = null;
  let els = {};                         // cached panel element refs (buildUI)

  /**
   * Return the trusted resolver anchor for the current token. Live chart ticks
   * are validated against this anchor, not against the last accepted tick, so a
   * single wrong page value cannot corrupt every following tick and P&L mark.
   */
  function tokenAnchor() {
    if (token && token.anchor && Number(token.anchor.priceNative) > 0) return token.anchor;
    return token;
  }
  /* ── Chart routing (C-19/C-20) ─────────────────────────────────────────────
   * ELI5: Some sites draw on the chart natively (Padre/GMGN), others need our
   * SVG overlay. This picks the right path and talks to the bridge. */

  if (!PanelChartRouting) throw new Error('PaperTrench: panel/panel-chart-routing.js must load before content/content.js');

  let chartRoutingApi = null;

  function chartRoutingCtx() {
    return {
      get site() { return site; },
      get token() { return token; },
      CM,
      drawnFillIds,
      contextDead: () => contextDead,
      restoreMarkersFromJournal: () => restoreMarkersFromJournal(),
      syncAveragePriceLines: () => syncAveragePriceLines(),
    };
  }

  function ensureChartRouting() {
    if (!chartRoutingApi) chartRoutingApi = PanelChartRouting.create(chartRoutingCtx());
    return chartRoutingApi;
  }

  function sendPadreMarker(...a) { return ensureChartRouting().sendPadreMarker(...a); }
  function nativeChartPending() { return ensureChartRouting().nativeChartPending(); }
  function usesNativeChart() { return ensureChartRouting().usesNativeChart(); }
  function usesSvgMarkers() { return ensureChartRouting().usesSvgMarkers(); }
  function genericChartPoint(...a) { return ensureChartRouting().genericChartPoint(...a); }
  function beginNativeProbe() { return ensureChartRouting().beginNativeProbe(); }
  function noteNativeCapability(payload) { return ensureChartRouting().noteNativeCapability(payload); }
  function resetChartRouting() { return ensureChartRouting().resetProbe(); }

  /* ── Extension lifetime ────────────────────────────────────────────────────
   * ELI5: When you reload the extension, the old copy on the page goes zombie.
   * These helpers detect that, shut down cleanly, and remove our UI. */

  // Reloading or updating the extension kills this script's context, but the
  // already-injected copy keeps running in the page. Every chrome.* call then
  // throws "Extension context invalidated", and because this script is driven
  // by several timers that produced a rejection on EVERY tick plus a visibly
  // thrashing panel. The guard below turns that into a single clean shutdown.
  let contextDead = false;
  const teardownFns = [];

  /**
   * Liveness beacon for the background's re-injection sweep.
   *
   * Chrome does not re-inject content scripts into tabs that were already open
   * when the extension reloads or updates, and the ORPHANED instance left in
   * such a tab keeps every one of its globals — only its chrome.* handles are
   * invalidated. Presence therefore proves nothing; the chrome handle is the
   * only honest signal, so that is what this reports. An orphan answers false
   * and the background rebuilds the tab (background.js reinjectOpenTabs).
   */
  try {
    window.__ptAlive = () => {
      try {
        return !contextDead && Boolean(chrome.runtime && chrome.runtime.id);
      } catch (_) {
        return false;
      }
    };
  } catch (_) { /* a hostile page pinned the property: the sweep re-injects, which is safe */ }

  /** True while this content script may still talk to the extension. */
  function contextAlive() {
    if (contextDead) return false;
    try {
      // chrome.runtime.id becomes undefined the moment the context is gone.
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  /** Register a cleanup action to run when the extension goes away. */
  function onTeardown(fn) { teardownFns.push(fn); }

  /**
   * Stop everything and remove our UI from the page.
   *
   * Idempotent: later timers that fire before they are cleared simply see
   * contextDead and return.
   */
  function shutdown(reason) {
    if (contextDead) return;
    contextDead = true;
    for (const fn of teardownFns.splice(0)) {
      try { fn(); } catch (_) { /* keep tearing down */ }
    }
    // DEFECTS O-04/C-17: extension reload/update must not leave chart
    // artifacts welded to the host page. destroyChartMarkers removes the SVG
    // overlay, its observers and its scan timer; the best-effort 'standdown'
    // tells the MAIN-world bridge — which cannot observe extension death
    // itself — to clear native marks/lines and stop re-asserting them.
    try { if (CM) CM.destroyChartMarkers(); } catch (_) {}
    try { sendPadreMarker('standdown'); } catch (_) {}
    try { if (bridgeApi) bridgeApi.unbind(); } catch (_) {}
    resetPanelMounts();
    try { if (host && host.remove) host.remove(); } catch (_) {}
    host = null; shadow = null; els = {};
    // One quiet line, not a per-tick error storm.
    try { console.info('PaperTrench: extension context ended (' + (reason || 'reloaded') + '); overlay removed.'); } catch (_) {}
  }

  /** setInterval that is registered for teardown and dies with the context. */
  function managedInterval(fn, ms) {
    const id = setInterval(() => {
      if (!contextAlive()) { shutdown('invalidated'); return; }
      fn();
    }, ms);
    onTeardown(() => clearInterval(id));
    return id;
  }

  /**
   * Storage access that fails soft.
   *
   * A dead context is an expected end-of-life condition, not an error worth
   * rejecting into the page's console on every heartbeat.
   *
   * get() resolves null when the read FAILED (dead context, lastError, or an
   * exception) and {} when it succeeded but nothing is stored. Callers must
   * never treat a failed read as "empty wallet" — that is how a transient
   * storage hiccup turns into a silent wipe of every open position.
   */
  const store = {
    get: (keys) => new Promise((resolve) => {
      if (!contextAlive()) { shutdown('invalidated'); resolve(null); return; }
      try {
        chrome.storage.local.get(keys, (value) => {
          if (chrome.runtime && chrome.runtime.lastError) { resolve(null); return; }
          resolve(value || {});
        });
      } catch (_) { shutdown('invalidated'); resolve(null); }
    }),
    set: (obj) => new Promise((resolve) => {
      if (!contextAlive()) { shutdown('invalidated'); resolve(); return; }
      try {
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime && chrome.runtime.lastError) { resolve(); return; }
          resolve();
        });
      } catch (_) { shutdown('invalidated'); resolve(); }
    }),
  };

  /** Fire-and-forget message that never rejects into the page console. */
  function sendMessage(payload) {
    if (!contextAlive()) { shutdown('invalidated'); return Promise.resolve(null); }
    try {
      const result = chrome.runtime.sendMessage(payload);
      return result && typeof result.catch === 'function'
        ? result.catch(() => null)
        : Promise.resolve(result || null);
    } catch (_) {
      shutdown('invalidated');
      return Promise.resolve(null);
    }
  }

  // Exposed for tests so the in-flight storage/messaging paths can be driven
  // directly; harmless in a page (a plain reference on the isolated-world
  // global, which the host page cannot see).
  try { window.__ptStore = store; window.__ptSend = sendMessage; } catch (_) {}

  /* ── Backend modules (content/content-*.js) ───────────────────────────────
   * ELI5: The specialist workers. Each gets a "ctx" bag of shared stuff
   * (token, settings, render functions) and does one job really well. */

  if (!ContentStorage) throw new Error('PaperTrench: content/content-storage.js must load before content/content.js');
  if (!ContentBridge) throw new Error('PaperTrench: content/content-bridge.js must load before content/content.js');
  if (!ContentDetect) throw new Error('PaperTrench: content/content-detect.js must load before content/content.js');
  if (!ContentPrice) throw new Error('PaperTrench: content/content-price.js must load before content/content.js');

  let storageApi = null;
  let bridgeApi = null;
  let detectApi = null;
  let priceApi = null;

  function storageCtx() {
    return {
      get state() { return state; },
      set state(v) { state = v; },
      get settings() { return settings; },
      set settings(v) { settings = v; },
      get token() { return token; },
      E, store,
      sendMessage: (...a) => sendMessage(...a),
      contextAlive: () => contextAlive(),
      get contextDead() { return contextDead; },
      shutdown: (...a) => shutdown(...a),
      onTeardown: (fn) => onTeardown(fn),
      invalidatePositionCard: () => invalidatePositionCard(),
      renderBalance: () => renderBalance(),
      renderPosition: () => renderPosition(),
      renderClosedPnl: () => renderClosedPnl(),
      renderPositionsBar: () => renderPositionsBar(),
      syncAveragePriceLines: () => syncAveragePriceLines(),
      restoreMarkersFromJournal: () => restoreMarkersFromJournal(),
      get barApi() { return barApi; },
      get els() { return els; },
      enableOverlay: () => enableOverlay(),
      disableOverlay: () => disableOverlay(),
      renderPresets: () => renderPresets(),
      updateOverlayVisibility: () => updateOverlayVisibility(),
      applyOverlaySize: () => applyOverlaySize(),
      publishPageState: () => publishPageState(),
      toast: (...a) => toast(...a),
      eachLivePositionPrice: (fn) => { if (barApi) barApi.eachLivePositionPrice(fn); },
    };
  }

  function ensureStorage() {
    if (!storageApi) storageApi = ContentStorage.create(storageCtx());
    return storageApi;
  }

  function withState(fn) { return ensureStorage().withState(fn); }
  function reloadState() { return ensureStorage().reloadState(); }
  function adoptState(next) { return ensureStorage().adoptState(next); }
  function persistStateNow(remutate) { return ensureStorage().persistStateNow(remutate); }
  function watchStorage() { return ensureStorage().watchStorage(); }
  function persistSoon() { return ensureStorage().persistSoon(); }

  function bridgeCtx() {
    return {
      contextAlive: () => contextAlive(),
      onTeardown: (fn) => onTeardown(fn),
      get site() { return site; },
      get settings() { return settings; },
      get token() { return token; },
      handlePageTick: (...a) => handlePageTick(...a),
      toast: (...a) => toast(...a),
      sendPadreMarker: (...a) => sendPadreMarker(...a),
      noteNativeCapability: (...a) => noteNativeCapability(...a),
      renderSiteStatus: () => renderSiteStatus(),
      onRouteChange: () => onRouteChange(),
      detectLoop: () => detectLoop(),
    };
  }

  function ensureBridge() {
    if (!bridgeApi) {
      bridgeApi = ContentBridge.create(bridgeCtx());
      bridgeApi.bind();
    }
    return bridgeApi;
  }

  function scheduleDetect() { return ensureBridge().scheduleDetect(); }
  function publishPageState() { return ensureBridge().publishPageState(); }

  function priceCtx() {
    return {
      get token() { return token; },
      get settings() { return settings; },
      get state() { return state; },
      get series() { return series; },
      get pendingSolUsd() { return pendingSolUsd; },
      get armedBuy() { return ensureTrade().armedBuy; },
      set armedBuy(v) { ensureTrade().armedBuy = v; },
      get lastAcceptedMarket() { return ensureTrade().lastAcceptedMarket; },
      set lastAcceptedMarket(v) { ensureTrade().lastAcceptedMarket = v; },
      E, Q, CM, R,
      SERIES_CAP,
      tokenAnchor: () => tokenAnchor(),
      contextAlive: () => contextAlive(),
      shutdown: (...a) => shutdown(...a),
      onTeardown: (fn) => onTeardown(fn),
      flushArmedBuy: () => flushArmedBuy(),
      armedBuyExpired: () => armedBuyExpired(),
      syncAveragePriceLines: () => syncAveragePriceLines(),
      maybeRepostAverageLines: () => maybeRepostAverageLines(),
      usesSvgMarkers: () => usesSvgMarkers(),
      genericChartPoint: (...a) => genericChartPoint(...a),
      renderHeader: () => renderHeader(),
      renderPosition: () => renderPosition(),
      renderBalance: () => renderBalance(),
      renderLiveDot: () => renderLiveDot(),
      renderPositionsBar: () => renderPositionsBar(),
      renderBuyButton: () => renderBuyButton(),
      toast: (...a) => toast(...a),
      persistSoon: () => persistSoon(),
    };
  }

  function ensurePrice() {
    if (!priceApi) priceApi = ContentPrice.create(priceCtx());
    return priceApi;
  }

  function handlePageTick(payload) { return ensurePrice().handlePageTick(payload); }
  function startPriceLoop() { return ensurePrice().startPriceLoop(); }
  function stopPriceLoop() { return ensurePrice().stopPriceLoop(); }
  function requote() { return ensurePrice().requote(); }
  function waitForNewPageQuote(...a) { return ensurePrice().waitForNewPageQuote(...a); }

  function detectCtx() {
    return {
      S, R, CM,
      get site() { return site; },
      set site(v) { site = v; },
      get token() { return token; },
      set token(v) { token = v; },
      get settings() { return settings; },
      get armedBuy() { return ensureTrade().armedBuy; },
      set armedBuy(v) { ensureTrade().armedBuy = v; },
      get onchainLive() { return onchainLive; },
      set onchainLive(v) { onchainLive = v; },
      get pendingSolUsd() { return pendingSolUsd; },
      set pendingSolUsd(v) { pendingSolUsd = v; },
      get series() { return series; },
      set series(v) { series = v; },
      get marks() { return marks; },
      set marks(v) { marks = v; },
      drawnFillIds,
      sendPadreMarker: (...a) => sendPadreMarker(...a),
      handlePageTick: (...a) => handlePageTick(...a),
      flushArmedBuy: () => flushArmedBuy(),
      reloadState: () => reloadState(),
      restoreMarkersFromJournal: () => restoreMarkersFromJournal(),
      usesNativeChart: () => usesNativeChart(),
      usesSvgMarkers: () => usesSvgMarkers(),
      resetLineThrottle: () => resetLineThrottle(),
      beginNativeProbe: () => beginNativeProbe(),
      startPriceLoop: () => startPriceLoop(),
      stopPriceLoop: () => stopPriceLoop(),
      renderAll: () => renderAll(),
      renderHeader: () => renderHeader(),
      renderSiteStatus: () => renderSiteStatus(),
      updateOverlayVisibility: () => updateOverlayVisibility(),
      invalidatePositionCard: () => invalidatePositionCard(),
      syncAveragePriceLines: () => syncAveragePriceLines(),
      publishPageState: () => publishPageState(),
      clearFeedOnMintChange: () => ensurePrice().clearFeedOnMintChange(),
      resetTokenPriceState: () => ensurePrice().resetTokenPriceState(),
    };
  }

  function ensureDetect() {
    if (!detectApi) detectApi = ContentDetect.create(detectCtx());
    return detectApi;
  }

  function detectLoop() { return ensureDetect().detectLoop(); }
  function setToken(data) { return ensureDetect().setToken(data); }
  // function rugRefusalMessage() { return ensureDetect().rugRefusalMessage(); }

  // Eagerly wire bridge listeners (postMessage fan-out).
  ensureBridge();
  // C-19: the native-chart discovery grace timer dies with the context.
  onTeardown(() => { try { resetChartRouting(); } catch (_) {} });

  /* ── Panel toasts ──────────────────────────────────────────────────────────
   * ELI5: Little popup messages ("Bought 0.5 SOL", warnings, etc.). */

  if (!PanelToast) throw new Error('PaperTrench: panel/panel-toast.js must load before content/content.js');

  let toastApi = null;

  function toastCtx() {
    return {
      get shadow() { return shadow; },
      get contextDead() { return contextDead; },
      get els() { return els; },
      readPanelPos,
    };
  }

  function ensureToast() {
    if (!toastApi) toastApi = PanelToast.create(toastCtx());
    return toastApi;
  }

  function toast(msg) {
    return ensureToast().toast(msg);
  }

  /* ── Positions bar ─────────────────────────────────────────────────────────
   * ELI5: The row of coin chips at the bottom showing all your open trades. */

  if (!PanelBar) throw new Error('PaperTrench: panel/panel-bar.js must load before content/content.js');

  let barApi = null;

  function barCtx() {
    return {
      get host() { return host; },
      get shadow() { return shadow; },
      get els() { return els; },
      get state() { return state; },
      get token() { return token; },
      get site() { return site; },
      get settings() { return settings; },
      set settings(v) { settings = v; },
      contextAlive: () => contextAlive(),
      contextDead: () => contextDead,
      E, Q, S, R,
      store,
      clampBarPos,
      makeDraggable,
      onMountCleanup,
      reclampPanel,
      persistStateNow: (...a) => persistStateNow(...a),
      persistSoon: () => persistSoon(),
      renderBalance: () => renderBalance(),
    };
  }

  function ensureBar() {
    if (!barApi) barApi = PanelBar.create(barCtx());
    return barApi;
  }

  function renderPositionsBar() { return ensureBar().renderPositionsBar(); }
  async function pollPositionPrices() { return ensureBar().pollPositionPrices(); }
  function setBarHidden(hidden) { return ensureBar().setBarHidden(hidden); }
  function positionBar(measuredLeft) { return ensureBar().positionBar(measuredLeft); }
  function syncRailFade() { return ensureBar().syncRailFade(); }

  /* ── Position card ─────────────────────────────────────────────────────────
   * Open-position UI lives in panel/panel-position.js. */

  if (!PanelPosition) throw new Error('PaperTrench: panel/panel-position.js must load before content/content.js');

  let positionApi = null;

  function positionCtx() {
    return {
      get els() { return els; },
      get state() { return state; },
      get token() { return token; },
      E, Q,
      toast: (...a) => toast(...a),
      entryText: (p) => entryText(p),
      mcapAtPrice: (p) => mcapAtPrice(p),
      fmtMoney: (n) => fmtMoney(n),
      renderStatsBar: () => renderStatsBar(),
      renderHoldings: () => renderHoldings(),
    };
  }

  function ensurePosition() {
    if (!positionApi) positionApi = PanelPosition.create(positionCtx());
    return positionApi;
  }

  function renderPosition() { return ensurePosition().renderPosition(); }
  function invalidatePositionCard() { return ensurePosition().invalidateCard(); }

  /* ── Format helpers ────────────────────────────────────────────────────────
   * Readable price / MC text lives in panel/panel-format.js. */

  if (!PanelFormat) throw new Error('PaperTrench: panel/panel-format.js must load before content/content.js');

  let formatApi = null;

  function formatCtx() {
    return {
      get token() { return token; },
      Q,
    };
  }

  function ensureFormat() {
    if (!formatApi) formatApi = PanelFormat.create(formatCtx());
    return formatApi;
  }

  function trimSci(p) { return ensureFormat().trimSci(p); }
  function fmtMoney(n) { return ensureFormat().fmtMoney(n); }
  function mcapAtPrice(priceNative) { return ensureFormat().mcapAtPrice(priceNative); }
  function entryText(priceNative) { return ensureFormat().entryText(priceNative); }
  function panelUsd() { return ensureFormat().panelUsd(); }
  function panelUsdRate() { return ensureFormat().panelUsdRate(); }

  /* ── Chart fills (markers + average lines) ─────────────────────────────────
   * Fill drawing lives in panel/panel-chart-fills.js. */

  if (!PanelChartFills) throw new Error('PaperTrench: panel/panel-chart-fills.js must load before content/content.js');

  let chartFillsApi = null;

  function chartFillsCtx() {
    return {
      get token() { return token; },
      get site() { return site; },
      get settings() { return settings; },
      get state() { return state; },
      get chartAxisBasis() { return ensurePrice().chartAxisBasis; },
      drawnFillIds,
      E, Q, CM,
      usesNativeChart: () => usesNativeChart(),
      usesSvgMarkers: () => usesSvgMarkers(),
      genericChartPoint: (...a) => genericChartPoint(...a),
      sendPadreMarker: (...a) => sendPadreMarker(...a),
    };
  }

  function ensureChartFills() {
    if (!chartFillsApi) chartFillsApi = PanelChartFills.create(chartFillsCtx());
    return chartFillsApi;
  }

  function drawFillOnChart(fill) { return ensureChartFills().drawFillOnChart(fill); }
  function restoreMarkersFromJournal() { return ensureChartFills().restoreMarkersFromJournal(); }
  function maybeRepostAverageLines() { return ensureChartFills().maybeRepostAverageLines(); }
  function syncAveragePriceLines() { return ensureChartFills().syncAveragePriceLines(); }
  function resetLineThrottle() { return ensureChartFills().resetLineThrottle(); }
  function resetLinesState() { return ensureChartFills().resetLinesState(); }

  /* ── Trades (quotes, fills, armed buys) ────────────────────────────────────
   * ELI5: The cashier module — buy/sell buttons ultimately call into here. */

  if (!ContentTrade) throw new Error('PaperTrench: content/content-trade.js must load before content/content.js');

  let tradeApi = null;

  function tradeCtx() {
    return {
      get state() { return state; },
      set state(v) { state = v; },
      get settings() { return settings; },
      get token() { return token; },
      get site() { return site; },
      marks,
      drawnFillIds,
      get lastPriceAt() { return ensurePrice().lastPriceAt; },
      get pageQuoteSeq() { return ensurePrice().getPageQuoteSeq(); },
      get lastMcapTickAt() { return ensurePrice().lastMcapTickAt; },
      E, Q, R, CM, store,
      sendMessage: (...a) => sendMessage(...a),
      sendPadreMarker: (...a) => sendPadreMarker(...a),
      toast: (...a) => toast(...a),
      renderAll: () => renderAll(),
      renderBuyButton: () => renderBuyButton(),
      withState: (...a) => withState(...a),
      persistStateNow: (...a) => persistStateNow(...a),
      drawFillOnChart: (f) => drawFillOnChart(f),
      syncAveragePriceLines: () => syncAveragePriceLines(),
      // rugRefusalMessage: () => rugRefusalMessage(),
      waitForNewPageQuote: (...a) => waitForNewPageQuote(...a),
      panelUsd: () => panelUsd(),
      panelUsdRate: () => panelUsdRate(),
      fmtMoney: (n) => fmtMoney(n),
      mcapAtPrice: (p) => mcapAtPrice(p),
      usesSvgMarkers: () => usesSvgMarkers(),
      get barApi() { return barApi; },
      resetPositionMount: () => { if (positionApi && positionApi.resetMount) positionApi.resetMount(); },
      setLastWritten: (s) => ensureStorage().setLastWritten(s),
    };
  }

  function ensureTrade() {
    if (!tradeApi) tradeApi = ContentTrade.create(tradeCtx());
    return tradeApi;
  }

  function flushArmedBuy() { return ensureTrade().flushArmedBuy(); }
  function quickResetWallet() { return ensureTrade().quickResetWallet(); }
  function quoteSnapshot() { return ensureTrade().quoteSnapshot(); }
  function quoteFromOnchain(...a) { return ensureTrade().quoteFromOnchain(...a); }
  function corroborateForFill(...a) { return ensureTrade().corroborateForFill(...a); }
  function quoteForTrade() { return ensureTrade().quoteForTrade(); }
  function pickQuoteForTrade() { return ensureTrade().pickQuoteForTrade(); }
  function requestBuy(...a) { return ensureTrade().requestBuy(...a); }
  function doBuy(...a) { return ensureTrade().doBuy(...a); }
  function doSell(...a) { return ensureTrade().doSell(...a); }
  function summarizeSession(...a) { return ensureTrade().summarizeSession(...a); }
  function summarizeTrade(...a) { return ensureTrade().summarizeTrade(...a); }
  function summarizeRound(...a) { return ensureTrade().summarizeRound(...a); }
  function armedBuyExpired() { return ensureTrade().armedBuyExpired(); }

  /* ── Panel controls (mount / bind / render) ──────────────────────────────
   * UI shell wiring lives in panel/panel-controls.js. */

  if (!PanelControls) throw new Error('PaperTrench: panel/panel-controls.js must load before content/content.js');

  let controlsApi = null;

  function controlsCtx() {
    return {
      get host() { return host; },
      get shadow() { return shadow; },
      get els() { return els; },
      get state() { return state; },
      set state(v) { state = v; },
      get settings() { return settings; },
      set settings(v) { settings = v; },
      get token() { return token; },
      get site() { return site; },
      get armedBuy() { return ensureTrade().armedBuy; },
      set armedBuy(v) { ensureTrade().armedBuy = v; },
      get lastPriceAt() { return ensurePrice().lastPriceAt; },
      get pendingSince() { return ensureDetect().pendingSince; },
      get onchainLive() { return onchainLive; },
      contextDead: () => contextDead,
      mountHost(nextHost, nextShadow) { host = nextHost; shadow = nextShadow; },
      E, Q, store, sendMessage,
      HOST_ID, UI, ICONS, PT_AXIOM_UI, solLogo,
      MS_PER_SECOND, SECONDS_PER_MINUTE, SECONDS_PER_HOUR, CLOSED_AGO_JUST_NOW_SEC,
      clampOverlaySize: (...a) => clampOverlaySize(...a),
      makeDraggable: (...a) => makeDraggable(...a),
      clampPanelPos: (...a) => clampPanelPos(...a),
      readPanelPos: (...a) => readPanelPos(...a),
      applyPanelPos: (...a) => applyPanelPos(...a),
      reclampPanel: () => reclampPanel(),
      requestBuy: (...a) => requestBuy(...a),
      doSell: (...a) => doSell(...a),
      doBuy: (...a) => doBuy(...a),
      renderPosition: () => renderPosition(),
      renderPositionsBar: () => renderPositionsBar(),
      quickResetWallet: () => quickResetWallet(),
      withState: (...a) => withState(...a),
      persistStateNow: (...a) => persistStateNow(...a),
      setBarHidden: (...a) => setBarHidden(...a),
      bindBarUI: () => ensureBar().bindUI(),
      panelUsd: () => panelUsd(),
      panelUsdRate: () => panelUsdRate(),
      toast: (...a) => toast(...a),
    };
  }

  function ensureControls() {
    if (!controlsApi) controlsApi = PanelControls.create(controlsCtx());
    return controlsApi;
  }

  function createUI() { return ensureControls().createUI(); }
  function renderAll() { return ensureControls().renderAll(); }
  function renderPresets() { return ensureControls().renderPresets(); }
  function renderBalance() { return ensureControls().renderBalance(); }
  function renderHoldings() { return ensureControls().renderHoldings(); }
  function renderStatsBar() { return ensureControls().renderStatsBar(); }
  function renderHeader() { return ensureControls().renderHeader(); }
  function renderBuyButton() { return ensureControls().renderBuyButton(); }
  function renderClosedPnl() { return ensureControls().renderClosedPnl(); }
  function renderLiveDot() { return ensureControls().renderLiveDot(); }
  function renderSiteStatus() { return ensureControls().renderSiteStatus(); }
  function applyFocusMode() { return ensureControls().applyFocusMode(); }
  function applyOverlaySize() { return ensureControls().applyOverlaySize(); }
  function updateOverlayVisibility() { return ensureControls().updateOverlayVisibility(); }
  function setPanelVisible(visible) { return ensureControls().setPanelVisible(visible); }
  function togglePresetEditor(force) { return ensureControls().togglePresetEditor(force); }
  async function savePresetEditor() { return ensureControls().savePresetEditor(); }
  async function toggleOverlayAutoHide() { return ensureControls().toggleOverlayAutoHide(); }
  async function toggleOverlayEnabled() { return ensureControls().toggleOverlayEnabled(); }
  function onOverlayResizeStart(e, corner) { return ensureControls().onOverlayResizeStart(e, corner); }

  /* ── UI (shadow panel + positions bar) ───────────────────────────────────
   * ELI5: All the pretty stuff — CSS, icons, panel HTML shell. */

  if (!PanelUI) throw new Error('PaperTrench: panel/panel-ui.js must load before content/content.js');
  const UI = PanelUI;
  const PT_AXIOM_UI = UI.PT_AXIOM_UI;
  const ICONS = UI.ICONS;
  const solLogo = UI.solLogo;
  const usdcLogo = UI.usdcLogo;

  /* ── Panel drag system ─────────────────────────────────────────────────────
   * Clamp + makeDraggable live in panel/panel-drag.js (window.PTPanelDrag).
   * Thin wrappers close over els / settings / onMountCleanup. */

  if (!PanelDrag) throw new Error('PaperTrench: panel/panel-drag.js must load before content/content.js');

  let dragApi = null;
  function dragCtx() {
    return {
      get els() { return els; },
      get settings() { return settings; },
      onMountCleanup: (fn) => onMountCleanup(fn),
    };
  }
  function ensureDrag() {
    if (!dragApi) dragApi = PanelDrag.create(dragCtx());
    return dragApi;
  }

  function clampOverlaySize(...a) { return ensureDrag().clampOverlaySize(...a); }
  function clampPanelPos(...a) { return ensureDrag().clampPanelPos(...a); }
  function clampBarPos(...a) { return ensureDrag().clampBarPos(...a); }
  function readPanelPos() { return ensureDrag().readPanelPos(); }
  function applyPanelPos(...a) { return ensureDrag().applyPanelPos(...a); }
  function reclampPanel() { return ensureDrag().reclampPanel(); }
  function makeDraggable(...a) { return ensureDrag().makeDraggable(...a); }

  if (contextAlive()) chrome.runtime.onMessage.addListener((msg) => {
    if (contextDead) return;
    if (msg?.type === 'pt_toggle_overlay') {
      // The popup / toolbar toggle flips the master overlay switch, so the
      // user can turn the whole thing on or off from the browser action.
      toggleOverlayEnabled().catch(() => {});
    }
  });

  /* ── Overlay lifecycle ─────────────────────────────────────────────────────
   * ELI5: Turn the whole floating panel on or off — mount, timers, teardown. */

  if (!PanelOverlay) throw new Error('PaperTrench: panel/panel-overlay.js must load before content/content.js');

  let overlayApi = null;

  function resetPanelMounts() {
    try { if (barApi && barApi.resetMount) barApi.resetMount(); } catch (_) {}
    barApi = null;
    try { if (positionApi && positionApi.resetMount) positionApi.resetMount(); } catch (_) {}
    positionApi = null;
    try { if (controlsApi && controlsApi.resetMount) controlsApi.resetMount(); } catch (_) {}
    controlsApi = null;
    try { if (toastApi && toastApi.reset) toastApi.reset(); } catch (_) {}
    toastApi = null;
    try { if (chartFillsApi) chartFillsApi.resetLinesState(); } catch (_) {}
    chartFillsApi = null;
    try { if (tradeApi && tradeApi.resetMount) tradeApi.resetMount(); } catch (_) {}
    tradeApi = null;
    dragApi = null;
  }

  function overlayCtx() {
    return {
      get host() { return host; },
      get token() { return token; },
      set token(v) { token = v; },
      get armedBuy() { return ensureTrade().armedBuy; },
      set armedBuy(v) { ensureTrade().armedBuy = v; },
      get onchainLive() { return onchainLive; },
      set onchainLive(v) { onchainLive = v; },
      get lastHref() { return ensureDetect().lastHref; },
      set lastHref(v) { ensureDetect().lastHref = v; },
      get lastWantsTicks() { return ensureBridge().lastWantsTicks; },
      set lastWantsTicks(v) { ensureBridge().lastWantsTicks = v; },
      get pendingSince() { return ensureDetect().pendingSince; },
      get resolving() { return ensureDetect().resolving; },
      drawnFillIds,
      resetChartRouting: () => resetChartRouting(),
      resetLinesState: () => resetLinesState(),
      contextAlive: () => contextAlive(),
      CM,
      R,
      DETECT_MS,
      FAST_RETRY_MS,
      FAST_RETRY_WINDOW_MS,
      BAR_SCAN_MS,
      createUI: () => createUI(),
      managedInterval: (...a) => managedInterval(...a),
      stopPriceLoop: () => stopPriceLoop(),
      detectLoop: () => detectLoop(),
      pollPositionPrices: () => pollPositionPrices(),
      renderPositionsBar: () => renderPositionsBar(),
      ensureBar: () => ensureBar(),
      sendPadreMarker: (...a) => sendPadreMarker(...a),
      removeHost() {
        try { if (host && host.remove) host.remove(); } catch (_) {}
        host = null; shadow = null; els = {};
      },
      resetPanelMounts: () => resetPanelMounts(),
    };
  }

  function ensureOverlay() {
    if (!overlayApi) overlayApi = PanelOverlay.create(overlayCtx());
    return overlayApi;
  }

  function onMountCleanup(fn) { return ensureOverlay().onMountCleanup(fn); }
  function runMountCleanups() { return ensureOverlay().runMountCleanups(); }
  function onRouteChange() { return ensureOverlay().onRouteChange(); }
  function stopOverlays() { return ensureOverlay().stopOverlays(); }
  async function enableOverlay() { return ensureOverlay().enableOverlay(); }
  function disableOverlay() { return ensureOverlay().disableOverlay(); }

  onTeardown(() => {
    try { if (overlayApi) overlayApi.runMountCleanups(); } catch (_) {}
  });

  /** ELI5: Startup — load wallet, watch for settings changes, show panel if enabled. */
  async function init() {
    // price-bridge.js is declared by the manifest in MAIN world at
    // document_start, before Padre creates its WebSocket and TradingView feed.
    await reloadState();
    // Storage must be watched even when the overlay is disabled, so toggling
    // settings from the dashboard or popup reaches this tab immediately.
    watchStorage();
    // The PAPER master switch outranks every paper sub-setting: off means
    // no paper surface mounts at all until the user turns it back on.
    if (settings.appEnabled === false || !settings.overlayEnabled) return;
    await enableOverlay();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init().catch(() => {}));
  else init().catch(() => {});
})();


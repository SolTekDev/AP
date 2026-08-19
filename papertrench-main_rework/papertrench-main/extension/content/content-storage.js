/* PaperTrench — wallet state persistence + cross-tab CAS sync for content.js.
 * Loaded before content.js. Factory: window.PTContentStorage.create(ctx).
 *
 * ELI5: Your pretend wallet (positions, balance, trades) lives in a shared
 * notebook (chrome.storage). This file makes sure only one tab writes at a
 * time, never loses a trade, and every tab shows the same numbers.
 */
(() => {
  'use strict';

  function create(ctx) {
    // ELI5: A line of kids waiting to touch the notebook — one change at a time.
    let mutationChain = Promise.resolve();
    // ELI5: Timer that says "save soon" instead of saving after every tiny wiggle.
    let persistTimer = null;
    let lastWrittenState = null;
    // ELI5: Our fingerprint on the last save — so we don't think OUR save was
    // someone else's and reload ourselves for no reason.
    let lastWrittenStamp = null;

    // ELI5: "Do something to the wallet, but wait your turn and reload first."
    function withState(fn) {
      const run = mutationChain.then(async () => { await reloadState(); return fn(); });
      mutationChain = run.catch(() => {});
      return run;
    }

    // ELI5: Read the notebook from storage into memory.
    async function reloadState() {
      const stored = await ctx.store.get([ctx.E.STORAGE_KEYS.state, ctx.E.STORAGE_KEYS.settings]);
      if (stored === null) return;
      ctx.settings = ctx.E.mergeSettings(stored[ctx.E.STORAGE_KEYS.settings]);
      if (stored[ctx.E.STORAGE_KEYS.state]) ctx.state = stored[ctx.E.STORAGE_KEYS.state];
    }

    /**
     * ELI5: Another tab (or the popup) changed the wallet — copy their version
     * and redraw everything on screen so you see the truth.
     */
    function adoptState(next) {
      const token = ctx.token;
      const state = ctx.state;
      const hadPosition = Boolean(token && state.positions && state.positions[token.mint]);
      ctx.state = next;
      const hasPosition = Boolean(token && ctx.state.positions && ctx.state.positions[token.mint]);
      if (hadPosition !== hasPosition) ctx.invalidatePositionCard();

      ctx.renderBalance();
      ctx.renderPosition();
      ctx.renderClosedPnl();
      ctx.renderPositionsBar();
      ctx.syncAveragePriceLines();
      ctx.restoreMarkersFromJournal();
    }

    /**
     * ELI5: Save the wallet RIGHT NOW, with a safety check: if another tab saved
     * while we were working, grab their version, merge our change back in, and
     * try again — so nobody's trade gets erased.
     */
    async function persistStateNow(remutate) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const state = ctx.state;
        state.seq = (Number(state.seq) || 0) + 1;
        state.updatedAt = Date.now();
        lastWrittenState = state;
        lastWrittenStamp = `${state.seq}:${state.updatedAt}`;
        const reply = await ctx.sendMessage({
          type: 'pt_state_commit', state, expectedSeq: state.seq - 1,
        }).catch(() => null);
        if (reply && reply.ok) return;
        if (!reply || reply.reason !== 'stale' || !reply.current) {
          await ctx.store.set({ [ctx.E.STORAGE_KEYS.state]: state });
          return;
        }
        adoptState(reply.current);
        const token = ctx.token;
        if (token && token.mint && Number(token.priceNative) > 0) {
          ctx.E.markPosition(ctx.state, token.mint, token.priceNative, token.priceUsd);
        }
        if (ctx.eachLivePositionPrice) {
          ctx.eachLivePositionPrice((mint, p) => {
            ctx.E.markPosition(ctx.state, mint, p.priceNative, p.priceUsd);
          });
        }
        if (remutate) await remutate();
      }
      throw new Error('The wallet kept changing under this write — please retry');
    }

    /**
     * ELI5: Listen for changes to settings or wallet from other tabs/popup.
     * When something changes, update our screen immediately.
     */
    function watchStorage() {
      if (!ctx.contextAlive() || !chrome.storage || !chrome.storage.onChanged) return;
      const listener = (changes, area) => {
        if (ctx.contextDead || area !== 'local') return;

        const settingsChange = changes[ctx.E.STORAGE_KEYS.settings];
        if (settingsChange && settingsChange.newValue) {
          ctx.settings = ctx.E.mergeSettings(settingsChange.newValue);
          const barApi = ctx.barApi;
          if (barApi) barApi.syncFromSettings();
          if (ctx.settings.appEnabled !== false && ctx.settings.overlayEnabled) ctx.enableOverlay().catch(() => {});
          else ctx.disableOverlay();
          if (ctx.els && ctx.els.buyPresets) ctx.renderPresets();
          ctx.syncAveragePriceLines();
          ctx.updateOverlayVisibility();
          ctx.applyOverlaySize();
          ctx.renderPositionsBar();
          ctx.publishPageState();
        }

        const rpcNotice = changes.pt_rpc_notice;
        if (rpcNotice && rpcNotice.newValue && !rpcNotice.oldValue) {
          const ms = Number(rpcNotice.newValue.bestMs) || 0;
          ctx.toast('Heads-up: the public price connection is slow from your region'
            + (ms ? ` (~${ms}ms)` : '')
            + '. A free personal RPC endpoint in settings can make new coins faster.');
        }

        const stateChange = changes[ctx.E.STORAGE_KEYS.state];
        if (!stateChange) return;
        const next = stateChange.newValue;
        if (!next || next === ctx.state) return;
        if (lastWrittenState && next === lastWrittenState) return;
        if (lastWrittenStamp && `${next.seq}:${next.updatedAt}` === lastWrittenStamp) return;

        adoptState(next);
      };
      chrome.storage.onChanged.addListener(listener);
      ctx.onTeardown(() => {
        try { chrome.storage.onChanged.removeListener(listener); } catch (_) {}
      });
    }

    // ELI5: "Save in about 0.8 seconds" — batches tiny updates so we don't spam storage.
    function persistSoon() {
      if (persistTimer) return;
      persistTimer = setTimeout(async () => {
        persistTimer = null;
        if (!ctx.contextAlive()) { ctx.shutdown('invalidated'); return; }
        const stored = await ctx.store.get([ctx.E.STORAGE_KEYS.state]);
        if (stored === null) return;
        const storedState = stored[ctx.E.STORAGE_KEYS.state];
        if (storedState && Number(storedState.seq) > Number(ctx.state.seq)) {
          adoptState(storedState);
          const token = ctx.token;
          if (token && token.mint && Number(token.priceNative) > 0) {
            ctx.E.markPosition(ctx.state, token.mint, token.priceNative, token.priceUsd);
          }
          if (ctx.eachLivePositionPrice) {
            ctx.eachLivePositionPrice((mint, p) => {
              ctx.E.markPosition(ctx.state, mint, p.priceNative, p.priceUsd);
            });
          }
        }
        await persistStateNow();
      }, 800);
    }

    function resetMount() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      mutationChain = Promise.resolve();
      lastWrittenState = null;
      lastWrittenStamp = null;
    }

    function setLastWritten(s) {
      lastWrittenState = s;
      lastWrittenStamp = `${s.seq}:${s.updatedAt}`;
    }

    return {
      withState,          // queue a wallet change
      reloadState,        // read notebook from storage
      adoptState,         // accept another tab's wallet
      persistStateNow,    // save immediately (with conflict retry)
      watchStorage,       // listen for cross-tab changes
      persistSoon,        // save soon (debounced)
      resetMount,
      setLastWritten,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTContentStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

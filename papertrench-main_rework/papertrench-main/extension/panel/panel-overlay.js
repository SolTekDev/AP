/* PaperTrench — overlay mount / teardown lifecycle.
 * Loaded before content.js. Factory: window.PTPanelOverlay.create(ctx).
 *
 * enableOverlay() is idempotent: watchStorage may call it on every settings
 * write, so a live host short-circuits before stacking timers (DEFECT O-05).
 * disableOverlay() is the full off-cycle teardown — timers, per-mount listeners,
 * chart artifacts, pool subscriptions, and panel module mounts.
 *
 * ELI5: Turns the whole PaperTrench panel on and off. When you enable it,
 * this builds the UI, starts the timers that watch prices, and hooks up
 * listeners. When you disable it, it cleans everything up so nothing leaks.
 */
(() => {
  'use strict';

  function create(ctx) {
    /* Listeners and timers created per MOUNT must die with that mount, not with
     * the page: each overlay off→on cycle used to leak window mousemove+mouseup
     * pairs that survived shutdown() (DEFECT O-26). */
    const mountCleanups = [];
    let restartBarSettle = null;

    let fastDetectTimer = null;
    let detectLoopTimer = null;
    let barScanTimer = null;
    let bridgePingTimer = null;

    function onMountCleanup(fn) { mountCleanups.push(fn); }

    function runMountCleanups() {
      for (const fn of mountCleanups.splice(0)) {
        try { fn(); } catch (_) { /* keep cleaning */ }
      }
    }

    /** Re-measure positions-bar inset after SPA nav (DEFECT O-15). */
    function onRouteChange() {
      if (restartBarSettle) restartBarSettle();
    }

    function stopOverlays() {
      ctx.stopPriceLoop();
      if (fastDetectTimer) { clearInterval(fastDetectTimer); fastDetectTimer = null; }
      if (detectLoopTimer) { clearInterval(detectLoopTimer); detectLoopTimer = null; }
      if (barScanTimer) { clearInterval(barScanTimer); barScanTimer = null; }
      if (bridgePingTimer) { clearInterval(bridgePingTimer); bridgePingTimer = null; }
    }

    // ELI5: Turn on the panel, start timers, and begin watching the page.
    async function enableOverlay() {
      if (ctx.host) return;
      ctx.createUI();
      if (!detectLoopTimer) detectLoopTimer = ctx.managedInterval(ctx.detectLoop, ctx.DETECT_MS);

      // DEFECT O-15: sample bar inset until measurement stabilizes.
      restartBarSettle = ctx.ensureBar().startBarSettle(onMountCleanup);
      onMountCleanup(() => { restartBarSettle = null; });

      // O-18: window resize re-clamps both floating elements.
      const onWindowResize = () => ctx.ensureBar().onWindowResize();
      window.addEventListener('resize', onWindowResize);
      onMountCleanup(() => { try { window.removeEventListener('resize', onWindowResize); } catch (_) {} });

      // MAIN-world bridge liveness ping (O-04/C-17).
      if (!bridgePingTimer) bridgePingTimer = ctx.managedInterval(() => ctx.sendPadreMarker('bridge-ping'), 30_000);
      const onVisibleAgain = () => { if (!document.hidden && ctx.contextAlive()) ctx.sendPadreMarker('bridge-ping'); };
      document.addEventListener('visibilitychange', onVisibleAgain);
      onMountCleanup(() => { try { document.removeEventListener('visibilitychange', onVisibleAgain); } catch (_) {} });

      // Fresh-launch sniping cadence while token is pending.
      if (!fastDetectTimer) fastDetectTimer = ctx.managedInterval(() => {
        const token = ctx.token;
        if (!token || !token.pending || ctx.resolving) return;
        if (ctx.pendingSince && Date.now() - ctx.pendingSince > ctx.FAST_RETRY_WINDOW_MS) return;
        ctx.detectLoop();
      }, ctx.FAST_RETRY_MS);

      // Positions bar runs independent of token detection.
      if (!barScanTimer) barScanTimer = ctx.managedInterval(() => {
        ctx.pollPositionPrices();
        ctx.renderPositionsBar();
      }, ctx.BAR_SCAN_MS);
      ctx.pollPositionPrices();

      await ctx.detectLoop();
    }

    // ELI5: Turn everything off and clean up so nothing is left running.
    function disableOverlay() {
      if (!ctx.host) return;
      stopOverlays();
      runMountCleanups();
      const token = ctx.token;
      if (token && token.mint) ctx.R.onchainUnwatch(token.mint);
      ctx.onchainLive = false;
      if (ctx.CM) ctx.CM.destroyChartMarkers();
      ctx.sendPadreMarker('paper-marker-clear');
      ctx.sendPadreMarker('paper-lines-clear');
      ctx.sendPadreMarker('gmgn-lines-clear');
      ctx.drawnFillIds.clear();
      ctx.sendPadreMarker('standdown');
      ctx.token = null;
      ctx.armedBuy = null;
      ctx.lastHref = '';
      ctx.lastWantsTicks = null;
      ctx.resetChartRouting();
      ctx.resetLinesState();
      ctx.removeHost();
      ctx.resetPanelMounts();
    }

    return {
      onMountCleanup,
      runMountCleanups,
      onRouteChange,
      stopOverlays,
      enableOverlay,
      disableOverlay,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTPanelOverlay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

/* PaperTrench — MAIN-world bridge message handler.
 * Loaded before content.js. Factory: window.PTContentBridge.create(ctx).
 *
 * ELI5: Imagine the trading website is one room and PaperTrench is another.
 * This file is the little mail slot between them. The website's own scripts
 * (in the MAIN world) drop notes through the slot — "here's a new price",
 * "the user changed pages". We read those notes and tell the rest of
 * PaperTrench what to do.
 */
(() => {
  'use strict';

  // ELI5: When the page jumps around fast (like flipping book pages), wait a
  // tiny beat before we look again so we don't check a hundred times at once.
  const DETECT_DEBOUNCE_MS = 30; // coalesce pushState bursts (O-14)

  function create(ctx) {
    // ELI5: Little sticky notes about what the chart hooks are doing right now.
    let padreHookStatus = { barsHooked: false, marksHooked: false, linesReady: false };
    let lastMarkerStatus = null;
    let lastLineStatus = null;

    /* ELI5: Some sites change the page without reloading (like an app). When
     * the address bar changes, we need to notice quickly and ask "which coin
     * are we on now?" instead of waiting for the slow timer. */
    let navDetectTimer = null;
    /** Debounced detectLoop trigger for SPA route changes (O-14). */
    function scheduleDetect() {
      if (navDetectTimer) return;
      navDetectTimer = setTimeout(() => {
        navDetectTimer = null;
        if (!ctx.contextAlive()) return;
        ctx.detectLoop();
      }, DETECT_DEBOUNCE_MS);
    }
    const onNavEvent = () => {
      scheduleDetect();
      ctx.onRouteChange();
    };

    /** ELI5: The mail slot handler — every note from the bridge lands here. */
    function onBridgeMessage(event) {
      // ELI5: Only accept mail from our own window, with our secret stamp on it.
      // Random websites or other tabs can't sneak fake messages in.
      if (event.source !== window || !event.data || event.data.source !== 'papertrench-bridge') return;
      if (event.origin && event.origin !== location.origin) return;
      const ev = event.data;

      if (ev.type === 'tick') {
        // ELI5: "Hey, the price moved!" — pass it to the main price tracker.
        ctx.handlePageTick(ev.payload);
      }
      else if (ev.type === 'nav') {
        // ELI5: The page moved to a new URL without a full reload — look for the new coin.
        scheduleDetect();
        ctx.onRouteChange();
      }
      else if (ev.type === 'padre-hook-status') {
        // ELI5: The chart hooks report in: "I attached to the bars / marks / lines!"
        padreHookStatus = { ...padreHookStatus, ...(ev.payload || {}) };
        ctx.noteNativeCapability(ev.payload);
        ctx.renderSiteStatus();
      } else if (ev.type === 'paper-marker-status') {
        // ELI5: Update about buy/sell dots drawn on the chart.
        lastMarkerStatus = ev.payload || null;
        ctx.renderSiteStatus();
      } else if (ev.type === 'paper-lines-status') {
        // ELI5: Update about average-price lines on the chart.
        lastLineStatus = ev.payload || null;
        ctx.renderSiteStatus();
      } else if (ev.type === 'gmgn-lines-status') {
        // ELI5: GMGN's chart said something changed — refresh the status display.
        ctx.renderSiteStatus();
      }
    }

    /* ELI5: Tell the bridge "yes, I need live prices" or "no, you can nap".
     * We need prices when you're on a coin page. Otherwise the bridge would
     * waste work reading price data nobody uses. */
    let lastWantsTicks = null;
    function publishPageState() {
      const token = ctx.token;
      const wants = Boolean(token);
      if (wants === lastWantsTicks) return;
      lastWantsTicks = wants;
      ctx.sendPadreMarker('page-state', { wantsTicks: wants });
    }

    // ELI5: Did we already plug in our ears to listen? Don't plug them in twice.
    let bound = false;

    function bind() {
      if (bound) return;
      bound = true;
      // ELI5: Listen for back-button / hash URL changes (page moved without reload).
      window.addEventListener('popstate', onNavEvent, true);
      window.addEventListener('hashchange', onNavEvent, true);
      // ELI5: Listen for all the bridge mail slot messages.
      window.addEventListener('message', onBridgeMessage);
      ctx.onTeardown(() => unbind());
    }

    function unbind() {
      if (!bound) return;
      bound = false;
      // ELI5: Unplug all our ears when the overlay goes away — no memory leaks.
      try { window.removeEventListener('popstate', onNavEvent, true); } catch (_) {}
      try { window.removeEventListener('hashchange', onNavEvent, true); } catch (_) {}
      try { window.removeEventListener('message', onBridgeMessage); } catch (_) {}
      if (navDetectTimer) { clearTimeout(navDetectTimer); navDetectTimer = null; }
    }

    function resetMount() {
      // ELI5: Fresh start — forget whether we already told the bridge about tick demand.
      lastWantsTicks = null;
    }

    // ELI5: Let other parts of PaperTrench peek at the latest hook/status sticky notes.
    function getPadreHookStatus() { return padreHookStatus; }
    function getLastMarkerStatus() { return lastMarkerStatus; }
    function getLastLineStatus() { return lastLineStatus; }

    return {
      bind,                  // plug in listeners
      unbind,                // unplug listeners
      scheduleDetect,        // "page changed, look for coin soon"
      publishPageState,      // tell bridge if we want live prices
      getPadreHookStatus,
      getLastMarkerStatus,
      getLastLineStatus,
      resetMount,
      get lastWantsTicks() { return lastWantsTicks; },
      set lastWantsTicks(v) { lastWantsTicks = v; },
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTContentBridge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

/* PaperTrench — chart routing (native TV vs SVG rail vs GMGN).
 * Loaded before content.js. Factory: window.PTPanelChartRouting.create(ctx).
 *
 * Owns probe state (C-19/C-20), axis point mapping (C-09), and the
 * content→MAIN bridge postMessage helper.
 *
 * ELI5: Different trading sites have different charts. This file picks
 * the right way to draw on each one — the site's own chart if we can hook
 * it, otherwise our backup drawing layer. It also passes notes between
 * PaperTrench and the page's scripts.
 */
(() => {
  'use strict';

  // ELI5: These sites already have a chart we can draw on directly.
  const NATIVE_TV_SITES = new Set(['padre', 'axiom']);
  const NATIVE_PROBE_GRACE_MS = 8000;

  function create(ctx) {
    let bridgeNativeCapable = false;
    let nativeProbeStartedAt = 0;
    let nativeProbeTimer = null;
    let svgFallbackActive = false;

    // ELI5: Send a note to the page's scripts (the "mail slot").
    function sendPadreMarker(type, payload) {
      window.postMessage({ source: 'papertrench-content', type, payload: payload || null }, '*');
    }

    function nativeChartPending() {
      const site = ctx.site;
      if (!site || bridgeNativeCapable) return false;
      if (NATIVE_TV_SITES.has(site.id) || site.id === 'gmgn') return false;
      return nativeProbeStartedAt > 0 && Date.now() - nativeProbeStartedAt < NATIVE_PROBE_GRACE_MS;
    }

    // ELI5: Can we draw directly on this site's chart, or do we need backup?
    function usesNativeChart() {
      const site = ctx.site;
      if (!site) return false;
      if (NATIVE_TV_SITES.has(site.id)) return true;
      if (site.id === 'gmgn') return false;
      return bridgeNativeCapable || nativeChartPending();
    }

    function usesSvgMarkers() {
      return Boolean(ctx.CM) && !usesNativeChart() && !(ctx.site && ctx.site.id === 'gmgn');
    }

    // ELI5: Turn a trade price into the right number for this chart's axis.
    function genericChartPoint(priceNative, priceUsd, mcap) {
      const token = ctx.token;
      const site = ctx.site;
      const usd = Number(priceUsd) > 0 ? Number(priceUsd) : null;
      const liveSupply = token && Number(token.mcap) > 0 && Number(token.priceUsd) > 0
        ? Number(token.mcap) / Number(token.priceUsd)
        : null;
      const chartMcap = Number(mcap) > 0 ? Number(mcap)
        : (liveSupply && usd > 0 ? usd * liveSupply : null);

      if (chartMcap > 0) {
        const plot = site && site.id === 'gmgn' ? chartMcap : (usd || Number(priceNative));
        return { plot, display: chartMcap, currency: 'MCAP' };
      }
      const fallback = usd || Number(priceNative);
      return { plot: fallback, display: fallback, currency: usd ? 'USD' : 'SOL' };
    }

    // ELI5: Wait a few seconds to see if the site's chart hooks respond.
    function beginNativeProbe() {
      if (nativeProbeTimer) { clearTimeout(nativeProbeTimer); nativeProbeTimer = null; }
      svgFallbackActive = false;
      const site = ctx.site;
      if (!site || NATIVE_TV_SITES.has(site.id) || site.id === 'gmgn' || bridgeNativeCapable) {
        nativeProbeStartedAt = 0;
        return;
      }
      nativeProbeStartedAt = Date.now();
      nativeProbeTimer = setTimeout(() => {
        nativeProbeTimer = null;
        if (ctx.contextDead() || bridgeNativeCapable || !ctx.token) return;
        svgFallbackActive = true;
        sendPadreMarker('paper-marker-clear');
        sendPadreMarker('paper-lines-clear');
        ctx.drawnFillIds.clear();
        if (ctx.CM && usesSvgMarkers()) {
          ctx.CM.clearMarkers();
          ctx.CM.initChartMarkers();
          ctx.restoreMarkersFromJournal();
          ctx.syncAveragePriceLines();
        }
      }, NATIVE_PROBE_GRACE_MS);
    }

    function noteNativeCapability(payload) {
      if (!payload || bridgeNativeCapable) return;
      if (!(payload.nativeCapable || payload.barsHooked || payload.marksHooked)) return;
      bridgeNativeCapable = true;
      if (nativeProbeTimer) { clearTimeout(nativeProbeTimer); nativeProbeTimer = null; }
      const site = ctx.site;
      if (!site || NATIVE_TV_SITES.has(site.id) || site.id === 'gmgn') return;
      if (svgFallbackActive) {
        svgFallbackActive = false;
        if (ctx.CM) ctx.CM.destroyChartMarkers();
        ctx.drawnFillIds.clear();
        ctx.restoreMarkersFromJournal();
        ctx.syncAveragePriceLines();
      }
    }

    function resetProbe() {
      if (nativeProbeTimer) { clearTimeout(nativeProbeTimer); nativeProbeTimer = null; }
      nativeProbeStartedAt = 0;
      svgFallbackActive = false;
    }

    function resetMount() {
      resetProbe();
      // bridgeNativeCapable is a page property and survives overlay off→on.
    }

    return {
      sendPadreMarker,
      nativeChartPending,
      usesNativeChart,
      usesSvgMarkers,
      genericChartPoint,
      beginNativeProbe,
      noteNativeCapability,
      resetProbe,
      resetMount,
      NATIVE_TV_SITES,
      NATIVE_PROBE_GRACE_MS,
    };
  }

  const api = { create, NATIVE_TV_SITES, NATIVE_PROBE_GRACE_MS };
  if (typeof window !== 'undefined') window.PTPanelChartRouting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

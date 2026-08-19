/* PaperTrench — chart fill markers + average-price lines.
 * Loaded before content.js. Factory: window.PTPanelChartFills.create(ctx).
 *
 * Draws buy/sell fills on the site's native chart (Padre/Axiom/GMGN) or the
 * SVG rail fallback, and keeps average-entry lines tracking the live market
 * (DEFECT C-01).
 *
 * ELI5: When you buy or sell, this draws little dots on the chart where
 * it happened and keeps horizontal lines at your average buy/sell price.
 * The dots stick to the chart when you scroll — like sticky notes on the
 * right candle.
 */
(() => {
  'use strict';

  // ELI5: Don't redraw the average lines every millisecond — wait a beat.
  // Heartbeat only (not on price moves): the bridge locks the line Y to the
  // fill average until another buy/sell changes it.
  const LINE_REPOST_MS = 2000;

  function create(ctx) {
    let lastLineSpecPostAt = 0;
    let lastLineSpecPrice = 0;
    let lastLinesActive = false;

    function resetLineThrottle() {
      lastLineSpecPostAt = 0;
      lastLineSpecPrice = 0;
    }

    function resetLinesState() {
      lastLinesActive = false;
      resetLineThrottle();
    }

    /**
     * Draw a fill on the site's own chart.
     *
     * Padre and Axiom take native TradingView marks; GMGN takes a native
     * execution shape positioned on its market-cap axis. Only sites with no
     * usable chart API fall back to the SVG overlay, because a native shape is
     * the only thing that stays glued to its candle through pan and zoom.
     */
    // ELI5: Put a buy/sell dot on the chart at the price you traded.
    function drawFillOnChart(fill) {
      const token = ctx.token;
      const site = ctx.site;
      const markerTs = fill.ts;
      const point = ctx.genericChartPoint(fill.priceNative, fill.priceUsd, fill.mcap);

      if (ctx.usesNativeChart()) {
        ctx.sendPadreMarker('paper-marker', {
          ts: markerTs,
          fillId: fill.fillId || null,
          priceNative: fill.priceNative,
          priceUsd: fill.priceUsd || null,
          mcap: point.currency === 'MCAP' ? point.display : null,
          side: fill.side,
          solAmount: fill.solAmount,
          symbol: token && token.symbol,
        });
        return;
      }

      if (site && site.id === 'gmgn') {
        const hasCap = point.currency === 'MCAP';
        ctx.sendPadreMarker('gmgn-marker', {
          ts: markerTs,
          mcap: hasCap ? point.display : null,
          priceNative: Number(fill.priceNative) > 0 ? Number(fill.priceNative) : null,
          side: fill.side,
          text: hasCap
            ? `${fill.side === 'buy' ? 'PT Buy' : 'PT Sell'} ${ctx.Q.formatMarketCap(point.display)}`
            : (fill.side === 'buy' ? 'PT Buy' : 'PT Sell'),
        });
        return;
      }

      if (ctx.CM) {
        ctx.CM.addMarker({
          ts: markerTs,
          price: point.plot,
          displayPrice: point.display,
          side: fill.side,
          solAmount: fill.solAmount,
          symbol: token && token.symbol,
          currency: point.currency,
        });
      }
    }

    // ELI5: After a page reload, redraw all your old buy/sell dots from memory.
    function restoreMarkersFromJournal() {
      const token = ctx.token;
      if (!token || !token.mint) return;
      const fills = (ctx.state.journal || []).filter(
        (t) => t.mint === token.mint && (t.side === 'buy' || t.side === 'sell')
      ).reverse();
      for (const f of fills) {
        if (f.id && ctx.drawnFillIds.has(f.id)) continue;
        if (f.id) ctx.drawnFillIds.add(f.id);
        drawFillOnChart({
          ts: f.ts,
          fillId: f.id,
          side: f.side,
          priceNative: f.priceNative,
          priceUsd: f.priceUsd,
          mcap: f.mcap,
          solAmount: f.solGross,
        });
      }
    }

    function maybeRepostAverageLines() {
      const token = ctx.token;
      if (!lastLinesActive || !token || !(Number(token.priceNative) > 0)) return;
      const now = Date.now();
      // Only a slow heartbeat — never on every price tick. Live price must not
      // drive avg-line updates; the bridge locks Y to the fill average until
      // the next buy/sell. Reposts only refresh conversion inputs while the
      // first lock is still waiting on a chart close.
      if (now - lastLineSpecPostAt < LINE_REPOST_MS) return;
      syncAveragePriceLines();
    }

    // ELI5: Keep the average buy/sell lines glued to the right height on the chart.
    function syncAveragePriceLines() {
      const token = ctx.token;
      const site = ctx.site;
      const settings = ctx.settings;
      if (!settings.averagePriceLinesEnabled || !token || !token.mint) {
        lastLinesActive = false;
        if (ctx.usesNativeChart()) ctx.sendPadreMarker('paper-lines-clear');
        if (site && site.id === 'gmgn') ctx.sendPadreMarker('gmgn-lines-clear');
        if (ctx.CM && site && !ctx.usesNativeChart()) ctx.CM.clearAverageLines();
        return;
      }

      const averages = ctx.E.averageFillPrices(ctx.state, token.mint);
      if (!averages) {
        lastLinesActive = false;
        if (ctx.usesNativeChart()) ctx.sendPadreMarker('paper-lines-clear');
        if (site && site.id === 'gmgn') ctx.sendPadreMarker('gmgn-lines-clear');
        if (ctx.CM && site && !ctx.usesNativeChart()) ctx.CM.clearAverageLines();
        return;
      }

      lastLinesActive = true;
      lastLineSpecPostAt = Date.now();
      lastLineSpecPrice = Number(token.priceNative) || 0;

      const usdPerNative = Number(token.priceUsd) > 0 && Number(token.priceNative) > 0
        ? Number(token.priceUsd) / Number(token.priceNative)
        : null;
      const avgBuyUsd = Number(averages.avgBuyUsd) > 0
        ? averages.avgBuyUsd
        : (usdPerNative && Number(averages.avgBuyNative) > 0 ? averages.avgBuyNative * usdPerNative : null);
      const avgSellUsd = Number(averages.avgSellUsd) > 0
        ? averages.avgSellUsd
        : (usdPerNative && Number(averages.avgSellNative) > 0 ? averages.avgSellNative * usdPerNative : null);

      if (ctx.usesNativeChart()) {
        const nativeSupply = Number(token.mcap) > 0 && Number(token.priceUsd) > 0
          ? Number(token.mcap) / Number(token.priceUsd)
          : null;
        ctx.sendPadreMarker('paper-lines', {
          enabled: true,
          axisBasis: ctx.chartAxisBasis,
          currentPriceNative: token.priceNative,
          currentPriceUsd: token.priceUsd,
          currentMcap: Number(token.mcap) > 0 ? Number(token.mcap) : null,
          avgBuyUsd,
          avgSellUsd,
          avgBuyMcap: nativeSupply && avgBuyUsd ? avgBuyUsd * nativeSupply : null,
          avgSellMcap: nativeSupply && avgSellUsd ? avgSellUsd * nativeSupply : null,
          avgBuyNative: Number(averages.avgBuyNative) > 0
            ? averages.avgBuyNative
            : (usdPerNative && avgBuyUsd ? avgBuyUsd / usdPerNative : null),
          avgSellNative: Number(averages.avgSellNative) > 0
            ? averages.avgSellNative
            : (usdPerNative && avgSellUsd ? avgSellUsd / usdPerNative : null),
          avgBuyMcapNative: nativeSupply && Number(averages.avgBuyNative) > 0
            ? averages.avgBuyNative * nativeSupply
            : null,
          avgSellMcapNative: nativeSupply && Number(averages.avgSellNative) > 0
            ? averages.avgSellNative * nativeSupply
            : null,
        });
      }

      if (ctx.CM && !ctx.usesNativeChart()) {
        if (site && site.id === 'gmgn') {
          const supply = Number(token.mcap) > 0 && Number(token.priceUsd) > 0
            ? Number(token.mcap) / Number(token.priceUsd)
            : null;
          ctx.sendPadreMarker('gmgn-lines', {
            enabled: true,
            avgBuyMcap: supply && avgBuyUsd ? avgBuyUsd * supply : null,
            avgSellMcap: supply && avgSellUsd ? avgSellUsd * supply : null,
            avgBuyText: supply && avgBuyUsd ? `PT Avg Buy ${ctx.Q.formatMarketCap(avgBuyUsd * supply)}` : '',
            avgSellText: supply && avgSellUsd ? `PT Avg Sell ${ctx.Q.formatMarketCap(avgSellUsd * supply)}` : '',
            currentMcap: Number(token.mcap) > 0 ? Number(token.mcap) : null,
            currentPriceNative: Number(token.priceNative) > 0 ? Number(token.priceNative) : null,
            currentPriceUsd: Number(token.priceUsd) > 0 ? Number(token.priceUsd) : null,
          });
          ctx.CM.clearAverageLines();
        } else {
          const supply = Number(token.mcap) > 0 && Number(token.priceUsd) > 0
            ? Number(token.mcap) / Number(token.priceUsd)
            : null;
          ctx.CM.setAverageLines({
            avgBuyPrice: avgBuyUsd,
            avgSellPrice: avgSellUsd,
            avgBuyLabel: supply && avgBuyUsd ? avgBuyUsd * supply : avgBuyUsd,
            avgSellLabel: supply && avgSellUsd ? avgSellUsd * supply : avgSellUsd,
            currency: supply ? 'MCAP' : 'USD',
          });
        }
      }
    }

    return {
      drawFillOnChart,
      restoreMarkersFromJournal,
      maybeRepostAverageLines,
      syncAveragePriceLines,
      resetLineThrottle,
      resetLinesState,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTPanelChartFills = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

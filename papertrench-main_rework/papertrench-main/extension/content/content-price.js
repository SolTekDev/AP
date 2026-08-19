/* PaperTrench — page tick validation + price heartbeat for content.js.
 * Loaded before content.js. Factory: window.PTContentPrice.create(ctx).
 *
 * ELI5: The price keeper. When the chart says "the coin costs X", this file
 * checks if X makes sense, updates the panel, and keeps the profit/loss number
 * ticking even when the page goes quiet for a moment.
 */
(() => {
  'use strict';

  const PRICE_TICK_MS = 100;             // redraw P&L ten times per second

  const OOB_REANCHOR_MIN_MS = 3000;      // wait at least 3s between "price jumped?" fixes
  const OOB_REJECTS_FOR_REANCHOR = 5;    // 5 weird ticks → ask resolver for fresh truth

  function create(ctx) {
    let priceTimer = null;
    let lastPollAt = 0;
    let pollInFlight = false;

    let lastPriceAt = 0;                  // when we last accepted a price
    let pageQuoteSeq = 0;                 // tick counter (for "wait for next price")
    const pageQuoteWaiters = new Set();
    let lastCmTickPrice = 0;
    let oobRejects = 0;                   // how many "that price looks wrong" in a row
    let lastOobRequoteAt = 0;
    let lastMcapTickAt = 0;               // last market-cap-only tick (keeps snipes alive)
    let chartAxisBasis = null;            // is chart showing USD, SOL, or market cap?
    // Inferred axis can flap tick-to-tick near unit boundaries; require a few
    // agreeing ticks before switching so avg lines do not unlock and ride price.
    let pendingAxisBasis = null;
    let pendingAxisBasisCount = 0;
    const AXIS_BASIS_STICKY_TICKS = 6;

    function axisBasisFamily(basis) {
      if (basis === 'mcap' || basis === 'native-mcap') return 'cap';
      if (basis === 'native') return 'native';
      if (basis === 'usd' || basis === 'usd-abs') return 'usd';
      return basis || null;
    }

    /** Adopt a new chart axis basis only after it sticks, or within the same family. */
    function noteChartAxisBasis(nextBasis) {
      if (!nextBasis) return false;
      if (nextBasis === chartAxisBasis) {
        pendingAxisBasis = null;
        pendingAxisBasisCount = 0;
        return false;
      }
      // Cap <-> cap (mcap vs native-mcap) is the same axis; adopt immediately.
      if (chartAxisBasis
        && axisBasisFamily(chartAxisBasis) === 'cap'
        && axisBasisFamily(nextBasis) === 'cap') {
        chartAxisBasis = nextBasis;
        pendingAxisBasis = null;
        pendingAxisBasisCount = 0;
        return true;
      }
      if (nextBasis === pendingAxisBasis) {
        pendingAxisBasisCount += 1;
      } else {
        pendingAxisBasis = nextBasis;
        pendingAxisBasisCount = 1;
      }
      if (!chartAxisBasis || pendingAxisBasisCount >= AXIS_BASIS_STICKY_TICKS) {
        chartAxisBasis = nextBasis;
        pendingAxisBasis = null;
        pendingAxisBasisCount = 0;
        return true;
      }
      return false;
    }

    /**
     * ELI5: A new price arrived from the chart! Check it's for the right coin,
     * check it's not crazy-wrong, then update everything on screen.
     */
    function handlePageTick(payload) {
      const token = ctx.token;
      if (!payload || !token) return;

      const { E, Q, CM } = ctx;

      // ELI5: Wrong coin or wrong symbol? Ignore — not for us.
      if (payload.mint && payload.mint !== token.mint) return;
      if (payload.symbol && token.symbol
        && String(payload.symbol).toUpperCase() !== String(token.symbol).toUpperCase()) return;

      // ELI5: Even a market-cap-only tick proves the coin is alive — helps snipe buys wait.
      if (Number(payload.mcap) > 0) lastMcapTickAt = Date.now();

      let verdict = null;
      const anchor = ctx.tokenAnchor();
      if (Number(anchor && anchor.priceNative) > 0) {
        verdict = Q.validateTick(anchor, payload);
      } else {
        // ELI5: Brand-new coin with no trusted price yet — first good on-screen price wins.
        verdict = Q.bootstrapTick(token, payload, ctx.pendingSolUsd);
      }
      if (!verdict || !verdict.accepted) {
        // ELI5: Price looks way off? After several rejects, ask the resolver for a fresh anchor.
        if (verdict && verdict.reason === 'out-of-band') {
          oobRejects += 1;
          if (oobRejects >= OOB_REJECTS_FOR_REANCHOR
            && Date.now() - lastOobRequoteAt > OOB_REANCHOR_MIN_MS) {
            lastOobRequoteAt = Date.now();
            oobRejects = 0;
            requote();
          }
        }
        return;
      }
      oobRejects = 0;

      // ELI5: Chart switched units (USD↔SOL, Price↔MCap)? Update our average lines right away.
      if ((payload.source === 'padre-chart-bar' || payload.source === 'chart-export') && verdict.basis) {
        if (noteChartAxisBasis(verdict.basis)) ctx.syncAveragePriceLines();
      }

      // ELI5: Reject prices that jump by a huge scale step (10x supply mistake) in one tick.
      const lastAcceptedMarket = ctx.lastAcceptedMarket;
      const scaleAnchor = ctx.tokenAnchor();
      if (Q.scaleStepVerdict(
        verdict.priceNative,
        lastAcceptedMarket && lastAcceptedMarket.priceNative,
        lastAcceptedMarket ? Date.now() - lastAcceptedMarket.at : Infinity,
        scaleAnchor ? Number(scaleAnchor.priceNative) : null
      ) === 'scale-step') {
        console.debug('PaperTrench: tick ' + verdict.priceNative + ' (' + (payload.source || 'page-feed')
          + ') rejected as scale-step vs accepted ' + lastAcceptedMarket.priceNative
          + ' — one tick may not re-scale the market (F-50)');
        return;
      }

      const oldNative = Number(token.priceNative);
      token.priceNative = verdict.priceNative;
      if (verdict.priceUsd) token.priceUsd = verdict.priceUsd;
      if (verdict.mcap) token.mcap = verdict.mcap;
      token.priceSource = payload.source || 'page-feed';
      ctx.lastAcceptedMarket = { priceNative: verdict.priceNative, at: Date.now() };

      // ELI5: First accepted price becomes our trusted starting point for new coins.
      if (!token.anchor && Number(token.priceNative) > 0) {
        token.anchor = {
          mint: token.mint,
          priceNative: Number(token.priceNative),
          priceUsd: Number(token.priceUsd) || null,
          mcap: Number(token.mcap) || null,
        };
      }

      lastPriceAt = Date.now();
      pageQuoteSeq += 1;
      for (const resolve of pageQuoteWaiters) resolve();
      pageQuoteWaiters.clear();
      ctx.flushArmedBuy();
      if (token.priceNative === oldNative) return;

      const series = ctx.series;
      series.push({ t: lastPriceAt, p: token.priceNative, usd: token.priceUsd });
      if (series.length > ctx.SERIES_CAP) series.shift();
      E.markPosition(ctx.state, token.mint, token.priceNative, token.priceUsd);
      ctx.maybeRepostAverageLines();
      if (ctx.usesSvgMarkers()) CM.tickPrice(ctx.genericChartPoint(token.priceNative, token.priceUsd, token.mcap).plot);
      ctx.persistSoon();
      ctx.renderHeader();
      ctx.renderPosition();
      ctx.renderBalance();
      ctx.renderLiveDot();
      ctx.renderPositionsBar();
    }

    /**
     * ELI5: A heartbeat that runs every 100ms. Keeps P&L updating, fetches backup
     * prices when the chart goes quiet, and expires snipe buys that never fired.
     */
    function startPriceLoop() {
      stopPriceLoop();
      priceTimer = setInterval(() => {
        if (!ctx.contextAlive()) { ctx.shutdown('invalidated'); return; }
        const token = ctx.token;
        if (!token || !token.mint) return;

        const now = Date.now();
        const hiddenBlocked = document.hidden;
        if (ctx.Q.shouldRequote({
          lastPriceAt, lastPollAt, inFlight: pollInFlight, hidden: hiddenBlocked,
        }, now)) {
          lastPollAt = now;
          requote();
        }

        const chartPrice = ctx.genericChartPoint(token.priceNative, token.priceUsd, token.mcap).plot;
        if (ctx.usesSvgMarkers() && chartPrice > 0 && chartPrice !== lastCmTickPrice) {
          lastCmTickPrice = chartPrice;
          ctx.CM.tickPrice(chartPrice);
        }
        // ELI5: Snipe buy waiting? Fire it if we have a price, or expire it if too long.
        if (ctx.armedBuy) {
          if (token && Number(token.priceNative) > 0) {
            ctx.flushArmedBuy();
          } else if (ctx.armedBuyExpired()) {
            ctx.armedBuy = null;
            ctx.renderBuyButton();
            ctx.toast('Armed buy expired — no fillable quote arrived in time');
          }
        }
        ctx.renderHeader();
        ctx.renderPosition();
      }, PRICE_TICK_MS);
    }

    /** ELI5: Ask the background for a fresh price from Jupiter/Dexscreener. */
    async function requote() {
      const token = ctx.token;
      if (pollInFlight || !token || !token.mint) return;
      pollInFlight = true;
      const forMint = token.mint;
      try {
        const fresh = await ctx.R.refresh(token);
        if (!ctx.token || ctx.token.mint !== forMint) return;
        if (!fresh || !(fresh.priceNative > 0)) return;
        if (fresh.mint && fresh.mint !== ctx.token.mint) return;

        const liveToken = ctx.token;

        liveToken.anchor = {
          mint: liveToken.mint,
          priceNative: Number(fresh.priceNative),
          priceUsd: Number(fresh.priceUsd) || null,
          mcap: Number(fresh.mcap) || null,
        };

        // ELI5: Chart feed is live? Only refresh USD/mcap math, don't override chart price.
        const feedLive = lastPriceAt
          && Date.now() - lastPriceAt < ctx.Q.STALE_AFTER_MS
          && Number(liveToken.priceNative) > 0
          && liveToken.priceSource !== 'resolver';
        if (feedLive) {
          const rate = Number(fresh.priceUsd) > 0 ? fresh.priceUsd / fresh.priceNative : null;
          if (rate) liveToken.priceUsd = liveToken.priceNative * rate;
          if (Number(fresh.mcap) > 0 && Number(fresh.priceUsd) > 0 && Number(liveToken.priceUsd) > 0) {
            const supply = fresh.mcap / fresh.priceUsd;
            liveToken.mcap = liveToken.priceUsd * supply;
          }
          ctx.maybeRepostAverageLines();
          ctx.persistSoon();
          ctx.renderHeader();
          ctx.renderPosition();
          return;
        }

        liveToken.priceNative = fresh.priceNative;
        if (fresh.priceUsd) liveToken.priceUsd = fresh.priceUsd;
        if (fresh.mcap) liveToken.mcap = fresh.mcap;
        liveToken.priceSource = fresh.priceSource || 'resolver';

        lastPriceAt = Date.now();
        const series = ctx.series;
        series.push({ t: lastPriceAt, p: liveToken.priceNative, usd: liveToken.priceUsd });
        if (series.length > ctx.SERIES_CAP) series.shift();
        ctx.E.markPosition(ctx.state, liveToken.mint, liveToken.priceNative, liveToken.priceUsd);
        ctx.maybeRepostAverageLines();
        if (ctx.usesSvgMarkers()) ctx.CM.tickPrice(ctx.genericChartPoint(liveToken.priceNative, liveToken.priceUsd, liveToken.mcap).plot);
        ctx.persistSoon();
        ctx.renderHeader();
        ctx.renderPosition();
        ctx.flushArmedBuy();
      } catch (e) {
        /* transient network failure; the next beat retries */
      } finally {
        pollInFlight = false;
      }
    }

    function stopPriceLoop() {
      if (priceTimer) clearInterval(priceTimer);
      priceTimer = null;
      lastPollAt = 0;
    }

    /** ELI5: "Wake me when the next chart price arrives" (used before filling a trade). */
    function waitForNewPageQuote(afterSeq, timeoutMs) {
      if (pageQuoteSeq > afterSeq) return Promise.resolve(true);
      return new Promise((resolve) => {
        const done = () => { pageQuoteWaiters.delete(done); resolve(pageQuoteSeq > afterSeq); };
        pageQuoteWaiters.add(done);
        setTimeout(done, timeoutMs);
      });
    }

    function getPageQuoteSeq() { return pageQuoteSeq; }

    function clearFeedOnMintChange() {
      lastMcapTickAt = 0;
      oobRejects = 0;
    }

    function resetTokenPriceState() {
      lastPriceAt = 0;
      lastCmTickPrice = 0;
      chartAxisBasis = null;
      pendingAxisBasis = null;
      pendingAxisBasisCount = 0;
    }

    function resetMount() {
      stopPriceLoop();
      lastPriceAt = 0;
      pageQuoteSeq = 0;
      pageQuoteWaiters.clear();
      lastCmTickPrice = 0;
      oobRejects = 0;
      lastOobRequoteAt = 0;
      lastMcapTickAt = 0;
      chartAxisBasis = null;
      pendingAxisBasis = null;
      pendingAxisBasisCount = 0;
      pollInFlight = false;
    }

    ctx.onTeardown(stopPriceLoop);

    return {
      handlePageTick,
      startPriceLoop,
      stopPriceLoop,
      requote,
      waitForNewPageQuote,
      getPageQuoteSeq,
      resetMount,
      clearFeedOnMintChange,
      resetTokenPriceState,
      get lastPriceAt() { return lastPriceAt; },
      get chartAxisBasis() { return chartAxisBasis; },
      get lastMcapTickAt() { return lastMcapTickAt; },
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTContentPrice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

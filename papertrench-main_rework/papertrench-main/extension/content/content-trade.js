/* PaperTrench — action-time quotes, buy/sell fills, and trade receipts for content.js.
 * Loaded before content.js. Factory: window.PTContentTrade.create(ctx).
 *
 * ELI5: The cashier. When you click Buy or Sell, this file finds a fair price,
 * checks it's not lying, updates your pretend wallet, draws the fill on the
 * chart, and shows you a receipt toast.
 */
(() => {
  'use strict';

  /* ── Armed buy timing ────────────────────────────────────────────────────── */

  const ARMED_BUY_TTL_MS = 60_000;       // snipe expires after 60s (unless market still active)
  const ARMED_BUY_MAX_TTL_MS = 300_000;  // hard stop at 5 minutes
  const ARMED_BUY_QUIET_MS = 15_000;     // no mcap activity for 15s → expire

  /* ── Fill quote freshness ────────────────────────────────────────────────── */

  const ACTION_QUOTE_MAX_AGE_MS = 350;   // on-screen price must be this fresh to fill
  const ACTION_PAGE_WAIT_MS = 175;       // wait briefly for next chart tick
  const PENDING_ACTION_MAX_AGE_MS = 2000; // brand-new coins get a longer window
  const STALE_FILL_MAX_AGE_MS = 3000;    // absolute last resort before refusing
  const ONCHAIN_SCREEN_CHECK_MAX_AGE_MS = 600; // chain vs screen price disagreement check

  function create(ctx) {
    let armedBuy = null;                  // snipe waiting for first price
    let lastAcceptedMarket = null;        // last price we trusted as "real money"
    let lastQuoteRefusal = null;          // why we said no to a fill

    let buyInFlight = false;              // prevent double-buy from double-click
    let sellInFlight = false;             // prevent double-sell from double-click

    /**
     * ELI5: You clicked Buy before a price existed. Now a price arrived — fire
     * the buy automatically!
     */
    function flushArmedBuy() {
      const token = ctx.token;
      if (!armedBuy || !token || !token.priceNative) return;
      if (armedBuy.mint && armedBuy.mint !== token.mint) {
        armedBuy = null;
        ctx.renderBuyButton();
        return;
      }
      if (Date.now() - armedBuy.at > ARMED_BUY_TTL_MS) {
        armedBuy = null;
        ctx.renderBuyButton();
        ctx.toast('Armed buy expired — the quote took too long');
        return;
      }
      let amount = armedBuy.amount;
      const armedUsd = Number(armedBuy.usd) > 0 ? Number(armedBuy.usd) : null;
      armedBuy = null;
      ctx.renderBuyButton();
      if (!(amount > 0) && armedUsd) {
        const rate = ctx.panelUsdRate();
        if (!rate) { ctx.toast('No SOL/USD rate for this chain — armed buy dropped'); return; }
        amount = armedUsd / rate;
      }
      if (!(amount > 0)) return;
      doBuy(amount, armedUsd);
    }

    /** ELI5: Wipe the pretend wallet and start over with fresh starting balance. */
    async function quickResetWallet() {
      const fresh = ctx.E.resetState(ctx.settings, ctx.state.seq);
      fresh.updatedAt = Date.now();
      ctx.state = fresh;
      if (ctx.barApi) ctx.barApi.clearLivePrices();
      if (ctx.resetPositionMount) ctx.resetPositionMount();
      if (ctx.setLastWritten) ctx.setLastWritten(fresh);
      const committed = await ctx.sendMessage({ type: 'pt_state_commit', state: fresh, force: true })
        .catch(() => null);
      if (!committed || !committed.ok) await ctx.store.set({ [ctx.E.STORAGE_KEYS.state]: fresh });
      ctx.sendMessage({ type: 'pt_settings_changed' });
      ctx.sendPadreMarker('paper-marker-clear');
      ctx.sendPadreMarker('paper-lines-clear');
      ctx.drawnFillIds.clear();
      const site = ctx.site;
      if (site && site.id === 'gmgn') ctx.sendPadreMarker('gmgn-lines-clear');
      if (ctx.CM && ctx.usesSvgMarkers()) { ctx.CM.clearMarkers(); ctx.CM.clearAverageLines(); }
      ctx.marks.length = 0;
      ctx.renderAll();
      ctx.toast(`Paper wallet reset — fresh ${ctx.E.fmt(ctx.settings.balanceStartSol, 2)} SOL`);
    }

    /** ELI5: Freeze the current on-screen price into a little snapshot for fill-time checks. */
    function quoteSnapshot() {
      const token = ctx.token;
      if (!token || !(Number(token.priceNative) > 0)) return null;
      return {
        mint: token.mint,
        priceNative: Number(token.priceNative),
        priceUsd: Number(token.priceUsd) > 0 ? Number(token.priceUsd) : null,
        mcap: Number(token.mcap) > 0 ? Number(token.mcap) : null,
        source: token.priceSource || 'unknown',
        receivedAt: ctx.lastPriceAt,
      };
    }

    /** ELI5: Turn a live blockchain price read into a fill-ready quote object. */
    function quoteFromOnchain(observation) {
      if (!observation || !(observation.priceNative > 0)) return null;
      const token = ctx.token;
      if (!token || token.mint !== observation.mint) return null;

      const anchorNative = Number(token.priceNative);
      const anchorUsd = Number(token.priceUsd);
      const usdPerSol = anchorNative > 0 && anchorUsd > 0 ? anchorUsd / anchorNative : null;
      const priceUsd = usdPerSol ? observation.priceNative * usdPerSol : null;

      const anchorMcap = Number(token.mcap);
      const mcap = anchorMcap > 0 && anchorUsd > 0 && priceUsd
        ? anchorMcap * (priceUsd / anchorUsd)
        : null;

      return {
        mint: observation.mint,
        priceNative: observation.priceNative,
        priceUsd,
        mcap,
        slot: observation.slot,
        source: 'onchain',
        receivedAt: observation.observedAt,
      };
    }

    /**
     * ELI5: Before filling, ask a second source "do you agree with this price?"
     * If they wildly disagree, refuse the fill — protects against stale/wrong quotes.
     */
    async function corroborateForFill(chosen) {
      lastQuoteRefusal = null;
      if (!chosen) return null;
      const evidence = lastAcceptedMarket;
      const evidenceAge = evidence ? Date.now() - evidence.at : Infinity;
      if (!ctx.Q.needsFillWitness(chosen.priceNative, evidence && evidence.priceNative, evidenceAge)) {
        return chosen;
      }
      let witnessNative = null;
      if (chosen.source === 'action-resolver') {
        const token = ctx.token;
        const obs = await ctx.R.onchainQuote(token && token.mint).catch(() => null);
        if (obs && obs.priceNative > 0) witnessNative = obs.priceNative;
      } else {
        const token = ctx.token;
        const fresh = await ctx.R.refresh(token).catch(() => null);
        if (fresh && Number(fresh.priceNative) > 0) witnessNative = Number(fresh.priceNative);
      }
      if (ctx.Q.witnessAgrees(chosen.priceNative, witnessNative)) return chosen;
      lastQuoteRefusal = 'Price sources disagree ('
        + ctx.E.fmt(chosen.priceNative) + ' vs recent ' + ctx.E.fmt(evidence.priceNative)
        + (witnessNative ? ', witness ' + ctx.E.fmt(witnessNative) : ', no second source')
        + ') — paper fill refused. Try again in a moment.';
      console.debug('PaperTrench: fill witness refused', {
        candidate: chosen.priceNative, source: chosen.source,
        evidence: evidence.priceNative, evidenceAgeMs: evidenceAge,
        witness: witnessNative,
      });
      return null;
    }

    async function quoteForTrade() {
      return corroborateForFill(await pickQuoteForTrade());
    }

    /**
     * ELI5: The price ladder — try sources in order until we find a fresh, fair price:
     *   1. Blockchain (if it agrees with the screen)
     *   2. What you see on screen right now
     *   3. Wait for next chart tick
     *   4. Ask Jupiter/Dexscreener
     *   5. Last resort: slightly stale screen price (within bounds)
     */
    async function pickQuoteForTrade() {
      const token = ctx.token;
      const startMint = token && token.mint;
      if (!startMint) return null;

      const clickAt = Date.now();
      const atClick = quoteSnapshot();
      const atClickAge = atClick ? clickAt - atClick.receivedAt : Infinity;

      const observation = await ctx.R.onchainQuote(startMint);
      if (!ctx.token || ctx.token.mint !== startMint) return null;
      const onchain = quoteFromOnchain(observation);
      if (onchain) {
        const screenFresh = atClick && atClickAge <= ONCHAIN_SCREEN_CHECK_MAX_AGE_MS;
        if (screenFresh && !ctx.Q.fillSourcesAgree(onchain.priceNative, atClick.priceNative)) {
          console.debug('PaperTrench: on-chain quote ' + onchain.priceNative
            + ' diverges from the on-screen price ' + atClick.priceNative
            + ' (' + atClickAge + 'ms old) — filling at the on-screen price');
          return atClick;
        }
        const acceptedEvidence = lastAcceptedMarket;
        const acceptedEvidenceAge = acceptedEvidence ? Date.now() - acceptedEvidence.at : Infinity;
        if (screenFresh || !ctx.Q.onchainContradictsEvidence(onchain.priceNative,
          acceptedEvidence && acceptedEvidence.priceNative, acceptedEvidenceAge)) {
          return onchain;
        }
        console.debug('PaperTrench: on-chain quote ' + onchain.priceNative
          + ' contradicts accepted market evidence ' + acceptedEvidence.priceNative
          + ' (' + acceptedEvidenceAge + 'ms old) on a quiet screen — re-pricing from the ladder');
      }

      if (atClick && atClickAge <= ACTION_QUOTE_MAX_AGE_MS) return atClick;

      const seqAtClick = ctx.pageQuoteSeq;
      await ctx.waitForNewPageQuote(seqAtClick, ACTION_PAGE_WAIT_MS);
      if (!ctx.token || ctx.token.mint !== startMint) return null;
      const pageQuote = quoteSnapshot();
      if (pageQuote && ctx.pageQuoteSeq > seqAtClick && Date.now() - pageQuote.receivedAt <= ACTION_QUOTE_MAX_AGE_MS) {
        return pageQuote;
      }

      if (ctx.token.pending) {
        const pendingQuote = quoteSnapshot();
        if (pendingQuote && Date.now() - pendingQuote.receivedAt <= PENDING_ACTION_MAX_AGE_MS) return pendingQuote;
      }

      const fresh = await ctx.R.refresh(ctx.token);
      if (!ctx.token || ctx.token.mint !== startMint) return null;
      if (ctx.pageQuoteSeq > seqAtClick) {
        const newerPageQuote = quoteSnapshot();
        if (newerPageQuote && Date.now() - newerPageQuote.receivedAt <= ACTION_QUOTE_MAX_AGE_MS) return newerPageQuote;
      }

      if (fresh && Number(fresh.priceNative) > 0 && (!fresh.mint || fresh.mint === startMint)) {
        const site = ctx.site;
        const tokenNow = ctx.token;
        const inheritedMcap = site && site.id === 'gmgn' && Number(tokenNow.mcap) > 0 && Number(tokenNow.priceUsd) > 0 && Number(fresh.priceUsd) > 0
          ? Number(tokenNow.mcap) * (Number(fresh.priceUsd) / Number(tokenNow.priceUsd))
          : Number(fresh.mcap) || null;
        return {
          mint: startMint,
          priceNative: Number(fresh.priceNative),
          priceUsd: Number(fresh.priceUsd) > 0 ? Number(fresh.priceUsd) : null,
          mcap: inheritedMcap,
          source: 'action-resolver',
          receivedAt: Date.now(),
        };
      }

      const lastResort = quoteSnapshot();
      if (lastResort && Date.now() - lastResort.receivedAt <= STALE_FILL_MAX_AGE_MS) return lastResort;
      return null;
    }

    /**
     * ELI5: You tapped a buy amount. Check guards, maybe arm a snipe if no price yet,
     * otherwise go fill.
     */
    function requestBuy(amt) {
      const token = ctx.token;
      if (!(amt > 0)) return ctx.toast(ctx.panelUsd() ? 'Pick a dollar amount first' : 'Pick a SOL amount first');
      if (buyInFlight) return ctx.toast('Buy already in progress…');
      let solAmount = amt;
      let quotedUsd = null;
      if (ctx.panelUsd()) {
        quotedUsd = amt;
        const rate = ctx.panelUsdRate();
        if (rate) {
          solAmount = amt / rate;
        } else if (token && token.priceNative) {
          return ctx.toast('No SOL/USD rate for this chain — paper buy refused');
        } else {
          solAmount = null;
        }
      }
      // const rugRefusal = ctx.rugRefusalMessage();
      // if (rugRefusal) return ctx.toast(rugRefusal);

      if (!token || !token.priceNative) {
        if (!token) return ctx.toast('No token detected on this page');
        armedBuy = { amount: solAmount, usd: quotedUsd, at: Date.now(), mint: token.mint };
        ctx.renderBuyButton();
        ctx.toast('Buy armed — fires the instant the first quote lands');
        return;
      }
      buyInFlight = true;
      doBuy(solAmount, quotedUsd).finally(() => { buyInFlight = false; });
    }

    /** ELI5: Actually execute the paper buy — price it, write wallet, draw chart, toast. */
    async function doBuy(solAmount, quotedUsd) {
      const token = ctx.token;
      if (!token) return ctx.toast('No token detected on this page');
      // const rugRefusal = ctx.rugRefusalMessage();
      // if (rugRefusal) return ctx.toast(rugRefusal);
      const fillQuote = await quoteForTrade();
      if (!fillQuote) return ctx.toast(lastQuoteRefusal || 'Could not obtain a fresh price — paper buy not filled.');
      try {
        const result = await ctx.withState(async () => {
          let filled = null;
          const mutate = () => {
            const tokenNow = ctx.token;
            if (!tokenNow || tokenNow.mint !== fillQuote.mint) throw new Error('Token changed before the paper buy could be filled');
            const hadPosition = Boolean(ctx.state.positions[tokenNow.mint]);
            filled = ctx.E.buy(ctx.state, ctx.settings, {
              ts: Date.now(), mint: tokenNow.mint, pairAddress: tokenNow.pairAddress,
              symbol: tokenNow.symbol, name: tokenNow.name, site: ctx.site.id,
              priceNative: fillQuote.priceNative, priceUsd: fillQuote.priceUsd, mcap: fillQuote.mcap,
              priceSource: fillQuote.source || null,
              priceAgeMs: fillQuote.receivedAt > 0 ? Date.now() - fillQuote.receivedAt : null,
              chain: tokenNow.chain || 'solana',
              solAmount,
              quotedUsd: quotedUsd || undefined,
            });
            filled.opened = !hadPosition;
            ctx.drawnFillIds.add(filled.trade.id);
          };
          mutate();
          await ctx.persistStateNow(mutate);
          const { trade, position, opened } = filled;
          const markerTs = Date.now();
          ctx.marks.push({ t: markerTs, p: trade.priceNative, side: 'buy' });
          ctx.drawFillOnChart({
            ts: markerTs,
            fillId: trade.id,
            side: 'buy',
            priceNative: trade.priceNative,
            priceUsd: trade.priceUsd,
            mcap: trade.mcap,
            solAmount,
          });
          ctx.syncAveragePriceLines();
          return { trade, position, opened };
        });
        if (result) {
          lastAcceptedMarket = { priceNative: result.trade.priceNative, at: Date.now() };
          const atMcap = ctx.mcapAtPrice(result.trade.priceNative);
          const boughtText = quotedUsd
            ? `$${ctx.E.fmt(quotedUsd, quotedUsd < 10 ? 2 : 0)}`
            : `${ctx.E.fmt(solAmount, 3)} SOL`;
          ctx.toast(`Bought ${boughtText} of ${token.symbol}${atMcap ? ` at ${ctx.fmtMoney(atMcap)} MC` : ''} (paper)`);
        }
      } catch (err) { ctx.toast(err.message || 'Buy failed'); }
      ctx.renderAll();
    }

    /** ELI5: Sell some fraction of your position (25%, 50%, 100%, etc.). */
    async function doSell(fraction) {
      const token = ctx.token;
      if (!token) return ctx.toast('No token detected on this page');
      if (sellInFlight) return ctx.toast('Sell already in progress…');
      sellInFlight = true;
      try {
        await doSellInner(fraction);
      } finally {
        sellInFlight = false;
      }
    }

    async function doSellInner(fraction) {
      const fillQuote = await quoteForTrade();
      if (!fillQuote) return ctx.toast(lastQuoteRefusal || 'Could not obtain a fresh price — paper sell not filled.');
      try {
        const result = await ctx.withState(async () => {
          let filled = null;
          const mutate = () => {
            const tokenNow = ctx.token;
            if (!tokenNow || tokenNow.mint !== fillQuote.mint) throw new Error('Token changed before the paper sell could be filled');
            filled = ctx.E.sell(ctx.state, ctx.settings, {
              ts: Date.now(), mint: tokenNow.mint, site: ctx.site.id,
              qtyFraction: fraction, priceNative: fillQuote.priceNative, priceUsd: fillQuote.priceUsd, mcap: fillQuote.mcap,
              priceSource: fillQuote.source || null,
              priceAgeMs: fillQuote.receivedAt > 0 ? Date.now() - fillQuote.receivedAt : null,
            });
            ctx.drawnFillIds.add(filled.trade.id);
          };
          mutate();
          await ctx.persistStateNow(mutate);
          const { trade, position, round } = filled;
          const markerTs = Date.now();
          ctx.marks.push({ t: markerTs, p: trade.priceNative, side: 'sell' });
          ctx.drawFillOnChart({
            ts: markerTs,
            fillId: trade.id,
            side: 'sell',
            priceNative: trade.priceNative,
            priceUsd: trade.priceUsd,
            mcap: trade.mcap,
            solAmount: trade.solGross,
          });
          ctx.syncAveragePriceLines();
          return { trade, position, round };
        });
        if (result) {
          lastAcceptedMarket = { priceNative: result.trade.priceNative, at: Date.now() };
          const pnl = result.trade.pnlSol;
          const exitMcap = ctx.mcapAtPrice(result.trade.priceNative);
          if (!result.round) {
            ctx.toast(`Sold ${Math.round(fraction * 100)}%${exitMcap ? ` at ${ctx.fmtMoney(exitMcap)} MC` : ''} — ${pnl >= 0 ? '+' : ''}${ctx.E.fmt(pnl)} SOL paper`);
          } else {
            ctx.toast(`Sold ${Math.round(fraction * 100)}%${exitMcap ? ` at ${ctx.fmtMoney(exitMcap)} MC` : ''} — round closed: ${result.round.pnlSol >= 0 ? '+' : ''}${ctx.E.fmt(result.round.pnlSol)} SOL (${result.round.pnlPct.toFixed(1)}%) paper`);
          }
        }
      } catch (err) { ctx.toast(err.message || 'Sell failed'); }
      ctx.renderAll();
    }

    // ELI5: Shrink trade objects before sending to popup/background (less data).
    function summarizeSession(value) {
      const token = ctx.token;
      const site = ctx.site;
      if (!value) return null;
      return {
        sessionId: value.sessionId,
        roundId: value.id || value.roundId || null,
        mint: value.mint,
        symbol: value.symbol,
        name: value.name || token?.name || '',
        site: value.site || site?.id || 'unknown',
        openedAt: value.openedAt,
        closedAt: value.closedAt || null,
      };
    }

    function summarizeTrade(t) {
      return {
        id: t.id,
        sessionId: t.sessionId,
        ts: t.ts,
        side: t.side,
        mint: t.mint,
        symbol: t.symbol,
        qty: t.qty,
        priceNative: t.priceNative,
        priceUsd: t.priceUsd,
        solGross: t.solGross,
        solNet: t.solNet,
        feeSol: t.feeSol,
        pnlSol: t.pnlSol,
        mcap: t.mcap,
      };
    }

    function summarizeRound(r) {
      return {
        id: r.id,
        sessionId: r.sessionId,
        mint: r.mint,
        symbol: r.symbol,
        name: r.name || '',
        site: r.site,
        openedAt: r.openedAt,
        closedAt: r.closedAt,
        heldMs: r.heldMs,
        investedSol: r.investedSol,
        returnedSol: r.returnedSol,
        pnlSol: r.pnlSol,
        pnlPct: r.pnlPct,
      };
    }

    /**
     * ELI5: Snipe buys stay alive while the market is still "buzzing" (mcap ticks),
     * even past the base 60s timer — but not forever (5 min cap).
     */
    function armedBuyExpired() {
      if (!armedBuy) return false;
      const age = Date.now() - armedBuy.at;
      if (age > ARMED_BUY_MAX_TTL_MS) return true;
      if (age <= ARMED_BUY_TTL_MS) return false;
      return Date.now() - ctx.lastMcapTickAt > ARMED_BUY_QUIET_MS;
    }

    function resetMount() {
      armedBuy = null;
      lastAcceptedMarket = null;
      lastQuoteRefusal = null;
      buyInFlight = false;
      sellInFlight = false;
    }

    return {
      get armedBuy() { return armedBuy; },
      set armedBuy(v) { armedBuy = v; },
      get lastAcceptedMarket() { return lastAcceptedMarket; },
      set lastAcceptedMarket(v) { lastAcceptedMarket = v; },
      get lastQuoteRefusal() { return lastQuoteRefusal; },
      get buyInFlight() { return buyInFlight; },
      get sellInFlight() { return sellInFlight; },
      flushArmedBuy,
      quickResetWallet,
      quoteSnapshot,
      quoteFromOnchain,
      corroborateForFill,
      quoteForTrade,
      pickQuoteForTrade,
      requestBuy,
      doBuy,
      doSell,
      summarizeSession,
      summarizeTrade,
      summarizeRound,
      armedBuyExpired,
      resetMount,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTContentTrade = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

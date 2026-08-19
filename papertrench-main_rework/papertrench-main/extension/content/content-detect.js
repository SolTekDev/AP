/* PaperTrench — token detection, rug guard, and setToken lifecycle for content.js.
 * Loaded before content.js. Factory: window.PTContentDetect.create(ctx).
 *
 * ELI5: When you open a coin page, this file figures out WHICH coin you're
 * looking at. It peeks at the website, asks our background helper for the
 * coin's name and price, checks if the coin looks sketchy (rug guard), and
 * cleans up the old coin's stuff when you switch to a new one.
 */
(() => {
  'use strict';

  // ELI5: How many "is this a rug?" answers we remember before throwing old ones away.
  // const RUG_VERDICT_CACHE_MAX = 50;
  // ELI5: The rug slider can't go below 10% or above 90% — those are the guardrails.
  // const RUG_TOP_PCT_MIN = 10;
  // const RUG_TOP_PCT_MAX = 90;
  // ELI5: By default, warn if the top wallets own more than 40% of the coin.
  // const RUG_TOP_PCT_DEFAULT = 40;

  function create(ctx) {
    /* ── Rug guard ───────────────────────────────────────────────────────────── */

    // ELI5: A little notebook: coin address → "how concentrated are the holders?"
    // We look this up when you land on a coin so we can block risky buys.
    // const rugVerdicts = new Map();

    // function refreshRugVerdict(mint) {
    //   if (!mint || ctx.settings.guardRugEnabled === false) return;
    //   ctx.R.rugCheck(mint).then((verdict) => {
    //     if (!verdict || !verdict.known) return;
    //     rugVerdicts.set(mint, verdict);
    //     if (rugVerdicts.size > RUG_VERDICT_CACHE_MAX) rugVerdicts.delete(rugVerdicts.keys().next().value);
    //     ctx.renderSiteStatus();
    //   }).catch(() => {});
    // }

    /** ELI5: If this coin looks too "ruggy", return a warning message that blocks buying.
     * Selling is always OK — you should be able to escape a bad coin. */
    // function rugRefusalMessage() {
    //   const token = ctx.token;
    //   if (!token || ctx.settings.guardRugEnabled === false) return null;
    //   const verdict = rugVerdicts.get(token.mint);
    //   if (!verdict || !verdict.known) return null;
    //   const threshold = Math.max(RUG_TOP_PCT_MIN, Math.min(RUG_TOP_PCT_MAX, Number(ctx.settings.guardRugTopPct) || RUG_TOP_PCT_DEFAULT));
    //   if (!(verdict.pct >= threshold)) return null;
    //   return `🚩 RUG WARNING — top ${verdict.holders} wallets hold ${verdict.pct}% of supply`
    //     + `${verdict.assumedPool ? ' (excl. the largest account, assumed pool)' : ' (excl. the pool)'}`
    //     + '. Paper buy refused — Settings → Guardrails → Rug guard to override.';
    // }

    /* ── Token detection ───────────────────────────────────────────────────── */

    // ELI5: We only try the "early peek" trick once per address — no spamming the chain.
    let prewatchedAddress = null;

    // ELI5: Memory helpers so we don't re-detect the same page over and over.
    let lastHref = '';                    // last URL we already handled
    let resolving = false;                // "busy looking up coin info" flag
    let pendingSince = 0;                 // when we started waiting for a brand-new coin
    let pendingAttempts = 0;              // how many times we've retried a fresh launch

    /** ELI5: Brand-new coins aren't in price websites yet. This asks the blockchain
     * directly: "hey, what's at this address?" so we can show SOMETHING and let
     * snipe buys fire instead of waiting forever for aggregators to catch up. */
    function prewatchPending(candidate) {
      if (!candidate || prewatchedAddress === candidate.address) return;
      prewatchedAddress = candidate.address;
      const ids = candidate.kind === 'pair'
        ? { pool: candidate.address }
        : { mint: candidate.address };
      // On-chain WS feed disabled (public RPC 403) — prewatch skipped.
      void ids;
      
      ctx.R.onchainPrewatch(ids).then((found) => {
        if (!found || !found.mint) return;
        const token = ctx.token;
        if (!token || !token.pending) return;
        if (token.srcAddress !== candidate.address && token.mint !== candidate.address) return;

        // ELI5: We found the real coin mint but not a price pool yet — still useful!
        // Save supply info so mcap-style pages can show a number, and swap in the real mint.
        if (!found.pool || found.poolKind == null) {
          if (found.mint !== token.mint) {
            if (ctx.armedBuy && ctx.armedBuy.mint === token.mint) ctx.armedBuy.mint = found.mint;
            token.mint = found.mint;
            token.pairAddress = found.pool || token.pairAddress || null;
            ctx.sendPadreMarker('paper-axis', { pairAddress: token.pairAddress, mint: token.mint });
          }
          if (Number(found.supplyUi) > 0) {
            token.supplyUi = Number(found.supplyUi);
            token.decimals = Number(found.decimals);
          }
          return;
        }

        // ELI5: Jackpot — we found the real coin AND a live pool with a price!
        if (ctx.armedBuy && ctx.armedBuy.mint === token.mint) ctx.armedBuy.mint = found.mint;
        token.mint = found.mint;
        token.pairAddress = found.pool || token.pairAddress || null;
        token.pumpCurve = found.poolKind === 'pump-curve';
        ctx.onchainLive = true;
        ctx.renderSiteStatus();
        ctx.sendPadreMarker('paper-axis', { pairAddress: token.pairAddress, mint: token.mint });
        if (Number(found.priceNative) > 0) {
          ctx.handlePageTick({
            mint: found.mint,
            source: 'onchain-prewatch',
            candidates: [{ value: Number(found.priceNative), unit: 'native' }],
          });
        }
      }).catch(() => {});
      
    }

    /** ELI5: The main "what coin am I on?" loop. Runs on a timer and when the page moves. */
    async function detectLoop() {
      const token = ctx.token;
      // ELI5: If we're still waiting for a brand-new coin to resolve, don't give up
      // just because the URL hasn't changed — keep trying!
      const settled = token && !token.pending;
      if (location.href === lastHref && settled) return;
      ctx.site = ctx.S.currentSite();
      const site = ctx.site;
      const candidate = site.detect();
      if (!candidate) { lastHref = location.href; setToken(null); return; }
      if (settled && (token.mint === candidate.address || token.pairAddress === candidate.address || token.srcAddress === candidate.address)) { lastHref = location.href; return; }
      // ELI5: If we're already looking up a coin, wait — don't start a second lookup.
      if (resolving) return;
      resolving = true;
      lastHref = location.href;
      const resolveHref = lastHref;

      // ELI5: Show "loading…" right away so the panel is honest while we fetch info.
      const curToken = ctx.token;
      const alreadyPendingSame = curToken && curToken.pending
        && (curToken.mint === candidate.address || curToken.srcAddress === candidate.address);
      if (!alreadyPendingSame) {
        setToken({
          mint: candidate.address, srcAddress: candidate.address, symbol: null, name: null,
          priceNative: null, priceUsd: null, pending: true,
        });
        pendingSince = Date.now();
        pendingAttempts = 0;
        // ELI5: Tell the chart bridge which coin we're aiming at, even before we know its name.
        ctx.sendPadreMarker('paper-axis', {
          pairAddress: candidate.kind === 'pair' ? candidate.address : null,
          mint: candidate.kind === 'mint' ? candidate.address : null,
        });
        // ELI5: Warm up the SOL→USD rate so we can show dollar prices the instant we get a number.
        ctx.R.solUsd().then((rate) => { if (rate > 0) ctx.pendingSolUsd = rate; }).catch(() => {});
        // ELI5: Early blockchain peek only works on Solana — other chains skip it.
        if (!candidate.chain || candidate.chain === 'solana') prewatchPending(candidate);
      }

      try {
        // ELI5: If prewatch already found the real mint, ask the resolver about THAT
        // instead of the pair address — Jupiter knows mints faster than new pools.
        const pendingToken = ctx.token;
        const resolveAddress = pendingToken && pendingToken.pending
          && pendingToken.srcAddress === candidate.address && pendingToken.mint !== candidate.address
          ? pendingToken.mint
          : candidate.address;
        const data = await ctx.R.resolve(resolveAddress, { chain: candidate.chain });
        // ELI5: You navigated away while we were looking — throw away the old answer.
        if (location.href !== resolveHref) return;
        if (!data) {
          // ELI5: Coin too new — not indexed yet. Keep showing "pending", don't flash blank.
          pendingAttempts += 1;
          // ELI5: Every few tries, peek at the blockchain again for brand-new launches.
          if (ctx.token && ctx.token.pending && pendingAttempts % 5 === 0
            && (!candidate.chain || candidate.chain === 'solana')) {
            prewatchedAddress = null;
            prewatchPending(candidate);
          }
          ctx.renderHeader();
          ctx.updateOverlayVisibility();
          return;
        }
        data.srcAddress = candidate.address;
        data.kind = candidate.kind;
        if (candidate.chain && !data.chain) data.chain = candidate.chain;
        setToken(data);
        // ELI5: Rug check only makes sense on Solana holder data.
        // if (!data.chain || data.chain === 'solana') refreshRugVerdict(data.mint);
        // ELI5: Tell the chart bridge the full coin identity (name, mint, pool).
        ctx.sendPadreMarker('paper-axis', { pairAddress: data.pairAddress, mint: data.mint, symbol: data.symbol });
        // Title-feed removed — tab-title market cap signal disabled.
        // ctx.startTitleSignal();
        // On-chain WS feed disabled (public RPC 403) — live pool watch skipped.
        /*
        if (data.pairAddress && (!data.chain || data.chain === 'solana')) {
          ctx.R.onchainWatch(data.mint, data.pairAddress).then((reply) => {
            if (ctx.token && ctx.token.mint === data.mint) {
              ctx.onchainLive = Boolean(reply && reply.live);
              ctx.renderSiteStatus();
            }
          }).catch(() => {});
        }
        */
        pendingSince = 0;
        pendingAttempts = 0;
        // ELI5: Reload your saved trades and redraw chart markers for this coin.
        await ctx.reloadState();
        ctx.restoreMarkersFromJournal();
        ctx.syncAveragePriceLines();
      } catch (e) {
        // ELI5: Internet hiccup — keep the pending coin and try again later.
        pendingAttempts += 1;
      } finally {
        resolving = false;
        ctx.R.solUsd().then((rate) => { if (rate > 0) ctx.pendingSolUsd = rate; }).catch(() => {});
      }
    }



    /** ELI5: "This is the coin we're tracking now." Switches everything over when the coin changes. */
    function setToken(data) {
      const prevMint = ctx.token?.mint;
      const hadPrice = Boolean(ctx.token && ctx.token.priceNative);
      // ELI5: New coin = wipe old price-feed counters so stale numbers don't leak over.
      if (!data || data.mint !== prevMint) ctx.clearFeedOnMintChange();
      ctx.token = data;
      const token = ctx.token;
      // ELI5: Save a trusted starting price from the resolver — live ticks must prove
      // they're close to this before we believe them.
      if (token && Number(token.priceNative) > 0) {
        token.anchor = {
          mint: token.mint,
          priceNative: Number(token.priceNative),
          priceUsd: Number(token.priceUsd) || null,
          mcap: Number(token.mcap) || null,
        };
      }
      // ELI5: If you armed a snipe buy and the coin just got its REAL mint name
      // (same coin, better ID), keep the armed buy alive. Only cancel on a true switch.
      if (token && prevMint && token.mint !== prevMint) {
        const armedBuy = ctx.armedBuy;
        const sameTokenResolving = armedBuy
          && armedBuy.mint === prevMint
          && (token.pairAddress === prevMint || token.srcAddress === prevMint);
        if (sameTokenResolving) armedBuy.mint = token.mint;
        else ctx.armedBuy = null;
      }
      if (!token) ctx.armedBuy = null;
      void hadPrice;
      if (!token || token.mint !== prevMint) {
        // ELI5: Force the position card to rebuild for the new coin.
        ctx.invalidatePositionCard();
      }
      if (prevMint && (!token || token.mint !== prevMint)) {
        // On-chain WS feed disabled (public RPC 403).
        ctx.onchainLive = false;
        // ctx.R.onchainUnwatch(prevMint);
        // Title-feed removed — tab-title market cap signal disabled.
        // ctx.stopTitleSignal();
      }
      if (token && token.mint !== prevMint) {
        // ELI5: Fresh slate for chart data, price state, and fill drawings.
        ctx.series = [];
        ctx.marks = [];
        ctx.resetTokenPriceState();
        ctx.resetLineThrottle();
        ctx.beginNativeProbe();
        ctx.drawnFillIds.clear();
        if (ctx.usesNativeChart()) {
          // ELI5: Padre has its own chart marks — clear the old ones.
          ctx.sendPadreMarker('paper-marker-clear');
          ctx.sendPadreMarker('paper-lines-clear');
          if (ctx.CM) ctx.CM.destroyChartMarkers();
        } else if (ctx.CM) {
          // ELI5: Generic SVG chart overlay — clear and re-mount for the new coin.
          const site = ctx.site;
          if (site && site.id === 'gmgn') ctx.sendPadreMarker('gmgn-lines-clear');
          ctx.CM.clearMarkers();
          if (ctx.usesSvgMarkers()) ctx.CM.initChartMarkers();
        }
        ctx.startPriceLoop();
      }
      if (!token) {
        // ELI5: No coin on this page — stop everything and clean the chart.
        ctx.stopPriceLoop();
        ctx.drawnFillIds.clear();
        if (ctx.CM) ctx.CM.destroyChartMarkers();
        if (ctx.usesNativeChart()) {
          ctx.sendPadreMarker('paper-marker-clear');
          ctx.sendPadreMarker('paper-lines-clear');
        }
        const site = ctx.site;
        if (site && site.id === 'gmgn') ctx.sendPadreMarker('gmgn-lines-clear');
      }
      ctx.renderAll();
      // ELI5: If you had a snipe buy armed and we just got the first price, fire it now!
      ctx.flushArmedBuy();
      ctx.publishPageState();
    }

    function resetMount() {
      // ELI5: Overlay turned off and on — forget all detection memory and start fresh.
      // rugVerdicts.clear();
      prewatchedAddress = null;
      lastHref = '';
      resolving = false;
      pendingSince = 0;
      pendingAttempts = 0;
    }

    return {
      detectLoop,           // "what coin is on this page?"
      setToken,             // adopt / switch / clear the current coin
      // refreshRugVerdict,    // re-check if holders look too concentrated
      // rugRefusalMessage,    // warning text if buys should be blocked
      resetMount,           // wipe memory on overlay remount
      get lastHref() { return lastHref; },
      set lastHref(v) { lastHref = v; },
      get pendingSince() { return pendingSince; },
      get resolving() { return resolving; },
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTContentDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

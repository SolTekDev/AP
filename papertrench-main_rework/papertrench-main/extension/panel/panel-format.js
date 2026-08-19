/* PaperTrench — shared price / market-cap formatters for the overlay.
 * Loaded before content.js. Factory: window.PTPanelFormat.create(ctx).
 *
 * Prices and market caps share one readable convention across the whole
 * overlay. Scientific notation ("3.97e-8") was reported as unreadable, so
 * sub-cent values use subscript-zero notation instead.
 *
 * ELI5: Turns big scary numbers into ones humans can read — like writing
 * "1.2M" instead of "1200000" — and figures out whether the panel should
 * show dollars or SOL for this chain.
 */
(() => {
  'use strict';

  function create(ctx) {
    function trimSci(p) { return ctx.Q.formatPrice(p); }

    function fmtMoney(n) { return ctx.Q.formatMarketCap(n); }

    /**
     * Market cap implied by a SOL-denominated price for the token on screen.
     *
     * Supply is constant on the timescale of a trade, so the live cap and the
     * live price move together. Scaling the current cap by the price ratio gives
     * the cap AT THAT PRICE without needing a second data source, which is what
     * keeps the entry figure consistent with the header.
     */
    // ELI5: If price goes up 10%, market cap went up 10% too — simple math.
    function mcapAtPrice(priceNative) {
      const token = ctx.token;
      if (!(priceNative > 0) || !token) return null;
      const nowPrice = Number(token.priceNative);
      const nowMcap = Number(token.mcap);
      if (!(nowPrice > 0) || !(nowMcap > 0)) return null;
      return nowMcap * (priceNative / nowPrice);
    }

    /** Entry figure in the unit traders actually use, price only as a fallback. */
    // ELI5: Show your entry as market cap if we can, otherwise as SOL price.
    function entryText(priceNative) {
      const mcap = mcapAtPrice(priceNative);
      if (mcap) return `${fmtMoney(mcap)} MC`;
      return `${trimSci(priceNative)} SOL`;
    }

    /* Panel denomination (SOL vs USD quick-buy). Foreign-chain panels
     * denominate in dollars; Solana panels keep SOL book units. */
    // ELI5: On non-Solana chains, buy buttons show dollars instead of SOL.
    function panelUsd() {
      return Boolean(ctx.token && ctx.token.chain && ctx.token.chain !== 'solana');
    }

    function panelUsdRate() {
      const rate = Number(ctx.token && ctx.token.solUsdAtResolve);
      return rate > 0 ? rate : null;
    }

    return {
      trimSci,
      fmtMoney,
      mcapAtPrice,
      entryText,
      panelUsd,
      panelUsdRate,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTPanelFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

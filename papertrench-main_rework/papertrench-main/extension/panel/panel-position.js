/* PaperTrench — open-position card.
 * Loaded before content.js. Factory: window.PTPanelPosition.create(ctx).
 *
 * ELI5: Shows your open trade — how much you hold, what you paid, what it
 * is worth now, and profit/loss.
 */
(() => {
  'use strict';

  function create(ctx) {
    let posEls = null;
    let lastRenderedPrice = null;

    function invalidateCard() {
      posEls = null;
      lastRenderedPrice = null;
    }

    // ELI5: Build the position card showing size, entry, value, and P&L.
    function buildPositionCard(pos) {
      posEls = null;
      ctx.els.position.textContent = '';
      const card = document.createElement('div');
      card.className = 'pt-pos';
      card.innerHTML = `
      <div class="row pt-detail"><span class="k">Position size</span><span class="v big" data-f="qty"></span></div>
      <div class="row pt-detail"><span class="k">Avg entry</span><span class="v" data-f="entry"></span></div>
      <div class="row pt-detail"><span class="k">Value</span><span class="v" data-f="value"></span></div>
      <div class="row row-pnl"><span class="k">Unrealized P&amp;L</span><span class="v pnl" data-f="pnl"></span></div>
    `;
      ctx.els.position.appendChild(card);

      posEls = {
        qty: card.querySelector('[data-f="qty"]'),
        entry: card.querySelector('[data-f="entry"]'),
        value: card.querySelector('[data-f="value"]'),
        pnl: card.querySelector('[data-f="pnl"]'),
      };
    }

    // ELI5: Refresh the position numbers whenever price moves.
    function renderPosition() {
      if (!ctx.els.position) return;
      const token = ctx.token;
      const pos = token && ctx.state.positions[token.mint];

      if (!pos) {
        if (ctx.els.position.childNodes.length) ctx.els.position.textContent = '';
        posEls = null;
        lastRenderedPrice = null;
        ctx.renderStatsBar();
        ctx.renderHoldings();
        return;
      }

      if (!posEls) buildPositionCard(pos);

      ctx.E.backfillPosition(ctx.state, pos);
      const mark = ctx.Q.positionMark(pos, token.priceNative, token.priceUsd);
      if (!mark) return;

      posEls.qty.textContent = `${ctx.E.fmt(mark.qty, 2)} ${pos.symbol}`;
      posEls.entry.textContent = ctx.entryText(mark.avgEntry);
      posEls.value.textContent = `${ctx.E.fmt(mark.valueSol, 4)} SOL`;

      const sign = mark.pnlSol >= 0 ? '+' : '';
      posEls.pnl.textContent =
        `${sign}${ctx.E.fmt(mark.pnlSol)} SOL (${mark.pnlPct.toFixed(1)}%)` +
        (mark.pnlUsd !== null ? ` · ${ctx.E.fmtUsd(mark.pnlUsd)}` : '');
      posEls.pnl.classList.toggle('pt-green', mark.up);
      posEls.pnl.classList.toggle('pt-red', !mark.up);

      if (lastRenderedPrice !== null && mark.price !== lastRenderedPrice) {
        const cls = mark.up ? 'pt-flash-up' : 'pt-flash-down';
        posEls.pnl.classList.remove('pt-flash-up', 'pt-flash-down');
        void posEls.pnl.offsetWidth;
        posEls.pnl.classList.add(cls);
      }
      lastRenderedPrice = mark.price;
      ctx.renderStatsBar();
      ctx.renderHoldings();
    }

    function resetMount() {
      invalidateCard();
    }

    return {
      renderPosition,
      invalidateCard,
      resetMount,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTPanelPosition = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

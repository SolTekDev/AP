/* PaperTrench — Padre-style positions bar (chips + off-screen price poll).
 * Loaded before content.js. Factory: window.PTPanelBar.create(ctx).
 *
 * ELI5: A little strip across the top of the page showing every coin you
 * still hold — like name tags with green/red profit. You can drag it, hide
 * it, and click a chip to jump to that coin's chart. It also quietly checks
 * prices for coins you are not looking at right now.
 */
(() => {
  'use strict';

  // ELI5: How often we peek at prices for off-screen positions (seconds).
  const BAR_POLL_MS = 6000;
  const BAR_POLL_HIDDEN_MS = 30_000;
  const BAR_DEFAULT_LEFT = 210;

  function create(ctx) {
    let livePositionPrices = {};
    const barChips = new Map();
    let barPos = { left: null, top: null };
    let barTotalEls = null;
    let positionsBarHidden = false;
    let barPollAt = 0;
    let barPollInFlight = false;
    let barTabDrag = null;
    let restartBarSettle = null;

    function syncFromSettings() {
      positionsBarHidden = ctx.settings.positionsBarHidden === true;
    }

    function livePositionPricesSnapshot() {
      return livePositionPrices;
    }

    function eachLivePositionPrice(fn) {
      for (const mint of Object.keys(livePositionPrices)) {
        const p = livePositionPrices[mint];
        if (p && Number(p.priceNative) > 0) fn(mint, p);
      }
    }

    function clearLivePrices() {
      livePositionPrices = {};
    }

    // ELI5: Peek at the page layout so the bar doesn't cover site buttons.
    function measureBarLeft() {
      const DEFAULT_LEFT = BAR_DEFAULT_LEFT;
      const MIN_LEFT = 96;
      const MAX_LEFT = 460;
      try {
        const probeY = 24;
        let edge = 0;
        for (let x = 8; x <= 420; x += 28) {
          const el = document.elementFromPoint(x, probeY);
          if (!el || el === document.body || el === document.documentElement) continue;
          const host = ctx.host;
          if (host && (el === host || (host.contains && host.contains(el)))) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 420 && rect.top < 60 && rect.right > edge) {
            edge = rect.right;
          }
        }
        if (edge > 0) return Math.min(MAX_LEFT, Math.max(MIN_LEFT, Math.round(edge + 18)));
      } catch (_) { /* cross-origin or exotic layout: use the default */ }
      return DEFAULT_LEFT;
    }

    function setBarPosition(left, top) {
      barPos = { left, top };
      const els = ctx.els;
      if (els.bar) {
        els.bar.style.setProperty('--pt-bar-left', left + 'px');
        els.bar.style.setProperty('--pt-bar-top', top + 'px');
      }
      if (els.barTab) {
        els.barTab.style.setProperty('--pt-bar-left', left + 'px');
        els.barTab.style.setProperty('--pt-bar-top', top + 'px');
      }
    }

    function positionBar(measuredLeft) {
      const els = ctx.els;
      if (!els.bar) return;
      const settings = ctx.settings;
      const left = typeof settings.positionsBarLeft === 'number' && Number.isFinite(settings.positionsBarLeft)
        ? settings.positionsBarLeft
        : (Number.isFinite(measuredLeft) ? measuredLeft : measureBarLeft());
      const top = typeof settings.positionsBarTop === 'number' && Number.isFinite(settings.positionsBarTop)
        ? settings.positionsBarTop : 7;
      const pos = ctx.clampBarPos(left, top);
      setBarPosition(pos.left, pos.top);
    }

    function applyBarOffset() { /* intentionally a no-op — see content history */ }

    function syncRailFade() {
      const rail = ctx.els.barRail;
      if (!rail) return;
      let scrollLeft = 0; let scrollWidth = 0; let clientWidth = 0;
      try {
        scrollLeft = rail.scrollLeft; scrollWidth = rail.scrollWidth; clientWidth = rail.clientWidth;
      } catch (_) { return; }
      if (!(clientWidth > 0)) return;
      const overflowing = scrollWidth - clientWidth > 1;
      const atStart = scrollLeft <= 1;
      const atEnd = scrollLeft >= scrollWidth - clientWidth - 1;
      rail.classList.toggle('pt-rail-more', overflowing && !atEnd);
      rail.classList.toggle('pt-rail-start', overflowing && !atStart && !atEnd);
      rail.classList.toggle('pt-rail-end', overflowing && atEnd);
    }

    function openPositionChart(mint) {
      if (!mint) return;
      const token = ctx.token;
      if (token && token.mint === mint) return;
      const pos = ctx.state.positions && ctx.state.positions[mint];
      const site = ctx.site;
      const url = ctx.S.tokenUrlFor(mint, {
        siteId: (pos && pos.site) || (site && site.id),
        pairAddress: pos && pos.pairAddress,
        fallbackSite: site,
      });
      if (!url) return;
      window.location.href = url;
    }

    function buildChip(row) {
      const el = document.createElement('button');
      el.className = 'pt-chip';
      el.innerHTML =
        '<span class="pt-chip-dot"></span>' +
        '<span class="pt-chip-sym"></span>' +
        '<span class="pt-chip-pnl"></span>' +
        '<span class="pt-chip-pct"></span>';
      const chip = {
        el,
        dot: el.querySelector('.pt-chip-dot'),
        sym: el.querySelector('.pt-chip-sym'),
        pnl: el.querySelector('.pt-chip-pnl'),
        pct: el.querySelector('.pt-chip-pct'),
        mint: row.mint,
        lastPnl: null,
      };
      el.addEventListener('click', () => openPositionChart(chip.mint));
      return chip;
    }

    function updateChip(chip, row) {
      const sign = row.pnlSol >= 0 ? '+' : '';
      chip.mint = row.mint;
      chip.sym.textContent = row.symbol;
      chip.pnl.textContent = `${sign}${ctx.E.fmt(row.pnlSol, 3)}`;
      chip.pct.textContent = `${sign}${row.pnlPct.toFixed(1)}%`;
      chip.el.classList.toggle('pt-green', row.up);
      chip.el.classList.toggle('pt-red', !row.up);
      chip.el.classList.toggle('active', row.active);
      chip.el.classList.toggle('stale', row.stale);
      chip.el.title = row.stale
        ? `${row.symbol} — ${ctx.E.fmt(row.valueSol, 4)} SOL · price not live yet`
        : `${row.symbol} — ${ctx.E.fmt(row.valueSol, 4)} SOL · click to open its chart`;

      if (chip.lastPnl !== null && row.pnlSol !== chip.lastPnl) {
        const cls = row.up ? 'pt-flash-up' : 'pt-flash-down';
        chip.el.classList.remove('pt-flash-up', 'pt-flash-down');
        void chip.el.offsetWidth;
        chip.el.classList.add(cls);
      }
      chip.lastPnl = row.pnlSol;
    }

    // ELI5: Redraw every position chip and the total profit summary.
    function renderPositionsBar() {
      const els = ctx.els;
      if (ctx.contextDead() || !els.bar || !els.barRail) return;

      const token = ctx.token;
      const activeQuote = token && token.mint && Number(token.priceNative) > 0
        ? { priceNative: Number(token.priceNative), priceUsd: Number(token.priceUsd) > 0 ? Number(token.priceUsd) : null }
        : null;
      for (const mint of Object.keys(ctx.state.positions || {})) {
        const pos = ctx.state.positions[mint];
        if (pos) ctx.E.backfillPosition(ctx.state, pos);
      }
      const rows = ctx.Q.positionRows(ctx.state, livePositionPrices, token && token.mint, activeQuote);
      const enabled = ctx.settings.positionsBarEnabled !== false;
      const show = enabled && rows.length > 0 && !positionsBarHidden;

      const held = new Set(rows.map((row) => row.mint));
      for (const [mint, chip] of barChips) {
        if (held.has(mint)) continue;
        chip.el.remove();
        barChips.delete(mint);
      }
      for (const mint of Object.keys(livePositionPrices)) {
        if (!held.has(mint)) delete livePositionPrices[mint];
      }

      const wasHidden = els.bar.classList.contains('pt-hidden');
      els.bar.classList.toggle('pt-hidden', !show);
      if (show && wasHidden) positionBar();
      if (els.barTab) {
        els.barTab.style.display = enabled && rows.length > 0 && positionsBarHidden ? 'flex' : 'none';
      }
      applyBarOffset(show);
      if (!show) return;

      const summary = ctx.Q.portfolioSummary(rows);
      if (els.barTotal) {
        if (!barTotalEls) {
          els.barTotal.textContent = '';
          const count = document.createElement('span');
          count.className = 'k';
          const sol = document.createElement('span');
          sol.className = 'v';
          const pct = document.createElement('span');
          pct.className = 'v';
          pct.style.fontSize = '11px';
          pct.style.opacity = '.75';
          els.barTotal.appendChild(count);
          els.barTotal.appendChild(sol);
          els.barTotal.appendChild(pct);
          barTotalEls = { count, sol, pct };
        }
        const sign = summary.up ? '+' : '';
        barTotalEls.count.textContent = `${rows.length} position${rows.length === 1 ? '' : 's'}`;
        barTotalEls.sol.textContent = `${sign}${ctx.E.fmt(summary.pnlSol, 3)} SOL`;
        barTotalEls.pct.textContent = `${sign}${summary.pnlPct.toFixed(1)}%`;
        for (const node of [barTotalEls.sol, barTotalEls.pct]) {
          node.classList.toggle('pt-green', summary.up);
          node.classList.toggle('pt-red', !summary.up);
        }
      }

      for (const row of rows) {
        let chip = barChips.get(row.mint);
        if (!chip) {
          chip = buildChip(row);
          barChips.set(row.mint, chip);
          els.barRail.appendChild(chip.el);
        }
        updateChip(chip, row);
      }

      const desired = rows.map((row) => barChips.get(row.mint).el);
      const current = els.barRail.children;
      let ordered = desired.length === current.length;
      if (ordered) {
        for (let i = 0; i < desired.length; i++) {
          if (current[i] !== desired[i]) { ordered = false; break; }
        }
      }
      if (!ordered) desired.forEach((el) => els.barRail.appendChild(el));
      syncRailFade();
    }

    // ELI5: Let you grab the bar and drag it somewhere else on screen.
    function setupBarDrag() {
      const readBarPos = () => ctx.clampBarPos(
        typeof barPos.left === 'number' ? barPos.left : ctx.settings.positionsBarLeft,
        typeof barPos.top === 'number' ? barPos.top : ctx.settings.positionsBarTop
      );
      const persistBarPos = () => {
        const pos = readBarPos();
        ctx.settings.positionsBarLeft = pos.left;
        ctx.settings.positionsBarTop = pos.top;
        try {
          ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings });
        } catch (_) {}
      };
      const barSpec = {
        start: readBarPos,
        move: (start, dx, dy) => {
          const pos = ctx.clampBarPos(start.left + dx, start.top + dy);
          setBarPosition(pos.left, pos.top);
        },
        drop: persistBarPos,
      };
      const els = ctx.els;
      if (els.barGrip) ctx.makeDraggable(els.barGrip, barSpec);
      if (els.barTab) barTabDrag = ctx.makeDraggable(els.barTab, barSpec);
    }

    function setBarHidden(hidden) {
      positionsBarHidden = hidden;
      ctx.settings = { ...ctx.settings, positionsBarHidden: hidden };
      ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings });
      renderPositionsBar();
    }

    function bindUI() {
      const shadow = ctx.shadow;
      const barHide = shadow.getElementById('pt-bar-hide');
      if (barHide) barHide.addEventListener('click', () => setBarHidden(true));
      if (ctx.els.barRail) {
        ctx.els.barRail.addEventListener('scroll', syncRailFade, { passive: true });
      }
      if (ctx.els.barTab) {
        ctx.els.barTab.addEventListener('click', () => {
          if (barTabDrag && barTabDrag.justDragged()) return;
          setBarHidden(false);
        });
      }
      setupBarDrag();
    }

    // ELI5: Fetch fresh prices for coins you are not currently viewing.
    async function pollPositionPrices() {
      const settings = ctx.settings;
      if (settings.positionsBarEnabled === false) return;
      if (barPollInFlight) return;

      const token = ctx.token;
      const mints = Object.keys(ctx.state.positions || {}).filter(
        (mint) => !(token && token.mint === mint)
      );
      if (!mints.length) return;

      const chains = {};
      for (const mint of mints) {
        const pos = ctx.state.positions && ctx.state.positions[mint];
        if (pos && pos.chain && pos.chain !== 'solana') chains[mint] = pos.chain;
      }

      const now = Date.now();
      const interval = document.hidden ? BAR_POLL_HIDDEN_MS : BAR_POLL_MS;
      if (barPollAt && now - barPollAt < interval) return;

      barPollInFlight = true;
      barPollAt = now;
      try {
        const prices = await ctx.R.batchPrices(mints, Object.keys(chains).length ? chains : undefined);
        let changed = false;
        for (const mint of Object.keys(prices)) {
          const quote = prices[mint];
          if (!quote || !(quote.priceNative > 0)) continue;
          livePositionPrices[mint] = { priceNative: quote.priceNative, priceUsd: quote.priceUsd };
          ctx.E.markPosition(ctx.state, mint, quote.priceNative, quote.priceUsd);
          changed = true;
        }
        if (changed) {
          ctx.persistSoon();
          renderPositionsBar();
          ctx.renderBalance();
        }
      } catch (_) {
        /* offline or rate-limited: keep the last marks and flag rows stale */
      } finally {
        barPollInFlight = false;
      }
    }

    // ELI5: Keep nudging the bar left until the page layout stops shifting.
    function startBarSettle(onMountCleanup) {
      let barSettle = { last: null, until: 0, timer: 0 };
      const barSettleLoop = () => {
        barSettle.timer = 0;
        if (!ctx.contextAlive() || !ctx.host) return;
        if (typeof ctx.settings.positionsBarLeft === 'number') { positionBar(); return; }
        const measured = measureBarLeft();
        positionBar(measured);
        const settled = measured === barSettle.last && measured !== BAR_DEFAULT_LEFT;
        barSettle.last = measured;
        if (settled || Date.now() > barSettle.until) return;
        barSettle.timer = setTimeout(barSettleLoop, 700);
      };
      const restart = () => {
        clearTimeout(barSettle.timer);
        barSettle = { last: null, until: Date.now() + 10_000, timer: setTimeout(barSettleLoop, 400) };
      };
      restartBarSettle = restart;
      restart();
      onMountCleanup(() => { clearTimeout(barSettle.timer); restartBarSettle = null; });
      return restart;
    }

    function onWindowResize() {
      positionBar();
      ctx.reclampPanel();
      syncRailFade();
    }

    function resetMount() {
      for (const chip of barChips.values()) {
        try { chip.el.remove(); } catch (_) {}
      }
      barChips.clear();
      barTotalEls = null;
      livePositionPrices = {};
      barPos = { left: null, top: null };
      barPollAt = 0;
      barPollInFlight = false;
      barTabDrag = null;
      if (restartBarSettle) {
        try { restartBarSettle = null; } catch (_) {}
      }
    }

    syncFromSettings();

    return {
      renderPositionsBar,
      pollPositionPrices,
      setBarHidden,
      bindUI,
      setupBarDrag,
      positionBar,
      measureBarLeft,
      syncRailFade,
      startBarSettle,
      onWindowResize,
      syncFromSettings,
      livePositionPricesSnapshot,
      eachLivePositionPrice,
      clearLivePrices,
      resetMount,
      BAR_DEFAULT_LEFT,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTPanelBar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

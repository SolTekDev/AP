/* PaperTrench — panel mount, bind, and render helpers.
 * Loaded before content.js. Factory: window.PTPanelControls.create(ctx).
 *
 * ELI5: The control room for the trading panel. It builds the box on screen,
 * wires up every button and preset, shows token name and price, lets you
 * drag and resize the panel, and refreshes all the numbers when something
 * changes — like the person behind the dashboard keeping everything updated.
 */
(() => {
  'use strict';

  // ELI5: Three saved sets of buy/sell button amounts you can switch between.
  const DEFAULT_PROFILES = [
    { buy: [0.01, 0.1, 0.25, 0.5, 0.75, 1.5, 2.5, 5], sell: [2, 50, 75, 100, 2, 5, 10, 15] },
    { buy: [0.1, 0.5, 1, 2, 0.25, 0.75, 1.5, 3], sell: [25, 50, 75, 100, 10, 20, 30, 50] },
    { buy: [0.05, 0.2, 0.5, 1, 1.5, 2, 3, 5], sell: [10, 25, 50, 75, 100, 33, 66, 90] },
  ];

  const USD_PRESETS_DEFAULT = [10, 100, 500, 1000];

  function create(ctx) {
    let pillDrag = null;
    let panelMinimized = false;
    let resizingOverlay = false;
    let resizeStart = null;
    let quickResetArmedAt = 0;
    let quickResetTimer = null;
    let closedRenderKey = null;
    let lastBuyPresetAmt = 0;

  // ELI5: Build the panel box from scratch and put it on the page.
  function createUI() {
    // Adopt-or-replace (DEFECT O-05): a leftover #papertrench-host — an
    // earlier mount that was never torn down, or a page-authored imposter —
    // used to cause an early return that left `ctx.host` null while
    // enableOverlay kept stacking fresh timers on every ctx.settings write.
    // Remove whatever is there and rebuild from scratch.
    const existing = document.getElementById(ctx.HOST_ID);
    if (existing && existing.remove) { try { existing.remove(); } catch (_) {} }
    const nextHost = document.createElement('div');
    nextHost.id = ctx.HOST_ID;
    const nextShadow = nextHost.attachShadow({ mode: 'open' });
    nextShadow.innerHTML = `<style>${ctx.UI.buildStyles()}</style>${ctx.UI.buildShellHtml()}`;
    document.body.appendChild(nextHost);
    ctx.mountHost(nextHost, nextShadow);

    ctx.els.box = ctx.shadow.getElementById('pt-box');
    // Restore the dragged position saved by the panel's drop handler.
    // Settings are already loaded (init awaits reloadState before
    // enableOverlay). ctx.clampPanelPos keeps a position saved on a bigger
    // monitor fully reachable on a smaller window — the old rescue clamp
    // (right ≤ innerWidth-40) left the panel almost entirely off the LEFT
    // edge of the viewport (DEFECT O-17).
    const savedRight = typeof ctx.settings.panelRight === 'number' && Number.isFinite(ctx.settings.panelRight);
    const savedTop = typeof ctx.settings.panelTop === 'number' && Number.isFinite(ctx.settings.panelTop);
    if (savedRight || savedTop) {
      ctx.applyPanelPos(savedRight ? ctx.settings.panelRight : 18, savedTop ? ctx.settings.panelTop : 84);
    }
    ctx.els.pill = ctx.shadow.getElementById('pt-pill');
    ctx.els.tokenName = ctx.shadow.getElementById('pt-token-name');
    ctx.els.tokenMint = ctx.shadow.getElementById('pt-token-mint');
    ctx.els.price = ctx.shadow.getElementById('pt-price');
    ctx.els.priceUsd = ctx.shadow.getElementById('pt-price-usd');
    ctx.els.buyPresets = ctx.shadow.getElementById('pt-buy-presets');
    ctx.els.sellPresets = ctx.shadow.getElementById('pt-sell-presets');
    ctx.els.buyMeta = ctx.shadow.getElementById('pt-buy-meta');
    ctx.els.sellMeta = ctx.shadow.getElementById('pt-sell-meta');
    ctx.els.balanceChip = ctx.shadow.getElementById('pt-balance-val');
    ctx.els.holdings = ctx.shadow.getElementById('pt-holdings');
    ctx.els.walletBadge = ctx.shadow.getElementById('pt-wallet-badge');
    ctx.els.statBought = ctx.shadow.getElementById('pt-stat-bought');
    ctx.els.statSold = ctx.shadow.getElementById('pt-stat-sold');
    ctx.els.statHoldings = ctx.shadow.getElementById('pt-stat-holdings');
    ctx.els.statPnl = ctx.shadow.getElementById('pt-stat-pnl');
    ctx.els.buyLabel = null;
    ctx.els.custom = ctx.shadow.getElementById('pt-custom');
    ctx.els.costs = null;
    ctx.els.editor = ctx.shadow.getElementById('pt-editor');
    ctx.els.editBuy = ctx.shadow.getElementById('pt-edit-buy');
    ctx.els.editSell = ctx.shadow.getElementById('pt-edit-sell');
    ctx.els.editFee = ctx.shadow.getElementById('pt-edit-fee');
    ctx.els.editGas = ctx.shadow.getElementById('pt-edit-gas');
    ctx.els.editTip = ctx.shadow.getElementById('pt-edit-tip');
    ctx.els.editSlip = ctx.shadow.getElementById('pt-edit-slip');
    ctx.els.btnBuy = ctx.shadow.getElementById('pt-buy');
    ctx.els.position = ctx.shadow.getElementById('pt-position');
    ctx.els.closed = ctx.shadow.getElementById('pt-closed');
    ctx.els.effects = ctx.shadow.getElementById('pt-effects');
    ctx.els.footSite = null;
    ctx.els.subtitle = null;
    ctx.els.bar = ctx.shadow.getElementById('pt-bar');
    ctx.els.barGrip = ctx.shadow.getElementById('pt-bar-grip');
    ctx.els.barTotal = ctx.shadow.getElementById('pt-bar-total');
    ctx.els.barStreak = ctx.shadow.getElementById('pt-bar-streak');
    ctx.els.gameHud = ctx.shadow.getElementById('pt-game-hud');
    ctx.els.barRail = ctx.shadow.getElementById('pt-bar-rail');
    ctx.els.barTab = ctx.shadow.getElementById('pt-bar-tab');
    ctx.els.liveDot = ctx.shadow.getElementById('pt-live-dot');
    ctx.els.visibility = null;
    ctx.els.pillText = ctx.shadow.getElementById('pt-pill-text');
    ctx.els.resize = ctx.shadow.getElementById('pt-resize');

    bindUI();
    syncActiveProfilePresets();
    ctx.shadow.querySelectorAll('.pt-profile').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.profile) === (ctx.settings.activeProfile || 0));
    });
    renderPresets();
    renderAll();
    applyOverlaySize();
  }

  // ELI5: Hook up every button, drag handle, and click in the panel.
  function bindUI() {
    // A user gesture unlocks Web Audio so a later hidden-tab profit bell is
    // allowed to play. Creating/resuming here is silent.
    ctx.els.box.addEventListener('pointerdown', () => {});

    if (ctx.els.visibility) ctx.els.visibility.addEventListener('click', toggleOverlayAutoHide);
    const quickReset = ctx.shadow.getElementById('pt-quickreset');
    if (quickReset) quickReset.addEventListener('click', () => onQuickResetTap(quickReset));
    // Every corner is a resize grip (reported: "should be able to be resized
    // from all four corners").
    ctx.shadow.querySelectorAll('[data-corner]').forEach((grip) =>
      grip.addEventListener('pointerdown', (e) => onOverlayResizeStart(e, grip.dataset.corner)));
    ctx.shadow.getElementById('pt-min').addEventListener('click', () => {
      panelMinimized = true;
      setPanelVisible(true);
    });
    ctx.els.pill.addEventListener('click', () => {
      // A drop at the end of a pill drag also fires click; only a TAP
      // restores the panel (O-20).
      if (pillDrag && pillDrag.justDragged()) return;
      panelMinimized = false;
      setPanelVisible(true);
    });
    // Positions bar controls.
    if (ctx.els.gameHud) ctx.els.gameHud.addEventListener('click', () => {});
    if (ctx.els.walletBadge) ctx.els.walletBadge.addEventListener('click', () => {
      if (ctx.settings.positionsBarHidden) ctx.setBarHidden(false);
    });
    // decorated terminal and the minimal one in place, with a soft pulse —
    // no dashboard round-trip. The flip persists so every surface agrees.
    const focusToggle = ctx.shadow.getElementById('pt-focus-toggle');
    if (focusToggle) {
      focusToggle.addEventListener('click', async () => {
        ctx.settings = { ...ctx.settings, panelFocusMode: ctx.settings.panelFocusMode !== true };
        if (ctx.els.box) {
          ctx.els.box.classList.remove('pt-morph');
          void ctx.els.box.offsetWidth; // restart the pulse (the one sanctioned reflow)
          ctx.els.box.classList.add('pt-morph');
        }
        applyFocusMode();
        renderAll();
        try { await ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings }); } catch (_) {}
      });
    }
    // Wave 1: the footer "Reset wallet" link is gone — the header's two-tap
    // ⟲ (formerly focus-only) is the panel's one reset in every mode.
    // Wave 1 (F-B7): the mint pill earns its pixels — click copies the mint.
    if (ctx.els.tokenMint) {
      ctx.els.tokenMint.style.cursor = 'pointer';
      ctx.els.tokenMint.title = 'Click to copy the mint address';
      ctx.els.tokenMint.addEventListener('click', () => {
        if (!ctx.token || !ctx.token.mint) return;
        try {
          navigator.clipboard.writeText(ctx.token.mint).then(
            () => ctx.toast('Mint copied'),
            () => ctx.toast('Copy failed — clipboard blocked')
          );
        } catch (_) { ctx.toast('Copy failed — clipboard blocked'); }
      });
    }
    ctx.els.btnBuy.addEventListener('click', () => {
      const custom = Number(ctx.els.custom.value);
      // Panel units throughout — dollars on a foreign-chain panel, SOL
      // otherwise; ctx.requestBuy owns the conversion.
      const amt = custom > 0 ? custom : lastBuyPresetAmt > 0 ? lastBuyPresetAmt : 0;
      if (!(amt > 0)) return ctx.toast(ctx.panelUsd() ? 'Pick a dollar amount first' : 'Pick a SOL amount first');
      ctx.requestBuy(amt);
    });
    // Enter in the amount box IS the buy — in compact focus mode the big
    // button is gone (the chips are the buttons), and in normal mode this
    // just saves a mouse trip.
    ctx.els.custom.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') ctx.els.btnBuy.click();
    });
    ctx.shadow.getElementById('pt-edit').addEventListener('click', () => togglePresetEditor());
    const settingsBtn = ctx.shadow.getElementById('pt-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => {
      ctx.els.box.classList.toggle('pt-show-custom');
      settingsBtn.classList.toggle('on', ctx.els.box.classList.contains('pt-show-custom'));
    });
    const hotkeys = ctx.shadow.getElementById('pt-hotkeys');
    if (hotkeys) hotkeys.addEventListener('click', () => {
      ctx.toast('Paper trading — click a preset to buy or sell instantly');
    });
    ctx.shadow.querySelectorAll('.pt-profile').forEach((btn) => {
      btn.addEventListener('click', () => applyProfile(Number(btn.dataset.profile) || 0));
    });
    const sellBlock = ctx.shadow.querySelector('.pt-sell-block');
    if (sellBlock) {
      sellBlock.addEventListener('click', (e) => {
        if (e.target.closest('#pt-sell-init')) sellInitial();
      });
    }
    const buyBlock = ctx.shadow.querySelector('.pt-buy-block');
    if (buyBlock) {
      buyBlock.addEventListener('change', (e) => {
        if (e.target.id === 'pt-adv-buy') {
          ctx.els.box.classList.toggle('pt-show-custom', e.target.checked);
          const settingsBtn = ctx.shadow.getElementById('pt-settings-btn');
          if (settingsBtn) settingsBtn.classList.toggle('on', e.target.checked);
          renderPresets();
        }
      });
    }
    ctx.shadow.getElementById('pt-edit-save').addEventListener('click', savePresetEditor);
    ctx.shadow.getElementById('pt-edit-cancel').addEventListener('click', () => togglePresetEditor(false));

    // "Make it remember its place" (levv6x): the dragged position must
    // survive page refreshes and new tabs. Persist it on drop and restore it
    // in createUI. The header is the handle; buttons on it are exempt.
    const drag = ctx.shadow.getElementById('pt-drag');
    const persistPanelPos = () => {
      const read = ctx.readPanelPos();
      const pos = ctx.clampPanelPos(read.right, read.top);
      // O-19: a legitimate 0 persists as 0 — never snapped to the default.
      ctx.settings.panelRight = pos.right;
      ctx.settings.panelTop = pos.top;
      try {
        ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings });
      } catch (_) {}
    };
    const panelSpec = {
      start: ctx.readPanelPos,
      move: (start, dx, dy) => ctx.applyPanelPos(start.right - dx, start.top + dy),
      drop: persistPanelPos,
    };
    ctx.makeDraggable(drag, {
      ...panelSpec,
      ignore: (e) => Boolean(e.target && e.target.closest && e.target.closest('button')),
    });
    // O-20: the minimized pill shares the panel's position and is a drag
    // handle itself — dragging it moves (and persists) the shared spot.
    pillDrag = ctx.makeDraggable(ctx.els.pill, panelSpec);
    ctx.bindBarUI();
  }

  function ensureProfiles() {
    if (!Array.isArray(ctx.settings.presetProfiles) || ctx.settings.presetProfiles.length < 3) {
      const currentBuy = ctx.settings.presetsBuy || DEFAULT_PROFILES[0].buy;
      const currentSell = ctx.settings.sellPcts || DEFAULT_PROFILES[0].sell;
      ctx.settings.presetProfiles = DEFAULT_PROFILES.map((p, i) => (i === 0
        ? { buy: currentBuy.slice(), sell: currentSell.slice() }
        : { buy: p.buy.slice(), sell: p.sell.slice() }));
    }
    if (typeof ctx.settings.activeProfile !== 'number' || ctx.settings.activeProfile < 0 || ctx.settings.activeProfile > 2) {
      ctx.settings.activeProfile = 0;
    }
    // Repair P1 if it was saved with P2's buy row (early profile-switch bug).
    const p1 = ctx.settings.presetProfiles[0];
    const p2row = DEFAULT_PROFILES[1].buy.slice(0, 4);
    if (p1 && Array.isArray(p1.buy) && p1.buy.length >= 4
        && p1.buy.slice(0, 4).every((v, i) => v === p2row[i])) {
      ctx.settings.presetProfiles[0] = {
        buy: DEFAULT_PROFILES[0].buy.slice(),
        sell: DEFAULT_PROFILES[0].sell.slice(),
      };
    }
  }

  function syncActiveProfilePresets() {
    ensureProfiles();
    const idx = ctx.settings.activeProfile || 0;
    const profile = ctx.settings.presetProfiles[idx];
    ctx.settings.presetsBuy = profile.buy.slice();
    ctx.settings.sellPcts = profile.sell.slice();
  }

  function applyProfile(idx) {
    ensureProfiles();
    ctx.settings.activeProfile = idx;
    const profile = ctx.settings.presetProfiles[idx];
    ctx.settings.presetsBuy = profile.buy.slice();
    ctx.settings.sellPcts = profile.sell.slice();
    ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings }).catch(() => {});
    if (ctx.shadow) {
      ctx.shadow.querySelectorAll('.pt-profile').forEach((b) => {
        b.classList.toggle('on', Number(b.dataset.profile) === idx);
      });
    }
    renderPresets();
  }

  function saveCurrentProfile() {
    ensureProfiles();
    ctx.settings.presetProfiles[ctx.settings.activeProfile || 0] = {
      buy: (ctx.settings.presetsBuy || []).slice(),
      sell: (ctx.settings.sellPcts || []).slice(),
    };
  }

  function padPresets(list, len, fallback) {
    const out = (list || []).slice();
    while (out.length < len) out.push(fallback[out.length % fallback.length] || fallback[fallback.length - 1]);
    return out.slice(0, len);
  }

  function formatSubscriptFee(n) {
    const v = Number(n) || 0;
    if (v <= 0) return '0';
    if (v >= 0.01) return String(v);
    const s = v.toFixed(12).replace(/0+$/, '');
    const m = s.match(/^0\.(0+)([1-9])/);
    if (!m) return String(v);
    const sub = '₀₁₂₃₄₅₆₇₈₉';
    const zeros = String(m[1].length).split('').map((d) => sub[Number(d)]).join('');
    return `0.0${zeros}${m[2]}`;
  }

  // ELI5: Draw the buy and sell preset buttons with your saved amounts.
  function renderPresets() {
    ensureProfiles();
    const sectionOn = ctx.settings.panelBuyEnabled !== false;
    const presetsOn = sectionOn && ctx.settings.panelPresetsEnabled !== false;
    if (ctx.els.custom) ctx.els.custom.style.display = ctx.els.box && ctx.els.box.classList.contains('pt-show-custom') ? '' : 'none';
    if (ctx.els.btnBuy) ctx.els.btnBuy.style.display = ctx.els.box && ctx.els.box.classList.contains('pt-show-custom') ? '' : 'none';
    if (!ctx.els.buyPresets) return;

    const usdMode = ctx.panelUsd();
    const buyList = padPresets(
      usdMode ? (ctx.settings.presetsBuyUsd || USD_PRESETS_DEFAULT) : (ctx.settings.presetsBuy || DEFAULT_PROFILES[0].buy),
      8,
      usdMode ? [10, 100, 500, 1000] : DEFAULT_PROFILES[0].buy
    );
    const instant = ctx.settings.instantBuyEnabled !== false;
    renderBalance();
    renderTradeMeta();
    if (!presetsOn) {
      ctx.els.buyPresets.innerHTML = '';
      renderSellPresets();
      return;
    }

    lastBuyPresetAmt = Number(buyList[0]) || 0;
    ctx.els.buyPresets.innerHTML = buyList.map((a) =>
      `<button class="pt-preset pt-preset-buy" data-amt="${a}" type="button">${usdMode ? `$${a}` : a}</button>`
    ).join('');
    ctx.els.buyPresets.querySelectorAll('.pt-preset-buy').forEach((b) => {
      b.addEventListener('click', () => {
        const amt = Number(b.dataset.amt);
        lastBuyPresetAmt = amt;
        if (ctx.els.custom) ctx.els.custom.value = '';
        if (instant) ctx.requestBuy(amt);
      });
    });
    renderSellPresets();
  }

  function renderSellPresets() {
    if (!ctx.els.sellPresets) return;
    const sellList = padPresets(ctx.settings.sellPcts || DEFAULT_PROFILES[0].sell, 8, DEFAULT_PROFILES[0].sell);
    ctx.els.sellPresets.innerHTML = sellList.map((p) =>
      `<button class="pt-preset pt-preset-sell" data-pct="${p}" type="button">${p}%</button>`
    ).join('');
    ctx.els.sellPresets.querySelectorAll('.pt-preset-sell').forEach((b) => {
      b.addEventListener('click', () => {
        ctx.doSell(Number(b.dataset.pct) / 100);
      });
    });
  }

  function renderTradeMeta() {
    const slipBuy = Number(ctx.settings.buySlippagePct) || 30;
    const slipSell = Number(ctx.settings.sellSlippagePct) || 70;
    const gas = Number(ctx.settings.gasSolPerTx) || 0;
    const tip = Number(ctx.settings.tipSolPerTx) || 0;
    const slip = ctx.ICONS.palm;
    const doc = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h4"/></svg>';
    const cylinder = '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="7" rx="6" ry="2.5"/><path d="M6 7v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7"/><path d="M6 12v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5"/></svg>';
    const ban = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/></svg>';
    const warn = '<span class="pt-meta-warn">⚠</span>';
    const gasBuy = formatSubscriptFee(gas);
    const tipBuy = formatSubscriptFee(tip);
    const gasSell = formatSubscriptFee(gas);
    const tipSell = formatSubscriptFee(tip);

    if (ctx.els.buyMeta) {
      ctx.els.buyMeta.innerHTML = `
        <div class="pt-meta-left">
          <span class="pt-meta-item">${slip} ${slipBuy}%</span>
          <span class="pt-meta-item">${doc} <span class="pt-meta-fee">${gasBuy}</span>${warn}</span>
          <span class="pt-meta-item">${cylinder} <span class="pt-meta-fee">${tipBuy}</span>${warn}</span>
          <span class="pt-meta-item">${ban} Off</span>
        </div>
        <label class="pt-meta-adv"><input type="checkbox" id="pt-adv-buy"> Adv.</label>`;
      const adv = ctx.els.buyMeta.querySelector('#pt-adv-buy');
      if (adv) adv.checked = ctx.els.box && ctx.els.box.classList.contains('pt-show-custom');
    }
    if (ctx.els.sellMeta) {
      ctx.els.sellMeta.innerHTML = `
        <div class="pt-meta-left">
          <span class="pt-meta-item">${slip} ${slipSell}%</span>
          <span class="pt-meta-item">${doc} <span class="pt-meta-fee">${gasSell}</span>${warn}</span>
          <span class="pt-meta-item">${cylinder} <span class="pt-meta-fee">${tipSell}</span>${warn}</span>
          <span class="pt-meta-item">${ban} Off</span>
        </div>
        <button class="pt-sell-init" id="pt-sell-init" type="button">Sell Init.</button>`;
    }
  }

  function fitStatPnlFont() {
    const el = ctx.els.statPnl;
    if (!el) return;
    const row = el.closest('.pt-stat-pnl-cell');
    if (!row) return;
    const ui = ctx.PT_AXIOM_UI || {};
    const maxPx = Number(ui.statPnlFontSize) || 11;
    const minPx = Number(ui.statPnlMinFontSize) || 7;
    const icon = row.querySelector('.pt-stat-icon');
    const avail = Math.max(0, row.clientWidth - (icon ? icon.offsetWidth : 0) - 12);
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    if (!(avail > 0)) {
      requestAnimationFrame(() => fitStatPnlFont());
      return;
    }
    while (size > minPx && el.scrollWidth > avail) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }

  function renderStatsBar() {
    const positions = Object.values(ctx.state.positions || {});
    const openCount = positions.length;
    const walletCount = ctx.els.walletBadge && ctx.els.walletBadge.querySelector('#pt-wallet-count');
    if (walletCount) walletCount.textContent = String(openCount);

    const mint = ctx.token && ctx.token.mint;
    const bought = mint ? ctx.E.tradeBoughtSol(ctx.state, mint) : 0;
    const sold = mint ? ctx.E.tradeSoldSol(ctx.state, mint) : 0;
    const holdings = mint && ctx.token
      ? ctx.E.tradeHoldingsSol(ctx.state, mint, ctx.token.priceNative)
      : 0;
    let pnlSol = 0;
    let pnlPct = 0;

    if (mint) {
      const pnl = ctx.E.tradePnl(ctx.state, mint, ctx.token && ctx.token.priceNative);
      pnlSol = pnl.pnlSol;
      pnlPct = pnl.pnlPct;
    }

    if (ctx.els.statBought) ctx.els.statBought.textContent = ctx.E.fmt(bought, 2);
    if (ctx.els.statSold) ctx.els.statSold.textContent = ctx.E.fmt(sold, 2);
    if (ctx.els.statHoldings) ctx.els.statHoldings.textContent = ctx.E.fmt(holdings, 2);
    if (ctx.els.statPnl) {
      const solSign = pnlSol >= 0 ? '+' : '';
      const pctSign = pnlPct >= 0 ? '+' : '';
      const pctWhole = Math.round(pnlPct);
      ctx.els.statPnl.textContent = `${solSign}${ctx.E.fmt(pnlSol, 3)} (${pctSign}${pctWhole}%)`;
      ctx.els.statPnl.classList.toggle('up', pnlSol >= 0);
      ctx.els.statPnl.classList.toggle('down', pnlSol < 0);
      ctx.els.statPnl.classList.toggle('green', pnlSol >= 0);
      fitStatPnlFont();
    }
  }

  function formatHoldingsUsd(solVal, priceNative, priceUsd) {
    if (!(solVal > 0)) return '$0';
    const px = Number(priceNative);
    const usdPx = Number(priceUsd);
    if (px > 0 && usdPx > 0) {
      const usd = solVal * (usdPx / px);
      if (usd >= 1000) return `$${ctx.E.fmtCompact(usd)}`;
      return `$${ctx.E.fmt(usd, 0)}`;
    }
    return '$0';
  }

  function renderHoldingsLine(qty, sym, usd, solVal) {
    const symLabel = qty > 0 ? ctx.E.fmtShortSymbol(sym) : sym;
    return [
      `<span class="pt-hold-qty">${ctx.E.fmtCompact(qty)} ${symLabel}</span>`,
      '<span class="pt-hold-sep">•</span>',
      `<span class="pt-hold-usd">${usd}</span>`,
      '<span class="pt-hold-sep">•</span>',
      `<span class="pt-hold-sol">${ctx.solLogo('#14F195', 10)} ${ctx.E.fmt(solVal, 2)}</span>`,
    ].join('');
  }

  function renderHoldings() {
    if (!ctx.els.holdings) return;
    if (!ctx.token) {
      ctx.els.holdings.innerHTML = renderHoldingsLine(0, '—', '$0', 0);
      return;
    }
    const sym = ctx.token.symbol || 'TOKEN';
    const pos = ctx.state.positions[ctx.token.mint];
    const qty = pos ? (pos.qty || 0) : 0;
    const solVal = ctx.E.tradeHoldingsSol(ctx.state, ctx.token.mint, ctx.token.priceNative);
    const usd = formatHoldingsUsd(solVal, ctx.token.priceNative, ctx.token.priceUsd);
    ctx.els.holdings.innerHTML = renderHoldingsLine(qty, sym, usd, solVal);
  }

  function sellInitial() {
    const pos = ctx.token && ctx.state.positions[ctx.token.mint];
    if (!pos || !ctx.token || !ctx.token.priceNative) {
      ctx.toast('No position to recover');
      return;
    }
    ctx.E.backfillPosition(ctx.state, pos);
    const cost = ctx.E.grossOpenCostSol(pos);
    const value = (pos.qty || 0) * ctx.token.priceNative;
    if (!(value > 0) || !(cost > 0)) {
      ctx.toast('No cost basis to recover');
      return;
    }
    const pct = Math.min(100, (cost / value) * 100);
    ctx.doSell(pct / 100);
  }

  /** The Buy label doubles as the balance line in compact focus mode — the
   * balance card is hidden there ("the less information in the tab the
   * better"), but cash on hand is execution information, not decoration. */
  function buyLabelText() {
    // Wave 2 (F-B6/F-H2): the balance CARD is gone — cash rides here in
    // every mode, and the label stops narrating what the chips already say.
    if (ctx.panelUsd()) {
      const rate = ctx.panelUsdRate();
      // Cash converted at the recorded rate, so the number is spendable
      // truth: $1000 shown means a $1000 preset fills.
      return rate ? `Buy ($) · $${ctx.E.fmt(ctx.state.cashSol * rate, 0)} cash` : 'Buy ($)';
    }
    return `Buy (SOL) · ${ctx.E.fmt(ctx.state.cashSol, 2)} cash`;
  }

  /** The simulated-cost strip under the presets: fee, gas, tip, slippage at
   * a glance, like the terminals' own widgets. Clicking it opens the inline
   * editor — these are the numbers people re-tune mid-session. */
  function renderCosts() {
    if (!ctx.els.costs) return;
    if (ctx.settings.panelBuyEnabled === false) { ctx.els.costs.style.display = 'none'; return; }
    ctx.els.costs.style.display = '';
    const feePct = (Number(ctx.settings.feeBps) || 0) / 100;
    const slipPct = (Number(ctx.settings.slippageBps) || 0) / 100;
    // Wave 1: only costs that EXIST get a chip — "Gas 0 · Tip 0 · Slip 0%"
    // was three no-op chips narrating ctx.settings forever. The full set always
    // lives in the ✎ editor; an all-zero setup shows one honest word.
    const chips = [];
    if (feePct > 0) chips.push(`Fee ${feePct}%`);
    if (Number(ctx.settings.gasSolPerTx) > 0) chips.push(`Gas ${ctx.settings.gasSolPerTx}`);
    if (Number(ctx.settings.tipSolPerTx) > 0) chips.push(`Tip ${ctx.settings.tipSolPerTx}`);
    if (slipPct > 0) chips.push(`Slip ${slipPct}%`);
    if (!chips.length) chips.push('No costs set');
    ctx.els.costs.innerHTML = chips.map((c) => `<span>${c}</span>`).join('');
  }

  /* -------------------- inline preset editor --------------------
   * lev, round two: "when i asked for this i didn't mean these to be added
   * in the extension but in the trading tab itself" — the pencil on the
   * panel header (and the cost strip) opens this. Same ctx.settings keys and
   * the SAME validation rules as the dashboard and popup (ctx.Q.parsePresetList
   * is the single source): a bad value keeps the saved value and says so. */

  function togglePresetEditor(force) {
    if (!ctx.els.editor) return;
    const open = force === undefined ? ctx.els.editor.style.display === 'none' : Boolean(force);
    if (open) {
      // The buy row edits the list the panel is SHOWING: dollar presets on
      // a foreign-chain panel, SOL presets otherwise.
      ctx.els.editBuy.value = (ctx.panelUsd()
        ? (ctx.settings.presetsBuyUsd || USD_PRESETS_DEFAULT)
        : (ctx.settings.presetsBuy || [0.1, 0.5, 1, 2])).join(', ');
      ctx.els.editSell.value = (ctx.settings.sellPcts || [25, 50, 75, 100]).join(', ');
      ctx.els.editFee.value = (Number(ctx.settings.feeBps) || 0) / 100;
      ctx.els.editGas.value = Number(ctx.settings.gasSolPerTx) > 0 ? ctx.settings.gasSolPerTx : '';
      ctx.els.editTip.value = Number(ctx.settings.tipSolPerTx) > 0 ? ctx.settings.tipSolPerTx : '';
      ctx.els.editSlip.value = (Number(ctx.settings.slippageBps) || 0) / 100;
    }
    ctx.els.editor.style.display = open ? '' : 'none';
  }

  async function savePresetEditor() {
    const notes = [];
    const patch = {};

    // Same row, two ledgers: dollar presets on foreign-chain panels (cap
    // $100k), SOL presets otherwise (cap 1000) — each saved to its own key
    // so switching chains never rewrites the other currency's list.
    const usdMode = ctx.panelUsd();
    const buyCap = usdMode ? 100000 : 1000;
    const buy = ctx.Q.parsePresetList(ctx.els.editBuy.value, buyCap);
    if (buy && buy.values.length) {
      patch[usdMode ? 'presetsBuyUsd' : 'presetsBuy'] = buy.values;
      if (buy.dropped > 0) notes.push(`${buy.dropped} buy preset(s) rejected (each must be > 0 and ≤ ${buyCap}, max 8)`);
    } else if (buy) {
      notes.push('buy presets: no valid entries — kept the saved list');
    }
    const sell = ctx.Q.parsePresetList(ctx.els.editSell.value, 100, { dedupe: true });
    if (sell && sell.values.length) {
      patch.sellPcts = sell.values;
      if (sell.dropped > 0) notes.push(`${sell.dropped} sell preset(s) rejected (1–100, no repeats, max 8)`);
    } else if (sell) {
      notes.push('sell presets: no valid entries — kept the saved list');
    }

    // Costs enter as the % the ctx.site UIs show; stored as bps like everywhere
    // else. Bounds mirror the dashboard exactly (D-11/D-23).
    const feePct = Number(ctx.els.editFee.value);
    if (String(ctx.els.editFee.value).trim() !== '' && Number.isFinite(feePct) && feePct >= 0) {
      patch.feeBps = Math.min(1000, Math.max(0, Math.round(feePct * 100)));
    }
    const gas = Number(ctx.els.editGas.value);
    patch.gasSolPerTx = Number.isFinite(gas) && gas > 0 ? Math.min(gas, 0.5) : 0;
    const tip = Number(ctx.els.editTip.value);
    patch.tipSolPerTx = Number.isFinite(tip) && tip > 0 ? Math.min(tip, 0.5) : 0;
    const slipPct = Number(ctx.els.editSlip.value);
    if (String(ctx.els.editSlip.value).trim() !== '' && Number.isFinite(slipPct) && slipPct >= 0) {
      patch.slippageBps = Math.min(2000, Math.max(0, Math.round(slipPct * 100)));
    }

    ctx.settings = { ...ctx.settings, ...patch };
    saveCurrentProfile();
    await ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings });
    renderPresets();
    ctx.renderPosition();
    togglePresetEditor(false);
    ctx.toast(notes.length ? `Saved · ${notes.join(' · ')}` : 'Presets & fees saved — live everywhere');
  }

  /**
   * Show or hide only the main panel and its minimized pill. The positions bar
   * is intentionally left alone: it must remain visible on non-coin pages when
   * the user has open positions.
   */
  function applyOverlaySize() {
    if (!ctx.els.box || resizingOverlay) return;
    const axiom = ctx.els.box.classList.contains('pt-axiom');
    const w = ctx.settings.overlayWidth;
    const h = ctx.settings.overlayHeight;
    if (axiom) {
      ctx.els.box.style.width = '';
      ctx.els.box.style.minWidth = '';
      ctx.els.box.style.maxWidth = '';
      if (ctx.PT_AXIOM_UI.panelHeight != null) {
        ctx.els.box.style.height = '';
        ctx.els.box.style.maxHeight = '';
      }
    } else {
      ctx.els.box.style.width = (w && Number(w) > 0) ? `${w}px` : '';
    }
    if (!axiom || ctx.PT_AXIOM_UI.panelHeight == null) {
      // The saved height is a CAP, not a command: a panel with less content
      // stays content-sized (no dead space), a panel with more scrolls inside
      // it. "It even lets you size it wrong" — not anymore.
      ctx.els.box.style.height = '';
      ctx.els.box.style.maxHeight = (h && Number(h) > 0) ? `min(${h}px, 88vh)` : '';
    }
  }

  function onOverlayResizeStart(e, corner) {
    if (!ctx.els.box) return;
    e.preventDefault();
    resizingOverlay = true;
    resizeStart = {
      x: e.clientX,
      y: e.clientY,
      w: ctx.els.box.offsetWidth,
      h: ctx.els.box.offsetHeight,
      top: ctx.readPanelPos().top,
      corner: corner || 'br',
      pointerId: e.pointerId,
      grip: e.currentTarget,
    };
    // Pointer CAPTURE is the un-stick fix (reported: a misclick "doesn't
    // actually unclick"): the old window-listener-only pattern waited for a
    // pointerup that never came when the gesture was cancelled (drag out of
    // window, context menu, touch cancel), leaving the drag latched on every
    // later mouse move. Capture guarantees a terminal event fires.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    window.addEventListener('pointermove', onOverlayResizeMove, { passive: false });
    window.addEventListener('pointerup', onOverlayResizeEnd);
    window.addEventListener('pointercancel', onOverlayResizeEnd);
  }

  function onOverlayResizeMove(e) {
    if (!resizingOverlay || !resizeStart || !ctx.els.box) return;
    e.preventDefault();
    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    const c = resizeStart.corner;
    // Right/top-anchored panel: width always adjusts the LEFT edge (the
    // right edge is planted), so left-corner drags invert dx. Top-corner
    // drags grow upward: `top` follows the clamped height so the bottom
    // edge stays planted.
    const wantW = (c === 'br' || c === 'tr') ? resizeStart.w + dx : resizeStart.w - dx;
    const wantH = (c === 'br' || c === 'bl') ? resizeStart.h + dy : resizeStart.h - dy;
    const { w, h } = ctx.clampOverlaySize(wantW, wantH);
    ctx.els.box.style.width = `${w}px`;
    ctx.els.box.style.height = `${h}px`;
    if (c === 'tr' || c === 'tl') {
      ctx.els.box.style.top = `${Math.max(0, resizeStart.top + (resizeStart.h - h))}px`;
    }
  }

  async function onOverlayResizeEnd() {
    window.removeEventListener('pointermove', onOverlayResizeMove);
    window.removeEventListener('pointerup', onOverlayResizeEnd);
    window.removeEventListener('pointercancel', onOverlayResizeEnd);
    const start = resizeStart;
    if (start && start.grip && start.pointerId !== undefined) {
      try { start.grip.releasePointerCapture(start.pointerId); } catch (_) {}
    }
    // DEFECT O-06: the flag must clear on EVERY exit path. The old early
    // return before it could latch resizingOverlay=true forever, permanently
    // disabling applyOverlaySize() for the rest of the page.
    resizingOverlay = false;
    resizeStart = null;
    if (!start || !ctx.els.box) return;
    const next = {
      ...ctx.settings,
      overlayWidth: ctx.els.box.offsetWidth,
      overlayHeight: ctx.els.box.offsetHeight,
    };
    if (start.corner === 'tr' || start.corner === 'tl') {
      const top = parseInt(ctx.els.box.style.top, 10);
      next.panelTop = Number.isFinite(top) ? Math.max(0, top) : start.top;
    }
    ctx.settings = next;
    await ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings });
    // Wave 1 (F-D3): growing the right-anchored panel wider while parked
    // near the left edge pushed content past x=0 and nothing healed it
    // until the next drag. Resize ends clamped, like drags do.
    ctx.reclampPanel();
    fitStatPnlFont();
  }

  function setPanelVisible(visible) {
    if (!ctx.els.box || !ctx.els.pill) return;
    if (!visible) {
      ctx.els.box.classList.add('pt-hidden');
      ctx.els.pill.style.display = 'none';
      return;
    }
    if (panelMinimized) {
      // O-20: the pill appears where the panel is, not at a hardcoded
      // top-right. Read the position BEFORE hiding the box.
      const pos = ctx.readPanelPos();
      ctx.els.box.classList.add('pt-hidden');
      ctx.els.pill.style.right = pos.right + 'px';
      ctx.els.pill.style.top = pos.top + 'px';
      ctx.els.pill.style.left = 'auto';
      // O-27: the pill is styled as a flex row (dot + label); display:block
      // broke its centering.
      ctx.els.pill.style.display = 'flex';
    } else {
      ctx.els.box.classList.remove('pt-hidden');
      ctx.els.pill.style.display = 'none';
      // Wave 1 (F-D4): a pill parked at the far edge restored a panel that
      // hung mostly off-screen (the box measured width 0 while hidden, so
      // the clamp had used the 40px sliver). Restore with real geometry.
      ctx.reclampPanel();
    }
  }

  /**
   * Update the main panel visibility based on the auto-hide setting and the
   * presence of a ctx.token. The overlay is hidden when the user is on a non-coin
   * page and auto-hide is enabled, and reappears when a ctx.token is detected or
   * auto-hide is turned off.
   */
  // ELI5: Hide the panel on non-coin pages if auto-hide is on.
  function updateOverlayVisibility() {
    if (!ctx.host) return;
    // A pending ctx.token that keeps failing to resolve with no sign of market
    // activity is a false positive — an address-shaped but dead route. It
    // must count as "no ctx.token" or the panel pins open on non-trading pages
    // forever (DEFECT O-10). A YOUNG pending ctx.token stays visible: that is
    // the fresh-launch sniping window, and hiding it would kill the arm-buy
    // flow the pending ctx.state exists for.
    const unresolvable = ctx.token && ctx.token.pending
      && ctx.pendingAttempts > 40
      && !(Number(ctx.token.priceNative) > 0)
      && Date.now() - ctx.lastMcapTickAt > 15_000;
    const hide = ctx.settings.overlayHideWhenNoToken && (!ctx.token || unresolvable);
    setPanelVisible(!hide);
    renderVisibilityIcon();
  }

  function renderVisibilityIcon() {
    if (!ctx.els.visibility) return;
    // eye = always visible / auto-hide off. eye-off = hides on non-coin pages.
    const autoHide = ctx.settings.overlayHideWhenNoToken !== false;
    ctx.els.visibility.innerHTML = autoHide ? ctx.ICONS['eye-off'] : ctx.ICONS.eye;
    ctx.els.visibility.title = autoHide
      ? 'Overlay auto-hides when no ctx.token is detected'
      : 'Overlay is always visible';
  }

  async function toggleOverlayAutoHide() {
    ctx.settings = { ...ctx.settings, overlayHideWhenNoToken: !ctx.settings.overlayHideWhenNoToken };
    await ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings });
    // The storage listener will also refresh ctx.settings, but we update the UI
    // immediately so the icon and ctx.host display feel instant.
    updateOverlayVisibility();
  }

  async function toggleOverlayEnabled() {
    ctx.settings = { ...ctx.settings, overlayEnabled: !ctx.settings.overlayEnabled };
    await ctx.store.set({ [ctx.E.STORAGE_KEYS.settings]: ctx.settings });
  }

  // ELI5: Refresh everything visible — price, position, presets, bar, etc.
  function renderAll() {
    if (ctx.contextDead() || !ctx.shadow) return;
    applyFocusMode();
    renderHeader();
    renderBalance();
    renderHoldings();
    renderStatsBar();
    ctx.renderPosition();
    renderBuyButton();
    renderClosedPnl();
    renderSiteStatus();
    renderLiveDot();
    updateOverlayVisibility();
    ctx.renderPositionsBar();
  }

  /**
   * Axiom-style focus mode (ctx.settings.panelFocusMode): decoration hidden via
   * the .pt-focus CSS class on the box. Re-applied on every render so a
   * ctx.settings change from the dashboard flips it live, and so the class can
   * never drift from the setting.
   */
  function applyFocusMode() {
    if (!ctx.els.box || !ctx.els.box.classList) return;
    ctx.els.box.classList.add('pt-axiom');
  }

  /* Quick reset (focus mode): no popup — popups steal stream focus — but
   * never one accidental tap either. First tap arms for 3 s, second resets. */

  function onQuickResetTap(btn) {
    const now = Date.now();
    if (now - quickResetArmedAt <= 3000 && quickResetArmedAt > 0) {
      quickResetArmedAt = 0;
      if (quickResetTimer) { clearTimeout(quickResetTimer); quickResetTimer = null; }
      btn.classList.remove('armed');
      btn.innerHTML = ctx.ICONS.timer;
      ctx.quickResetWallet();
      return;
    }
    quickResetArmedAt = now;
    btn.classList.add('armed');
    btn.textContent = 'Sure?';
    if (quickResetTimer) clearTimeout(quickResetTimer);
    quickResetTimer = setTimeout(() => {
      quickResetArmedAt = 0;
      quickResetTimer = null;
      if (btn.isConnected) { btn.classList.remove('armed'); btn.innerHTML = ctx.ICONS.timer; }
    }, 3000);
  }

  function renderSiteStatus() {
    if (ctx.els.liveDot && ctx.site) {
      const detail = ctx.onchainLive ? 'feed: chain' : 'feed: aggregator';
      ctx.els.liveDot.title = detail;
    }
  }

  /**
   * Header rendering is a thin projection of the pure headerFields() contract,
   * so what the user sees is exactly what the tests assert.
   */
  // ELI5: Update token name, price, and market cap at the top of the panel.
  function renderHeader() {
    if (!ctx.els.tokenName) return;

    const f = ctx.Q.headerFields(ctx.token, { lastPriceAt: ctx.lastPriceAt, now: Date.now(), pendingSince: ctx.pendingSince });
    ctx.els.tokenName.textContent = f.title;
    // Distinct fields: the name goes above, the contract address below.
    ctx.els.tokenMint.textContent = ctx.token
      ? f.address
      : (ctx.site ? `${ctx.site.name} — open a ctx.token page` : 'Open a token page');
    ctx.els.price.textContent = f.priceText;
    // Amber for both "no price yet" and "price has gone stale" — either way the
    // number on screen is not currently live.
    ctx.els.price.classList.toggle('pt-price-stale', f.pending || f.stale);

    // The headline is market cap, so the second line carries the label and the
    // unit price rather than repeating the cap.
    // The old label read "MC · $0.0₄21" — which parses as "the MC IS $0.0₄21"
    // when it actually meant "the headline above is the MC; here is the unit
    // price". Say what the number IS (F-31, reported from a live screenshot).
    const secondary = f.priceIsMarketCap
      ? `Price ${f.priceUsdText || (f.hasTrustedPrice ? ctx.Q.formatPrice(ctx.token.priceNative) + ' SOL' : '')}`.trim()
      : (f.priceUsdText || '');
    ctx.els.priceUsd.textContent = f.stale ? `${secondary} · reconnecting…`.trim() : secondary;
  }

  function renderBalance() {
    if (ctx.els.balanceChip) {
      const cash = ctx.panelUsd() && ctx.panelUsdRate()
        ? ctx.state.cashSol * ctx.panelUsdRate()
        : ctx.state.cashSol;
      ctx.els.balanceChip.textContent = ctx.panelUsd()
        ? `$${ctx.E.fmt(cash, 3)}`
        : ctx.E.fmt(cash, 3);
    }
  }


  /** The buy button states its own readiness instead of failing on click. */
  function renderBuyButton() {
    if (!ctx.els.btnBuy) return;
    const ready = Boolean(ctx.token && ctx.token.priceNative);
    if (ctx.armedBuy) {
      const armedText = Number(ctx.armedBuy.usd) > 0
        ? `$${ctx.E.fmt(ctx.armedBuy.usd, 0)}`
        : `${ctx.E.fmt(ctx.armedBuy.amount, 3)} SOL`;
      ctx.els.btnBuy.textContent = `ARMED — ${armedText} ON FIRST QUOTE`;
      ctx.els.btnBuy.classList.add('pt-buy-armed');
      return;
    }
    ctx.els.btnBuy.classList.remove('pt-buy-armed');
    ctx.els.btnBuy.textContent = ready ? 'BUY' : 'BUY WHEN QUOTED';
  }


  /**
   * Commit a fill to the tamper-evident chain.
   *
   * Done at fill time, before the outcome is known, so the chain records what
   * was actually decided rather than what the user later wishes they had done.
   *
   * The chain no longer rides inside pt_state (DEFECT F-14): the background
   * worker is its single writer, appending into segmented storage under one
   * serial lock. Sending the fill instead of rewriting the chain here is what
   * removed the multi-tab full-chain race AND the per-fill cost that grew
   * with lifetime fill count. The chain is still NEVER truncated — dropping
   * links would break verifyChain (the first kept link no longer chains from
   * GENESIS) and replayChain (derived P&L would silently drop early fills);
   * the worker's segmented store bounds the cost of keeping everything.
   *
   * Failure here must never block a trade — the trade is the product; the
   * chain is evidence for an optional leaderboard.
   */

  function renderLiveDot() {
    if (!ctx.els.liveDot) return;
    const hasPrice = Boolean(ctx.token && ctx.token.priceNative);
    const stale = !hasPrice || ctx.Q.isPriceStale(ctx.lastPriceAt, Date.now());
    ctx.els.liveDot.classList.toggle('on', hasPrice && !stale);
    ctx.els.liveDot.classList.toggle('warn', hasPrice && stale);
  }

  /**
   * Micro-sparkline of the recent price series, drawn as an SVG path.
   * Colored by move direction across the window, with a soft area fill and a
   * pulsing head so the newest tick is obvious in peripheral vision.
   */
  /* renderSparkline is gone (Wave 2, F-B3): a 26px copy of the chart the
   * panel floats over was decoration, not signal. */

  /**
   * Keep the newest realized result visible after a sell. Full exits show the
   * complete round-trip result; partial exits show the realized slice.
   */

  function renderClosedPnl() {
    if (!ctx.els.closed) return;
    const closed = ctx.token && ctx.E.latestClosedPnl(ctx.state, ctx.token.mint);
    if (!closed) {
      closedRenderKey = null;
      if (ctx.els.closed.childNodes.length) ctx.els.closed.textContent = '';
      return;
    }

    // Rebuilding the card on every heartbeat re-ran its entry animation —
    // the reported "blinking". Same result: only the ago-text updates,
    // in place; the card itself renders ONCE per close.
    const key = `${closed.kind}·${closed.closedAt}·${closed.pnlSol}`;
    if (key === closedRenderKey && ctx.els.closed.childNodes.length) {
      const agoMeta = ctx.els.closed.querySelector('.pt-closed-meta');
      if (agoMeta) agoMeta.textContent = `Returned ${ctx.E.fmt(closed.returnedSol, 4)} SOL · ${closedAgo(closed.closedAt)}`;
      return;
    }
    closedRenderKey = key;

    const sign = closed.pnlSol >= 0 ? '+' : '';
    const pctSign = closed.pnlPct >= 0 ? '+' : '';
    const badge = closed.kind === 'round' ? 'POSITION CLOSED' : 'PARTIAL EXIT';

    ctx.els.closed.textContent = '';
    const card = document.createElement('div');
    card.className = 'pt-closed';

    const head = document.createElement('div');
    head.className = 'pt-closed-head';
    const title = document.createElement('span');
    title.className = 'pt-closed-title';
    title.textContent = 'Closed P&L';
    const right = document.createElement('span');
    right.style.display = 'inline-flex';
    right.style.alignItems = 'center';
    const status = document.createElement('span');
    status.className = 'pt-closed-badge';
    status.textContent = badge;
    right.appendChild(status);
    head.appendChild(title);
    head.appendChild(right);

    const pnl = document.createElement('div');
    pnl.className = `pt-closed-pnl ${closed.pnlSol >= 0 ? 'pt-green' : 'pt-red'}`;
    pnl.textContent = `${sign}${ctx.E.fmt(closed.pnlSol)} SOL (${pctSign}${closed.pnlPct.toFixed(1)}%)`;

    const meta = document.createElement('div');
    meta.className = 'pt-closed-meta';
    meta.textContent = `Returned ${ctx.E.fmt(closed.returnedSol, 4)} SOL · ${closedAgo(closed.closedAt)}`;

    card.appendChild(head);
    card.appendChild(pnl);
    card.appendChild(meta);
    ctx.els.closed.appendChild(card);
  }

  function closedAgo(ts) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

    return {
      createUI,
      bindUI,
      renderAll,
      renderPresets,
      renderBalance,
      renderHoldings,
      renderStatsBar,
      renderHeader,
      renderBuyButton,
      renderClosedPnl,
      renderLiveDot,
      renderSiteStatus,
      applyFocusMode,
      applyOverlaySize,
      updateOverlayVisibility,
      setPanelVisible,
      togglePresetEditor,
      savePresetEditor,
      toggleOverlayAutoHide,
      toggleOverlayEnabled,
      onOverlayResizeStart,
      onQuickResetTap,
      resetMount() {
        pillDrag = null;
        panelMinimized = false;
        resizingOverlay = false;
        resizeStart = null;
        quickResetArmedAt = 0;
        if (quickResetTimer) { clearTimeout(quickResetTimer); quickResetTimer = null; }
        closedRenderKey = null;
      },
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTPanelControls = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

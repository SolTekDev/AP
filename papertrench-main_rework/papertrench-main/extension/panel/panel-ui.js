/* PaperTrench — panel presentational UI (theme, CSS, icons, shadow shell).
 *
 * Loaded before content.js. Does NOT own trading logic or render updates.
 * Affects: shadow-DOM look of the trade panel + positions bar markup.
 *
 * ELI5: The paint and furniture for the panel — colors, fonts, button shapes,
 * icons, and the HTML skeleton. Think of it as the interior designer: it
 * makes everything look like a sleek trading terminal but does not decide
 * what to buy or sell.
 */
(() => {
  'use strict';

  /* ── Theme + icons + logos + stylesheet ─────────────────────────────── */

  /**
   * Master tuning block for the Axiom-style trading panel.
   * Edit values here — they flow into the panel CSS via custom properties.
   */
  const PT_AXIOM_UI = {   
    // max z index = 2147483647
    // Panel shell
    panelWidth: 310,
    panelHeight: 370,
    borderRadius: 10,
    panelZIndex: 1000, // below site hover popovers; raise if panel sinks under chart chrome
    toastZIndex: 10001, // toasts above the trade panel
    barZIndex: 9999, // positions bar — usually (panelZIndex - 1)

    // Spacing (px) — dense fill for 310×370
    blockPadX: 8,
    blockPadY: 9,
    buyBlockPadTop: 5, // gap above Buy / asset tabs / balance row only
    buyBlockHeadMargin: 10, // gap below Buy header → buy preset buttons
    buyMetaMarginTop: 14, // gap below buy preset buttons → meta row (slip/gas/Adv)
    buyBlockPadBottom: 6, // gap below buy meta row → sell divider
    sellBlockPadTop: 6, // gap above Sell % / holdings row (below divider)
    sellBlockHeadMargin: 8, // gap below Sell header → sell preset buttons
    sellMetaMarginTop: 16, // gap below sell preset buttons → sell meta row
    sellBlockPadBottom: 6, // gap below sell meta row → footer
    blockPadBottom: 6,
    insetMargin: 10,
    toolbarPadY: 11, // top "toolbar" line padding
    toolbarPadX: 8,
    blockHeadMargin: 6,
    metaMarginTop: 6,
    presetGap: 8,
    presetPadY: 5,
    presetRadius: 999,
    presetBorderOpacity: 1,
    presetColumns: 4,
    statPadY: 9,
    statBarPadLeft: 8, // footer left inset for stats group
    statGroupWidth: 185, // bought / sold / holdings block width (px)
    statGroupPadY: 7,
    statGroupPadX: 2,
    statGroupGap: 3,
    statGroupFontSize: 13,
    statGroupIconSize: 10,
    statPnlPadY: 9,
    statPnlFontSize: 13,
    statPnlMinFontSize: 7, // floor when auto-shrinking long PnL readouts
    statPnlIconSize: 11,
    toolbarGap: 2,
  
    // Typography
    fontFamily: 'Geist',
    fontWeight: 'normal',
    fontSize: 13,
    presetFontSize: 14, // buttons
    metaFontSize: 11, // slippage 
    balanceFontSize: 14, // buy-header wallet balance
    balanceIconSize: 12, // SOL icon beside balance
    holdingsFontSize: 14, // holdings %
    statFontSize: 12,
  
    // Colors
    colorBg: '#18181a',
    colorBorder: '#23252c',
    colorShellBorder: '#2c2e3a',
    colorFooterBg: '#18181a',
    colorText: '#c8c9d1',
    colorMuted: '#929399',
    colorMutedHover: '#b3b4bb',
    colorAccent: '#526fff',
    colorBuy: '#2fe3ac',
    colorBuyBorder: '#23735b',
    colorBuyHover: '#2fe3ac',
    colorSell: '#ec397a',
    colorSellBorder: '#772745',
    colorSellHover: '#ec397a',
    colorFee: '#f5c518',
    colorStatTeal: '#2dd7a4',
    colorStatPink: '#ec397a',
    colorStatBlue: '#60a5fa',
    colorStatGreen: '#2fe3ac',
    colorWalletBg: '#16161a',
    colorWalletBorder: '#3a3a42',
    colorAssetTabBg: '#18181a',
    colorAssetTabBorder: '#2f323e',
    colorAssetTabActive: '#2f323e',
  };
  
  /** Z-index tokens for shadow-root shell (panel, toasts, positions bar). */
  function shellZTokens(u = PT_AXIOM_UI) {
    return `
      --pt-panel-z:${u.panelZIndex};
      --pt-toast-z:${u.toastZIndex};
      --pt-bar-z:${u.barZIndex};`;
  }

  /** Emits width/height + --pt-axiom-* custom properties for .pt-box.pt-axiom */
  // ELI5: Turn the theme numbers into CSS variables the stylesheet reads.
  function axiomCssVars(u = PT_AXIOM_UI) {
    const heightRule = u.panelHeight != null
      ? `height:${u.panelHeight}px;min-height:${u.panelHeight}px;max-height:${u.panelHeight}px;`
      : 'max-height:none;';
    return `
      width:${u.panelWidth}px;min-width:${u.panelWidth}px;max-width:${u.panelWidth}px;
      ${heightRule}
      --pt-axiom-bg:${u.colorBg};
      --pt-axiom-border:${u.colorBorder};
      --pt-axiom-shell-border:${u.colorShellBorder};
      --pt-axiom-footer-bg:${u.colorFooterBg};
      --pt-axiom-text:${u.colorText};
      --pt-axiom-muted:${u.colorMuted};
      --pt-axiom-muted-hover:${u.colorMutedHover};
      --pt-axiom-accent:${u.colorAccent};
      --pt-axiom-buy:${u.colorBuy};
      --pt-axiom-buy-border:${u.colorBuyBorder};
      --pt-axiom-buy-hover:${u.colorBuyHover};
      --pt-axiom-sell:${u.colorSell};
      --pt-axiom-sell-border:${u.colorSellBorder};
      --pt-axiom-sell-hover:${u.colorSellHover};
      --pt-axiom-fee:${u.colorFee};
      --pt-axiom-stat-teal:${u.colorStatTeal};
      --pt-axiom-stat-pink:${u.colorStatPink};
      --pt-axiom-stat-blue:${u.colorStatBlue};
      --pt-axiom-stat-green:${u.colorStatGreen};
      --pt-axiom-wallet-bg:${u.colorWalletBg};
      --pt-axiom-wallet-border:${u.colorWalletBorder};
      --pt-axiom-asset-tab-bg:${u.colorAssetTabBg};
      --pt-axiom-asset-tab-border:${u.colorAssetTabBorder};
      --pt-axiom-asset-tab-active:${u.colorAssetTabActive};
      --pt-axiom-radius:${u.borderRadius}px;
      --pt-axiom-font-family:'${u.fontFamily}', ui-sans-serif, sans-serif;
      --pt-axiom-font:${u.fontSize}px;
      --pt-axiom-preset-radius:${u.presetRadius}px;
      --pt-axiom-preset-gap:${u.presetGap}px;
      --pt-axiom-preset-font:${u.presetFontSize}px;
      --pt-axiom-preset-pad-y:${u.presetPadY}px;
      --pt-axiom-preset-border:${u.presetBorderOpacity};
      --pt-axiom-preset-cols:${u.presetColumns};
      --pt-axiom-block-px:${u.blockPadX}px;
      --pt-axiom-block-py:${u.blockPadY}px;
      --pt-axiom-buy-block-pt:${u.buyBlockPadTop}px;
      --pt-axiom-buy-block-head-mb:${u.buyBlockHeadMargin}px;
      --pt-axiom-buy-meta-mt:${u.buyMetaMarginTop}px;
      --pt-axiom-buy-block-pb:${u.buyBlockPadBottom}px;
      --pt-axiom-sell-block-pt:${u.sellBlockPadTop}px;
      --pt-axiom-sell-block-head-mb:${u.sellBlockHeadMargin}px;
      --pt-axiom-sell-meta-mt:${u.sellMetaMarginTop}px;
      --pt-axiom-sell-block-pb:${u.sellBlockPadBottom}px;
      --pt-axiom-block-pb:${u.blockPadBottom}px;
      --pt-axiom-block-head-mb:${u.blockHeadMargin}px;
      --pt-axiom-meta-mt:${u.metaMarginTop}px;
      --pt-axiom-stat-py:${u.statPadY}px;
      --pt-axiom-stat-bar-pl:${u.statBarPadLeft}px;
      --pt-axiom-stat-group-width:${u.statGroupWidth}px;
      --pt-axiom-stat-group-py:${u.statGroupPadY}px;
      --pt-axiom-stat-group-px:${u.statGroupPadX}px;
      --pt-axiom-stat-group-gap:${u.statGroupGap}px;
      --pt-axiom-stat-group-font:${u.statGroupFontSize}px;
      --pt-axiom-stat-group-icon:${u.statGroupIconSize}px;
      --pt-axiom-stat-pnl-py:${u.statPnlPadY}px;
      --pt-axiom-stat-pnl-font:${u.statPnlFontSize}px;
      --pt-axiom-stat-pnl-icon:${u.statPnlIconSize}px;
      --pt-axiom-inset:${u.insetMargin}px;
      --pt-axiom-inset-2:${u.insetMargin * 2}px;
      --pt-axiom-toolbar-py:${u.toolbarPadY}px;
      --pt-axiom-toolbar-px:${u.toolbarPadX}px;
      --pt-axiom-toolbar-gap:${u.toolbarGap}px;
      --pt-axiom-meta-font:${u.metaFontSize}px;
      --pt-axiom-balance-font:${u.balanceFontSize}px;
      --pt-axiom-balance-icon:${u.balanceIconSize}px;
      --pt-axiom-holdings-font:${u.holdingsFontSize}px;
      --pt-axiom-stat-font:${u.statFontSize}px`;
  }
  
  /* Inline SVG beats emoji: it inherits currentColor, stays crisp at any DPI,
   * and renders identically across every host site's font stack. */
  const ICONS = {
    chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8 13 13.7l-3-3L6.3 14.4"/></svg>',
    minimize: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    grip: '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/><circle cx="2.5" cy="6" r="1.2"/><circle cx="7.5" cy="6" r="1.2"/><circle cx="2.5" cy="9.5" r="1.2"/><circle cx="7.5" cy="9.5" r="1.2"/></svg>',
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    'eye-off': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.7 0 0 1 12 19c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94m2.8-2.8A16.46 16.46 0 0 1 21.94 4.06 18.45 18.45 0 0 1 23 12s-4 8-11 8a12.92 12.92 0 0 1-6.06-1.06M1 1l22 22"/></svg>',
    resize: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15l-6 6M16 10l-9 9M3 21V3h18"/></svg>',
    keyboard: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="1.5" y="5.5" width="21" height="13" rx="2.2"/><rect x="4" y="8.2" width="2.2" height="2.2" rx="0.4" fill="#18181a"/><rect x="7.4" y="8.2" width="2.2" height="2.2" rx="0.4" fill="#18181a"/><rect x="10.8" y="8.2" width="2.2" height="2.2" rx="0.4" fill="#18181a"/><rect x="14.2" y="8.2" width="2.2" height="2.2" rx="0.4" fill="#18181a"/><rect x="17.6" y="8.2" width="2.2" height="2.2" rx="0.4" fill="#18181a"/><rect x="5.5" y="13.2" width="13" height="2.4" rx="0.5" fill="#18181a"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 13h.01"/><path d="M2 10h20"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
    palm: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-1.2 2.8-4.5 4.2-7 5.2 2.2.2 4.2-.2 6-.9C9.8 9.2 8 12 8 15c0 0 2.5-1.5 4-3.5 1.5 2 4 3.5 4 3.5 0-3-1.8-5.8-3-8.7 1.8.7 3.8 1.1 6 .9C16.5 6.2 13.2 4.8 12 2z"/><path d="M11.2 14.5V21h1.6v-6.5z"/></svg>',
  };
  
  let _solLogoSeq = 0;
  /** Compact Solana triple-bar logo (matches Axiom token icons). */
  function solLogo(accent = '#14F195', size = 12) {
    const id = `pt-sol-${_solLogoSeq++}`;
    const h = Math.round(size * 0.78);
    return `<svg class="pt-sol-logo" width="${size}" height="${h}" viewBox="0 0 398 312" aria-hidden="true"><defs><linearGradient id="${id}" x1="360" y1="351" x2="141" y2="-69" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs><path fill="url(#${id})" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/><path fill="url(#${id})" d="M64.6 150.3c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/><path fill="url(#${id})" d="M333.1 3.8c-2.4-2.4-5.7-3.8-9.2-3.8H6.5C.7 0-2.2 7 1.9 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1L333.1 3.8z"/></svg>`;
  }
  
  function usdcLogo(size = 12) {
    return `<svg class="pt-usdc-logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#2775CA"/><path fill="#fff" d="M17.4 14.3c0-1.1-.7-1.6-2-1.6H12.8v3.2h2.6c1.3 0 2-.5 2-1.6zm.4 3.5h-5V21h2.1v-1.5h2.9c1.9 0 3.2-1 3.2-2.7 0-1.2-.6-2-1.6-2.4 1.2-.4 1.9-1.3 1.9-2.6 0-1.8-1.4-2.9-3.6-2.9H10.3v12.1H12.4v-3.2h5.4c1.3 0 2.1.5 2.1 1.6 0 1.1-.8 1.6-2.1 1.6z"/></svg>`;
  }
  
  const PT_GEIST_FONT_URL = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL('fonts/Geist-Regular.ttf')
    : 'fonts/Geist-Regular.ttf';
  

  /** Full shadow stylesheet (Geist @font-face + design system + Axiom rules). */
  // ELI5: All the CSS that makes the panel look the way it does.
  function buildStyles() {
    return `
  @font-face {
    font-family: 'Geist';
    src: url('${PT_GEIST_FONT_URL}') format('truetype');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
  /* ============================================================
     PaperTrench overlay — design system
     Tokens first, then components. Every number uses tabular
     figures so digits never jitter as prices tick.
     ============================================================ */
  :host {
    all: initial;
    ${shellZTokens()}
    --pt-void: #07090D;
    --pt-bg: #0B0E14;
    --pt-surface: rgba(20, 24, 32, 0.86);
    --pt-raised: rgba(30, 36, 47, 0.72);
    --pt-line: rgba(255, 255, 255, 0.07);
    --pt-line-2: rgba(255, 255, 255, 0.13);
    --pt-text: #EAEFF7;
    --pt-dim: #8D97A9;
    --pt-faint: #5A6273;
    --pt-amber: #4A9EFF;
    --pt-amber-soft: rgba(74, 158, 255, 0.16);
    --pt-green: #34D399;
    --pt-green-soft: rgba(52, 211, 153, 0.15);
    --pt-red: #FF5F56;
    --pt-red-soft: rgba(255, 95, 86, 0.15);
    --pt-r-lg: 18px;
    --pt-r-md: 12px;
    --pt-r-sm: 9px;
    --pt-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --pt-sans: 'Geist', ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    --pt-mono: 'Geist', ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
    --pt-weight: ${PT_AXIOM_UI.fontWeight};
  }

  * { box-sizing: border-box; }
  button { font-family: inherit; }

  .pt-wrap {
    font-family: var(--pt-sans);
    font-size: 13px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
    font-variant-numeric: tabular-nums;
  }

  /* ---------------- panel shell ---------------- */

  .pt-box {
    position: fixed; top: 84px; right: 18px; z-index: var(--pt-panel-z);
    width: 380px;
    min-width: 320px; max-width: 480px;
    /* Content-sized by design (maintainer + F-C8): a saved resize acts as
       a CAP, never a stretch — no dead space, no forced scroll on a panel
       that would have fit. The viewport is always a hard ceiling. */
    max-height: min(820px, 88vh);
    color: var(--pt-text);
    background:
      radial-gradient(120% 90% at 50% -10%, rgba(74, 158, 255, 0.10), transparent 62%),
      linear-gradient(180deg, rgba(17, 21, 28, 0.96), rgba(9, 11, 16, 0.97));
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    border-radius: var(--pt-r-lg);
    box-shadow:
      0 32px 70px -18px rgba(0, 0, 0, 0.85),
      0 8px 24px -8px rgba(0, 0, 0, 0.6),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    display: flex; flex-direction: column;
    overflow: hidden;
    animation: pt-enter 0.42s var(--pt-ease) both;
  }
  /* Hairline gradient rim — the "expensive" edge. */
  .pt-box::before {
    content: ''; position: absolute; inset: 0; z-index: 4;
    border-radius: inherit; padding: 1px; pointer-events: none;
    background: linear-gradient(150deg,
      rgba(74, 158, 255, 0.75), rgba(74, 158, 255, 0.14) 34%,
      rgba(255, 255, 255, 0.07) 62%, rgba(74, 158, 255, 0.42));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
  }
  @keyframes pt-enter {
    from { opacity: 0; transform: translateY(-10px) scale(0.975); }
    to   { opacity: 1; transform: none; }
  }
  .pt-resize {
    position: absolute; right: 4px; bottom: 4px; z-index: 6;
    width: 18px; height: 18px;
    display: flex; align-items: flex-end; justify-content: flex-end;
    color: rgba(74, 158, 255, 0.45);
    cursor: nwse-resize; pointer-events: auto;
    transition: color 0.12s;
  }
  /* Corner grips: every corner resizes. The three extra grips are
     invisible hit areas; the panel is right/top-anchored so width always
     grows leftward from the planted right edge, and top-corner drags move
     the top offset with the clamped height so the bottom edge stays
     planted. */
  .pt-rz-tl, .pt-rz-tr, .pt-rz-bl {
    position: absolute; z-index: 6; width: 14px; height: 14px;
    pointer-events: auto; background: transparent;
  }
  .pt-rz-tl { left: 0; top: 0; cursor: nwse-resize; }
  .pt-rz-tr { right: 0; top: 0; cursor: nesw-resize; }
  .pt-rz-bl { left: 0; bottom: 0; cursor: nesw-resize; }
  .pt-resize:hover { color: var(--pt-amber); }
  .pt-resize:active { color: #fff; }

  /* Axiom-style focus mode: decoration out, execution controls stay.
   * Toggle is settings.panelFocusMode (Dashboard → Settings). The class
   * rides on .pt-box so every rule below scopes to the panel. */
  .pt-box.pt-focus .pt-banner,
  .pt-box.pt-focus .pt-footer,
  .pt-box.pt-focus #pt-closed { display: none; }
  /* Community (lev): focus mode should be genuinely COMPACT — hide the
     position-detail rows (P&L + quick sell carry the signal while
     streaming) and tighten the whole panel toward the size of the site's
     own terminal. */
  .pt-box.pt-focus .pt-pos .pt-detail { display: none; }
  .pt-box.pt-focus { font-size: 12px; }
  .pt-box.pt-focus .pt-body { padding: 6px 8px 8px; }
  .pt-box.pt-focus .pt-preset { padding: 5px 4px; font-size: 11px; }
  .pt-box.pt-focus .pt-buy { padding: 9px 0; font-size: 12.5px; }
  .pt-box.pt-focus .pt-custom { font-size: 11.5px; }
  .pt-box.pt-focus .pt-sell-row button { padding: 5px 0; font-size: 11px; }
  .pt-box.pt-focus .pt-label { margin-top: 5px; font-size: 9px; }
  /* Round 2 (lev, screenshot vs Axiom's own widget): "the less information
     in the tab the better". The balance CARD goes — cash rides inline on
     the Buy label (renderPresets/renderBalance keep it fresh). The custom
     amount slims down; with one-tap presets on, the big BUY button goes
     too — the chips ARE the buttons, and Enter in the amount box buys.
     Everything that remains is a chip row, like the terminal's own widget. */
  .pt-box.pt-focus.pt-focus-instant .pt-buy { display: none; }
  /* Round 3 (toshi_100x: "small sleek simple", "less info and few
     keywords"): the header slims to the drag strip it really is — the
     subtitle line goes, the icon shrinks — and the cost chips collapse
     out of focus mode entirely: the ✎ in the header stays the editor
     entry, so nothing is lost, just not narrated. */
  .pt-box.pt-focus #pt-subtitle { display: none; }
  .pt-box.pt-focus .pt-header { padding: 7px 10px 6px; gap: 8px; }
  .pt-box.pt-focus .pt-icon { width: 18px; height: 18px; font-size: 10px; border-radius: 6px; }
  .pt-box.pt-focus .pt-title { font-size: 12px; }
  .pt-box.pt-focus .pt-costs { display: none; }
  .pt-box.pt-focus .pt-custom { margin-top: 5px; padding: 6px 9px; }
  .pt-box.pt-focus .pt-token-row { margin-bottom: 4px; }
  /* Quick reset lives in the header ONLY in focus mode (lev streams fresh
     runs per coin). Two-step inline confirm instead of a popup: first tap
     arms it for 3 s, second tap resets. */
  /* Wave 1 (F-B14): the two-tap ⟲ is the ONLY reset on the panel now, in
     every mode — the footer's standing "Reset wallet" link with a native
     confirm() was a destructive control on a trading surface. */
  #pt-quickreset { display: inline-flex; }
  #pt-quickreset.armed { color: #FF5F56; font-weight: 800; }

  /* ---------------- paper banner ----------------
   * The ONE honesty cue on the panel (UI-OVERHAUL Wave 1): the diagonal
   * watermark, the "(PAPER)" button suffix and the rest of the seven
   * restatements are gone — the banner carries it, stated once, clearly.
   * The PnL-card watermark doctrine is separate and untouched. */

  .pt-banner {
    position: relative; z-index: 2;
    display: flex; align-items: center; justify-content: center; gap: 7px;
    padding: 6px 10px;
    background: linear-gradient(90deg, rgba(74, 158, 255, 0.14), rgba(74, 158, 255, 0.28), rgba(74, 158, 255, 0.14));
    border-bottom: 1px solid rgba(74, 158, 255, 0.24);
    color: #A8D4FF;
    font-size: 9.5px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase;
    overflow: hidden;
  }
  .pt-banner::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.16) 50%, transparent 70%);
    transform: translateX(-100%);
    animation: pt-sheen 5.5s ease-in-out infinite;
  }
  @keyframes pt-sheen {
    0%, 62% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .pt-banner b { font-weight: 900; letter-spacing: 1.6px; }

  /* ---------------- Axiom-style trading widget ---------------- */
  .pt-box.pt-axiom .pt-banner,
  .pt-box.pt-axiom .pt-header,
  .pt-box.pt-axiom .pt-token-row,
  .pt-box.pt-axiom .pt-footer,
  .pt-box.pt-axiom #pt-position,
  .pt-box.pt-axiom #pt-closed,
  .pt-box.pt-axiom .pt-pos .pt-label,
  .pt-box.pt-axiom .pt-pos .pt-sell-row,
  .pt-box.pt-axiom .pt-resize,
  .pt-box.pt-axiom .pt-rz-tl,
  .pt-box.pt-axiom .pt-rz-tr,
  .pt-box.pt-axiom .pt-rz-bl { display: none !important; }
  .pt-box.pt-axiom {
    ${axiomCssVars()}
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--pt-axiom-bg);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border: 1px solid var(--pt-axiom-shell-border);
    border-radius: var(--pt-axiom-radius);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
    font-family: var(--pt-axiom-font-family);
    font-size: var(--pt-axiom-font);
    line-height: 1.3;
    animation: none;
  }
  .pt-box.pt-axiom::before { display: none; }
  .pt-box.pt-axiom .pt-toolbar { flex: none; }
  .pt-box.pt-axiom .pt-body {
    flex: 1;
    min-height: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    justify-content: flex-start;
  }
  .pt-box.pt-axiom .pt-buy-block {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding-top: var(--pt-axiom-buy-block-pt);
    padding-bottom: var(--pt-axiom-buy-block-pb);
  }
  .pt-box.pt-axiom .pt-buy-block .pt-block-head {
    margin-bottom: var(--pt-axiom-buy-block-head-mb);
  }
  .pt-box.pt-axiom .pt-buy-block .pt-trade-meta {
    margin-top: var(--pt-axiom-buy-meta-mt);
  }
  .pt-box.pt-axiom .pt-sell-block {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding-top: var(--pt-axiom-sell-block-pt);
    padding-bottom: var(--pt-axiom-sell-block-pb);
  }
  .pt-box.pt-axiom .pt-sell-block .pt-block-head {
    margin-bottom: var(--pt-axiom-sell-block-head-mb);
  }
  .pt-box.pt-axiom .pt-sell-block .pt-trade-meta {
    margin-top: var(--pt-axiom-sell-meta-mt);
  }
  .pt-box.pt-axiom .pt-stats-bar { flex: none; margin-top: auto; }

  /* Solana / asset mini-icons */
  .pt-sol-logo { display: inline-block; flex: none; vertical-align: -1px; }
  .pt-usdc-logo { display: inline-block; flex: none; vertical-align: -2px; border-radius: 50%; }
  .pt-sol-icon {
    display: inline-block; width: 14px; height: 14px; flex: none;
    border-radius: 50%;
    background: linear-gradient(135deg, #9945ff 0%, #14f195 100%);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }
  .pt-sol-icon.sm { width: 12px; height: 12px; }
  .pt-sol-icon.xs { width: 10px; height: 10px; }
  .pt-usdc-icon {
    display: inline-block; width: 12px; height: 12px; flex: none;
    border-radius: 50%; background: #2775ca;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  }
  .pt-usol-icon {
    display: inline-block; width: 12px; height: 12px; flex: none;
    border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #60a5fa);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }

  .pt-toolbar {
    display: flex; align-items: center; gap: var(--pt-axiom-toolbar-gap);
    padding: var(--pt-axiom-toolbar-py) var(--pt-axiom-toolbar-px);
    border-bottom: 1px solid var(--pt-axiom-border);
    cursor: grab; user-select: none;
  }
  .pt-toolbar:active { cursor: grabbing; }
  .pt-grow { flex: 1; }
  .pt-tb-btn {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 22px; height: 22px; padding: 0 3px;
    border: none; border-radius: 5px;
    background: transparent; color: var(--pt-axiom-muted-hover);
    font-size: 11px; font-weight: 600; cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }
  .pt-tb-btn:hover { color: #e8edf5; background: rgba(255, 255, 255, 0.05); }
  .pt-tb-btn.on { color: var(--pt-axiom-accent); }
  .pt-tb-btn.pt-close { font-size: 13px; color: var(--pt-axiom-muted-hover); }
  .pt-tb-btn.pt-close:hover { color: #fff; background: transparent; }
  .pt-tb-kbd { color: var(--pt-axiom-accent); font-size: 13px; min-width: 22px; }
  .pt-tb-kbd svg { width: 15px; height: 15px; }
  .pt-tb-icon svg { width: 14px; height: 14px; display: block; }
  .pt-toolbar-right {
    display: inline-flex; align-items: center; gap: var(--pt-axiom-toolbar-gap);
    margin-left: auto; flex: none;
  }
  .pt-profiles { display: flex; gap: 0; margin-left: 4px; flex: none; }
  .pt-profile {
    padding: 3px 7px; border: none; border-radius: 0;
    border-bottom: none;
    background: transparent; color: var(--pt-axiom-muted-hover);
    font-size: 12px; font-weight: 700; cursor: pointer;
    letter-spacing: 0.2px; line-height: 1;
  }
  .pt-profile.on {
    color: var(--pt-axiom-accent);
    background: transparent;
  }
  .pt-profile:hover:not(.on) { color: #e8edf5; }
  .pt-wallet-badge {
    display: inline-flex; align-items: center; gap: 4px;
    min-width: 30px; height: 22px; padding: 0 7px;
    border: 1px solid var(--pt-axiom-wallet-border); border-radius: 8px;
    font-size: 11px; font-weight: 700; color: #e8edf5;
    background: var(--pt-axiom-wallet-bg);
  }
  .pt-wallet-badge svg { width: 13px; height: 13px; opacity: 0.9; }

  .pt-trade-block { padding: var(--pt-axiom-block-py) var(--pt-axiom-block-px) var(--pt-axiom-block-pb); }
  .pt-sell-block { border-top: 1px solid var(--pt-axiom-border); }
  .pt-block-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 6px; margin-bottom: var(--pt-axiom-block-head-mb); min-height: 22px;
    flex: none;
  }
  .pt-block-label {
    display: flex; align-items: center; gap: 5px;
    font-size: var(--pt-axiom-font); font-weight: normal; color: var(--pt-axiom-text);
  }
  .pt-asset-tabs {
    display: inline-flex; align-items: center; gap: 1px;
    margin-left: 4px; padding: 2px;
    background: var(--pt-axiom-asset-tab-bg); border-radius: 999px;
    border: 1px solid var(--pt-axiom-asset-tab-border);
  }
  .pt-asset {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 3px 8px; border: none; border-radius: 999px;
    background: transparent; color: var(--pt-axiom-muted-hover);
    font-size: 10.5px; font-weight: 650; cursor: pointer;
    line-height: 1.2;
  }
  .pt-asset.on {
    color: #fff;
    background: var(--pt-axiom-asset-tab-active);
    box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.35);
  }
  .pt-asset:disabled { opacity: 0.55; cursor: default; }
  .pt-balance-chip {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: var(--pt-axiom-balance-font); font-weight: 650; color: var(--pt-axiom-text);
    font-family: var(--pt-mono);
  }
  .pt-balance-chip .pt-sol-logo {
    width: var(--pt-axiom-balance-icon);
    height: auto;
  }
  .pt-sell-block .pt-block-label { flex: none; }
  .pt-holdings {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    font-size: var(--pt-axiom-holdings-font); font-weight: 600; color: #c8cdd8;
    font-family: var(--pt-mono);
    overflow: hidden;
  }
  .pt-hold-qty {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 1;
  }
  .pt-hold-usd,
  .pt-hold-sol,
  .pt-hold-sep {
    flex: none;
    white-space: nowrap;
  }
  .pt-hold-sol {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .pt-sell-pct-icon { color: #c8cdd8; font-size: 12px; font-weight: 600; }
  .pt-swap-btn {
    border: none; background: transparent; color: var(--pt-axiom-muted-hover);
    font-size: 12px; cursor: pointer; padding: 0 1px; line-height: 1;
    display: inline-flex; align-items: center;
  }
  .pt-swap-btn svg { width: 13px; height: 13px; display: block; }
  .pt-swap-btn:hover { color: #fff; }

  .pt-preset-grid {
    display: grid; grid-template-columns: repeat(var(--pt-axiom-preset-cols), 1fr);
    gap: var(--pt-axiom-preset-gap);
    flex: none;
  }
  .pt-box.pt-axiom .pt-preset {
    padding: var(--pt-axiom-preset-pad-y) 2px; border-radius: var(--pt-axiom-preset-radius);
    font-size: var(--pt-axiom-preset-font); font-weight: 650;
    background: transparent;
    line-height: 1.15;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }
  .pt-box.pt-axiom .pt-preset-buy {
    color: var(--pt-axiom-buy);
    border: 1.5px solid var(--pt-axiom-buy-border);
  }
  .pt-box.pt-axiom .pt-preset-buy:hover {
    background: color-mix(in srgb, var(--pt-axiom-buy) 12%, transparent);
    color: var(--pt-axiom-buy-hover);
    border-color: var(--pt-axiom-buy-hover);
  }
  .pt-box.pt-axiom .pt-preset-sell {
    color: var(--pt-axiom-sell);
    border: 1.5px solid var(--pt-axiom-sell-border);
  }
  .pt-box.pt-axiom .pt-preset-sell:hover {
    background: color-mix(in srgb, var(--pt-axiom-sell) 12%, transparent);
    color: var(--pt-axiom-sell-hover);
    border-color: var(--pt-axiom-sell-hover);
  }
  .pt-box.pt-axiom .pt-preset.sel {
    background: color-mix(in srgb, var(--pt-axiom-buy) 16%, transparent);
    border-color: var(--pt-axiom-buy-border); color: var(--pt-axiom-buy-hover);
    box-shadow: none;
  }

  .pt-trade-meta {
    display: flex; align-items: center; justify-content: space-between;
    gap: 4px; flex-wrap: nowrap;
    margin-top: var(--pt-axiom-meta-mt); font-size: var(--pt-axiom-meta-font); color: #c8cdd8;
    overflow: hidden;
    flex: none;
  }
  .pt-meta-left {
    display: inline-flex; align-items: center; gap: 7px;
    flex: 1; min-width: 0; overflow: hidden;
  }
  .pt-meta-item {
    display: inline-flex; align-items: center; gap: 3px;
    white-space: nowrap; flex-shrink: 0;
  }
  .pt-meta-item svg { width: 12px; height: 12px; opacity: 0.9; flex-shrink: 0; }
  .pt-meta-fee { color: var(--pt-axiom-fee); font-family: var(--pt-mono); font-size: 10.5px; font-weight: 650; }
  .pt-meta-warn { color: var(--pt-axiom-fee); font-size: 9px; line-height: 1; }
  .pt-meta-adv {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; color: #c8cdd8; cursor: pointer; flex-shrink: 0;
  }
  .pt-meta-adv input {
    appearance: none; -webkit-appearance: none;
    width: 12px; height: 12px; margin: 0;
    border: 1.5px solid #6b7280; border-radius: 2px;
    background: transparent;
    accent-color: var(--pt-axiom-accent);
  }
  .pt-meta-adv input:checked {
    background: #1f2937;
    border-color: #9ca3af;
  }
  .pt-sell-init {
    border: none; background: transparent;
    color: var(--pt-axiom-sell); font-size: 12px; font-weight: 700; cursor: pointer;
    padding: 0; flex-shrink: 0;
  }
  .pt-sell-init:hover { color: var(--pt-axiom-sell-hover); }

  .pt-stats-bar {
    display: flex; align-items: stretch;
    justify-content: flex-start;
    padding-left: var(--pt-axiom-stat-bar-pl);
    border-top: 1px solid var(--pt-axiom-border);
    background: var(--pt-axiom-footer-bg);
  }
  .pt-stats-group {
    flex: none;
    width: var(--pt-axiom-stat-group-width);
    max-width: var(--pt-axiom-stat-group-width);
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-right: 1px solid var(--pt-axiom-border);
  }
  .pt-stats-group .pt-stat {
    gap: var(--pt-axiom-stat-group-gap);
    padding: var(--pt-axiom-stat-group-py) var(--pt-axiom-stat-group-px);
    font-size: var(--pt-axiom-stat-group-font);
  }
  .pt-stats-group .pt-sol-logo {
    width: var(--pt-axiom-stat-group-icon);
    height: auto;
  }
  .pt-stat {
    display: flex; align-items: center; justify-content: center;
    font-weight: 700;
    font-family: var(--pt-mono);
    border-right: 1px solid var(--pt-axiom-border);
  }
  .pt-stats-group .pt-stat:last-child { border-right: none; }
  .pt-stat-pnl-cell {
    flex: 1;
    min-width: 0;
    display: flex; align-items: center; justify-content: center; gap: 4px;
    padding: var(--pt-axiom-stat-pnl-py) 4px;
    font-size: var(--pt-axiom-stat-pnl-font); font-weight: 700;
    font-family: var(--pt-mono);
    border-right: none;
    overflow: hidden;
  }
  .pt-stat-pnl-cell .pt-stat-icon {
    flex: none;
  }
  .pt-stat-pnl-cell .pt-sol-logo {
    width: var(--pt-axiom-stat-pnl-icon);
    height: auto;
  }
  .pt-stat-pnl {
    min-width: 0;
    flex: 1;
    line-height: 1.1;
    white-space: nowrap;
    text-align: center;
  }
  .pt-stat-val { line-height: 1; }
  .pt-stat-icon { display: inline-flex; align-items: center; line-height: 1; }
  .pt-stat-val.teal, .pt-stat-icon.teal { color: var(--pt-axiom-stat-teal); }
  .pt-stat-val.pink, .pt-stat-icon.pink { color: var(--pt-axiom-stat-pink); }
  .pt-stat-val.blue, .pt-stat-icon.blue { color: var(--pt-axiom-stat-blue); }
  .pt-stat-val.green, .pt-stat-icon.green { color: var(--pt-axiom-stat-green); }
  .pt-stat-pnl.up { color: var(--pt-axiom-stat-green); }
  .pt-stat-pnl.down { color: var(--pt-axiom-sell); }

  .pt-box.pt-axiom .pt-pos {
    margin: 0; padding: 8px 12px;
    background: transparent; border: none; border-radius: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }
  .pt-box.pt-axiom .pt-pos .row-pnl .pnl {
    font-size: 14px; min-height: 0; padding: 4px 0;
  }
  .pt-box.pt-axiom .pt-custom,
  .pt-box.pt-axiom .pt-buy { display: none !important; }
  .pt-box.pt-axiom.pt-show-custom .pt-custom { display: block !important; margin: 0 var(--pt-axiom-inset) 6px; width: calc(100% - var(--pt-axiom-inset-2)); }
  .pt-box.pt-axiom.pt-show-custom .pt-buy { display: block !important; margin: 0 var(--pt-axiom-inset) 6px; width: calc(100% - var(--pt-axiom-inset-2)); }
  .pt-box.pt-axiom .pt-editor { margin: 0 var(--pt-axiom-inset) 6px; }

  /* ---------------- header (legacy) ---------------- */

  .pt-header {
    position: relative; z-index: 2;
    display: flex; align-items: center; gap: 10px;
    padding: 11px 12px 10px;
    border-bottom: 1px solid var(--pt-line);
    cursor: grab; user-select: none;
  }
  .pt-header:active { cursor: grabbing; }
  .pt-icon {
    width: 30px; height: 30px; border-radius: 10px; flex: none;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 900; color: #0A1628;
    background: linear-gradient(145deg, #7EC8FF, var(--pt-amber) 55%, #2563EB);
    box-shadow: 0 4px 14px rgba(74, 158, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }
  .pt-title { font-weight: 750; font-size: 13.5px; letter-spacing: -0.15px; min-width: 0; }
  .pt-title .sub {
    display: block; margin-top: 1px;
    font-size: 10px; font-weight: 500; color: var(--pt-faint);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pt-grow { flex: 1; }
  .pt-hbtn {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; padding: 0;
    background: transparent; border: 1px solid transparent; border-radius: 8px;
    color: var(--pt-faint); font-size: 13px; cursor: pointer;
    transition: background 0.16s, color 0.16s, border-color 0.16s, transform 0.16s;
  }
  .pt-hbtn:hover { background: var(--pt-raised); border-color: var(--pt-line-2); color: var(--pt-text); }
  .pt-hbtn:active { transform: scale(0.92); }

  /* ---------------- body ---------------- */

  .pt-body {
    position: relative; z-index: 2; padding: 10px 12px 11px;
    flex: 1; min-height: 0; overflow-y: auto;
  }

  /* Maintainer: NEVER a visible scrollbar, anywhere in the overlay. Wheel,
     touch and drag still scroll everything below; we sit on top of someone
     else's product and a stray OS scrollbar reads as our chrome leaking.
     This was per-element and drifted — the positions rail asked for a 4px
     dark thumb and got a full-size LIGHT one across a dark bar, because
     Chrome 121+ lets the standard scrollbar-width property SUPPRESS the
     ::-webkit-scrollbar rules entirely. Declaring both is not belt and
     braces; the modern one wins and the styling is silently dropped. So the
     rule lives in one place and every scrollable surface is listed here —
     a new one that forgets to opt in is the only way this can regress. */
  .pt-body,
  .pt-bar-rail {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .pt-body::-webkit-scrollbar,
  .pt-bar-rail::-webkit-scrollbar { width: 0; height: 0; display: none; }

  .pt-token-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
    margin-bottom: 8px;
  }
  .pt-token { flex: 1; min-width: 0; }
  .pt-token > div:first-child {
    font-size: 17px; font-weight: 800; letter-spacing: -0.3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
  }
  .pt-mint {
    display: inline-block; margin-top: 4px; padding: 2px 7px;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--pt-mono); font-size: 9.5px; font-weight: 500; color: var(--pt-dim);
    background: var(--pt-raised); border: 1px solid var(--pt-line);
    border-radius: 999px;
  }
  .pt-price { text-align: right; flex: none; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .pt-price .num {
    font-size: 15px; font-weight: 800; letter-spacing: -0.3px;
    font-family: var(--pt-mono);
    transition: color 0.2s;
  }
  .pt-price .usd { margin-top: 3px; font-size: 10.5px; color: var(--pt-dim); }
  .pt-price-stale { color: var(--pt-amber) !important; }

  /* Wave 2 (F-B3/F-H2): the sparkline duplicated the chart the panel
     floats over, and the 23px balance hero out-shouted the live P&L.
     Both cards are gone: cash rides the Buy label, the type-scale crown
     belongs to the position's P&L, and the live dot sits by the price. */

  /* live status dot */
  .pt-dot {
    width: 6px; height: 6px; border-radius: 50%; flex: none;
    background: var(--pt-faint); box-shadow: 0 0 0 0 transparent;
  }
  .pt-dot.on { background: var(--pt-green); animation: pt-pulse 2.1s ease-out infinite; }
  .pt-dot.warn { background: var(--pt-amber); }
  @keyframes pt-pulse {
    0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); }
    70% { box-shadow: 0 0 0 7px rgba(52, 211, 153, 0); }
    100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
  }

  /* ---------------- labels ---------------- */

  .pt-label {
    display: flex; align-items: center; justify-content: space-between;
    margin: 8px 0 5px;
    font-size: 9.5px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase;
    color: var(--pt-faint);
  }

  /* ---------------- presets ---------------- */

  .pt-presets {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
    padding: 4px; border-radius: var(--pt-r-md);
    background: rgba(0, 0, 0, 0.32); border: 1px solid var(--pt-line);
  }
  .pt-preset {
    position: relative;
    padding: 8px 2px; border: 1px solid transparent; border-radius: var(--pt-r-sm);
    background: transparent; color: var(--pt-dim);
    font-size: 11.5px; font-weight: 750; text-align: center; cursor: pointer;
    transition: color 0.16s, background 0.16s, border-color 0.16s, transform 0.12s;
  }
  .pt-preset:hover { color: var(--pt-text); background: var(--pt-raised); }
  .pt-preset:active { transform: scale(0.95); }
  .pt-preset.sel {
    color: #0A1628; border-color: transparent;
    background: linear-gradient(145deg, #7EC8FF, var(--pt-amber));
    box-shadow: 0 4px 14px rgba(74, 158, 255, 0.3);
  }

  /* The simulated-cost strip: fee, gas, tip, slippage at a glance, exactly
     like the terminals' own widgets — honest costs should not need a trip
     to the dashboard to be seen. Clicking it opens the inline editor. */
  .pt-costs {
    display: flex; gap: 4px; margin-top: 5px; cursor: pointer;
    font-size: 10px; color: var(--pt-faint); font-variant-numeric: tabular-nums;
  }
  .pt-costs span {
    padding: 2px 6px; border-radius: var(--pt-r-sm);
    background: rgba(0, 0, 0, 0.25); border: 1px solid var(--pt-line);
    white-space: nowrap;
  }
  .pt-costs:hover span { color: var(--pt-dim); border-color: var(--pt-line-2, var(--pt-line)); }

  /* Inline preset editor (lev: "on the tab for quick fixes" — the TRADING
     tab, like the pencil on the site's own widget). One compact block:
     comma lists for the two preset rows, the four cost numbers, Save. */
  .pt-editor {
    margin-top: 6px; padding: 8px; border-radius: var(--pt-r-md);
    background: rgba(0, 0, 0, 0.32); border: 1px solid var(--pt-line);
  }
  .pt-editor .row { display: flex; align-items: center; gap: 5px; margin-bottom: 6px; }
  .pt-editor .row:last-child { margin-bottom: 0; }
  .pt-editor label {
    flex: 0 0 auto; min-width: 44px; font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.4px; text-transform: uppercase; color: var(--pt-faint);
  }
  .pt-editor .row.costs label { min-width: 0; }
  .pt-editor input {
    flex: 1; min-width: 0; padding: 5px 7px; border-radius: var(--pt-r-sm);
    background: rgba(0, 0, 0, 0.35); border: 1px solid var(--pt-line);
    color: var(--pt-text); font: 11px var(--pt-mono, monospace);
  }
  .pt-editor input:focus { outline: none; border-color: rgba(74, 158, 255, 0.55); }
  .pt-editor .actions button {
    flex: 1; padding: 6px 0; border-radius: var(--pt-r-sm); cursor: pointer;
    font-size: 11px; font-weight: 750; border: 1px solid var(--pt-line);
    background: rgba(0, 0, 0, 0.3); color: var(--pt-dim);
  }
  .pt-editor .actions #pt-edit-save {
    color: #0A1628; border-color: transparent;
    background: linear-gradient(145deg, #7EC8FF, var(--pt-amber));
  }

  .pt-custom {
    width: 100%; margin-top: 7px; padding: 10px 11px;
    background: rgba(0, 0, 0, 0.32); border: 1px solid var(--pt-line);
    border-radius: var(--pt-r-sm); color: var(--pt-text);
    font-family: var(--pt-mono); font-size: 13px; outline: none;
    transition: border-color 0.16s, box-shadow 0.16s, background 0.16s;
  }
  .pt-custom::placeholder { color: var(--pt-faint); font-family: var(--pt-sans); }
  .pt-custom:focus {
    border-color: rgba(74, 158, 255, 0.6);
    box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.13);
    background: rgba(0, 0, 0, 0.45);
  }

  /* ---------------- primary action ---------------- */

  .pt-buy {
    position: relative; overflow: hidden;
    width: 100%; margin-top: 7px; padding: 11px;
    border: none; border-radius: var(--pt-r-md);
    background: linear-gradient(180deg, #3FE49B, #22B573);
    color: #032B1B; font-size: 14.5px; font-weight: 850; letter-spacing: 0.4px;
    cursor: pointer;
    box-shadow: 0 8px 22px -6px rgba(34, 181, 115, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transition: transform 0.13s var(--pt-ease), box-shadow 0.2s, filter 0.16s;
  }
  .pt-buy::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.32) 50%, transparent 65%);
    transform: translateX(-100%);
    transition: transform 0.6s var(--pt-ease);
  }
  .pt-buy:hover { filter: brightness(1.06); box-shadow: 0 12px 28px -8px rgba(34, 181, 115, 0.68), inset 0 1px 0 rgba(255, 255, 255, 0.35); }
  .pt-buy:hover::after { transform: translateX(100%); }
  .pt-buy:active { transform: translateY(1px) scale(0.988); }
  /* Armed: the click already happened, we are waiting on the first quote. */
  .pt-buy-armed {
    background: linear-gradient(180deg, #7EC8FF, var(--pt-amber));
    color: #0A1628;
    box-shadow: 0 8px 22px -6px rgba(74, 158, 255, 0.55), inset 0 1px 0 rgba(255,255,255,0.35);
    animation: pt-armed-pulse 1.4s ease-in-out infinite;
  }
  @keyframes pt-armed-pulse {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.12); }
  }

  /* ---------------- position card ---------------- */

  .pt-pos {
    margin-top: 8px; padding: 9px 11px;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012));
    border: 1px solid var(--pt-line); border-radius: var(--pt-r-md);
    animation: pt-rise 0.32s var(--pt-ease) both;
  }
  @keyframes pt-rise {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  .pt-pos .row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 5px 0;
  }
  .pt-pos .row + .row { border-top: 1px solid rgba(255, 255, 255, 0.045); }
  .pt-pos .k { font-size: 11px; color: var(--pt-dim); white-space: nowrap; flex: none; }
  .pt-pos .v {
    font-weight: 700; font-family: var(--pt-mono); font-size: 12px;
    text-align: right; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pt-pos .big { font-size: 14px; font-weight: 800; }
  /* The P&L row carries three values (SOL, %, USD) and is the one number
     that must never be clipped. It gets its own full-width line so the USD
     amount cannot be cut off on the right. */
  .pt-pos .row-pnl {
    display: block; padding-top: 7px;
  }
  .pt-pos .row-pnl .k { display: block; margin-bottom: 4px; }
  .pt-pos .pnl {
    display: block; width: 100%; padding: 5px 9px; border-radius: var(--pt-r-sm);
    /* Wave 2 (F-H1/H2): the live P&L wears the type-scale crown the old
       balance hero used to — mid-trade, this IS the panel's biggest number. */
    font-size: 21px; font-weight: 850; letter-spacing: -0.5px;
    text-align: left; white-space: normal; overflow: visible;
    line-height: 1.25; font-feature-settings: "tnum";
    /* The number wraps to a second line whenever it grows (a sign flip, an
       extra digit, the USD part) and un-wraps when it shrinks — and the
       quick-sell row sits directly below, so every wrap change moved the
       buttons UNDER THE CURSOR mid-aim ("the bottom click to sell keeps
       moving when i am in profit or not" — gibsonandjustin, Twitch). The
       two-line space is reserved permanently: a stable target beats a
       compact card for the row the trader is actively clicking. */
    min-height: calc(2 * 1.25em + 10px);
  }
  /* USD sits on its own line at narrow widths rather than being truncated. */
  .pt-pos .pnl .usd-part { opacity: 0.85; }

  /* ---------------- closed P&L ---------------- */

  .pt-closed {
    margin-top: 8px; padding: 9px 11px;
    background: linear-gradient(135deg, rgba(74, 158, 255, 0.11), rgba(11, 14, 20, 0.9));
    border: 1px solid rgba(74, 158, 255, 0.4); border-radius: var(--pt-r-md);
    animation: pt-rise 0.34s var(--pt-ease) both;
  }
  .pt-closed-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .pt-closed-title {
    font-size: 9.5px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase;
    color: var(--pt-amber);
  }
  .pt-closed-badge {
    padding: 2px 7px; border-radius: 999px;
    background: rgba(74, 158, 255, 0.14); border: 1px solid rgba(74, 158, 255, 0.28);
    font-size: 8.5px; font-weight: 800; letter-spacing: 0.6px; color: #A8D4FF;
  }
  .pt-closed-pnl { font-size: 21px; font-weight: 850; letter-spacing: -0.6px; line-height: 1.2; }
  .pt-closed-meta { margin-top: 3px; font-size: 10px; color: var(--pt-dim); }
  /* Process grade chip (GAMIFY.md): grades judge process, never P&L. */
  .pt-grade {
    margin-right: 6px; padding: 2px 7px; border-radius: 999px;
    font-family: var(--pt-mono); font-size: 9px; font-weight: 800; letter-spacing: 0.6px;
    border: 1px solid var(--pt-line-2); color: var(--pt-dim);
  }
  .pt-grade-s { color: #C9B2FF; border-color: rgba(183, 134, 255, 0.45); }
  .pt-grade-a { color: var(--pt-green); border-color: rgba(52, 211, 153, 0.4); }
  .pt-grade-b { color: #9CC2FF; border-color: rgba(106, 169, 255, 0.4); }
  .pt-grade-c { color: var(--pt-amber); border-color: rgba(74, 158, 255, 0.4); }
  .pt-grade-d, .pt-grade-f { color: var(--pt-red); border-color: rgba(255, 95, 86, 0.4); }

  /* ---------------- sell row ---------------- */

  .pt-sell-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 6px; }
  .pt-sell {
    padding: 9px 2px; border-radius: var(--pt-r-sm);
    border: 1px solid rgba(255, 95, 86, 0.32);
    background: linear-gradient(180deg, rgba(255, 95, 86, 0.19), rgba(255, 95, 86, 0.09));
    color: #FFB3AE; font-size: 11.5px; font-weight: 800; cursor: pointer;
    transition: background 0.16s, color 0.16s, transform 0.12s, box-shadow 0.18s;
  }
  .pt-sell:hover {
    background: linear-gradient(180deg, #FF6B62, #E0433A);
    color: #fff; border-color: transparent;
    box-shadow: 0 6px 18px -6px rgba(255, 95, 86, 0.6);
  }
  .pt-sell:active { transform: scale(0.95); }

  /* ---------------- footer ---------------- */

  .pt-footer {
    position: relative; z-index: 2;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--pt-line);
    background: rgba(0, 0, 0, 0.28);
    font-size: 10px; color: var(--pt-faint);
  }
  .pt-footer span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pt-footer a {
    color: var(--pt-dim); cursor: pointer; text-decoration: none;
    border-bottom: 1px dotted var(--pt-line-2);
    transition: color 0.16s, border-color 0.16s;
  }
  .pt-footer a:hover { color: var(--pt-amber); border-color: var(--pt-amber); }

  /* ---------------- semantic colors ---------------- */

  .pt-green { color: var(--pt-green); }
  .pt-red { color: var(--pt-red); }
  .pt-muted { color: var(--pt-dim); }
  .pt-pos .pnl.pt-green { background: var(--pt-green-soft); }
  .pt-pos .pnl.pt-red { background: var(--pt-red-soft); }
  .pt-hidden { display: none !important; }

  /* ---------------- minimized pill ---------------- */

  .pt-minipill {
    position: fixed; top: 84px; right: 18px; z-index: var(--pt-panel-z);
    display: none; align-items: center; gap: 7px;
    padding: 9px 15px; border-radius: 999px;
    background: linear-gradient(180deg, rgba(20, 24, 32, 0.95), rgba(9, 11, 16, 0.95));
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(74, 158, 255, 0.55);
    color: var(--pt-amber); font-family: var(--pt-sans);
    font-size: 11.5px; font-weight: 800; letter-spacing: 0.6px; cursor: pointer;
    box-shadow: 0 14px 34px -10px rgba(0, 0, 0, 0.8);
    transition: transform 0.18s var(--pt-ease), box-shadow 0.2s, border-color 0.2s;
  }
  .pt-minipill:hover { transform: translateY(-2px); border-color: var(--pt-amber); box-shadow: 0 18px 40px -10px rgba(0, 0, 0, 0.85); }
  .pt-minipill:active { transform: scale(0.96); }

  /* ---------------- toasts ---------------- */

  .pt-toast {
    position: fixed; top: 74px; right: 18px; z-index: var(--pt-toast-z);
    max-width: 320px; padding: 10px 14px;
    background: linear-gradient(180deg, rgba(24, 28, 37, 0.97), rgba(13, 16, 22, 0.97));
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border: 1px solid var(--pt-line-2); border-left: 3px solid var(--pt-amber);
    border-radius: var(--pt-r-md); color: var(--pt-text);
    font-size: 12px; font-weight: 600;
    box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.8);
    animation: pt-toast-in 0.34s var(--pt-ease) both;
  }
  @keyframes pt-toast-in {
    from { opacity: 0; transform: translateX(22px) scale(0.97); }
    to { opacity: 1; transform: none; }
  }

  /* ---------------- tick flash ----------------
     Colored by TOTAL position P&L, never tick direction. */
  @keyframes pt-flash-up { from { background: rgba(52, 211, 153, 0.38); } to { background: var(--pt-green-soft); } }
  @keyframes pt-flash-down { from { background: rgba(255, 95, 86, 0.38); } to { background: var(--pt-red-soft); } }
  .pt-flash-up { animation: pt-flash-up 0.45s ease-out; border-radius: 7px; }
  .pt-flash-down { animation: pt-flash-down 0.45s ease-out; border-radius: 7px; }

  /* ---------------- positions bar (Padre-style) ----------------
     A fixed top rail listing every open paper position, so P&L stays
     visible while the user is looking at a different token's chart. */
  /* Floats over the page rather than reflowing it.
     Anchored to the LEFT, tucked into the empty space beside the host site's
     logo, instead of the top-right where trading UIs put their own buttons
     (wallet, settings, connect) and an overlay would sit on top of them. */
  .pt-bar {
    position: fixed; top: var(--pt-bar-top, 7px); left: var(--pt-bar-left, 210px); right: auto; z-index: var(--pt-bar-z);
    max-width: min(62vw, 760px);
    display: flex; align-items: stretch; gap: 0;
    min-height: 36px; padding: 0;
    font-family: var(--pt-sans); font-size: 12px;
    color: var(--pt-text);
    background: linear-gradient(180deg, rgba(13, 16, 23, 0.94), rgba(9, 11, 16, 0.92));
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    border: 1px solid rgba(74, 158, 255, 0.3);
    border-radius: 12px;
    box-shadow: 0 14px 34px -14px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    overflow: hidden;
    animation: pt-bar-in 0.34s var(--pt-ease) both;
  }
  @keyframes pt-bar-in {
    from { opacity: 0; transform: translateY(-12px); }
    to { opacity: 1; transform: none; }
  }
  .pt-bar.pt-hidden { display: none !important; }

  .pt-bar-grip {
    display: flex; align-items: center; justify-content: center;
    flex: none; width: 18px; padding: 0 2px;
    color: var(--pt-faint); cursor: grab; user-select: none;
    border-right: 1px solid var(--pt-line);
  }
  .pt-bar-grip:hover { color: var(--pt-amber); }
  .pt-bar-grip:active { cursor: grabbing; }
  .pt-bar-brand {
    display: flex; align-items: center; gap: 7px; flex: none;
    padding: 0 12px;
    border-right: 1px solid var(--pt-line);
    cursor: pointer; user-select: none;
  }
  .pt-bar-brand:hover { background: rgba(255, 255, 255, 0.04); }
  .pt-bar-mark {
    width: 18px; height: 18px; border-radius: 5px; flex: none;
    display: flex; align-items: center; justify-content: center;
    font-size: 9.5px; font-weight: 900; color: #0A1628;
    background: linear-gradient(145deg, #7EC8FF, var(--pt-amber) 60%, #2563EB);
  }
  .pt-bar-label {
    font-size: 9px; font-weight: 800; letter-spacing: 1.1px;
    text-transform: uppercase; color: var(--pt-amber);
    white-space: nowrap;
  }

  /* aggregate segment */
  .pt-bar-total {
    display: flex; align-items: center; gap: 9px; flex: none;
    padding: 0 13px; border-right: 1px solid var(--pt-line);
    white-space: nowrap;
  }
  .pt-bar-total .k {
    font-size: 9px; font-weight: 700; letter-spacing: 0.9px;
    text-transform: uppercase; color: var(--pt-faint);
  }
  .pt-bar-total .v {
    font-family: var(--pt-mono); font-size: 12.5px; font-weight: 800;
    letter-spacing: -0.2px;
  }
  /* Discipline streak chip and game HUD removed (paper-trading-only build). */

  /* Scrolling chip rail. Scrollbar hidden by the house rule above; the
     overflow affordance is the fade below, which only paints when there is
     actually something past the edge — a permanent fade would dim the last
     chip on a bar that fits, which is a lie about there being more. */
  .pt-bar-rail {
    display: flex; align-items: center; gap: 6px;
    flex: 1; min-width: 0;
    padding: 5px 10px;
    overflow-x: auto; overflow-y: hidden;
    overscroll-behavior-x: contain;
  }
  .pt-bar-rail.pt-rail-more {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent 100%);
    mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent 100%);
  }
  .pt-bar-rail.pt-rail-more.pt-rail-start {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
  }
  .pt-bar-rail.pt-rail-end {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 26px);
    mask-image: linear-gradient(to right, transparent 0, #000 26px);
  }

  .pt-chip {
    display: flex; align-items: center; gap: 8px; flex: none;
    padding: 5px 10px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--pt-line);
    border-radius: 999px;
    color: var(--pt-text); font-family: inherit; font-size: 11.5px;
    cursor: pointer; white-space: nowrap;
    transition: background 0.15s, border-color 0.15s, transform 0.15s var(--pt-ease);
  }
  .pt-chip:hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: var(--pt-line-2);
    transform: translateY(-1px);
  }
  .pt-chip:active { transform: translateY(0) scale(0.98); }
  /* The token whose chart is on screen right now. */
  .pt-chip.active {
    border-color: rgba(74, 158, 255, 0.65);
    background: linear-gradient(135deg, rgba(74, 158, 255, 0.18), rgba(74, 158, 255, 0.05));
    box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.12);
  }
  .pt-chip-sym { font-weight: 800; letter-spacing: -0.1px; }
  .pt-chip-pnl { font-family: var(--pt-mono); font-weight: 750; }
  .pt-chip-pct { font-family: var(--pt-mono); font-size: 10.5px; opacity: 0.75; }
  /* A position with no fresh quote must look different from a live one. */
  .pt-chip.stale .pt-chip-pnl, .pt-chip.stale .pt-chip-pct { opacity: 0.5; }
  .pt-chip-dot {
    width: 6px; height: 6px; border-radius: 50%; flex: none;
    background: currentColor;
    box-shadow: 0 0 6px currentColor;
  }
  .pt-chip.stale .pt-chip-dot { box-shadow: none; opacity: 0.45; }

  .pt-bar-empty {
    display: flex; align-items: center;
    padding: 0 12px; color: var(--pt-faint); font-size: 11.5px;
  }
  .pt-bar-actions {
    display: flex; align-items: center; gap: 4px; flex: none;
    padding: 0 8px; border-left: 1px solid var(--pt-line);
  }
  .pt-bar-btn {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    background: transparent; border: 1px solid transparent; border-radius: 7px;
    color: var(--pt-faint); font-size: 12px; cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .pt-bar-btn:hover { background: var(--pt-raised); border-color: var(--pt-line-2); color: var(--pt-text); }

  /* Restore tab shown when the bar is collapsed. */
  .pt-bar-tab {
    position: fixed; top: var(--pt-bar-top, 7px); left: var(--pt-bar-left, 210px); right: auto;
    z-index: var(--pt-bar-z); display: none; align-items: center; gap: 6px;
    padding: 6px 12px;
    background: linear-gradient(180deg, rgba(13, 16, 23, 0.94), rgba(9, 11, 16, 0.92));
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(74, 158, 255, 0.42);
    border-radius: 999px;
    color: var(--pt-amber); font-family: var(--pt-sans);
    font-size: 10px; font-weight: 800; letter-spacing: 0.7px;
    cursor: pointer;
    transition: transform 0.16s var(--pt-ease), border-color 0.16s;
  }
  .pt-bar-tab:hover { transform: translateY(1px); border-color: var(--pt-amber); }

  @media (prefers-reduced-motion: reduce) {
    .pt-bar, .pt-box, .pt-pos, .pt-closed, .pt-toast { animation: none; }
    .pt-banner::after, .pt-dot.on { animation: none; }
    .pt-chip:hover { transform: none; }
    .pt-buy::after { display: none; }
  }

  /* Focus morph: one soft pulse masks the relayout when the panel
     transforms between decorated and minimal. */
  @keyframes pt-morph { from { transform: scale(0.985); opacity: 0.72; } to { transform: scale(1); opacity: 1; } }
  .pt-box.pt-morph { animation: pt-morph 0.26s var(--pt-ease); }
  .pt-hbtn.on { color: var(--pt-amber); }

  /* One movement system (UI-OVERHAUL Wave 1): every drag handle refuses
     the browser's scroll gesture — pointer capture alone never did that
     (O-25's real completion) — and every draggable surface says so with
     its cursor instead of masquerading as a plain button. */
  .pt-header, .pt-bar-grip, .pt-minipill, .pt-bar-tab,
  .pt-resize, .pt-rz-tl, .pt-rz-tr, .pt-rz-bl { touch-action: none; }
  .pt-minipill, .pt-bar-tab { cursor: grab; user-select: none; }

  /* Uniform weight baseline — tune via PT_AXIOM_UI.fontWeight / --pt-weight */
  .pt-wrap,
  .pt-wrap * {
    font-weight: var(--pt-weight) !important;
  }
    `;
  }


  /* ── Shadow DOM shell markup ─────────────────────────────────────────── */

  /** Static panel + positions-bar HTML (no <style>; caller wraps buildStyles). */
  // ELI5: The HTML blueprint for the panel and positions bar.
  function buildShellHtml() {
    return `
    <div class="pt-wrap">
      <div class="pt-bar pt-hidden" id="pt-bar">
        <div class="pt-bar-grip" id="pt-bar-grip" title="Drag to move">${ICONS.grip}</div>
        <div class="pt-bar-brand" id="pt-bar-brand" title="Paper positions">
          <span class="pt-bar-mark">P</span>
          <span class="pt-bar-label">Paper</span>
        </div>
        <div class="pt-bar-total" id="pt-bar-total"></div>
        <div class="pt-bar-rail" id="pt-bar-rail"></div>
        <div class="pt-bar-actions">
          <button class="pt-bar-btn" id="pt-bar-hide" title="Hide positions bar">${ICONS.minimize}</button>
        </div>
      </div>
      <button class="pt-bar-tab" id="pt-bar-tab" title="Show paper positions">POSITIONS</button>
      <div class="pt-box pt-axiom" id="pt-box">
        <div class="pt-toolbar" id="pt-drag">
          <button class="pt-tb-btn pt-tb-kbd" id="pt-hotkeys" title="Hotkeys" type="button">${ICONS.keyboard}</button>
          <div class="pt-profiles" id="pt-profiles">
            <button class="pt-profile on" data-profile="0" type="button">P1</button>
            <button class="pt-profile" data-profile="1" type="button">P2</button>
            <button class="pt-profile" data-profile="2" type="button">P3</button>
          </div>
          <div class="pt-toolbar-right">
            <button class="pt-tb-btn pt-tb-icon" id="pt-edit" title="Edit presets &amp; fees" type="button">${ICONS.edit}</button>
            <button class="pt-tb-btn pt-tb-icon" id="pt-settings-btn" title="Toggle advanced" type="button">${ICONS.settings}</button>
            <button class="pt-tb-btn pt-tb-icon" id="pt-quickreset" title="Reset wallet (tap twice)" type="button">${ICONS.timer}</button>
            <button class="pt-tb-btn pt-wallet-badge" id="pt-wallet-badge" title="Open positions" type="button">${ICONS.wallet}<span id="pt-wallet-count">0</span></button>
            <button class="pt-tb-btn pt-close" id="pt-min" title="Minimize" type="button">✕</button>
          </div>
        </div>
        <div class="pt-body">
          <div class="pt-trade-block pt-buy-block">
            <div class="pt-block-head">
              <div class="pt-block-label">
                <span>Buy</span>
                <div class="pt-asset-tabs">
                  <button class="pt-asset on" data-unit="sol" type="button">${solLogo('#14F195', 12)} SOL</button>
                  <button class="pt-asset" data-unit="usdc" type="button" disabled>${usdcLogo(12)} USDC</button>
                  <button class="pt-asset" data-unit="usol" type="button" disabled>${solLogo('#60a5fa', 12)} uSOL</button>
                </div>
              </div>
              <div class="pt-balance-chip" id="pt-balance-chip">${solLogo('#14F195', PT_AXIOM_UI.balanceIconSize)} <span id="pt-balance-val">0</span></div>
            </div>
            <div class="pt-preset-grid" id="pt-buy-presets"></div>
            <div class="pt-trade-meta" id="pt-buy-meta"></div>
          </div>
          <div class="pt-trade-block pt-sell-block">
            <div class="pt-block-head">
              <div class="pt-block-label">
                <span>Sell</span>
                <span class="pt-sell-pct-icon">%</span>
                <button class="pt-swap-btn" id="pt-swap-sides" title="Swap buy/sell focus" type="button">${ICONS.swap}</button>
              </div>
              <div class="pt-holdings" id="pt-holdings">—</div>
            </div>
            <div class="pt-preset-grid" id="pt-sell-presets"></div>
            <div class="pt-trade-meta" id="pt-sell-meta"></div>
          </div>
          <div class="pt-editor" id="pt-editor" style="display:none">
            <div class="row"><label>Buy SOL</label><input id="pt-edit-buy" type="text" inputmode="decimal" placeholder="0.01, 0.1, 0.25, 0.5"></div>
            <div class="row"><label>Sell %</label><input id="pt-edit-sell" type="text" inputmode="decimal" placeholder="2, 50, 75, 100"></div>
            <div class="row costs">
              <label>Fee %</label><input id="pt-edit-fee" type="number" min="0" max="10" step="0.05">
              <label>Gas</label><input id="pt-edit-gas" type="number" min="0" max="0.5" step="0.0001">
              <label>Tip</label><input id="pt-edit-tip" type="number" min="0" max="0.5" step="0.0001">
              <label>Slip %</label><input id="pt-edit-slip" type="number" min="0" max="20" step="0.1">
            </div>
            <div class="row actions">
              <button id="pt-edit-save" type="button">Save</button>
              <button id="pt-edit-cancel" type="button">Cancel</button>
            </div>
          </div>
          <input class="pt-custom" id="pt-custom" type="number" min="0" step="0.01" placeholder="Custom SOL amount…" />
          <button class="pt-buy" id="pt-buy" type="button">BUY</button>
          <div class="pt-token-row pt-legacy-token" style="display:none">
            <div class="pt-token"><div id="pt-token-name">—</div><div class="pt-mint" id="pt-token-mint">waiting for token</div></div>
            <div class="pt-price"><span class="pt-dot" id="pt-live-dot"></span><div class="num" id="pt-price">—</div><div class="usd" id="pt-price-usd"></div></div>
          </div>
          <div id="pt-position"></div>
          <div id="pt-closed"></div>
        </div>
        <div class="pt-stats-bar" id="pt-stats-bar">
          <div class="pt-stats-group">
            <div class="pt-stat">
              <span class="pt-stat-icon teal">${solLogo('#2dd7a4', PT_AXIOM_UI.statGroupIconSize)}</span>
              <span class="pt-stat-val teal" id="pt-stat-bought">0</span>
            </div>
            <div class="pt-stat">
              <span class="pt-stat-icon pink">${solLogo('#ec397a', PT_AXIOM_UI.statGroupIconSize)}</span>
              <span class="pt-stat-val pink" id="pt-stat-sold">0</span>
            </div>
            <div class="pt-stat">
              <span class="pt-stat-icon blue">${solLogo('#60a5fa', PT_AXIOM_UI.statGroupIconSize)}</span>
              <span class="pt-stat-val blue" id="pt-stat-holdings">0</span>
            </div>
          </div>
          <div class="pt-stat-pnl-cell">
            <span class="pt-stat-icon green">${solLogo('#2dd7a4', PT_AXIOM_UI.statPnlIconSize)}</span>
            <span class="pt-stat-pnl green" id="pt-stat-pnl">+0.000 (+0%)</span>
          </div>
        </div>
        <div class="pt-resize" id="pt-resize" data-corner="br" title="Resize">${ICONS.resize}</div>
        <div class="pt-rz-tl" data-corner="tl" title="Resize"></div>
        <div class="pt-rz-tr" data-corner="tr" title="Resize"></div>
        <div class="pt-rz-bl" data-corner="bl" title="Resize"></div>
      </div>
      <button class="pt-minipill" id="pt-pill"><span class="pt-dot on"></span><span id="pt-pill-text">PAPER</span></button>
      <div id="pt-toast-root"></div>
    </div>
    `;
  }

  const api = {
    PT_AXIOM_UI,
    axiomCssVars,
    ICONS,
    solLogo,
    usdcLogo,
    buildStyles,
    buildShellHtml,
  };

  if (typeof window !== 'undefined') window.PTPanelUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

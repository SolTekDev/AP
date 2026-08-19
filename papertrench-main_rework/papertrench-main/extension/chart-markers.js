/* PaperTrench — honest chart marker rail (the non-native fallback).
 *
 * ELI5: When the site won't let us draw on the real chart, we pin a small
 * honest list to the corner — your buys, sells, and average lines as text
 * chips, not fake dots on the candles. Think sticky notes on the chart edge:
 * we never guess where a price would be on the Y axis.
 *
 * Affects: content.js when no native TradingView bridge is available.
 * Does NOT draw on-chart geometry — lists fills + average LEVELS in a rail.
 *
 * Native path: price-bridge.js draws fills/lines on the real chart widget.
 * This module: fallback rail pinned to chart top-right (or screen corner).
 *
 * Deliberately absent (C-02/C-03/C-04): fabricated priceToY/timeToX, invented
 * price ranges, rank-based X positions. Honest absence beats wrong placement.
 */

(() => {
  'use strict';

  /* ── Shared dependency ─────────────────────────────────────────────────────
   * ELI5: Number formatting helpers from quote.js. */

  /** Price/mcap formatting from quote.js. */
  const Q = window.PaperQuote;

  /* ── DOM ids / class names ─────────────────────────────────────────────────
   * OVERLAY_ID = chart rail root; FALLBACK_ID = fixed corner strip root. */

  const OVERLAY_ID = 'papertrench-chart-overlay';
  const FALLBACK_ID = 'papertrench-chart-fallback';
  const PAPERTRENCH_HOST_ID = 'papertrench-host'; // trade panel host — corner probe skips this
  const CLASS_FILL_ROW = 'pt-rail-fill';          // one paper fill history row
  const CLASS_AVG_ROW = 'pt-rail-avg';            // AVG BUY / AVG SELL chip

  /* ── Trade sides / chip kinds ────────────────────────────────────────────── */

  const SIDE_BUY = 'buy';
  const SIDE_SELL = 'sell';
  const KIND_AVG_BUY = 'AVG BUY';
  const KIND_AVG_SELL = 'AVG SELL';
  const BADGE_BUY = 'B';
  const BADGE_SELL = 'S';

  /* ── Storage limits ────────────────────────────────────────────────────────
   * Markers are FIFO-evicted; only the newest maxRows appear in the rail. */

  const MAX_MARKERS = 200;        // in-memory fill history cap
  const RAIL_MAX_ROWS = 6;        // visible rows on chart-attached rail
  const FALLBACK_MAX_ROWS = 6;    // visible rows on fixed fallback strip

  /* ── Chart discovery polling ─────────────────────────────────────────────── */

  const SCAN_INTERVAL_MS = 500;
  const SCAN_FALLBACK_AFTER = 10;   // attempts × interval ≈ 5s
  const SCAN_GIVE_UP_AFTER = 60;    // attempts × interval ≈ 30s

  /* ── Time units (age labels + render signature bucket) ───────────────────── */

  const MS_PER_SECOND = 1000;
  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;
  const SIGNATURE_MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
  const MIN_AGE_SECONDS = 1;
  const RAF_FALLBACK_MS = 16; // ~60fps when requestAnimationFrame is missing

  /* ── Display formatting ──────────────────────────────────────────────────── */

  const SOL_DISPLAY_DECIMALS = 2;
  const MIN_VALID_PRICE = 0;
  const DEFAULT_CURRENCY = 'SOL';
  const VALID_CURRENCIES = new Set(['USD', 'MCAP']);

  /* ── Colors ──────────────────────────────────────────────────────────────── */

  const BUY_COLOR = '#3fb950';
  const SELL_COLOR = '#f85149';
  const AVG_BUY_COLOR = '#34D399';
  const AVG_SELL_COLOR = '#FF5F56';
  const AGE_COLOR = '#8b949e';
  const ROW_TEXT_COLOR = '#e6edf3';
  const ROW_BG_RGBA = 'rgba(13,17,23,0.92)';
  const ROW_SHADOW_RGBA = 'rgba(0,0,0,.4)';

  /* ── Layout (pixels unless noted) ────────────────────────────────────────── */

  const LAYOUT = Object.freeze({
    railInset: 8,
    railZIndex: 999,
    railMaxHeightPct: 70,
    stackGap: 4,
    rowGap: 6,
    rowMaxWidth: 340,
    rowRadius: 8,
    rowPadY: 3,
    rowPadX: 8,
    rowFontSize: 11,
    ageFontSize: 10,
    rowLineHeight: 1.5,
    rowBorderWidth: 1,
    rowShadowOffsetY: 2,
    rowShadowBlur: 8,
    fallbackEdgeInset: 12,
    fallbackTopOffset: 84,   // below typical site toolbar
    fallbackProbeInset: 40,
    fallbackProbeTopY: 120,
    fallbackMaxHeightVh: 60,
    fallbackZIndex: 2147483646,
    defaultViewportWidth: 1280,
    defaultViewportHeight: 800,
  });

  /* ── Chart container scoring (discovery heuristics) ──────────────────────── */

  const CHART_SCORE = Object.freeze({
    invalid: -1,
    minWidth: 200,
    minHeight: 150,
    widthDivisor: 100,
    maxWidthBonus: 10,
    maxHeightBonus: 5,
    idGlobalTvOverlay: 100,
    idChartAnchorMain: 90,
    classChart: 20,
    idChart: 15,
    classTradingView: 15,
    classCandleGraph: 10,
    hasCanvas: 30,
    minVisibleOpacity: 0.1,
  });

  const CHART_ID_GLOBAL_TV = 'global-tv-overlay';           // Axiom / Padre TV wrapper
  const CHART_ID_ANCHOR_MAIN = 'chart_anchor_container_main'; // GMGN chart anchor
  const NODE_ELEMENT = 1;                                   // document.ELEMENT_NODE guard

  /* ── Default model shapes ────────────────────────────────────────────────── */

  const EMPTY_AVERAGE_LINES = Object.freeze({
    avgBuyPrice: null,
    avgSellPrice: null,
    avgBuyLabel: null,
    avgSellLabel: null,
    currency: DEFAULT_CURRENCY,
  });

  /* ── CSS builders (no magic numbers in string literals) ──────────────────── */

  /** Append `px` unit for inline style strings. */
  function px(n) { return n + 'px'; }

  /** Append `vh` unit for viewport-relative heights. */
  function vh(n) { return n + 'vh'; }

  /** Shared inline styles for every fill row and average chip. */
  const ROW_BASE_CSS = [
    'pointer-events:none',
    'display:flex',
    'align-items:center',
    'gap:' + px(LAYOUT.rowGap),
    'width:max-content',
    'max-width:' + px(LAYOUT.rowMaxWidth),
    'background:' + ROW_BG_RGBA,
    'border-radius:' + px(LAYOUT.rowRadius),
    'padding:' + px(LAYOUT.rowPadY) + ' ' + px(LAYOUT.rowPadX),
    'font-size:' + px(LAYOUT.rowFontSize),
    'line-height:' + LAYOUT.rowLineHeight,
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'color:' + ROW_TEXT_COLOR,
    'white-space:nowrap',
    'box-shadow:0 ' + px(LAYOUT.rowShadowOffsetY) + ' ' + px(LAYOUT.rowShadowBlur) + ' ' + ROW_SHADOW_RGBA,
  ].join(';');

  /** Chart-attached rail: absolute top-right stack inside chartContainer. */
  const RAIL_ROOT_CSS = [
    'position:absolute',
    'top:' + px(LAYOUT.railInset),
    'right:' + px(LAYOUT.railInset),
    'z-index:' + LAYOUT.railZIndex,
    'pointer-events:none',
    'display:flex',
    'flex-direction:column',
    'align-items:flex-end',
    'gap:' + px(LAYOUT.stackGap),
    'max-height:' + LAYOUT.railMaxHeightPct + '%',
    'overflow:hidden',
  ].join(';');

  /** Inner column layout reused inside the fixed fallback strip. */
  const FALLBACK_INNER_CSS = [
    'display:flex',
    'flex-direction:column',
    'gap:' + px(LAYOUT.stackGap),
  ].join(';');

  /** Build `left/right/top/bottom` CSS for a fixed fallback corner; `null` → `auto`. */
  function fallbackCornerPosition(left, right, top, bottom) {
    const auto = 'auto';
    return [
      'left:' + (left == null ? auto : px(left)),
      'right:' + (right == null ? auto : px(right)),
      'top:' + (top == null ? auto : px(top)),
      'bottom:' + (bottom == null ? auto : px(bottom)),
    ].join(';');
  }

  /** Screen corners probed for fallback strip (O-23/C-25: avoid panel overlap). */
  const FALLBACK_CORNERS = [
    {
      name: 'bottom-left',
      css: fallbackCornerPosition(LAYOUT.fallbackEdgeInset, null, null, LAYOUT.fallbackEdgeInset),
      probe: (vw, vh) => [LAYOUT.fallbackProbeInset, vh - LAYOUT.fallbackProbeInset],
    },
    {
      name: 'bottom-right',
      css: fallbackCornerPosition(null, LAYOUT.fallbackEdgeInset, null, LAYOUT.fallbackEdgeInset),
      probe: (vw, vh) => [vw - LAYOUT.fallbackProbeInset, vh - LAYOUT.fallbackProbeInset],
    },
    {
      name: 'top-left',
      css: fallbackCornerPosition(LAYOUT.fallbackEdgeInset, null, LAYOUT.fallbackTopOffset, null),
      probe: () => [LAYOUT.fallbackProbeInset, LAYOUT.fallbackProbeTopY],
    },
    {
      name: 'top-right',
      css: fallbackCornerPosition(null, LAYOUT.fallbackEdgeInset, LAYOUT.fallbackTopOffset, null),
      probe: (vw) => [vw - LAYOUT.fallbackProbeInset, LAYOUT.fallbackProbeTopY],
    },
  ];

  /* ── Chart container discovery selectors (most → least specific) ───────────
   * Ordered so TradingView wrappers win before bare canvas / generic [class*="chart"]. */

  const CHART_SELECTORS = [
    '[class*="TradingViewChart"]',
    '[class*="trading-view"]',
    '[class*="tradingview"]',
    '[class*="chart-wrapper"]',
    '[class*="chartWrapper"]',
    '[class*="chart-container"]',
    '[class*="chartContainer"]',
    '#' + CHART_ID_GLOBAL_TV,
    '#' + CHART_ID_ANCHOR_MAIN,
    '[class*="kline"]',
    '[class*="k-line"]',
    '[class*="KlineChart"]',
    '[class*="price-chart"]',
    '[class*="token-chart"]',
    '[class*="trading_chart"]',
    '[class*="ChartContainer"]',
    '[class*="chart-area"]',
    '[class*="chartArea"]',
    '[class*="chart"]',
    '[data-chart]',
    '[id*="chart"]',
    '[id*="tv"]',
    '[class*="tv_chart"]',
    'canvas',
    '[class*="graph"]',
    '[class*="candlestick"]',
    '[class*="candle"]',
  ];

  /* ── Mutable module state ──────────────────────────────────────────────────
   * All cleared by destroyChartMarkers(); markers/averageLines by clearMarkers(). */

  let chartContainer = null;        // discovered chart DOM node the rail attaches to
  let railEl = null;                // live overlay root (#papertrench-chart-overlay)
  let domObserver = null;           // watches chartContainer for external DOM churn
  let markers = [];                 // fill rows newest-last; capped at MAX_MARKERS
  let averageLines = freshAverageLines(); // avg buy/sell chips from content.js PnL
  let scanTimer = null;             // poll interval while hunting for chart container
  let fallbackEl = null;            // fixed-position strip when no chart is found
  let renderPending = false;        // coalesce requestRender() to one frame
  let lastRenderedSignature = null; // skip rebuild when model + minute bucket unchanged
  let renderCount = 0;              // test hook: how many full renders completed

  /* ── Model helpers ───────────────────────────────────────────────────────── */

  /** Return a blank average-lines object (all nulls, currency SOL). */
  function freshAverageLines() {
    return { ...EMPTY_AVERAGE_LINES };
  }

  /** Clamp display currency to USD/MCAP/SOL; unknown values fall back to SOL. */
  function normalizeCurrency(currency) {
    return VALID_CURRENCIES.has(currency) ? currency : DEFAULT_CURRENCY;
  }

  /** True when the rail would show at least one chip or fill row. */
  function hasDisplayContent() {
    return markers.length > 0
      || averageLines.avgBuyPrice != null
      || averageLines.avgSellPrice != null;
  }

  /** Guard for price/amount fields — rejects zero, negative, and non-numbers. */
  function isPositiveNumber(n) {
    return typeof n === 'number' && n > MIN_VALID_PRICE;
  }

  /** Map buy/sell side to badge letter and row border color. */
  function sideMeta(side) {
    const isBuy = side === SIDE_BUY;
    return {
      isBuy,
      color: isBuy ? BUY_COLOR : SELL_COLOR,
      badge: isBuy ? BADGE_BUY : BADGE_SELL,
    };
  }

  /* ── DOM utilities ───────────────────────────────────────────────────────── */

  /** Remove a node from its parent without throwing if already detached. */
  function detachNode(el) {
    try {
      if (el && el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      } else if (el && typeof el.remove === 'function') {
        el.remove();
      }
    } catch (_) { /* already gone */ }
  }

  /** True when `el` is still in the document (isConnected or contains fallback). */
  function isAttached(el) {
    if (!el) return false;
    if (typeof el.isConnected === 'boolean') return el.isConnected;
    try {
      return Boolean(document.contains && document.contains(el));
    } catch (_) {
      return false;
    }
  }

  /** True when `parent` directly or deeply contains `el` (MutationObserver guard). */
  function holdsChild(parent, el) {
    if (!parent || !el) return false;
    if (typeof parent.contains === 'function') {
      try { return parent.contains(el); } catch (_) { /* fall through */ }
    }
    const kids = parent.children || [];
    for (let i = 0; i < kids.length; i++) if (kids[i] === el) return true;
    return false;
  }

  /** Create a styled rail row div (fill or average chip) with colored border. */
  function createRailRow(className, borderColor, extraStyle = '') {
    const row = document.createElement('div');
    row.className = className;
    row.style.cssText = ROW_BASE_CSS
      + ';border:' + px(LAYOUT.rowBorderWidth) + ' solid ' + borderColor
      + (extraStyle ? ';' + extraStyle : '');
    return row;
  }

  /** Append a text span to a rail row; optional inline style. */
  function appendSpan(parent, text, cssText = '') {
    const span = document.createElement('span');
    span.textContent = text;
    if (cssText) span.style.cssText = cssText;
    parent.appendChild(span);
    return span;
  }

  /** Stop chart-discovery polling (init success, give-up, or destroy). */
  function clearScanTimer() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  }

  /** Current window size; falls back to LAYOUT defaults in headless tests. */
  function viewportSize() {
    return {
      width: window.innerWidth || LAYOUT.defaultViewportWidth,
      height: window.innerHeight || LAYOUT.defaultViewportHeight,
    };
  }

  /* ── Chart container discovery ───────────────────────────────────────────────
   * ELI5: Hunt the page for the real candlestick box to stick our rail on.
   * Scores DOM candidates so the rail pins to the real chart, not a sidebar. */

  /** Heuristic score for one element; CHART_SCORE.invalid means reject. */
  function scoreChartCandidate(el) {
    if (!el || el.nodeType !== NODE_ELEMENT) return CHART_SCORE.invalid;
    const rect = el.getBoundingClientRect();
    if (rect.width < CHART_SCORE.minWidth || rect.height < CHART_SCORE.minHeight) {
      return CHART_SCORE.invalid;
    }

    let score = 0;
    const cls = (el.className || '').toLowerCase();
    const id = (el.id || '').toLowerCase();

    score += Math.min(rect.width / CHART_SCORE.widthDivisor, CHART_SCORE.maxWidthBonus);
    score += Math.min(rect.height / CHART_SCORE.widthDivisor, CHART_SCORE.maxHeightBonus);

    if (id === CHART_ID_GLOBAL_TV) score += CHART_SCORE.idGlobalTvOverlay;
    if (id === CHART_ID_ANCHOR_MAIN) score += CHART_SCORE.idChartAnchorMain;
    if (/chart/.test(cls)) score += CHART_SCORE.classChart;
    if (/chart/.test(id)) score += CHART_SCORE.idChart;
    if (/tradingview|tv[_-]/.test(cls)) score += CHART_SCORE.classTradingView;
    if (/candle|graph|price/.test(cls)) score += CHART_SCORE.classCandleGraph;
    if (el.querySelector && el.querySelector('canvas')) score += CHART_SCORE.hasCanvas;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return CHART_SCORE.invalid;
    if (parseFloat(style.opacity) < CHART_SCORE.minVisibleOpacity) return CHART_SCORE.invalid;

    return score;
  }

  /** Walk CHART_SELECTORS and return the highest-scoring visible chart node. */
  function findChartContainer() {
    let best = null;
    let bestScore = CHART_SCORE.invalid;

    for (const sel of CHART_SELECTORS) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (_) { continue; }
      for (const el of els) {
        const candidates = [el];
        if (el.tagName === 'CANVAS' && el.parentElement) candidates.push(el.parentElement);

        for (const cand of candidates) {
          const score = scoreChartCandidate(cand);
          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }
      }
    }

    return best;
  }

  /** Resolve chartContainer, re-scan if detached, and call setupOverlay on first find. */
  function ensureContainer() {
    if (chartContainer && !isAttached(chartContainer)) {
      chartContainer = null;
      removeOverlay();
    }
    if (chartContainer) return chartContainer;

    const found = findChartContainer();
    if (found) {
      chartContainer = found;
      setupOverlay();
      return chartContainer;
    }
    return null;
  }

  /* ── Chart rail lifecycle ──────────────────────────────────────────────────
   * ELI5: Attach a top-right stack inside the chart, or use a fixed corner strip.
   * Rail is position:absolute inside chartContainer (top-right inset). */

  /** Make container `position:relative` and observe external DOM mutations. */
  function setupOverlay() {
    if (!chartContainer) return;
    removeOverlay();

    if (getComputedStyle(chartContainer).position === 'static') {
      chartContainer.style.position = 'relative';
    }

    if (typeof MutationObserver !== 'undefined') {
      domObserver = new MutationObserver((records) => {
        let external = false;
        for (const record of records || []) {
          const target = record && record.target;
          if (railEl && (target === railEl || holdsChild(railEl, target))) continue;
          external = true;
          break;
        }
        if (!external) return;
        requestRender();
      });
      try {
        domObserver.observe(chartContainer, { childList: true, subtree: true });
      } catch (_) { /* harness fake */ }
    }
  }

  /** Tear down rail element and disconnect the chart MutationObserver. */
  function removeOverlay() {
    if (railEl) detachNode(railEl);
    railEl = null;
    if (domObserver) { domObserver.disconnect(); domObserver = null; }
  }

  /* ── Fallback strip (no chart container) ───────────────────────────────────
   * Fixed-position rail when discovery fails; probes corners to miss the panel. */

  /** First FALLBACK_CORNERS entry not covered by #papertrench-host (O-23/C-25). */
  function pickFreeCorner() {
    if (typeof document.elementFromPoint !== 'function') return FALLBACK_CORNERS[0];
    const { width: vw, height: vh } = viewportSize();
    for (const corner of FALLBACK_CORNERS) {
      const [x, y] = corner.probe(vw, vh);
      let hit = null;
      try { hit = document.elementFromPoint(x, y); } catch (_) { hit = null; }
      if (!hit || hit.id !== PAPERTRENCH_HOST_ID) return corner;
    }
    return FALLBACK_CORNERS[0];
  }

  /** Create or return the fixed fallback strip appended to document.body. */
  function ensureFallback() {
    if (fallbackEl && isAttached(fallbackEl)) return fallbackEl;
    if (fallbackEl) fallbackEl = null;
    if (!document.body) return null;

    fallbackEl = document.createElement('div');
    fallbackEl.setAttribute('id', FALLBACK_ID);
    fallbackEl.style.cssText = [
      'position:fixed',
      pickFreeCorner().css,
      'z-index:' + LAYOUT.fallbackZIndex,
      'pointer-events:none',
      'display:flex',
      'flex-direction:column',
      'gap:' + px(LAYOUT.stackGap),
      'max-height:' + vh(LAYOUT.fallbackMaxHeightVh),
      'overflow:hidden',
    ].join(';');
    document.body.appendChild(fallbackEl);
    return fallbackEl;
  }

  /** Remove the fixed fallback strip from the page. */
  function removeFallback() {
    if (fallbackEl) detachNode(fallbackEl);
    fallbackEl = null;
  }

  /* ── Rail content builders ─────────────────────────────────────────────────
   * Each row: badge · price/mcap · SOL size · age (fills) or AVG label (chips). */

  /** Format a price for display using quote.js helpers and active currency. */
  function formatChartPrice(price, currency) {
    if (currency === 'MCAP') {
      return Q && typeof Q.formatMarketCap === 'function'
        ? Q.formatMarketCap(price)
        : '$' + price;
    }
    const text = Q && typeof Q.formatPrice === 'function' ? Q.formatPrice(price) : String(price);
    return currency === 'USD' ? '$' + text : text + ' ' + DEFAULT_CURRENCY;
  }

  /** Format paper fill size as "X.XX SOL". */
  function formatSolAmount(solAmount) {
    return Number(solAmount || 0).toFixed(SOL_DISPLAY_DECIMALS) + ' ' + DEFAULT_CURRENCY;
  }

  /** Build one fill history row from a marker model object. */
  function buildFillRow(m) {
    const { color, badge } = sideMeta(m.side);
    const row = createRailRow(CLASS_FILL_ROW, color);

    appendSpan(row, badge, 'font-weight:normal;color:' + color);

    const level = formatChartPrice(m.displayPrice || m.price, m.currency || DEFAULT_CURRENCY);
    appendSpan(row, level + ' · ' + formatSolAmount(m.solAmount));
    appendSpan(row, timeAgo(m.ts), 'color:' + AGE_COLOR + ';font-size:' + px(LAYOUT.ageFontSize));

    return row;
  }

  /** Build one AVG BUY / AVG SELL chip from averageLines state. */
  function buildAverageChip(kind, value, label, currency) {
    const isBuy = kind === KIND_AVG_BUY;
    const color = isBuy ? AVG_BUY_COLOR : AVG_SELL_COLOR;
    const chip = createRailRow(CLASS_AVG_ROW, color, 'font-weight:normal');

    appendSpan(chip, kind, 'color:' + color);
    appendSpan(chip, formatChartPrice(label != null ? label : value, currency));

    return chip;
  }

  /** Assemble overlay root: average chips first, then newest fills (capped). */
  function buildRailContent(rootCss, maxRows) {
    if (!hasDisplayContent()) return null;

    const root = document.createElement('div');
    root.setAttribute('id', OVERLAY_ID);
    root.style.cssText = rootCss;

    if (averageLines.avgBuyPrice != null) {
      root.appendChild(buildAverageChip(
        KIND_AVG_BUY, averageLines.avgBuyPrice, averageLines.avgBuyLabel, averageLines.currency));
    }
    if (averageLines.avgSellPrice != null) {
      root.appendChild(buildAverageChip(
        KIND_AVG_SELL, averageLines.avgSellPrice, averageLines.avgSellLabel, averageLines.currency));
    }

    for (const m of markers.slice(-maxRows).reverse()) {
      root.appendChild(buildFillRow(m));
    }
    return root;
  }

  /* ── Render pipeline ───────────────────────────────────────────────────────
   * ELI5: Redraw the sticky-note list when fills or prices change (coalesced per frame).
   * Coalesced via requestAnimationFrame; skips rebuild when signature matches. */

  /** Fingerprint of visible model + minute bucket for deduped renders. */
  function modelSignature() {
    const rows = markers.slice(-RAIL_MAX_ROWS).map(
      (m) => `${m.ts}·${m.side}·${m.displayPrice || m.price}·${m.currency}`
    );
    return JSON.stringify([
      averageLines.avgBuyPrice, averageLines.avgSellPrice,
      averageLines.avgBuyLabel, averageLines.avgSellLabel,
      averageLines.currency,
      markers.length,
      rows,
      Math.floor(Date.now() / SIGNATURE_MINUTE_MS),
    ]);
  }

  /** Skip DOM rebuild when model unchanged and rail is still attached. */
  function shouldSkipRender(container, signature) {
    return signature === lastRenderedSignature
      && railEl
      && holdsChild(container, railEl);
  }

  /** Record a completed render for dedup and test render-count assertions. */
  function commitRender(signature) {
    renderCount += 1;
    lastRenderedSignature = signature;
  }

  /** Primary render: chart rail, or delegate to renderFallback if no container. */
  function renderMarkers() {
    const container = ensureContainer();
    if (!container) {
      renderFallback();
      return;
    }

    const signature = modelSignature();
    if (shouldSkipRender(container, signature)) return;
    commitRender(signature);

    if (railEl) { detachNode(railEl); railEl = null; }
    const rail = buildRailContent(RAIL_ROOT_CSS, RAIL_MAX_ROWS);
    if (rail) {
      container.appendChild(rail);
      railEl = rail;
    }

    if (fallbackEl) removeFallback();
  }

  /** Render into the fixed corner strip when chart discovery never lands. */
  function renderFallback() {
    if (!hasDisplayContent()) {
      removeFallback();
      return;
    }
    const el = ensureFallback();
    if (!el) return;
    el.textContent = '';
    const content = buildRailContent(FALLBACK_INNER_CSS, FALLBACK_MAX_ROWS);
    if (content) el.appendChild(content);
  }

  /** Human-readable fill age: "Ns ago", "Nm ago", or "Nh ago". */
  function timeAgo(ts) {
    const elapsedSec = Math.max(MIN_AGE_SECONDS, Math.floor((Date.now() - ts) / MS_PER_SECOND));
    if (elapsedSec < SECONDS_PER_MINUTE) return elapsedSec + 's ago';
    if (elapsedSec < SECONDS_PER_HOUR) return Math.floor(elapsedSec / SECONDS_PER_MINUTE) + 'm ago';
    return Math.floor(elapsedSec / SECONDS_PER_HOUR) + 'h ago';
  }

  /** Schedule one render on the next animation frame (or RAF_FALLBACK_MS). */
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    const done = () => { renderPending = false; renderMarkers(); };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(done);
    } else {
      setTimeout(done, RAF_FALLBACK_MS);
    }
  }

  /* ── Public API (window.PTChartMarkers) ──────────────────────────────────
   * ELI5: What content.js calls — add a fill chip, tick price, init/teardown.
   * Called from content.js on fills, price ticks, and average-line updates. */

  /** ELI5: Record a paper buy/sell as a row in the rail. */
  function addMarker(m) {
    if (!m || !isPositiveNumber(m.price)) return;
    const displayPrice = Number(m.displayPrice);
    markers.push({
      ts: m.ts || Date.now(),
      price: m.price,
      side: m.side || SIDE_BUY,
      solAmount: m.solAmount || 0,
      symbol: m.symbol || '',
      displayPrice: isPositiveNumber(displayPrice) ? displayPrice : m.price,
      currency: normalizeCurrency(m.currency),
    });
    if (markers.length > MAX_MARKERS) markers.shift();
    requestRender();
  }

  /** Re-render when live price changes (refreshes age labels / currency display). */
  function tickPrice(price) {
    if (!isPositiveNumber(price)) return;
    if (hasDisplayContent()) requestRender();
  }

  /** Wipe fill history and average lines; remove rail + fallback from DOM. */
  function clearMarkers() {
    markers = [];
    averageLines = freshAverageLines();
    lastRenderedSignature = null;
    if (railEl) { detachNode(railEl); railEl = null; }
    removeFallback();
  }

  /** Start chart discovery; poll until found, then fallback after ~5s / give up ~30s. */
  function initChartMarkers() {
    clearScanTimer();

    if (ensureContainer()) {
      requestRender();
      return;
    }

    let attempts = 0;
    scanTimer = setInterval(() => {
      attempts++;
      if (ensureContainer()) {
        clearScanTimer();
        requestRender();
        return;
      }
      if (attempts >= SCAN_FALLBACK_AFTER && markers.length) renderFallback();
      if (attempts > SCAN_GIVE_UP_AFTER) {
        clearScanTimer();
        if (markers.length) renderFallback();
      }
    }, SCAN_INTERVAL_MS);
  }

  /** Full teardown on token leave or overlay destroy — resets all module state. */
  function destroyChartMarkers() {
    removeOverlay();
    removeFallback();
    clearScanTimer();
    renderPending = false;
    chartContainer = null;
    markers = [];
    averageLines = freshAverageLines();
    lastRenderedSignature = null;
  }

  /** Update avg buy/sell chip values from content.js position PnL. */
  function setAverageLines(opts) {
    if (!opts) return;
    if (opts.avgBuyPrice !== undefined) averageLines.avgBuyPrice = opts.avgBuyPrice;
    if (opts.avgSellPrice !== undefined) averageLines.avgSellPrice = opts.avgSellPrice;
    if (opts.avgBuyLabel !== undefined) averageLines.avgBuyLabel = opts.avgBuyLabel;
    if (opts.avgSellLabel !== undefined) averageLines.avgSellLabel = opts.avgSellLabel;
    if (opts.currency !== undefined) averageLines.currency = normalizeCurrency(opts.currency);
    requestRender();
  }

  /** Remove avg buy/sell chips without clearing fill marker history. */
  function clearAverageLines() {
    averageLines = freshAverageLines();
    requestRender();
  }

  const api = {
    addMarker,              // ELI5: after paper fill
    tickPrice,              // ELI5: on live price update
    clearMarkers,           // ELI5: token switch / wallet reset
    setAverageLines,        // ELI5: position avg price lines
    clearAverageLines,      // ELI5: position closed
    initChartMarkers,       // ELI5: overlay mount
    destroyChartMarkers,    // ELI5: overlay teardown
    _getMarkers: () => markers,                    // tests: fill model snapshot
    _getAverageLines: () => ({ ...averageLines }), // tests: avg-line model snapshot
    _findChartContainer: findChartContainer,       // tests: discovery helper
    _scoreChartCandidate: scoreChartCandidate,       // tests: scoring helper
    _getRenderCount: () => renderCount,             // tests: render dedup assertions
    _getRailElement: () => railEl,                  // tests: chart-attached rail DOM
    _getFallbackElement: () => fallbackEl,          // tests: fixed fallback strip DOM
  };

  if (typeof window !== 'undefined') window.PTChartMarkers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

/* PaperTrench — portfolio engine.
 *
 * ELI5: The pretend wallet's rulebook. Pure math on a JSON object — no web
 * page, no Chrome. Buy and sell update cash and positions. Content
 * script and popup load this and save the result to storage after every fill.
 *
 * Pure functions over a serializable state object. No DOM, no chrome APIs —
 * the content script and popup load this and drive it with storage
 * reads/writes.
 *
 * All prices in SOL (priceNative). USD values are derived per-trade with the
 * priceUsd captured at that moment.
 */
(() => {
  'use strict';

  const STORAGE_KEYS = {
    state: 'pt_state',
    settings: 'pt_settings',
  };
  const EPS = 1e-9;

  // ELI5: Version bump when defaults change — migrations run once per user.
  // Bumped when a default changes in a way existing users should receive.
  // Stored settings normally win over defaults, so without this a user who
  // installed before the change would keep the old value forever.
  //
  // Declared HERE, above DEFAULT_SETTINGS, so the defaults can carry it
  // directly. That coupling is the fix for D-56: the constant used to live
  // below the defaults, which pinned `settingsRevision` to a literal (4)
  // that nobody remembered to bump alongside it. A FRESH install was
  // therefore born three revisions stale, and migrations written to repair
  // data from OLD builds ran against settings the user had just typed —
  // silently reverting them one read after "Saved." appeared. A brand-new
  // install has no legacy data, so no migration may ever apply to it.
  const SETTINGS_REVISION = 8;

  const DEFAULT_SETTINGS = {
    balanceStartSol: 10,
    presetsBuy: [0.01, 0.1, 0.25, 0.5, 0.75, 1.5, 2.5, 5],
    // Foreign-chain panels quick-buy in DOLLARS (fomo's own ladder on its
    // EVM chains, read off the live site 2026-08-05). Separate key so a
    // chain switch never rewrites the SOL list.
    presetsBuyUsd: [10, 100, 500, 1000],
    sellPcts: [2, 50, 75, 100, 2, 5, 10, 15],
    buySlippagePct: 30,
    sellSlippagePct: 70,
    // One-click trading: a preset amount fires the buy immediately (Axiom /
    // Padre quick-buy behaviour) instead of only selecting it for the BUY
    // button. Off returns to the two-step select-then-confirm flow.
    instantBuyEnabled: true,
    // Master switch for the buy controls in the trade tab (presets, custom
    // amount, BUY button). Off makes the panel view-only for people who
    // never buy from the overlay.
    panelBuyEnabled: true,
    // The one-tap preset amount row inside the buy section. Can be hidden
    // on its own so traders who always type a custom amount keep the BUY
    // button.
    panelPresetsEnabled: true,
    feeBps: 100,          // 1% per side, roughly Padre/Axiom territory
    slippageBps: 0,       // extra simulated slippage, 0 = fill at tick price
    overlayEnabled: true,
    // Axiom-style focus mode for the trade tab: strips every decoration and
    // info card (banner, watermark, sparkline, thesis, last-close card,
    // footer) and leaves only token, price, balance, buy and sell controls.
    // Requested from the community: "make the trading tab like axiom and
    // other platforms for more optimised and less distracted trades".
    // Opt-in — the decorated panel stays the default.
    panelFocusMode: false,
    // Hide the overlay on pages where no token is detected (e.g., a project's
    // home page or a screener without a selected token). It pops back the
    // moment the user opens a coin page.
    overlayHideWhenNoToken: true,
    // Last user-resized width/height of the trade tab, in pixels. null means
    // use the CSS default (336px by content height).
    overlayWidth: null,
    overlayHeight: null,
    averagePriceLinesEnabled: true,
    // A fresh install is CURRENT by construction — see SETTINGS_REVISION.
    settingsRevision: SETTINGS_REVISION,
    // Padre-style top rail listing every open paper position.
    positionsBarEnabled: true,
    // Saved left/top offsets for the draggable positions bar. null means the
    // bar should auto-measure against the host site header on first paint.
    positionsBarLeft: null,
    positionsBarTop: null,
    // Whether the positions bar is collapsed into its small POSITIONS tab.
    // Saved so "hide it once" sticks across pages, tabs and sessions instead
    // of the bar reappearing on every new page — the "it follows me
    // everywhere" complaint.
    positionsBarHidden: false,
    // Optional private Solana RPC. Empty means "use the built-in keyless
    // public pool", which is the default and needs no signup from anyone.
    // Public RPC limits are per IP, so the pool scales across every install.
    // Power users can paste their own endpoint here for extra headroom.
    rpcUrl: '',
    // Flat per-transaction costs, emulating what real trading actually costs
    // beyond the platform's percentage fee: a priority fee (gas) and a
    // bribe/tip per transaction. Small trades are DOMINATED by these — a
    // 0.1 SOL entry with 0.002 SOL of tx costs pays 2% before the platform
    // fee — so practicing without them teaches economics that don't exist.
    // Zero by default so existing wallets' math never changes silently; the
    // Fees & costs settings card nudges users to copy their real setup.
    gasSolPerTx: 0,
    tipSolPerTx: 0,
  };

  function defaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  /**
   * ELI5: Blend saved settings with defaults and run one-time upgrade fixes.
   * Merge stored settings over defaults, applying one-time migrations.
   *
   * Revision 2 turned trade effects, sounds, and average price lines on. Those
   * were previously off by default, so an existing install has `false` saved
   * for them — not because the user chose it, but because that was the default.
   * The migration adopts the new defaults ONCE and records that it ran, so a
   * deliberate opt-out afterwards is never overridden.
   *
   * Revision 3 starts hiding the overlay on pages without a detected token.
   *
   * Revision 5 adds the trade-tab buy toggles (whole buy section, and the
   * preset row on its own), both on by default.
   *
   * Revision 6 persists the positions bar's collapsed/expanded state, so
   * hiding it once keeps it hidden everywhere.
   *
   */
  function mergeSettings(stored) {
    const merged = Object.assign(defaultSettings(), stored || {});
    if (!stored) return merged;

    const revision = Number(stored.settingsRevision) || 0;
    if (revision < 3) {
      merged.overlayHideWhenNoToken = DEFAULT_SETTINGS.overlayHideWhenNoToken;
    }
    if (revision < 5) {
      merged.panelBuyEnabled = DEFAULT_SETTINGS.panelBuyEnabled;
      merged.panelPresetsEnabled = DEFAULT_SETTINGS.panelPresetsEnabled;
    }
    if (revision < 6) {
      merged.positionsBarHidden = DEFAULT_SETTINGS.positionsBarHidden;
    }
    if (revision < 8) {
      const oldSell4 = [25, 50, 75, 100];
      const oldSell8 = [2, 50, 75, 100, 5, 10, 15, 25];
      const cur = merged.sellPcts || [];
      const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      if (same(cur, oldSell4) || same(cur, oldSell8)) {
        merged.sellPcts = DEFAULT_SETTINGS.sellPcts.slice();
      }
      if (merged.buySlippagePct == null) merged.buySlippagePct = DEFAULT_SETTINGS.buySlippagePct;
      if (merged.sellSlippagePct == null) merged.sellSlippagePct = DEFAULT_SETTINGS.sellSlippagePct;
    }
    merged.settingsRevision = SETTINGS_REVISION;
    return merged;
  }

  function defaultState(settings = DEFAULT_SETTINGS) {
    return {
      version: 1,
      // Monotonic write counter bumped by the content script on every state
      // write. A fresh wallet starts at 0; a writer holding an older seq can
      // tell it has been overtaken and adopt instead of clobber.
      seq: 0,
      cashSol: settings.balanceStartSol,
      startedAt: Date.now(),
      positions: {},   // mint -> position
      rounds: [],      // closed round trips, newest first
      journal: [],     // every fill, newest first
      stats: { totalBuys: 0, totalSells: 0, realizedPnlSol: 0, feesPaidSol: 0 },
    };
  }

  /* ---------------- price helpers ----------------
   * ELI5: Slippage and per-tx gas/tip applied to buy/sell prices. */

  function applyBps(x, bps) { return x * (bps || 0) / 10000; }

  /** Effective buy price including simulated slippage. */
  function buyPrice(px, settings) { return px * (1 + applyBps(1, settings.slippageBps)); }
  /** Effective sell price including simulated slippage. */
  function sellPrice(px, settings) { return px * (1 - applyBps(1, settings.slippageBps)); }
  /** Flat per-transaction cost (priority fee + tip), sanity-bounded. */
  function txCostSol(settings) {
    const gas = clamp(Number(settings && settings.gasSolPerTx) || 0, 0, 0.5);
    const tip = clamp(Number(settings && settings.tipSolPerTx) || 0, 0, 0.5);
    return gas + tip;
  }

  /* ---------------- fills ----------------
   * ELI5: Buy and sell — the core paper-trade ledger writes. */

  function getPosition(state, mint) {
    return state.positions[mint] || null;
  }

  /**
   * ELI5: Spend SOL to buy tokens at the quoted price (fees, gas, journal row).
   * Buy `solAmount` gross SOL of the token. Returns {trade, state} or throws.
   */
  function buy(state, settings, o) {
    const sol = Number(o.solAmount);
    const px = buyPrice(Number(o.priceNative), settings);
    const flat = txCostSol(settings);
    if (!(sol > 0)) throw new Error('Buy amount must be > 0 SOL');
    if (!(px > 0)) throw new Error('No live price available');
    if (sol + flat > state.cashSol + EPS) {
      throw new Error(flat > 0
        ? `Insufficient paper balance for ${fmt(sol)} SOL + ${fmt(flat)} SOL tx costs (${fmt(state.cashSol)} SOL left)`
        : `Insufficient paper balance (${fmt(state.cashSol)} SOL left)`);
    }

    const fee = applyBps(sol, settings.feeBps);
    const net = sol - fee;
    const qty = net / px;

    let pos = state.positions[o.mint];
    if (!pos) {
      pos = state.positions[o.mint] = {
        mint: o.mint,
        symbol: o.symbol || short(o.mint),
        name: o.name || o.symbol || '',
        site: o.site || 'unknown',
        pairAddress: o.pairAddress || null,
        sessionId: replaySessionId(o.mint, o.ts),
        qty: 0,
        costSol: 0,          // net SOL spent on the open stack
        investedSol: 0,      // gross SOL spent (incl. fees) on this round
        netInvestedSol: 0,   // net SOL (gross minus buy fees) spent on this round
        realizedSol: 0,      // net SOL returned by sells this round (cash-flow P&L)
        entryCostSol: 0,     // fee-free net SOL in open tokens (avg-entry numerator)
        peakPnlSol: 0,
        troughPnlSol: 0,
        openedAt: o.ts,
        lastPriceNative: px,
        lastPriceUsd: o.priceUsd || null,
        // Multichain: the chain the token lives on ('solana' default). Off-
        // Solana fills price in derived SOL (docs/MULTICHAIN.md) and the
        // batch poller needs the chain to re-quote the right family.
        chain: o.chain || 'solana',
      };
    }
    // Upgrade a legacy open position in place so replays can still be attached
    // after the extension updates from an older version.
    if (!pos.sessionId) pos.sessionId = replaySessionId(pos.mint, pos.openedAt || o.ts);
    if (pos.realizedSol == null) pos.realizedSol = 0;
    if (pos.entryCostSol == null) pos.entryCostSol = 0;

    pos.qty += qty;
    // Flat tx costs (gas + tip) join the COST BASIS: they bought no tokens,
    // but this trade cannot break even until the price covers them — which
    // is exactly what real fills feel like. Routing them through costSol
    // means per-sell P&L, rounds, the calendar, and the equity identity all
    // account for them with no special cases downstream.
    pos.costSol += net + flat;
    pos.investedSol += sol + flat;
    // D-08: total NET invested never shrinks (mirrors investedSol). costSol
    // DOES shrink proportionally on partial sells, so costSol/netInvestedSol
    // is the surviving fraction of the stack — which lets grossOpenCostSol()
    // recover the gross cost of what is still open. Legacy positions predate
    // the field; `|| 0` upgrades them in place on their next buy.
    pos.netInvestedSol = (Number(pos.netInvestedSol) || 0) + net + flat;
    pos.entryCostSol = (Number(pos.entryCostSol) || 0) + net;
    pos.lastPriceNative = px;
    pos.lastPriceUsd = o.priceUsd || pos.lastPriceUsd;

    state.cashSol -= sol + flat;
    state.stats.totalBuys += 1;
    state.stats.feesPaidSol += fee + flat;

    const trade = {
      id: tradeId(o.ts),
      ts: o.ts,
      site: o.site || pos.site,
      mint: o.mint,
      symbol: pos.symbol,
      sessionId: pos.sessionId,
      side: 'buy',
      qty,
      priceNative: px,
      priceUsd: o.priceUsd || null,
      solGross: sol,
      feeSol: fee,
      txCostSol: flat,
      solNet: net,
      mcap: o.mcap || null,
      chain: pos.chain || o.chain || 'solana',
    };
    // Foreign-chain panels order in dollars; the tapped amount is recorded
    // so receipts echo the order as placed, not just its SOL conversion.
    if (Number(o.quotedUsd) > 0) trade.quotedUsd = Number(o.quotedUsd);
    // F-48: price provenance rides the journal row. Stored-not-committed
    // (the solNet pattern) — the attestation preimage is untouched.
    if (o.priceSource) trade.priceSource = String(o.priceSource);
    if (Number.isFinite(o.priceAgeMs)) trade.priceAgeMs = Math.max(0, Math.round(o.priceAgeMs));
    state.journal.unshift(trade);
    pruneJournal(state);
    return { trade, position: pos };
  }

  /**
   * ELI5: Sell part or all of a position; may close the round trip.
   * Sell `qtyFraction` (0..1) of the current position. Returns {trade, state}.
   * Closing the whole stack also closes the round trip and appends to rounds.
   */
  function sell(state, settings, o) {
    const pos = state.positions[o.mint];
    if (!pos || pos.qty <= EPS) throw new Error('No open paper position in this token');
    if (!pos.sessionId) pos.sessionId = replaySessionId(pos.mint, pos.openedAt || o.ts);
    backfillPosition(state, pos);

    let qty = Number(o.qty);
    if (!(qty > 0)) {
      const frac = clamp(Number(o.qtyFraction), 0, 1);
      qty = pos.qty * frac;
    }
    qty = Math.min(qty, pos.qty);
    if (qty <= EPS) throw new Error('Sell quantity is zero');

    const px = sellPrice(Number(o.priceNative), settings);
    if (!(px > 0)) throw new Error('No live price available');

    const gross = qty * px;
    const fee = applyBps(gross, settings.feeBps);
    const flat = txCostSol(settings);
    // Net proceeds pay the platform fee AND the flat tx costs. A dust sell
    // can genuinely net negative — you paid gas to exit a worthless bag,
    // which is precisely the lesson worth learning on paper.
    const net = gross - fee - flat;

    const qtyBefore = pos.qty;
    const costShare = pos.costSol * (qty / qtyBefore);
    const pnl = net - costShare;
    const entryShare = (Number(pos.entryCostSol) || 0) * (qty / qtyBefore);
    const grossCostSold = (Number(pos.investedSol) || 0) * (qty / qtyBefore);

    pos.qty -= qty;
    pos.costSol -= costShare;
    pos.entryCostSol = (Number(pos.entryCostSol) || 0) - entryShare;
    pos.realizedSol = (Number(pos.realizedSol) || 0) + net;
    pos.lastPriceNative = px;
    pos.lastPriceUsd = o.priceUsd || pos.lastPriceUsd;

    state.cashSol += net;
    state.stats.totalSells += 1;
    state.stats.feesPaidSol += fee + flat;
    state.stats.realizedPnlSol += net - grossCostSold;

    const trade = {
      id: tradeId(o.ts),
      ts: o.ts,
      site: o.site || pos.site,
      mint: o.mint,
      symbol: pos.symbol,
      sessionId: pos.sessionId,
      side: 'sell',
      qty,
      priceNative: px,
      priceUsd: o.priceUsd || null,
      solGross: gross,
      feeSol: fee,
      txCostSol: flat,
      solNet: net,
      pnlSol: pnl,
      mcap: o.mcap || null,
      chain: pos.chain || 'solana',
    };
    // F-48: price provenance — see buy().
    if (o.priceSource) trade.priceSource = String(o.priceSource);
    if (Number.isFinite(o.priceAgeMs)) trade.priceAgeMs = Math.max(0, Math.round(o.priceAgeMs));
    state.journal.unshift(trade);
    pruneJournal(state);

    let round = null;
    if (pos.qty <= Math.max(pos.investedSol, 1) * 1e-9 || pos.qty <= EPS) {
      round = closeRound(state, pos, o.ts);
      delete state.positions[o.mint];
    }
    return { trade, position: pos.qty > EPS ? pos : null, round };
  }

  function closeRound(state, pos, ts) {
    backfillPosition(state, pos);
    const returned = Number(pos.realizedSol) || 0;
    const round = {
      id: 'r' + ts.toString(36) + Math.random().toString(36).slice(2, 7),
      mint: pos.mint,
      symbol: pos.symbol,
      name: pos.name || '',
      site: pos.site,
      pairAddress: pos.pairAddress || null,
      sessionId: pos.sessionId || replaySessionId(pos.mint, pos.openedAt),
      openedAt: pos.openedAt,
      closedAt: ts,
      heldMs: ts - pos.openedAt,
      chain: pos.chain || 'solana',
      investedSol: pos.investedSol,
      returnedSol: returned,
      pnlSol: returned - pos.investedSol,
      pnlPct: pos.investedSol > 0 ? (returned / pos.investedSol - 1) * 100 : 0,
      peakPnlSol: pos.peakPnlSol,
      troughPnlSol: pos.troughPnlSol,
      tradeIds: state.journal.filter((t) => t.mint === pos.mint && t.ts >= pos.openedAt).map((t) => t.id),
    };
    state.rounds.unshift(round);
    if (state.rounds.length > 500) state.rounds.length = 500;
    return round;
  }

  /* ---------------- marks / analytics ----------------
   * ELI5: Mark positions to market and equity. */

  /** ELI5: Update last price and track best/worst unrealized P&L on the bag. */
  function markPosition(state, mint, priceNative, priceUsd) {
    const pos = state.positions[mint];
    if (!pos) return null;
    pos.lastPriceNative = priceNative;
    if (priceUsd) pos.lastPriceUsd = priceUsd;
    backfillPosition(state, pos);
    const bought = Number(pos.investedSol) || 0;
    const sold = Number(pos.realizedSol) || 0;
    const unrealized = pos.qty * priceNative + sold - bought;
    if (unrealized > pos.peakPnlSol) pos.peakPnlSol = unrealized;
    if (unrealized < pos.troughPnlSol) pos.troughPnlSol = unrealized;
    return { unrealized, pos };
  }

  function unrealizedPnl(pos) {
    const bought = Number(pos.investedSol) || 0;
    const sold = Number(pos.realizedSol) || 0;
    return pos.qty * pos.lastPriceNative + sold - bought;
  }

  function equitySol(state) {
    let eq = state.cashSol;
    for (const mint of Object.keys(state.positions)) {
      const p = state.positions[mint];
      eq += p.qty * (p.lastPriceNative || 0);
    }
    return eq;
  }

  function clampNearZero(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.abs(x) < 1e-6 ? 0 : x;
  }

  /** Derive cash-flow accumulators on legacy positions from the journal. */
  function backfillPosition(state, pos) {
    if (!state || !pos) return pos;
    const openedAt = Number(pos.openedAt) || 0;
    const needRealized = pos.realizedSol == null || !Number.isFinite(Number(pos.realizedSol));
    const needEntry = pos.entryCostSol == null || !Number.isFinite(Number(pos.entryCostSol));
    if (!needRealized && !needEntry) return pos;

    const fills = (state.journal || [])
      .filter((t) => t.mint === pos.mint && Number(t.ts) >= openedAt)
      .slice()
      .sort((a, b) => Number(a.ts) - Number(b.ts));

    if (needRealized) {
      pos.realizedSol = fills
        .filter((t) => t.side === 'sell')
        .reduce((sum, t) => sum + (Number(t.solNet) || 0), 0);
    }

    if (needEntry) {
      let entry = 0;
      let qty = 0;
      for (const t of fills) {
        if (t.side === 'buy') {
          entry += Number(t.solNet) || 0;
          qty += Number(t.qty) || 0;
        } else if (t.side === 'sell' && qty > EPS) {
          const sold = Math.min(Number(t.qty) || 0, qty);
          entry -= entry * (sold / qty);
          qty -= sold;
        }
      }
      pos.entryCostSol = entry;
    }
    return pos;
  }

  /**
   * Axiom-style wallet cash flow for the current token round.
   * P&L = Holdings + Sold − Bought; % = P&L / Bought.
   */
  function roundStats(state, mint, priceNative) {
    const empty = {
      boughtSol: 0,
      soldSol: 0,
      holdingsSol: 0,
      pnlSol: 0,
      pnlPct: 0,
      avgEntryNative: 0,
      qty: 0,
      open: false,
    };
    if (!state || !mint) return empty;

    const pos = state.positions && state.positions[mint];
    if (pos && Number(pos.qty) > EPS) {
      backfillPosition(state, pos);
      const px = Number(priceNative) > 0 ? Number(priceNative) : Number(pos.lastPriceNative);
      const boughtSol = Number(pos.investedSol) || 0;
      const soldSol = Number(pos.realizedSol) || 0;
      const qty = Number(pos.qty) || 0;
      const holdingsSol = px > 0 ? qty * px : 0;
      const pnlSol = clampNearZero(holdingsSol + soldSol - boughtSol);
      const pnlPct = boughtSol > 0 ? (pnlSol / boughtSol) * 100 : 0;
      const entryCost = Number(pos.entryCostSol) || 0;
      const avgEntryNative = qty > 0 ? entryCost / qty : 0;
      return {
        boughtSol,
        soldSol,
        holdingsSol,
        pnlSol,
        pnlPct,
        avgEntryNative,
        qty,
        open: true,
      };
    }

    const round = (state.rounds || []).find((r) => r.mint === mint);
    if (round) {
      const boughtSol = Number(round.investedSol) || 0;
      const soldSol = Number(round.returnedSol) || 0;
      const pnlSol = clampNearZero(Number(round.pnlSol) || 0);
      return {
        boughtSol,
        soldSol,
        holdingsSol: 0,
        pnlSol,
        pnlPct: Number(round.pnlPct) || 0,
        avgEntryNative: 0,
        qty: 0,
        open: false,
      };
    }
    return empty;
  }

  /**
   * D-08: the gross (fee-inclusive) cost of what is still open in a position.
   *
   * Closed rounds measure their percentage against GROSS invested
   * (closeRound: returned / investedSol − 1). The open-position percentage
   * used pnl / costSol — a NET-of-buy-fee denominator (and numerator) — so
   * the same trade's % dropped ~2×feeBps at the moment of close with no
   * price move at all.
   *
   * costSol shrinks proportionally on partial sells while netInvestedSol
   * (total net ever invested) does not, so costSol / netInvestedSol is the
   * surviving fraction of the stack and invested × that fraction is its
   * gross cost. Legacy positions predate netInvestedSol: without partial
   * sells costSol === net invested and the full investedSol is exact, so it
   * is the fallback.
   */
  function grossOpenCostSol(pos) {
    if (!pos) return 0;
    const invested = Number(pos.investedSol) || 0;
    const cost = Number(pos.costSol) || 0;
    const netInvested = Number(pos.netInvestedSol) || 0;
    if (netInvested > 0) return invested * (cost / netInvested);
    return invested;
  }

  /** Gross SOL spent on buys for the current token round (open or most recent closed). */
  function tradeBoughtSol(state, mint) {
    return roundStats(state, mint, 0).boughtSol;
  }

  /** Net SOL received from sells for the current token round (open or most recent closed). */
  function tradeSoldSol(state, mint) {
    return roundStats(state, mint, 0).soldSol;
  }

  /** Open-position market value in SOL (0 when flat). */
  function tradeHoldingsSol(state, mint, priceNative) {
    return roundStats(state, mint, priceNative).holdingsSol;
  }

  /** Open unrealized or most recent closed round P&L for this token. */
  function tradePnl(state, mint, priceNative) {
    const stats = roundStats(state, mint, priceNative);
    return { pnlSol: stats.pnlSol, pnlPct: stats.pnlPct };
  }

  function averageFillPrices(state, mint) {
    if (!state || !mint) return null;
    const journal = state.journal || [];
    const position = state.positions && state.positions[mint];
    let fills;

    if (position) {
      fills = journal.filter((t) => t.mint === mint && Number(t.ts) >= Number(position.openedAt));
    } else {
      // Rounds are stored newest-first (unshift), so .find() over the raw
      // array already returns the most recent round for this mint.
      const round = (state.rounds || []).find((r) => r.mint === mint);
      if (!round) return null;
      const ids = new Set(round.tradeIds || []);
      fills = journal.filter((t) => ids.has(t.id));
    }

    function weighted(side, priceKey) {
      let value = 0;
      let quantity = 0;
      for (const fill of fills) {
        if (fill.side !== side) continue;
        const qty = Number(fill.qty);
        const price = Number(fill[priceKey]);
        if (!(qty > 0) || !(price > 0)) continue;
        value += qty * price;
        quantity += qty;
      }
      return quantity > 0 ? value / quantity : null;
    }

    function weightedUsd(side) {
      // A USD average is only honest if EVERY fill on that side recorded a
      // USD price. Fresh-launch fills often pre-date the USD tick and carry
      // priceUsd: null; weighting only the fills that happened to have USD
      // silently changes which fills the "average" covers — the reported
      // "avg fills not accurate". When the set is incomplete return null and
      // let the caller derive USD from the complete native average.
      const sideFills = fills.filter((fill) => fill.side === side && Number(fill.qty) > 0);
      if (!sideFills.length) return null;
      if (!sideFills.every((fill) => Number(fill.priceUsd) > 0)) return null;
      return weighted(side, 'priceUsd');
    }

    const buyQty = fills.filter((t) => t.side === 'buy').reduce((sum, t) => sum + (Number(t.qty) || 0), 0);
    const sellQty = fills.filter((t) => t.side === 'sell').reduce((sum, t) => sum + (Number(t.qty) || 0), 0);
    if (!(buyQty > 0) && !(sellQty > 0)) return null;

    return {
      avgBuyNative: weighted('buy', 'priceNative'),
      avgBuyUsd: weightedUsd('buy'),
      avgSellNative: weighted('sell', 'priceNative'),
      avgSellUsd: weightedUsd('sell'),
      buyQty,
      sellQty,
      fillCount: fills.length,
    };
  }

  /**
   * Return the realized result the overlay should show after the newest sell
   * for a token. A full exit uses the completed round-trip result; a partial
   * exit uses the realized P&L of that individual sell.
   */
  function latestClosedPnl(state, mint) {
    if (!state || !mint) return null;
    const sell = (state.journal || []).find((t) => t.mint === mint && t.side === 'sell');
    if (!sell) return null;

    const round = (state.rounds || []).find(
      (r) => r.mint === mint && Number(r.closedAt) === Number(sell.ts)
    );
    if (round) {
      return {
        kind: 'round',
        symbol: round.symbol || sell.symbol || '',
        closedAt: round.closedAt,
        pnlSol: Number(round.pnlSol) || 0,
        pnlPct: Number(round.pnlPct) || 0,
        returnedSol: Number(round.returnedSol) || 0,
        investedSol: Number(round.investedSol) || 0,
      };
    }

    const pnlSol = Number(sell.pnlSol) || 0;
    const returnedSol = Number(sell.solNet) || 0;
    // sell.pnlSol = net proceeds - cost basis closed by this sell.
    const closedCostSol = returnedSol - pnlSol;
    return {
      kind: 'partial',
      symbol: sell.symbol || '',
      closedAt: sell.ts,
      pnlSol,
      pnlPct: closedCostSol > 0 ? (pnlSol / closedCostSol) * 100 : 0,
      returnedSol,
      investedSol: closedCostSol,
    };
  }

  /** Reset everything back to a fresh wallet with the given settings. */
  function resetState(settings, baseSeq = 0) {
    const fresh = defaultState(settings);
    // A reset that starts back at seq 0 is OLDER than every state a running
    // tab still holds, so that tab's next heartbeat mark clobbers the reset
    // and the old wallet reappears — the reported "reset restores old data"
    // bug. The fresh state must be strictly newer than anything in flight.
    fresh.seq = (Number(baseSeq) || 0) + 1;
    return fresh;
  }

  /* ---------------- misc ----------------
   * ELI5: IDs, formatting, journal cap, and the public export object. */

  function tradeId(ts) {
    return 't' + ts.toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function replaySessionId(mint, ts) {
    const cleanMint = String(mint || '').replace(/[^A-Za-z0-9]/g, '');
    const stamp = Math.max(0, Number(ts) || Date.now()).toString(36);
    const tail = cleanMint ? cleanMint.slice(0, 5) + cleanMint.slice(-4) : 'unknown';
    return `pts-${stamp}-${tail}`;
  }

  function pruneJournal(state) {
    if (state.journal.length > 2000) state.journal.length = 2000;
  }

  function short(addr) {
    return addr && addr.length > 10 ? addr.slice(0, 4) + '…' + addr.slice(-4) : (addr || '?');
  }

  const EPS_ = 1e-9;

  function fmt(n, dp = 4) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: dp });
  }

  function trimFixed(s) {
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  /** Compact token qty for tight UI rows (e.g. 30,783,947 → 30.78M). */
  function fmtCompact(n, dp = 2) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    const x = Number(n);
    if (!x) return '0';
    const sign = x < 0 ? '-' : '';
    const abs = Math.abs(x);
    if (abs >= 1e9) return sign + trimFixed((abs / 1e9).toFixed(dp)) + 'B';
    if (abs >= 1e6) return sign + trimFixed((abs / 1e6).toFixed(dp)) + 'M';
    if (abs >= 1e3) return sign + trimFixed((abs / 1e3).toFixed(dp)) + 'K';
    if (abs >= 1) return sign + trimFixed(abs.toFixed(dp));
    return sign + trimFixed(abs.toFixed(4));
  }

  /** Short token symbol for tight rows (e.g. BAGWORK → BAGWO...). */
  function fmtShortSymbol(sym, maxLen = 5) {
    const s = String(sym || '').trim();
    if (!s) return '—';
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '...';
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const sign = n > 0 ? '+' : n < 0 ? '-' : '';
    return sign + '$' + Math.abs(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  const _PaperEngine = {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    defaultSettings,
    mergeSettings,
    SETTINGS_REVISION,
    defaultState,
    resetState,
    buy,
    sell,
    getPosition,
    markPosition,
    unrealizedPnl,
    equitySol,
    grossOpenCostSol,
    backfillPosition,
    roundStats,
    tradeBoughtSol,
    tradeSoldSol,
    tradeHoldingsSol,
    tradePnl,
    averageFillPrices,
    latestClosedPnl,
    replaySessionId,
    short,
    fmt,
    fmtCompact,
    fmtShortSymbol,
    fmtUsd,
    clamp,
    EPS_,
  };

  if (typeof window !== 'undefined') {
    window.PaperEngine = _PaperEngine;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _PaperEngine;
  }

})();

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const E = require('../extension/engine.js');

const MINT = 'So11111111111111111111111111111111111111112';
const settings = E.defaultSettings();

function fill(o) {
  return {
    ts: Date.now(),
    mint: MINT,
    symbol: 'TEST',
    site: 'test',
    priceNative: 0.001,
    priceUsd: 0.2,
    ...o,
  };
}

function fresh() {
  return E.defaultState(settings);
}

describe('roundStats cash-flow P&L', () => {
  it('reconciles Sold + Holdings − Bought === PnL on open position', () => {
    let state = fresh();
    E.buy(state, settings, fill({ solAmount: 5, priceNative: 0.001 }));
    const pos = state.positions[MINT];
    const px = 0.002;
    const stats = E.roundStats(state, MINT, px);
    assert.equal(stats.boughtSol, pos.investedSol);
    assert.equal(stats.soldSol, 0);
    assert.ok(stats.holdingsSol > 0);
    const reconciled = stats.soldSol + stats.holdingsSol - stats.boughtSol;
    assert.ok(Math.abs(reconciled - stats.pnlSol) < 1e-9);
    assert.equal(stats.pnlPct, (stats.pnlSol / stats.boughtSol) * 100);
  });

  it('measures P&L against gross bought, not net costSol', () => {
    let state = fresh();
    E.buy(state, settings, fill({ solAmount: 5, priceNative: 0.001 }));
    const px = 0.002;
    const stats = E.roundStats(state, MINT, px);
    const oldNetPnl = stats.holdingsSol - state.positions[MINT].costSol;
    assert.notEqual(stats.pnlSol, oldNetPnl);
    assert.equal(stats.boughtSol, 5);
  });

  it('keeps P&L continuous across final sell except sell fee', () => {
    let state = fresh();
    const px = 0.001;
    E.buy(state, settings, fill({ solAmount: 5, priceNative: px }));
    const before = E.roundStats(state, MINT, px * 2);
    const { round } = E.sell(state, settings, fill({
      qtyFraction: 1,
      priceNative: px * 2,
    }));
    assert.ok(round);
    const closed = E.roundStats(state, MINT, px * 2);
    assert.equal(closed.open, false);
    assert.ok(Math.abs(closed.pnlSol - round.pnlSol) < 1e-9);
    assert.ok(Math.abs(before.pnlSol - round.pnlSol) < 0.1);
  });

  it('handles partial sell with correct remaining basis', () => {
    let state = fresh();
    E.buy(state, settings, fill({ solAmount: 2, priceNative: 0.001 }));
    E.buy(state, settings, fill({ solAmount: 3, priceNative: 0.001, ts: Date.now() + 1 }));
    E.sell(state, settings, fill({ qtyFraction: 0.5, priceNative: 0.002 }));
    const pos = state.positions[MINT];
    const stats = E.roundStats(state, MINT, 0.002);
    assert.ok(stats.soldSol > 0);
    assert.ok(stats.holdingsSol > 0);
    assert.equal(stats.boughtSol, 5);
    const reconciled = stats.soldSol + stats.holdingsSol - stats.boughtSol;
    assert.ok(Math.abs(reconciled - stats.pnlSol) < 1e-6);
    assert.ok(pos.entryCostSol > 0);
    assert.ok(pos.realizedSol > 0);
  });

  it('places fees and tx costs in investedSol only once', () => {
    let state = fresh();
    const withCosts = {
      ...settings,
      feeBps: 100,
      gasSolPerTx: 0.001,
      tipSolPerTx: 0.0005,
    };
    const startCash = state.cashSol;
    E.buy(state, withCosts, fill({ solAmount: 1, priceNative: 0.001 }));
    const pos = state.positions[MINT];
    assert.equal(pos.investedSol, 1 + 0.0015);
    assert.equal(startCash - state.cashSol, 1 + 0.0015);
  });

  it('avg entry is fee-free weighted fill price', () => {
    let state = fresh();
    E.buy(state, settings, fill({ solAmount: 1, priceNative: 0.001 }));
    const stats = E.roundStats(state, MINT, 0.001);
    assert.ok(Math.abs(stats.avgEntryNative - 0.001 * 0.99) < 1e-12);
    const mcapSkewed = state.positions[MINT].costSol / state.positions[MINT].qty;
    assert.notEqual(stats.avgEntryNative, mcapSkewed);
  });

  it('backfills legacy positions from journal', () => {
    let state = fresh();
    E.buy(state, settings, fill({ solAmount: 2, priceNative: 0.001, ts: 1000 }));
    E.sell(state, settings, fill({ qtyFraction: 0.5, priceNative: 0.002, ts: 2000 }));
    const pos = state.positions[MINT];
    delete pos.realizedSol;
    delete pos.entryCostSol;
    E.backfillPosition(state, pos);
    const stats = E.roundStats(state, MINT, 0.002);
    const reconciled = stats.soldSol + stats.holdingsSol - stats.boughtSol;
    assert.ok(Math.abs(reconciled - stats.pnlSol) < 1e-6);
    assert.ok(Number(pos.realizedSol) > 0);
    assert.ok(Number(pos.entryCostSol) > 0);
  });

  it('trade helpers match roundStats', () => {
    let state = fresh();
    E.buy(state, settings, fill({ solAmount: 3, priceNative: 0.001 }));
    const px = 0.0015;
    const stats = E.roundStats(state, MINT, px);
    assert.equal(E.tradeBoughtSol(state, MINT), stats.boughtSol);
    assert.equal(E.tradeSoldSol(state, MINT), stats.soldSol);
    assert.equal(E.tradeHoldingsSol(state, MINT, px), stats.holdingsSol);
    const pnl = E.tradePnl(state, MINT, px);
    assert.equal(pnl.pnlSol, stats.pnlSol);
    assert.equal(pnl.pnlPct, stats.pnlPct);
  });

  it('clamps near-zero P&L to zero', () => {
    let state = fresh();
    const px = 0.001;
    E.buy(state, settings, fill({ solAmount: 5, priceNative: px }));
    const pos = state.positions[MINT];
    const breakEvenPx = 5 / pos.qty;
    const stats = E.roundStats(state, MINT, breakEvenPx);
    assert.equal(stats.pnlSol, 0);
  });
});

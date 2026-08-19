/* PaperTrench — popup (paper-trading core).
 *
 * ELI5: The little control panel when you click the extension icon. It is
 * like a wallet receipt taped to the fridge — shows your paper balance,
 * recent trades, and quick knobs (overlay on/off, reset, backup). It does
 * not trade on the chart itself; it reads the shared notebook in Chrome
 * storage and lets you change settings that every open tab picks up.
 */

'use strict';

// ELI5: Fallback settings if storage is empty — same shape the engine expects.
const DEFAULTS = {
  appEnabled: true,
  balanceStartSol: 10,
  overlayEnabled: true,
  overlayHideWhenNoToken: true,
  presetsBuy: [0.1, 0.5, 1, 2],
  sellPcts: [25, 50, 75, 100],
  feeBps: 100,
  gasSolPerTx: 0,
  tipSolPerTx: 0,
  slippageBps: 0,
};

// ELI5: One-tap fee bundles — "bot", "fast", or "zero" cost simulation.
const FEE_PRESETS = {
  bot: { feeBps: 100, gasSolPerTx: 0.001, tipSolPerTx: 0.001, slippageBps: 0 },
  fast: { feeBps: 100, gasSolPerTx: 0.003, tipSolPerTx: 0.005, slippageBps: 50 },
  zero: { feeBps: 0, gasSolPerTx: 0, tipSolPerTx: 0, slippageBps: 0 },
};

function $(id) { return document.getElementById(id); }

$('toggle').addEventListener('click', toggleOverlay);
$('reset').addEventListener('click', resetWallet);
$('backup').addEventListener('click', backupWallet);
$('restore').addEventListener('click', () => $('restoreFile').click());
$('restoreFile').addEventListener('change', restoreWallet);
$('power').addEventListener('click', togglePower);
$('qs-apply').addEventListener('click', applyQuickSettings);

function fmt(n, dp = 4) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: dp });
}

/** ELI5: Blank paper wallet — starting cash, empty positions, seq 0. */
function freshState(settings) {
  return {
    version: 1,
    seq: 0,
    cashSol: settings.balanceStartSol,
    startedAt: Date.now(),
    positions: {},
    rounds: [],
    journal: [],
    stats: { totalBuys: 0, totalSells: 0, realizedPnlSol: 0, feesPaidSol: 0 },
  };
}

/** ELI5: Add up cash + open bags to get equity and realized P&L for the header. */
function computeStats(state, settings) {
  const positions = Object.values(state.positions || {});
  const rounds = state.rounds || [];
  const openValue = positions.reduce((s, p) => s + (p.qty || 0) * (p.lastPriceNative || 0), 0);
  const equity = (state.cashSol || 0) + openValue;
  let realized = Number((state.stats || {}).realizedPnlSol);
  if (!Number.isFinite(realized)) {
    realized = (state.journal || []).reduce(
      (s, t) => s + (t.side === 'sell' ? (Number(t.pnlSol) || 0) : 0), 0
    );
  }
  return {
    equitySol: equity,
    openPositions: positions.length,
    realizedPnlSol: realized,
    rounds: rounds.length,
    equityVsStart: equity - settings.balanceStartSol,
  };
}

/** ELI5: Paint the popup — equity, delta, recent rounds, quick-settings fields. */
async function load() {
  try {
    const stored = await chrome.storage.local.get(['pt_state', 'pt_settings']);
    const settings = { ...DEFAULTS, ...(stored.pt_settings || {}) };
    const state = stored.pt_state || freshState(settings);
    const stats = computeStats(state, settings);
    const up = stats.equityVsStart >= 0;

    $('equity').innerHTML = `${fmt(stats.equitySol, 2)} <small>SOL</small>`;
    $('equity').className = 'equity ' + (up ? 'green' : 'red');

    const deltaEl = $('delta');
    const pct = settings.balanceStartSol ? (stats.equityVsStart / settings.balanceStartSol) * 100 : 0;
    deltaEl.textContent = `${up ? '▲' : '▼'} ${up ? '+' : ''}${fmt(stats.equityVsStart, 3)} SOL (${up ? '+' : ''}${pct.toFixed(1)}%)`;
    deltaEl.className = 'delta ' + (up ? 'green' : 'red');

    $('toggle').textContent = settings.overlayEnabled !== false
      ? 'Disable overlay'
      : 'Enable overlay';

    const appOn = settings.appEnabled !== false;
    const power = $('power');
    power.textContent = appOn ? '⏻ Turn PaperTrench off' : '⏻ Turn PaperTrench on';
    power.className = appOn ? 'btn-backup' : 'btn-backup';
    const badge = $('badge');
    badge.textContent = appOn ? 'PAPER' : 'OFF';
    badge.classList.toggle('badge-off', !appOn);

    $('cash').textContent = fmt(state.cashSol, 2);
    $('open').textContent = stats.openPositions;
    $('rounds').textContent = stats.rounds;

    const pnlEl = $('pnl');
    pnlEl.textContent = (stats.realizedPnlSol >= 0 ? '+' : '') + fmt(stats.realizedPnlSol, 3);
    pnlEl.className = 'v ' + (stats.realizedPnlSol >= 0 ? 'green' : 'red');

    fillQuickSettings(settings);

    const rounds = (state.rounds || []).slice(0, 6);
    $('recent').innerHTML = rounds.length
      ? rounds.map((r) => `
          <div class="row">
            <span><strong>${escapeHtml(r.symbol || '?')}</strong><span class="dim"> · ${((r.heldMs || 0) / 60000).toFixed(1)}m</span></span>
            <span class="${r.pnlSol >= 0 ? 'green' : 'red'}" style="font-weight:normal">${r.pnlSol >= 0 ? '+' : ''}${fmt(r.pnlSol, 3)} SOL</span>
          </div>`).join('')
      : '<div class="row dim">No closed round trips yet</div>';
  } catch (err) {
    $('status').textContent = 'Error: ' + err.message;
    console.error('PaperTrench popup load failed', err);
  }
}

let qsFilled = false;

function fillQuickSettings(settings) {
  if (qsFilled) return;
  qsFilled = true;
  $('qs-balance').value = settings.balanceStartSol;
  $('qs-presets').value = (settings.presetsBuy || DEFAULTS.presetsBuy).join(', ');
  $('qs-sellpcts').value = (settings.sellPcts || DEFAULTS.sellPcts).join(', ');
  const match = Object.keys(FEE_PRESETS).find((key) => {
    const p = FEE_PRESETS[key];
    return Number(settings.feeBps) === p.feeBps
      && (Number(settings.gasSolPerTx) || 0) === p.gasSolPerTx
      && (Number(settings.tipSolPerTx) || 0) === p.tipSolPerTx
      && (Number(settings.slippageBps) || 0) === p.slippageBps;
  });
  $('qs-fees').value = match || 'custom';
}

function parseNumberList(raw, max, label, notes, { dedupe = false } = {}) {
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let values = parts.map((s) => parseFloat(s)).filter((n) => Number.isFinite(n) && n > 0 && n <= max);
  if (dedupe) values = [...new Set(values)];
  if (values.length > 8) values = values.slice(0, 8);
  if (!values.length) { notes.push(`${label}: no valid entries — kept the saved list`); return null; }
  if (values.length !== parts.length) {
    notes.push(`${label}: kept ${values.length} of ${parts.length} entries`);
  }
  return values;
}

/** ELI5: Save balance/presets/fees from the quick form into shared storage. */
async function applyQuickSettings() {
  const stored = await chrome.storage.local.get(['pt_settings']);
  const settings = { ...DEFAULTS, ...(stored.pt_settings || {}) };
  const notes = [];
  const patch = {};

  const balanceRaw = $('qs-balance').value;
  const balanceNum = Number(balanceRaw);
  if (String(balanceRaw).trim() !== '') {
    if (Number.isFinite(balanceNum) && balanceNum >= 0.1) {
      if (balanceNum !== Number(settings.balanceStartSol)) {
        patch.balanceStartSol = balanceNum;
        notes.push('starting balance saved — cash changes on the next reset');
      }
    } else {
      notes.push(`starting balance "${balanceRaw}" rejected (must be ≥ 0.1 SOL)`);
    }
  }

  const presets = parseNumberList($('qs-presets').value, 1000, 'quick-buy presets', notes);
  if (presets) patch.presetsBuy = presets;
  const sellPcts = parseNumberList($('qs-sellpcts').value, 100, 'quick-sell presets', notes, { dedupe: true });
  if (sellPcts) patch.sellPcts = sellPcts;

  const feeChoice = $('qs-fees').value;
  if (FEE_PRESETS[feeChoice]) Object.assign(patch, FEE_PRESETS[feeChoice]);

  if (!Object.keys(patch).length) {
    $('status').textContent = notes.length ? notes.join(' · ') : 'Nothing to change.';
    return;
  }
  await chrome.storage.local.set({ pt_settings: { ...settings, ...patch } });
  chrome.runtime.sendMessage({ type: 'pt_settings_changed' }).catch(() => {});
  qsFilled = false;
  await load();
  $('status').textContent = ['Applied — open trading tabs pick it up live.', ...notes].join(' · ');
}

/** ELI5: Hide or show the floating trade panel on the active tab. */
async function toggleOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'pt_toggle_overlay' });
      window.close();
      return;
    } catch (_) {}
  }
  const stored = await chrome.storage.local.get(['pt_settings']);
  const settings = { ...DEFAULTS, ...(stored.pt_settings || {}) };
  const newSettings = { ...settings, overlayEnabled: !settings.overlayEnabled };
  await chrome.storage.local.set({ pt_settings: newSettings });
  chrome.runtime.sendMessage({ type: 'pt_settings_changed' }).catch(() => {});
  await load();
  $('status').textContent = tab
    ? 'Updated — reload this page for the overlay to respond.'
    : 'Updated.';
}

/** ELI5: Master off switch — tears down PaperTrench everywhere until re-enabled. */
async function togglePower() {
  const stored = await chrome.storage.local.get(['pt_settings']);
  const settings = { ...DEFAULTS, ...(stored.pt_settings || {}) };
  const next = { ...settings, appEnabled: settings.appEnabled === false };
  await chrome.storage.local.set({ pt_settings: next });
  chrome.runtime.sendMessage({ type: 'pt_settings_changed' }).catch(() => {});
  await load();
  $('status').textContent = next.appEnabled
    ? 'PaperTrench is back on.'
    : 'PaperTrench is off everywhere until you turn it back on.';
}

/** ELI5: Wipe the pretend wallet and start over (bumps seq so tabs don't clobber). */
async function resetWallet() {
  if (!confirm('Reset the paper wallet and erase positions and trade history?')) return;
  const stored = await chrome.storage.local.get(['pt_settings', 'pt_state']);
  const settings = { ...DEFAULTS, ...(stored.pt_settings || {}) };
  const baseSeq = (stored.pt_state && Number(stored.pt_state.seq)) || 0;
  const fresh = freshState(settings);
  fresh.seq = baseSeq + 1;
  await chrome.storage.local.set({
    pt_state: fresh,
  });
  chrome.runtime.sendMessage({ type: 'pt_settings_changed' }).catch(() => {});
  load();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const BACKUP_KEYS = ['pt_state', 'pt_settings'];

/** ELI5: Download wallet + settings as a JSON file you can save elsewhere. */
async function backupWallet() {
  const stored = await chrome.storage.local.get(BACKUP_KEYS);
  const backup = {
    app: 'papertrench-backup',
    format: 1,
    exportedAt: new Date().toISOString(),
    data: stored,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `papertrench-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  $('status').textContent = 'Backup downloaded.';
}

/** ELI5: Load a backup file back into storage (with seq bump so it wins over tabs). */
async function restoreWallet(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch (_) {
    $('status').textContent = 'That file is not valid JSON.';
    return;
  }
  const data = backup && backup.app === 'papertrench-backup' ? backup.data : backup;
  if (!data || typeof data !== 'object' || !data.pt_state || typeof data.pt_state !== 'object') {
    $('status').textContent = 'Not a PaperTrench backup — nothing was restored.';
    return;
  }
  const rounds = Array.isArray(data.pt_state.rounds) ? data.pt_state.rounds.length : 0;
  if (!confirm(`Restore this backup? It replaces your current wallet (${rounds} closed rounds in the backup).`)) return;
  const write = {};
  for (const key of BACKUP_KEYS) if (data[key] !== undefined) write[key] = data[key];
  const current = await chrome.storage.local.get(['pt_state']);
  const liveSeq = Number(current.pt_state && current.pt_state.seq) || 0;
  const backupSeq = Number(write.pt_state.seq) || 0;
  write.pt_state.seq = Math.max(liveSeq, backupSeq) + 1;
  const restored = await chrome.runtime.sendMessage({
    type: 'pt_state_commit', state: write.pt_state, force: true,
  }).catch(() => null);
  const rest = { ...write };
  if (restored && restored.ok) delete rest.pt_state;
  await chrome.storage.local.set(rest);
  chrome.runtime.sendMessage({ type: 'pt_settings_changed' }).catch(() => {});
  $('status').textContent = 'Backup restored.';
  load();
}

load();

/* PaperTrench — panel toast stack (queued slots under the overlay).
 * Loaded before content.js. Factory: window.PTPanelToast.create(ctx).
 *
 * ELI5: The little messages that pop up under the panel — "Bought 0.5 SOL",
 * "Alert fired", etc. They stack in slots so they never pile on top of
 * each other, and wait in line if all slots are busy.
 */
(() => {
  'use strict';

  // ELI5: How many toast messages can show at once, and how long they live.
  const TOAST_SLOT_COUNT = 8;
  const TOAST_LIFE_MS = 4200;
  const TOAST_STEP_PX = 52;
  const TOAST_QUEUE_MAX = 16;

  function create(ctx) {
    const toastSlotBusy = new Array(TOAST_SLOT_COUNT).fill(false);
    const toastQueue = [];

    /** Where slot 0 goes right now: under the panel, on the panel's side. */
    // ELI5: Figure out where to put toasts so they sit just below the panel.
    function toastBase() {
      const vh = window.innerHeight || 600;
      let right = 18;
      let top = 74;
      const box = ctx.els && ctx.els.box;
      if (box) {
        const pos = ctx.readPanelPos();
        right = pos.right;
        let panelH = 0;
        try {
          const hidden = box.classList && box.classList.contains('pt-hidden');
          const rect = !hidden && box.getBoundingClientRect ? box.getBoundingClientRect() : null;
          panelH = (rect && Number(rect.height)) || 0;
        } catch (_) { /* fall back to the header clearance */ }
        // Visible panel: start under it. Hidden/minimized: its saved spot is
        // free below the (absent) header, so only clear the header band.
        top = pos.top + (panelH > 0 ? panelH + 10 : 48);
      }
      // However tall the panel, keep at least two slots on screen.
      return { right, top: Math.max(8, Math.min(top, vh - 2 * TOAST_STEP_PX)) };
    }

    // ELI5: Show a short message; queue it if all slots are full.
    function toast(msg) {
      const root = ctx.shadow && ctx.shadow.getElementById('pt-toast-root');
      if (!root) return;
      const slot = toastSlotBusy.indexOf(false);
      if (slot === -1) {
        // Every slot is on screen: queue rather than overprint (O-28).
        if (toastQueue.length < TOAST_QUEUE_MAX) toastQueue.push(msg);
        return;
      }
      toastSlotBusy[slot] = true;
      const base = toastBase();
      const d = document.createElement('div');
      d.className = 'pt-toast';
      d.style.top = Math.round(base.top + slot * TOAST_STEP_PX) + 'px';
      d.style.right = Math.round(base.right) + 'px';
      d.textContent = msg;
      root.appendChild(d);
      setTimeout(() => {
        try { d.remove(); } catch (_) {}
        toastSlotBusy[slot] = false;
        if (toastQueue.length && !ctx.contextDead) toast(toastQueue.shift());
      }, TOAST_LIFE_MS);
    }

    function reset() {
      toastQueue.length = 0;
      for (let i = 0; i < toastSlotBusy.length; i++) toastSlotBusy[i] = false;
    }

    return { toast, reset };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.PTPanelToast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

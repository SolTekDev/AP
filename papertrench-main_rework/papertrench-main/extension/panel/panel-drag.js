/* PaperTrench — panel drag / position helpers.
 *
 * Loaded before content.js. Owns clamp math + makeDraggable (O-16..O-26).
 * Does NOT own settings persistence or overlay mount — content.js wires those.
 *
 * ELI5: Makes the panel and positions bar draggable without flying off screen.
 * When you grab and move them, this file does the math so they stay visible
 * and remembers not to treat a drag as a click.
 */
(() => {
  'use strict';

  /* ── Layout constants ────────────────────────────────────────────────────── */

  /** Minimum sliver of a dragged element that must stay reachable on screen. */
  const DRAG_KEEP_PX = 40;

  const DEFAULT_PANEL_RIGHT = 18;
  const DEFAULT_PANEL_TOP = 84;
  const DEFAULT_BAR_LEFT = 210;
  const DEFAULT_BAR_TOP = 7;
  const DEFAULT_VIEWPORT_W = 800;
  const DEFAULT_VIEWPORT_H = 600;
  const PANEL_BOTTOM_KEEP_PX = 48;
  const BAR_BOTTOM_KEEP_PX = 20;
  const DRAG_MOVE_THRESHOLD_PX = 5; // shaky tap vs real drag (Wave 1)
  const JUST_DRAGGED_MS = 400;      // click vs drop disambiguation window

  const OVERLAY_MIN_W = 260;
  const OVERLAY_MAX_W = 560;
  const OVERLAY_MIN_H = 320;
  const OVERLAY_MAX_H = 820;

  /* ── Helpers ─────────────────────────────────────────────────────────────── */

  /** Pixel-string → number with Number.isFinite semantics (DEFECT O-19). */
  function finitePx(value, fallback) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Clamp the panel's (and pill's) right/top so its header stays reachable.
   * opts.box — optional element for live width; opts.overlayWidth — saved px.
   */
  // ELI5: Keep the panel inside the window so you can always grab it again.
  function clampPanelPos(right, top, opts) {
    opts = opts || {};
    const vw = window.innerWidth || DEFAULT_VIEWPORT_W;
    const vh = window.innerHeight || DEFAULT_VIEWPORT_H;
    let w = 0;
    try {
      const box = opts.box;
      const rect = box && box.getBoundingClientRect && box.getBoundingClientRect();
      w = (rect && Number(rect.width)) || 0;
    } catch (_) { /* fall through */ }
    if (!(w > 0) && Number(opts.overlayWidth) > 0) w = Number(opts.overlayWidth);
    const keep = Math.max(DRAG_KEEP_PX, Math.min(w, vw));
    return {
      right: Math.max(0, Math.min(finitePx(right, DEFAULT_PANEL_RIGHT), vw - keep)),
      top: Math.max(0, Math.min(finitePx(top, DEFAULT_PANEL_TOP), vh - PANEL_BOTTOM_KEEP_PX)),
    };
  }

  /** Clamp the positions bar's left/top so its grip stays reachable (O-16). */
  // ELI5: Keep the positions bar inside the window too.
  function clampBarPos(left, top) {
    const vw = window.innerWidth || DEFAULT_VIEWPORT_W;
    const vh = window.innerHeight || DEFAULT_VIEWPORT_H;
    return {
      left: Math.max(0, Math.min(finitePx(left, DEFAULT_BAR_LEFT), vw - DRAG_KEEP_PX)),
      top: Math.max(0, Math.min(finitePx(top, DEFAULT_BAR_TOP), vh - BAR_BOTTOM_KEEP_PX)),
    };
  }

  /** The panel's current right/top from computed style. */
  function readPanelPos(box) {
    let style = null;
    try { style = box ? window.getComputedStyle(box) : null; } catch (_) {}
    return {
      right: finitePx(style && style.right, DEFAULT_PANEL_RIGHT),
      top: finitePx(style && style.top, DEFAULT_PANEL_TOP),
    };
  }

  /**
   * Apply (and clamp) panel position; pill mirrors it (O-20).
   * opts: { box, pill, overlayWidth }
   */
  function applyPanelPos(right, top, opts) {
    opts = opts || {};
    if (!opts.box) return null;
    const pos = clampPanelPos(right, top, opts);
    opts.box.style.right = pos.right + 'px';
    opts.box.style.top = pos.top + 'px';
    opts.box.style.left = 'auto';
    if (opts.pill) {
      opts.pill.style.right = pos.right + 'px';
      opts.pill.style.top = pos.top + 'px';
      opts.pill.style.left = 'auto';
    }
    return pos;
  }

  /**
   * Re-clamp the panel into the current viewport (window resize, O-18).
   * A clamp that cannot MEASURE must not move anything (O-17 / O-19).
   */
  // ELI5: After a window resize, pull the panel back on screen if needed.
  function reclampPanel(opts) {
    opts = opts || {};
    if (!opts.box) return;
    if (!(opts.box.offsetWidth > 0) || !(window.innerWidth > 0)) return;
    const pos = readPanelPos(opts.box);
    applyPanelPos(pos.right, pos.top, opts);
  }

  /** Clamp user-resized overlay dimensions. */
  function clampOverlaySize(w, h) {
    return {
      w: Math.max(OVERLAY_MIN_W, Math.min(OVERLAY_MAX_W, Math.round(w))),
      h: Math.max(OVERLAY_MIN_H, Math.min(OVERLAY_MAX_H, Math.round(h))),
    };
  }

  /**
   * Wire ONE drag handle. `spec`:
   *   start()             position at pointerdown
   *   move(start, dx, dy) apply clamped position for this delta
   *   drop()              persist
   *   ignore(ev)          optional pass-through
   * opts.onCleanup(fn)    register mount teardown (content.js onMountCleanup)
   * Returns { justDragged() } for click-vs-drop on the same element.
   */
  // ELI5: Wire up "grab this handle and drag" for the panel or bar.
  function makeDraggable(handle, spec, opts) {
    if (!handle || !handle.addEventListener) return { justDragged: () => false };
    opts = opts || {};
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let start = null;
    let moved = false;
    let droppedAt = 0;

    const onMove = (e) => {
      if (!dragging || !start) return;
      const dx = (e.clientX || 0) - sx;
      const dy = (e.clientY || 0) - sy;
      if (Math.abs(dx) > DRAG_MOVE_THRESHOLD_PX || Math.abs(dy) > DRAG_MOVE_THRESHOLD_PX) {
        moved = true;
      }
      if (e.cancelable && e.preventDefault) e.preventDefault();
      spec.move(start, dx, dy);
    };
    const unbindWindow = () => {
      try { window.removeEventListener('pointermove', onMove); } catch (_) {}
      try { window.removeEventListener('pointerup', onUp); } catch (_) {}
      try { window.removeEventListener('pointercancel', onUp); } catch (_) {}
    };
    function onUp() {
      if (!dragging) return;
      dragging = false;
      start = null;
      unbindWindow();
      if (moved) droppedAt = Date.now();
      spec.drop();
    }
    const onDown = (e) => {
      if (spec.ignore && spec.ignore(e)) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      dragging = true;
      moved = false;
      sx = e.clientX || 0;
      sy = e.clientY || 0;
      start = spec.start();
      if (e.pointerId !== undefined && typeof handle.setPointerCapture === 'function') {
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      if (e.cancelable && e.preventDefault) e.preventDefault();
    };

    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    if (typeof opts.onCleanup === 'function') {
      opts.onCleanup(() => {
        dragging = false;
        start = null;
        unbindWindow();
        if (handle.removeEventListener) {
          try { handle.removeEventListener('pointerdown', onDown); } catch (_) {}
          try { handle.removeEventListener('pointermove', onMove); } catch (_) {}
          try { handle.removeEventListener('pointerup', onUp); } catch (_) {}
          try { handle.removeEventListener('pointercancel', onUp); } catch (_) {}
        }
      });
    }

    return { justDragged: () => moved && Date.now() - droppedAt < JUST_DRAGGED_MS };
  }

  /** Factory for content.js — closes over els / settings / onMountCleanup. */
  function create(ctx) {
    function panelPosOpts() {
      return {
        box: ctx.els && ctx.els.box,
        pill: ctx.els && ctx.els.pill,
        overlayWidth: Number(ctx.settings && ctx.settings.overlayWidth) || 0,
      };
    }
    return {
      clampOverlaySize,
      panelPosOpts,
      clampPanelPos(right, top) { return clampPanelPos(right, top, panelPosOpts()); },
      clampBarPos,
      readPanelPos() { return readPanelPos(ctx.els && ctx.els.box); },
      applyPanelPos(right, top) { return applyPanelPos(right, top, panelPosOpts()); },
      reclampPanel() { return reclampPanel(panelPosOpts()); },
      makeDraggable(handle, spec) {
        return makeDraggable(handle, spec, { onCleanup: ctx.onMountCleanup });
      },
    };
  }

  const api = {
    create,
    DRAG_KEEP_PX,
    DEFAULT_PANEL_RIGHT,
    DEFAULT_PANEL_TOP,
    OVERLAY_MIN_W,
    OVERLAY_MAX_W,
    OVERLAY_MIN_H,
    OVERLAY_MAX_H,
    finitePx,
    clampPanelPos,
    clampBarPos,
    readPanelPos,
    applyPanelPos,
    reclampPanel,
    clampOverlaySize,
    makeDraggable,
  };

  if (typeof window !== 'undefined') window.PTPanelDrag = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

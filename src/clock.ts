import { candleFlicker, type Flicker, type Vec2 } from "./motion.ts";

/** Everything the room knows at one instant, computed once and handed to every
 *  plate. There is one candle in this room, so `flick` is shared; the sitters
 *  each have their own mind, so their glance phase is not (see gaze/phase.ts). */
export type GazeFrame = {
  /** Seconds since the clock started. */
  t: number;
  /** Last known pointer position in client coordinates, or null if it has never
   *  been seen or has left the window. */
  pointer: Vec2 | null;
  sinceMoveMs: number;
  flick: Flicker;
};

export type GazeClock = {
  subscribe(fn: (f: GazeFrame) => void): () => void;
  destroy(): void;
};

/**
 * One rAF loop, one pointer listener, one flame, for the whole page.
 *
 * The rig this was extracted from ran all three per portrait, which is correct
 * for a page with one portrait on it and wasteful for a ring. It also pauses
 * when the tab is hidden, which the original did too; per-plate visibility is
 * the plate's business, not the clock's.
 */
export function createGazeClock(): GazeClock {
  const subs = new Set<(f: GazeFrame) => void>();
  const start = performance.now();
  const pointer: Vec2 = { x: 0, y: 0 };
  let seen = false;
  // Engagement is time since this, so the room starts self-directed rather than
  // staring at a cursor that has not moved yet.
  let lastMoveMs = -1e9;
  let raf = 0;
  let running = false;

  const onMove = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    seen = true;
    lastMoveMs = performance.now();
  };

  // Pointer gone from the window entirely: drop the gaze at once rather than
  // waiting out the hold on a cursor that is no longer there.
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget) {
      seen = false;
      lastMoveMs = -1e9;
    }
  };

  const loop = () => {
    const now = performance.now();
    const t = (now - start) / 1000;
    const frame: GazeFrame = {
      t,
      pointer: seen ? pointer : null,
      sinceMoveMs: now - lastMoveMs,
      flick: candleFlicker(t),
    };
    for (const fn of subs) fn(frame);
    if (running) raf = requestAnimationFrame(loop);
  };

  const sync = () => {
    const should = !document.hidden;
    if (should && !running) {
      running = true;
      raf = requestAnimationFrame(loop);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerout", onOut, { passive: true });
  document.addEventListener("visibilitychange", sync);
  running = true;
  raf = requestAnimationFrame(loop);

  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      document.removeEventListener("visibilitychange", sync);
      subs.clear();
    },
  };
}

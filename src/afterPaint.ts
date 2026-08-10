/**
 * When a background layer is allowed to start building itself.
 *
 * Vendored 2026-08-06 from the landing portrait of memormaneo.com. Each plate
 * costs a shader compile, two texture uploads and a full-size buffer, and none
 * of it is visible on the first frame: the <img> under the canvas is already
 * showing the print. On a page of several plates that cost is multiplied by the
 * number of them, so this matters more here than it did for one portrait.
 *
 * Two frames, not one: a callback in the first frame still runs before that
 * frame is painted, so only the second is safely on the other side of it.
 *
 * @param work Setup to defer. Whatever it returns is treated as its teardown, so
 *   an effect can hand this straight back to React.
 * @returns Dispose. Before `work` has run it cancels it; after, it runs `work`'s
 *   own teardown. Safe to call more than once.
 */
export function afterPaint(work: () => void | (() => void)): () => void {
  let teardown: (() => void) | null = null;
  let disposed = false;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      frame = 0;
      teardown = work() ?? null;
    });
  });

  return () => {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    teardown?.();
  };
}

import { GLANCE_WINDOW_S } from "./motion.ts";

/** phi. The most irrational number there is, in the sense that matters here: its
 *  continued fraction is all ones, so its multiples avoid every rational
 *  alignment for as long as arithmetic allows. */
const GOLDEN = 1.618033988749895;

/**
 * Seconds between one plate's glance clock and the next: one whole glance window
 * plus the golden fraction of another. Both halves earn their place.
 *
 * The WHOLE WINDOW is what stops the chorus. glanceTarget draws its look-points
 * from floor(t / GLANCE_WINDOW_S), so two plates less than a window apart spend
 * much of their time in the same window, easing between the same pair of points,
 * and once both saccades finish they hold the identical point. Measured over 1200
 * samples, two plates 0.5s apart agree to within 0.02 on 817 of them; 3.09s apart,
 * on 149; a full window and a bit apart, on 8.
 *
 * The GOLDEN FRACTION spreads them inside the window. `i / phi mod 1` maximises
 * the smallest gap for every prefix length, so three plates are as evenly spread
 * as three can be and so are nine, which is what lets the ring grow by adding
 * manifest entries and nothing else.
 *
 * Change this only with test/phase.test.ts in front of you. Dropping the whole
 * window multiplies the coincidences by twenty; rounding the fraction collapses
 * the four-plate gap from 0.729s to 0.2s.
 */
export const PHASE_STEP = GLANCE_WINDOW_S * GOLDEN;

/**
 * The glance-clock offset for the plate at `index` in the manifest.
 *
 * Passed to glanceTarget as `glanceTarget(t + phase)`. Because the offset shifts
 * both which window is current and which hash is drawn, one number changes the
 * cadence and the sequence of look-points at once.
 *
 * The candle is deliberately not phased: there is one flame in the room, so
 * every frame breathes together while every mind wanders alone.
 *
 * Deliberately unbounded. An earlier version wrapped this modulo nine windows to
 * keep the number small, which was pure cosmetics (nothing hand-writes a phase;
 * the manifest calls this function) and it cost real quality: the wrap brought
 * plate 6 back to 3.5s, inside one window of plate 0, and their coincidence count
 * jumped from 8 to 82 per 1200 samples. Rounding to four decimals is safe by a
 * wide margin, since the plates are 0.279s apart at worst.
 */
export function phaseFor(index: number): number {
  return Number((index * PHASE_STEP).toFixed(4));
}

/**
 * Pure motion helpers for a candlelit engraved portrait. No DOM, no side
 * effects, unit tested in test/motion.test.ts.
 *
 * Vendored 2026-08-06 from the landing portrait of memormaneo.com, converted to
 * TypeScript. Behaviour is identical; the cases in test/motion.test.ts are that
 * portrait's own test file, ported, and they are the proof.
 */

export type Vec2 = { x: number; y: number };
export type Flicker = { gain: number; dx: number; dy: number };
export type Rect = { left: number; top: number; width: number; height: number };

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Hermite smoothstep: 0 at or below edge0, 1 at or above edge1, eased between. */
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Linear interpolation. */
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Pointer position relative to an element centre, normalised to [-1, 1] against
 * the half-viewport, so the effect responds to whole-screen movement.
 *
 * `rect` must be a viewport-space box, which is to say `getBoundingClientRect()`
 * and not the layout box: in the ring a plate is transformed, and where it
 * actually is on screen is the whole question.
 */
export function normalizePointer(
  clientX: number,
  clientY: number,
  rect: Rect,
  vw: number,
  vh: number,
): Vec2 {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    x: clamp((clientX - cx) / (vw / 2), -1, 1),
    y: clamp((clientY - cy) / (vh / 2), -1, 1),
  };
}

/** One critically-damped-ish easing step toward target. */
export const dampedStep = (current: number, target: number, k: number): number =>
  current + (target - current) * k;

/**
 * Slow deterministic drift for idle breathing. Two detuned sines per axis keep
 * it from looking periodic; bounded to [-0.5, 0.5].
 * @param t seconds
 */
export function idleSignal(t: number): Vec2 {
  const x = 0.35 * Math.sin(t * 0.55) + 0.12 * Math.sin(t * 0.23 + 1.7);
  const y = 0.28 * Math.sin(t * 0.4 + 0.6) + 0.12 * Math.sin(t * 0.17 + 3.1);
  return { x: clamp(x, -0.5, 0.5), y: clamp(y, -0.5, 0.5) };
}

/**
 * 1 while the pointer moved within holdMs, then a linear ramp to 0 over fadeMs.
 * @param elapsedMs since the last pointer move
 */
export function pointerFade(elapsedMs: number, holdMs: number, fadeMs: number): number {
  if (elapsedMs <= holdMs) return 1;
  return clamp(1 - (elapsedMs - holdMs) / fadeMs, 0, 1);
}

/**
 * Gaze offset for the eye-warp shader. Pointer space in (x right+, y down+,
 * -1..1); GL-UV offset out (y up+, the flip is folded in here and only here, so
 * it stays unit-testable). Clamped to the per-axis max.
 *
 * restDownY lowers the whole vertical range: it compensates artwork whose drawn
 * gaze is elevated, so the neutral pupil meets the viewer instead of looking
 * over their head.
 */
export function eyeGaze(
  x: number,
  y: number,
  maxX: number,
  maxY: number,
  restDownY = 0,
): Vec2 {
  return {
    x: clamp(x, -1, 1) * maxX,
    y: -clamp(y, -1, 1) * maxY - restDownY,
  };
}

// Self-life gaze cadence. A short base window with a jittered saccade start
// inside it, so the head reaches a look-point, holds a fixation, then moves on:
// frequent but never metronomic, while the turn itself stays slow.
/** Base seconds per look-point. Exported because a plate's phase offset must
 *  not be a small integer multiple of it, or the offset aliases back into
 *  alignment and every plate saccades as one. */
export const GLANCE_WINDOW_S = 5;
const GLANCE_SACCADE_S = 1.4; // slow, deliberate turn between look-points
const GLANCE_MICRO = 0.05; // amplitude of the live micro-drift on a fixation

/** Deterministic 0..1 hash. Decorrelates successive look-points so the wander
 *  reads as random rather than a smooth periodic sweep, and does the same job
 *  for the wall's hang: a still capture of a plate has to come out the same way
 *  every time it is taken, so nothing here may call Math.random. */
export const hash01 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A deterministic contemplative look-point for window index k (look-space,
 *  x right+, y down+): wide spread, biased slightly up, never a hard forward
 *  stare. Hashed so consecutive points are not correlated. */
function glancePoint(k: number): Vec2 {
  return {
    x: 0.85 * (hash01(k) * 2 - 1),
    y: 0.5 * (hash01(k + 57.3) * 2 - 1) - 0.1,
  };
}

/**
 * Self-life gaze target when the cursor is away: the mind picks a look-point,
 * eases to it over a saccade, holds a fixation (with a small live micro-drift so
 * it never freezes, since an engraving has no blink to soften a dead stare),
 * then drifts on to the next. Each window's saccade starts at a random time; the
 * turn itself takes GLANCE_SACCADE_S. Deterministic, so it can be frozen at a
 * chosen t for a reproducible still capture and unit-tested besides, and bounded
 * to a contemplative region.
 * @param t seconds. Call it as `glanceTarget(t + plate.phase)`: the offset
 *   shifts both which window is current and which hash is drawn, so one number
 *   changes the cadence and the sequence of look-points at once.
 */
export function glanceTarget(t: number): Vec2 {
  const k = Math.floor(t / GLANCE_WINDOW_S);
  const u = t / GLANCE_WINDOW_S - k; // 0..1 within the window
  const from = glancePoint(k);
  const to = glancePoint(k + 1);
  const s0 = 0.05 + 0.5 * hash01(k + 91.7); // saccade starts 5 to 55% into the window
  const s1 = Math.min(s0 + GLANCE_SACCADE_S / GLANCE_WINDOW_S, 0.97); // ease always completes
  const e = smoothstep(s0, s1, u);
  const micro = idleSignal(t);
  return {
    x: clamp(mix(from.x, to.x, e) + GLANCE_MICRO * micro.x, -0.9, 0.9),
    y: clamp(mix(from.y, to.y, e) + GLANCE_MICRO * micro.y, -0.7, 0.5),
  };
}

/**
 * Candle-flame flicker: a slow breathing wander with small fast shivers, layered
 * detuned sines so it never reads as periodic. Deterministic.
 *
 * There is one candle for the whole page, so this is computed once per frame
 * for the whole ring and handed to every plate. gain multiplies a light's
 * intensity (about 0.8 to 1.06); dx/dy are a -1..1 sway for the light's
 * position, scaled to taste at the call site.
 * @param t seconds
 */
export function candleFlicker(t: number): Flicker {
  const gain =
    0.93 +
    0.055 * Math.sin(t * 1.1 + Math.sin(t * 0.53) * 1.4) +
    0.035 * Math.sin(t * 3.7 + 0.8) * Math.sin(t * 0.9 + 2.1) +
    0.02 * Math.sin(t * 8.3 + 4.4);
  return {
    gain: clamp(gain, 0.78, 1.08),
    dx: clamp(0.6 * Math.sin(t * 1.7 + 0.4) + 0.4 * Math.sin(t * 4.3), -1, 1),
    dy: clamp(0.6 * Math.sin(t * 1.3 + 2.6) + 0.4 * Math.sin(t * 5.1 + 1.2), -1, 1),
  };
}

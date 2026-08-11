/**
 * argus: engraved portraits that watch your cursor.
 *
 * Two things make a sitter look at somebody. `createRig` draws one plate and
 * takes a frame at a time; `createGazeClock` supplies those frames, one rAF and
 * one pointer listener for the whole page however many plates are hanging.
 *
 * The rig deliberately does not own its clock. A page with nine portraits on it
 * wants one loop and one cursor, not nine of each, so the caller drives frame().
 *
 * `createRig` returns null when WebGL2 is unavailable and hides the canvas. That
 * is the fallback contract, not a failure: put an <img> of the plate underneath
 * the canvas and it becomes visible on its own.
 */

export { createRig, litAtCentre, bufferSize, eyeUniform, rimUniform } from "./rig.ts";
export { TORCH_PX, TORCH_ZOOM_PX, TORCH_STILL_REACH } from "./rig.ts";
export type { FrameInput, RigHandle } from "./rig.ts";

export { createGazeClock } from "./clock.ts";
export type { GazeClock, GazeFrame } from "./clock.ts";

export { phaseFor, PHASE_STEP } from "./phase.ts";
// The unit those phases are measured against. Public for the same reason the
// constant's own comment gives: a gallery choosing phase offsets has to know
// not to land on a small integer multiple of it, or the offsets alias back into
// alignment and every sitter saccades together.
export { GLANCE_WINDOW_S } from "./motion.ts";
export { afterPaint } from "./afterPaint.ts";

export { VERT, FRAG, UNIFORMS } from "./shader.ts";

export type { GazePlate, EyeRegion, Ellipse, Radii } from "./plate.ts";
export type { Vec2, Flicker } from "./motion.ts";

import {
  normalizePointer,
  dampedStep,
  mix,
  eyeGaze,
  pointerFade,
  glanceTarget,
  type Flicker,
  type Vec2,
} from "./motion.ts";
import { VERT, FRAG } from "./shader.ts";
// Relative even though this one is type-only and would survive the alias: this
// module is reachable from node --test, and a type-only import that works today
// breaks the day someone needs a value from the same file.
import type { Ellipse, GazePlate, Radii } from "./plate.ts";

/**
 * The gaze rig: a canvas, a plate record and a pointer, drawn.
 *
 * Vendored 2026-08-06 from the landing portrait of memormaneo.com, which ran one
 * sitter as a single React component. Two deliberate changes from that original,
 * both forced by putting a whole wall of them on one page:
 *
 *   1. It does not own the clock. The original ran its own rAF, its own pointer
 *      listeners and its own IntersectionObserver. Nine of those in a room is
 *      nine loops for one cursor and one candle, so the caller drives frame().
 *   2. The drawing buffer is sized from the host's LAYOUT box, never from
 *      getBoundingClientRect(). In a rotated ring the projected rect of a plate
 *      shrinks to a third of its layout width and changes on every turn; sizing
 *      the buffer from it would re-allocate the canvas continuously and render
 *      an oblique plate at a third of its resolution. The gaze still uses the
 *      projected rect, because where the plate is on screen is exactly what the
 *      gaze needs to know.
 *
 * Liftable for real: the only local import above is ./plate.ts, which declares
 * GazePlate and Ellipse and depends on nothing in any caller's plate domain. A
 * second consumer, including putting this rig back on memormaneo.com for one
 * portrait, carries those two types along and nothing plate-specific: no
 * caption, no ring angle, no provenance text.
 *
 * One accepted limitation, decided rather than overlooked: if setup throws after
 * the program is created (a shader compile or link failure, or a texture that
 * cannot be allocated) nothing deletes what was already allocated, because no
 * handle has been returned for the caller to destroy. That is left alone. The
 * shader source is static and pinned by tests, so a compile failure here is a
 * build-time bug rather than a runtime one, and it would fail identically for
 * every plate in the room, so the page is broken either way and a leaked context
 * is the least of it.
 */

/** How long the sitter keeps watching after the cursor last moved. */
const ENGAGE_HOLD_MS = 3500;
/** Then how long his attention takes to ease away to his own thoughts. */
const ENGAGE_FADE_MS = 2000;
/** Head damping. */
const K_HEAD = 0.08;
/** Eye damping. The eyes lead the head, because they do. */
const K_EYE = 0.2;
/** How far the candle's sway moves the lamp, in UV. */
const LIGHT_SWAY = 0.006;
/** Lamp radius in CSS pixels while the visitor is surveying the wall. One torch
 *  in the dark: a plate a frame-width from the cursor sits at the shader's
 *  0.035 ambient floor and is discovered by sweeping, not by being lit. A page
 *  that also lights the wall behind its frames should light it at this same
 *  radius, so that the two read as one flame rather than two. */
export const TORCH_PX = 320;
/** And once they have flown into a plate, wide enough to wash the whole face.
 *  A spot-lit portrait you have chosen to stand in front of reads as a mistake.
 *  The reach is measured from the cursor, not from the plate, so it has to span
 *  most of the viewport or a chosen plate goes dark the moment the hand wanders
 *  toward an edge. At full zoom a plate is roughly 800px tall: 1800 keeps about
 *  a third of the lamp's gain at a screen corner instead of none, and flattens
 *  the across-plate brightness spread from about 2.56x to about 1.25x. */
export const TORCH_ZOOM_PX = 1800;
/** What still() sets, in plate heights. This is the literal the static poster
 *  was measured at, kept unchanged so that captures stay comparable with the
 *  ones taken before the reach became a parameter. */
export const TORCH_STILL_REACH = 0.85;

export type FrameInput = {
  /** Seconds since the clock started. */
  t: number;
  /** Last known pointer position in client coordinates, or null if the pointer
   *  has never been seen or has left the window. */
  pointer: Vec2 | null;
  /** Milliseconds since the pointer last moved. */
  sinceMoveMs: number;
  /** The page's single flame, computed once per frame for every plate. */
  flick: Flicker;
  /** Lamp radius in CSS pixels. A page showing several plates widens it from
   *  TORCH_PX toward TORCH_ZOOM_PX for the one the visitor has chosen to stand
   *  in front of. Leave it out for a single plate with no surrounding page,
   *  which gets the resting torch. */
  torchPx?: number;
};

export type RigHandle = {
  /** @returns how lit this plate's CENTRE is, 0..1, from the same falloff the
   *  shader burns. The caller hands it to the CSS as --lit so the DOM
   *  moulding, which no shader touches, sits in the same light as the print
   *  inside it. */
  frame(input: FrameInput): number;
  /** One deterministic neutral frame, for the branches that draw a plate once
   *  and never animate it: reduced motion, no fine pointer, a static capture.
   *  Deliberately returns no lit value, because those branches never run a
   *  frame loop either, so --lit is never written and any surround styled from
   *  it stays at its CSS default of fully lit, which is the plate as a poster
   *  wants it. */
  still(): void;
  /** Re-allocate the drawing buffer from the host's layout box, optionally
   *  scaled. Derive that scale from your own zoom level and never from a
   *  measured rect, so that panning reallocates nothing. */
  resize(scale?: number): void;
  destroy(): void;
};

/** Measured image coordinates (top-left origin, y down) to the GL UV vec4 the
 *  shader wants. This is the only y flip in the codebase, deliberately. */
export function eyeUniform(e: Ellipse): [number, number, number, number] {
  return [e.cx, 1 - e.cy, e.rx, e.ry];
}

/** Rim radii to the GL vec2. There is deliberately no flip here: eyeUniform
 *  flips cy because it is a position, and a radius is not one. */
export function rimUniform(r: Radii): [number, number] {
  return [r.rx, r.ry];
}

/**
 * How lit a point at uv (0.5, 0.5) is, 0..1: the shader's own lamp falloff,
 * evaluated on the CPU for the plate's centre.
 *
 * It mirrors `pow(smoothstep(uReach, 0.0, length((uLight - uv) * vec2(uAspect,
 * 1.0))), 1.5)` and deliberately no more of the shader's light: not the candle sway
 * paint() adds to uLight, worth about 0.01 of --lit, and not the
 * `* (0.82 + spec * 0.5) * uFlick` laid over the lamp, whose spec term wants a
 * depth map the CPU has not got. Both omissions breathe with the flame, and
 * the caller skips a --lit that moved by under 0.002, so mirroring either
 * would write style on twelve elements every frame at rest. It exists because
 * the engraved moulding is a DOM background layer that no shader ever
 * samples, so without a number crossing back out of the rig a torch that
 * leaves a print at the 0.16 ambient floor leaves its gilt frame at full
 * brightness, and the wall reads as eleven empty frames.
 *
 * @param aspect w/h of the drawing buffer, the shader's uAspect.
 */
export function litAtCentre(
  lampX: number,
  lampY: number,
  reach: number,
  aspect: number,
): number {
  if (!(reach > 0)) return 0;
  const d = Math.hypot((lampX - 0.5) * aspect, lampY - 0.5);
  const t = Math.min(Math.max(1 - d / reach, 0), 1);
  return (t * t * (3 - 2 * t)) ** 1.5;
}

/**
 * Drawing-buffer size in device pixels.
 *
 * Takes the LAYOUT box, not the projected one. See the note at the top of this
 * file: `offsetWidth` holds steady at 475 while a plate's `getBoundingClientRect()`
 * width swings from 371 at the centre of the ring to 136 at 90 degrees.
 */
export function bufferSize(
  layoutW: number,
  layoutH: number,
  dpr: number,
): { w: number; h: number } {
  const s = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 2);
  return {
    w: Math.max(1, Math.round(layoutW * s)),
    h: Math.max(1, Math.round(layoutH * s)),
  };
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("[gaze] could not create shader");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s) ?? "shader compile failed";
    console.error("[gaze] shader compile failed:", info);
    throw new Error(info);
  }
  return s;
}

export function createRig(opts: {
  canvas: HTMLCanvasElement;
  /** The element whose layout box sizes the buffer and whose projected box
   *  positions the gaze. Where several plates share a page, this is that
   *  plate's own stage. */
  host: HTMLElement;
  plate: GazePlate;
  albedo: string;
  depth: string;
}): RigHandle | null {
  const { canvas, host, plate } = opts;

  // alpha: true is load-bearing: it is the whole fallback strategy, since an
  // undrawn WebGL buffer composites as transparent over the <img> beneath it,
  // including on the throw path below where a setup exception escapes before
  // canvas.style.display is ever reached. alpha: false would paint this
  // aperture solid black while loading and on every failure.
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true });
  if (!gl) {
    console.warn(`[gaze] WebGL2 unavailable, static image fallback for ${plate.slug}`);
    canvas.style.display = "none"; // CSS shows the <img> underneath
    return null;
  }

  const prog = gl.createProgram();
  if (!prog) throw new Error("[gaze] could not create program");
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) ?? "link failed";
    console.error("[gaze] program link failed:", info);
    throw new Error(info);
  }
  gl.useProgram(prog);

  // Every location that gets written more than once is looked up here, once.
  // uRest belongs in this list and not in frame(): frame() runs per plate per
  // animation frame, so a lookup there is 540 redundant GL calls a second in a
  // nine-plate room.
  const loc = (name: string) => gl.getUniformLocation(prog, name);
  const uMouse = loc("uMouse");
  const uLight = loc("uLight");
  const uAspect = loc("uAspect");
  const uFlick = loc("uFlick");
  const uReach = loc("uReach");
  const uGaze = loc("uGaze");
  const uRest = loc("uRest");

  gl.uniform1f(loc("uAmp"), plate.amp);
  gl.uniform1f(uFlick, 1.0); // the static branch keeps a steady flame
  gl.uniform4f(loc("uEyeL"), ...eyeUniform(plate.eyes.l.iris));
  gl.uniform4f(loc("uEyeR"), ...eyeUniform(plate.eyes.r.iris));
  gl.uniform2f(loc("uRimL"), ...rimUniform(plate.eyes.l.rim));
  gl.uniform2f(loc("uRimR"), ...rimUniform(plate.eyes.r.rim));
  // Static per plate, so it is set here and never in frame(). still() does not
  // reset it because still() zeroes uGaze, and the fade only applies while the
  // gaze is looking down.
  gl.uniform1f(loc("uLidFade"), plate.gaze.lidFade);
  // Same reasoning: per plate, never per frame. still() leaves them alone for
  // the same reason it leaves uLidFade alone, since a zero uGaze carries them.
  gl.uniform1f(loc("uLidFollow"), plate.gaze.lidFollow);
  gl.uniform1f(loc("uLidReach"), plate.gaze.lidReach);
  gl.uniform4f(uRest, 0, 0, 0, 0);

  const mkTex = (unit: number, name: string): WebGLTexture => {
    const tex = gl.createTexture();
    if (!tex) throw new Error("[gaze] could not create texture");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // LINEAR, not LINEAR_MIPMAP_LINEAR, and only until the image lands: a
    // texture whose min filter wants mips and has none is INCOMPLETE and
    // samples as opaque black, which would paint the aperture black over the
    // <img> fallback for as long as the decode takes. load() raises it the
    // instant generateMipmap has run.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 1x1 placeholder until the image decodes
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]));
    gl.uniform1i(loc(name), unit);
    return tex;
  };
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const albedoTex = mkTex(0, "uAlbedo");
  const depthTex = mkTex(1, "uDepth");

  const cur = { x: 0, y: 0 };
  const eyeCur = { x: 0, y: 0 };
  // Where the torch is, in this plate's uv, and how far it reaches. Held here
  // rather than recomputed in paint() because paint() also runs on texture load
  // and from still(), neither of which has a pointer.
  const lamp = { x: 0.5, y: 0.5, reach: TORCH_STILL_REACH };
  let ready = 0;
  let destroyed = false;

  const paint = (flick: Flicker | null) => {
    // Pointer y is down+, GL UV y is up+. Flip so the head turns TOWARD the
    // cursor vertically; the lamp and eyeGaze already flip, so this must too.
    gl.uniform2f(uMouse, cur.x, -cur.y);
    const sway = flick ? LIGHT_SWAY : 0;
    gl.uniform2f(
      uLight,
      lamp.x + (flick?.dx ?? 0) * sway,
      lamp.y + (flick?.dy ?? 0) * sway,
    );
    gl.uniform1f(uReach, lamp.reach);
    if (flick) gl.uniform1f(uFlick, flick.gain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Remembered, so a ResizeObserver firing on a window resize keeps whatever
  // bucket the zoom last put this plate in.
  let bufScale = 1;
  const resize = (scale?: number) => {
    if (scale !== undefined) bufScale = scale;
    // Layout box, not getBoundingClientRect. See the note at the top of the file.
    const { w, h } = bufferSize(
      host.offsetWidth * bufScale,
      host.offsetHeight * bufScale,
      window.devicePixelRatio,
    );
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    // Both dimensions scale together, so this stays 4:5 and the eye ellipses
    // do not move.
    gl.uniform1f(uAspect, w / h);
  };

  const load = (src: string, unit: number, tex: WebGLTexture) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (destroyed) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // The single most visible thing in this file. A plate is 920 texels wide
      // and a resting plate's drawing buffer is a few hundred, so every one of
      // the room's unfocused frames is a heavy MINIFICATION, and an engraving
      // is nothing but high-frequency hatching. Sampled with one bilinear tap
      // that hatching aliases into moire and the sitter reads as smeared; the
      // effect goes away as you zoom in, which is exactly the complaint that
      // "portraits look bad unless you look straight at them" describes.
      //
      // Deliberately no EXT_texture_filter_anisotropic with it. The oblique
      // angle of a plate on this wall is applied by the CSS compositor AFTER
      // the shader has drawn, so inside the shader the minification is very
      // nearly isotropic and anisotropy would cost a texture parameter to buy
      // nothing measurable.
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      ready++;
      // Both, or not at all. depth.png is a quarter of albedo.jpg and normally
      // wins the race; drawing on its arrival paints the aperture solid black
      // over an <img> fallback that is already showing the print, which reads as
      // the portrait visibly loading twice.
      if (ready >= 2) paint(null);
    };
    img.onerror = () => console.error(`[gaze] ${plate.slug}: failed to load ${src}`);
    img.src = src;
  };

  resize();
  load(opts.albedo, 0, albedoTex);
  load(opts.depth, 1, depthTex);

  return {
    resize,

    still() {
      // Genuinely neutral, not merely "not currently animating". paint() never
      // touches uRest or uGaze, and frame() leaves both wherever the damping
      // last drove them, so without this reset a still() that follows any
      // frame() would paint the leftover eased gaze plus this plate's rest
      // correction, and the flame's last gain besides. The shipped
      // philosopher's restR is -0.0025, not zero, so that is a visible
      // difference and not a theoretical one.
      //
      // The two calls are mutually exclusive in the current callers, which is
      // why this was not already broken. It is fixed anyway because a still
      // frame has to be deterministic: it is what regression screenshots are
      // compared against, and one live reduced-motion listener or a visibility
      // pause would make the sequence reachable and quietly move the
      // measurement.
      gl.uniform4f(uRest, 0, 0, 0, 0);
      gl.uniform2f(uGaze, 0, 0);
      gl.uniform1f(uFlick, 1.0);
      cur.x = 0;
      cur.y = 0;
      eyeCur.x = 0;
      eyeCur.y = 0;
      lamp.x = 0.5;
      lamp.y = 0.5;
      lamp.reach = TORCH_STILL_REACH;
      if (ready >= 2) paint(null);
    },

    frame({ t, pointer, sinceMoveMs, flick, torchPx }) {
      // Rest corrections apply only to the animated branch: the static frame is
      // the untouched artwork, which still() enforces by zeroing this again.
      gl.uniform4f(uRest, 0, 0, plate.gaze.restR.x, plate.gaze.restR.y);

      const rect = host.getBoundingClientRect(); // projected, deliberately

      // One torch, in screen space, off the SAME rect the gaze already read.
      // Raw pointer, not the eased one: a lamp that lags the hand does not read
      // as a light. With no pointer the torch stands in the middle of the room,
      // which is a candle on a table rather than every plate lighting itself.
      const lx = pointer?.x ?? window.innerWidth / 2;
      const ly = pointer?.y ?? window.innerHeight / 2;
      const rh = Math.max(rect.height, 1); // an edge-on plate can project to 0
      lamp.x = rect.width > 0 ? (lx - rect.left) / rect.width : 0.5;
      lamp.y = 1 - (ly - rect.top) / rh; // GL uv is y up
      lamp.reach = (torchPx ?? TORCH_PX) / rh;

      const target = pointer
        ? normalizePointer(pointer.x, pointer.y, rect, window.innerWidth, window.innerHeight)
        : { x: 0, y: 0 };

      // Watch the cursor wherever it is; let the gaze wander to this sitter's own
      // look-points once the pointer stops moving or leaves.
      const engage = pointer ? pointerFade(sinceMoveMs, ENGAGE_HOLD_MS, ENGAGE_FADE_MS) : 0;
      const glance = glanceTarget(t + plate.phase);
      const tx = mix(glance.x, target.x, engage);
      const ty = mix(glance.y, target.y, engage);

      cur.x = dampedStep(cur.x, tx, K_HEAD);
      cur.y = dampedStep(cur.y, ty, K_HEAD);
      eyeCur.x = dampedStep(eyeCur.x, tx, K_EYE);
      eyeCur.y = dampedStep(eyeCur.y, ty, K_EYE);

      const gz = eyeGaze(
        eyeCur.x,
        eyeCur.y,
        plate.gaze.maxX,
        plate.gaze.maxY,
        plate.gaze.restDown,
      );
      gl.uniform2f(uGaze, gz.x, gz.y);

      if (ready >= 2) paint(flick);

      // The drawing buffer's own aspect, which is exactly what resize() last
      // uploaded as uAspect, so this cannot drift from the shader.
      return litAtCentre(lamp.x, lamp.y, lamp.reach, canvas.width / canvas.height);
    },

    destroy() {
      destroyed = true;
      gl.deleteTexture(albedoTex);
      gl.deleteTexture(depthTex);
      gl.deleteProgram(prog);
      // A ring can hold more contexts than a browser will keep alive (the cap is
      // around 16), so hand this one back rather than waiting for the GC.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

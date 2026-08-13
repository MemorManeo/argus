/**
 * The gaze shader. Vendored 2026-08-06 from the landing portrait of
 * memormaneo.com, unchanged in substance: the uniforms that were per-component
 * constants there are now per-plate data here, and that is the only difference.
 *
 * Every asymmetry in the eye gains is a repair for something a real plate did
 * wrong. test/shader.test.ts pins the ones that cost the most to find.
 */

export const VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 pos = vec2(gl_VertexID==1 ? 3.0 : -1.0, gl_VertexID==2 ? 3.0 : -1.0);
  vUv = 0.5 * pos + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uAlbedo, uDepth;
uniform vec2 uMouse;   // -1..1 eased
uniform vec2 uLight;   // the cursor in THIS plate's uv; runs outside 0..1
uniform float uAmp, uAspect;
uniform float uPivot;      // depth the head rotates about; 0.5 uncalibrated
uniform float uScale;      // this map's relief, out to about +-1; 0 is OFF
uniform float uFlick;      // candle gain, 1.0 when static
uniform float uReach;      // lamp radius, in plate heights of THIS plate
uniform vec4 uEyeL, uEyeR; // iris ellipse: centre.xy (UV), radii.zw
uniform vec2 uRimL, uRimR; // radii at which the warp reaches zero
uniform float uLidFade;    // per-plate down-warp repair; 0 for a whole iris
uniform float uLidFollow;  // how much of the vertical gaze the LID carries
uniform float uLidReach;   // where the lid's motion dies, as a multiple of rim
uniform vec2 uGaze;        // pupil offset (UV); zero when static or idle
uniform vec4 uRest;        // per-eye rest gaze correction: L.xy, R.zw
in vec2 vUv;
out vec4 frag;
// How far below the mip level the hardware picks this plate is sampled.
//
// The albedo is 920 texels wide and a resting plate's drawing buffer is around
// 630, so the implicit level is about 0.86 and trilinear filtering spends most
// of its weight on the half-resolution mip. On an ENGRAVING that is not a
// subtle loss: the hatching is the whole subject, and at that level a face
// resolves into smooth tone and stops looking printed.
//
// It is safe to pull it back only because the drawing buffer is deliberately
// larger than the plate is displayed at, so the compositor's own downsample is
// already supersampling every fragment drawn here. Keep that ratio above 1 when
// you scale the buffer, or this bias has nothing paying for it. The mips are
// still there and still take over when a plate really is tiny, which is the
// aliasing this bias must not undo.
const float LOD_BIAS = -0.75;
float dep(vec2 uv){ return texture(uDepth, uv).r; }
// ONE SCALAR gain, applied to both axes, with NO exception. This is the whole
// repair. A gain that differs between x and y, or that varies across the iris,
// shears the disc as it slides: the middle band moves and the top and bottom
// stay, and the pupil stretches. Gain is exactly 1.0 inside the iris ellipse, so
// the drawn disc translates rigidly, and eases to 0 at the rim ellipse, which
// must stop inside the lid line. t runs 0 at the iris boundary to 1 at the rim
// boundary along every ray out of the centre, exactly; test/shader.test.ts
// mirrors this in TypeScript and checks it on sixteen of them.
//
// uLidFade used to multiply this gain and is the one thing that ever qualified
// the paragraph above. It is in lidFadeAt now, and it reaches only the vertical
// term: see the note on it below.
//
// uLidFollow, in eyeOffset, is not an exception either. It does make the
// vertical factor differ from the horizontal one, but only outside the iris:
// inside it both gains are 1, so both axes are 1 and the disc still translates.
vec2 eyeGain(vec2 p, vec4 eye, vec2 rim){
  vec2 a = (p - eye.xy) / eye.zw;
  vec2 b = (p - eye.xy) / rim;
  float la = length(a);
  float t = clamp((la - 1.0) / max(la - length(b), 1e-4), 0.0, 1.0);
  float g = 1.0 - smoothstep(0.0, 1.0, t);
  return vec2(g);
}
// How much of the DOWN-warp survives near the upper lid. A plate whose iris is
// clipped high under the lid has no sclera above it to reveal, so dragging the
// upper band DOWN smears lid ink into the eye as a top shadow.
//
// Which is a statement about the down-warp and about nothing else, and it used
// to multiply the scalar gain, so it throttled the SIDEWAYS warp by the same
// amount. On the philosopher that pinned the top of his pupil at 0.15 of the
// travel while its bottom ran at 1.0, and his restDown holds uGaze.y negative
// over all but the top eighth of the screen, so it was pinned essentially
// always. Moving sideways reveals nothing from above and drags no lash line
// down; only the down-warp ever needed this.
//
// Gating it on uGaze.y while it multiplies gaze.y also makes it continuous. As a
// factor on gaze.x it stepped by up to 6.7x across the gaze.y == 0 crossing,
// where nothing about the plate has changed and the eye visibly popped.
float lidFadeAt(vec2 p, vec4 eye){
  if (uGaze.y >= 0.0) return 1.0;
  return 1.0 - uLidFade * smoothstep(0.15, 0.75, (p.y - eye.y) / eye.w);
}
// How much the LID moves: eyeGain's construction exactly, one ellipse pair
// further out. 1 everywhere inside the rim, easing to 0 at rim * reach, so the
// whole socket carries the lid's motion as rigidly as the iris carries the
// pupil's, and the brow and the cheek beyond the reach do not move at all.
float lidGain(vec2 p, vec4 eye, vec2 rim, float reach){
  vec2 a = (p - eye.xy) / rim;
  vec2 b = (p - eye.xy) / (rim * reach);
  float la = length(a);
  float t = clamp((la - 1.0) / max(la - length(b), 1e-4), 0.0, 1.0);
  return 1.0 - smoothstep(0.0, 1.0, t);
}
// One eye's contribution to the sampling offset.
//
// Vertically the lid travels with the iris, because that is what an eye looking
// down actually does, and because it is what lifts the geometric ceiling. The
// iris-to-rim band is only a few pixels tall on a wide-open eye, and a gain that
// falls the whole way from 1 to 0 across it folds the sampling map once the
// travel passes roughly two thirds of its width. With the lid following, that
// band only has to absorb the RELATIVE motion between iris and lid, so its
// slope drops by (1 - uLidFollow) and the fold moves out by the reciprocal; what
// is left is shed across the far wider rim-to-reach band. Horizontally the gaze
// rides the iris gain alone: a real eye barely moves its lids sideways, and
// there is sclera enough that the horizontal travel never needed the help.
//
// At uLidFollow 0 the vertical term is mix(g.y, l, 0.0), which is g.y to the
// last bit, so a plate that does not opt in warps exactly as it did before any
// of this existed. test/shader.test.ts holds that identity on a dense grid; it
// is the whole reason the frozen plate needed no regression hunt.
vec2 eyeOffset(vec2 p, vec2 gaze, vec4 eye, vec2 rim){
  vec2 g = eyeGain(p, eye, rim);
  float l = lidGain(p, eye, rim, uLidReach);
  return vec2(gaze.x * g.x, gaze.y * mix(g.y * lidFadeAt(p, eye), l, uLidFollow));
}
void main(){
  vec2 uv = vUv;
  float d = dep(uv);
  // The head turns about uPivot, and about 0.5 only when nobody has said
  // otherwise.
  //
  // A monocular depth estimator spends most of its 0..1 on the step between
  // sitter and backdrop. Measured over five shipped plates: the step is 0.67 to
  // 0.77 while the entire relief of the face is 0.165 to 0.231, the sitter sits
  // near 0.77, the backdrop near 0.03, and 5 to 12 percent of pixels lie near
  // 0.5 (which is the feathered silhouette ring, not the face). Pivoting at 0.5
  // therefore puts the whole head on one side of the pivot: it TRANSLATES
  // wholesale while the backdrop counter-slides, and the few interior plateaus
  // (nose, moustache, hair, shoulders) each translate rigidly at slightly
  // different rates. On a 920px plate at amp 0.045 that is about 4px of
  // interior differential against 31px of head-against-backdrop. Cardboard.
  //
  // uScale then takes the sitter's own relief back out to roughly +-1, which is
  // what turns a gentle dome into one you can see. tanh is what keeps the
  // backdrop, which lands at -7 or worse once scaled, from tearing the
  // silhouette open. Deliberately not clamp: a clamp puts a gradient
  // discontinuity exactly at the silhouette, and creasing at the silhouette is
  // the failure tools/plate/warp.py exists to catch. tanh is C-infinity,
  // near-linear across the face, and flat against the backdrop.
  //
  // uScale 0 is not a neutral default, it is an exact one: the term is
  // (d - 0.5) again, bit for bit what shipped before this uniform existed, so
  // an uncalibrated plate is owed no regression hunt. tanh(d - 0.5) is NOT
  // d - 0.5, which is why this is gated rather than unconditional.
  float turn = uScale > 0.0 ? tanh((d - uPivot) * uScale) : d - 0.5;
  vec2 suv = uv - turn * uAmp * uMouse;   // parallax head-turn
  // pupils slide within the eye whites; gains at suv keep the region
  // glued to the eye pixels while the head turns (the rim regions, out to
  // uLidReach, are disjoint, so summing the two eyes' contributions is exact)
  vec2 off = eyeOffset(suv, uGaze + uRest.xy, uEyeL, uRimL)
           + eyeOffset(suv, uGaze + uRest.zw, uEyeR, uRimR);
  vec3 col = texture(uAlbedo, suv - off, LOD_BIAS).rgb;
  float e = 1.0/512.0;                          // pseudo-normal from depth
  // From the RAW depth, deliberately, and not from the remapped turn above. A
  // calibrated uScale is around 10, so feeding the remap in here would multiply
  // every gradient in the field by that and rewrite the specular on every
  // plate at once. How a properly scaled relief should catch the lamp is a real
  // question and a separate one; answering it silently inside a parallax fix
  // would be the bad outcome.
  float dx = dep(uv+vec2(e,0.)) - dep(uv-vec2(e,0.));
  float dy = dep(uv+vec2(0.,e)) - dep(uv-vec2(0.,e));
  vec3 n = normalize(vec3(-dx, -dy, 0.25));
  // One torch, in screen space. uLight is the true cursor position in this
  // plate's uv, so it runs far outside 0..1 for a plate the cursor is nowhere
  // near, and this falloff darkens it to the ambient floor for free. lv is in
  // units of the plate's HEIGHT (uAspect is w/h, so it converts the x
  // difference), which is what lets the caller set uReach in screen pixels.
  vec2 lv = (uLight - uv) * vec2(uAspect, 1.0);
  // The 1.5 is what makes this a carried flame rather than a floodlight: a
  // plain smoothstep spends most of its range at the bright end, so the pool
  // read as a wide even wash with a soft rim. Raising it to a power pulls the
  // brightness in toward the cursor and lengthens the tail, so a plate is
  // revealed as the light arrives at it rather than being merely less dim.
  float lamp = pow(smoothstep(uReach, 0.0, length(lv)), 1.5);
  float spec = pow(max(dot(n, normalize(vec3(lv, 0.6))), 0.0), 3.0);
  // candlelight: a near-white flame with a whisper of warmth. The print
  // keeps its etching whites; the tint lives in the light around it.
  float lampI = lamp*(0.82 + spec*0.5) * uFlick;
  vec3 lit = vec3(0.035) + vec3(1.03, 1.0, 0.94) * lampI;
  frag = vec4(col * min(lit, vec3(1.28)), 1.0);
}`;

/** Every uniform the rig is responsible for setting. Kept beside the source so
 *  a uniform can never be added to one and forgotten in the other. */
export const UNIFORMS = [
  "uAlbedo",
  "uDepth",
  "uMouse",
  "uLight",
  "uAmp",
  "uPivot",
  "uScale",
  "uAspect",
  "uFlick",
  "uReach",
  "uEyeL",
  "uEyeR",
  "uRimL",
  "uRimR",
  "uLidFade",
  "uLidFollow",
  "uLidReach",
  "uGaze",
  "uRest",
] as const satisfies readonly string[];

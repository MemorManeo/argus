import { test } from "node:test";
import assert from "node:assert/strict";

import { eyeUniform, rimUniform, bufferSize, litAtCentre } from "../src/rig.ts";
import { PHILOSOPHER } from "../example/plate.ts";

test("eyeUniform flips y from image coords to GL UV, once", () => {
  const e = { cx: 0.48, cy: 0.378, rx: 0.038, ry: 0.01 };
  assert.deepEqual(eyeUniform(e), [0.48, 1 - 0.378, 0.038, 0.01]);
});

test("eyeUniform leaves the radii alone", () => {
  // Radii are lengths, not positions. Flipping one would silently reshape the
  // warp region and the eye would drag its own lid.
  const e = { cx: 0.5, cy: 0.25, rx: 0.04, ry: 0.009 };
  const [, , rx, ry] = eyeUniform(e);
  assert.equal(rx, 0.04);
  assert.equal(ry, 0.009);
});

test("eyeUniform round-trips the philosopher's measured eyes", () => {
  const p = PHILOSOPHER;
  assert.deepEqual(eyeUniform(p.eyes.r.iris), [0.687, 1 - 0.3845, 0.0231, 0.00572]);
});

test("rimUniform leaves the radii alone", () => {
  // Radii are lengths, not positions. eyeUniform flips cy because it is a
  // position; there is nothing here to flip, and this test exists so that stays
  // true when someone adds a second flip to be safe.
  assert.deepEqual(rimUniform({ rx: 0.042, ry: 0.0175 }), [0.042, 0.0175]);
});

test("bufferSize caps device pixel ratio at 2", () => {
  assert.deepEqual(bufferSize(475, 594, 3), { w: 950, h: 1188 });
  assert.deepEqual(bufferSize(475, 594, 2), { w: 950, h: 1188 });
  assert.deepEqual(bufferSize(475, 594, 1), { w: 475, h: 594 });
});

test("bufferSize survives a nonsense dpr", () => {
  assert.deepEqual(bufferSize(100, 100, 0), { w: 100, h: 100 });
  assert.deepEqual(bufferSize(100, 100, Number.NaN), { w: 100, h: 100 });
});

test("bufferSize never returns a zero dimension", () => {
  // A zero-width drawing buffer is a GL error, and a plate mid-layout can
  // genuinely measure 0.
  const b = bufferSize(0, 0, 2);
  assert.ok(b.w >= 1 && b.h >= 1);
});

test("bufferSize rounds rather than truncating", () => {
  assert.deepEqual(bufferSize(160.6, 200.4, 1), { w: 161, h: 200 });
});

// --- The lamp falloff, mirrored on the CPU ----------------------------------
//
// litAtCentre is two lines of the fragment shader written out in TypeScript and
// evaluated at uv (0.5, 0.5), so the room can dim a plate's DOM moulding to
// match the print inside it. test/shader.test.ts pins that the GLSL still says
// what this mirrors; these check that what it says is right. Properties, not the
// expansion: the expansion is the part a reader is most likely to rewrite, and a
// mirror that has silently drifted certifies the wrong light.

/** Every plate's drawing buffer is 4:5, so this is the shipped uAspect. The
 *  others are here because a mirror that only works at one aspect is a mirror
 *  that has an aspect bug nobody can see. */
const PLATE_ASPECT = 4 / 5;
const ASPECTS = [PLATE_ASPECT, 1, 1.6] as const;
const LAMP_RAYS = 16;

test("a lamp standing on a plate's centre lights that centre fully", () => {
  for (const reach of [0.25, 0.5, 0.85, 2]) {
    for (const aspect of ASPECTS) {
      assert.equal(litAtCentre(0.5, 0.5, reach, aspect), 1, `reach ${reach}, aspect ${aspect}`);
    }
  }
});

test("the light is gone at the reach and stays gone beyond it", () => {
  // The shader calls smoothstep with edge0 = uReach and edge1 = 0, which is
  // backwards from the usual spelling and is what makes the gain FALL with
  // distance. Written the other way round the torch would light the far wall
  // and leave the plate under the cursor dark, which is why both ends are
  // pinned rather than only the centre.
  for (const reach of [0.25, 0.5, 0.85, 2]) {
    for (const aspect of ASPECTS) {
      const at = `reach ${reach}, aspect ${aspect}`;
      assert.equal(litAtCentre(0.5, 0.5 + reach, reach, aspect), 0, `at the reach, below: ${at}`);
      assert.equal(litAtCentre(0.5, 0.5 - reach, reach, aspect), 0, `at the reach, above: ${at}`);
      assert.equal(
        litAtCentre(0.5 + reach / aspect, 0.5, reach, aspect),
        0,
        `at the reach, across: ${at}`,
      );
      assert.equal(litAtCentre(0.5, 0.5 + 4 * reach, reach, aspect), 0, `far below: ${at}`);
      // uLight is the cursor in THIS plate's uv, so it runs far outside 0..1 for
      // a plate the cursor is nowhere near. That is the resting case for eleven
      // of the twelve.
      assert.equal(litAtCentre(-7.5, 12.25, reach, aspect), 0, `another plate entirely: ${at}`);
    }
  }
});

test("the light falls monotonically from the centre out to the reach", () => {
  const reach = 0.6;
  for (const aspect of ASPECTS) {
    for (let i = 0; i < LAMP_RAYS; i++) {
      const th = (2 * Math.PI * i) / LAMP_RAYS;
      let prev = Number.POSITIVE_INFINITY;
      for (let s = 0; s <= 20; s++) {
        const f = s / 20;
        // Divided by the aspect on x so every sample sits at f * reach from the
        // centre in the shader's own units, whatever the buffer's shape.
        const v = litAtCentre(
          0.5 + (f * reach * Math.cos(th)) / aspect,
          0.5 + f * reach * Math.sin(th),
          reach,
          aspect,
        );
        assert.ok(v < prev, `light rose to ${v} at f=${f} th=${th} aspect=${aspect}`);
        prev = v;
      }
    }
  }
});

test("the falloff is the shader's smoothstep raised to 1.5, not a linear ramp", () => {
  // Monotone from 1 to 0 is not enough to say a mirror has not drifted: a linear
  // ramp satisfies every property above and would be visibly harder at the edge
  // of the torch. Three points at t = 0.75, 0.5 and 0.25 through the shader's
  // pow(t * t * (3 - 2t), 1.5).
  //
  // The exponent is the room's darkness, not a detail. Dropping it leaves every
  // one of these values higher than it should be, which is a torch that carries
  // half again as far as the print it is lighting, so the second assertion in
  // each pair is what stops it from being quietly lost.
  for (const [y, want, plain] of [
    [0.625, 0.7750338639274900, 0.84375],
    [0.75, 0.3535533905932737, 0.5],
    [0.875, 0.0617632355501637, 0.15625],
  ] as const) {
    const v = litAtCentre(0.5, y, 0.5, PLATE_ASPECT);
    assert.ok(Math.abs(v - want) < 1e-12, `at y=${y}: ${v}, want ${want}`);
    assert.ok(v < plain - 1e-3, `at y=${y} the mirror has lost its exponent`);
  }
});

test("the aspect stretches x and leaves y alone", () => {
  // uAspect is w/h, so it converts an x difference into units of the plate's
  // HEIGHT, which is what lets the room set one reach in screen pixels for a
  // plate that is not square. A lamp d/aspect across is therefore exactly as far
  // as one d down.
  const reach = 0.6;
  for (const aspect of ASPECTS) {
    for (const d of [0.05, 0.2, 0.35, 0.55]) {
      const across = litAtCentre(0.5 + d / aspect, 0.5, reach, aspect);
      const down = litAtCentre(0.5, 0.5 + d, reach, aspect);
      assert.ok(Math.abs(across - down) < 1e-12, `${d} at aspect ${aspect}: ${across} vs ${down}`);
      if (aspect === 1) continue;
      // And the aspect is doing the work, rather than the two agreeing because
      // it is applied to both axes or to neither. Only says anything off square.
      const undivided = litAtCentre(0.5 + d, 0.5, reach, aspect);
      assert.ok(
        Math.abs(undivided - down) > 1e-6,
        `aspect ${aspect} changed nothing at ${d}: ${undivided} vs ${down}`,
      );
    }
  }
});

test("a reach of zero or less returns darkness rather than dividing", () => {
  // The room derives the reach from a projected rect, which an edge-on plate or
  // a plate mid-layout can report as nothing. A NaN here would reach --lit as
  // the string "NaN" and the moulding would keep whatever it last had.
  for (const reach of [0, -1, -0.5, Number.NaN]) {
    assert.equal(litAtCentre(0.5, 0.5, reach, PLATE_ASPECT), 0, `reach ${reach}`);
  }
});

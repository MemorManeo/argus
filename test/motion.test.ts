import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizePointer,
  dampedStep,
  idleSignal,
  pointerFade,
  mix,
  eyeGaze,
  candleFlicker,
  glanceTarget,
  GLANCE_WINDOW_S,
} from "../src/motion.ts";

const rect = { left: 100, top: 100, width: 200, height: 200 }; // centre (200,200)

test("normalizePointer is 0,0 at the element centre", () => {
  const p = normalizePointer(200, 200, rect, 1000, 800);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test("normalizePointer clamps to [-1,1] far outside the viewport", () => {
  const p = normalizePointer(100000, 100000, rect, 1000, 800);
  assert.equal(p.x, 1);
  assert.equal(p.y, 1);
  const n = normalizePointer(-100000, -100000, rect, 1000, 800);
  assert.equal(n.x, -1);
  assert.equal(n.y, -1);
});

test("normalizePointer scales by half-viewport", () => {
  // 250px right of centre, half-vw = 500, so 250/500 = 0.5
  const p = normalizePointer(450, 200, rect, 1000, 800);
  assert.ok(Math.abs(p.x - 0.5) < 1e-9, `x=${p.x}`);
});

test("dampedStep moves a fraction toward target and rests at target", () => {
  assert.ok(Math.abs(dampedStep(0, 1, 0.1) - 0.1) < 1e-9);
  assert.equal(dampedStep(0.5, 0.5, 0.1), 0.5);
});

test("idleSignal is deterministic and bounded", () => {
  assert.deepEqual(idleSignal(0), idleSignal(0));
  for (const t of [0, 1.3, 7.7, 42]) {
    const s = idleSignal(t);
    assert.ok(Math.abs(s.x) <= 0.5 + 1e-9, `x=${s.x}`);
    assert.ok(Math.abs(s.y) <= 0.5 + 1e-9, `y=${s.y}`);
  }
  assert.notDeepEqual(idleSignal(0), idleSignal(3));
});

test("pointerFade holds at 1, ramps to 0, clamps", () => {
  assert.equal(pointerFade(0, 1500, 1000), 1);
  assert.equal(pointerFade(1500, 1500, 1000), 1);
  assert.equal(pointerFade(2000, 1500, 1000), 0.5);
  assert.equal(pointerFade(2500, 1500, 1000), 0);
  assert.equal(pointerFade(9999, 1500, 1000), 0);
});

test("mix interpolates", () => {
  assert.equal(mix(0, 10, 0), 0);
  assert.equal(mix(0, 10, 1), 10);
  assert.equal(mix(0, 10, 0.25), 2.5);
});

test("eyeGaze is zero at center", () => {
  const g = eyeGaze(0, 0, 0.012, 0.006);
  assert.equal(g.x, 0);
  assert.equal(Object.is(g.y, 0) || Object.is(g.y, -0), true);
});

test("eyeGaze reaches the max at the extremes and clamps beyond", () => {
  assert.deepEqual(eyeGaze(1, 0, 0.012, 0.006), { x: 0.012, y: -0 });
  assert.deepEqual(eyeGaze(5, -5, 0.012, 0.006), { x: 0.012, y: 0.006 });
  assert.deepEqual(eyeGaze(-5, 5, 0.012, 0.006), { x: -0.012, y: -0.006 });
});

test("eyeGaze flips y (pointer down means gaze offset down-screen, negative GL y)", () => {
  assert.equal(eyeGaze(0, 1, 0.012, 0.006).y, -0.006);
});

test("eyeGaze is proportional between center and extreme", () => {
  const g = eyeGaze(0.5, -0.5, 0.012, 0.006);
  assert.ok(Math.abs(g.x - 0.006) < 1e-12, `x=${g.x}`);
  assert.ok(Math.abs(g.y - 0.003) < 1e-12, `y=${g.y}`);
});

test("eyeGaze restDownY shifts the whole range down (GL y negative)", () => {
  const rest = eyeGaze(0, 0, 0.012, 0.006, 0.0035);
  assert.ok(Math.abs(rest.y - -0.0035) < 1e-12, `rest y=${rest.y}`);
  const up = eyeGaze(0, -1, 0.012, 0.006, 0.0035);
  assert.ok(Math.abs(up.y - 0.0025) < 1e-12, `up y=${up.y}`);
  const down = eyeGaze(0, 1, 0.012, 0.006, 0.0035);
  assert.ok(Math.abs(down.y - -0.0095) < 1e-12, `down y=${down.y}`);
  assert.equal(rest.x, 0);
});

test("eyeGaze restDownY defaults to 0", () => {
  assert.deepEqual(eyeGaze(1, 0, 0.012, 0.006), { x: 0.012, y: -0 });
});

test("candleFlicker is deterministic, bounded, and actually flickers", () => {
  assert.deepEqual(candleFlicker(1.5), candleFlicker(1.5));
  const gains: number[] = [];
  for (let t = 0; t < 20; t += 0.05) {
    const f = candleFlicker(t);
    assert.ok(f.gain >= 0.78 && f.gain <= 1.08, `gain ${f.gain} out of candle range at t=${t}`);
    assert.ok(Math.abs(f.dx) <= 1 && Math.abs(f.dy) <= 1, `sway out of [-1,1] at t=${t}`);
    gains.push(f.gain);
  }
  const spread = Math.max(...gains) - Math.min(...gains);
  assert.ok(spread > 0.1, `gain barely moves (spread ${spread}), no flicker`);
});

// Engagement is time since the pointer last moved, not distance. The rig uses
// hold 3500 / fade 2000.
test("engagement: he watches the cursor for a good while after it last moved", () => {
  assert.equal(pointerFade(0, 3500, 2000), 1);
  assert.equal(pointerFade(3400, 3500, 2000), 1, "still watching, wherever on the page it is");
  assert.equal(pointerFade(3500, 3500, 2000), 1, "the hold ends exactly here");
});

test("engagement: then his attention eases away rather than snapping", () => {
  const mid = pointerFade(4500, 3500, 2000);
  assert.ok(mid > 0 && mid < 1, `mid=${mid}`);
  let prev = 1.0001;
  for (const ms of [3600, 4000, 4500, 5000, 5400]) {
    const e = pointerFade(ms, 3500, 2000);
    assert.ok(e >= 0 && e <= 1, `engagement ${e} out of [0,1] at ${ms}ms`);
    assert.ok(e < prev, `not decreasing at ${ms}ms: ${e} !< ${prev}`);
    prev = e;
  }
});

test("engagement: a long-still pointer leaves him entirely to himself", () => {
  assert.equal(pointerFade(5500, 3500, 2000), 0);
  assert.equal(pointerFade(60000, 3500, 2000), 0);
});

test("glanceTarget is deterministic", () => {
  for (const t of [0, 2.3, 17.7, 123.4]) {
    assert.deepEqual(glanceTarget(t), glanceTarget(t));
  }
});

test("glanceTarget stays inside the contemplative region", () => {
  for (let t = 0; t < 3000; t += 0.37) {
    const g = glanceTarget(t);
    assert.ok(Math.abs(g.x) <= 0.9 + 1e-9, `x=${g.x} out of region at t=${t}`);
    assert.ok(g.y >= -0.7 - 1e-9 && g.y <= 0.5 + 1e-9, `y=${g.y} out of region at t=${t}`);
  }
});

test("glanceTarget is continuous, the head never teleports", () => {
  const dt = 1 / 60;
  let maxDelta = 0;
  for (let t = 0; t < 600; t += dt) {
    const a = glanceTarget(t);
    const b = glanceTarget(t + dt);
    maxDelta = Math.max(maxDelta, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  assert.ok(maxDelta < 0.05, `per-frame jump ${maxDelta} too large, gaze teleports`);
});

test("glanceTarget glances often enough (a saccade every few seconds)", () => {
  const dt = 1 / 60;
  let episodes = 0;
  let active = false;
  let prev = glanceTarget(0);
  for (let t = dt; t <= 60; t += dt) {
    const cur = glanceTarget(t);
    const speed = Math.max(Math.abs(cur.x - prev.x), Math.abs(cur.y - prev.y));
    if (speed > 0.004) {
      if (!active) episodes++;
      active = true;
    } else {
      active = false;
    }
    prev = cur;
  }
  assert.ok(episodes >= 10, `only ${episodes} saccades in 60s, not frequent enough`);
});

test("glanceTarget actually looks around (deliberate variety, not a dead stare)", () => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let t = 0; t < 300; t += 0.25) {
    const g = glanceTarget(t);
    xs.push(g.x);
    ys.push(g.y);
  }
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1.0, "horizontal gaze range too small");
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.4, "vertical gaze range too small");
});

test("GLANCE_WINDOW_S is exported so plate phases can be chosen against it", () => {
  assert.equal(GLANCE_WINDOW_S, 5);
});

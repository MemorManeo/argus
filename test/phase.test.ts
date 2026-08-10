import { test } from "node:test";
import assert from "node:assert/strict";

import { phaseFor, PHASE_STEP } from "../src/phase.ts";
import { glanceTarget, GLANCE_WINDOW_S } from "../src/motion.ts";

/** Where plate `i` sits inside the glance window, in seconds, 0 to 5. */
const slot = (i: number): number => phaseFor(i) % GLANCE_WINDOW_S;

/** Distance between two slots the short way round the window. The window wraps,
 *  so 0.1 and 4.9 are 0.2s apart, not 4.8s. */
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, GLANCE_WINDOW_S - d);
};

/** The closest any two of the first `n` plates come to sharing a clock. */
const tightest = (n: number): number => {
  let worst = GLANCE_WINDOW_S;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) worst = Math.min(worst, apart(slot(i), slot(j)));
  }
  return worst;
};

test("phaseFor(0) is zero, so plate zero is the clock itself", () => {
  assert.equal(phaseFor(0), 0);
});

test("no plate after the first lands on a window boundary", () => {
  // A whole number of windows aliases straight back into alignment: same window
  // index, same hash, same look-point as plate zero, and the offset buys nothing.
  for (let i = 1; i < 9; i++) {
    assert.ok(apart(slot(i), 0) > 0.25, `phaseFor(${i}) = ${phaseFor(i)} sits ${slot(i)}s into the window, too near plate zero's alignment`);
  }
});

test("no two plates ever share a glance window", () => {
  // This is the property that does the real work. glanceTarget draws its
  // look-points from floor(t / GLANCE_WINDOW_S), so two plates less than a
  // window apart interpolate between the SAME pair of points and land on the
  // identical one once both saccades finish. Measured, an offset of 0.5s
  // coincides on 817 of 1200 samples; a full window apart coincides on 8.
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      const gap = Math.abs(phaseFor(i) - phaseFor(j));
      assert.ok(
        gap > GLANCE_WINDOW_S,
        `plates ${i} and ${j} are only ${gap}s apart, inside one ${GLANCE_WINDOW_S}s window`,
      );
    }
  }
});

test("nine plates stay separated", () => {
  // Measured minimum for the golden step at nine plates is 0.279s.
  assert.ok(tightest(9) > 0.25, `tightest pair is ${tightest(9)}s apart`);
});

test("the separation holds at every ring size, not just nine", () => {
  // This is the property that lets the room grow by adding manifest entries and
  // nothing else. A rounder step passes at 3 and collapses at 4.
  for (const n of [2, 3, 4, 5, 9, 12]) {
    assert.ok(tightest(n) > 0.25, `ring of ${n} has a pair only ${tightest(n)}s apart`);
  }
});

test("nine plates leave no dead stretch of the window", () => {
  // Spread is not the same as separation: nine plates could be evenly split into
  // two tight clumps and still pass the pairwise test.
  const slots = Array.from({ length: 9 }, (_, i) => slot(i)).sort((a, b) => a - b);
  let largest = GLANCE_WINDOW_S - (slots[slots.length - 1] ?? 0) + (slots[0] ?? 0);
  for (let i = 1; i < slots.length; i++) {
    largest = Math.max(largest, (slots[i] ?? 0) - (slots[i - 1] ?? 0));
  }
  assert.ok(largest < 1.0, `a ${largest}s stretch of the window has no plate in it`);
});

test("no pair of plates in a nine-plate ring shares a look-point", () => {
  // The whole point of section 7: the visitor stops moving and every face drifts
  // away independently, each on its own errand. Checks every pair, not just the
  // first two: the measured worst pair is 8 of 1200 samples.
  for (let i = 0; i < 9; i++) {
    for (let j = i + 1; j < 9; j++) {
      let coincidences = 0;
      for (let t = 0; t < 300; t += 0.25) {
        const a = glanceTarget(t + phaseFor(i));
        const b = glanceTarget(t + phaseFor(j));
        if (Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02) coincidences++;
      }
      assert.ok(
        coincidences < 30,
        `plates ${i} and ${j} coincided ${coincidences} times in 1200 samples`,
      );
    }
  }
});

test("three phased plates never saccade together", () => {
  // A saccade is a fast frame-to-frame move. If all three spike in the same
  // frame the room reads as a chorus line.
  const dt = 1 / 60;
  const speed = (i: number, t: number) => {
    const a = glanceTarget(t + phaseFor(i));
    const b = glanceTarget(t + dt + phaseFor(i));
    return Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  };
  let together = 0;
  for (let t = 0; t < 120; t += dt) {
    const moving = [0, 1, 2].filter((i) => speed(i, t) > 0.004).length;
    if (moving === 3) together++;
  }
  assert.equal(together, 0, `all three saccaded in the same frame ${together} times`);
});

test("PHASE_STEP clears a whole window and is not a whole number of them", () => {
  assert.ok(PHASE_STEP > GLANCE_WINDOW_S, "a step inside one window shares look-points");
  assert.ok(Math.abs(PHASE_STEP - GLANCE_WINDOW_S * 1.618033988749895) < 1e-12);
  assert.notEqual(PHASE_STEP % GLANCE_WINDOW_S, 0);
});

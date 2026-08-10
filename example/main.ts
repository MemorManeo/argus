import { createRig, createGazeClock } from "../src/index.ts";
import { PHILOSOPHER } from "./plate.ts";

const host = document.querySelector<HTMLElement>("#plate")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;

const rig = createRig({
  canvas,
  host,
  plate: PHILOSOPHER,
  albedo: "./albedo.jpg",
  depth: "./depth.png",
});

// Null means no WebGL2. The <img> under the canvas is already showing the
// print, and createRig has hidden the canvas, so there is nothing else to do.
if (rig) {
  new ResizeObserver(() => rig.resize()).observe(host);
  createGazeClock().subscribe((f) => {
    const lit = rig.frame({
      t: f.t,
      pointer: f.pointer,
      sinceMoveMs: f.sinceMoveMs,
      flick: f.flick,
    });
    host.style.setProperty("--lit", String(lit));
  });
}

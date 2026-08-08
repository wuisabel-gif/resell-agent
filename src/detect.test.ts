// Check detection parsing + crop math (pure, no model or image needed).
// Run: npm run build && node dist/detect.test.js
import assert from "node:assert";
import { parseDetections, boxToRect } from "./detect.js";

// Parses a plain JSON array, clamps to [0,1], keeps a labelled box.
const d = parseDetections(`[{"label":"dress","box":[0.3,0.4,0.4,0.5]},{"label":"bag","box":[0.05,0.6,0.2,0.2]}]`);
assert.equal(d.length, 2);
assert.equal(d[0].label, "dress");
assert.deepEqual(d[1].box, [0.05, 0.6, 0.2, 0.2]);

// Tolerates prose/fences around the array.
assert.equal(parseDetections('here:\n```json\n[{"label":"belt","box":[0,0,1,1]}]\n```').length, 1);

// Drops malformed entries; clamps out-of-range; trims overflow so x+w<=1.
const c = parseDetections(`[{"label":"x","box":[0.9,0,0.5,0.5]},{"box":[1,2]},{"label":"y","box":["a",0,1,1]}]`);
assert.equal(c.length, 1);
assert.ok(c[0].box[0] + c[0].box[2] <= 1.0000001);

// Bad input never throws.
assert.deepEqual(parseDetections("not json"), []);

// boxToRect: normalised -> integer pixels, padded and clamped in-bounds.
const r = boxToRect([0.25, 0.1, 0.5, 0.4], 1000, 2000, 0.04);
assert.equal(r.left, Math.round(0.21 * 1000));
assert.ok(r.left + r.width <= 1000 && r.top + r.height <= 2000);

// A full-frame box stays inside the image.
const full = boxToRect([0, 0, 1, 1], 800, 600, 0.04);
assert.deepEqual(full, { left: 0, top: 0, width: 800, height: 600 });

console.log("detect.test ok");

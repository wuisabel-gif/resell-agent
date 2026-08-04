// Check the pure index math (cosine + search ranking) and labelling — no model.
// Run: npm run build && node dist/nnindex.test.js
import assert from "node:assert";
import { cosine, search, labelFor, type NNIndex } from "./nnindex.js";

// Cosine: identical direction = 1, orthogonal = 0, and it's scale-invariant.
assert.ok(Math.abs(cosine([1, 0], [2, 0]) - 1) < 1e-9);
assert.ok(Math.abs(cosine([1, 0], [0, 5])) < 1e-9);

const index: NNIndex = {
  model: "test",
  entries: [
    { label: "Coach", file: "coach/a.jpg", vec: [1, 0, 0] },
    { label: "Hermès", file: "hermes/b.jpg", vec: [0, 1, 0] },
    { label: "Coach", file: "coach/c.jpg", vec: [0.9, 0.1, 0] },
  ],
};
const hits = search(index, [1, 0, 0], 2);
assert.equal(hits[0].label, "Coach");
assert.ok(hits[0].score > hits[1].score); // sorted descending
assert.equal(hits.length, 2);

// Label from parent folder, else from the "Brand__desc" filename convention.
assert.equal(labelFor("refs", "refs/Coach/img1.jpg"), "Coach");
assert.equal(labelFor("refs", "refs/Hermes__quick.jpg"), "Hermes");

console.log("nnindex.test ok");

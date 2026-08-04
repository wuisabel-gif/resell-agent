// Check the pure ranking/threshold of the local brand matcher (no model needed).
// Run: npm run build && node dist/brandvision.test.js
import assert from "node:assert";
import { pickBrand } from "./brandvision.js";

// Picks the top-scoring label and strips the prompt wrapper.
const r = pickBrand([
  { label: "a photo of a Coach item", score: 0.62 },
  { label: "a photo of a Gucci item", score: 0.21 },
]);
assert.equal(r?.brand, "Coach");
assert.equal(r?.score, 0.62);

// Below the confidence floor -> no guess (don't force a wrong brand).
assert.equal(pickBrand([{ label: "a photo of a Prada item", score: 0.09 }]), null);

// Empty -> null.
assert.equal(pickBrand([]), null);

// Threshold is tunable.
assert.equal(pickBrand([{ label: "a photo of a UGG item", score: 0.12 }], 0.1)?.brand, "UGG");

console.log("brandvision.test ok");

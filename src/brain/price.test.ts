// Runnable check for the pricing math. Run: npm run build && node dist/brain/price.test.js
import assert from "node:assert";
import { priceFromComps } from "./price.js";
import type { Comp } from "../types.js";

const active = (p: number): Comp => ({
  title: "x",
  price: p,
  currency: "USD",
  condition: null,
  url: "",
  source: "ebay-active",
});
const sold = (p: number): Comp => ({ ...active(p), source: "ebay-sold" });

// No comps -> zeros with a manual-listing basis.
assert.equal(priceFromComps([]).suggested, 0);
assert.equal(priceFromComps([]).sampleSize, 0);

// Sold comps (>=3) win and are used at median, undiscounted.
const s = priceFromComps([sold(20), sold(30), sold(40)]);
assert.equal(s.suggested, 30);
assert.match(s.basis, /sold comps/);

// Fewer than 3 sold -> fall back to active asks, discounted 15%.
const a = priceFromComps([active(100), active(100), active(100), sold(999)]);
assert.equal(a.suggested, 85);
assert.match(a.basis, /active asks/);

console.log("price.test ok");

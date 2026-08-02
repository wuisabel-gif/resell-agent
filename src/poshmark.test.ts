// Check the Poshmark JSON parse + cross-platform comparison without any network.
// Run: npm run build && node dist/poshmark.test.js
import assert from "node:assert";
import { parsePoshmark } from "./poshmark.js";
import { compareByPlatform } from "./brain/price.js";
import type { Comp } from "./types.js";

// Handles the { price_amount: { val, currency_code } } shape...
const a = parsePoshmark({
  data: [
    { id: "abc", title: "Patagonia Fleece", price_amount: { val: "45", currency_code: "USD" }, condition: "not_nwt" },
    { id: "def", title: "Junk", price_amount: { val: "0" } }, // dropped: price 0
    { id: "ghi", title: "Flat price shape", price: 60 }, // ...and the flat shape
  ],
});
assert.equal(a.length, 2);
assert.equal(a[0].price, 45);
assert.equal(a[0].source, "poshmark-active");
assert.equal(a[0].url, "https://poshmark.com/listing/abc");
assert.equal(a[1].price, 60);

// Empty / malformed input never throws.
assert.deepEqual(parsePoshmark(null), []);
assert.deepEqual(parsePoshmark({}), []);

// Comparison groups by source with trimmed stats.
const comps: Comp[] = [
  { title: "", price: 60, currency: "USD", condition: null, url: "", source: "ebay-sold" },
  { title: "", price: 70, currency: "USD", condition: null, url: "", source: "ebay-sold" },
  { title: "", price: 80, currency: "USD", condition: null, url: "", source: "ebay-sold" },
  { title: "", price: 45, currency: "USD", condition: null, url: "", source: "poshmark-active" },
];
const stats = compareByPlatform(comps);
assert.equal(stats.length, 2);
const ebay = stats.find((s) => s.source === "ebay-sold")!;
assert.equal(ebay.n, 3);
assert.equal(ebay.median, 70);

console.log("poshmark.test ok");

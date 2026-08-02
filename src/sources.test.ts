// Parse checks for the scrape sources — fixtures only, no network.
// Run: npm run build && node dist/sources.test.js
import assert from "node:assert";
import { parseThredup } from "./thredup.js";
import { parseRealReal } from "./therealreal.js";
import { parseMercari } from "./mercari.js";

// ThredUp — items[] with dollar prices; 0/negatives dropped.
const t = parseThredup({ items: [
  { title: "Levi's 501", price: 24.5, url: "https://www.thredup.com/product/1" },
  { brand: "Gap", price: 0 },
  { id: 7, current_price: 18 },
] });
assert.equal(t.length, 2);
assert.equal(t[0].source, "thredup-active");
assert.equal(t[0].price, 24.5);
assert.equal(t[1].url, "https://www.thredup.com/product/7");

// The RealReal — products[]; handles nested final_sale_price.amount.
const r = parseRealReal({ products: [
  { name: "Gucci Belt", price: 320, url: "https://www.therealreal.com/x" },
  { name: "No price" },
  { name: "Nested", final_sale_price: { amount: 150 } },
] });
assert.equal(r.length, 2);
assert.equal(r[0].source, "therealreal-active");
assert.equal(r[1].price, 150);

// Mercari — items[]; whole-dollar price, condition from nested object.
const m = parseMercari({ items: [
  { id: "m1", name: "Nike Dunk", price: 90, item_condition: { name: "Good" } },
  { id: "m2", name: "Bad", price: -5 },
] });
assert.equal(m.length, 1);
assert.equal(m[0].source, "mercari-active");
assert.equal(m[0].condition, "Good");
assert.equal(m[0].url, "https://www.mercari.com/us/item/m1/");

// Malformed input never throws.
for (const f of [parseThredup, parseRealReal, parseMercari]) {
  assert.deepEqual(f(null), []);
  assert.deepEqual(f({}), []);
}

console.log("sources.test ok");

// Check the retail-listing parse on fixture markup, no network.
// Run: npm run build && node dist/retail.test.js
import assert from "node:assert";
import { parseShopping } from "./retail.js";

const html = `
<a href="https://www.mytheresa.com/us/en/women/valentino-p0118"><div>Valentino Embroidered Linen Midi Dress</div><span>$4,190.00</span></a>
<a href="/url?q=https://www.saksfifthavenue.com/product/v123&sa=U"><div>Embroidered midi</div><span>$4,190.00</span></a>
<a href="https://www.google.com/aclk?x"><span>$9.99</span></a>
<a href="https://www.farfetch.com/shopping/item-2"><span>$3,985.00</span></a>`;

const r = parseShopping(html);
assert.ok(r.length >= 2, "finds at least two listings");
assert.equal(r[0].retailer, "mytheresa");
assert.equal(r[0].price, 4190);
assert.ok(r.every((x) => !x.url.includes("google")), "google redirect hosts excluded");
const ff = r.find((x) => x.retailer === "farfetch");
assert.equal(ff?.price, 3985);

// duplicates (same retailer+price) collapse
const dup = parseShopping(html + html);
assert.equal(dup.length, r.length);

// garbage never throws
assert.deepEqual(parseShopping("<html>nothing here</html>"), []);

console.log("retail.test ok");

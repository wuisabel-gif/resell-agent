// Pure GUI boundary tests; no server, image, or platform service is involved.
import assert from "node:assert";
import { mergeEditableListingFields, stableGuiSku, validatePlatformSelection } from "./gui-validation.js";
import type { DraftBundle } from "./types.js";

const draft: DraftBundle = {
  attributes: {
    brand: "Example",
    brandInferred: false,
    productName: "Jacket",
    category: "Jacket",
    titleKeywords: [],
    size: "M",
    color: "blue",
    material: "wool",
    condition: "good",
    flaws: [],
    dimensions: null,
    originalRetail: null,
  },
  price: { suggested: 40, low: 30, high: 50, currency: "USD", basis: "test", sampleSize: 1 },
  comps: [],
  comparison: [],
  retail: [],
  listings: [
    { platform: "ebay", title: "Original", description: "Original description", price: 40, condition: "good", categoryId: "123" },
    { platform: "depop", title: "Depop", description: "Depop description", price: 40, condition: "good" },
  ],
};

assert.deepEqual(validatePlatformSelection(["ebay", "ebay", "depop"]), ["ebay", "depop"]);
assert.throws(() => validatePlatformSelection([]), /at least one/);
assert.throws(() => validatePlatformSelection(["etsy"]), /Unsupported platform/);

const merged = mergeEditableListingFields(draft, [
  { platform: "ebay", title: " Edited ", description: "New copy", price: 41.25, categoryId: "456", ignored: "not merged" },
]);
assert.equal(merged.listings[0].title, "Edited");
assert.equal(merged.listings[0].price, 41.25);
assert.equal(merged.listings[0].categoryId, "456");
assert.equal((merged.listings[0] as unknown as Record<string, unknown>).ignored, undefined);
assert.equal(draft.listings[0].title, "Original");
assert.throws(() => mergeEditableListingFields(draft, [{ platform: "ebay", price: Number.NaN }]), /finite positive/);
assert.throws(() => mergeEditableListingFields(draft, [{ platform: "depop", categoryId: "123" }]), /Only eBay/);
assert.match(stableGuiSku("123e4567-e89b-12d3-a456-426614174000"), /^resale-gui-/);
assert.equal(stableGuiSku("draft-id", "GUI"), stableGuiSku("draft-id", "GUI"));

console.log("gui-validation.test ok");

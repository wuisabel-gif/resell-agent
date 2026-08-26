// Checks the publish orchestration without hitting live services.
// Run: npm run build && node dist/publish.test.js
import assert from "node:assert";
import { publishDraftBundle } from "./publish.js";
import type { DraftBundle } from "./types.js";

const draft: DraftBundle = {
  attributes: {
    brand: "Patagonia",
    brandInferred: false,
    productName: "Synchilla Snap-T",
    category: "Fleece Jacket",
    titleKeywords: ["synchilla"],
    size: "M",
    color: "green",
    material: "fleece",
    condition: "good",
    flaws: [],
    dimensions: null,
    originalRetail: 139,
  },
  price: { suggested: 68, low: 55, high: 82, currency: "USD", basis: "median of 21 active asks", sampleSize: 21 },
  comparison: [],
  retail: [],
  comps: [],
  listings: [
    { platform: "ebay", title: "Patagonia Synchilla Fleece M Green", description: "Green fleece.", price: 68, condition: "good", categoryId: "57988" },
    { platform: "poshmark", title: "Cozy Patagonia fleece", description: "So warm.", price: 68, condition: "good" },
    { platform: "depop", title: "Patagonia fleece", description: "Vintage-inspired.", price: 68, condition: "good" },
  ],
};

const calls: string[] = [];

const result = await publishDraftBundle(
  {
    draft,
    photoPaths: ["/tmp/photo1.jpg"],
    platforms: ["ebay", "poshmark", "depop"],
    ebay: {
      imageUrls: ["https://example.com/photo1.jpg"],
      merchantLocationKey: "loc",
      fulfillmentPolicyId: "fulfill",
      paymentPolicyId: "payment",
      returnPolicyId: "return",
    },
  },
  {
    publishEbay: async (listing, opts) => {
      calls.push(`ebay:${listing.platform}:${opts.categoryId}`);
      return { offerId: "offer-1", listingId: "listing-1" };
    },
    publishBrowser: async (platform, listing) => {
      calls.push(`browser:${platform}:${listing.platform}`);
      return { message: `${platform} done`, url: `https://${platform}.example.com/listing/1` };
    },
  }
);

assert.deepEqual(calls, ["ebay:ebay:57988", "browser:poshmark:poshmark", "browser:depop:depop"]);
assert.equal(result.results.length, 3);
assert.equal(result.results[0].status, "published");
assert.equal(result.results[1].status, "published");
assert.equal(result.results[2].status, "published");

console.log("publish.test ok");

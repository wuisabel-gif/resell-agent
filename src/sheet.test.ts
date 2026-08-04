// Check the paste-sheet renderer. Run: npm run build && node dist/sheet.test.js
import assert from "node:assert";
import { renderSheet } from "./sheet.js";
import type { DraftBundle } from "./types.js";

const bundle: DraftBundle = {
  attributes: {
    brand: "Patagonia", brandInferred: false, category: "Fleece Jacket", titleKeywords: ["synchilla"],
    size: "M", color: "green", material: "fleece", condition: "good",
    flaws: ["small stain on cuff"], dimensions: "≈ 27 x 24 in (estimate)", originalRetail: 139,
  },
  price: { suggested: 68, low: 55, high: 82, currency: "USD", basis: "median of 21 active asks", sampleSize: 21 },
  comparison: [{ source: "ebay-active", median: 80, low: 72, high: 95, n: 21 }],
  comps: [],
  listings: [
    { platform: "ebay", title: "Patagonia Synchilla Fleece M Green", description: "Green fleece.", price: 68, condition: "good", categoryId: "57988", itemSpecifics: { Brand: ["Patagonia"], Size: ["M"] } },
    { platform: "poshmark", title: "Cozy Patagonia fleece 💚", description: "So warm.", price: 68, condition: "good" },
  ],
};

const md = renderSheet(bundle, ["front.clean.png"]);
// Range-first, framed as a starting point — not a bare single number.
assert.ok(md.includes("$55–$82"), "shows the range");
assert.ok(md.includes("start around $68"), "frames a starting point");
// Both platform blocks present with paste-ready fields.
assert.ok(md.includes("## eBay") && md.includes("## Poshmark"));
assert.ok(md.includes("**Category:** 57988"));
assert.ok(md.includes("Brand: Patagonia"));
assert.ok(md.includes("front.clean.png"));
assert.ok(md.includes("small stain on cuff"));
assert.ok(md.includes("≈ 27 x 24 in (estimate)"), "shows the estimated dimensions");

// No comps -> manual price, no crash.
const empty = renderSheet({ ...bundle, price: { ...bundle.price, suggested: 0, low: 0, high: 0 }, comparison: [] });
assert.ok(empty.includes("set it manually"));

console.log("sheet.test ok");

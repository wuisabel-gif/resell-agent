// Checks that copy/paste-only drafts never invoke eBay comp sources.
import assert from "node:assert";
import { gatherComps, usesEbay, type PipelineCompSources } from "./pipeline.js";
import type { ItemAttributes } from "./types.js";

const attrs: ItemAttributes = {
  brand: null,
  brandInferred: false,
  productName: "Jacket",
  category: "Jacket",
  titleKeywords: ["jacket"],
  size: "M",
  color: "blue",
  material: "wool",
  condition: "good",
  flaws: [],
  dimensions: null,
  originalRetail: null,
};

assert.equal(usesEbay(["poshmark", "depop"]), false);
assert.equal(usesEbay(["ebay", "poshmark"]), true);

let activeCalls = 0;
let soldCalls = 0;
const source = (name: string) => async (): Promise<never[]> => {
  if (name === "active") activeCalls++;
  if (name === "sold") soldCalls++;
  return [];
};
const sources: PipelineCompSources = {
  getActiveComps: source("active"),
  getSoldComps: source("sold"),
  getPoshmarkComps: source("poshmark"),
  getThredupComps: source("thredup"),
  getRealRealComps: source("realreal"),
  getMercariComps: source("mercari"),
};

await gatherComps(attrs, ["poshmark", "depop"], sources);
assert.equal(activeCalls, 0);
assert.equal(soldCalls, 0);
await gatherComps(attrs, ["ebay"], sources);
assert.equal(activeCalls, 1);
assert.equal(soldCalls, 1);

console.log("pipeline.test ok");

import { writeFileSync, readFileSync } from "node:fs";
import { buildDraft } from "./pipeline.js";
import { buildConsentUrl, exchangeCode } from "./ebay/auth.js";
import { publishListing, type PostOptions } from "./ebay/sell.js";
import type { DraftBundle, Platform } from "./types.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function cmdDraft() {
  const photos = (arg("--photos") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const notes = arg("--notes") ?? "";
  const platforms = ((arg("--platforms") ?? "ebay,poshmark").split(",")) as Platform[];
  const out = arg("--out") ?? "draft.json";

  if (photos.length === 0) {
    console.error("Usage: draft --photos a.jpg,b.jpg [--notes '...'] [--platforms ebay,poshmark] [--out draft.json]");
    process.exit(1);
  }

  const bundle = await buildDraft(photos, notes, platforms);
  writeFileSync(out, JSON.stringify(bundle, null, 2));

  console.log(`\nAttributes: ${bundle.attributes.brand ?? "?"} ${bundle.attributes.category} (${bundle.attributes.condition})`);
  console.log(`Price: ${bundle.price.suggested} ${bundle.price.currency}  [${bundle.price.low}-${bundle.price.high}]`);
  console.log(`Basis: ${bundle.price.basis}`);
  for (const l of bundle.listings) {
    console.log(`\n--- ${l.platform} ---\n${l.title}\n${l.description}`);
    if (l.platform === "ebay") {
      console.log(`category: ${l.categoryId ?? "(unresolved — pass --category on post)"}`);
      const specs = l.itemSpecifics ?? {};
      const n = Object.keys(specs).length;
      if (n) console.log(`item specifics (${n}): ${Object.entries(specs).map(([k, v]) => `${k}=${v.join("/")}`).join(", ")}`);
    }
  }
  console.log(`\nSaved ${out}. Review it, then use \`post\` to publish to eBay.`);
}

async function cmdPost() {
  const file = arg("--draft") ?? "draft.json";
  const bundle = JSON.parse(readFileSync(file, "utf8")) as DraftBundle;
  const ebay = bundle.listings.find((l) => l.platform === "ebay");
  if (!ebay) throw new Error("no eBay listing in draft");

  // These identifiers come from your one-time eBay account setup (see README).
  const opts: PostOptions = {
    sku: arg("--sku") ?? `resell-${Date.now()}`,
    imageUrls: (arg("--images") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    // Draft resolves this automatically; --category is now just an override.
    categoryId: arg("--category") ?? ebay.categoryId ?? "",
    merchantLocationKey: arg("--location") ?? "",
    fulfillmentPolicyId: arg("--fulfillment") ?? "",
    paymentPolicyId: arg("--payment") ?? "",
    returnPolicyId: arg("--return") ?? "",
  };

  for (const [k, v] of Object.entries(opts)) {
    if (v === "" || (Array.isArray(v) && v.length === 0)) {
      throw new Error(`missing --${k.replace(/Id$/, "").toLowerCase()}; see README for one-time setup`);
    }
  }

  console.log(`Publishing "${ebay.title}" at ${ebay.price} ...`);
  const r = await publishListing(ebay, opts);
  console.log(`Live. offerId=${r.offerId} listingId=${r.listingId}`);
}

function cmdAuthUrl() {
  console.log("Open this URL, sign in, approve, then copy the ?code= value from the redirect:\n");
  console.log(buildConsentUrl());
}

async function cmdAuthExchange() {
  const code = process.argv[3];
  if (!code) throw new Error("Usage: auth-exchange <code>");
  const t = await exchangeCode(decodeURIComponent(code));
  console.log("\nAdd this to your .env:\n");
  console.log(`EBAY_USER_REFRESH_TOKEN=${t.refresh_token}`);
}

const cmd = process.argv[2];
const table: Record<string, () => unknown | Promise<unknown>> = {
  draft: cmdDraft,
  post: cmdPost,
  "auth-url": cmdAuthUrl,
  "auth-exchange": cmdAuthExchange,
};

const fn = table[cmd];
if (!fn) {
  console.error("Commands: draft | post | auth-url | auth-exchange");
  process.exit(1);
}
Promise.resolve(fn()).catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});

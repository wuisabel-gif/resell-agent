import { writeFileSync, readFileSync } from "node:fs";
import { buildDraft } from "./pipeline.js";
import { renderSheet } from "./sheet.js";
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
  const imageUrl = arg("--image-url"); // public URL for reverse-image brand lookup

  if (photos.length === 0) {
    console.error("Usage: draft --photos a.jpg,b.jpg [--notes '...'] [--platforms ebay,poshmark] [--clean] [--image-url https://...] [--out draft.json]");
    process.exit(1);
  }

  // --clean: remove backgrounds first. Cleaner input -> better attribute extraction,
  // and the .clean.png files are listing-ready (host them for `post --images`).
  let usePhotos = photos;
  if (process.argv.includes("--clean")) {
    const { cleanPhoto } = await import("./brain/bgremove.js");
    usePhotos = [];
    for (const p of photos) {
      const out = await cleanPhoto(p);
      console.log(`cleaned ${p} -> ${out}`);
      usePhotos.push(out);
    }
  }

  const bundle = await buildDraft(usePhotos, notes, platforms, imageUrl);
  writeFileSync(out, JSON.stringify(bundle, null, 2));

  // Paste sheet: the artifact you send a friend (eBay + Poshmark blocks).
  const sheetPath = out.replace(/\.json$/i, "") + ".md";
  writeFileSync(sheetPath, renderSheet(bundle, usePhotos));

  const p = bundle.price;
  console.log(`\nAttributes: ${bundle.attributes.brand ?? "?"} ${bundle.attributes.category} (${bundle.attributes.condition})`);
  if (p.suggested > 0) {
    console.log(`Price: ${p.low}–${p.high} ${p.currency}  (start around ${p.suggested}, adjust)`);
  } else {
    console.log(`Price: no comps found — set it manually`);
  }
  console.log(`Basis: ${p.basis}`);
  if (bundle.comparison.length) {
    console.log(`\nCross-platform comps:`);
    for (const s of bundle.comparison) {
      console.log(`  ${s.source.padEnd(16)} ${String(s.median).padStart(7)}  [${s.low}-${s.high}]  n=${s.n}`);
    }
  }
  for (const l of bundle.listings) {
    console.log(`\n--- ${l.platform} ---\n${l.title}\n${l.description}`);
    if (l.platform === "ebay") {
      console.log(`category: ${l.categoryId ?? "(unresolved — pass --category on post)"}`);
      const specs = l.itemSpecifics ?? {};
      const n = Object.keys(specs).length;
      if (n) console.log(`item specifics (${n}): ${Object.entries(specs).map(([k, v]) => `${k}=${v.join("/")}`).join(", ")}`);
    }
  }
  console.log(`\nSaved ${out} (data) and ${sheetPath} (paste sheet to send). Review before sharing.`);
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

// Build the reference brand index from a folder of your own product photos.
// Layout: refs/<Brand>/anything.jpg  (or  refs/Brand__desc.jpg). See README.
async function cmdIndex() {
  const dir = arg("--dir") ?? "refs";
  const out = arg("--out") ?? "brand-index.json";
  const { buildIndex, saveIndex } = await import("./nnindex.js");
  console.log(`Embedding reference photos in ${dir}/ (first run downloads the model)...`);
  const idx = await buildIndex(dir);
  saveIndex(out, idx);
  const brands = new Set(idx.entries.map((e) => e.label));
  console.log(`Indexed ${idx.entries.length} photos across ${brands.size} labels -> ${out}. Set ENABLE_BRAND_MATCH=1 to use it.`);
}

// Multi-item: detect every piece in one photo, then draft each separately.
async function cmdOutfit() {
  const photo = (arg("--photos") ?? arg("--photo") ?? "").split(",")[0]?.trim();
  const outBase = arg("--out") ?? "outfit";
  const platforms = ((arg("--platforms") ?? "ebay,poshmark").split(",")) as Platform[];
  if (!photo) {
    console.error("Usage: outfit --photos look.jpg [--notes '...'] [--out outfit]");
    process.exit(1);
  }
  const { buildOutfit, renderDetectionSvg } = await import("./outfit.js");
  console.log(`Detecting pieces in ${photo} ...`);
  const items = await buildOutfit(photo, arg("--notes") ?? "", platforms);
  if (!items.length) {
    console.log("No sellable pieces detected.");
    return;
  }
  console.log(`\nDetected ${items.length} piece(s):`);
  items.forEach((it, i) => {
    const p = it.draft.price;
    const price = p.suggested > 0 ? `${p.low}-${p.high} ${p.currency}` : "set manually";
    const a = it.draft.attributes;
    const brand = a.brand ? ` · ${a.brand}${a.brandInferred ? " (verify)" : ""}` : "";
    writeFileSync(`${outBase}-${i + 1}.md`, renderSheet(it.draft, [it.crop]));
    console.log(`  ${i + 1}. ${it.label} — ${price}${brand}`);
  });
  writeFileSync(`${outBase}.svg`, await renderDetectionSvg(photo, items));
  console.log(`\nWrote ${outBase}.svg and ${items.length} sheet(s) (${outBase}-1.md ...). Review before sharing.`);
}

const cmd = process.argv[2];
const table: Record<string, () => unknown | Promise<unknown>> = {
  draft: cmdDraft,
  outfit: cmdOutfit,
  post: cmdPost,
  index: cmdIndex,
  "auth-url": cmdAuthUrl,
  "auth-exchange": cmdAuthExchange,
};

const fn = table[cmd];
if (!fn) {
  console.error("Commands: draft | outfit | post | index | auth-url | auth-exchange");
  process.exit(1);
}
Promise.resolve(fn()).catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});

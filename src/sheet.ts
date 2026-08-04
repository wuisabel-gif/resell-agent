import type { DraftBundle } from "./types.js";

// Per-item paste sheet: an eBay block and a Poshmark block a seller copies
// wholesale into their own account, led by a price RANGE (a starting point,
// not a fake-precise number) plus the cross-platform comparison.
export function renderSheet(bundle: DraftBundle, photos: string[] = []): string {
  const { attributes: a, price: p, comparison, listings } = bundle;
  const out: string[] = [];

  const head = [a.brand, a.category].filter(Boolean).join(" ") || "Item";
  out.push(`# ${head} — ${a.condition}`, "");

  if (p.suggested > 0) {
    out.push(`**Price: $${p.low}–$${p.high}** ${p.currency} — start around $${p.suggested} and adjust.`);
  } else {
    out.push(`**Price: no comps found — set it manually.**`);
  }
  out.push(`_${p.basis}_`, "");

  if (comparison.length) {
    out.push("Comps by source:");
    for (const s of comparison) out.push(`- ${s.source}: median $${s.median}  [$${s.low}–$${s.high}]  n=${s.n}`);
    out.push("");
  }
  if (a.dimensions) out.push(`Dimensions: ${a.dimensions} — confirm before listing`, "");
  if (a.flaws.length) out.push(`Flaws: ${a.flaws.join("; ")}`, "");
  if (photos.length) out.push(`Photos: ${photos.join(", ")}`, "");

  for (const l of listings) {
    out.push(`## ${l.platform === "ebay" ? "eBay" : "Poshmark"}`, "");
    out.push(`**Title:** ${l.title}`);
    if (l.platform === "ebay") {
      if (l.categoryId) out.push(`**Category:** ${l.categoryId}`);
      const specs = l.itemSpecifics ?? {};
      const keys = Object.keys(specs);
      if (keys.length) {
        out.push(`**Item specifics:** ${keys.map((k) => `${k}: ${specs[k].join("/")}`).join(" · ")}`);
      }
    }
    out.push("", l.description, "");
  }

  return out.join("\n");
}

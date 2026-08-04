// ─────────────────────────────────────────────────────────────────────────────
// Our own reverse-image brand matcher. No scraping, no key, no ToS risk: it runs
// a CLIP model locally (transformers.js) and does zero-shot image classification
// of the photo against a curated list of resale houses. Works on the local photo
// bytes, so nothing needs hosting. Off unless ENABLE_BRAND_MATCH=1 (first run
// downloads the model, ~150MB). It returns a ranked brand guess with a confidence
// score, fed to the vision step as a lead — never as proof or authentication.
//
// Upgrade path: swap the fixed label list for nearest-neighbour search over an
// index of your own product-image embeddings, for true photo-to-listing matching.
// ─────────────────────────────────────────────────────────────────────────────

// Curated resale houses. Zero-shot can only name a brand that's on this list, so
// keep it to the ones you actually resell; add freely.
export const BRANDS = [
  "Coach", "Hermès", "Louis Vuitton", "Chanel", "Gucci", "Prada", "Dior", "Fendi",
  "Bottega Veneta", "Saint Laurent", "Balenciaga", "Celine", "Loewe", "Givenchy",
  "Valentino", "Burberry", "Versace", "Miu Miu", "Chloé", "Goyard", "Mulberry",
  "Marc Jacobs", "Michael Kors", "Kate Spade", "Tory Burch", "Longchamp", "Ferragamo",
  "Tod's", "Jimmy Choo", "Christian Louboutin", "Manolo Blahnik", "Nike", "Adidas",
  "New Balance", "Air Jordan", "Common Projects", "Golden Goose", "Dr. Martens", "UGG",
  "Patagonia", "The North Face", "Arc'teryx", "Moncler", "Canada Goose", "Stone Island",
  "Supreme", "Carhartt", "Levi's", "Ralph Lauren", "Tommy Hilfiger", "Lululemon",
  "Aritzia", "Reformation", "Free People", "Madewell", "Theory", "Vince", "Eileen Fisher",
  "Jenni Kayne", "Zimmermann", "Ganni", "Rolex", "Omega", "Cartier", "Tiffany & Co.",
  "David Yurman", "Diptyque", "Jo Malone",
];

export interface BrandMatch {
  brand: string;
  score: number;
}

const label = (b: string) => `a photo of a ${b} item`;
const brandOf = (l: string) => l.replace(/^a photo of a /, "").replace(/ item$/, "");

// Rank CLIP output and keep the top guess only if it clears a confidence floor.
// Pure, so it's testable without the model.
export function pickBrand(
  results: { label: string; score: number }[],
  minScore = 0.18
): BrandMatch | null {
  if (!results.length) return null;
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (top.score < minScore) return null;
  return { brand: brandOf(top.label), score: top.score };
}

export async function matchBrand(imagePath: string): Promise<BrandMatch | null> {
  if (!process.env.ENABLE_BRAND_MATCH) return null;
  try {
    const { existsSync } = await import("node:fs");
    const indexPath = process.env.BRAND_INDEX ?? "brand-index.json";

    // Preferred: nearest-neighbour against your own indexed reference photos.
    if (existsSync(indexPath)) {
      const { loadIndex, search } = await import("./nnindex.js");
      const { embedImage } = await import("./embed.js");
      const hits = search(loadIndex(indexPath), await embedImage(imagePath), 3);
      const min = Number(process.env.BRAND_MATCH_MIN ?? 0.75);
      if (!hits.length || hits[0].score < min) return null;
      return { brand: hits[0].label, score: hits[0].score };
    }

    // Fallback: zero-shot against the curated label list (no index built yet).
    // @ts-ignore optional dependency, resolved at runtime when ENABLE_BRAND_MATCH is set
    const mod: any = await import("@xenova/transformers");
    const classify = await mod.pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32");
    return pickBrand(await classify(imagePath, BRANDS.map(label)));
  } catch (e) {
    console.warn(`brand match unavailable (${String(e)}); skipping. Set ENABLE_BRAND_MATCH and install @xenova/transformers.`);
    return null;
  }
}

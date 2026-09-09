import { extractAttributes } from "./brain/extract.js";
import { priceFromComps, compareByPlatform } from "./brain/price.js";
import { generateListing } from "./brain/listing.js";
import { fillAspects } from "./brain/aspects.js";
import { getActiveComps, getSoldComps } from "./ebay/browse.js";
import { getPoshmarkComps } from "./poshmark.js";
import { getThredupComps } from "./thredup.js";
import { getRealRealComps } from "./therealreal.js";
import { getMercariComps } from "./mercari.js";
import { suggestCategory, getRequiredAspects } from "./ebay/taxonomy.js";
import { getImageGuess } from "./imagesearch.js";
import { matchBrand } from "./brandvision.js";
import { getRetail } from "./retail.js";
import type { Comp, ItemAttributes, DraftBundle, Platform } from "./types.js";

type CompSource = (attributes: ItemAttributes) => Promise<Comp[]>;

export interface PipelineCompSources {
  getActiveComps: CompSource;
  getSoldComps: CompSource;
  getPoshmarkComps: CompSource;
  getThredupComps: CompSource;
  getRealRealComps: CompSource;
  getMercariComps: CompSource;
}

const defaultCompSources: PipelineCompSources = {
  getActiveComps,
  getSoldComps,
  getPoshmarkComps,
  getThredupComps,
  getRealRealComps,
  getMercariComps,
};

/** eBay is the only source that needs eBay credentials and is opt-in per draft. */
export function usesEbay(platforms: readonly Platform[]): boolean {
  return platforms.includes("ebay");
}

/**
 * Gather only the selected draft's relevant sources. In particular, the two
 * eBay requests are never invoked for copy/paste-only Poshmark/Depop drafts.
 */
export async function gatherComps(
  attributes: ItemAttributes,
  platforms: readonly Platform[],
  sources: PipelineCompSources = defaultCompSources
): Promise<Comp[]> {
  const includeEbay = usesEbay(platforms);
  const [active, sold, poshmark, thredup, realreal, mercari] = await Promise.all([
    includeEbay ? sources.getActiveComps(attributes) : Promise.resolve([]),
    includeEbay ? sources.getSoldComps(attributes) : Promise.resolve([]),
    sources.getPoshmarkComps(attributes),
    sources.getThredupComps(attributes),
    sources.getRealRealComps(attributes),
    sources.getMercariComps(attributes),
  ]);
  return [...sold, ...active, ...poshmark, ...thredup, ...realreal, ...mercari];
}

// photos + notes  ->  attributes  ->  comps  ->  price  ->  listings.
// Read-only end to end. Nothing gets posted here.
export async function buildDraft(
  photoPaths: string[],
  notes: string,
  platforms: Platform[] = ["ebay", "poshmark", "depop"],
  imageUrl?: string
): Promise<DraftBundle> {
  // Optional brand leads fed into the vision step (both gated, both null when off):
  // a local CLIP visual match, and an unofficial reverse-image search (CLI only).
  const [urlGuess, clip] = await Promise.all([
    imageUrl ? getImageGuess(imageUrl) : Promise.resolve(null),
    matchBrand(photoPaths[0]),
  ]);
  const leads = [
    urlGuess ? `reverse-image search: "${urlGuess}"` : null,
    clip ? `visual brand match: ${clip.brand} (${Math.round(clip.score * 100)}%)` : null,
  ].filter(Boolean);
  const attributes = await extractAttributes(photoPaths, notes, leads.join("; ") || undefined);

  const [comps, retail] = await Promise.all([
    gatherComps(attributes, platforms),
    getRetail(attributes), // exact piece at retail, only when a product was named
  ]);

  const price = priceFromComps(comps);
  const comparison = compareByPlatform(comps);

  const listings = await Promise.all(
    platforms.map((p) => generateListing(attributes, price, p))
  );

  // Enrich the eBay listing with a resolved category + item specifics so `post`
  // needs no manual --category and buyers get eBay's search-weighted aspects.
  const ebay = listings.find((l) => l.platform === "ebay");
  if (ebay) {
    const cat = await suggestCategory(ebay.title);
    if (cat) {
      ebay.categoryId = cat.categoryId;
      ebay.itemSpecifics = await fillAspects(attributes, await getRequiredAspects(cat.categoryId));
    }
  }

  return { attributes, price, comps, comparison, retail, listings };
}

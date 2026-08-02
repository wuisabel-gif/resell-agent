import { extractAttributes } from "./brain/extract.js";
import { priceFromComps, compareByPlatform } from "./brain/price.js";
import { generateListing } from "./brain/listing.js";
import { fillAspects } from "./brain/aspects.js";
import { getActiveComps, getSoldComps } from "./ebay/browse.js";
import { getPoshmarkComps } from "./poshmark.js";
import { suggestCategory, getRequiredAspects } from "./ebay/taxonomy.js";
import type { DraftBundle, Platform } from "./types.js";

// photos + notes  ->  attributes  ->  comps  ->  price  ->  listings.
// Read-only end to end. Nothing gets posted here.
export async function buildDraft(
  photoPaths: string[],
  notes: string,
  platforms: Platform[] = ["ebay", "poshmark"]
): Promise<DraftBundle> {
  const attributes = await extractAttributes(photoPaths, notes);

  const [active, sold, poshmark] = await Promise.all([
    getActiveComps(attributes),
    getSoldComps(attributes),
    getPoshmarkComps(attributes),
  ]);
  const comps = [...sold, ...active, ...poshmark];

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

  return { attributes, price, comps, comparison, listings };
}

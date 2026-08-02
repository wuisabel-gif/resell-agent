import { extractAttributes } from "./brain/extract.js";
import { priceFromComps } from "./brain/price.js";
import { generateListing } from "./brain/listing.js";
import { getActiveComps, getSoldComps } from "./ebay/browse.js";
import type { DraftBundle, Platform } from "./types.js";

// photos + notes  ->  attributes  ->  comps  ->  price  ->  listings.
// Read-only end to end. Nothing gets posted here.
export async function buildDraft(
  photoPaths: string[],
  notes: string,
  platforms: Platform[] = ["ebay", "poshmark"]
): Promise<DraftBundle> {
  const attributes = await extractAttributes(photoPaths, notes);

  const [active, sold] = await Promise.all([
    getActiveComps(attributes),
    getSoldComps(attributes),
  ]);
  const comps = [...sold, ...active];

  const price = priceFromComps(comps);

  const listings = await Promise.all(
    platforms.map((p) => generateListing(attributes, price, p))
  );

  return { attributes, price, comps, listings };
}

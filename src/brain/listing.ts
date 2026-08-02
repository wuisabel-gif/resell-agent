import { complete, parseJson } from "./anthropic.js";
import type { ItemAttributes, ListingDraft, Platform, PriceSuggestion } from "../types.js";

const VOICE: Record<Platform, string> = {
  ebay:
    "eBay: keyword-dense title up to 80 chars (brand, item, size, color, key terms buyers search). " +
    "Description is factual, scannable, states condition and every flaw plainly. No hype.",
  poshmark:
    "Poshmark: warmer, social tone. Shorter title. Description can use a couple of tasteful emojis, " +
    "mention styling, still states condition and flaws honestly.",
};

const SYSTEM = `You write second-hand resale listings. Given item attributes and a target price,
write a listing for the requested platform. State condition and flaws honestly.
Never invent details not present in the attributes.
Reply with ONLY JSON: { "title": string, "description": string }`;

export async function generateListing(
  attrs: ItemAttributes,
  price: PriceSuggestion,
  platform: Platform
): Promise<ListingDraft> {
  const raw = await complete(
    SYSTEM,
    [
      {
        role: "user",
        content:
          `Platform rules: ${VOICE[platform]}\n\n` +
          `Attributes: ${JSON.stringify(attrs)}\n` +
          `Target price: ${price.suggested} ${price.currency}\n\n` +
          `Write the listing as JSON.`,
      },
    ],
    900
  );
  const { title, description } = parseJson<{ title: string; description: string }>(raw);
  return {
    platform,
    title: title.slice(0, platform === "ebay" ? 80 : 120),
    description,
    price: price.suggested,
    condition: attrs.condition,
  };
}

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { complete, parseJson, type Msg } from "./anthropic.js";
import type { ItemAttributes } from "../types.js";

function mediaType(path: string): string {
  const e = extname(path).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  return "image/jpeg";
}

function imageBlock(path: string) {
  const data = readFileSync(path).toString("base64");
  return { type: "image" as const, source: { type: "base64" as const, media_type: mediaType(path), data } };
}

const SYSTEM = `You are a resale cataloging assistant. Given photos of a used item and optional
seller notes, identify its attributes for listing on eBay and Poshmark.
Grade condition honestly from visible wear. List real visible flaws.
Be conservative with SIZE: if the garment's label isn't visible, use null, never a guess.

For "brand", identify the house from the photo. First read any visible label, tag, or
engraved/embossed logo. If no mark is visible, INFER the most likely house from its
design signatures: hardware (a Coach turnlock, an Hermes H, an LV monogram), silhouette,
stitching, materials, and the item's overall style. Set "brandInferred" true when you
inferred it from design rather than a visible mark, false when you read it from a mark.
Use null only when you genuinely cannot tell. An inferred brand is a lead to verify,
never a certainty, and never an authentication.

For "dimensions", ESTIMATE the item's approximate size and return a short string
like "≈ 15 x 11 x 4 in (estimate)". Base the estimate on the item's type and its
typical size, refined by its proportions against anything of known size in frame
(a hand, a coin or card, standard furniture, a hanger). Always mark it "(estimate)".
Use null only when size truly can't be inferred — e.g. clothing/shoe SIZING, which
needs the garment's own label, not a visual guess. Never present an estimate as exact.

Reply with ONLY a JSON object, no prose, matching this shape:
{
  "brand": string|null,
  "brandInferred": boolean,
  "category": string,
  "titleKeywords": string[],
  "size": string|null,
  "color": string|null,
  "material": string|null,
  "condition": "NWT"|"like-new"|"good"|"fair",
  "flaws": string[],
  "dimensions": string|null,
  "originalRetail": number|null
}`;

export async function extractAttributes(
  photoPaths: string[],
  notes = "",
  imageSearchHint?: string
): Promise<ItemAttributes> {
  const hint = imageSearchHint
    ? `\n\nAutomated brand leads (${imageSearchHint}). ` +
      `Treat these as leads to confirm or reject against the photo, not proof; keep brandInferred true if you rely on one.`
    : "";
  const content: Msg["content"] = [
    ...photoPaths.map(imageBlock),
    {
      type: "text",
      text: `Seller notes: ${notes || "(none)"}${hint}\n\nCatalog this item as JSON.`,
    },
  ];
  const raw = await complete(SYSTEM, [{ role: "user", content }], 1000);
  return parseJson<ItemAttributes>(raw);
}

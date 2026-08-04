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
Be conservative: if you cannot see the brand or size, use null rather than guessing.
Grade condition honestly from visible wear. List real visible flaws.

For "dimensions", ESTIMATE the item's approximate size and return a short string
like "≈ 15 x 11 x 4 in (estimate)". Base the estimate on the item's type and its
typical size, refined by its proportions against anything of known size in frame
(a hand, a coin or card, standard furniture, a hanger). Always mark it "(estimate)".
Use null only when size truly can't be inferred — e.g. clothing/shoe SIZING, which
needs the garment's own label, not a visual guess. Never present an estimate as exact.

Reply with ONLY a JSON object, no prose, matching this shape:
{
  "brand": string|null,
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
  notes = ""
): Promise<ItemAttributes> {
  const content: Msg["content"] = [
    ...photoPaths.map(imageBlock),
    {
      type: "text",
      text: `Seller notes: ${notes || "(none)"}\n\nCatalog this item as JSON.`,
    },
  ];
  const raw = await complete(SYSTEM, [{ role: "user", content }], 1000);
  return parseJson<ItemAttributes>(raw);
}

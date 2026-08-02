import { complete, parseJson } from "./anthropic.js";
import type { AspectSpec } from "../ebay/taxonomy.js";
import type { ItemAttributes } from "../types.js";

const SYSTEM = `You map a used item's known attributes onto eBay's item-specific aspects.
Only fill an aspect if the attributes clearly support a value. Leave anything you'd
have to guess OUT of the object — never invent brand, size, material, etc.
For SELECTION aspects, choose only from the allowed values given.
Reply with ONLY a JSON object of { "<aspect name>": "<value>" }.`;

// attributes + eBay's expected aspects -> { aspectName: [value] } for the Inventory API.
export async function fillAspects(
  attrs: ItemAttributes,
  aspects: AspectSpec[]
): Promise<Record<string, string[]>> {
  if (aspects.length === 0) return {};

  const list = aspects
    .map(
      (a) =>
        `- ${a.name}${a.required ? " (required)" : ""}` +
        (a.values.length ? ` — allowed: ${a.values.slice(0, 25).join(", ")}` : "")
    )
    .join("\n");

  const raw = await complete(
    SYSTEM,
    [
      {
        role: "user",
        content:
          `Attributes: ${JSON.stringify(attrs)}\n\n` +
          `eBay aspects to fill where supported:\n${list}\n\n` +
          `Return the JSON map.`,
      },
    ],
    700
  );

  const flat = parseJson<Record<string, string>>(raw);
  // Keep only known aspect names with a real value; wrap in arrays (eBay's shape).
  const known = new Map(aspects.map((a) => [a.name.toLowerCase(), a.name]));
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(flat)) {
    const name = known.get(k.toLowerCase());
    if (name && typeof v === "string" && v.trim()) out[name] = [v.trim()];
  }
  return out;
}

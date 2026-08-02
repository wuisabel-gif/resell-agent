import type { Comp, ItemAttributes } from "./types.js";
import { buildQuery, gatedJson } from "./sources.js";

// ThredUp — unofficial internal search endpoint, ToS-risky, ASKING prices only.
// Off unless ENABLE_THREDUP=1. See src/sources.ts for the shared caveats.
export async function getThredupComps(a: ItemAttributes, limit = 48): Promise<Comp[]> {
  const url = `https://www.thredup.com/api/v1.5/items/search?query=${encodeURIComponent(buildQuery(a))}&page_size=${limit}`;
  const j = await gatedJson("ENABLE_THREDUP", "thredup", url);
  return j ? parseThredup(j) : [];
}

export function parseThredup(j: unknown): Comp[] {
  const obj = j as Record<string, any>;
  const items: unknown[] = obj?.items ?? obj?.hits ?? obj?.results ?? [];
  const out: Comp[] = [];
  for (const raw of items) {
    const p = raw as Record<string, any>;
    // ThredUp prices are US dollars. ponytail: if a field ever returns cents, /100 here.
    const price = Number(p?.price ?? p?.current_price ?? p?.sale_price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      title: String(p?.title ?? p?.brand ?? ""),
      price,
      currency: "USD",
      condition: p?.condition ?? null,
      url: String(p?.url ?? (p?.id ? `https://www.thredup.com/product/${p.id}` : "")),
      source: "thredup-active",
    });
  }
  return out;
}

import type { Comp, ItemAttributes } from "./types.js";
import { buildQuery, gatedJson } from "./sources.js";

// The RealReal — unofficial internal endpoint, ToS-risky, luxury-only, ASKING
// prices. Off unless ENABLE_THEREALREAL=1. See src/sources.ts for the caveats.
export async function getRealRealComps(a: ItemAttributes, limit = 40): Promise<Comp[]> {
  const url = `https://www.therealreal.com/products.json?keywords=${encodeURIComponent(buildQuery(a))}&per_page=${limit}`;
  const j = await gatedJson("ENABLE_THEREALREAL", "therealreal", url);
  return j ? parseRealReal(j) : [];
}

export function parseRealReal(j: unknown): Comp[] {
  const obj = j as Record<string, any>;
  const products: unknown[] = obj?.products ?? obj?.results ?? [];
  const out: Comp[] = [];
  for (const raw of products) {
    const p = raw as Record<string, any>;
    const price = Number(p?.price ?? p?.sale_price ?? p?.final_sale_price?.amount);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      title: String(p?.name ?? p?.title ?? ""),
      price,
      currency: String(p?.currency ?? "USD"),
      condition: p?.condition ?? null,
      url: String(p?.url ?? p?.pdp_url ?? ""),
      source: "therealreal-active",
    });
  }
  return out;
}

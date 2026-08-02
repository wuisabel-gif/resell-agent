import type { Comp, ItemAttributes } from "./types.js";
import { buildQuery, gatedJson } from "./sources.js";

// Mercari US — unofficial internal search endpoint, ToS-risky, ASKING prices.
// Off unless ENABLE_MERCARI=1. See src/sources.ts for the shared caveats.
// Note: Mercari's real endpoint often needs rotating DPoP tokens; if this plain
// GET is rejected it just yields no comps (the source degrades gracefully).
export async function getMercariComps(a: ItemAttributes, limit = 40): Promise<Comp[]> {
  const url = `https://www.mercari.com/v1/api/search?keyword=${encodeURIComponent(buildQuery(a))}&limit=${limit}&status=on_sale`;
  const j = await gatedJson("ENABLE_MERCARI", "mercari", url);
  return j ? parseMercari(j) : [];
}

export function parseMercari(j: unknown): Comp[] {
  const obj = j as Record<string, any>;
  const items: unknown[] = obj?.items ?? obj?.data ?? obj?.results ?? [];
  const out: Comp[] = [];
  for (const raw of items) {
    const p = raw as Record<string, any>;
    // Mercari US lists in whole dollars. ponytail: if the API returns cents, /100 here.
    const price = Number(p?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      title: String(p?.name ?? p?.title ?? ""),
      price,
      currency: "USD",
      condition: p?.item_condition?.name ?? p?.condition ?? null,
      url: p?.id ? `https://www.mercari.com/us/item/${p.id}/` : "",
      source: "mercari-active",
    });
  }
  return out;
}

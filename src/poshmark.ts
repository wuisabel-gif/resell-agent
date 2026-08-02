import type { Comp, ItemAttributes } from "./types.js";
import { buildQuery, gatedJson } from "./sources.js";

// Poshmark — unofficial internal endpoint, ToS-risky, ASKING prices only.
// Off unless ENABLE_POSHMARK=1. See src/sources.ts for the shared caveats.
export async function getPoshmarkComps(a: ItemAttributes, limit = 40): Promise<Comp[]> {
  const request = JSON.stringify({ filters: { inventory_status: ["available"] }, query: buildQuery(a) });
  const url = `https://poshmark.com/vm-rest/posts?request=${encodeURIComponent(request)}&summarize=true&count=${limit}`;
  const j = await gatedJson("ENABLE_POSHMARK", "poshmark", url, { "X-Requested-With": "XMLHttpRequest" });
  return j ? parsePoshmark(j) : [];
}

// Pure parse, split out so the shape handling is testable without the network.
export function parsePoshmark(j: unknown): Comp[] {
  const posts = (j as { data?: unknown[] })?.data ?? [];
  const out: Comp[] = [];
  for (const raw of posts) {
    const p = raw as Record<string, any>;
    // Poshmark has used both { price_amount: { val, currency_code } } and a flat price.
    const price = Number(p?.price_amount?.val ?? p?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      title: String(p?.title ?? ""),
      price,
      currency: String(p?.price_amount?.currency_code ?? "USD"),
      condition: p?.condition ?? null,
      url: p?.id ? `https://poshmark.com/listing/${p.id}` : "",
      source: "poshmark-active",
    });
  }
  return out;
}

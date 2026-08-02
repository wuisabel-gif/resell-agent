import type { Comp, ItemAttributes } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Poshmark has NO public API. This hits the same undocumented internal endpoint
// their web app uses. That means:
//   • It is AGAINST Poshmark's Terms of Service. Ban risk is on your account.
//   • It is FRAGILE — the endpoint/shape can change without notice and break.
//   • It returns ASKING prices only (Poshmark exposes no sold data publicly).
// It is OFF unless you set ENABLE_POSHMARK=1. Enable at your own risk.
// ─────────────────────────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function query(a: ItemAttributes): string {
  return [a.brand, ...a.titleKeywords, a.size].filter(Boolean).join(" ").trim();
}

export async function getPoshmarkComps(a: ItemAttributes, limit = 40): Promise<Comp[]> {
  if (!process.env.ENABLE_POSHMARK) return [];

  const request = JSON.stringify({ filters: { inventory_status: ["available"] }, query: query(a) });
  const url = `https://poshmark.com/vm-rest/posts?request=${encodeURIComponent(request)}&summarize=true&count=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parsePoshmark(await res.json());
  } catch (e) {
    // Fragile + unofficial: never let it break the draft, just warn and skip.
    console.warn(`poshmark comps unavailable (${String(e)}); skipping. Source is unofficial/ToS-risky.`);
    return [];
  }
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

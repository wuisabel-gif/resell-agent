import type { ItemAttributes } from "./types.js";

// Shared plumbing for the unofficial scrape sources (Poshmark, ThredUp,
// The RealReal, Mercari). None of these have a public API; each hits an
// undocumented internal endpoint. That means for ALL of them:
//   • against the platform's ToS — account/IP-ban risk is yours
//   • fragile — endpoints/shapes change without notice
//   • asking prices only (no sold data is exposed anywhere but eBay)
// Every source is OFF unless its ENABLE_* flag is set. Enable at your own risk.

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export function buildQuery(a: ItemAttributes): string {
  return [a.brand, ...a.titleKeywords, a.size].filter(Boolean).join(" ").trim();
}

// Gated, fault-tolerant JSON GET. Returns null when the flag is off or anything
// fails, so a flaky/blocked source yields no comps instead of breaking the draft.
export async function gatedJson(
  flag: string,
  name: string,
  url: string,
  headers: Record<string, string> = {}
): Promise<unknown | null> {
  if (!process.env[flag]) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`${name} comps unavailable (${String(e)}); skipping. Source is unofficial/ToS-risky.`);
    return null;
  }
}

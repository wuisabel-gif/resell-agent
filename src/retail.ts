import type { ItemAttributes, RetailListing } from "./types.js";
import { UA } from "./sources.js";

// Where the exact piece sells NEW. Unofficial Google Shopping scrape, same rules
// as the other scrape sources: against ToS, fragile, often blocked, off unless
// ENABLE_RETAIL=1. Only runs when the vision step has named an exact product, so
// the query is specific enough to mean the same piece, not just similar ones.

export async function getRetail(a: ItemAttributes, limit = 6): Promise<RetailListing[]> {
  if (!a.brand || !a.productName) return [];
  const fromYou = await getYouRetail(a, limit);
  if (fromYou.length) return fromYou;
  if (!process.env.ENABLE_RETAIL) return [];
  const q = `${a.brand} ${a.productName}`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=shop&hl=en`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseShopping(await res.text()).slice(0, limit);
  } catch (e) {
    console.warn(`retail lookup unavailable (${String(e)}); skipping. Unofficial/ToS-risky and often blocked.`);
    return [];
  }
}

async function getYouRetail(a: ItemAttributes, limit: number): Promise<RetailListing[]> {
  const key = process.env.YOU_API_KEY?.trim();
  if (!key) return [];
  try {
    const res = await fetch("https://ydc-index.io/v1/search", {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${a.brand} ${a.productName} buy`, count: 8 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const web = (await res.json() as { results?: { web?: Array<{ title?: string; url?: string; description?: string; snippets?: string[] }> } }).results?.web ?? [];
    const out: RetailListing[] = [];
    const seen = new Set<string>();
    for (const hit of web) {
      if (!hit.url) continue;
      const blob = [hit.title, hit.description, ...(hit.snippets ?? [])].filter(Boolean).join(" ");
      const match = blob.match(/\$(\d{2,5}(?:,\d{3})*(?:\.\d{2})?)/);
      if (!match) continue;
      const price = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(price) || price <= 0) continue;
      let retailer: string;
      try {
        retailer = new URL(hit.url).hostname.replace(/^www\./, "").split(".")[0] ?? "retailer";
      } catch {
        continue;
      }
      const keySeen = `${retailer}:${price}`;
      if (seen.has(keySeen)) continue;
      seen.add(keySeen);
      out.push({ retailer, price, currency: "USD", url: hit.url });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.warn(`You.com search unavailable (${String(e)}); skipping.`);
    return [];
  }
}

// Tolerant parse of shopping-result markup: merchant + price + link triplets.
// Split out so the (brittle) parse is testable on fixtures without the network.
export function parseShopping(html: string): RetailListing[] {
  const out: RetailListing[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="(\/url\?q=)?(https?:\/\/(?!www\.google)[^"&]+)[^"]*"[^>]*>[\s\S]{0,600}?\$([\d,]+(?:\.\d{2})?)[\s\S]{0,600}?(?:<\/a>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) {
    const url = m[2];
    const price = Number(m[3].replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    let retailer: string;
    try {
      retailer = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
    } catch {
      continue;
    }
    const key = `${retailer}:${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ retailer, price, currency: "USD", url });
  }
  return out;
}

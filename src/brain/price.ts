import type { Comp, ItemAttributes, PlatformStat, PriceSuggestion, RetailListing } from "../types.js";

const round = (x: number) => Math.round(x * 100) / 100;
const dollars = (x: number) => Math.max(1, Math.round(x));

const RESALE_OF_NEW: Record<ItemAttributes["condition"], { lo: number; hi: number }> = {
  NWT: { lo: 0.5, hi: 0.8 },
  "like-new": { lo: 0.35, hi: 0.65 },
  good: { lo: 0.22, hi: 0.48 },
  fair: { lo: 0.1, hi: 0.28 },
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return s[i];
}

// Cross-platform view: trimmed median + IQR per source, so the seller can see
// where the item runs cheap or dear. Does not change the suggested price (that
// stays eBay-anchored, since `post` lists to eBay).
export function compareByPlatform(comps: Comp[]): PlatformStat[] {
  const groups = new Map<Comp["source"], number[]>();
  for (const c of comps) {
    const g = groups.get(c.source) ?? [];
    g.push(c.price);
    groups.set(c.source, g);
  }
  const out: PlatformStat[] = [];
  for (const [source, prices] of groups) {
    if (!prices.length) continue;
    const lo = percentile(prices, 0.1);
    const hi = percentile(prices, 0.9);
    const trimmed = prices.filter((p) => p >= lo && p <= hi);
    const pool = trimmed.length ? trimmed : prices;
    out.push({
      source,
      median: round(median(pool)),
      low: round(percentile(pool, 0.25)),
      high: round(percentile(pool, 0.75)),
      n: prices.length,
    });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

// Trim outliers, then anchor to the sold-comp median if we have sold data,
// otherwise discount active-listing prices (asks run above sale prices).
export function priceFromComps(comps: Comp[]): PriceSuggestion {
  const currency = comps[0]?.currency ?? "USD";
  const sold = comps.filter((c) => c.source === "ebay-sold").map((c) => c.price);
  const active = comps.filter((c) => c.source === "ebay-active").map((c) => c.price);

  const useSold = sold.length >= 3;
  const pool = useSold ? sold : active;

  if (pool.length === 0) {
    return {
      suggested: 0,
      low: 0,
      high: 0,
      currency,
      basis: "No comps found. List manually or broaden keywords.",
      sampleSize: 0,
    };
  }

  // drop the extreme 10% each side to kill junk listings
  const lo = percentile(pool, 0.1);
  const hi = percentile(pool, 0.9);
  const trimmed = pool.filter((p) => p >= lo && p <= hi);
  const base = median(trimmed.length ? trimmed : pool);

  // active asks sell for less than listed; nudge down when that's all we have
  const suggested = useSold ? base : Math.round(base * 0.85 * 100) / 100;

  return {
    suggested,
    low: Math.round(percentile(trimmed, 0.25) * 100) / 100,
    high: Math.round(percentile(trimmed, 0.75) * 100) / 100,
    currency,
    basis: useSold
      ? `Median of ${sold.length} sold comps (10% trimmed).`
      : `No sold data; median of ${active.length} active asks, discounted 15%.`,
    sampleSize: pool.length,
  };
}

/** Resale band from the photo estimate, or a haircut of new/original retail. */
export function priceFromAnchors(
  attrs: Pick<ItemAttributes, "condition" | "originalRetail" | "resaleLow" | "resaleHigh">,
  retail: Pick<RetailListing, "price">[] = [],
): PriceSuggestion | null {
  const extractedLow = Number(attrs.resaleLow);
  const extractedHigh = Number(attrs.resaleHigh);
  if (extractedLow > 0 && extractedHigh >= extractedLow) {
    const low = dollars(extractedLow);
    const high = dollars(extractedHigh);
    return {
      suggested: dollars((low + high) / 2),
      low,
      high,
      currency: "USD",
      basis: "Estimated resale range from the photographs; no sold comps.",
      sampleSize: 0,
    };
  }

  const news = retail.map((row) => row.price).filter((price) => price > 0);
  const anchor = news.length ? median(news) : attrs.originalRetail;
  if (!anchor || anchor <= 0) return null;
  const { lo, hi } = RESALE_OF_NEW[attrs.condition];
  const low = dollars(anchor * lo);
  const high = Math.max(low + 1, dollars(anchor * hi));
  return {
    suggested: dollars((low + high) / 2),
    low,
    high,
    currency: "USD",
    basis: news.length
      ? `Estimated from ${news.length} new-retail asks (median $${dollars(median(news))}); no sold comps.`
      : `Estimated from original retail ($${dollars(anchor)}); no sold comps.`,
    sampleSize: 0,
  };
}

export function resolvePrice(
  comps: Comp[],
  attrs: Pick<ItemAttributes, "condition" | "originalRetail" | "resaleLow" | "resaleHigh">,
  retail: Pick<RetailListing, "price">[] = [],
): PriceSuggestion {
  const fromComps = priceFromComps(comps);
  if (fromComps.suggested > 0) return fromComps;
  return priceFromAnchors(attrs, retail) ?? fromComps;
}

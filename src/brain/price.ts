import type { Comp, PlatformStat, PriceSuggestion } from "../types.js";

const round = (x: number) => Math.round(x * 100) / 100;

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

import { cfg } from "../config.js";
import { getAppToken } from "./auth.js";
import type { Comp, ItemAttributes } from "../types.js";

// Maps our internal condition to eBay's condition filter IDs.
// 1000 New, 1500 New other, 3000 Used, 2500 Seller refurbished.
function conditionFilter(c: ItemAttributes["condition"]): string {
  switch (c) {
    case "NWT":
      return "1000|1500";
    default:
      return "3000";
  }
}

function buildQuery(a: ItemAttributes): string {
  return [a.brand, ...a.titleKeywords, a.size]
    .filter(Boolean)
    .join(" ")
    .trim();
}

// Active-listing comps via the Browse API. This is the app-token path that
// works as soon as you have production Browse access.
//
// NOTE: these are ASKING prices, not sold prices. For true sold comps you need
// the Marketplace Insights API (getItemSalesReport), which is separately gated.
// See getSoldComps below for the stub.
export async function getActiveComps(
  a: ItemAttributes,
  limit = 25
): Promise<Comp[]> {
  const token = await getAppToken();
  const q = buildQuery(a);
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    filter: `conditionIds:{${conditionFilter(a.condition)}}`,
    sort: "price",
  });

  const res = await fetch(
    `${cfg.apiBase}/buy/browse/v1/item_summary/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    }
  );
  if (!res.ok) throw new Error(`browse search failed: ${res.status} ${await res.text()}`);

  const j = (await res.json()) as {
    itemSummaries?: Array<{
      title: string;
      price?: { value: string; currency: string };
      condition?: string;
      itemWebUrl: string;
    }>;
  };

  return (j.itemSummaries ?? [])
    .filter((it) => it.price)
    .map((it) => ({
      title: it.title,
      price: Number(it.price!.value),
      currency: it.price!.currency,
      condition: it.condition ?? null,
      url: it.itemWebUrl,
      source: "ebay-active" as const,
    }));
}

// Sold comps via the Marketplace Insights API. This code is complete but DORMANT:
// the buy.marketplace.insights scope is gated, so the token call fails until eBay
// approves your app. Set EBAY_INSIGHTS=1 only after approval; until then this
// returns [] and pricing falls back to discounted active asks.
// ponytail: env flag is the on-switch; no code change needed once approved.
const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

export async function getSoldComps(a: ItemAttributes, limit = 25): Promise<Comp[]> {
  if (!process.env.EBAY_INSIGHTS) return [];

  const token = await getAppToken(INSIGHTS_SCOPE);
  const params = new URLSearchParams({
    q: buildQuery(a),
    limit: String(limit),
    filter: `conditionIds:{${conditionFilter(a.condition)}}`,
  });

  const res = await fetch(
    `${cfg.apiBase}/buy/marketplace_insights/v1_beta/item_sales/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } }
  );
  if (!res.ok) throw new Error(`insights search failed: ${res.status} ${await res.text()}`);

  const j = (await res.json()) as {
    itemSales?: Array<{
      title: string;
      lastSoldPrice?: { value: string; currency: string };
      condition?: string;
      itemWebUrl: string;
    }>;
  };

  return (j.itemSales ?? [])
    .filter((it) => it.lastSoldPrice)
    .map((it) => ({
      title: it.title,
      price: Number(it.lastSoldPrice!.value),
      currency: it.lastSoldPrice!.currency,
      condition: it.condition ?? null,
      url: it.itemWebUrl,
      source: "ebay-sold" as const,
    }));
}

import { cfg } from "../config.js";
import { getUserToken } from "./auth.js";
import type { ListingDraft } from "../types.js";

// eBay condition enums for the Inventory API.
function ebayConditionEnum(c: ListingDraft["condition"]): string {
  switch (c) {
    case "NWT":
      return "NEW_WITH_TAGS";
    case "like-new":
      return "LIKE_NEW";
    case "good":
      return "USED_EXCELLENT";
    case "fair":
      return "USED_GOOD";
  }
}

async function ebayFetch(path: string, init: RequestInit) {
  const token = await getUserToken();
  const res = await fetch(`${cfg.apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

export interface PostOptions {
  sku: string;
  imageUrls: string[];        // must be publicly reachable URLs
  quantity?: number;
  categoryId: string;         // eBay leaf category id
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

// Three-step publish: inventory item -> offer -> publish.
// Assumes you have already created business policies and a merchant location
// (one-time setup via the Account API or Seller Hub). See README.
export async function publishListing(
  draft: ListingDraft,
  opts: PostOptions
): Promise<{ offerId: string; listingId: string }> {
  // 1. inventory item (keyed by SKU)
  await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(opts.sku)}`, {
    method: "PUT",
    body: JSON.stringify({
      availability: { shipToLocationAvailability: { quantity: opts.quantity ?? 1 } },
      condition: ebayConditionEnum(draft.condition),
      product: {
        title: draft.title,
        description: draft.description,
        imageUrls: opts.imageUrls,
      },
    }),
  });

  // 2. offer
  const offer = await ebayFetch(`/sell/inventory/v1/offer`, {
    method: "POST",
    body: JSON.stringify({
      sku: opts.sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: opts.quantity ?? 1,
      categoryId: opts.categoryId,
      listingDescription: draft.description,
      pricingSummary: { price: { value: draft.price.toFixed(2), currency: "USD" } },
      listingPolicies: {
        fulfillmentPolicyId: opts.fulfillmentPolicyId,
        paymentPolicyId: opts.paymentPolicyId,
        returnPolicyId: opts.returnPolicyId,
      },
      merchantLocationKey: opts.merchantLocationKey,
    }),
  });

  // 3. publish
  const published = await ebayFetch(
    `/sell/inventory/v1/offer/${offer.offerId}/publish`,
    { method: "POST" }
  );

  return { offerId: offer.offerId, listingId: published.listingId };
}

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${cfg.apiBase}${path}`, {
      ...init,
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
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

interface ExistingOffer {
  offerId: string;
  listingId?: string;
  status?: string;
}

async function existingOffers(sku: string): Promise<ExistingOffer[]> {
  const result = await ebayFetch(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, { method: "GET" });
  const offers = (result as { offers?: unknown })?.offers;
  if (!Array.isArray(offers)) return [];
  return offers.flatMap((raw): ExistingOffer[] => {
    if (!raw || typeof raw !== "object") return [];
    const offer = raw as Record<string, unknown>;
    if (typeof offer.offerId !== "string" || !offer.offerId) return [];
    return [{
      offerId: offer.offerId,
      listingId: typeof offer.listingId === "string" ? offer.listingId : undefined,
      status: typeof offer.status === "string" ? offer.status : undefined,
    }];
  });
}

// Three-step publish: inventory item -> offer -> publish.
// Assumes you have already created business policies and a merchant location
// (one-time setup via the Account API or Seller Hub). See README.
export async function publishListing(
  draft: ListingDraft,
  opts: PostOptions
): Promise<{ offerId: string; listingId: string }> {
  // Stable GUI SKUs make retries detectable. Do not create a second offer when
  // eBay already has one for this SKU; an operator can inspect/reconcile it.
  const priorOffers = await existingOffers(opts.sku);
  const priorPublished = priorOffers.find((offer) => offer.status === "PUBLISHED" && offer.listingId);
  if (priorPublished?.listingId) return { offerId: priorPublished.offerId, listingId: priorPublished.listingId };
  if (priorOffers.length) {
    throw new Error(`eBay already has an offer for SKU ${opts.sku}; inspect it before retrying to avoid a duplicate.`);
  }

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
        ...(draft.itemSpecifics ? { aspects: draft.itemSpecifics } : {}),
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

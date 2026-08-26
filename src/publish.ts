import { publishListing, type PostOptions } from "./ebay/sell.js";
import { publishViaBrowser, type BrowserAutomationOptions, type BrowserPublishResult } from "./browser-automation.js";
import type { DraftBundle, ListingDraft, Platform } from "./types.js";

export interface EbayPublishSettings {
  sku?: string;
  imageUrls: string[];
  quantity?: number;
  categoryId?: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

export interface PublishRunOptions {
  draft: DraftBundle;
  photoPaths: string[];
  platforms?: Platform[];
  ebay?: EbayPublishSettings;
  browser?: BrowserAutomationOptions;
}

export type PublishStatus = "published" | "error" | "skipped";

export interface PlatformPublishResult {
  platform: Platform;
  status: PublishStatus;
  message: string;
  offerId?: string;
  listingId?: string;
  url?: string;
}

export interface PublishRunResult {
  results: PlatformPublishResult[];
}

export interface PublishDeps {
  publishEbay?: typeof publishListing;
  publishBrowser?: typeof publishViaBrowser;
}

function uniquePlatforms(platforms: Platform[]): Platform[] {
  const seen = new Set<Platform>();
  const out: Platform[] = [];
  for (const platform of platforms) {
    if (!seen.has(platform)) {
      seen.add(platform);
      out.push(platform);
    }
  }
  return out;
}

function listingForPlatform(draft: DraftBundle, platform: Platform): ListingDraft | null {
  return draft.listings.find((listing) => listing.platform === platform) ?? null;
}

function requireText(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`Missing required ${name}`);
  }
  return trimmed;
}

function toEbayOptions(draft: DraftBundle, ebay: EbayPublishSettings | undefined): PostOptions {
  const listing = listingForPlatform(draft, "ebay");
  const categoryId = ebay?.categoryId ?? listing?.categoryId ?? "";
  const imageUrls = ebay?.imageUrls ?? [];
  if (!imageUrls.length) {
    throw new Error("eBay publish requires public image URLs; paste them into the dashboard first.");
  }

  return {
    sku: ebay?.sku?.trim() || `resale-${Date.now()}`,
    imageUrls,
    quantity: ebay?.quantity ?? 1,
    categoryId: requireText(categoryId, "eBay categoryId"),
    merchantLocationKey: requireText(ebay?.merchantLocationKey, "eBay merchantLocationKey"),
    fulfillmentPolicyId: requireText(ebay?.fulfillmentPolicyId, "eBay fulfillmentPolicyId"),
    paymentPolicyId: requireText(ebay?.paymentPolicyId, "eBay paymentPolicyId"),
    returnPolicyId: requireText(ebay?.returnPolicyId, "eBay returnPolicyId"),
  };
}

export async function publishDraftBundle(
  opts: PublishRunOptions,
  deps: PublishDeps = {}
): Promise<PublishRunResult> {
  const publishEbay = deps.publishEbay ?? publishListing;
  const publishBrowser = deps.publishBrowser ?? publishViaBrowser;
  const targets = uniquePlatforms(opts.platforms ?? opts.draft.listings.map((listing) => listing.platform));
  const results: PlatformPublishResult[] = [];

  for (const platform of targets) {
    const listing = listingForPlatform(opts.draft, platform);
    if (!listing) {
      results.push({
        platform,
        status: "error",
        message: `No draft listing was generated for ${platform}`,
      });
      continue;
    }

    try {
      if (platform === "ebay") {
        const ebayOpts = toEbayOptions(opts.draft, opts.ebay);
        const published = await publishEbay(listing, ebayOpts);
        results.push({
          platform,
          status: "published",
          message: `eBay published: offer ${published.offerId}, listing ${published.listingId}`,
          offerId: published.offerId,
          listingId: published.listingId,
        });
      } else {
        if (!opts.photoPaths.length) {
          throw new Error(`Browser publishing for ${platform} needs the uploaded photo files from the draft step.`);
        }
        const browserResult: BrowserPublishResult = await publishBrowser(
          platform as Exclude<Platform, "ebay">,
          listing,
          opts.photoPaths,
          opts.browser
        );
        results.push({
          platform,
          status: "published",
          message: browserResult.message,
          url: browserResult.url,
        });
      }
    } catch (error) {
      results.push({
        platform,
        status: "error",
        message: String(error instanceof Error ? error.message : error),
      });
    }
  }

  return { results };
}

import { publishListing, type PostOptions } from "./ebay/sell.js";
import { publishViaBrowser, type BrowserAutomationOptions, type BrowserPublishResult } from "./browser-automation.js";
import { GUI_PLATFORMS, stableGuiSku } from "./gui-validation.js";
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
  /** Set by the GUI so retries use the same SKU and persisted result state. */
  draftId?: string;
  guiSkuPrefix?: string;
  previousResults?: PlatformPublishResult[];
}

export type PublishStatus = "published" | "error" | "unknown" | "skipped";

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

function selectedPlatforms(value: Platform[] | undefined, draft: DraftBundle): Platform[] {
  if (value === undefined) return uniquePlatforms(draft.listings.map((listing) => listing.platform));
  if (!Array.isArray(value) || value.length === 0) throw new Error("Select at least one platform.");
  const result: Platform[] = [];
  const seen = new Set<Platform>();
  for (const candidate of value) {
    if (!GUI_PLATFORMS.includes(candidate)) throw new Error(`Unsupported platform: ${String(candidate)}`);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  if (!result.length) throw new Error("Select at least one platform.");
  return result;
}

function listingForPlatform(draft: DraftBundle, platform: Platform): ListingDraft | null {
  return draft.listings.find((listing) => listing.platform === platform) ?? null;
}

function requireText(value: unknown, name: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`Missing required ${name}`);
  }
  if (trimmed.length > 256) throw new Error(`${name} is too long`);
  return trimmed;
}

export function validateHttpsImageUrls(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("eBay publish requires at least one public HTTPS image URL.");
  }
  if (value.length > 20) throw new Error("eBay accepts at most 20 image URLs here.");
  const urls: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || candidate.length > 2_048) {
      throw new Error("Each eBay image URL must be a short HTTPS URL.");
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`Invalid eBay image URL: ${candidate}`);
    }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error("eBay image URLs must use HTTPS and may not contain credentials.");
    }
    urls.push(parsed.toString());
  }
  return [...new Set(urls)];
}

export function toEbayOptions(
  draft: DraftBundle,
  ebay: EbayPublishSettings | undefined,
  draftId?: string,
  guiSkuPrefix = ""
): PostOptions {
  const listing = listingForPlatform(draft, "ebay");
  const categoryId = ebay?.categoryId ?? listing?.categoryId ?? "";
  const imageUrls = validateHttpsImageUrls(ebay?.imageUrls);
  const quantity = ebay?.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error("eBay quantity must be an integer between 1 and 100.");
  }
  const category = requireText(categoryId, "eBay categoryId");
  if (!/^\d+$/.test(category)) throw new Error("eBay categoryId must be numeric.");

  return {
    sku: draftId ? stableGuiSku(draftId, guiSkuPrefix) : (ebay?.sku?.trim() || `resale-${Date.now()}`),
    imageUrls,
    quantity,
    categoryId: category,
    merchantLocationKey: requireText(ebay?.merchantLocationKey, "eBay merchantLocationKey"),
    fulfillmentPolicyId: requireText(ebay?.fulfillmentPolicyId, "eBay fulfillmentPolicyId"),
    paymentPolicyId: requireText(ebay?.paymentPolicyId, "eBay paymentPolicyId"),
    returnPolicyId: requireText(ebay?.returnPolicyId, "eBay returnPolicyId"),
  };
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error);
}

function possiblyPublished(message: string): boolean {
  return /possibly published|timed? ?out|timeout|abort|network|fetch failed|econn|socket|connection/i.test(message);
}

function unknownMessage(platform: Platform, message: string): string {
  return `${platform} publish status is unknown; the request may have reached the platform. Verify the listing before retrying. ${message}`;
}

export async function publishDraftBundle(
  opts: PublishRunOptions,
  deps: PublishDeps = {}
): Promise<PublishRunResult> {
  const publishEbay = deps.publishEbay ?? publishListing;
  const publishBrowser = deps.publishBrowser ?? publishViaBrowser;
  const targets = selectedPlatforms(opts.platforms, opts.draft);
  const results: PlatformPublishResult[] = [];
  const previous = new Map((opts.previousResults ?? []).map((result) => [result.platform, result]));

  for (const platform of targets) {
    const prior = previous.get(platform);
    if (prior?.status === "published") {
      results.push({
        ...prior,
        status: "skipped",
        message: `${platform} was already published successfully; skipped retry.`,
      });
      continue;
    }

    const listing = listingForPlatform(opts.draft, platform);
    if (!listing) {
      results.push({
        platform,
        status: "error",
        message: `No draft listing was generated for ${platform}`,
      });
      continue;
    }

    if (platform !== "ebay" && (!Number.isFinite(listing.price) || listing.price <= 0)) {
      results.push({
        platform,
        status: "error",
        message: `${platform} needs a positive price before publishing; set it manually or use Copy listing.`,
      });
      continue;
    }

    let externalPublishAttempted = false;
    try {
      if (platform === "ebay") {
        const ebayOpts = toEbayOptions(opts.draft, opts.ebay, opts.draftId, opts.guiSkuPrefix);
        externalPublishAttempted = true;
        const published = await publishEbay(listing, ebayOpts);
        if (!published || typeof published.offerId !== "string" || !published.offerId || typeof published.listingId !== "string" || !published.listingId) {
          throw new Error("eBay returned no offer/listing identifiers after publish.");
        }
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
        externalPublishAttempted = true;
        const browserResult: BrowserPublishResult = await publishBrowser(
          platform as Exclude<Platform, "ebay">,
          listing,
          opts.photoPaths,
          opts.browser
        );
        results.push({
          platform,
          status: browserResult.status === "unknown" ? "unknown" : "published",
          message: browserResult.message,
          url: browserResult.url,
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      const unknown = possiblyPublished(message);
      const duplicateWarning = platform === "ebay" && externalPublishAttempted && !unknown
        ? " Verify eBay before retrying; an earlier API step may have been accepted."
        : "";
      results.push({
        platform,
        status: unknown ? "unknown" : "error",
        message: unknown ? unknownMessage(platform, message) : `${message}${duplicateWarning}`,
      });
    }
  }

  return { results };
}

import type { DraftBundle, ListingDraft, Platform } from "./types.js";

export const GUI_PLATFORMS: readonly Platform[] = ["ebay", "poshmark", "depop"];

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_CATEGORY_LENGTH = 32;

function cloneDraft(draft: DraftBundle): DraftBundle {
  return JSON.parse(JSON.stringify(draft)) as DraftBundle;
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && GUI_PLATFORMS.includes(value as Platform);
}

/**
 * Validate the platform list at the API boundary. An omitted list is handled
 * by the caller (the CLI intentionally retains its historical default).
 */
export function validatePlatformSelection(value: unknown): Platform[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Select at least one platform.");
  }

  const seen = new Set<Platform>();
  const result: Platform[] = [];
  for (const candidate of value) {
    if (!isPlatform(candidate)) {
      throw new Error(`Unsupported platform: ${String(candidate)}`);
    }
    if (!seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  if (!result.length) throw new Error("Select at least one platform.");
  return result;
}

function editableText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const result = value.trim();
  if (!result) throw new Error(`${name} cannot be empty.`);
  if (result.length > maxLength) throw new Error(`${name} is too long.`);
  return result;
}

function editablePrice(value: unknown, allowZero: boolean): number {
  const minimum = allowZero ? 0 : Number.MIN_VALUE;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > 1_000_000) {
    throw new Error(allowZero
      ? "Price must be a finite non-negative number no greater than 1,000,000."
      : "Price must be a finite positive number no greater than 1,000,000.");
  }
  return Math.round(value * 100) / 100;
}

/**
 * Merge only fields the review UI is allowed to edit into a server-owned
 * DraftBundle. Unknown fields are deliberately ignored; malformed editable
 * fields fail closed instead of partially changing the draft.
 */
export function mergeEditableListingFields(
  storedDraft: DraftBundle,
  submitted: unknown
): DraftBundle {
  if (!Array.isArray(submitted)) throw new Error("Listing edits must be an array.");

  const merged = cloneDraft(storedDraft);
  const byPlatform = new Map<Platform, ListingDraft>(
    merged.listings.map((listing) => [listing.platform, listing])
  );

  for (const patch of submitted) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("Each listing edit must be an object.");
    }
    const input = patch as Record<string, unknown>;
    if (!isPlatform(input.platform)) throw new Error(`Unsupported platform: ${String(input.platform)}`);
    const listing = byPlatform.get(input.platform);
    if (!listing) throw new Error(`No stored draft listing exists for ${input.platform}.`);

    if (Object.hasOwn(input, "title")) {
      listing.title = editableText(input.title, `${input.platform} title`, MAX_TITLE_LENGTH);
    }
    if (Object.hasOwn(input, "description")) {
      listing.description = editableText(input.description, `${input.platform} description`, MAX_DESCRIPTION_LENGTH);
    }
    if (Object.hasOwn(input, "price")) listing.price = editablePrice(input.price, input.platform !== "ebay");
    if (Object.hasOwn(input, "categoryId")) {
      if (input.platform !== "ebay") throw new Error("Only eBay may set categoryId.");
      if (typeof input.categoryId !== "string") throw new Error("eBay categoryId must be text.");
      const categoryId = input.categoryId.trim();
      if (!categoryId || categoryId.length > MAX_CATEGORY_LENGTH || !/^\d+$/.test(categoryId)) {
        throw new Error("eBay categoryId must be a numeric category id.");
      }
      listing.categoryId = categoryId;
    }
  }

  return merged;
}

export function stableGuiSku(draftId: string, configuredPrefix = ""): string {
  const safeId = draftId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
  const prefix = configuredPrefix.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12);
  const sku = `${prefix ? `${prefix}-` : "resale-gui-"}${safeId}`;
  return sku.slice(0, 50);
}

export type Platform = "ebay" | "poshmark";

export interface ItemAttributes {
  brand: string | null;
  category: string;
  titleKeywords: string[];
  size: string | null;
  color: string | null;
  material: string | null;
  condition: "NWT" | "like-new" | "good" | "fair";
  flaws: string[];
  originalRetail: number | null;
}

export interface Comp {
  title: string;
  price: number;
  currency: string;
  condition: string | null;
  url: string;
  source: "ebay-active" | "ebay-sold" | "poshmark-active";
}

// One row of the cross-platform price comparison (trimmed stats per source).
export interface PlatformStat {
  source: Comp["source"];
  median: number;
  low: number;
  high: number;
  n: number;
}

export interface PriceSuggestion {
  suggested: number;
  low: number;
  high: number;
  currency: string;
  basis: string;
  sampleSize: number;
}

export interface ListingDraft {
  platform: Platform;
  title: string;
  description: string;
  price: number;
  condition: ItemAttributes["condition"];
  // eBay-only, filled at draft time by the taxonomy step. Poshmark ignores these.
  categoryId?: string;
  itemSpecifics?: Record<string, string[]>;
}

export interface DraftBundle {
  attributes: ItemAttributes;
  price: PriceSuggestion;
  comps: Comp[];
  comparison: PlatformStat[];
  listings: ListingDraft[];
}

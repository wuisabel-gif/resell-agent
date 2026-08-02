import { cfg } from "../config.js";
import { getAppToken } from "./auth.js";

// eBay Taxonomy API: resolve a listing title to a leaf category, and fetch the
// item-specific aspects that category expects. App-token path, no user login.

export interface AspectSpec {
  name: string;
  required: boolean;
  values: string[]; // non-empty only for SELECTION_ONLY aspects
}

async function taxonomyGet(path: string): Promise<any> {
  const token = await getAppToken();
  const res = await fetch(`${cfg.apiBase}/commerce/taxonomy/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`taxonomy ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

let treeIdCache: string | null = null;
async function categoryTreeId(): Promise<string> {
  if (treeIdCache) return treeIdCache;
  const j = await taxonomyGet(`/get_default_category_tree_id?marketplace_id=EBAY_US`);
  treeIdCache = j.categoryTreeId as string;
  return treeIdCache;
}

// Best-effort: returns null if eBay can't suggest one (e.g. sandbox gaps), so the
// pipeline degrades to a manual --category flag instead of hard-failing.
export async function suggestCategory(
  title: string
): Promise<{ categoryId: string; categoryName: string } | null> {
  try {
    const tree = await categoryTreeId();
    const j = await taxonomyGet(
      `/category_tree/${tree}/get_category_suggestions?q=${encodeURIComponent(title)}`
    );
    const c = j.categorySuggestions?.[0]?.category;
    return c ? { categoryId: c.categoryId, categoryName: c.categoryName } : null;
  } catch (e) {
    console.warn(`category suggestion failed, continuing without: ${String(e)}`);
    return null;
  }
}

export async function getRequiredAspects(categoryId: string): Promise<AspectSpec[]> {
  try {
    const tree = await categoryTreeId();
    const j = await taxonomyGet(
      `/category_tree/${tree}/get_item_aspects_for_category?category_id=${categoryId}`
    );
    const specs: AspectSpec[] = (j.aspects ?? []).map((a: any) => ({
      name: a.localizedAspectName as string,
      required: Boolean(a.aspectConstraint?.aspectRequired),
      values:
        a.aspectConstraint?.aspectMode === "SELECTION_ONLY"
          ? (a.aspectValues ?? []).map((v: any) => v.localizedValue as string)
          : [],
    }));
    // Required first, then a few recommended, capped so the fill prompt stays small.
    return specs.sort((x, y) => Number(y.required) - Number(x.required)).slice(0, 20);
  } catch (e) {
    console.warn(`aspect fetch failed, listing without specifics: ${String(e)}`);
    return [];
  }
}

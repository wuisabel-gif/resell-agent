import { readFileSync } from "node:fs";
import { truthy } from "./env.js";

/** Azure Bing Visual Search. Official reverse-image from local photo bytes. */

export interface BingVisualGuess {
  label: string;
}

interface BingAction {
  actionType?: string;
  displayName?: string;
}

interface BingTag {
  displayName?: string;
  actions?: BingAction[];
}

export function parseBingVisualSearch(body: unknown): BingVisualGuess | null {
  const tags = (body as { tags?: BingTag[] })?.tags;
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    for (const action of tag.actions ?? []) {
      if (action.actionType === "BestRepresentativeQuery") {
        const name = action.displayName?.trim();
        if (name) return { label: name };
      }
    }
  }
  for (const tag of tags) {
    const name = tag.displayName?.trim();
    if (name) return { label: name };
  }
  return null;
}

export async function getBingVisualGuess(imagePath: string): Promise<BingVisualGuess | null> {
  const key = process.env.BING_VISUAL_SEARCH_KEY?.trim();
  if (!key) return null;
  if (process.env.ENABLE_BING_VISUAL_SEARCH !== undefined && !truthy(process.env.ENABLE_BING_VISUAL_SEARCH)) {
    return null;
  }
  const endpoint = (process.env.BING_VISUAL_SEARCH_ENDPOINT?.trim() || "https://api.bing.microsoft.com/v7.0/images/visualsearch").replace(/\/+$/, "");
  try {
    const form = new FormData();
    form.append("image", new Blob([readFileSync(imagePath)]), "photo.jpg");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key },
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    return parseBingVisualSearch(await res.json());
  } catch (e) {
    console.warn(`Bing Visual Search unavailable (${String(e)}); skipping.`);
    return null;
  }
}

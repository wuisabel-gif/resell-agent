import { UA } from "./sources.js";

// ─────────────────────────────────────────────────────────────────────────────
// Reverse-image brand lookup — UNOFFICIAL Google search-by-image scrape.
// Free, but: against Google's ToS, fragile (endpoint/markup change without notice),
// and frequently blocked or CAPTCHA'd. Off unless ENABLE_IMAGE_SEARCH=1.
// It needs the photo at a PUBLIC URL — Google fetches the image itself. Returns
// Google's "best guess" text, which the vision step then treats as a lead to
// confirm the brand (never as proof). Approach mirrors
// github.com/SOME-1HING/google-reverse-image-api, reduced to a dependency-free parse.
// ─────────────────────────────────────────────────────────────────────────────

export async function getImageGuess(imageUrl: string): Promise<string | null> {
  if (!process.env.ENABLE_IMAGE_SEARCH) return null;
  const url = `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}&hl=en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGuess(await res.text());
  } catch (e) {
    console.warn(
      `reverse-image search unavailable (${String(e)}); skipping. Unofficial/ToS-risky and often blocked.`
    );
    return null;
  }
}

// Pull Google's "best guess for this image" text out of the results HTML.
// Split out so the (brittle) parse is testable without the network.
export function parseGuess(html: string): string | null {
  const patterns = [
    /Best guess for this image[^<]*<\/[^>]+>\s*<a[^>]*>([^<]{2,90})<\/a>/i,
    /best guess[^:]*:\s*<[^>]*>\s*([^<]{2,90})</i,
    /"bestGuess"\s*:\s*"([^"]{2,90})"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return decode(m[1].trim());
  }
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]{2,90})"/i);
  if (og && !/^google/i.test(og[1])) return decode(og[1].trim());
  return null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

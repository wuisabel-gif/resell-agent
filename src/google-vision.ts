import { readFileSync } from "node:fs";
import { truthy } from "./env.js";

/** Official Google Cloud Vision web detection (reverse-image). Not the HTML scrape. */

export interface VisionWebGuess {
  label: string;
  entities: string[];
}

interface VisionWebDetection {
  bestGuessLabels?: Array<{ label?: string }>;
  webEntities?: Array<{ description?: string; score?: number }>;
}

export function parseWebDetection(body: unknown): VisionWebGuess | null {
  const responses = (body as { responses?: Array<{ webDetection?: VisionWebDetection }> })?.responses;
  const web = responses?.[0]?.webDetection;
  if (!web) return null;
  const label = web.bestGuessLabels?.map((row) => row.label?.trim()).find(Boolean)
    || web.webEntities?.filter((row) => row.description?.trim()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]?.description?.trim();
  if (!label) return null;
  const entities = (web.webEntities ?? [])
    .map((row) => row.description?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 5);
  return { label, entities };
}

export async function getGoogleVisionGuess(imagePath: string): Promise<VisionWebGuess | null> {
  const key = process.env.GOOGLE_VISION_API_KEY?.trim();
  if (!key) return null;
  if (process.env.ENABLE_GOOGLE_VISION !== undefined && !truthy(process.env.ENABLE_GOOGLE_VISION)) return null;
  try {
    const content = readFileSync(imagePath).toString("base64");
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content },
            features: [{ type: "WEB_DETECTION", maxResults: 8 }],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    return parseWebDetection(await res.json());
  } catch (e) {
    console.warn(`Google Vision reverse-image unavailable (${String(e)}); skipping.`);
    return null;
  }
}

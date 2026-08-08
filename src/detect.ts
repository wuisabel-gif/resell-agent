import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { complete, type Msg } from "./brain/anthropic.js";

// Multi-item detection. Claude vision returns a bounding box per sellable piece;
// each box is then cropped and run through the normal single-item pipeline.
export interface Detection {
  label: string;
  box: [number, number, number, number]; // x, y, w, h as fractions of the image, in [0,1]
}

const SYSTEM = `You are a resale item DETECTOR. Given one photo (a person wearing an
outfit, or a flat-lay), locate every distinct SELLABLE fashion item: dress, top,
trousers, skirt, coat, jacket, shoes, handbag, belt, sunglasses, hat, scarf, jewellery,
watch. Ignore the person's body, face, skin, and the background. One box per item; do
not box the whole person.
Reply with ONLY a JSON array. Each element: {"label": string, "box": [x, y, w, h]}
where x,y,w,h are the item's bounding box as fractions of the image width and height in
[0,1], and x,y is the top-left corner. No prose, no code fences.`;

function imageBlock(path: string) {
  const e = extname(path).toLowerCase();
  const mt = e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : e === ".gif" ? "image/gif" : "image/jpeg";
  return { type: "image" as const, source: { type: "base64" as const, media_type: mt, data: readFileSync(path).toString("base64") } };
}

export async function detectItems(imagePath: string): Promise<Detection[]> {
  const content: Msg["content"] = [imageBlock(imagePath), { type: "text", text: "Detect the sellable items as a JSON array." }];
  return parseDetections(await complete(SYSTEM, [{ role: "user", content }], 900));
}

// Pull the JSON array out of the model reply, tolerantly. Split out so it's testable.
export function parseDetections(raw: string): Detection[] {
  const m = raw.match(/\[[\s\S]*\]/);
  let arr: unknown;
  try {
    arr = JSON.parse(m ? m[0] : raw);
  } catch {
    return [];
  }
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const out: Detection[] = [];
  for (const d of Array.isArray(arr) ? arr : []) {
    const b = (d as any)?.box;
    if (!Array.isArray(b) || b.length !== 4) continue;
    const nums = b.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    let [x, y, w, h] = nums.map(clamp);
    if (w <= 0 || h <= 0) continue;
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    out.push({ label: String((d as any).label ?? "item").trim() || "item", box: [x, y, w, h] });
  }
  return out;
}

// Normalised box -> integer pixel rect (with optional padding), clamped in-bounds.
// Pure, so the crop math is testable without an image.
export function boxToRect(
  box: [number, number, number, number],
  W: number,
  H: number,
  pad = 0.04
): { left: number; top: number; width: number; height: number } {
  let [x, y, w, h] = box;
  x = Math.max(0, x - pad);
  y = Math.max(0, y - pad);
  w = Math.min(1 - x, w + 2 * pad);
  h = Math.min(1 - y, h + 2 * pad);
  const left = Math.round(x * W);
  const top = Math.round(y * H);
  const width = Math.max(1, Math.min(W - left, Math.round(w * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(h * H)));
  return { left, top, width, height };
}

// Crop one detected region to its own file for the single-item pipeline.
export async function cropRegion(imagePath: string, box: Detection["box"], outPath: string): Promise<string> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(imagePath).metadata();
  const rect = boxToRect(box, meta.width ?? 0, meta.height ?? 0);
  await sharp(imagePath).extract(rect).toFile(outPath);
  return outPath;
}

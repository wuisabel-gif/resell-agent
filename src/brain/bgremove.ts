import { writeFileSync } from "node:fs";
import { extname } from "node:path";
import { removeBackground } from "@imgly/background-removal-node";

// Strip the background from a product photo. Outputs a transparent PNG, which is
// what eBay wants — its product view composites onto white, so no white-fill step
// is needed here. ponytail: add white compositing only if a category rejects alpha.
// Transparent padding kept around the item after cropping, in pixels.
const PAD = 24;

export async function cleanPhoto(path: string, outPath = cleanPath(path)): Promise<string> {
  let blob: Blob;
  try {
    blob = await removeBackground(path);
  } catch (e) {
    // Almost always the native deps (sharp/onnxruntime-node) not built or the
    // first-run model download failing — not a bug in this code. Say so plainly.
    throw new Error(
      `Background removal failed for ${path}: ${e instanceof Error ? e.message : e}\n` +
        "Fix: reinstall approving build scripts (native deps need them), and ensure " +
        "network access for the first-run model download. Or drop --clean to skip it."
    );
  }
  const cutout = Buffer.from(await blob.arrayBuffer());
  writeFileSync(outPath, await autoCrop(cutout));
  return outPath;
}

// Auto-crop: the cutout is transparent outside the item, so trimming the
// transparent border crops tight to the subject. Best-effort — if sharp isn't
// available or trims to nothing, fall back to the uncropped cutout.
async function autoCrop(png: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(png)
      .trim()
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (e) {
    console.warn(`auto-crop skipped (${String(e)}); using uncropped cutout.`);
    return png;
  }
}

export function cleanPath(path: string): string {
  return path.slice(0, path.length - extname(path).length) + ".clean.png";
}

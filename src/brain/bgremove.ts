import { writeFileSync } from "node:fs";
import { extname } from "node:path";
import { removeBackground } from "@imgly/background-removal-node";

// Strip the background from a product photo. Outputs a transparent PNG, which is
// what eBay wants — its product view composites onto white, so no white-fill step
// is needed here. ponytail: add white compositing only if a category rejects alpha.
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
  writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()));
  return outPath;
}

export function cleanPath(path: string): string {
  return path.slice(0, path.length - extname(path).length) + ".clean.png";
}

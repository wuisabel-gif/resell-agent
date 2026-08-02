import { writeFileSync } from "node:fs";
import { extname } from "node:path";
import { removeBackground } from "@imgly/background-removal-node";

// Strip the background from a product photo. Outputs a transparent PNG, which is
// what eBay wants — its product view composites onto white, so no white-fill step
// is needed here. ponytail: add white compositing only if a category rejects alpha.
export async function cleanPhoto(path: string, outPath = cleanPath(path)): Promise<string> {
  const blob = await removeBackground(path);
  writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()));
  return outPath;
}

export function cleanPath(path: string): string {
  return path.slice(0, path.length - extname(path).length) + ".clean.png";
}

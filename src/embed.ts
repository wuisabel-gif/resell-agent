// Shared CLIP image embedder (transformers.js), used to build the reference index
// and to embed a query photo. Model loads once and is reused. Optional dependency:
// only pulled in when brand matching is enabled.

let extractorP: Promise<any> | null = null;

async function extractor(): Promise<any> {
  if (!extractorP) {
    // @ts-ignore optional dependency, resolved at runtime
    const mod: any = await import("@xenova/transformers");
    extractorP = mod.pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32");
  }
  return extractorP;
}

// Returns the raw CLIP image embedding as a plain number[]. Cosine handles
// normalisation, so no need to unit-scale here.
export async function embedImage(path: string): Promise<number[]> {
  const ex = await extractor();
  const out = await ex(path);
  return Array.from(out.data as Float32Array);
}

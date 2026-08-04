import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname, basename, relative } from "node:path";
import { embedImage } from "./embed.js";

// A flat nearest-neighbour index over your own reference product photos. Brute-force
// cosine is plenty for thousands of entries; reach for a vector DB (milvus, etc.) only
// past that. Label = the immediate parent folder (refs/<Brand>/img.jpg), or the part
// of the filename before "__" (Coach__messenger.jpg).

export interface IndexEntry {
  label: string;
  file: string;
  vec: number[];
}
export interface NNIndex {
  model: string;
  entries: IndexEntry[];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function search(
  index: NNIndex,
  q: number[],
  k = 3
): { label: string; file: string; score: number }[] {
  return index.entries
    .map((e) => ({ label: e.label, file: e.file, score: cosine(q, e.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

const IMG = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (IMG.has(extname(name).toLowerCase())) out.push(full);
  }
  return out;
}

export function labelFor(root: string, file: string): string {
  const parts = relative(root, file).split(/[\\/]/);
  if (parts.length > 1) return parts[0]; // refs/<Brand>/...
  return basename(file, extname(file)).split("__")[0]; // Brand__desc.jpg
}

export async function buildIndex(root: string): Promise<NNIndex> {
  const files = walk(root);
  const entries: IndexEntry[] = [];
  for (const f of files) {
    entries.push({ label: labelFor(root, f), file: relative(root, f), vec: await embedImage(f) });
  }
  return { model: "Xenova/clip-vit-base-patch32", entries };
}

export function loadIndex(path: string): NNIndex {
  return JSON.parse(readFileSync(path, "utf8")) as NNIndex;
}
export function saveIndex(path: string, idx: NNIndex): void {
  writeFileSync(path, JSON.stringify(idx));
}

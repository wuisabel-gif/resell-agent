import { extname } from "node:path";
import { detectItems, cropRegion, boxToRect, type Detection } from "./detect.js";
import { buildDraft } from "./pipeline.js";
import type { DraftBundle, Platform } from "./types.js";

export interface OutfitItem {
  label: string;
  box: Detection["box"];
  crop: string;
  draft: DraftBundle;
}

// Detect every sellable piece, then run the full single-item pipeline on each crop.
export async function buildOutfit(
  photoPath: string,
  notes = "",
  platforms: Platform[] = ["ebay", "poshmark"]
): Promise<OutfitItem[]> {
  const dets = await detectItems(photoPath);
  const base = photoPath.slice(0, photoPath.length - extname(photoPath).length);
  const items: OutfitItem[] = [];
  for (let i = 0; i < dets.length; i++) {
    const crop = `${base}.item${i + 1}.png`;
    await cropRegion(photoPath, dets[i].box, crop);
    const draft = await buildDraft([crop], `${notes} [detected: ${dets[i].label}]`.trim(), platforms);
    items.push({ label: dets[i].label, box: dets[i].box, crop, draft });
  }
  return items;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Build a detection overlay SVG from the REAL boxes + each item's real brand/price.
// Same look as the marketing graphics, but this one is genuine tool output.
export async function renderDetectionSvg(photoPath: string, items: OutfitItem[]): Promise<string> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(photoPath).metadata();
  const W = meta.width ?? 1000, H = meta.height ?? 1000;
  const jpg = await sharp(photoPath).resize(Math.min(880, W)).jpeg({ quality: 74 }).toBuffer();
  const uri = `data:image/jpeg;base64,${jpg.toString("base64")}`;

  const groups = items
    .map((it, i) => {
      const r = boxToRect(it.box, W, H, 0);
      const p = it.draft.price;
      const price = p.suggested > 0 ? `$${p.low}-${p.high}` : "set manually";
      const a = it.draft.attributes;
      const brand = a.brand ? `${esc(a.brand)}${a.brandInferred ? " · verify" : ""}` : "no confident match";
      const tw = 320;
      const ty = Math.max(52, r.top) - 6;
      return `<g class="det d${(i % 4) + 1}">
        <rect class="bx" x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" rx="3"/>
        <g transform="translate(${Math.min(r.left, W - tw - 8)},${ty})">
          <rect class="tag" x="0" y="-44" width="${tw}" height="60" rx="3"/>
          <text class="name" x="14" y="-18">${esc(it.label)}</text>
          <text class="conf" x="${tw - 96}" y="-19">${price}</text>
          <text class="brand" x="14" y="8">brand · ${brand}</text>
        </g></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="resell-agent detected ${items.length} pieces">
  <defs><style>
    .name{font-family:Georgia,serif;font-size:20px;fill:#f4f1e8}
    .conf{font-family:Arial,sans-serif;font-size:15px;fill:#c79a4a}
    .brand{font-family:Arial,sans-serif;font-size:14.5px;fill:#e6c06a}
    .bx{fill:#c79a4a;fill-opacity:0.05;stroke:#c79a4a;stroke-width:3}
    .tag{fill:#241423;fill-opacity:0.95}
    .det{opacity:1;transform-box:fill-box;transform-origin:center}
    @media (prefers-reduced-motion:no-preference){
      .det{animation:reveal 8s ease-in-out infinite}
      .d1{animation-delay:0s}.d2{animation-delay:.8s}.d3{animation-delay:1.6s}.d4{animation-delay:2.4s}
    }
    @keyframes reveal{0%{opacity:0}6%{opacity:1}80%{opacity:1}90%,100%{opacity:0}}
  </style></defs>
  <image href="${uri}" x="0" y="0" width="${W}" height="${H}"/>
  ${groups}
</svg>`;
}

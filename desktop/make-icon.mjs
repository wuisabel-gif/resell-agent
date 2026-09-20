import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = join(dirname(fileURLToPath(import.meta.url)), "icon.png");
await mkdir(dirname(out), { recursive: true });

const base = await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: { r: 42, g: 27, b: 46, alpha: 1 },
  },
}).png().toBuffer();

const bar = await sharp({
  create: {
    width: 420,
    height: 36,
    channels: 4,
    background: { r: 212, g: 179, b: 106, alpha: 1 },
  },
}).png().toBuffer();

const dot = await sharp({
  create: {
    width: 72,
    height: 72,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><circle cx="36" cy="36" r="36" fill="#D4B36A"/></svg>`,
      ),
    },
  ])
  .png()
  .toBuffer();

await sharp(base)
  .composite([
    { input: bar, top: 494, left: 220 },
    { input: dot, top: 476, left: 668 },
  ])
  .png()
  .toFile(out);

console.log(`wrote ${out}`);

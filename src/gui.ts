import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { buildDraft } from "./pipeline.js";
import { publishDraftBundle, validateHttpsImageUrls, type EbayPublishSettings, type PlatformPublishResult } from "./publish.js";
import { buildGuiScript, type GuiBootState } from "./gui-client.js";
import { GUI_PLATFORMS, mergeEditableListingFields, validatePlatformSelection } from "./gui-validation.js";
import { truthy } from "./env.js";
import type { DraftBundle, Platform } from "./types.js";

interface UploadedPhoto {
  name: string;
  path: string;
  mimeType: string;
}

interface DraftRecord {
  draftId: string;
  draft: DraftBundle;
  photoPaths: string[];
  photos: UploadedPhoto[];
  createdAt: string;
  updatedAt: string;
  publishResults: PlatformPublishResult[];
  ebay?: EbayPublishSettings;
  guiSkuPrefix?: string;
}

const drafts = new Map<string, DraftRecord>();
const DATA_DIR = process.env.GUI_DATA_DIR?.trim() || join(tmpdir(), "resell-agent-gui");
export const GUI_MAX_REQUEST_BYTES = 40 * 1024 * 1024;
export const GUI_MAX_PHOTO_COUNT = 12;
export const GUI_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const GUI_MAX_TOTAL_PHOTO_BYTES = 30 * 1024 * 1024;
const configuredDraftTtl = Number(process.env.GUI_DRAFT_TTL_MS ?? "");
export const GUI_DRAFT_TTL_MS = Number.isFinite(configuredDraftTtl) && configuredDraftTtl >= 60_000
  ? configuredDraftTtl
  : 24 * 60 * 60 * 1000;
const GUI_MAX_JSON_BYTES = 2 * 1024 * 1024;
const GUI_MAX_IMAGE_PIXELS = 40_000_000;
const GUI_DIR_RE = /^[a-zA-Z0-9-]{20,64}$/;
let activeGuiServer: ReturnType<typeof createServer> | null = null;
const activePublishes = new Set<string>();

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

class BodyTooLargeError extends HttpError {
  constructor() {
    super(413, "Request body exceeds the GUI limit.");
  }
}

async function collectBody(req: IncomingMessage, limit = GUI_MAX_REQUEST_BYTES): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new BodyTooLargeError();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      req.resume();
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function headersToWebHeaders(headers: IncomingMessage["headers"]): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      out.set(key, value);
    } else if (Array.isArray(value)) {
      out.set(key, value.join(", "));
    }
  }
  return out;
}

async function parseJsonBody(req: IncomingMessage): Promise<any> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (contentType.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "Expected an application/json request.");
  const body = await collectBody(req, GUI_MAX_JSON_BYTES);
  if (!body.length) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "Malformed JSON request.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "JSON request must be an object.");
  }
  return parsed;
}

async function parseFormData(req: IncomingMessage): Promise<FormData> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (contentType.split(";", 1)[0].trim() !== "multipart/form-data") {
    throw new HttpError(415, "Expected a multipart/form-data request.");
  }
  const body = await collectBody(req);
  try {
    const request = new Request("http://localhost/", {
      method: req.method ?? "POST",
      headers: headersToWebHeaders(req.headers),
      body: new Blob([new Uint8Array(body)]),
    });
    return await request.formData();
  } catch {
    throw new HttpError(400, "Malformed multipart form data.");
  }
}

async function ensureDraftDir(draftId: string): Promise<string> {
  const dir = join(DATA_DIR, draftId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

function platformLabels(platforms: Platform[]): Record<Platform, string> {
  const labels: Record<Platform, string> = {
    ebay: "eBay",
    poshmark: "Poshmark",
    depop: "Depop",
  };
  return Object.fromEntries(platforms.map((platform) => [platform, labels[platform]])) as Record<Platform, string>;
}

function renderPage(boot: GuiBootState): string {
  const labels = platformLabels(boot.platforms);
  const platformChecks = boot.platforms
    .map(
      (platform) => `
        <label class="check">
          <input type="checkbox" name="platforms" value="${platform}" checked>
          <span>${labels[platform]}</span>
        </label>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>resell-agent GUI</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #100f14;
      --panel: #191723;
      --panel-2: #221f2d;
      --line: #353144;
      --text: #f4f1e8;
      --muted: #a9a1b6;
      --gold: #c79a4a;
      --green: #79c98b;
      --red: #ef767a;
      --blue: #7fb3ff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top, #1d1a29 0, var(--bg) 48%);
      color: var(--text);
      line-height: 1.45;
    }
    a { color: var(--gold); }
    header {
      border-bottom: 1px solid var(--line);
      background: rgba(16, 15, 20, 0.88);
      backdrop-filter: blur(10px);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    .wrap {
      width: min(1200px, calc(100% - 2rem));
      margin: 0 auto;
      padding: 1rem 0;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .brand b { font-size: 1.1rem; letter-spacing: 0.02em; }
    .brand span, .muted { color: var(--muted); }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.4rem 0.65rem;
      border-radius: 999px;
      background: var(--panel-2);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.88rem;
    }
    main { padding: 1.25rem 0 3rem; }
    .grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: 1.2fr 0.8fr;
      align-items: start;
    }
    .card {
      background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 1rem;
      box-shadow: 0 12px 36px rgba(0,0,0,0.22);
    }
    .card + .card { margin-top: 1rem; }
    h1, h2, h3 { margin: 0 0 0.6rem; line-height: 1.15; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); }
    h2 { font-size: 1.35rem; }
    h3 { font-size: 1.05rem; }
    p { margin: 0.4rem 0 0.9rem; }
    form { display: grid; gap: 1rem; }
    label { display: grid; gap: 0.35rem; font-weight: 600; }
    input[type="text"], input[type="url"], input[type="number"], textarea {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: #111019;
      color: var(--text);
      padding: 0.78rem 0.9rem;
      font: inherit;
    }
    input[type="file"] {
      width: 100%;
      border-radius: 12px;
      border: 1px dashed var(--line);
      background: #111019;
      color: var(--text);
      padding: 0.75rem;
    }
    textarea { resize: vertical; }
    fieldset {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 0.9rem;
      margin: 0;
      display: grid;
      gap: 0.6rem;
    }
    legend { padding: 0 0.35rem; color: var(--muted); }
    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1rem;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 500;
      color: var(--text);
    }
    .check input { width: 1rem; height: 1rem; }
    .two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.9rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 0.85rem 1.1rem;
      background: var(--gold);
      color: #1b1220;
      font-weight: 700;
      cursor: pointer;
    }
    button.secondary {
      background: #2a2536;
      color: var(--text);
      border: 1px solid var(--line);
    }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    #global-status {
      margin-top: 0.85rem;
      padding: 0.8rem 0.9rem;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: #111019;
    }
    #global-status[data-kind="success"] { border-color: rgba(121, 201, 139, 0.55); color: var(--green); }
    #global-status[data-kind="error"] { border-color: rgba(239, 118, 122, 0.55); color: var(--red); }
    #global-status[data-kind="info"] { border-color: rgba(127, 179, 255, 0.55); color: var(--blue); }
    .photo-strip {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      align-items: start;
    }
    .thumb {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      background: #111019;
    }
    .thumb img { width: 100%; height: 120px; object-fit: cover; display: block; }
    .thumb figcaption { padding: 0.45rem 0.6rem; font-size: 0.86rem; color: var(--muted); }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
      gap: 0.65rem;
      margin-bottom: 1rem;
    }
    .summary-item {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 0.7rem;
      background: #111019;
      display: grid;
      gap: 0.2rem;
    }
    .summary-item span { color: var(--muted); font-size: 0.82rem; }
    .summary-item strong { font-size: 0.98rem; }
    .table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid var(--line);
    }
    .table th, .table td {
      padding: 0.65rem 0.7rem;
      text-align: left;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    .table th { color: var(--muted); font-weight: 600; background: #111019; }
    .retail-list { margin: 0.4rem 0 0; padding-left: 1.1rem; }
    .listing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
    }
    .listing-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #111019;
      padding: 0.95rem;
      display: grid;
      gap: 0.75rem;
    }
    .listing-card header {
      position: static;
      border: 0;
      background: transparent;
      backdrop-filter: none;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0;
    }
    .publish-status {
      padding: 0.38rem 0.6rem;
      border-radius: 999px;
      border: 1px solid var(--line);
      color: var(--muted);
      align-self: start;
      font-size: 0.84rem;
      white-space: nowrap;
    }
    .publish-status[data-kind="published"] { border-color: rgba(121, 201, 139, 0.55); color: var(--green); }
    .publish-status[data-kind="error"], .publish-status[data-kind="unknown"] { border-color: rgba(239, 118, 122, 0.55); color: var(--red); }
    .publish-status[data-kind="skipped"] { border-color: rgba(127, 179, 255, 0.55); color: var(--blue); }
    .listing-card details { border: 1px solid var(--line); border-radius: 12px; padding: 0.55rem 0.7rem; }
    .listing-card pre { margin: 0.5rem 0 0; white-space: pre-wrap; word-break: break-word; font-size: 0.84rem; color: var(--muted); }
    .muted { color: var(--muted); }
    .results { display: grid; gap: 0.55rem; }
    .result {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 0.7rem 0.8rem;
      background: #111019;
    }
    .result.published { border-color: rgba(121, 201, 139, 0.55); }
    .result.error, .result.unknown { border-color: rgba(239, 118, 122, 0.55); }
    .result.skipped { border-color: rgba(127, 179, 255, 0.55); }
    .form-note {
      border: 1px dashed var(--line);
      border-radius: 14px;
      padding: 0.9rem;
      background: rgba(255,255,255,0.02);
    }
    #publish-panel[hidden] { display: none; }
    #draft-meta { margin-bottom: 1rem; color: var(--muted); }
    @media (max-width: 960px) {
      .grid { grid-template-columns: 1fr; }
      .two-col { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div class="brand">
        <b>resell·agent GUI</b>
        <span>Draft once, review, then publish with a single button.</span>
      </div>
      <div class="pill">Browser automation: ${boot.browserAutomationEnabled ? "enabled" : "disabled"}</div>
    </div>
  </header>
  <main>
    <div class="wrap grid">
      <section class="card">
        <h1>New draft</h1>
        <p>Upload photos, enter notes, and build a cross-platform listing draft.</p>
        <form id="draft-form">
          <div class="two-col">
            <label>
              Photos
              <input id="photos" name="photos" type="file" accept="image/*" multiple />
            </label>
            <label>
              Reverse-image URL
              <input id="referenceImageUrl" name="referenceImageUrl" type="url" placeholder="https://..." />
            </label>
          </div>
          <label>
            Seller notes
            <textarea id="notes" name="notes" rows="6" placeholder="Flaws, fit notes, measurements, condition, anything to call out."></textarea>
          </label>
          <fieldset>
            <legend>Platforms</legend>
            <div class="checks">
              ${platformChecks}
            </div>
          </fieldset>
          <div class="actions">
            <button id="build-draft" type="submit">Build draft</button>
          </div>
        </form>
        <div id="global-status" data-kind="info">Choose photos to begin.</div>
      </section>

      <section class="card">
        <h2>Photos</h2>
        <div id="photo-preview" class="photo-strip"><p class="muted">No photos selected yet.</p></div>
      </section>

      <section class="card">
        <h2>Draft summary</h2>
        <div id="summary"><p class="muted">Build a draft to see pricing and comparisons.</p></div>
      </section>

      <section id="publish-panel" class="card" hidden>
        <h2>Review and publish</h2>
        <div id="draft-meta"></div>
        <div id="listing-cards" class="listing-grid"></div>
        <section id="ebay-section" class="form-note" hidden>
          <h3>eBay publish settings</h3>
          <p class="muted">eBay still needs public image URLs and your saved account policy IDs.</p>
          <div class="two-col">
            <label>SKU (stable for this draft)<input id="ebay-sku" name="ebay-sku" type="text" placeholder="resale-..." readonly /></label>
            <label>Merchant location key<input id="ebay-location" name="ebay-location" type="text" /></label>
          </div>
          <div class="two-col">
            <label>Fulfillment policy ID<input id="ebay-fulfillment" name="ebay-fulfillment" type="text" /></label>
            <label>Payment policy ID<input id="ebay-payment" name="ebay-payment" type="text" /></label>
          </div>
          <label>Return policy ID<input id="ebay-return" name="ebay-return" type="text" /></label>
          <label>
            Public image URLs for eBay, one per line
            <textarea id="ebay-image-urls" name="ebay-image-urls" rows="4" placeholder="https://...\nhttps://..."></textarea>
          </label>
        </section>
        <div class="actions" style="margin-top:1rem;">
          <button id="publish-all" type="button">Publish all</button>
        </div>
        <div id="publish-results" class="results"></div>
      </section>
    </div>
  </main>
  <script>${buildGuiScript(boot)}</script>
</body>
</html>`;
}

function securityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function sendJson(res: ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    ...extra,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(
  res: ServerResponse,
  status: number,
  text: string,
  contentType = "text/plain; charset=utf-8",
  extra: Record<string, string> = {}
): void {
  res.writeHead(status, { ...securityHeaders(), "Content-Type": contentType, ...extra });
  res.end(text);
}

async function savePhoto(file: File, dir: string, index: number): Promise<UploadedPhoto> {
  if (file.size <= 0) throw new HttpError(400, `Photo ${index + 1} is empty.`);
  if (file.size > GUI_MAX_PHOTO_BYTES) {
    throw new HttpError(413, `Photo ${index + 1} exceeds the ${GUI_MAX_PHOTO_BYTES / 1024 / 1024} MiB per-file limit.`);
  }

  const input = Buffer.from(await file.arrayBuffer());
  if (input.length > GUI_MAX_PHOTO_BYTES) throw new HttpError(413, `Photo ${index + 1} is too large.`);

  let normalized: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(input, { limitInputPixels: GUI_MAX_IMAGE_PIXELS, failOn: "error" });
    const metadata = await image.metadata();
    const format = metadata.format?.toLowerCase();
    const allowedRasterFormats = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff", "heif"]);
    if (!format || !allowedRasterFormats.has(format)) {
      throw new HttpError(415, `Photo ${index + 1} is not a supported raster image.`);
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > GUI_MAX_IMAGE_PIXELS) {
      throw new HttpError(413, `Photo ${index + 1} has too many pixels.`);
    }
    normalized = await image.rotate().jpeg({ quality: 90 }).toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(415, `Photo ${index + 1} is malformed or is not a supported raster image.`);
  }
  if (!normalized.length || normalized.length > GUI_MAX_PHOTO_BYTES) {
    throw new HttpError(413, `Photo ${index + 1} exceeds the normalized size limit.`);
  }

  // Never use the client filename for storage. All uploaded files are private,
  // normalized JPEGs with generated names.
  const name = `photo-${index + 1}.jpg`;
  const path = join(dir, `${String(index + 1).padStart(2, "0")}-${randomUUID()}.jpg`);
  await writeFile(path, normalized, { mode: 0o600 });
  await chmod(path, 0o600);
  return { name, path, mimeType: "image/jpeg" };
}

function isSafeDraftId(value: string): boolean {
  return GUI_DIR_RE.test(value);
}

function draftRecordPath(draftId: string): string {
  if (!isSafeDraftId(draftId)) throw new HttpError(400, "Invalid draft id.");
  return join(DATA_DIR, draftId, "draft.json");
}

async function persistDraft(record: DraftRecord): Promise<void> {
  const dir = await ensureDraftDir(record.draftId);
  const temporaryPath = join(dir, `.draft-${randomUUID()}.tmp`);
  const metadata = JSON.stringify(record, null, 2);
  try {
    await writeFile(temporaryPath, metadata, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, draftRecordPath(record.draftId));
    await chmod(draftRecordPath(record.draftId), 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function serializedRecord(record: DraftRecord): Record<string, unknown> {
  return {
    draftId: record.draftId,
    draft: record.draft,
    photos: record.photos.map((photo, index) => ({
      name: photo.name,
      url: `/api/draft/${record.draftId}/photo/${index}`,
    })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    publishResults: record.publishResults,
    ebay: record.ebay,
    guiSkuPrefix: record.guiSkuPrefix,
  };
}

async function loadDraftRecords(): Promise<void> {
  let entries;
  try {
    entries = await readdir(DATA_DIR, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeDraftId(entry.name)) continue;
    try {
      const metadata = JSON.parse(await readFile(draftRecordPath(entry.name), "utf8")) as Partial<DraftRecord>;
      if (!metadata.draft || !Array.isArray(metadata.photos) || !metadata.createdAt) continue;
      const lexicalRoot = `${resolve(join(DATA_DIR, entry.name))}${sep}`;
      const root = `${await realpath(resolve(join(DATA_DIR, entry.name)))}${sep}`;
      const photos = metadata.photos.filter((photo): photo is UploadedPhoto => {
        if (!photo || typeof photo !== "object") return false;
        const candidate = photo as UploadedPhoto;
        return typeof candidate.name === "string" && typeof candidate.path === "string" && resolve(candidate.path).startsWith(lexicalRoot) && candidate.mimeType === "image/jpeg";
      });
      const photoPaths = photos.map((photo) => photo.path);
      const record: DraftRecord = {
        draftId: entry.name,
        draft: metadata.draft,
        photos,
        photoPaths,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt ?? metadata.createdAt,
        publishResults: Array.isArray(metadata.publishResults) ? metadata.publishResults : [],
        ebay: metadata.ebay,
        guiSkuPrefix: metadata.guiSkuPrefix,
      };
      const present: UploadedPhoto[] = [];
      for (const photo of record.photos) {
        const info = await stat(photo.path);
        const target = await realpath(photo.path);
        if (info.isFile() && target.startsWith(root)) present.push(photo);
      }
      record.photos = present;
      record.photoPaths = present.map((photo) => photo.path);
      drafts.set(record.draftId, record);
    } catch {
      // A corrupt or partially-written generated draft is ignored and will be
      // removed by TTL cleanup; it must not prevent the GUI from starting.
    }
  }
}

async function cleanupExpiredDrafts(now = Date.now()): Promise<void> {
  let entries;
  try {
    entries = await readdir(DATA_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeDraftId(entry.name)) continue;
    let timestamp = 0;
    try {
      const raw = await readFile(draftRecordPath(entry.name), "utf8");
      const parsed = JSON.parse(raw) as Partial<DraftRecord>;
      timestamp = Date.parse(parsed.updatedAt ?? parsed.createdAt ?? "");
    } catch {
      try {
        timestamp = (await stat(join(DATA_DIR, entry.name))).mtimeMs;
      } catch {
        timestamp = now;
      }
    }
    if (!Number.isFinite(timestamp) || now - timestamp > GUI_DRAFT_TTL_MS) {
      await rm(join(DATA_DIR, entry.name), { recursive: true, force: true });
      drafts.delete(entry.name);
    }
  }
}

async function draftIdToRecord(draftId: string): Promise<DraftRecord | null> {
  if (!isSafeDraftId(draftId)) return null;
  return drafts.get(draftId) ?? null;
}

function validateReferenceUrl(value: string): string {
  if (!value) return "";
  if (value.length > 2_048) throw new HttpError(400, "Reference image URL is too long.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "Reference image URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new HttpError(400, "Reference image URL must use HTTPS without embedded credentials.");
  return parsed.toString();
}

function validateClientPlatforms(value: unknown): Platform[] {
  try {
    return validatePlatformSelection(value);
  } catch (error) {
    throw new HttpError(400, String(error instanceof Error ? error.message : error));
  }
}

function mergeClientEdits(draft: DraftBundle, edits: unknown): DraftBundle {
  try {
    return mergeEditableListingFields(draft, edits);
  } catch (error) {
    throw new HttpError(400, String(error instanceof Error ? error.message : error));
  }
}

function normalizedEbaySettings(value: unknown): EbayPublishSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "eBay settings must be an object.");
  }
  const input = value as Record<string, unknown>;
  const text = (key: string): string => {
    const candidate = input[key];
    if (candidate === undefined || candidate === null) return "";
    if (typeof candidate !== "string" || candidate.length > 256) throw new HttpError(400, `eBay ${key} must be short text.`);
    return candidate.trim();
  };
  const imageUrls = input.imageUrls === undefined
    ? []
    : Array.isArray(input.imageUrls)
      ? input.imageUrls.map((url) => {
          if (typeof url !== "string" || url.length > 2_048) throw new HttpError(400, "eBay image URLs must be short text.");
          return url.trim();
        }).filter(Boolean)
      : (() => { throw new HttpError(400, "eBay imageUrls must be an array."); })();
  if (imageUrls.length > 20) throw new HttpError(400, "eBay accepts at most 20 image URLs here.");
  const quantity = input.quantity === undefined ? undefined : Number(input.quantity);
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)) {
    throw new HttpError(400, "eBay quantity must be an integer between 1 and 100.");
  }
  const uniqueImageUrls = [...new Set(imageUrls)];
  if (uniqueImageUrls.length) {
    try {
      validateHttpsImageUrls(uniqueImageUrls);
    } catch (error) {
      throw new HttpError(400, String(error instanceof Error ? error.message : error));
    }
  }
  return {
    sku: text("sku"),
    imageUrls: uniqueImageUrls,
    quantity,
    categoryId: text("categoryId") || undefined,
    merchantLocationKey: text("merchantLocationKey"),
    fulfillmentPolicyId: text("fulfillmentPolicyId"),
    paymentPolicyId: text("paymentPolicyId"),
    returnPolicyId: text("returnPolicyId"),
  };
}

function defaultEbaySettings(boot: GuiBootState): EbayPublishSettings {
  return {
    sku: boot.ebayDefaults.sku,
    imageUrls: [],
    merchantLocationKey: boot.ebayDefaults.merchantLocationKey,
    fulfillmentPolicyId: boot.ebayDefaults.fulfillmentPolicyId,
    paymentPolicyId: boot.ebayDefaults.paymentPolicyId,
    returnPolicyId: boot.ebayDefaults.returnPolicyId,
  };
}

async function handleDraft(req: IncomingMessage, boot: GuiBootState, res: ServerResponse): Promise<void> {
  const form = await parseFormData(req);
  const notes = String(form.get("notes") ?? "");
  if (notes.length > 20_000) throw new HttpError(400, "Seller notes are too long.");
  const referenceImageUrl = validateReferenceUrl(String(form.get("referenceImageUrl") ?? "").trim());
  const platforms = validateClientPlatforms(form.getAll("platforms").map((value) => String(value).trim()));
  const files = form.getAll("photos").filter((value): value is File => value instanceof File);
  if (!files.length) throw new HttpError(400, "Choose at least one photo before building a draft.");
  if (files.length > GUI_MAX_PHOTO_COUNT) throw new HttpError(413, `Choose no more than ${GUI_MAX_PHOTO_COUNT} photos.`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > GUI_MAX_TOTAL_PHOTO_BYTES) throw new HttpError(413, "Uploaded photos exceed the total size limit.");

  const draftId = randomUUID();
  const dir = await ensureDraftDir(draftId);
  try {
    const photos: UploadedPhoto[] = [];
    let normalizedTotalBytes = 0;
    for (let i = 0; i < files.length; i++) {
      const photo = await savePhoto(files[i], dir, i);
      normalizedTotalBytes += (await stat(photo.path)).size;
      if (normalizedTotalBytes > GUI_MAX_TOTAL_PHOTO_BYTES) {
        throw new HttpError(413, "Normalized photos exceed the total size limit.");
      }
      photos.push(photo);
    }
    const photoPaths = photos.map((photo) => photo.path);
    const draft = await buildDraft(photoPaths, notes, platforms, referenceImageUrl || undefined);
    const now = new Date().toISOString();
    const record: DraftRecord = {
      draftId,
      draft,
      photoPaths,
      photos,
      createdAt: now,
      updatedAt: now,
      publishResults: [],
    };
    drafts.set(draftId, record);
    await persistDraft(record);
    sendJson(res, 200, serializedRecord(record));
  } catch (error) {
    drafts.delete(draftId);
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function handleGetDraft(draftId: string, res: ServerResponse): Promise<void> {
  const record = await draftIdToRecord(draftId);
  if (!record) {
    sendJson(res, 404, { error: "Draft not found or expired." });
    return;
  }
  record.updatedAt = new Date().toISOString();
  await persistDraft(record);
  sendJson(res, 200, serializedRecord(record));
}

async function handleDraftEdit(req: IncomingMessage, draftId: string, res: ServerResponse): Promise<void> {
  const record = await draftIdToRecord(draftId);
  if (!record) {
    sendJson(res, 404, { error: "Draft not found or expired." });
    return;
  }
  const body = await parseJsonBody(req);
  const edits = body.edits === undefined ? [] : body.edits;
  const merged = mergeClientEdits(record.draft, edits);
  const ebay = body.ebay === undefined ? undefined : normalizedEbaySettings(body.ebay);
  record.draft = merged;
  if (ebay !== undefined) record.ebay = ebay;
  record.updatedAt = new Date().toISOString();
  await persistDraft(record);
  sendJson(res, 200, serializedRecord(record));
}

function mergedPublishResults(previous: PlatformPublishResult[], current: PlatformPublishResult[]): PlatformPublishResult[] {
  const byPlatform = new Map(previous.map((result) => [result.platform, result]));
  for (const result of current) {
    const prior = byPlatform.get(result.platform);
    if (result.status === "skipped" && prior?.status === "published") continue;
    byPlatform.set(result.platform, result);
  }
  return [...byPlatform.values()];
}

async function handlePublish(req: IncomingMessage, boot: GuiBootState, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (typeof body.draftId !== "string" || !body.draftId.trim()) throw new HttpError(400, "A stored draftId is required.");
  const draftId = body.draftId.trim();
  const record = await draftIdToRecord(draftId);
  if (!record) {
    sendJson(res, 404, { error: "Draft not found or expired. Build a new draft." });
    return;
  }
  if (activePublishes.has(draftId)) throw new HttpError(409, "This draft is already being published. Wait for the current result before retrying.");
  activePublishes.add(draftId);
  try {
    const platforms = validateClientPlatforms(body.platforms);
    const edits = body.edits === undefined ? [] : body.edits;
    const merged = mergeClientEdits(record.draft, edits);
    const ebay = body.ebay === undefined ? (record.ebay ?? defaultEbaySettings(boot)) : normalizedEbaySettings(body.ebay);
    record.draft = merged;
    record.ebay = ebay;
    record.guiSkuPrefix ??= boot.ebayDefaults.sku;
    record.updatedAt = new Date().toISOString();
    await persistDraft(record);

    const result = await publishDraftBundle({
      draft: record.draft,
      photoPaths: record.photoPaths,
      platforms,
      ebay,
      draftId,
      guiSkuPrefix: record.guiSkuPrefix,
      previousResults: record.publishResults,
      browser: { headless: !truthy(process.env.BROWSER_AUTOMATION_HEADFUL) },
    });
    record.publishResults = mergedPublishResults(record.publishResults, result.results);
    record.updatedAt = new Date().toISOString();
    await persistDraft(record);
    sendJson(res, 200, {
      results: result.results,
      publishResults: record.publishResults,
      browserAutomationEnabled: boot.browserAutomationEnabled,
    });
  } finally {
    activePublishes.delete(draftId);
  }
}

async function handleDraftPhoto(res: ServerResponse, draftId: string, indexStr: string): Promise<void> {
  const record = drafts.get(draftId);
  if (!record) {
    sendText(res, 404, "Draft not found");
    return;
  }
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0 || index >= record.photos.length) {
    sendText(res, 404, "Photo not found");
    return;
  }
  const photo = record.photos[index];
  let bytes: Buffer;
  try {
    bytes = await readFile(photo.path);
  } catch {
    sendText(res, 404, "Photo not found");
    return;
  }
  res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": photo.mimeType,
    "Content-Length": String(bytes.length),
  });
  res.end(bytes);
}

function bootState(): GuiBootState {
  return {
    platforms: [...GUI_PLATFORMS],
    browserAutomationEnabled: truthy(process.env.ENABLE_BROWSER_AUTOMATION),
    ebayDefaults: {
      sku: process.env.GUI_DEFAULT_SKU ?? "",
      merchantLocationKey: process.env.GUI_DEFAULT_MERCHANT_LOCATION_KEY ?? "",
      fulfillmentPolicyId: process.env.GUI_DEFAULT_FULFILLMENT_POLICY_ID ?? "",
      paymentPolicyId: process.env.GUI_DEFAULT_PAYMENT_POLICY_ID ?? "",
      returnPolicyId: process.env.GUI_DEFAULT_RETURN_POLICY_ID ?? "",
    },
  };
}

function cookieToken(req: IncomingMessage): string | undefined {
  const cookies = String(req.headers.cookie ?? "").split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === "gui_token") return rest.join("=");
  }
  return undefined;
}

function authorized(req: IncomingMessage, apiToken: string): boolean {
  return req.headers["x-gui-token"] === apiToken || cookieToken(req) === apiToken;
}

function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function originAllowed(req: IncomingMessage, host: string, port: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  const expected = new Set([`http://${urlHost(host).toLowerCase()}:${port}`]);
  if (host === "127.0.0.1") {
    expected.add(`http://localhost:${port}`);
    expected.add(`http://127.0.0.1:${port}`);
  }
  return expected.has(parsed.origin);
}

export async function startGui(port = Number(process.env.GUI_PORT ?? "3000")): Promise<void> {
  const allowRemote = process.env.GUI_ALLOW_REMOTE?.trim() === "1";
  const configuredHost = process.env.GUI_HOST?.trim();
  if (configuredHost && /[\r\n]/.test(configuredHost)) throw new Error("GUI_HOST contains invalid control characters.");
  const host = allowRemote && configuredHost ? configuredHost : "127.0.0.1";
  if (configuredHost && !allowRemote) {
    console.warn("GUI_HOST is ignored unless GUI_ALLOW_REMOTE=1 is set; binding to 127.0.0.1.");
  }
  const listenPort = Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : 3000;
  const configuredToken = process.env.GUI_AUTH_TOKEN?.trim();
  if (configuredToken && configuredToken.length < 24) throw new Error("GUI_AUTH_TOKEN must be at least 24 characters.");
  const apiToken = configuredToken || randomBytes(32).toString("base64url");

  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await chmod(DATA_DIR, 0o700);
  await cleanupExpiredDrafts();
  await loadDraftRecords();
  const boot = bootState();
  let actualPort = listenPort;
  let cleanupTimer: NodeJS.Timeout | undefined;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (method === "GET" && url.pathname === "/") {
        if (allowRemote && !authorized(req, apiToken)) {
          if (url.searchParams.get("gui_token") !== apiToken) {
            sendJson(res, 401, { error: "Open the GUI URL printed by the server, or provide the configured GUI token." });
            return;
          }
          res.writeHead(302, {
            ...securityHeaders(),
            Location: "/",
            "Set-Cookie": `gui_token=${apiToken}; Path=/; HttpOnly; SameSite=Strict`,
          });
          res.end();
          return;
        }
        sendText(res, 200, renderPage(boot), "text/html; charset=utf-8", {
          "Set-Cookie": `gui_token=${apiToken}; Path=/; HttpOnly; SameSite=Strict`,
          "Content-Security-Policy": "default-src 'self'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
        });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        if (!authorized(req, apiToken)) {
          sendJson(res, 401, { error: "Unauthorized GUI API request." });
          return;
        }
        if (method !== "GET" && !originAllowed(req, host, actualPort)) {
          sendJson(res, 403, { error: "Request origin is not allowed." });
          return;
        }
      }

      if (method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, browserAutomationEnabled: boot.browserAutomationEnabled, drafts: drafts.size });
        return;
      }
      if (method === "POST" && url.pathname === "/api/draft") {
        await handleDraft(req, boot, res);
        return;
      }
      if (method === "POST" && url.pathname === "/api/publish") {
        await handlePublish(req, boot, res);
        return;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "api" && parts[1] === "draft" && parts.length >= 3) {
        let draftId: string;
        try {
          draftId = decodeURIComponent(parts[2]);
        } catch {
          throw new HttpError(400, "Malformed draft id.");
        }
        if (parts.length === 3 && method === "GET") {
          await handleGetDraft(draftId, res);
          return;
        }
        if (parts.length === 3 && method === "PATCH") {
          await handleDraftEdit(req, draftId, res);
          return;
        }
        if (parts.length === 5 && parts[3] === "photo" && method === "GET") {
          await handleDraftPhoto(res, draftId, parts[4]);
          return;
        }
      }
      sendText(res, 404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, { error: String(error instanceof Error ? error.message : error) });
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  activeGuiServer = server;

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(listenPort, host, () => resolveListen());
  });
  const address = server.address();
  if (address && typeof address === "object") actualPort = address.port;

  cleanupTimer = setInterval(() => {
    void cleanupExpiredDrafts().catch(() => undefined);
  }, 60 * 60 * 1000);
  cleanupTimer.unref();
  const shutdown = () => {
    void server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.once("close", () => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    if (activeGuiServer === server) activeGuiServer = null;
    void cleanupExpiredDrafts().catch(() => undefined);
  });

  const accessUrl = allowRemote
    ? `http://${urlHost(host)}:${actualPort}/?gui_token=${encodeURIComponent(apiToken)}`
    : `http://${urlHost(host)}:${actualPort}`;
  console.log(`GUI listening on ${accessUrl}`);
}

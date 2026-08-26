import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { buildDraft } from "./pipeline.js";
import { publishDraftBundle } from "./publish.js";
import { buildGuiScript, type GuiBootState } from "./gui-client.js";
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
}

const drafts = new Map<string, DraftRecord>();
const DATA_DIR = join(tmpdir(), "resell-agent-gui");

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function guessMimeType(name: string, fallback = "application/octet-stream"): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".avif") return "image/avif";
  return fallback;
}

async function collectBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
  const body = await collectBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

async function parseFormData(req: IncomingMessage): Promise<FormData> {
  const body = await collectBody(req);
  const request = new Request("http://localhost/", {
    method: req.method ?? "POST",
    headers: headersToWebHeaders(req.headers),
    body: new Blob([new Uint8Array(body)]),
  });
  return await request.formData();
}

async function ensureDraftDir(draftId: string): Promise<string> {
  const dir = join(DATA_DIR, draftId);
  await mkdir(dir, { recursive: true });
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
    .publish-status[data-kind="error"] { border-color: rgba(239, 118, 122, 0.55); color: var(--red); }
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
    .result.error { border-color: rgba(239, 118, 122, 0.55); }
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
            <label>SKU<input id="ebay-sku" name="ebay-sku" type="text" placeholder="resale-..." /></label>
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

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res: ServerResponse, status: number, text: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(text);
}

async function savePhoto(file: File, dir: string, index: number): Promise<UploadedPhoto> {
  const name = file.name || `photo-${index + 1}`;
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = join(dir, `${String(index + 1).padStart(2, "0")}-${safe}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path, buffer);
  return { name, path, mimeType: file.type || guessMimeType(name) };
}

async function draftIdToRecord(draftId: string): Promise<DraftRecord | null> {
  return drafts.get(draftId) ?? null;
}

function selectedPlatformsFromForm(form: FormData, fallback: Platform[]): Platform[] {
  const selected = form.getAll("platforms").map((value) => String(value).trim()).filter(Boolean) as Platform[];
  return selected.length ? selected : fallback;
}

async function handleDraft(req: IncomingMessage, boot: GuiBootState, res: ServerResponse): Promise<void> {
  const form = await parseFormData(req);
  const notes = String(form.get("notes") ?? "");
  const referenceImageUrl = String(form.get("referenceImageUrl") ?? "").trim();
  const platforms = selectedPlatformsFromForm(form, boot.platforms);
  const files = form.getAll("photos").filter((value): value is File => value instanceof File);
  if (!files.length) {
    sendJson(res, 400, { error: "Choose at least one photo before building a draft." });
    return;
  }

  const draftId = randomUUID();
  const dir = await ensureDraftDir(draftId);
  const photos: UploadedPhoto[] = [];
  for (let i = 0; i < files.length; i++) {
    photos.push(await savePhoto(files[i], dir, i));
  }
  const photoPaths = photos.map((photo) => photo.path);
  const draft = await buildDraft(photoPaths, notes, platforms, referenceImageUrl || undefined);

  const record: DraftRecord = {
    draftId,
    draft,
    photoPaths,
    photos,
    createdAt: new Date().toISOString(),
  };
  drafts.set(draftId, record);

  sendJson(res, 200, {
    draftId,
    draft,
    photos: photos.map((photo, index) => ({
      name: photo.name,
      url: `/api/draft/${draftId}/photo/${index}`,
    })),
  });
}

async function handlePublish(req: IncomingMessage, boot: GuiBootState, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  const draftId = String(body.draftId ?? "").trim();
  const draft = (body.draft as DraftBundle | undefined) ?? (draftId ? drafts.get(draftId)?.draft : undefined);
  if (!draft) {
    sendJson(res, 400, { error: "Build a draft first." });
    return;
  }

  const record = draftId ? await draftIdToRecord(draftId) : null;
  const photoPaths = record?.photoPaths ?? [];
  const platforms = Array.isArray(body.platforms) && body.platforms.length
    ? (body.platforms.map((value: unknown) => String(value).trim()).filter(Boolean) as Platform[])
    : draft.listings.map((listing) => listing.platform);

  const result = await publishDraftBundle({
    draft,
    photoPaths,
    platforms,
    ebay: body.ebay,
    browser: {
      headless: !truthy(process.env.BROWSER_AUTOMATION_HEADFUL),
    },
  });

  sendJson(res, 200, { results: result.results, browserAutomationEnabled: boot.browserAutomationEnabled });
}

async function handleDraftPhoto(req: IncomingMessage, res: ServerResponse, draftId: string, indexStr: string): Promise<void> {
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
  const bytes = await readFile(photo.path);
  res.writeHead(200, {
    "Content-Type": photo.mimeType,
    "Cache-Control": "no-store",
    "Content-Length": String(bytes.length),
  });
  res.end(bytes);
}

function bootState(): GuiBootState {
  return {
    platforms: ["ebay", "poshmark", "depop"],
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

export async function startGui(port = Number(process.env.GUI_PORT ?? "3000")): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const boot = bootState();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        sendText(res, 200, renderPage(boot), "text/html; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, browserAutomationEnabled: boot.browserAutomationEnabled, drafts: drafts.size });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/draft") {
        await handleDraft(req, boot, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/publish") {
        await handlePublish(req, boot, res);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/draft/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length === 4 && parts[0] === "api" && parts[1] === "draft" && parts[3] === "photo") {
          // never reached; kept for readability
        }
        if (parts.length === 5 && parts[0] === "api" && parts[1] === "draft" && parts[3] === "photo") {
          await handleDraftPhoto(req, res, parts[2], parts[4]);
          return;
        }
      }
      sendText(res, 404, "Not found");
    } catch (error) {
      sendJson(res, 500, { error: String(error instanceof Error ? error.message : error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });

  console.log(`GUI listening on http://localhost:${port}`);
}

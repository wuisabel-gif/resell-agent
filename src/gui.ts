import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { buildConsentUrl, exchangeCode } from "./ebay/auth.js";
import { buildDraft } from "./pipeline.js";
import { publishDraftBundle, validateHttpsImageUrls, type EbayPublishSettings, type PlatformPublishResult } from "./publish.js";
import { buildGuiScript, type GuiBootState } from "./gui-client.js";
import { GUI_PLATFORMS, mergeEditableListingFields, validatePlatformSelection } from "./gui-validation.js";
import { truthy } from "./env.js";
import { applyRuntimeSettings, resetRuntimeSettings, RUNTIME_SECRET_KEYS } from "./runtime-settings.js";
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
    @import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600;6..96,700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
    :root {
      --bg: oklch(0.972 0.006 312);
      --surface: oklch(0.995 0.003 312);
      --surface-2: oklch(0.955 0.008 312);
      --ink: oklch(0.235 0.028 312);
      --ink-soft: oklch(0.34 0.026 310);
      --muted: oklch(0.47 0.022 308);
      --plum: oklch(0.43 0.13 305);
      --aubergine: oklch(0.205 0.034 313);
      --aubergine-2: oklch(0.26 0.04 312);
      --gold: oklch(0.80 0.085 80);
      --gold-soft: oklch(0.86 0.06 82);
      --gold-ink: oklch(0.56 0.085 72);
      --line: oklch(0.88 0.01 310);
      --line-dark: oklch(0.34 0.03 312);
      --green: oklch(0.48 0.12 148);
      --red: oklch(0.52 0.16 25);
      --blue: oklch(0.45 0.12 250);
      --serif: 'Bodoni Moda', Georgia, 'Times New Roman', serif;
      --sans: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
      --radius: 2px;
    }
    *, *::before, *::after { box-sizing: border-box; }
    * { margin: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      font-family: var(--sans);
      font-size: clamp(0.98rem, 0.94rem + 0.2vw, 1.06rem);
      line-height: 1.6;
      color: var(--ink-soft);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    a { color: inherit; text-decoration: none; }
    button, input, select, textarea { font: inherit; color: inherit; }
    h1, h2, h3, h4 { font-family: var(--serif); color: var(--ink); font-weight: 600; line-height: 1.08; letter-spacing: -0.015em; text-wrap: balance; }
    p { text-wrap: pretty; max-width: 68ch; }
    :focus-visible { outline: 2px solid var(--plum); outline-offset: 3px; border-radius: var(--radius); }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      background: color-mix(in oklch, var(--bg) 88%, transparent);
      backdrop-filter: saturate(140%) blur(12px);
      border-bottom: 1px solid var(--line);
    }
    .wrap { width: 100%; max-width: 1200px; margin-inline: auto; padding-inline: clamp(1.25rem, 5vw, 4rem); }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; min-height: 78px; }
    .brand { display: flex; flex-direction: column; line-height: 1; letter-spacing: 0.01em; }
    .brand b { font-family: var(--serif); font-weight: 600; font-size: 1.32rem; color: var(--ink); letter-spacing: 0.02em; }
    .brand span { font-size: 0.6rem; letter-spacing: 0.34em; text-transform: uppercase; color: var(--gold-ink); margin-top: 5px; }
    .pill { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.45rem 0.75rem; border: 1px solid var(--line); border-radius: var(--radius); color: var(--gold-ink); background: var(--surface); font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; }
    main { padding: clamp(1rem, 3vw, 2rem) 0 clamp(3.5rem, 7vw, 7rem); }
    .steps { display: flex; align-items: center; gap: clamp(1rem, 4vw, 3.5rem); padding: 1rem 0 2.25rem; border-bottom: 1px solid var(--line); color: var(--muted); }
    .step { display: inline-flex; align-items: center; gap: 0.6rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }
    .step b { color: var(--gold-ink); font-family: var(--serif); font-size: 1.1rem; font-weight: 600; letter-spacing: 0; }
    .step.is-active { color: var(--ink); }
    .step.is-active b { color: var(--plum); }
    .step + .step::before { content: '—'; color: var(--line-dark); margin-right: clamp(0.35rem, 1vw, 1rem); }
    .grid { display: grid; gap: clamp(1rem, 2vw, 1.5rem); grid-template-columns: 1.1fr 0.9fr; align-items: start; }
    .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: clamp(1.2rem, 2.4vw, 2rem); box-shadow: 0 18px 40px -32px oklch(0.2 0.03 312 / 0.35); }
    .grid > .card:first-child { background: var(--aubergine); color: oklch(0.9 0.01 312); border-color: var(--aubergine); box-shadow: 0 30px 60px -36px oklch(0.1 0.04 312 / 0.65); }
    .grid > .card:first-child h1, .grid > .card:first-child h2, .grid > .card:first-child h3 { color: oklch(0.97 0.01 312); }
    .grid > .card:first-child p, .grid > .card:first-child .muted { color: oklch(0.82 0.015 312); }
    #publish-panel { grid-column: 1 / -1; }
    h1 { font-size: clamp(2.2rem, 4vw, 4rem); font-weight: 500; }
    h1 em { color: var(--gold); font-style: italic; font-weight: 500; }
    h2 { font-size: clamp(1.55rem, 2.5vw, 2.25rem); }
    h3 { font-size: 1.28rem; }
    p { margin: 0.55rem 0 1rem; }
    .eyebrow { display: block; margin-bottom: 0.85rem; color: var(--gold); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; }
    form { display: grid; gap: 1.25rem; }
    label { display: grid; gap: 0.4rem; font-size: 0.88rem; font-weight: 600; letter-spacing: 0.02em; }
    input[type="text"], input[type="url"], input[type="number"], input[type="password"], select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--ink);
      padding: 0.78rem 0.9rem;
      font: inherit;
    }
    .grid > .card:first-child input[type="text"], .grid > .card:first-child input[type="url"], .grid > .card:first-child input[type="number"], .grid > .card:first-child input[type="password"], .grid > .card:first-child select, .grid > .card:first-child textarea { background: var(--aubergine-2); color: oklch(0.97 0.01 312); border-color: var(--line-dark); }
    input[readonly] { opacity: 0.82; }
    input[type="file"] { width: 100%; border: 1px dashed var(--gold-ink); border-radius: var(--radius); background: var(--surface); color: var(--ink-soft); padding: 0.72rem; }
    input[type="file"]::file-selector-button { margin-right: 0.7rem; border: 1px solid var(--ink); border-radius: var(--radius); padding: 0.45rem 0.7rem; background: var(--ink); color: var(--bg); font-weight: 600; cursor: pointer; }
    .dropzone { position: relative; min-height: 168px; display: flex; align-items: center; justify-content: center; text-align: center; border: 1px dashed var(--gold-ink); border-radius: var(--radius); background: color-mix(in oklch, var(--aubergine-2) 76%, var(--aubergine)); overflow: hidden; cursor: pointer; }
    .dropzone:hover, .dropzone:focus-within { border-color: var(--gold); background: var(--aubergine-2); }
    .dropzone input[type="file"] { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    .dropzone-copy { position: relative; z-index: 1; display: grid; gap: 0.25rem; pointer-events: none; }
    .dropzone-mark { color: var(--gold); font-family: var(--serif); font-size: 2.5rem; line-height: 1; }
    .dropzone-title { color: oklch(0.97 0.01 312); font-family: var(--serif); font-size: 1.25rem; }
    .dropzone-note { color: oklch(0.78 0.02 312); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
    .field-help { color: oklch(0.75 0.02 312); font-size: 0.78rem; font-weight: 400; letter-spacing: 0; }
    textarea { resize: vertical; }
    fieldset { border: 1px solid var(--line-dark); border-radius: var(--radius); padding: 1rem; margin: 0; display: grid; gap: 0.7rem; }
    legend { padding: 0 0.4rem; color: var(--gold); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; }
    .settings-panel { border-top: 1px solid var(--line-dark); border-bottom: 1px solid var(--line-dark); padding: 0.8rem 0; }
    .settings-panel summary { color: var(--gold); cursor: pointer; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.14em; list-style-position: inside; text-transform: uppercase; }
    .settings-panel summary span { color: oklch(0.73 0.02 312); font-size: 0.72rem; font-weight: 400; letter-spacing: 0; text-transform: none; }
    .settings-body { display: grid; gap: 0.8rem; padding-top: 1rem; }
    .settings-note { color: oklch(0.78 0.02 312); font-size: 0.78rem; font-weight: 400; letter-spacing: 0; }
    .settings-note strong { color: var(--gold-soft); }
    .auth-tools { display: grid; gap: 0.7rem; border-top: 1px solid var(--line-dark); padding-top: 0.8rem; }
    .auth-tools .actions { gap: 0.55rem; }
    .auth-link { color: var(--gold); font-size: 0.8rem; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
    .checks { display: flex; flex-wrap: wrap; gap: 0.65rem 1.25rem; }
    .check { display: inline-flex; align-items: center; gap: 0.5rem; color: inherit; font-size: 0.92rem; font-weight: 500; }
    .check input { width: 1rem; height: 1rem; accent-color: var(--gold); }
    .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
    button { border: 1px solid transparent; border-radius: var(--radius); padding: 0.82rem 1.45rem; background: var(--gold-ink); color: oklch(0.99 0.01 90); font-size: 0.78rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: all 0.35s var(--ease); }
    button.small { padding: 0.55rem 0.75rem; font-size: 0.68rem; }
    button:hover { background: var(--ink); }
    button.secondary { background: transparent; color: var(--ink); border-color: var(--ink); }
    button.secondary:hover { background: var(--ink); color: var(--bg); }
    .grid > .card:first-child button.secondary { color: var(--gold); border-color: var(--gold); }
    .grid > .card:first-child button.secondary:hover { background: var(--gold); color: var(--aubergine); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    #global-status { margin-top: 1.1rem; padding: 0.75rem 0; border-top: 1px solid var(--line-dark); color: oklch(0.82 0.015 312); font-size: 0.9rem; }
    #global-status[data-kind="success"] { color: var(--gold); }
    #global-status[data-kind="error"] { color: oklch(0.78 0.12 25); }
    #global-status[data-kind="info"] { color: oklch(0.82 0.015 312); }
    .photo-strip { display: grid; gap: 0.8rem; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); align-items: start; }
    .thumb { margin: 0; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--surface-2); }
    .thumb img { width: 100%; height: 132px; object-fit: cover; display: block; }
    .thumb figcaption { padding: 0.45rem 0.6rem; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gold-ink); }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 0.65rem; margin-bottom: 1.25rem; }
    .summary-item { border-top: 1px solid var(--line); padding: 0.7rem 0; display: grid; gap: 0.2rem; }
    .summary-item span { color: var(--muted); font-size: 0.76rem; letter-spacing: 0.08em; text-transform: uppercase; }
    .summary-item strong { color: var(--ink); font-size: 0.98rem; font-weight: 500; }
    .table { width: 100%; border-collapse: collapse; border-top: 1px solid var(--line); }
    .table th, .table td { padding: 0.7rem 0.5rem; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
    .table th { color: var(--gold-ink); font-size: 0.74rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
    .retail-list { margin: 0.4rem 0 0; padding-left: 1.1rem; }
    .retail-list a { color: var(--gold-ink); font-weight: 600; }
    .listing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .listing-card { border: 1px solid var(--line); border-top: 2px solid var(--gold-ink); border-radius: var(--radius); background: var(--surface); padding: 1rem; display: grid; gap: 0.8rem; }
    .listing-card header { position: static; border: 0; background: transparent; backdrop-filter: none; display: flex; justify-content: space-between; gap: 1rem; padding: 0; }
    .listing-card h3 { color: var(--ink); font-size: 1.35rem; }
    .publish-status { padding: 0.3rem 0.5rem; border: 1px solid var(--line); border-radius: var(--radius); color: var(--muted); align-self: start; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
    .publish-status[data-kind="published"] { border-color: var(--green); color: var(--green); }
    .publish-status[data-kind="error"], .publish-status[data-kind="unknown"] { border-color: var(--red); color: var(--red); }
    .publish-status[data-kind="skipped"] { border-color: var(--blue); color: var(--blue); }
    .listing-card details { border-top: 1px solid var(--line); padding-top: 0.65rem; }
    .listing-card pre { margin: 0.5rem 0 0; white-space: pre-wrap; word-break: break-word; font-size: 0.84rem; color: var(--muted); }
    .copy-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.65rem; }
    .copy-status { color: var(--muted); font-size: 0.76rem; }
    .copy-status[data-kind="success"] { color: var(--green); }
    .copy-status[data-kind="error"] { color: var(--red); }
    .results { display: grid; gap: 0.55rem; margin-top: 1rem; }
    .result { border-left: 3px solid var(--line); padding: 0.7rem 0.8rem; background: var(--surface-2); }
    .result.published { border-color: var(--green); }
    .result.error, .result.unknown { border-color: var(--red); }
    .result.skipped { border-color: var(--blue); }
    .form-note { border: 1px dashed var(--gold-ink); border-radius: var(--radius); padding: 1rem; margin-top: 1.25rem; background: var(--surface-2); }
    .copy-mode-note { border-color: var(--blue); }
    #publish-panel[hidden] { display: none; }
    #draft-meta { margin-bottom: 1rem; color: var(--muted); font-size: 0.9rem; }
    @media (max-width: 960px) { .grid { grid-template-columns: 1fr; } #publish-panel { grid-column: auto; } .two-col { grid-template-columns: 1fr; } .steps { gap: 0.8rem; justify-content: space-between; } .step { font-size: 0.62rem; letter-spacing: 0.08em; } .step + .step::before { display: none; } }
    @media (max-width: 560px) { .steps { align-items: flex-start; } .step { flex-direction: column; gap: 0.2rem; text-align: center; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div class="brand">
        <b>resell·agent</b>
        <span>Resale, considered</span>
      </div>
      <div class="pill">Browser automation: ${boot.browserAutomationEnabled ? "enabled" : "disabled"}</div>
    </div>
  </header>
  <main>
    <div class="wrap">
      <nav class="steps" aria-label="Listing workflow">
        <span class="step is-active"><b>01</b> Read</span>
        <span class="step"><b>02</b> Consider</span>
        <span class="step"><b>03</b> Place</span>
      </nav>
    </div>
    <div class="wrap grid">
      <section class="card">
        <span class="eyebrow">Resale, considered</span>
        <h1>Photograph the piece.<br><em>Receive the listing.</em></h1>
        <p>Read the item once, then carry its considered listing wherever its buyers already are.</p>
        <details id="settings-panel" class="settings-panel">
          <summary>Settings <span>Anthropic gateway / native API and eBay account</span></summary>
          <div class="settings-body">
            <p class="settings-note"><strong>Private runtime settings.</strong> Values are sent only over this protected local GUI API for draft/publish, applied to <code>process.env</code> in memory, and never saved in a draft, response, or browser storage. Blank fields leave the process-start environment unchanged. Do not deploy this HTTP GUI publicly; use a private HTTPS server for remote access.</p>
            <div class="two-col">
              <label>Anthropic auth token<input id="setting-anthropic-auth-token" type="password" autocomplete="off" placeholder="gateway bearer token" /></label>
              <label>Anthropic API key <span class="field-help">optional native mode</span><input id="setting-anthropic-api-key" type="password" autocomplete="off" placeholder="sk-ant-..." /></label>
            </div>
            <div class="two-col">
              <label>Anthropic base URL<input id="setting-anthropic-base-url" type="url" placeholder="https://api.anthropic.com" /></label>
              <label>Anthropic model<input id="setting-anthropic-model" type="text" placeholder="claude-sonnet-5" /></label>
            </div>
            <div class="two-col">
              <label>eBay client ID<input id="setting-ebay-client-id" type="text" autocomplete="off" /></label>
              <label>eBay client secret<input id="setting-ebay-client-secret" type="password" autocomplete="off" /></label>
            </div>
            <div class="two-col">
              <label>eBay environment<select id="setting-ebay-env"><option value="">Use process environment</option><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label>
              <label>eBay redirect / RuName <span class="field-help">optional for auth flow</span><input id="setting-ebay-redirect-uri" type="text" placeholder="Your eBay RuName" /></label>
            </div>
            <div class="auth-tools">
              <div class="actions">
                <button id="ebay-auth-url" class="secondary small" type="button">Create eBay sign-in link</button>
                <a id="ebay-auth-link" class="auth-link" href="#" target="_blank" rel="noopener noreferrer" hidden>Open eBay authorization</a>
              </div>
              <label>eBay authorization code <span class="field-help">paste the code from the redirect</span><input id="ebay-auth-code" type="text" autocomplete="off" placeholder="code..." /></label>
              <button id="ebay-exchange" class="secondary small" type="button">Exchange code for refresh token</button>
            </div>
            <label>eBay user refresh token <span class="field-help">optional if already configured in .env</span><input id="setting-ebay-user-refresh-token" type="password" autocomplete="off" /></label>
            <div class="actions"><button id="clear-runtime-settings" class="secondary small" type="button">Clear in-memory settings</button><span class="settings-note">Restores process-start values; nothing is written to disk.</span></div>
          </div>
        </details>
        <form id="draft-form">
          <label class="dropzone">
            <span class="dropzone-copy">
              <span class="dropzone-mark">+</span>
              <span class="dropzone-title">Drop photographs here</span>
              <span class="dropzone-note">or choose files · jpeg · png · webp</span>
              <span class="field-help">The vision model reads the uploaded photos directly.</span>
            </span>
            <input id="photos" name="photos" type="file" accept="image/*" multiple />
          </label>
          <label>
            Seller notes
            <textarea id="notes" name="notes" rows="6" placeholder="Flaws, fit notes, measurements, condition, anything to call out."></textarea>
          </label>
          <fieldset>
            <legend>Platforms</legend>
            <div class="checks">
              ${platformChecks}
            </div>
            <p id="platform-mode-note" class="field-help">Choose eBay to use eBay pricing and publishing. Without eBay, this is copy/paste mode for the selected marketplaces.</p>
          </fieldset>
          <div class="actions">
            <button id="build-draft" type="submit">Build draft</button>
          </div>
        </form>
        <div id="global-status" data-kind="info">Choose photos to begin.</div>
      </section>

      <section class="card">
        <span class="eyebrow">02 / Evidence</span>
        <h2>Photos</h2>
        <div id="photo-preview" class="photo-strip"><p class="muted">No photos selected yet.</p></div>
      </section>

      <section class="card">
        <span class="eyebrow">02 / Market</span>
        <h2>Draft summary</h2>
        <div id="summary"><p class="muted">Build a draft to see pricing and comparisons.</p></div>
      </section>

      <section id="publish-panel" class="card" hidden>
        <span class="eyebrow">03 / Place</span>
        <h2>Review and publish</h2>
        <div id="draft-meta"></div>
        <div id="copy-mode-note" class="form-note copy-mode-note" hidden><strong>Copy/paste mode.</strong> eBay was not selected, so no eBay credentials or eBay comps were used. Set a price manually if needed, then use each platform's <strong>Copy listing</strong> button to paste the title, description, price, and condition into its marketplace.</div>
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
  let body = JSON.stringify(payload, null, 2) ?? "null";
  // A provider error should not be able to reflect a credential back to the
  // browser if it happens to include request details in its response text.
  for (const key of RUNTIME_SECRET_KEYS) {
    const value = process.env[key]?.trim();
    if (value) body = body.split(value).join("[redacted]");
  }
  res.end(body);
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

function validateClientPlatforms(value: unknown): Platform[] {
  try {
    return validatePlatformSelection(value);
  } catch (error) {
    throw new HttpError(400, String(error instanceof Error ? error.message : error));
  }
}

function applyGuiRuntimeSettings(value: unknown): void {
  try {
    applyRuntimeSettings(value);
  } catch (error) {
    throw new HttpError(400, String(error instanceof Error ? error.message : error));
  }
}

function parseGuiRuntimeSettings(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") throw new HttpError(400, "settings must be JSON text.");
  if (value.length > 30_000) throw new HttpError(413, "settings are too large.");
  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(400, "settings must be valid JSON.");
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

function authorizationCode(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "eBay authorization code must be text.");
  const candidate = value.trim();
  if (!candidate || candidate.length > 8_192 || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw new HttpError(400, "eBay authorization code is invalid.");
  }
  try {
    const parsed = new URL(candidate);
    const code = parsed.searchParams.get("code");
    if (code) return code;
  } catch {
    // The normal input is the raw code; a full redirect URL is accepted too.
  }
  return decodeURIComponent(candidate);
}

async function handleEbayAuthUrl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  applyGuiRuntimeSettings(body.settings);
  const url = buildConsentUrl();
  sendJson(res, 200, { url });
}

async function handleEbayExchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  applyGuiRuntimeSettings(body.settings);
  const token = await exchangeCode(authorizationCode(body.code));
  // Keep the refresh token available to the current GUI process without
  // returning or persisting the short-lived access token.
  applyGuiRuntimeSettings({ EBAY_USER_REFRESH_TOKEN: token.refresh_token });
  sendJson(res, 200, { refreshToken: token.refresh_token });
}

async function handleDraft(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = await parseFormData(req);
  const notes = String(form.get("notes") ?? "");
  if (notes.length > 20_000) throw new HttpError(400, "Seller notes are too long.");
  applyGuiRuntimeSettings(parseGuiRuntimeSettings(form.get("settings")));
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
    const draft = await buildDraft(photoPaths, notes, platforms);
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
  applyGuiRuntimeSettings(body.settings);
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
    const includesEbay = platforms.includes("ebay");
    const edits = body.edits === undefined ? [] : body.edits;
    const merged = mergeClientEdits(record.draft, edits);
    const ebay = includesEbay
      ? (body.ebay === undefined ? (record.ebay ?? defaultEbaySettings(boot)) : normalizedEbaySettings(body.ebay))
      : undefined;
    record.draft = merged;
    if (ebay) {
      record.ebay = ebay;
      record.guiSkuPrefix ??= boot.ebayDefaults.sku;
    }
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
      if (method === "POST" && url.pathname === "/api/settings/clear") {
        await parseJsonBody(req);
        resetRuntimeSettings();
        sendJson(res, 200, { ok: true, message: "GUI runtime settings cleared from process memory." });
        return;
      }
      if (method === "POST" && url.pathname === "/api/ebay/auth-url") {
        await handleEbayAuthUrl(req, res);
        return;
      }
      if (method === "POST" && url.pathname === "/api/ebay/exchange") {
        await handleEbayExchange(req, res);
        return;
      }
      if (method === "POST" && url.pathname === "/api/draft") {
        await handleDraft(req, res);
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

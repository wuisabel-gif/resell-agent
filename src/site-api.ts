import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDraft } from "./pipeline.js";
import { generateListing } from "./brain/listing.js";
import { clientKey, corsOrigin, createRateLimiter, parseAllowedOrigins } from "./site-api-policy.js";
import { publicFileType, resolvePublicFile } from "./site-static.js";
import type { Platform } from "./types.js";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_NOTES = 2_000;
const MAX_PIXELS = 40_000_000;

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function headersToWebHeaders(headers: IncomingMessage["headers"]): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => out.append(key, item));
    else out.set(key, value);
  }
  return out;
}

async function collectBody(req: IncomingMessage, limit = MAX_REQUEST_BYTES): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new HttpError(413, "Request is too large.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      req.resume();
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function parseFormData(req: IncomingMessage): Promise<FormData> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (contentType.split(";", 1)[0].trim() !== "multipart/form-data") {
    throw new HttpError(415, "Expected a photo upload.");
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
    throw new HttpError(400, "Malformed upload.");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extra,
  });
  res.end(JSON.stringify(body));
}

function modelReady(): boolean {
  return Boolean(process.env.ANTHROPIC_AUTH_TOKEN?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}

async function savePhoto(file: File, dir: string): Promise<string> {
  if (file.size <= 0) throw new HttpError(400, "The photo is empty.");
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, "The photo is too large (6 MiB max).");
  const input = Buffer.from(await file.arrayBuffer());
  const sharp = (await import("sharp")).default;
  let jpeg: Buffer;
  try {
    const image = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" });
    const metadata = await image.metadata();
    const format = metadata.format?.toLowerCase();
    if (!format || !["jpeg", "png", "webp", "gif", "avif", "tiff", "heif"].includes(format)) {
      throw new HttpError(415, "Use a JPEG, PNG, or WebP photo.");
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
      throw new HttpError(413, "The photo has too many pixels.");
    }
    jpeg = await image.rotate().jpeg({ quality: 88 }).toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(415, "The photo is not a supported image.");
  }
  const path = join(dir, `${randomUUID()}.jpg`);
  await writeFile(path, jpeg, { mode: 0o600 });
  return path;
}

export async function startSiteApi(port = Number(process.env.PORT ?? process.env.SITE_API_PORT ?? "8787")): Promise<{ url: string; close(): Promise<void> }> {
  const allowed = parseAllowedOrigins();
  const ipLimit = createRateLimiter(60 * 60 * 1000, 6);
  const globalLimit = createRateLimiter(60 * 60 * 1000, 40);
  const inFlight = new Set<string>();
  const host = process.env.SITE_API_HOST?.trim() || "0.0.0.0";
  const listenPort = Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : 8787;
  const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs");

  const corsHeaders = (origin: string | null): Record<string, string> => {
    if (!origin) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
  };

  const server = createServer(async (req, res) => {
    const origin = corsOrigin(req.headers.origin, allowed, req.headers.host);
    const cors = corsHeaders(origin);
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (method === "OPTIONS") {
        res.writeHead(origin ? 204 : 403, cors);
        res.end();
        return;
      }
      if (method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, ready: modelReady() }, cors);
        return;
      }
      if (method === "POST" && url.pathname === "/api/draft") {
        if (!origin) throw new HttpError(403, "This origin is not allowed to use the live model.");
        if (!modelReady()) throw new HttpError(503, "The live model is not configured on the server.");
        const key = clientKey(req.headers["x-forwarded-for"]?.toString(), req.socket.remoteAddress);
        if (!globalLimit("all") || !ipLimit(key)) {
          throw new HttpError(429, "Live draft limit reached. Try again later.");
        }
        if (inFlight.has(key)) throw new HttpError(429, "A draft is already running for you.");
        inFlight.add(key);
        const dir = await mkdtemp(join(tmpdir(), "resell-site-"));
        try {
          const form = await parseFormData(req);
          const photo = form.get("photo");
          if (!(photo instanceof File)) throw new HttpError(400, "Choose a photo first.");
          const notes = String(form.get("notes") ?? "").trim().slice(0, MAX_NOTES);
          const path = await savePhoto(photo, dir);
          const platforms: Platform[] = ["poshmark", "depop"];
          const draft = await buildDraft([path], notes, platforms);
          const ebay = await generateListing(draft.attributes, draft.price, "ebay");
          sendJson(res, 200, {
            attributes: draft.attributes,
            price: draft.price,
            listings: [ebay, ...draft.listings],
          }, cors);
        } finally {
          inFlight.delete(key);
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }
      if (method === "GET") {
        const file = resolvePublicFile(docsRoot, url.pathname);
        if (file) {
          const body = await readFile(file);
          res.writeHead(200, {
            "Content-Type": publicFileType(file),
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
          });
          res.end(body);
          return;
        }
      }
      sendJson(res, 404, { error: "Not found" }, cors);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, { error: String(error instanceof Error ? error.message : error) }, cors);
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(listenPort, host, () => resolveListen());
  });
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : listenPort;
  const url = `http://127.0.0.1:${actualPort}`;
  console.log(`Site API listening on ${url}`);
  return {
    url,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((err) => (err ? rejectClose(err) : resolveClose()));
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startSiteApi().catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}

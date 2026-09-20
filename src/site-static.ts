import { existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

export function resolvePublicFile(docsRoot: string, pathname: string): string | null {
  let relative = pathname.split("?")[0] ?? "";
  try {
    relative = decodeURIComponent(relative);
  } catch {
    return null;
  }
  if (!relative || relative === "/") relative = "/index.html";
  if (!relative.startsWith("/")) return null;
  relative = relative.slice(1);
  if (relative.includes("\0") || relative.split(/[\\/]/).some((part) => part === "..")) return null;
  const root = resolve(docsRoot);
  let full = resolve(root, relative);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (full !== root && !full.startsWith(prefix)) return null;
  if (!existsSync(full)) return null;
  if (statSync(full).isDirectory()) {
    full = resolve(full, "index.html");
    if (!full.startsWith(prefix) || !existsSync(full)) return null;
  }
  return full;
}

export function publicFileType(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
}

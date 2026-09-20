/** CORS and rate-limit helpers for the public website API. */

export const DEFAULT_SITE_ORIGINS = [
  "https://wuisabel-gif.github.io",
  "https://resell-agent.onrender.com",
];

export function parseAllowedOrigins(raw = process.env.SITE_ALLOWED_ORIGINS): string[] {
  const extra = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const render = (process.env.RENDER_EXTERNAL_URL ?? "").trim().replace(/\/+$/, "");
  return [...new Set([...DEFAULT_SITE_ORIGINS, ...extra, render].filter(Boolean))];
}

export function corsOrigin(
  origin: string | undefined,
  allowed: readonly string[],
  hostHeader?: string,
): string | null {
  if (!origin) return null;
  if (allowed.includes(origin)) return origin;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")) {
      return origin;
    }
    const host = (hostHeader ?? "").split(",")[0]?.trim();
    if (host && (parsed.host === host || parsed.hostname === host.split(":")[0])) return origin;
  } catch {
    return null;
  }
  return null;
}

export function clientKey(forwardedFor: string | undefined, remoteAddress: string | undefined): string {
  const forwarded = forwardedFor?.split(",")[0]?.trim();
  return forwarded || remoteAddress || "unknown";
}

export function createRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

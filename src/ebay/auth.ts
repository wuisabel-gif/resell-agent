import { cfg } from "../config.js";

const OAUTH_TOKEN_PATH = "/identity/v1/oauth2/token";

function basicAuth(): string {
  return Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const appTokenCache = new Map<string, { token: string; exp: number }>();

// App token (client credentials). Used for Browse / Taxonomy / Insights. No user login.
// Cached per scope — Marketplace Insights needs a different (gated) scope than Browse.
export async function getAppToken(scope: string = BASE_SCOPE): Promise<string> {
  const hit = appTokenCache.get(scope);
  if (hit && Date.now() < hit.exp) return hit.token;

  const body = new URLSearchParams({ grant_type: "client_credentials", scope });

  const res = await fetch(`${cfg.apiBase}${OAUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`app token failed: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  const entry = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  appTokenCache.set(scope, entry);
  return entry.token;
}

// Step 1 of user consent: build the URL the human opens in a browser.
export function buildConsentUrl(): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.sellScopes.join(" "),
  });
  return `${cfg.authBase}/oauth2/authorize?${p.toString()}`;
}

// Step 2: eBay redirects back with ?code=... . Exchange it for tokens.
export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });
  const res = await fetch(`${cfg.apiBase}${OAUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`code exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

let userTokenCache: { token: string; exp: number } | null = null;

// User token (Sell APIs). Refreshed from the stored refresh token.
export async function getUserToken(): Promise<string> {
  if (!cfg.userRefreshToken) {
    throw new Error(
      "EBAY_USER_REFRESH_TOKEN not set. Run `npm run auth-url`, approve, then `npm run auth-exchange -- <code>`."
    );
  }
  if (userTokenCache && Date.now() < userTokenCache.exp) return userTokenCache.token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cfg.userRefreshToken,
    scope: cfg.sellScopes.join(" "),
  });
  const res = await fetch(`${cfg.apiBase}${OAUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`user token refresh failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  userTokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return userTokenCache.token;
}

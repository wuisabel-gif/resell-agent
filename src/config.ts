// .env loader + eBay endpoint derivation. Reads process.env once at import.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
const production = env === "production";

// eBay's REST host, OAuth-consent host, and sell scopes differ per environment.
const apiBase = production ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
const authBase = production ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";

export const cfg = {
  env,
  apiBase,
  authBase,
  // Required, but read lazily so unrelated commands (help) don't crash on missing keys.
  get clientId() {
    return req("EBAY_CLIENT_ID");
  },
  get clientSecret() {
    return req("EBAY_CLIENT_SECRET");
  },
  // RuName / redirect only needed for the posting flow; empty is fine for pricing.
  redirectUri: process.env.EBAY_REDIRECT_URI ?? "",
  userRefreshToken: process.env.EBAY_USER_REFRESH_TOKEN ?? "",
  sellScopes: [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
  ],
};

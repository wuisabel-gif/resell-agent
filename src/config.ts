// Runtime .env access + eBay endpoint derivation. Values are read lazily so
// the local GUI can apply credentials to process.env for one running process.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

function ebayEnvironment(): string {
  return (process.env.EBAY_ENV ?? "sandbox").trim().toLowerCase() || "sandbox";
}

export const cfg = {
  get env() {
    return ebayEnvironment();
  },
  get apiBase() {
    return this.env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  },
  get authBase() {
    return this.env === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
  },
  // Required, but read lazily so unrelated commands (help) don't crash on missing keys.
  get clientId() {
    return req("EBAY_CLIENT_ID");
  },
  get clientSecret() {
    return req("EBAY_CLIENT_SECRET");
  },
  // RuName / redirect only needed for the posting flow; empty is fine for pricing.
  get redirectUri() {
    return process.env.EBAY_REDIRECT_URI ?? "";
  },
  get userRefreshToken() {
    return process.env.EBAY_USER_REFRESH_TOKEN ?? "";
  },
  sellScopes: [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
  ],
};

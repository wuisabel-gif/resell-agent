// Pure runtime GUI settings validation/merge tests; no network or GUI server.
import assert from "node:assert";
import { mergeRuntimeSettings, validateRuntimeSettings } from "./runtime-settings.js";

const validated = validateRuntimeSettings({
  ANTHROPIC_AUTH_TOKEN: " gateway-token ",
  ANTHROPIC_BASE_URL: "https://gateway.example.test/v1/",
  ANTHROPIC_MODEL: "claude-compatible",
  EBAY_ENV: "PRODUCTION",
  EBAY_REDIRECT_URI: "MyEbayRuName",
} as Record<string, unknown>);

assert.deepEqual(validated, {
  ANTHROPIC_AUTH_TOKEN: "gateway-token",
  ANTHROPIC_BASE_URL: "https://gateway.example.test/v1",
  ANTHROPIC_MODEL: "claude-compatible",
  EBAY_ENV: "production",
  EBAY_REDIRECT_URI: "MyEbayRuName",
});
assert.deepEqual(mergeRuntimeSettings({ ANTHROPIC_MODEL: "old", EBAY_ENV: "sandbox" }, validated), {
  ANTHROPIC_AUTH_TOKEN: "gateway-token",
  ANTHROPIC_BASE_URL: "https://gateway.example.test/v1",
  ANTHROPIC_MODEL: "claude-compatible",
  EBAY_ENV: "production",
  EBAY_REDIRECT_URI: "MyEbayRuName",
});
assert.throws(() => validateRuntimeSettings({ EBAY_ENV: "staging" }), /sandbox or production/);
assert.throws(() => validateRuntimeSettings({ ANTHROPIC_BASE_URL: "ftp://gateway.example.test" }), /http or https/);
assert.throws(() => validateRuntimeSettings({ ANTHROPIC_BASE_URL: "https://user:pass@gateway.example.test" }), /embedded credentials/);
assert.throws(() => validateRuntimeSettings({ EBAY_CLIENT_ID: "bad\nvalue" }), /control characters/);
assert.throws(() => validateRuntimeSettings({ NOT_A_SETTING: "value" }), /Unsupported runtime setting/);

console.log("runtime-settings.test ok");

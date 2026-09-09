// Pure checks for Anthropic-compatible gateway configuration.
// Run: npm run build && node dist/brain/anthropic.test.js
import assert from "node:assert";
import { authenticationHeaders, messagesEndpoint } from "./anthropic.js";

assert.equal(messagesEndpoint("https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
assert.equal(messagesEndpoint("https://api.example.test/v1/"), "https://api.example.test/v1/messages");
assert.deepEqual(authenticationHeaders("gateway-secret", undefined), { Authorization: "Bearer gateway-secret" });
assert.deepEqual(authenticationHeaders(undefined, "native-secret"), { "x-api-key": "native-secret" });
assert.throws(() => authenticationHeaders(undefined, undefined), /ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY/);

console.log("anthropic.test ok");

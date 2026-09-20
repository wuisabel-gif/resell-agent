import assert from "node:assert";
import { clientKey, corsOrigin, createRateLimiter, parseAllowedOrigins } from "./site-api-policy.js";

assert.deepEqual(parseAllowedOrigins(""), ["https://wuisabel-gif.github.io"]);
assert.ok(parseAllowedOrigins("https://example.test").includes("https://example.test"));

assert.equal(corsOrigin("https://wuisabel-gif.github.io", parseAllowedOrigins()), "https://wuisabel-gif.github.io");
assert.equal(corsOrigin("https://evil.example", parseAllowedOrigins()), null);
assert.equal(corsOrigin("http://127.0.0.1:4173", parseAllowedOrigins()), "http://127.0.0.1:4173");
assert.equal(corsOrigin("http://localhost:5500", parseAllowedOrigins()), "http://localhost:5500");

assert.equal(clientKey("  203.0.113.9, 10.0.0.1", "127.0.0.1"), "203.0.113.9");

const allow = createRateLimiter(60_000, 2);
assert.equal(allow("a", 1), true);
assert.equal(allow("a", 2), true);
assert.equal(allow("a", 3), false);
assert.equal(allow("b", 3), true);

console.log("site-api-policy.test ok");

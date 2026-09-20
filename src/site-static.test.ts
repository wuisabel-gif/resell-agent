import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicFileType, resolvePublicFile } from "./site-static.js";

const root = mkdtempSync(join(tmpdir(), "resell-docs-"));
writeFileSync(join(root, "index.html"), "<h1>home</h1>");
mkdirSync(join(root, "sub"));
writeFileSync(join(root, "sub", "page.html"), "<h1>page</h1>");

assert.equal(resolvePublicFile(root, "/"), join(root, "index.html"));
assert.equal(resolvePublicFile(root, "/index.html"), join(root, "index.html"));
assert.equal(resolvePublicFile(root, "/sub/page.html"), join(root, "sub", "page.html"));
assert.equal(resolvePublicFile(root, "/missing.html"), null);
assert.equal(resolvePublicFile(root, "/../index.html"), null);
assert.equal(resolvePublicFile(root, "/sub/../../index.html"), null);
assert.equal(publicFileType("x.html"), "text/html; charset=utf-8");
assert.equal(publicFileType("x.png"), "image/png");

console.log("site-static.test ok");

// Listens on an ephemeral port and closes cleanly. No Electron, photos, or network APIs.
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "resell-agent-gui-server-"));
process.env.GUI_DATA_DIR = dir;
process.env.GUI_ALLOW_REMOTE = "";
process.env.GUI_HOST = "";

const { startGui } = await import("./gui.js");
const handle = await startGui(0);

try {
  assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(handle.host, "127.0.0.1");
  assert.ok(handle.port > 0);
  const response = await fetch(handle.url);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /resell/i);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /gui_token=/);
  assert.match(cookie, /HttpOnly/i);
  console.log("gui-server.test ok");
} finally {
  await handle.close();
  await handle.close();
  await rm(dir, { recursive: true, force: true });
}

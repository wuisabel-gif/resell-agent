import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {{ close(): Promise<void> } | null} */
let gui = null;
let stopping = false;

function applyEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

async function openExternalHttps(url) {
  if (url.startsWith("https:")) await shell.openExternal(url);
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "resell·agent",
    backgroundColor: "#F6F2F5",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void openExternalHttps(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (isAppUrl(target)) return;
    event.preventDefault();
    void openExternalHttps(target);
  });
  void win.loadURL(url);
  return win;
}

async function stopGui() {
  if (!gui) return;
  const handle = gui;
  gui = null;
  await handle.close().catch(() => undefined);
}

async function boot() {
  app.setName("Resell Agent");
  const userData = app.getPath("userData");
  if (!process.env.GUI_DATA_DIR) process.env.GUI_DATA_DIR = join(userData, "gui-data");
  applyEnvFile(join(userData, ".env"));
  if (!app.isPackaged) applyEnvFile(join(process.cwd(), ".env"));

  const guiModuleUrl = pathToFileURL(join(here, "..", "dist", "gui.js")).href;
  const { startGui } = await import(guiModuleUrl);
  gui = await startGui(0);
  mainWindow = createWindow(gui.url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => boot()).catch(async (error) => {
    await dialog.showErrorBox("resell·agent", String(error instanceof Error ? error.message : error));
    app.quit();
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", (event) => {
    if (stopping || !gui) return;
    event.preventDefault();
    stopping = true;
    void stopGui().finally(() => app.quit());
  });
}

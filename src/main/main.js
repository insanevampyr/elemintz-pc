import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerMultiplayerIpcHandlers } from "./ipc/multiplayerIpc.js";
import { registerStateIpcHandlers } from "./ipc/stateIpc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on("uncaughtException", (error) => {
  console.error("[Main] uncaughtException", {
    message: error?.message,
    stack: error?.stack,
    code: error?.code
  });
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[Main] unhandledRejection", {
    message: error?.message,
    stack: error?.stack
  });
});

app.on("renderer-process-crashed", (_event, webContents, killed) => {
  console.error("[Main] renderer-process-crashed", {
    url: webContents?.getURL?.(),
    killed
  });
});

app.on("render-process-gone", (_event, webContents, details) => {
  console.error("[Main] render-process-gone", {
    url: webContents?.getURL?.(),
    details
  });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.info("[Main] BrowserWindow created", {
    id: win.id
  });

  win.webContents.on("did-finish-load", () => {
    console.info("[Main] index.html finished loading", {
      id: win.id,
      url: win.webContents.getURL()
    });
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[Main] did-fail-load", {
      id: win.id,
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Main] webContents render-process-gone", {
      id: win.id,
      details
    });
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.info("[Renderer console-message]", {
      level,
      message,
      line,
      sourceId
    });
  });

  win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  const dataDir = path.join(app.getPath("userData"), "elemintz-data");
  registerStateIpcHandlers(ipcMain, { dataDir });
  registerMultiplayerIpcHandlers(ipcMain);

  console.info("[Startup] Electron userData", {
    userData: app.getPath("userData"),
    stateDataDir: dataDir
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  console.info("[Main] window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});





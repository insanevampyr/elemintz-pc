import { app, BrowserWindow, ipcMain, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerMultiplayerIpcHandlers } from "./ipc/multiplayerIpc.js";
import { registerStateIpcHandlers } from "./ipc/stateIpc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function writeStartupLogLine({
  appDataPath,
  userDataPath,
  startupLogPath,
  multiplayerClientLogPath
} = {}) {
  const timestamp = new Date().toISOString();

  fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
  fs.appendFileSync(
    startupLogPath,
    `${timestamp} MAIN PROCESS STARTED | appData=${appDataPath} | userData=${userDataPath} | envAPPDATA=${process.env.APPDATA ?? ""} | startupLogPath=${startupLogPath} | multiplayerClientLogPath=${multiplayerClientLogPath}\n`,
    "utf8"
  );
}

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

function configurePermissionDenials(targetSession) {
  if (!targetSession) {
    return;
  }

  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === "geolocation") {
      return false;
    }
    return true;
  });

  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "geolocation") {
      console.info("[Main] denied permission request", {
        permission
      });
      callback(false);
      return;
    }
    callback(true);
  });
}

app.whenReady().then(() => {
  const appDataPath = app.getPath("appData");
  const userDataPath = app.getPath("userData");
  const startupLogPath = path.join(appDataPath, "elemintz-pc", "logs", "startup.log");
  const multiplayerClientLogPath = path.join(appDataPath, "elemintz-pc", "logs", "multiplayer-client.log");

  writeStartupLogLine({
    appDataPath,
    userDataPath,
    startupLogPath,
    multiplayerClientLogPath
  });
  configurePermissionDenials(session.defaultSession);

  const dataDir = path.join(userDataPath, "elemintz-data");
  const multiplayerIpc = registerMultiplayerIpcHandlers(ipcMain, { dataDir, appDataPath });
  registerStateIpcHandlers(ipcMain, {
    dataDir,
    getOnlineAuthorityState: () => multiplayerIpc?.client?.getState?.() ?? null
  });

  console.info("[Startup] Electron userData", {
    appData: appDataPath,
    userData: userDataPath,
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





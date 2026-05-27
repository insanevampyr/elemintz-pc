import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../../state/storage/jsonStore.js";

export const MULTIPLAYER_RUNTIME_CONFIG_FILENAME = "multiplayer-config.json";

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function defaultElectronUserDataPath() {
  switch (process.platform) {
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "EleMintz");
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "EleMintz");
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "EleMintz");
  }
}

export function resolveMultiplayerRuntimeDataDir(explicitDataDir) {
  if (explicitDataDir) {
    return path.resolve(explicitDataDir);
  }

  if (process.env.ELEMINTZ_DATA_DIR) {
    return path.resolve(process.env.ELEMINTZ_DATA_DIR);
  }

  return path.join(defaultElectronUserDataPath(), "elemintz-data");
}

export function resolveMultiplayerRuntimeConfigPath({ dataDir } = {}) {
  return path.join(
    resolveMultiplayerRuntimeDataDir(dataDir),
    MULTIPLAYER_RUNTIME_CONFIG_FILENAME
  );
}

export function normalizeMultiplayerRuntimeConfig(value) {
  const safeValue =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const serverUrl = String(safeValue.serverUrl ?? "").trim();
  const updatedAt = String(safeValue.updatedAt ?? "").trim();
  const source = String(safeValue.source ?? "").trim();

  return {
    serverUrl: serverUrl.length > 0 ? serverUrl : null,
    updatedAt: updatedAt.length > 0 ? updatedAt : null,
    source: source.length > 0 ? source : null
  };
}

export function hasRuntimeServerUrl(config) {
  return String(config?.serverUrl ?? "").trim().length > 0;
}

export function buildMultiplayerRuntimeConfig({
  serverUrl,
  updatedAt = new Date().toISOString(),
  source = "manual"
} = {}) {
  const normalized = normalizeMultiplayerRuntimeConfig({
    serverUrl,
    updatedAt,
    source
  });

  if (!hasRuntimeServerUrl(normalized)) {
    throw new Error("multiplayer runtime config requires a non-empty serverUrl");
  }

  return normalized;
}

export function readMultiplayerRuntimeConfigSync({ dataDir, logger = console } = {}) {
  const filePath = resolveMultiplayerRuntimeConfigPath({ dataDir });

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const normalized = normalizeMultiplayerRuntimeConfig(JSON.parse(stripBom(raw)));
    return hasRuntimeServerUrl(normalized) ? normalized : null;
  } catch (error) {
    logger?.warn?.("[MultiplayerConfig] failed to read runtime config", {
      filePath,
      message: error?.message ?? String(error)
    });
    return null;
  }
}

export async function readMultiplayerRuntimeConfig({ dataDir, logger = console } = {}) {
  const filePath = resolveMultiplayerRuntimeConfigPath({ dataDir });

  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const normalized = normalizeMultiplayerRuntimeConfig(JSON.parse(stripBom(raw)));
    return hasRuntimeServerUrl(normalized) ? normalized : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    logger?.warn?.("[MultiplayerConfig] failed to read runtime config", {
      filePath,
      message: error?.message ?? String(error)
    });
    return null;
  }
}

export async function writeMultiplayerRuntimeConfig(config, { dataDir } = {}) {
  const resolvedDataDir = resolveMultiplayerRuntimeDataDir(dataDir);
  const store = new JsonStore(MULTIPLAYER_RUNTIME_CONFIG_FILENAME, {
    dataDir: resolvedDataDir
  });
  const normalized = buildMultiplayerRuntimeConfig(config);
  await store.write(normalized);
  return {
    config: normalized,
    filePath: store.filePath
  };
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMultiplayerRuntimeConfig,
  readMultiplayerRuntimeConfig,
  resolveMultiplayerRuntimeConfigPath,
  writeMultiplayerRuntimeConfig
} from "../src/main/multiplayer/multiplayerConfig.js";

export const NGROK_API_URL = "http://127.0.0.1:4040/api/tunnels";

export function selectHttpsNgrokTunnel(payload) {
  const tunnels = Array.isArray(payload?.tunnels) ? payload.tunnels : [];
  const httpsTunnels = tunnels.filter((entry) =>
    String(entry?.public_url ?? "").trim().startsWith("https://")
  );

  if (httpsTunnels.length === 0) {
    const error = new Error("No HTTPS ngrok tunnel found.");
    error.code = "NGROK_HTTPS_TUNNEL_NOT_FOUND";
    throw error;
  }

  return {
    tunnel: httpsTunnels[0],
    httpsTunnels
  };
}

export async function fetchNgrokTunnels({
  apiUrl = NGROK_API_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const response = await fetchImpl(apiUrl);
    if (!response?.ok) {
      throw new Error(`Unexpected ngrok API response (${response?.status ?? "unknown"}).`);
    }

    return await response.json();
  } catch (error) {
    const nextError = new Error(
      `Could not reach ngrok local API at ${apiUrl}. Is ngrok running?`
    );
    nextError.code = "NGROK_API_UNAVAILABLE";
    nextError.cause = error;
    throw nextError;
  }
}

export async function updateNgrokUrlRuntimeConfig({
  apiUrl = NGROK_API_URL,
  dataDir,
  fetchImpl = globalThis.fetch,
  now = () => new Date()
} = {}) {
  const payload = await fetchNgrokTunnels({ apiUrl, fetchImpl });
  const { tunnel, httpsTunnels } = selectHttpsNgrokTunnel(payload);
  const oldConfig = await readMultiplayerRuntimeConfig({ dataDir });
  const nextConfig = buildMultiplayerRuntimeConfig({
    serverUrl: tunnel.public_url,
    updatedAt: now().toISOString(),
    source: "ngrok-helper"
  });
  const { filePath } = await writeMultiplayerRuntimeConfig(nextConfig, { dataDir });

  return {
    oldUrl: oldConfig?.serverUrl ?? null,
    newUrl: nextConfig.serverUrl,
    filePath,
    selectedTunnelName: String(tunnel?.name ?? "").trim() || null,
    httpsTunnelUrls: httpsTunnels.map((entry) => String(entry?.public_url ?? "").trim()).filter(Boolean),
    changed: oldConfig?.serverUrl !== nextConfig.serverUrl
  };
}

function printResult(result) {
  if (Array.isArray(result.httpsTunnelUrls) && result.httpsTunnelUrls.length > 1) {
    console.warn("Multiple HTTPS ngrok tunnels were found. Using the first HTTPS tunnel:");
    for (const url of result.httpsTunnelUrls) {
      console.warn(`- ${url}`);
    }
  }

  console.info(`Old URL: ${result.oldUrl ?? "(none)"}`);
  console.info(`New URL: ${result.newUrl}`);
  console.info(`Config file: ${result.filePath}`);
  console.info("Fully close and reopen EleMintz for the new server URL to be used.");
}

async function main() {
  const result = await updateNgrokUrlRuntimeConfig();
  printResult(result);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isDirectRun = entryPath === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}

export const __private__ = {
  printResult,
  main,
  resolveMultiplayerRuntimeConfigPath
};

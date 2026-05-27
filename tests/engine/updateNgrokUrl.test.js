import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MULTIPLAYER_RUNTIME_CONFIG_FILENAME,
  resolveMultiplayerRuntimeConfigPath
} from "../../src/main/multiplayer/multiplayerConfig.js";
import {
  selectHttpsNgrokTunnel,
  updateNgrokUrlRuntimeConfig
} from "../../scripts/updateNgrokUrl.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-ngrok-helper-"));
}

test("ngrok helper: selects the first HTTPS tunnel from the ngrok API payload", () => {
  const { tunnel, httpsTunnels } = selectHttpsNgrokTunnel({
    tunnels: [
      { name: "tcp", public_url: "tcp://0.tcp.ngrok.io:12345" },
      { name: "https-primary", public_url: "https://first.ngrok-free.app" },
      { name: "https-secondary", public_url: "https://second.ngrok-free.app" }
    ]
  });

  assert.equal(tunnel?.public_url, "https://first.ngrok-free.app");
  assert.deepEqual(
    httpsTunnels.map((entry) => entry.public_url),
    ["https://first.ngrok-free.app", "https://second.ngrok-free.app"]
  );
});

test("ngrok helper: fails cleanly when no HTTPS tunnel exists", () => {
  assert.throws(
    () =>
      selectHttpsNgrokTunnel({
        tunnels: [{ name: "tcp", public_url: "tcp://0.tcp.ngrok.io:12345" }]
      }),
    /No HTTPS ngrok tunnel found\./
  );
});

test("ngrok helper: writes a valid runtime config JSON shape from the HTTPS tunnel", async () => {
  const dataDir = await createTempDataDir();

  try {
    const result = await updateNgrokUrlRuntimeConfig({
      dataDir,
      now: () => new Date("2026-05-27T18:00:00.000Z"),
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            tunnels: [
              { name: "https-primary", public_url: "https://fresh-tunnel.ngrok-free.app" }
            ]
          };
        }
      })
    });

    assert.equal(result.oldUrl, null);
    assert.equal(result.newUrl, "https://fresh-tunnel.ngrok-free.app");
    assert.equal(
      result.filePath,
      resolveMultiplayerRuntimeConfigPath({ dataDir })
    );

    const written = JSON.parse(
      await fs.readFile(path.join(dataDir, MULTIPLAYER_RUNTIME_CONFIG_FILENAME), "utf8")
    );
    assert.deepEqual(written, {
      serverUrl: "https://fresh-tunnel.ngrok-free.app",
      updatedAt: "2026-05-27T18:00:00.000Z",
      source: "ngrok-helper"
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

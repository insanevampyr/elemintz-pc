import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerStateIpcHandlers } from "../../src/main/ipc/stateIpc.js";
import { StateCoordinator } from "../../src/state/stateCoordinator.js";

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-offline-authority-"));
}

function createFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}

test("state IPC no longer registers removed local daily reward and store mutation handlers while keeping chest open available", async () => {
  const dataDir = await createTempDataDir();

  try {
    const ipcMain = createFakeIpcMain();
    registerStateIpcHandlers(ipcMain, {
      dataDir,
      getOnlineAuthorityState: () => ({
        session: {
          authenticated: true,
          username: "OnlineUser"
        }
      })
    });

    assert.equal(ipcMain.handlers.has("state:claimDailyLoginReward"), false);
    assert.equal(ipcMain.handlers.has("state:buyStoreItem"), false);
    assert.equal(ipcMain.handlers.has("state:grantSupporterPass"), false);
    assert.equal(ipcMain.handlers.has("state:openChest"), true);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("state IPC still keeps remaining guarded local mutation handlers for valid non-online flows", async () => {
  const dataDir = await createTempDataDir();

  try {
    const ipcMain = createFakeIpcMain();
    registerStateIpcHandlers(ipcMain, {
      dataDir,
      getOnlineAuthorityState: () => ({
        session: {
          authenticated: true,
          username: "DifferentUser"
        }
      })
    });

    assert.equal(ipcMain.handlers.has("state:recordMatchResult"), true);
    assert.equal(ipcMain.handlers.has("state:equipCosmetic"), true);
    assert.equal(ipcMain.handlers.has("state:updateCosmeticPreferences"), true);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("state IPC allows local authoritative match-result persistence for authenticated profiles in pve and local_pvp", async () => {
  const dataDir = await createTempDataDir();
  const originalRecordMatchResult = StateCoordinator.prototype.recordMatchResult;
  const calls = [];

  StateCoordinator.prototype.recordMatchResult = async function stubRecordMatchResult(payload) {
    calls.push(payload);
    return { ok: true, mode: payload?.matchState?.mode ?? null };
  };

  try {
    const ipcMain = createFakeIpcMain();
    registerStateIpcHandlers(ipcMain, {
      dataDir,
      getOnlineAuthorityState: () => ({
        session: {
          authenticated: true,
          username: "OnlineUser"
        }
      })
    });

    const handler = ipcMain.handlers.get("state:recordMatchResult");
    assert.equal(typeof handler, "function");

    const pveResult = await handler({}, {
      username: "OnlineUser",
      perspective: "p1",
      matchState: { mode: "pve", status: "completed" }
    });
    const pvpResult = await handler({}, {
      username: "OnlineUser",
      perspective: "p1",
      matchState: { mode: "local_pvp", status: "completed" }
    });

    assert.deepEqual(calls.map((payload) => payload.matchState.mode), ["pve", "local_pvp"]);
    assert.equal(pveResult.mode, "pve");
    assert.equal(pvpResult.mode, "local_pvp");
  } finally {
    StateCoordinator.prototype.recordMatchResult = originalRecordMatchResult;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("state IPC still blocks recordMatchResult for authenticated online-authority payloads", async () => {
  const dataDir = await createTempDataDir();

  try {
    const ipcMain = createFakeIpcMain();
    registerStateIpcHandlers(ipcMain, {
      dataDir,
      getOnlineAuthorityState: () => ({
        session: {
          authenticated: true,
          username: "OnlineUser"
        }
      })
    });

    const handler = ipcMain.handlers.get("state:recordMatchResult");
    assert.equal(typeof handler, "function");

    await assert.rejects(
      () =>
        handler({}, {
          username: "OnlineUser",
          perspective: "p1",
          matchState: { mode: "online_pvp", status: "completed" }
        }),
      (error) => error?.code === "ONLINE_ONLY_SERVER_AUTHORITY"
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("state IPC blocks local chest opening for authenticated online-authority profiles", async () => {
  const dataDir = await createTempDataDir();

  try {
    const ipcMain = createFakeIpcMain();
    registerStateIpcHandlers(ipcMain, {
      dataDir,
      getOnlineAuthorityState: () => ({
        session: {
          authenticated: true,
          username: "OnlineUser"
        }
      })
    });

    const handler = ipcMain.handlers.get("state:openChest");
    assert.equal(typeof handler, "function");

    await assert.rejects(
      () =>
        handler({}, {
          username: "OnlineUser",
          chestType: "epic"
        }),
      (error) => error?.code === "ONLINE_ONLY_SERVER_AUTHORITY"
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

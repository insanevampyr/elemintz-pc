import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { createUpdateLifecycleStore } from "../../src/main/updates/updateLifecycle.js";
import { registerUpdateIpcHandlers } from "../../src/main/ipc/updateIpc.js";
import { buildUpdateCoordinatorState, buildUpdateDiagnosticsSnapshot } from "../../src/renderer/systems/updateCoordinator.js";
import { createUpdaterAdapter } from "../../src/main/updates/updaterAdapter.js";
import { RUNTIME_PUBLISH_CONFIGURATION, hasRuntimePublishConfiguration } from "../../src/main/updates/publishConfiguration.js";

function createFakeIpcMain() {
  const handlers = new Map();
  const events = new Map();
  return {
    handlers,
    events,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    on(channel, handler) {
      events.set(channel, handler);
    }
  };
}

function createFakeSender() {
  return {
    messages: [],
    send(channel, payload) {
      this.messages.push({ channel, payload });
    },
    isDestroyed() {
      return false;
    }
  };
}

function createFakeLogger() {
  const entries = [];
  return {
    entries,
    info(message, details = {}) {
      entries.push({ level: "info", message, details });
    },
    error(message, details = {}) {
      entries.push({ level: "error", message, details });
    }
  };
}

function createFakeUpdater() {
  const emitter = new EventEmitter();
  const calls = {
    checkForUpdates: 0,
    downloadUpdate: 0,
    quitAndInstall: 0,
    setFeedURL: []
  };

  emitter.checkForUpdates = async () => {
    calls.checkForUpdates += 1;
    emitter.emit("checking-for-update");
    return { cancellationToken: null };
  };
  emitter.downloadUpdate = async () => {
    calls.downloadUpdate += 1;
    return ["EleMintz_Setup_test.exe"];
  };
  emitter.quitAndInstall = () => {
    calls.quitAndInstall += 1;
  };
  emitter.setFeedURL = (configuration) => {
    calls.setFeedURL.push(configuration);
  };
  emitter.autoDownload = true;
  emitter.autoInstallOnAppQuit = true;

  return {
    updater: emitter,
    calls
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("update lifecycle: initial state is idle", () => {
  const store = createUpdateLifecycleStore();
  const state = store.getState();

  assert.equal(state.status, "idle");
  assert.equal(state.restartRequested, false);
  assert.equal(state.deferredUntilSafe, false);
  assert.equal(state.error, null);
  assert.equal(state.lastCheckedAt, null);
  assert.match(state.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("update IPC: requestCheck is disabled safely in dev/unpackaged mode", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    isPackaged: false,
    hasPublishConfiguration: true,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: false,
      hasPublishConfiguration: true
    })
  });

  const response = await ipcMain.handlers.get("updates:requestCheck")();

  assert.equal(response.status, "idle");
  assert.equal(response.restartRequested, false);
  assert.equal(response.deferredUntilSafe, false);
  assert.match(response.message, /disabled in dev\/unpackaged builds/i);
  assert.match(response.lastCheckedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls.checkForUpdates, 0);
  assert.equal(calls.downloadUpdate, 0);
  assert.equal(calls.quitAndInstall, 0);
});

test("update IPC: requestDownload is disabled safely in dev/unpackaged mode", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "available",
    updateInfo: { version: "9.9.9" }
  });
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    isPackaged: false,
    hasPublishConfiguration: true,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: false,
      hasPublishConfiguration: true
    })
  });

  const response = await ipcMain.handlers.get("updates:requestDownload")();

  assert.equal(response.status, "available");
  assert.match(response.message, /disabled in dev\/unpackaged builds/i);
  assert.equal(calls.downloadUpdate, 0);
  assert.equal(calls.quitAndInstall, 0);
});

test("update IPC: requestInstallWhenSafe sets deferred restart state and cancel clears it", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "downloaded",
    message: "Update downloaded."
  });
  registerUpdateIpcHandlers(ipcMain, { store });

  const deferred = await ipcMain.handlers.get("updates:requestInstallWhenSafe")();
  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.restartRequested, true);
  assert.equal(deferred.deferredUntilSafe, true);

  const cleared = await ipcMain.handlers.get("updates:cancelDeferredInstall")();
  assert.equal(cleared.status, "downloaded");
  assert.equal(cleared.restartRequested, false);
  assert.equal(cleared.deferredUntilSafe, false);
});

test("update IPC: mock downloaded trigger sets lifecycle to downloaded with mock update info", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  registerUpdateIpcHandlers(ipcMain, { store, allowDevSimulation: true });

  const state = await ipcMain.handlers.get("updates:devMarkDownloaded")({}, { version: "1.2.3-mock" });

  assert.equal(state.status, "downloaded");
  assert.equal(state.updateInfo?.version, "1.2.3-mock");
  assert.equal(state.updateInfo?.mock, true);
  assert.equal(state.downloadProgress?.percent, 100);
  assert.equal(state.restartRequested, false);
  assert.equal(state.deferredUntilSafe, false);
});

test("update IPC: stateChanged notification emits on lifecycle changes", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  registerUpdateIpcHandlers(ipcMain, { store, allowDevSimulation: true });

  const sender = createFakeSender();
  ipcMain.events.get("updates:subscribe")({ sender });
  sender.messages.length = 0;

  await ipcMain.handlers.get("updates:devMarkDownloaded")({}, { version: "9.9.9-mock" });
  await ipcMain.handlers.get("updates:requestInstallWhenSafe")();

  assert.equal(sender.messages.length, 2);
  assert.deepEqual(
    sender.messages.map((entry) => entry.channel),
    ["updates:stateChanged", "updates:stateChanged"]
  );
  assert.equal(sender.messages[0].payload.status, "downloaded");
  assert.equal(sender.messages[0].payload.updateInfo?.mock, true);
  assert.equal(sender.messages[1].payload.status, "deferred");
  assert.equal(sender.messages[1].payload.restartRequested, true);
});

test("update adapter: real updater events map into lifecycle state without install side effects", async () => {
  const store = createUpdateLifecycleStore();
  const { updater, calls } = createFakeUpdater();
  createUpdaterAdapter({
    store,
    updater,
    isPackaged: true,
    hasPublishConfiguration: true
  });

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);

  updater.emit("update-available", { version: "0.1.7" });
  await flushMicrotasks();
  let state = store.getState();
  assert.equal(state.status, "downloading");
  assert.equal(state.updateInfo?.version, "0.1.7");
  assert.equal(calls.downloadUpdate, 1);

  updater.emit("download-progress", { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 8 });
  state = store.getState();
  assert.equal(state.status, "downloading");
  assert.equal(state.downloadProgress?.percent, 42);

  updater.emit("update-downloaded", { version: "0.1.7", files: ["EleMintz-Setup.exe"] });
  state = store.getState();
  assert.equal(state.status, "downloaded");
  assert.equal(state.updateInfo?.version, "0.1.7");
  assert.equal(state.restartRequested, false);
  assert.equal(state.deferredUntilSafe, false);
  assert.equal(calls.quitAndInstall, 0);
});

test("update IPC: requestDownload uses the real adapter only when an update is available", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "available",
    message: "Update available.",
    updateInfo: { version: "2.0.1" }
  });
  const { updater, calls } = createFakeUpdater();
  const adapter = createUpdaterAdapter({
    store,
    updater,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: adapter,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  const response = await ipcMain.handlers.get("updates:requestDownload")();

  assert.equal(calls.downloadUpdate, 1);
  assert.equal(calls.quitAndInstall, 0);
  assert.equal(response.status, "downloading");
  assert.match(response.message, /starting update download/i);
});

test("update IPC: duplicate requestDownload calls are blocked while download is in flight", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "available",
    message: "Update available.",
    updateInfo: { version: "2.0.1" }
  });
  const { updater, calls } = createFakeUpdater();
  let resolveDownload = null;
  updater.downloadUpdate = () => {
    calls.downloadUpdate += 1;
    return new Promise((resolve) => {
      resolveDownload = resolve;
    });
  };
  const adapter = createUpdaterAdapter({
    store,
    updater,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: adapter,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  const firstPromise = ipcMain.handlers.get("updates:requestDownload")();
  const secondResponse = await ipcMain.handlers.get("updates:requestDownload")();

  assert.equal(calls.downloadUpdate, 1);
  assert.equal(secondResponse.status, "downloading");
  assert.match(secondResponse.message, /already in progress/i);
  assert.equal(calls.quitAndInstall, 0);

  resolveDownload?.(["EleMintz_Setup_2.0.1.exe"]);
  await firstPromise;
});

test("update IPC: requestDownload rejects when no update is available", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "idle",
    message: "No updates available."
  });
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: true,
      hasPublishConfiguration: true,
      publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
    }),
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  const response = await ipcMain.handlers.get("updates:requestDownload")();

  assert.equal(response.status, "error");
  assert.match(response.message, /no available update to download/i);
  assert.equal(calls.downloadUpdate, 0);
  assert.equal(calls.quitAndInstall, 0);
});

test("update IPC: requestInstall is blocked when no downloaded update exists", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "available",
    message: "Update available.",
    updateInfo: { version: "2.0.2" }
  });
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: true,
      hasPublishConfiguration: true,
      publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
    })
  });

  const response = await ipcMain.handlers.get("updates:requestInstall")(null, { safe: true, reasons: [] });

  assert.equal(response.status, "error");
  assert.match(response.message, /no downloaded update/i);
  assert.equal(calls.quitAndInstall, 0);
});

test("update IPC: requestInstall defers while unsafe", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "downloaded",
    message: "Update downloaded.",
    updateInfo: { version: "2.0.2" }
  });
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: true,
      hasPublishConfiguration: true,
      publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
    })
  });

  const response = await ipcMain.handlers.get("updates:requestInstall")(null, {
    safe: false,
    reasons: ["active_match"],
    checkedAt: "2026-05-07T00:30:00.000Z"
  });

  assert.equal(response.status, "deferred");
  assert.equal(response.restartRequested, true);
  assert.equal(response.deferredUntilSafe, true);
  assert.equal(calls.quitAndInstall, 0);
});

test("update IPC: duplicate deferred requestInstall calls are blocked while unsafe", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "deferred",
    message: "Update install requested. Waiting for a safe restart window.",
    updateInfo: { version: "2.0.2" },
    restartRequested: true,
    deferredUntilSafe: true
  });
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: true,
      hasPublishConfiguration: true,
      publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
    })
  });

  const response = await ipcMain.handlers.get("updates:requestInstall")(null, {
    safe: false,
    reasons: ["active_match"]
  });

  assert.equal(response.status, "deferred");
  assert.match(response.message, /already deferred/i);
  assert.equal(calls.quitAndInstall, 0);
});

test("update IPC: requestInstall calls quitAndInstall only when safe", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "downloaded",
    message: "Update downloaded.",
    updateInfo: { version: "2.0.2" }
  });
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: true,
      hasPublishConfiguration: true,
      publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
    })
  });

  const response = await ipcMain.handlers.get("updates:requestInstall")(null, {
    safe: true,
    reasons: [],
    checkedAt: "2026-05-07T00:31:00.000Z"
  });

  assert.equal(response.status, "readyToInstall");
  assert.equal(response.restartRequested, true);
  assert.equal(response.deferredUntilSafe, false);
  assert.equal(calls.quitAndInstall, 1);
});

test("update IPC: duplicate requestInstall calls are blocked once install has started", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore({
    status: "downloaded",
    message: "Update downloaded.",
    updateInfo: { version: "2.0.2" }
  });
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: true,
      hasPublishConfiguration: true,
      publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
    })
  });

  await ipcMain.handlers.get("updates:requestInstall")(null, { safe: true, reasons: [] });
  const response = await ipcMain.handlers.get("updates:requestInstall")(null, { safe: true, reasons: [] });

  assert.equal(response.status, "readyToInstall");
  assert.match(response.message, /already requested/i);
  assert.equal(calls.quitAndInstall, 1);
});

test("update IPC: requestCheck uses the real adapter in packaged builds without install side effects", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  const { updater, calls } = createFakeUpdater();
  const adapter = createUpdaterAdapter({
    store,
    updater,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: adapter,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  const response = await ipcMain.handlers.get("updates:requestCheck")();

  assert.equal(calls.checkForUpdates, 1);
  assert.deepEqual(calls.setFeedURL, [RUNTIME_PUBLISH_CONFIGURATION]);
  assert.equal(calls.quitAndInstall, 0);
  assert.equal(response.status, "checking");
  assert.equal(response.restartRequested, false);
  assert.equal(response.deferredUntilSafe, false);
});

test("update IPC: update-available auto-triggers requestDownload and logs the download lifecycle", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  const { updater, calls } = createFakeUpdater();
  const logger = createFakeLogger();
  updater.checkForUpdates = async () => {
    calls.checkForUpdates += 1;
    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "2.1.5" });
    return { cancellationToken: null };
  };
  updater.downloadUpdate = async () => {
    calls.downloadUpdate += 1;
    updater.emit("download-progress", {
      percent: 50,
      transferred: 500,
      total: 1000,
      bytesPerSecond: 250
    });
    updater.emit("update-downloaded", { version: "2.1.5", files: ["EleMintz_Setup_2.1.5.exe"] });
    return ["EleMintz_Setup_2.1.5.exe"];
  };
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      logger,
      isPackaged: true,
      hasPublishConfiguration: true,
      publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
    }),
    logger,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  await ipcMain.handlers.get("updates:requestCheck")();
  await flushMicrotasks();

  const state = store.getState();
  assert.equal(calls.checkForUpdates, 1);
  assert.equal(calls.downloadUpdate, 1);
  assert.equal(state.status, "downloaded");
  assert.equal(state.updateInfo?.version, "2.1.5");
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] download started"),
    true
  );
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] download progress"),
    true
  );
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] update downloaded"),
    true
  );
});

test("update IPC: packaged startup schedules a one-time updater check", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  const { updater, calls } = createFakeUpdater();
  const logger = createFakeLogger();
  updater.checkForUpdates = async () => {
    calls.checkForUpdates += 1;
    updater.emit("checking-for-update");
    updater.emit("update-not-available", { version: "2.1.3" });
    return { cancellationToken: null };
  };
  const adapter = createUpdaterAdapter({
    store,
    updater,
    logger,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  const scheduled = [];
  const registration = registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: adapter,
    logger,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  assert.equal(
    registration.scheduleStartupUpdateCheck({
      delayMs: 250,
      timer: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return 1;
      }
    }),
    true
  );
  assert.equal(registration.scheduleStartupUpdateCheck(), false);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 250);
  assert.equal(calls.checkForUpdates, 0);

  await scheduled[0].callback();

  assert.equal(calls.checkForUpdates, 1);
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] auto-check scheduled"),
    true
  );
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] updater check started"),
    true
  );
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] check started"),
    true
  );
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] update not available"),
    true
  );
});

test("update IPC: prompt events are logged for startup.log visibility", async () => {
  const ipcMain = createFakeIpcMain();
  const logger = createFakeLogger();
  registerUpdateIpcHandlers(ipcMain, {
    logger
  });

  assert.equal(
    await ipcMain.handlers.get("updates:reportPromptEvent")(null, {
      type: "install_prompt_shown",
      version: "2.1.5"
    }),
    true
  );
  assert.equal(
    await ipcMain.handlers.get("updates:reportPromptEvent")(null, {
      type: "user_chose_later",
      version: "2.1.5"
    }),
    true
  );
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] install_prompt_shown"),
    true
  );
  assert.equal(
    logger.entries.some((entry) => entry.message === "[Updater] user_chose_later"),
    true
  );
});

test("update IPC: startup auto-check is skipped safely in dev/unpackaged mode", () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  const { updater, calls } = createFakeUpdater();
  const logger = createFakeLogger();
  const registration = registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      logger,
      isPackaged: false,
      hasPublishConfiguration: true
    }),
    logger,
    isPackaged: false,
    hasPublishConfiguration: true
  });

  const scheduled = [];
  assert.equal(
    registration.scheduleStartupUpdateCheck({
      timer: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return 1;
      }
    }),
    false
  );
  assert.equal(scheduled.length, 0);
  assert.equal(calls.checkForUpdates, 0);
  assert.equal(
    logger.entries.some(
      (entry) =>
        entry.message === "[Updater] auto-check skipped on startup because app is not packaged"
    ),
    true
  );
});

test("update IPC: requestCheck reports a safe error when publish config is missing", async () => {
  const ipcMain = createFakeIpcMain();
  const store = createUpdateLifecycleStore();
  const { updater, calls } = createFakeUpdater();
  registerUpdateIpcHandlers(ipcMain, {
    store,
    updaterAdapter: createUpdaterAdapter({
      store,
      updater,
      isPackaged: true,
      hasPublishConfiguration: false
    }),
    isPackaged: true,
    hasPublishConfiguration: false
  });

  const response = await ipcMain.handlers.get("updates:requestCheck")();

  assert.equal(response.status, "error");
  assert.match(response.message, /publish configuration is missing/i);
  assert.equal(calls.checkForUpdates, 0);
  assert.deepEqual(calls.setFeedURL, []);
  assert.equal(calls.quitAndInstall, 0);
});

test("publish config: packaged-style runtime config detection succeeds for shipped GitHub config", () => {
  assert.equal(hasRuntimePublishConfiguration(RUNTIME_PUBLISH_CONFIGURATION), true);
});

test("publish config: missing runtime config stays false", () => {
  assert.equal(hasRuntimePublishConfiguration(null), false);
  assert.equal(hasRuntimePublishConfiguration({ provider: "github", owner: "", repo: "elemintz-pc" }), false);
});

test("update adapter: object-shaped updater errors become readable messages", () => {
  const store = createUpdateLifecycleStore();
  const { updater } = createFakeUpdater();
  createUpdaterAdapter({
    store,
    updater,
    isPackaged: true,
    hasPublishConfiguration: true,
    publishConfiguration: RUNTIME_PUBLISH_CONFIGURATION
  });

  updater.emit("error", {
    message: "Cannot find latest.yml in the latest release artifacts.",
    code: "ERR_UPDATER_LATEST_YML_MISSING"
  });

  const state = store.getState();
  assert.equal(state.status, "error");
  assert.equal(state.error?.message, "Cannot find latest.yml in the latest release artifacts.");
});

test("update coordinator: blocks install when safety is unsafe and returns blocker reasons", () => {
  const coordinator = buildUpdateCoordinatorState({
    lifecycleState: {
      status: "downloaded",
      restartRequested: true,
      deferredUntilSafe: true,
      message: "Ready when safe."
    },
    safetyState: {
      safe: false,
      reasons: ["active_match", "pending_admin_grant_notice"],
      checkedAt: "2026-05-06T12:00:00.000Z"
    }
  });

  assert.equal(coordinator.installAllowedNow, false);
  assert.equal(coordinator.deferredUntilSafe, true);
  assert.deepEqual(coordinator.blockedReasons, ["active_match", "pending_admin_grant_notice"]);
});

test("update coordinator: allows install only when lifecycle is ready and safety is clear", () => {
  const coordinator = buildUpdateCoordinatorState({
    lifecycleState: {
      status: "downloaded",
      restartRequested: true,
      deferredUntilSafe: true,
      message: "Ready when safe."
    },
    safetyState: {
      safe: true,
      reasons: [],
      checkedAt: "2026-05-06T12:00:00.000Z"
    }
  });

  assert.equal(coordinator.installAllowedNow, true);
  assert.deepEqual(coordinator.blockedReasons, []);
  assert.equal(coordinator.deferredUntilSafe, true);
});

test("update coordinator: diagnostics snapshot exposes install gate facts without side effects", () => {
  const coordinator = buildUpdateCoordinatorState({
    lifecycleState: {
      status: "deferred",
      restartRequested: true,
      deferredUntilSafe: true,
      message: "Waiting for safe state."
    },
    safetyState: {
      safe: false,
      reasons: ["active_match", "active_war"],
      checkedAt: "2026-05-06T12:00:00.000Z"
    }
  });

  const diagnostics = buildUpdateDiagnosticsSnapshot(coordinator);

  assert.deepEqual(diagnostics, {
    lifecycleStatus: "deferred",
    message: "Waiting for safe state.",
    error: null,
    updateInfo: null,
    downloadProgress: null,
    deferredUntilSafe: true,
    restartRequested: true,
    installAllowedNow: false,
    blockedReasons: ["active_match", "active_war"]
  });
});

test("update coordinator: does not imply restart side effects from state computation", () => {
  const lifecycleState = {
    status: "downloaded",
    restartRequested: true,
    deferredUntilSafe: true,
    message: "Ready when safe."
  };
  const safetyState = {
    safe: false,
    reasons: ["chest_open_in_flight"],
    checkedAt: "2026-05-06T12:00:00.000Z"
  };

  const coordinator = buildUpdateCoordinatorState({
    lifecycleState,
    safetyState
  });

  assert.equal(coordinator.lifecycleState.restartRequested, true);
  assert.equal(coordinator.installAllowedNow, false);
  assert.deepEqual(safetyState.reasons, ["chest_open_in_flight"]);
  assert.equal(lifecycleState.status, "downloaded");
});

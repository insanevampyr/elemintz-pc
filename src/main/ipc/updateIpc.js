import { createUpdateLifecycleStore } from "../updates/updateLifecycle.js";
import { createUpdaterAdapter } from "../updates/updaterAdapter.js";

export function registerUpdateIpcHandlers(
  ipcMain,
  {
    store = createUpdateLifecycleStore(),
    updaterAdapter = null,
    allowDevSimulation = process.env.NODE_ENV !== "production",
    isPackaged = false,
    hasPublishConfiguration = false,
    publishConfiguration = null
  } = {}
) {
  const subscribers = new Set();
  let adapter = updaterAdapter;
  let startupCheckScheduled = false;
  const getUpdaterAdapter = () => {
    if (!adapter) {
      adapter = createUpdaterAdapter({
        store,
        isPackaged,
        hasPublishConfiguration,
        publishConfiguration
      });
    }
    return adapter;
  };

  const scheduleStartupUpdateCheck = ({
    delayMs = 1500,
    timer = globalThis.setTimeout
  } = {}) => {
    if (!isPackaged) {
      console.info("[Updater] auto-check skipped on startup because app is not packaged", {
        isPackaged
      });
      return false;
    }

    if (startupCheckScheduled) {
      console.info("[Updater] auto-check already scheduled");
      return false;
    }

    startupCheckScheduled = true;
    console.info("[Updater] auto-check scheduled", {
      delayMs
    });

    timer(() => {
      Promise.resolve(getUpdaterAdapter().requestCheck()).catch((error) => {
        console.error("[Updater] startup auto-check failed", {
          message: error?.message ?? String(error)
        });
      });
    }, delayMs);

    return true;
  };

  const broadcast = (state) => {
    for (const sender of [...subscribers]) {
      if (sender.isDestroyed?.()) {
        subscribers.delete(sender);
        continue;
      }

      sender.send("updates:stateChanged", state);
    }
  };

  store.subscribe((state) => {
    broadcast(state);
  });

  ipcMain.on("updates:subscribe", (event) => {
    subscribers.add(event.sender);
    event.sender.send("updates:stateChanged", store.getState());
  });

  ipcMain.handle("updates:getState", async () => store.getState());

  ipcMain.handle("updates:requestCheck", async () => getUpdaterAdapter().requestCheck());
  ipcMain.handle("updates:requestDownload", async () => getUpdaterAdapter().requestDownload());
  ipcMain.handle("updates:requestInstall", async (_event, safetyState) => getUpdaterAdapter().requestInstall(safetyState));

  ipcMain.handle("updates:requestInstallWhenSafe", async () =>
    store.markInstallDeferred("Update install requested. Waiting for a safe restart window.")
  );

  ipcMain.handle("updates:cancelDeferredInstall", async () =>
    store.clearDeferredInstall("Deferred update install cleared.")
  );

  ipcMain.handle("updates:devMarkDownloaded", async (_event, payload) => {
    if (!allowDevSimulation) {
      throw new Error("Mock update triggers are disabled outside dev/test mode.");
    }

    return store.markMockDownloaded(payload ?? {});
  });

  return {
    store,
    updaterAdapter: getUpdaterAdapter,
    scheduleStartupUpdateCheck
  };
}

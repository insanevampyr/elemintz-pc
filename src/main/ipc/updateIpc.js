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
    updaterAdapter: getUpdaterAdapter
  };
}

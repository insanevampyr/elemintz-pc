import { StateCoordinator } from "../../state/stateCoordinator.js";

export function registerStateIpcHandlers(ipcMain, options = {}) {
  const coordinator = new StateCoordinator(options);

  console.info("[Startup] State data directory", {
    dataDir: coordinator.profiles.store.dataDir
  });

  ipcMain.handle("state:recordMatchResult", async (_event, payload) =>
    coordinator.recordMatchResult(payload)
  );

  ipcMain.handle("state:getProfile", async (_event, username) =>
    coordinator.profiles.getProfile(username)
  );

  ipcMain.handle("state:ensureProfile", async (_event, username) => {
    try {
      console.info("[IPC] state:ensureProfile called", { username });
      const result = await coordinator.profiles.ensureProfile(username);
      console.info("[IPC] state:ensureProfile returned", result);
      return result;
    } catch (error) {
      console.error("[IPC] state:ensureProfile threw", {
        username,
        message: error?.message,
        code: error?.code,
        stack: error?.stack
      });
      throw error;
    }
  });

  ipcMain.handle("state:claimDailyLoginReward", async (_event, username) =>
    coordinator.claimDailyLoginReward(username)
  );

  ipcMain.handle("state:getAchievements", async (_event, username) =>
    coordinator.getAchievements(username)
  );

  ipcMain.handle("state:getDailyChallenges", async (_event, username) =>
    coordinator.getDailyChallenges(username)
  );

  ipcMain.handle("state:getStore", async (_event, username) => coordinator.getStore(username));

  ipcMain.handle("state:buyStoreItem", async (_event, payload) =>
    coordinator.buyStoreItem(payload)
  );

  ipcMain.handle("state:grantSupporterPass", async (_event, username) =>
    coordinator.grantSupporterPass(username)
  );

  ipcMain.handle("state:getCosmetics", async (_event, username) =>
    coordinator.getCosmetics(username)
  );

  ipcMain.handle("state:equipCosmetic", async (_event, payload) =>
    coordinator.equipCosmetic(payload)
  );

  ipcMain.handle("state:updateCosmeticPreferences", async (_event, payload) =>
    coordinator.updateCosmeticPreferences(payload)
  );

  ipcMain.handle("state:saveCosmeticLoadout", async (_event, payload) =>
    coordinator.saveCosmeticLoadout(payload)
  );

  ipcMain.handle("state:applyCosmeticLoadout", async (_event, payload) =>
    coordinator.applyCosmeticLoadout(payload)
  );

  ipcMain.handle("state:renameCosmeticLoadout", async (_event, payload) =>
    coordinator.renameCosmeticLoadout(payload)
  );

  ipcMain.handle("state:acknowledgeLoadoutUnlocks", async (_event, username) =>
    coordinator.acknowledgeLoadoutUnlocks(username)
  );

  ipcMain.handle("state:listProfiles", async () => coordinator.profiles.listProfiles());
  ipcMain.handle("state:getSettings", async () => coordinator.settings.getSettings());

  ipcMain.handle("state:updateSettings", async (_event, patch) =>
    coordinator.settings.updateSettings(patch)
  );

  ipcMain.handle("state:listSaves", async () => coordinator.saves.listMatchResults());
}



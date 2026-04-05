import { StateCoordinator } from "../../state/stateCoordinator.js";

function normalizeAuthorityUsername(username) {
  const normalized = String(username ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function extractUsernameFromPayload(payload) {
  if (typeof payload === "string") {
    return normalizeAuthorityUsername(payload);
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return normalizeAuthorityUsername(payload.username);
  }

  return null;
}

function isLocalAuthoritativeMatchResultPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const mode = String(payload?.matchState?.mode ?? "").trim();
  return mode === "pve" || mode === "local_pvp";
}

function createOnlineAuthorityDisabledError(channel, username) {
  const error = new Error(
    `Legacy local authority path '${channel}' is disabled for authenticated online profiles.`
  );
  error.code = "ONLINE_ONLY_SERVER_AUTHORITY";
  error.channel = channel;
  error.username = username ?? null;
  return error;
}

export function registerStateIpcHandlers(ipcMain, options = {}) {
  const coordinator = new StateCoordinator(options);
  const getOnlineAuthorityState =
    typeof options.getOnlineAuthorityState === "function" ? options.getOnlineAuthorityState : null;

  console.info("[Startup] State data directory", {
    dataDir: coordinator.profiles.store.dataDir
  });

  const isBlockedForAuthenticatedOnlineAuthority = (username) => {
    const effectiveUsername = normalizeAuthorityUsername(username);
    if (!effectiveUsername || !getOnlineAuthorityState) {
      return false;
    }

    const onlineAuthorityState = getOnlineAuthorityState();
    const sessionUsername = normalizeAuthorityUsername(onlineAuthorityState?.session?.username);
    return Boolean(onlineAuthorityState?.session?.authenticated) && sessionUsername === effectiveUsername;
  };

  const registerGuardedMutation = (channel, resolver, guardOptions = {}) => {
    const readUsername = guardOptions.readUsername ?? extractUsernameFromPayload;
    const allowWhen = typeof guardOptions.allowWhen === "function" ? guardOptions.allowWhen : null;
    ipcMain.handle(channel, async (_event, payload) => {
      const username = readUsername(payload);
      if (isBlockedForAuthenticatedOnlineAuthority(username) && !allowWhen?.(payload, username)) {
        throw createOnlineAuthorityDisabledError(channel, username);
      }

      return resolver(payload);
    });
  };

  registerGuardedMutation(
    "state:recordMatchResult",
    async (payload) => coordinator.recordMatchResult(payload),
    { allowWhen: isLocalAuthoritativeMatchResultPayload }
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

  ipcMain.handle("state:getAchievements", async (_event, username) =>
    coordinator.getAchievements(username)
  );

  ipcMain.handle("state:getDailyChallenges", async (_event, username) =>
    coordinator.getDailyChallenges(username)
  );

  ipcMain.handle("state:getStore", async (_event, username) => coordinator.getStore(username));

  ipcMain.handle("state:acknowledgeMilestoneChestReward", async (_event, payload) =>
    coordinator.acknowledgeMilestoneChestReward(payload)
  );

  registerGuardedMutation("state:openChest", async (payload) =>
    coordinator.openChest(payload)
  );

  ipcMain.handle("state:getCosmetics", async (_event, username) =>
    coordinator.getCosmetics(username)
  );

  registerGuardedMutation("state:equipCosmetic", async (payload) =>
    coordinator.equipCosmetic(payload)
  );

  registerGuardedMutation("state:updateCosmeticPreferences", async (payload) =>
    coordinator.updateCosmeticPreferences(payload)
  );

  registerGuardedMutation("state:randomizeOwnedCosmetics", async (payload) =>
    coordinator.randomizeOwnedCosmetics(payload)
  );

  registerGuardedMutation("state:saveCosmeticLoadout", async (payload) =>
    coordinator.saveCosmeticLoadout(payload)
  );

  registerGuardedMutation("state:applyCosmeticLoadout", async (payload) =>
    coordinator.applyCosmeticLoadout(payload)
  );

  registerGuardedMutation("state:renameCosmeticLoadout", async (payload) =>
    coordinator.renameCosmeticLoadout(payload)
  );

  registerGuardedMutation("state:acknowledgeLoadoutUnlocks", async (username) =>
    coordinator.acknowledgeLoadoutUnlocks(username)
  );

  ipcMain.handle("state:listProfiles", async () => coordinator.profiles.listProfiles());
  ipcMain.handle("state:getSettings", async () => coordinator.settings.getSettings());

  ipcMain.handle("state:updateSettings", async (_event, patch) =>
    coordinator.settings.updateSettings(patch)
  );

  ipcMain.handle("state:listSaves", async () => coordinator.saves.listMatchResults());
}



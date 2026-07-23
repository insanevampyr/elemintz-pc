let contextBridge = null;
let ipcRenderer = null;

try {
  const electron = require("electron");
  contextBridge = electron?.contextBridge ?? null;
  ipcRenderer = electron?.ipcRenderer ?? null;
} catch {
  contextBridge = null;
  ipcRenderer = null;
}

function resolveAppVersion({
  ipcRendererRef = ipcRenderer,
  env = process?.env ?? {},
  fallback = "unknown"
} = {}) {
  const npmVersion = String(env?.npm_package_version ?? "").trim();
  if (npmVersion) {
    return npmVersion;
  }

  if (ipcRendererRef?.sendSync) {
    try {
      const runtimeVersion = String(ipcRendererRef.sendSync("app:getVersionSync") ?? "").trim();
      if (runtimeVersion && runtimeVersion.toLowerCase() !== "unknown") {
        return runtimeVersion;
      }
    } catch {
      // Fall through to the safe fallback below.
    }
  }

  return fallback;
}

function subscribeToChannel(ipcRendererRef, subscribeChannel, eventChannel, listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  const handleUpdate = (_event, state) => listener(state);
  ipcRendererRef.on(eventChannel, handleUpdate);
  ipcRendererRef.send(subscribeChannel);
  return () => {
    ipcRendererRef.removeListener(eventChannel, handleUpdate);
  };
}

function buildElemintzBridge(ipcRendererRef, { appVersion = "unknown" } = {}) {
  return {
    version: appVersion,
    state: {
      recordMatchResult: (payload) => ipcRendererRef.invoke("state:recordMatchResult", payload),
      recordGauntletStats: (payload) => ipcRendererRef.invoke("state:recordGauntletStats", payload),
      recordBloodMatchResult: (payload) => ipcRendererRef.invoke("state:recordBloodMatchResult", payload),
      getProfile: (username) => ipcRendererRef.invoke("state:getProfile", username),
      ensureProfile: (username) => ipcRendererRef.invoke("state:ensureProfile", username),
      getAchievements: (username) => ipcRendererRef.invoke("state:getAchievements", username),
      getDailyChallenges: (username) => ipcRendererRef.invoke("state:getDailyChallenges", username),
      getCosmetics: (username) => ipcRendererRef.invoke("state:getCosmetics", username),
      getStore: (username) => ipcRendererRef.invoke("state:getStore", username),
      acknowledgeAnnouncement: (payload) => ipcRendererRef.invoke("state:acknowledgeAnnouncement", payload),
      acknowledgeMilestoneChestReward: (payload) =>
        ipcRendererRef.invoke("state:acknowledgeMilestoneChestReward", payload),
      openChest: (payload) => ipcRendererRef.invoke("state:openChest", payload),
      equipCosmetic: (payload) => ipcRendererRef.invoke("state:equipCosmetic", payload),
      updateCosmeticPreferences: (payload) => ipcRendererRef.invoke("state:updateCosmeticPreferences", payload),
      randomizeOwnedCosmetics: (payload) => ipcRendererRef.invoke("state:randomizeOwnedCosmetics", payload),
      saveCosmeticLoadout: (payload) => ipcRendererRef.invoke("state:saveCosmeticLoadout", payload),
      applyCosmeticLoadout: (payload) => ipcRendererRef.invoke("state:applyCosmeticLoadout", payload),
      renameCosmeticLoadout: (payload) => ipcRendererRef.invoke("state:renameCosmeticLoadout", payload),
      updateProfileShowcaseSlot: (payload) => ipcRendererRef.invoke("state:updateProfileShowcaseSlot", payload),
      claimCollectionAlbumReward: (payload) => ipcRendererRef.invoke("state:claimCollectionAlbumReward", payload),
      acknowledgeLoadoutUnlocks: (username) => ipcRendererRef.invoke("state:acknowledgeLoadoutUnlocks", username),
      listProfiles: () => ipcRendererRef.invoke("state:listProfiles"),
      getSettings: () => ipcRendererRef.invoke("state:getSettings"),
      updateSettings: (patch) => ipcRendererRef.invoke("state:updateSettings", patch),
      listSaves: () => ipcRendererRef.invoke("state:listSaves")
    },
    updates: {
      getState: () => ipcRendererRef.invoke("updates:getState"),
      requestCheck: () => ipcRendererRef.invoke("updates:requestCheck"),
      requestDownload: () => ipcRendererRef.invoke("updates:requestDownload"),
      requestInstall: (safetyState) => ipcRendererRef.invoke("updates:requestInstall", safetyState),
      requestInstallWhenSafe: () => ipcRendererRef.invoke("updates:requestInstallWhenSafe"),
      cancelDeferredInstall: () => ipcRendererRef.invoke("updates:cancelDeferredInstall"),
      reportPromptEvent: (payload) => ipcRendererRef.invoke("updates:reportPromptEvent", payload),
      devMarkDownloaded: (payload) => ipcRendererRef.invoke("updates:devMarkDownloaded", payload),
      onStateChanged: (listener) =>
        subscribeToChannel(ipcRendererRef, "updates:subscribe", "updates:stateChanged", listener)
    },
    multiplayer: {
      getState: () => ipcRendererRef.invoke("multiplayer:getState"),
      restoreSession: (payload) => ipcRendererRef.invoke("multiplayer:restoreSession", payload),
      getProfile: (payload) => ipcRendererRef.invoke("multiplayer:getProfile", payload),
      getStore: (payload) => ipcRendererRef.invoke("multiplayer:getStore", payload),
      getCollectionPackDeals: (payload) => ipcRendererRef.invoke("multiplayer:getCollectionPackDeals", payload),
      viewProfile: (payload) => ipcRendererRef.invoke("multiplayer:viewProfile", payload),
      listAnnouncements: (payload) => ipcRendererRef.invoke("multiplayer:listAnnouncements", payload),
      dismissAnnouncement: (payload) => ipcRendererRef.invoke("multiplayer:dismissAnnouncement", payload),
      getActiveShopRotation: (payload) => ipcRendererRef.invoke("multiplayer:getActiveShopRotation", payload),
      getActiveBoostEvent: (payload) => ipcRendererRef.invoke("multiplayer:getActiveBoostEvent", payload),
      getOnlineCount: (payload) => ipcRendererRef.invoke("multiplayer:getOnlineCount", payload),
      getCosmetics: (payload) => ipcRendererRef.invoke("multiplayer:getCosmetics", payload),
      acknowledgeAnnouncement: (payload) => ipcRendererRef.invoke("multiplayer:acknowledgeAnnouncement", payload),
      acknowledgeMilestoneChestReward: (payload) =>
        ipcRendererRef.invoke("multiplayer:acknowledgeMilestoneChestReward", payload),
      claimDailyLoginReward: (payload) => ipcRendererRef.invoke("multiplayer:claimDailyLoginReward", payload),
      getDailyElementChestStatus: (payload) =>
        ipcRendererRef.invoke("multiplayer:getDailyElementChestStatus", payload),
      startLocalPveMatch: (payload) => ipcRendererRef.invoke("multiplayer:startLocalPveMatch", payload),
      startFeaturedRivalMatch: (payload) =>
        ipcRendererRef.invoke("multiplayer:startFeaturedRivalMatch", payload),
      startGauntletMatch: (payload) =>
        ipcRendererRef.invoke("multiplayer:startGauntletMatch", payload),
      getLocalMatchSessionState: (payload) =>
        ipcRendererRef.invoke("multiplayer:getLocalMatchSessionState", payload),
      abandonLocalMatchSession: (payload) =>
        ipcRendererRef.invoke("multiplayer:abandonLocalMatchSession", payload),
      applyLocalMatchResult: (payload) => ipcRendererRef.invoke("multiplayer:applyLocalMatchResult", payload),
      applyLocalHotseatResult: (payload) => ipcRendererRef.invoke("multiplayer:applyLocalHotseatResult", payload),
      recordGauntletStats: (payload) => ipcRendererRef.invoke("multiplayer:recordGauntletStats", payload),
      buyStoreItem: (payload) => ipcRendererRef.invoke("multiplayer:buyStoreItem", payload),
      buyCollectionPack: (payload) => ipcRendererRef.invoke("multiplayer:buyCollectionPack", payload),
      submitFeedback: (payload) => ipcRendererRef.invoke("multiplayer:submitFeedback", payload),
      openChest: (payload) => ipcRendererRef.invoke("multiplayer:openChest", payload),
      openDailyElementChest: (payload) => ipcRendererRef.invoke("multiplayer:openDailyElementChest", payload),
      confirmAdminGrantNotice: (payload) => ipcRendererRef.invoke("multiplayer:confirmAdminGrantNotice", payload),
      equipCosmetic: (payload) => ipcRendererRef.invoke("multiplayer:equipCosmetic", payload),
      updateCosmeticPreferences: (payload) => ipcRendererRef.invoke("multiplayer:updateCosmeticPreferences", payload),
      randomizeOwnedCosmetics: (payload) => ipcRendererRef.invoke("multiplayer:randomizeOwnedCosmetics", payload),
      saveCosmeticLoadout: (payload) => ipcRendererRef.invoke("multiplayer:saveCosmeticLoadout", payload),
      applyCosmeticLoadout: (payload) => ipcRendererRef.invoke("multiplayer:applyCosmeticLoadout", payload),
      renameCosmeticLoadout: (payload) => ipcRendererRef.invoke("multiplayer:renameCosmeticLoadout", payload),
      updateProfileShowcaseSlot: (payload) => ipcRendererRef.invoke("multiplayer:updateProfileShowcaseSlot", payload),
      claimCollectionAlbumReward: (payload) => ipcRendererRef.invoke("multiplayer:claimCollectionAlbumReward", payload),
      connect: (payload) => ipcRendererRef.invoke("multiplayer:connect", payload),
      register: (payload) => ipcRendererRef.invoke("multiplayer:register", payload),
      login: (payload) => ipcRendererRef.invoke("multiplayer:login", payload),
      getEmailVerificationStatus: (payload) =>
        ipcRendererRef.invoke("multiplayer:getEmailVerificationStatus", payload),
      requestEmailVerification: (payload) =>
        ipcRendererRef.invoke("multiplayer:requestEmailVerification", payload),
      verifyEmail: (payload) => ipcRendererRef.invoke("multiplayer:verifyEmail", payload),
      getOrCreateReferralCode: (payload) =>
        ipcRendererRef.invoke("multiplayer:getOrCreateReferralCode", payload),
      activateReferralCode: (payload) =>
        ipcRendererRef.invoke("multiplayer:activateReferralCode", payload),
      authenticateHotseatIdentity: (payload) => ipcRendererRef.invoke("multiplayer:authenticateHotseatIdentity", payload),
      createRoom: (payload) => ipcRendererRef.invoke("multiplayer:createRoom", payload),
      listPublicRooms: (payload) => ipcRendererRef.invoke("multiplayer:listPublicRooms", payload),
      joinRoom: (payload) => ipcRendererRef.invoke("multiplayer:joinRoom", payload),
      submitMove: (payload) => {
        console.info("[OnlinePlay][Preload] submitMove called", {
          move: payload?.move ?? null
        });
        return ipcRendererRef.invoke("multiplayer:submitMove", payload);
      },
      sendTaunt: (payload) => ipcRendererRef.invoke("multiplayer:sendTaunt", payload),
      readyRematch: (payload) => ipcRendererRef.invoke("multiplayer:readyRematch", payload),
      disconnect: () => ipcRendererRef.invoke("multiplayer:disconnect"),
      logout: (payload) => ipcRendererRef.invoke("multiplayer:logout", payload),
      onUpdate: (listener) =>
        subscribeToChannel(ipcRendererRef, "multiplayer:subscribe", "multiplayer:update", listener)
    }
  };
}

if (contextBridge?.exposeInMainWorld && ipcRenderer?.invoke) {
  const APP_VERSION = resolveAppVersion({ ipcRendererRef: ipcRenderer });
  contextBridge.exposeInMainWorld(
    "elemintz",
    buildElemintzBridge(ipcRenderer, {
      appVersion: APP_VERSION
    })
  );
}

module.exports = {
  resolveAppVersion,
  buildElemintzBridge
};

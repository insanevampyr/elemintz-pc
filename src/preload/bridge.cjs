function subscribeToChannel(ipcRenderer, subscribeChannel, eventChannel, listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  const handleUpdate = (_event, state) => listener(state);
  ipcRenderer.on(eventChannel, handleUpdate);
  ipcRenderer.send(subscribeChannel);
  return () => {
    ipcRenderer.removeListener(eventChannel, handleUpdate);
  };
}

function buildElemintzBridge(ipcRenderer, { appVersion = "unknown" } = {}) {
  return {
    version: appVersion,
    state: {
      recordMatchResult: (payload) => ipcRenderer.invoke("state:recordMatchResult", payload),
      recordGauntletStats: (payload) => ipcRenderer.invoke("state:recordGauntletStats", payload),
      getProfile: (username) => ipcRenderer.invoke("state:getProfile", username),
      ensureProfile: (username) => ipcRenderer.invoke("state:ensureProfile", username),
      getAchievements: (username) => ipcRenderer.invoke("state:getAchievements", username),
      getDailyChallenges: (username) => ipcRenderer.invoke("state:getDailyChallenges", username),
      getCosmetics: (username) => ipcRenderer.invoke("state:getCosmetics", username),
      getStore: (username) => ipcRenderer.invoke("state:getStore", username),
      acknowledgeAnnouncement: (payload) => ipcRenderer.invoke("state:acknowledgeAnnouncement", payload),
      acknowledgeMilestoneChestReward: (payload) =>
        ipcRenderer.invoke("state:acknowledgeMilestoneChestReward", payload),
      openChest: (payload) => ipcRenderer.invoke("state:openChest", payload),
      equipCosmetic: (payload) => ipcRenderer.invoke("state:equipCosmetic", payload),
      updateCosmeticPreferences: (payload) => ipcRenderer.invoke("state:updateCosmeticPreferences", payload),
      randomizeOwnedCosmetics: (payload) => ipcRenderer.invoke("state:randomizeOwnedCosmetics", payload),
      saveCosmeticLoadout: (payload) => ipcRenderer.invoke("state:saveCosmeticLoadout", payload),
      applyCosmeticLoadout: (payload) => ipcRenderer.invoke("state:applyCosmeticLoadout", payload),
      renameCosmeticLoadout: (payload) => ipcRenderer.invoke("state:renameCosmeticLoadout", payload),
      acknowledgeLoadoutUnlocks: (username) => ipcRenderer.invoke("state:acknowledgeLoadoutUnlocks", username),
      listProfiles: () => ipcRenderer.invoke("state:listProfiles"),
      getSettings: () => ipcRenderer.invoke("state:getSettings"),
      updateSettings: (patch) => ipcRenderer.invoke("state:updateSettings", patch),
      listSaves: () => ipcRenderer.invoke("state:listSaves")
    },
    updates: {
      getState: () => ipcRenderer.invoke("updates:getState"),
      requestCheck: () => ipcRenderer.invoke("updates:requestCheck"),
      requestInstallWhenSafe: () => ipcRenderer.invoke("updates:requestInstallWhenSafe"),
      cancelDeferredInstall: () => ipcRenderer.invoke("updates:cancelDeferredInstall"),
      devMarkDownloaded: (payload) => ipcRenderer.invoke("updates:devMarkDownloaded", payload),
      onStateChanged: (listener) =>
        subscribeToChannel(ipcRenderer, "updates:subscribe", "updates:stateChanged", listener)
    },
    multiplayer: {
      getState: () => ipcRenderer.invoke("multiplayer:getState"),
      restoreSession: (payload) => ipcRenderer.invoke("multiplayer:restoreSession", payload),
      getProfile: (payload) => ipcRenderer.invoke("multiplayer:getProfile", payload),
      viewProfile: (payload) => ipcRenderer.invoke("multiplayer:viewProfile", payload),
      getCosmetics: (payload) => ipcRenderer.invoke("multiplayer:getCosmetics", payload),
      acknowledgeAnnouncement: (payload) => ipcRenderer.invoke("multiplayer:acknowledgeAnnouncement", payload),
      claimDailyLoginReward: (payload) => ipcRenderer.invoke("multiplayer:claimDailyLoginReward", payload),
      getDailyElementChestStatus: (payload) =>
        ipcRenderer.invoke("multiplayer:getDailyElementChestStatus", payload),
      buyStoreItem: (payload) => ipcRenderer.invoke("multiplayer:buyStoreItem", payload),
      recordGauntletStats: (payload) => ipcRenderer.invoke("multiplayer:recordGauntletStats", payload),
      openChest: (payload) => ipcRenderer.invoke("multiplayer:openChest", payload),
      openDailyElementChest: (payload) => ipcRenderer.invoke("multiplayer:openDailyElementChest", payload),
      confirmAdminGrantNotice: (payload) => ipcRenderer.invoke("multiplayer:confirmAdminGrantNotice", payload),
      equipCosmetic: (payload) => ipcRenderer.invoke("multiplayer:equipCosmetic", payload),
      updateCosmeticPreferences: (payload) => ipcRenderer.invoke("multiplayer:updateCosmeticPreferences", payload),
      randomizeOwnedCosmetics: (payload) => ipcRenderer.invoke("multiplayer:randomizeOwnedCosmetics", payload),
      saveCosmeticLoadout: (payload) => ipcRenderer.invoke("multiplayer:saveCosmeticLoadout", payload),
      applyCosmeticLoadout: (payload) => ipcRenderer.invoke("multiplayer:applyCosmeticLoadout", payload),
      renameCosmeticLoadout: (payload) => ipcRenderer.invoke("multiplayer:renameCosmeticLoadout", payload),
      connect: (payload) => ipcRenderer.invoke("multiplayer:connect", payload),
      register: (payload) => ipcRenderer.invoke("multiplayer:register", payload),
      login: (payload) => ipcRenderer.invoke("multiplayer:login", payload),
      authenticateHotseatIdentity: (payload) => ipcRenderer.invoke("multiplayer:authenticateHotseatIdentity", payload),
      createRoom: (payload) => ipcRenderer.invoke("multiplayer:createRoom", payload),
      joinRoom: (payload) => ipcRenderer.invoke("multiplayer:joinRoom", payload),
      submitMove: (payload) => {
        console.info("[OnlinePlay][Preload] submitMove called", {
          move: payload?.move ?? null
        });
        return ipcRenderer.invoke("multiplayer:submitMove", payload);
      },
      sendTaunt: (payload) => ipcRenderer.invoke("multiplayer:sendTaunt", payload),
      readyRematch: (payload) => ipcRenderer.invoke("multiplayer:readyRematch", payload),
      disconnect: () => ipcRenderer.invoke("multiplayer:disconnect"),
      logout: (payload) => ipcRenderer.invoke("multiplayer:logout", payload),
      onUpdate: (listener) =>
        subscribeToChannel(ipcRenderer, "multiplayer:subscribe", "multiplayer:update", listener)
    }
  };
}

module.exports = {
  buildElemintzBridge
};

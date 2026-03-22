const { contextBridge, ipcRenderer } = require("electron");

function subscribeToMultiplayerUpdates(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  const handleUpdate = (_event, state) => listener(state);
  ipcRenderer.on("multiplayer:update", handleUpdate);
  ipcRenderer.send("multiplayer:subscribe");
  return () => {
    ipcRenderer.removeListener("multiplayer:update", handleUpdate);
  };
}

contextBridge.exposeInMainWorld("elemintz", {
  version: "0.1.0",
  state: {
    recordMatchResult: (payload) => ipcRenderer.invoke("state:recordMatchResult", payload),
    getProfile: (username) => ipcRenderer.invoke("state:getProfile", username),
    ensureProfile: (username) => ipcRenderer.invoke("state:ensureProfile", username),
    claimDailyLoginReward: (username) => ipcRenderer.invoke("state:claimDailyLoginReward", username),
    getAchievements: (username) => ipcRenderer.invoke("state:getAchievements", username),
    getDailyChallenges: (username) => ipcRenderer.invoke("state:getDailyChallenges", username),
    getCosmetics: (username) => ipcRenderer.invoke("state:getCosmetics", username),
    getStore: (username) => ipcRenderer.invoke("state:getStore", username),
    buyStoreItem: (payload) => ipcRenderer.invoke("state:buyStoreItem", payload),
    grantSupporterPass: (username) => ipcRenderer.invoke("state:grantSupporterPass", username),
    openChest: (payload) => ipcRenderer.invoke("state:openChest", payload),
    acknowledgeMilestoneChestReward: (payload) =>
      ipcRenderer.invoke("state:acknowledgeMilestoneChestReward", payload),
    equipCosmetic: (payload) => ipcRenderer.invoke("state:equipCosmetic", payload),
    updateCosmeticPreferences: (payload) => ipcRenderer.invoke("state:updateCosmeticPreferences", payload),
    saveCosmeticLoadout: (payload) => ipcRenderer.invoke("state:saveCosmeticLoadout", payload),
    applyCosmeticLoadout: (payload) => ipcRenderer.invoke("state:applyCosmeticLoadout", payload),
    renameCosmeticLoadout: (payload) => ipcRenderer.invoke("state:renameCosmeticLoadout", payload),
    acknowledgeLoadoutUnlocks: (username) => ipcRenderer.invoke("state:acknowledgeLoadoutUnlocks", username),
    listProfiles: () => ipcRenderer.invoke("state:listProfiles"),
    getSettings: () => ipcRenderer.invoke("state:getSettings"),
    updateSettings: (patch) => ipcRenderer.invoke("state:updateSettings", patch),
    listSaves: () => ipcRenderer.invoke("state:listSaves")
  },
  multiplayer: {
    getState: () => ipcRenderer.invoke("multiplayer:getState"),
    connect: (payload) => ipcRenderer.invoke("multiplayer:connect", payload),
    createRoom: (payload) => ipcRenderer.invoke("multiplayer:createRoom", payload),
    joinRoom: (payload) => ipcRenderer.invoke("multiplayer:joinRoom", payload),
    submitMove: (payload) => {
      console.info("[OnlinePlay][Preload] submitMove called", {
        move: payload?.move ?? null
      });
      return ipcRenderer.invoke("multiplayer:submitMove", payload);
    },
    readyRematch: (payload) => ipcRenderer.invoke("multiplayer:readyRematch", payload),
    disconnect: () => ipcRenderer.invoke("multiplayer:disconnect"),
    onUpdate: (listener) => subscribeToMultiplayerUpdates(listener)
  }
});

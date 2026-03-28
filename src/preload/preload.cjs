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
  multiplayer: {
    getState: () => ipcRenderer.invoke("multiplayer:getState"),
    getProfile: (payload) => ipcRenderer.invoke("multiplayer:getProfile", payload),
    getCosmetics: (payload) => ipcRenderer.invoke("multiplayer:getCosmetics", payload),
    equipCosmetic: (payload) => ipcRenderer.invoke("multiplayer:equipCosmetic", payload),
    updateCosmeticPreferences: (payload) => ipcRenderer.invoke("multiplayer:updateCosmeticPreferences", payload),
    randomizeOwnedCosmetics: (payload) => ipcRenderer.invoke("multiplayer:randomizeOwnedCosmetics", payload),
    saveCosmeticLoadout: (payload) => ipcRenderer.invoke("multiplayer:saveCosmeticLoadout", payload),
    applyCosmeticLoadout: (payload) => ipcRenderer.invoke("multiplayer:applyCosmeticLoadout", payload),
    renameCosmeticLoadout: (payload) => ipcRenderer.invoke("multiplayer:renameCosmeticLoadout", payload),
    connect: (payload) => ipcRenderer.invoke("multiplayer:connect", payload),
    register: (payload) => ipcRenderer.invoke("multiplayer:register", payload),
    login: (payload) => ipcRenderer.invoke("multiplayer:login", payload),
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
    onUpdate: (listener) => subscribeToMultiplayerUpdates(listener)
  }
});

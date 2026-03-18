import { contextBridge, ipcRenderer } from "electron";

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
  }
});

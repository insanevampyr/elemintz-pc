import { MultiplayerClient } from "../multiplayer/multiplayerClient.js";

export function registerMultiplayerIpcHandlers(ipcMain, options = {}) {
  const client = new MultiplayerClient(options);
  const subscribers = new Set();

  const broadcast = (state) => {
    for (const sender of [...subscribers]) {
      if (sender.isDestroyed?.()) {
        subscribers.delete(sender);
        continue;
      }

      sender.send("multiplayer:update", state);
    }
  };

  client.subscribe((state) => {
    broadcast(state);
  });

  ipcMain.on("multiplayer:subscribe", (event) => {
    subscribers.add(event.sender);
    event.sender.send("multiplayer:update", client.getState());
  });

  ipcMain.handle("multiplayer:getState", async (event) => {
    subscribers.add(event.sender);
    return client.getState();
  });

  ipcMain.handle("multiplayer:restoreSession", async (event, payload) => {
    subscribers.add(event.sender);
    return client.restoreSession(payload);
  });

  ipcMain.handle("multiplayer:connect", async (event, payload) => {
    subscribers.add(event.sender);
    return client.connect(payload);
  });

  ipcMain.handle("multiplayer:register", async (event, payload) => {
    subscribers.add(event.sender);
    return client.register(payload);
  });

  ipcMain.handle("multiplayer:login", async (event, payload) => {
    subscribers.add(event.sender);
    return client.login(payload);
  });

  ipcMain.handle("multiplayer:authenticateHotseatIdentity", async (event, payload) => {
    subscribers.add(event.sender);
    return client.authenticateHotseatIdentity(payload);
  });

  ipcMain.handle("multiplayer:createRoom", async (event, payload) => {
    subscribers.add(event.sender);
    return client.createRoom(payload);
  });

  ipcMain.handle("multiplayer:listPublicRooms", async (event, payload) => {
    subscribers.add(event.sender);
    return client.listPublicRooms(payload);
  });

  ipcMain.handle("multiplayer:joinRoom", async (event, payload) => {
    subscribers.add(event.sender);
    return client.joinRoom(payload);
  });

  ipcMain.handle("multiplayer:getProfile", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getProfile(payload);
  });

  ipcMain.handle("multiplayer:getStore", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getStore(payload);
  });

  ipcMain.handle("multiplayer:getCollectionPackDeals", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getCollectionPackDeals(payload);
  });

  ipcMain.handle("multiplayer:viewProfile", async (event, payload) => {
    subscribers.add(event.sender);
    return client.viewProfile(payload);
  });

  ipcMain.handle("multiplayer:listAnnouncements", async (event, payload) => {
    subscribers.add(event.sender);
    return client.listAnnouncements(payload);
  });

  ipcMain.handle("multiplayer:dismissAnnouncement", async (event, payload) => {
    subscribers.add(event.sender);
    return client.dismissAnnouncement(payload);
  });

  ipcMain.handle("multiplayer:getActiveShopRotation", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getActiveShopRotation(payload);
  });

  ipcMain.handle("multiplayer:getActiveBoostEvent", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getActiveBoostEvent(payload);
  });

  ipcMain.handle("multiplayer:getOnlineCount", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getOnlineCount(payload);
  });

  ipcMain.handle("multiplayer:getCosmetics", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getCosmetics(payload);
  });

  ipcMain.handle("multiplayer:acknowledgeAnnouncement", async (event, payload) => {
    subscribers.add(event.sender);
    return client.acknowledgeAnnouncement(payload);
  });

  ipcMain.handle("multiplayer:acknowledgeMilestoneChestReward", async (event, payload) => {
    subscribers.add(event.sender);
    return client.acknowledgeMilestoneChestReward(payload);
  });

  ipcMain.handle("multiplayer:claimDailyLoginReward", async (event, payload) => {
    subscribers.add(event.sender);
    return client.claimDailyLoginReward(payload);
  });

  ipcMain.handle("multiplayer:getDailyElementChestStatus", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getDailyElementChestStatus(payload);
  });

  ipcMain.handle("multiplayer:startLocalPveMatch", async (event, payload) => {
    subscribers.add(event.sender);
    return client.startLocalPveMatch(payload);
  });

  ipcMain.handle("multiplayer:startFeaturedRivalMatch", async (event, payload) => {
    subscribers.add(event.sender);
    return client.startFeaturedRivalMatch(payload);
  });

  ipcMain.handle("multiplayer:startGauntletMatch", async (event, payload) => {
    subscribers.add(event.sender);
    return client.startGauntletMatch(payload);
  });

  ipcMain.handle("multiplayer:getLocalMatchSessionState", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getLocalMatchSessionState(payload);
  });

  ipcMain.handle("multiplayer:abandonLocalMatchSession", async (event, payload) => {
    subscribers.add(event.sender);
    return client.abandonLocalMatchSession(payload);
  });

  ipcMain.handle("multiplayer:applyLocalMatchResult", async (event, payload) => {
    subscribers.add(event.sender);
    return client.applyLocalMatchResult(payload);
  });

  ipcMain.handle("multiplayer:applyLocalHotseatResult", async (event, payload) => {
    subscribers.add(event.sender);
    return client.applyLocalHotseatResult(payload);
  });

  ipcMain.handle("multiplayer:recordGauntletStats", async (event, payload) => {
    subscribers.add(event.sender);
    return client.recordGauntletStats(payload);
  });

  ipcMain.handle("multiplayer:buyStoreItem", async (event, payload) => {
    subscribers.add(event.sender);
    return client.buyStoreItem(payload);
  });

  ipcMain.handle("multiplayer:buyCollectionPack", async (event, payload) => {
    subscribers.add(event.sender);
    return client.buyCollectionPack(payload);
  });

  ipcMain.handle("multiplayer:submitFeedback", async (event, payload) => {
    subscribers.add(event.sender);
    return client.submitFeedback(payload);
  });

  ipcMain.handle("multiplayer:openChest", async (event, payload) => {
    subscribers.add(event.sender);
    return client.openChest(payload);
  });

  ipcMain.handle("multiplayer:openDailyElementChest", async (event, payload) => {
    subscribers.add(event.sender);
    return client.openDailyElementChest(payload);
  });

  ipcMain.handle("multiplayer:confirmAdminGrantNotice", async (event, payload) => {
    subscribers.add(event.sender);
    return client.confirmAdminGrantNotice(payload);
  });

  ipcMain.handle("multiplayer:equipCosmetic", async (event, payload) => {
    subscribers.add(event.sender);
    return client.equipCosmetic(payload);
  });

  ipcMain.handle("multiplayer:updateCosmeticPreferences", async (event, payload) => {
    subscribers.add(event.sender);
    return client.updateCosmeticPreferences(payload);
  });

  ipcMain.handle("multiplayer:randomizeOwnedCosmetics", async (event, payload) => {
    subscribers.add(event.sender);
    return client.randomizeOwnedCosmetics(payload);
  });

  ipcMain.handle("multiplayer:saveCosmeticLoadout", async (event, payload) => {
    subscribers.add(event.sender);
    return client.saveCosmeticLoadout(payload);
  });

  ipcMain.handle("multiplayer:applyCosmeticLoadout", async (event, payload) => {
    subscribers.add(event.sender);
    return client.applyCosmeticLoadout(payload);
  });

  ipcMain.handle("multiplayer:renameCosmeticLoadout", async (event, payload) => {
    subscribers.add(event.sender);
    return client.renameCosmeticLoadout(payload);
  });

  ipcMain.handle("multiplayer:updateProfileShowcaseSlot", async (event, payload) => {
    subscribers.add(event.sender);
    return client.updateProfileShowcaseSlot(payload);
  });

  ipcMain.handle("multiplayer:claimCollectionAlbumReward", async (event, payload) => {
    subscribers.add(event.sender);
    return client.claimCollectionAlbumReward(payload);
  });

  ipcMain.handle("multiplayer:submitMove", async (event, payload) => {
    subscribers.add(event.sender);
    console.info("[OnlinePlay][MainIPC] submitMove handler entered", {
      move: payload?.move ?? null
    });
    return client.submitMove({
      move: payload?.move ?? null
    });
  });

  ipcMain.handle("multiplayer:sendTaunt", async (event, payload) => {
    subscribers.add(event.sender);
    return client.sendTaunt({
      line: payload?.line ?? null
    });
  });

  ipcMain.handle("multiplayer:readyRematch", async (event, payload) => {
    subscribers.add(event.sender);
    return client.readyRematch(payload);
  });

  ipcMain.handle("multiplayer:disconnect", async (event) => {
    subscribers.add(event.sender);
    return client.disconnect();
  });

  ipcMain.handle("multiplayer:logout", async (event, payload) => {
    subscribers.add(event.sender);
    return client.logout(payload);
  });

  return {
    client
  };
}

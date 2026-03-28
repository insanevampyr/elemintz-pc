import { MultiplayerClient } from "../multiplayer/multiplayerClient.js";

export function registerMultiplayerIpcHandlers(ipcMain) {
  const client = new MultiplayerClient();
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

  ipcMain.handle("multiplayer:createRoom", async (event, payload) => {
    subscribers.add(event.sender);
    return client.createRoom(payload);
  });

  ipcMain.handle("multiplayer:joinRoom", async (event, payload) => {
    subscribers.add(event.sender);
    return client.joinRoom(payload);
  });

  ipcMain.handle("multiplayer:getProfile", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getProfile(payload);
  });

  ipcMain.handle("multiplayer:getCosmetics", async (event, payload) => {
    subscribers.add(event.sender);
    return client.getCosmetics(payload);
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
}

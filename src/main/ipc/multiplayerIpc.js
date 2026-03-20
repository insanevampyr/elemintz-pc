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

  ipcMain.handle("multiplayer:createRoom", async (event, payload) => {
    subscribers.add(event.sender);
    return client.createRoom(payload);
  });

  ipcMain.handle("multiplayer:joinRoom", async (event, payload) => {
    subscribers.add(event.sender);
    return client.joinRoom(payload);
  });

  ipcMain.handle("multiplayer:disconnect", async (event) => {
    subscribers.add(event.sender);
    return client.disconnect();
  });
}

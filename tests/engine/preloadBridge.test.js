import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { resolveAppVersion, buildElemintzBridge } = require("../../src/preload/preload.cjs");

function createFakeIpcRenderer() {
  const invocations = [];
  const listeners = new Map();
  const sends = [];
  const syncResponses = new Map();

  return {
    invocations,
    listeners,
    sends,
    syncResponses,
    invoke(channel, payload) {
      invocations.push({ channel, payload });
      return Promise.resolve({ channel, payload });
    },
    sendSync(channel) {
      return syncResponses.get(channel);
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    send(channel) {
      sends.push(channel);
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) {
        listeners.delete(channel);
      }
    }
  };
}

test("preload.cjs is self-contained and does not require sibling helper preload modules", () => {
  const source = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\preload\\preload.cjs",
    "utf8"
  );

  assert.equal(source.includes('require("./version.cjs")'), false);
  assert.equal(source.includes('require("./bridge.cjs")'), false);
});

test("preload version resolver falls back safely when package metadata is unavailable", () => {
  const version = resolveAppVersion({
    ipcRendererRef: null,
    env: {},
    fallback: "unknown"
  });

  assert.equal(version, "unknown");
});

test("preload version resolver prefers runtime app version from the preload bridge", () => {
  const ipcRenderer = createFakeIpcRenderer();
  ipcRenderer.syncResponses.set("app:getVersionSync", "2.0.4");

  const version = resolveAppVersion({
    ipcRendererRef: ipcRenderer,
    env: {},
    fallback: "unknown"
  });

  assert.equal(version, "2.0.4");
});

test("preload bridge remains available when version falls back", async () => {
  const ipcRenderer = createFakeIpcRenderer();
  const bridge = buildElemintzBridge(ipcRenderer, {
    appVersion: resolveAppVersion({
      ipcRendererRef: null,
      env: {},
      fallback: "unknown"
    })
  });

  assert.equal(bridge.version, "unknown");
  assert.equal(typeof bridge.state.getSettings, "function");
  assert.equal(typeof bridge.updates.getState, "function");
  assert.equal(typeof bridge.updates.requestCheck, "function");
  assert.equal(typeof bridge.updates.requestInstall, "function");
  assert.equal(typeof bridge.updates.reportPromptEvent, "function");
  assert.equal(typeof bridge.multiplayer.getState, "function");
  assert.equal(typeof bridge.multiplayer.listPublicRooms, "function");
  assert.equal(typeof bridge.multiplayer.acknowledgeMilestoneChestReward, "function");
  assert.equal(typeof bridge.multiplayer.submitFeedback, "function");

  await bridge.state.getSettings();
  await bridge.updates.getState();
  await bridge.updates.reportPromptEvent({ type: "install_prompt_shown", version: "2.1.5" });
  await bridge.multiplayer.listPublicRooms({ username: "VampyrLee" });
  await bridge.multiplayer.acknowledgeMilestoneChestReward({ username: "RewardHero", level: 5 });
  await bridge.multiplayer.submitFeedback({ category: "Bug / Error", message: "Hello" });

  assert.deepEqual(ipcRenderer.invocations.slice(0, 6), [
    { channel: "state:getSettings", payload: undefined },
    { channel: "updates:getState", payload: undefined },
    { channel: "updates:reportPromptEvent", payload: { type: "install_prompt_shown", version: "2.1.5" } },
    { channel: "multiplayer:listPublicRooms", payload: { username: "VampyrLee" } },
    { channel: "multiplayer:acknowledgeMilestoneChestReward", payload: { username: "RewardHero", level: 5 } },
    { channel: "multiplayer:submitFeedback", payload: { category: "Bug / Error", message: "Hello" } }
  ]);
});

test("preload bridge subscriptions still wire update events with fallback version", () => {
  const ipcRenderer = createFakeIpcRenderer();
  const bridge = buildElemintzBridge(ipcRenderer, {
    appVersion: "unknown"
  });
  const events = [];

  const unsubscribe = bridge.updates.onStateChanged((state) => {
    events.push(state);
  });

  assert.deepEqual(ipcRenderer.sends, ["updates:subscribe"]);
  const listener = ipcRenderer.listeners.get("updates:stateChanged");
  assert.equal(typeof listener, "function");

  listener(null, { status: "checking" });
  assert.deepEqual(events, [{ status: "checking" }]);

  unsubscribe();
  assert.equal(ipcRenderer.listeners.has("updates:stateChanged"), false);
});

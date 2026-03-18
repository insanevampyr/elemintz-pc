import test from "node:test";
import assert from "node:assert/strict";

import { SoundManager } from "../../src/renderer/systems/soundManager.js";

test("sound: pve round mapping uses win/loss/war loss", () => {
  const calls = [];
  const manager = new SoundManager({ catalog: {} });
  manager.play = (key) => {
    calls.push(key);
    return true;
  };

  manager.playRoundResolved({
    mode: "pve",
    round: { result: "p1", warClashes: 0 }
  });
  manager.playRoundResolved({
    mode: "pve",
    round: { result: "p2", warClashes: 0 }
  });
  manager.playRoundResolved({
    mode: "pve",
    round: { result: "p2", warClashes: 1 }
  });

  assert.deepEqual(calls, ["roundWin", "roundLoss", "warLoss"]);
});

test("sound: local pvp remains neutral for round resolution", () => {
  const calls = [];
  const manager = new SoundManager({ catalog: {} });
  manager.play = (key) => {
    calls.push(key);
    return true;
  };

  manager.playRoundResolved({
    mode: "local_pvp",
    round: { result: "p1", warClashes: 0 }
  });
  manager.playRoundResolved({
    mode: "local_pvp",
    round: { result: "p2", warClashes: 1 }
  });

  assert.deepEqual(calls, []);
});

test("sound: pve reveal uses element sounds for revealed cards", () => {
  const calls = [];
  const manager = new SoundManager({ catalog: {} });
  manager.play = (key) => {
    calls.push(key);
    return true;
  };

  manager.playReveal({
    mode: "pve",
    cards: ["fire", "wind", "unknown", null]
  });

  assert.deepEqual(calls, ["playFire", "playWind"]);
});

test("sound: local pvp reveal stays neutral with a single flip", () => {
  const calls = [];
  const manager = new SoundManager({ catalog: {} });
  manager.play = (key) => {
    calls.push(key);
    return true;
  };

  manager.playReveal({
    mode: "local_pvp",
    cards: ["fire", "water"]
  });

  assert.deepEqual(calls, ["cardFlip"]);
});

test("sound: match complete mapping is mode-safe", () => {
  const calls = [];
  const manager = new SoundManager({ catalog: {} });
  manager.play = (key) => {
    calls.push(key);
    return true;
  };

  manager.playMatchComplete({
    mode: "pve",
    match: { status: "completed", winner: "p1" }
  });
  manager.playMatchComplete({
    mode: "pve",
    match: { status: "completed", winner: "p2" }
  });
  manager.playMatchComplete({
    mode: "local_pvp",
    match: { status: "completed", winner: "p2" }
  });

  assert.deepEqual(calls, ["matchWin", "matchLoss"]);
});

test("sound: disabled and missing assets fail silently", () => {
  const manager = new SoundManager({
    catalog: {},
    audioFactory: () => {
      throw new Error("should not be called for missing key");
    }
  });

  assert.equal(manager.play("does_not_exist"), false);

  manager.setEnabled(false);
  assert.equal(manager.play("warStart"), false);
});

test("sound: cooldown prevents immediate same-key spam", () => {
  const times = [1000, 1050, 1300];
  let idx = 0;
  const manager = new SoundManager({
    catalog: { warStart: "assets/sounds/war_starts.mp3" },
    now: () => {
      const value = times[Math.min(idx, times.length - 1)];
      idx += 1;
      return value;
    },
    cooldownMs: 120,
    audioFactory: () => ({
      currentTime: 0,
      play: () => Promise.resolve()
    })
  });

  assert.equal(manager.play("warStart"), true);
  assert.equal(manager.play("warStart"), false);
  assert.equal(manager.play("warStart"), true);
});

test("sound: clustered sounds are queued with spacing while first isolated sound stays immediate", () => {
  const scheduled = [];
  const played = [];
  const times = [1000, 1000];
  let idx = 0;

  const manager = new SoundManager({
    catalog: {
      playFire: "assets/sounds/play_fire.mp3",
      roundWin: "assets/sounds/win_round.mp3"
    },
    now: () => times[Math.min(idx++, times.length - 1)],
    setTimeout: (fn, delay) => {
      scheduled.push({ fn, delay });
      return 1;
    },
    audioFactory: (src) => ({
      currentTime: 0,
      play: () => {
        played.push(src);
        return Promise.resolve();
      }
    })
  });

  assert.equal(manager.play("playFire"), true);
  assert.equal(manager.play("roundWin"), true);

  assert.deepEqual(played, ["assets/sounds/play_fire.mp3"]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1000);

  scheduled[0].fn();
  assert.deepEqual(played, ["assets/sounds/play_fire.mp3", "assets/sounds/win_round.mp3"]);
});

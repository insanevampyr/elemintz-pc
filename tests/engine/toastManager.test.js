import test from "node:test";
import assert from "node:assert/strict";

import {
  ToastManager,
  getChestOpenRewardImagePath,
  getChestRewardImagePath
} from "../../src/renderer/systems/toastManager.js";

function makeFakeElement() {
  return {
    className: "",
    innerHTML: "",
    removed: false,
    classList: {
      classes: new Set(),
      add(value) {
        this.classes.add(value);
      },
      remove(value) {
        this.classes.delete(value);
      }
    },
    remove() {
      this.removed = true;
    }
  };
}

test("toast: token rewards create reward toast and queue without overlap", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showTokenReward({ amount: 1, label: "Daily Challenge" });
  manager.showTokenReward({ amount: 1, label: "Weekly Challenge" });

  assert.equal(appended.length, 2);
  assert.match(appended[0].className, /reward-toast/);
  assert.match(appended[0].innerHTML, /\+1 Token Earned/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: xp breakdown and level-up toasts render expected content", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showXpBreakdown({
    label: "Player XP",
    lines: [{ label: "Match Completed", amount: 1 }, { label: "Victory Bonus", amount: 2 }],
    total: 3
  });
  manager.showLevelUp({
    fromLevel: 4,
    toLevel: 5,
    rewards: [{ name: "Avatar: Novice Mage" }],
    playerName: "Tester"
  });

  assert.equal(appended.length, 2);
  assert.match(appended[0].className, /xp-breakdown-toast/);
  assert.match(appended[0].innerHTML, /TOTAL: \+3 XP/);
  assert.match(appended[1].className, /levelup-toast/);
  assert.match(appended[1].innerHTML, /src="(?:file:.*\/)?assets\/icons\/level_up\.png"/);
  assert.match(appended[1].innerHTML, /alt="Level Up"/);
  assert.match(appended[1].innerHTML, /Level 4 &rarr; Level 5/);
  assert.doesNotMatch(appended[1].innerHTML, />\?</);
  assert.match(appended[1].innerHTML, /Avatar: Novice Mage/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: level up toast keeps the no reward fallback copy without placeholder glyphs", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement() {
      return {
        className: "",
        innerHTML: "",
        classList: { add() {}, remove() {} },
        remove() {}
      };
    }
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 0;
  };
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showLevelUp({
    fromLevel: 34,
    toLevel: 35,
    rewards: [],
    playerName: "VampyrLee"
  });

  assert.equal(appended.length, 1);
  assert.match(appended[0].innerHTML, /Level 34 &rarr; Level 35/);
  assert.match(appended[0].innerHTML, /No new reward\./);
  assert.match(appended[0].innerHTML, /assets\/icons\/level_up\.png/);
  assert.doesNotMatch(appended[0].innerHTML, />\?</);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: achievement toast supports player-labeled heading", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showAchievement(
    { name: "First Flame", description: "Win your first match.", image: "badges/firstFlame.png" },
    { playerName: "Bob" }
  );

  assert.equal(appended.length, 1);
  assert.match(appended[0].innerHTML, /Bob unlocked achievement/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: reward presentation can show both token and XP lines with player label", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showTokenReward({ amount: 5, label: "Alice reward payout" });
  manager.showXpBreakdown({
    label: "Alice XP",
    lines: [
      { label: "Match Completed", amount: 1 },
      { label: "Win 1 Match Challenge", amount: 3 }
    ],
    total: 4
  });

  assert.equal(appended.length, 2);
  assert.match(appended[0].innerHTML, /\+5 Tokens Earned/);
  assert.match(appended[0].innerHTML, /Alice reward payout/);
  assert.match(appended[1].innerHTML, /\+3 XP Win 1 Match Challenge/);
  assert.match(appended[1].innerHTML, /Alice XP/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: chest grants render singular and plural labels", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showChestGrant({ amount: 1, chestLabel: "Basic Chest", chestType: "basic" });
  manager.showChestGrant({ amount: 2, chestLabel: "Basic Chest", chestType: "basic" });

  assert.equal(appended.length, 2);
  assert.match(appended[0].innerHTML, /\+1 Basic Chest/);
  assert.match(appended[0].innerHTML, /assets\/icons\/basic_chest\.png/);
  assert.match(appended[1].innerHTML, /\+2 Basic Chests/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: chest grant mapping uses the correct closed chest art for each supported chest type", () => {
  assert.match(getChestRewardImagePath("basic"), /assets\/icons\/basic_chest\.png/);
  assert.match(getChestRewardImagePath("milestone"), /assets\/icons\/loot_chest\.png/);
  assert.match(getChestRewardImagePath("epic"), /assets\/icons\/epic_chest\.png/);
  assert.match(getChestRewardImagePath("legendary"), /assets\/icons\/legendary_chest\.png/);
});

test("toast: unknown chest types fall back to the basic chest art safely", () => {
  assert.equal(getChestRewardImagePath("mystery"), getChestRewardImagePath("basic"));
});

test("toast: chest opened mapping uses the correct opened chest art for each supported chest type", () => {
  assert.match(getChestOpenRewardImagePath("basic"), /assets\/icons\/basic_chest_open\.png/);
  assert.match(getChestOpenRewardImagePath("milestone"), /assets\/icons\/loot_chest_open\.png/);
  assert.match(getChestOpenRewardImagePath("epic"), /assets\/icons\/epic_chest_open\.png/);
  assert.match(getChestOpenRewardImagePath("legendary"), /assets\/icons\/legendary_chest_open\.png/);
});

test("toast: unknown chest types fall back to the basic opened chest art safely", () => {
  assert.equal(getChestOpenRewardImagePath("mystery"), getChestOpenRewardImagePath("basic"));
});

test("toast: daily login streak reward shows day and mixed XP-token reward details", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showDailyLoginReward({
    tokens: 4,
    xp: 2,
    streakDay: 1,
    rewardSummary: { day: 1, tokens: 4, xp: 2, chestAwarded: null },
    xpConversionTokenBonus: 1
  });
  manager.showDailyLoginReward({
    tokens: 50,
    xp: 20,
    streakDay: 7,
    rewardSummary: { day: 7, tokens: 50, xp: 20, chestAwarded: null },
    xpConversionTokenBonus: 0
  });

  assert.equal(appended.length, 2);
  assert.match(appended[0].innerHTML, /Daily Login Streak/);
  assert.match(appended[0].innerHTML, /Day 1 of 7/);
  assert.match(appended[0].innerHTML, /Reward: 2 XP \+ 4 Tokens/);
  assert.match(appended[0].innerHTML, /Max Level Bonus: \+1 Tokens/);
  assert.match(appended[1].innerHTML, /Day 7 of 7/);
  assert.match(appended[1].innerHTML, /Day 7 Streak Reward!/);
  assert.match(appended[1].innerHTML, /No chest this time, but you earned 50 tokens\. Keep coming back to rebuild your streak\./);
  assert.doesNotMatch(appended[1].innerHTML, /Max Level Bonus:/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: daily login streak reward shows Day 7 chest outcomes and XP fallback clearly", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showDailyLoginReward({
    tokens: 50,
    xp: 20,
    streakDay: 7,
    rewardSummary: { day: 7, tokens: 50, xp: 20, chestAwarded: { chestType: "legendary", chestLabel: "Legendary Chest" } },
    chestAwarded: { chestType: "legendary", chestLabel: "Legendary Chest" }
  });
  manager.showDailyLoginReward({
    tokens: 50,
    xp: 20,
    streakDay: 7,
    rewardSummary: { day: 7, tokens: 50, xp: 20, chestAwarded: { chestType: "epic", chestLabel: "Epic Chest" } },
    chestAwarded: { chestType: "epic", chestLabel: "Epic Chest" }
  });
  manager.showDailyLoginReward({
    tokens: 50,
    xp: 20,
    streakDay: 7,
    rewardSummary: { day: 7, tokens: 50, xp: 20, chestAwarded: null }
  });

  assert.equal(appended.length, 3);
  assert.match(appended[0].innerHTML, /Day 7 Streak Reward!/);
  assert.match(appended[0].innerHTML, /Day 7 of 7/);
  assert.match(appended[0].innerHTML, /You earned 50 tokens and found a Legendary Chest!/);
  assert.match(appended[1].innerHTML, /You earned 50 tokens and found an Epic Chest!/);
  assert.match(appended[2].innerHTML, /No chest this time, but you earned 50 tokens\. Keep coming back to rebuild your streak\./);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

test("toast: chest open rewards render xp, tokens, and cosmetic messages", () => {
  const appended = [];
  const root = {
    appendChild(node) {
      appended.push(node);
    }
  };

  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    createElement: () => makeFakeElement()
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const manager = new ToastManager(root);
  manager.showChestOpenReward({ chestType: "basic", rewards: { xp: 5, tokens: 0, cosmetic: null } });
  manager.showChestOpenReward({ chestType: "milestone", rewards: { xp: 0, tokens: 10, cosmetic: null } });
  manager.showChestOpenReward({
    chestType: "epic",
    rewards: {
      xp: 0,
      tokens: 0,
      cosmetic: {
        id: "badge_ember",
        name: "Ember Crest",
        rarity: "Epic",
        type: "badge",
        image: "assets/badges/collector.png"
      }
    }
  });
  manager.showChestOpenReward({ chestType: "legendary", rewards: { xp: 1, tokens: 0, cosmetic: null } });
  manager.showChestOpenReward({ chestType: "mystery", rewards: { xp: 2, tokens: 0, cosmetic: null } });
  manager.showChestOpenReward({
    chestType: "basic",
    rewards: { xp: 0, tokens: 0, cosmetic: null, xpConversionTokenBonus: 2 }
  });
  manager.showChestOpenReward({
    chestType: "basic",
    rewards: { xp: 0, tokens: 0, cosmetic: { id: "title_test", name: "Spellwired" } }
  });

  assert.equal(appended.length, 7);
  assert.match(appended[0].className, /chest-open-reveal-toast/);
  assert.match(appended[0].innerHTML, /\+5 XP/);
  assert.match(appended[0].innerHTML, /assets\/icons\/basic_chest_open\.png/);
  assert.match(appended[0].innerHTML, /chest-open-toast-row-label">XP/);
  assert.match(appended[1].innerHTML, /\+10 Tokens/);
  assert.match(appended[1].innerHTML, /assets\/icons\/loot_chest_open\.png/);
  assert.match(appended[2].innerHTML, /Cosmetic Unlocked/);
  assert.match(appended[2].innerHTML, /Ember Crest/);
  assert.match(appended[2].innerHTML, /Epic[\s\S]*badge/);
  assert.match(appended[2].innerHTML, /assets\/badges\/collector\.png/);
  assert.match(appended[2].innerHTML, /assets\/icons\/epic_chest_open\.png/);
  assert.match(appended[3].innerHTML, /assets\/icons\/legendary_chest_open\.png/);
  assert.match(appended[4].innerHTML, /assets\/icons\/basic_chest_open\.png/);
  assert.match(appended[4].innerHTML, /Chest Opened/);
  assert.match(appended[5].innerHTML, /chest-open-toast-row-label">Max Level Bonus/);
  assert.match(appended[5].innerHTML, /\+2 Tokens/);
  assert.doesNotMatch(appended[5].innerHTML, /\+\d+ XP/);
  assert.equal((appended[5].innerHTML.match(/Max Level Bonus/g) ?? []).length, 1);
  assert.match(appended[6].innerHTML, /Spellwired/);
  assert.doesNotMatch(appended[6].innerHTML, /chest-open-toast-cosmetic-meta/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});

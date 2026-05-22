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
  globalThis.setTimeout = (callback) => { callback(); return 0; };

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
  globalThis.setTimeout = (callback) => { callback(); return 0; };

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
  assert.match(appended[1].innerHTML, /Level 4/);
  assert.match(appended[1].innerHTML, /Level 5/);

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
  globalThis.setTimeout = (callback) => { callback(); return 0; };

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
  globalThis.setTimeout = (callback) => { callback(); return 0; };

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
  globalThis.setTimeout = (callback) => { callback(); return 0; };

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

test("toast: daily login reward includes max level bonus line only when conversion occurs", () => {
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
  globalThis.setTimeout = (callback) => { callback(); return 0; };

  const manager = new ToastManager(root);
  manager.showDailyLoginReward({ tokens: 5, xp: 0, xpConversionTokenBonus: 1 });
  manager.showDailyLoginReward({ tokens: 5, xp: 2, xpConversionTokenBonus: 0 });

  assert.equal(appended.length, 2);
  assert.match(appended[0].innerHTML, /Max Level Bonus: \+1 Tokens/);
  assert.doesNotMatch(appended[1].innerHTML, /Max Level Bonus:/);

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
  globalThis.setTimeout = (callback) => { callback(); return 0; };

  const manager = new ToastManager(root);
  manager.showChestOpenReward({ chestType: "basic", rewards: { xp: 5, tokens: 0, cosmetic: null } });
  manager.showChestOpenReward({ chestType: "milestone", rewards: { xp: 0, tokens: 10, cosmetic: null } });
  manager.showChestOpenReward({
    chestType: "epic",
    rewards: { xp: 0, tokens: 0, cosmetic: { id: "badge_ember", name: "Ember Crest" } }
  });
  manager.showChestOpenReward({ chestType: "legendary", rewards: { xp: 1, tokens: 0, cosmetic: null } });
  manager.showChestOpenReward({ chestType: "mystery", rewards: { xp: 2, tokens: 0, cosmetic: null } });
  manager.showChestOpenReward({ chestType: "basic", rewards: { xp: 0, tokens: 0, cosmetic: null, xpConversionTokenBonus: 2 } });

  assert.equal(appended.length, 6);
  assert.match(appended[0].innerHTML, /\+5 XP/);
  assert.match(appended[0].innerHTML, /assets\/icons\/basic_chest_open\.png/);
  assert.match(appended[1].innerHTML, /\+10 Tokens/);
  assert.match(appended[1].innerHTML, /assets\/icons\/loot_chest_open\.png/);
  assert.match(appended[2].innerHTML, /Cosmetic: <strong>Ember Crest<\/strong>/);
  assert.match(appended[2].innerHTML, /assets\/icons\/epic_chest_open\.png/);
  assert.match(appended[3].innerHTML, /assets\/icons\/legendary_chest_open\.png/);
  assert.match(appended[4].innerHTML, /assets\/icons\/basic_chest_open\.png/);
  assert.match(appended[4].innerHTML, /Chest Opened/);
  assert.match(appended[5].innerHTML, /Max Level Bonus: \+2 Tokens/);

  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.setTimeout = originalSetTimeout;
});



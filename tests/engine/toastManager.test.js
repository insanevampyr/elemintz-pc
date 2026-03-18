import test from "node:test";
import assert from "node:assert/strict";

import { ToastManager } from "../../src/renderer/systems/toastManager.js";

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



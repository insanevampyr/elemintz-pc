import { getAssetPath } from "../utils/dom.js";

const CHEST_REWARD_IMAGE_PATHS = Object.freeze({
  basic: "icons/basic_chest.png",
  milestone: "icons/loot_chest.png",
  epic: "icons/epic_chest.png",
  legendary: "icons/legendary_chest.png"
});

const CHEST_OPEN_REWARD_IMAGE_PATHS = Object.freeze({
  basic: "icons/basic_chest_open.png",
  milestone: "icons/loot_chest_open.png",
  epic: "icons/epic_chest_open.png",
  legendary: "icons/legendary_chest_open.png"
});

function resolveAchievementImage(image) {
  if (!image) {
    return null;
  }

  const value = String(image);
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("../") ||
    value.startsWith("./") ||
    value.includes("/assets/") ||
    value.startsWith("assets/")
  ) {
    return value;
  }

  return getAssetPath(value);
}

function getChestRewardImagePath(chestType) {
  const safeChestType = String(chestType ?? "").trim().toLowerCase();
  const imagePath = CHEST_REWARD_IMAGE_PATHS[safeChestType] ?? CHEST_REWARD_IMAGE_PATHS.basic;
  return getAssetPath(imagePath);
}

function getChestOpenRewardImagePath(chestType) {
  const safeChestType = String(chestType ?? "").trim().toLowerCase();
  const imagePath =
    CHEST_OPEN_REWARD_IMAGE_PATHS[safeChestType] ?? CHEST_OPEN_REWARD_IMAGE_PATHS.basic;
  return getAssetPath(imagePath);
}

export class ToastManager {
  constructor(rootNode) {
    this.rootNode = rootNode;
    this.queue = [];
    this.active = false;
  }

  enqueueToast({ className, html, durationMs = 2200 }) {
    this.queue.push({ className, html, durationMs });
    this.processQueue();
  }

  processQueue() {
    if (this.active || this.queue.length === 0) {
      return;
    }

    this.active = true;
    const next = this.queue.shift();
    const toast = document.createElement("article");
    toast.className = next.className;
    toast.innerHTML = next.html;

    this.rootNode.appendChild(toast);

    // Trigger enter animation after first paint.
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    setTimeout(() => {
      toast.classList.remove("show");
      toast.classList.add("hide");

      setTimeout(() => {
        toast.remove();
        this.active = false;
        this.processQueue();
      }, 280);
    }, next.durationMs);
  }

  showAchievement(achievement, options = {}) {
    const playerName = options?.playerName ? String(options.playerName) : "";
    const image = resolveAchievementImage(achievement.image);
    const heading = playerName ? `${playerName} unlocked achievement` : "Achievement Unlocked";

    this.enqueueToast({
      className: "achievement-toast",
      durationMs: 3000,
      html: `
        ${image ? `<img class="achievement-toast-badge" src="${image}" alt="${achievement.name}" />` : '<div class="achievement-toast-badge">?</div>'}
        <div>
          <h4>${heading}</h4>
          <p><strong>${achievement.name}</strong></p>
          <p>${achievement.description}</p>
          ${achievement.repeatable ? `<p>Count: ${achievement.count}</p>` : ""}
        </div>
      `
    });
  }

  showTokenReward({ amount = 0, label = "Token Earned" }) {
    const tokenAmount = Math.max(0, Number(amount) || 0);
    this.enqueueToast({
      className: "reward-toast",
      durationMs: 2000,
      html: `
        <div class="reward-toast-icon">\u2728</div>
        <div>
          <h4>+${tokenAmount} Token${tokenAmount === 1 ? "" : "s"} Earned</h4>
          <p>${label}</p>
        </div>
      `
    });
  }

  showDailyLoginReward({ tokens = 5, xp = 2, xpConversionTokenBonus = 0 } = {}) {
    console.info("[DailyLogin][Renderer] toast display path ran", {
      tokens,
      xp,
      xpConversionTokenBonus
    });

    this.enqueueToast({
      className: "reward-toast daily-login-toast",
      durationMs: 2400,
      html: `
        <div class="reward-toast-icon">\u2B50</div>
        <div>
          <h4>Daily Login Reward</h4>
          <p>+${Math.max(0, Number(tokens) || 0)} Tokens</p>
          <p>+${Math.max(0, Number(xp) || 0)} XP</p>
          ${Math.max(0, Number(xpConversionTokenBonus) || 0) > 0 ? `<p>Max Level Bonus: +${Math.max(0, Number(xpConversionTokenBonus) || 0)} Tokens</p>` : ""}
        </div>
      `
    });
  }

  showChestGrant({ amount = 0, chestLabel = "Basic Chest", chestType = "basic" } = {}) {
    const chestAmount = Math.max(0, Number(amount) || 0);
    if (chestAmount <= 0) {
      return;
    }
    const chestImage = getChestRewardImagePath(chestType);

    this.enqueueToast({
      className: "reward-toast chest-toast",
      durationMs: 2200,
      html: `
        <img class="reward-toast-icon reward-toast-icon-image" src="${chestImage}" alt="${chestLabel}" />
        <div>
          <h4>+${chestAmount} ${chestLabel}${chestAmount === 1 ? "" : "s"}</h4>
        </div>
      `
    });
  }

  showChestOpenReward({ rewards = {}, chestType = "basic" } = {}) {
    const xpAmount = Math.max(0, Number(rewards?.xp) || 0);
    const tokenAmount = Math.max(0, Number(rewards?.tokens) || 0);
    const xpConversionTokenBonus = Math.max(0, Number(rewards?.xpConversionTokenBonus) || 0);
    const cosmeticName = String(rewards?.cosmetic?.name ?? "").trim();
    const rewardLines = [];
    const chestImage = getChestOpenRewardImagePath(chestType);

    if (tokenAmount > 0) {
      rewardLines.push(`<p>+${tokenAmount} Token${tokenAmount === 1 ? "" : "s"}</p>`);
    }
    if (xpAmount > 0) {
      rewardLines.push(`<p>+${xpAmount} XP</p>`);
    }
    if (xpConversionTokenBonus > 0) {
      rewardLines.push(`<p>Max Level Bonus: +${xpConversionTokenBonus} Tokens</p>`);
    }
    if (cosmeticName) {
      const rarity = String(rewards?.cosmetic?.rarity ?? "").trim();
      rewardLines.push(
        `<p>${rarity ? `${rarity} ` : ""}Cosmetic: <strong>${cosmeticName}</strong></p>`
      );
    }

    if (rewardLines.length === 0) {
      return;
    }

    this.enqueueToast({
      className: "reward-toast chest-open-toast",
      durationMs: 2200,
      html: `
        <img class="reward-toast-icon reward-toast-icon-image" src="${chestImage}" alt="Opened ${String(chestType ?? "basic").trim() || "basic"} chest" />
        <div>
          <h4>Chest Opened</h4>
          ${rewardLines.join("")}
        </div>
      `
    });
  }

  showXpBreakdown({ lines = [], total = 0, label = "XP Summary" }) {
    const filtered = Array.isArray(lines) ? lines.filter((line) => Number(line?.amount ?? 0) > 0) : [];
    if (!filtered.length || Number(total ?? 0) <= 0) {
      return;
    }

    this.enqueueToast({
      className: "xp-breakdown-toast",
      durationMs: 2600,
      html: `
        <div class="reward-toast-icon">XP</div>
        <div>
          <h4>${label}</h4>
          ${filtered.map((line) => `<p>+${line.amount} XP ${line.label}</p>`).join("")}
          <p><strong>TOTAL: +${total} XP</strong></p>
        </div>
      `
    });
  }

  showLevelUp({ fromLevel = 1, toLevel = 1, rewards = [], playerName = "Player" }) {
    if (Number(toLevel) <= Number(fromLevel)) {
      return;
    }

    const rewardLines = Array.isArray(rewards) && rewards.length
      ? rewards.map((reward) => `<p>${reward.name}</p>`).join("")
      : "<p>No new reward.</p>";

    this.enqueueToast({
      className: "levelup-toast",
      durationMs: 3400,
      html: `
        <div class="reward-toast-icon">?</div>
        <div>
          <h4>LEVEL UP! ${playerName}</h4>
          <p>Level ${fromLevel} ? Level ${toLevel}</p>
          ${rewardLines}
        </div>
      `
    });
  }
}

export { getChestOpenRewardImagePath, getChestRewardImagePath };


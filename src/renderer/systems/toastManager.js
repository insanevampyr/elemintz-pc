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

const LEVEL_UP_ICON_PATH = "icons/level_up.png";

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

function resolveOptionalAssetPath(value) {
  const safeValue = String(value ?? "").trim();
  if (!safeValue) {
    return null;
  }

  if (
    safeValue.startsWith("http://") ||
    safeValue.startsWith("https://") ||
    safeValue.startsWith("data:") ||
    safeValue.startsWith("../") ||
    safeValue.startsWith("./") ||
    safeValue.includes("/assets/") ||
    safeValue.startsWith("assets/")
  ) {
    return safeValue.startsWith("assets/") ? getAssetPath(safeValue.slice("assets/".length)) : safeValue;
  }

  return getAssetPath(safeValue);
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
    const cosmeticRarity = String(rewards?.cosmetic?.rarity ?? "").trim();
    const cosmeticType = String(
      rewards?.cosmetic?.displayType ?? rewards?.cosmetic?.typeLabel ?? rewards?.cosmetic?.type ?? ""
    ).trim();
    const cosmeticImage = resolveOptionalAssetPath(rewards?.cosmetic?.image ?? "");
    const rewardRows = [];
    const chestImage = getChestOpenRewardImagePath(chestType);

    if (tokenAmount > 0) {
      rewardRows.push(`
        <div class="chest-open-toast-row chest-open-toast-row-token">
          <span class="chest-open-toast-row-label">Tokens</span>
          <strong class="chest-open-toast-row-value">+${tokenAmount} Token${tokenAmount === 1 ? "" : "s"}</strong>
        </div>
      `);
    }
    if (xpAmount > 0) {
      rewardRows.push(`
        <div class="chest-open-toast-row chest-open-toast-row-xp">
          <span class="chest-open-toast-row-label">XP</span>
          <strong class="chest-open-toast-row-value">+${xpAmount} XP</strong>
        </div>
      `);
    }
    if (xpConversionTokenBonus > 0) {
      rewardRows.push(`
        <div class="chest-open-toast-row chest-open-toast-row-bonus">
          <span class="chest-open-toast-row-label">Max Level Bonus</span>
          <strong class="chest-open-toast-row-value">+${xpConversionTokenBonus} Tokens</strong>
        </div>
      `);
    }

    const cosmeticBlock =
      cosmeticName
        ? `
        <section class="chest-open-toast-cosmetic">
          <p class="chest-open-toast-cosmetic-kicker">Cosmetic Unlocked</p>
          <div class="chest-open-toast-cosmetic-body">
            ${
              cosmeticImage
                ? `<img class="chest-open-toast-cosmetic-image" src="${cosmeticImage}" alt="${cosmeticName}" />`
                : ""
            }
            <div class="chest-open-toast-cosmetic-copy">
              <strong class="chest-open-toast-cosmetic-name">${cosmeticName}</strong>
              ${
                cosmeticRarity || cosmeticType
                  ? `<p class="chest-open-toast-cosmetic-meta">${[cosmeticRarity, cosmeticType].filter(Boolean).join(" • ")}</p>`
                  : ""
              }
            </div>
          </div>
        </section>
      `
        : "";

    if (rewardRows.length === 0 && !cosmeticBlock) {
      return;
    }

    this.enqueueToast({
      className: "reward-toast chest-open-toast chest-open-reveal-toast",
      durationMs: 2400,
      html: `
        <div class="chest-open-toast-visual">
          <img class="reward-toast-icon reward-toast-icon-image chest-open-toast-image" src="${chestImage}" alt="Opened ${String(chestType ?? "basic").trim() || "basic"} chest" />
        </div>
        <div class="chest-open-toast-content">
          <h4>Chest Opened</h4>
          <div class="chest-open-toast-rewards">
            ${rewardRows.join("")}
          </div>
          ${cosmeticBlock}
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

    const levelUpIcon = getAssetPath(LEVEL_UP_ICON_PATH);
    const rewardLines = Array.isArray(rewards) && rewards.length
      ? rewards.map((reward) => `<p class="levelup-toast-reward-line">${reward.name}</p>`).join("")
      : '<p class="levelup-toast-reward-line levelup-toast-reward-line-muted">No new reward.</p>';

    this.enqueueToast({
      className: "levelup-toast",
      durationMs: 3400,
      html: `
        <img class="reward-toast-icon reward-toast-icon-image levelup-toast-icon-image" src="${levelUpIcon}" alt="Level Up" />
        <div class="levelup-toast-content">
          <h4>LEVEL UP! ${playerName}</h4>
          <p class="levelup-toast-transition">Level ${fromLevel} &rarr; Level ${toLevel}</p>
          ${rewardLines}
        </div>
      `
    });
  }
}

export { getChestOpenRewardImagePath, getChestRewardImagePath };


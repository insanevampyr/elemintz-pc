import { getAssetPath } from "../../utils/dom.js";

const MENU_TILE_IMAGE_MAP = Object.freeze({
  "start-pve-btn": "menu_tiles/tile_play_ai.png",
  "start-local-btn": "menu_tiles/tile_local_pvp.png",
  "online-play-btn": "menu_tiles/tile_local_pvp.png",
  "profile-btn": "menu_tiles/tile_profile.png",
  "cosmetics-btn": "menu_tiles/tile_cosmetics.png",
  "store-btn": "menu_tiles/tile_store.png",
  "achievements-btn": "menu_tiles/tile_achievements.png",
  "settings-btn": "menu_tiles/tile_settings.png",
  "logout-btn": "menu_tiles/tile_logout.png"
});

function renderChallengeLine(item, iconText) {
  const progress = Math.max(0, Number(item?.progress ?? 0));
  const goal = Math.max(1, Number(item?.goal ?? 1));
  const status = item?.completed ? "\u2714" : `${progress}/${goal}`;
  const rewardXp = Math.max(0, Number(item?.rewardXp ?? 0));
  const rewardTokens = Math.max(0, Number(item?.rewardTokens ?? 0));
  return `
    <div class="menu-challenge-line">
      <p>${iconText} ${item.name} <strong>${status}</strong></p>
      <p class="menu-challenge-reward">+${rewardXp} XP &#8226; +${rewardTokens} Token${rewardTokens === 1 ? "" : "s"}</p>
    </div>
  `;
}

function renderMenuTile(id, label) {
  const image = getAssetPath(MENU_TILE_IMAGE_MAP[id]);
  return `
    <button
      id="${id}"
      class="menu-tile"
      type="button"
      aria-label="${label}"
    >
      <span class="menu-tile__visual" style="background-image: url('${image}')">
        <span class="menu-tile__veil"></span>
        <span class="menu-tile__label">${label}</span>
      </span>
    </button>
  `;
}

function getChallengeSummary(bucket) {
  const challenges = bucket?.challenges ?? [];
  const total = challenges.length;
  const completed = challenges.filter((item) => item?.completed).length;
  return { completed, total };
}

function getPreviewChallenges(bucket, limit = 3) {
  const challenges = bucket?.challenges ?? [];
  const unfinished = challenges.filter((item) => !item?.completed);
  const completed = challenges.filter((item) => item?.completed);
  return [...unfinished, ...completed].slice(0, limit);
}

export function renderMenuChallengePreview(title, iconText, bucket) {
  const bucketKey = String(title ?? "").trim().toLowerCase();
  if (!bucket) {
    return `
      <div class="stack-sm menu-challenge-column" data-menu-challenge-bucket="${bucketKey}">
        <div class="stack-xs menu-challenge-header">
          <h4 class="section-title">${title}</h4>
          <p class="muted">${title} - 0/0</p>
        </div>
        <p class="muted">Challenges are loading...</p>
        <p class="muted menu-challenge-reset" data-menu-reset-label="${bucketKey}">Reset in: ${bucket?.resetLabel ?? "--:--"}</p>
      </div>
    `;
  }

  if (!bucket.challenges?.length) {
    return `
      <div class="stack-sm menu-challenge-column" data-menu-challenge-bucket="${bucketKey}">
        <div class="stack-xs menu-challenge-header">
          <h4 class="section-title">${title}</h4>
          <p class="muted">${title} - 0/0</p>
        </div>
        <p class="muted">No ${bucketKey} challenges available right now.</p>
        <p class="muted menu-challenge-reset" data-menu-reset-label="${bucketKey}">Reset in: ${bucket.resetLabel ?? "--:--"}</p>
      </div>
    `;
  }

  const preview = getPreviewChallenges(bucket, 3);
  const summary = getChallengeSummary(bucket);
  return `
    <div class="stack-sm menu-challenge-column" data-menu-challenge-bucket="${bucketKey}">
      <div class="stack-xs menu-challenge-header">
        <h4 class="section-title">${title}</h4>
        <p class="muted">${title} - ${summary.completed}/${summary.total}</p>
      </div>
      ${preview.map((item) => renderChallengeLine(item, iconText)).join("")}
      <p class="muted menu-challenge-reset" data-menu-reset-label="${bucketKey}">Reset in: ${bucket.resetLabel ?? "--:--"}</p>
    </div>
  `;
}

export function renderMenuDailyLoginStatus(status) {
  if (!status) {
    return '<p class="muted">Daily Login Reward status unavailable.</p>';
  }

  return `
    <div class="menu-daily-login">
      <p><strong id="menu-daily-login-status">${status.stateLabel.replace("Next Daily Login Reward", "Daily Login Reward")}</strong></p>
    </div>
  `;
}

export const menuScreen = {
  render(context) {
    return `
      <section class="screen screen-menu">
        <section class="arena-board screen-themed-surface" style="background-image: url('${context.backgroundImage}')">
          <div class="panel themed-screen-panel">
            <h2 class="view-title">Main Menu</h2>
            <p>Signed in as <strong>${context.username}</strong></p>
            <div class="inline-actions auth-session-actions">
              <button id="switch-account-btn" class="btn btn-secondary" type="button">Switch Account</button>
            </div>
            <div class="grid two-col">
              <div class="grid two-col menu-action-grid">
                ${renderMenuTile("start-pve-btn", "Play vs AI")}
                ${renderMenuTile("start-local-btn", "Local 2-Player")}
                ${renderMenuTile("online-play-btn", "Online Play")}
                ${renderMenuTile("profile-btn", "Profile")}
                ${renderMenuTile("cosmetics-btn", "Cosmetics")}
                ${renderMenuTile("store-btn", "Store")}
                ${renderMenuTile("achievements-btn", "Achievements")}
                ${renderMenuTile("settings-btn", "Settings")}
                ${renderMenuTile("logout-btn", "Logout")}
              </div>
              <aside class="panel stack-sm daily-panel">
                <div data-menu-daily-login-panel="true">
                  ${renderMenuDailyLoginStatus(context.dailyChallenges?.dailyLogin)}
                </div>
                <div class="menu-challenges-heading">
                  <h3 class="section-title">Challenges</h3>
                </div>
                <div class="grid two-col menu-challenge-columns">
                  <div data-menu-challenge-preview="daily">
                    ${renderMenuChallengePreview("Daily", "\u2B50", context.dailyChallenges?.daily)}
                  </div>
                  <div data-menu-challenge-preview="weekly">
                    ${renderMenuChallengePreview("Weekly", "\uD83C\uDFC6", context.dailyChallenges?.weekly)}
                  </div>
                </div>
                <div class="menu-challenge-actions">
                  <button id="open-daily-challenges-btn" class="btn">View All</button>
                </div>
              </aside>
            </div>
          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("start-pve-btn").addEventListener("click", context.actions.startPveGame);
    document.getElementById("start-local-btn").addEventListener("click", context.actions.startLocalGame);
    document.getElementById("online-play-btn").addEventListener("click", context.actions.openOnlinePlay);
    document.getElementById("profile-btn").addEventListener("click", context.actions.openProfile);
    document.getElementById("achievements-btn").addEventListener("click", context.actions.openAchievements);
    document
      .getElementById("open-daily-challenges-btn")
      .addEventListener("click", context.actions.openDailyChallenges);
    document.getElementById("cosmetics-btn").addEventListener("click", context.actions.openCosmetics);
    document.getElementById("store-btn").addEventListener("click", context.actions.openStore);
    document.getElementById("settings-btn").addEventListener("click", context.actions.openSettings);
    document.getElementById("switch-account-btn").addEventListener("click", context.actions.switchAccount);
    document.getElementById("logout-btn").addEventListener("click", context.actions.logout);
  }
};

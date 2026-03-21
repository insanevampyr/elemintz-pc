import { getArenaBackground, getAvatarImage, getBadgeImage } from "../../utils/assets.js";
import { getAssetPath } from "../../utils/dom.js";
import {
  ACHIEVEMENT_CATALOG,
  countUnlockedAchievements,
  getUnlockedAchievements
} from "../../utils/achievements.js";
import { getCosmeticDisplayName } from "../../../state/cosmeticSystem.js";

function resolveImagePath(image) {
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

function renderTitleLine(titleText, titleIcon, featuredBadge) {
  const icon = resolveImagePath(titleIcon);
  const badge = resolveImagePath(featuredBadge);

  return `
    <p class="player-title">
      ${icon ? `<img class="title-icon" src="${icon}" alt="${titleText}" />` : ""}
      <span>${titleText}</span>
      ${badge ? `<img class="featured-badge" src="${badge}" alt="Featured Badge" />` : ""}
    </p>
  `;
}

function renderAchievement(achievement) {
  const image = resolveImagePath(achievement.image);

  return `
    <article class="achievement-card unlocked">
      ${image ? `<img src="${image}" alt="${achievement.name}" class="achievement-badge" />` : '<div class="achievement-badge missing">No Badge</div>'}
      <div>
        <p><strong>${achievement.name}</strong></p>
        <p>${achievement.description}</p>
        ${achievement.repeatable ? `<p>Repeat Count: ${achievement.count}</p>` : ""}
      </div>
    </article>
  `;
}

function getTitleCatalogIcon(cosmetics, equippedTitleId) {
  const titleItems = cosmetics?.catalog?.title;
  if (!Array.isArray(titleItems) || !equippedTitleId) {
    return null;
  }

  const titleItem = titleItems.find((item) => item.id === equippedTitleId);
  return titleItem?.image ?? null;
}

function viewedTitleIcon(viewedProfile) {
  const title = getCosmeticDisplayName(
    "title",
    viewedProfile?.equippedCosmetics?.title,
    viewedProfile?.title ?? "Initiate"
  );
  const iconMap = {
    "Flame Vanguard": "badges/firstFlame.png",
    "Arena Founder": "badges/earlyTester.png",
    "Token Tycoon": "badges/collector.png",
    "Apprentice": "badges/firstFlame.png",
    "Elementalist": "badges/elementalConqueror.png",
    "War Master": "badges/warMachine.png",
    "Element Sovereign": "badges/elementalMaster.png",
    "Master of EleMintz": "badges/elementalOverlord.png",
    "Storm Breaker": "badges/badge_longest_war_7.png",
    "Last Card Legend": "badges/badge_comeback_win_25.png"
  };

  return iconMap[title] ?? null;
}

function renderXpProgress(profile) {
  const level = Math.max(1, Number(profile.playerLevel ?? 1));
  const totalXp = Math.max(0, Number(profile.playerXP ?? 0));
  const currentLevelXp = Math.max(0, Number(profile.currentLevelXp ?? 0));
  const nextLevelXp = Math.max(currentLevelXp, Number(profile.nextLevelXp ?? currentLevelXp));
  const range = Math.max(1, nextLevelXp - currentLevelXp);
  const displayedCurrentXp =
    level >= 100 ? range : Math.max(0, Math.min(range, totalXp - currentLevelXp));
  const displayedRequiredXp = range;
  const progress =
    level >= 100
      ? 100
      : Math.max(0, Math.min(100, Math.round((displayedCurrentXp / displayedRequiredXp) * 100)));

  const nextReward = profile.nextReward ?? null;
  const nextRewardLine = nextReward
    ? `<p class="next-reward-line"><strong>Next Reward:</strong> Lv ${nextReward.level} - ${nextReward.name}</p>`
    : '<p class="next-reward-line"><strong>Next Reward:</strong> Level cap reached</p>';

  return `
    <section class="stack-sm xp-panel">
      <h3 class="section-title">Progression</h3>
      <p><strong>Level ${level}</strong></p>
      <p>XP: ${displayedCurrentXp} / ${displayedRequiredXp}</p>
      ${nextRewardLine}
      <div class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <div class="xp-fill" data-target-width="${progress}" style="width: ${progress}%"></div>
      </div>
    </section>
  `;
}

function renderChestPanel(profile, visualState = {}) {
  const basicChestCount = Math.max(0, Number(profile?.chests?.basic ?? 0) || 0);
  const chestIcon = getAssetPath(
    visualState?.basicOpen ? "icons/basic_chest_open.png" : "icons/basic_chest.png"
  );

  return `
    <section class="stack-sm chest-panel">
      <h3 class="section-title">Basic Chests</h3>
      <div class="chest-row">
        <div class="chest-slot">
          <button
            id="open-basic-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${basicChestCount > 0 ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Basic Chest"
          >
            <span class="chest-count-bubble" aria-label="Basic Chest count">${basicChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${chestIcon}" alt="Basic Chest" data-basic-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper">${basicChestCount > 0 ? "Click chest to open" : "No Basic Chests available"}</p>
        </div>
      </div>
    </section>
  `;
}
function renderReadOnlyProfile(viewedProfile) {
  if (!viewedProfile) {
    return "";
  }

  const avatar = getAvatarImage(viewedProfile.equippedCosmetics?.avatar);
  const unlockedAchievements = getUnlockedAchievements(viewedProfile);
  const title = getCosmeticDisplayName(
    "title",
    viewedProfile.equippedCosmetics?.title,
    viewedProfile.title ?? "Initiate"
  );
  const featuredBadge = getBadgeImage(viewedProfile.equippedCosmetics?.badge ?? "none");
  const level = Math.max(1, Number(viewedProfile.playerLevel ?? 1));
  const xp = Math.max(0, Number(viewedProfile.playerXP ?? 0));
  const tokens = Math.max(0, Number(viewedProfile.tokens ?? 0));
  const wins = Math.max(0, Number(viewedProfile.wins ?? 0));
  const losses = Math.max(0, Number(viewedProfile.losses ?? 0));
  const cardsCaptured = Math.max(0, Number(viewedProfile.cardsCaptured ?? 0));
  const gamesPlayed = Math.max(0, Number(viewedProfile.gamesPlayed ?? 0));
  const warsEntered = Math.max(0, Number(viewedProfile.warsEntered ?? 0));
  const warsWon = Math.max(0, Number(viewedProfile.warsWon ?? 0));
  const longestWar = Math.max(0, Number(viewedProfile.longestWar ?? 0));
  const bestWinStreak = Math.max(0, Number(viewedProfile.bestWinStreak ?? 0));
  const pveWins = Math.max(0, Number(viewedProfile.modeStats?.pve?.wins ?? 0));
  const pveLosses = Math.max(0, Number(viewedProfile.modeStats?.pve?.losses ?? 0));
  const pvpWins = Math.max(0, Number(viewedProfile.modeStats?.local_pvp?.wins ?? 0));
  const pvpLosses = Math.max(0, Number(viewedProfile.modeStats?.local_pvp?.losses ?? 0));
  const viewedBackgroundId =
    viewedProfile.equippedCosmetics?.background ??
    viewedProfile.cosmetics?.background ??
    "default_background";
  const viewedBackground = getArenaBackground(viewedBackgroundId);

  return `
    <section class="panel stack-sm viewed-profile-panel" style="background-image: url('${viewedBackground}')">
      <div class="viewed-profile-content">
        <h3 class="section-title">Viewed Profile</h3>
        <div class="player-header">
          <img class="player-avatar" src="${avatar}" alt="${viewedProfile.username}" />
          <div>
            <h3>${viewedProfile.username}</h3>
            ${renderTitleLine(title, viewedTitleIcon(viewedProfile), featuredBadge)}
          </div>
        </div>
        <div class="grid two-col">
          <p>Level: ${level}</p>
          <p>Total XP: ${xp}</p>
          <p>Tokens: ${tokens}</p>
          <p>Games Played: ${gamesPlayed}</p>
          <p>Wins: ${wins}</p>
          <p>Losses: ${losses}</p>
          <p>Cards Captured: ${cardsCaptured}</p>
          <p>Wars Entered / Won: ${warsEntered} / ${warsWon}</p>
          <p>Longest War: ${longestWar}</p>
          <p>Best Win Streak: ${bestWinStreak}</p>
          <p>PvE W/L: ${pveWins} / ${pveLosses}</p>
          <p>Local PvP W/L: ${pvpWins} / ${pvpLosses}</p>
          <p>Achievements: ${unlockedAchievements.length}</p>
        </div>
        <div class="achievement-grid achievement-grid-profile">
          ${
            unlockedAchievements.length > 0
              ? unlockedAchievements.map(renderAchievement).join("")
              : "<p>No unlocked achievements yet.</p>"
          }
        </div>
      </div>
    </section>
  `;
}

export const profileScreen = {
  render(context) {
    const profile = context.profile;
    const unlockedAchievements = getUnlockedAchievements(profile);
    const unlockedAchievementCount = countUnlockedAchievements(profile);
    const totalAchievementCount = ACHIEVEMENT_CATALOG.length;
    const searchResults = context.searchResults ?? [];
    const cosmetics = context.cosmetics;

    const playerAvatar = getAvatarImage(profile.equippedCosmetics?.avatar);
    const profileTitleIcon = getTitleCatalogIcon(cosmetics, profile.equippedCosmetics?.title);
    const equippedTitle = getCosmeticDisplayName(
      "title",
      profile.equippedCosmetics?.title,
      profile.title ?? "Initiate"
    );

    return `
      <section class="screen screen-profile">
        <section class="arena-board screen-themed-surface" style="background-image: url('${context.backgroundImage}')">
          <div class="panel themed-screen-panel">
          <div class="screen-topbar">
            <h2 class="view-title">Profile</h2>
            <button id="profile-back-btn" class="btn screen-back-btn">Back</button>
          </div>
          <div class="player-header">
            <img class="player-avatar" src="${playerAvatar}" alt="${profile.username}" />
            <div>
              <h3>${profile.username}</h3>
              ${renderTitleLine(equippedTitle, profileTitleIcon, getBadgeImage(profile.equippedCosmetics?.badge ?? "none"))}
            </div>
          </div>
          <p>Tokens: <strong>${profile.tokens ?? 0}</strong></p>
          <p>Founder / Supporter: <strong>${profile.supporterPass ? "Active" : "Not Active"}</strong></p>
          ${renderXpProgress(profile)}
          ${renderChestPanel(profile, context.basicChestVisualState)}

          <div class="grid two-col">
            <p>Wins: ${profile.wins}</p>
            <p>Losses: ${profile.losses}</p>
            <p>Wars Entered: ${profile.warsEntered}</p>
            <p>Wars Won: ${profile.warsWon}</p>
            <p>Longest War: ${profile.longestWar}</p>
            <p>Cards Captured: ${profile.cardsCaptured}</p>
            <p>Games Played: ${profile.gamesPlayed ?? 0}</p>
            <p>Best Win Streak: ${profile.bestWinStreak ?? 0}</p>
          </div>

          <h3 class="section-title">Mode Stats</h3>
          <div class="grid two-col">
            <p>PvE W/L: ${profile.modeStats?.pve?.wins ?? 0} / ${profile.modeStats?.pve?.losses ?? 0}</p>
            <p>Local PvP W/L: ${profile.modeStats?.local_pvp?.wins ?? 0} / ${profile.modeStats?.local_pvp?.losses ?? 0}</p>
          </div>

          <h3 class="section-title">Achievements (${unlockedAchievementCount}/${totalAchievementCount})</h3>
          <div class="achievement-grid achievement-grid-profile">
            ${
              unlockedAchievements.length > 0
                ? unlockedAchievements.map(renderAchievement).join("")
                : "<p>No achievements unlocked yet.</p>"
            }
          </div>

          <h3 class="section-title">Profile Search</h3>
          <form id="profile-search-form" class="stack-sm">
            <label for="profile-search-input">Search usernames</label>
            <input id="profile-search-input" name="profileSearch" type="text" value="${context.searchQuery ?? ""}" />
            <button type="submit" class="btn">Search</button>
          </form>

          ${
            searchResults.length
              ? `<div class="stack-sm">${searchResults
                  .map((item) => `<button class="btn" data-view-profile="${item.username}">View ${item.username}</button>`)
                  .join("")}</div>`
              : ""
          }

          ${renderReadOnlyProfile(context.viewedProfile)}
          ${context.viewedProfile ? '<button id="clear-viewed-profile-btn" class="btn">Close Viewed Profile</button>' : ""}

          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("profile-back-btn").addEventListener("click", context.actions.back);
    const openBasicChestButton = document.getElementById("open-basic-chest-btn");
    if (openBasicChestButton && context.actions.openBasicChest) {
      openBasicChestButton.addEventListener("click", context.actions.openBasicChest);
    }

    const searchForm = document.getElementById("profile-search-form");
    searchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const query = String(formData.get("profileSearch") ?? "").trim();
      await context.actions.searchProfiles(query);
    });

    document.querySelectorAll("[data-view-profile]").forEach((button) => {
      button.addEventListener("click", async () => {
        const username = button.getAttribute("data-view-profile");
        await context.actions.viewProfile(username);
      });
    });

    const clearViewed = document.getElementById("clear-viewed-profile-btn");
    if (clearViewed) {
      clearViewed.addEventListener("click", context.actions.clearViewed);
    }
  }
};










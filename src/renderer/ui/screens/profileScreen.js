import { getArenaBackground, getAvatarImage, getBadgeImage } from "../../utils/assets.js";
import { getAssetPath } from "../../utils/dom.js";
import { buildAchievementCatalog } from "../../../state/achievementSystem.js";
import {
  getCosmeticDisplayName,
  getCosmeticDefinition,
  getCosmeticHoverMetadata
} from "../../../state/cosmeticSystem.js";
import {
  bindCosmeticHoverPreview,
  buildHoverPreviewAttributes,
  hasRenderablePreviewSource
} from "../shared/cosmeticHoverPreview.js";

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

function renderTitleLine(titleText, titleIcon, featuredBadge, options = {}) {
  const icon = resolveImagePath(titleIcon);
  const badge = resolveImagePath(featuredBadge);
  const titleDefinition = options.titleId ? getCosmeticDefinition("title", options.titleId) : null;
  const canonicalTitleImage = titleDefinition?.image ? resolveImagePath(titleDefinition.image) : null;
  const titleDisplaySrc = hasRenderablePreviewSource(icon, {
    previewName: titleText,
    previewVisualText: titleText
  })
    ? icon
    : hasRenderablePreviewSource(canonicalTitleImage, {
        previewName: titleText,
        previewVisualText: titleText
      })
      ? canonicalTitleImage
      : null;
  const titlePreviewSrc = hasRenderablePreviewSource(canonicalTitleImage, {
    previewName: titleText,
    previewVisualText: titleText
  })
    ? canonicalTitleImage
    : null;
  const badgeDisplaySrc = hasRenderablePreviewSource(badge, {
    previewName: "Featured Badge"
  })
    ? badge
    : null;
  const titleHoverMetadata = getCosmeticHoverMetadata("title", options.titleId, titleText);
  const titleHoverAttributes = buildHoverPreviewAttributes({
    previewType: "title",
    previewSrc: titlePreviewSrc,
    previewName: titleHoverMetadata.name ?? titleText,
    previewDescription: titleHoverMetadata.description,
    previewVisualText: titleText,
    previewRarity: titleHoverMetadata.rarity
  });
  const badgeHoverMetadata = badgeDisplaySrc
    ? getCosmeticHoverMetadata("badge", options.badgeId, "Featured Badge")
    : null;
  const badgeHoverAttributes = badgeDisplaySrc
    ? buildHoverPreviewAttributes({
        previewType: "badge",
        previewSrc: badgeDisplaySrc,
        previewName: badgeHoverMetadata?.name ?? "Featured Badge",
        previewDescription: badgeHoverMetadata?.description ?? "",
        previewRarity: badgeHoverMetadata?.rarity ?? "Common"
      })
    : "";

  return `
    <p class="player-title">
      <span class="player-title-preview" ${titleHoverAttributes}>${titleDisplaySrc ? `<img class="title-icon" src="${titleDisplaySrc}" alt="${titleText}" />` : ""}<span>${titleText}</span></span>
      ${badgeDisplaySrc ? `<img class="featured-badge" src="${badgeDisplaySrc}" alt="Featured Badge" ${badgeHoverAttributes} />` : ""}
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
  const equippedTitleId = viewedProfile?.equippedCosmetics?.title ?? null;
  const titleDefinition = equippedTitleId ? getCosmeticDefinition("title", equippedTitleId) : null;
  if (titleDefinition?.image) {
    return titleDefinition.image;
  }

  const title = getCosmeticDisplayName("title", equippedTitleId, viewedProfile?.title ?? "Initiate");
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

function safeStat(value) {
  return Math.max(0, Number(value ?? 0));
}

function renderStatList(items) {
  return `
    <div class="profile-stat-list">
      ${items
        .map(
          (item) => `
            <div class="profile-stat-row">
              <span class="profile-stat-label">${item.label}</span>
              <strong class="profile-stat-value">${item.value}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderModeStatsCard(title, stats = {}) {
  return `
    <section class="profile-mode-card stack-sm">
      <h4 class="section-title">${title}</h4>
      ${renderStatList([
        { label: "Games Played", value: safeStat(stats.gamesPlayed) },
        { label: "Wins / Losses", value: `${safeStat(stats.wins)} / ${safeStat(stats.losses)}` },
        { label: "Cards Captured", value: safeStat(stats.cardsCaptured) },
        { label: "WARs Entered / Won", value: `${safeStat(stats.warsEntered)} / ${safeStat(stats.warsWon)}` },
        { label: "Longest WAR", value: safeStat(stats.longestWar) }
      ])}
    </section>
  `;
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
    <section class="stack-sm xp-panel profile-summary-card">
      <h3 class="section-title">Progress</h3>
      <p><strong>Level ${level}</strong></p>
      <p>XP: ${displayedCurrentXp} / ${displayedRequiredXp}</p>
      ${nextRewardLine}
      <div class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <div class="xp-fill" data-target-width="${progress}" style="width: ${progress}%"></div>
      </div>
    </section>
  `;
}

function renderChestPanel(profile, visualState = {}, options = {}) {
  const basicChestCount = Math.max(0, Number(profile?.chests?.basic ?? 0) || 0);
  const milestoneChestCount = Math.max(0, Number(profile?.chests?.milestone ?? 0) || 0);
  const epicChestCount = Math.max(0, Number(profile?.chests?.epic ?? 0) || 0);
  const legendaryChestCount = Math.max(0, Number(profile?.chests?.legendary ?? 0) || 0);
  const openingInFlight = Boolean(options?.openingInFlight);
  const openingLabel = openingInFlight ? "Opening..." : null;
  const basicChestIcon = getAssetPath(
    visualState?.basicOpen ? "icons/basic_chest_open.png" : "icons/basic_chest.png"
  );
  const milestoneChestIcon = getAssetPath(
    visualState?.milestoneOpen ? "icons/loot_chest_open.png" : "icons/loot_chest.png"
  );
  const epicChestIcon = getAssetPath(
    visualState?.epicOpen ? "icons/epic_chest_open.png" : "icons/epic_chest.png"
  );
  const legendaryChestIcon = getAssetPath(
    visualState?.legendaryOpen ? "icons/legendary_chest_open.png" : "icons/legendary_chest.png"
  );
  const commonLabelClass = "cosmetic-rarity-label rarity-common";
  const rareLabelClass = "cosmetic-rarity-label rarity-rare";
  const epicLabelClass = "cosmetic-rarity-label rarity-epic";
  const legendaryLabelClass = "cosmetic-rarity-label rarity-legendary";

  return `
    <section class="stack-sm chest-panel profile-chest-panel">
      <h3 class="section-title">Reward Chests</h3>
      <div class="chest-row profile-chest-row" data-profile-chest-row="true">
        <div class="chest-slot" data-profile-chest-slot="basic">
          <button
            id="open-basic-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${basicChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Basic Chest"
          >
            <span class="chest-count-bubble" aria-label="Basic Chest count">${basicChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${basicChestIcon}" alt="Basic Chest" data-basic-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${commonLabelClass}" data-basic-chest-label="true">${openingLabel ?? (basicChestCount > 0 ? "Basic Chest" : "No Basic Chests available")}</p>
        </div>
        <div class="chest-slot" data-profile-chest-slot="milestone">
          <button
            id="open-milestone-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${milestoneChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Milestone Chest"
          >
            <span class="chest-count-bubble" aria-label="Milestone Chest count">${milestoneChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${milestoneChestIcon}" alt="Milestone Chest" data-milestone-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${rareLabelClass}" data-milestone-chest-label="true">${openingLabel ?? "Milestone Chest"}</p>
        </div>
        <div class="chest-slot" data-profile-chest-slot="epic">
          <button
            id="open-epic-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${epicChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Epic Chest"
          >
            <span class="chest-count-bubble" aria-label="Epic Chest count">${epicChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${epicChestIcon}" alt="Epic Chest" data-epic-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${epicLabelClass}" data-epic-chest-label="true">${openingLabel ?? "Epic Chest"}</p>
        </div>
        <div class="chest-slot" data-profile-chest-slot="legendary">
          <button
            id="open-legendary-chest-btn"
            class="chest-open-trigger"
            type="button"
            ${legendaryChestCount > 0 && !openingInFlight ? "" : "disabled aria-disabled=\"true\""}
            aria-label="Open Legendary Chest"
          >
            <span class="chest-count-bubble" aria-label="Legendary Chest count">${legendaryChestCount}</span>
            <img class="player-avatar chest-open-trigger__image" src="${legendaryChestIcon}" alt="Legendary Chest" data-legendary-chest-image="true" />
          </button>
          <p class="text-muted chest-open-helper ${legendaryLabelClass}" data-legendary-chest-label="true">${openingLabel ?? "Legendary Chest"}</p>
        </div>
      </div>
      <p class="text-muted chest-panel-helper">Click a chest image to open it.</p>
    </section>
  `;
}

function renderProfileIdentityHeader({ username, avatarId, avatarSrc, title, titleId, titleIcon, badgeId, badgeSrc }) {
  const avatarImageSrc = hasRenderablePreviewSource(avatarSrc, { previewName: username }) ? avatarSrc : null;
  const avatarHoverMetadata = getCosmeticHoverMetadata("avatar", avatarId, username);
  const avatarHoverAttributes = buildHoverPreviewAttributes({
    previewType: "avatar",
    previewSrc: avatarImageSrc,
    previewName: avatarHoverMetadata.name ?? username,
    previewRarity: avatarHoverMetadata.rarity
  });

  return `
    <div class="player-header">
      ${avatarImageSrc ? `<img class="player-avatar" src="${avatarImageSrc}" alt="${username}" ${avatarHoverAttributes} />` : ""}
      <div>
        <h3>${username}</h3>
        ${renderTitleLine(title, titleIcon, badgeSrc, { titleId, badgeId })}
      </div>
    </div>
  `;
}

function renderReadOnlyProfile(viewedProfile, options = {}) {
  if (!viewedProfile) {
    return "";
  }

  const achievementCatalog = buildAchievementCatalog(viewedProfile);
  const unlockedAchievements = achievementCatalog.filter((item) => item.unlocked);
  const unlockedAchievementCount = unlockedAchievements.length;
  const totalAchievementCount = achievementCatalog.length;
  const achievementsExpanded = Boolean(options.achievementsExpanded);
  const achievementToggleLabel = achievementsExpanded ? "Hide Achievements" : "Show Achievements";
  const avatar = getAvatarImage(viewedProfile.equippedCosmetics?.avatar);
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
  const featuredRivalWins = Math.max(0, Number(viewedProfile.featuredRivalWins ?? 0));
  const pveStats = viewedProfile.modeStats?.pve ?? {};
  const localPvpStats = viewedProfile.modeStats?.local_pvp ?? {};
  const onlinePvpStats = viewedProfile.modeStats?.online_pvp ?? {};
  const viewedBackgroundId =
    viewedProfile.equippedCosmetics?.background ??
    viewedProfile.cosmetics?.background ??
    "default_background";
  const viewedBackground = getArenaBackground(viewedBackgroundId);

  return `
    <section class="panel stack-sm viewed-profile-panel" style="background-image: url('${viewedBackground}')">
      <div class="viewed-profile-content">
        <h3 class="section-title">Viewed Profile</h3>
        ${renderProfileIdentityHeader({
          username: viewedProfile.username,
          avatarId: viewedProfile.equippedCosmetics?.avatar,
          avatarSrc: avatar,
          title,
          titleId: viewedProfile.equippedCosmetics?.title,
          titleIcon: viewedTitleIcon(viewedProfile),
          badgeId: viewedProfile.equippedCosmetics?.badge ?? "none",
          badgeSrc: featuredBadge
        })}
        <div class="profile-summary-grid profile-summary-grid-viewed">
          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Account Snapshot</h3>
            ${renderStatList([
              { label: "Level", value: level },
              { label: "XP", value: xp },
              { label: "Tokens", value: tokens }
            ])}
          </section>
          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Overall Record</h3>
            ${renderStatList([
              { label: "Wins", value: wins },
              { label: "Losses", value: losses },
              { label: "Games Played", value: gamesPlayed },
              { label: "Best Win Streak", value: bestWinStreak }
            ])}
          </section>
          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Battle Stats</h3>
            ${renderStatList([
              { label: "Cards Captured", value: cardsCaptured },
              { label: "WARs Entered", value: warsEntered },
              { label: "WARs Won", value: warsWon },
              { label: "Longest WAR", value: longestWar }
            ])}
          </section>
          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Featured Rival</h3>
            ${renderStatList([{ label: "Featured Rival Wins", value: featuredRivalWins }])}
          </section>
        </div>
        <section class="profile-summary-card stack-sm">
          <h3 class="section-title">Mode Stats</h3>
          <div class="profile-mode-grid">
            ${renderModeStatsCard("PvE", pveStats)}
            ${renderModeStatsCard("Local PvP", localPvpStats)}
            ${renderModeStatsCard("Online PvP", onlinePvpStats)}
          </div>
        </section>
        <div class="section-heading-row profile-achievements-heading">
          <h3 class="section-title">Achievements (${unlockedAchievementCount}/${totalAchievementCount})</h3>
          <button id="viewed-profile-achievements-toggle-btn" class="btn btn-secondary" type="button">${achievementToggleLabel}</button>
        </div>
        ${
          achievementsExpanded
            ? `<div class="achievement-grid achievement-grid-profile">
                ${
                  unlockedAchievements.length > 0
                    ? unlockedAchievements.map(renderAchievement).join("")
                    : "<p>No unlocked achievements yet.</p>"
                }
              </div>`
            : ""
        }
      </div>
    </section>
  `;
}

export const profileScreen = {
  render(context) {
    const profile = context.profile;
    const achievementCatalog = Array.isArray(context.achievementCatalog)
      ? context.achievementCatalog
      : buildAchievementCatalog(profile);
    const unlockedAchievements = achievementCatalog.filter((item) => item.unlocked);
    const unlockedAchievementCount = unlockedAchievements.length;
    const totalAchievementCount = achievementCatalog.length;
    const profileAchievementsExpanded = Boolean(context.profileAchievementsExpanded);
    const viewedProfileAchievementsExpanded = Boolean(context.viewedProfileAchievementsExpanded);
    const searchResults = context.searchResults ?? [];
    const cosmetics = context.cosmetics;
    const onlinePvpStats = profile.modeStats?.online_pvp ?? {};

    const playerAvatar = getAvatarImage(profile.equippedCosmetics?.avatar);
    const profileTitleIcon = getTitleCatalogIcon(cosmetics, profile.equippedCosmetics?.title);
    const equippedTitle = getCosmeticDisplayName(
      "title",
      profile.equippedCosmetics?.title,
      profile.title ?? "Initiate"
    );

    return `
      <section class="screen screen-profile">
        <div class="screen-topbar">
          <h2 class="view-title">Profile</h2>
          <button id="profile-back-btn" class="btn screen-back-btn">Back</button>
        </div>
        <section class="arena-board screen-themed-surface" style="background-image: url('${context.backgroundImage}')">
          <div class="panel themed-screen-panel">
          ${renderProfileIdentityHeader({
            username: profile.username,
            avatarId: profile.equippedCosmetics?.avatar,
            avatarSrc: playerAvatar,
            title: equippedTitle,
            titleId: profile.equippedCosmetics?.title ?? profile.title,
            titleIcon: profileTitleIcon,
            badgeId: profile.equippedCosmetics?.badge ?? "none",
            badgeSrc: getBadgeImage(profile.equippedCosmetics?.badge ?? "none")
          })}
          <div class="profile-summary-grid">
            ${renderXpProgress(profile)}
            <section class="profile-summary-card stack-sm">
              <h3 class="section-title">Currency & Chests</h3>
              ${renderStatList([
                { label: "Tokens", value: profile.tokens ?? 0 },
                { label: "Founder / Supporter", value: profile.supporterPass ? "Active" : "Not Active" }
              ])}
              ${renderChestPanel(profile, context.basicChestVisualState, {
                openingInFlight: context.profileChestOpenInFlight
              })}
            </section>
            <section class="profile-summary-card stack-sm">
              <h3 class="section-title">Overall Record</h3>
              ${renderStatList([
                { label: "Wins", value: profile.wins ?? 0 },
                { label: "Losses", value: profile.losses ?? 0 },
                { label: "Games Played", value: profile.gamesPlayed ?? 0 },
                { label: "Best Win Streak", value: profile.bestWinStreak ?? 0 }
              ])}
            </section>
            <section class="profile-summary-card stack-sm">
              <h3 class="section-title">Battle Stats</h3>
              ${renderStatList([
                { label: "Cards Captured", value: profile.cardsCaptured ?? 0 },
                { label: "WARs Entered", value: profile.warsEntered ?? 0 },
                { label: "WARs Won", value: profile.warsWon ?? 0 },
                { label: "Longest WAR", value: profile.longestWar ?? 0 }
              ])}
            </section>
            <section class="profile-summary-card stack-sm">
              <h3 class="section-title">Featured Rival</h3>
              ${renderStatList([
                { label: "Featured Rival Wins", value: profile.featuredRivalWins ?? 0 }
              ])}
            </section>
          </div>

          <section class="profile-summary-card stack-sm">
            <h3 class="section-title">Mode Stats</h3>
            <div class="profile-mode-grid">
              ${renderModeStatsCard("PvE", profile.modeStats?.pve ?? {})}
              ${renderModeStatsCard("Local PvP", profile.modeStats?.local_pvp ?? {})}
              ${renderModeStatsCard("Online PvP", onlinePvpStats)}
            </div>
          </section>

          <div class="section-heading-row profile-achievements-heading">
            <h3 class="section-title">Achievements (${unlockedAchievementCount}/${totalAchievementCount})</h3>
            <button id="profile-achievements-toggle-btn" class="btn btn-secondary" type="button">${profileAchievementsExpanded ? "Hide Achievements" : "Show Achievements"}</button>
          </div>
          ${
            profileAchievementsExpanded
              ? `<div class="achievement-grid achievement-grid-profile">
                  ${
                    unlockedAchievements.length > 0
                      ? unlockedAchievements.map(renderAchievement).join("")
                      : "<p>No achievements unlocked yet.</p>"
                  }
                </div>`
              : ""
          }

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

          ${renderReadOnlyProfile(context.viewedProfile, {
            achievementsExpanded: viewedProfileAchievementsExpanded
          })}
          ${context.viewedProfile ? '<button id="clear-viewed-profile-btn" class="btn">Close Viewed Profile</button>' : ""}

          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    bindCosmeticHoverPreview({
      root: (typeof document.querySelector === "function" ? document.querySelector(".screen-profile") : null) ?? document,
      documentRef: document
    });

    document.getElementById("profile-back-btn").addEventListener("click", context.actions.back);
    const profileAchievementsToggle = document.getElementById("profile-achievements-toggle-btn");
    if (profileAchievementsToggle && context.actions.toggleProfileAchievements) {
      profileAchievementsToggle.addEventListener("click", context.actions.toggleProfileAchievements);
    }
    const openBasicChestButton = document.getElementById("open-basic-chest-btn");
    if (openBasicChestButton && context.actions.openBasicChest) {
      openBasicChestButton.addEventListener("click", context.actions.openBasicChest);
    }
    const openMilestoneChestButton = document.getElementById("open-milestone-chest-btn");
    if (openMilestoneChestButton && context.actions.openMilestoneChest) {
      openMilestoneChestButton.addEventListener("click", context.actions.openMilestoneChest);
    }
    const openEpicChestButton = document.getElementById("open-epic-chest-btn");
    if (openEpicChestButton && context.actions.openEpicChest) {
      openEpicChestButton.addEventListener("click", context.actions.openEpicChest);
    }
    const openLegendaryChestButton = document.getElementById("open-legendary-chest-btn");
    if (openLegendaryChestButton && context.actions.openLegendaryChest) {
      openLegendaryChestButton.addEventListener("click", context.actions.openLegendaryChest);
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

    const viewedAchievementsToggle = document.getElementById("viewed-profile-achievements-toggle-btn");
    if (viewedAchievementsToggle && context.actions.toggleViewedProfileAchievements) {
      viewedAchievementsToggle.addEventListener("click", context.actions.toggleViewedProfileAchievements);
    }
  }
};










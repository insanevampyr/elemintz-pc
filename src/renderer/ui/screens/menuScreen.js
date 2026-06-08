import { getAssetPath } from "../../utils/dom.js";
import { renderDailyElementChestMiniCard } from "./dailyElementChestScreen.js";
import { buildThemedSurfaceClassName } from "../shared/themedSurfaceShared.js";

const MENU_TILE_IMAGE_MAP = Object.freeze({
  "start-pve-btn": "menu_tiles/tile_play_ai.png",
  "start-local-btn": "menu_tiles/tile_local_pvp.png",
  "online-play-btn": "menu_tiles/tile_local_pvp.png",
  "profile-btn": "menu_tiles/tile_profile.png",
  "cosmetics-btn": "menu_tiles/tile_cosmetics.png",
  "store-btn": "menu_tiles/tile_store.png",
  "achievements-btn": "menu_tiles/tile_achievements.png",
  "roadmap-btn": "menu_tiles/tile_roadmap.png",
  "settings-btn": "menu_tiles/tile_settings.png",
  "how-to-play-btn": "menu_tiles/tile_how_to_play.png",
  "feedback-btn": "menu_tiles/tile_feedback.png",
  "logout-btn": "menu_tiles/tile_logout.png"
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

function isFeaturedRivalChallenge(challenge) {
  return /^daily_defeat_featured_rival_|^weekly_defeat_featured_rival_/.test(
    String(challenge?.id ?? "").trim()
  );
}

function getSafeGoal(challenge) {
  return Math.max(1, Number(challenge?.goal ?? 1) || 1);
}

function getSafeProgress(challenge) {
  return Math.max(0, Number(challenge?.progress ?? 0) || 0);
}

function comparePreviewChallenges(left, right) {
  const leftCompleted = left?.completed ? 1 : 0;
  const rightCompleted = right?.completed ? 1 : 0;
  if (leftCompleted !== rightCompleted) {
    return leftCompleted - rightCompleted;
  }

  const leftFeatured = isFeaturedRivalChallenge(left) ? 1 : 0;
  const rightFeatured = isFeaturedRivalChallenge(right) ? 1 : 0;
  if (leftFeatured !== rightFeatured) {
    return rightFeatured - leftFeatured;
  }

  const leftBonus = left?.isBonus ? 1 : 0;
  const rightBonus = right?.isBonus ? 1 : 0;
  if (leftBonus !== rightBonus) {
    return rightBonus - leftBonus;
  }

  const leftRatio = Math.min(1, getSafeProgress(left) / getSafeGoal(left));
  const rightRatio = Math.min(1, getSafeProgress(right) / getSafeGoal(right));
  if (leftRatio !== rightRatio) {
    return rightRatio - leftRatio;
  }

  const leftProgress = getSafeProgress(left);
  const rightProgress = getSafeProgress(right);
  if (leftProgress !== rightProgress) {
    return rightProgress - leftProgress;
  }

  return (left?._previewIndex ?? 0) - (right?._previewIndex ?? 0);
}

function getPreviewChallenges(bucket, limit = 3) {
  const challenges = bucket?.challenges ?? [];
  return challenges
    .map((item, index) => ({ ...item, _previewIndex: index }))
    .sort(comparePreviewChallenges)
    .slice(0, limit)
    .map(({ _previewIndex, ...item }) => item);
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
    return '<p class="muted">Daily Login Streak status unavailable.</p>';
  }

  return `
    <div class="menu-daily-login">
      <p><strong id="menu-daily-login-status">${escapeHtml(status.stateLabel ?? "")}</strong></p>
      ${
        status.detailLabel
          ? `<p class="muted" id="menu-daily-login-detail">${escapeHtml(status.detailLabel)}</p>`
          : ""
      }
    </div>
  `;
}

function renderMenuAnnouncementCard(announcement) {
  if (!announcement) {
    return "";
  }

  const type = String(announcement.type ?? "").trim();
  return `
    <section class="menu-announcement-card" data-menu-announcement-card="true">
      <div class="menu-announcement-card__header">
        <span class="menu-announcement-card__label">Announcement</span>
        ${type ? `<span class="menu-announcement-card__type">${escapeHtml(type)}</span>` : ""}
      </div>
      <div class="stack-xs menu-announcement-card__content">
        <h3 class="section-title menu-announcement-card__title">${escapeHtml(announcement.title)}</h3>
        <div class="menu-announcement-card__message-group">
          ${renderEscapedAnnouncementMessage(announcement.message)}
        </div>
      </div>
      ${
        announcement.dismissible !== false
          ? `<div class="menu-announcement-card__actions">
              <button
                id="dismiss-announcement-btn"
                class="btn btn-secondary"
                type="button"
                data-announcement-id="${escapeHtml(announcement.id)}"
              >
                Dismiss
              </button>
            </div>`
          : ""
      }
    </section>
  `;
}

function formatBoostScopeLabel(scope) {
  const safeScope = String(scope ?? "").trim().toLowerCase();
  switch (safeScope) {
    case "online":
      return "Online Play";
    case "pve":
      return "PvE";
    case "local_pvp":
      return "Local 2-Player";
    case "all":
      return "All Eligible Modes";
    case "custom":
      return "Custom Targets";
    default:
      return "Eligible Modes";
  }
}

function renderBoostDetailLine(label, value) {
  return `
    <div class="menu-boost-card__detail-line">
      <span class="menu-boost-card__detail-label">${label}</span>
      <strong class="menu-boost-card__detail-value">${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderEscapedParagraphBlock(value, className) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p class="${className}">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderEscapedAnnouncementMessage(value) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const bulletLines = lines.filter((line) => /^[•*-]\s+/.test(line));

      if (lines.length > 0 && bulletLines.length === lines.length) {
        const items = lines
          .map((line) => line.replace(/^[•*-]\s+/, ""))
          .map((line) => `<li class="menu-announcement-card__list-item">${escapeHtml(line)}</li>`)
          .join("");
        return `<ul class="menu-announcement-card__list">${items}</ul>`;
      }

       if (
        lines.length > 1 &&
        !/^[•*-]\s+/.test(lines[0]) &&
        lines.slice(1).every((line) => /^[•*-]\s+/.test(line))
      ) {
        const intro = `<p class="menu-announcement-card__message">${escapeHtml(lines[0])}</p>`;
        const items = lines
          .slice(1)
          .map((line) => line.replace(/^[•*-]\s+/, ""))
          .map((line) => `<li class="menu-announcement-card__list-item">${escapeHtml(line)}</li>`)
          .join("");
        return `${intro}<ul class="menu-announcement-card__list">${items}</ul>`;
      }

      return `<p class="menu-announcement-card__message">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

function renderMenuBoostEventCard(boostEvent) {
  if (!boostEvent) {
    return "";
  }

  const xpMultiplier = Number(boostEvent.xpMultiplier ?? 1);
  const tokenMultiplier = Number(boostEvent.tokenMultiplier ?? 1);
  const targetSummary = String(boostEvent.targetSummary ?? "").trim();
  const detailLines = [
    renderBoostDetailLine(
      targetSummary ? "Targets" : "Scope",
      targetSummary || formatBoostScopeLabel(boostEvent.scope)
    )
  ];

  if (xpMultiplier > 1) {
    detailLines.push(renderBoostDetailLine("XP Boost", `${xpMultiplier}x`));
  }

  if (tokenMultiplier > 1) {
    detailLines.push(renderBoostDetailLine("Token Boost", `${tokenMultiplier}x`));
  }

  if (boostEvent.endsAtLabel) {
    detailLines.push(renderBoostDetailLine("Ends", boostEvent.endsAtLabel));
  }

  return `
    <section class="menu-boost-card" data-menu-boost-card="true">
      <div class="menu-boost-card__header">
        <span class="menu-boost-card__label">BOOST EVENT</span>
      </div>
      <div class="stack-xs">
        <h3 class="section-title menu-boost-card__title">${escapeHtml(boostEvent.title)}</h3>
        <div class="menu-boost-card__message-group">
          ${renderEscapedParagraphBlock(boostEvent.message, "menu-boost-card__message")}
        </div>
      </div>
      <div class="menu-boost-card__details">
        ${detailLines.join("")}
      </div>
    </section>
  `;
}

export const menuScreen = {
  render(context) {
    return `
      <section class="screen screen-menu">
        <section class="${buildThemedSurfaceClassName({ backgroundImage: context.backgroundImage ?? "" })}" style="background-image: url('${context.backgroundImage}')">
          <div class="panel themed-screen-panel">
            <h2 class="view-title">Main Menu</h2>
            <p>Signed in as <strong>${context.username}</strong></p>
            <div class="grid two-col">
              <div class="grid two-col menu-action-grid">
                ${renderMenuTile("how-to-play-btn", "How to Play")}
                ${renderMenuTile("start-pve-btn", "Play vs AI")}
                ${renderMenuTile("start-local-btn", "Local 2-Player")}
                ${renderMenuTile("online-play-btn", "Online Play")}
                ${renderMenuTile("profile-btn", "Profile")}
                ${renderMenuTile("cosmetics-btn", "Cosmetics")}
                ${renderMenuTile("store-btn", "Store")}
                ${renderMenuTile("achievements-btn", "Achievements")}
                ${renderMenuTile("roadmap-btn", "Roadmap")}
                ${renderMenuTile("settings-btn", "Settings")}
                ${renderMenuTile("feedback-btn", "Feedback")}
                ${renderMenuTile("logout-btn", "Logout")}
              </div>
              <aside class="panel stack-sm daily-panel">
                ${renderMenuAnnouncementCard(context.announcement)}
                ${renderMenuBoostEventCard(context.boostEvent)}
                <div data-menu-daily-login-panel="true">
                  ${renderMenuDailyLoginStatus(context.dailyChallenges?.dailyLogin)}
                </div>
                <div data-menu-daily-element-chest-panel="true">
                  ${renderDailyElementChestMiniCard(context.dailyElementChest)}
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
    document.getElementById("roadmap-btn").addEventListener("click", context.actions.openRoadmap);
    document.getElementById("settings-btn").addEventListener("click", context.actions.openSettings);
    document.getElementById("how-to-play-btn").addEventListener("click", context.actions.openHowToPlay);
    document.getElementById("feedback-btn").addEventListener("click", context.actions.openFeedback);
    document.getElementById("logout-btn").addEventListener("click", context.actions.logout);
    document
      .getElementById("open-daily-element-chest-btn")
      ?.addEventListener("click", context.actions.openDailyElementChest);
    const dismissAnnouncementButton = document.getElementById("dismiss-announcement-btn");
    if (dismissAnnouncementButton) {
      dismissAnnouncementButton.addEventListener("click", () =>
        context.actions.dismissAnnouncement(dismissAnnouncementButton.dataset.announcementId)
      );
    }
  }
};

import {
  escapeHtml,
  getAssetPath,
  getAvatarImage,
  getBadgeImage,
  getCardImage,
  getCardBackImage,
  getVariantCardImages
} from "../../utils/index.js";
import { getCosmeticDisplayName } from "../../../state/cosmeticSystem.js";

const BLOOD_MATCH_ARENA_PATH = "rivals/BloodMatch/background_blood_match_arena.png";
const BLOOD_MATCH_MENU_TILE_PATH = "menu_tiles/tile_blood_match_mode.png";
const ELEMENT_ORDER = Object.freeze(["fire", "earth", "wind", "water"]);
let detachBloodMatchKeyboardHandler = null;
const RIVAL_COSMETIC_RACKS = Object.freeze({
  vampire: Object.freeze({
    cardBack: "cardback_blood_gem",
    variants: Object.freeze({
      fire: "fire_variant_flame_wings",
      earth: "earth_variant_stone_graves",
      wind: "wind_variant_wings_wind",
      water: "water_variant_blood_wings"
    })
  }),
  lycan: Object.freeze({
    cardBack: "cardback_lycan_pack",
    variants: Object.freeze({
      fire: "fire_variant_fire_paw",
      earth: "earth_variant_stone_paw",
      wind: "wind_variant_lycan_duo",
      water: "water_variant_water_wolf"
    })
  })
});

function formatClock(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = String(Math.floor(safe / 60)).padStart(2, "0");
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatElementLabel(element) {
  const value = String(element ?? "").trim().toLowerCase();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Unknown";
}

function isEditableShortcutTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = String(target.tagName ?? "").trim().toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(target.isContentEditable) ||
    Boolean(target.closest?.("[contenteditable='true']"))
  );
}

function getCombatant(state, id) {
  return state?.combatants?.[id] ?? { id, name: id, hand: [], capturedCards: [], recentMoves: [] };
}

function getPanelState(state, id) {
  const combatant = getCombatant(state, id);
  const war = state?.war ?? {};
  const warActive = Boolean(war.active);
  const activeInWar = Array.isArray(war.activeCombatantIds) && war.activeCombatantIds.includes(id);
  const eliminated = Boolean(combatant.eliminated);
  const lastResult = state?.lastResult ?? null;
  const excluded = Array.isArray(lastResult?.excludedCombatantIds) && lastResult.excludedCombatantIds.includes(id);
  const returned = Array.isArray(lastResult?.returnedCardEntries) && lastResult.returnedCardEntries.some((entry) => entry.ownerId === id);
  return {
    combatant,
    eliminated,
    activeInWar,
    excluded,
    returned,
    className: [
      "blood-match-combatant",
      `blood-match-combatant--${id}`,
      eliminated ? "is-eliminated" : "",
      warActive && activeInWar ? "is-war-active" : "",
      excluded ? "is-war-excluded" : "",
      returned ? "is-card-returned" : ""
    ].filter(Boolean).join(" ")
  };
}

function getEquippedCosmetics(state) {
  return state?.equippedCosmetics ?? state?.profile?.equippedCosmetics ?? state?.cosmetics?.equipped ?? {};
}

function resolvePlayerIdentity(state) {
  const equipped = getEquippedCosmetics(state);
  const avatarId = String(equipped?.avatar ?? "default_avatar").trim() || "default_avatar";
  const titleId = String(equipped?.title ?? "").trim();
  const badgeId = String(equipped?.badge ?? "").trim();
  const fallbackTitle = String(state?.profile?.title ?? state?.title ?? "Initiate").trim() || "Initiate";

  return {
    avatarSrc: getAvatarImage(avatarId),
    title: titleId ? getCosmeticDisplayName("title", titleId, fallbackTitle) ?? fallbackTitle : fallbackTitle,
    badgeSrc: badgeId ? getBadgeImage(badgeId) : null,
    badgeAlt: badgeId ? getCosmeticDisplayName("badge", badgeId, "Equipped badge") ?? "Equipped badge" : null
  };
}

function getCombatantStatusLabel(state, id, panel) {
  const terminal = state?.terminalResult ?? null;
  if (state?.status === "completed" && terminal) {
    if (id === "player") {
      return terminal.result === "player_win" ? "Victor" : "Defeated";
    }
    if (panel.eliminated) {
      return "Eliminated";
    }
    if (terminal.winnerId === id) {
      return "Victor";
    }
    return terminal.result === "player_loss" ? "Survived" : "Match Complete";
  }

  if (panel.eliminated) {
    return "Eliminated";
  }
  if (panel.returned) {
    return "Card Returned";
  }
  if (panel.excluded) {
    return "Out of this WAR";
  }
  if (panel.activeInWar) {
    return "Active WAR";
  }
  return "In Match";
}

function renderCombatantPanel(state, id, { role, title, avatarPath, avatarSrc = null, badgeSrc = null, badgeAlt = null, className = "" }) {
  const panel = getPanelState(state, id);
  const handCount = Array.isArray(panel.combatant.hand) ? panel.combatant.hand.length : 0;
  const capturedCount = Array.isArray(panel.combatant.capturedCards) ? panel.combatant.capturedCards.length : 0;
  const recent = Array.isArray(panel.combatant.recentMoves) ? panel.combatant.recentMoves : [];
  const fatigued = recent.length >= 2 && recent.at(-1) === recent.at(-2) ? recent.at(-1) : null;
  const stateLabel = getCombatantStatusLabel(state, id, panel);
  const resolvedAvatarSrc = avatarSrc ?? getAssetPath(avatarPath);

  return `
    <section class="${panel.className} ${className}" data-blood-combatant="${id}">
      <div class="blood-match-combatant__identity">
        <img class="blood-match-combatant__avatar" src="${resolvedAvatarSrc}" alt="${escapeHtml(panel.combatant.name)} avatar" />
        <div>
          <p class="blood-match-combatant__role">${escapeHtml(role)}</p>
          <h3>${escapeHtml(panel.combatant.name)}</h3>
          <p class="muted">${escapeHtml(title)}</p>
        </div>
        ${badgeSrc ? `<img class="blood-match-combatant__badge" src="${badgeSrc}" alt="${escapeHtml(badgeAlt ?? "Equipped badge")}" />` : ""}
      </div>
      <div class="blood-match-combatant__stats">
        <span>Hand: <strong>${handCount}</strong></span>
        <span>Captured: <strong>${capturedCount}</strong></span>
        <span>Status: <strong>${escapeHtml(stateLabel)}</strong></span>
        ${id === "player" && fatigued ? `<span>Fatigue: <strong>${formatElementLabel(fatigued)}</strong></span>` : ""}
      </div>
    </section>
  `;
}

function renderRivalCosmeticRack(id) {
  const rack = RIVAL_COSMETIC_RACKS[id] ?? RIVAL_COSMETIC_RACKS.vampire;
  const label = id === "vampire" ? "Countess" : "Ravena";
  const variantMap = getVariantCardImages(rack.variants);
  return `
    <div class="blood-match-rival-rack" data-blood-rival-rack="${id}" aria-label="${label} cosmetic card rack">
      <div class="blood-match-rival-rack__back">
        <img src="${getCardBackImage(rack.cardBack)}" alt="${label} card back" />
        <span>Card Back</span>
      </div>
      <div class="blood-match-rival-rack__variants">
        ${ELEMENT_ORDER.map((element) => `
          <div class="blood-match-rival-rack__variant" data-blood-rival-rack-element="${element}">
            <img src="${getCardImage(element, variantMap)}" alt="${formatElementLabel(element)} rival card art" />
            <span>${formatElementLabel(element)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCountessStrip(state) {
  return `
    <section class="blood-match-countess-strip" data-blood-countess-strip="true">
      ${renderCombatantPanel(state, "vampire", {
        role: "Vampire Rival",
        title: "Blood Court Duelist",
        avatarPath: "gauntlet/avatars/avatar_gauntlet_vampire_rival.png",
        className: "blood-match-combatant--strip"
      })}
      ${renderRivalCosmeticRack("vampire")}
    </section>
  `;
}

function renderRavenaColumn(state) {
  return `
    <section class="blood-match-board-column blood-match-board-column--ravena" data-blood-ravena-column="true">
      ${renderCombatantPanel(state, "lycan", {
        role: "Lycan Rival",
        title: "Moon-Rage Huntress",
        avatarPath: "gauntlet/avatars/avatar_gauntlet_lycan_rival.png"
      })}
      ${renderRivalCosmeticRack("lycan")}
    </section>
  `;
}

function renderCardSlot(entry, state, { showEmpty = true } = {}) {
  if (!entry) {
    if (!showEmpty) {
      return "";
    }
    return `
      <div class="blood-match-card-slot is-empty" data-blood-card-slot="true">
        <span>Awaiting Card</span>
      </div>
    `;
  }

  const owner = getCombatant(state, entry.ownerId);
  return `
    <div class="blood-match-card-slot" data-blood-card-slot="true" data-owner-id="${escapeHtml(entry.ownerId)}">
      <img src="${getCardImage(entry.element)}" alt="${formatElementLabel(entry.element)} card" />
      <span>${escapeHtml(owner.name)} · ${formatElementLabel(entry.element)}</span>
    </div>
  `;
}

function getResultHeadline(state) {
  const terminal = state?.terminalResult ?? null;
  if (terminal) {
    if (terminal.result === "player_win") {
      return "Blood Match Victory";
    }
    return "Blood Match Defeat";
  }

  const result = state?.lastResult ?? null;
  if (!result) {
    return "Choose your Elemint";
  }

  if (result.type === "clear_winner" || result.type === "war_resolved") {
    return `${getCombatant(state, result.winnerId).name} wins the clash`;
  }
  if (result.type === "three_way_war") {
    return "Three-Way WAR";
  }
  if (result.type === "two_way_war_defeated_third") {
    return "Two-Way WAR · Third defeated";
  }
  if (result.type === "two_way_war_neutral_third") {
    return "Two-Way WAR · Card Returned";
  }
  if (result.type === "war_continues" || result.type === "two_way_war") {
    return "WAR Continues";
  }
  if (result.type === "ai_eliminated_continue") {
    return "Rival Eliminated";
  }
  return "Blood Match Clash";
}

function getEndReasonLabel(reason) {
  const normalized = String(reason ?? "").trim();
  const labels = {
    both_rivals_eliminated: "Both rivals were eliminated.",
    all_ai_required_play_unavailable: "Both rivals were eliminated.",
    player_required_play_failed: "You had no card available to continue.",
    player_required_play_unavailable: "You had no card available to continue.",
    vampire_required_play_failed: "Countess Veyra was eliminated.",
    lycan_required_play_failed: "Ravena Moonfang was eliminated.",
    ai_required_play_unavailable: "A rival had no card available to continue.",
    timeout_lead: "You led every surviving rival when time expired.",
    timeout_tie_or_deficit: "You did not lead every surviving rival when time expired.",
    quit_forfeit: "You forfeited the Blood Match."
  };
  return labels[normalized] ?? "The Blood Match is complete.";
}

function getChestLabel(chestType) {
  const normalized = String(chestType ?? "basic").trim().toLowerCase();
  const labels = {
    basic: "Basic Chest",
    milestone: "Milestone Chest",
    epic: "Epic Chest",
    legendary: "Legendary Chest"
  };
  return labels[normalized] ?? "Chest";
}

function groupPotEntries(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    const ownerId = String(entry?.ownerId ?? "").trim();
    const element = String(entry?.element ?? "").trim().toLowerCase();
    if (!ownerId || !element) {
      continue;
    }
    const key = `${ownerId}:${element}`;
    const existing = groups.get(key) ?? { ownerId, element, count: 0 };
    existing.count += 1;
    groups.set(key, existing);
  }
  return [...groups.values()];
}

function getOwnerVariantMap(state, ownerId) {
  if (ownerId === "player") {
    return getVariantCardImages(
      getEquippedCosmetics(state)?.elementCardVariant ??
        state?.equippedCardVariants ??
        null
    );
  }
  const rack = RIVAL_COSMETIC_RACKS[ownerId] ?? null;
  return getVariantCardImages(rack?.variants ?? null);
}

function getShortOwnerLabel(ownerId, ownerName) {
  if (ownerId === "vampire") {
    return "Countess";
  }
  if (ownerId === "lycan") {
    return "Ravena";
  }
  return ownerName;
}

function renderWarPile(state) {
  const potEntries = Array.isArray(state?.potCardEntries) ? state.potCardEntries : [];
  const active = potEntries.length > 0;
  const groups = groupPotEntries(potEntries);
  return `
    <section class="blood-match-war-pile ${active ? "is-active" : "is-inactive"}" data-blood-war-pile="true">
      <div class="blood-match-war-pile__header">
        <p class="blood-match-eyebrow">WAR Pile</p>
        <span>Total Committed: <strong>${potEntries.length}</strong></span>
      </div>
      ${active
        ? `<div class="blood-match-war-pile__cards">
            ${groups.map((entry) => {
              const owner = getCombatant(state, entry.ownerId);
              const ownerLabel = getShortOwnerLabel(entry.ownerId, owner.name);
              const image = getCardImage(entry.element, getOwnerVariantMap(state, entry.ownerId));
              const elementLabel = formatElementLabel(entry.element);
              return `
                <div
                  class="blood-match-war-pile__mini-card blood-match-war-pile__mini-card--${escapeHtml(entry.ownerId)}"
                  data-blood-war-pile-mini-card="true"
                  data-owner-id="${escapeHtml(entry.ownerId)}"
                  data-element="${escapeHtml(entry.element)}"
                  aria-label="${escapeHtml(owner.name)} ${elementLabel}, ${entry.count} committed"
                >
                  <span class="blood-match-war-pile__owner-strip" aria-hidden="true"></span>
                  <span class="blood-match-war-pile__image-wrap">
                    <img src="${image}" alt="${escapeHtml(owner.name)} ${elementLabel} committed card" />
                    <span class="blood-match-war-pile__count" aria-hidden="true">×${entry.count}</span>
                  </span>
                  <span class="blood-match-war-pile__owner">${escapeHtml(ownerLabel)}</span>
                  <span class="blood-match-war-pile__element">${elementLabel}</span>
                </div>
              `;
            }).join("")}
          </div>`
        : '<p class="muted blood-match-war-pile__empty">No cards committed to WAR yet.</p>'}
    </section>
  `;
}

function renderTerminalResultPanel(state) {
  if (state?.status !== "completed") {
    return "";
  }
  const terminal = state?.terminalResult ?? {};
  const settlement = state?.settlementResult ?? null;
  const won = terminal.result === "player_win";
  const headline = won ? "Blood Match Victory" : "Blood Match Defeat";
  const reason = getEndReasonLabel(terminal.endReason ?? terminal.reason ?? state?.endReason);

  let settlementBody = "";
  if (settlement?.status === "settled") {
    const chestGrants = Array.isArray(settlement.chestGrants) ? settlement.chestGrants : [];
    const achievements = Array.isArray(settlement.unlockedAchievements) ? settlement.unlockedAchievements : [];
    settlementBody = `
      <div class="blood-match-terminal-result__rewards">
        <span>XP Gained: <strong>${Math.max(0, Number(settlement.matchXpDelta ?? 0) || 0)}</strong></span>
        <span>Tokens Gained: <strong>${Math.max(0, Number(settlement.matchTokenDelta ?? 0) || 0)}</strong></span>
        <span>Chest: <strong>${
          chestGrants.length > 0
            ? chestGrants.map((grant) => `${getChestLabel(grant.chestType)} ×${grant.amount}`).join(", ")
            : "No chest earned"
        }</strong></span>
      </div>
      <div class="blood-match-terminal-result__achievements">
        <strong>New Achievements:</strong>
        ${
          achievements.length > 0
            ? `<ul>${achievements.map((achievement) => `<li>${escapeHtml(achievement.name || achievement.id)}</li>`).join("")}</ul>`
            : "<span>None</span>"
        }
      </div>
      ${settlement.duplicate ? '<p class="muted">Settlement already completed; no duplicate rewards were applied.</p>' : ""}
    `;
  } else if (settlement?.status === "error") {
    settlementBody = `<p class="blood-match-terminal-result__warning">Settlement could not be confirmed: ${escapeHtml(settlement.message ?? "Unknown error")}</p>`;
  } else {
    settlementBody = '<p class="muted">Finalizing settlement results...</p>';
  }

  return `
    <section class="blood-match-terminal-result" data-blood-terminal-result="true">
      <p class="blood-match-eyebrow">Settlement Result</p>
      <h2>${headline}</h2>
      <p>Reason: <strong>${escapeHtml(reason)}</strong></p>
      ${settlementBody}
    </section>
  `;
}

function renderCenterClash(state) {
  const lastResult = state?.lastResult ?? null;
  const revealed = Array.isArray(lastResult?.revealedCardEntries) ? lastResult.revealedCardEntries : [];
  const terminal = state?.status === "completed";
  const slots = ["vampire", "player", "lycan"]
    .map((id) => renderCardSlot(revealed.find((entry) => entry.ownerId === id), state, { showEmpty: !terminal }))
    .filter(Boolean);
  const activeWarNames = Array.isArray(state?.war?.activeCombatantIds)
    ? state.war.activeCombatantIds.map((id) => getCombatant(state, id).name)
    : [];

  return `
    <section class="blood-match-center-column" data-blood-center-column="true">
      <section class="blood-match-clash-zone" data-blood-clash-zone="true">
        <p class="blood-match-eyebrow">Shared Clash Zone</p>
        <h2>${escapeHtml(getResultHeadline(state))}</h2>
        ${slots.length > 0
          ? `<div class="blood-match-card-row">
              ${slots.join("")}
            </div>`
          : '<p class="muted blood-match-clash-zone__terminal-note">Final clash complete.</p>'}
        <div class="blood-match-clash-status">
          ${terminal
            ? `<span>State: <strong>Match Complete</strong></span>
               <span>Match: <strong>${formatClock(state?.totalMatchSeconds)}</strong></span>`
            : `<span>WAR: <strong>${state?.war?.active ? activeWarNames.join(" vs ") : "Inactive"}</strong></span>
               <span>Turn: <strong>${state?.timerSeconds ?? 0}s</strong></span>
               <span>Match: <strong>${formatClock(state?.totalMatchSeconds)}</strong></span>`}
        </div>
      </section>
      ${renderWarPile(state)}
    </section>
  `;
}

function renderPlayerHand(state) {
  const player = getCombatant(state, "player");
  const legalCards = Array.isArray(state?.legalPlayableCards?.player) ? state.legalPlayableCards.player : [];
  if (state?.status !== "active") {
    return '<p class="muted">Match complete.</p>';
  }
  const equippedVariants = getVariantCardImages(
    state?.equippedCosmetics?.elementCardVariant ??
      state?.equippedCardVariants ??
      state?.cosmetics?.equipped?.elementCardVariant ??
      null
  );
  const counts = Object.fromEntries(ELEMENT_ORDER.map((element) => [element, 0]));
  for (const element of Array.isArray(player.hand) ? player.hand : []) {
    const normalized = String(element ?? "").trim().toLowerCase();
    if (Object.hasOwn(counts, normalized)) {
      counts[normalized] += 1;
    }
  }
  const legalElements = new Set(
    legalCards.map((element) => String(element ?? "").trim().toLowerCase()).filter(Boolean)
  );
  const recent = Array.isArray(player.recentMoves) ? player.recentMoves : [];
  const fatiguedElement =
    recent.length >= 2 && recent.at(-1) === recent.at(-2)
      ? String(recent.at(-1) ?? "").trim().toLowerCase()
      : null;

  return `
    <div class="blood-match-hand" data-blood-player-hand="true">
      ${ELEMENT_ORDER.map((element) => {
        const count = counts[element] ?? 0;
        const disabled = count <= 0 || !legalElements.has(element);
        const fatigued = fatiguedElement === element && disabled && count > 0;
        const stateLabel = count <= 0
          ? "No cards remaining"
          : fatigued
            ? "Fatigued"
            : disabled
              ? "Unavailable"
              : "Playable";
        return `
          <button
            class="blood-match-hand-card ${disabled ? "is-disabled" : ""} ${count <= 0 ? "is-zero" : ""} ${fatigued ? "is-fatigued" : ""}"
            type="button"
            data-blood-play-card-element="${element}"
            aria-label="${formatElementLabel(element)} card, ${count} remaining, ${stateLabel}"
            ${disabled ? "disabled" : ""}
          >
            <img src="${getCardImage(element, equippedVariants)}" alt="${formatElementLabel(element)} card" />
            <span class="blood-match-hand-card__name">${formatElementLabel(element)}</span>
            <span class="blood-match-hand-card__count" aria-hidden="true">×${count}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderTerminalActions(state) {
  if (state?.status !== "completed") {
    return "";
  }
  return `
    <div class="blood-match-terminal-actions">
      <button id="blood-match-rematch-btn" class="btn btn-primary" type="button">Rematch</button>
      <button id="blood-match-return-menu-btn" class="btn" type="button">Return to Menu</button>
    </div>
  `;
}

function renderPlayerColumn(state) {
  const playerIdentity = resolvePlayerIdentity(state);
  return `
    <section class="blood-match-board-column blood-match-board-column--player" data-blood-player-column="true">
      ${renderCombatantPanel(state, "player", {
        role: "Player",
        title: playerIdentity.title,
        avatarSrc: playerIdentity.avatarSrc,
        badgeSrc: playerIdentity.badgeSrc,
        badgeAlt: playerIdentity.badgeAlt,
        avatarPath: "avatars/default.png"
      })}
      <section class="blood-match-player-hand-panel" data-blood-player-hand-panel="true">
        <div>
          <h2>Your Hand</h2>
          <p class="muted">Playable cards are based on controller-provided legal state.</p>
          <p class="keyboard-hint">Keyboard: [1] Fire   [2] Earth   [3] Wind   [4] Water</p>
        </div>
        ${renderPlayerHand(state)}
      </section>
      ${renderTerminalResultPanel(state)}
      ${renderTerminalActions(state)}
    </section>
  `;
}

export const bloodMatchScreen = {
  render(context = {}) {
    const state = context.state ?? {};
    const arena = getAssetPath(BLOOD_MATCH_ARENA_PATH);
    return `
      <section
        class="screen screen-blood-match"
        data-blood-match-screen="true"
        data-blood-match-arena-source="assets/${BLOOD_MATCH_ARENA_PATH}"
        style="background-image: url('${arena}')"
      >
        <div class="blood-match-backdrop">
          <header class="blood-match-topbar">
            <div>
              <p class="blood-match-eyebrow">Blood Match</p>
              <h1>Player vs Countess Veyra vs Ravena Moonfang</h1>
              <p>Eliminate both rivals, or lead every surviving rival when time expires.</p>
            </div>
            <button id="blood-match-quit-btn" class="btn" type="button">Quit</button>
          </header>
          ${renderCountessStrip(state)}
          <main class="blood-match-layout">
            ${renderPlayerColumn(state)}
            ${renderCenterClash(state)}
            ${renderRavenaColumn(state)}
          </main>
          <img class="blood-match-preload-cardback" src="${getCardBackImage("default_card_back")}" alt="" aria-hidden="true" />
        </div>
      </section>
    `;
  },
  bind(context = {}) {
    detachBloodMatchKeyboardHandler?.();
    detachBloodMatchKeyboardHandler = null;

    let locked = false;
    const selectButton = async (button) => {
      if (!button || locked || button.hasAttribute?.("disabled")) {
        return;
      }

      locked = true;
      document.querySelectorAll("[data-blood-play-card-element]").forEach((cardButton) => {
        cardButton.setAttribute?.("disabled", "disabled");
      });

      try {
        const element = button.dataset?.bloodPlayCardElement;
        await context.actions?.playCard?.(element);
      } finally {
        if (button.isConnected === false) {
          return;
        }

        locked = false;
        document.querySelectorAll("[data-blood-play-card-element]").forEach((cardButton) => {
          if (!cardButton.classList?.contains?.("is-disabled") && !cardButton.classList?.contains?.("is-zero")) {
            cardButton.removeAttribute?.("disabled");
          }
        });
      }
    };

    document.querySelectorAll("[data-blood-play-card-element]").forEach((button) => {
      button.addEventListener("click", () => {
        void selectButton(button);
      });
    });

    const keyToElement = {
      "1": "fire",
      "2": "earth",
      "3": "wind",
      "4": "water"
    };
    const hasOpenModal = () => Boolean(document.querySelector?.(".modal-overlay"));
    const keydownHandler = async (event) => {
      const element = keyToElement[event.key];
      const target = event.target ?? document.activeElement ?? null;
      if (!element || locked || hasOpenModal() || isEditableShortcutTarget(target)) {
        return;
      }

      const activeButton = Array.from(document.querySelectorAll("[data-blood-play-card-element]")).find(
        (button) => button.dataset?.bloodPlayCardElement === element && !button.hasAttribute?.("disabled")
      );
      if (!activeButton) {
        return;
      }

      event.preventDefault?.();
      await selectButton(activeButton);
    };

    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", keydownHandler);
      detachBloodMatchKeyboardHandler = () => {
        document.removeEventListener?.("keydown", keydownHandler);
      };
    }

    document.getElementById("blood-match-quit-btn")?.addEventListener("click", () => {
      void context.actions?.quit?.();
    });
    document.getElementById("blood-match-rematch-btn")?.addEventListener("click", () => {
      void context.actions?.rematch?.();
    });
    document.getElementById("blood-match-return-menu-btn")?.addEventListener("click", () => {
      void context.actions?.returnToMenu?.();
    });
  },
  constants: {
    arenaPath: BLOOD_MATCH_ARENA_PATH,
    menuTilePath: BLOOD_MATCH_MENU_TILE_PATH
  }
};

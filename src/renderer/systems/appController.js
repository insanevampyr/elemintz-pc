import {
  aiDifficultyScreen,
  achievementsScreen,
  cosmeticsScreen,
  dailyChallengesScreen,
  gameScreen,
  howToPlayScreen,
  localSetupScreen,
  loginScreen,
  menuScreen,
  onlinePlayScreen,
  passScreen,
  profileScreen,
  roadmapScreen,
  settingsScreen,
  storeScreen
} from "../ui/screens/index.js";
import { buildGameHudPrimaryLine, buildGameLiveUpdateSignature } from "../ui/screens/gameScreen.js";
import { renderMenuChallengePreview, renderMenuDailyLoginStatus } from "../ui/screens/menuScreen.js";
import {
  GAME_BATTLE_EXPRESSIONS_RAIL_OPTIONS,
  renderBattleExpressionsFeed,
  renderBattleExpressionsPanel,
  renderBattleExpressionsRailContents
} from "../ui/shared/battleExpressionsRail.js";
import {
  renderDailyElementChestModalBody
} from "../ui/screens/dailyElementChestScreen.js";
import { getArenaBackground, getAvatarImage, getBadgeImage, getCardBackImage, getVariantCardImages } from "../utils/assets.js";
import { escapeHtml, getAssetPath } from "../utils/dom.js";
import { GameController, MATCH_MODE } from "./gameController.js";
import { SoundManager } from "./soundManager.js";
import {
  applyAchievementUnlocks,
  buildAchievementCatalog,
  evaluateRetroactiveAchievements
} from "../../state/achievementSystem.js";
import {
  COSMETIC_CATALOG,
  getCosmeticCatalogForProfile,
  getCosmeticDefinition,
  getCosmeticDisplayName
} from "../../state/cosmeticSystem.js";
import { buildFeaturedRotationCatalog, getStoreViewForProfile } from "../../state/storeSystem.js";
import { deriveMatchStats } from "../../state/statsTracking.js";
import { deriveLevelFromXp, MAX_LEVEL } from "../../state/levelRewardsSystem.js";
import { listGauntletRivals, resolveGauntletRivalById } from "../../engine/gauntletRivals.js";
import { createDefaultCategoryViewState } from "../ui/shared/cosmeticCategoryShared.js";
import { bindCosmeticHoverPreview } from "../ui/shared/cosmeticHoverPreview.js";
import { MATCH_TAUNT_FEED_LIMIT, MATCH_TAUNT_PRESETS } from "../ui/shared/playSurfaceShared.js";
import { getUpdateSafetyState as buildUpdateSafetyState, isSafeForUpdateRestart as computeIsSafeForUpdateRestart } from "./updateSafety.js";
import {
  buildUpdateCoordinatorState,
  buildUpdateDiagnosticsSnapshot,
  refreshUpdateCoordinatorState as loadUpdateCoordinatorState
} from "./updateCoordinator.js";
import { getDailyResetWindow } from "../../state/dailyChallengesSystem.js";

const FALLBACK_SETTINGS = {
  audio: { enabled: true },
  gameplay: { timerSeconds: 20 },
  aiDifficulty: "normal",
  aiOpponentStyle: "random",
  ui: { reducedMotion: false }
};

const TITLE_ICON_MAP = Object.freeze({
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
});
const ONLINE_RECONNECT_TIMEOUT_MS = 60000;
const ONLINE_DEFAULT_EQUIPPED_COSMETICS = Object.freeze({
  avatar: "default_avatar",
  background: "default_background",
  cardBack: "default_card_back",
  elementCardVariant: Object.freeze({
    fire: "default_fire_card",
    water: "default_water_card",
    earth: "default_earth_card",
    wind: "default_wind_card"
  }),
  title: "Initiate",
  badge: "none"
});
const ELEMENT_CARD_VARIANT_ELEMENTS = Object.freeze(["fire", "water", "earth", "wind"]);
const MATCH_TAUNT_HISTORY_LIMIT = 8;
const MATCH_TAUNT_VISIBLE_MS = 30000;
const MATCH_TAUNT_FADE_MS = 400;
const MATCH_TAUNT_UI_TICK_MS = 250;
const PLAYER_TAUNT_COOLDOWN_MS = 12000;
const AI_TAUNT_COOLDOWN_MIN_MS = 20000;
const AI_TAUNT_COOLDOWN_MAX_MS = 30000;
const AI_TAUNT_CHANCE_MIN = 0.3;
const AI_TAUNT_CHANCE_MAX = 0.5;
const NEW_COSMETICS_ANNOUNCEMENT_KEY = "cosmetics_v0.1.6";
const NEW_COSMETICS_ANNOUNCEMENT_TITLE = "New Cosmetics Added!";
const NEW_COSMETICS_ANNOUNCEMENT_BODY =
  "26 new titles and avatars are now available in the Store.";
const FEEDBACK_CATEGORIES = Object.freeze([
  "Bug / Error",
  "Balance Issue",
  "AI Too Easy/Hard",
  "Reward / Chest Issue",
  "Online Room Issue",
  "Login / Profile Issue",
  "Suggestion",
  "Other"
]);
const FEEDBACK_MAX_MESSAGE_LENGTH = 2000;
const DAILY_ELEMENT_CHEST_RESULT_VISIBILITY_MS = 3000;
const DAILY_LOGIN_UPDATE_SAFETY_STALE_MS = 20000;
const PVE_AI_TAUNT_LINES = Object.freeze({
  match_start: Object.freeze(["👀 I saw that.", "😤 Not done yet.", "🔥 Burn it down!"]),
  player_win: Object.freeze(["💀 That hurt.", "😤 Not done yet.", "💀 I don’t fold."]),
  player_loss: Object.freeze(["🏆 Clean win.", "🎲 Lucky clash.", "💧 Washed out!"]),
  war_start: Object.freeze(["⚔️ WAR!", "😤 Not done yet.", "👀 I saw that."]),
  war_resolved: Object.freeze(["⚔️ WAR!", "🏆 Clean win.", "💀 I don’t fold."]),
  near_victory: Object.freeze(["🏆 Clean win.", "🔥 Burn it down!", "🌍 Stone solid."]),
  match_end: Object.freeze(["🏆 Clean win.", "✨ Nice play.", "😤 Not done yet."])
});
const FEATURED_RIVAL_CONFIGS = Object.freeze({
  crownfire_duelist: Object.freeze({
    id: "crownfire_duelist",
    name: "Crownfire Duelist",
    titleName: "Inferno Regent",
    titleIconPath: "rivals/Crownfire/title_crownfire_inferno_regent.png",
    avatarPath: "rivals/Crownfire/rival_crownfire_duelist_avatar.png",
    badgePath: "rivals/Crownfire/badge_crownfire_sigil.png",
    cardBackPath: "rivals/Crownfire/cardback_crownfire_regent.png",
    backgroundPath: "rivals/Crownfire/bg_crownfire_arena.png",
    elementCardVariant: Object.freeze({
      fire: "rivals/Crownfire/variant_fire_crownfire.png",
      water: "rivals/Crownfire/variant_water_crownfire.png",
      earth: "rivals/Crownfire/variant_earth_crownfire.png",
      wind: "rivals/Crownfire/variant_wind_crownfire.png"
    }),
    aiDifficulty: "hard",
    totalCards: 20
  })
});
const DAILY_LOGIN_STREAK_MAX_DAY = 7;
const DAY_7_DAILY_LOGIN_PREVIEW_LINES = Object.freeze([
  "Day 7 Streak Reward",
  "Guaranteed 50 tokens",
  "10% chance for an Epic Chest",
  "3% chance for a Legendary Chest"
]);

function getSafeDailyLoginStreakDay(value) {
  const safeDay = Math.floor(Number(value ?? 0) || 0);
  return Math.min(DAILY_LOGIN_STREAK_MAX_DAY, Math.max(0, safeDay));
}

function getPreviousDailyLoginWindowKey(nowMs = Date.now()) {
  const currentWindow = getDailyResetWindow(nowMs);
  const previousWindow = getDailyResetWindow(currentWindow.lastResetMs - 1);
  return new Date(previousWindow.lastResetMs).toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function createDefaultGauntletRunState() {
  return {
    active: false,
    sessionId: null,
    previousSessionId: null,
    currentStreak: 0,
    currentRivalIndex: -1,
    currentRivalId: null,
    rivalBag: [],
    lastRivalId: null,
    defeatedRivalIds: [],
    claimedMilestoneStreaks: [],
    lastResult: null
  };
}

function shuffleList(items = [], random = Math.random) {
  const nextItems = Array.isArray(items) ? [...items] : [];
  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = nextItems[index];
    nextItems[index] = nextItems[swapIndex];
    nextItems[swapIndex] = current;
  }

  return nextItems;
}

export class AppController {
  constructor({ screenManager, modalManager, toastManager }) {
    this.screenManager = screenManager;
    this.modalManager = modalManager;
    this.toastManager = toastManager;

    this.username = null;
    this.profile = null;
    this.settings = null;
    this.gameController = null;
    this.sound = new SoundManager();
    this.localPlayers = null;
    this.localProfiles = null;
    this.localPlayerAuthorities = null;
    this.profileSearchQuery = "";
    this.profileSearchError = "";
    this.viewedProfileUsername = null;
    this.viewedProfileCloseAction = null;
    this.profileAchievementsExpanded = false;
    this.viewedProfileAchievementsExpanded = false;
    this.battleReportSelectedIndex = null;
    this.passTimerId = null;
    this.passKeyHandler = null;
    this.navigationShortcutHandler = null;
    this.dailyChallenges = null;
    this.dailyResetCountdownId = null;
    this.dailyChallengesRefreshPromise = null;
    this.localQuitLastRequestAt = 0;
    this.initPromise = null;
    this.dailyLoginAutoClaimKey = null;
    this.dailyLoginAutoClaimPromise = null;
    this.dailyLoginAutoClaimSessionGateKey = null;
    this.dailyLoginAutoClaimStartedAt = 0;
    this.passCompletionResolve = null;
    this.pendingMatchCompletePayload = null;
    this.pendingGauntletVictoryPayload = null;
    this.pendingGauntletContinuation = null;
    this.pendingGauntletContinuationRequiresConfirm = false;
    this.deferPveOutcomeSound = false;
    this.deferredPveRoundSound = null;
    this.pveOpponentStyle = null;
    this.pveGauntletMode = false;
    this.pveFeaturedRivalId = null;
    this.currentProtectedLocalMatchSession = null;
    this.pendingProtectedLocalMatchSessionPromise = null;
    this.protectedLocalMatchSessionRequestId = 0;
    this.currentGauntletLocalMatchSession = null;
    this.pendingGauntletLocalMatchSessionPromise = null;
    this.gauntletLocalMatchSessionRequestId = 0;
    this.gauntletRunState = createDefaultGauntletRunState();
    this.profileChestVisualState = {
      basicOpen: false,
      milestoneOpen: false,
      epicOpen: false,
      legendaryOpen: false
    };
    this.profileMilestoneChestNoticeOpen = false;
    this.profileChestOpenInFlight = false;
    this.onlinePlayState = null;
    this.ownProfileHydration = {
      status: "ready",
      username: null,
      message: ""
    };
    this.lastAuthoritativeOwnProfile = null;
    this.activeAdminGrantNoticeId = null;
    this.queuedAdminGrantNoticeIds = [];
    this.onlinePlayJoinCode = "";
    this.onlineCreateRoomVisibility = "private";
      this.onlinePublicRooms = [];
      this.onlinePublicRoomsStatus = "idle";
      this.onlinePublicRoomsError = "";
      this.onlinePlayerCount = null;
      this.onlinePlayerCountStatus = "idle";
      this.onlinePlayerCountRefreshPromise = null;
      this.onlinePublicRoomsRefreshPromise = null;
      this.onlinePlayUnsubscribe = null;
    this.onlinePlayChallengeSummary = null;
    this.onlinePlayChallengeSummaryKey = null;
    this.onlinePlayProfileRefreshKey = null;
    this.onlinePlayProfileRefreshPromise = null;
    this.onlineReconnectReminder = null;
    this.onlineReconnectReminderDismissedKey = null;
    this.onlineReconnectUiTimerId = null;
    this.onlineTurnTimerUiId = null;
    this.onlineMoveSubmitPromise = null;
    this.onlinePlaySoundState = {
      roomCode: null,
      revealKey: null,
      warStartKey: null,
      roundResolvedKey: null,
      matchCompleteKey: null
    };
    this.matchTaunts = [];
    this.matchTauntPanelOpen = false;
    this.matchTauntSequence = 0;
    this.matchTauntUiTimerId = null;
    this.playerTauntCooldowns = Object.create(null);
    this.aiTauntCooldownUntil = 0;
    this.aiLastTauntEventKey = null;
    this.activeAnnouncementKey = null;
    this.seenAnnouncementSessionFlags = new Set();
    this.menuAnnouncement = null;
    this.menuAnnouncementRefreshPromise = null;
    this.menuBoostEvent = null;
    this.menuBoostEventRefreshPromise = null;
    this.dailyElementChestStatus = null;
    this.dailyElementChestStatusRefreshPromise = null;
    this.dailyElementChestOpenInFlight = false;
    this.dailyElementChestPendingOpenType = null;
    this.dailyElementChestLastResult = null;
    this.dailyElementChestResultVisualActive = false;
    this.dailyElementChestResultVisualTimeoutId = null;
    this.dailyElementChestUiError = "";
    this.tauntRandom = Math.random;
    this.gauntletRandom = Math.random;
    this.opponentDisplayName = "Elemental AI";
    this.storeViewState = this.createDefaultStoreViewState();
    this.storePurchaseInFlight = false;
    this.storePurchaseInFlightKey = null;
    this.storeFeaturedRotationCache = null;
    this.storeFeaturedRotationCacheUsername = null;
    this.cosmeticsViewState = createDefaultCategoryViewState();
    this.presentedAchievementUnlockKeys = new Set();
      this.roundPresentation = {
        phase: "idle",
        busy: false,
        selectedCardIndex: null
      };
      this.screenFlow = "idle";
      this.updateCoordinatorState = buildUpdateCoordinatorState();
      this.updateLifecycleUnsubscribe = null;
      this.updateReadyPromptVersion = null;
      this.updateReadyPromptVisible = false;

    this.registerScreens();
    this.ensureNavigationShortcutHandler();
  }

  cloneOnlineBattleLogResult(result) {
    if (!result) {
      return null;
    }

    return {
      outcomeType: result.outcomeType ?? null,
      hostMove: result.hostMove ?? null,
      guestMove: result.guestMove ?? null,
      hostResult: result.hostResult ?? null,
      guestResult: result.guestResult ?? null,
      roundNumber: Number(result.roundNumber ?? 0) || null,
      matchComplete: Boolean(result.matchComplete)
    };
  }

  buildOnlineBattleLogResultFromRoundEntry(entry, fallback = {}) {
    if (!entry) {
      return null;
    }

    const outcomeType = String(entry?.outcomeType ?? fallback?.outcomeType ?? "").trim().toLowerCase();
    if (!outcomeType || !["resolved", "no_effect", "war", "war_resolved"].includes(outcomeType)) {
      return null;
    }

    return this.cloneOnlineBattleLogResult({
      outcomeType,
      hostMove: entry?.hostMove ?? fallback?.hostMove ?? null,
      guestMove: entry?.guestMove ?? fallback?.guestMove ?? null,
      hostResult: entry?.hostResult ?? fallback?.hostResult ?? null,
      guestResult: entry?.guestResult ?? fallback?.guestResult ?? null,
      roundNumber: entry?.round ?? fallback?.roundNumber ?? null,
      matchComplete: Boolean(entry?.matchComplete ?? fallback?.matchComplete)
    });
  }

  extractCompletedOnlineBattleLogResultFromRoom(state) {
    const room = state?.room ?? null;
    if (!room) {
      return null;
    }

    const lastOutcomeType = String(room?.lastOutcomeType ?? "").trim().toLowerCase();
    const roundHistory = Array.isArray(room?.roundHistory) ? room.roundHistory : [];
    const warRounds = Array.isArray(room?.warRounds) ? room.warRounds : [];
    const latestRoundHistoryEntry = roundHistory.at(-1) ?? null;
    const latestWarRoundEntry = warRounds.at(-1) ?? null;

    if (lastOutcomeType === "resolved" || lastOutcomeType === "war_resolved") {
      const matchingHistoryEntry =
        [...roundHistory].reverse().find((entry) => String(entry?.outcomeType ?? "").trim().toLowerCase() === lastOutcomeType) ??
        latestRoundHistoryEntry;
      return this.buildOnlineBattleLogResultFromRoundEntry(matchingHistoryEntry, {
        outcomeType: lastOutcomeType,
        matchComplete: room?.matchComplete
      });
    }

    if (lastOutcomeType === "no_effect" || lastOutcomeType === "war") {
      const matchingWarEntry =
        [...warRounds].reverse().find((entry) => String(entry?.outcomeType ?? "").trim().toLowerCase() === lastOutcomeType) ??
        [...roundHistory].reverse().find((entry) => String(entry?.outcomeType ?? "").trim().toLowerCase() === lastOutcomeType) ??
        latestWarRoundEntry ??
        latestRoundHistoryEntry;
      return this.buildOnlineBattleLogResultFromRoundEntry(matchingWarEntry, {
        outcomeType: lastOutcomeType,
        hostResult: lastOutcomeType === "war" ? "war" : "no_effect",
        guestResult: lastOutcomeType === "war" ? "war" : "no_effect",
        matchComplete: room?.matchComplete
      });
    }

    return this.buildOnlineBattleLogResultFromRoundEntry(latestRoundHistoryEntry, {
      matchComplete: room?.matchComplete
    });
  }

  extractCompletedOnlineBattleLogResult(state) {
    const authoritativeResult = state?.latestAuthoritativeRoundResult ?? null;
    const roundResult = authoritativeResult?.roundResult ?? state?.latestRoundResult ?? null;
    const outcomeType = String(authoritativeResult?.outcomeType ?? roundResult?.outcomeType ?? "").trim().toLowerCase();

    const fromLiveResult =
      roundResult && outcomeType
        ? this.buildOnlineBattleLogResultFromRoundEntry(
            {
              ...roundResult,
              outcomeType,
              hostMove: authoritativeResult?.submittedCards?.host ?? roundResult?.hostMove ?? null,
              guestMove: authoritativeResult?.submittedCards?.guest ?? roundResult?.guestMove ?? null,
              round: roundResult?.roundNumber ?? state?.room?.roundNumber ?? null,
              matchComplete: Boolean(roundResult?.matchComplete ?? state?.room?.matchComplete)
            },
            {
              outcomeType,
              matchComplete: state?.room?.matchComplete
            }
          )
        : null;

    return fromLiveResult ?? this.extractCompletedOnlineBattleLogResultFromRoom(state);
  }

  resetDailyLoginAutoClaimGuard() {
    this.dailyLoginAutoClaimKey = null;
    this.dailyLoginAutoClaimPromise = null;
    this.dailyLoginAutoClaimSessionGateKey = null;
    this.dailyLoginAutoClaimStartedAt = 0;
  }

  hasActiveDailyLoginAutoClaimForUpdateSafety(nowMs = Date.now()) {
    if (!this.dailyLoginAutoClaimPromise) {
      return false;
    }

    const startedAt = Number(this.dailyLoginAutoClaimStartedAt ?? 0);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      return true;
    }

    if (nowMs - startedAt < DAILY_LOGIN_UPDATE_SAFETY_STALE_MS) {
      return true;
    }

    console.warn("[DailyLogin][Renderer] clearing stale auto-claim update-safety guard", {
      username: this.username,
      startedAt,
      nowMs,
      ageMs: nowMs - startedAt
    });
    this.resetDailyLoginAutoClaimGuard();
    return false;
  }

  getTauntNow() {
    return Date.now();
  }

  resetMatchTaunts() {
    this.matchTaunts = [];
    this.matchTauntPanelOpen = false;
    this.matchTauntSequence = 0;
    this.playerTauntCooldowns = Object.create(null);
    this.aiTauntCooldownUntil = 0;
    this.aiLastTauntEventKey = null;
    this.clearMatchTauntUiTimer();
  }

  appendMatchTaunt({ speaker, text, kind = "player" }) {
    const now = this.getTauntNow();
    const safeSpeaker = String(speaker ?? "").trim();
    const safeText = String(text ?? "").trim();
    if (!safeSpeaker || !safeText) {
      return;
    }

    this.matchTauntSequence += 1;
    this.matchTaunts = [
      ...this.matchTaunts,
      {
        id: `taunt-${this.matchTauntSequence}`,
        speaker: safeSpeaker,
        text: safeText,
        kind,
        createdAt: now,
        fadeAt: now + MATCH_TAUNT_VISIBLE_MS,
        expiresAt: now + MATCH_TAUNT_VISIBLE_MS + MATCH_TAUNT_FADE_MS
      }
    ].slice(-MATCH_TAUNT_HISTORY_LIMIT);
    this.ensureMatchTauntUiTimer();
  }

  clearMatchTauntUiTimer() {
    if (this.matchTauntUiTimerId) {
      clearInterval(this.matchTauntUiTimerId);
      this.matchTauntUiTimerId = null;
    }
  }

  getCurrentPlayerTauntCooldownRemaining(senderKey) {
    const key = String(senderKey ?? "").trim();
    if (!key) {
      return 0;
    }

    return Math.max(0, Number(this.playerTauntCooldowns[key] ?? 0) - this.getTauntNow());
  }

  isPlayerTauntCoolingDown(senderKey) {
    return this.getCurrentPlayerTauntCooldownRemaining(senderKey) > 0;
  }

  startPlayerTauntCooldown(senderKey) {
    const key = String(senderKey ?? "").trim();
    if (!key) {
      return;
    }

    this.playerTauntCooldowns[key] = this.getTauntNow() + PLAYER_TAUNT_COOLDOWN_MS;
    this.ensureMatchTauntUiTimer();
  }

  getCurrentGameTauntSenderKey() {
    const vm = this.gameController?.getViewModel();
    if (vm?.mode === MATCH_MODE.LOCAL_PVP) {
      return vm.hotseatTurn === "p2" ? "local:p2" : "local:p1";
    }

    return `user:${this.username ?? this.profile?.username ?? "player"}`;
  }

  getCurrentOnlineTauntSenderKey() {
    const room = this.onlinePlayState?.room;
    const socketId = this.onlinePlayState?.socketId ?? null;

    if (room?.host?.socketId && room.host.socketId === socketId) {
      return "online:host";
    }

    if (room?.guest?.socketId && room.guest.socketId === socketId) {
      return "online:guest";
    }

    return `user:${this.username ?? this.profile?.username ?? "player"}`;
  }

  buildRenderableTauntMessages(taunts) {
    const now = this.getTauntNow();
    return (Array.isArray(taunts) ? taunts : [])
      .map((entry) => {
        const fallbackCreatedAt = Date.parse(entry?.sentAt ?? "") || now;
        const createdAt = Number(entry?.createdAt ?? fallbackCreatedAt);
        const fadeAt = Number(entry?.fadeAt ?? (createdAt + MATCH_TAUNT_VISIBLE_MS));
        const expiresAt = Number(entry?.expiresAt ?? (fadeAt + MATCH_TAUNT_FADE_MS));
        if (!Number.isFinite(expiresAt) || now >= expiresAt) {
          return null;
        }

        return {
          id: entry?.id ?? null,
          speaker: entry?.speaker ?? entry?.senderName ?? "Player",
          text: entry?.text ?? "",
          kind: entry?.kind ?? "player",
          isFading: now >= fadeAt
        };
      })
      .filter(Boolean)
      .slice(-MATCH_TAUNT_FEED_LIMIT);
  }

  pruneExpiredLocalMatchTaunts() {
    const now = this.getTauntNow();
    const nextTaunts = this.matchTaunts.filter((entry) => Number(entry?.expiresAt ?? 0) > now);
    const changed = nextTaunts.length !== this.matchTaunts.length;
    if (changed) {
      this.matchTaunts = nextTaunts;
    }
    return changed;
  }

  hasActiveTauntHudState() {
    const localActive = this.matchTaunts.some((entry) => Number(entry?.expiresAt ?? 0) > this.getTauntNow());
    const onlineActive = Array.isArray(this.onlinePlayState?.room?.taunts) && this.onlinePlayState.room.taunts.some((entry) => {
      const createdAt = Date.parse(entry?.sentAt ?? "") || 0;
      return createdAt + MATCH_TAUNT_VISIBLE_MS + MATCH_TAUNT_FADE_MS > this.getTauntNow();
    });
    const hasCooldown = Object.values(this.playerTauntCooldowns).some((value) => Number(value ?? 0) > this.getTauntNow());
    return localActive || onlineActive || hasCooldown;
  }

  buildCurrentTauntHudRenderState(screenFlow = this.screenFlow) {
    const tauntHud = this.getCurrentTauntHudState();
    const idPrefix = screenFlow === "onlinePlay" ? "online" : "game";
    return {
      idPrefix,
      panelOpen: this.matchTauntPanelOpen,
      messages:
        screenFlow === "onlinePlay"
          ? this.getRenderableOnlineTaunts()
          : this.getRenderableMatchTaunts(),
      presetLines: MATCH_TAUNT_PRESETS,
      cooldownRemainingMs: tauntHud.cooldownRemainingMs,
      canSend: tauntHud.canSend
    };
  }

  buildTauntHudRenderSignature(renderState = {}) {
    const messages = Array.isArray(renderState.messages)
      ? renderState.messages.map((message) => ({
          id: message?.id ?? null,
          speaker: message?.speaker ?? "",
          text: message?.text ?? "",
          isFading: Boolean(message?.isFading),
          isAi: Boolean(message?.isAi),
          isOpponent: Boolean(message?.isOpponent)
        }))
      : [];
    const cooldownRemainingMs = Math.max(0, Number(renderState.cooldownRemainingMs) || 0);
    const cooldownLabel = cooldownRemainingMs > 0 ? `${Math.ceil(cooldownRemainingMs / 1000)}s` : "Ready";
    return JSON.stringify({
      idPrefix: renderState.idPrefix ?? "",
      panelOpen: Boolean(renderState.panelOpen),
      messages,
      presetLines: Array.isArray(renderState.presetLines) ? renderState.presetLines : [],
      cooldownLabel,
      canSend: renderState.canSend ?? true
    });
  }

  getTauntHudScopeConfig(screenFlow = this.screenFlow) {
    if (screenFlow === "onlinePlay") {
      return {
        idPrefix: "online",
        shellClassName: "match-taunt-shell online-match-taunt-rail",
        toggleButtonId: "online-taunts-toggle-btn",
        railBodySelector: '[data-online-match-taunt-rail-body="true"]'
      };
    }

    return {
      idPrefix: "game",
      shellClassName: "match-taunt-shell game-match-taunt-rail",
      toggleButtonId: "game-taunts-toggle-btn",
      railBodySelector: '[data-game-match-taunt-rail-body="true"]'
    };
  }

  captureCurrentTauntHudDomState(screenFlow = this.screenFlow) {
    if (typeof document?.querySelector !== "function") {
      return null;
    }

    const config = this.getTauntHudScopeConfig(screenFlow);
    const shell = document.querySelector?.(`[data-match-taunt-shell="${config.idPrefix}"]`);
    if (!shell) {
      return null;
    }

    const railBody = shell.querySelector?.(config.railBodySelector) ?? null;
    const panel = shell.querySelector?.(`[data-match-taunt-panel="${config.idPrefix}"]`) ?? null;
    const activeElement = document?.activeElement ?? null;
    const focusedTauntLine =
      activeElement?.getAttribute?.("data-taunt-line") &&
      activeElement?.closest?.(`[data-match-taunt-panel="${config.idPrefix}"]`)
        ? activeElement.getAttribute("data-taunt-line")
        : null;

    return {
      railBodyScrollTop: Number(railBody?.scrollTop ?? 0),
      panelScrollTop: Number(panel?.scrollTop ?? 0),
      focusedTauntLine
    };
  }

  restoreCurrentTauntHudDomState(screenFlow = this.screenFlow, preservedState = null) {
    if (!preservedState || typeof document?.querySelector !== "function") {
      return;
    }

    const config = this.getTauntHudScopeConfig(screenFlow);
    const shell = document.querySelector?.(`[data-match-taunt-shell="${config.idPrefix}"]`);
    if (!shell) {
      return;
    }

    const railBody = shell.querySelector?.(config.railBodySelector) ?? null;
    if (railBody && Number.isFinite(preservedState.railBodyScrollTop)) {
      railBody.scrollTop = preservedState.railBodyScrollTop;
    }

    const panel = shell.querySelector?.(`[data-match-taunt-panel="${config.idPrefix}"]`) ?? null;
    if (panel && Number.isFinite(preservedState.panelScrollTop)) {
      panel.scrollTop = preservedState.panelScrollTop;
    }

    if (preservedState.focusedTauntLine && typeof shell.querySelector === "function") {
      shell.querySelector(`[data-taunt-line="${preservedState.focusedTauntLine.replaceAll("\"", "&quot;")}"]`)?.focus?.();
    }
  }

  finalizeRenderedTauntHud(screenFlow = this.screenFlow, preservedState = null) {
    if (typeof document?.querySelector !== "function") {
      return;
    }

    const config = this.getTauntHudScopeConfig(screenFlow);
    const shell = document.querySelector?.(`[data-match-taunt-shell="${config.idPrefix}"]`);
    if (!shell) {
      return;
    }

    shell.__elemintzTauntRenderSignature = this.buildTauntHudRenderSignature(
      this.buildCurrentTauntHudRenderState(screenFlow)
    );
    this.bindRenderedTauntHud(shell, screenFlow);
    this.restoreCurrentTauntHudDomState(screenFlow, preservedState);
  }

  bindRenderedTauntHud(shell, screenFlow = this.screenFlow) {
    if (!shell || typeof shell.querySelectorAll !== "function") {
      return;
    }

    const config = this.getTauntHudScopeConfig(screenFlow);
    const toggleButton = shell.querySelector?.(`#${config.toggleButtonId}`);
    if (toggleButton && !toggleButton.__elemintzTauntToggleBound) {
      toggleButton.__elemintzTauntToggleBound = true;
      toggleButton.addEventListener("click", async () => {
        this.toggleMatchTauntPanel();
      });
    }

    shell.querySelectorAll("[data-taunt-line]").forEach((button) => {
      if (button.__elemintzTauntLineBound) {
        return;
      }

      button.__elemintzTauntLineBound = true;
      button.addEventListener("click", async () => {
        const line = button.getAttribute("data-taunt-line") ?? "";
        if (screenFlow === "onlinePlay") {
          await this.sendCurrentOnlineTaunt(line);
          return;
        }

        await this.sendCurrentMatchTaunt(line);
      });
    });
  }

  refreshCurrentTauntHudInPlace(screenFlow = this.screenFlow) {
    if (typeof document?.querySelector !== "function") {
      return false;
    }

    const renderState = this.buildCurrentTauntHudRenderState(screenFlow);
    const shell = document.querySelector(`[data-match-taunt-shell="${renderState.idPrefix}"]`);
    if (!shell) {
      return false;
    }
    const config = this.getTauntHudScopeConfig(screenFlow);
    const renderOptions = screenFlow === "onlinePlay" ? undefined : GAME_BATTLE_EXPRESSIONS_RAIL_OPTIONS;
    const renderSignature = this.buildTauntHudRenderSignature(renderState);

    shell.className = `${config.shellClassName} ${renderState.panelOpen ? "is-open" : ""}`.trim();

    if (shell.__elemintzTauntRenderSignature === renderSignature) {
      this.bindRenderedTauntHud(shell, screenFlow);
      return true;
    }

    const trigger = shell.querySelector?.(`#${config.toggleButtonId}`);
    const cooldown = shell.querySelector?.(".match-taunt-cooldown");
    const feed = shell.querySelector?.(".match-taunt-feed");
    const railBody = shell.querySelector?.(config.railBodySelector);
    const panel = shell.querySelector?.(`[data-match-taunt-panel="${config.idPrefix}"]`);
    const activeElement = document?.activeElement ?? null;
    const focusedTauntLine =
      activeElement?.getAttribute?.("data-taunt-line") &&
      activeElement?.closest?.(`[data-match-taunt-panel="${config.idPrefix}"]`)
        ? activeElement.getAttribute("data-taunt-line")
        : null;

    const canPatchExistingShell = Boolean(trigger && cooldown && feed && railBody);
    if (!canPatchExistingShell) {
      shell.innerHTML = renderBattleExpressionsRailContents(renderState, renderOptions);
      shell.__elemintzTauntRenderSignature = renderSignature;
      this.bindRenderedTauntHud(shell, screenFlow);
      return true;
    }

    trigger.setAttribute?.("aria-expanded", renderState.panelOpen ? "true" : "false");
    const cooldownRemainingMs = Math.max(0, Number(renderState.cooldownRemainingMs) || 0);
    const cooldownLabel = cooldownRemainingMs > 0 ? `${Math.ceil(cooldownRemainingMs / 1000)}s` : "Ready";
    const desiredCooldownState = cooldownRemainingMs > 0 ? "cooldown" : "ready";
    if (cooldown.textContent !== cooldownLabel) {
      cooldown.textContent = cooldownLabel;
    }
    if (cooldown.getAttribute?.("data-taunt-cooldown-state") !== desiredCooldownState) {
      cooldown.setAttribute?.("data-taunt-cooldown-state", desiredCooldownState);
    }

    const feedMarkup = renderBattleExpressionsFeed(renderState.messages);
    if (feed.outerHTML !== feedMarkup.trim()) {
      feed.outerHTML = feedMarkup.trim();
    }

    const refreshedFeed = shell.querySelector?.(".match-taunt-feed");
    const refreshedRailBody = shell.querySelector?.(config.railBodySelector) ?? railBody;
    const existingPanel = shell.querySelector?.(`[data-match-taunt-panel="${config.idPrefix}"]`);

    if (!renderState.panelOpen) {
      existingPanel?.remove?.();
    } else {
      const panelMarkup = renderBattleExpressionsPanel(renderState.presetLines, {
        canSend: renderState.canSend,
        panelDataScope: config.idPrefix,
        toggleButtonId: config.toggleButtonId
      }).trim();

      if (existingPanel) {
        const previousScrollTop = Number(existingPanel.scrollTop ?? 0);
        if (existingPanel.outerHTML !== panelMarkup) {
          existingPanel.outerHTML = panelMarkup;
        }
        const nextPanel = shell.querySelector?.(`[data-match-taunt-panel="${config.idPrefix}"]`);
        if (nextPanel) {
          nextPanel.scrollTop = previousScrollTop;
          if (focusedTauntLine && typeof nextPanel.querySelector === "function") {
            nextPanel.querySelector(`[data-taunt-line="${focusedTauntLine.replaceAll("\"", "&quot;")}"]`)?.focus?.();
          }
        }
      } else if (typeof refreshedRailBody?.insertAdjacentHTML === "function") {
        refreshedRailBody.insertAdjacentHTML("beforeend", panelMarkup);
      } else {
        shell.innerHTML = renderBattleExpressionsRailContents(renderState, renderOptions);
        shell.__elemintzTauntRenderSignature = renderSignature;
        this.bindRenderedTauntHud(shell, screenFlow);
        return true;
      }
    }

    shell.__elemintzTauntRenderSignature = renderSignature;
    this.bindRenderedTauntHud(shell, screenFlow);
    return true;
  }

  refreshTauntHudIfNeeded() {
    const removedExpired = this.pruneExpiredLocalMatchTaunts();

    if (this.screenFlow === "game") {
      if (this.refreshCurrentTauntHudInPlace("game")) {
        return;
      }

      this.showGame();
    } else if (this.screenFlow === "onlinePlay") {
      if (this.refreshCurrentTauntHudInPlace("onlinePlay")) {
        return;
      }

      this.renderOnlinePlayScreen();
    } else if (removedExpired || !this.hasActiveTauntHudState()) {
      this.clearMatchTauntUiTimer();
    }
  }

  ensureMatchTauntUiTimer() {
    if (this.matchTauntUiTimerId || !this.hasActiveTauntHudState()) {
      return;
    }

    this.matchTauntUiTimerId = setInterval(() => {
      if (!this.hasActiveTauntHudState()) {
        this.clearMatchTauntUiTimer();
        return;
      }

      this.refreshTauntHudIfNeeded();
    }, MATCH_TAUNT_UI_TICK_MS);
    this.matchTauntUiTimerId?.unref?.();
  }

  getRenderableMatchTaunts() {
    return this.buildRenderableTauntMessages(this.matchTaunts);
  }

  getRenderableOnlineTaunts() {
    const taunts = Array.isArray(this.onlinePlayState?.room?.taunts) ? this.onlinePlayState.room.taunts : [];
    return this.buildRenderableTauntMessages(taunts);
  }

  getCurrentTauntHudState() {
    if (this.screenFlow === "onlinePlay") {
      const senderKey = this.getCurrentOnlineTauntSenderKey();
      const cooldownRemainingMs = this.getCurrentPlayerTauntCooldownRemaining(senderKey);
      return {
        senderKey,
        cooldownRemainingMs,
        canSend: cooldownRemainingMs <= 0
      };
    }

    const senderKey = this.getCurrentGameTauntSenderKey();
    const cooldownRemainingMs = this.getCurrentPlayerTauntCooldownRemaining(senderKey);
    return {
      senderKey,
      cooldownRemainingMs,
      canSend: cooldownRemainingMs <= 0
    };
  }

  toggleMatchTauntPanel() {
    this.matchTauntPanelOpen = !this.matchTauntPanelOpen;
    if (this.screenFlow === "onlinePlay") {
      if (this.refreshCurrentTauntHudInPlace("onlinePlay")) {
        return;
      }

      this.renderOnlinePlayScreen();
      return;
    }

    if (this.screenFlow === "game") {
      if (this.refreshCurrentTauntHudInPlace("game")) {
        return;
      }

      this.showGame();
    }
  }

  closeMatchTauntPanel() {
    this.matchTauntPanelOpen = false;
  }

  getCurrentGameTauntSpeaker() {
    const vm = this.gameController?.getViewModel();
    if (!vm) {
      return this.username ?? "Player";
    }

    if (vm.mode === MATCH_MODE.LOCAL_PVP) {
      const names = this.getLocalNames();
      return vm.hotseatTurn === "p2" ? names.p2 : names.p1;
    }

    return this.username ?? this.profile?.username ?? "Player";
  }

  async sendCurrentMatchTaunt(line) {
    const safeLine = String(line ?? "").trim();
    if (!MATCH_TAUNT_PRESETS.includes(safeLine)) {
      return;
    }

    const senderKey = this.getCurrentGameTauntSenderKey();
    if (this.isPlayerTauntCoolingDown(senderKey)) {
      this.ensureMatchTauntUiTimer();
      if (this.screenFlow === "game") {
        if (this.refreshCurrentTauntHudInPlace("game")) {
          return;
        }

        this.showGame();
      }
      return;
    }

    this.appendMatchTaunt({
      speaker: this.getCurrentGameTauntSpeaker(),
      text: safeLine,
      kind: "player"
    });
    this.startPlayerTauntCooldown(senderKey);
    this.closeMatchTauntPanel();
    if (!this.refreshCurrentTauntHudInPlace("game")) {
      this.showGame();
    }
  }

  async sendCurrentOnlineTaunt(line) {
    if (!window.elemintz?.multiplayer?.sendTaunt) {
      return;
    }

    const safeLine = String(line ?? "").trim();
    if (!MATCH_TAUNT_PRESETS.includes(safeLine)) {
      return;
    }

    const senderKey = this.getCurrentOnlineTauntSenderKey();
    if (this.isPlayerTauntCoolingDown(senderKey)) {
      this.ensureMatchTauntUiTimer();
      if (!this.refreshCurrentTauntHudInPlace("onlinePlay")) {
        this.renderOnlinePlayScreen();
      }
      return;
    }

    this.matchTauntPanelOpen = false;
    this.onlinePlayState = this.normalizeOnlinePlayState(
      await window.elemintz.multiplayer.sendTaunt({ line: safeLine })
    );
    this.startPlayerTauntCooldown(senderKey);
    if (!this.refreshCurrentTauntHudInPlace("onlinePlay")) {
      this.renderOnlinePlayScreen();
    }
  }

  randomChanceBetween(min, max) {
    return min + this.tauntRandom() * (max - min);
  }

  maybeEmitPveAiTaunt(eventKey) {
    if (!this.gameController || this.gameController.getViewModel()?.mode !== MATCH_MODE.PVE) {
      return false;
    }

    const lines = PVE_AI_TAUNT_LINES[eventKey] ?? [];
    if (!lines.length) {
      return false;
    }

    const now = this.getTauntNow();
    if (now < this.aiTauntCooldownUntil) {
      return false;
    }

    const chance = this.randomChanceBetween(AI_TAUNT_CHANCE_MIN, AI_TAUNT_CHANCE_MAX);
    if (this.tauntRandom() > chance) {
      return false;
    }

    const line = lines[Math.floor(this.tauntRandom() * lines.length)] ?? null;
    if (!line) {
      return false;
    }

    this.appendMatchTaunt({
      speaker: this.opponentDisplayName ?? "Elemental AI",
      text: line,
      kind: "ai"
    });
    this.aiLastTauntEventKey = eventKey;
    this.aiTauntCooldownUntil = now + this.randomChanceBetween(AI_TAUNT_COOLDOWN_MIN_MS, AI_TAUNT_COOLDOWN_MAX_MS);

    if (this.screenFlow === "game") {
      if (!this.refreshCurrentTauntHudInPlace("game")) {
        this.showGame();
      }
    }

    return true;
  }

  maybeEmitPveAiTauntForResult(result) {
    const vm = this.gameController?.getViewModel();
    if (!vm || vm.mode !== MATCH_MODE.PVE || !result) {
      return false;
    }

    if (result.status === "war_continues") {
      return this.maybeEmitPveAiTaunt("war_start");
    }

    if (result.status !== "resolved" && result.status !== "round_resolved") {
      return false;
    }

    if (result.round?.result === "p2") {
      if (vm.opponentHand.length <= 2) {
        return this.maybeEmitPveAiTaunt("near_victory");
      }

      return this.maybeEmitPveAiTaunt(Number(result.round?.warClashes ?? 0) > 0 ? "war_resolved" : "player_loss");
    }

    if (result.round?.result === "p1") {
      return this.maybeEmitPveAiTaunt("player_win");
    }

    return false;
  }

  registerScreens() {
    this.screenManager.register("login", loginScreen);
    this.screenManager.register("menu", menuScreen);
    this.screenManager.register("aiDifficulty", aiDifficultyScreen);
    this.screenManager.register("localSetup", localSetupScreen);
    this.screenManager.register("game", gameScreen);
    this.screenManager.register("pass", passScreen);
    this.screenManager.register("profile", profileScreen);
    this.screenManager.register("achievements", achievementsScreen);
    this.screenManager.register("dailyChallenges", dailyChallengesScreen);
    this.screenManager.register("cosmetics", cosmeticsScreen);
    this.screenManager.register("store", storeScreen);
    this.screenManager.register("settings", settingsScreen);
    this.screenManager.register("onlinePlay", onlinePlayScreen);
    this.screenManager.register("howToPlay", howToPlayScreen);
    this.screenManager.register("roadmap", roadmapScreen);
  }

  ensureNavigationShortcutHandler() {
    const documentRef = globalThis.document;
    if (this.navigationShortcutHandler || !documentRef?.addEventListener) {
      return false;
    }

    this.navigationShortcutHandler = (event) => {
      void this.handleNavigationShortcut(event);
    };
    documentRef.addEventListener("keydown", this.navigationShortcutHandler);
    return true;
  }

  isEditableTarget(target) {
    if (!target) {
      return false;
    }

    const tagName = String(target.tagName ?? "").toUpperCase();
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) {
      return true;
    }

    if (target.isContentEditable) {
      return true;
    }

    if (typeof target.closest === "function") {
      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'
        )
      );
    }

    return false;
  }

  isShortcutSuppressedTarget(target) {
    if (!target) {
      return false;
    }

    if (this.isEditableTarget(target)) {
      return true;
    }

    if (typeof target.closest !== "function") {
      return false;
    }

    return Boolean(
      target.closest(
        ".modal-overlay, [data-match-taunt-shell], [data-match-taunt-panel], [data-online-active-match-expressions], #feedback-category-select, #feedback-message-textarea, #feedback-include-debug-checkbox, .feedback-modal__field, .feedback-modal__checkbox-row"
      )
    );
  }

  shouldIgnoreNavigationShortcut(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) {
      return true;
    }

    const documentRef = globalThis.document;
    if (documentRef?.querySelector?.(".modal-overlay")) {
      return true;
    }
    const targets = [event.target, documentRef?.activeElement];
    return targets.some((target) => this.isShortcutSuppressedTarget(target));
  }

  isFeedbackShortcutTarget(target) {
    if (!target || typeof target.closest !== "function") {
      return false;
    }

    return Boolean(
      target.closest(
        "#feedback-category-select, #feedback-message-textarea, #feedback-include-debug-checkbox, .feedback-modal__field, .feedback-modal__checkbox-row"
      )
    );
  }

  getActiveModalTitle() {
    return String(globalThis.document?.querySelector?.(".modal-overlay .modal h3")?.textContent ?? "").trim();
  }

  hasUnsafeEscapeModalOpen() {
    const title = this.getActiveModalTitle();
    return [
      "Match Complete",
      "Gauntlet Victory!",
      "Reward Confirmation",
      "Confirmation Failed",
      "Reconnect to Online Match",
      "Request Quit",
      "Leave Match"
    ].includes(title);
  }

  isOnlinePlayLobbyState() {
    if (this.screenFlow !== "onlinePlay") {
      return false;
    }

    const room = this.onlinePlayState?.room ?? null;
    if (!room) {
      return true;
    }

    return String(room.status ?? "").trim().toLowerCase() === "waiting";
  }

  isOnlinePlayEscapeBlockedState() {
    return this.screenFlow === "onlinePlay" && !this.isOnlinePlayLobbyState();
  }

  getSafeBackAction() {
    switch (this.screenFlow) {
      case "store":
      case "cosmetics":
      case "achievements":
      case "dailyChallenges":
      case "roadmap":
      case "howToPlay":
      case "settings":
      case "aiDifficulty":
      case "localSetup":
      case "profile":
        return () => this.showMenu();
      case "onlinePlay":
        if (!this.isOnlinePlayLobbyState()) {
          return null;
        }
        return async () => {
          if (window.elemintz?.multiplayer?.disconnect) {
            await window.elemintz.multiplayer.disconnect();
          }
          this.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
        };
      case "login":
        if (globalThis.document?.getElementById?.("login-back-btn")) {
          return () => this.showLogin({ mode: "choice" });
        }
        if (globalThis.document?.getElementById?.("register-back-btn")) {
          return () => this.showLogin({ mode: "choice" });
        }
        return null;
      default:
        return null;
    }
  }

  getMenuHotkeyAction(key) {
    switch (key) {
      case "h":
        return () => this.showHowToPlay();
      case "p":
        return () => this.showAiDifficultySelect();
      case "l":
        return () => this.showLocalSetup();
      case "o":
        return () => this.showOnlinePlay();
      case "v":
        return () => this.showProfile();
      case "i":
        return () => this.showCosmetics();
      case "s":
        return () => this.showStore();
      case "a":
        return () => this.showAchievements();
      case "r":
        return () => this.showRoadmap();
      case "t":
        return () => this.showSettings();
      case "f":
        return () => this.showFeedbackModal();
      case "q":
        return () => this.logoutToLogin({ noticeMessage: "Signed out." });
      case "d":
        return () => this.showDailyChallenges();
      default:
        return null;
    }
  }

  async handleNavigationShortcut(event) {
    const key = String(event?.key ?? "").trim().toLowerCase();
    if (!key) {
      return;
    }

    if (key === "escape") {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (["game", "pass"].includes(this.screenFlow) || this.isOnlinePlayEscapeBlockedState()) {
        return;
      }

      const documentRef = globalThis.document;
      const escapeTarget = event.target ?? documentRef?.activeElement ?? null;
      if (this.isFeedbackShortcutTarget(escapeTarget)) {
        return;
      }

      if (this.isEditableTarget(escapeTarget)) {
        return;
      }

      const modalOpen = Boolean(documentRef?.querySelector?.(".modal-overlay"));
      if (modalOpen) {
        if (this.hasUnsafeEscapeModalOpen()) {
          return;
        }

        event.preventDefault?.();
        this.modalManager?.hide?.();
        return;
      }

      const backAction = this.getSafeBackAction();
      if (!backAction) {
        return;
      }

      event.preventDefault?.();
      await backAction();
      return;
    }

    if (this.screenFlow !== "menu" || this.shouldIgnoreNavigationShortcut(event)) {
      return;
    }

    const action = this.getMenuHotkeyAction(key);
    if (!action) {
      return;
    }

    event.preventDefault?.();
    await action();
  }

  clearPassTimer({ settle = true, result = { reason: "cancelled" } } = {}) {
    if (this.passTimerId) {
      clearInterval(this.passTimerId);
      this.passTimerId = null;
    }

    if (this.passKeyHandler && globalThis.document?.removeEventListener) {
      globalThis.document.removeEventListener("keydown", this.passKeyHandler);
      this.passKeyHandler = null;
    }

    if (settle && this.passCompletionResolve) {
      const resolve = this.passCompletionResolve;
      this.passCompletionResolve = null;
      resolve(result);
    }
  }

  clearDailyCountdown() {
    if (this.dailyResetCountdownId) {
      clearInterval(this.dailyResetCountdownId);
      this.dailyResetCountdownId = null;
    }
  }

  clearOnlineReconnectUiTimer() {
    if (this.onlineReconnectUiTimerId) {
      clearInterval(this.onlineReconnectUiTimerId);
      this.onlineReconnectUiTimerId = null;
    }
  }

  clearOnlineTurnTimerUi() {
    if (this.onlineTurnTimerUiId) {
      clearInterval(this.onlineTurnTimerUiId);
      this.onlineTurnTimerUiId = null;
    }
  }

  getOnlineRoleLabelFromState(state = this.onlinePlayState) {
    const room = state?.room ?? null;
    const socketId = state?.socketId ?? null;

    if (!room || !socketId) {
      return null;
    }

    if (room.host?.socketId === socketId) {
      return "Host";
    }

    if (room.guest?.socketId === socketId) {
      return "Guest";
    }

    return null;
  }

  getOnlineMoveSyncFromState(state = this.onlinePlayState) {
    const room = state?.room ?? null;
    const roleLabel = this.getOnlineRoleLabelFromState(state);
    const sync =
      room?.moveSync ??
      (room?.status === "full"
        ? {
            hostSubmitted: false,
            guestSubmitted: false,
            submittedCount: 0,
            bothSubmitted: false,
            updatedAt: null
          }
        : null);

    if (!room || room.status !== "full" || !sync) {
      return null;
    }

    const ownSubmitted =
      roleLabel === "Host"
        ? Boolean(sync.hostSubmitted)
        : roleLabel === "Guest"
          ? Boolean(sync.guestSubmitted)
          : false;

    return {
      submittedCount: Number(sync.submittedCount ?? 0),
      bothSubmitted: Boolean(sync.bothSubmitted),
      hostSubmitted: Boolean(sync.hostSubmitted),
      guestSubmitted: Boolean(sync.guestSubmitted),
      ownSubmitted
    };
  }

  getOnlineSelectableElementsFromState(state = this.onlinePlayState) {
    const room = state?.room ?? null;
    const roleLabel = this.getOnlineRoleLabelFromState(state);
    const hand =
      roleLabel === "Host"
        ? room?.hostHand ?? null
        : roleLabel === "Guest"
          ? room?.guestHand ?? null
          : null;

    if (!hand) {
      return [];
    }

    return ["fire", "earth", "wind", "water"].filter(
      (element) => Math.max(0, Number(hand?.[element] ?? 0) || 0) > 0
    );
  }

  canSubmitOnlineMoveFromState(state = this.onlinePlayState) {
    const room = state?.room ?? null;
    const sync = this.getOnlineMoveSyncFromState(state);

    if (String(state?.connectionStatus ?? "").trim().toLowerCase() !== "connected") {
      return false;
    }

    if (!room || room.status !== "full" || room.matchComplete) {
      return false;
    }

    if (room.disconnectState?.active || room.status === "paused" || room.status === "closing" || room.status === "expired") {
      return false;
    }

    if (!sync || sync.ownSubmitted || sync.bothSubmitted) {
      return false;
    }

    return this.getOnlineSelectableElementsFromState(state).length > 0;
  }

  getOnlineTurnTimerViewState(state = this.onlinePlayState, now = Date.now()) {
    const room = state?.room ?? null;
    const sync = this.getOnlineMoveSyncFromState(state);
    const turnTimer = room?.serverMatchState?.turnTimer ?? null;

    if (
      String(state?.connectionStatus ?? "").trim().toLowerCase() !== "connected" ||
      !room ||
      room.status !== "full" ||
      room.matchComplete ||
      room.disconnectState?.active ||
      !turnTimer?.active ||
      !turnTimer?.expiresAt ||
      sync?.ownSubmitted ||
      sync?.bothSubmitted ||
      this.getOnlineSelectableElementsFromState(state).length === 0
    ) {
      return {
        visible: false,
        label: "",
        lowTime: false
      };
    }

    const expiresAtMs = Date.parse(turnTimer.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return {
        visible: false,
        label: "",
        lowTime: false
      };
    }

    const secondsRemaining = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
    return {
      visible: true,
      label: `Time to choose: ${String(secondsRemaining).padStart(2, "0")}s`,
      lowTime: secondsRemaining <= 5
    };
  }

  getOnlineMatchTimerViewState(state = this.onlinePlayState, now = Date.now()) {
    const room = state?.room ?? null;
    const matchTimer = room?.serverMatchState?.matchTimer ?? room?.matchTimer ?? null;

    if (
      String(state?.connectionStatus ?? "").trim().toLowerCase() !== "connected" ||
      !room ||
      room.status !== "full" ||
      room.matchComplete ||
      room.disconnectState?.active ||
      !matchTimer?.active ||
      !matchTimer?.expiresAt
    ) {
      return {
        visible: false,
        label: "",
        lowTime: false
      };
    }

    const expiresAtMs = Date.parse(matchTimer.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return {
        visible: false,
        label: "",
        lowTime: false
      };
    }

    const totalSecondsRemaining = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
    const minutes = Math.floor(totalSecondsRemaining / 60);
    const seconds = totalSecondsRemaining % 60;
    return {
      visible: true,
      label: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
      lowTime: totalSecondsRemaining <= 60
    };
  }

  syncOnlineTurnTimerUi() {
    const turnShell = globalThis.document?.querySelector?.("[data-online-turn-timer-shell='true']");
    const turnLabel = globalThis.document?.querySelector?.("[data-online-turn-timer-label='true']");
    const matchShell = globalThis.document?.querySelector?.("[data-online-match-timer-shell='true']");
    const matchLabel = globalThis.document?.querySelector?.("[data-online-match-timer-label='true']");
    if ((!turnShell || !turnLabel) && (!matchShell || !matchLabel)) {
      return false;
    }

    const turnTimerView = this.getOnlineTurnTimerViewState();
    if (turnShell && turnLabel) {
      turnShell.classList.toggle("is-hidden", !turnTimerView.visible);
      turnShell.classList.toggle("is-low-time", Boolean(turnTimerView.lowTime && turnTimerView.visible));
      turnLabel.textContent = turnTimerView.visible ? turnTimerView.label : "";
    }

    const matchTimerView = this.getOnlineMatchTimerViewState();
    if (matchShell && matchLabel) {
      matchShell.classList.toggle("is-hidden", !matchTimerView.visible);
      matchShell.classList.toggle("is-low-time", Boolean(matchTimerView.lowTime && matchTimerView.visible));
      matchLabel.textContent = matchTimerView.visible ? matchTimerView.label : "";
    }

    return turnTimerView.visible || matchTimerView.visible;
  }

  ensureOnlineTurnTimerUi() {
    if (this.screenFlow !== "onlinePlay") {
      this.clearOnlineTurnTimerUi();
      return;
    }

    const visible = this.syncOnlineTurnTimerUi();
    if (!visible) {
      this.clearOnlineTurnTimerUi();
      return;
    }

    if (this.onlineTurnTimerUiId) {
      return;
    }

    this.onlineTurnTimerUiId = setInterval(() => {
      if (!this.syncOnlineTurnTimerUi()) {
        this.clearOnlineTurnTimerUi();
      }
    }, 250);
    this.onlineTurnTimerUiId?.unref?.();
  }

  async submitOnlineMove(move, { source = "manual" } = {}) {
    if (!window.elemintz?.multiplayer?.submitMove) {
      return null;
    }

    const safeMove = String(move ?? "").trim().toLowerCase();
    const legalMoves = this.getOnlineSelectableElementsFromState(this.onlinePlayState);

    if (!this.canSubmitOnlineMoveFromState(this.onlinePlayState) || !legalMoves.includes(safeMove)) {
      console.info("[OnlinePlay][Renderer] move ignored before submit bridge", {
        source,
        move: safeMove,
        legalMoves
      });
      return null;
    }

    if (this.onlineMoveSubmitPromise) {
      return this.onlineMoveSubmitPromise;
    }

    this.onlineMoveSubmitPromise = (async () => {
      try {
        console.info("[OnlinePlay][Renderer] AppController submitMove entered", {
          move: safeMove,
          source
        });
        const previousState = this.onlinePlayState;
        const nextState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.submitMove({ move: safeMove }));
        this.onlinePlayState = this.reconcileOnlinePlayRoundState(previousState, nextState);
        if (this.onlinePlayState?.latestRoundResult) {
          console.info("[OnlinePlay][Renderer] latest round result stored in renderer state", this.onlinePlayState.latestRoundResult);
        }
        if (this.onlinePlayState?.room?.matchComplete) {
          await this.refreshOnlineSettlementStateFromServer(this.onlinePlayState);
        }
        this.ensureOnlineReconnectUiTimer();
        this.renderOnlinePlayScreen();
      } finally {
        this.onlineMoveSubmitPromise = null;
      }
    })();

    return this.onlineMoveSubmitPromise;
  }

  getConfiguredTurnSeconds() {
    const configured = Number(this.settings?.gameplay?.timerSeconds);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : FALLBACK_SETTINGS.gameplay.timerSeconds;
  }

  getConfiguredAiDifficulty() {
    const configured = String(this.settings?.aiDifficulty ?? FALLBACK_SETTINGS.aiDifficulty);
    return ["easy", "normal", "hard"].includes(configured)
      ? configured
      : FALLBACK_SETTINGS.aiDifficulty;
  }

  getFeaturedRivalConfig(featuredRivalId = null) {
    const normalizedId = String(featuredRivalId ?? "").trim().toLowerCase();
    return FEATURED_RIVAL_CONFIGS[normalizedId] ?? null;
  }

  getCurrentPveOpponentName() {
    return (
      this.getCurrentGauntletRival()?.displayName ??
      this.getFeaturedRivalConfig(this.pveFeaturedRivalId)?.name ??
      this.opponentDisplayName ??
      "Elemental AI"
    );
  }

  showAiDifficultySelect() {
    this.clearTransientUiBeforeScreenTransition();
    this.screenFlow = "aiDifficulty";
    this.screenManager.show("aiDifficulty", {
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      selectedDifficulty: this.getConfiguredAiDifficulty(),
      selectedGauntletMode: Boolean(this.pveGauntletMode),
      selectedFeaturedRivalId: this.pveFeaturedRivalId,
      actions: {
        start: async ({ aiDifficulty, featuredRivalId, gauntletMode } = {}) => {
          this.startGame(MATCH_MODE.PVE, { aiDifficulty, featuredRivalId, gauntletMode });
        },
        back: () => this.showMenu()
      }
    });
  }

  getConfiguredAiOpponentStyle() {
    const configured = String(this.settings?.aiOpponentStyle ?? FALLBACK_SETTINGS.aiOpponentStyle);
    return ["default", "random"].includes(configured)
      ? configured
      : FALLBACK_SETTINGS.aiOpponentStyle;
  }

  createDefaultStoreViewState() {
    return {
      searchText: "",
      categories: new Set(["avatar", "background", "cardBack", "elementCardVariant", "title", "badge"]),
      rarities: new Set(["Common", "Rare", "Epic", "Legendary"]),
      elements: new Set(["fire", "water", "earth", "wind"]),
      collections: new Set(),
      showNewFirst: true
    };
  }

  buildStorePurchaseKey(type, cosmeticId) {
    const safeType = String(type ?? "").trim();
    const safeCosmeticId = String(cosmeticId ?? "").trim();
    return safeType && safeCosmeticId ? `${safeType}:${safeCosmeticId}` : null;
  }

  buildSafeCosmeticsPayload(cosmetics, profile = this.profile ?? {}) {
    const fallbackCatalog = getCosmeticCatalogForProfile(profile ?? {});
    const fallbackOwned = {
      avatar: Array.isArray(profile?.ownedCosmetics?.avatar) ? profile.ownedCosmetics.avatar : [],
      cardBack: Array.isArray(profile?.ownedCosmetics?.cardBack) ? profile.ownedCosmetics.cardBack : [],
      background: Array.isArray(profile?.ownedCosmetics?.background) ? profile.ownedCosmetics.background : [],
      elementCardVariant: Array.isArray(profile?.ownedCosmetics?.elementCardVariant)
        ? profile.ownedCosmetics.elementCardVariant
        : [],
      badge: Array.isArray(profile?.ownedCosmetics?.badge) ? profile.ownedCosmetics.badge : [],
      title: Array.isArray(profile?.ownedCosmetics?.title) ? profile.ownedCosmetics.title : []
    };
    const fallbackEquipped = {
      avatar: profile?.equippedCosmetics?.avatar ?? "default_avatar",
      cardBack: profile?.equippedCosmetics?.cardBack ?? "default_card_back",
      background: profile?.equippedCosmetics?.background ?? "default_background",
      elementCardVariant: {
        fire: profile?.equippedCosmetics?.elementCardVariant?.fire ?? "default_fire_card",
        water: profile?.equippedCosmetics?.elementCardVariant?.water ?? "default_water_card",
        earth: profile?.equippedCosmetics?.elementCardVariant?.earth ?? "default_earth_card",
        wind: profile?.equippedCosmetics?.elementCardVariant?.wind ?? "default_wind_card"
      },
      badge: profile?.equippedCosmetics?.badge ?? "none",
      title: profile?.equippedCosmetics?.title ?? "Initiate"
    };
    const fallbackLoadouts = Array.isArray(profile?.cosmeticLoadouts) ? profile.cosmeticLoadouts : [];
    const fallbackPreferences =
      profile?.cosmeticRandomizeAfterMatch && typeof profile.cosmeticRandomizeAfterMatch === "object"
        ? profile.cosmeticRandomizeAfterMatch
        : {};
    const source = cosmetics && typeof cosmetics === "object" ? cosmetics : {};
    const sourceSnapshot =
      source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
    const safeLoadouts = Array.isArray(source.loadouts)
      ? source.loadouts
      : Array.isArray(sourceSnapshot.loadouts)
        ? sourceSnapshot.loadouts
        : fallbackLoadouts;

    return {
      ...source,
      catalog: source.catalog && typeof source.catalog === "object" ? source.catalog : fallbackCatalog,
      owned:
        source.owned && typeof source.owned === "object"
          ? source.owned
          : sourceSnapshot.owned && typeof sourceSnapshot.owned === "object"
            ? sourceSnapshot.owned
            : fallbackOwned,
      equipped:
        source.equipped && typeof source.equipped === "object"
          ? source.equipped
          : sourceSnapshot.equipped && typeof sourceSnapshot.equipped === "object"
            ? sourceSnapshot.equipped
            : fallbackEquipped,
      loadouts: safeLoadouts,
      preferences:
        source.preferences && typeof source.preferences === "object"
          ? source.preferences
          : sourceSnapshot.preferences && typeof sourceSnapshot.preferences === "object"
            ? sourceSnapshot.preferences
            : fallbackPreferences,
      snapshot: {
        ...sourceSnapshot,
        owned:
          sourceSnapshot.owned && typeof sourceSnapshot.owned === "object"
            ? sourceSnapshot.owned
            : source.owned && typeof source.owned === "object"
              ? source.owned
              : fallbackOwned,
        equipped:
          sourceSnapshot.equipped && typeof sourceSnapshot.equipped === "object"
            ? sourceSnapshot.equipped
            : source.equipped && typeof source.equipped === "object"
              ? source.equipped
              : fallbackEquipped,
        loadouts: Array.isArray(sourceSnapshot.loadouts) ? sourceSnapshot.loadouts : safeLoadouts,
        preferences:
          sourceSnapshot.preferences && typeof sourceSnapshot.preferences === "object"
            ? sourceSnapshot.preferences
            : source.preferences && typeof source.preferences === "object"
              ? source.preferences
              : fallbackPreferences
      }
    };
  }

  ensureStoreViewState() {
    if (!this.storeViewState) {
      this.storeViewState = this.createDefaultStoreViewState();
    }

    this.storeViewState.searchText = String(this.storeViewState.searchText ?? "");
    this.storeViewState.categories =
      this.storeViewState.categories instanceof Set
        ? this.storeViewState.categories
        : new Set(this.storeViewState.categories ?? this.createDefaultStoreViewState().categories);
    this.storeViewState.rarities =
      this.storeViewState.rarities instanceof Set
        ? this.storeViewState.rarities
        : new Set(this.storeViewState.rarities ?? this.createDefaultStoreViewState().rarities);
    this.storeViewState.elements =
      this.storeViewState.elements instanceof Set
        ? this.storeViewState.elements
        : new Set(this.storeViewState.elements ?? this.createDefaultStoreViewState().elements);
    this.storeViewState.collections =
      this.storeViewState.collections instanceof Set
        ? this.storeViewState.collections
        : new Set(this.storeViewState.collections ?? this.createDefaultStoreViewState().collections);
    this.storeViewState.showNewFirst =
      typeof this.storeViewState.showNewFirst === "boolean"
        ? this.storeViewState.showNewFirst
        : this.createDefaultStoreViewState().showNewFirst;

    return this.storeViewState;
  }

  buildFeaturedStoreRotationContext(rotation, store, profileForFeaturedCatalog = null) {
    if (!rotation || !store?.catalog) {
      return null;
    }

    const featuredCatalog = profileForFeaturedCatalog
      ? buildFeaturedRotationCatalog(profileForFeaturedCatalog, {
          allowLimitedCosmeticIds: rotation.allowLimitedCosmeticIds ?? []
        })
      : store.catalog;
    const catalogEntriesById = new Map();
    for (const [type, items] of Object.entries(featuredCatalog ?? {})) {
      for (const item of items ?? []) {
        const id = String(item?.id ?? "").trim();
        if (!id || catalogEntriesById.has(id)) {
          continue;
        }
        catalogEntriesById.set(id, { type, item });
      }
    }

    const featuredItems = [];
    for (const featuredId of Array.isArray(rotation.featuredCosmeticIds) ? rotation.featuredCosmeticIds : []) {
      const match = catalogEntriesById.get(String(featuredId ?? "").trim());
      if (!match) {
        continue;
      }

      featuredItems.push({
        id: String(featuredId ?? "").trim(),
        type: match.type,
        item: match.item
      });
    }

    if (featuredItems.length === 0) {
      return null;
    }

    return {
      activeRotationId: String(rotation.activeRotationId ?? "").trim() || null,
      title: String(rotation.title ?? "").trim() || "Featured Rotation",
      message: String(rotation.message ?? "").trim() || "",
      startsAt: rotation.startsAt ?? null,
      endsAt: rotation.endsAt ?? null,
      allowLimitedCosmeticIds: Array.isArray(rotation.allowLimitedCosmeticIds)
        ? rotation.allowLimitedCosmeticIds.map((id) => String(id ?? "").trim()).filter(Boolean)
        : [],
      featuredItems
    };
  }

  async loadFeaturedStoreRotation({ preferCache = true } = {}) {
    if (!this.hasMultiplayerProfileAccess() || !window.elemintz?.multiplayer?.getActiveShopRotation) {
      this.storeFeaturedRotationCache = null;
      this.storeFeaturedRotationCacheUsername = null;
      return null;
    }

    const safeUsername = String(this.username ?? "").trim() || null;
    if (
      preferCache &&
      this.storeFeaturedRotationCache &&
      this.storeFeaturedRotationCacheUsername === safeUsername
    ) {
      return this.storeFeaturedRotationCache;
    }

    try {
      const rotation = await window.elemintz.multiplayer.getActiveShopRotation({
        username: this.username
      });
      this.storeFeaturedRotationCache = rotation ?? null;
      this.storeFeaturedRotationCacheUsername = safeUsername;
      return rotation;
    } catch (error) {
      console.warn("[Store][Renderer] featured rotation load failed", {
        username: this.username,
        message: error?.message ?? String(error)
      });
      this.storeFeaturedRotationCache = null;
      this.storeFeaturedRotationCacheUsername = safeUsername;
      return null;
    }
  }

  ensureCosmeticsViewState() {
    if (!this.cosmeticsViewState) {
      this.cosmeticsViewState = createDefaultCategoryViewState();
    }

    const defaults = createDefaultCategoryViewState();
    this.cosmeticsViewState.categories =
      this.cosmeticsViewState.categories instanceof Set
        ? this.cosmeticsViewState.categories
        : new Set(this.cosmeticsViewState.categories ?? defaults.categories);
    this.cosmeticsViewState.rarities =
      this.cosmeticsViewState.rarities instanceof Set
        ? this.cosmeticsViewState.rarities
        : new Set(this.cosmeticsViewState.rarities ?? defaults.rarities);
    this.cosmeticsViewState.elements =
      this.cosmeticsViewState.elements instanceof Set
        ? this.cosmeticsViewState.elements
        : new Set(this.cosmeticsViewState.elements ?? defaults.elements);
    this.cosmeticsViewState.collections =
      this.cosmeticsViewState.collections instanceof Set
        ? this.cosmeticsViewState.collections
        : new Set(this.cosmeticsViewState.collections ?? defaults.collections);
    this.cosmeticsViewState.showNewFirst =
      typeof this.cosmeticsViewState.showNewFirst === "boolean"
        ? this.cosmeticsViewState.showNewFirst
        : defaults.showNewFirst;

    return this.cosmeticsViewState;
  }

  chooseRandomCatalogItem(type, { excludeIds = [] } = {}) {
    const catalog = Array.isArray(COSMETIC_CATALOG[type]) ? COSMETIC_CATALOG[type] : [];
    const exclusionSet = new Set(excludeIds);
    const filtered = catalog.filter((item) => !exclusionSet.has(item.id));
    const pool = filtered.length > 0 ? filtered : catalog;

    if (pool.length === 0) {
      return null;
    }

    const index = Math.floor(Math.random() * pool.length);
    return pool[index] ?? pool[0];
  }

  getDefaultElementCardVariantMap() {
    return {
      ...ONLINE_DEFAULT_EQUIPPED_COSMETICS.elementCardVariant
    };
  }

  normalizeElementCardVariantMap(selection = null, fallbackMap = this.getDefaultElementCardVariantMap()) {
    return Object.fromEntries(
      ELEMENT_CARD_VARIANT_ELEMENTS.map((element) => {
        const fallbackId = String(
          fallbackMap?.[element] ?? ONLINE_DEFAULT_EQUIPPED_COSMETICS.elementCardVariant[element]
        );
        const requestedId = String(selection?.[element] ?? "").trim();
        if (
          requestedId &&
          (requestedId.includes("/") ||
            requestedId.endsWith(".png") ||
            requestedId.endsWith(".jpg") ||
            requestedId.endsWith(".jpeg"))
        ) {
          return [element, requestedId];
        }

        const definition = requestedId ? getCosmeticDefinition("elementCardVariant", requestedId) : null;
        const resolvedId = definition?.element === element ? requestedId : fallbackId;
        return [element, resolvedId];
      })
    );
  }

  chooseRandomElementCardVariantMap() {
    const fallbackMap = this.getDefaultElementCardVariantMap();

    return Object.fromEntries(
      ELEMENT_CARD_VARIANT_ELEMENTS.map((element) => {
        const variants = (Array.isArray(COSMETIC_CATALOG.elementCardVariant)
          ? COSMETIC_CATALOG.elementCardVariant
          : []
        ).filter((item) => item?.element === element && item?.id);
        const index = variants.length > 0 ? Math.floor(Math.random() * variants.length) : -1;
        const chosenId = variants[index]?.id ?? fallbackMap[element];
        return [element, chosenId];
      })
    );
  }

  getGauntletRivalCatalog() {
    return listGauntletRivals();
  }

  getCurrentGauntletRival() {
    return this.pveGauntletMode
      ? resolveGauntletRivalById(this.gauntletRunState?.currentRivalId ?? null)
      : null;
  }

  buildShuffledGauntletBag(excludedFirstRivalId = null) {
    const rivalIds = this.getGauntletRivalCatalog().map((rival) => rival.id);
    const bag = shuffleList(rivalIds, this.gauntletRandom);
    const excluded = String(excludedFirstRivalId ?? "").trim().toLowerCase() || null;

    if (excluded && bag.length > 1 && bag[0] === excluded) {
      const swapIndex = bag.findIndex((rivalId) => rivalId !== excluded);
      if (swapIndex > 0) {
        [bag[0], bag[swapIndex]] = [bag[swapIndex], bag[0]];
      }
    }

    return bag;
  }

  pullNextGauntletRival({ rivalBag = [], lastRivalId = null } = {}) {
    let nextBag = Array.isArray(rivalBag) ? [...rivalBag] : [];
    if (!nextBag.length) {
      nextBag = this.buildShuffledGauntletBag(lastRivalId);
    }

    const excluded = String(lastRivalId ?? "").trim().toLowerCase() || null;
    if (excluded && nextBag.length > 1 && nextBag[0] === excluded) {
      const swapIndex = nextBag.findIndex((rivalId) => rivalId !== excluded);
      if (swapIndex > 0) {
        [nextBag[0], nextBag[swapIndex]] = [nextBag[swapIndex], nextBag[0]];
      }
    }

    const nextRivalId = nextBag.shift() ?? null;
    const nextRival = resolveGauntletRivalById(nextRivalId, null);
    return {
      rival: nextRival,
      rivalId: nextRival?.id ?? null,
      rivalBag: nextBag
    };
  }

  clearGauntletRunState() {
    this.pveGauntletMode = false;
    this.clearGauntletLocalMatchSessionState();
    this.gauntletRunState = createDefaultGauntletRunState();
    this.pendingGauntletVictoryPayload = null;
    this.pendingGauntletContinuation = null;
    this.pendingGauntletContinuationRequiresConfirm = false;
  }

  async recordGauntletProfileStats({
    runStarted = false,
    matchWon = false,
    runEndedWithLoss = false,
    currentStreak = 0,
    claimedMilestoneStreaks = [],
    matchState = null,
    latestBattleContext = null,
    battleReportAlreadyRecorded = false,
    perspective = "p1",
    nowMs = Date.now()
  } = {}) {
    if (!this.username) {
      return null;
    }

    const multiplayerRecorder =
      this.hasAuthenticatedMultiplayerSessionForUsername(this.username) &&
      typeof globalThis.window?.elemintz?.multiplayer?.recordGauntletStats === "function"
        ? globalThis.window.elemintz.multiplayer.recordGauntletStats
        : null;

    if (multiplayerRecorder) {
      const gauntletSession = await this.resolveGauntletLocalMatchSession();
      const result = await multiplayerRecorder({
        username: this.username,
        runStarted,
        matchWon,
        runEndedWithLoss,
        currentStreak,
        claimedMilestoneStreaks,
        matchState,
        latestBattleContext,
        battleReportAlreadyRecorded,
        perspective,
        nowMs,
        localMatchSessionId: gauntletSession?.sessionId ?? this.gauntletRunState?.sessionId ?? null
      });

      if (result?.snapshot) {
        this.applyServerProfileSnapshot(result.snapshot, {
          fallbackProfile: this.profile ?? null
        });
      } else if (result?.profile) {
        this.profile = result.profile;
      }

      if (result?.gauntletSession) {
        const sessionStatus = String(result.gauntletSession.status ?? "").trim().toLowerCase() || null;
        this.currentGauntletLocalMatchSession = result.gauntletSession;
        this.gauntletRunState = {
          ...this.gauntletRunState,
          sessionId:
            sessionStatus === "active" ? result.gauntletSession.sessionId : this.gauntletRunState?.sessionId ?? null,
          previousSessionId:
            sessionStatus === "completed" ? result.gauntletSession.sessionId : this.gauntletRunState?.previousSessionId ?? null,
          claimedMilestoneStreaks: Array.isArray(result?.claimedMilestoneStreaks)
            ? [...result.claimedMilestoneStreaks]
            : this.gauntletRunState?.claimedMilestoneStreaks ?? []
        };
      }

      return result?.snapshot ? { ...result, profile: this.profile } : result ?? null;
    }

    const localRecorder = globalThis.window?.elemintz?.state?.recordGauntletStats;
    if (typeof localRecorder !== "function") {
      return null;
    }

    const result = await localRecorder({
      username: this.username,
      runStarted,
      matchWon,
      runEndedWithLoss,
      currentStreak,
      claimedMilestoneStreaks,
      matchState,
      latestBattleContext,
      battleReportAlreadyRecorded,
      perspective,
      nowMs
    });

    if (result?.profile) {
      this.profile = result.profile;
    }

    return result ?? null;
  }

  startFreshGauntletRun() {
    const { rival: firstRival, rivalBag } = this.pullNextGauntletRival();
    this.pveGauntletMode = Boolean(firstRival);
    this.clearGauntletLocalMatchSessionState();
    this.gauntletRunState = {
      active: Boolean(firstRival),
      sessionId: null,
      previousSessionId: null,
      currentStreak: 0,
      currentRivalIndex: firstRival
        ? Math.max(0, this.getGauntletRivalCatalog().findIndex((rival) => rival.id === firstRival.id))
        : -1,
      currentRivalId: firstRival?.id ?? null,
      rivalBag,
      lastRivalId: null,
      defeatedRivalIds: [],
      claimedMilestoneStreaks: [],
      lastResult: null
    };
    return firstRival;
  }

  continueGauntletRunWithRival(gauntletRivalId = null) {
    const rivals = this.getGauntletRivalCatalog();
    const fallbackRival = rivals[0] ?? null;
    const resolvedRival = resolveGauntletRivalById(gauntletRivalId, fallbackRival?.id ?? null);
    const resolvedIndex = resolvedRival
      ? Math.max(
          0,
          rivals.findIndex((rival) => rival.id === resolvedRival.id)
        )
      : -1;
    this.pveGauntletMode = Boolean(resolvedRival);
    this.gauntletRunState = {
      ...createDefaultGauntletRunState(),
      ...this.gauntletRunState,
      active: Boolean(resolvedRival),
      sessionId: null,
      currentRivalIndex: resolvedIndex,
      currentRivalId: resolvedRival?.id ?? null
    };
    return resolvedRival;
  }

  advanceGauntletRunStateAfterWin() {
    const rivals = this.getGauntletRivalCatalog();
    if (!rivals.length) {
      this.clearGauntletRunState();
      return null;
    }

    const currentRivalId = this.gauntletRunState?.currentRivalId ?? null;
    const { rival: nextRival, rivalBag } = this.pullNextGauntletRival({
      rivalBag: this.gauntletRunState?.rivalBag ?? [],
      lastRivalId: currentRivalId
    });
    const nextIndex = nextRival
      ? Math.max(0, rivals.findIndex((rival) => rival.id === nextRival.id))
      : -1;

    this.gauntletRunState = {
      active: true,
      sessionId: null,
      previousSessionId: this.gauntletRunState?.sessionId ?? null,
      currentStreak: Math.max(0, Number(this.gauntletRunState?.currentStreak ?? 0)) + 1,
      currentRivalIndex: nextIndex,
      currentRivalId: nextRival?.id ?? null,
      rivalBag,
      lastRivalId: currentRivalId,
      defeatedRivalIds: [
        ...(Array.isArray(this.gauntletRunState?.defeatedRivalIds)
          ? this.gauntletRunState.defeatedRivalIds
          : []),
        currentRivalId
      ],
      claimedMilestoneStreaks: Array.isArray(this.gauntletRunState?.claimedMilestoneStreaks)
        ? [...this.gauntletRunState.claimedMilestoneStreaks]
        : [],
      lastResult: "win"
    };

    return nextRival ?? null;
  }

  endGauntletRun(result = "ended") {
    this.gauntletRunState = {
      ...this.gauntletRunState,
      active: false,
      lastResult: result
    };
    this.pendingGauntletVictoryPayload = null;
    this.pendingGauntletContinuation = null;
    this.pendingGauntletContinuationRequiresConfirm = false;
  }

  captureGauntletCompletionContext() {
    const runState = this.gauntletRunState
      ? {
          ...this.gauntletRunState,
          rivalBag: Array.isArray(this.gauntletRunState.rivalBag) ? [...this.gauntletRunState.rivalBag] : [],
          defeatedRivalIds: Array.isArray(this.gauntletRunState.defeatedRivalIds)
            ? [...this.gauntletRunState.defeatedRivalIds]
            : [],
          claimedMilestoneStreaks: Array.isArray(this.gauntletRunState.claimedMilestoneStreaks)
            ? [...this.gauntletRunState.claimedMilestoneStreaks]
            : []
        }
      : null;
    const activeGauntletRival = this.getCurrentGauntletRival();
    return {
      isGauntletMatch: Boolean(this.pveGauntletMode && runState?.active),
      runState,
      rivalName:
        activeGauntletRival?.displayName ??
        (typeof this.getCurrentPveOpponentName === "function" ? this.getCurrentPveOpponentName() : "") ??
        ""
    };
  }

  handleGauntletMatchCompletion(match, completionContext = null) {
    const effectiveRunState = completionContext?.runState ?? this.gauntletRunState;
    const isGauntletMatch =
      completionContext?.isGauntletMatch ?? Boolean(this.pveGauntletMode && effectiveRunState?.active);
    if (!isGauntletMatch || !effectiveRunState?.active) {
      return { handled: false };
    }

    if (match?.winner === "p1") {
      const nextRival = this.advanceGauntletRunStateAfterWin();
      if (!nextRival) {
        this.endGauntletRun("win");
        return { handled: false };
      }

      this.pendingGauntletContinuation = {
        mode: MATCH_MODE.PVE,
        options: {
          gauntletMode: true,
          gauntletContinue: true,
          gauntletRivalId: nextRival.id
        }
      };
      this.pendingGauntletContinuationRequiresConfirm = true;
      return {
        handled: true,
        type: "victory",
        nextRival,
        streak: Math.max(0, Number(this.gauntletRunState?.currentStreak ?? 0))
      };
    }

    const result =
      match?.winner === "draw"
        ? "draw"
        : String(match?.endReason ?? "").trim().toLowerCase() === "quit_forfeit"
            ? "quit_forfeit"
            : "loss";
    const rivalName =
      completionContext?.rivalName ??
      this.getCurrentGauntletRival()?.displayName ??
      (typeof this.getCurrentPveOpponentName === "function" ? this.getCurrentPveOpponentName() : "") ??
      "";
    const finalStreak = Math.max(0, Number(effectiveRunState?.currentStreak ?? 0));
    const rivalsDefeated = Array.isArray(effectiveRunState?.defeatedRivalIds)
      ? effectiveRunState.defeatedRivalIds.length
      : 0;
    this.endGauntletRun(result);
    return {
      handled: false,
      type: "ended",
      result,
      showSummary: result !== "quit_forfeit",
      finalStreak,
      rivalsDefeated,
      rivalLabel: result === "loss" ? "Lost To" : "Final Rival",
      rivalName
    };
  }

  buildPveOpponentStyle(featuredRivalId = this.pveFeaturedRivalId) {
    const gauntletRival = this.getCurrentGauntletRival();
    if (gauntletRival) {
      return {
        gauntletRivalId: gauntletRival.id,
        name: gauntletRival.displayName,
        avatarPath: gauntletRival.avatarPath,
        titleId: null,
        titleName: gauntletRival.title,
        titleIconPath: null,
        badgeId: "none",
        cardBackId: "default_card_back",
        elementCardVariant: this.chooseRandomElementCardVariantMap()
      };
    }

    const featuredRival = this.getFeaturedRivalConfig(featuredRivalId);
    if (featuredRival) {
      return {
        featuredRivalId: featuredRival.id,
        avatarPath: featuredRival.avatarPath,
        titleId: null,
        titleName: featuredRival.titleName,
        titleIconPath: featuredRival.titleIconPath,
        badgePath: featuredRival.badgePath,
        cardBackId: featuredRival.cardBackPath,
        backgroundPath: featuredRival.backgroundPath,
        elementCardVariant: {
          ...featuredRival.elementCardVariant
        }
      };
    }

    if (this.getConfiguredAiOpponentStyle() !== "random") {
      return {
        avatarId: "default_avatar",
        titleId: null,
        titleName: "Arena Rival",
        badgeId: "none",
        cardBackId: "default_card_back",
        elementCardVariant: this.getDefaultElementCardVariantMap()
      };
    }

    const avatar = this.chooseRandomCatalogItem("avatar", { excludeIds: ["default_avatar"] });
    const title = this.chooseRandomCatalogItem("title", { excludeIds: ["Initiate"] });
    const badge = this.chooseRandomCatalogItem("badge", { excludeIds: ["none"] });
    const cardBack = this.chooseRandomCatalogItem("cardBack", { excludeIds: ["default_card_back"] });

    return {
      avatarId: avatar?.id ?? "default_avatar",
      titleId: title?.id ?? null,
      titleName: getCosmeticDisplayName("title", title?.id, title?.name ?? "Arena Rival"),
      badgeId: badge?.id ?? "none",
      cardBackId: cardBack?.id ?? "default_card_back",
      elementCardVariant: this.chooseRandomElementCardVariantMap()
    };
  }

  resolvePveOpponentStyle() {
    if (!this.pveOpponentStyle) {
      this.pveOpponentStyle = this.buildPveOpponentStyle();
    }

    return this.pveOpponentStyle;
  }

  formatDuration(ms) {
    const safe = Math.max(0, Number(ms) || 0);
    const totalMinutes = Math.floor(safe / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  formatWeeklyDuration(ms) {
    const safe = Math.max(0, Number(ms) || 0);
    const totalMinutes = Math.floor(safe / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const remainderMinutes = totalMinutes - days * 24 * 60;
    const hours = Math.floor(remainderMinutes / 60);
    const minutes = remainderMinutes % 60;

    if (days > 0) {
      return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  formatPassTimerLabel(secondsLeft) {
    return `Time Remaining: ${secondsLeft ?? 30}s`;
  }

  formatReconnectCountdown(msRemaining) {
    const safeSeconds = Math.max(0, Math.ceil(Math.max(0, Number(msRemaining ?? 0)) / 1000));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  updatePassCountdown(secondsLeft) {
    const timerLabel = globalThis.document?.getElementById?.("pass-timer-label");
    if (!timerLabel) {
      return false;
    }

    timerLabel.textContent = this.formatPassTimerLabel(secondsLeft);
    return true;
  }

  async waitForRevealSoundSpacing(shouldWait) {
    if (!shouldWait) {
      return;
    }

    await delay(1000);
  }

  formatDailyLoginStatus(status) {
    if (!status) {
      return {
        stateLabel: "Checking Daily Login Streak...",
        detailLabel: "",
        resetLabel: "--:--"
      };
    }

    const safeCurrentStreakDay = getSafeDailyLoginStreakDay(status.streakDay);
    const safeLastClaimDate = String(status.lastDailyLoginClaimDate ?? "").trim();
    const previousWindowKey = getPreviousDailyLoginWindowKey(status.nowMs ?? Date.now());
    const upcomingStreakDay =
      safeLastClaimDate && safeLastClaimDate === previousWindowKey
        ? safeCurrentStreakDay >= DAILY_LOGIN_STREAK_MAX_DAY
          ? 1
          : Math.max(1, safeCurrentStreakDay + 1)
        : 1;
    const safeResetLabel = this.formatDuration(status.msUntilReset);

    if (status.eligible) {
      return {
        stateLabel: "Daily Login Streak: Ready",
        detailLabel: `Day ${upcomingStreakDay} of ${DAILY_LOGIN_STREAK_MAX_DAY}`,
        previewLines:
          upcomingStreakDay === DAILY_LOGIN_STREAK_MAX_DAY
            ? [...DAY_7_DAILY_LOGIN_PREVIEW_LINES]
            : [],
        resetLabel: safeResetLabel
      };
    }

    return {
      stateLabel: `Daily Login Streak: Day ${Math.max(1, safeCurrentStreakDay || 1)} of ${DAILY_LOGIN_STREAK_MAX_DAY}`,
      detailLabel: `Already claimed today · Next reset: ${safeResetLabel}`,
      resetLabel: safeResetLabel
    };
  }

  async ensureDailyLoginAutoClaim({ showToasts = true, requestKey = null } = {}) {
    if (!this.username) {
      return null;
    }

    const effectiveKey = requestKey ?? `user:${this.username}`;
    const sessionGateKey = `user:${String(this.username ?? "").trim()}`;
    if (this.dailyLoginAutoClaimSessionGateKey === sessionGateKey) {
      console.info("[DailyLogin][Renderer] skip duplicate auto-claim", {
        username: this.username,
        requestKey: effectiveKey,
        sessionGateKey,
        inFlight: Boolean(this.dailyLoginAutoClaimPromise)
      });
      return this.dailyLoginAutoClaimPromise;
    }

    if (this.dailyLoginAutoClaimKey === effectiveKey) {
      console.info("[DailyLogin][Renderer] skip duplicate auto-claim", {
        username: this.username,
        requestKey: effectiveKey,
        inFlight: Boolean(this.dailyLoginAutoClaimPromise)
      });
      return this.dailyLoginAutoClaimPromise;
    }

    this.dailyLoginAutoClaimKey = effectiveKey;
    this.dailyLoginAutoClaimSessionGateKey = sessionGateKey;
    const claimPromise = this.claimDailyLoginRewardFor(this.username, { showToasts });
    this.dailyLoginAutoClaimPromise = claimPromise;
    this.dailyLoginAutoClaimStartedAt = Date.now();
    let reward = null;

    try {
      reward = await claimPromise;
    } finally {
      if (
        this.dailyLoginAutoClaimKey === effectiveKey &&
        this.dailyLoginAutoClaimPromise === claimPromise
      ) {
        this.dailyLoginAutoClaimPromise = null;
        this.dailyLoginAutoClaimStartedAt = 0;
      }
    }

    if (reward?.profile) {
      const nextRewardProfile =
        this.hasMultiplayerProfileAccess() && this.profile
          ? {
              ...reward.profile,
              username: this.profile.username ?? reward.profile.username ?? this.username,
              wins: this.profile.wins ?? reward.profile.wins ?? 0,
              losses: this.profile.losses ?? reward.profile.losses ?? 0,
              gamesPlayed: this.profile.gamesPlayed ?? reward.profile.gamesPlayed ?? 0,
              warsEntered: this.profile.warsEntered ?? reward.profile.warsEntered ?? 0,
              warsWon: this.profile.warsWon ?? reward.profile.warsWon ?? 0,
              cardsCaptured: this.profile.cardsCaptured ?? reward.profile.cardsCaptured ?? 0,
              modeStats: this.profile.modeStats ?? reward.profile.modeStats ?? null,
              equippedCosmetics:
                this.profile.equippedCosmetics ?? reward.profile.equippedCosmetics ?? null,
              ownedCosmetics: this.profile.ownedCosmetics ?? reward.profile.ownedCosmetics ?? null,
              cosmeticLoadouts:
                this.profile.cosmeticLoadouts ?? reward.profile.cosmeticLoadouts ?? null,
              cosmeticRandomizeAfterMatch:
                this.profile.cosmeticRandomizeAfterMatch ??
                reward.profile.cosmeticRandomizeAfterMatch ??
                null
            }
          : reward.profile;

      this.profile = this.mergeSeenAnnouncementsIntoProfile(nextRewardProfile, this.profile);
      if (this.hasMultiplayerProfileAccess() && this.profile) {
        this.username = this.profile?.username ?? this.username;
      }
    }

    return reward;
  }

  renderMenuScreen() {
    const dailyLogin = this.formatDailyLoginStatus(this.dailyChallenges?.dailyLogin);

    this.screenManager.show("menu", {
      username: this.username,
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      announcement: this.menuAnnouncement,
      boostEvent: this.menuBoostEvent,
      dailyChallenges: this.dailyChallenges
        ? {
            dailyLogin,
            daily: {
              ...this.dailyChallenges.daily,
              resetLabel: this.formatDuration(this.dailyChallenges.daily.msUntilReset)
            },
            weekly: {
              ...this.dailyChallenges.weekly,
              resetLabel: this.formatWeeklyDuration(this.dailyChallenges.weekly.msUntilReset)
            }
          }
        : null,
      dailyElementChest: this.buildDailyElementChestMenuView(),
      actions: {
        startPveGame: () => this.showAiDifficultySelect(),
        startLocalGame: () => this.showLocalSetup(),
        openOnlinePlay: async () => this.showOnlinePlay(),
        openProfile: async () => this.showProfile(),
        openAchievements: async () => this.showAchievements(),
        openDailyElementChest: async () => this.showDailyElementChestModal(),
        openDailyChallenges: async () => this.showDailyChallenges(),
        openCosmetics: async () => this.showCosmetics(),
        openStore: async () => this.showStore(),
        openRoadmap: () => this.showRoadmap(),
        openSettings: async () => this.showSettings(),
        openHowToPlay: () => this.showHowToPlay(),
        openFeedback: () => this.showFeedbackModal(),
        dismissAnnouncement: async (id) => this.dismissMenuAnnouncement(id),
        switchAccount: async () => this.logoutToLogin({ noticeMessage: "Signed out. Sign in with another account." }),
        logout: async () => this.logoutToLogin({ noticeMessage: "Signed out." })
      }
    });
  }

  hasDailyElementChestApiAccess() {
    return Boolean(
      this.username &&
      globalThis.window?.elemintz?.multiplayer?.getDailyElementChestStatus &&
      globalThis.window?.elemintz?.multiplayer?.openDailyElementChest
    );
  }

  formatDailyElementChestCountdown(nextFreeResetAt) {
    const expiresAtMs = Date.parse(String(nextFreeResetAt ?? "").trim());
    if (!Number.isFinite(expiresAtMs)) {
      return "--";
    }

    const remainingMs = Math.max(0, expiresAtMs - Date.now());
    const totalMinutes = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  buildDailyElementChestMenuView() {
    if (!this.hasDailyElementChestApiAccess()) {
      return {
        loading: false,
        canOpenFree: false,
        nextFreeLabel: "--",
        paidOpenCost: 100
      };
    }

    if (!this.dailyElementChestStatus) {
      return {
        loading: true,
        canOpenFree: false,
        nextFreeLabel: "--",
        paidOpenCost: 100
      };
    }

    return {
      loading: false,
      canOpenFree: this.dailyElementChestStatus.canOpenFree === true,
      nextFreeLabel: this.formatDailyElementChestCountdown(this.dailyElementChestStatus.nextFreeResetAt),
      paidOpenCost: this.dailyElementChestStatus.paidOpenCost ?? 100,
      isPoolComplete: this.dailyElementChestStatus.collectionProgress?.isComplete === true
    };
  }

  buildDailyElementChestModalView() {
    const status = this.dailyElementChestStatus ?? null;
    const pity = status?.pity ?? status?.dailyElementChest?.pity ?? {};
    const epicProgress = Math.min(10, Math.max(0, Number(pity.opensSinceEpicPlus ?? 0) || 0));
    const legendaryProgress = Math.min(30, Math.max(0, Number(pity.opensSinceLegendary ?? 0) || 0));
    const result = this.dailyElementChestLastResult ?? null;
    const rewardPreview = this.buildDailyElementChestRewardPreview(result);
    let resultDisplayName = "";
    if (result?.cosmetic?.type && result?.cosmetic?.cosmeticId) {
      resultDisplayName =
        getCosmeticDisplayName(result.cosmetic.type, result.cosmetic.cosmeticId) ??
        result.cosmetic.cosmeticId;
    }

    return {
      loading: !status,
      canOpenFree: status?.canOpenFree === true,
      nextFreeLabel: this.formatDailyElementChestCountdown(status?.nextFreeResetAt),
      paidOpenCost: status?.paidOpenCost ?? 100,
      tokens: status?.tokens ?? this.profile?.tokens ?? 0,
      odds: status?.odds ?? {},
      poolSummary: status?.poolSummary ?? {},
      collectionProgress: status?.collectionProgress ?? null,
      epicProgressLabel: `${epicProgress} / 10`,
      legendaryProgressLabel: `${legendaryProgress} / 30`,
      openInFlight: this.dailyElementChestOpenInFlight,
      pendingOpenType: this.dailyElementChestPendingOpenType,
      result,
      resultVisualActive: this.dailyElementChestResultVisualActive,
      rewardPreview,
      resultDisplayName,
      errorMessage: this.dailyElementChestUiError
    };
  }

  buildDailyElementChestRewardPreview(result) {
    if (!result?.cosmetic?.type || !result?.cosmetic?.cosmeticId || result?.duplicateConversion) {
      return null;
    }

    const type = result.cosmetic.type;
    const cosmeticId = result.cosmetic.cosmeticId;
    const definition = getCosmeticDefinition(type, cosmeticId);
    const displayName = getCosmeticDisplayName(type, cosmeticId) ?? cosmeticId;
    let imageSrc = null;
    let mediaKind = "square";

    switch (type) {
      case "avatar":
        imageSrc = getAvatarImage(cosmeticId);
        break;
      case "badge":
        imageSrc = getBadgeImage(cosmeticId);
        break;
      case "cardBack":
        imageSrc = getCardBackImage(cosmeticId);
        mediaKind = "portrait";
        break;
      case "elementCardVariant": {
        const element = definition?.element ?? null;
        const variantMap = getVariantCardImages(cosmeticId);
        imageSrc = element ? variantMap?.[element] ?? null : null;
        mediaKind = "portrait";
        break;
      }
      case "background":
        imageSrc = getArenaBackground(cosmeticId);
        mediaKind = "landscape";
        break;
      case "title":
        imageSrc = definition?.image ? getAssetPath(definition.image) : null;
        break;
      default:
        return null;
    }

    if (!imageSrc) {
      return null;
    }

    return {
      type,
      cosmeticId,
      displayName,
      rarity: String(result.rarity ?? "common").toLowerCase(),
      imageSrc,
      imageAlt: `${displayName} reward preview`,
      mediaKind
    };
  }

  clearDailyElementChestResultVisualTimer() {
    if (this.dailyElementChestResultVisualTimeoutId) {
      clearTimeout(this.dailyElementChestResultVisualTimeoutId);
      this.dailyElementChestResultVisualTimeoutId = null;
    }
  }

  setDailyElementChestResultVisualActive(active) {
    this.clearDailyElementChestResultVisualTimer();
    this.dailyElementChestResultVisualActive = active === true;
  }

  armDailyElementChestResultVisualState() {
    this.setDailyElementChestResultVisualActive(true);
    this.dailyElementChestResultVisualTimeoutId = setTimeout(() => {
      this.dailyElementChestResultVisualTimeoutId = null;
      this.dailyElementChestResultVisualActive = false;
      if (this.isDailyElementChestModalOpen()) {
        this.showDailyElementChestModal();
      }
    }, DAILY_ELEMENT_CHEST_RESULT_VISIBILITY_MS);
  }

  isDailyElementChestModalOpen() {
    return Boolean(globalThis.document?.querySelector?.("[data-daily-element-chest-modal='true']"));
  }

  async refreshDailyElementChestStatus({ shouldRenderMenu = true, shouldRenderModal = true } = {}) {
    if (!this.hasDailyElementChestApiAccess()) {
      this.dailyElementChestStatus = null;
      return null;
    }

    if (this.dailyElementChestStatusRefreshPromise) {
      return this.dailyElementChestStatusRefreshPromise;
    }

    this.dailyElementChestStatusRefreshPromise = (async () => {
      try {
        const status = await window.elemintz.multiplayer.getDailyElementChestStatus({
          username: this.username
        });
        this.dailyElementChestStatus = status ?? null;
        if (shouldRenderMenu && this.screenFlow === "menu") {
          this.renderMenuScreen();
        }
        if (shouldRenderModal && this.isDailyElementChestModalOpen()) {
          this.showDailyElementChestModal();
        }
        return this.dailyElementChestStatus;
      } catch (error) {
        console.warn("[DailyElementChest][Renderer] failed to refresh status", {
          username: this.username,
          message: error?.message ?? String(error)
        });
        this.dailyElementChestStatus = null;
        if (shouldRenderModal && this.isDailyElementChestModalOpen()) {
          this.dailyElementChestUiError = String(error?.message ?? "Unable to load Daily EleMintz Chest status.");
          this.showDailyElementChestModal();
        }
        return null;
      } finally {
        this.dailyElementChestStatusRefreshPromise = null;
      }
    })();

    return this.dailyElementChestStatusRefreshPromise;
  }

  async openDailyElementChest(openType) {
    if (this.dailyElementChestOpenInFlight || !this.hasDailyElementChestApiAccess()) {
      return;
    }

    this.dailyElementChestOpenInFlight = true;
    this.dailyElementChestPendingOpenType = openType;
    this.dailyElementChestUiError = "";
    this.setDailyElementChestResultVisualActive(false);
    this.showDailyElementChestModal();

    try {
      const result = await window.elemintz.multiplayer.openDailyElementChest({
        username: this.username,
        openType
      });
      if (result?.snapshot) {
        this.applyServerProfileSnapshot(result.snapshot, {
          fallbackProfile: result?.profile ?? this.profile ?? null
        });
      } else if (result?.profile) {
        this.profile = result.profile;
      }

      this.dailyElementChestLastResult = result ?? null;
      this.armDailyElementChestResultVisualState();
      this.dailyElementChestStatus = result?.status ?? this.dailyElementChestStatus;
      if (!this.dailyElementChestStatus) {
        await this.refreshDailyElementChestStatus({
          shouldRenderMenu: false,
          shouldRenderModal: false
        });
      }

      if (this.screenFlow === "menu") {
        this.renderMenuScreen();
      }
    } catch (error) {
      this.dailyElementChestUiError = String(error?.message ?? "Unable to open Daily EleMintz Chest.");
      await this.refreshDailyElementChestStatus({
        shouldRenderMenu: false,
        shouldRenderModal: false
      });
    } finally {
      this.dailyElementChestOpenInFlight = false;
      this.dailyElementChestPendingOpenType = null;
      this.showDailyElementChestModal();
      if (this.screenFlow === "menu") {
        this.renderMenuScreen();
      }
    }
  }

  showDailyElementChestModal() {
    const modalView = this.buildDailyElementChestModalView();
    this.modalManager.show({
      title: "Daily EleMintz Chest",
      bodyHtml: renderDailyElementChestModalBody(modalView),
      actions: [{ label: "Close", onClick: () => this.modalManager.hide() }],
      modalClassName: "daily-element-chest-modal-shell"
    });

    const freeOpenButton = globalThis.document?.getElementById?.("daily-chest-free-open-btn") ?? null;
    const paidOpenButton = globalThis.document?.getElementById?.("daily-chest-paid-open-btn") ?? null;
    freeOpenButton?.addEventListener("click", async () => this.openDailyElementChest("free"));
    paidOpenButton?.addEventListener("click", async () => this.openDailyElementChest("paid"));

    if (!this.dailyElementChestStatus && this.hasDailyElementChestApiAccess() && !this.dailyElementChestStatusRefreshPromise) {
      void this.refreshDailyElementChestStatus();
    }
  }

  async refreshMenuAnnouncement() {
    if (!this.username || !this.hasMultiplayerProfileAccess() || !window.elemintz?.multiplayer?.listAnnouncements) {
      const changed = this.menuAnnouncement !== null;
      this.menuAnnouncement = null;
      if (changed && this.screenFlow === "menu") {
        this.renderMenuScreen();
      }
      return null;
    }

    if (this.menuAnnouncementRefreshPromise) {
      return this.menuAnnouncementRefreshPromise;
    }

    this.menuAnnouncementRefreshPromise = (async () => {
      try {
        const result = await window.elemintz.multiplayer.listAnnouncements({
          username: this.username
        });
        const snapshot = result?.snapshot ?? null;
        if (snapshot) {
          const baseProfile =
            this.preserveAuthenticatedOwnProfileIfSafer({
              username: this.username,
              onlineState: this.onlinePlayState,
              reason: "refreshMenuAnnouncement:base"
            }) ??
            this.profile ??
            {};
          this.profile = this.mergeSeenAnnouncementsIntoProfile(
            baseProfile,
            this.buildProfileFromServerSnapshot(snapshot)
          );
        }

        const announcement = Array.isArray(result?.announcements) ? result.announcements[0] ?? null : null;
        this.menuAnnouncement = announcement;
        if (this.screenFlow === "menu") {
          this.renderMenuScreen();
        }
        return announcement;
      } catch (error) {
        console.warn("[Announcements] Failed to refresh menu announcement", {
          username: this.username,
          message: error?.message,
          stack: error?.stack
        });
        this.menuAnnouncement = null;
        if (this.screenFlow === "menu") {
          this.renderMenuScreen();
        }
        return null;
      } finally {
        this.menuAnnouncementRefreshPromise = null;
      }
    })();

    return this.menuAnnouncementRefreshPromise;
  }

  formatMenuBoostEvent(boostEvent) {
    if (!boostEvent) {
      return null;
    }

    const endsAt = String(boostEvent.endsAt ?? "").trim();
    let endsAtLabel = null;
    if (endsAt) {
      const parsedMs = Date.parse(endsAt);
      if (Number.isFinite(parsedMs)) {
        endsAtLabel = new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(parsedMs));
      }
    }

    return {
      ...boostEvent,
      endsAtLabel
    };
  }

  async refreshMenuBoostEvent() {
    if (!this.username || !this.hasMultiplayerProfileAccess() || !window.elemintz?.multiplayer?.getActiveBoostEvent) {
      return null;
    }

    if (this.menuBoostEventRefreshPromise) {
      return this.menuBoostEventRefreshPromise;
    }

    this.menuBoostEventRefreshPromise = (async () => {
      try {
        const boostEvent = this.formatMenuBoostEvent(
          await window.elemintz.multiplayer.getActiveBoostEvent({
            username: this.username
          })
        );
        this.menuBoostEvent = boostEvent;
        if (this.screenFlow === "menu") {
          this.renderMenuScreen();
        }
        return boostEvent;
      } catch (error) {
        console.warn("[BoostEvent] Failed to refresh menu boost event", {
          username: this.username,
          message: error?.message,
          stack: error?.stack
        });
        if (this.screenFlow === "menu" && this.menuBoostEvent === null) {
          this.renderMenuScreen();
        }
        return null;
      } finally {
        this.menuBoostEventRefreshPromise = null;
      }
    })();

    return this.menuBoostEventRefreshPromise;
  }

  async dismissMenuAnnouncement(id) {
    const safeId = String(id ?? "").trim();
    if (!safeId || !this.username || !this.hasMultiplayerProfileAccess() || !window.elemintz?.multiplayer?.dismissAnnouncement) {
      return null;
    }

    const result = await window.elemintz.multiplayer.dismissAnnouncement({
      username: this.username,
      id: safeId
    });
    if (result?.snapshot) {
      const baseProfile =
        this.preserveAuthenticatedOwnProfileIfSafer({
          username: this.username,
          onlineState: this.onlinePlayState,
          reason: "dismissMenuAnnouncement:base"
        }) ??
        this.profile ??
        {};
      this.profile = this.mergeSeenAnnouncementsIntoProfile(
        baseProfile,
        this.buildProfileFromServerSnapshot(result.snapshot)
      );
    }
    this.menuAnnouncement = Array.isArray(result?.announcements) ? result.announcements[0] ?? null : null;
    if (this.screenFlow === "menu") {
      this.renderMenuScreen();
    }
    return result;
  }

  buildFeedbackModalHtml({
    category = FEEDBACK_CATEGORIES[0],
    message = "",
    includeDebugInfo = true,
    errorMessage = ""
  } = {}) {
    const normalizedCategory = FEEDBACK_CATEGORIES.includes(category) ? category : FEEDBACK_CATEGORIES[0];
    const safeMessage = escapeHtml(String(message ?? "").slice(0, FEEDBACK_MAX_MESSAGE_LENGTH));
    const safeErrorMessage = escapeHtml(String(errorMessage ?? "").trim());

    return `
      <div class="stack-sm feedback-modal">
        <p class="muted">Send feedback, bugs, or suggestions directly to the EleMintz server team.</p>
        <label class="stack-xs feedback-modal__field">
          <span class="feedback-modal__label"><strong>Category</strong></span>
          <select id="feedback-category-select" class="input feedback-modal__input">
            ${FEEDBACK_CATEGORIES.map((entry) => `
              <option value="${escapeHtml(entry)}"${entry === normalizedCategory ? " selected" : ""}>${escapeHtml(entry)}</option>
            `).join("")}
          </select>
        </label>
        <label class="stack-xs feedback-modal__field">
          <span class="feedback-modal__label"><strong>Message</strong></span>
          <textarea
            id="feedback-message-textarea"
            class="input feedback-modal__input feedback-modal__textarea"
            rows="6"
            maxlength="${FEEDBACK_MAX_MESSAGE_LENGTH}"
            placeholder="Tell us what happened, what felt off, or what you'd like to see."
          >${safeMessage}</textarea>
        </label>
        <label class="inline-actions feedback-modal__checkbox-row">
          <input id="feedback-include-debug-checkbox" type="checkbox"${includeDebugInfo ? " checked" : ""} />
          <span>Include debug info</span>
        </label>
        <p id="feedback-modal-error" class="muted feedback-modal__error"${safeErrorMessage ? "" : ' hidden="hidden"'}>${safeErrorMessage}</p>
        <div class="inline-actions feedback-modal__actions">
          <button id="feedback-submit-btn" class="btn" type="button">Submit</button>
          <button id="feedback-cancel-btn" class="btn btn-secondary" type="button">Cancel</button>
        </div>
      </div>
    `;
  }

  getFeedbackConnectionStatus() {
    if (this.onlinePlayState?.connectionStatus) {
      return this.onlinePlayState.connectionStatus;
    }

    if (window.elemintz?.multiplayer) {
      return "available";
    }

    return "offline";
  }

  buildFeedbackClientContext() {
    const activeMode = this.gameController?.getViewModel?.()?.mode ?? null;
    const pveDifficulty =
      activeMode === MATCH_MODE.PVE
        ? this.gameController?.aiDifficulty ?? this.settings?.aiDifficulty ?? null
        : null;

    return {
      appVersion: window.elemintz?.version ?? null,
      platform: globalThis.navigator?.platform ?? null,
      screen: this.screenFlow ?? null,
      connectionStatus: this.getFeedbackConnectionStatus(),
      mode: activeMode ?? (this.onlinePlayState?.room ? "online" : null),
      pveDifficulty,
      roomCode: this.onlinePlayState?.room?.roomCode ?? null,
      recentErrorMessage: this.onlinePlayState?.lastError?.message ?? null
    };
  }

  showFeedbackValidationError(message) {
    const errorNode = document.getElementById("feedback-modal-error");
    if (!errorNode) {
      return;
    }

    errorNode.hidden = false;
    errorNode.textContent = String(message ?? "").trim();
  }

  showFeedbackModal({ category, message, includeDebugInfo = true, errorMessage = "" } = {}) {
    this.modalManager.show({
      title: "Send Feedback",
      bodyHtml: this.buildFeedbackModalHtml({
        category,
        message,
        includeDebugInfo,
        errorMessage
      }),
      actions: []
    });

    const categorySelect = document.getElementById("feedback-category-select");
    const messageTextarea = document.getElementById("feedback-message-textarea");
    const includeDebugCheckbox = document.getElementById("feedback-include-debug-checkbox");
    const submitButton = document.getElementById("feedback-submit-btn");
    const cancelButton = document.getElementById("feedback-cancel-btn");

    cancelButton?.addEventListener("click", () => this.modalManager.hide());
    submitButton?.addEventListener("click", async () => {
      const selectedCategory = String(categorySelect?.value ?? FEEDBACK_CATEGORIES[0]).trim();
      const nextMessage = String(messageTextarea?.value ?? "");
      const nextIncludeDebugInfo = includeDebugCheckbox?.checked !== false;
      const trimmedMessage = nextMessage.trim();

      if (!FEEDBACK_CATEGORIES.includes(selectedCategory)) {
        this.showFeedbackValidationError("Please choose a valid feedback category.");
        return;
      }

      if (!trimmedMessage) {
        this.showFeedbackValidationError("Please enter a feedback message.");
        return;
      }

      if (trimmedMessage.length > FEEDBACK_MAX_MESSAGE_LENGTH) {
        this.showFeedbackValidationError(
          `Feedback messages must be ${FEEDBACK_MAX_MESSAGE_LENGTH} characters or fewer.`
        );
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = "Sending...";

      try {
        if (!window.elemintz?.multiplayer?.submitFeedback) {
          throw new Error("Feedback submission is unavailable right now.");
        }

        await window.elemintz.multiplayer.submitFeedback({
          username: this.username,
          category: selectedCategory,
          message: trimmedMessage,
          includeDebugInfo: nextIncludeDebugInfo,
          clientContext: nextIncludeDebugInfo ? this.buildFeedbackClientContext() : null
        });

        this.modalManager.hide();
        this.modalManager.show({
          title: "Feedback Sent",
          body: "Feedback sent. Thank you.",
          actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
        });
      } catch (error) {
        this.modalManager.show({
          title: "Feedback Failed",
          body: String(error?.message ?? "Unable to send feedback."),
          actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
        });
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Submit";
      }
    });
  }

  clearAuthenticatedExperienceState() {
    this.username = null;
    this.profile = null;
    this.lastAuthoritativeOwnProfile = null;
    this.dailyChallenges = null;
    this.dailyElementChestStatus = null;
    this.dailyElementChestLastResult = null;
    this.setDailyElementChestResultVisualActive(false);
    this.dailyElementChestUiError = "";
    this.dailyElementChestOpenInFlight = false;
    this.dailyElementChestPendingOpenType = null;
    this.menuBoostEvent = null;
    this.localPlayers = null;
    this.localProfiles = null;
    this.localPlayerAuthorities = null;
    this.onlinePlayChallengeSummary = null;
    this.onlinePlayChallengeSummaryKey = null;
    this.onlinePlayProfileRefreshKey = null;
    this.onlinePlayProfileRefreshPromise = null;
    this.onlinePlayJoinCode = "";
    this.onlineReconnectReminder = null;
    this.onlineReconnectReminderDismissedKey = null;
    this.pendingMatchCompletePayload = null;
    this.activeAnnouncementKey = null;
    this.resetDailyLoginAutoClaimGuard();
    this.gameController?.stopTimer();
    this.gameController?.stopMatchClock();
    this.clearDailyCountdown();
    this.clearOnlineReconnectUiTimer();
    this.clearPassTimer();
  }

  async logoutToLogin({ noticeMessage = "Signed out." } = {}) {
    this.resetDailyLoginAutoClaimGuard();
    await window.elemintz?.multiplayer?.logout?.();
    this.onlinePlayState = this.normalizeOnlinePlayState(
      await window.elemintz?.multiplayer?.getState?.()
    );
    this.clearAuthenticatedExperienceState();
    this.showLogin({ statusMessage: noticeMessage });
  }

  async forceReturnToLoginForInvalidSession(message) {
    this.onlinePlayState = this.normalizeOnlinePlayState(
      await window.elemintz?.multiplayer?.getState?.()
    );
    this.clearAuthenticatedExperienceState();
    this.showLogin({
      errorMessage: String(message ?? "").trim() || "Session expired. Please sign in again."
    });
  }

  updateMenuCountdownDisplay() {
    if (this.screenFlow !== "menu" || !globalThis.document?.getElementById) {
      return false;
    }

    const dailyLoginLabel = globalThis.document.getElementById("menu-daily-login-status");
    const dailyLoginDetail = globalThis.document.getElementById("menu-daily-login-detail");
    const dailyResetLabel = globalThis.document.querySelector?.('[data-menu-reset-label="daily"]');
    const weeklyResetLabel = globalThis.document.querySelector?.('[data-menu-reset-label="weekly"]');
    const dailyLogin = this.formatDailyLoginStatus(this.dailyChallenges?.dailyLogin);

    if (dailyLoginLabel) {
      dailyLoginLabel.textContent = dailyLogin.stateLabel;
    }

    if (dailyLoginDetail) {
      dailyLoginDetail.textContent = dailyLogin.detailLabel ?? "";
    }

    if (dailyResetLabel) {
      dailyResetLabel.textContent = `Reset in: ${this.formatDuration(this.dailyChallenges?.daily?.msUntilReset)}`;
    }

    if (weeklyResetLabel) {
      weeklyResetLabel.textContent = `Reset in: ${this.formatWeeklyDuration(this.dailyChallenges?.weekly?.msUntilReset)}`;
    }

    return Boolean(dailyLoginLabel || dailyResetLabel || weeklyResetLabel);
  }

  updateMenuChallengePreviewDisplay() {
    if (this.screenFlow !== "menu" || !globalThis.document?.querySelector) {
      return false;
    }

    const dailyLoginPanel = globalThis.document.querySelector('[data-menu-daily-login-panel="true"]');
    const dailyPreview = globalThis.document.querySelector('[data-menu-challenge-preview="daily"]');
    const weeklyPreview = globalThis.document.querySelector('[data-menu-challenge-preview="weekly"]');
    const dailyLogin = this.formatDailyLoginStatus(this.dailyChallenges?.dailyLogin);

    if (dailyLoginPanel) {
      dailyLoginPanel.innerHTML = renderMenuDailyLoginStatus(dailyLogin);
    }

    if (dailyPreview) {
      dailyPreview.innerHTML = renderMenuChallengePreview("Daily", "\u2B50", {
        ...this.dailyChallenges?.daily,
        resetLabel: this.formatDuration(this.dailyChallenges?.daily?.msUntilReset)
      });
    }

    if (weeklyPreview) {
      weeklyPreview.innerHTML = renderMenuChallengePreview("Weekly", "\uD83C\uDFC6", {
        ...this.dailyChallenges?.weekly,
        resetLabel: this.formatWeeklyDuration(this.dailyChallenges?.weekly?.msUntilReset)
      });
    }

    return Boolean(dailyLoginPanel || dailyPreview || weeklyPreview);
  }

  hasActiveQuitConfirmationModal() {
    const modalTitle = globalThis.document?.querySelector?.(".modal-overlay .modal h3");
    const title = String(modalTitle?.textContent ?? "").trim();
    return title === "Request Quit" || title === "Leave Match";
  }

  hasActiveMatchCompleteModal() {
    const modalTitle = globalThis.document?.querySelector?.(".modal-overlay .modal h3");
    const title = String(modalTitle?.textContent ?? "").trim();
    return title === "Match Complete";
  }

  clearTransientUiBeforeScreenTransition({ preserveModal = false } = {}) {
    this.clearMatchTauntUiTimer();
    this.clearOnlineTurnTimerUi();
    if (preserveModal) {
      return false;
    }

    return Boolean(this.modalManager?.clearStaleOverlay?.());
  }

  async refreshDailyChallengesForMenu() {
    if (!this.username) {
      return;
    }

    if (this.dailyChallengesRefreshPromise) {
      return this.dailyChallengesRefreshPromise;
    }

    this.dailyChallengesRefreshPromise = (async () => {
      try {
        const serverProfile = this.hasMultiplayerProfileAccess()
          ? await globalThis.window.elemintz.multiplayer.getProfile({ username: this.username })
          : null;
        const result = serverProfile
          ? {
              daily: serverProfile.progression?.dailyChallenges ?? null,
              weekly: serverProfile.progression?.weeklyChallenges ?? null,
              dailyLogin: serverProfile.progression?.dailyLogin ?? null
            }
          : this.isAuthenticatedOnlineProfileFlow()
            ? null
          : globalThis.window?.elemintz?.state?.getDailyChallenges
            ? await globalThis.window.elemintz.state.getDailyChallenges(this.username)
            : null;
        if (!result) {
          return null;
        }
        this.dailyChallenges = { daily: result.daily, weekly: result.weekly, dailyLogin: result.dailyLogin };

        if (this.screenFlow === "menu") {
          this.updateMenuChallengePreviewDisplay();
          this.updateMenuCountdownDisplay();
        }

        this.clearDailyCountdown();
        this.dailyResetCountdownId = setInterval(() => {
          if (!this.dailyChallenges) {
            return;
          }

          this.dailyChallenges = {
            dailyLogin: this.dailyChallenges.dailyLogin
              ? {
                  ...this.dailyChallenges.dailyLogin,
                  msUntilReset: Math.max(0, (this.dailyChallenges.dailyLogin?.msUntilReset ?? 0) - 1000)
                }
              : null,
            daily: {
              ...this.dailyChallenges.daily,
              msUntilReset: Math.max(0, (this.dailyChallenges.daily?.msUntilReset ?? 0) - 1000)
            },
            weekly: {
              ...this.dailyChallenges.weekly,
              msUntilReset: Math.max(0, (this.dailyChallenges.weekly?.msUntilReset ?? 0) - 1000)
            }
          };

          if (this.screenFlow === "menu") {
            this.updateMenuCountdownDisplay();
          }
        }, 1000);
        this.dailyResetCountdownId?.unref?.();
        return this.dailyChallenges;
      } catch (error) {
        console.error("Failed to load daily challenges", error);
        return null;
      } finally {
        this.dailyChallengesRefreshPromise = null;
      }
    })();

    return this.dailyChallengesRefreshPromise;
  }

  applyMotionPreference() {
    const reducedMotion = Boolean(this.settings?.ui?.reducedMotion);
    document.body.classList.toggle("reduced-motion", reducedMotion);
  }

  applySoundPreference() {
    const enabled = this.settings?.audio?.enabled !== false;
    this.sound.setEnabled(enabled);
  }

  isReducedMotion() {
    return Boolean(this.settings?.ui?.reducedMotion);
  }

  resolveAvatarPath(avatarId) {
    const directPath = String(avatarId ?? "").trim();
    if (directPath.startsWith("assets/")) {
      return getAssetPath(directPath.slice("assets/".length));
    }

    return getAvatarImage(avatarId);
  }

  getBackgroundIdFromProfile(profile) {
    return (
      profile?.cosmetics?.snapshot?.equipped?.background ??
      profile?.cosmetics?.background ??
      profile?.equippedCosmetics?.background ??
      "default_background"
    );
  }

  getBackgroundFromProfile(profile) {
    return getArenaBackground(this.getBackgroundIdFromProfile(profile));
  }

  getEnabledCosmeticRandomizationCategories(profile) {
    const preferences = profile?.cosmeticRandomizeAfterMatch ?? {};
    const categories = ["avatar", "title", "badge", "elementCardVariant", "cardBack", "background"];
    return categories.filter((type) => Boolean(preferences[type] ?? (type === "background" && profile?.randomizeBackgroundEachMatch)));
  }

  async randomizeOwnedCosmeticsFor(username, profile, categories = []) {
    const uniqueCategories = [...new Set(Array.isArray(categories) ? categories.filter(Boolean) : [])];
    if (!username || !profile || uniqueCategories.length === 0) {
      return profile;
    }

    try {
      if (this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.randomizeOwnedCosmetics) {
        const result = await window.elemintz.multiplayer.randomizeOwnedCosmetics({
          username,
          categories: uniqueCategories
        });
        const nextProfile = result?.snapshot ? this.buildProfileFromServerSnapshot(result.snapshot) : result?.profile ?? null;
        return nextProfile ?? profile;
      }

      const result = await window.elemintz.state.randomizeOwnedCosmetics({
        username,
        categories: uniqueCategories
      });
      return result?.profile ?? profile;
    } catch (error) {
      console.error("Failed to randomize owned cosmetics after match", {
        username,
        categories: uniqueCategories,
        error
      });
      return profile;
    }
  }

  async maybeRandomizeCosmeticsAfterMatchFor(username, profile) {
    const categories = this.getEnabledCosmeticRandomizationCategories(profile);
    return this.randomizeOwnedCosmeticsFor(username, profile, categories);
  }

  async applyPostMatchCosmeticRandomization(mode, finalPersisted) {
    if (mode === MATCH_MODE.LOCAL_PVP) {
      const names = this.getLocalNames();
      const p1Profile = finalPersisted?.p1?.profile ?? this.localProfiles?.p1 ?? null;
      const p2Profile = finalPersisted?.p2?.profile ?? this.localProfiles?.p2 ?? null;

      this.localProfiles = {
        p1: await this.maybeRandomizeCosmeticsAfterMatchFor(names.p1, p1Profile),
        p2: await this.maybeRandomizeCosmeticsAfterMatchFor(names.p2, p2Profile)
      };
      return;
    }

    const latestProfile = finalPersisted?.profile ?? this.profile;
    this.profile = await this.maybeRandomizeCosmeticsAfterMatchFor(this.username, latestProfile);
  }

  resolveTitleLabel(profile, fallbackTitle = "Initiate") {
    return getCosmeticDisplayName(
      "title",
      profile?.equippedCosmetics?.title,
      profile?.title ?? fallbackTitle
    );
  }

  resolveIdentityDisplay({
    name = null,
    fallbackName = "Player",
    avatarId = null,
    avatarPath = null,
    titleId = null,
    badgeId = null,
    badgePath = null,
    titleIconPath = null,
    titleText = null,
    fallbackTitle = "Initiate"
  } = {}) {
    const resolvedAvatarId = avatarPath
      ? avatarPath
      : getCosmeticDefinition("avatar", avatarId)
        ? avatarId
        : "default_avatar";
    const resolvedTitleId = getCosmeticDefinition("title", titleId) ? titleId : null;
    const resolvedBadgeId = badgePath
      ? badgePath
      : getCosmeticDefinition("badge", badgeId)
        ? badgeId
        : "none";
    const resolvedTitle = getCosmeticDisplayName("title", resolvedTitleId, titleText ?? fallbackTitle) ?? fallbackTitle;
    const titleDefinition = resolvedTitleId ? getCosmeticDefinition("title", resolvedTitleId) : null;
    const titleIcon =
      titleIconPath
        ? getAssetPath(titleIconPath)
        : titleDefinition?.image
        ? getAssetPath(titleDefinition.image)
        : TITLE_ICON_MAP[resolvedTitle]
          ? getAssetPath(TITLE_ICON_MAP[resolvedTitle])
          : null;

    return {
      name: normalizeName(name, fallbackName),
      avatarId: resolvedAvatarId,
      titleId: resolvedTitleId,
      badgeId: resolvedBadgeId,
      title: resolvedTitle,
      titleIcon,
      featuredBadge: getBadgeImage(resolvedBadgeId),
      avatar: this.resolveAvatarPath(resolvedAvatarId)
    };
  }

  buildPlayerDisplay(profile, fallbackName, fallbackTitle = "Initiate") {
    const avatarId =
      profile?.cosmetics?.snapshot?.equipped?.avatar ??
      profile?.equippedCosmetics?.avatar ??
      profile?.cosmetics?.equipped?.avatar ??
      profile?.cosmetics?.avatar ??
      "default_avatar";
    const titleId =
      profile?.cosmetics?.snapshot?.equipped?.title ??
      profile?.equippedCosmetics?.title ??
      profile?.cosmetics?.equipped?.title ??
      null;
    const badgeId =
      profile?.cosmetics?.snapshot?.equipped?.badge ??
      profile?.equippedCosmetics?.badge ??
      profile?.cosmetics?.equipped?.badge ??
      profile?.cosmetics?.badge ??
      "none";

    return this.resolveIdentityDisplay({
      name: profile?.username,
      fallbackName,
      avatarId,
      titleId,
      badgeId,
      titleText: profile?.title ?? this.resolveTitleLabel(profile, fallbackTitle),
      fallbackTitle
    });
  }

  buildMatchCosmeticProfileView(profile = null) {
    if (!profile || typeof profile !== "object") {
      return profile;
    }

    return {
      ...profile,
      equippedCosmetics: this.buildOnlineEquippedCosmetics(profile)
    };
  }

  getOnlineEquippedCosmeticValue(profile = null, key, fallback) {
    return profile?.cosmetics?.snapshot?.equipped?.[key] ??
      profile?.cosmetics?.equipped?.[key] ??
      profile?.equippedCosmetics?.[key] ??
      profile?.cosmetics?.[key] ??
      (key === "title" ? profile?.title : undefined) ??
      fallback;
  }

  isConnectedOnlineProfileFlow(onlineState = this.onlinePlayState) {
    return String(onlineState?.connectionStatus ?? "").toLowerCase() === "connected";
  }

  hasMultiplayerProfileAccess(onlineState = this.onlinePlayState) {
    return this.isConnectedOnlineProfileFlow(onlineState) && Boolean(window.elemintz?.multiplayer?.getProfile);
  }

  isAuthenticatedOnlineProfileFlow(onlineState = this.onlinePlayState, username = this.username) {
    if (!this.hasMultiplayerProfileAccess(onlineState)) {
      return false;
    }

    if (!onlineState?.session?.authenticated) {
      return false;
    }

    const requestedUsername = String(username ?? "").trim();
    const sessionUsername = String(onlineState?.session?.username ?? "").trim();
    return !requestedUsername || !sessionUsername || requestedUsername === sessionUsername;
  }

  hasAuthenticatedMultiplayerSessionForUsername(
    username = this.username,
    onlineState = this.onlinePlayState
  ) {
    if (!onlineState?.session?.authenticated) {
      return false;
    }

    const requestedUsername = String(username ?? "").trim();
    const sessionUsername = String(onlineState?.session?.username ?? "").trim();
    return !requestedUsername || !sessionUsername || requestedUsername === sessionUsername;
  }

  setOwnProfileHydrationState(status, { username = this.username, message = "" } = {}) {
    const safeStatus = ["pending", "ready", "error"].includes(String(status ?? "").trim().toLowerCase())
      ? String(status).trim().toLowerCase()
      : "error";
    const safeUsername = String(username ?? "").trim() || null;
    this.ownProfileHydration = {
      status: safeStatus,
      username: safeUsername,
      message: String(message ?? "").trim()
    };
    return this.ownProfileHydration;
  }

  isOwnProfileHydrated(username = this.username, onlineState = this.onlinePlayState) {
    if (!this.isAuthenticatedOnlineProfileFlow(onlineState, username)) {
      return true;
    }

    const safeUsername = String(username ?? "").trim().toLowerCase();
    const hydratedUsername = String(this.ownProfileHydration?.username ?? "").trim().toLowerCase();
    return (
      this.ownProfileHydration?.status === "ready" &&
      Boolean(safeUsername) &&
      safeUsername === hydratedUsername &&
      String(this.profile?.username ?? "").trim().toLowerCase() === safeUsername
    );
  }

  isFallbackLikeAuthenticatedProfile(profile) {
    if (!profile || typeof profile !== "object") {
      return true;
    }

    const stats = profile.stats && typeof profile.stats === "object" ? profile.stats : {};
    const equippedCosmetics =
      profile.equippedCosmetics && typeof profile.equippedCosmetics === "object"
        ? profile.equippedCosmetics
        : {};
    const level = Number(profile.playerLevel ?? 0) || 0;
    const xp = Number(profile.playerXP ?? 0) || 0;
    const tokens = Number(profile.tokens ?? 0) || 0;
    const gamesPlayed = Number(stats.gamesPlayed ?? profile.gamesPlayed ?? 0) || 0;
    const wins = Number(stats.wins ?? profile.wins ?? 0) || 0;
    const losses = Number(stats.losses ?? profile.losses ?? 0) || 0;
    const cardsCaptured = Number(profile.cardsCaptured ?? stats.cardsCaptured ?? 0) || 0;
    const warsEntered = Number(profile.warsEntered ?? stats.warsEntered ?? 0) || 0;
    const avatar = String(equippedCosmetics.avatar ?? "").trim() || null;
    const title = String(equippedCosmetics.title ?? "").trim() || null;
    const cardBack = String(equippedCosmetics.cardBack ?? "").trim() || null;

    const zeroishStats =
      level <= 1 &&
      xp <= 0 &&
      tokens <= 0 &&
      gamesPlayed <= 0 &&
      wins <= 0 &&
      losses <= 0 &&
      cardsCaptured <= 0 &&
      warsEntered <= 0;
    const defaultOrMissingCosmetics =
      (!avatar || avatar === "default_avatar") &&
      (!cardBack || cardBack === "default_card_back") &&
      (!title || title === "Initiate");

    return zeroishStats && defaultOrMissingCosmetics;
  }

  rememberAuthoritativeOwnProfile(profile, {
    username = this.username,
    onlineState = this.onlinePlayState
  } = {}) {
    if (!this.isAuthenticatedOnlineProfileFlow(onlineState, username) || !profile) {
      return profile;
    }

    const safeUsername = String(username ?? "").trim().toLowerCase();
    const profileUsername = String(profile?.username ?? "").trim().toLowerCase();
    if (!safeUsername || profileUsername !== safeUsername) {
      return profile;
    }

    this.lastAuthoritativeOwnProfile = JSON.parse(JSON.stringify(profile));
    return profile;
  }

  getRememberedAuthoritativeOwnProfile(username = this.username, onlineState = this.onlinePlayState) {
    if (!this.hasAuthenticatedMultiplayerSessionForUsername(username, onlineState) || !this.lastAuthoritativeOwnProfile) {
      return null;
    }

    const safeUsername = String(username ?? "").trim().toLowerCase();
    const profileUsername = String(this.lastAuthoritativeOwnProfile?.username ?? "").trim().toLowerCase();
    if (!safeUsername || profileUsername !== safeUsername) {
      return null;
    }

    return JSON.parse(JSON.stringify(this.lastAuthoritativeOwnProfile));
  }

  preserveAuthenticatedOwnProfileIfSafer({
    username = this.username,
    onlineState = this.onlinePlayState,
    reason = "unknown"
  } = {}) {
    if (!this.hasAuthenticatedMultiplayerSessionForUsername(username, onlineState)) {
      return this.profile;
    }

    const rememberedProfile = this.getRememberedAuthoritativeOwnProfile(username, onlineState);
    if (!rememberedProfile) {
      return this.profile;
    }

    const safeUsername = String(username ?? "").trim().toLowerCase();
    const currentUsername = String(this.profile?.username ?? "").trim().toLowerCase();
    const shouldRestoreRememberedProfile =
      !this.profile ||
      !safeUsername ||
      currentUsername !== safeUsername ||
      Boolean(
        this.isFallbackLikeAuthenticatedProfile(this.profile) &&
        !this.isFallbackLikeAuthenticatedProfile(rememberedProfile)
      );

    if (!shouldRestoreRememberedProfile) {
      return this.profile;
    }

    this.profile = rememberedProfile;
    this.setOwnProfileHydrationState("ready", {
      username: rememberedProfile.username ?? username
    });
    return this.profile;
  }

  getOwnProfileHydrationBlockMessage(username = this.username, onlineState = this.onlinePlayState) {
    if (this.isOwnProfileHydrated(username, onlineState)) {
      return "";
    }

    return this.ownProfileHydration?.status === "pending"
      ? "Profile is still loading. Please wait."
      : "Unable to load your online profile. Please reconnect or log in again.";
  }

  requireOwnProfileHydratedForAction(actionName = "continue", {
    username = this.username,
    onlineState = this.onlinePlayState,
    showMessage = true
  } = {}) {
    if (!this.isAuthenticatedOnlineProfileFlow(onlineState, username)) {
      return true;
    }

    if (this.isOwnProfileHydrated(username, onlineState)) {
      return true;
    }

    if (showMessage) {
      this.modalManager.show({
        title: this.ownProfileHydration?.status === "pending" ? "Profile Loading" : "Profile Unavailable",
        body: this.getOwnProfileHydrationBlockMessage(username, onlineState),
        actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
      });
    }

    console.warn("[ProfileHydration] blocked action", {
      actionName,
      username: String(username ?? "").trim() || null,
      status: this.ownProfileHydration?.status ?? null
    });
    return false;
  }

  clearProtectedLocalMatchSessionState() {
    this.protectedLocalMatchSessionRequestId += 1;
    this.currentProtectedLocalMatchSession = null;
    this.pendingProtectedLocalMatchSessionPromise = null;
  }

  clearGauntletLocalMatchSessionState() {
    this.gauntletLocalMatchSessionRequestId += 1;
    this.currentGauntletLocalMatchSession = null;
    this.pendingGauntletLocalMatchSessionPromise = null;
  }

  isProtectedServerSessionPveMode({
    mode = MATCH_MODE.PVE,
    gauntletMode = this.pveGauntletMode
  } = {}) {
    return mode === MATCH_MODE.PVE && !gauntletMode;
  }

  syncProtectedLocalMatchSessionOntoMatch(session = null) {
    const safeSessionId = String(session?.sessionId ?? "").trim() || null;
    if (!safeSessionId || !this.gameController?.match?.meta) {
      return;
    }

    this.gameController.match.meta.localMatchSessionId = safeSessionId;
  }

  async startProtectedPveLocalMatchSession({
    aiDifficulty,
    featuredRivalId = null,
    requestId = this.protectedLocalMatchSessionRequestId
  } = {}) {
    const multiplayer = globalThis.window?.elemintz?.multiplayer ?? null;
    const safeUsername = String(this.username ?? "").trim() || null;
    const safeFeaturedRivalId = String(featuredRivalId ?? "").trim().toLowerCase() || null;
    const safeDifficulty = String(aiDifficulty ?? "").trim().toLowerCase() || null;

    if (!safeUsername || !this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, safeUsername)) {
      this.clearProtectedLocalMatchSessionState();
      return null;
    }

    const starter = safeFeaturedRivalId
      ? multiplayer?.startFeaturedRivalMatch
      : multiplayer?.startLocalPveMatch;
    if (typeof starter !== "function") {
      this.clearProtectedLocalMatchSessionState();
      return null;
    }

    const session = await starter({
      username: safeUsername,
      aiDifficulty: safeDifficulty,
      ...(safeFeaturedRivalId ? { featuredRivalId: safeFeaturedRivalId } : {})
    });

    if (requestId !== this.protectedLocalMatchSessionRequestId) {
      return null;
    }

    this.currentProtectedLocalMatchSession = session ?? null;
    this.syncProtectedLocalMatchSessionOntoMatch(session);
    return session ?? null;
  }

  async resolveProtectedPveLocalMatchSession() {
    if (this.currentProtectedLocalMatchSession?.sessionId) {
      return this.currentProtectedLocalMatchSession;
    }

    if (this.pendingProtectedLocalMatchSessionPromise) {
      try {
        const session = await this.pendingProtectedLocalMatchSessionPromise;
        this.currentProtectedLocalMatchSession = session ?? null;
        this.syncProtectedLocalMatchSessionOntoMatch(session);
        return session ?? null;
      } finally {
        this.pendingProtectedLocalMatchSessionPromise = null;
      }
    }

    return null;
  }

  syncGauntletLocalMatchSession(session = null) {
    const safeSessionId = String(session?.sessionId ?? "").trim() || null;
    if (!safeSessionId) {
      return;
    }

    this.currentGauntletLocalMatchSession = session ?? null;
    this.gauntletRunState = {
      ...this.gauntletRunState,
      sessionId: safeSessionId,
      previousSessionId: null,
      claimedMilestoneStreaks: Array.isArray(session?.metadata?.claimedMilestoneStreaks)
        ? [...session.metadata.claimedMilestoneStreaks]
        : this.gauntletRunState?.claimedMilestoneStreaks ?? [],
      currentStreak: Math.max(
        0,
        Number(session?.metadata?.currentStreak ?? this.gauntletRunState?.currentStreak ?? 0)
      ),
      defeatedRivalIds: Array.isArray(session?.metadata?.defeatedRivalIds)
        ? [...session.metadata.defeatedRivalIds]
        : this.gauntletRunState?.defeatedRivalIds ?? []
    };

    if (this.gameController?.match?.meta) {
      this.gameController.match.meta.localMatchSessionId = safeSessionId;
    }
  }

  async startGauntletLocalMatchSession({
    aiDifficulty,
    gauntletRivalId,
    previousSessionId = null,
    requestId = this.gauntletLocalMatchSessionRequestId
  } = {}) {
    const multiplayer = globalThis.window?.elemintz?.multiplayer ?? null;
    const safeUsername = String(this.username ?? "").trim() || null;
    const starter = multiplayer?.startGauntletMatch;
    if (
      !safeUsername ||
      !this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, safeUsername) ||
      typeof starter !== "function"
    ) {
      this.clearGauntletLocalMatchSessionState();
      return null;
    }

    const session = await starter({
      username: safeUsername,
      aiDifficulty: String(aiDifficulty ?? "").trim().toLowerCase() || null,
      gauntletRivalId,
      previousSessionId
    });

    if (requestId !== this.gauntletLocalMatchSessionRequestId) {
      return null;
    }

    this.syncGauntletLocalMatchSession(session);
    return session ?? null;
  }

  async resolveGauntletLocalMatchSession() {
    if (this.currentGauntletLocalMatchSession?.sessionId) {
      return this.currentGauntletLocalMatchSession;
    }

    if (this.pendingGauntletLocalMatchSessionPromise) {
      try {
        const session = await this.pendingGauntletLocalMatchSessionPromise;
        this.syncGauntletLocalMatchSession(session);
        return session ?? null;
      } finally {
        this.pendingGauntletLocalMatchSessionPromise = null;
      }
    }

    return null;
  }

  buildLocalMatchSettlementKey(match, { mode = null, names = [], localMatchSessionId = null } = {}) {
    const safeMode = String(mode ?? match?.mode ?? "local_match").trim() || "local_match";
    const safeMatchId =
      String(match?.id ?? "").trim() ||
      String(match?.meta?.startedAt ?? "").trim() ||
      "match";
    const safeStartedAt = String(match?.meta?.startedAt ?? "").trim() || "started";
    const safeEndedAt = String(match?.meta?.endedAt ?? "").trim() || "ended";
    const safeWinner = String(match?.winner ?? "none").trim() || "none";
    const safeRounds = Math.max(0, Number(match?.round ?? 0) || 0);
    const participants = (Array.isArray(names) ? names : [])
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean)
      .sort()
      .join("|");
    const safeLocalMatchSessionId = String(
      localMatchSessionId ?? match?.meta?.localMatchSessionId ?? ""
    ).trim();

    return [
      safeMode,
      safeLocalMatchSessionId ? `session:${safeLocalMatchSessionId}` : null,
      safeMatchId,
      safeStartedAt,
      safeEndedAt,
      safeWinner,
      String(safeRounds),
      participants
    ]
      .filter(Boolean)
      .join("::");
  }

  async settleLocalMatchResultForIdentity({
    mode,
    username,
    perspective = "p1",
    match,
    authority = null
  } = {}) {
    const safeUsername = String(username ?? "").trim();
    const multiplayerSettle = globalThis.window?.elemintz?.multiplayer?.applyLocalMatchResult;
    const multiplayerHotseatSettle = globalThis.window?.elemintz?.multiplayer?.applyLocalHotseatResult;
    const localRecord = globalThis.window?.elemintz?.state?.recordMatchResult;
    const sessionToken = String(authority?.sessionToken ?? "").trim() || null;
    const accountId =
      String(
        authority?.accountId ??
          (perspective === "p1" ? this.onlinePlayState?.session?.accountId : "") ??
          ""
      ).trim() || null;
    const localMatchSessionId =
      String(
        authority?.localMatchSessionId ??
          match?.meta?.localMatchSessionId ??
          ""
      ).trim() || null;
    const requiresProtectedServerSession = Boolean(authority?.protectedServerSessionRequired);
    const settlementKey = this.buildLocalMatchSettlementKey(match, {
      mode,
      names:
        mode === MATCH_MODE.LOCAL_PVP
          ? [this.getLocalNames().p1, this.getLocalNames().p2]
          : [safeUsername],
      localMatchSessionId
    });
    const latestBattleContext =
      mode === MATCH_MODE.LOCAL_PVP
        ? {
            opponentName:
              perspective === "p2"
                ? this.getLocalNames().p1
                : this.getLocalNames().p2
          }
        : null;
    const matchSummary = {
      winner: String(match?.winner ?? "").trim() || null,
      endReason: String(match?.endReason ?? "").trim() || null,
      round: Math.max(0, Number(match?.round ?? 0) || 0)
    };
    const hasAuthenticatedAuthority =
      Boolean(sessionToken) || this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, safeUsername);
    const canUseServer =
      mode !== MATCH_MODE.LOCAL_PVP &&
      typeof multiplayerSettle === "function" &&
      hasAuthenticatedAuthority;
    const canUseHotseatServer =
      mode === MATCH_MODE.LOCAL_PVP &&
      typeof multiplayerHotseatSettle === "function" &&
      hasAuthenticatedAuthority;

    console.info("[MatchSettlement][Renderer] attempt", {
      mode,
      username: safeUsername,
      accountId,
      perspective,
      ...matchSummary,
      settlementKey,
      usingServerAuthority: canUseServer || canUseHotseatServer
    });

    if (canUseHotseatServer) {
      try {
        const result = await multiplayerHotseatSettle({
          username: safeUsername,
          perspective,
          matchState: match,
          settlementKey,
          latestBattleContext,
          ...(sessionToken ? { sessionToken } : {})
        });
        console.info("[MatchSettlement][Renderer] hotseat authority success", {
          mode,
          username: safeUsername,
          accountId,
          perspective,
          duplicate: Boolean(result?.duplicate),
          fallbackUsed: false
        });
        return result;
      } catch (error) {
        console.error("[MatchSettlement][Renderer] hotseat authority failure", {
          mode,
          username: safeUsername,
          accountId,
          perspective,
          error
        });
        throw error;
      }
    }

    if (canUseServer) {
      try {
        const result = await multiplayerSettle({
          username: safeUsername,
          perspective,
          matchState: match,
          settlementKey,
          latestBattleContext,
          ...(localMatchSessionId ? { localMatchSessionId } : {}),
          ...(sessionToken ? { sessionToken } : {})
        });
        console.info("[MatchSettlement][Renderer] authoritative success", {
          mode,
          username: safeUsername,
          accountId,
          perspective,
          duplicate: Boolean(result?.duplicate),
          fallbackUsed: false
        });
        if (requiresProtectedServerSession) {
          this.clearProtectedLocalMatchSessionState();
        }
        return result;
      } catch (error) {
        console.error("[MatchSettlement][Renderer] authoritative failure", {
          mode,
          username: safeUsername,
          accountId,
          perspective,
          fallbackUsed: typeof localRecord === "function",
          message: error?.message,
          stack: error?.stack
        });
        if (requiresProtectedServerSession) {
          throw error;
        }
      }
    }

    if (typeof localRecord !== "function") {
      return null;
    }

    const result = await localRecord({
      username: safeUsername,
      perspective,
      matchState: match,
      settlementKey,
      latestBattleContext
    });
    console.info("[MatchSettlement][Renderer] local fallback success", {
      mode,
      username: safeUsername,
      accountId,
      perspective,
      fallbackUsed: true
    });
    return result;
  }

  showLegacyLocalAuthorityDisabledModal(body) {
    this.modalManager.show({
      title: "Online Authority Only",
      body,
      actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
    });
  }

  getUpdateSafetyState() {
    return buildUpdateSafetyState(this);
  }

  isSafeForUpdateRestart() {
    return computeIsSafeForUpdateRestart(this);
  }

  getUpdateCoordinatorState() {
    return this.updateCoordinatorState;
  }

  getUpdateDiagnostics() {
    return buildUpdateDiagnosticsSnapshot(this.updateCoordinatorState);
  }

  hasDevUpdateSimulationAccess() {
    const updates = globalThis.window?.elemintz?.updates ?? null;
    return Boolean(
      updates?.devMarkDownloaded &&
      updates?.requestInstallWhenSafe &&
      updates?.cancelDeferredInstall
    );
  }

  ensureDevUpdateSimulationAccess() {
    if (!this.hasDevUpdateSimulationAccess()) {
      throw new Error("Update dev simulation is unavailable in this build.");
    }
  }

  async refreshUpdateCoordinatorState() {
    this.updateCoordinatorState = await loadUpdateCoordinatorState(this);
    return this.updateCoordinatorState;
  }

  getUpdateReadyPromptVersionKey(lifecycleState = null) {
    const version = String(lifecycleState?.updateInfo?.version ?? "").trim();
    if (version) {
      return version;
    }

    return String(lifecycleState?.updatedAt ?? "");
  }

  async reportUpdatePromptEvent(type, details = {}) {
    const updates = globalThis.window?.elemintz?.updates ?? null;
    if (!updates?.reportPromptEvent) {
      return false;
    }

    try {
      return await updates.reportPromptEvent({
        type,
        ...details
      });
    } catch (error) {
      console.error("[Updates][PromptEvent] failed", {
        type,
        message: String(error?.message ?? error ?? "Unknown prompt event reporting failure.")
      });
      return false;
    }
  }

  buildUpdateInstallBlockedMessage(blockedReasons = []) {
    const reasons = Array.isArray(blockedReasons) ? blockedReasons : [];
    if (reasons.length === 0) {
      return "EleMintz is not in a safe state to restart right now. Please finish your current flow and try again.";
    }

    const labels = {
      active_match: "a local match is active",
      active_online_match: "an online match is active",
      active_war: "a WAR sequence is still active",
      round_presentation_busy: "a round reveal is still playing",
      pending_match_complete_flow: "match rewards or results are still being presented",
      chest_open_in_flight: "a chest is opening",
      milestone_chest_notice_open: "a chest reward notice is open",
      reconnect_paused_or_reminder_active: "an online reconnect flow is active",
      pending_online_room_action: "an online room action is still pending",
      pending_reward_settlement: "match rewards are still settling",
      daily_login_claim_in_flight: "daily login rewards are still being claimed",
      online_profile_refresh_in_flight: "the online profile is still refreshing",
      pending_admin_grant_notice: "an admin grant notice is still pending",
      quit_confirmation_modal_active: "a quit confirmation is open",
      match_complete_modal_active: "the match complete dialog is open"
    };

    const readableReasons = reasons.map((reason) => labels[reason] ?? reason.replaceAll("_", " "));
    if (readableReasons.length === 1) {
      return `EleMintz cannot restart to install the update yet because ${readableReasons[0]}.`;
    }

    return `EleMintz cannot restart to install the update yet because ${readableReasons
      .slice(0, -1)
      .join(", ")} and ${readableReasons.at(-1)}.`;
  }

  async showUpdateReadyPrompt(lifecycleState) {
    const version = lifecycleState?.updateInfo?.version ?? "the latest version";
    this.updateReadyPromptVisible = true;
    await this.reportUpdatePromptEvent("install_prompt_shown", {
      version,
      source: "renderer-update-modal"
    });

    this.modalManager.show({
      title: "Update Ready",
      body: "A new EleMintz update has been downloaded. Restart now to install?",
      actions: [
        {
          label: "Restart Now",
          onClick: async () => {
            this.updateReadyPromptVisible = false;
            this.modalManager.hide();
            await this.reportUpdatePromptEvent("user_chose_restart_now", {
              version,
              source: "renderer-update-modal"
            });
            const coordinator = await this.requestUpdateInstall();
            const diagnostics = this.getUpdateDiagnostics();
            if (coordinator?.lifecycleState?.status === "error") {
              this.modalManager.show({
                title: "Update Install Failed",
                body:
                  diagnostics.message ||
                  "EleMintz could not start the update install right now.",
                actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
              });
              return;
            }

            if (!coordinator?.installAllowedNow) {
              this.modalManager.show({
                title: "Update Not Safe Yet",
                body: this.buildUpdateInstallBlockedMessage(coordinator?.blockedReasons ?? []),
                actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
              });
            }
          }
        },
        {
          label: "Later",
          onClick: async () => {
            this.updateReadyPromptVisible = false;
            this.modalManager.hide();
            await this.reportUpdatePromptEvent("user_chose_later", {
              version,
              source: "renderer-update-modal"
            });
          }
        }
      ]
    });
  }

  async maybeHandleDownloadedUpdateLifecycle(lifecycleState) {
    const status = String(lifecycleState?.status ?? "").trim();
    if (status !== "downloaded") {
      return;
    }

    const promptVersionKey = this.getUpdateReadyPromptVersionKey(lifecycleState);
    if (!promptVersionKey || promptVersionKey === this.updateReadyPromptVersion || this.updateReadyPromptVisible) {
      return;
    }

    this.updateReadyPromptVersion = promptVersionKey;
    await this.showUpdateReadyPrompt(lifecycleState);
  }

  bindUpdateLifecycleUpdates() {
    if (this.updateLifecycleUnsubscribe || !globalThis.window?.elemintz?.updates?.onStateChanged) {
      return;
    }

    this.updateLifecycleUnsubscribe = globalThis.window.elemintz.updates.onStateChanged((lifecycleState) => {
      const safetyState = this.getUpdateSafetyState();
      this.updateCoordinatorState = buildUpdateCoordinatorState({
        lifecycleState,
        safetyState
      });

      console.info("[Updates][Coordinator]", this.getUpdateDiagnostics());
      void this.maybeHandleDownloadedUpdateLifecycle(lifecycleState);
    });
  }

  async devSimulateDownloadedUpdate(payload = {}) {
    this.ensureDevUpdateSimulationAccess();
    await globalThis.window.elemintz.updates.devMarkDownloaded(payload);
    return this.refreshUpdateCoordinatorState();
  }

  async devRequestInstallWhenSafe() {
    this.ensureDevUpdateSimulationAccess();
    await globalThis.window.elemintz.updates.requestInstallWhenSafe();
    return this.refreshUpdateCoordinatorState();
  }

  async devCancelDeferredUpdateInstall() {
    this.ensureDevUpdateSimulationAccess();
    await globalThis.window.elemintz.updates.cancelDeferredInstall();
    return this.refreshUpdateCoordinatorState();
  }

  async requestManualUpdateCheck() {
    const updates = globalThis.window?.elemintz?.updates ?? null;
    if (!updates?.requestCheck) {
      throw new Error("Update checks are unavailable in this build.");
    }

    console.info("[Updates][ManualCheck] requested", {
      before: this.getUpdateDiagnostics()
    });

    try {
      await updates.requestCheck();
      const nextState = await this.refreshUpdateCoordinatorState();
      console.info("[Updates][ManualCheck] completed", {
        after: this.getUpdateDiagnostics()
      });
      return nextState;
    } catch (error) {
      const nextState = await this.refreshUpdateCoordinatorState();
      console.error("[Updates][ManualCheck] failed", {
        message: String(error?.message ?? error ?? "Unknown update check failure."),
        after: this.getUpdateDiagnostics()
      });
      return nextState;
    }
  }

  async requestUpdateInstall() {
    const updates = globalThis.window?.elemintz?.updates ?? null;
    if (!updates?.requestInstall) {
      throw new Error("Update install is unavailable in this build.");
    }

    const safetyState = this.getUpdateSafetyState();

    console.info("[Updates][InstallRequest] requested", {
      safetyState,
      before: this.getUpdateDiagnostics()
    });

    try {
      await updates.requestInstall(safetyState);
      const nextState = await this.refreshUpdateCoordinatorState();
      console.info("[Updates][InstallRequest] completed", {
        after: this.getUpdateDiagnostics()
      });
      return nextState;
    } catch (error) {
      const nextState = await this.refreshUpdateCoordinatorState();
      console.error("[Updates][InstallRequest] failed", {
        message: String(error?.message ?? error ?? "Unknown update install failure."),
        after: this.getUpdateDiagnostics()
      });
      return nextState;
    }
  }

  buildOnlineEquippedCosmetics(profile = null) {
    const equippedVariants =
      profile?.cosmetics?.snapshot?.equipped?.elementCardVariant ??
      profile?.equippedCosmetics?.elementCardVariant ??
      profile?.cosmetics?.equipped?.elementCardVariant ??
      profile?.cosmetics?.elementCardVariant ??
      {};

      return {
        avatar: String(this.getOnlineEquippedCosmeticValue(profile, "avatar", ONLINE_DEFAULT_EQUIPPED_COSMETICS.avatar)),
        background: String(this.getOnlineEquippedCosmeticValue(profile, "background", ONLINE_DEFAULT_EQUIPPED_COSMETICS.background)),
        cardBack: String(this.getOnlineEquippedCosmeticValue(profile, "cardBack", ONLINE_DEFAULT_EQUIPPED_COSMETICS.cardBack)),
        elementCardVariant: this.normalizeElementCardVariantMap(equippedVariants),
        title: String(this.getOnlineEquippedCosmeticValue(profile, "title", ONLINE_DEFAULT_EQUIPPED_COSMETICS.title)),
        badge: String(this.getOnlineEquippedCosmeticValue(profile, "badge", ONLINE_DEFAULT_EQUIPPED_COSMETICS.badge))
      };
  }

  buildProfileFromServerSnapshot(serverProfile) {
    const cosmetics = serverProfile?.cosmetics ?? null;
    const stats = serverProfile?.stats ?? null;
    const currency = serverProfile?.currency ?? null;
    const baseProfile =
      serverProfile?.profile && typeof serverProfile.profile === "object"
        ? serverProfile.profile
        : {};
    const hasDomainData =
      Boolean(serverProfile?.username) ||
      Object.keys(baseProfile).length > 0 ||
      Boolean(cosmetics) ||
      Boolean(stats) ||
      Boolean(currency);
    if (!hasDomainData) {
      return null;
    }

    const nextUsername = String(serverProfile?.username ?? baseProfile?.username ?? "").trim() || null;
    const mergedProfile = {
      ...baseProfile,
      ...(nextUsername ? { username: nextUsername } : {}),
      ...(cosmetics ? { cosmetics } : {}),
      ...(cosmetics
        ? {
            equippedCosmetics:
              cosmetics.snapshot?.equipped ??
              cosmetics.equipped ??
              baseProfile?.equippedCosmetics ??
              null,
            ownedCosmetics:
              cosmetics.snapshot?.owned ??
              cosmetics.owned ??
              baseProfile?.ownedCosmetics ??
              null,
            cosmeticLoadouts:
              cosmetics.snapshot?.loadouts ??
              cosmetics.loadouts ??
              baseProfile?.cosmeticLoadouts ??
              null,
            cosmeticRandomizeAfterMatch:
              cosmetics.snapshot?.preferences ??
              cosmetics.preferences ??
              baseProfile?.cosmeticRandomizeAfterMatch ??
              null
          }
        : {}),
      ...(stats
        ? {
            wins: stats.summary?.wins ?? baseProfile?.wins ?? 0,
            losses: stats.summary?.losses ?? baseProfile?.losses ?? 0,
            gamesPlayed: stats.summary?.gamesPlayed ?? baseProfile?.gamesPlayed ?? 0,
            warsEntered: stats.summary?.warsEntered ?? baseProfile?.warsEntered ?? 0,
            warsWon: stats.summary?.warsWon ?? baseProfile?.warsWon ?? 0,
            cardsCaptured: stats.summary?.cardsCaptured ?? baseProfile?.cardsCaptured ?? 0,
            modeStats: stats.modes ?? baseProfile?.modeStats ?? null
          }
        : {}),
      ...(currency
        ? {
            tokens: Number(currency.tokens ?? baseProfile?.tokens ?? 0)
          }
        : {})
    };
    const retroactiveUnlocks = evaluateRetroactiveAchievements(mergedProfile);
    return retroactiveUnlocks.length > 0
      ? applyAchievementUnlocks(mergedProfile, retroactiveUnlocks).profile
      : mergedProfile;
  }

  buildAchievementCatalogForProfile(profile) {
    return buildAchievementCatalog(profile ?? {});
  }

  mergeServerOwnedProfileDomains(localProfile, serverProfile) {
    const serverProfileView = this.buildProfileFromServerSnapshot(serverProfile);
    if (!serverProfileView) {
      return localProfile;
    }

    return {
      ...(localProfile ?? {}),
      ...serverProfileView,
      username: serverProfileView.username ?? localProfile?.username ?? null,
      tokens: serverProfileView.tokens ?? localProfile?.tokens ?? 0,
      wins: serverProfileView.wins ?? localProfile?.wins ?? 0,
      losses: serverProfileView.losses ?? localProfile?.losses ?? 0,
      gamesPlayed: serverProfileView.gamesPlayed ?? localProfile?.gamesPlayed ?? 0,
      warsEntered: serverProfileView.warsEntered ?? localProfile?.warsEntered ?? 0,
      warsWon: serverProfileView.warsWon ?? localProfile?.warsWon ?? 0,
      cardsCaptured: serverProfileView.cardsCaptured ?? localProfile?.cardsCaptured ?? 0,
      modeStats: serverProfileView.modeStats ?? localProfile?.modeStats ?? null,
      equippedCosmetics: serverProfileView.equippedCosmetics ?? localProfile?.equippedCosmetics ?? null,
      ownedCosmetics: serverProfileView.ownedCosmetics ?? localProfile?.ownedCosmetics ?? null,
      cosmeticLoadouts: serverProfileView.cosmeticLoadouts ?? localProfile?.cosmeticLoadouts ?? null,
      cosmeticRandomizeAfterMatch:
        serverProfileView.cosmeticRandomizeAfterMatch ?? localProfile?.cosmeticRandomizeAfterMatch ?? null
    };
  }

  applyServerProfileSnapshot(serverProfile, { fallbackProfile = null } = {}) {
    const nextProfile = this.mergeSeenAnnouncementsIntoProfile(
      this.buildProfileFromServerSnapshot(serverProfile),
      fallbackProfile ?? this.profile
    );
    if (nextProfile) {
      const nextProfileUsername = nextProfile.username ?? this.username;
      const rememberedAuthoritativeProfile = this.getRememberedAuthoritativeOwnProfile(
        nextProfileUsername,
        this.onlinePlayState
      );
      const shouldPreserveRememberedProfile =
        rememberedAuthoritativeProfile &&
        Boolean(
          this.isFallbackLikeAuthenticatedProfile(nextProfile) &&
          !this.isFallbackLikeAuthenticatedProfile(rememberedAuthoritativeProfile)
        );
      this.profile = shouldPreserveRememberedProfile ? rememberedAuthoritativeProfile : nextProfile;
      this.username = this.profile?.username ?? nextProfileUsername ?? this.username;
      if (this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, nextProfileUsername)) {
        if (!shouldPreserveRememberedProfile) {
          this.rememberAuthoritativeOwnProfile(nextProfile, {
            username: nextProfileUsername,
            onlineState: this.onlinePlayState
          });
        }
        this.setOwnProfileHydrationState("ready", {
          username: this.profile?.username ?? nextProfileUsername
        });
      }
    }

    const progression = serverProfile?.progression ?? null;
    if (progression) {
      this.dailyChallenges = {
        daily: progression.dailyChallenges ?? this.dailyChallenges?.daily ?? null,
        weekly: progression.weeklyChallenges ?? this.dailyChallenges?.weekly ?? null,
        dailyLogin: progression.dailyLogin ?? this.dailyChallenges?.dailyLogin ?? null
      };
      if (this.profile && progression.xp) {
        this.profile = {
          ...this.profile,
          ...progression.xp
        };
      }
    }

    return this.profile;
  }

  buildAchievementUnlockPresentationKey(achievement, playerName) {
    const safePlayerName = String(playerName ?? "").trim() || "Player";
    const safeAchievement =
      achievement && typeof achievement === "object" && !Array.isArray(achievement)
        ? achievement
        : {};
    const id = String(safeAchievement.id ?? "").trim() || "unknown";
    const count = Math.max(0, Number(safeAchievement.count ?? 0));
    const lastUnlockedAt = String(safeAchievement.lastUnlockedAt ?? "").trim() || "none";
    const firstUnlockedAt = String(safeAchievement.firstUnlockedAt ?? "").trim() || "none";

    return `${safePlayerName}|${id}|${count}|${lastUnlockedAt}|${firstUnlockedAt}`;
  }

  shouldPresentAchievementUnlock(achievement, playerName) {
    const key = this.buildAchievementUnlockPresentationKey(achievement, playerName);
    if (this.presentedAchievementUnlockKeys.has(key)) {
      return false;
    }

    this.presentedAchievementUnlockKeys.add(key);
    return true;
  }

  async fetchAuthenticatedHotseatProfile({ mode = "login", username = "", email = "", password = "" } = {}) {
    const authMode = String(mode ?? "login").trim().toLowerCase() === "register" ? "register" : "login";
    const request =
      authMode === "register"
        ? { mode: authMode, username, email, password }
        : { mode: authMode, email, password };
    const result = await window.elemintz?.multiplayer?.authenticateHotseatIdentity?.(request);
    if (!result?.ok) {
      throw new Error(result?.error?.message ?? "Unable to authenticate this player.");
    }

    const profile = this.buildProfileFromServerSnapshot(result.profile);
    if (!profile?.username) {
      throw new Error("Authenticated player profile could not be loaded.");
    }

    return {
      account: result.account ?? null,
      session: result.session ?? null,
      accountId: result.session?.accountId ?? result.account?.accountId ?? null,
      profile,
      snapshot: result.profile ?? null
    };
  }

  async resolveLocalHotseatPlayerOne(setup = {}) {
    if (this.onlinePlayState?.session?.authenticated && String(this.username ?? "").trim()) {
      const snapshot =
        (await window.elemintz?.multiplayer?.getProfile?.({ username: this.username })) ?? null;
      const profile = this.buildProfileFromServerSnapshot(snapshot);
      if (!profile?.username) {
        throw new Error("Unable to load the signed-in Player 1 profile.");
      }

      this.profile = profile;
      this.username = profile.username;
      return {
        accountId: this.onlinePlayState?.session?.accountId ?? null,
        session: {
          token: null,
          username: profile.username ?? this.username ?? null,
          authenticated: Boolean(this.onlinePlayState?.session?.authenticated)
        },
        profile
      };
    }

    const authAction =
      String(setup?.mode ?? "login").trim().toLowerCase() === "register"
        ? window.elemintz?.multiplayer?.register
        : window.elemintz?.multiplayer?.login;
    if (typeof authAction !== "function") {
      throw new Error("Player 1 account authentication is unavailable.");
    }

    const authResult = await authAction({
      username: setup?.username,
      email: setup?.email,
      password: setup?.password
    });
    if (!authResult?.ok) {
      throw new Error(authResult?.error?.message ?? "Unable to authenticate Player 1.");
    }

    this.onlinePlayState = this.normalizeOnlinePlayState(
      await window.elemintz?.multiplayer?.getState?.()
    );
    this.username =
      authResult?.session?.username ??
      authResult?.account?.username ??
      String(setup?.username ?? "").trim();

    await this.loadPreferredProfileForOnlineSession({
      username: this.username,
      onlineState: this.onlinePlayState,
      allowEnsureLocal: false
    });

    if (!this.profile?.username) {
      throw new Error("Unable to load the authenticated Player 1 profile.");
    }

    return {
      accountId: authResult?.session?.accountId ?? authResult?.account?.accountId ?? null,
      session: authResult?.session ?? null,
      profile: this.profile
    };
  }

  async resolveLocalHotseatPlayers(setup = {}) {
    const playerOne = await this.resolveLocalHotseatPlayerOne(setup?.p1 ?? {});
    const playerTwo = await this.fetchAuthenticatedHotseatProfile(setup?.p2 ?? {});

    if (!playerOne?.profile?.username || !playerTwo?.profile?.username) {
      throw new Error("Both hotseat players must have valid authenticated profiles.");
    }

    if (
      String(playerOne.accountId ?? "").trim() &&
      String(playerTwo.account?.accountId ?? "").trim() &&
      playerOne.accountId === playerTwo.account.accountId
    ) {
      throw new Error("Player 1 and Player 2 must use different EleMintz accounts.");
    }

    return {
      p1: playerOne.profile,
      p2: playerTwo.profile,
      authorities: {
        p1: {
          username: playerOne.profile.username ?? null,
          accountId: playerOne.accountId ?? null,
          sessionToken: playerOne.session?.token ?? null
        },
        p2: {
          username: playerTwo.profile.username ?? null,
          accountId: playerTwo.accountId ?? playerTwo.account?.accountId ?? null,
          sessionToken: playerTwo.session?.token ?? null
        }
      }
    };
  }

  async loadPreferredProfileForOnlineSession({
    username = this.username,
    onlineState = this.onlinePlayState,
    allowEnsureLocal = false
  } = {}) {
    const safeUsername = String(username ?? "").trim();
    if (!safeUsername) {
      return this.profile;
    }

    const onlineConnected = String(onlineState?.connectionStatus ?? "").toLowerCase() === "connected";
    const isAuthenticatedOwnProfileFlow = this.isAuthenticatedOnlineProfileFlow(onlineState, safeUsername);
    const hadHydratedOwnProfile =
      isAuthenticatedOwnProfileFlow && this.isOwnProfileHydrated(safeUsername, onlineState);
    if (isAuthenticatedOwnProfileFlow) {
      this.setOwnProfileHydrationState("pending", { username: safeUsername });
    }

    const activeProfileMatches =
      String(this.profile?.username ?? "").trim().toLowerCase() === safeUsername.toLowerCase();
    const localProfile = isAuthenticatedOwnProfileFlow
      ? null
      : onlineConnected && activeProfileMatches
        ? this.profile
        : (
          window.elemintz?.state?.getProfile
            ? await window.elemintz.state.getProfile(safeUsername)
            : null
        );

    if (onlineConnected && window.elemintz?.multiplayer?.getProfile) {
      const serverProfile = await window.elemintz.multiplayer.getProfile({ username: safeUsername });
      const fallbackProfileForServer =
        serverProfile &&
        isAuthenticatedOwnProfileFlow &&
        this.screenFlow === "menu" &&
        !localProfile &&
        window.elemintz?.state?.getProfile
          ? await window.elemintz.state.getProfile(safeUsername)
          : localProfile;
      const nextProfile = this.applyServerProfileSnapshot(serverProfile, {
        fallbackProfile: fallbackProfileForServer
      });
      if (nextProfile) {
        return this.preserveAuthenticatedOwnProfileIfSafer({
          username: safeUsername,
          onlineState,
          reason: "loadPreferredProfileForOnlineSession:serverProfile"
        });
      }
    }

    if (isAuthenticatedOwnProfileFlow) {
      const preservedProfile = this.preserveAuthenticatedOwnProfileIfSafer({
        username: safeUsername,
        onlineState,
        reason: "loadPreferredProfileForOnlineSession:nullServer"
      });
      if (preservedProfile) {
        return preservedProfile;
      }
      if (!hadHydratedOwnProfile) {
        this.profile = null;
      }
      this.setOwnProfileHydrationState("error", {
        username: safeUsername,
        message: "Unable to load the authenticated profile snapshot."
      });
      return this.profile;
    }

    if (allowEnsureLocal && window.elemintz?.state?.ensureProfile) {
      this.profile = await window.elemintz.state.ensureProfile(safeUsername);
      return this.profile;
    }

    if (localProfile) {
      this.profile = localProfile;
    }
    return this.profile;
  }

  async buildOnlineRoomIdentityPayload() {
    const latestProfile = await this.loadPreferredProfileForOnlineSession({
      username: this.username,
      onlineState: this.onlinePlayState,
      allowEnsureLocal: false
    });

    return {
      username: latestProfile?.username ?? this.username,
      equippedCosmetics: this.buildOnlineEquippedCosmetics(latestProfile)
    };
  }

  normalizeOnlineRoomPlayer(player) {
    if (!player) {
      return null;
    }

    return {
      ...player,
      equippedCosmetics: this.buildOnlineEquippedCosmetics(player)
    };
  }

  buildResolvedOnlinePlayerIdentity(player, slotLabel) {
    if (!player) {
      return null;
    }

    const equippedCosmetics = this.buildOnlineEquippedCosmetics(player);
    const profileLike = {
      ...player,
      title: player?.title ?? equippedCosmetics.title,
      equippedCosmetics,
      cosmetics: {
        ...(player?.cosmetics ?? {}),
        avatar: equippedCosmetics.avatar,
        background: equippedCosmetics.background,
        badge: equippedCosmetics.badge
      }
    };
    const playerDisplay = this.buildPlayerDisplay(profileLike, player?.username ?? slotLabel, "Initiate");

    return {
      slotLabel,
      username: player?.username ?? slotLabel,
      connected: player?.connected !== false,
      avatarId: playerDisplay.avatarId ?? equippedCosmetics.avatar,
      titleId: playerDisplay.titleId ?? equippedCosmetics.title,
      badgeId: playerDisplay.badgeId ?? equippedCosmetics.badge,
      titleIcon: playerDisplay.titleIcon ?? null,
      avatarImage: playerDisplay.avatar,
      backgroundImage: this.getBackgroundFromProfile(profileLike),
      cardBackId: equippedCosmetics.cardBack,
      cardBackImage: getCardBackImage(equippedCosmetics.cardBack),
      titleLabel: playerDisplay.title,
      badgeImage: playerDisplay.featuredBadge,
      variantSelection: equippedCosmetics.elementCardVariant,
      variantImages: getVariantCardImages(equippedCosmetics.elementCardVariant)
      };
  }

  buildOnlineOpponentCardVariants(
    room = null,
    {
      socketId = this.onlinePlayState?.socketId ?? null,
      sessionUsername = this.onlinePlayState?.session?.username ?? this.username ?? null
    } = {}
  ) {
    const activeSocketId = String(socketId ?? "").trim();
    const activeUsername = String(sessionUsername ?? "").trim();
    const hostSocketId = String(room?.host?.socketId ?? "").trim();
    const guestSocketId = String(room?.guest?.socketId ?? "").trim();
    const hostUsername = String(room?.host?.username ?? "").trim();
    const guestUsername = String(room?.guest?.username ?? "").trim();
    const remoteIdentity =
      activeSocketId && activeSocketId === guestSocketId
        ? room?.hostResolvedIdentity ?? null
        : activeSocketId && activeSocketId === hostSocketId
          ? room?.guestResolvedIdentity ?? null
          : activeUsername && activeUsername === guestUsername
            ? room?.hostResolvedIdentity ?? null
            : activeUsername && activeUsername === hostUsername
              ? room?.guestResolvedIdentity ?? null
              : room?.guestResolvedIdentity ?? null;

    return this.normalizeElementCardVariantMap(remoteIdentity?.variantSelection ?? null);
  }

  async maybeShowLoadoutUnlockNotice() {
    if (!this.username || !globalThis.window?.elemintz?.state?.acknowledgeLoadoutUnlocks) {
      return;
    }

    if (this.isAuthenticatedOnlineProfileFlow()) {
      return;
    }

    try {
      const result = await globalThis.window.elemintz.state.acknowledgeLoadoutUnlocks(this.username);
      if (!result) {
        return;
      }

      this.profile = result.profile ?? this.profile;
      const unlockedSlots = Array.isArray(result.newlyUnlockedSlots) ? result.newlyUnlockedSlots : [];
      if (unlockedSlots.length === 0) {
        return;
      }

      for (const slot of unlockedSlots) {
        const slotNumber = Number(slot?.slotNumber ?? slot);
        const nextText = result.nextUnlockLevel
          ? `Next unlock: Level ${result.nextUnlockLevel}`
          : "All loadout slots unlocked";
        const bodyHtml = `
          <div class="loadout-unlock-modal">
            <p class="loadout-unlock-lead">You can now save cosmetic presets in Profile / Cosmetics.</p>
            <section class="loadout-unlock-section">
              <p class="loadout-unlock-label">A loadout saves your:</p>
              <ul class="loadout-unlock-list">
                <li>Avatar</li>
                <li>Title</li>
                <li>Badge</li>
                <li>Background</li>
                <li>Card Back</li>
                <li>Card Variants</li>
              </ul>
            </section>
            <section class="loadout-unlock-section">
              <p class="loadout-unlock-label">Use:</p>
              <ul class="loadout-unlock-list loadout-unlock-list-usage">
                <li><strong>Save to Slot</strong> <span>&mdash; stores your current setup</span></li>
                <li><strong>Load</strong> <span>&mdash; switches to a saved setup</span></li>
              </ul>
            </section>
            <p class="loadout-unlock-next">${nextText}</p>
          </div>
        `;

        await new Promise((resolve) => {
          this.modalManager.show({
            title: "New Loadout Slot Unlocked!",
            bodyHtml,
            actions: [
              {
                label: "OK",
                onClick: () => {
                  this.modalManager.hide();
                  resolve();
                }
              }
            ]
          });
        });
      }
      await this.maybeShowNewCosmeticsAnnouncement();
    } catch (error) {
      console.error("Failed to acknowledge loadout unlocks", error);
    }
  }

  hasSeenAnnouncement(key, profile = this.profile) {
    const safeKey = String(key ?? "").trim();
    if (!safeKey) {
      return false;
    }

    return Boolean(profile?.seenAnnouncements?.[safeKey]);
  }

  getAnnouncementSessionKey(key, username = this.username) {
    const safeKey = String(key ?? "").trim();
    const safeUsername = String(username ?? "").trim();
    if (!safeKey || !safeUsername) {
      return "";
    }

    return `${safeUsername}:${safeKey}`;
  }

  hasSeenAnnouncementInSession(key, username = this.username) {
    const sessionKey = this.getAnnouncementSessionKey(key, username);
    return Boolean(sessionKey) && this.seenAnnouncementSessionFlags.has(sessionKey);
  }

  markAnnouncementSeenInSession(key, username = this.username) {
    const sessionKey = this.getAnnouncementSessionKey(key, username);
    if (sessionKey) {
      this.seenAnnouncementSessionFlags.add(sessionKey);
    }
  }

  applySeenAnnouncementToProfile(key, profile = this.profile) {
    const safeKey = String(key ?? "").trim();
    if (!safeKey || !profile || typeof profile !== "object" || Array.isArray(profile)) {
      return profile;
    }

    return {
      ...profile,
      seenAnnouncements: {
        ...(profile?.seenAnnouncements ?? {}),
        [safeKey]: true
      }
    };
  }

  mergeSeenAnnouncementsIntoProfile(primaryProfile, fallbackProfile = null) {
    const primary =
      primaryProfile && typeof primaryProfile === "object" && !Array.isArray(primaryProfile)
        ? primaryProfile
        : null;
    if (!primary) {
      return primaryProfile;
    }

    const fallback =
      fallbackProfile && typeof fallbackProfile === "object" && !Array.isArray(fallbackProfile)
        ? fallbackProfile
        : null;
    const primarySeen = primary?.seenAnnouncements;
    const fallbackSeen = fallback?.seenAnnouncements;
    const primaryKeys =
      primarySeen && typeof primarySeen === "object" && !Array.isArray(primarySeen)
        ? Object.keys(primarySeen)
        : [];
    const fallbackKeys =
      fallbackSeen && typeof fallbackSeen === "object" && !Array.isArray(fallbackSeen)
        ? Object.keys(fallbackSeen)
        : [];
    const keys = new Set([...primaryKeys, ...fallbackKeys]);
    if (keys.size === 0) {
      return primary;
    }

    const mergedSeenAnnouncements = {};
    for (const key of keys) {
      mergedSeenAnnouncements[key] = Boolean(primarySeen?.[key] || fallbackSeen?.[key]);
    }

    return {
      ...primary,
      seenAnnouncements: mergedSeenAnnouncements
    };
  }

  async acknowledgeAnnouncementSeen(key) {
    const safeKey = String(key ?? "").trim();
    if (!safeKey) {
      return null;
    }

    this.markAnnouncementSeenInSession(safeKey);
    const fallbackProfile = this.applySeenAnnouncementToProfile(safeKey, this.profile ?? {});
    this.profile = fallbackProfile ?? this.profile;

    const localAcknowledge = globalThis.window?.elemintz?.state?.acknowledgeAnnouncement;
    const multiplayerAcknowledge = globalThis.window?.elemintz?.multiplayer?.acknowledgeAnnouncement;
    const useMultiplayerAuthority =
      this.hasMultiplayerProfileAccess() && typeof multiplayerAcknowledge === "function";

    try {
      let localResult = null;
      if (typeof localAcknowledge === "function") {
        localResult = await localAcknowledge({
          username: this.username,
          key: safeKey
        });
      }

      let multiplayerResult = null;
      if (useMultiplayerAuthority) {
        try {
          multiplayerResult = await multiplayerAcknowledge({
            username: this.username,
            key: safeKey
          });
        } catch {
        }
      }

      const nextProfile = multiplayerResult?.snapshot
        ? this.mergeSeenAnnouncementsIntoProfile(
            this.buildProfileFromServerSnapshot(multiplayerResult.snapshot),
            localResult?.profile ?? fallbackProfile
          )
        : this.mergeSeenAnnouncementsIntoProfile(localResult?.profile ?? fallbackProfile, this.profile);
      this.profile = nextProfile ?? fallbackProfile;
      return multiplayerResult ?? localResult ?? { key: safeKey, seen: true, profile: this.profile };
    } catch (error) {
      console.error("[Announcements] Failed to persist seen announcement", {
        username: this.username,
        key: safeKey,
        message: error?.message,
        stack: error?.stack
      });
      this.profile = fallbackProfile;
      return {
        key: safeKey,
        seen: true,
        profile: this.profile
      };
    }
  }

  isNewCosmeticsAnnouncementUiReady() {
    if (this.screenFlow !== "menu" || !this.username) {
      return false;
    }

    if (this.activeAnnouncementKey === NEW_COSMETICS_ANNOUNCEMENT_KEY) {
      return false;
    }

    if (this.pendingMatchCompletePayload || this.roundPresentation?.busy) {
      return false;
    }

    if (this.activeAdminGrantNoticeId || this.getPendingAdminGrantNotice?.(this.onlinePlayState)) {
      return false;
    }

    if (this.getActiveOnlineReconnectReminder?.()) {
      return false;
    }

    const activeAnnouncementModal =
      globalThis.document?.querySelector?.("[data-new-cosmetics-announcement='true']");
    const activeModal = globalThis.document?.querySelector?.(".modal-overlay");
    if (activeModal && !activeAnnouncementModal) {
      return false;
    }

    return true;
  }

  async maybeShowNewCosmeticsAnnouncement() {
    if (
      this.hasSeenAnnouncement(NEW_COSMETICS_ANNOUNCEMENT_KEY) ||
      this.hasSeenAnnouncementInSession(NEW_COSMETICS_ANNOUNCEMENT_KEY) ||
      !this.isNewCosmeticsAnnouncementUiReady()
    ) {
      return false;
    }

    this.activeAnnouncementKey = NEW_COSMETICS_ANNOUNCEMENT_KEY;
    this.modalManager.show({
      title: NEW_COSMETICS_ANNOUNCEMENT_TITLE,
      bodyHtml: `
        <div data-new-cosmetics-announcement="true" class="stack-sm">
          <p>${escapeHtml(NEW_COSMETICS_ANNOUNCEMENT_BODY)}</p>
        </div>
      `,
      actions: [
        {
          label: "Open Store",
          onClick: async () => {
            this.modalManager.hide();
            this.activeAnnouncementKey = null;
            await this.acknowledgeAnnouncementSeen(NEW_COSMETICS_ANNOUNCEMENT_KEY);
            await this.showStore();
          }
        },
        {
          label: "OK",
          onClick: async () => {
            this.modalManager.hide();
            this.activeAnnouncementKey = null;
            await this.acknowledgeAnnouncementSeen(NEW_COSMETICS_ANNOUNCEMENT_KEY);
          }
        }
      ]
    });
    return true;
  }

  getLocalNames() {
    return {
      p1: normalizeName(this.localPlayers?.p1, "Player 1"),
      p2: normalizeName(this.localPlayers?.p2, "Player 2")
    };
  }

  getRewardPlayerName(result, fallbackName) {
    return normalizeName(result?.profile?.username, fallbackName);
  }

  getChestCount(profile, chestType = "basic") {
    return Math.max(0, Number(profile?.chests?.[chestType] ?? 0) || 0);
  }

  getBasicChestCount(profile) {
    return this.getChestCount(profile, "basic");
  }

  getMilestoneChestCount(profile) {
    return this.getChestCount(profile, "milestone");
  }

  getChestLabel(chestType) {
    switch (String(chestType ?? "basic").trim()) {
      case "milestone":
        return "Milestone Chest";
      case "epic":
        return "Epic Chest";
      case "legendary":
        return "Legendary Chest";
      case "basic":
      default:
        return "Basic Chest";
    }
  }

  getChestVisualStateKey(chestType) {
    switch (String(chestType ?? "basic").trim()) {
      case "milestone":
        return "milestoneOpen";
      case "epic":
        return "epicOpen";
      case "legendary":
        return "legendaryOpen";
      case "basic":
      default:
        return "basicOpen";
    }
  }

  setProfileChestVisualState(chestType, isOpen) {
    const visualKey = this.getChestVisualStateKey(chestType);
    this.profileChestVisualState = {
      basicOpen: false,
      milestoneOpen: false,
      epicOpen: false,
      legendaryOpen: false,
      [visualKey]: Boolean(isOpen)
    };
  }

  async openProfileChest(chestType) {
    const safeChestType = String(chestType ?? "basic").trim() || "basic";
    if (this.profileChestOpenInFlight || this.getChestCount(this.profile, safeChestType) <= 0) {
      return;
    }

    const multiplayerOpenChest = globalThis.window?.elemintz?.multiplayer?.openChest;
    const openWithMultiplayer =
      typeof multiplayerOpenChest === "function" &&
      (
        this.hasMultiplayerProfileAccess() ||
        this.hasAuthenticatedMultiplayerSessionForUsername(this.username)
      );
    const openAuthority = openWithMultiplayer
      ? multiplayerOpenChest
      : globalThis.window?.elemintz?.state?.openChest;

    if (typeof openAuthority !== "function") {
      this.modalManager.show({
        title: "Chest Unavailable",
        body: "Unable to open this chest right now.",
        actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
      });
      return;
    }

    this.profileChestOpenInFlight = true;
    let preserveModal = false;

    try {
      const previousProfile = this.profile ? { ...this.profile } : null;
      this.setProfileChestVisualState(safeChestType, true);
      await this.showProfile();
      await delay(this.isReducedMotion() ? 0 : 220);

      const result = await openAuthority({
        username: this.username,
        chestType: safeChestType
      });

      if (result?.snapshot) {
        this.applyServerProfileSnapshot(result.snapshot, {
          fallbackProfile: result?.profile ?? this.profile
        });
      } else {
        this.profile = result?.profile ?? this.profile;
      }
      this.emitChestOpenToast(result, { previousProfile, nextProfile: this.profile });
    } catch (error) {
      preserveModal = true;
      this.modalManager.show({
        title: "Chest Open Failed",
        body: String(error?.message ?? "Unable to open this chest."),
        actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
      });
      } finally {
        this.profileChestOpenInFlight = false;
        this.setProfileChestVisualState(safeChestType, false);
        if (this.screenFlow === "profile") {
          try {
            await this.showProfile({ preserveModal });
          } catch (renderError) {
            console.error("Failed to refresh profile after chest open", renderError);
            try {
              await this.showProfile({ preserveModal });
            } catch (retryError) {
              console.error("Failed to refresh profile after chest open retry", retryError);
            }
          }
        }
      }
    }

  normalizeChestOpenToastRewards(rewards, previousProfile = null, nextProfile = null) {
    if (!rewards || typeof rewards !== "object") {
      return rewards;
    }

    const xpConversionTokenBonus = Math.max(0, Number(rewards.xpConversionTokenBonus ?? 0) || 0);
    if (xpConversionTokenBonus <= 0) {
      return rewards;
    }

    const profileLevelBefore = Math.max(
      0,
      Number(previousProfile?.playerLevel ?? 0) || 0,
      deriveLevelFromXp(previousProfile?.playerXP ?? 0)
    );
    const profileLevelAfter = Math.max(
      0,
      Number(nextProfile?.playerLevel ?? 0) || 0,
      deriveLevelFromXp(nextProfile?.playerXP ?? 0)
    );
    const wasAlreadyAtMaxLevel = profileLevelBefore >= MAX_LEVEL;
    const isAtMaxLevelAfterOpen = profileLevelAfter >= MAX_LEVEL;

    if (!wasAlreadyAtMaxLevel && !isAtMaxLevelAfterOpen) {
      return rewards;
    }

    return {
      ...rewards,
      xp: 0
    };
  }

  emitChestOpenToast(result, { previousProfile = null, nextProfile = null } = {}) {
    if (!result?.rewards) {
      return;
    }

    this.toastManager.showChestOpenReward?.({
      rewards: this.normalizeChestOpenToastRewards(result.rewards, previousProfile, nextProfile),
      chestType: result.chestType
    });

    const levelBefore = Math.max(1, Number(result?.levelBefore ?? previousProfile?.playerLevel ?? 1) || 1);
    const levelAfter = Math.max(1, Number(result?.levelAfter ?? nextProfile?.playerLevel ?? levelBefore) || levelBefore);
    if (levelAfter > levelBefore) {
      this.toastManager.showLevelUp?.({
        fromLevel: levelBefore,
        toLevel: levelAfter,
        rewards: Array.isArray(result?.levelRewards) ? result.levelRewards : [],
        playerName: this.username
      });
    }
  }

  async maybeShowMilestoneChestRewardNotice() {
    const localAcknowledge = globalThis.window?.elemintz?.state?.acknowledgeMilestoneChestReward;
    const multiplayerAcknowledge =
      globalThis.window?.elemintz?.multiplayer?.acknowledgeMilestoneChestReward;
    const useMultiplayerAuthority =
      this.isAuthenticatedOnlineProfileFlow() && typeof multiplayerAcknowledge === "function";
    if (
      this.screenFlow !== "profile" ||
      this.profileMilestoneChestNoticeOpen ||
      !this.username ||
      (!useMultiplayerAuthority && typeof localAcknowledge !== "function")
    ) {
      return;
    }

    const pendingLevel = Math.max(0, Number(this.profile?.pendingMilestoneChestRewardLevel ?? 0) || 0);
    if (pendingLevel <= 0) {
      return;
    }

    this.profileMilestoneChestNoticeOpen = true;

    await new Promise((resolve) => {
      this.modalManager.show({
        title: "Level Reward Available",
        body: `Congrats ${this.username} on level ${pendingLevel}, a FREE Token Reward is now Available`,
        actions: [
          {
            label: "OK",
            onClick: async () => {
              this.modalManager.hide();
              try {
                const result = useMultiplayerAuthority
                  ? await multiplayerAcknowledge({
                      username: this.username,
                      level: pendingLevel
                    })
                  : await localAcknowledge({
                      username: this.username,
                      level: pendingLevel
                    });
                this.profile = result?.snapshot
                  ? this.buildProfileFromServerSnapshot(result.snapshot)
                  : result?.profile ?? this.profile;
              } catch (error) {
                console.error("Failed to acknowledge milestone chest reward", error);
              } finally {
                this.profileMilestoneChestNoticeOpen = false;
                resolve();
                if (this.screenFlow === "profile") {
                  await this.showProfile();
                }
              }
            }
          }
        ]
      });
    });
  }

  normalizeOnlinePlayState(state) {
    const normalizedHost = this.normalizeOnlineRoomPlayer(state?.room?.host);
    const normalizedGuest = this.normalizeOnlineRoomPlayer(state?.room?.guest);
    let normalizedRoom = state?.room
      ? {
          ...state.room,
          host: normalizedHost,
          guest: normalizedGuest,
          hostResolvedIdentity: this.buildResolvedOnlinePlayerIdentity(normalizedHost, "Host"),
          guestResolvedIdentity: this.buildResolvedOnlinePlayerIdentity(normalizedGuest, "Guest"),
          hostHand:
            state.room.hostHand ??
            (state.room.status === "full"
              ? { fire: 2, water: 2, earth: 2, wind: 2 }
              : null),
          guestHand:
            state.room.guestHand ??
            (state.room.status === "full"
              ? { fire: 2, water: 2, earth: 2, wind: 2 }
              : null),
          warPot: {
            host: Array.isArray(state.room.warPot?.host) ? [...state.room.warPot.host] : [],
            guest: Array.isArray(state.room.warPot?.guest) ? [...state.room.warPot.guest] : []
          },
          moveSync:
            state.room.moveSync ??
            (state.room.status === "full"
              ? {
                  hostSubmitted: false,
                  guestSubmitted: false,
                  submittedCount: 0,
                  bothSubmitted: false,
                  updatedAt: null
                }
              : null),
          taunts: Array.isArray(state.room.taunts)
            ? state.room.taunts.map((entry) => ({
                id: entry?.id ?? null,
                speaker: entry?.speaker ?? entry?.senderName ?? "Player",
                senderName: entry?.senderName ?? entry?.speaker ?? "Player",
                senderRole: entry?.senderRole ?? null,
                text: entry?.text ?? "",
                kind: entry?.kind ?? "player",
                sentAt: entry?.sentAt ?? null
              }))
            : []
          }
        : null;
    if (normalizedRoom) {
      const onlineWarPileSummary = this.buildOnlineWarPileSummary(normalizedRoom);
      normalizedRoom = {
        ...normalizedRoom,
        ...onlineWarPileSummary,
        opponentCardVariants: this.buildOnlineOpponentCardVariants(
          normalizedRoom,
          {
            socketId: state?.socketId ?? this.onlinePlayState?.socketId ?? null,
            sessionUsername: state?.session?.username ?? this.onlinePlayState?.session?.username ?? this.username ?? null
          }
        )
      };
    }

    const fallback = {
      connectionStatus: "disconnected",
      socketId: null,
      room: null,
      latestRoundResult: null,
      lastCompletedBattleResult: null,
      pendingAdminGrantNotices: [],
      lastError: null,
      statusMessage: "Offline. Open Online Play to connect."
    };
    const previousRoomCode = String(this.onlinePlayState?.room?.roomCode ?? "").trim();
    const nextRoomCode = String(normalizedRoom?.roomCode ?? state?.room?.roomCode ?? "").trim();
    const extractedCompletedBattleResult = this.extractCompletedOnlineBattleLogResult(state);
    const preservedBattleLogResult =
      previousRoomCode && nextRoomCode && previousRoomCode === nextRoomCode
        ? this.cloneOnlineBattleLogResult(this.onlinePlayState?.lastCompletedBattleResult)
        : null;

    return {
      ...fallback,
      ...(state ?? {}),
      room: normalizedRoom,
      pendingAdminGrantNotices: Array.isArray(state?.pendingAdminGrantNotices)
        ? state.pendingAdminGrantNotices
            .map((entry) => ({
              transactionId: String(entry?.transactionId ?? "").trim() || null,
              targetUsername: String(entry?.targetUsername ?? "").trim() || null,
              message: String(entry?.message ?? "").trim(),
              payload: {
                xp: Math.max(0, Number(entry?.payload?.xp ?? 0) || 0),
                tokens: Math.max(0, Number(entry?.payload?.tokens ?? 0) || 0),
                chests: Array.isArray(entry?.payload?.chests)
                  ? entry.payload.chests.map((chest) => ({
                      chestType: String(chest?.chestType ?? "").trim() || null,
                      amount: Math.max(0, Number(chest?.amount ?? 0) || 0)
                    }))
                  : []
              },
              timestamp: entry?.timestamp ?? null
            }))
            .filter((entry) => entry.transactionId)
        : [],
      latestAuthoritativeRoundResult: state?.latestAuthoritativeRoundResult
        ? {
            ...state.latestAuthoritativeRoundResult,
            submittedCards: {
              host: state.latestAuthoritativeRoundResult.submittedCards?.host ?? null,
              guest: state.latestAuthoritativeRoundResult.submittedCards?.guest ?? null
            },
            roundResult: state.latestAuthoritativeRoundResult.roundResult
              ? { ...state.latestAuthoritativeRoundResult.roundResult }
              : null,
            matchSnapshot: state.latestAuthoritativeRoundResult.matchSnapshot
              ? { ...state.latestAuthoritativeRoundResult.matchSnapshot }
              : null,
            animation: state.latestAuthoritativeRoundResult.animation
              ? { ...state.latestAuthoritativeRoundResult.animation }
              : null,
            syncSource: state.latestAuthoritativeRoundResult.syncSource ?? null
          }
        : null,
      lastCompletedBattleResult: state?.lastCompletedBattleResult
        ? this.cloneOnlineBattleLogResult(state.lastCompletedBattleResult)
        : extractedCompletedBattleResult ?? preservedBattleLogResult
    };
  }

  buildOnlineWarPileSummary(room) {
    const normalizedHostPot = Array.isArray(room?.warPot?.host)
      ? room.warPot.host
          .map((card) => String(card ?? "").trim().toLowerCase())
          .filter((card) => ELEMENT_CARD_VARIANT_ELEMENTS.includes(card))
      : [];
    const normalizedGuestPot = Array.isArray(room?.warPot?.guest)
      ? room.warPot.guest
          .map((card) => String(card ?? "").trim().toLowerCase())
          .filter((card) => ELEMENT_CARD_VARIANT_ELEMENTS.includes(card))
      : [];
    const derivedPileCards = [];
    const committedRoundCount = Math.max(normalizedHostPot.length, normalizedGuestPot.length);

    for (let index = 0; index < committedRoundCount; index += 1) {
      const hostCard = normalizedHostPot[index] ?? null;
      const guestCard = normalizedGuestPot[index] ?? null;

      if (hostCard) {
        derivedPileCards.push(hostCard);
      }

      if (guestCard) {
        derivedPileCards.push(guestCard);
      }
    }

    const derivedPileCount = derivedPileCards.length;
    const derivedWarPileSizes = Array.isArray(room?.warRounds) && room.warRounds.length > 0
      ? room.warRounds
          .map((_, index) => Math.min(derivedPileCount, (index + 1) * 2))
          .filter((size, index, values) => size > 0 && (index === 0 || size !== values[index - 1]))
      : [];
    const existingPileCount = Math.max(0, Number(room?.pileCount ?? 0) || 0);
    const existingWarPileCards = Array.isArray(room?.warPileCards) ? room.warPileCards : [];
    const existingWarPileSizes = Array.isArray(room?.warPileSizes) ? room.warPileSizes : [];

    return {
      pileCount: derivedPileCount > 0 ? derivedPileCount : existingPileCount,
      warPileCards: derivedPileCards.length > 0 ? derivedPileCards : existingWarPileCards,
      warPileSizes: derivedWarPileSizes.length > 0 ? derivedWarPileSizes : existingWarPileSizes
    };
  }

  formatMultiplayerErrorDetail(value) {
    if (value == null) {
      return "";
    }

    if (typeof value === "string") {
      return value.trim();
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  formatMultiplayerErrorMessage(error, fallbackMessage = "") {
    if (!error && !fallbackMessage) {
      return "";
    }

    const message = String(error?.message ?? "").trim();
    const serverUrl = String(error?.serverUrl ?? "").trim();
    const description = this.formatMultiplayerErrorDetail(error?.description);
    const context = this.formatMultiplayerErrorDetail(error?.context);
    const parts = [message || fallbackMessage].filter(Boolean);

    if (serverUrl && !parts.some((entry) => entry.includes(serverUrl))) {
      parts.push(`serverUrl=${serverUrl}`);
    }

    if (description && !parts.some((entry) => entry.includes(`description=${description}`))) {
      parts.push(`description=${description}`);
    }

    if (context && !parts.some((entry) => entry.includes(`context=${context}`))) {
      parts.push(`context=${context}`);
    }

    return parts.join(" | ");
  }

  formatPlayerFacingMessage(message, fallbackMessage = "Something went wrong. Please try again.") {
    const raw = String(message ?? "").trim();
    if (!raw) {
      return fallbackMessage;
    }

    const primary = raw
      .split("|")
      .map((entry) => entry.trim())
      .find(Boolean) ?? raw;

    const normalized = primary
      .replace(/serverUrl=.*$/i, "")
      .replace(/description=.*$/i, "")
      .replace(/context=.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return normalized || fallbackMessage;
  }

  formatPlayerFacingMultiplayerError(error, fallbackMessage = "Online Play is unavailable right now. Please try again.") {
    const rawMessage = this.formatMultiplayerErrorMessage(error, fallbackMessage);
    const normalized = String(rawMessage ?? "").trim();
    const lowercase = normalized.toLowerCase();

    if (!normalized) {
      return "";
    }

    if (lowercase.includes("session expired")) {
      return "Your session expired. Please sign in again.";
    }

    if (
      lowercase.includes("econnrefused") ||
      lowercase.includes("network") ||
      lowercase.includes("socket hang up") ||
      lowercase.includes("fetch failed") ||
      lowercase.includes("timed out")
    ) {
      return "We could not reach EleMintz Online. Please try again in a moment.";
    }

    if (
      lowercase.includes("unable to authenticate") ||
      lowercase.includes("invalid credentials") ||
      lowercase.includes("auth required") ||
      lowercase.includes("unauthorized")
    ) {
      return "Sign-in failed. Double-check your account details and try again.";
    }

    return this.formatPlayerFacingMessage(normalized, fallbackMessage);
  }

  getAppVersionDisplay() {
    const version = String(globalThis.window?.elemintz?.version ?? "").trim();
    if (!version || version.toLowerCase() === "unknown") {
      return "";
    }

    return version.startsWith("v") ? version : `v${version}`;
  }

  getPendingAdminGrantNotice(state = this.onlinePlayState) {
    this.syncPendingAdminGrantNoticeQueue(state);
    const notices = Array.isArray(state?.pendingAdminGrantNotices) ? state.pendingAdminGrantNotices : [];
    const queuedId = this.queuedAdminGrantNoticeIds[0] ?? null;

    if (queuedId) {
      return notices.find((entry) => entry?.transactionId === queuedId) ?? null;
    }

    return notices[0] ?? null;
  }

  syncPendingAdminGrantNoticeQueue(state = this.onlinePlayState) {
    const notices = Array.isArray(state?.pendingAdminGrantNotices) ? state.pendingAdminGrantNotices : [];
    const noticeIds = new Set(
      notices
        .map((entry) => String(entry?.transactionId ?? "").trim())
        .filter(Boolean)
    );

    this.queuedAdminGrantNoticeIds = this.queuedAdminGrantNoticeIds.filter((transactionId) =>
      noticeIds.has(transactionId)
    );

    for (const notice of notices) {
      const transactionId = String(notice?.transactionId ?? "").trim();
      if (!transactionId || this.queuedAdminGrantNoticeIds.includes(transactionId)) {
        continue;
      }
      this.queuedAdminGrantNoticeIds.push(transactionId);
    }
  }

  getAdminGrantNoticeSignature(state = this.onlinePlayState) {
    return (Array.isArray(state?.pendingAdminGrantNotices) ? state.pendingAdminGrantNotices : [])
      .map((entry) => String(entry?.transactionId ?? "").trim())
      .filter(Boolean)
      .join("|");
  }

  dequeuePendingAdminGrantNotice(transactionId) {
    const safeTransactionId = String(transactionId ?? "").trim();
    if (!safeTransactionId) {
      return;
    }

    this.queuedAdminGrantNoticeIds = this.queuedAdminGrantNoticeIds.filter(
      (queuedTransactionId) => queuedTransactionId !== safeTransactionId
    );
  }

  isAdminGrantNoticeUiReady() {
    return [
      "menu",
      "onlinePlay",
      "profile",
      "dailyChallenges",
      "achievements",
      "cosmetics",
      "store",
      "settings"
    ].includes(this.screenFlow);
  }

  releaseQueuedAdminGrantNotice(state = this.onlinePlayState) {
    this.maybeShowPendingAdminGrantNotice(state);
  }

  maybeShowPendingAdminGrantNotice(state = this.onlinePlayState) {
    const notice = this.getPendingAdminGrantNotice(state);
    if (!notice?.transactionId || !window.elemintz?.multiplayer?.confirmAdminGrantNotice) {
      if (this.activeAdminGrantNoticeId && !this.getPendingAdminGrantNotice()) {
        this.activeAdminGrantNoticeId = null;
      }
      return;
    }

    if (!this.isAdminGrantNoticeUiReady()) {
      return;
    }

    if (this.activeAdminGrantNoticeId === notice.transactionId) {
      return;
    }

    const activeAdminNotice = globalThis.document?.querySelector?.("[data-admin-grant-notice='true']");
    const activeModal = globalThis.document?.querySelector?.(".modal-overlay");
    if (activeModal && !activeAdminNotice) {
      return;
    }

    this.activeAdminGrantNoticeId = notice.transactionId;
    this.modalManager.show({
      title: "Reward Confirmation",
      bodyHtml: `
        <div data-admin-grant-notice="true" class="stack-sm">
          <p>${escapeHtml(notice.message || "EleMintz has sent you a reward. Click OK to confirm.")}</p>
        </div>
      `,
      actions: [
        {
          label: "OK",
          onClick: async () => {
            try {
              const confirmationResult = await window.elemintz.multiplayer.confirmAdminGrantNotice({
                transactionId: notice.transactionId
              });
              this.modalManager.hide();
              this.dequeuePendingAdminGrantNotice(notice.transactionId);
              this.activeAdminGrantNoticeId = null;
              const applied = confirmationResult?.result?.applied ?? confirmationResult?.applied ?? null;
              const levelBefore = Math.max(1, Number(applied?.levelBefore ?? 1) || 1);
              const levelAfter = Math.max(1, Number(applied?.levelAfter ?? levelBefore) || levelBefore);
              if (levelAfter > levelBefore) {
                this.toastManager.showLevelUp?.({
                  fromLevel: levelBefore,
                  toLevel: levelAfter,
                  rewards: Array.isArray(applied?.levelRewards) ? applied.levelRewards : [],
                  playerName: this.username
                });
              }
              await this.syncOnlinePlayState();
              if (this.screenFlow === "profile") {
                await this.showProfile();
              } else if (this.screenFlow === "onlinePlay") {
                this.renderOnlinePlayScreen();
              }
              this.maybeShowPendingAdminGrantNotice();
              void this.maybeShowNewCosmeticsAnnouncement();
            } catch (error) {
              this.modalManager.hide();
              this.activeAdminGrantNoticeId = null;
              this.modalManager.show({
                title: "Confirmation Failed",
                body: String(error?.message ?? "Unable to confirm this EleMintz reward."),
                actions: [
                  {
                    label: "OK",
                    onClick: () => {
                      this.modalManager.hide();
                      this.maybeShowPendingAdminGrantNotice();
                      void this.maybeShowNewCosmeticsAnnouncement();
                    }
                  }
                ]
              });
            }
          }
        }
      ]
    });
  }

  deriveOnlineChallengeSummaryKey(state) {
    const settlementKey = this.deriveOnlineSettlementRefreshKey(state);
    return settlementKey ? `${settlementKey}:challenges` : null;
  }

  deriveOnlineSettlementRefreshKey(state) {
    const room = state?.room;
    const decision = room?.rewardSettlement?.decision;
    const summary = room?.rewardSettlement?.summary;
    const username = String(this.username ?? "").trim();

    if (!room?.matchComplete || !room?.rewardSettlement?.granted || !username) {
      return null;
    }

    const hostUsername = decision?.participants?.hostUsername ?? summary?.settledHostUsername ?? null;
    const guestUsername = decision?.participants?.guestUsername ?? summary?.settledGuestUsername ?? null;

    if (hostUsername !== username && guestUsername !== username) {
      return null;
    }

    return (
      decision?.settlementKey ??
      `${room.roomCode ?? "room"}:${room.rewardSettlement?.grantedAt ?? "settled"}:${username}`
    );
  }

  async refreshOnlinePlayChallengeSummary(state = this.onlinePlayState, options = {}) {
    const summaryKey = this.deriveOnlineChallengeSummaryKey(state);

    if (!summaryKey) {
      return this.onlinePlayChallengeSummary;
    }

    if (this.onlinePlayChallengeSummaryKey === summaryKey && this.onlinePlayChallengeSummary) {
      return this.onlinePlayChallengeSummary;
    }

    if (!this.username) {
      return null;
    }

    const serverProfile =
      options?.serverProfile ??
      (window.elemintz?.multiplayer?.getProfile
        ? await window.elemintz.multiplayer.getProfile({ username: this.username })
        : null);
    const result = serverProfile
      ? {
          daily: serverProfile.progression?.dailyChallenges ?? null,
          weekly: serverProfile.progression?.weeklyChallenges ?? null
        }
      : window.elemintz?.state?.getDailyChallenges
        ? await window.elemintz.state.getDailyChallenges(this.username)
        : null;

    if (!result) {
      return null;
    }

    this.onlinePlayChallengeSummary = {
      daily: result?.daily ?? null,
      weekly: result?.weekly ?? null
    };
    this.onlinePlayChallengeSummaryKey = summaryKey;
    return this.onlinePlayChallengeSummary;
  }

  async refreshLocalProfileAfterOnlineSettlement(state = this.onlinePlayState, options = {}) {
    const refreshKey = this.deriveOnlineSettlementRefreshKey(state);
    const isAuthenticatedOwnProfileFlow =
      this.isAuthenticatedOnlineProfileFlow(state, this.username) ||
      this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, this.username);
    const hasHydratedAuthenticatedOwnProfile =
      this.isOwnProfileHydrated(this.username, state) ||
      this.isOwnProfileHydrated(this.username, this.onlinePlayState);

    if (!refreshKey) {
      return this.profile;
    }

    if (this.onlinePlayProfileRefreshKey === refreshKey && this.onlinePlayProfileRefreshPromise) {
      return this.onlinePlayProfileRefreshPromise;
    }

    if (this.onlinePlayProfileRefreshKey === refreshKey && this.profile) {
      return this.profile;
    }

    if (!this.username) {
      return this.profile;
    }

    this.onlinePlayProfileRefreshKey = refreshKey;
    this.onlinePlayProfileRefreshPromise = (async () => {
      const serverProfile =
        options?.serverProfile ??
        (window.elemintz?.multiplayer?.getProfile
          ? await window.elemintz.multiplayer.getProfile({ username: this.username })
          : null);
      const nextProfile = serverProfile
        ? this.applyServerProfileSnapshot(serverProfile, {
            fallbackProfile: this.profile
          })
        : isAuthenticatedOwnProfileFlow
          ? null
          : (
            window.elemintz?.state?.getProfile
              ? await window.elemintz.state.getProfile(this.username)
              : null
          );
      if (nextProfile) {
        this.profile = this.onlinePlayProfileRefreshKey === refreshKey
          ? await this.maybeRandomizeCosmeticsAfterMatchFor(this.username, nextProfile)
          : nextProfile;
        this.username = this.profile?.username ?? this.username;
        if (isAuthenticatedOwnProfileFlow) {
          this.rememberAuthoritativeOwnProfile(this.profile, {
            username: this.username,
            onlineState: this.onlinePlayState
          });
        }
      } else if (isAuthenticatedOwnProfileFlow && this.profile && hasHydratedAuthenticatedOwnProfile) {
        this.rememberAuthoritativeOwnProfile(this.profile, {
          username: this.username,
          onlineState: this.onlinePlayState
        });
      } else if (isAuthenticatedOwnProfileFlow && !hasHydratedAuthenticatedOwnProfile) {
        this.profile = null;
        this.setOwnProfileHydrationState("error", {
          username: this.username,
          message: "Unable to refresh the authenticated profile snapshot after online settlement."
        });
      }

      const providedChallengeStatus =
        options?.challengeStatus && (options.challengeStatus.daily || options.challengeStatus.weekly)
          ? options.challengeStatus
          : null;

      const serverChallengeStatus = serverProfile
        ? {
            daily: serverProfile.progression?.dailyChallenges ?? null,
            weekly: serverProfile.progression?.weeklyChallenges ?? null,
            dailyLogin: serverProfile.progression?.dailyLogin ?? null,
            xp: serverProfile.progression?.xp ?? null
          }
        : null;

      if (providedChallengeStatus || serverChallengeStatus || window.elemintz?.state?.getDailyChallenges) {
        const challengeStatus =
          providedChallengeStatus
            ?? serverChallengeStatus
            ?? await window.elemintz.state.getDailyChallenges(this.username);
        this.dailyChallenges = {
          daily: challengeStatus?.daily ?? null,
          weekly: challengeStatus?.weekly ?? null,
          dailyLogin: challengeStatus?.dailyLogin ?? this.dailyChallenges?.dailyLogin ?? null
        };
        if (challengeStatus?.xp && this.profile) {
          this.profile = {
            ...this.profile,
            ...challengeStatus.xp
          };
        }
      }

      return this.profile;
    })();

    try {
      return await this.onlinePlayProfileRefreshPromise;
    } finally {
      if (this.onlinePlayProfileRefreshKey === refreshKey) {
        this.onlinePlayProfileRefreshPromise = null;
      }
    }
  }

  async refreshOnlineSettlementStateFromServer(state = this.onlinePlayState) {
    if (!this.username) {
      return {
        challengeSummary: this.onlinePlayChallengeSummary,
        profile: this.profile
      };
    }

    const serverProfile =
      window.elemintz?.multiplayer?.getProfile
        ? await window.elemintz.multiplayer.getProfile({ username: this.username })
        : null;
    const challengeSummary = await this.refreshOnlinePlayChallengeSummary(state, {
      serverProfile
    });
    const profile = await this.refreshLocalProfileAfterOnlineSettlement(state, {
      serverProfile,
      challengeStatus: challengeSummary
        ? {
            daily: challengeSummary.daily ?? null,
            weekly: challengeSummary.weekly ?? null,
            dailyLogin: this.dailyChallenges?.dailyLogin ?? null
          }
        : null
    });

    return {
      challengeSummary,
      profile
    };
  }

  derivePendingReconnectReminderKey(reminder = this.onlineReconnectReminder) {
    if (!reminder?.roomCode || !reminder?.expiresAt || !reminder?.username) {
      return null;
    }

    return `${reminder.roomCode}:${reminder.expiresAt}:${reminder.username}`;
  }

  getActiveOnlineReconnectReminder(nowMs = Date.now()) {
    const reminder = this.onlineReconnectReminder;
    if (!reminder?.roomCode || !reminder?.expiresAt) {
      return null;
    }

    const expiresAtMs = new Date(reminder.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      return null;
    }

    return {
      ...reminder,
      msRemaining: Math.max(0, expiresAtMs - nowMs),
      countdownLabel: this.formatReconnectCountdown(expiresAtMs - nowMs)
    };
  }

  clearOnlineReconnectReminder({ hideModal = true } = {}) {
    this.onlineReconnectReminder = null;
    this.onlineReconnectReminderDismissedKey = null;
    if (hideModal && globalThis.document?.querySelector?.("[data-online-reconnect-reminder='true']")) {
      this.modalManager.hide();
    }
  }

  maybeCaptureOnlineReconnectReminder(previousState, nextState) {
    const previousRoom = previousState?.room ?? null;
    if (
      nextState?.connectionStatus !== "disconnected" ||
      !previousRoom ||
      previousRoom.status !== "full" ||
      previousRoom.matchComplete
    ) {
      return;
    }

    const username = String(this.username ?? "").trim();
    if (!username) {
      return;
    }

    if (previousRoom.host?.username !== username && previousRoom.guest?.username !== username) {
      return;
    }

    const authoritativeExpiresAt =
      nextState?.room?.disconnectState?.expiresAt ??
      previousRoom?.disconnectState?.expiresAt ??
      null;

    this.onlineReconnectReminder = {
      username,
      roomCode: previousRoom.roomCode,
      expiresAt: authoritativeExpiresAt ?? new Date(Date.now() + ONLINE_RECONNECT_TIMEOUT_MS).toISOString()
    };
    this.onlineReconnectReminderDismissedKey = null;
  }

  clearOnlineReconnectReminderFromState(state) {
    const reminder = this.getActiveOnlineReconnectReminder();
    if (!reminder) {
      this.clearOnlineReconnectReminder();
      return;
    }

    const room = state?.room ?? null;
    const errorCode = String(state?.lastError?.code ?? "");
    const username = String(this.username ?? "").trim();
    const reminderKey = this.derivePendingReconnectReminderKey(reminder);

    if (
      room?.roomCode === reminder.roomCode &&
      room?.status === "full" &&
      (room.host?.username === username || room.guest?.username === username)
    ) {
      this.clearOnlineReconnectReminder();
      return;
    }

    if (["ROOM_EXPIRED", "ROOM_NOT_FOUND", "ROOM_CLOSING"].includes(errorCode)) {
      this.clearOnlineReconnectReminder();
      return;
    }

    if (room?.roomCode === reminder.roomCode && (room?.status === "expired" || room?.status === "closing")) {
      this.clearOnlineReconnectReminder();
      return;
    }

    if (this.onlineReconnectReminderDismissedKey && this.onlineReconnectReminderDismissedKey !== reminderKey) {
      this.onlineReconnectReminderDismissedKey = null;
    }
  }

  ensureOnlineReconnectUiTimer() {
    const hasPausedCountdown =
      this.onlinePlayState?.room?.status === "paused" &&
      Boolean(this.onlinePlayState?.room?.disconnectState?.active) &&
      Boolean(this.onlinePlayState?.room?.disconnectState?.expiresAt);
    const hasReminder = Boolean(this.getActiveOnlineReconnectReminder());

    if (!hasPausedCountdown && !hasReminder) {
      this.clearOnlineReconnectUiTimer();
      return;
    }

    if (this.onlineReconnectUiTimerId) {
      return;
    }

    this.onlineReconnectUiTimerId = setInterval(() => {
      if (!this.getActiveOnlineReconnectReminder()) {
        this.clearOnlineReconnectReminder();
      }

      if (
        this.screenFlow === "onlinePlay" &&
        this.onlinePlayState?.room?.status === "paused" &&
        this.onlinePlayState?.room?.disconnectState?.expiresAt
      ) {
        this.renderOnlinePlayScreen();
      } else {
        this.updateOnlineReconnectReminderModal();
      }

      const stillHasPausedCountdown =
        this.onlinePlayState?.room?.status === "paused" &&
        Boolean(this.onlinePlayState?.room?.disconnectState?.active) &&
        Boolean(this.onlinePlayState?.room?.disconnectState?.expiresAt);
      const stillHasReminder = Boolean(this.getActiveOnlineReconnectReminder());
      if (!stillHasPausedCountdown && !stillHasReminder) {
        this.clearOnlineReconnectUiTimer();
      }
    }, 1000);

    this.onlineReconnectUiTimerId?.unref?.();
  }

  updateOnlineReconnectReminderModal() {
    const reminder = this.getActiveOnlineReconnectReminder();
    if (!reminder || this.screenFlow === "onlinePlay") {
      if (globalThis.document?.querySelector?.("[data-online-reconnect-reminder='true']")) {
        this.modalManager.hide();
      }
      return;
    }

    const reminderKey = this.derivePendingReconnectReminderKey(reminder);
    if (this.onlineReconnectReminderDismissedKey === reminderKey) {
      return;
    }

    const activeReminderModal = globalThis.document?.querySelector?.("[data-online-reconnect-reminder='true']");
    const activeModal = globalThis.document?.querySelector?.(".modal-overlay");
    if (activeModal && !activeReminderModal) {
      return;
    }

    this.modalManager.show({
      title: "Reconnect to Online Match",
      bodyHtml: `
        <div data-online-reconnect-reminder="true" class="stack-sm">
          <p><strong>Room Code:</strong> ${escapeHtml(reminder.roomCode)}</p>
          <p><strong>Time Remaining:</strong> ${escapeHtml(reminder.countdownLabel)}</p>
          <p>You have 60 seconds to return before the room expires as no contest.</p>
        </div>
      `,
      actions: [
        {
          label: "Reconnect Now",
          onClick: async () => {
            this.modalManager.hide();
            await this.reconnectToPendingOnlineRoom();
          }
        },
        {
          label: "Dismiss",
          onClick: () => {
            this.onlineReconnectReminderDismissedKey = reminderKey;
            this.modalManager.hide();
            void this.maybeShowNewCosmeticsAnnouncement();
          }
        }
      ]
    });
  }

  async reconnectToPendingOnlineRoom() {
    const reminder = this.getActiveOnlineReconnectReminder();
    if (!reminder || !window.elemintz?.multiplayer?.connect || !window.elemintz?.multiplayer?.joinRoom) {
      return;
    }

    this.screenFlow = "onlinePlay";
    this.onlinePlayJoinCode = reminder.roomCode;
    this.onlinePlayState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.connect());
    await this.loadPreferredProfileForOnlineSession({
      username: this.username,
      onlineState: this.onlinePlayState,
      allowEnsureLocal: false
    });
    this.renderOnlinePlayScreen();
    this.onlinePlayState = this.normalizeOnlinePlayState(
      await window.elemintz.multiplayer.joinRoom({
        roomCode: reminder.roomCode,
        username: this.username
      })
    );
    this.clearOnlineReconnectReminderFromState(this.onlinePlayState);
    this.ensureOnlineReconnectUiTimer();
    this.renderOnlinePlayScreen();
  }

  reconcileOnlinePlayRoundState(previousState, nextState) {
    const previousSubmittedCount = Number(previousState?.room?.moveSync?.submittedCount ?? 0);
    const nextSubmittedCount = Number(nextState?.room?.moveSync?.submittedCount ?? 0);
    const hasLatestRoundResult = Boolean(nextState?.latestRoundResult);
    const isSnapshotResync =
      String(nextState?.latestAuthoritativeRoundResult?.syncSource ?? "").trim() === "room_snapshot";
    const previousRoomCode = String(previousState?.room?.roomCode ?? "").trim();
    const nextRoomCode = String(nextState?.room?.roomCode ?? "").trim();
    const preservedBattleLogResult =
      previousRoomCode && nextRoomCode && previousRoomCode === nextRoomCode
        ? this.cloneOnlineBattleLogResult(previousState?.lastCompletedBattleResult)
        : null;
    const startedNextRound = previousSubmittedCount >= 2 && nextSubmittedCount === 0;
    const enteredHalfSubmittedState = previousSubmittedCount === 0 && nextSubmittedCount > 0;
    const shouldIgnoreLiveRoundResultForBattleLog = startedNextRound || enteredHalfSubmittedState;
    const nextCompletedBattleLogResult = shouldIgnoreLiveRoundResultForBattleLog
      ? null
      : this.extractCompletedOnlineBattleLogResult(nextState);
    const stateWithBattleLog = this.normalizeOnlinePlayState({
      ...nextState,
      lastCompletedBattleResult: nextCompletedBattleLogResult ?? preservedBattleLogResult
    });

    if (!hasLatestRoundResult) {
      return stateWithBattleLog;
    }

    if (isSnapshotResync) {
      return stateWithBattleLog;
    }

    if (startedNextRound) {
      console.info("[OnlinePlay][Renderer] new round detected, clearing round result");
      return this.normalizeOnlinePlayState({
        ...nextState,
        latestRoundResult: null,
        latestAuthoritativeRoundResult: null,
        lastCompletedBattleResult: preservedBattleLogResult
      });
    }

    if (enteredHalfSubmittedState) {
      console.info("[OnlinePlay][Renderer] new round detected, clearing round result");
      return this.normalizeOnlinePlayState({
        ...nextState,
        latestRoundResult: null,
        latestAuthoritativeRoundResult: null,
        lastCompletedBattleResult: preservedBattleLogResult
      });
    }

    return stateWithBattleLog;
  }

  async syncOnlinePlayState() {
    if (!window.elemintz?.multiplayer?.getState) {
      this.onlinePlayState = this.normalizeOnlinePlayState(null);
      return this.onlinePlayState;
    }

    this.onlinePlayState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.getState());
    return this.onlinePlayState;
  }

  bindOnlinePlayUpdates() {
    if (this.onlinePlayUnsubscribe || !window.elemintz?.multiplayer?.onUpdate) {
      return;
    }

    this.onlinePlayUnsubscribe = window.elemintz.multiplayer.onUpdate((state) => {
      const previousState = this.onlinePlayState;
      const nextState = this.normalizeOnlinePlayState(state);
      const previousAdminNoticeSignature = this.getAdminGrantNoticeSignature(previousState);
      this.onlinePlayState = this.reconcileOnlinePlayRoundState(previousState, nextState);
      this.handleOnlinePlaySoundTransitions(previousState, this.onlinePlayState);
      const nextAdminNoticeSignature = this.getAdminGrantNoticeSignature(this.onlinePlayState);
      const adminNoticeStateChanged = previousAdminNoticeSignature !== nextAdminNoticeSignature;
      const lostAuthenticatedSession =
        Boolean(previousState?.session?.authenticated) &&
        !Boolean(this.onlinePlayState?.session?.authenticated);
      const sessionErrorCode = String(this.onlinePlayState?.lastError?.code ?? "").trim().toUpperCase();
      const invalidatedSession =
        ["SESSION_NOT_FOUND", "SESSION_TOKEN_REQUIRED", "SESSION_INVALID", "SESSION_EXPIRED", "AUTH_REQUIRED"].includes(sessionErrorCode);
      if (lostAuthenticatedSession && invalidatedSession && this.screenFlow !== "login") {
        void this.forceReturnToLoginForInvalidSession(
          this.onlinePlayState?.lastError?.message ?? "Session expired. Please sign in again."
        );
        return;
      }
      this.maybeCaptureOnlineReconnectReminder(previousState, this.onlinePlayState);
      this.clearOnlineReconnectReminderFromState(this.onlinePlayState);
      this.ensureOnlineReconnectUiTimer();
      this.updateOnlineReconnectReminderModal();
      if (this.onlinePlayState?.latestRoundResult) {
        console.info("[OnlinePlay][Renderer] latest round result stored in renderer state", this.onlinePlayState.latestRoundResult);
      }
      if (this.screenFlow === "onlinePlay") {
        this.renderOnlinePlayScreen();
      }
      if (this.screenFlow === "profile" && adminNoticeStateChanged) {
        void this.showProfile({ preserveModal: true });
      }
      this.maybeShowPendingAdminGrantNotice(this.onlinePlayState);
      if (this.onlinePlayState?.room?.matchComplete) {
        void this.refreshOnlineSettlementStateFromServer(this.onlinePlayState)
          .then(() => {
          if (this.screenFlow === "onlinePlay") {
            this.renderOnlinePlayScreen();
          }
        });
      }
    });
  }

  renderOnlinePlayScreen() {
    this.screenFlow = "onlinePlay";
    const preservedTauntHudState = this.captureCurrentTauntHudDomState("onlinePlay");
    const tauntHud = this.getCurrentTauntHudState();
    this.screenManager.show("onlinePlay", {
      multiplayer: this.normalizeOnlinePlayState(this.onlinePlayState),
      onlineRematchRequestInFlight: Boolean(this.onlineRematchRequestPromise),
      onlineMatchTimer: this.getOnlineMatchTimerViewState(),
      onlineTurnTimer: this.getOnlineTurnTimerViewState(),
      formattedErrorMessage: this.formatPlayerFacingMultiplayerError(this.onlinePlayState?.lastError, ""),
      onlineChallengeSummary: this.onlinePlayChallengeSummary,
      profile: this.profile,
        username: this.profile?.username ?? this.username,
        joinCode: this.onlinePlayJoinCode,
        onlineCreateRoomVisibility: this.onlineCreateRoomVisibility,
        onlinePlayerCount: Number.isFinite(this.onlinePlayerCount) ? this.onlinePlayerCount : null,
        onlinePlayerCountStatus: this.onlinePlayerCountStatus,
        onlinePublicRooms: Array.isArray(this.onlinePublicRooms) ? this.onlinePublicRooms.map((room) => ({ ...room })) : [],
        onlinePublicRoomsStatus: this.onlinePublicRoomsStatus,
        onlinePublicRoomsError: this.onlinePublicRoomsError,
      now: Date.now(),
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      taunts: {
        panelOpen: this.matchTauntPanelOpen,
        messages: this.getRenderableOnlineTaunts(),
        presetLines: MATCH_TAUNT_PRESETS,
        cooldownRemainingMs: tauntHud.cooldownRemainingMs,
        canSend: tauntHud.canSend
      },
      actions: {
        createRoom: async () => {
          if (!window.elemintz?.multiplayer?.createRoom) {
            return;
          }

          const identityPayload = await this.buildOnlineRoomIdentityPayload();
          this.onlinePlayState = this.normalizeOnlinePlayState(
            await window.elemintz.multiplayer.createRoom({
              ...identityPayload,
              visibility: this.onlineCreateRoomVisibility
            })
          );
          this.onlinePublicRoomsStatus = "idle";
          this.onlinePublicRoomsError = "";
          this.ensureOnlineReconnectUiTimer();
          this.renderOnlinePlayScreen();
        },
        setCreateRoomVisibility: async (visibility) => {
          this.onlineCreateRoomVisibility = String(visibility ?? "").trim().toLowerCase() === "public"
            ? "public"
            : "private";
          this.renderOnlinePlayScreen();
        },
          browsePublicRooms: async () => {
            await this.refreshOnlinePlayLobbyData();
          },
        joinRoom: async (roomCode) => {
          if (!window.elemintz?.multiplayer?.joinRoom) {
            return;
          }

          this.onlinePlayJoinCode = String(roomCode ?? "").trim().toUpperCase();
          this.renderOnlinePlayScreen();
          const identityPayload = await this.buildOnlineRoomIdentityPayload();
          this.onlinePlayState = this.normalizeOnlinePlayState(
            await window.elemintz.multiplayer.joinRoom({
              roomCode: this.onlinePlayJoinCode,
              ...identityPayload
            })
          );
          this.onlinePublicRoomsStatus = "idle";
          this.onlinePublicRoomsError = "";
          this.clearOnlineReconnectReminderFromState(this.onlinePlayState);
          this.ensureOnlineReconnectUiTimer();
          this.renderOnlinePlayScreen();
        },
        submitMove: async (move) => {
          await this.submitOnlineMove(move, { source: "ui" });
        },
        toggleTauntsPanel: async () => {
          this.toggleMatchTauntPanel();
        },
        sendTaunt: async (line) => {
          await this.sendCurrentOnlineTaunt(line);
        },
        readyRematch: async () => {
          if (!window.elemintz?.multiplayer?.readyRematch) {
            return;
          }

          if (this.onlineRematchRequestPromise) {
            return this.onlineRematchRequestPromise;
          }

          const rematchRequestPromise = (async () => {
            try {
              const previousState = this.onlinePlayState;
              const nextState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.readyRematch());
              this.onlinePlayState = this.reconcileOnlinePlayRoundState(previousState, nextState);
              this.ensureOnlineReconnectUiTimer();
              this.renderOnlinePlayScreen();
              return this.onlinePlayState;
            } catch (error) {
              this.modalManager.show({
                title: "Rematch Failed",
                body: this.formatPlayerFacingMultiplayerError(
                  error,
                  "Unable to ready your rematch right now."
                ),
                actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
              });
              this.renderOnlinePlayScreen();
              return null;
            } finally {
              this.onlineRematchRequestPromise = null;
              if (this.screenFlow === "onlinePlay") {
                this.renderOnlinePlayScreen();
              }
            }
          })();

          this.onlineRematchRequestPromise = rematchRequestPromise;
          this.renderOnlinePlayScreen();
          return rematchRequestPromise;
        },
        viewOpponentProfile: async () => {
          const opponentUsername = this.getOnlineOpponentProfileUsername(this.onlinePlayState);
          if (!opponentUsername) {
            return false;
          }

          this.modalManager.hide();
          await this.openViewedProfile(opponentUsername, {
            preserveAchievementVisibility: true,
            onClose: async () => {
              await this.renderOnlinePlayScreen();
            }
          });
          return true;
        },
        back: async () => {
          if (window.elemintz?.multiplayer?.disconnect) {
            await window.elemintz.multiplayer.disconnect();
          }
          this.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
        }
      }
    });
    this.finalizeRenderedTauntHud("onlinePlay", preservedTauntHudState);
    this.ensureOnlineTurnTimerUi();
    this.ensureMatchTauntUiTimer();
  }

  async claimDailyLoginRewardFor(username, { showToasts = false } = {}) {
    const isAuthenticatedOnline = this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, username);
    const localClaimMethod = globalThis.window?.elemintz?.state?.claimDailyLoginReward;
    const multiplayerClaimMethod = globalThis.window?.elemintz?.multiplayer?.claimDailyLoginReward;

    if (!username || (!localClaimMethod && !multiplayerClaimMethod)) {
      console.info("[DailyLogin][Renderer] claim unavailable", {
        username,
        hasWindow: Boolean(globalThis.window),
        hasElemintz: Boolean(globalThis.window?.elemintz),
        hasState: Boolean(globalThis.window?.elemintz?.state),
        hasClaimMethod: Boolean(localClaimMethod),
        hasMultiplayerClaimMethod: Boolean(multiplayerClaimMethod)
      });
      return null;
    }

    console.info("[DailyLogin][Renderer] about to call claim", {
      username,
      showToasts,
      authority: isAuthenticatedOnline ? "multiplayer" : "local"
    });
    console.info("[DailyLogin][Renderer] request", {
      username,
      showToasts
    });
    if (isAuthenticatedOnline && !multiplayerClaimMethod) {
      console.info("[DailyLogin][Renderer] authoritative multiplayer claim unavailable", {
        username
      });
      return null;
    }

    const reward = isAuthenticatedOnline
      ? await multiplayerClaimMethod({ username })
      : await localClaimMethod?.(username);
    console.info("[DailyLogin][Renderer] claim call finished", {
      username,
      granted: Boolean(reward?.granted)
    });
    console.info("[DailyLogin][Renderer] response", {
      username,
      granted: Boolean(reward?.granted),
      eligible: reward?.dailyLoginStatus?.eligible,
      resetWindowKey: reward?.dailyLoginStatus?.loginDayKey,
      lastDailyLoginClaimDate: reward?.dailyLoginStatus?.lastDailyLoginClaimDate,
      toastRequested: Boolean(showToasts && reward?.granted)
    });
    if (!reward?.profile && !reward?.snapshot) {
      return reward;
    }

    const nextProfile = reward?.snapshot
      ? this.applyServerProfileSnapshot(reward.snapshot)
      : reward.profile;

    if (this.username === username && nextProfile) {
      this.profile = nextProfile;
    }

    if (reward?.snapshot?.progression || reward?.dailyLoginStatus) {
      this.dailyChallenges = {
        daily: reward?.snapshot?.progression?.dailyChallenges ?? this.dailyChallenges?.daily ?? null,
        weekly: reward?.snapshot?.progression?.weeklyChallenges ?? this.dailyChallenges?.weekly ?? null,
        dailyLogin:
          reward?.snapshot?.progression?.dailyLogin
          ?? reward?.dailyLoginStatus
          ?? this.dailyChallenges?.dailyLogin
          ?? null
      };
    }

    if (showToasts && reward.granted) {
      console.info("[DailyLogin][Renderer] toast requested", {
        username,
        rewardTokens: reward.rewardTokens,
        rewardXp: reward.rewardXp
      });
      this.toastManager.showDailyLoginReward?.({
        tokens: reward.rewardTokens ?? 0,
        xp: reward.rewardXp ?? 0,
        xpConversionTokenBonus: reward.xpConversionTokenBonus ?? 0,
        streakDay: reward.streakDay ?? reward.dailyLoginStatus?.streakDay ?? 1,
        rewardSummary: reward.rewardSummary ?? null,
        chestAwarded: reward.chestAwarded ?? null
      });

      for (const grant of reward.chestGrants ?? []) {
        const chestType = String(grant?.chestType ?? "basic").trim() || "basic";
        this.toastManager.showChestGrant?.({
          amount: grant?.amount ?? 0,
          chestLabel: this.getChestLabel(chestType),
          chestType
        });
      }

      const totalTokens =
        Math.max(0, Number(reward.rewardTokens ?? 0)) +
        Math.max(0, Number(reward.xpConversionTokenBonus ?? 0)) +
        Math.max(0, Number(reward.levelRewardTokenDelta ?? 0));

      if (totalTokens > 0) {
        this.toastManager.showTokenReward?.({
          amount: totalTokens,
          label: `${username} daily login reward`
        });
      }

      this.toastManager.showXpBreakdown?.({
        lines: reward.xpBreakdown?.lines ?? [],
        total: reward.xpBreakdown?.total ?? 0,
        label: `${username} XP`
      });

      this.toastManager.showLevelUp?.({
        fromLevel: reward.levelBefore ?? reward.profile.playerLevel ?? 1,
        toLevel: reward.levelAfter ?? reward.profile.playerLevel ?? 1,
        rewards: reward.levelRewards ?? [],
        playerName: username
      });
    } else {
      console.info("[DailyLogin][Renderer] toast not shown", {
        username,
        granted: Boolean(reward?.granted),
        showToasts
      });
    }

    return reward;
  }

  emitRewardToastsForResult(result, fallbackName, previousProfile = null) {
    if (!result) {
      return;
    }

    const playerName = this.getRewardPlayerName(result, fallbackName);
    const achievements = Array.isArray(result.unlockedAchievements)
      ? result.unlockedAchievements
      : [];

    for (const achievement of achievements) {
      if (!this.shouldPresentAchievementUnlock(achievement, playerName)) {
        continue;
      }

      this.toastManager.showAchievement(achievement, { playerName });
    }

    const challengeRewards = [
      ...(Array.isArray(result.dailyRewards) ? result.dailyRewards : []),
      ...(Array.isArray(result.weeklyRewards) ? result.weeklyRewards : [])
    ];

    const challengeTokensFromRewards = challengeRewards.reduce(
      (sum, reward) => sum + Math.max(0, Number(reward?.rewardTokens ?? 0)),
      0
    );
    const matchTokenDelta = Math.max(0, Number(result.matchTokenDelta ?? 0));
    const challengeTokenDelta = Math.max(
      0,
      Number(result.challengeTokenDelta ?? challengeTokensFromRewards)
    );
    const baseTokenDelta = Math.max(
      0,
      Number(result.tokenDelta ?? matchTokenDelta + challengeTokenDelta)
    );
    const levelRewardTokens = Math.max(0, Number(result.levelRewardTokenDelta ?? 0));
    const totalTokens = baseTokenDelta + levelRewardTokens;

    if (totalTokens > 0) {
      this.toastManager.showTokenReward?.({
        amount: totalTokens,
        label: `${playerName} reward payout`
      });
    }

    for (const chestType of ["basic", "milestone", "epic", "legendary"]) {
      const chestDelta = Math.max(
        0,
        this.getChestCount(result.profile, chestType) - this.getChestCount(previousProfile, chestType)
      );
      if (chestDelta > 0) {
        this.toastManager.showChestGrant?.({
          amount: chestDelta,
          chestLabel: this.getChestLabel(chestType),
          chestType
        });
      }
    }

    this.toastManager.showXpBreakdown?.({
      lines: result.xpBreakdown?.lines ?? [],
      total: result.xpDelta ?? 0,
      label: `${playerName} XP`
    });

    this.toastManager.showLevelUp?.({
      fromLevel: result.levelBefore ?? result.profile?.playerLevel ?? 1,
      toLevel: result.levelAfter ?? result.profile?.playerLevel ?? 1,
      rewards: result.levelRewards ?? [],
      playerName
    });
  }

  getLastRoundSummary() {
    const vm = this.gameController?.getViewModel();
    if (!vm?.lastRound) {
      const fallback = this.gameController?.roundResultText;
      return fallback && fallback !== "Match started." ? `Last Round: ${fallback}` : null;
    }

    const names = this.getLocalNames();
    const resultLabel =
      vm.lastRound.result === "p1"
        ? `${names.p1} won`
        : vm.lastRound.result === "p2"
          ? `${names.p2} won`
          : vm.lastRound.result === "none"
            ? "No effect"
            : "Draw";

    const captureSummary = this.buildResolvedCaptureSummary(vm.lastRound, {
      p1Label: names.p1,
      p2Label: names.p2,
      useSecondPersonForP1: false
    }).replace(new RegExp(`^${names.p1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "u"), "");
    const normalizedCaptureSummary = captureSummary
      ? `${captureSummary.charAt(0).toUpperCase()}${captureSummary.slice(1)}`
      : captureSummary;

    return `Last Round: ${resultLabel}. ${normalizedCaptureSummary}`;
  }

  getResolvedOpponentCardsCaptured(round) {
    const explicit = Number(round?.capturedOpponentCards);
    if (Number.isFinite(explicit) && explicit >= 0) {
      return explicit;
    }

    return Math.max(0, Math.floor(Number(round?.capturedCards ?? 0) / 2));
  }

  getResolvedWinnerCaptureCount(round) {
    const explicit = this.getResolvedOpponentCardsCaptured(round);
    const totalCaptured = Math.max(0, Math.floor(Number(round?.capturedCards ?? 0) / 2));

    // Some local-authoritative WAR rows store `capturedOpponentCards` from the player-side
    // perspective, so an opponent WAR win can arrive with `0` even though the winner took cards.
    if (round?.result === "p2" && totalCaptured > 0) {
      return totalCaptured;
    }

    return explicit > 0 ? explicit : totalCaptured;
  }

  buildResolvedCaptureSummary(
    round,
    { p1Label = "Player", p2Label = "Opponent", useSecondPersonForP1 = false } = {}
  ) {
    const capturedCount = this.getResolvedWinnerCaptureCount(round);
    if (round?.result === "p1") {
      const subject = useSecondPersonForP1 ? "You" : p1Label;
      return `${subject} captured ${capturedCount} opponent card(s).`;
    }

    if (round?.result === "p2") {
      if (capturedCount > 0) {
        return useSecondPersonForP1
          ? `${p2Label} captured ${capturedCount} of your card(s).`
          : `${p2Label} captured ${capturedCount} of ${p1Label}'s card(s).`;
      }

      return `${p2Label} won the WAR pot.`;
    }

    return "No cards were captured.";
  }

  getMatchPerspectiveCapturedTotal(match, perspective) {
    if (!Array.isArray(match?.history)) {
      return null;
    }

    return match.history
      .filter((round) => round?.result === perspective)
      .reduce((sum, round) => sum + this.getResolvedOpponentCardsCaptured(round), 0);
  }

  getMatchPerspectiveStats(match, perspective) {
    try {
      return deriveMatchStats(match, perspective);
    } catch {
      return null;
    }
  }

  getMatchCompleteCapturedTotals(mode, match, finalPersisted) {
    const isLocalPvp = mode === MATCH_MODE.LOCAL_PVP;
    const leftStats = isLocalPvp ? finalPersisted?.p1?.stats : finalPersisted?.stats;
    const rightStats = isLocalPvp ? finalPersisted?.p2?.stats : null;
    const leftDerivedStats = this.getMatchPerspectiveStats(match, "p1");
    const rightDerivedStats = this.getMatchPerspectiveStats(match, "p2");
    const liveCaptured = this.gameController?.captured ?? null;
    const safeNumber = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    };

    if (isLocalPvp) {
      return {
        left: safeNumber(leftStats?.cardsCaptured) ?? safeNumber(liveCaptured?.p1) ?? safeNumber(leftDerivedStats?.cardsCaptured) ?? 0,
        right: safeNumber(rightStats?.cardsCaptured) ?? safeNumber(liveCaptured?.p2) ?? safeNumber(rightDerivedStats?.cardsCaptured) ?? 0
      };
    }

    return {
      left: safeNumber(liveCaptured?.p1) ?? safeNumber(leftStats?.cardsCaptured) ?? safeNumber(leftDerivedStats?.cardsCaptured) ?? 0,
      right: safeNumber(liveCaptured?.p2) ?? safeNumber(rightDerivedStats?.cardsCaptured) ?? 0
    };
  }

  buildMatchCompleteRewardSummary(mode, match, finalPersisted) {
    if (mode === MATCH_MODE.LOCAL_PVP) {
      const p1Result = finalPersisted?.p1 ?? null;
      const p2Result = finalPersisted?.p2 ?? null;
      const names = this.getLocalNames();
      const p1Xp = Math.max(0, Number(p1Result?.xpDelta ?? 0));
      const p1Tokens = Math.max(0, Number(p1Result?.tokenDelta ?? 0));
      const p2Xp = Math.max(0, Number(p2Result?.xpDelta ?? 0));
      const p2Tokens = Math.max(0, Number(p2Result?.tokenDelta ?? 0));
      const capped =
        Boolean(p1Result?.localPvpRewardStatus?.capped) || Boolean(p2Result?.localPvpRewardStatus?.capped);

      return `
        <section class="match-complete-meta match-complete-rewards">
          <p><strong>${escapeHtml(names.p1)}:</strong> +${p1Xp} XP / +${p1Tokens} Tokens</p>
          <p><strong>${escapeHtml(names.p2)}:</strong> +${p2Xp} XP / +${p2Tokens} Tokens</p>
          <p><strong>Mode Policy:</strong> Local 2-Player rewards are casual and capped daily.</p>
          <p><strong>Chest Policy:</strong> No chests are awarded in this mode.</p>
          ${
            capped
              ? `<p><strong>Daily local reward cap reached.</strong> Match stats saved, but no XP/tokens awarded.</p>`
              : ""
          }
        </section>
      `;
    }

    if (mode !== MATCH_MODE.PVE) {
      return "";
    }

    const difficulty = String(match?.difficulty ?? "normal").trim().toLowerCase();
    const xpDelta = Math.max(0, Number(finalPersisted?.xpDelta ?? 0));
    const tokenDelta = Math.max(0, Number(finalPersisted?.tokenDelta ?? 0));
    const xpConversionTokenBonus = Math.max(0, Number(finalPersisted?.xpConversionTokenBonus ?? 0));
    const xpLines = Array.isArray(finalPersisted?.xpBreakdown?.lines) ? finalPersisted.xpBreakdown.lines : [];
    const boostDisplay = finalPersisted?.boostDisplay ?? null;
    const hasHardBonus = xpLines.some((line) => line?.label === "Hard AI Victory Bonus");
    const featuredRivalReward = finalPersisted?.featuredRivalReward ?? null;

    if (difficulty === "easy") {
      return `
        <section class="match-complete-meta match-complete-rewards">
          <p><strong>Difficulty:</strong> Easy / Practice Mode</p>
          <p>No rewards, stats, achievements, or challenge progress.</p>
        </section>
      `;
    }

    const difficultyLabel = difficulty === "hard" ? "Hard" : "Normal";
    const bonusLine =
      difficulty === "hard" && hasHardBonus
        ? `<p><strong>Hard AI Victory Bonus:</strong> +5 XP / +5 tokens</p>`
        : "";
    const featuredRivalBonusLine =
      featuredRivalReward?.granted
        ? `<p><strong>${escapeHtml(featuredRivalReward.label ?? "Featured Rival Bonus")}:</strong> +${Math.max(0, Number(featuredRivalReward.xpDelta ?? 0))} XP / +${Math.max(0, Number(featuredRivalReward.tokenDelta ?? 0))} tokens</p>`
        : "";
    const boostLine = this.buildMatchCompleteBoostSummaryLine(boostDisplay);
    const chestLine =
      difficulty === "hard"
        ? `<p><strong>Basic Chest Win Chance:</strong> 12%</p>`
        : `<p><strong>Basic Chest Win Chance:</strong> 10%</p>`;
    const maxLevelBonusLine =
      xpConversionTokenBonus > 0
        ? `<p><strong>Max Level Bonus:</strong> +${xpConversionTokenBonus} Tokens</p>`
        : "";

    return `
      <section class="match-complete-meta match-complete-rewards">
        <p><strong>Difficulty:</strong> ${escapeHtml(difficultyLabel)}</p>
        <p><strong>XP Gained:</strong> ${xpDelta}</p>
        <p><strong>Tokens Gained:</strong> ${tokenDelta}</p>
        ${maxLevelBonusLine}
        ${bonusLine}
        ${featuredRivalBonusLine}
        ${boostLine}
        ${chestLine}
      </section>
    `;
  }

  buildMatchCompleteBoostSummaryLine(boostDisplay) {
    if (!boostDisplay || (!boostDisplay.xpApplied && !boostDisplay.tokenApplied)) {
      return "";
    }

    const segments = [];
    if (boostDisplay.xpApplied) {
      segments.push(`${Number(boostDisplay.xpMultiplier ?? 1)}x XP`);
    }
    if (boostDisplay.tokenApplied) {
      segments.push(`${Number(boostDisplay.tokenMultiplier ?? 1)}x Tokens`);
    }

    if (!segments.length) {
      return "";
    }

    return `<p><strong>Boost Event:</strong> ${escapeHtml(segments.join(" / "))} applied</p>`;
  }

  playRoundRevealSounds(result, mode = MATCH_MODE.PVE, { warWasActive = false } = {}) {
    if (!result) {
      return false;
    }

    const revealedCards = result?.revealedCards ?? result?.round ?? {};
    const playedReveal = this.sound.playReveal({
      mode,
      cards:
        mode === MATCH_MODE.PVE
          ? [revealedCards?.p1Card].filter(Boolean)
          : [revealedCards?.p1Card, revealedCards?.p2Card].filter(Boolean)
    });

    const warStartedNow =
      !warWasActive &&
      ((result?.status === "war_continues" && Number(result?.war?.clashes ?? 0) >= 1) ||
        Number(result?.round?.warClashes ?? 0) > 0);

    if (warStartedNow) {
      this.sound.play("warStart");
    }

    return playedReveal;
  }

  resetOnlinePlaySoundState(roomCode = null) {
    this.onlinePlaySoundState = {
      roomCode: roomCode ? String(roomCode).trim() : null,
      revealKey: null,
      warStartKey: null,
      roundResolvedKey: null,
      matchCompleteKey: null
    };
  }

  getOnlineLocalRole(state = this.onlinePlayState) {
    const room = state?.room ?? null;
    if (!room) {
      return null;
    }

    const activeSocketId = String(state?.socketId ?? this.onlinePlayState?.socketId ?? "").trim();
    const activeUsername = String(state?.session?.username ?? this.username ?? "").trim();
    const hostSocketId = String(room?.host?.socketId ?? "").trim();
    const guestSocketId = String(room?.guest?.socketId ?? "").trim();
    const hostUsername = String(room?.host?.username ?? "").trim();
    const guestUsername = String(room?.guest?.username ?? "").trim();

    if (activeSocketId && activeSocketId === hostSocketId) {
      return "host";
    }
    if (activeSocketId && activeSocketId === guestSocketId) {
      return "guest";
    }
    if (activeUsername && activeUsername === hostUsername) {
      return "host";
    }
    if (activeUsername && activeUsername === guestUsername) {
      return "guest";
    }

    return null;
  }

  buildOnlineSoundPerspective(state = this.onlinePlayState) {
    const roomCode = String(state?.room?.roomCode ?? "").trim();
    const battleResult = this.extractCompletedOnlineBattleLogResult(state);
    const localRole = this.getOnlineLocalRole(state);
    if (!roomCode || !battleResult || !localRole) {
      return null;
    }

    const outcomeType = String(battleResult?.outcomeType ?? "").trim().toLowerCase();
    const roundNumber = Number(battleResult?.roundNumber ?? 0) || 0;
    const localMove = localRole === "host" ? battleResult?.hostMove ?? null : battleResult?.guestMove ?? null;
    const localResult = localRole === "host" ? battleResult?.hostResult ?? null : battleResult?.guestResult ?? null;

    return {
      roomCode,
      roundNumber,
      outcomeType,
      hostMove: battleResult?.hostMove ?? null,
      guestMove: battleResult?.guestMove ?? null,
      hostResult: battleResult?.hostResult ?? null,
      guestResult: battleResult?.guestResult ?? null,
      localRole,
      localMove,
      localResult,
      matchComplete: Boolean(state?.room?.matchComplete ?? battleResult?.matchComplete),
      winner: String(state?.room?.winner ?? "").trim().toLowerCase(),
      hostScore: Math.max(0, Number(state?.room?.hostScore ?? 0) || 0),
      guestScore: Math.max(0, Number(state?.room?.guestScore ?? 0) || 0),
      winReason: String(state?.room?.winReason ?? "").trim().toLowerCase()
    };
  }

  getOnlineOpponentProfileUsername(state = this.onlinePlayState) {
    const room = state?.room ?? null;
    if (!room?.matchComplete) {
      return null;
    }

    const localRole = this.getOnlineLocalRole(state);
    const ownUsername = String(state?.session?.username ?? this.username ?? "").trim();
    const decision = room?.rewardSettlement?.decision ?? null;
    const summary = room?.rewardSettlement?.summary ?? null;
    const hostUsername = String(
      decision?.participants?.hostUsername ?? summary?.settledHostUsername ?? room?.host?.username ?? ""
    ).trim();
    const guestUsername = String(
      decision?.participants?.guestUsername ?? summary?.settledGuestUsername ?? room?.guest?.username ?? ""
    ).trim();

    let opponentUsername = "";
    if (localRole === "host") {
      opponentUsername = guestUsername;
    } else if (localRole === "guest") {
      opponentUsername = hostUsername;
    }

    if (!opponentUsername && ownUsername) {
      if (hostUsername === ownUsername) {
        opponentUsername = guestUsername;
      } else if (guestUsername === ownUsername) {
        opponentUsername = hostUsername;
      }
    }

    if (!opponentUsername || (ownUsername && opponentUsername === ownUsername)) {
      return null;
    }

    return opponentUsername;
  }

  buildOnlineRoundSoundKey(perspective) {
    if (!perspective?.roomCode || !perspective?.roundNumber || !perspective?.outcomeType) {
      return null;
    }

    return [
      perspective.roomCode,
      perspective.roundNumber,
      perspective.outcomeType,
      perspective.hostMove ?? "",
      perspective.guestMove ?? "",
      perspective.hostResult ?? "",
      perspective.guestResult ?? "",
      perspective.hostScore,
      perspective.guestScore
    ].join("|");
  }

  buildOnlineWarStartSoundKey(perspective) {
    if (perspective?.outcomeType !== "war" || !perspective?.roomCode || !perspective?.roundNumber) {
      return null;
    }

    return [perspective.roomCode, perspective.roundNumber, "war_start"].join("|");
  }

  buildOnlineMatchCompleteSoundKey(perspective) {
    if (!perspective?.matchComplete || !perspective?.winner || !perspective?.roomCode || !perspective?.roundNumber) {
      return null;
    }

    return [
      perspective.roomCode,
      perspective.roundNumber,
      perspective.winner,
      perspective.hostScore,
      perspective.guestScore,
      perspective.winReason,
      "match_complete"
    ].join("|");
  }

  getOnlinePerspectiveMatchWinner(perspective) {
    if (!perspective?.winner || !perspective?.localRole) {
      return null;
    }

    if (perspective.winner === "host") {
      return perspective.localRole === "host" ? "p1" : "p2";
    }

    if (perspective.winner === "guest") {
      return perspective.localRole === "guest" ? "p1" : "p2";
    }

    return null;
  }

  handleOnlinePlaySoundTransitions(previousState, nextState) {
    const previousRoomCode = String(previousState?.room?.roomCode ?? "").trim();
    const nextRoomCode = String(nextState?.room?.roomCode ?? "").trim();

    if (!nextRoomCode) {
      if (previousRoomCode || this.onlinePlaySoundState.roomCode) {
        this.resetOnlinePlaySoundState();
      }
      return;
    }

    const previousRoundNumber = Number(previousState?.room?.roundNumber ?? 0) || 0;
    const nextRoundNumber = Number(nextState?.room?.roundNumber ?? 0) || 0;
    const previousMatchComplete = Boolean(previousState?.room?.matchComplete);
    const nextMatchComplete = Boolean(nextState?.room?.matchComplete);

    if (this.onlinePlaySoundState.roomCode !== nextRoomCode) {
      this.resetOnlinePlaySoundState(nextRoomCode);
    }

    if (
      (previousRoomCode && nextRoomCode && previousRoomCode !== nextRoomCode) ||
      (previousMatchComplete && !nextMatchComplete) ||
      (previousRoundNumber > 0 && nextRoundNumber > 0 && nextRoundNumber < previousRoundNumber)
    ) {
      this.resetOnlinePlaySoundState(nextRoomCode);
      if (previousRoomCode && previousRoomCode !== nextRoomCode) {
        return;
      }
    }

    if (!previousRoomCode || previousRoomCode !== nextRoomCode) {
      return;
    }

    const nextPerspective = this.buildOnlineSoundPerspective(nextState);
    if (!nextPerspective) {
      return;
    }

    const previousPerspective = this.buildOnlineSoundPerspective(previousState);
    const previousRoundKey = this.buildOnlineRoundSoundKey(previousPerspective);
    const nextRoundKey = this.buildOnlineRoundSoundKey(nextPerspective);

    if (nextRoundKey && nextRoundKey !== previousRoundKey && nextRoundKey !== this.onlinePlaySoundState.revealKey) {
      this.sound.playReveal({
        mode: MATCH_MODE.PVE,
        cards: [nextPerspective.localMove].filter(Boolean)
      });
      this.onlinePlaySoundState.revealKey = nextRoundKey;
    }

    const warStartKey = this.buildOnlineWarStartSoundKey(nextPerspective);
    if (
      warStartKey &&
      nextPerspective.outcomeType === "war" &&
      previousPerspective?.outcomeType !== "war" &&
      warStartKey !== this.onlinePlaySoundState.warStartKey
    ) {
      this.sound.play("warStart");
      this.onlinePlaySoundState.warStartKey = warStartKey;
    }

    if (
      nextRoundKey &&
      nextRoundKey !== previousRoundKey &&
      nextRoundKey !== this.onlinePlaySoundState.roundResolvedKey &&
      ["resolved", "war_resolved"].includes(nextPerspective.outcomeType) &&
      ["win", "lose"].includes(String(nextPerspective.localResult ?? "").trim().toLowerCase())
    ) {
      this.sound.playRoundResolved({
        mode: MATCH_MODE.PVE,
        round: {
          result: nextPerspective.localResult === "win" ? "p1" : "p2",
          warClashes: nextPerspective.outcomeType === "war_resolved" ? 1 : 0
        }
      });
      this.onlinePlaySoundState.roundResolvedKey = nextRoundKey;
    }

    const matchCompleteKey = this.buildOnlineMatchCompleteSoundKey(nextPerspective);
    const matchWinner = this.getOnlinePerspectiveMatchWinner(nextPerspective);
    if (
      matchCompleteKey &&
      matchWinner &&
      matchCompleteKey !== this.onlinePlaySoundState.matchCompleteKey
    ) {
      this.sound.playMatchComplete({
        mode: MATCH_MODE.PVE,
        match: {
          status: "completed",
          winner: matchWinner
        }
      });
      this.onlinePlaySoundState.matchCompleteKey = matchCompleteKey;
    }
  }

  buildResolutionPopupContent(result, mode = MATCH_MODE.PVE) {
    const names = this.getLocalNames();
    const isLocalPvp = mode === MATCH_MODE.LOCAL_PVP;
    const p1Label = isLocalPvp ? names.p1 : "Player";
    const p2Label = isLocalPvp ? names.p2 : "Opponent";

    if (result?.status === "war_continues") {
      const pileSize = Number(result?.war?.pileSize ?? this.gameController?.getViewModel?.()?.pileCount ?? 0);
      const clashCount = Number(result?.war?.clashes ?? this.gameController?.getViewModel?.()?.totalWarClashes ?? 0);
      return {
        message: "WAR continues",
        summary: `No cards were captured. WAR pile: ${pileSize} card(s). WAR clashes so far: ${clashCount}.`
      };
    }

    const round = result?.round;
    if (!round) {
      return {
        message: "Round resolved",
        summary: "Resolution complete."
      };
    }

    if (round.result === "none") {
      return {
        message: "No effect",
        summary: "No cards were captured. Both players keep their own card."
      };
    }

    if (round.result === "draw") {
      return {
        message: "WAR ended in a draw",
        summary: "Both sides ran out of cards at the same time. The committed WAR cards returned to their owners."
      };
    }

    const winnerLabel = round.result === "p1" ? p1Label : p2Label;
    const warPrefix = Number(round.warClashes ?? 0) > 0 ? "WAR resolved. " : "";
    return {
      message: `${winnerLabel} wins`,
      summary: `${warPrefix}${this.buildResolvedCaptureSummary(round, {
        p1Label,
        p2Label,
        useSecondPersonForP1: !isLocalPvp
      })}`
    };
  }

  shouldSuppressSharedResolutionPopup(result, mode = MATCH_MODE.PVE) {
    if (mode !== MATCH_MODE.PVE) {
      return false;
    }

    return result?.status === "round_resolved" || result?.status === "war_continues";
  }

  async showSharedResolutionPopup(result, mode = MATCH_MODE.PVE, { onShown = null } = {}) {
    if (this.shouldSuppressSharedResolutionPopup(result, mode)) {
      await onShown?.();
      return;
    }

    const content = this.buildResolutionPopupContent(result, mode);
    await this.showPassScreen({
      message: content.message,
      summary: content.summary,
      secondsLeft: 3,
      showContinueButton: true,
      allowEnter: true,
      afterRender: async () => {
        await onShown?.();
      },
      onContinue: async () => {},
      onTimeout: async () => {}
    });
  }

  prepareForFinalModal() {
    this.clearPassTimer({ settle: false });
    this.clearMatchTauntUiTimer();
    this.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };
    this.screenFlow = "idle";

    if (this.gameController?.getViewModel?.()) {
      this.showGame();
    }
  }

  buildGauntletRunSummary({
    finalStreak = 0,
    rivalsDefeated = 0,
    bestStreak = 0,
    rivalLabel = "",
    rivalName = ""
  } = {}) {
    return {
      finalStreak: Math.max(0, Number(finalStreak ?? 0)),
      rivalsDefeated: Math.max(0, Number(rivalsDefeated ?? 0)),
      bestStreak: Math.max(0, Number(bestStreak ?? 0)),
      rivalLabel: String(rivalLabel ?? "").trim(),
      rivalName: String(rivalName ?? "").trim()
    };
  }

  buildGauntletMilestoneRewardLines(milestoneRewards = []) {
    const rewards = Array.isArray(milestoneRewards) ? milestoneRewards : [];
    const lines = [];

    for (const reward of rewards) {
      const xp = Math.max(0, Number(reward?.xp ?? 0));
      const tokens = Math.max(0, Number(reward?.tokens ?? 0));
      const chests = Array.isArray(reward?.chests) ? reward.chests : [];

      if (xp > 0 && tokens > 0) {
        lines.push(`+${xp} XP, +${tokens} Tokens`);
      } else if (xp > 0) {
        lines.push(`+${xp} XP`);
      } else if (tokens > 0) {
        lines.push(`+${tokens} Tokens`);
      }

      for (const chest of chests) {
        const amount = Math.max(0, Number(chest?.amount ?? 0));
        const label = String(chest?.chestLabel ?? "Chest").trim() || "Chest";
        if (amount > 0) {
          lines.push(`+${amount} ${label}${amount === 1 ? "" : "s"}`);
        }
      }
    }

    return lines;
  }

  buildMatchCompleteModalPayload(mode, match, finalPersisted, options = {}) {
    const names = this.getLocalNames();
    const roundsPlayed = Array.isArray(match?.history) ? match.history.length : 0;
    const safeValue = (value) => (value ?? "-");
    const isLocalPvp = mode === MATCH_MODE.LOCAL_PVP;
    const isEasyPracticePve =
      !isLocalPvp &&
      mode === MATCH_MODE.PVE &&
      String(match?.difficulty ?? "").trim().toLowerCase() === "easy";
    const startOptions =
      !isLocalPvp && mode === MATCH_MODE.PVE && this.pveGauntletMode
        ? { gauntletMode: true }
        : !isLocalPvp && mode === MATCH_MODE.PVE && this.pveFeaturedRivalId
          ? { featuredRivalId: this.pveFeaturedRivalId }
          : {};

    const leftName = isLocalPvp ? names.p1 : (this.profile?.username ?? this.username ?? "Player");
    const rightName = isLocalPvp ? names.p2 : this.getCurrentPveOpponentName();

    const leftStats = isLocalPvp ? finalPersisted?.p1?.stats : finalPersisted?.stats;
    const rightStats = isLocalPvp ? finalPersisted?.p2?.stats : null;
    const leftDerivedStats = this.getMatchPerspectiveStats(match, "p1");
    const capturedTotals = this.getMatchCompleteCapturedTotals(mode, match, finalPersisted);
    const leftWarStats = isEasyPracticePve ? leftDerivedStats : leftStats;

    const leftCaptured = safeValue(capturedTotals.left);
    const rightCaptured = safeValue(capturedTotals.right);

    const warsEntered = isLocalPvp
      ? `${safeValue(leftStats?.warsEntered)} | ${safeValue(rightStats?.warsEntered)}`
      : safeValue(leftWarStats?.warsEntered);
    const longestWar = isLocalPvp
      ? `${safeValue(leftStats?.longestWar)} | ${safeValue(rightStats?.longestWar)}`
      : safeValue(leftWarStats?.longestWar);
    const leftFinalHand = safeValue(match?.players?.p1?.hand?.length);
    const rightFinalHand = safeValue(match?.players?.p2?.hand?.length);
    const rewardSummary = this.buildMatchCompleteRewardSummary(mode, match, finalPersisted);
    const gauntletSummary = options?.gauntletSummary ?? null;
    const isCrownfireFeaturedRival =
      mode === MATCH_MODE.PVE && String(this.pveFeaturedRivalId ?? "").trim().toLowerCase() === "crownfire_duelist";

    const outcomeLabel =
      match.winner === "draw"
        ? "Draw"
        : isCrownfireFeaturedRival
          ? match.winner === "p1"
            ? "Boss Defeated"
            : "Boss Survived"
          : !isLocalPvp && match.winner === "p2"
            ? "Defeat"
            : "Victory";

    const outcomeClass =
      outcomeLabel === "Victory"
        ? "is-victory"
        : outcomeLabel === "Defeat"
          ? "is-defeat"
          : "is-draw";

    const outcomeSubtitle =
      match.winner === "draw"
        ? `${escapeHtml(leftName)} and ${escapeHtml(rightName)} finished even.`
        : isCrownfireFeaturedRival
          ? match.winner === "p1"
            ? `You defeated ${escapeHtml(rightName)}.`
            : `${escapeHtml(rightName)} defeated you.`
          : `${escapeHtml(match.winner === "p1" ? leftName : rightName)} defeated ${escapeHtml(match.winner === "p1" ? rightName : leftName)}.`;
    const featuredRivalLossHelper =
      isCrownfireFeaturedRival && match.winner === "p2"
        ? `<p class="match-complete-helper">No Crownfire First Win Bonus earned.</p>`
        : "";
    const gauntletSummaryHtml = gauntletSummary
      ? `
        <section class="match-complete-gauntlet-summary">
          <p class="match-complete-helper">Gauntlet Run Ended</p>
          <div class="match-complete-stats">
            ${gauntletSummary.rivalName
              ? `
            <div class="match-complete-stat">
              <span class="match-complete-stat-label">${escapeHtml(gauntletSummary.rivalLabel || "Final Rival")}</span>
              <strong class="match-complete-stat-value">${escapeHtml(gauntletSummary.rivalName)}</strong>
            </div>`
              : ""}
            <div class="match-complete-stat">
              <span class="match-complete-stat-label">Final Streak</span>
              <strong class="match-complete-stat-value">${gauntletSummary.finalStreak}</strong>
            </div>
            <div class="match-complete-stat">
              <span class="match-complete-stat-label">Best Streak</span>
              <strong class="match-complete-stat-value">${gauntletSummary.bestStreak}</strong>
            </div>
            <div class="match-complete-stat">
              <span class="match-complete-stat-label">Rivals Defeated</span>
              <strong class="match-complete-stat-value">${gauntletSummary.rivalsDefeated}</strong>
            </div>
          </div>
        </section>
      `
      : "";

    const bodyHtml = `
      <section class="match-complete-modal ${outcomeClass}">
        <header class="match-complete-hero">
          <p class="match-complete-kicker">Match Complete</p>
          <h4 class="match-complete-outcome">${outcomeLabel}</h4>
          <p class="match-complete-subtitle">${outcomeSubtitle}</p>
          <p class="match-complete-captured">${escapeHtml(leftName)} • ${leftCaptured} | ${escapeHtml(rightName)} • ${rightCaptured}</p>
        </header>
        <p class="match-complete-helper">Captured totals reflect opponent cards won across the full match.</p>
        ${featuredRivalLossHelper}
        ${gauntletSummaryHtml}

        <section class="match-complete-stats">
          <div class="match-complete-stat">
            <span class="match-complete-stat-label">Captured Opponent Cards</span>
            <strong class="match-complete-stat-value">${leftCaptured} | ${rightCaptured}</strong>
          </div>
          <div class="match-complete-stat">
            <span class="match-complete-stat-label">WARs Entered</span>
            <strong class="match-complete-stat-value">${warsEntered}</strong>
          </div>
          <div class="match-complete-stat">
            <span class="match-complete-stat-label">Longest WAR</span>
            <strong class="match-complete-stat-value">${longestWar}</strong>
          </div>
          <div class="match-complete-stat">
            <span class="match-complete-stat-label">Rounds Played</span>
            <strong class="match-complete-stat-value">${roundsPlayed}</strong>
          </div>
          <div class="match-complete-stat">
            <span class="match-complete-stat-label">Final Hands</span>
            <strong class="match-complete-stat-value">${leftFinalHand} | ${rightFinalHand}</strong>
          </div>
        </section>

        <section class="match-complete-meta">
          <p><strong>Mode:</strong> ${escapeHtml(mode)}</p>
          <p><strong>End Reason:</strong> ${escapeHtml(match.endReason ?? "normal")}</p>
        </section>

        ${rewardSummary}

        <div class="match-complete-actions">
          <button id="match-complete-play-again" class="btn btn-primary">Play Again</button>
          <button id="match-complete-return-menu" class="btn">Return to Menu</button>
        </div>
      </section>
    `;

    return {
      title: gauntletSummary ? "Gauntlet Run Ended" : "Match Complete",
      bodyHtml,
      mode,
      startOptions
    };
  }

  showMatchCompleteModal(payload) {
    this.prepareForFinalModal();
    this.modalManager.show({
      title: payload.title,
      bodyHtml: payload.bodyHtml,
      actions: []
    });

    document.getElementById("match-complete-play-again")?.addEventListener("click", () => {
      this.modalManager.hide();
      this.startGame(payload.mode ?? MATCH_MODE.PVE, payload.startOptions ?? {});
    });

    document.getElementById("match-complete-return-menu")?.addEventListener("click", async () => {
      this.modalManager.hide();
      this.showMenu();
      await this.refreshDailyChallengesForMenu();
    });
  }

  showGauntletVictoryModal({
    streak = 0,
    nextRival = null,
    milestoneRewards = [],
    xpConversionTokenBonus = 0
  } = {}) {
    this.prepareForFinalModal();
    const milestoneLines = this.buildGauntletMilestoneRewardLines(milestoneRewards);
    if (Math.max(0, Number(xpConversionTokenBonus ?? 0)) > 0) {
      milestoneLines.push(`Max Level Bonus: +${Math.max(0, Number(xpConversionTokenBonus ?? 0))} Tokens`);
    }
    this.modalManager.show({
      title: "Gauntlet Victory!",
      bodyHtml: `
        <section class="match-complete-modal is-victory">
          <header class="match-complete-hero">
            <p class="match-complete-kicker">Gauntlet Victory!</p>
            <h4 class="match-complete-outcome">Streak: ${Math.max(0, Number(streak ?? 0))}</h4>
            <p class="match-complete-subtitle">Next Rival: ${escapeHtml(nextRival?.displayName ?? "Unknown Rival")}</p>
            <p class="match-complete-helper">${escapeHtml(nextRival?.title ?? "Arena Rival")}</p>
            ${
              nextRival?.hint
                ? `<p class="match-complete-helper">${escapeHtml(nextRival.hint)}</p>`
                : ""
            }
          </header>
          ${
            milestoneLines.length > 0
              ? `
          <section class="match-complete-gauntlet-summary">
            <p class="match-complete-helper">Milestone Reward!</p>
            <div class="match-complete-meta">
              ${milestoneLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
            </div>
          </section>
          `
              : ""
          }
          <div class="match-complete-actions">
            <button id="gauntlet-continue-btn" class="btn btn-primary">Continue Gauntlet</button>
            <button id="gauntlet-return-menu-btn" class="btn">Return to Menu</button>
          </div>
        </section>
      `,
      actions: []
    });

    document.getElementById("gauntlet-continue-btn")?.addEventListener("click", () => {
      this.modalManager.hide();
      this.flushPendingGauntletContinuation({ force: true });
    });

    document.getElementById("gauntlet-return-menu-btn")?.addEventListener("click", async () => {
      this.modalManager.hide();
      this.clearGauntletRunState();
      this.showMenu();
      await this.refreshDailyChallengesForMenu();
    });
  }

  flushPendingGauntletVictoryModal() {
    if (
      !this.pendingGauntletVictoryPayload ||
      this.roundPresentation?.busy ||
      this.screenFlow === "pass"
    ) {
      return false;
    }

    const payload = this.pendingGauntletVictoryPayload;
    this.pendingGauntletVictoryPayload = null;
    this.showGauntletVictoryModal(payload);
    return true;
  }

  flushPendingMatchCompleteModal() {
    if (!this.pendingMatchCompletePayload) {
      return;
    }

    const payload = this.pendingMatchCompletePayload;
    this.pendingMatchCompletePayload = null;
    this.showMatchCompleteModal(payload);
  }

  flushPendingGauntletContinuation({ force = false } = {}) {
    if (
      !this.pendingGauntletContinuation ||
      this.roundPresentation?.busy ||
      this.screenFlow === "pass" ||
      (this.pendingGauntletContinuationRequiresConfirm && !force)
    ) {
      return false;
    }

    const pendingContinuation = this.pendingGauntletContinuation;
    this.pendingGauntletContinuation = null;
    this.pendingGauntletContinuationRequiresConfirm = false;
    void this.startGame(pendingContinuation.mode, pendingContinuation.options);
    return true;
  }

  schedulePendingGauntletContinuationFlush() {
    setTimeout(() => {
      this.flushPendingGauntletContinuation();
    }, 0);
  }

  schedulePendingGauntletVictoryModalFlush() {
    setTimeout(() => {
      this.flushPendingGauntletVictoryModal();
    }, 0);
  }

  async init() {
    if (this.initPromise) {
      console.info("[Renderer] AppController.init() skipped", {
        alreadyInitialized: true
      });
      return this.initPromise;
    }

    console.info("[Renderer] AppController.init() entered");
    this.initPromise = (async () => {
      let restoreResult = null;
      try {
        if (!window.elemintz?.state) {
          throw new Error("Preload API unavailable: window.elemintz.state is undefined");
        }

        this.bindOnlinePlayUpdates();
        this.bindUpdateLifecycleUpdates();
        await this.refreshUpdateCoordinatorState();
        this.settings = await window.elemintz.state.getSettings();
        await this.syncOnlinePlayState();
        restoreResult = await window.elemintz?.multiplayer?.restoreSession?.();
        if (restoreResult?.state) {
          this.onlinePlayState = this.normalizeOnlinePlayState(restoreResult.state);
        }
      } catch (error) {
        console.error("AppController init failed while loading settings", error);
        this.settings = FALLBACK_SETTINGS;
        this.modalManager.show({
          title: "Startup Warning",
          body: "Settings failed to load. Using defaults for this session.",
          actions: [{ label: "Continue", onClick: () => this.modalManager.hide() }]
        });
      }

      this.applyMotionPreference();
      this.applySoundPreference();
      if (
        this.onlinePlayState?.session?.authenticated &&
        String(this.onlinePlayState?.session?.username ?? "").trim()
      ) {
        this.username = String(this.onlinePlayState.session.username).trim();
        await this.loadPreferredProfileForOnlineSession({
          username: this.username,
          onlineState: this.onlinePlayState,
          allowEnsureLocal: false
        });
        await this.ensureDailyLoginAutoClaim({
          showToasts: true,
          requestKey: `restore:${this.username}`
        });
        this.showMenu({
          autoClaimDailyLogin: false,
          showDailyLoginToasts: true,
          skipInitialDailyChallengesRefresh: true
        });
        return;
      }
      const restoreFailureMessage =
        restoreResult?.invalid
          ? this.formatPlayerFacingMessage(
              restoreResult?.error?.message,
              "Saved session expired. Please sign in again."
            )
          : "";
      this.showLogin({
        ...(restoreFailureMessage ? { statusMessage: restoreFailureMessage } : {})
      });
    })();

    return this.initPromise;
  }

  showLogin({ errorMessage = "", statusMessage = "", defaults = {}, mode = "choice" } = {}) {
    this.clearPassTimer();
    this.screenFlow = "login";
    this.screenManager.show("login", {
      backgroundImage: getArenaBackground("default_background"),
      errorMessage,
      statusMessage,
      version: this.getAppVersionDisplay(),
      defaults,
      mode,
      actions: {
        openSignIn: () => this.showLogin({ defaults, statusMessage, mode: "login" }),
        openCreateAccount: () => this.showLogin({ defaults, statusMessage, mode: "register" }),
        back: () => this.showLogin({ statusMessage, mode: "choice" }),
        showMode: ({ mode: nextMode = "choice", errorMessage: nextErrorMessage = "", defaults: nextDefaults = {} } = {}) =>
          this.showLogin({
            mode: nextMode,
            errorMessage: nextErrorMessage,
            statusMessage,
            defaults: nextDefaults
          }),
        login: async (request) => {
          let username = "";
          let email = "";
          let mode = "choice";
          let rememberSession = true;
          try {
            this.resetDailyLoginAutoClaimGuard();
            const loginRequest =
              typeof request === "string"
                ? { mode: "", username: request }
                : { ...(request ?? {}) };
            mode = String(loginRequest.mode ?? "").trim();
            username = String(loginRequest.username ?? "").trim();
            email = String(loginRequest.email ?? "").trim();
            const password = String(loginRequest.password ?? "");
            rememberSession = loginRequest.rememberSession !== false;

            if (mode === "login" || mode === "register") {
              const authAction =
                mode === "register"
                  ? window.elemintz?.multiplayer?.register
                  : window.elemintz?.multiplayer?.login;
              if (typeof authAction !== "function") {
                throw new Error("Online account authentication is unavailable.");
              }

              const authPayload =
                mode === "register"
                  ? { username, email, password, rememberSession }
                  : { email, password, rememberSession };
              const authResult = await authAction(authPayload);
              if (!authResult?.ok) {
                console.error("[OnlinePlay][Renderer] authentication failed", authResult?.error ?? null);
                throw new Error(
                  this.formatPlayerFacingMultiplayerError(
                    authResult?.error,
                    "Unable to authenticate this account."
                  )
                );
              }

              this.onlinePlayState = this.normalizeOnlinePlayState(
                await window.elemintz?.multiplayer?.getState?.()
              );
              this.username =
                authResult?.session?.username ??
                authResult?.account?.username ??
                username;
            } else {
              throw new Error("Authenticated account login is required.");
            }

            const profile = await this.loadPreferredProfileForOnlineSession({
              username: this.username,
              onlineState: this.onlinePlayState,
              allowEnsureLocal: false
            });
            if (!profile?.username) {
              throw new Error("Unable to load the authenticated profile snapshot.");
            }
            await this.ensureDailyLoginAutoClaim({
              showToasts: true,
              requestKey: `login:${this.username}`
            });
            this.showMenu({
              autoClaimDailyLogin: false,
              showDailyLoginToasts: true,
              skipInitialDailyChallengesRefresh: true
            });
          } catch (err) {
            console.error("LOGIN ERROR:", err);
            console.error("STACK:", err?.stack);
            this.showLogin({
              errorMessage: this.formatPlayerFacingMultiplayerError(
                err,
                "Unable to sign in right now. Please try again."
              ),
              defaults: {
                username,
                email,
                rememberSession
              },
              mode: mode === "register" ? "register" : "login"
            });
          }
        }
      }
    });
  }

  showMenu({
    autoClaimDailyLogin = true,
    showDailyLoginToasts = true,
    skipInitialDailyChallengesRefresh = false
  } = {}) {
    const previousScreenFlow = this.screenFlow;
    this.clearPassTimer();
    this.clearTransientUiBeforeScreenTransition();
    this.clearGauntletRunState();
    this.screenFlow = "menu";
    this.localPlayers = null;
    this.localProfiles = null;
    this.localPlayerAuthorities = null;
    this.preserveAuthenticatedOwnProfileIfSafer({
      username: this.username,
      onlineState: this.onlinePlayState,
      reason: "showMenu"
    });

    this.renderMenuScreen();
    this.updateOnlineReconnectReminderModal();
    if (!skipInitialDailyChallengesRefresh) {
      this.refreshDailyChallengesForMenu();
    }
    this.refreshDailyElementChestStatus();
    this.refreshMenuAnnouncement();
    this.refreshMenuBoostEvent();
    Promise.resolve().then(() => this.releaseQueuedAdminGrantNotice(this.onlinePlayState));
    Promise.resolve().then(async () => {
      await this.maybeShowLoadoutUnlockNotice();
      await this.maybeShowNewCosmeticsAnnouncement();
    });

    if (autoClaimDailyLogin) {
      Promise.resolve()
        .then(() =>
          this.ensureDailyLoginAutoClaim({
            showToasts: showDailyLoginToasts,
            requestKey: `menu:${this.username}`
          })
        )
        .then((reward) => {
          if (!reward?.granted) {
            return null;
          }

          if (this.screenFlow === "menu") {
            this.updateMenuChallengePreviewDisplay();
            this.updateMenuCountdownDisplay();
            this.renderMenuScreen();
          }
          return null;
        })
        .catch((error) => {
          console.error("[DailyLogin][Renderer] auto-claim failed", {
            username: this.username,
            message: error?.message,
            stack: error?.stack
          });
        });
    }
  }

  async refreshOnlinePlayerCount({ shouldRender = true } = {}) {
    if (this.onlinePlayerCountRefreshPromise) {
      return this.onlinePlayerCountRefreshPromise;
    }

    if (!window.elemintz?.multiplayer?.getOnlineCount) {
      this.onlinePlayerCount = null;
      this.onlinePlayerCountStatus = "idle";
      if (shouldRender && this.screenFlow === "onlinePlay") {
        this.renderOnlinePlayScreen();
      }
      return null;
    }

    this.onlinePlayerCountStatus = "loading";
    if (shouldRender && this.screenFlow === "onlinePlay") {
      this.renderOnlinePlayScreen();
    }

    this.onlinePlayerCountRefreshPromise = (async () => {
      try {
        const nextCount = await window.elemintz.multiplayer.getOnlineCount({
          username: this.profile?.username ?? this.username
        });
        this.onlinePlayerCount = Number.isFinite(nextCount) && nextCount >= 0 ? nextCount : null;
        this.onlinePlayerCountStatus = "ready";
      } catch (error) {
        this.onlinePlayerCount = null;
        this.onlinePlayerCountStatus = "error";
        console.warn("[OnlinePlay][Renderer] failed to refresh online player count", {
          username: this.profile?.username ?? this.username ?? null,
          message: error?.message ?? String(error)
        });
      } finally {
        this.onlinePlayerCountRefreshPromise = null;
      }

      if (shouldRender && this.screenFlow === "onlinePlay") {
        this.renderOnlinePlayScreen();
      }

      return this.onlinePlayerCount;
    })();

    return this.onlinePlayerCountRefreshPromise;
  }

  async refreshOnlinePublicRooms({ shouldRender = true } = {}) {
    if (this.onlinePublicRoomsRefreshPromise) {
      return this.onlinePublicRoomsRefreshPromise;
    }

    if (!window.elemintz?.multiplayer?.listPublicRooms) {
      this.onlinePublicRooms = [];
      this.onlinePublicRoomsStatus = "error";
      this.onlinePublicRoomsError = "Public room browsing is unavailable right now.";
      if (shouldRender && this.screenFlow === "onlinePlay") {
        this.renderOnlinePlayScreen();
      }
      return this.onlinePublicRooms;
    }

    this.onlinePublicRoomsStatus = "loading";
    this.onlinePublicRoomsError = "";
    if (shouldRender && this.screenFlow === "onlinePlay") {
      this.renderOnlinePlayScreen();
    }

    this.onlinePublicRoomsRefreshPromise = (async () => {
      try {
        const rooms = await window.elemintz.multiplayer.listPublicRooms({
          username: this.profile?.username ?? this.username
        });

        if (Array.isArray(rooms)) {
          this.onlinePublicRooms = rooms.map((room) => ({ ...room }));
          this.onlinePublicRoomsStatus = "ready";
          this.onlinePublicRoomsError = "";
        } else {
          const latestMultiplayerState =
            (await window.elemintz.multiplayer.getState?.()) ?? this.onlinePlayState;
          this.onlinePlayState = this.normalizeOnlinePlayState(latestMultiplayerState);
          this.onlinePublicRooms = [];
          this.onlinePublicRoomsStatus = "error";
          this.onlinePublicRoomsError = this.formatPlayerFacingMultiplayerError(
            this.onlinePlayState?.lastError,
            this.onlinePlayState?.statusMessage ?? "Unable to load public rooms."
          );
        }
      } catch (error) {
        this.onlinePublicRooms = [];
        this.onlinePublicRoomsStatus = "error";
        this.onlinePublicRoomsError = this.formatPlayerFacingMultiplayerError(
          error,
          "Unable to load public rooms."
        );
      } finally {
        this.onlinePublicRoomsRefreshPromise = null;
      }

      if (shouldRender && this.screenFlow === "onlinePlay") {
        this.renderOnlinePlayScreen();
      }

      return this.onlinePublicRooms;
    })();

    return this.onlinePublicRoomsRefreshPromise;
  }

  async refreshOnlinePlayLobbyData({ shouldRender = true } = {}) {
    const [countResult] = await Promise.allSettled([
      this.refreshOnlinePlayerCount({ shouldRender }),
      this.refreshOnlinePublicRooms({ shouldRender })
    ]);

    if (
      countResult?.status === "rejected" &&
      this.screenFlow === "onlinePlay" &&
      shouldRender
    ) {
      this.renderOnlinePlayScreen();
    }

    return {
      onlinePlayerCount: this.onlinePlayerCount,
      onlinePublicRooms: Array.isArray(this.onlinePublicRooms) ? [...this.onlinePublicRooms] : []
    };
  }

  async showOnlinePlay() {
    this.clearPassTimer();
    this.clearTransientUiBeforeScreenTransition();
    this.screenFlow = "onlinePlay";
    this.matchTauntPanelOpen = false;
    await this.syncOnlinePlayState();
    await this.loadPreferredProfileForOnlineSession({
      username: this.username,
      onlineState: this.onlinePlayState,
      allowEnsureLocal: false
    });
      await this.refreshOnlinePlayChallengeSummary(this.onlinePlayState);
      this.ensureOnlineReconnectUiTimer();
      this.renderOnlinePlayScreen();
      this.maybeShowPendingAdminGrantNotice(this.onlinePlayState);
      void this.refreshOnlinePlayLobbyData();

      if (!window.elemintz?.multiplayer?.connect) {
        return;
      }

    this.onlinePlayState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.connect());
    await this.loadPreferredProfileForOnlineSession({
      username: this.username,
      onlineState: this.onlinePlayState,
      allowEnsureLocal: false
    });
      await this.refreshOnlinePlayChallengeSummary(this.onlinePlayState);
      this.ensureOnlineReconnectUiTimer();
      this.renderOnlinePlayScreen();
      this.maybeShowPendingAdminGrantNotice(this.onlinePlayState);
      void this.refreshOnlinePlayLobbyData();
    }

  showLocalSetup({ errorMessage = "", setupDefaults = null } = {}) {
    this.clearTransientUiBeforeScreenTransition();
    this.screenFlow = "localSetup";
    const playerOneDefaults = setupDefaults?.p1 ?? null;
    const playerTwoDefaults = setupDefaults?.p2 ?? null;
    this.screenManager.show("localSetup", {
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      errorMessage,
      player1: {
        authenticated: Boolean(this.onlinePlayState?.session?.authenticated && String(this.username ?? "").trim()),
        username: this.username,
        defaults: {
          username: playerOneDefaults?.username ?? this.username ?? "",
          email: playerOneDefaults?.email ?? ""
        },
        mode: playerOneDefaults?.mode ?? "login"
      },
      player2: {
        defaults: {
          username: playerTwoDefaults?.username ?? "",
          email: playerTwoDefaults?.email ?? ""
        },
        mode: playerTwoDefaults?.mode ?? "login"
      },
      actions: {
        start: async (setup) => {
          try {
            const resolvedPlayers = await this.resolveLocalHotseatPlayers(setup);
            this.localPlayers = {
              p1: resolvedPlayers.p1.username,
              p2: resolvedPlayers.p2.username
            };
            this.localProfiles = {
              p1: resolvedPlayers.p1,
              p2: resolvedPlayers.p2
            };
            this.localPlayerAuthorities = resolvedPlayers.authorities ?? null;

            this.startGame(MATCH_MODE.LOCAL_PVP);
          } catch (error) {
            this.showLocalSetup({
              errorMessage: this.formatPlayerFacingMessage(
                error?.message,
                "Both players must be signed in before Local 2-Player can start."
              ),
              setupDefaults: setup
            });
          }
        },
        back: () => this.showMenu()
      }
    });
  }

  handleGameUpdate() {
    if (!this.gameController || this.screenFlow === "pass") {
      return;
    }

    if (this.flushPendingGauntletVictoryModal()) {
      return;
    }

    if (this.flushPendingGauntletContinuation()) {
      return;
    }

    if (this.refreshActiveGameHudInPlace()) {
      return;
    }

    this.showGame();
  }

  enterHotseatTurn() {
    if (!this.gameController) {
      return;
    }

    this.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };

    this.gameController.resetTimer();
    this.gameController?.resumeLocalTurnTimer?.();
    this.showGame();
  }

  async persistLocalPvpResult(match) {
    const names = this.getLocalNames();
    const authorities = this.localPlayerAuthorities ?? {};

    const persistFor = async (username, perspective, authority) => {
      try {
        return await this.settleLocalMatchResultForIdentity({
          mode: MATCH_MODE.LOCAL_PVP,
          username,
          perspective,
          match,
          authority
        });
      } catch (error) {
        console.error("Failed to persist local PvP profile", { username, perspective, error });
        return null;
      }
    };

    // Commit local PvP results sequentially to avoid stale read-modify-write overlap.
    const p1Result = await persistFor(names.p1, "p1", authorities.p1 ?? null);
    const p2Result = await persistFor(names.p2, "p2", authorities.p2 ?? null);

    return {
      mode: MATCH_MODE.LOCAL_PVP,
      p1Name: names.p1,
      p2Name: names.p2,
      p1: p1Result,
      p2: p2Result
    };
  }

  async persistPveResult(match) {
    const protectedServerSessionRequired =
      this.isProtectedServerSessionPveMode({
        mode: MATCH_MODE.PVE,
        gauntletMode: this.pveGauntletMode
      }) &&
      this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, this.username);
    const localMatchSession = protectedServerSessionRequired
      ? await this.resolveProtectedPveLocalMatchSession()
      : null;
    return this.settleLocalMatchResultForIdentity({
      mode: MATCH_MODE.PVE,
      username: this.username,
      perspective: "p1",
      match,
      authority: {
        username: this.username,
        accountId: this.onlinePlayState?.session?.accountId ?? null,
        sessionToken: null,
        localMatchSessionId: localMatchSession?.sessionId ?? null,
        protectedServerSessionRequired
      }
    });
  }

  startGame(mode = MATCH_MODE.PVE, options = {}) {
    if (!this.requireOwnProfileHydratedForAction("start_game")) {
      return;
    }

    this.clearPassTimer();
    this.gameController?.stopTimer();
    this.gameController?.stopMatchClock();
    this.pendingMatchCompletePayload = null;
    this.pendingGauntletVictoryPayload = null;
    this.pendingGauntletContinuation = null;
    this.pendingGauntletContinuationRequiresConfirm = false;
    const wantsGauntlet = mode === MATCH_MODE.PVE && options?.gauntletMode === true;
    if (wantsGauntlet) {
      if (options?.gauntletContinue === true) {
        this.continueGauntletRunWithRival(options?.gauntletRivalId);
      } else {
        this.startFreshGauntletRun();
      }
    } else {
      this.clearGauntletRunState();
    }

    this.pveFeaturedRivalId =
      mode === MATCH_MODE.PVE && !wantsGauntlet
        ? String(options?.featuredRivalId ?? "").trim().toLowerCase() || null
        : null;
    const featuredRival = this.getFeaturedRivalConfig(this.pveFeaturedRivalId);
    this.pveOpponentStyle =
      mode === MATCH_MODE.PVE ? this.buildPveOpponentStyle(this.pveFeaturedRivalId) : null;
    const resolvedAiDifficulty =
      mode === MATCH_MODE.PVE
        ? featuredRival?.aiDifficulty ??
          (String(options?.aiDifficulty ?? "").trim().toLowerCase() ||
            this.getConfiguredAiDifficulty())
        : FALLBACK_SETTINGS.aiDifficulty;
    this.clearProtectedLocalMatchSessionState();
    this.clearGauntletLocalMatchSessionState();
    const protectedLocalMatchSessionRequestId = this.protectedLocalMatchSessionRequestId;
    const gauntletLocalMatchSessionRequestId = this.gauntletLocalMatchSessionRequestId;
    this.resetMatchTaunts();

    this.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };
    this.screenFlow = "idle";

    this.gameController = new GameController({
      username: mode === MATCH_MODE.LOCAL_PVP ? this.getLocalNames().p1 : this.username,
      localPlayerNames: mode === MATCH_MODE.LOCAL_PVP ? this.getLocalNames() : null,
      timerSeconds: this.settings?.gameplay?.timerSeconds ?? FALLBACK_SETTINGS.gameplay.timerSeconds,
      matchTimeLimitSeconds: 300,
      aiDifficulty: resolvedAiDifficulty,
      gauntletMode: wantsGauntlet,
      gauntletRivalId: wantsGauntlet ? this.gauntletRunState?.currentRivalId ?? null : null,
      featuredRivalId: this.pveFeaturedRivalId,
      mode,
      persistMatchResults: mode !== MATCH_MODE.LOCAL_PVP,
      persistMatchResult:
        mode === MATCH_MODE.PVE ? async (match) => this.persistPveResult(match) : null,
      onRoundResolved: (round) => {
        if (mode === MATCH_MODE.PVE && this.deferPveOutcomeSound) {
          this.deferredPveRoundSound = round;
          return;
        }

        this.sound.playRoundResolved({ mode, round });
      },
      onUpdate: () => this.handleGameUpdate(),
      onHotseatTurnTimeout: async (turn) => {
        const vm = this.gameController?.getViewModel();
        if (!vm || vm.mode !== MATCH_MODE.LOCAL_PVP || this.screenFlow === "pass") {
          return;
        }

        await this.autoPickForTurn(turn);
      },
      onMatchComplete: async ({ match, persisted }) => {
        this.clearPassTimer();
        const gauntletCompletionContext =
          mode === MATCH_MODE.PVE ? this.captureGauntletCompletionContext() : null;
        const previousPveProfile =
          mode === MATCH_MODE.PVE && this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, this.username)
            ? (this.isOwnProfileHydrated(this.username, this.onlinePlayState) && this.profile
                ? { ...this.profile }
                : null)
            : (this.profile ? { ...this.profile } : null);
        const previousLocalProfiles = this.localProfiles
          ? {
              p1: this.localProfiles.p1 ? { ...this.localProfiles.p1 } : null,
              p2: this.localProfiles.p2 ? { ...this.localProfiles.p2 } : null
            }
          : null;

        let finalPersisted = persisted;
        if (mode === MATCH_MODE.LOCAL_PVP) {
          finalPersisted = await this.persistLocalPvpResult(match);
        } else if (persisted?.snapshot) {
          this.profile =
            this.buildProfileFromServerSnapshot(persisted.snapshot) ?? persisted.profile ?? this.profile;
        } else if (persisted?.profile) {
          this.profile = persisted.profile;
        }

        if (mode === MATCH_MODE.PVE && finalPersisted?.dailyChallenges && finalPersisted?.weeklyChallenges) {
          this.dailyChallenges = {
            daily: finalPersisted.dailyChallenges,
            weekly: finalPersisted.weeklyChallenges
          };
        }

        await this.applyPostMatchCosmeticRandomization(mode, finalPersisted);
        if (mode === MATCH_MODE.PVE) {
          this.maybeEmitPveAiTaunt("match_end");
        }

        this.sound.playMatchComplete({ mode, match });

        const names = this.getLocalNames();
        if (mode === MATCH_MODE.LOCAL_PVP) {
          this.emitRewardToastsForResult(finalPersisted?.p1, names.p1, previousLocalProfiles?.p1);
          this.emitRewardToastsForResult(finalPersisted?.p2, names.p2, previousLocalProfiles?.p2);
        } else {
          this.emitRewardToastsForResult(finalPersisted, this.username, previousPveProfile);
        }
        if (mode === MATCH_MODE.PVE && gauntletCompletionContext?.isGauntletMatch) {
          const isQuitForfeit = String(match?.endReason ?? "").trim().toLowerCase() === "quit_forfeit";
          if (match?.winner === "p1") {
            const nextStreak =
              Math.max(0, Number(gauntletCompletionContext?.runState?.currentStreak ?? 0)) + 1;
            const gauntletStatsResult = await this.recordGauntletProfileStats({
              matchWon: true,
              currentStreak: nextStreak,
              claimedMilestoneStreaks: gauntletCompletionContext?.runState?.claimedMilestoneStreaks ?? [],
              matchState: match,
              battleReportAlreadyRecorded: true,
              latestBattleContext: {
                rivalName:
                  gauntletCompletionContext?.rivalName ??
                  this.getCurrentGauntletRival()?.displayName ??
                  null
              }
            });
            if (gauntletStatsResult?.profile) {
              finalPersisted = {
                ...(finalPersisted ?? {}),
                profile: gauntletStatsResult.profile
              };
            }
            if (Array.isArray(gauntletStatsResult?.claimedMilestoneStreaks)) {
              this.gauntletRunState = {
                ...this.gauntletRunState,
                claimedMilestoneStreaks: [...gauntletStatsResult.claimedMilestoneStreaks]
              };
            }
            const gauntletLevelBefore = Math.max(
              1,
              Number(gauntletStatsResult?.levelBefore ?? 1) || 1
            );
            const gauntletLevelAfter = Math.max(
              1,
              Number(gauntletStatsResult?.levelAfter ?? gauntletLevelBefore) || gauntletLevelBefore
            );
            if (gauntletLevelAfter > gauntletLevelBefore) {
              this.toastManager.showLevelUp?.({
                fromLevel: gauntletLevelBefore,
                toLevel: gauntletLevelAfter,
                rewards: Array.isArray(gauntletStatsResult?.levelRewards)
                  ? gauntletStatsResult.levelRewards
                  : [],
                playerName: this.username
              });
            }
            if (gauntletStatsResult) {
              finalPersisted = {
                ...(finalPersisted ?? {}),
                gauntletMilestoneRewards: Array.isArray(gauntletStatsResult.milestoneRewards)
                  ? gauntletStatsResult.milestoneRewards
                  : [],
                gauntletXpConversionTokenBonus: Math.max(
                  0,
                  Number(gauntletStatsResult.xpConversionTokenBonus ?? 0)
                )
              };
            }
          } else if (!isQuitForfeit) {
            const gauntletStatsResult = await this.recordGauntletProfileStats({
              runEndedWithLoss: true,
              matchState: match,
              battleReportAlreadyRecorded: true,
              latestBattleContext: {
                rivalName:
                  gauntletCompletionContext?.rivalName ??
                  this.getCurrentGauntletRival()?.displayName ??
                  null
              }
            });
            if (gauntletStatsResult?.profile) {
              finalPersisted = {
                ...(finalPersisted ?? {}),
                profile: gauntletStatsResult.profile
              };
            }
          }
        }
        const gauntletCompletion =
          mode === MATCH_MODE.PVE
            ? this.handleGauntletMatchCompletion(match, gauntletCompletionContext)
            : { handled: false };
        if (mode === MATCH_MODE.PVE && gauntletCompletion?.type === "victory") {
          const gauntletVictoryPayload = {
            streak: gauntletCompletion.streak,
            nextRival: gauntletCompletion.nextRival,
            milestoneRewards: finalPersisted?.gauntletMilestoneRewards ?? [],
            xpConversionTokenBonus: Math.max(
              0,
              Number(finalPersisted?.gauntletXpConversionTokenBonus ?? 0)
            )
          };
          if (this.roundPresentation.busy || this.screenFlow === "pass") {
            this.pendingGauntletVictoryPayload = gauntletVictoryPayload;
            this.schedulePendingGauntletVictoryModalFlush();
            return;
          }

          this.showGauntletVictoryModal(gauntletVictoryPayload);
          return;
        }
        const gauntletSummary =
          mode === MATCH_MODE.PVE && gauntletCompletion?.showSummary
            ? this.buildGauntletRunSummary({
                finalStreak: gauntletCompletion.finalStreak,
                rivalsDefeated: gauntletCompletion.rivalsDefeated,
                bestStreak:
                  finalPersisted?.profile?.gauntletBestStreak ??
                  this.profile?.gauntletBestStreak ??
                  0,
                rivalLabel: gauntletCompletion.rivalLabel,
                rivalName: gauntletCompletion.rivalName
              })
            : null;
        const modalPayload = this.buildMatchCompleteModalPayload(mode, match, finalPersisted, {
          gauntletSummary
        });
        if (this.roundPresentation.busy || this.screenFlow === "pass") {
          this.pendingMatchCompletePayload = modalPayload;
          return;
        }

        this.showMatchCompleteModal(modalPayload);
      }
    });

    if (
      this.isProtectedServerSessionPveMode({
        mode,
        gauntletMode: wantsGauntlet
      }) &&
      this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, this.username)
    ) {
      this.pendingProtectedLocalMatchSessionPromise = this.startProtectedPveLocalMatchSession({
        aiDifficulty: resolvedAiDifficulty,
        featuredRivalId: this.pveFeaturedRivalId,
        requestId: protectedLocalMatchSessionRequestId
      }).catch((error) => {
        console.error("[MatchSettlement][Renderer] failed to start protected PvE session", {
          mode,
          username: this.username,
          featuredRivalId: this.pveFeaturedRivalId,
          aiDifficulty: resolvedAiDifficulty,
          message: error?.message,
          stack: error?.stack
        });
        this.clearProtectedLocalMatchSessionState();
        return null;
      });
    }

    if (
      wantsGauntlet &&
      this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, this.username)
    ) {
      this.pendingGauntletLocalMatchSessionPromise = this.startGauntletLocalMatchSession({
        aiDifficulty: resolvedAiDifficulty,
        gauntletRivalId: this.gauntletRunState?.currentRivalId ?? null,
        previousSessionId:
          options?.gauntletContinue === true
            ? this.gauntletRunState?.previousSessionId ?? null
            : null,
        requestId: gauntletLocalMatchSessionRequestId
      }).catch((error) => {
        console.error("[Gauntlet][Renderer] failed to start protected gauntlet session", {
          username: this.username,
          gauntletRivalId: this.gauntletRunState?.currentRivalId ?? null,
          message: error?.message,
          stack: error?.stack
        });
        this.clearGauntletLocalMatchSessionState();
        return null;
      });
    }

    if (mode === MATCH_MODE.LOCAL_PVP) {
      this.screenFlow = "pass";
    }

    this.gameController.startNewMatch();
    if (wantsGauntlet && options?.gauntletContinue !== true && this.gauntletRunState?.active) {
      void this.recordGauntletProfileStats({ runStarted: true });
    }

    if (mode === MATCH_MODE.LOCAL_PVP) {
      this.showInitialHotseatPass();
      return;
    }

    this.showGame();
    if (mode === MATCH_MODE.PVE) {
      this.maybeEmitPveAiTaunt("match_start");
    }
  }

  buildActiveGameRefreshContext(vm = this.gameController?.getViewModel?.()) {
    if (!vm) {
      return null;
    }

    const names = this.getLocalNames();
    const p2Name = vm.mode === MATCH_MODE.LOCAL_PVP ? names.p2 : this.getCurrentPveOpponentName();
    const gauntletRival = vm.mode === MATCH_MODE.PVE && this.pveGauntletMode ? this.getCurrentGauntletRival() : null;
    return {
      game: vm,
      hotseat: {
        enabled: vm.mode === MATCH_MODE.LOCAL_PVP,
        activePlayer: vm.mode === MATCH_MODE.LOCAL_PVP ? vm.hotseatTurn : "p1",
        p1Name: names.p1,
        p2Name,
        turnLabel:
          vm.mode === MATCH_MODE.LOCAL_PVP
            ? `${vm.hotseatTurn === "p1" ? names.p1 : names.p2} Turn`
            : "Player Turn"
      },
      gauntlet:
        gauntletRival
          ? {
              active: true,
              currentStreak: Math.max(0, Number(this.gauntletRunState?.currentStreak ?? 0)),
              rivalName: gauntletRival.displayName,
              rivalTitle: gauntletRival.title,
              rivalHint: gauntletRival.hint
            }
          : null,
      presentation: this.roundPresentation
    };
  }

  refreshActiveGameHudInPlace() {
    const doc = globalThis.document;
    if (this.screenFlow !== "game" || typeof doc?.querySelector !== "function") {
      return false;
    }

    const context = this.buildActiveGameRefreshContext();
    if (!context) {
      return false;
    }

    const root = doc.querySelector(".screen-game");
    const hudLine = doc.getElementById?.("game-hud-primary-line") ?? null;
    if (!root || !hudLine) {
      return false;
    }

    const currentSignature = root.getAttribute?.("data-game-live-update-signature") ?? "";
    const nextSignature = buildGameLiveUpdateSignature(context);
    if (currentSignature !== nextSignature) {
      return false;
    }

    hudLine.textContent = buildGameHudPrimaryLine(context);
    return true;
  }

  async showPassScreen({
    message,
    includeSummary,
    summary = null,
    secondsLeft = this.getConfiguredTurnSeconds(),
    showContinueButton = true,
    allowEnter = true,
    afterRender = null,
    onContinue = async () => {},
    onTimeout = async () => {}
  }) {
    this.clearPassTimer();
    this.screenFlow = "pass";
    this.gameController?.pauseLocalTurnTimer?.();

    const state = {
      secondsLeft,
      message,
      summary: summary ?? (includeSummary ? this.getLastRoundSummary() : null),
      showContinueButton
    };

    return await new Promise((resolve) => {
      this.passCompletionResolve = resolve;

      let continuing = false;
      const finishPass = async ({ reason, action }) => {
        if (continuing) {
          return;
        }

        continuing = true;
        this.clearPassTimer({ settle: false });

        try {
          await action();
        } finally {
          if (this.passCompletionResolve) {
            const settlePass = this.passCompletionResolve;
            this.passCompletionResolve = null;
            settlePass({ reason });
          }
        }
      };

      const continueFromPass = async () => {
        await finishPass({ reason: "continue", action: onContinue });
      };

      const render = () => {
        this.screenManager.show("pass", {
          message: state.message,
          summary: state.summary,
          secondsLeft: state.secondsLeft,
          showContinueButton: state.showContinueButton,
          actions: {
            continue: continueFromPass
          }
        });
      };

      render();
      Promise.resolve(afterRender?.()).catch((error) => {
        console.error("Pass screen afterRender failed", error);
      });

      if (globalThis.document?.addEventListener) {
        this.passKeyHandler = async (event) => {
          if (!allowEnter || event?.key !== "Enter" || this.screenFlow !== "pass") {
            return;
          }

          event.preventDefault?.();
          await continueFromPass();
        };

        globalThis.document.addEventListener("keydown", this.passKeyHandler);
      }

      this.passTimerId = setInterval(async () => {
        state.secondsLeft -= 1;
        if (state.secondsLeft <= 0) {
          await finishPass({ reason: "timeout", action: onTimeout });
          return;
        }

        if (!this.updatePassCountdown(state.secondsLeft)) {
          render();
        }
      }, 1000);
    });
  }

  async autoPickForTurn(turn) {
    if (!this.gameController) {
      return;
    }

    this.gameController?.pauseLocalTurnTimer?.();

    const randomIndex = this.gameController.pickRandomCardIndex(turn);
    if (randomIndex === null) {
      this.showGame();
      return;
    }

    const result = await this.gameController.submitHotseatSelection(randomIndex);

    if (result.status === "pass_to_p2") {
      this.showPassToPlayer2();
      return;
    }

    if (result.status === "pass_to_p1") {
      await this.presentHotseatResolution();
      return;
    }

    this.showGame();
  }

  async showInitialHotseatPass() {
    await this.showPlayer1TurnPass(false);
  }

  async showPassToPlayer2() {
    await this.showPassScreen({
      message: "Player 2, Click When Ready",
      includeSummary: true,
      onContinue: async () => this.enterHotseatTurn(),
      onTimeout: async () => this.autoPickForTurn("p2")
    });
  }

  async showPlayer1TurnPass(includeSummary = true) {
    await this.showPassScreen({
      message: "Player 1, Click When Ready",
      includeSummary,
      secondsLeft: this.getConfiguredTurnSeconds(),
      onContinue: async () => this.enterHotseatTurn(),
      onTimeout: async () => this.autoPickForTurn("p1")
    });
  }

  async presentHotseatResolution() {
    if (!this.gameController || this.roundPresentation.busy) {
      return;
    }

    this.gameController?.pauseLocalTurnTimer?.();
    const warWasActive = Boolean(this.gameController?.getViewModel?.()?.warActive);

    const reducedMotion = this.isReducedMotion();

    this.roundPresentation = {
      phase: "reveal",
      busy: true,
      selectedCardIndex: null
    };
    this.showGame();

    if (!reducedMotion) {
      await delay(300);
    }

    const result = await this.gameController.confirmHotseatRound();
    if (result.status !== "war_continues" && result.status !== "round_resolved") {
      this.roundPresentation = {
        phase: "idle",
        busy: false,
        selectedCardIndex: null
      };
      this.showGame();
      return;
    }

    this.playRoundRevealSounds(result, MATCH_MODE.LOCAL_PVP, { warWasActive });

    try {
      this.roundPresentation = {
        phase: "idle",
        busy: true,
        selectedCardIndex: null
      };
      await this.showSharedResolutionPopup(result, MATCH_MODE.LOCAL_PVP);
    } finally {
      this.roundPresentation = {
        phase: "idle",
        busy: false,
        selectedCardIndex: null
      };
      this.screenFlow = "idle";
    }

    if (this.gameController.getViewModel()?.status === "active") {
      this.gameController?.rearmActiveRoundPresentation?.();
      await this.showPlayer1TurnPass(true);
      return;
    }

    this.flushPendingMatchCompleteModal();
  }

  async presentPveRound(cardIndex) {
    if (!this.gameController || this.roundPresentation.busy) {
      return;
    }

    const reducedMotion = this.isReducedMotion();
    const warWasActive = Boolean(this.gameController?.getViewModel?.()?.warActive);

    this.roundPresentation = {
      phase: "play",
      busy: true,
      selectedCardIndex: cardIndex
    };
    this.gameController.stopTimer();
    this.showGame();

    if (!reducedMotion) {
      await delay(180);
    }

    this.roundPresentation = {
      ...this.roundPresentation,
      phase: "reveal"
    };
    this.showGame();

    if (!reducedMotion) {
      await delay(260);
    }

    this.deferPveOutcomeSound = true;
    this.deferredPveRoundSound = null;
    const result = await this.gameController.playCard(cardIndex);
    this.maybeEmitPveAiTauntForResult(result);
    const deferredOutcomeRound = this.deferredPveRoundSound;
    this.deferPveOutcomeSound = false;
    this.deferredPveRoundSound = null;
    if (result?.status === "war_continues" || result?.status === "resolved") {
      const playedReveal = this.playRoundRevealSounds(result, MATCH_MODE.PVE, { warWasActive });
      await this.waitForRevealSoundSpacing(playedReveal);
      try {
        this.roundPresentation = {
          phase: "idle",
          busy: true,
          selectedCardIndex: null
        };
        await this.showSharedResolutionPopup(
          result?.status === "resolved"
            ? { status: "round_resolved", round: result.round }
            : result,
          MATCH_MODE.PVE,
          {
            onShown: async () => {
              if (deferredOutcomeRound) {
                this.sound.playRoundResolved({ mode: MATCH_MODE.PVE, round: deferredOutcomeRound });
              }
            }
          }
        );
      } finally {
        this.roundPresentation = {
          phase: "idle",
          busy: false,
          selectedCardIndex: null
        };
        this.screenFlow = "idle";
      }
    } else {
      this.roundPresentation = {
        phase: "idle",
        busy: false,
        selectedCardIndex: null
      };
      this.screenFlow = "idle";
    }

    if (this.gameController.getViewModel()?.status === "active") {
      this.gameController?.rearmActiveRoundPresentation?.();
      this.showGame();
      return;
    }

    if (this.flushPendingGauntletVictoryModal()) {
      return;
    }

    if (this.flushPendingGauntletContinuation()) {
      return;
    }

    this.flushPendingMatchCompleteModal();
  }

  async handleGameCardSelection(cardIndex) {
    const vm = this.gameController?.getViewModel();
    if (!vm) {
      return;
    }

    if (vm.mode === MATCH_MODE.LOCAL_PVP) {
      this.gameController?.pauseLocalTurnTimer?.();
      const result = await this.gameController.submitHotseatSelection(cardIndex);

      this.roundPresentation = {
        phase: "idle",
        busy: false,
        selectedCardIndex: null
      };

      if (result.status === "pass_to_p2") {
        this.showPassToPlayer2();
        return;
      }

      if (result.status === "pass_to_p1") {
        await this.presentHotseatResolution();
        return;
      }

      this.showGame();
      return;
    }

    await this.presentPveRound(cardIndex);
  }

  async quitCurrentMatch() {
    const vm = this.gameController?.getViewModel();
    if (!vm || vm.status !== "active") {
      this.showMenu();
      return;
    }

    if (vm.mode === MATCH_MODE.LOCAL_PVP) {
      const now = Date.now();
      const elapsed = now - this.localQuitLastRequestAt;
      if (elapsed < 30000) {
        const secondsLeft = Math.ceil((30000 - elapsed) / 1000);
        this.modalManager.show({
          title: "Quit Cooldown",
          body: `A new local quit request is available in ${secondsLeft}s.`,
          actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
        });
        return;
      }

      this.localQuitLastRequestAt = now;
      const names = this.getLocalNames();
      const requester = vm.hotseatTurn === "p2" ? names.p2 : names.p1;
      const other = vm.hotseatTurn === "p2" ? names.p1 : names.p2;

      this.modalManager.show({
        title: "Request Quit",
        body:
          "Both players must agree to quit.\n" +
          "Quitting gives all players a loss and no achievements.\n\n" +
          requester + " is requesting to quit. " + other + ", do you accept?",
        actions: [
          {
            label: "Accept Quit",
            onClick: async () => {
              this.modalManager.hide();
              await this.gameController.quitMatch({ quitter: "both", reason: "quit_forfeit" });
            }
          },
          {
            label: "Decline",
            onClick: () => {
              this.modalManager.hide();
              this.showGame();
            }
          }
        ]
      });

      return;
    }

    this.modalManager.show({
      title: "Leave Match",
      body:
        "Quitting gives you a loss and no achievements will be awarded for this match.",
      actions: [
        {
          label: "Quit Match",
          onClick: async () => {
            this.modalManager.hide();
            await this.gameController.quitMatch({ quitter: "p1", reason: "quit_forfeit" });
          }
        },
        { label: "Cancel", onClick: () => this.modalManager.hide() }
      ]
    });
  }

  showGame() {
    const vm = this.gameController?.getViewModel();
    if (!vm) {
      this.showMenu();
      return;
    }

    this.clearTransientUiBeforeScreenTransition({
      preserveModal: this.hasActiveQuitConfirmationModal() || this.hasActiveMatchCompleteModal()
    });
    this.screenFlow = "game";
    const preservedTauntHudState = this.captureCurrentTauntHudDomState("game");
    const tauntHud = this.getCurrentTauntHudState();

    const localPvp = vm.mode === MATCH_MODE.LOCAL_PVP;
    if (localPvp) {
      if (vm.status !== "active" || this.roundPresentation.busy) {
        this.gameController?.pauseLocalTurnTimer?.();
      } else {
        this.gameController?.resumeLocalTurnTimer?.();
      }
    }

    const names = this.getLocalNames();
    const p1Profile = this.buildMatchCosmeticProfileView(localPvp ? this.localProfiles?.p1 : this.profile);
    const p2Profile = localPvp ? this.buildMatchCosmeticProfileView(this.localProfiles?.p2) : null;
    const pveOpponentStyle = localPvp ? null : this.resolvePveOpponentStyle();
    const nonLocalOpponentName = pveOpponentStyle?.name ?? this.getCurrentPveOpponentName();
    const localViewerKey = localPvp && vm.hotseatTurn === "p2" ? "p2" : "p1";
    const localOpponentProfile =
      !localPvp
        ? null
        : localViewerKey === "p2"
          ? p1Profile ?? this.profile
          : p2Profile ?? null;
    const opponentCardVariants = this.normalizeElementCardVariantMap(
      localPvp
        ? localOpponentProfile?.equippedCosmetics?.elementCardVariant ?? null
        : pveOpponentStyle?.elementCardVariant ?? null
    );

    const playerDisplay = this.buildPlayerDisplay(p1Profile, names.p1, "Initiate");
    const opponentDisplay = localPvp
      ? this.buildPlayerDisplay(p2Profile, names.p2, "Initiate")
      : this.resolveIdentityDisplay({
          name: nonLocalOpponentName,
          fallbackName: nonLocalOpponentName,
          avatarId: pveOpponentStyle?.avatarId ?? "default_avatar",
          avatarPath: pveOpponentStyle?.avatarPath ?? null,
          titleId: pveOpponentStyle?.titleId ?? null,
          badgeId: pveOpponentStyle?.badgeId ?? "none",
          badgePath: pveOpponentStyle?.badgePath ?? null,
          titleIconPath: pveOpponentStyle?.titleIconPath ?? null,
          titleText: pveOpponentStyle?.titleName ?? "Arena Rival",
          fallbackTitle: "Arena Rival"
        });
    this.opponentDisplayName = opponentDisplay?.name ?? "Elemental AI";

    const p1Variant = p1Profile?.equippedCosmetics?.elementCardVariant ?? null;
    const p1CardBack = p1Profile?.equippedCosmetics?.cardBack ?? "default_card_back";
    const p2Variant =
      localPvp
        ? p2Profile?.equippedCosmetics?.elementCardVariant ?? null
        : null;
    const p2CardBack = localPvp
      ? p2Profile?.equippedCosmetics?.cardBack ?? "default_card_back"
      : pveOpponentStyle?.cardBackId ?? "default_card_back";

    const backgroundProfile =
      localPvp && vm.hotseatTurn === "p2" ? p2Profile ?? this.profile : p1Profile ?? this.profile;
    const arenaBackground =
      !localPvp && pveOpponentStyle?.backgroundPath
        ? getArenaBackground(pveOpponentStyle.backgroundPath)
        : this.getBackgroundFromProfile(backgroundProfile);

    this.screenManager.show("game", {
      game: vm,
      arenaBackground,
      cardImages: {
        p1: getVariantCardImages(p1Variant),
        p2: getVariantCardImages(p2Variant)
      },
        cosmeticIds: {
          variants: {
            p1: p1Variant,
            p2: p2Variant
        },
        cardBacks: {
          p1: p1CardBack,
          p2: p2CardBack
        }
        },
        opponentCardVariants,
        cardBacks: {
          p1: getCardBackImage(p1CardBack),
          p2: getCardBackImage(p2CardBack)
      },
      playerDisplay,
      opponentDisplay,
      reducedMotion: this.isReducedMotion(),
      presentation: this.roundPresentation,
      hotseat: {
        enabled: localPvp,
        activePlayer: localPvp ? vm.hotseatTurn : "p1",
        p1Name: names.p1,
        p2Name: localPvp ? names.p2 : opponentDisplay?.name ?? nonLocalOpponentName,
        turnLabel: localPvp ? `${vm.hotseatTurn === "p1" ? names.p1 : names.p2} Turn` : "Player Turn"
      },
      taunts: {
        panelOpen: this.matchTauntPanelOpen,
        messages: this.getRenderableMatchTaunts(),
        presetLines: MATCH_TAUNT_PRESETS,
        cooldownRemainingMs: tauntHud.cooldownRemainingMs,
        canSend: tauntHud.canSend
      },
      actions: {
        playCard: async (nextCardIndex) => this.handleGameCardSelection(nextCardIndex),
        backToMenu: async () => this.quitCurrentMatch(),
        toggleTauntsPanel: async () => {
          this.toggleMatchTauntPanel();
        },
        sendTaunt: async (line) => {
          await this.sendCurrentMatchTaunt(line);
        }
      }
    });
    this.finalizeRenderedTauntHud("game", preservedTauntHudState);
    this.ensureMatchTauntUiTimer();
  }

  async showProfile({
    preserveModal = false,
    preserveAchievementVisibility = false,
    profileOverride = null,
    cosmeticsOverride = null,
    searchResultsOverride = null,
    viewedProfileOverride,
    skipAuthoritativeProfileRefresh = false
  } = {}) {
    const isAuthenticatedOwnProfileFlow = this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, this.username);
    const hasAuthenticatedOwnProfileSession = this.hasAuthenticatedMultiplayerSessionForUsername(
      this.username,
      this.onlinePlayState
    );
    if (isAuthenticatedOwnProfileFlow && !this.isOwnProfileHydrated()) {
      await this.loadPreferredProfileForOnlineSession({
        username: this.username,
        onlineState: this.onlinePlayState,
        allowEnsureLocal: false
      });
      if (!this.requireOwnProfileHydratedForAction("show_profile")) {
        return;
      }
    }

    const enteringFresh = this.screenFlow !== "profile";
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    if (!preserveAchievementVisibility || enteringFresh) {
      this.profileAchievementsExpanded = false;
      this.viewedProfileAchievementsExpanded = false;
    }
    this.screenFlow = "profile";
    const shouldRefreshProfile = !skipAuthoritativeProfileRefresh && !profileOverride;
    const serverProfile = shouldRefreshProfile && this.hasMultiplayerProfileAccess()
      ? await window.elemintz.multiplayer.getProfile({ username: this.username })
      : null;
    const rememberedAuthoritativeProfile = hasAuthenticatedOwnProfileSession
      ? this.getRememberedAuthoritativeOwnProfile(this.username, this.onlinePlayState)
      : null;
    const hasAuthoritativeServerProfile = Boolean(serverProfile);
    let resolvedProfile = profileOverride;
    if (!resolvedProfile && hasAuthenticatedOwnProfileSession) {
      if (hasAuthoritativeServerProfile) {
        resolvedProfile = this.applyServerProfileSnapshot(serverProfile, {
          fallbackProfile: rememberedAuthoritativeProfile ?? this.profile ?? null
        });
      } else {
        resolvedProfile = rememberedAuthoritativeProfile;
        if (!resolvedProfile) {
          this.profile = null;
          this.setOwnProfileHydrationState("error", {
            username: this.username,
            message: "Unable to refresh your online profile."
          });
          this.requireOwnProfileHydratedForAction("show_profile");
          return;
        }
        this.profile = resolvedProfile;
      }
    }

    if (!resolvedProfile) {
      const localProfile = shouldRefreshProfile
        ? await window.elemintz.state.getProfile(this.username)
        : this.profile ?? null;
      resolvedProfile = this.mergeServerOwnedProfileDomains(localProfile, serverProfile);
      this.profile = resolvedProfile;
    } else if (profileOverride) {
      this.profile = profileOverride;
    }
    const achievementCatalog = this.buildAchievementCatalogForProfile(this.profile);
    const rawCosmetics = cosmeticsOverride
      ? null
      : shouldRefreshProfile
        ? hasAuthenticatedOwnProfileSession
          ? this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.getCosmetics
            ? await window.elemintz.multiplayer.getCosmetics({ username: this.username })
            : null
          : this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.getCosmetics
          ? await window.elemintz.multiplayer.getCosmetics({ username: this.username })
          : await window.elemintz.state.getCosmetics(this.username)
        : null;
    const cosmetics = cosmeticsOverride ?? this.buildSafeCosmeticsPayload(rawCosmetics, this.profile);
    if (shouldRefreshProfile && (serverProfile?.progression?.xp || window.elemintz.state.getDailyChallenges)) {
      const challengeStatus = serverProfile
        ? { xp: serverProfile.progression?.xp ?? null }
        : await window.elemintz.state.getDailyChallenges(this.username);
      this.profile = {
        ...this.profile,
        ...(challengeStatus?.xp ?? {})
      };
    }
    const query = this.profileSearchQuery.trim().toLowerCase();
    const searchResults =
      searchResultsOverride ??
      (query
        ? (await window.elemintz.state.listProfiles())
            .filter((item) => item.username.toLowerCase().includes(query))
            .slice(0, 8)
        : []);

    const viewedProfile =
      viewedProfileOverride !== undefined
        ? viewedProfileOverride
        : this.viewedProfileUsername
          ? await this.loadViewedProfile(this.viewedProfileUsername)
          : null;

    this.screenManager.show("profile", {
      profile: this.profile,
      achievementCatalog,
      titleIcon: TITLE_ICON_MAP[this.resolveTitleLabel(this.profile)]
        ? getAssetPath(TITLE_ICON_MAP[this.resolveTitleLabel(this.profile)])
        : null,
        cosmetics,
        backgroundImage: this.getBackgroundFromProfile(this.profile),
        basicChestVisualState: this.profileChestVisualState,
        profileChestOpenInFlight: this.profileChestOpenInFlight,
        searchQuery: this.profileSearchQuery,
        searchError: this.profileSearchError,
        searchResults,
        viewedProfile,
        profileAchievementsExpanded: this.profileAchievementsExpanded,
        viewedProfileAchievementsExpanded: this.viewedProfileAchievementsExpanded,
      actions: {
        openBasicChest: async () => {
          await this.openProfileChest("basic");
        },
        openMilestoneChest: async () => {
          await this.openProfileChest("milestone");
        },
        openEpicChest: async () => {
          await this.openProfileChest("epic");
        },
        openLegendaryChest: async () => {
          await this.openProfileChest("legendary");
        },
        equip: async (type, cosmeticId) => {
          const result =
            this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.equipCosmetic
              ? await window.elemintz.multiplayer.equipCosmetic({ username: this.username, type, cosmeticId })
              : await window.elemintz.state.equipCosmetic({ username: this.username, type, cosmeticId });
          this.profile = result?.snapshot
            ? this.buildProfileFromServerSnapshot(result.snapshot)
            : result.profile;
          await this.showProfile({
            preserveAchievementVisibility: true,
            profileOverride: this.profile,
            cosmeticsOverride: this.buildSafeCosmeticsPayload(null, this.profile),
            searchResultsOverride: searchResults,
            viewedProfileOverride: viewedProfile,
            skipAuthoritativeProfileRefresh: true
          });
        },
        toggleProfileAchievements: async () => {
          this.profileAchievementsExpanded = !this.profileAchievementsExpanded;
          await this.showProfile({
            preserveAchievementVisibility: true,
            profileOverride: this.profile,
            cosmeticsOverride: cosmetics,
            searchResultsOverride: searchResults,
            viewedProfileOverride: viewedProfile,
            skipAuthoritativeProfileRefresh: true
          });
        },
        toggleViewedProfileAchievements: async () => {
          this.viewedProfileAchievementsExpanded = !this.viewedProfileAchievementsExpanded;
          await this.showProfile({
            preserveAchievementVisibility: true,
            profileOverride: this.profile,
            cosmeticsOverride: cosmetics,
            searchResultsOverride: searchResults,
            viewedProfileOverride: viewedProfile,
            skipAuthoritativeProfileRefresh: true
          });
        },
        searchProfiles: async (queryValue) => {
          this.profileSearchQuery = queryValue;
          this.profileSearchError = "";
          this.clearViewedProfileSelection();
          await this.showProfile({ preserveAchievementVisibility: true });
        },
        viewProfile: async (username) => {
          const safeUsername = String(username ?? "").trim();
          if (!safeUsername) {
            this.profileSearchError = "";
            this.clearViewedProfileSelection();
            await this.showProfile({
              preserveAchievementVisibility: true,
              profileOverride: this.profile,
              cosmeticsOverride: cosmetics,
              searchResultsOverride: searchResults,
              viewedProfileOverride: null,
              skipAuthoritativeProfileRefresh: true
            });
            return;
          }

          await this.openViewedProfile(safeUsername, { preserveAchievementVisibility: true });
        },
        clearViewed: async () => {
          this.profileSearchError = "";
          this.clearViewedProfileSelection();
          await this.showProfile({
            preserveAchievementVisibility: true,
            profileOverride: this.profile,
            cosmeticsOverride: cosmetics,
            searchResultsOverride: searchResults,
            viewedProfileOverride: null,
            skipAuthoritativeProfileRefresh: true
          });
        },
        openBattleReport: async () => {
          this.battleReportSelectedIndex = null;
          this.showBattleReportModal();
        },
        back: () => this.showMenu()
      }
    });
    if (viewedProfile) {
      this.showViewedProfileModal(viewedProfile);
    }
    this.updateOnlineReconnectReminderModal();
    Promise.resolve().then(() => this.maybeShowMilestoneChestRewardNotice());
  }

  clearViewedProfileSelection() {
    this.viewedProfileUsername = null;
    this.viewedProfileCloseAction = null;
    this.viewedProfileAchievementsExpanded = false;
  }

  async openViewedProfile(
    username,
    { preserveAchievementVisibility = true, onClose = null } = {}
  ) {
    const safeUsername = String(username ?? "").trim();
    if (!safeUsername) {
      return false;
    }

    this.profileSearchQuery = safeUsername;
    this.profileSearchError = "";
    this.viewedProfileUsername = safeUsername;
    this.viewedProfileCloseAction = typeof onClose === "function" ? onClose : null;
    this.viewedProfileAchievementsExpanded = false;
    await this.showProfile({ preserveAchievementVisibility });
    return true;
  }

  buildViewedProfileLookupMessage(username, error) {
    const safeUsername = String(username ?? "").trim();
    const code = String(error?.code ?? "").trim().toUpperCase();
    if (code === "PROFILE_NOT_FOUND") {
      return `Profile "${safeUsername}" was not found.`;
    }

    return `Unable to load profile "${safeUsername}".`;
  }

  async loadViewedProfile(username) {
    const safeUsername = String(username ?? "").trim();
    if (!safeUsername) {
      return null;
    }

    const canUseAuthoritativeViewedProfile =
      Boolean(this.onlinePlayState?.session?.authenticated) &&
      typeof window.elemintz?.multiplayer?.viewProfile === "function";

    if (canUseAuthoritativeViewedProfile) {
      try {
        const snapshot = await window.elemintz.multiplayer.viewProfile({ username: safeUsername });
        const profile = this.buildProfileFromServerSnapshot(snapshot);
        if (profile) {
          this.profileSearchError = "";
          return profile;
        }
        this.profileSearchError = this.buildViewedProfileLookupMessage(safeUsername, {
          code: "PROFILE_VIEW_FAILED"
        });
        return null;
      } catch (error) {
        this.profileSearchError = this.buildViewedProfileLookupMessage(safeUsername, error);
        console.warn("Viewed profile lookup failed", {
          username: safeUsername,
          code: String(error?.code ?? "").trim().toUpperCase() || null,
          message: String(error?.message ?? error ?? "Unknown viewed profile failure.")
        });
        return null;
      }
    }

    this.profileSearchError = "";
    const localViewedProfile = await window.elemintz.state.getProfile(safeUsername);
    return localViewedProfile;
  }

  bindViewedProfileModalControls() {
    const viewedProfileModalBody =
      globalThis.document?.querySelector?.(".viewed-profile-modal-body") ?? null;
    if (viewedProfileModalBody && !viewedProfileModalBody.__elemintzHoverPreviewBound) {
      bindCosmeticHoverPreview({
        root: viewedProfileModalBody,
        documentRef: globalThis.document
      });
      viewedProfileModalBody.__elemintzHoverPreviewBound = true;
    }

    const viewedAchievementsToggle =
      globalThis.document?.getElementById?.("viewed-profile-achievements-toggle-btn") ?? null;
    if (!viewedAchievementsToggle) {
      return;
    }

    viewedAchievementsToggle.addEventListener("click", async () => {
      this.viewedProfileAchievementsExpanded = !this.viewedProfileAchievementsExpanded;
      await this.showProfile({ preserveAchievementVisibility: true, preserveModal: true });
    });
  }

  bindBattleReportModalControls() {
    const battleReportEntryButtons = Array.from(
      globalThis.document?.querySelectorAll?.("[data-battle-report-entry-index]") ?? []
    );
    for (const battleReportEntryButton of battleReportEntryButtons) {
      battleReportEntryButton.addEventListener("click", () => {
        const selectedIndex = Number.parseInt(
          String(battleReportEntryButton.getAttribute("data-battle-report-entry-index") ?? ""),
          10
        );
        if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
          return;
        }

        this.battleReportSelectedIndex = selectedIndex;
        this.showBattleReportModal();
      });
    }

    const battleReportBackButton =
      globalThis.document?.querySelector?.("[data-battle-report-back]") ?? null;
    if (battleReportBackButton) {
      battleReportBackButton.addEventListener("click", () => {
        this.battleReportSelectedIndex = null;
        this.showBattleReportModal();
      });
    }

    const opponentProfileButtons = Array.from(
      globalThis.document?.querySelectorAll?.("[data-battle-report-view-profile]") ?? []
    );
    for (const opponentProfileButton of opponentProfileButtons) {
      opponentProfileButton.addEventListener("click", async () => {
        const username = String(
          opponentProfileButton.getAttribute("data-battle-report-view-profile") ?? ""
        ).trim();
        if (!username) {
          return;
        }

        const previousSearchQuery = this.profileSearchQuery;
        const previousSearchError = this.profileSearchError;
        this.modalManager.hide();
        await this.openViewedProfile(username, {
          preserveAchievementVisibility: true,
          onClose: async () => {
            this.profileSearchQuery = previousSearchQuery;
            this.profileSearchError = previousSearchError;
            await this.showProfile({
              preserveAchievementVisibility: true,
              preserveModal: true,
              profileOverride: this.profile,
              skipAuthoritativeProfileRefresh: true
            });
            this.showBattleReportModal();
          }
        });
      });
    }
  }

  showViewedProfileModal(viewedProfile) {
    if (!viewedProfile) {
      return;
    }

    const closeAction = this.viewedProfileCloseAction;

    this.modalManager.show({
      title: `Viewing: ${viewedProfile.username}`,
      bodyHtml: profileScreen.renderViewedProfileModalBody(viewedProfile, {
        achievementsExpanded: this.viewedProfileAchievementsExpanded
      }),
      modalClassName: "viewed-profile-modal",
      bodyClassName: "viewed-profile-modal-body",
      actions: [
        {
          label: "Close",
          onClick: async () => {
            this.modalManager.hide();
            this.clearViewedProfileSelection();
            if (typeof closeAction === "function") {
              await closeAction();
              return;
            }
            await this.showProfile({ preserveAchievementVisibility: true, preserveModal: true });
          }
        }
      ]
    });
    this.bindViewedProfileModalControls();
  }

  showBattleReportModal() {
    this.modalManager.show({
      title: "Battle Report",
      bodyHtml: profileScreen.renderBattleReportModalBody(this.profile ?? {}, {
        selectedBattleIndex: this.battleReportSelectedIndex
      }),
      modalClassName: "battle-report-modal",
      bodyClassName: "battle-report-modal-body",
      actions: [{ label: "Close", onClick: () => this.modalManager.hide() }]
    });
    this.bindBattleReportModalControls();
  }

  async showDailyChallenges() {
    this.clearTransientUiBeforeScreenTransition();
    this.screenFlow = "dailyChallenges";
    const serverProfile = this.hasMultiplayerProfileAccess()
      ? await window.elemintz.multiplayer.getProfile({ username: this.username })
      : null;
    const result = serverProfile
      ? {
          daily: serverProfile.progression?.dailyChallenges ?? null,
          weekly: serverProfile.progression?.weeklyChallenges ?? null,
          tokens: serverProfile.currency?.tokens ?? serverProfile.profile?.tokens ?? this.profile?.tokens ?? 0
        }
      : this.isAuthenticatedOnlineProfileFlow()
        ? {
            daily: this.dailyChallenges?.daily ?? null,
            weekly: this.dailyChallenges?.weekly ?? null,
            tokens: this.profile?.tokens ?? 0
          }
      : await window.elemintz.state.getDailyChallenges(this.username);
    this.dailyChallenges = { daily: result.daily, weekly: result.weekly };

    this.screenManager.show("dailyChallenges", {
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      daily: result.daily,
      weekly: result.weekly,
      tokens: result.tokens ?? this.profile?.tokens ?? 0,
      actions: {
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  async showAchievements() {
    this.clearTransientUiBeforeScreenTransition();
    this.screenFlow = "achievements";
    const serverProfile = this.hasMultiplayerProfileAccess()
      ? await window.elemintz.multiplayer.getProfile({ username: this.username })
      : null;
    const authoritativeProfile = serverProfile
      ? this.applyServerProfileSnapshot(serverProfile)
      : this.isAuthenticatedOnlineProfileFlow()
        ? this.profile ?? null
        : null;
    const achievements = authoritativeProfile
      ? this.buildAchievementCatalogForProfile(authoritativeProfile)
      : (await window.elemintz.state.getAchievements(this.username)).achievements;

    this.screenManager.show("achievements", {
      backgroundImage: this.getBackgroundFromProfile(authoritativeProfile ?? this.profile),
      achievements,
      actions: {
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  async showCosmetics({ preserveModal = false, cosmeticsOverride = null } = {}) {
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "cosmetics";
    const cosmetics =
      cosmeticsOverride ?? this.buildSafeCosmeticsPayload(
        this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.getCosmetics
          ? await window.elemintz.multiplayer.getCosmetics({ username: this.username })
          : await window.elemintz.state.getCosmetics(this.username),
        this.profile
      );
    const viewState = this.ensureCosmeticsViewState();

    this.screenManager.show("cosmetics", {
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      cosmetics,
      viewState,
      actions: {
        equip: async (type, cosmeticId) => {
          const result =
            this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.equipCosmetic
              ? await window.elemintz.multiplayer.equipCosmetic({ username: this.username, type, cosmeticId })
              : await window.elemintz.state.equipCosmetic({ username: this.username, type, cosmeticId });
          this.profile = result?.snapshot
            ? this.buildProfileFromServerSnapshot(result.snapshot)
            : result.profile;
          await this.showCosmetics({
            cosmeticsOverride: this.buildSafeCosmeticsPayload(null, this.profile)
          });
        },
        updateRandomizationPreferences: async (patch) => {
          const result =
            this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.updateCosmeticPreferences
              ? await window.elemintz.multiplayer.updateCosmeticPreferences({
                  username: this.username,
                  patch: {
                    randomizeAfterEachMatch: patch
                  }
                })
              : await window.elemintz.state.updateCosmeticPreferences({
                  username: this.username,
                  patch: {
                    randomizeAfterEachMatch: patch
                  }
                });
          this.profile = result?.snapshot
            ? this.buildProfileFromServerSnapshot(result.snapshot)
            : result.profile;
          await this.showCosmetics({
            cosmeticsOverride: this.buildSafeCosmeticsPayload(null, this.profile)
          });
        },
        randomizeNow: async (categories) => {
          const result =
            this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.randomizeOwnedCosmetics
              ? await window.elemintz.multiplayer.randomizeOwnedCosmetics({
                  username: this.username,
                  categories
                })
              : await window.elemintz.state.randomizeOwnedCosmetics({
                  username: this.username,
                  categories
                });
          this.profile = result?.snapshot
            ? this.buildProfileFromServerSnapshot(result.snapshot)
            : result.profile;
          await this.showCosmetics({
            cosmeticsOverride: this.buildSafeCosmeticsPayload(null, this.profile)
          });
        },
        saveLoadout: async (slotIndex) => {
          const slot = cosmetics.loadouts?.[slotIndex] ?? null;
          const shouldUseAuthoritativeLoadoutPath =
            this.hasAuthenticatedMultiplayerSessionForUsername(this.username) &&
            window.elemintz?.multiplayer?.saveCosmeticLoadout;
          const runSave = async () => {
            const result =
              shouldUseAuthoritativeLoadoutPath
                ? await window.elemintz.multiplayer.saveCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  })
                : await window.elemintz.state.saveCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  });
            const nextCosmeticsSource = result?.cosmetics ?? result?.snapshot?.cosmetics ?? null;
            this.profile = result?.snapshot
              ? this.buildProfileFromServerSnapshot(result.snapshot)
              : result.profile;
            await this.showCosmetics({
              cosmeticsOverride: this.buildSafeCosmeticsPayload(nextCosmeticsSource, this.profile)
            });
          };

          if (slot?.hasSavedLoadout) {
            this.modalManager.show({
              title: "Overwrite Loadout",
              body: "Overwrite this loadout slot with your current equipped cosmetics?",
              actions: [
                {
                  label: "Overwrite",
                  onClick: async () => {
                    this.modalManager.hide();
                    await runSave();
                  }
                },
                {
                  label: "Cancel",
                  onClick: () => this.modalManager.hide()
                }
              ]
            });
            return;
          }

          await runSave();
        },
        applyLoadout: async (slotIndex) => {
          try {
            const shouldUseAuthoritativeLoadoutPath =
              this.hasAuthenticatedMultiplayerSessionForUsername(this.username) &&
              window.elemintz?.multiplayer?.applyCosmeticLoadout;
            const result =
              shouldUseAuthoritativeLoadoutPath
                ? await window.elemintz.multiplayer.applyCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  })
                : await window.elemintz.state.applyCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  });
            const nextCosmeticsSource = result?.cosmetics ?? result?.snapshot?.cosmetics ?? null;
            this.profile = result?.snapshot
              ? this.buildProfileFromServerSnapshot(result.snapshot)
              : result.profile;
            await this.showCosmetics({
              cosmeticsOverride: this.buildSafeCosmeticsPayload(nextCosmeticsSource, this.profile)
            });
          } catch (error) {
            this.modalManager.show({
              title: "Loadout Unavailable",
              body: String(error?.message ?? "Unable to apply this loadout."),
              actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
            });
          }
        },
        renameLoadout: async (slotIndex, name) => {
          try {
            const shouldUseAuthoritativeLoadoutPath =
              this.hasAuthenticatedMultiplayerSessionForUsername(this.username) &&
              window.elemintz?.multiplayer?.renameCosmeticLoadout;
            const result =
              shouldUseAuthoritativeLoadoutPath
                ? await window.elemintz.multiplayer.renameCosmeticLoadout({
                    username: this.username,
                    slotIndex,
                    name
                  })
                : await window.elemintz.state.renameCosmeticLoadout({
                    username: this.username,
                    slotIndex,
                    name
                  });
            const nextCosmeticsSource = result?.cosmetics ?? result?.snapshot?.cosmetics ?? null;
            this.profile = result?.snapshot
              ? this.buildProfileFromServerSnapshot(result.snapshot)
              : result.profile;
            await this.showCosmetics({
              cosmeticsOverride: this.buildSafeCosmeticsPayload(nextCosmeticsSource, this.profile)
            });
          } catch (error) {
            this.modalManager.show({
              title: "Rename Failed",
              body: String(error?.message ?? "Unable to rename this loadout."),
              actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
            });
          }
        },
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  async showStore({
    preserveModal = false,
    profileOverride = null,
    storeOverride = null,
    featuredRotationOverride,
    skipProfileRefresh = false,
    preferCachedFeaturedRotation = true
  } = {}) {
    let hydratedProfileForStore = null;
    if (this.isAuthenticatedOnlineProfileFlow(this.onlinePlayState, this.username) && !this.isOwnProfileHydrated()) {
      hydratedProfileForStore = await this.loadPreferredProfileForOnlineSession({
        username: this.username,
        onlineState: this.onlinePlayState,
        allowEnsureLocal: false
      });
      if (!this.requireOwnProfileHydratedForAction("show_store")) {
        return;
      }
    }

    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "store";
    const viewState = this.ensureStoreViewState();
    const serverProfile = !skipProfileRefresh && !profileOverride && !hydratedProfileForStore && this.hasMultiplayerProfileAccess()
      ? await window.elemintz.multiplayer.getProfile({ username: this.username })
      : null;
    const profileForStore =
      profileOverride ??
      hydratedProfileForStore ??
      this.buildProfileFromServerSnapshot(serverProfile) ??
      serverProfile?.profile ??
      this.profile ??
      {};
    const store =
      storeOverride ??
      (serverProfile || profileOverride || hydratedProfileForStore
        ? getStoreViewForProfile(profileForStore)
        : await window.elemintz.state.getStore(this.username));
    const featuredRotation = this.buildFeaturedStoreRotationContext(
      featuredRotationOverride !== undefined
        ? featuredRotationOverride
        : await this.loadFeaturedStoreRotation({ preferCache: preferCachedFeaturedRotation }),
      store,
      profileForStore
    );

    this.screenManager.show("store", {
      backgroundImage: this.getBackgroundFromProfile(profileForStore),
      store,
      featuredRotation,
      viewState,
      storePurchasePending: this.storePurchaseInFlight,
      storePurchasePendingKey: this.storePurchaseInFlightKey,
      actions: {
        buy: async (type, cosmeticId) => {
          const purchaseKey = this.buildStorePurchaseKey(type, cosmeticId);
          if (this.storePurchaseInFlight) {
            return;
          }

          this.storePurchaseInFlight = true;
          this.storePurchaseInFlightKey = purchaseKey;
          if (this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.buyStoreItem) {
            try {
              const result = await window.elemintz.multiplayer.buyStoreItem({
                username: this.username,
                type,
                cosmeticId
              });
              this.profile = result?.snapshot
                ? this.buildProfileFromServerSnapshot(result.snapshot)
                : result?.profile ?? this.profile;
              const nextStore = getStoreViewForProfile(this.profile ?? {});

              if (result?.purchase?.status === "already-owned") {
                this.modalManager.show({
                  title: "Already Owned",
                  body: "That store item is already owned on your profile.",
                  actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
                });
                await this.showStore({
                  preserveModal: true,
                  profileOverride: this.profile,
                  storeOverride: nextStore,
                  featuredRotationOverride: this.storeFeaturedRotationCache,
                  skipProfileRefresh: true
                });
                return;
              }

              await this.showStore({
                profileOverride: this.profile,
                storeOverride: nextStore,
                featuredRotationOverride: this.storeFeaturedRotationCache,
                skipProfileRefresh: true
              });
            } catch (error) {
              this.modalManager.show({
                title: "Purchase Failed",
                body: String(error?.message ?? "Unable to complete this store purchase."),
                actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
              });
            } finally {
              this.storePurchaseInFlight = false;
              this.storePurchaseInFlightKey = null;
            }
            return;
          }

          this.showLegacyLocalAuthorityDisabledModal(
            "Local store purchases are unavailable while duplicate offline progression systems are being removed."
          );
          this.storePurchaseInFlight = false;
          this.storePurchaseInFlightKey = null;
        },
        equip: async (type, cosmeticId) => {
          const result =
            this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.equipCosmetic
              ? await window.elemintz.multiplayer.equipCosmetic({ username: this.username, type, cosmeticId })
              : await window.elemintz.state.equipCosmetic({ username: this.username, type, cosmeticId });
          this.profile = result?.snapshot
            ? this.buildProfileFromServerSnapshot(result.snapshot)
            : result.profile;
          await this.showStore({
            profileOverride: this.profile,
            storeOverride: getStoreViewForProfile(this.profile ?? {}),
            featuredRotationOverride: this.storeFeaturedRotationCache,
            skipProfileRefresh: true
          });
        },
        activateSupporter: async () => {
          this.showLegacyLocalAuthorityDisabledModal(
            "Local supporter pass grants are unavailable while duplicate offline progression systems are being removed."
          );
        },
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  async showSettings({ preserveModal = false } = {}) {
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "settings";
    this.settings = await window.elemintz.state.getSettings();
    this.applyMotionPreference();

    this.screenManager.show("settings", {
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      settings: this.settings,
      actions: {
        save: async (patch) => {
          this.settings = await window.elemintz.state.updateSettings(patch);
          this.applyMotionPreference();
          this.applySoundPreference();
          this.modalManager.show({
            title: "Settings Saved",
            body: "Your preferences were updated.",
            actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
          });
          this.showSettings({ preserveModal: true });
        },
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  showHowToPlay({ preserveModal = false } = {}) {
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "howToPlay";
    this.screenManager.show("howToPlay", {
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      actions: {
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  showRoadmap({ preserveModal = false } = {}) {
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "roadmap";
    this.screenManager.show("roadmap", {
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      actions: {
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }
}




















import {
  achievementsScreen,
  cosmeticsScreen,
  dailyChallengesScreen,
  gameScreen,
  localSetupScreen,
  loginScreen,
  menuScreen,
  onlinePlayScreen,
  passScreen,
  profileScreen,
  settingsScreen,
  storeScreen
} from "../ui/screens/index.js";
import { buildGameHudPrimaryLine, buildGameLiveUpdateSignature } from "../ui/screens/gameScreen.js";
import { renderMenuChallengePreview, renderMenuDailyLoginStatus } from "../ui/screens/menuScreen.js";
import { getArenaBackground, getAvatarImage, getBadgeImage, getCardBackImage, getVariantCardImages } from "../utils/assets.js";
import { escapeHtml, getAssetPath } from "../utils/dom.js";
import { GameController, MATCH_MODE } from "./gameController.js";
import { SoundManager } from "./soundManager.js";
import { buildAchievementCatalog } from "../../state/achievementSystem.js";
import { COSMETIC_CATALOG, getCosmeticDefinition, getCosmeticDisplayName } from "../../state/cosmeticSystem.js";
import { getStoreViewForProfile } from "../../state/storeSystem.js";
import { deriveMatchStats } from "../../state/statsTracking.js";
import { createDefaultCategoryViewState } from "../ui/shared/cosmeticCategoryShared.js";
import { MATCH_TAUNT_FEED_LIMIT, MATCH_TAUNT_PRESETS, renderMatchTauntHudContents } from "../ui/shared/playSurfaceShared.js";

const FALLBACK_SETTINGS = {
  audio: { enabled: true },
  gameplay: { timerSeconds: 30 },
  aiDifficulty: "normal",
  aiOpponentStyle: "default",
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
const MATCH_TAUNT_HISTORY_LIMIT = 8;
const MATCH_TAUNT_VISIBLE_MS = 20000;
const MATCH_TAUNT_FADE_MS = 400;
const MATCH_TAUNT_UI_TICK_MS = 250;
const PLAYER_TAUNT_COOLDOWN_MS = 12000;
const AI_TAUNT_COOLDOWN_MIN_MS = 20000;
const AI_TAUNT_COOLDOWN_MAX_MS = 30000;
const AI_TAUNT_CHANCE_MIN = 0.3;
const AI_TAUNT_CHANCE_MAX = 0.5;
const PVE_AI_TAUNT_LINES = Object.freeze({
  match_start: Object.freeze(["Your move.", "Let's finish this.", "I saw that coming."]),
  player_win: Object.freeze(["Interesting.", "Not bad.", "Bold choice."]),
  player_loss: Object.freeze(["You got lucky.", "This isn't over.", "A risky play."]),
  war_start: Object.freeze(["Interesting.", "Bold choice.", "Let's finish this."]),
  war_resolved: Object.freeze(["Well played.", "Not bad.", "I saw that coming."]),
  near_victory: Object.freeze(["This isn't over.", "Let's finish this.", "Your move."]),
  match_end: Object.freeze(["Well played.", "Not bad.", "This isn't over."])
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
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
    this.profileSearchQuery = "";
    this.viewedProfileUsername = null;
    this.passTimerId = null;
    this.passKeyHandler = null;
    this.dailyChallenges = null;
    this.dailyResetCountdownId = null;
    this.localQuitLastRequestAt = 0;
    this.initPromise = null;
    this.dailyLoginAutoClaimKey = null;
    this.dailyLoginAutoClaimPromise = null;
    this.passCompletionResolve = null;
    this.pendingMatchCompletePayload = null;
    this.deferPveOutcomeSound = false;
    this.deferredPveRoundSound = null;
    this.pveOpponentStyle = null;
    this.profileChestVisualState = {
      basicOpen: false,
      milestoneOpen: false,
      epicOpen: false,
      legendaryOpen: false
    };
    this.profileMilestoneChestNoticeOpen = false;
    this.profileChestOpenInFlight = false;
    this.onlinePlayState = null;
    this.activeAdminGrantNoticeId = null;
    this.queuedAdminGrantNoticeIds = [];
    this.onlinePlayJoinCode = "";
    this.onlinePlayUnsubscribe = null;
    this.onlinePlayChallengeSummary = null;
    this.onlinePlayChallengeSummaryKey = null;
    this.onlinePlayProfileRefreshKey = null;
    this.onlinePlayProfileRefreshPromise = null;
    this.onlineReconnectReminder = null;
    this.onlineReconnectReminderDismissedKey = null;
    this.onlineReconnectUiTimerId = null;
    this.matchTaunts = [];
    this.matchTauntPanelOpen = false;
    this.matchTauntSequence = 0;
    this.matchTauntUiTimerId = null;
    this.playerTauntCooldowns = Object.create(null);
    this.aiTauntCooldownUntil = 0;
    this.aiLastTauntEventKey = null;
    this.tauntRandom = Math.random;
    this.opponentDisplayName = "Elemental AI";
    this.storeViewState = this.createDefaultStoreViewState();
    this.cosmeticsViewState = createDefaultCategoryViewState();
    this.presentedAchievementUnlockKeys = new Set();
    this.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };
    this.screenFlow = "idle";

    this.registerScreens();
  }

  resetDailyLoginAutoClaimGuard() {
    this.dailyLoginAutoClaimKey = null;
    this.dailyLoginAutoClaimPromise = null;
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

  bindRenderedTauntHud(shell, screenFlow = this.screenFlow) {
    if (!shell || typeof shell.querySelectorAll !== "function") {
      return;
    }

    const toggleButton = shell.querySelector?.(`#${screenFlow === "onlinePlay" ? "online" : "game"}-taunts-toggle-btn`);
    toggleButton?.addEventListener("click", async () => {
      this.toggleMatchTauntPanel();
    });

    shell.querySelectorAll("[data-taunt-line]").forEach((button) => {
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

    shell.className = `match-taunt-shell ${renderState.panelOpen ? "is-open" : ""}`.trim();
    shell.innerHTML = renderMatchTauntHudContents(renderState);
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
      rarities: new Set(["Common", "Rare", "Epic", "Legendary"])
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

    return this.storeViewState;
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

  buildPveOpponentStyle() {
    if (this.getConfiguredAiOpponentStyle() !== "random") {
      return {
        avatarId: "default_avatar",
        titleId: null,
        titleName: "Arena Rival",
        badgeId: "none",
        cardBackId: "default_card_back"
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
      cardBackId: cardBack?.id ?? "default_card_back"
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
        stateLabel: "Checking Daily Login Reward...",
        resetLabel: "--:--"
      };
    }

    if (status.eligible) {
      return {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: this.formatDuration(status.msUntilReset)
      };
    }

    return {
      stateLabel: `Next Daily Login Reward: ${this.formatDuration(status.msUntilReset)}`,
      resetLabel: this.formatDuration(status.msUntilReset)
    };
  }

  async ensureDailyLoginAutoClaim({ showToasts = true, requestKey = null } = {}) {
    if (!this.username) {
      return null;
    }

    const effectiveKey = requestKey ?? `user:${this.username}`;
    if (this.dailyLoginAutoClaimKey === effectiveKey) {
      console.info("[DailyLogin][Renderer] skip duplicate auto-claim", {
        username: this.username,
        requestKey: effectiveKey,
        inFlight: Boolean(this.dailyLoginAutoClaimPromise)
      });
      return this.dailyLoginAutoClaimPromise;
    }

    this.dailyLoginAutoClaimKey = effectiveKey;
    this.dailyLoginAutoClaimPromise = this.claimDailyLoginRewardFor(this.username, { showToasts });
    const reward = await this.dailyLoginAutoClaimPromise;

    if (reward?.profile) {
      if (this.hasMultiplayerProfileAccess() && this.profile) {
        this.profile = {
          ...reward.profile,
          username: this.profile.username ?? reward.profile.username ?? this.username,
          wins: this.profile.wins ?? reward.profile.wins ?? 0,
          losses: this.profile.losses ?? reward.profile.losses ?? 0,
          gamesPlayed: this.profile.gamesPlayed ?? reward.profile.gamesPlayed ?? 0,
          warsEntered: this.profile.warsEntered ?? reward.profile.warsEntered ?? 0,
          warsWon: this.profile.warsWon ?? reward.profile.warsWon ?? 0,
          cardsCaptured: this.profile.cardsCaptured ?? reward.profile.cardsCaptured ?? 0,
          modeStats: this.profile.modeStats ?? reward.profile.modeStats ?? null,
          equippedCosmetics: this.profile.equippedCosmetics ?? reward.profile.equippedCosmetics ?? null,
          ownedCosmetics: this.profile.ownedCosmetics ?? reward.profile.ownedCosmetics ?? null,
          cosmeticLoadouts: this.profile.cosmeticLoadouts ?? reward.profile.cosmeticLoadouts ?? null,
          cosmeticRandomizeAfterMatch:
            this.profile.cosmeticRandomizeAfterMatch ??
            reward.profile.cosmeticRandomizeAfterMatch ??
            null
        };
      } else {
        this.profile = reward.profile;
      }
    }

    return reward;
  }

  renderMenuScreen() {
    const dailyLogin = this.formatDailyLoginStatus(this.dailyChallenges?.dailyLogin);

    this.screenManager.show("menu", {
      username: this.username,
      backgroundImage: this.getBackgroundFromProfile(this.profile),
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
      actions: {
        startPveGame: () => this.startGame(MATCH_MODE.PVE),
        startLocalGame: () => this.showLocalSetup(),
        openOnlinePlay: async () => this.showOnlinePlay(),
        openProfile: async () => this.showProfile(),
        openAchievements: async () => this.showAchievements(),
        openDailyChallenges: async () => this.showDailyChallenges(),
        openCosmetics: async () => this.showCosmetics(),
        openStore: async () => this.showStore(),
        openSettings: async () => this.showSettings(),
        switchAccount: async () => this.logoutToLogin({ noticeMessage: "Signed out. Sign in with another account." }),
        logout: async () => this.logoutToLogin({ noticeMessage: "Signed out." })
      }
    });
  }

  clearAuthenticatedExperienceState() {
    this.username = null;
    this.profile = null;
    this.dailyChallenges = null;
    this.localPlayers = null;
    this.localProfiles = null;
    this.onlinePlayChallengeSummary = null;
    this.onlinePlayChallengeSummaryKey = null;
    this.onlinePlayProfileRefreshKey = null;
    this.onlinePlayProfileRefreshPromise = null;
    this.onlinePlayJoinCode = "";
    this.onlineReconnectReminder = null;
    this.onlineReconnectReminderDismissedKey = null;
    this.pendingMatchCompletePayload = null;
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
    const dailyResetLabel = globalThis.document.querySelector?.('[data-menu-reset-label="daily"]');
    const weeklyResetLabel = globalThis.document.querySelector?.('[data-menu-reset-label="weekly"]');
    const dailyLogin = this.formatDailyLoginStatus(this.dailyChallenges?.dailyLogin);

    if (dailyLoginLabel) {
      dailyLoginLabel.textContent = dailyLogin.stateLabel.replace(
        "Next Daily Login Reward",
        "Daily Login Reward"
      );
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
    if (preserveModal) {
      return false;
    }

    return Boolean(this.modalManager?.clearStaleOverlay?.());
  }

  async refreshDailyChallengesForMenu() {
    if (!this.username) {
      return;
    }

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
        return;
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
    } catch (error) {
      console.error("Failed to load daily challenges", error);
    }
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
    titleId = null,
    badgeId = null,
    titleText = null,
    fallbackTitle = "Initiate"
  } = {}) {
    const resolvedAvatarId = getCosmeticDefinition("avatar", avatarId) ? avatarId : "default_avatar";
    const resolvedTitleId = getCosmeticDefinition("title", titleId) ? titleId : null;
    const resolvedBadgeId = getCosmeticDefinition("badge", badgeId) ? badgeId : "none";
    const resolvedTitle = getCosmeticDisplayName("title", resolvedTitleId, titleText ?? fallbackTitle) ?? fallbackTitle;
    const titleDefinition = resolvedTitleId ? getCosmeticDefinition("title", resolvedTitleId) : null;
    const titleIcon =
      titleDefinition?.image
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

  showLegacyLocalAuthorityDisabledModal(body) {
    this.modalManager.show({
      title: "Online Authority Only",
      body,
      actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
    });
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
      elementCardVariant: {
        fire: String(equippedVariants?.fire ?? ONLINE_DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.fire),
        water: String(equippedVariants?.water ?? ONLINE_DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.water),
        earth: String(equippedVariants?.earth ?? ONLINE_DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.earth),
        wind: String(equippedVariants?.wind ?? ONLINE_DEFAULT_EQUIPPED_COSMETICS.elementCardVariant.wind)
      },
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
    return {
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

  applyServerProfileSnapshot(serverProfile) {
    const nextProfile = this.buildProfileFromServerSnapshot(serverProfile);
    if (nextProfile) {
      this.profile = nextProfile;
      this.username = nextProfile.username ?? this.username;
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
      p2: playerTwo.profile
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
    if (onlineConnected && window.elemintz?.multiplayer?.getProfile) {
      const serverProfile = await window.elemintz.multiplayer.getProfile({ username: safeUsername });
      const nextProfile = this.applyServerProfileSnapshot(serverProfile);
      if (nextProfile) {
        return nextProfile;
      }
    }

    if (this.isAuthenticatedOnlineProfileFlow(onlineState, safeUsername)) {
      return this.profile;
    }

    if (allowEnsureLocal && window.elemintz?.state?.ensureProfile) {
      this.profile = await window.elemintz.state.ensureProfile(safeUsername);
      return this.profile;
    }

    if (window.elemintz?.state?.getProfile) {
      this.profile = await window.elemintz.state.getProfile(safeUsername);
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
    } catch (error) {
      console.error("Failed to acknowledge loadout unlocks", error);
    }
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

    const openWithMultiplayer =
      this.hasMultiplayerProfileAccess() && globalThis.window?.elemintz?.multiplayer?.openChest;
    const openAuthority = openWithMultiplayer
      ? globalThis.window.elemintz.multiplayer.openChest
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
      this.setProfileChestVisualState(safeChestType, true);
      await this.showProfile();
      await delay(this.isReducedMotion() ? 0 : 220);

      const result = await openAuthority({
        username: this.username,
        chestType: safeChestType
      });

      this.profile = result?.snapshot
        ? this.buildProfileFromServerSnapshot(result.snapshot)
        : result?.profile ?? this.profile;
      this.emitChestOpenToast(result);
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

  emitChestOpenToast(result) {
    if (!result?.rewards) {
      return;
    }

    this.toastManager.showChestOpenReward?.({
      rewards: result.rewards
    });
  }

  async maybeShowMilestoneChestRewardNotice() {
    if (
      this.screenFlow !== "profile" ||
      this.profileMilestoneChestNoticeOpen ||
      !this.username ||
      !globalThis.window?.elemintz?.state?.acknowledgeMilestoneChestReward
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
                const result = await globalThis.window.elemintz.state.acknowledgeMilestoneChestReward({
                  username: this.username,
                  level: pendingLevel
                });
                this.profile = result?.profile ?? this.profile;
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
    const normalizedRoom = state?.room
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

    const fallback = {
      connectionStatus: "disconnected",
      socketId: null,
      room: null,
      latestRoundResult: null,
      pendingAdminGrantNotices: [],
      lastError: null,
      statusMessage: "Offline. Open Online Play to connect."
    };

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
        : null
    };
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
              await window.elemintz.multiplayer.confirmAdminGrantNotice({
                transactionId: notice.transactionId
              });
              this.modalManager.hide();
              this.dequeuePendingAdminGrantNotice(notice.transactionId);
              this.activeAdminGrantNoticeId = null;
              await this.syncOnlinePlayState();
              if (this.screenFlow === "profile") {
                await this.showProfile();
              } else if (this.screenFlow === "onlinePlay") {
                this.renderOnlinePlayScreen();
              }
              this.maybeShowPendingAdminGrantNotice();
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
        ? this.buildProfileFromServerSnapshot(serverProfile)
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

    if (!hasLatestRoundResult) {
      return nextState;
    }

    if (isSnapshotResync) {
      return nextState;
    }

    if (previousSubmittedCount >= 2 && nextSubmittedCount === 0) {
      console.info("[OnlinePlay][Renderer] new round detected, clearing round result");
      return this.normalizeOnlinePlayState({
        ...nextState,
        latestRoundResult: null,
        latestAuthoritativeRoundResult: null
      });
    }

    if (previousSubmittedCount === 0 && nextSubmittedCount > 0) {
      console.info("[OnlinePlay][Renderer] new round detected, clearing round result");
      return this.normalizeOnlinePlayState({
        ...nextState,
        latestRoundResult: null,
        latestAuthoritativeRoundResult: null
      });
    }

    return nextState;
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
    const tauntHud = this.getCurrentTauntHudState();
    this.screenManager.show("onlinePlay", {
      multiplayer: this.normalizeOnlinePlayState(this.onlinePlayState),
      onlineChallengeSummary: this.onlinePlayChallengeSummary,
      profile: this.profile,
      username: this.profile?.username ?? this.username,
      joinCode: this.onlinePlayJoinCode,
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
            await window.elemintz.multiplayer.createRoom(identityPayload)
          );
          this.ensureOnlineReconnectUiTimer();
          this.renderOnlinePlayScreen();
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
          this.clearOnlineReconnectReminderFromState(this.onlinePlayState);
          this.ensureOnlineReconnectUiTimer();
          this.renderOnlinePlayScreen();
        },
        submitMove: async (move) => {
          if (!window.elemintz?.multiplayer?.submitMove) {
            return;
          }

          console.info("[OnlinePlay][Renderer] AppController submitMove entered", {
            move
          });
          const previousState = this.onlinePlayState;
          const nextState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.submitMove({ move }));
          this.onlinePlayState = this.reconcileOnlinePlayRoundState(previousState, nextState);
          if (this.onlinePlayState?.latestRoundResult) {
            console.info("[OnlinePlay][Renderer] latest round result stored in renderer state", this.onlinePlayState.latestRoundResult);
          }
          if (this.onlinePlayState?.room?.matchComplete) {
            await this.refreshOnlineSettlementStateFromServer(this.onlinePlayState);
          }
          this.ensureOnlineReconnectUiTimer();
          this.renderOnlinePlayScreen();
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

          const previousState = this.onlinePlayState;
          const nextState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.readyRematch());
          this.onlinePlayState = this.reconcileOnlinePlayRoundState(previousState, nextState);
          this.ensureOnlineReconnectUiTimer();
          this.renderOnlinePlayScreen();
        },
        back: async () => {
          if (window.elemintz?.multiplayer?.disconnect) {
            await window.elemintz.multiplayer.disconnect();
          }

          this.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
        }
      }
    });
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
        xp: reward.rewardXp ?? 0
      });

      const totalTokens =
        Math.max(0, Number(reward.rewardTokens ?? 0)) +
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
          chestLabel: this.getChestLabel(chestType)
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

    return `Last Round: ${resultLabel}. Captured ${vm.lastRound.capturedCards} card(s).`;
  }

  getResolvedOpponentCardsCaptured(round) {
    const explicit = Number(round?.capturedOpponentCards);
    if (Number.isFinite(explicit) && explicit >= 0) {
      return explicit;
    }

    return Math.max(0, Math.floor(Number(round?.capturedCards ?? 0) / 2));
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

    const capturedOpponentCards = this.getResolvedOpponentCardsCaptured(round);
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
      summary: `${warPrefix}${winnerLabel} captured ${capturedOpponentCards} opponent card(s).`
    };
  }

  async showSharedResolutionPopup(result, mode = MATCH_MODE.PVE, { onShown = null } = {}) {
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

  buildMatchCompleteModalPayload(mode, match, finalPersisted) {
    const names = this.getLocalNames();
    const roundsPlayed = Array.isArray(match?.history) ? match.history.length : 0;
    const safeValue = (value) => (value ?? "-");
    const isLocalPvp = mode === MATCH_MODE.LOCAL_PVP;

    const leftName = isLocalPvp ? names.p1 : (this.profile?.username ?? this.username ?? "Player");
    const rightName = isLocalPvp ? names.p2 : "Elemental AI";

    const leftStats = isLocalPvp ? finalPersisted?.p1?.stats : finalPersisted?.stats;
    const rightStats = isLocalPvp ? finalPersisted?.p2?.stats : null;
    const leftDerivedStats = this.getMatchPerspectiveStats(match, "p1");
    const rightDerivedStats = this.getMatchPerspectiveStats(match, "p2");

    const leftCaptured = isLocalPvp
      ? safeValue(leftStats?.cardsCaptured)
      : safeValue(leftDerivedStats?.cardsCaptured);
    const rightCaptured = isLocalPvp
      ? safeValue(rightStats?.cardsCaptured)
      : safeValue(rightDerivedStats?.cardsCaptured);

    const warsEntered = isLocalPvp
      ? `${safeValue(leftStats?.warsEntered)} | ${safeValue(rightStats?.warsEntered)}`
      : safeValue(leftStats?.warsEntered);
    const longestWar = isLocalPvp
      ? `${safeValue(leftStats?.longestWar)} | ${safeValue(rightStats?.longestWar)}`
      : safeValue(leftStats?.longestWar);

    const outcomeLabel =
      match.winner === "draw"
        ? "Draw"
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
        : `${escapeHtml(match.winner === "p1" ? leftName : rightName)} defeated ${escapeHtml(match.winner === "p1" ? rightName : leftName)}.`;

    const bodyHtml = `
      <section class="match-complete-modal ${outcomeClass}">
        <header class="match-complete-hero">
          <p class="match-complete-kicker">Match Complete</p>
          <h4 class="match-complete-outcome">${outcomeLabel}</h4>
          <p class="match-complete-subtitle">${outcomeSubtitle}</p>
          <p class="match-complete-captured">${escapeHtml(leftName)} • ${leftCaptured} | ${escapeHtml(rightName)} • ${rightCaptured}</p>
        </header>

        <section class="match-complete-stats">
          <div class="match-complete-stat">
            <span class="match-complete-stat-label">Captures</span>
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
        </section>

        <section class="match-complete-meta">
          <p><strong>Mode:</strong> ${escapeHtml(mode)}</p>
          <p><strong>End Reason:</strong> ${escapeHtml(match.endReason ?? "normal")}</p>
        </section>

        <div class="match-complete-actions">
          <button id="match-complete-play-again" class="btn btn-primary">Play Again</button>
          <button id="match-complete-return-menu" class="btn">Return to Menu</button>
        </div>
      </section>
    `;

    return { title: "Match Complete", bodyHtml, mode };
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
      this.startGame(payload.mode ?? MATCH_MODE.PVE);
    });

    document.getElementById("match-complete-return-menu")?.addEventListener("click", async () => {
      this.modalManager.hide();
      this.showMenu();
      await this.refreshDailyChallengesForMenu();
    });
  }

  flushPendingMatchCompleteModal() {
    if (!this.pendingMatchCompletePayload) {
      return;
    }

    const payload = this.pendingMatchCompletePayload;
    this.pendingMatchCompletePayload = null;
    this.showMatchCompleteModal(payload);
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
        this.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: true });
        return;
      }
      const restoreFailureMessage =
        restoreResult?.invalid
          ? (restoreResult?.error?.message ?? "Saved session expired. Please sign in again.")
          : "";
      this.showLogin({
        ...(restoreFailureMessage ? { statusMessage: restoreFailureMessage } : {})
      });
    })();

    return this.initPromise;
  }

  showLogin({ errorMessage = "", statusMessage = "", defaults = {}, mode = "login" } = {}) {
    this.clearPassTimer();
    this.screenFlow = "login";
    this.screenManager.show("login", {
      errorMessage,
      statusMessage,
      defaults,
      mode,
      actions: {
        login: async (request) => {
          let username = "";
          let email = "";
          let mode = "login";
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

            if (mode === "login" || mode === "register") {
              const authAction =
                mode === "register"
                  ? window.elemintz?.multiplayer?.register
                  : window.elemintz?.multiplayer?.login;
              if (typeof authAction !== "function") {
                throw new Error("Online account authentication is unavailable.");
              }

              const authResult = await authAction({
                username,
                email,
                password
              });
              if (!authResult?.ok) {
                throw new Error(authResult?.error?.message ?? "Unable to authenticate this account.");
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
            this.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: true });
          } catch (err) {
            console.error("LOGIN ERROR:", err);
            console.error("STACK:", err?.stack);
            this.showLogin({
              errorMessage: String(err?.message ?? "Unable to load profile. Check console for details and try again."),
              defaults: {
                username,
                email
              },
              mode: mode === "register" ? "register" : "login"
            });
          }
        }
      }
    });
  }

  showMenu({ autoClaimDailyLogin = true, showDailyLoginToasts = true } = {}) {
    this.clearPassTimer();
    this.clearTransientUiBeforeScreenTransition();
    this.screenFlow = "menu";
    this.localPlayers = null;
    this.localProfiles = null;

    this.renderMenuScreen();
    this.updateOnlineReconnectReminderModal();
    this.refreshDailyChallengesForMenu();
    Promise.resolve().then(() => this.releaseQueuedAdminGrantNotice(this.onlinePlayState));
    Promise.resolve().then(() => this.maybeShowLoadoutUnlockNotice());

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

          return this.refreshDailyChallengesForMenu();
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
  }

  showLocalSetup({ errorMessage = "", setupDefaults = null } = {}) {
    this.clearTransientUiBeforeScreenTransition();
    this.screenFlow = "localSetup";
    const playerOneDefaults = setupDefaults?.p1 ?? null;
    const playerTwoDefaults = setupDefaults?.p2 ?? null;
    this.screenManager.show("localSetup", {
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

            this.startGame(MATCH_MODE.LOCAL_PVP);
          } catch (error) {
            this.showLocalSetup({
              errorMessage: String(error?.message ?? "Both players must authenticate before starting Local 2-Player."),
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

    const persistFor = async (username, perspective) => {
      try {
        return await window.elemintz.state.recordMatchResult({ username, perspective, matchState: match });
      } catch (error) {
        console.error("Failed to persist local profile", { username, perspective, error });
        return null;
      }
    };

    // Commit local PvP results sequentially to avoid stale read-modify-write overlap.
    const p1Result = await persistFor(names.p1, "p1");
    const p2Result = await persistFor(names.p2, "p2");

    return {
      mode: MATCH_MODE.LOCAL_PVP,
      p1Name: names.p1,
      p2Name: names.p2,
      p1: p1Result,
      p2: p2Result
    };
  }

  startGame(mode = MATCH_MODE.PVE) {
    this.clearPassTimer();
    this.gameController?.stopTimer();
    this.gameController?.stopMatchClock();
    this.pendingMatchCompletePayload = null;
    this.pveOpponentStyle = mode === MATCH_MODE.PVE ? this.buildPveOpponentStyle() : null;
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
      aiDifficulty: mode === MATCH_MODE.PVE ? this.getConfiguredAiDifficulty() : FALLBACK_SETTINGS.aiDifficulty,
      mode,
      persistMatchResults: mode !== MATCH_MODE.LOCAL_PVP,
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
        const previousPveProfile = this.profile ? { ...this.profile } : null;
        const previousLocalProfiles = this.localProfiles
          ? {
              p1: this.localProfiles.p1 ? { ...this.localProfiles.p1 } : null,
              p2: this.localProfiles.p2 ? { ...this.localProfiles.p2 } : null
            }
          : null;

        let finalPersisted = persisted;
        if (mode === MATCH_MODE.LOCAL_PVP) {
          finalPersisted = await this.persistLocalPvpResult(match);
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
        const modalPayload = this.buildMatchCompleteModalPayload(mode, match, finalPersisted);
        if (this.roundPresentation.busy || this.screenFlow === "pass") {
          this.pendingMatchCompletePayload = modalPayload;
          return;
        }

        this.showMatchCompleteModal(modalPayload);
      }
    });

    if (mode === MATCH_MODE.LOCAL_PVP) {
      this.screenFlow = "pass";
    }

    this.gameController.startNewMatch();

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
    return {
      game: vm,
      hotseat: {
        enabled: vm.mode === MATCH_MODE.LOCAL_PVP,
        activePlayer: vm.mode === MATCH_MODE.LOCAL_PVP ? vm.hotseatTurn : "p1",
        p1Name: names.p1,
        p2Name: names.p2,
        turnLabel:
          vm.mode === MATCH_MODE.LOCAL_PVP
            ? `${vm.hotseatTurn === "p1" ? names.p1 : names.p2} Turn`
            : "Player Turn"
      },
      presentation: this.roundPresentation
    };
  }

  refreshActiveGameHudInPlace() {
    if (this.screenFlow !== "game" || typeof document?.querySelector !== "function") {
      return false;
    }

    const context = this.buildActiveGameRefreshContext();
    if (!context) {
      return false;
    }

    const root = document.querySelector(".screen-game");
    const hudLine = document.getElementById?.("game-hud-primary-line") ?? null;
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
        this.enterHotseatTurn();
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
    const p1Profile = localPvp ? this.localProfiles?.p1 : this.profile;
    const p2Profile = localPvp ? this.localProfiles?.p2 : null;
    const pveOpponentStyle = localPvp ? null : this.resolvePveOpponentStyle();

    const playerDisplay = this.buildPlayerDisplay(p1Profile, names.p1, "Initiate");
    const opponentDisplay = localPvp
      ? this.buildPlayerDisplay(p2Profile, names.p2, "Initiate")
      : this.resolveIdentityDisplay({
          name: "Elemental AI",
          fallbackName: "Elemental AI",
          avatarId: pveOpponentStyle?.avatarId ?? "default_avatar",
          titleId: pveOpponentStyle?.titleId ?? null,
          badgeId: pveOpponentStyle?.badgeId ?? "none",
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

    this.screenManager.show("game", {
      game: vm,
      arenaBackground: this.getBackgroundFromProfile(backgroundProfile),
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
        p2Name: names.p2,
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
    this.ensureMatchTauntUiTimer();
  }

  async showProfile({ preserveModal = false } = {}) {
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "profile";
    const serverProfile = this.hasMultiplayerProfileAccess()
      ? await window.elemintz.multiplayer.getProfile({ username: this.username })
      : null;
    const localProfile = this.isAuthenticatedOnlineProfileFlow()
      ? this.profile ?? null
      : await window.elemintz.state.getProfile(this.username);
    this.profile = this.mergeServerOwnedProfileDomains(localProfile, serverProfile);
    const achievementCatalog = this.buildAchievementCatalogForProfile(this.profile);
    const cosmetics =
      this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.getCosmetics
        ? await window.elemintz.multiplayer.getCosmetics({ username: this.username })
        : await window.elemintz.state.getCosmetics(this.username);
    if (serverProfile?.progression?.xp || window.elemintz.state.getDailyChallenges) {
      const challengeStatus = serverProfile
        ? { xp: serverProfile.progression?.xp ?? null }
        : await window.elemintz.state.getDailyChallenges(this.username);
      this.profile = {
        ...this.profile,
        ...(challengeStatus?.xp ?? {})
      };
    }
    const query = this.profileSearchQuery.trim().toLowerCase();
    const searchResults = query
      ? (await window.elemintz.state.listProfiles())
          .filter((item) => item.username.toLowerCase().includes(query))
          .slice(0, 8)
      : [];

    const viewedProfile = this.viewedProfileUsername
      ? await window.elemintz.state.getProfile(this.viewedProfileUsername)
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
        searchResults,
        viewedProfile,
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
          await this.showProfile();
        },
        searchProfiles: async (queryValue) => {
          this.profileSearchQuery = queryValue;
          this.viewedProfileUsername = null;
          await this.showProfile();
        },
        viewProfile: async (username) => {
          this.viewedProfileUsername = username;
          await this.showProfile();
        },
        clearViewed: async () => {
          this.viewedProfileUsername = null;
          await this.showProfile();
        },
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
    Promise.resolve().then(() => this.maybeShowMilestoneChestRewardNotice());
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
      achievements,
      actions: {
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  async showCosmetics({ preserveModal = false } = {}) {
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "cosmetics";
    const cosmetics =
      this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.getCosmetics
        ? await window.elemintz.multiplayer.getCosmetics({ username: this.username })
        : await window.elemintz.state.getCosmetics(this.username);
    const viewState = this.ensureCosmeticsViewState();

    this.screenManager.show("cosmetics", {
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
          await this.showCosmetics();
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
          await this.showCosmetics();
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
          await this.showCosmetics();
        },
        saveLoadout: async (slotIndex) => {
          const slot = cosmetics.loadouts?.[slotIndex] ?? null;
          const runSave = async () => {
            const result =
              this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.saveCosmeticLoadout
                ? await window.elemintz.multiplayer.saveCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  })
                : await window.elemintz.state.saveCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  });
            this.profile = result?.snapshot
              ? this.buildProfileFromServerSnapshot(result.snapshot)
              : result.profile;
            await this.showCosmetics();
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
            const result =
              this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.applyCosmeticLoadout
                ? await window.elemintz.multiplayer.applyCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  })
                : await window.elemintz.state.applyCosmeticLoadout({
                    username: this.username,
                    slotIndex
                  });
            this.profile = result?.snapshot
              ? this.buildProfileFromServerSnapshot(result.snapshot)
              : result.profile;
            await this.showCosmetics();
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
            const result =
              this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.renameCosmeticLoadout
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
            this.profile = result?.snapshot
              ? this.buildProfileFromServerSnapshot(result.snapshot)
              : result.profile;
            await this.showCosmetics();
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

  async showStore({ preserveModal = false } = {}) {
    this.clearTransientUiBeforeScreenTransition({ preserveModal });
    this.screenFlow = "store";
    const viewState = this.ensureStoreViewState();
    const serverProfile = this.hasMultiplayerProfileAccess()
      ? await window.elemintz.multiplayer.getProfile({ username: this.username })
      : null;
    const store = serverProfile
      ? getStoreViewForProfile(
          this.buildProfileFromServerSnapshot(serverProfile) ?? serverProfile.profile ?? this.profile ?? {}
        )
      : await window.elemintz.state.getStore(this.username);
    let purchaseConfirmOpen = false;
    let purchasePending = false;

    this.screenManager.show("store", {
      store,
      viewState,
      actions: {
        buy: async (type, cosmeticId) => {
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

              if (result?.purchase?.status === "already-owned") {
                this.modalManager.show({
                  title: "Already Owned",
                  body: "That store item is already owned on your profile.",
                  actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
                });
                await this.showStore({ preserveModal: true });
                return;
              }

              await this.showStore();
            } catch (error) {
              this.modalManager.show({
                title: "Purchase Failed",
                body: String(error?.message ?? "Unable to complete this store purchase."),
                actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
              });
            }
            return;
          }

          this.showLegacyLocalAuthorityDisabledModal(
            "Local store purchases are unavailable while duplicate offline progression systems are being removed."
          );
        },
        equip: async (type, cosmeticId) => {
          const result =
            this.hasMultiplayerProfileAccess() && window.elemintz?.multiplayer?.equipCosmetic
              ? await window.elemintz.multiplayer.equipCosmetic({ username: this.username, type, cosmeticId })
              : await window.elemintz.state.equipCosmetic({ username: this.username, type, cosmeticId });
          this.profile = result?.snapshot
            ? this.buildProfileFromServerSnapshot(result.snapshot)
            : result.profile;
          await this.showStore();
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
}




















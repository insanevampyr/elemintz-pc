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
import { getArenaBackground, getAvatarImage, getBadgeImage, getCardBackImage, getVariantCardImages } from "../utils/assets.js";
import { escapeHtml, getAssetPath } from "../utils/dom.js";
import { GameController, MATCH_MODE } from "./gameController.js";
import { SoundManager } from "./soundManager.js";
import { COSMETIC_CATALOG, getCosmeticDefinition, getCosmeticDisplayName } from "../../state/cosmeticSystem.js";
import { createDefaultCategoryViewState } from "../ui/shared/cosmeticCategoryShared.js";

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
      basicOpen: false
    };
    this.onlinePlayState = null;
    this.onlinePlayJoinCode = "";
    this.onlinePlayUnsubscribe = null;
    this.onlinePlayChallengeSummary = null;
    this.onlinePlayChallengeSummaryKey = null;
    this.onlinePlayProfileRefreshKey = null;
    this.onlinePlayProfileRefreshPromise = null;
    this.onlineReconnectReminder = null;
    this.onlineReconnectReminderDismissedKey = null;
    this.onlineReconnectUiTimerId = null;
    this.storeViewState = this.createDefaultStoreViewState();
    this.cosmeticsViewState = createDefaultCategoryViewState();
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
      this.profile = reward.profile;
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
        logout: () => {
          this.resetDailyLoginAutoClaimGuard();
          this.username = null;
          this.profile = null;
          this.dailyChallenges = null;
          this.gameController?.stopTimer();
          this.gameController?.stopMatchClock();
          this.clearDailyCountdown();
          this.showLogin();
        }
      }
    });
  }

  async refreshDailyChallengesForMenu() {
    if (!this.username || !globalThis.window?.elemintz?.state?.getDailyChallenges) {
      return;
    }

    try {
      const result = await globalThis.window.elemintz.state.getDailyChallenges(this.username);
      this.dailyChallenges = { daily: result.daily, weekly: result.weekly, dailyLogin: result.dailyLogin };

      if (this.screenFlow === "menu") {
        this.renderMenuScreen();
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
          this.renderMenuScreen();
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
    return profile?.cosmetics?.background ?? profile?.equippedCosmetics?.background ?? "default_background";
  }

  getBackgroundFromProfile(profile) {
    return getArenaBackground(this.getBackgroundIdFromProfile(profile));
  }

  chooseOwnedBackgroundForNextMatch(profile) {
    const ownedBackgrounds = Array.isArray(profile?.ownedCosmetics?.background)
      ? profile.ownedCosmetics.background.filter(Boolean)
      : [];
    const currentBackground = this.getBackgroundIdFromProfile(profile);

    if (ownedBackgrounds.length === 0) {
      return currentBackground;
    }

    const nonRepeatingPool =
      ownedBackgrounds.length > 1
        ? ownedBackgrounds.filter((backgroundId) => backgroundId !== currentBackground)
        : ownedBackgrounds;
    const pool = nonRepeatingPool.length > 0 ? nonRepeatingPool : ownedBackgrounds;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index] ?? currentBackground;
  }

  async maybeRandomizeBackgroundAfterMatchFor(username, profile) {
    if (!username || !profile?.randomizeBackgroundEachMatch) {
      return profile;
    }

    const nextBackgroundId = this.chooseOwnedBackgroundForNextMatch(profile);
    const currentBackgroundId = this.getBackgroundIdFromProfile(profile);
    if (!nextBackgroundId || nextBackgroundId === currentBackgroundId) {
      return profile;
    }

    try {
      const result = await window.elemintz.state.equipCosmetic({
        username,
        type: "background",
        cosmeticId: nextBackgroundId
      });
      return result?.profile ?? profile;
    } catch (error) {
      console.error("Failed to randomize owned background after match", {
        username,
        nextBackgroundId,
        error
      });
      return profile;
    }
  }

  async applyPostMatchBackgroundRandomization(mode, finalPersisted) {
    if (mode === MATCH_MODE.LOCAL_PVP) {
      const names = this.getLocalNames();
      const p1Profile = finalPersisted?.p1?.profile ?? this.localProfiles?.p1 ?? null;
      const p2Profile = finalPersisted?.p2?.profile ?? this.localProfiles?.p2 ?? null;

      this.localProfiles = {
        p1: await this.maybeRandomizeBackgroundAfterMatchFor(names.p1, p1Profile),
        p2: await this.maybeRandomizeBackgroundAfterMatchFor(names.p2, p2Profile)
      };
      return;
    }

    const latestProfile = finalPersisted?.profile ?? this.profile;
    this.profile = await this.maybeRandomizeBackgroundAfterMatchFor(this.username, latestProfile);
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
      profile?.equippedCosmetics?.avatar ??
      profile?.cosmetics?.equipped?.avatar ??
      profile?.cosmetics?.avatar ??
      "default_avatar";
    const titleId =
      profile?.equippedCosmetics?.title ??
      profile?.cosmetics?.equipped?.title ??
      null;
    const badgeId =
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
    return profile?.cosmetics?.equipped?.[key] ??
      profile?.equippedCosmetics?.[key] ??
      profile?.cosmetics?.[key] ??
      (key === "title" ? profile?.title : undefined) ??
      fallback;
  }

  buildOnlineEquippedCosmetics(profile = null) {
    const equippedVariants =
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

  async buildOnlineRoomIdentityPayload() {
    let latestProfile = this.profile;

    if (this.username && window.elemintz?.state?.getProfile) {
      latestProfile = await window.elemintz.state.getProfile(this.username);
      if (latestProfile) {
        this.profile = latestProfile;
      }
    }

    return {
      username: this.username,
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

  getBasicChestCount(profile) {
    return Math.max(0, Number(profile?.chests?.basic ?? 0) || 0);
  }

  emitChestOpenToast(result) {
    if (!result?.rewards) {
      return;
    }

    this.toastManager.showChestOpenReward?.({
      rewards: result.rewards
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
              : null)
        }
      : null;

    const fallback = {
      connectionStatus: "disconnected",
      socketId: null,
      room: null,
      latestRoundResult: null,
      lastError: null,
      statusMessage: "Offline. Open Online Play to connect."
    };

    return {
      ...fallback,
      ...(state ?? {}),
      room: normalizedRoom
    };
  }

  deriveOnlineChallengeSummaryKey(state) {
    const settlementKey = this.deriveOnlineSettlementRefreshKey(state);
    return settlementKey ? `${settlementKey}:challenges` : null;
  }

  deriveOnlineSettlementRefreshKey(state) {
    const room = state?.room;
    const summary = room?.rewardSettlement?.summary;
    const username = String(this.username ?? "").trim();

    if (!room?.matchComplete || !room?.rewardSettlement?.granted || !username) {
      return null;
    }

    if (summary?.settledHostUsername !== username && summary?.settledGuestUsername !== username) {
      return null;
    }

    return `${room.roomCode ?? "room"}:${room.rewardSettlement?.grantedAt ?? "settled"}:${username}`;
  }

  async refreshOnlinePlayChallengeSummary(state = this.onlinePlayState) {
    const summaryKey = this.deriveOnlineChallengeSummaryKey(state);

    if (!summaryKey) {
      return this.onlinePlayChallengeSummary;
    }

    if (this.onlinePlayChallengeSummaryKey === summaryKey && this.onlinePlayChallengeSummary) {
      return this.onlinePlayChallengeSummary;
    }

    if (!window.elemintz?.state?.getDailyChallenges || !this.username) {
      return null;
    }

    const result = await window.elemintz.state.getDailyChallenges(this.username);
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

    if (!window.elemintz?.state?.getProfile || !this.username) {
      return this.profile;
    }

    this.onlinePlayProfileRefreshKey = refreshKey;
    this.onlinePlayProfileRefreshPromise = (async () => {
      const nextProfile = await window.elemintz.state.getProfile(this.username);
      if (nextProfile) {
        this.profile = nextProfile;
      }

      const providedChallengeStatus =
        options?.challengeStatus && (options.challengeStatus.daily || options.challengeStatus.weekly)
          ? options.challengeStatus
          : null;

      if (providedChallengeStatus || window.elemintz?.state?.getDailyChallenges) {
        const challengeStatus =
          providedChallengeStatus ?? await window.elemintz.state.getDailyChallenges(this.username);
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

    if (!hasLatestRoundResult) {
      return nextState;
    }

    if (previousSubmittedCount >= 2 && nextSubmittedCount === 0) {
      console.info("[OnlinePlay][Renderer] new round detected, clearing round result");
      return this.normalizeOnlinePlayState({
        ...nextState,
        latestRoundResult: null
      });
    }

    if (previousSubmittedCount === 0 && nextSubmittedCount > 0) {
      console.info("[OnlinePlay][Renderer] new round detected, clearing round result");
      return this.normalizeOnlinePlayState({
        ...nextState,
        latestRoundResult: null
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
      this.onlinePlayState = this.reconcileOnlinePlayRoundState(previousState, nextState);
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
      if (this.onlinePlayState?.room?.matchComplete) {
        void this.refreshOnlinePlayChallengeSummary(this.onlinePlayState)
          .then((challengeSummary) =>
            this.refreshLocalProfileAfterOnlineSettlement(this.onlinePlayState, {
              challengeStatus: challengeSummary
                ? {
                    daily: challengeSummary.daily ?? null,
                    weekly: challengeSummary.weekly ?? null,
                    dailyLogin: this.dailyChallenges?.dailyLogin ?? null
                  }
                : null
            })
          )
          .then(() => {
          if (this.screenFlow === "onlinePlay") {
            this.renderOnlinePlayScreen();
          }
        });
      }
    });
  }

  renderOnlinePlayScreen() {
    this.screenManager.show("onlinePlay", {
      multiplayer: this.normalizeOnlinePlayState(this.onlinePlayState),
      onlineChallengeSummary: this.onlinePlayChallengeSummary,
      profile: this.profile,
      username: this.username,
      joinCode: this.onlinePlayJoinCode,
      now: Date.now(),
      backgroundImage: this.getBackgroundFromProfile(this.profile),
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
            const challengeSummary = await this.refreshOnlinePlayChallengeSummary(this.onlinePlayState);
            await this.refreshLocalProfileAfterOnlineSettlement(this.onlinePlayState, {
              challengeStatus: challengeSummary
                ? {
                    daily: challengeSummary.daily ?? null,
                    weekly: challengeSummary.weekly ?? null,
                    dailyLogin: this.dailyChallenges?.dailyLogin ?? null
                  }
                : null
            });
          }
          this.ensureOnlineReconnectUiTimer();
          this.renderOnlinePlayScreen();
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
  }

  async claimDailyLoginRewardFor(username, { showToasts = false } = {}) {
    if (!username || !globalThis.window?.elemintz?.state?.claimDailyLoginReward) {
      console.info("[DailyLogin][Renderer] claim unavailable", {
        username,
        hasWindow: Boolean(globalThis.window),
        hasElemintz: Boolean(globalThis.window?.elemintz),
        hasState: Boolean(globalThis.window?.elemintz?.state),
        hasClaimMethod: Boolean(globalThis.window?.elemintz?.state?.claimDailyLoginReward)
      });
      return null;
    }

    console.info("[DailyLogin][Renderer] about to call claim", {
      username,
      showToasts
    });
    console.info("[DailyLogin][Renderer] request", {
      username,
      showToasts
    });
    const reward = await globalThis.window.elemintz.state.claimDailyLoginReward(username);
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
    if (!reward?.profile) {
      return reward;
    }

    if (this.username === username) {
      this.profile = reward.profile;
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

    const chestDelta = Math.max(
      0,
      this.getBasicChestCount(result.profile) - this.getBasicChestCount(previousProfile)
    );
    if (chestDelta > 0) {
      this.toastManager.showChestGrant?.({
        amount: chestDelta,
        chestLabel: "Basic Chest"
      });
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

    const leftCaptured = safeValue(leftStats?.cardsCaptured);
    const rightCaptured = isLocalPvp
      ? safeValue(rightStats?.cardsCaptured)
      : safeValue(
        match?.history
          ?.filter((round) => round?.result === "p2")
          .reduce((sum, round) => sum + this.getResolvedOpponentCardsCaptured(round), 0)
      );

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
      try {
        if (!window.elemintz?.state) {
          throw new Error("Preload API unavailable: window.elemintz.state is undefined");
        }

        this.bindOnlinePlayUpdates();
        this.settings = await window.elemintz.state.getSettings();
        await this.syncOnlinePlayState();
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
      this.showLogin();
    })();

    return this.initPromise;
  }

  showLogin() {
    this.clearPassTimer();
    this.screenFlow = "login";
    this.screenManager.show("login", {
      actions: {
        login: async (username) => {
          try {
            this.resetDailyLoginAutoClaimGuard();
            this.username = username;
            this.profile = await window.elemintz.state.ensureProfile(username);
            await this.ensureDailyLoginAutoClaim({
              showToasts: true,
              requestKey: `login:${username}`
            });
            this.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: true });
          } catch (err) {
            console.error("LOGIN ERROR:", err);
            console.error("STACK:", err?.stack);
            this.modalManager.show({
              title: "Login Failed",
              body: "Unable to load profile. Check console for details and try again.",
              actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
            });
          }
        }
      }
    });
  }

  showMenu({ autoClaimDailyLogin = true, showDailyLoginToasts = true } = {}) {
    this.clearPassTimer();
    this.screenFlow = "menu";
    this.localPlayers = null;
    this.localProfiles = null;

    this.renderMenuScreen();
    this.updateOnlineReconnectReminderModal();
    this.refreshDailyChallengesForMenu();
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
    this.screenFlow = "onlinePlay";
    await this.syncOnlinePlayState();
    await this.refreshOnlinePlayChallengeSummary(this.onlinePlayState);
    this.ensureOnlineReconnectUiTimer();
    this.renderOnlinePlayScreen();

    if (!window.elemintz?.multiplayer?.connect) {
      return;
    }

    this.onlinePlayState = this.normalizeOnlinePlayState(await window.elemintz.multiplayer.connect());
    await this.refreshOnlinePlayChallengeSummary(this.onlinePlayState);
    this.ensureOnlineReconnectUiTimer();
    this.renderOnlinePlayScreen();
  }

  showLocalSetup() {
    this.screenFlow = "localSetup";
    this.screenManager.show("localSetup", {
      defaultNames: {
        p1: this.username,
        p2: ""
      },
      actions: {
        start: async (p1Name, p2Name) => {
          const normalizedP1 = normalizeName(p1Name, "Player 1");
          const normalizedP2 = normalizeName(p2Name, "Player 2");

          this.localPlayers = { p1: normalizedP1, p2: normalizedP2 };
          const [p1Profile, p2Profile] = await Promise.all([
            window.elemintz.state.ensureProfile(normalizedP1),
            window.elemintz.state.ensureProfile(normalizedP2)
          ]);
          const [p1Reward, p2Reward] = await Promise.all([
            this.claimDailyLoginRewardFor(normalizedP1, { showToasts: false }),
            this.claimDailyLoginRewardFor(normalizedP2, { showToasts: false })
          ]);
          this.localProfiles = {
            p1: p1Reward?.profile ?? p1Profile,
            p2: p2Reward?.profile ?? p2Profile
          };

          this.startGame(MATCH_MODE.LOCAL_PVP);
        },
        back: () => this.showMenu()
      }
    });
  }

  handleGameUpdate() {
    if (!this.gameController || this.screenFlow === "pass") {
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

    this.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };
    this.screenFlow = "idle";

    this.gameController = new GameController({
      username: mode === MATCH_MODE.LOCAL_PVP ? this.getLocalNames().p1 : this.username,
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

        await this.applyPostMatchBackgroundRandomization(mode, finalPersisted);

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

    this.roundPresentation = {
      phase: "idle",
      busy: true,
      selectedCardIndex: null
    };
    await this.showSharedResolutionPopup(result, MATCH_MODE.LOCAL_PVP);

    this.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };
    this.screenFlow = "idle";

    if (this.gameController.getViewModel()?.status === "active") {
      await this.showPlayer1TurnPass(false);
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
    const deferredOutcomeRound = this.deferredPveRoundSound;
    this.deferPveOutcomeSound = false;
    this.deferredPveRoundSound = null;
    if (result?.status === "war_continues" || result?.status === "resolved") {
      const playedReveal = this.playRoundRevealSounds(result, MATCH_MODE.PVE, { warWasActive });
      await this.waitForRevealSoundSpacing(playedReveal);
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
    }

    this.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };
    this.screenFlow = "idle";

    if (this.gameController.getViewModel()?.status === "active") {
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

    this.screenFlow = "game";

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
      actions: {
        playCard: async (nextCardIndex) => this.handleGameCardSelection(nextCardIndex),
        backToMenu: async () => this.quitCurrentMatch()
      }
    });
  }

  async showProfile() {
    this.screenFlow = "profile";
    this.profile = await window.elemintz.state.getProfile(this.username);
    const cosmetics = await window.elemintz.state.getCosmetics(this.username);
    if (window.elemintz.state.getDailyChallenges) {
      const challengeStatus = await window.elemintz.state.getDailyChallenges(this.username);
      this.profile = {
        ...this.profile,
        ...(challengeStatus.xp ?? {})
      };
    }
    const allProfiles = await window.elemintz.state.listProfiles();

    const query = this.profileSearchQuery.trim().toLowerCase();
    const searchResults = query
      ? allProfiles.filter((item) => item.username.toLowerCase().includes(query)).slice(0, 8)
      : [];

    const viewedProfile = this.viewedProfileUsername
      ? await window.elemintz.state.getProfile(this.viewedProfileUsername)
      : null;

    this.screenManager.show("profile", {
      profile: this.profile,
      titleIcon: TITLE_ICON_MAP[this.resolveTitleLabel(this.profile)]
        ? getAssetPath(TITLE_ICON_MAP[this.resolveTitleLabel(this.profile)])
        : null,
      cosmetics,
      backgroundImage: this.getBackgroundFromProfile(this.profile),
      basicChestVisualState: this.profileChestVisualState,
      searchQuery: this.profileSearchQuery,
      searchResults,
      viewedProfile,
      actions: {
        openBasicChest: async () => {
          if (this.getBasicChestCount(this.profile) <= 0) {
            return;
          }

          try {
            this.profileChestVisualState = {
              ...this.profileChestVisualState,
              basicOpen: true
            };
            await this.showProfile();
            await delay(400);

            const result = await window.elemintz.state.openChest({
              username: this.username,
              chestType: "basic"
            });
            this.profile = result.profile ?? this.profile;
            this.emitChestOpenToast(result);
            this.profileChestVisualState = {
              ...this.profileChestVisualState,
              basicOpen: false
            };
            await this.showProfile();
          } catch (error) {
            this.profileChestVisualState = {
              ...this.profileChestVisualState,
              basicOpen: false
            };
            await this.showProfile();
            this.modalManager.show({
              title: "Chest Unavailable",
              body: String(error?.message ?? "Unable to open Basic Chest."),
              actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
            });
          }
        },
        equip: async (type, cosmeticId) => {
          const result = await window.elemintz.state.equipCosmetic({ username: this.username, type, cosmeticId });
          this.profile = result.profile;
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
  }

  async showDailyChallenges() {
    this.screenFlow = "dailyChallenges";
    const result = await window.elemintz.state.getDailyChallenges(this.username);
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
    this.screenFlow = "achievements";
    const result = await window.elemintz.state.getAchievements(this.username);

    this.screenManager.show("achievements", {
      achievements: result.achievements,
      actions: {
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  async showCosmetics() {
    this.screenFlow = "cosmetics";
    const cosmetics = await window.elemintz.state.getCosmetics(this.username);
    const viewState = this.ensureCosmeticsViewState();

    this.screenManager.show("cosmetics", {
      cosmetics,
      viewState,
      actions: {
        equip: async (type, cosmeticId) => {
          const result = await window.elemintz.state.equipCosmetic({ username: this.username, type, cosmeticId });
          this.profile = result.profile;
          await this.showCosmetics();
        },
        toggleBackgroundRandomization: async (enabled) => {
          const result = await window.elemintz.state.updateCosmeticPreferences({
            username: this.username,
            patch: {
              randomizeBackgroundEachMatch: Boolean(enabled)
            }
          });
          this.profile = result.profile;
          await this.showCosmetics();
        },
        saveLoadout: async (slotIndex) => {
          const slot = cosmetics.loadouts?.[slotIndex] ?? null;
          const runSave = async () => {
            const result = await window.elemintz.state.saveCosmeticLoadout({
              username: this.username,
              slotIndex
            });
            this.profile = result.profile;
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
            const result = await window.elemintz.state.applyCosmeticLoadout({
              username: this.username,
              slotIndex
            });
            this.profile = result.profile;
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
            const result = await window.elemintz.state.renameCosmeticLoadout({
              username: this.username,
              slotIndex,
              name
            });
            this.profile = result.profile;
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

  async showStore() {
    this.screenFlow = "store";
    const viewState = this.ensureStoreViewState();
    const store = await window.elemintz.state.getStore(this.username);
    let purchaseConfirmOpen = false;
    let purchasePending = false;

    this.screenManager.show("store", {
      store,
      viewState,
      actions: {
        buy: async (type, cosmeticId) => {
          if (purchaseConfirmOpen || purchasePending) {
            return;
          }

          const item = store?.catalog?.[type]?.find((entry) => entry.id === cosmeticId);
          const price = Number(item?.price ?? 0);
          purchaseConfirmOpen = true;

          this.modalManager.show({
            title: "Confirm Purchase",
            body: `Buy this item for ${price} tokens?`,
            actions: [
              {
                label: "Yes",
                onClick: async () => {
                  if (purchasePending) {
                    return;
                  }

                  purchaseConfirmOpen = false;
                  purchasePending = true;
                  this.modalManager.hide();

                  try {
                    const result = await window.elemintz.state.buyStoreItem({ username: this.username, type, cosmeticId });
                    this.profile = result.profile;
                    await this.showStore();
                  } catch (error) {
                    this.modalManager.show({
                      title: "Purchase Failed",
                      body: String(error?.message ?? "Unable to complete purchase."),
                      actions: [{ label: "OK", onClick: () => this.modalManager.hide() }]
                    });
                  } finally {
                    purchasePending = false;
                  }
                }
              },
              {
                label: "No",
                onClick: () => {
                  purchaseConfirmOpen = false;
                  this.modalManager.hide();
                }
              }
            ]
          });
        },
        equip: async (type, cosmeticId) => {
          const result = await window.elemintz.state.equipCosmetic({ username: this.username, type, cosmeticId });
          this.profile = result.profile;
          await this.showStore();
        },
        activateSupporter: async () => {
          const result = await window.elemintz.state.grantSupporterPass(this.username);
          this.profile = result.profile;
          await this.showStore();
        },
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }

  async showSettings() {
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
          this.showSettings();
        },
        back: () => this.showMenu()
      }
    });
    this.updateOnlineReconnectReminderModal();
  }
}




















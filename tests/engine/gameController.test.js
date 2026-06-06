import test from "node:test";
import assert from "node:assert/strict";

import { GameController, MATCH_MODE } from "../../src/renderer/systems/gameController.js";
import { AppController } from "../../src/renderer/systems/appController.js";
import { getUpdateSafetyState, isSafeForUpdateRestart } from "../../src/renderer/systems/updateSafety.js";
import { WAR_REQUIRED_CARDS } from "../../src/engine/index.js";
import { buildOnlineMatchStateFromRoom } from "../../src/multiplayer/foundation.js";
import { createRoomStore } from "../../src/multiplayer/rooms.js";
import { buildAchievementCatalog } from "../../src/state/achievementSystem.js";
import { deriveMatchStats } from "../../src/state/statsTracking.js";

function canonicalizeUsername(username) {
  const value = String(username ?? "").trim();
  return value.endsWith("-Canonical") ? value : `${value}-Canonical`;
}

function createMinimalMatch(mode = "pve") {
  return {
    id: "match-test",
    status: "active",
    round: 0,
    mode,
    difficulty: "hard",
    winner: null,
    currentPile: [],
    players: {
      p1: { hand: ["fire", "wind"], wonRounds: 0 },
      p2: { hand: ["earth", "water"], wonRounds: 0 }
    },
    war: {
      active: false,
      clashes: 0
    },
    history: [],
    meta: {
      totalCards: 4
    }
  };
}

function findCardIndexByElement(hand, element) {
  return Array.isArray(hand) ? hand.findIndex((card) => card === element) : -1;
}

function createAuthoritativeLocalRoom({
  roomCode = "ABC123",
  roundNumber = 1,
  matchComplete = false,
  winner = null,
  winReason = null,
  hostHand = { fire: 2, water: 2, earth: 2, wind: 2 },
  guestHand = { fire: 2, water: 2, earth: 2, wind: 2 },
  warActive = false,
  warRounds = [],
  warPot = { host: [], guest: [] },
  roundHistory = []
} = {}) {
  return {
    roomCode,
    status: "full",
    matchComplete,
    winner,
    winReason,
    roundNumber,
    hostHand,
    guestHand,
    warActive,
    warRounds,
    warPot,
    roundHistory,
    serverMatchState: {
      matchId: `${roomCode}:match:1`
    }
  };
}

function createAuthoritativePveStore({
  initialRoom = createAuthoritativeLocalRoom(),
  createRoom,
  joinRoom,
  submitMove,
  completeMatchByCardCount,
  completeMatch
} = {}) {
  return {
    createRoom:
      createRoom ??
      (() => ({ ok: true, room: initialRoom })),
    joinRoom:
      joinRoom ??
      (() => ({
        ok: true,
        room: {
          ...initialRoom,
          guest: {
            username: "EleMintz AI",
            bot: true,
            aiDifficulty: "normal"
          }
        }
      })),
    submitMove,
    completeMatchByCardCount,
    completeMatch
  };
}

function createOnlineSoundState({
  socketId = "guest-1",
  sessionUsername = "SignedInUser",
  roomOverrides = {},
  latestRoundResult = null,
  latestAuthoritativeRoundResult = null
} = {}) {
  return {
    connectionStatus: "connected",
    socketId,
    session: {
      authenticated: true,
      username: sessionUsername
    },
    room: {
      roomCode: "ABC123",
      status: "full",
      host: { socketId: "host-1", username: "HostUser" },
      guest: { socketId: "guest-1", username: "SignedInUser" },
      hostScore: 0,
      guestScore: 0,
      roundNumber: 2,
      lastOutcomeType: "resolved",
      warActive: false,
      warDepth: 0,
      warRounds: [],
      roundHistory: [],
      moveSync: {
        hostSubmitted: true,
        guestSubmitted: true,
        submittedCount: 2,
        bothSubmitted: true,
        updatedAt: "2026-03-19T12:00:05.000Z"
      },
      ...roomOverrides
    },
    latestRoundResult,
    latestAuthoritativeRoundResult,
    lastError: null,
    statusMessage: ""
  };
}

function createUpdateSafetyController() {
  return new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {}, clearStaleOverlay: () => false },
    toastManager: { show: () => {} }
  });
}

function createModalCapture() {
  const shows = [];
  return {
    shows,
    hidden: 0,
    show(config) {
      shows.push(config);
    },
    hide() {
      this.hidden += 1;
    },
    clearStaleOverlay() {
      return false;
    }
  };
}

function createFakeDomElement(overrides = {}) {
  const listeners = new Map();
  return {
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    textContent: "",
    innerHTML: "",
    listeners,
    addEventListener: (type, handler) => listeners.set(type, handler),
    ...overrides
  };
}

function createMockUpdateBridge(initialState = {}) {
  let listener = null;
  const requestCheckResponses = Array.isArray(initialState.requestCheckResponses)
    ? [...initialState.requestCheckResponses]
    : [];
  const calls = {
    requestCheck: 0,
    requestInstall: 0,
    reportPromptEvent: [],
    devMarkDownloaded: 0,
    requestInstallWhenSafe: 0,
    cancelDeferredInstall: 0,
    quitAndInstall: 0
  };
  let state = {
    status: "idle",
    message: "",
    error: null,
    updateInfo: null,
    downloadProgress: null,
    restartRequested: false,
    deferredUntilSafe: false,
    lastCheckedAt: null,
    updatedAt: "2026-05-06T12:00:00.000Z",
    ...initialState
  };
  delete state.requestCheckResponses;

  const emit = () => {
    if (typeof listener === "function") {
      listener({ ...state });
    }
  };

  return {
    calls,
    getState: async () => ({ ...state }),
    onStateChanged(nextListener) {
      listener = nextListener;
      return () => {
        if (listener === nextListener) {
          listener = null;
        }
      };
    },
    async requestCheck() {
      calls.requestCheck += 1;
      const nextResponse = requestCheckResponses.shift() ?? {
        status: state.status === "idle" ? "checking" : state.status,
        message: "Manual update check requested."
      };
      state = {
        ...state,
        ...nextResponse,
        updatedAt: "2026-05-06T12:00:30.000Z"
      };
      emit();
      return { ...state };
    },
    async requestInstall(safetyState) {
      calls.requestInstall += 1;
      const safe = Boolean(safetyState?.safe);
      if (!["downloaded", "deferred", "readyToInstall"].includes(state.status)) {
        state = {
          ...state,
          status: "error",
          message: "No downloaded update is ready to install.",
          error: { message: "No downloaded update is ready to install." },
          updatedAt: "2026-05-06T12:01:30.000Z"
        };
        emit();
        return { ...state };
      }
      if (!safe) {
        state = {
          ...state,
          status: state.status === "downloaded" ? "deferred" : state.status,
          message: state.deferredUntilSafe
            ? "Update install already deferred until the app is safe."
            : "Update install requested. Waiting for a safe restart window.",
          restartRequested: true,
          deferredUntilSafe: true,
          updatedAt: "2026-05-06T12:01:30.000Z"
        };
        emit();
        return { ...state };
      }
      if (state.restartRequested && !state.deferredUntilSafe) {
        state = {
          ...state,
          message: "Update install already requested.",
          updatedAt: "2026-05-06T12:01:45.000Z"
        };
        emit();
        return { ...state };
      }
      state = {
        ...state,
        status: "readyToInstall",
        message: "Update install approved. Restarting to install update.",
        restartRequested: true,
        deferredUntilSafe: false,
        updatedAt: "2026-05-06T12:01:45.000Z"
      };
      calls.quitAndInstall += 1;
      emit();
      return { ...state };
    },
    async reportPromptEvent(payload) {
      calls.reportPromptEvent.push(payload);
      return true;
    },
    async devMarkDownloaded(payload = {}) {
      calls.devMarkDownloaded += 1;
      state = {
        ...state,
        status: "downloaded",
        message: "Mock update marked as downloaded.",
        error: null,
        updateInfo: {
          version: payload.version ?? "dev-simulated",
          notes: payload.notes ?? "Mock downloaded update for renderer testing.",
          mock: true
        },
        downloadProgress: {
          percent: 100,
          transferred: 1,
          total: 1,
          bytesPerSecond: 0,
          mock: true
        },
        updatedAt: "2026-05-06T12:01:00.000Z"
      };
      emit();
      return { ...state };
    },
    async requestInstallWhenSafe() {
      calls.requestInstallWhenSafe += 1;
      state = {
        ...state,
        status: ["downloaded", "deferred", "readyToInstall"].includes(state.status) ? "deferred" : state.status,
        message: "Update install requested. Waiting for a safe restart window.",
        restartRequested: true,
        deferredUntilSafe: true,
        updatedAt: "2026-05-06T12:02:00.000Z"
      };
      emit();
      return { ...state };
    },
    async cancelDeferredInstall() {
      calls.cancelDeferredInstall += 1;
      state = {
        ...state,
        status: state.status === "deferred" ? "downloaded" : state.status,
        message: "Deferred update install cleared.",
        restartRequested: false,
        deferredUntilSafe: false,
        updatedAt: "2026-05-06T12:03:00.000Z"
      };
      emit();
      return { ...state };
    },
    quitAndInstall() {
      calls.quitAndInstall += 1;
    }
  };
}

test("appController: update safety returns safe true for a clean idle menu state", () => {
  const app = createUpdateSafetyController();
  app.screenFlow = "menu";
  app.username = "SafetyUser";

  const safety = app.getUpdateSafetyState();

  assert.equal(safety.safe, true);
  assert.deepEqual(safety.reasons, []);
  assert.match(safety.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(app.isSafeForUpdateRestart(), true);
});

test("appController: update safety blocks active match, war, and busy round presentation without mutating state", () => {
  const app = createUpdateSafetyController();
  app.gameController = {
    getViewModel: () => ({
      status: "active",
      warActive: true
    })
  };
  app.screenFlow = "game";
  app.roundPresentation = {
    phase: "reveal",
    busy: true,
    selectedCardIndex: 1
  };

  const before = {
    screenFlow: app.screenFlow,
    roundPresentation: { ...app.roundPresentation }
  };

  const safety = getUpdateSafetyState(app);

  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, ["active_match", "active_war", "round_presentation_busy"]);
  assert.deepEqual(
    {
      screenFlow: app.screenFlow,
      roundPresentation: { ...app.roundPresentation }
    },
    before
  );
  assert.equal(isSafeForUpdateRestart(app), false);
});

test("appController: update safety blocks chest, pending admin notice, reconnect reminder, and reward settlement blockers together", () => {
  const app = createUpdateSafetyController();
  app.profileChestOpenInFlight = true;
  app.profileMilestoneChestNoticeOpen = true;
  app.activeAdminGrantNoticeId = "grant-1";
  app.onlineReconnectReminder = {
    username: "SafetyUser",
    roomCode: "ROOM1",
    expiresAt: "2026-05-06T12:00:00.000Z"
  };
  app.dailyLoginAutoClaimPromise = Promise.resolve();
  app.onlinePlayProfileRefreshPromise = Promise.resolve();
  app.onlinePlayState = {
    room: {
      status: "closing",
      matchComplete: true,
      rewardSettlement: {
        granted: false
      },
      pendingActions: {
        host: null,
        guest: null
      }
    },
    pendingAdminGrantNotices: [{ transactionId: "grant-1" }]
  };

  const safety = app.getUpdateSafetyState();

  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, [
    "chest_open_in_flight",
    "milestone_chest_notice_open",
    "pending_admin_grant_notice",
    "reconnect_paused_or_reminder_active",
    "pending_reward_settlement",
    "daily_login_claim_in_flight",
    "online_profile_refresh_in_flight"
  ]);
});

test("appController: update safety blocks active online match, reconnect paused state, and pending room actions", () => {
  const app = createUpdateSafetyController();
  app.onlinePlayState = {
    room: {
      status: "paused",
      matchComplete: false,
      warActive: false,
      disconnectState: {
        active: true,
        expiresAt: "2026-05-06T12:00:00.000Z"
      },
      pendingActions: {
        host: { type: "submit_move" },
        guest: null
      }
    },
    pendingAdminGrantNotices: []
  };

  const safety = app.getUpdateSafetyState();

  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, [
    "reconnect_paused_or_reminder_active",
    "pending_online_room_action"
  ]);
});

test("appController: update safety blocks a live online match and active online war", () => {
  const app = createUpdateSafetyController();
  app.onlinePlayState = {
    room: {
      status: "full",
      matchComplete: false,
      warActive: true,
      pendingActions: {
        host: null,
        guest: null
      }
    },
    pendingAdminGrantNotices: []
  };

  const safety = app.getUpdateSafetyState();

  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, ["active_online_match", "active_war"]);
});

test("appController: update safety blocks pending local match-complete flow", () => {
  const app = createUpdateSafetyController();
  app.pendingMatchCompletePayload = {
    title: "Match Complete"
  };

  const safety = app.getUpdateSafetyState();

  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, ["pending_match_complete_flow"]);
});

test("appController: update safety blocks active quit and match-complete modals when present", () => {
  const originalDocument = globalThis.document;
  const app = createUpdateSafetyController();

  try {
    globalThis.document = {
      querySelector: () => ({ textContent: "Match Complete" })
    };

    let safety = app.getUpdateSafetyState();
    assert.equal(safety.safe, false);
    assert.deepEqual(safety.reasons, ["match_complete_modal_active"]);

    globalThis.document = {
      querySelector: () => ({ textContent: "Leave Match" })
    };

    safety = app.getUpdateSafetyState();
    assert.equal(safety.safe, false);
    assert.deepEqual(safety.reasons, ["quit_confirmation_modal_active"]);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("appController: dev update simulation flow stays deferred while unsafe and becomes install-allowed once safe", async () => {
  const originalWindow = globalThis.window;
  const updateBridge = createMockUpdateBridge();

  try {
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = createUpdateSafetyController();
    app.bindUpdateLifecycleUpdates();
    await app.refreshUpdateCoordinatorState();

    app.screenFlow = "game";
    app.roundPresentation = {
      phase: "reveal",
      busy: true,
      selectedCardIndex: 0
    };
    app.gameController = {
      getViewModel: () => ({
        status: "active",
        warActive: true
      })
    };

    await app.devSimulateDownloadedUpdate({ version: "dev-flow-1" });
    assert.equal(app.getUpdateCoordinatorState().lifecycleState.status, "downloaded");
    assert.equal(app.getUpdateCoordinatorState().lifecycleState.updateInfo?.mock, true);

    await app.devRequestInstallWhenSafe();
    assert.equal(app.getUpdateCoordinatorState().lifecycleState.status, "deferred");
    assert.equal(app.getUpdateCoordinatorState().deferredUntilSafe, true);
    assert.equal(app.getUpdateCoordinatorState().installAllowedNow, false);
    assert.deepEqual(app.getUpdateCoordinatorState().blockedReasons, [
      "active_match",
      "active_war",
      "round_presentation_busy"
    ]);
    assert.deepEqual(app.getUpdateDiagnostics(), {
      lifecycleStatus: "deferred",
      message: "Update install requested. Waiting for a safe restart window.",
      error: null,
      updateInfo: {
        version: "dev-flow-1",
        notes: "Mock downloaded update for renderer testing.",
        mock: true
      },
      downloadProgress: {
        percent: 100,
        transferred: 1,
        total: 1,
        bytesPerSecond: 0,
        mock: true
      },
      deferredUntilSafe: true,
      restartRequested: true,
      installAllowedNow: false,
      blockedReasons: ["active_match", "active_war", "round_presentation_busy"]
    });

    app.screenFlow = "menu";
    app.roundPresentation = {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    };
    app.gameController = {
      getViewModel: () => ({
        status: "idle",
        warActive: false
      })
    };

    await app.refreshUpdateCoordinatorState();
    assert.equal(app.getUpdateCoordinatorState().installAllowedNow, true);
    assert.deepEqual(app.getUpdateCoordinatorState().blockedReasons, []);
    assert.deepEqual(app.getUpdateDiagnostics(), {
      lifecycleStatus: "deferred",
      message: "Update install requested. Waiting for a safe restart window.",
      error: null,
      updateInfo: {
        version: "dev-flow-1",
        notes: "Mock downloaded update for renderer testing.",
        mock: true
      },
      downloadProgress: {
        percent: 100,
        transferred: 1,
        total: 1,
        bytesPerSecond: 0,
        mock: true
      },
      deferredUntilSafe: true,
      restartRequested: true,
      installAllowedNow: true,
      blockedReasons: []
    });

    await app.devCancelDeferredUpdateInstall();
    assert.equal(app.getUpdateCoordinatorState().lifecycleState.status, "downloaded");
    assert.equal(app.getUpdateCoordinatorState().deferredUntilSafe, false);
    assert.equal(app.getUpdateCoordinatorState().lifecycleState.restartRequested, false);
    assert.equal(app.getUpdateCoordinatorState().installAllowedNow, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: dev update lifecycle subscription updates coordinator from stateChanged events", async () => {
  const originalWindow = globalThis.window;
  const updateBridge = createMockUpdateBridge();

  try {
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = createUpdateSafetyController();
    app.screenFlow = "menu";
    app.bindUpdateLifecycleUpdates();

    await app.devSimulateDownloadedUpdate({ version: "subscription-flow-1" });

    const coordinator = app.getUpdateCoordinatorState();
    assert.equal(coordinator.lifecycleState.status, "downloaded");
    assert.equal(coordinator.lifecycleState.updateInfo?.version, "subscription-flow-1");
    assert.equal(coordinator.installAllowedNow, false);
    assert.equal(coordinator.deferredUntilSafe, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: downloaded update shows an Update Ready prompt and Later does not install", async () => {
  const originalWindow = globalThis.window;
  const updateBridge = createMockUpdateBridge();
  const modalManager = createModalCapture();

  try {
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = new AppController({
      screenManager: { register: () => {}, show: () => {} },
      modalManager,
      toastManager: { show: () => {} }
    });
    app.screenFlow = "menu";
    app.bindUpdateLifecycleUpdates();

    await app.devSimulateDownloadedUpdate({ version: "2.1.5" });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalManager.shows.length, 1);
    const prompt = modalManager.shows[0];
    assert.equal(prompt.title, "Update Ready");
    assert.match(prompt.body, /downloaded/i);
    assert.deepEqual(updateBridge.calls.reportPromptEvent, [
      {
        type: "install_prompt_shown",
        version: "2.1.5",
        source: "renderer-update-modal"
      }
    ]);

    await prompt.actions[1].onClick();

    assert.equal(updateBridge.calls.requestInstall, 0);
    assert.deepEqual(updateBridge.calls.reportPromptEvent.at(-1), {
      type: "user_chose_later",
      version: "2.1.5",
      source: "renderer-update-modal"
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: downloaded update Restart Now uses safe install and does not show a blocker modal", async () => {
  const originalWindow = globalThis.window;
  const updateBridge = createMockUpdateBridge();
  const modalManager = createModalCapture();

  try {
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = new AppController({
      screenManager: { register: () => {}, show: () => {} },
      modalManager,
      toastManager: { show: () => {} }
    });
    app.screenFlow = "menu";
    app.bindUpdateLifecycleUpdates();

    await app.devSimulateDownloadedUpdate({ version: "2.1.5" });
    await Promise.resolve();
    await Promise.resolve();

    const prompt = modalManager.shows[0];
    await prompt.actions[0].onClick();

    assert.equal(updateBridge.calls.requestInstall, 1);
    assert.equal(updateBridge.calls.quitAndInstall, 1);
    assert.deepEqual(updateBridge.calls.reportPromptEvent.at(-1), {
      type: "user_chose_restart_now",
      version: "2.1.5",
      source: "renderer-update-modal"
    });
    assert.equal(modalManager.shows.length, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: downloaded update Restart Now stays blocked safely during an active match", async () => {
  const originalWindow = globalThis.window;
  const updateBridge = createMockUpdateBridge();
  const modalManager = createModalCapture();

  try {
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = new AppController({
      screenManager: { register: () => {}, show: () => {} },
      modalManager,
      toastManager: { show: () => {} }
    });
    app.screenFlow = "game";
    app.roundPresentation = {
      phase: "reveal",
      busy: true,
      selectedCardIndex: 0
    };
    app.gameController = {
      getViewModel: () => ({
        status: "active",
        warActive: true
      })
    };
    app.bindUpdateLifecycleUpdates();

    await app.devSimulateDownloadedUpdate({ version: "2.1.5" });
    await Promise.resolve();
    await Promise.resolve();

    const prompt = modalManager.shows[0];
    await prompt.actions[0].onClick();

    assert.equal(updateBridge.calls.requestInstall, 1);
    assert.equal(updateBridge.calls.quitAndInstall, 0);
    assert.equal(modalManager.shows.length, 2);
    assert.equal(modalManager.shows[1].title, "Update Not Safe Yet");
    assert.match(modalManager.shows[1].body, /cannot restart/i);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: manual update check calls the update API once and refreshes diagnostics safely in dev/unpackaged mode", async () => {
  const originalWindow = globalThis.window;
  const originalConsoleInfo = console.info;
  const originalConsoleError = console.error;
  const logs = [];
  const errors = [];
  const updateBridge = createMockUpdateBridge({
    requestCheckResponses: [
      {
        status: "idle",
        message: "Update checks are disabled in dev/unpackaged builds.",
        error: null,
        lastCheckedAt: "2026-05-06T12:10:00.000Z"
      }
    ]
  });

  try {
    console.info = (...args) => logs.push(args);
    console.error = (...args) => errors.push(args);
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = createUpdateSafetyController();
    app.screenFlow = "menu";
    app.bindUpdateLifecycleUpdates();

    const coordinator = await app.requestManualUpdateCheck();
    const diagnostics = app.getUpdateDiagnostics();

    assert.equal(updateBridge.calls.requestCheck, 1);
    assert.equal(updateBridge.calls.quitAndInstall, 0);
    assert.equal(coordinator.lifecycleState.status, "idle");
    assert.match(diagnostics.message, /disabled in dev\/unpackaged builds/i);
    assert.equal(diagnostics.lifecycleStatus, "idle");
    assert.equal(diagnostics.restartRequested, false);
    assert.equal(diagnostics.deferredUntilSafe, false);
    assert.equal(diagnostics.installAllowedNow, false);
    assert.deepEqual(diagnostics.blockedReasons, []);
    assert.equal(errors.length, 0);
    assert.equal(logs.some((entry) => String(entry[0]).includes("[Updates][ManualCheck] requested")), true);
    assert.equal(logs.some((entry) => String(entry[0]).includes("[Updates][ManualCheck] completed")), true);
  } finally {
    console.info = originalConsoleInfo;
    console.error = originalConsoleError;
    globalThis.window = originalWindow;
  }
});

test("appController: manual update check in packaged-style flow does not install or restart", async () => {
  const originalWindow = globalThis.window;
  const updateBridge = createMockUpdateBridge({
    requestCheckResponses: [
      {
        status: "checking",
        message: "Checking for updates...",
        error: null,
        updateInfo: null,
        downloadProgress: null,
        lastCheckedAt: "2026-05-06T12:11:00.000Z"
      }
    ]
  });

  try {
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = createUpdateSafetyController();
    app.screenFlow = "menu";
    app.bindUpdateLifecycleUpdates();

    const coordinator = await app.requestManualUpdateCheck();
    const diagnostics = app.getUpdateDiagnostics();

    assert.equal(updateBridge.calls.requestCheck, 1);
    assert.equal(updateBridge.calls.quitAndInstall, 0);
    assert.equal(coordinator.lifecycleState.status, "checking");
    assert.equal(diagnostics.lifecycleStatus, "checking");
    assert.equal(diagnostics.message, "Checking for updates...");
    assert.equal(diagnostics.error, null);
    assert.equal(diagnostics.updateInfo, null);
    assert.equal(diagnostics.downloadProgress, null);
    assert.equal(diagnostics.restartRequested, false);
    assert.equal(diagnostics.deferredUntilSafe, false);
    assert.equal(diagnostics.installAllowedNow, false);
    assert.deepEqual(diagnostics.blockedReasons, []);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: explicit install request defers while unsafe and installs only after a safe retry", async () => {
  const originalWindow = globalThis.window;
  const updateBridge = createMockUpdateBridge({
    status: "downloaded",
    message: "Update downloaded.",
    updateInfo: { version: "2.0.2" }
  });

  try {
    globalThis.window = {
      elemintz: {
        updates: updateBridge
      }
    };

    const app = createUpdateSafetyController();
    app.bindUpdateLifecycleUpdates();
    app.screenFlow = "game";
    app.roundPresentation = { phase: "reveal", busy: true, selectedCardIndex: 0 };
    app.gameController = {
      getViewModel: () => ({ status: "active", warActive: true })
    };
    await app.refreshUpdateCoordinatorState();

    let coordinator = await app.requestUpdateInstall();
    assert.equal(updateBridge.calls.requestInstall, 1);
    assert.equal(updateBridge.calls.quitAndInstall, 0);
    assert.equal(coordinator.lifecycleState.status, "deferred");
    assert.equal(coordinator.deferredUntilSafe, true);
    assert.equal(coordinator.installAllowedNow, false);
    assert.deepEqual(coordinator.blockedReasons, ["active_match", "active_war", "round_presentation_busy"]);

    app.screenFlow = "menu";
    app.roundPresentation = { phase: "idle", busy: false, selectedCardIndex: null };
    app.gameController = {
      getViewModel: () => ({ status: "idle", warActive: false })
    };
    await app.refreshUpdateCoordinatorState();

    coordinator = await app.requestUpdateInstall();
    assert.equal(updateBridge.calls.requestInstall, 2);
    assert.equal(updateBridge.calls.quitAndInstall, 1);
    assert.equal(coordinator.lifecycleState.status, "readyToInstall");
    assert.equal(coordinator.lifecycleState.restartRequested, true);
    assert.equal(coordinator.deferredUntilSafe, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("gameController: AI selection is independent from player's current card", async () => {
  const originalWindow = globalThis.window;
  const submittedMoves = [];
  const initialRoom = createAuthoritativeLocalRoom();
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 1, earth: 3, wind: 2 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });

  const controller = new GameController({
    username: "FairnessUser",
    timerSeconds: 30,
    aiDifficulty: "hard",
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: (_socketId, move) => {
          submittedMoves.push(move);
          return {
            ok: true,
            room: resolvedRoom,
            roundResult: {
              round: 1,
              hostMove: "fire",
              guestMove: "earth",
              outcomeType: "resolved",
              hostResult: "win",
              guestResult: "lose",
              warRounds: [],
              warPot: { host: [], guest: [] }
            }
          };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        },
        multiplayer: {
          getProfile: async () => null
        }
      }
    };

    controller.startNewMatch();
    await controller.playCard(0);

    assert.deepEqual(submittedMoves, ["fire"]);
    assert.equal(controller.lastRound.p1Card, "fire");
    assert.equal(controller.lastRound.p2Card, "earth");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: non-authoritative PvE passes visible hand counts and recent moves into Hard AI", async () => {
  const originalWindow = globalThis.window;
  const originalRandom = Math.random;
  const controller = new GameController({
    username: "HardAiContextUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    aiDifficulty: "hard",
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    Math.random = () => 0;
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.localAuthority = null;
    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      players: {
        p1: {
          hand: ["fire", "fire", "earth"],
          wonRounds: 0
        },
        p2: {
          hand: ["earth", "water", "wind"],
          wonRounds: 0
        }
      },
      history: [
        {
          round: 1,
          p1Card: "fire",
          p2Card: "earth",
          result: "p1",
          warClashes: 0,
          capturedCards: 2,
          capturedOpponentCards: 1
        }
      ],
      currentPile: [],
      war: {
        active: false,
        clashes: 0
      }
    };
    controller.captured = { p1: 1, p2: 0 };

    let capturedFinalizeCall = null;
    controller.finalizeRound = async ({ p1CardIndex, p2CardIndex }) => {
      capturedFinalizeCall = {
        p1CardIndex,
        p2CardIndex
      };
      return {
        status: "resolved",
        round: {
          result: "p1",
          p1Card: "fire",
          p2Card: "water",
          capturedOpponentCards: 1
        }
      };
    };

    const result = await controller.playCard(0);

    assert.equal(capturedFinalizeCall?.p2CardIndex, 1);
    assert.equal(result.revealedCards.p2Card, "water");
  } finally {
    Math.random = originalRandom;
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: completed PvE rounds wait for async match-complete handling before the trailing update", async () => {
  const originalWindow = globalThis.window;
  let releaseMatchComplete;
  let matchCompleteFinished = false;
  const updates = [];

  const controller = new GameController({
    username: "PveLossRaceUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {
      updates.push({
        isResolvingRound: controller.isResolvingRound,
        matchCompleteFinished
      });
    },
    onMatchComplete: async () => {
      await new Promise((resolve) => {
        releaseMatchComplete = resolve;
      });
      matchCompleteFinished = true;
    }
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.finalizeRound = async () => {
      controller.match.status = "completed";
      controller.match.winner = "p2";
      await controller.finalizeCompletedMatch();
      return {
        status: "resolved",
        round: {
          result: "p2",
          p1Card: "fire",
          p2Card: "earth",
          capturedOpponentCards: 1
        }
      };
    };

    const pendingPlay = controller.playCard(0);
    await Promise.resolve();

    assert.equal(typeof releaseMatchComplete, "function");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].isResolvingRound, true);
    assert.equal(updates[0].matchCompleteFinished, false);

    releaseMatchComplete();
    await pendingPlay;

    assert.equal(matchCompleteFinished, true);
    assert.equal(updates.at(-1).isResolvingRound, false);
    assert.equal(updates.at(-1).matchCompleteFinished, true);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat uses two pass states and resolves only on confirmation", async () => {
  const originalWindow = globalThis.window;
  const submitCalls = [];
  const initialRoom = createAuthoritativeLocalRoom();
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 3, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 1, water: 2, earth: 1, wind: 2 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });
  const fakeStore = {
    createRoom: () => ({ ok: true, room: initialRoom }),
    joinRoom: () => ({ ok: true, room: initialRoom }),
    submitMove: (_socketId, move) => {
      submitCalls.push(move);
      if (submitCalls.length === 1) {
        return { ok: true, room: initialRoom, roundResult: null };
      }

      return {
        ok: true,
        room: resolvedRoom,
        roundResult: {
          round: 1,
          hostMove: "fire",
          guestMove: "earth",
          outcomeType: "resolved",
          hostResult: "win",
          guestResult: "lose",
          warRounds: [],
          warPot: { host: [], guest: [] }
        }
      };
    }
  };

  const controller = new GameController({
    username: "LocalTester",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    aiDifficulty: "hard",
    localAuthorityStoreFactory: () => fakeStore,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const p1Selection = await controller.submitHotseatSelection(0);
    assert.equal(p1Selection.status, "pass_to_p2");

    const p2Selection = await controller.submitHotseatSelection(4);
    assert.equal(p2Selection.status, "pass_to_p1");
    assert.equal(controller.lastRound, null);

    const confirmed = await controller.confirmHotseatRound();
    assert.equal(confirmed.status, "round_resolved");
    assert.deepEqual(submitCalls, ["fire", "earth"]);
    assert.equal(controller.lastRound.p1Card, "fire");
    assert.equal(controller.lastRound.p2Card, "earth");
    assert.equal(controller.match.players.p1.hand.length, 9);
    assert.equal(controller.match.players.p2.hand.length, 6);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat WAR continuation comes from authoritative room state", async () => {
  const originalWindow = globalThis.window;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 1, water: 2, earth: 2, wind: 2 },
    warActive: true,
    warRounds: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war"
      }
    ],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  let submitCount = 0;
  const fakeStore = {
    createRoom: () => ({ ok: true, room: initialRoom }),
    joinRoom: () => ({ ok: true, room: initialRoom }),
    submitMove: (_socketId, move) => {
      if (move !== "fire") {
        return { ok: false, error: { code: "UNEXPECTED_MOVE" } };
      }

      submitCount += 1;
      return submitCount > 1
        ? {
            ok: true,
            room: warRoom,
            roundResult: {
              round: 1,
              hostMove: "fire",
              guestMove: "fire",
              outcomeType: "war",
              hostResult: "war",
              guestResult: "war",
              warRounds: [{ round: 1, outcomeType: "war" }],
              warPot: { host: ["fire"], guest: ["fire"] }
            }
          }
        : { ok: true, room: initialRoom, roundResult: null };
    }
  };
  const controller = new GameController({
    username: "WarAuthorityUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirmed = await controller.confirmHotseatRound();

    assert.equal(confirmed.status, "war_continues");
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.war.active, true);
    assert.deepEqual(controller.match.currentPile, ["fire", "fire"]);
    assert.equal(controller.roundResultText, "WAR continues. Choose new cards for the next clash.");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat authoritative room store accepts round progression beyond the first round", async () => {
  const originalWindow = globalThis.window;
  const controller = new GameController({
    username: "LocalRoundProgressUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    let result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "water")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const firstRound = await controller.confirmHotseatRound();
    assert.equal(firstRound.status, "round_resolved");
    assert.equal(controller.match.status, "active");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "water")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const secondRound = await controller.confirmHotseatRound();
    assert.equal(secondRound.status, "round_resolved");
    assert.equal(controller.match.status, "active");
    assert.equal(controller.match.round, 2);
    assert.equal(controller.pendingHotseatP1CardIndex, null);
    assert.equal(controller.pendingHotseatP2CardIndex, null);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local hotseat authoritative room store accepts WAR continuation submissions", async () => {
  const originalWindow = globalThis.window;
  const controller = new GameController({
    username: "LocalWarProgressUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    let result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const warStart = await controller.confirmHotseatRound();
    assert.equal(warStart.status, "war_continues");
    assert.equal(controller.match.war.active, true);

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p1.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p2");

    result = await controller.submitHotseatSelection(
      findCardIndexByElement(controller.match.players.p2.hand, "fire")
    );
    assert.equal(result.status, "pass_to_p1");

    const warContinue = await controller.confirmHotseatRound();
    assert.equal(warContinue.status, "war_continues");
    assert.equal(controller.match.war.active, true);
    assert.equal(controller.pendingHotseatP1CardIndex, null);
    assert.equal(controller.pendingHotseatP2CardIndex, null);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE authoritative room store accepts multiple resolved rounds and WAR continuation", async () => {
  const originalWindow = globalThis.window;

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    const resolvedController = new GameController({
      username: "PveProgressUser",
      timerSeconds: 30,
      mode: MATCH_MODE.PVE,
      localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
      onUpdate: () => {},
      onMatchComplete: () => {}
    });
    resolvedController.startNewMatch();

    const firstRound = await resolvedController.playCard(
      findCardIndexByElement(resolvedController.match.players.p1.hand, "water")
    );
    assert.match(firstRound.status, /^(resolved|war_continues)$/);
    assert.equal(resolvedController.match.status, "active");

    const secondRound = await resolvedController.playCard(
      findCardIndexByElement(resolvedController.match.players.p1.hand, "wind")
    );
    assert.match(secondRound.status, /^(resolved|war_continues)$/);
    assert.equal(resolvedController.match.status, "active");
    assert.equal(resolvedController.match.round, 2);
    resolvedController.stopTimer();
    resolvedController.stopMatchClock();

    const warController = new GameController({
      username: "PveWarProgressUser",
      timerSeconds: 30,
      mode: MATCH_MODE.PVE,
      localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
      onUpdate: () => {},
      onMatchComplete: () => {}
    });
    warController.startNewMatch();

    const warStart = await warController.playCard(
      findCardIndexByElement(warController.match.players.p1.hand, "fire")
    );
    assert.match(warStart.status, /^(war_continues|resolved)$/);
    if (warStart.status === "war_continues") {
      assert.equal(warController.match.war.active, true);
    }

    const warContinue = await warController.playCard(
      findCardIndexByElement(warController.match.players.p1.hand, "fire")
    );
    assert.notEqual(warContinue.skipped, true);
    assert.match(warContinue.status, /^(war_continues|resolved)$/);
    warController.stopTimer();
    warController.stopMatchClock();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvE fatigue blocks a third same element when another playable element exists", async () => {
  const controller = new GameController({
    username: "FatiguePveUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });
  let finalizeCalls = 0;
  controller.match = {
    ...createMinimalMatch(MATCH_MODE.PVE),
    players: {
      p1: { hand: ["fire", "fire", "water"], wonRounds: 0 },
      p2: { hand: ["earth", "wind"], wonRounds: 0 }
    },
    history: [
      { p1Card: "fire", p2Card: "earth", result: "p1" },
      { p1Card: "fire", p2Card: "wind", result: "p1" }
    ]
  };
  controller.finalizeRound = async () => {
    finalizeCalls += 1;
    return { status: "resolved", round: null };
  };

  const result = await controller.playCard(findCardIndexByElement(controller.match.players.p1.hand, "fire"));

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "player-card-fatigued");
  assert.equal(finalizeCalls, 0);
});

test("gameController: local PvE fatigue bypass allows the only playable element and ignores face-down WAR pile cards", async () => {
  const controller = new GameController({
    username: "FatigueBypassUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });
  let finalizeCalls = 0;
  controller.match = {
    ...createMinimalMatch(MATCH_MODE.PVE),
    currentPile: ["fire", "water", "earth", "wind"],
    war: {
      active: true,
      clashes: 1
    },
    players: {
      p1: { hand: ["fire"], wonRounds: 0 },
      p2: { hand: ["earth"], wonRounds: 0 }
    },
    history: [
      { p1Card: "fire", p2Card: "fire", result: "none" }
    ]
  };
  controller.finalizeRound = async () => {
    finalizeCalls += 1;
    return {
      status: "resolved",
      round: {
        result: "p1",
        p1Card: "fire",
        p2Card: "earth",
        capturedOpponentCards: 1
      }
    };
  };

  const result = await controller.playCard(0);

  assert.notEqual(result.skipped, true);
  assert.equal(finalizeCalls, 1);
});

test("gameController: local PvE fatigue counts WAR chosen cards toward the next selection", async () => {
  const controller = new GameController({
    username: "FatigueWarUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });
  controller.match = {
    ...createMinimalMatch(MATCH_MODE.PVE),
    players: {
      p1: { hand: ["fire", "water"], wonRounds: 0 },
      p2: { hand: ["fire", "earth"], wonRounds: 0 }
    },
    history: [
      { p1Card: "fire", p2Card: "fire", result: "none", warClashes: 0 },
      { p1Card: "fire", p2Card: "water", result: "none", warClashes: 1 }
    ]
  };

  const result = await controller.playCard(findCardIndexByElement(controller.match.players.p1.hand, "fire"));

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "player-card-fatigued");
});

test("gameController: local hotseat fatigue only blocks the current turn owner", async () => {
  const controller = new GameController({
    username: "FatigueHotseatUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });
  controller.match = {
    ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
    players: {
      p1: { hand: ["fire", "water"], wonRounds: 0 },
      p2: { hand: ["fire", "earth"], wonRounds: 0 }
    },
    history: [
      { p1Card: "fire", p2Card: "earth", result: "p1" },
      { p1Card: "fire", p2Card: "wind", result: "p1" }
    ]
  };
  controller.hotseatTurn = "p1";

  const blocked = await controller.submitHotseatSelection(
    findCardIndexByElement(controller.match.players.p1.hand, "fire")
  );
  assert.equal(blocked.status, "ignored");
  assert.equal(blocked.reason, "player-1-card-fatigued");

  const p1Allowed = await controller.submitHotseatSelection(
    findCardIndexByElement(controller.match.players.p1.hand, "water")
  );
  assert.equal(p1Allowed.status, "pass_to_p2");

  const p2Allowed = await controller.submitHotseatSelection(
    findCardIndexByElement(controller.match.players.p2.hand, "fire")
  );
  assert.equal(p2Allowed.status, "pass_to_p1");
});

test("gameController: active authoritative sync keeps the last completed local round presentation before the next clash", () => {
  const controller = new GameController({
    username: "RoundResetUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      status: "active",
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] }
    };
    controller.lastRound = {
      round: 1,
      p1Card: "fire",
      p2Card: "earth",
      result: "p1",
      warClashes: 0,
      capturedOpponentCards: 1
    };
    controller.roundResultText = "Player wins this clash.";

    controller.syncLocalAuthorityState(createAuthoritativeLocalRoom(), null);

    assert.deepEqual(controller.lastRound, {
      round: 1,
      p1Card: "fire",
      p2Card: "earth",
      result: "p1",
      warClashes: 0,
      capturedOpponentCards: 1
    });
    assert.equal(controller.roundResultText, "Choose a card to begin the next clash.");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: PvE rebuilt local history keeps capture totals monotonic through WAR chains", () => {
  const controller = new GameController({
    username: "PveWarCaptureUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const preWarRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      }
    ]
  });

  const warStartRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["water"], guest: ["water"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warContinueRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" },
      { round: 2, hostMove: "earth", guestMove: "fire", outcomeType: "no_effect" }
    ],
    warPot: { host: ["water", "earth"], guest: ["water", "fire"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "earth",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warResolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    roundHistory: [
      ...warContinueRoom.roundHistory,
      {
        round: 2,
        hostMove: "wind",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(preWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warStartRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0]
    );

    controller.syncLocalAuthorityState(warContinueRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0, 0]
    );

    controller.syncLocalAuthorityState(warResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 3 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0, 0, 3]
    );
    assert.deepEqual(
      controller.match.history.map((round) => round.warClashes),
      [0, 0, 0, 3]
    );
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE WAR stats ignore pre-WAR no-effect rows when resolving war depth", () => {
  const controller = new GameController({
    username: "PveWarDepthTruthUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const tracedRoom = createAuthoritativeLocalRoom({
    roundNumber: 7,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 3,
        hostMove: "wind",
        guestMove: "wind",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 4,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 5,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 6,
        hostMove: "earth",
        guestMove: "wind",
        outcomeType: "war_resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(tracedRoom, null);

    assert.deepEqual(
      controller.match.history.map((round) => round.warClashes),
      [0, 0, 0, 0, 0, 3]
    );
    assert.deepEqual(controller.captured, { p1: 4, p2: 1 });
    assert.equal(controller.getViewModel().captured.p1, 4);
    assert.equal(controller.getViewModel().captured.p2, 1);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE active WAR exposes the latest authoritative clash cards without reusing stale lastRound data", () => {
  const controller = new GameController({
    username: "PveWarClashCardsUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const preWarRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    roundHistory: [
      {
        round: 1,
        hostMove: "wind",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      }
    ]
  });

  const warStartRow = {
    round: 2,
    hostMove: "water",
    guestMove: "water",
    outcomeType: "war",
    hostResult: "war",
    guestResult: "war",
    capturedCards: 0,
    capturedOpponentCards: 0
  };
  const warStartRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warDepth: 1,
    warRounds: [{ round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }],
    warPot: { host: ["water"], guest: ["water"] },
    roundHistory: [...preWarRoom.roundHistory, warStartRow]
  });

  const warContinueRow = {
    round: 2,
    hostMove: "earth",
    guestMove: "fire",
    outcomeType: "no_effect",
    hostResult: "no_effect",
    guestResult: "no_effect",
    capturedCards: 0,
    capturedOpponentCards: 0
  };
  const warContinueRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warDepth: 2,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" },
      { round: 2, hostMove: "earth", guestMove: "fire", outcomeType: "no_effect" }
    ],
    warPot: { host: ["water", "earth"], guest: ["water", "fire"] },
    roundHistory: [...preWarRoom.roundHistory, warStartRow, warContinueRow]
  });

  const warResolvedRow = {
    round: 2,
    hostMove: "wind",
    guestMove: "water",
    outcomeType: "war_resolved",
    hostResult: "lose",
    guestResult: "win",
    capturedCards: 6,
    capturedOpponentCards: 3
  };
  const warResolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    roundHistory: [...warContinueRoom.roundHistory, warResolvedRow]
  });

  try {
    controller.syncLocalAuthorityState(preWarRoom, null);
    assert.equal(controller.getViewModel().activeWarClashCards, null);

    controller.syncLocalAuthorityState(warStartRoom, warStartRow);
    let vm = controller.getViewModel();
    assert.deepEqual(vm.activeWarClashCards, { p1Card: "water", p2Card: "water" });
    assert.deepEqual(vm.warPileSizes, [2]);
    assert.equal(controller.lastRound, null);

    controller.syncLocalAuthorityState(warContinueRoom, warContinueRow);
    vm = controller.getViewModel();
    assert.deepEqual(vm.activeWarClashCards, { p1Card: "earth", p2Card: "fire" });
    assert.deepEqual(vm.warPileSizes, [2, 4]);
    assert.equal(controller.lastRound.p1Card, "earth");
    assert.equal(controller.lastRound.p2Card, "fire");

    controller.syncLocalAuthorityState(warResolvedRoom, warResolvedRow);
    vm = controller.getViewModel();
    assert.equal(vm.activeWarClashCards, null);
    assert.equal(controller.lastRound.p1Card, "wind");
    assert.equal(controller.lastRound.p2Card, "water");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE live captured tally uses derived match stats without preserving higher prior values", () => {
  const controller = new GameController({
    username: "PveLiveCaptureUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const higherCaptureRoom = createAuthoritativeLocalRoom({
    roundNumber: 4,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "earth",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "wind",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  const lowerSnapshotRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["water"], guest: ["water"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(higherCaptureRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 3 });

    controller.syncLocalAuthorityState(lowerSnapshotRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 3 });
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE no-effect snapshot does not erase prior captured totals when room history is trimmed", () => {
  const controller = new GameController({
    username: "PveTrimNoEffectUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const beforeTrimRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM",
    roundNumber: 11,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  const trimmedNoEffectRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM",
    roundNumber: 12,
    roundHistory: [
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(beforeTrimRoom, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 3 });

    controller.syncLocalAuthorityState(trimmedNoEffectRoom, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 3 });
    assert.equal(controller.match.history.length, 11);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE later resolved player win does not erase prior AI captures when room history is trimmed", () => {
  const controller = new GameController({
    username: "PveTrimResolvedUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const beforeResolvedRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM2",
    roundNumber: 12,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  const trimmedResolvedRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM2",
    roundNumber: 13,
    roundHistory: [
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(beforeResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 3 });

    controller.syncLocalAuthorityState(trimmedResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 5, p2: 3 });
    assert.equal(controller.match.history.length, 12);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE WAR trigger does not erase prior player captures when room history is trimmed", () => {
  const controller = new GameController({
    username: "PveTrimWarUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const beforeWarRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM3",
    roundNumber: 13,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 2, hostMove: "water", guestMove: "earth", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 3, hostMove: "earth", guestMove: "wind", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  const trimmedWarRoom = createAuthoritativeLocalRoom({
    roomCode: "PVETRM3",
    roundNumber: 14,
    warActive: true,
    warDepth: 1,
    warRounds: [{ round: 13, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      { round: 4, hostMove: "wind", guestMove: "wind", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "fire", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 8, hostMove: "wind", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "fire", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 13, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(beforeWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 5, p2: 3 });

    controller.syncLocalAuthorityState(trimmedWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 5, p2: 3 });
    assert.equal(controller.match.history.length, 13);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvE repeated WAR and no-effect patterns do not duplicate prior rows during trimmed merges", () => {
  const controller = new GameController({
    username: "PveTrimRepeatedWarUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const snapshotA = createAuthoritativeLocalRoom({
    roomCode: "PVETRM4",
    roundNumber: 11,
    roundHistory: [
      { round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 2, hostMove: "fire", guestMove: "earth", outcomeType: "war_resolved", hostResult: "win", guestResult: "lose", capturedCards: 4, capturedOpponentCards: 2 },
      { round: 3, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 4, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "wind", outcomeType: "war_resolved", hostResult: "lose", guestResult: "win", capturedCards: 6, capturedOpponentCards: 3 },
      { round: 8, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 }
    ]
  });

  const snapshotB = createAuthoritativeLocalRoom({
    roomCode: "PVETRM4",
    roundNumber: 14,
    warActive: true,
    warDepth: 2,
    warRounds: [
      { round: 11, hostMove: "fire", guestMove: "fire", outcomeType: "war" },
      { round: 12, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["fire", "water"], guest: ["fire", "water"] },
    roundHistory: [
      { round: 4, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 5, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 6, hostMove: "water", guestMove: "water", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 7, hostMove: "earth", guestMove: "wind", outcomeType: "war_resolved", hostResult: "lose", guestResult: "win", capturedCards: 6, capturedOpponentCards: 3 },
      { round: 8, hostMove: "wind", guestMove: "fire", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 9, hostMove: "fire", guestMove: "earth", outcomeType: "resolved", hostResult: "win", guestResult: "lose", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 10, hostMove: "water", guestMove: "wind", outcomeType: "resolved", hostResult: "lose", guestResult: "win", capturedCards: 2, capturedOpponentCards: 1 },
      { round: 11, hostMove: "fire", guestMove: "fire", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 12, hostMove: "water", guestMove: "water", outcomeType: "war", hostResult: "war", guestResult: "war", capturedCards: 0, capturedOpponentCards: 0 },
      { round: 13, hostMove: "earth", guestMove: "earth", outcomeType: "no_effect", hostResult: "no_effect", guestResult: "no_effect", capturedCards: 0, capturedOpponentCards: 0 }
    ]
  });

  try {
    controller.syncLocalAuthorityState(snapshotA, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 5 });
    assert.equal(controller.match.history.length, 10);

    controller.syncLocalAuthorityState(snapshotB, null);
    assert.deepEqual(controller.captured, { p1: 4, p2: 5 });
    assert.equal(controller.match.history.length, 13);
    assert.equal(
      controller.match.history.filter((round) => round.warClashes > 0).length,
      2
    );
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local PvP rebuilt local history keeps capture totals monotonic through WAR chains", () => {
  const controller = new GameController({
    username: "LocalPvpWarCaptureUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  const preWarRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 2,
        capturedOpponentCards: 1
      }
    ]
  });

  const warStartRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["water"], guest: ["water"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warContinueRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    warActive: true,
    warRounds: [
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" },
      { round: 2, hostMove: "earth", guestMove: "fire", outcomeType: "no_effect" }
    ],
    warPot: { host: ["water", "earth"], guest: ["water", "fire"] },
    roundHistory: [
      ...preWarRoom.roundHistory,
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "earth",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      }
    ]
  });

  const warResolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    roundHistory: [
      ...warContinueRoom.roundHistory,
      {
        round: 2,
        hostMove: "wind",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 6,
        capturedOpponentCards: 3
      }
    ]
  });

  try {
    controller.syncLocalAuthorityState(preWarRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warStartRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warContinueRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 0 });

    controller.syncLocalAuthorityState(warResolvedRoom, null);
    assert.deepEqual(controller.captured, { p1: 1, p2: 3 });
    assert.deepEqual(
      controller.match.history.map((round) => round.capturedOpponentCards),
      [1, 0, 0, 3]
    );
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: local time-limit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "host",
    winReason: "time_limit",
    roundNumber: 3,
    hostHand: { fire: 3, water: 2, earth: 2, wind: 1 },
    guestHand: { fire: 1, water: 1, earth: 1, wind: 1 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const fakeStore = {
    createRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    joinRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    completeMatchByCardCount: (_socketId, options) => {
      completionCalls.push(options);
      return { ok: true, room: completedRoom };
    }
  };
  const controller = new GameController({
    username: "LocalTimeLimitAuthority",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.finalizeByTimeLimit();

    assert.deepEqual(completionCalls, [{ reason: "time_limit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p1");
    assert.equal(controller.match.endReason, "time_limit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local quit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "guest",
    winReason: "quit_forfeit",
    roundNumber: 2,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
  });
  const fakeStore = {
    createRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    joinRoom: () => ({ ok: true, room: createAuthoritativeLocalRoom() }),
    completeMatch: (_socketId, options) => {
      completionCalls.push(options);
      return { ok: true, room: completedRoom };
    }
  };
  const controller = new GameController({
    username: "LocalQuitAuthority",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });

    assert.deepEqual(completionCalls, [{ winner: "guest", reason: "quit_forfeit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(controller.match.endReason, "quit_forfeit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local authoritative rematch start resets to a fresh room-backed state", async () => {
  const originalWindow = globalThis.window;
  const createdRooms = [];
  const roomA = createAuthoritativeLocalRoom({
    roomCode: "AAA111",
    roundNumber: 4,
    hostHand: { fire: 5, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 1, earth: 1, wind: 1 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });
  const roomB = createAuthoritativeLocalRoom({
    roomCode: "BBB222",
    roundNumber: 1,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    roundHistory: []
  });
  const fakeStore = {
    createRoom: () => {
      const room = createdRooms.length === 0 ? roomA : roomB;
      createdRooms.push(room.roomCode);
      return { ok: true, room };
    },
    joinRoom: () => ({ ok: true, room: createdRooms.length === 1 ? roomA : roomB })
  };
  const controller = new GameController({
    username: "LocalRematchAuthority",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    localAuthorityStoreFactory: () => fakeStore,
    persistMatchResults: false,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    assert.equal(controller.match.id, "AAA111:match:1");
    assert.equal(controller.match.round, 3);
    assert.ok(controller.match.history.length > 0);

    controller.startNewMatch();
    assert.deepEqual(createdRooms, ["AAA111", "BBB222"]);
    assert.equal(controller.match.id, "BBB222:match:1");
    assert.equal(controller.match.round, 0);
    assert.deepEqual(controller.match.history, []);
    assert.equal(controller.match.players.p1.hand.length, 8);
    assert.equal(controller.match.players.p2.hand.length, 8);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: Featured Rival PvE starts with an 8-card player hand, a 12-card rival hand, and 20 total cards", async () => {
  const originalWindow = globalThis.window;
  const controller = new GameController({
    username: "CrownfireChallenger",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    aiDifficulty: "normal",
    featuredRivalId: "crownfire_duelist",
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    assert.equal(controller.match.players.p1.hand.length, 8);
    assert.equal(controller.match.players.p2.hand.length, 12);
    assert.equal(controller.match.meta.totalCards, 20);

    const room = controller.localAuthority.store.getRoom(controller.localAuthority.roomCode);
    assert.deepEqual(room.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(room.guestHand, { fire: 3, water: 3, earth: 3, wind: 3 });
    assert.equal(room.featuredRivalId, "crownfire_duelist");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: Featured Rival rematch resets back to the same asymmetric 8 vs 12 hand counts", async () => {
  const originalWindow = globalThis.window;
  const controller = new GameController({
    username: "CrownfireRematch",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    aiDifficulty: "normal",
    featuredRivalId: "crownfire_duelist",
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const store = controller.localAuthority.store;
    const hostSocketId = controller.localAuthority.hostSocket.id;
    const guestSocketId = controller.localAuthority.guestSocket.id;

    const completed = store.completeMatch(hostSocketId, { winner: "guest", reason: "manual_test" });
    assert.equal(completed.ok, true);

    const firstReady = store.readyRematch(hostSocketId);
    assert.equal(firstReady.ok, true);
    assert.equal(firstReady.rematchStarted, false);

    const secondReady = store.readyRematch(guestSocketId);
    assert.equal(secondReady.ok, true);
    assert.equal(secondReady.rematchStarted, true);
    assert.deepEqual(secondReady.room.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(secondReady.room.guestHand, { fire: 3, water: 3, earth: 3, wind: 3 });
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: Featured Rival completion persists featuredRivalId on the settled match payload", async () => {
  const originalWindow = globalThis.window;
  const persistedCalls = [];
  const completedMatches = [];
  const controller = new GameController({
    username: "CrownfirePersistence",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    aiDifficulty: "normal",
    featuredRivalId: "crownfire_duelist",
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: ({ match }) => completedMatches.push(match)
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async (payload) => {
            persistedCalls.push(payload);
            return { ok: true };
          }
        }
      }
    };

    controller.startNewMatch();
    await controller.quitMatch({ quitter: "p2", reason: "quit_forfeit" });

    assert.equal(persistedCalls.length, 1);
    assert.equal(persistedCalls[0].matchState.featuredRivalId, "crownfire_duelist");
    assert.equal(completedMatches.length, 1);
    assert.equal(completedMatches[0].featuredRivalId, "crownfire_duelist");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: normal PvE still starts with symmetric 8 vs 8 hands", async () => {
  const originalWindow = globalThis.window;
  const controller = new GameController({
    username: "StandardPve",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    aiDifficulty: "hard",
    localAuthorityStoreFactory: () => createRoomStore({ random: () => 0 }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    assert.equal(controller.match.players.p1.hand.length, 8);
    assert.equal(controller.match.players.p2.hand.length, 8);
    assert.equal(controller.match.meta.totalCards, 16);

    const room = controller.localAuthority.store.getRoom(controller.localAuthority.roomCode);
    assert.deepEqual(room.hostHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.deepEqual(room.guestHand, { fire: 2, water: 2, earth: 2, wind: 2 });
    assert.equal(room.featuredRivalId, null);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: WAR pile preview reflects committed WAR cards", () => {
  const controller = new GameController({
    username: "WarPreviewUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  controller.match = createMinimalMatch(MATCH_MODE.PVE);
  controller.match.war = { active: true, clashes: 1, pendingClashes: 1, pendingPileSizes: [2] };
  controller.match.currentPile = ["fire", "earth"];
  controller.lastRound = {
    round: 1,
    p1Card: "fire",
    p2Card: "fire",
    result: "p1",
    warClashes: 1,
    capturedCards: 4,
    warPileSize: 2,
    warPileSizes: [2, 4]
  };

  let vm = controller.getViewModel();
  assert.equal(vm.warPileCards.length, 2);
  assert.deepEqual(vm.warPileCards, ["fire", "earth"]);

  controller.match.currentPile = ["fire", "earth", "water", "wind"];
  controller.match.war.pendingPileSizes = [2, 4];
  vm = controller.getViewModel();
  assert.equal(vm.warPileCards.length, 4);
  assert.deepEqual(vm.warPileCards, ["fire", "earth", "water", "wind"]);

  controller.match.war.active = false;
  controller.match.currentPile = [];
  vm = controller.getViewModel();
  assert.equal(vm.warPileCards.length, 0);
  assert.deepEqual(vm.warPileCards, []);
});

test("gameController: local turn timer counts down and times out", async () => {
  const originalWindow = globalThis.window;
  let timeoutTurn = null;

  const controller = new GameController({
    username: "TimerLocal",
    mode: MATCH_MODE.LOCAL_PVP,
    timerSeconds: 2,
    onUpdate: () => {},
    onHotseatTurnTimeout: async (turn) => {
      timeoutTurn = turn;
    },
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.match = createMinimalMatch(MATCH_MODE.LOCAL_PVP);
    controller.hotseatTurn = "p1";
    controller.resetTimer();
    controller.resumeLocalTurnTimer();

    await new Promise((resolve) => setTimeout(resolve, 2200));

    assert.equal(timeoutTurn, "p1");
    assert.equal(controller.timerId, null);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: local mode opens setup screen before match start", () => {
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "SignedInUser";
  app.onlinePlayState = app.normalizeOnlinePlayState({
    session: {
      authenticated: true,
      username: "SignedInUser"
    }
  });
  app.showMenu();
  shownScreens.at(-1).context.actions.startLocalGame();

  assert.equal(shownScreens.at(-1).name, "localSetup");
  assert.equal(shownScreens.at(-1).context.player1.authenticated, true);
  assert.equal(shownScreens.at(-1).context.player1.username, "SignedInUser");
  assert.equal(shownScreens.at(-1).context.player2.mode, "login");
});

test("appController: Play vs AI from the main menu opens the difficulty screen instead of starting immediately", () => {
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "hard", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "PveChooser";
  app.profile = { username: "PveChooser" };

  app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
  shownScreens.at(-1).context.actions.startPveGame();

  assert.equal(shownScreens.at(-1).name, "aiDifficulty");
  assert.equal(shownScreens.at(-1).context.selectedDifficulty, "hard");
});

test("appController: ai difficulty screen back action returns to the main menu", () => {
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "PveChooser";
  app.profile = { username: "PveChooser" };

  app.showAiDifficultySelect();
  shownScreens.at(-1).context.actions.back();

  assert.equal(shownScreens.at(-1).name, "menu");
});

test("appController: switch account clears authenticated state and returns to login", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    logout: 0,
    getState: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          logout: async () => {
            calls.logout += 1;
          },
          getState: async () => {
            calls.getState += 1;
            return {
              connectionStatus: "disconnected",
              session: {
                active: false,
                username: null,
                sessionId: null,
                accountId: null,
                profileKey: null,
                authenticated: false
              },
              room: null,
              lastError: null,
              statusMessage: "Signed out."
            };
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", tokens: 250 };
    app.dailyChallenges = { daily: { challenges: [] }, weekly: { challenges: [] } };
    app.menuBoostEvent = { title: "Active Boost" };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "SignedInUser",
        sessionId: "session-1",
        accountId: "account-1",
        profileKey: "SignedInUser",
        authenticated: true
      }
    });

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await shownScreens.at(-1).context.actions.switchAccount();

    assert.equal(calls.logout, 1);
    assert.equal(calls.getState, 1);
    assert.equal(app.username, null);
    assert.equal(app.profile, null);
    assert.equal(app.menuBoostEvent, null);
    assert.equal(shownScreens.at(-1).name, "login");
    assert.equal(shownScreens.at(-1).context.statusMessage, "Signed out. Sign in with another account.");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: local hotseat setup resolves both players from authenticated account profiles", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  let startedMode = null;
  const calls = {
    multiplayerGetProfile: 0,
    authenticateHotseatIdentity: 0,
    ensureProfile: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode) => {
    startedMode = mode;
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async () => {
            calls.ensureProfile += 1;
            throw new Error("local ensureProfile should not be used for authenticated hotseat setup");
          }
        },
        multiplayer: {
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              username: "SignedInUser",
              profile: {
                username: "SignedInUser",
                tokens: 200,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {
                  avatar: "default_avatar",
                  background: "default_background",
                  badge: "none",
                  title: "Initiate",
                  cardBack: "default_card_back",
                  elementCardVariant: {
                    fire: "default_fire_card",
                    water: "default_water_card",
                    earth: "default_earth_card",
                    wind: "default_wind_card"
                  }
                },
                owned: {}
              },
              stats: {
                summary: {
                  wins: 1,
                  losses: 0,
                  gamesPlayed: 1,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 1
                },
                modes: {}
              },
              currency: {
                tokens: 200
              }
            };
          },
          authenticateHotseatIdentity: async () => {
            calls.authenticateHotseatIdentity += 1;
            return {
              ok: true,
              account: {
                accountId: "account-p2"
              },
              session: {
                accountId: "account-p2",
                username: "SecondPlayer"
              },
              profile: {
                username: "SecondPlayer",
                profile: {
                  username: "SecondPlayer",
                  tokens: 180,
                  equippedCosmetics: {}
                },
                cosmetics: {
                  equipped: {
                    avatar: "default_avatar",
                    background: "default_background",
                    badge: "none",
                    title: "Initiate",
                    cardBack: "default_card_back",
                    elementCardVariant: {
                      fire: "default_fire_card",
                      water: "default_water_card",
                      earth: "default_earth_card",
                      wind: "default_wind_card"
                    }
                  },
                  owned: {}
                },
                stats: {
                  summary: {
                    wins: 2,
                    losses: 3,
                    gamesPlayed: 5,
                    warsEntered: 1,
                    warsWon: 0,
                    cardsCaptured: 4
                  },
                  modes: {}
                },
                currency: {
                  tokens: 180
                }
              }
            };
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      session: {
        authenticated: true,
        username: "SignedInUser",
        accountId: "account-p1"
      }
    });

    app.showLocalSetup();
    await shownScreens.at(-1).context.actions.start({
      p1: { authenticated: true },
      p2: {
        mode: "login",
        email: "p2@example.com",
        password: "password123",
        username: ""
      }
    });

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.authenticateHotseatIdentity, 1);
    assert.equal(calls.ensureProfile, 0);
    assert.equal(app.localPlayers.p1, "SignedInUser");
    assert.equal(app.localPlayers.p2, "SecondPlayer");
    assert.equal(app.localProfiles.p1.username, "SignedInUser");
    assert.equal(app.localProfiles.p2.username, "SecondPlayer");
    assert.equal(startedMode, MATCH_MODE.LOCAL_PVP);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: menu online play action opens the online play screen", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    getState: 0,
    connect: 0
  };
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => {
            calls.getState += 1;
            return {
              connectionStatus: "disconnected",
              room: null,
              statusMessage: "Offline. Open Online Play to connect."
            };
          },
          connect: async () => {
            calls.connect += 1;
            const state = {
              connectionStatus: "connected",
              socketId: "socket-1",
              room: null,
              lastError: null,
              statusMessage: "Connected. Create a room or join one."
            };
            for (const listener of updateListeners) {
              listener(state);
            }
            return state;
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await shownScreens.at(-1).context.actions.openOnlinePlay();

    assert.equal(calls.getState, 1);
    assert.equal(calls.connect, 1);
    assert.equal(shownScreens.at(-1).name, "onlinePlay");
    assert.equal(shownScreens.at(-1).context.username, "SignedInUser");
    assert.equal(shownScreens.at(-1).context.multiplayer.connectionStatus, "connected");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: menu announcements fetch and dismiss through the multiplayer profile path", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    listAnnouncements: [],
    dismissAnnouncement: []
  };
  let renderCount = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => ({
            authority: "server",
            source: "multiplayer",
            profile: {
              username,
              equippedCosmetics: {}
            },
            progression: {}
          }),
          listAnnouncements: async ({ username }) => {
            calls.listAnnouncements.push({ username });
            return {
              announcements: [
                {
                  id: "patch-2-1-9",
                  title: "v2.1.9 Patch Live",
                  message: "Fixed the Profile reward popup loop reported by Bane.",
                  type: "patch",
                  priority: 10,
                  dismissible: true
                }
              ],
              snapshot: {
                authority: "server",
                source: "multiplayer",
                profile: {
                  username,
                  seenAnnouncements: {}
                },
                progression: {}
              }
            };
          },
          dismissAnnouncement: async ({ username, id }) => {
            calls.dismissAnnouncement.push({ username, id });
            return {
              announcements: [],
              snapshot: {
                authority: "server",
                source: "multiplayer",
                profile: {
                  username,
                  seenAnnouncements: {
                    [`announcement:${id}`]: true
                  }
                },
                progression: {}
              }
            };
          }
        }
      }
    };

    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      equippedCosmetics: { background: "default_background" },
      seenAnnouncements: {}
    };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "AnnouncementUser"
      }
    });
    app.screenFlow = "menu";
    app.renderMenuScreen = () => {
      renderCount += 1;
    };

    await app.refreshMenuAnnouncement();

    assert.deepEqual(calls.listAnnouncements, [{ username: "AnnouncementUser" }]);
    assert.equal(app.menuAnnouncement?.id, "patch-2-1-9");
    assert.equal(renderCount, 1);

    await app.dismissMenuAnnouncement("patch-2-1-9");

    assert.deepEqual(calls.dismissAnnouncement, [
      { username: "AnnouncementUser", id: "patch-2-1-9" }
    ]);
    assert.equal(app.menuAnnouncement, null);
    assert.equal(app.profile?.seenAnnouncements?.["announcement:patch-2-1-9"], true);
    assert.equal(renderCount, 2);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: refreshMenuAnnouncement does not degrade a hydrated authenticated profile with a partial snapshot", async () => {
  const originalWindow = globalThis.window;
  let renderCount = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({}),
          listAnnouncements: async ({ username }) => ({
            announcements: [
              {
                id: "patch-2-1-58",
                title: "v2.1.58",
                message: "Patch live.",
                dismissible: true
              }
            ],
            snapshot: {
              authority: "server",
              profile: {
                username,
                tokens: 0,
                playerXP: 0,
                playerLevel: 1,
                equippedCosmetics: {
                  background: "default_background"
                },
                seenAnnouncements: {}
              },
              progression: {}
            }
          })
        }
      }
    };

    app.username = "AnnouncementUser";
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "AnnouncementUser"
      }
    });
    app.profile = {
      username: "AnnouncementUser",
      tokens: 245,
      playerXP: 83,
      playerLevel: 4,
      equippedCosmetics: {
        background: "authority_bg"
      },
      seenAnnouncements: {}
    };
    app.setOwnProfileHydrationState("ready", { username: "AnnouncementUser" });
    app.rememberAuthoritativeOwnProfile(app.profile, {
      username: "AnnouncementUser",
      onlineState: app.onlinePlayState
    });
    app.screenFlow = "menu";
    app.renderMenuScreen = () => {
      renderCount += 1;
    };

    await app.refreshMenuAnnouncement();

    assert.equal(app.menuAnnouncement?.id, "patch-2-1-58");
    assert.equal(app.profile?.tokens, 245);
    assert.equal(app.profile?.playerXP, 83);
    assert.equal(app.profile?.playerLevel, 4);
    assert.equal(app.profile?.equippedCosmetics?.background, "authority_bg");
    assert.equal(renderCount, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: menu boost event refreshes through the multiplayer profile path", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    getActiveBoostEvent: []
  };
  let renderCount = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({}),
          getActiveBoostEvent: async ({ username }) => {
            calls.getActiveBoostEvent.push({ username });
            return {
              enabled: true,
              title: "Online Players X2 XP Weekend",
              message: "Earn double XP in Online Play this weekend.",
              startsAt: "2026-05-22T18:00:00.000Z",
              endsAt: "2026-05-25T06:00:00.000Z",
              scope: "online",
              excludeDifficulties: [],
              xpMultiplier: 2,
              tokenMultiplier: 1
            };
          }
        }
      }
    };

    app.username = "BoostUser";
    app.profile = {
      username: "BoostUser",
      equippedCosmetics: { background: "default_background" }
    };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });
    app.screenFlow = "menu";
    app.renderMenuScreen = () => {
      renderCount += 1;
    };

    await app.refreshMenuBoostEvent();

    assert.deepEqual(calls.getActiveBoostEvent, [{ username: "BoostUser" }]);
    assert.equal(app.menuBoostEvent?.title, "Online Players X2 XP Weekend");
    assert.equal(app.menuBoostEvent?.scope, "online");
    assert.match(app.menuBoostEvent?.endsAtLabel ?? "", /\w{3}/);
    assert.equal(renderCount, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: menu boost event refresh keeps an existing banner when the multiplayer request fails", async () => {
  const originalWindow = globalThis.window;
  let renderCount = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

    try {
      globalThis.window = {
        elemintz: {
          multiplayer: {
            getProfile: async () => ({}),
            getActiveBoostEvent: async () => {
              throw new Error("temporary offline");
            }
          }
        }
      };

      app.username = "BoostUser";
      app.menuBoostEvent = {
        title: "Old Boost"
      };
      app.onlinePlayState = app.normalizeOnlinePlayState({
        connectionStatus: "connected",
        session: {
        authenticated: true,
        username: "BoostUser"
      }
    });
    app.screenFlow = "menu";
    app.renderMenuScreen = () => {
      renderCount += 1;
    };

      const result = await app.refreshMenuBoostEvent();

      assert.equal(result, null);
      assert.deepEqual(app.menuBoostEvent, {
        title: "Old Boost"
      });
      assert.equal(renderCount, 0);
    } finally {
      globalThis.window = originalWindow;
    }
  });

test("appController: menu boost event refresh preserves an existing banner when the multiplayer boost bridge is unavailable", async () => {
  const originalWindow = globalThis.window;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({})
        }
      }
    };

    app.username = "BoostUser";
    app.menuBoostEvent = {
      title: "Old Boost"
    };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });

    const result = await app.refreshMenuBoostEvent();

    assert.equal(result, null);
    assert.deepEqual(app.menuBoostEvent, {
      title: "Old Boost"
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: menu boost event refresh preserves an existing banner when multiplayer access is temporarily unavailable", async () => {
  const originalWindow = globalThis.window;
  let renderCount = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {}
      }
    };
    app.username = "BoostUser";
    app.profile = { username: "BoostUser", equippedCosmetics: {} };
    app.menuBoostEvent = { title: "Old Boost" };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "disconnected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });
    app.screenFlow = "menu";
    app.renderMenuScreen = () => {
      renderCount += 1;
    };

    const result = await app.refreshMenuBoostEvent();

    assert.equal(result, null);
    assert.deepEqual(app.menuBoostEvent, { title: "Old Boost" });
    assert.equal(renderCount, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: menu boost event refresh clears an existing banner when the server returns no active event", async () => {
  const originalWindow = globalThis.window;
  let renderCount = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({}),
          getActiveBoostEvent: async () => null
        }
      }
    };
    app.username = "BoostUser";
    app.profile = { username: "BoostUser", equippedCosmetics: {} };
    app.menuBoostEvent = { title: "Old Boost" };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });
    app.screenFlow = "menu";
    app.renderMenuScreen = () => {
      renderCount += 1;
    };

    const result = await app.refreshMenuBoostEvent();

    assert.equal(result, null);
    assert.equal(app.menuBoostEvent, null);
    assert.equal(renderCount, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: boost banner survives online play return to menu when boost refresh is temporarily unavailable", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({}),
          getState: async () => ({ connectionStatus: "disconnected" }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            session: {
              authenticated: true,
              username: "BoostUser"
            }
          }),
          listPublicRooms: async () => [],
          getOnlineCount: async () => 2
        }
      }
    };

    app.username = "BoostUser";
    app.profile = { username: "BoostUser", equippedCosmetics: {} };
    app.menuBoostEvent = { title: "Persisted Boost" };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });
    app.refreshDailyChallengesForMenu = async () => {};
    app.refreshMenuAnnouncement = async () => {};

    await app.showOnlinePlay();
    await Promise.resolve();
    await Promise.resolve();

    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "disconnected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(shownScreens.at(-1)?.name, "menu");
    assert.deepEqual(app.menuBoostEvent, { title: "Persisted Boost" });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: returning from online play to menu preserves the remembered authoritative profile", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getState: async () => ({ connectionStatus: "disconnected" }),
          connect: async () => ({
            connectionStatus: "connected",
            session: {
              authenticated: true,
              username: "MenuUser"
            }
          }),
          disconnect: async () => ({}),
          getProfile: async () => ({
            authority: "server",
            profile: {
              username: "MenuUser",
              tokens: 0,
              playerXP: 0,
              playerLevel: 1,
              equippedCosmetics: {
                background: "default_background"
              }
            },
            progression: {}
          }),
          listPublicRooms: async () => [],
          getOnlineCount: async () => 1
        }
      }
    };

    app.username = "MenuUser";
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "MenuUser"
      }
    });
    app.profile = {
      username: "MenuUser",
      tokens: 245,
      playerXP: 83,
      playerLevel: 4,
      equippedCosmetics: {
        background: "authority_bg"
      }
    };
    app.setOwnProfileHydrationState("ready", { username: "MenuUser" });
    app.rememberAuthoritativeOwnProfile(app.profile, {
      username: "MenuUser",
      onlineState: app.onlinePlayState
    });
    app.refreshDailyChallengesForMenu = async () => {};
    app.refreshMenuAnnouncement = async () => {};
    app.refreshMenuBoostEvent = async () => {};
    app.updateOnlineReconnectReminderModal = () => {};
    app.releaseQueuedAdminGrantNotice = () => {};
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.maybeShowNewCosmeticsAnnouncement = async () => {};
    app.dailyChallenges = {
      daily: { msUntilReset: 0, challenges: [] },
      weekly: { msUntilReset: 0, challenges: [] },
      dailyLogin: { eligible: false, msUntilReset: 0 }
    };

    await app.showOnlinePlay();

    app.profile = {
      username: "MenuUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      equippedCosmetics: {
        background: "default_background"
      }
    };
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });

    const menuContext = shownScreens.at(-1)?.context;
    assert.equal(shownScreens.at(-1)?.name, "menu");
    assert.equal(app.profile?.tokens, 245);
    assert.equal(app.profile?.playerXP, 83);
    assert.equal(app.profile?.playerLevel, 4);
    assert.equal(app.profile?.equippedCosmetics?.background, "authority_bg");
    assert.equal(menuContext?.backgroundImage, app.getBackgroundFromProfile(app.profile));
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: showMenu refreshes the boost event on entry", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({}),
          getActiveBoostEvent: async ({ username }) => {
            calls.push(username);
            return {
              enabled: true,
              title: "Menu Boost",
              message: "Boost is active.",
              endsAt: "2026-05-25T06:00:00.000Z",
              scope: "online",
              xpMultiplier: 2,
              tokenMultiplier: 1
            };
          }
        }
      }
    };

    app.username = "BoostUser";
    app.profile = { username: "BoostUser", equippedCosmetics: {} };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });
    app.refreshDailyChallengesForMenu = async () => {};
    app.refreshMenuAnnouncement = async () => {};

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls, ["BoostUser"]);
    assert.equal(app.menuBoostEvent?.title, "Menu Boost");
    assert.equal(shownScreens.at(-1)?.name, "menu");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: returning to menu after a match refreshes the boost event again", async () => {
  const originalWindow = globalThis.window;
  const calls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({}),
          getActiveBoostEvent: async ({ username }) => {
            calls.push(username);
            return {
              enabled: true,
              title: `Boost ${calls.length}`,
              message: "Refresh me.",
              scope: "online",
              xpMultiplier: 2,
              tokenMultiplier: 1
            };
          }
        }
      }
    };

    app.username = "BoostUser";
    app.profile = { username: "BoostUser", equippedCosmetics: {} };
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "BoostUser"
      }
    });
    app.refreshDailyChallengesForMenu = async () => {};
    app.refreshMenuAnnouncement = async () => {};

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls, ["BoostUser", "BoostUser"]);
    assert.equal(app.menuBoostEvent?.title, "Boost 2");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play create join submit-move and ready-rematch actions use the multiplayer bridge", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
    const calls = {
      createRoom: [],
      listPublicRooms: [],
      getOnlineCount: [],
      joinRoom: [],
      submitMove: [],
      readyRematch: 0
  };
  const playableOnlineState = {
    connectionStatus: "connected",
    socketId: "socket-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      host: { socketId: "socket-1", username: "SignedInUser-Canonical" },
      guest: { socketId: "socket-2", username: "OtherUser" },
      hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
      guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
      moveSync: {
        hostSubmitted: false,
        guestSubmitted: false,
        submittedCount: 0,
        bothSubmitted: false,
        updatedAt: null
      },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      matchComplete: false,
      rematch: { hostReady: false, guestReady: false }
    },
    lastError: null,
    statusMessage: "Connected. Create a room or join one."
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => playableOnlineState,
          connect: async () => playableOnlineState,
          getProfile: async ({ username }) => ({
            username: canonicalizeUsername(username),
            profile: {
              username: canonicalizeUsername(username),
              playerXP: 12,
              playerLevel: 2
            },
            cosmetics: {
              equipped: {
                avatar: "avatar_arcane_gambler",
                cardBack: "default_card_back",
                background: "bg_crystal_nexus",
                elementCardVariant: {
                  fire: "default_fire_card",
                  water: "default_water_card",
                  earth: "default_earth_card",
                  wind: "default_wind_card"
                },
                title: "Flame Vanguard",
                badge: "first_flame"
              },
              owned: {}
            },
            stats: {
              summary: {
                wins: 9,
                losses: 4,
                gamesPlayed: 13,
                warsEntered: 2,
                warsWon: 1,
                cardsCaptured: 18
              },
              modes: {}
            },
            currency: {
              tokens: 415
            },
            progression: {
              dailyChallenges: { challenges: [], msUntilReset: 3600000 },
              weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
              dailyLogin: { eligible: false, msUntilReset: 3600000 }
            }
          }),
          createRoom: async (payload) => {
            calls.createRoom.push(payload);
            return playableOnlineState;
          },
          listPublicRooms: async (payload) => {
            calls.listPublicRooms.push(payload);
            return [
              {
                roomCode: "PUB123",
                createdAt: "2026-05-12T12:00:00.000Z",
                hostUsername: "PublicHost",
                visibility: "public",
                status: "waiting"
              }
            ];
          },
          getOnlineCount: async (payload) => {
            calls.getOnlineCount.push(payload);
            return 3;
          },
          joinRoom: async (payload) => {
            calls.joinRoom.push(payload);
            return playableOnlineState;
          },
          submitMove: async ({ move }) => {
            calls.submitMove.push(move);
            return playableOnlineState;
          },
          readyRematch: async () => {
            calls.readyRematch += 1;
            return playableOnlineState;
          },
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();

    await shownScreens.at(-1).context.actions.createRoom();
    await shownScreens.at(-1).context.actions.setCreateRoomVisibility("public");
    await shownScreens.at(-1).context.actions.createRoom();
    await shownScreens.at(-1).context.actions.browsePublicRooms();
    assert.equal(app.onlinePublicRoomsStatus, "ready");
    assert.deepEqual(app.onlinePublicRooms, [
      {
        roomCode: "PUB123",
        createdAt: "2026-05-12T12:00:00.000Z",
        hostUsername: "PublicHost",
        visibility: "public",
        status: "waiting"
      }
    ]);
    await shownScreens.at(-1).context.actions.joinRoom("abc123");
    await shownScreens.at(-1).context.actions.submitMove("fire");
    await shownScreens.at(-1).context.actions.readyRematch();

    const expectedIdentityPayload = {
      username: "SignedInUser-Canonical",
      equippedCosmetics: {
        avatar: "avatar_arcane_gambler",
        cardBack: "default_card_back",
        background: "bg_crystal_nexus",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        title: "Flame Vanguard",
        badge: "first_flame"
      }
    };

    assert.deepEqual(calls.createRoom, [
      { ...expectedIdentityPayload, visibility: "private" },
      { ...expectedIdentityPayload, visibility: "public" }
    ]);
    assert.deepEqual(calls.listPublicRooms, [
      { username: "SignedInUser-Canonical" },
      { username: "SignedInUser-Canonical" },
      { username: "SignedInUser-Canonical" }
    ]);
    assert.deepEqual(calls.getOnlineCount, [
      { username: "SignedInUser-Canonical" },
      { username: "SignedInUser-Canonical" },
      { username: "SignedInUser-Canonical" }
    ]);
    assert.deepEqual(calls.joinRoom, [{ roomCode: "ABC123", ...expectedIdentityPayload }]);
    assert.deepEqual(calls.submitMove, ["fire"]);
    assert.equal(calls.readyRematch, 1);
    assert.equal(app.onlinePlayJoinCode, "ABC123");
    assert.equal(app.onlinePlayerCount, 3);
    assert.equal(app.username, "SignedInUser-Canonical");
    assert.equal(app.profile.tokens, 415);
    assert.equal(app.profile.wins, 9);
    assert.equal(app.profile.equippedCosmetics.background, "bg_crystal_nexus");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: entering online play auto-refreshes public rooms and online count", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    listPublicRooms: [],
    getOnlineCount: []
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (screen, context) => shownScreens.push({ screen, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => ({
            username: "SignedInUser-Canonical",
            equippedCosmetics: {}
          }),
          getDailyChallengesSummary: async () => null
        },
        multiplayer: {
          getState: async () => ({ connectionStatus: "disconnected" }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            session: {
              authenticated: true,
              username: "SignedInUser-Canonical"
            }
          }),
          getProfile: async () => ({
            username: "SignedInUser-Canonical",
            equippedCosmetics: {}
          }),
          listPublicRooms: async (payload) => {
            calls.listPublicRooms.push(payload);
            return [];
          },
          getOnlineCount: async (payload) => {
            calls.getOnlineCount.push(payload);
            return 3;
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(shownScreens.at(-1).screen, "onlinePlay");
    assert.deepEqual(calls.listPublicRooms, [
      { username: "SignedInUser-Canonical" },
      { username: "SignedInUser-Canonical" }
    ]);
    assert.deepEqual(calls.getOnlineCount, [
      { username: "SignedInUser-Canonical" },
      { username: "SignedInUser-Canonical" }
    ]);
    assert.equal(app.onlinePublicRoomsStatus, "ready");
    assert.equal(app.onlinePlayerCount, 3);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play manual refresh reuses in-flight lobby refresh requests", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    listPublicRooms: 0,
    getOnlineCount: 0
  };
  let resolveRooms;
  let resolveCount;
  const roomsPromise = new Promise((resolve) => {
    resolveRooms = resolve;
  });
  const countPromise = new Promise((resolve) => {
    resolveCount = resolve;
  });

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (screen, context) => shownScreens.push({ screen, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => ({
            username: "SignedInUser-Canonical",
            equippedCosmetics: {}
          }),
          getDailyChallengesSummary: async () => null
        },
        multiplayer: {
          getState: async () => ({ connectionStatus: "disconnected" }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            session: {
              authenticated: true,
              username: "SignedInUser-Canonical"
            }
          }),
          getProfile: async () => ({
            username: "SignedInUser-Canonical",
            equippedCosmetics: {}
          }),
          listPublicRooms: async () => {
            calls.listPublicRooms += 1;
            return roomsPromise;
          },
          getOnlineCount: async () => {
            calls.getOnlineCount += 1;
            return countPromise;
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    const showPromise = app.showOnlinePlay();
    await showPromise;
    const manualRefreshPromise = shownScreens.at(-1).context.actions.browsePublicRooms();

    assert.equal(calls.listPublicRooms, 1);
    assert.equal(calls.getOnlineCount, 1);
    assert.equal(app.onlinePublicRoomsStatus, "loading");
    assert.equal(app.onlinePlayerCountStatus, "loading");

    resolveRooms([]);
    resolveCount(2);
    await manualRefreshPromise;

    assert.equal(calls.listPublicRooms, 1);
    assert.equal(calls.getOnlineCount, 1);
    assert.equal(app.onlinePublicRoomsStatus, "ready");
    assert.equal(app.onlinePlayerCount, 2);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play survives failed auto-refresh for count and public rooms", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (screen, context) => shownScreens.push({ screen, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => ({
            username: "SignedInUser-Canonical",
            equippedCosmetics: {}
          }),
          getDailyChallengesSummary: async () => null
        },
        multiplayer: {
          getState: async () => ({
            connectionStatus: "connected",
            lastError: "rooms_failed",
            statusMessage: "Unable to load public rooms."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            session: {
              authenticated: true,
              username: "SignedInUser-Canonical"
            }
          }),
          getProfile: async () => ({
            username: "SignedInUser-Canonical",
            equippedCosmetics: {}
          }),
          listPublicRooms: async () => null,
          getOnlineCount: async () => {
            throw new Error("count failed");
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(shownScreens.at(-1).screen, "onlinePlay");
    assert.equal(app.onlinePlayerCount, null);
    assert.equal(app.onlinePlayerCountStatus, "error");
    assert.equal(app.onlinePublicRoomsStatus, "error");
    assert.match(app.onlinePublicRoomsError, /Unable to load public rooms/i);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: feedback modal validates empty messages and submits through the multiplayer bridge", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const modalCalls = [];
  const feedbackCalls = [];
  const modalState = { hidden: false };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (screen, context) => shownScreens.push({ screen, context })
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {
        modalState.hidden = true;
      }
    },
    toastManager: { show: () => {} }
  });

  const elements = {
    "feedback-category-select": createFakeDomElement({ value: "Bug / Error" }),
    "feedback-message-textarea": createFakeDomElement({ value: "   " }),
    "feedback-include-debug-checkbox": createFakeDomElement({ checked: true }),
    "feedback-submit-btn": createFakeDomElement(),
    "feedback-cancel-btn": createFakeDomElement(),
    "feedback-modal-error": createFakeDomElement({ hidden: true })
  };

  globalThis.document = {
    getElementById: (id) => elements[id] ?? null,
    querySelector: () => null
  };

  globalThis.window = {
    elemintz: {
      version: "2.1.3",
      multiplayer: {
        submitFeedback: async (payload) => {
          feedbackCalls.push(payload);
          return {
            feedbackId: "fb_test",
            storedAt: "2026-05-13T12:00:00.000Z"
          };
        }
      }
    }
  };

  try {
    app.username = "FeedbackUser";
    app.screenFlow = "menu";
    app.onlinePlayState = {
      connectionStatus: "connected",
      room: { roomCode: "ROOM123" },
      lastError: { message: "Recent error" }
    };
    app.renderMenuScreen();

    shownScreens.at(-1).context.actions.openFeedback();
    assert.equal(modalCalls.at(-1)?.title, "Send Feedback");
    assert.match(modalCalls.at(-1)?.bodyHtml ?? "", /feedback-category-select/);
    assert.match(modalCalls.at(-1)?.bodyHtml ?? "", /feedback-message-textarea/);

    await elements["feedback-submit-btn"].listeners.get("click")?.();
    assert.equal(feedbackCalls.length, 0);
    assert.equal(elements["feedback-modal-error"].hidden, false);
    assert.match(elements["feedback-modal-error"].textContent, /Please enter a feedback message\./);

    elements["feedback-message-textarea"].value = "Public rooms were hard to find.";
    elements["feedback-category-select"].value = "Online Room Issue";
    await elements["feedback-submit-btn"].listeners.get("click")?.();

    assert.equal(feedbackCalls.length, 1);
    assert.deepEqual(feedbackCalls[0], {
      username: "FeedbackUser",
      category: "Online Room Issue",
      message: "Public rooms were hard to find.",
      includeDebugInfo: true,
      clientContext: {
        appVersion: "2.1.3",
        platform: globalThis.navigator?.platform ?? null,
        screen: "menu",
        connectionStatus: "connected",
        mode: "online",
        pveDifficulty: null,
        roomCode: "ROOM123",
        recentErrorMessage: "Recent error"
      }
    });
    assert.equal(modalState.hidden, true);
    assert.equal(modalCalls.at(-1)?.title, "Feedback Sent");
    assert.equal(modalCalls.at(-1)?.body, "Feedback sent. Thank you.");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("appController: feedback submission failure shows a readable error modal", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const modalCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  const elements = {
    "feedback-category-select": createFakeDomElement({ value: "Suggestion" }),
    "feedback-message-textarea": createFakeDomElement({ value: "Add more room browser filters." }),
    "feedback-include-debug-checkbox": createFakeDomElement({ checked: false }),
    "feedback-submit-btn": createFakeDomElement(),
    "feedback-cancel-btn": createFakeDomElement(),
    "feedback-modal-error": createFakeDomElement({ hidden: true })
  };

  globalThis.document = {
    getElementById: (id) => elements[id] ?? null,
    querySelector: () => null
  };

  globalThis.window = {
    elemintz: {
      multiplayer: {
        submitFeedback: async () => {
          throw new Error("Server feedback log is unavailable.");
        }
      }
    }
  };

  try {
    app.showFeedbackModal();
    await elements["feedback-submit-btn"].listeners.get("click")?.();
    assert.equal(modalCalls.at(-1)?.title, "Feedback Failed");
    assert.equal(modalCalls.at(-1)?.body, "Server feedback log is unavailable.");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("appController: online settlement refresh prefers the multiplayer-authoritative profile snapshot", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0,
    localGetDailyChallenges: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              profile: {
                username,
                tokens: 245,
                playerXP: 18,
                playerLevel: 1,
                equippedCosmetics: {}
              },
              progression: {
                xp: {
                  playerXP: 18,
                  playerLevel: 1
                },
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        },
        state: {
          getProfile: async () => {
            calls.localGetProfile += 1;
            return null;
          },
          getDailyChallenges: async () => {
            calls.localGetDailyChallenges += 1;
            return null;
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", tokens: 200, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

    const settledState = {
      room: {
        roomCode: "ABC123",
        matchComplete: true,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-28T18:00:00.000Z",
          summary: {
            settledHostUsername: "SignedInUser",
            settledGuestUsername: "OtherPlayer"
          }
        }
      }
    };

    await app.refreshLocalProfileAfterOnlineSettlement(settledState);

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 0);
    assert.equal(calls.localGetDailyChallenges, 0);
    assert.equal(app.profile.tokens, 245);
    assert.equal(app.profile.playerXP, 18);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated online settlement refresh preserves the last authoritative own profile when the server snapshot is unavailable", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return null;
          }
        },
        state: {
          getProfile: async () => {
            calls.localGetProfile += 1;
            return {
              username: "SignedInUser",
              tokens: 0,
              playerXP: 0,
              playerLevel: 1,
              equippedCosmetics: {}
            };
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "SignedInUser"
      }
    };
    app.profile = {
      username: "SignedInUser",
      tokens: 245,
      playerXP: 18,
      playerLevel: 2,
      equippedCosmetics: {
        background: "authority_bg"
      }
    };
    app.setOwnProfileHydrationState("ready", { username: "SignedInUser" });

    const settledState = {
      connectionStatus: "connected",
      room: {
        roomCode: "ABC123",
        matchComplete: true,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-28T18:00:00.000Z",
          summary: {
            settledHostUsername: "SignedInUser",
            settledGuestUsername: "OtherPlayer"
          }
        }
      }
    };

    const refreshedProfile = await app.refreshLocalProfileAfterOnlineSettlement(settledState);

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 0);
    assert.equal(refreshedProfile?.tokens, 245);
    assert.equal(app.profile?.tokens, 245);
    assert.equal(app.profile?.equippedCosmetics?.background, "authority_bg");
    assert.equal(app.ownProfileHydration.status, "ready");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated online profile load preserves the remembered own profile when online play returns a default-like snapshot", async () => {
  const originalWindow = globalThis.window;
  let localProfileReads = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({
            authority: "server",
            profile: {
              username: "SignedInUser",
              tokens: 0,
              playerXP: 0,
              playerLevel: 1,
              equippedCosmetics: {
                background: "default_background"
              }
            },
            progression: {}
          })
        },
        state: {
          getProfile: async () => {
            localProfileReads += 1;
            return {
              username: "SignedInUser",
              tokens: 0,
              equippedCosmetics: {
                background: "local_background"
              }
            };
          }
        }
      }
    };

    app.username = "SignedInUser";
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "SignedInUser"
      }
    };
    app.profile = {
      username: "SignedInUser",
      tokens: 245,
      playerXP: 83,
      playerLevel: 4,
      equippedCosmetics: {
        background: "authority_bg"
      }
    };
    app.setOwnProfileHydrationState("ready", { username: "SignedInUser" });
    app.rememberAuthoritativeOwnProfile(app.profile, {
      username: "SignedInUser",
      onlineState: app.onlinePlayState
    });
    app.profile = {
      username: "SignedInUser",
      tokens: 0,
      playerXP: 0,
      playerLevel: 1,
      equippedCosmetics: {
        background: "default_background"
      }
    };

    const profile = await app.loadPreferredProfileForOnlineSession({
      username: "SignedInUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    assert.equal(localProfileReads, 0);
    assert.equal(profile?.tokens, 245);
    assert.equal(profile?.playerXP, 83);
    assert.equal(profile?.playerLevel, 4);
    assert.equal(profile?.equippedCosmetics?.background, "authority_bg");
    assert.equal(app.profile?.tokens, 245);
    assert.equal(app.ownProfileHydration?.status, "ready");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated own profile view after online disconnect reuses the remembered authoritative profile instead of local fallback", async () => {
  const originalWindow = globalThis.window;
  let multiplayerProfileReads = 0;
  let localProfileReads = 0;
  let localCosmeticsReads = 0;

  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => {
            multiplayerProfileReads += 1;
            return null;
          }
        },
        state: {
          getProfile: async () => {
            localProfileReads += 1;
            return {
              username: "SignedInUser",
              tokens: 200,
              playerXP: 0,
              playerLevel: 1,
              equippedCosmetics: {
                background: "default_background"
              }
            };
          },
          getCosmetics: async () => {
            localCosmeticsReads += 1;
            return {
              equipped: {
                background: "default_background"
              },
              catalog: {
                avatar: [],
                cardBack: [],
                background: [],
                elementCardVariant: [],
                badge: [],
                title: []
              }
            };
          },
          getDailyChallenges: async () => ({ xp: {} }),
          listProfiles: async () => []
        }
      }
    };

    app.username = "SignedInUser";
    app.onlinePlayState = {
      connectionStatus: "disconnected",
      session: {
        authenticated: true,
        username: "SignedInUser"
      }
    };
    app.profile = {
      username: "SignedInUser",
      tokens: 315,
      playerXP: 1353,
      playerLevel: 18,
      equippedCosmetics: {
        avatar: "avatar_aurelian_archon",
        title: "title_goldbound",
        cardBack: "cardback_goldbound_relic",
        background: "celestial_chamber_background"
      }
    };
    app.setOwnProfileHydrationState("ready", { username: "SignedInUser" });
    app.rememberAuthoritativeOwnProfile(app.profile, {
      username: "SignedInUser",
      onlineState: {
        connectionStatus: "connected",
        session: {
          authenticated: true,
          username: "SignedInUser"
        }
      }
    });
    app.profile = {
      username: "SignedInUser",
      tokens: 200,
      playerXP: 0,
      playerLevel: 1,
      equippedCosmetics: {
        avatar: "default_avatar",
        title: "Initiate",
        cardBack: "default_card_back",
        background: "default_background"
      }
    };

    await app.showProfile();

    assert.equal(multiplayerProfileReads, 0);
    assert.equal(localProfileReads, 0);
    assert.equal(localCosmeticsReads, 0);
    assert.equal(app.profile?.tokens, 315);
    assert.equal(app.profile?.playerXP, 1353);
    assert.equal(app.profile?.playerLevel, 18);
    assert.equal(app.profile?.equippedCosmetics?.background, "celestial_chamber_background");
    assert.equal(shown.at(-1)?.profile?.tokens, 315);
    assert.equal(shown.at(-1)?.profile?.equippedCosmetics?.cardBack, "cardback_goldbound_relic");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online menu challenge refresh prefers the multiplayer profile snapshot", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const calls = {
    multiplayerGetProfile: 0,
    localGetDailyChallenges: 0
  };

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username,
              profile: { username, tokens: 200, equippedCosmetics: {} },
              progression: {
                dailyChallenges: { challenges: [{ id: "daily" }], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [{ id: "weekly" }], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 1800000 }
              }
            };
          }
        },
        state: {
          getDailyChallenges: async () => {
            calls.localGetDailyChallenges += 1;
            return null;
          }
        }
      }
    };

    app.username = "MenuOnlineUser";
    app.onlinePlayState = { connectionStatus: "connected" };
    await app.refreshDailyChallengesForMenu();

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetDailyChallenges, 0);
    assert.equal(app.dailyChallenges.daily.challenges[0].id, "daily");
    assert.equal(app.dailyChallenges.weekly.challenges[0].id, "weekly");
    assert.equal(app.dailyChallenges.dailyLogin.msUntilReset, 1800000);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online menu challenge refresh is single-flight while a refresh is already in progress", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const calls = {
    multiplayerGetProfile: 0
  };
  let resolveProfile;
  const profileSettled = new Promise((resolve) => {
    resolveProfile = resolve;
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            await profileSettled;
            return {
              username,
              profile: { username, tokens: 200, equippedCosmetics: {} },
              progression: {
                dailyChallenges: { challenges: [{ id: "daily" }], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [{ id: "weekly" }], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 1800000 }
              }
            };
          }
        }
      }
    };

    app.username = "MenuOnlineUser";
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "MenuOnlineUser",
        authenticated: true
      }
    });

    const firstRefresh = app.refreshDailyChallengesForMenu();
    const secondRefresh = app.refreshDailyChallengesForMenu();
    await Promise.resolve();

    assert.equal(calls.multiplayerGetProfile, 1);

    resolveProfile();
    await firstRefresh;
    await secondRefresh;

    assert.equal(calls.multiplayerGetProfile, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated online menu flow does not call the disabled local loadout unlock acknowledgement path", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const calls = {
    acknowledgeLoadoutUnlocks: 0,
    multiplayerGetProfile: 0
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          acknowledgeLoadoutUnlocks: async () => {
            calls.acknowledgeLoadoutUnlocks += 1;
            return null;
          }
        },
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username,
              profile: { username, tokens: 200, equippedCosmetics: {} },
              progression: {
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 1800000 }
              }
            };
          }
        }
      }
    };

    app.username = "MenuOnlineUser";
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "MenuOnlineUser",
        sessionId: "session-1",
        accountId: "account-1",
        profileKey: "MenuOnlineUser",
        authenticated: true
      }
    });

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.acknowledgeLoadoutUnlocks, 0);
    assert.equal(calls.multiplayerGetProfile, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online daily challenges screen prefers the multiplayer profile snapshot", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const calls = {
    multiplayerGetProfile: 0,
    localGetDailyChallenges: 0
  };

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username,
              profile: { username, tokens: 415, equippedCosmetics: {} },
              currency: { tokens: 415 },
              progression: {
                dailyChallenges: { challenges: [{ id: "daily-online" }], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [{ id: "weekly-online" }], msUntilReset: 7200000 }
              }
            };
          }
        },
        state: {
          getDailyChallenges: async () => {
            calls.localGetDailyChallenges += 1;
            return null;
          }
        }
      }
    };

    app.username = "DailyOnlineUser";
    app.onlinePlayState = { connectionStatus: "connected" };
    await app.showDailyChallenges();

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetDailyChallenges, 0);
    assert.equal(shownScreens.at(-1).name, "dailyChallenges");
    assert.equal(shownScreens.at(-1).context.tokens, 415);
    assert.equal(shownScreens.at(-1).context.daily.challenges[0].id, "daily-online");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: daily challenge screen payload carries rotating bonus quests and excludes retired legacy ids", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async ({ username }) => ({
            username,
            profile: { username, tokens: 415, equippedCosmetics: {} },
            currency: { tokens: 415 },
            progression: {
              dailyChallenges: {
                challenges: [
                  { id: "daily_play_5_matches" },
                  { id: "daily_win_1_match" },
                  { id: "daily_win_2_matches" },
                  { id: "daily_win_1_war" },
                  { id: "daily_capture_16_cards" },
                  { id: "daily_use_all_4_elements" },
                  { id: "daily_online_match_1" },
                  { id: "daily_no_quit_3" },
                  { id: "daily_win_with_water" }
                ],
                msUntilReset: 3600000
              },
              weeklyChallenges: {
                challenges: [
                  { id: "weekly_play_15_matches" },
                  { id: "weekly_win_10_matches" },
                  { id: "weekly_win_9_wars" },
                  { id: "weekly_capture_64_cards" },
                  { id: "weekly_win_streak_3" },
                  { id: "weekly_use_all_4_elements_5x" },
                  { id: "weekly_longest_war_5" },
                  { id: "weekly_hard_ai_wins_5" },
                  { id: "weekly_online_matches_5" },
                  { id: "weekly_online_wins_3" }
                ],
                msUntilReset: 7200000
              }
            }
          })
        },
        state: {
          getDailyChallenges: async () => {
            throw new Error("local fallback should not be used in this test");
          }
        }
      }
    };

    app.username = "DailyOnlineUser";
    app.onlinePlayState = { connectionStatus: "connected" };
    await app.showDailyChallenges();

    const dailyIds = shownScreens.at(-1).context.daily.challenges.map((challenge) => challenge.id);
    const weeklyIds = shownScreens.at(-1).context.weekly.challenges.map((challenge) => challenge.id);

    assert.ok(dailyIds.includes("daily_online_match_1"));
    assert.ok(dailyIds.includes("daily_no_quit_3"));
    assert.ok(dailyIds.includes("daily_win_with_water"));
    assert.ok(weeklyIds.includes("weekly_hard_ai_wins_5"));
    assert.ok(weeklyIds.includes("weekly_online_matches_5"));
    assert.ok(weeklyIds.includes("weekly_online_wins_3"));
    assert.equal(dailyIds.includes("daily_win_2_wars"), false);
    assert.equal(dailyIds.includes("daily_trigger_2_wars_one_match"), false);
    assert.equal(dailyIds.includes("daily_capture_24_cards"), false);
    assert.equal(weeklyIds.includes("weekly_win_20_matches"), false);
    assert.equal(weeklyIds.includes("weekly_win_15_wars"), false);
    assert.equal(weeklyIds.includes("weekly_use_all_4_elements_10x"), false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online cosmetic randomization after settlement uses multiplayer authority instead of local state", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerRandomizeOwnedCosmetics: 0,
    localRandomizeOwnedCosmetics: 0
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => ({
            username: "OnlineRandomUser",
            profile: {
              username: "OnlineRandomUser",
              cosmeticRandomizeAfterMatch: { avatar: true }
            }
          }),
          randomizeOwnedCosmetics: async () => {
            calls.multiplayerRandomizeOwnedCosmetics += 1;
            return {
              profile: {
                username: "OnlineRandomUser",
                equippedCosmetics: {
                  avatar: "avatar_arcane_gambler"
                }
              },
              snapshot: {
                username: "OnlineRandomUser",
                profile: {
                  username: "OnlineRandomUser",
                  equippedCosmetics: {
                    avatar: "avatar_arcane_gambler"
                  }
                },
                cosmetics: {
                  equipped: {
                    avatar: "avatar_arcane_gambler"
                  }
                }
              }
            };
          }
        },
        state: {
          randomizeOwnedCosmetics: async () => {
            calls.localRandomizeOwnedCosmetics += 1;
            return null;
          }
        }
      }
    };

    app.username = "OnlineRandomUser";
    app.onlinePlayState = { connectionStatus: "connected" };
    const result = await app.randomizeOwnedCosmeticsFor("OnlineRandomUser", {
      username: "OnlineRandomUser",
      cosmeticRandomizeAfterMatch: { avatar: true }
    }, ["avatar"]);

    assert.equal(calls.multiplayerRandomizeOwnedCosmetics, 1);
    assert.equal(calls.localRandomizeOwnedCosmetics, 0);
    assert.equal(result.equippedCosmetics.avatar, "avatar_arcane_gambler");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play join rerenders move controls when a full room state is returned directly", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          joinRoom: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            lastError: null,
            statusMessage: "Room ABC123 is full.",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" }
            }
          }),
          createRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();
    await shownScreens.at(-1).context.actions.joinRoom("abc123");

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.room.status, "full");
    assert.deepEqual(onlinePlayContext.multiplayer.room.moveSync, {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play update preserves latest round result for the online play screen", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: true,
                guestSubmitted: true,
                submittedCount: 2,
                bothSubmitted: true,
                updatedAt: "2026-03-19T12:00:05.000Z"
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Both players submitted moves for room ABC123."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: true,
                guestSubmitted: true,
                submittedCount: 2,
                bothSubmitted: true,
                updatedAt: "2026-03-19T12:00:05.000Z"
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Both players submitted moves for room ABC123."
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    await app.showOnlinePlay();

    updateListeners[0]({
      connectionStatus: "connected",
      socketId: "guest-1",
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 1,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      },
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win"
      },
      lastError: null,
      statusMessage: "You Win Room ABC123"
    });

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.deepEqual(onlinePlayContext.multiplayer.latestRoundResult, {
      roomCode: "ABC123",
      hostMove: "fire",
      guestMove: "water",
      outcomeType: "resolved",
      hostResult: "lose",
      guestResult: "win"
    });
    assert.deepEqual(onlinePlayContext.multiplayer.lastCompletedBattleResult, {
      outcomeType: "resolved",
      hostMove: "fire",
      guestMove: "water",
      hostResult: "lose",
      guestResult: "win",
      roundNumber: 2,
      matchComplete: false
    });
    assert.equal(onlinePlayContext.multiplayer.room.hostScore, 0);
    assert.equal(onlinePlayContext.multiplayer.room.guestScore, 1);
    assert.equal(onlinePlayContext.multiplayer.room.roundNumber, 2);
    assert.equal(onlinePlayContext.multiplayer.room.lastOutcomeType, "resolved");
    assert.equal(onlinePlayContext.multiplayer.room.warActive, false);
    assert.equal(onlinePlayContext.multiplayer.room.warDepth, 0);
    assert.deepEqual(onlinePlayContext.multiplayer.room.warRounds, []);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play clears previous round result when the next round begins", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: {
              roomCode: "ABC123",
              hostMove: "fire",
              guestMove: "water",
              outcomeType: "resolved",
              hostResult: "lose",
              guestResult: "win"
            },
            lastError: null,
            statusMessage: "You Win Room ABC123"
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 1,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: {
              roomCode: "ABC123",
              hostMove: "fire",
              guestMove: "water",
              outcomeType: "resolved",
              hostResult: "lose",
              guestResult: "win"
            },
            lastError: null,
            statusMessage: "You Win Room ABC123"
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    await app.showOnlinePlay();

    updateListeners[0]({
      connectionStatus: "connected",
      socketId: "guest-1",
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 1,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: false,
          submittedCount: 1,
          bothSubmitted: false,
          updatedAt: "2026-03-19T12:01:00.000Z"
        }
      },
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win"
      },
      lastError: null,
      statusMessage: "1/2 move submission received for room ABC123."
    });

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.latestRoundResult, null);
    assert.deepEqual(onlinePlayContext.multiplayer.lastCompletedBattleResult, {
      outcomeType: "resolved",
      hostMove: "fire",
      guestMove: "water",
      hostResult: "lose",
      guestResult: "win",
      roundNumber: 2,
      matchComplete: false
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play submit responses cannot resurrect a stale round result during 1/2 submitted state", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Room ABC123 is full."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Room ABC123 is full."
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({
            connectionStatus: "connected",
            socketId: "host-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 2,
              lastOutcomeType: "resolved",
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: true,
                guestSubmitted: false,
                submittedCount: 1,
                bothSubmitted: false,
                updatedAt: "2026-03-19T12:00:05.000Z"
              }
            },
            latestRoundResult: {
              roomCode: "ABC123",
              hostMove: "fire",
              guestMove: "earth",
              outcomeType: "resolved",
              hostResult: "win",
              guestResult: "lose"
            },
            lastError: null,
            statusMessage: "1/2 move submission received for room ABC123."
          }),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();
    await shownScreens.at(-1).context.actions.submitMove("fire");

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.room.moveSync.submittedCount, 1);
    assert.equal(onlinePlayContext.multiplayer.latestRoundResult, null);
    assert.equal(onlinePlayContext.multiplayer.lastCompletedBattleResult, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play replaces the preserved battle log only when a newer completed result arrives", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 1,
              lastOutcomeType: null,
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Room ABC123 is full."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 1,
              lastOutcomeType: null,
              warActive: false,
              warDepth: 0,
              warRounds: [],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Room ABC123 is full."
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    await app.showOnlinePlay();

    updateListeners[0]({
      connectionStatus: "connected",
      socketId: "guest-1",
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 1,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      },
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win"
      },
      lastError: null,
      statusMessage: "You Win Room ABC123"
    });

    updateListeners[0]({
      connectionStatus: "connected",
      socketId: "guest-1",
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 1,
        guestScore: 1,
        roundNumber: 3,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:01:05.000Z"
        }
      },
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "earth",
        guestMove: "wind",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      },
      lastError: null,
      statusMessage: "You Lose Room ABC123"
    });

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.deepEqual(onlinePlayContext.multiplayer.lastCompletedBattleResult, {
      outcomeType: "resolved",
      hostMove: "earth",
      guestMove: "wind",
      hostResult: "win",
      guestResult: "lose",
      roundNumber: 3,
      matchComplete: false
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play keeps the preserved battle log during a 2/2 to 0/2 next-round reset", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const previousState = app.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "guest-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      roundNumber: 2,
      moveSync: {
        hostSubmitted: true,
        guestSubmitted: true,
        submittedCount: 2,
        bothSubmitted: true,
        updatedAt: "2026-03-19T12:00:05.000Z"
      }
    },
    latestRoundResult: {
      roomCode: "ABC123",
      hostMove: "fire",
      guestMove: "water",
      outcomeType: "resolved",
      hostResult: "lose",
      guestResult: "win"
    },
    lastCompletedBattleResult: {
      outcomeType: "resolved",
      hostMove: "fire",
      guestMove: "water",
      hostResult: "lose",
      guestResult: "win",
      roundNumber: 2,
      matchComplete: false
    }
  });

  const nextState = app.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "guest-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      roundNumber: 3,
      moveSync: {
        hostSubmitted: false,
        guestSubmitted: false,
        submittedCount: 0,
        bothSubmitted: false,
        updatedAt: null
      }
    },
    latestRoundResult: {
      roomCode: "ABC123",
      hostMove: "fire",
      guestMove: "water",
      outcomeType: "resolved",
      hostResult: "lose",
      guestResult: "win"
    }
  });

  const reconciledState = app.reconcileOnlinePlayRoundState(previousState, nextState);
  assert.equal(reconciledState.latestRoundResult, null);
  assert.deepEqual(reconciledState.lastCompletedBattleResult, {
    outcomeType: "resolved",
    hostMove: "fire",
    guestMove: "water",
    hostResult: "lose",
    guestResult: "win",
    roundNumber: 2,
    matchComplete: false
  });
});

test("appController: online play update preserves war state for the online play screen", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const updateListeners = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          onUpdate: (listener) => {
            updateListeners.push(listener);
            return () => {};
          },
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 3,
              lastOutcomeType: "no_effect",
              hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
              guestHand: { fire: 1, water: 2, earth: 2, wind: 1 },
              warPot: {
                host: ["fire"],
                guest: ["fire", "wind"]
              },
              warActive: true,
              warDepth: 1,
              warRounds: [
                {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war"
                },
                {
                  round: 2,
                  hostMove: "wind",
                  guestMove: "fire",
                  outcomeType: "no_effect"
                }
              ],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "No Effect Room ABC123"
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "guest-1",
            room: {
              roomCode: "ABC123",
              createdAt: "2026-03-19T12:00:00.000Z",
              status: "full",
              host: { socketId: "host-1" },
              guest: { socketId: "guest-1" },
              hostScore: 0,
              guestScore: 0,
              roundNumber: 3,
              lastOutcomeType: "no_effect",
              hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
              guestHand: { fire: 1, water: 2, earth: 2, wind: 1 },
              warPot: {
                host: ["fire"],
                guest: ["fire", "wind"]
              },
              warActive: true,
              warDepth: 1,
              warRounds: [
                {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war"
                },
                {
                  round: 2,
                  hostMove: "wind",
                  guestMove: "fire",
                  outcomeType: "no_effect"
                }
              ],
              roundHistory: [],
              moveSync: {
                hostSubmitted: false,
                guestSubmitted: false,
                submittedCount: 0,
                bothSubmitted: false,
                updatedAt: null
              }
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "No Effect Room ABC123"
          }),
          createRoom: async () => ({}),
          joinRoom: async () => ({}),
          submitMove: async () => ({}),
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    app.bindOnlinePlayUpdates();
    await app.showOnlinePlay();

    const onlinePlayContext = shownScreens.at(-1).context;
    assert.equal(onlinePlayContext.multiplayer.room.warActive, true);
    assert.equal(onlinePlayContext.multiplayer.room.warDepth, 1);
    assert.deepEqual(onlinePlayContext.multiplayer.room.hostHand, {
      fire: 1,
      water: 2,
      earth: 2,
      wind: 2
    });
    assert.deepEqual(onlinePlayContext.multiplayer.room.guestHand, {
      fire: 1,
      water: 2,
      earth: 2,
      wind: 1
    });
    assert.deepEqual(onlinePlayContext.multiplayer.room.warPot, {
      host: ["fire"],
      guest: ["fire", "wind"]
    });
    assert.deepEqual(onlinePlayContext.multiplayer.room.warRounds, [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war"
      },
      {
        round: 2,
        hostMove: "wind",
        guestMove: "fire",
        outcomeType: "no_effect"
      }
    ]);
    assert.deepEqual(onlinePlayContext.multiplayer.lastCompletedBattleResult, {
      outcomeType: "no_effect",
      hostMove: "wind",
      guestMove: "fire",
      hostResult: "no_effect",
      guestResult: "no_effect",
      roundNumber: 2,
      matchComplete: false
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: online play room snapshot resolved result updates lastCompletedBattleResult without a live latestRoundResult payload", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const normalized = app.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "guest-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      roundNumber: 5,
      lastOutcomeType: "resolved",
      warActive: false,
      warDepth: 0,
      warRounds: [],
      roundHistory: [
        {
          round: 4,
          hostMove: "earth",
          guestMove: "fire",
          outcomeType: "resolved",
          hostResult: "lose",
          guestResult: "win"
        }
      ],
      moveSync: {
        hostSubmitted: false,
        guestSubmitted: false,
        submittedCount: 0,
        bothSubmitted: false,
        updatedAt: null
      }
    },
    latestRoundResult: null
  });

  assert.deepEqual(normalized.lastCompletedBattleResult, {
    outcomeType: "resolved",
    hostMove: "earth",
    guestMove: "fire",
    hostResult: "lose",
    guestResult: "win",
    roundNumber: 4,
    matchComplete: false
  });
});

test("appController: online play room snapshot war started result updates lastCompletedBattleResult without a live latestRoundResult payload", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const normalized = app.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "guest-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      roundNumber: 4,
      lastOutcomeType: "war",
      warActive: true,
      warDepth: 1,
      warRounds: [
        {
          round: 3,
          hostMove: "earth",
          guestMove: "earth",
          outcomeType: "war"
        }
      ],
      roundHistory: [],
      moveSync: {
        hostSubmitted: false,
        guestSubmitted: false,
        submittedCount: 0,
        bothSubmitted: false,
        updatedAt: null
      }
    },
    latestRoundResult: null
  });

  assert.deepEqual(normalized.lastCompletedBattleResult, {
    outcomeType: "war",
    hostMove: "earth",
    guestMove: "earth",
    hostResult: "war",
    guestResult: "war",
    roundNumber: 3,
    matchComplete: false
  });
});

test("appController: online play room snapshot war resolved result replaces the preserved battle log without a live latestRoundResult payload", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.onlinePlayState = app.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "guest-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      roundNumber: 4,
      moveSync: {
        hostSubmitted: false,
        guestSubmitted: false,
        submittedCount: 0,
        bothSubmitted: false,
        updatedAt: null
      }
    },
    lastCompletedBattleResult: {
      outcomeType: "war",
      hostMove: "earth",
      guestMove: "earth",
      hostResult: "war",
      guestResult: "war",
      roundNumber: 3,
      matchComplete: false
    }
  });

  const normalized = app.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "guest-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      roundNumber: 5,
      lastOutcomeType: "war_resolved",
      warActive: false,
      warDepth: 0,
      warRounds: [],
      roundHistory: [
        {
          round: 4,
          hostMove: "water",
          guestMove: "fire",
          outcomeType: "war_resolved",
          hostResult: "lose",
          guestResult: "win"
        }
      ],
      moveSync: {
        hostSubmitted: false,
        guestSubmitted: false,
        submittedCount: 0,
        bothSubmitted: false,
        updatedAt: null
      }
    },
    latestRoundResult: null
  });

  assert.deepEqual(normalized.lastCompletedBattleResult, {
    outcomeType: "war_resolved",
    hostMove: "water",
    guestMove: "fire",
    hostResult: "lose",
    guestResult: "win",
    roundNumber: 4,
    matchComplete: false
  });
});

test("appController: reveal sounds are mode-aware and war start only plays when war begins", () => {
  const calls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {}
  });

  app.sound = {
    playReveal: (payload) => calls.push({ type: "reveal", payload }),
    play: (key) => calls.push({ type: "play", key })
  };

  app.playRoundRevealSounds(
    {
      status: "war_continues",
      war: { clashes: 1 },
      revealedCards: { p1Card: "fire", p2Card: "water" }
    },
    MATCH_MODE.PVE,
    { warWasActive: false }
  );

  app.playRoundRevealSounds(
    {
      status: "round_resolved",
      round: { result: "p2", warClashes: 2 },
      revealedCards: { p1Card: "earth", p2Card: "wind" }
    },
    MATCH_MODE.LOCAL_PVP,
    { warWasActive: true }
  );

  assert.deepEqual(calls, [
    { type: "reveal", payload: { mode: MATCH_MODE.PVE, cards: ["fire"] } },
    { type: "play", key: "warStart" },
    { type: "reveal", payload: { mode: MATCH_MODE.LOCAL_PVP, cards: ["earth", "wind"] } }
  ]);
});

test("appController: online play reveal uses only the local player's element sound and dedupes identical WAR-start updates", () => {
  const calls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {}
  });

  app.sound = {
    playReveal: (payload) => calls.push({ type: "reveal", payload }),
    play: (key) => calls.push({ type: "play", key }),
    playRoundResolved: () => {},
    playMatchComplete: () => {}
  };
  app.username = "SignedInUser";

  const previousState = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 2,
        lastOutcomeType: "",
        warActive: false
      }
    })
  );
  const nextState = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 2,
        lastOutcomeType: "war",
        warActive: true,
        warDepth: 1
      },
      latestAuthoritativeRoundResult: {
        outcomeType: "war",
        submittedCards: { host: "earth", guest: "fire" },
        roundResult: {
          hostMove: "earth",
          guestMove: "fire",
          hostResult: "war",
          guestResult: "war",
          outcomeType: "war",
          roundNumber: 2
        }
      }
    })
  );

  app.handleOnlinePlaySoundTransitions(previousState, nextState);
  app.handleOnlinePlaySoundTransitions(nextState, nextState);

  assert.deepEqual(calls, [
    { type: "reveal", payload: { mode: MATCH_MODE.PVE, cards: ["fire"] } },
    { type: "play", key: "warStart" }
  ]);
});

test("appController: online play round outcome sounds match PvE baseline for win loss and WAR resolution", () => {
  const calls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {}
  });

  app.sound = {
    playReveal: () => {},
    play: () => {},
    playRoundResolved: (payload) => calls.push(payload),
    playMatchComplete: () => {}
  };
  app.username = "SignedInUser";

  const basePrevious = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 1,
        lastOutcomeType: ""
      }
    })
  );

  const nonWarWin = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 2,
        hostScore: 0,
        guestScore: 1,
        lastOutcomeType: "resolved"
      },
      latestAuthoritativeRoundResult: {
        outcomeType: "resolved",
        submittedCards: { host: "fire", guest: "water" },
        roundResult: {
          hostMove: "fire",
          guestMove: "water",
          hostResult: "lose",
          guestResult: "win",
          outcomeType: "resolved",
          roundNumber: 2
        }
      }
    })
  );
  app.handleOnlinePlaySoundTransitions(basePrevious, nonWarWin);

  const nonWarLoss = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 3,
        hostScore: 1,
        guestScore: 1,
        lastOutcomeType: "resolved"
      },
      latestAuthoritativeRoundResult: {
        outcomeType: "resolved",
        submittedCards: { host: "earth", guest: "wind" },
        roundResult: {
          hostMove: "earth",
          guestMove: "wind",
          hostResult: "win",
          guestResult: "lose",
          outcomeType: "resolved",
          roundNumber: 3
        }
      }
    })
  );
  app.handleOnlinePlaySoundTransitions(nonWarWin, nonWarLoss);

  const warLoss = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 4,
        hostScore: 2,
        guestScore: 1,
        lastOutcomeType: "war_resolved"
      },
      latestAuthoritativeRoundResult: {
        outcomeType: "war_resolved",
        submittedCards: { host: "water", guest: "fire" },
        roundResult: {
          hostMove: "water",
          guestMove: "fire",
          hostResult: "win",
          guestResult: "lose",
          outcomeType: "war_resolved",
          roundNumber: 4
        }
      }
    })
  );
  app.handleOnlinePlaySoundTransitions(nonWarLoss, warLoss);

  const warWin = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 5,
        hostScore: 2,
        guestScore: 2,
        lastOutcomeType: "war_resolved"
      },
      latestAuthoritativeRoundResult: {
        outcomeType: "war_resolved",
        submittedCards: { host: "fire", guest: "water" },
        roundResult: {
          hostMove: "fire",
          guestMove: "water",
          hostResult: "lose",
          guestResult: "win",
          outcomeType: "war_resolved",
          roundNumber: 5
        }
      }
    })
  );
  app.handleOnlinePlaySoundTransitions(warLoss, warWin);

  assert.deepEqual(calls, [
    { mode: MATCH_MODE.PVE, round: { result: "p1", warClashes: 0 } },
    { mode: MATCH_MODE.PVE, round: { result: "p2", warClashes: 0 } },
    { mode: MATCH_MODE.PVE, round: { result: "p2", warClashes: 1 } },
    { mode: MATCH_MODE.PVE, round: { result: "p1", warClashes: 1 } }
  ]);
});

test("appController: online play match complete sounds map to local win loss and do not repeat on identical updates", () => {
  const calls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {}
  });

  app.sound = {
    playReveal: () => {},
    play: () => {},
    playRoundResolved: () => {},
    playMatchComplete: (payload) => calls.push(payload)
  };
  app.username = "SignedInUser";

  const previousState = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 6,
        hostScore: 2,
        guestScore: 2,
        matchComplete: false,
        lastOutcomeType: "resolved"
      }
    })
  );
  const winState = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roundNumber: 7,
        hostScore: 2,
        guestScore: 3,
        matchComplete: true,
        winner: "guest",
        winReason: "hand_exhaustion",
        lastOutcomeType: "resolved"
      },
      latestAuthoritativeRoundResult: {
        outcomeType: "resolved",
        submittedCards: { host: "fire", guest: "water" },
        roundResult: {
          hostMove: "fire",
          guestMove: "water",
          hostResult: "lose",
          guestResult: "win",
          outcomeType: "resolved",
          roundNumber: 7,
          matchComplete: true
        }
      }
    })
  );

  app.handleOnlinePlaySoundTransitions(previousState, winState);
  app.handleOnlinePlaySoundTransitions(winState, winState);

  const nextPrevious = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roomCode: "XYZ789",
        host: { socketId: "host-2", username: "OtherHost" },
        guest: { socketId: "guest-2", username: "SignedInUser" },
        roundNumber: 4,
        hostScore: 1,
        guestScore: 1,
        matchComplete: false,
        lastOutcomeType: "resolved"
      },
      socketId: "guest-2"
    })
  );
  const lossState = app.normalizeOnlinePlayState(
    createOnlineSoundState({
      roomOverrides: {
        roomCode: "XYZ789",
        host: { socketId: "host-2", username: "OtherHost" },
        guest: { socketId: "guest-2", username: "SignedInUser" },
        roundNumber: 5,
        hostScore: 2,
        guestScore: 1,
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        lastOutcomeType: "resolved"
      },
      socketId: "guest-2",
      latestAuthoritativeRoundResult: {
        outcomeType: "resolved",
        submittedCards: { host: "earth", guest: "wind" },
        roundResult: {
          hostMove: "earth",
          guestMove: "wind",
          hostResult: "win",
          guestResult: "lose",
          outcomeType: "resolved",
          roundNumber: 5,
          matchComplete: true
        }
      }
    })
  );

  app.handleOnlinePlaySoundTransitions(nextPrevious, lossState);
  app.handleOnlinePlaySoundTransitions(lossState, lossState);

  assert.deepEqual(calls, [
    { mode: MATCH_MODE.PVE, match: { status: "completed", winner: "p1" } },
    { mode: MATCH_MODE.PVE, match: { status: "completed", winner: "p2" } }
  ]);
});

test("appController: removed offline login path is rejected cleanly", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    ensureProfile: 0,
    claimDailyLoginReward: 0,
    getDailyChallenges: 0,
    modalShow: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: {
      show: () => {
        calls.modalShow += 1;
      },
      hide: () => {}
    },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: () => {},
      showTokenReward: () => {},
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async (username) => {
            calls.ensureProfile += 1;
            return { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
          },
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: true,
              profile: { username, tokens: 105, playerXP: 2, playerLevel: 1, equippedCosmetics: {} },
              rewardTokens: 5,
              rewardXp: 2,
              levelRewardTokenDelta: 0,
              xpBreakdown: { lines: [{ key: "daily_login", label: "Daily Login", amount: 2 }], total: 2 },
              levelBefore: 1,
              levelAfter: 1,
              levelRewards: [],
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-09T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-09T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          },
          getDailyChallenges: async () => {
            calls.getDailyChallenges += 1;
            return {
              dailyLogin: { eligible: false, msUntilReset: 3600000 },
              daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            };
          }
        }
      }
    };

    app.showLogin();
    await shownScreens.at(-1).context.actions.login("EligibleUser");

    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.claimDailyLoginReward, 0);
    assert.equal(calls.getDailyChallenges, 0);
    assert.equal(calls.modalShow, 0);
    assert.equal(app.profile, null);
    assert.equal(shownScreens.at(-1).name, "login");
    assert.match(shownScreens.at(-1).context.errorMessage, /Authenticated account login is required/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: login starts on the auth choice screen and routes to sign in or create account views", () => {
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.showLogin({ statusMessage: "Signed out." });
  assert.equal(shownScreens.at(-1).name, "login");
  assert.equal(shownScreens.at(-1).context.mode, "choice");
  assert.equal(shownScreens.at(-1).context.statusMessage, "Signed out.");

  shownScreens.at(-1).context.actions.openSignIn();
  assert.equal(shownScreens.at(-1).context.mode, "login");

  shownScreens.at(-1).context.actions.back();
  assert.equal(shownScreens.at(-1).context.mode, "choice");

  shownScreens.at(-1).context.actions.openCreateAccount();
  assert.equal(shownScreens.at(-1).context.mode, "register");
});

test("appController: login prefers the multiplayer profile snapshot when the session is already online-connected", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerLogin: [],
    ensureProfile: 0,
    multiplayerGetState: 0,
    multiplayerGetProfile: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.onlinePlayState = app.normalizeOnlinePlayState({
    connectionStatus: "connected"
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async (username) => {
            calls.ensureProfile += 1;
            return { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
          }
        },
        multiplayer: {
          login: async (payload) => {
            calls.multiplayerLogin.push(payload);
            return {
              ok: true,
              account: {
                accountId: "account-connected-1",
                email: payload.email,
                username: "ConnectedUser"
              },
              session: {
                token: "session-token-connected-1",
                sessionId: "session-id-connected-1",
                username: "ConnectedUser",
                profileKey: "ConnectedUser",
                accountId: "account-connected-1",
                authenticated: true
              }
            };
          },
          getState: async () => {
            calls.multiplayerGetState += 1;
            return {
              connectionStatus: "connected",
              socketId: "socket-connected-1",
              session: {
                active: true,
                username: "ConnectedUser",
                sessionId: "session-id-connected-1",
                accountId: "account-connected-1",
                profileKey: "ConnectedUser",
                authenticated: true
              },
              room: null,
              lastError: null,
              statusMessage: "Signed in."
            };
          },
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username: canonicalizeUsername(username),
              profile: {
                username: canonicalizeUsername(username),
                playerXP: 18,
                playerLevel: 1
              },
              cosmetics: {
                equipped: { background: "wind_background", avatar: "default_avatar" },
                owned: { background: ["wind_background"] }
              },
              stats: {
                summary: {
                  wins: 4,
                  losses: 1,
                  gamesPlayed: 5,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 3
                },
                modes: {}
              },
              currency: {
                tokens: 245
              },
              progression: {
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    app.showLogin();
    await shownScreens.at(-1).context.actions.login({
      mode: "login",
      email: "connected@example.com",
      password: "password123"
    });

    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.multiplayerLogin.length, 1);
    assert.equal(calls.multiplayerGetState, 1);
    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(app.username, "ConnectedUser-Canonical");
    assert.equal(app.profile.tokens, 245);
    assert.equal(app.profile.wins, 4);
    assert.equal(app.profile.equippedCosmetics.background, "wind_background");
    assert.equal(app.profile.playerXP, 18);
    assert.equal(app.dailyChallenges.daily.msUntilReset, 3600000);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: account login uses the multiplayer auth path and hydrates the active profile from the server snapshot", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerLogin: [],
    multiplayerGetState: 0,
    multiplayerGetProfile: 0,
    ensureProfile: 0,
    claimDailyLoginReward: 0,
    getDailyChallenges: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
        elemintz: {
          state: {
            ensureProfile: async () => {
              calls.ensureProfile += 1;
              return { username: "LocalFallbackUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
            },
            getDailyChallenges: async () => {
              calls.getDailyChallenges += 1;
              return {
                dailyLogin: { eligible: false, msUntilReset: 3600000 },
                daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            };
          }
        },
        multiplayer: {
            login: async (payload) => {
              calls.multiplayerLogin.push(payload);
              return {
                ok: true,
                account: {
                accountId: "account-1",
                email: payload.email,
                username: "AccountUser"
              },
              session: {
                token: "session-token-1",
                sessionId: "session-id-1",
                username: "AccountUser",
                profileKey: "AccountUser",
                accountId: "account-1",
                  authenticated: true
                }
              };
            },
            claimDailyLoginReward: async ({ username }) => {
              calls.claimDailyLoginReward += 1;
              return {
                granted: false,
                profile: { username, tokens: 260, playerXP: 24, playerLevel: 2, equippedCosmetics: {} },
                snapshot: {
                  authority: "server",
                  profile: { username, tokens: 260, playerXP: 24, playerLevel: 2, equippedCosmetics: {} },
                  progression: {
                    dailyChallenges: { challenges: [] },
                    weeklyChallenges: { challenges: [] },
                    dailyLogin: {
                      eligible: false,
                      loginDayKey: "2026-03-28T00:00:00.000Z",
                      lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                      msUntilReset: 3600000
                    }
                  }
                },
                dailyLoginStatus: {
                  eligible: false,
                  loginDayKey: "2026-03-28T00:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                  msUntilReset: 3600000
                }
              };
            },
            getState: async () => {
            calls.multiplayerGetState += 1;
            return {
              connectionStatus: "connected",
              socketId: "socket-1",
              session: {
                active: true,
                username: "AccountUser",
                sessionId: "session-id-1",
                accountId: "account-1",
                profileKey: "AccountUser",
                authenticated: true
              },
              room: null,
              lastError: null,
              statusMessage: "Signed in."
            };
          },
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              username: "AccountUser",
              profile: {
                username: "AccountUser",
                tokens: 260,
                playerXP: 24,
                playerLevel: 2,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {},
                owned: {}
              },
              stats: {
                summary: {
                  wins: 5,
                  losses: 2,
                  gamesPlayed: 7,
                  warsEntered: 1,
                  warsWon: 1,
                  cardsCaptured: 9
                },
                modes: {
                  online: {
                    wins: 5,
                    losses: 2
                  }
                }
              },
              currency: {
                tokens: 260
              },
              progression: {
                xp: {
                  playerXP: 24,
                  playerLevel: 2
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    app.showLogin();
    await shownScreens.at(-1).context.actions.login({
      mode: "login",
      email: "player@example.com",
      password: "password123"
    });

    assert.deepEqual(calls.multiplayerLogin, [
      {
        email: "player@example.com",
        password: "password123",
        rememberSession: true
      }
    ]);
    assert.equal(calls.multiplayerGetState, 1);
    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.claimDailyLoginReward, 1);
    assert.equal(calls.getDailyChallenges, 0);
    assert.equal(app.username, "AccountUser");
    assert.equal(app.profile.tokens, 260);
    assert.equal(app.ownProfileHydration.status, "ready");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: account creation uses the multiplayer register path with username email and password", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerRegister: [],
    multiplayerGetState: 0,
    multiplayerGetProfile: 0,
    claimDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getDailyChallenges: async () => ({
            dailyLogin: { eligible: false, msUntilReset: 3600000 },
            daily: { msUntilReset: 3600000, challenges: [] },
            weekly: { msUntilReset: 7200000, challenges: [] }
          })
        },
        multiplayer: {
          register: async (payload) => {
            calls.multiplayerRegister.push(payload);
            return {
              ok: true,
              account: {
                accountId: "new-account-1",
                email: payload.email,
                username: payload.username
              },
              session: {
                token: "session-token-register-1",
                sessionId: "session-id-register-1",
                username: payload.username,
                profileKey: payload.username,
                accountId: "new-account-1",
                authenticated: true
              }
            };
          },
          claimDailyLoginReward: async ({ username }) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: false,
              profile: { username, tokens: 200, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
              snapshot: {
                profile: { username, tokens: 200, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
                progression: {
                  dailyChallenges: { challenges: [] },
                  weeklyChallenges: { challenges: [] },
                  dailyLogin: { eligible: false, msUntilReset: 3600000 }
                }
              }
            };
          },
          getState: async () => {
            calls.multiplayerGetState += 1;
            return {
              connectionStatus: "connected",
              session: {
                active: true,
                username: "NewPlayer",
                sessionId: "session-id-register-1",
                accountId: "new-account-1",
                profileKey: "NewPlayer",
                authenticated: true
              },
              room: null,
              lastError: null,
              statusMessage: "Signed in."
            };
          },
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              username: "NewPlayer",
              profile: {
                username: "NewPlayer",
                tokens: 200,
                playerXP: 0,
                playerLevel: 1,
                equippedCosmetics: {}
              },
              cosmetics: { equipped: {}, owned: {} },
              stats: { summary: { wins: 0, losses: 0, gamesPlayed: 0, warsEntered: 0, warsWon: 0, cardsCaptured: 0 }, modes: {} },
              currency: { tokens: 200 },
              progression: {
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    app.showLogin({ mode: "register" });
    await shownScreens.at(-1).context.actions.login({
      mode: "register",
      username: "NewPlayer",
      email: "new@example.com",
      password: "password123"
    });

    assert.deepEqual(calls.multiplayerRegister, [
      {
        username: "NewPlayer",
        email: "new@example.com",
        password: "password123",
        rememberSession: true
      }
    ]);
    assert.equal(calls.multiplayerGetState, 1);
    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.claimDailyLoginReward, 1);
    assert.equal(app.username, "NewPlayer");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: auth failure rerenders the correct auth screen and clears the password", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          register: async () => ({
            ok: false,
            error: { message: "Email already in use." }
          })
        }
      }
    };

    app.showLogin({ mode: "register" });
    await shownScreens.at(-1).context.actions.login({
      mode: "register",
      username: "TakenName",
      email: "taken@example.com",
      password: "password123"
    });

    assert.equal(shownScreens.at(-1).name, "login");
    assert.equal(shownScreens.at(-1).context.mode, "register");
    assert.equal(shownScreens.at(-1).context.defaults.username, "TakenName");
    assert.equal(shownScreens.at(-1).context.defaults.email, "taken@example.com");
    assert.ok(!("password" in shownScreens.at(-1).context.defaults));
    assert.match(shownScreens.at(-1).context.errorMessage, /Email already in use|Unable to authenticate this account/i);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: unchecked account login keeps the current run signed in without requesting remember-me persistence", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerLogin: []
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getDailyChallenges: async () => ({
            dailyLogin: { eligible: false, msUntilReset: 3600000 },
            daily: { msUntilReset: 3600000, challenges: [] },
            weekly: { msUntilReset: 7200000, challenges: [] }
          })
        },
        multiplayer: {
          login: async (payload) => {
            calls.multiplayerLogin.push(payload);
            return {
              ok: true,
              session: {
                token: "session-token-remember-off",
                sessionId: "session-id-remember-off",
                username: "RememberOffUser",
                profileKey: "RememberOffUser",
                accountId: "account-remember-off",
                authenticated: true
              }
            };
          },
          getState: async () => ({
            connectionStatus: "connected",
            session: {
              active: true,
              username: "RememberOffUser",
              sessionId: "session-id-remember-off",
              accountId: "account-remember-off",
              profileKey: "RememberOffUser",
              authenticated: true
            },
            room: null,
            lastError: null,
            statusMessage: "Signed in."
          }),
          getProfile: async () => ({
            username: "RememberOffUser",
            profile: {
              username: "RememberOffUser",
              tokens: 120,
              playerXP: 0,
              playerLevel: 1,
              equippedCosmetics: {}
            },
            cosmetics: { equipped: {}, owned: {} },
            stats: { summary: { wins: 0, losses: 0, gamesPlayed: 0, warsEntered: 0, warsWon: 0, cardsCaptured: 0 }, modes: {} },
            currency: { tokens: 120 },
            progression: {
              dailyChallenges: { challenges: [] },
              weeklyChallenges: { challenges: [] },
              dailyLogin: { eligible: false, msUntilReset: 3600000 }
            }
          }),
          claimDailyLoginReward: async ({ username }) => ({
            granted: false,
            profile: { username, tokens: 120, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
            snapshot: {
              profile: { username, tokens: 120, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
              progression: {
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            }
          })
        }
      }
    };

    app.showLogin();
    await shownScreens.at(-1).context.actions.login({
      mode: "login",
      email: "player@example.com",
      password: "password123",
      rememberSession: false
    });

    assert.deepEqual(calls.multiplayerLogin, [
      {
        email: "player@example.com",
        password: "password123",
        rememberSession: false
      }
    ]);
    assert.equal(app.username, "RememberOffUser");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: init restores a persisted authenticated session and auto-enters the signed-in flow", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const calls = {
    restoreSession: 0,
    multiplayerGetProfile: 0,
    claimDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: () => {}
        },
        dataset: {}
      },
      body: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {}
        }
      }
    };
      globalThis.window = {
        elemintz: {
          state: {
            getSettings: async () => ({ gameplay: { timerSeconds: 30 }, ui: { reducedMotion: false }, audio: { enabled: true } }),
            getDailyChallenges: async () => ({
              dailyLogin: { eligible: false, msUntilReset: 3600000 },
              daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            })
          },
          multiplayer: {
            onUpdate: () => () => {},
            claimDailyLoginReward: async ({ username }) => {
              calls.claimDailyLoginReward += 1;
              return {
                granted: false,
                profile: { username, tokens: 275, playerXP: 22, playerLevel: 2, equippedCosmetics: {} },
                snapshot: {
                  authority: "server",
                  profile: { username, tokens: 275, playerXP: 22, playerLevel: 2, equippedCosmetics: {} },
                  progression: {
                    dailyChallenges: { challenges: [] },
                    weeklyChallenges: { challenges: [] },
                    dailyLogin: {
                      eligible: false,
                      loginDayKey: "2026-03-28T00:00:00.000Z",
                      lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                      msUntilReset: 3600000
                    }
                  }
                },
                dailyLoginStatus: {
                  eligible: false,
                  loginDayKey: "2026-03-28T00:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                  msUntilReset: 3600000
                }
              };
            },
            getState: async () => ({
              connectionStatus: "disconnected",
              session: {
                active: false,
              username: null,
              sessionId: null,
              accountId: null,
              profileKey: null,
              authenticated: false
            },
            room: null,
            lastError: null,
            statusMessage: "Offline."
          }),
          restoreSession: async () => {
            calls.restoreSession += 1;
            return {
              ok: true,
              restored: true,
              state: {
                connectionStatus: "connected",
                socketId: "socket-restore-1",
                session: {
                  active: true,
                  username: "RestoredUser",
                  sessionId: "session-restore-1",
                  accountId: "account-restore-1",
                  profileKey: "RestoredUser",
                  authenticated: true
                },
                room: null,
                lastError: null,
                statusMessage: "Signed in. Session restored."
              }
            };
          },
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              username: "RestoredUser",
              profile: {
                username: "RestoredUser",
                tokens: 275,
                playerXP: 22,
                playerLevel: 2,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {},
                owned: {}
              },
              stats: {
                summary: {
                  wins: 6,
                  losses: 1,
                  gamesPlayed: 7,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 8
                },
                modes: {
                  online: { wins: 6, losses: 1 }
                }
              },
              currency: {
                tokens: 275
              },
              progression: {
                xp: {
                  playerXP: 22,
                  playerLevel: 2
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    await app.init();

    assert.equal(calls.restoreSession, 1);
    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.claimDailyLoginReward, 1);
    assert.equal(app.username, "RestoredUser");
    assert.equal(app.profile.tokens, 275);
    assert.equal(shownScreens.some((entry) => entry.name === "login"), false);
    assert.equal(shownScreens.at(-1).name, "menu");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: invalid restored session clears back to login with a visible status message", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const calls = {
    restoreSession: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: () => {}
        },
        dataset: {}
      },
      body: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {}
        }
      }
    };
    globalThis.window = {
      elemintz: {
        state: {
          getSettings: async () => ({ gameplay: { timerSeconds: 30 }, ui: { reducedMotion: false }, audio: { enabled: true } })
        },
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "disconnected",
            session: {
              active: false,
              username: null,
              sessionId: null,
              accountId: null,
              profileKey: null,
              authenticated: false
            },
            room: null,
            lastError: {
              code: "SESSION_EXPIRED",
              message: "Saved session expired. Please sign in again."
            },
            statusMessage: "Saved session expired. Please sign in again."
          }),
          restoreSession: async () => {
            calls.restoreSession += 1;
            return {
              ok: false,
              restored: false,
              invalid: true,
              error: {
                code: "SESSION_EXPIRED",
                message: "Saved session expired. Please sign in again."
              },
              state: {
                connectionStatus: "disconnected",
                session: {
                  active: false,
                  username: null,
                  sessionId: null,
                  accountId: null,
                  profileKey: null,
                  authenticated: false
                },
                room: null,
                lastError: {
                  code: "SESSION_EXPIRED",
                  message: "Saved session expired. Please sign in again."
                },
                statusMessage: "Saved session expired. Please sign in again."
              }
            };
          }
        }
      }
    };

    await app.init();

    assert.equal(calls.restoreSession, 1);
    assert.equal(shownScreens.at(-1).name, "login");
    assert.equal(shownScreens.at(-1).context.statusMessage, "Saved session expired. Please sign in again.");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: restored authenticated startup still exposes local setup and creates both local PvP profiles", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const calls = {
    restoreSession: 0,
    multiplayerGetProfile: 0,
    authenticateHotseatIdentity: 0,
    claimDailyLoginReward: []
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: () => {}
        },
        dataset: {}
      },
      body: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {}
        }
      }
    };
      globalThis.window = {
        elemintz: {
          state: {
            getSettings: async () => ({ gameplay: { timerSeconds: 30 }, ui: { reducedMotion: false }, audio: { enabled: true } }),
            getDailyChallenges: async () => ({
              dailyLogin: { eligible: false, msUntilReset: 3600000 },
              daily: { msUntilReset: 3600000, challenges: [] },
              weekly: { msUntilReset: 7200000, challenges: [] }
            }),
          recordMatchResult: async () => ({}),
          getProfile: async (username) => ({
            username,
            tokens: username === "LocalP2" ? 210 : 275,
            playerXP: 12,
            playerLevel: 2,
            equippedCosmetics: {}
          }),
          getCosmetics: async () => ({ owned: {}, equipped: {}, loadouts: [] })
          },
          multiplayer: {
            onUpdate: () => () => {},
            claimDailyLoginReward: async ({ username }) => {
              calls.claimDailyLoginReward.push(username);
              return {
                granted: false,
                profile: {
                  username,
                  tokens: username === "LocalP2" ? 210 : 275,
                  playerXP: 12,
                  playerLevel: 2,
                  equippedCosmetics: {}
                },
                snapshot: {
                  authority: "server",
                  profile: {
                    username,
                    tokens: username === "LocalP2" ? 210 : 275,
                    playerXP: 12,
                    playerLevel: 2,
                    equippedCosmetics: {}
                  },
                  progression: {
                    dailyChallenges: { challenges: [] },
                    weeklyChallenges: { challenges: [] },
                    dailyLogin: {
                      eligible: false,
                      loginDayKey: "2026-03-28T00:00:00.000Z",
                      lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                      msUntilReset: 3600000
                    }
                  }
                },
                dailyLoginStatus: {
                  eligible: false,
                  loginDayKey: "2026-03-28T00:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                  msUntilReset: 3600000
                }
              };
            },
            getState: async () => ({
              connectionStatus: "disconnected",
              session: {
                active: false,
              username: null,
              sessionId: null,
              accountId: null,
              profileKey: null,
              authenticated: false
            },
            room: null,
            lastError: null,
            statusMessage: "Offline."
          }),
          restoreSession: async () => {
            calls.restoreSession += 1;
            return {
              ok: true,
              restored: true,
              state: {
                connectionStatus: "connected",
                socketId: "socket-restore-2",
                session: {
                  active: true,
                  username: "RestoredUser",
                  sessionId: "session-restore-2",
                  accountId: "account-restore-2",
                  profileKey: "RestoredUser",
                  authenticated: true
                },
                room: null,
                lastError: null,
                statusMessage: "Signed in. Session restored."
              }
            };
          },
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return {
              authority: "server",
              source: "multiplayer",
              username: "RestoredUser",
              profile: {
                username: "RestoredUser",
                tokens: 275,
                playerXP: 22,
                playerLevel: 2,
                equippedCosmetics: {}
              },
              cosmetics: {
                equipped: {},
                owned: {}
              },
              stats: {
                summary: {
                  wins: 6,
                  losses: 1,
                  gamesPlayed: 7,
                  warsEntered: 0,
                  warsWon: 0,
                  cardsCaptured: 8
                },
                modes: {
                  online: { wins: 6, losses: 1 }
                }
              },
              currency: {
                tokens: 275
              },
              progression: {
                xp: {
                  playerXP: 22,
                  playerLevel: 2
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          },
          authenticateHotseatIdentity: async () => {
            calls.authenticateHotseatIdentity += 1;
            return {
              ok: true,
              account: {
                accountId: "account-local-p2"
              },
              session: {
                accountId: "account-local-p2",
                username: "LocalP2"
              },
              profile: {
                authority: "server",
                source: "multiplayer",
                username: "LocalP2",
                profile: {
                  username: "LocalP2",
                  tokens: 210,
                  playerXP: 12,
                  playerLevel: 2,
                  equippedCosmetics: {}
                },
                cosmetics: {
                  equipped: {},
                  owned: {}
                },
                stats: {
                  summary: {
                    wins: 0,
                    losses: 0,
                    gamesPlayed: 0,
                    warsEntered: 0,
                    warsWon: 0,
                    cardsCaptured: 0
                  },
                  modes: {}
                },
                currency: {
                  tokens: 210
                }
              }
            };
          }
        }
      }
    };

    await app.init();
    assert.equal(shownScreens.at(-1).name, "menu");

    await shownScreens.at(-1).context.actions.startLocalGame();
    assert.equal(shownScreens.at(-1).name, "localSetup");
    assert.equal(shownScreens.at(-1).context.player1.authenticated, true);
    assert.equal(shownScreens.at(-1).context.player1.username, "RestoredUser");

    await shownScreens.at(-1).context.actions.start({
      p1: { authenticated: true },
      p2: {
        mode: "login",
        email: "localp2@example.com",
        password: "password123",
        username: ""
      }
    });

    assert.equal(calls.multiplayerGetProfile, 2);
    assert.equal(calls.authenticateHotseatIdentity, 1);
    assert.deepEqual(calls.claimDailyLoginReward, ["RestoredUser"]);
    assert.equal(app.localPlayers.p1, "RestoredUser");
    assert.equal(app.localPlayers.p2, "LocalP2");
    assert.equal(app.localProfiles.p1.username, "RestoredUser");
    assert.equal(app.localProfiles.p2.username, "LocalP2");
    assert.equal(shownScreens.at(-1).name, "pass");
    assert.equal(shownScreens.at(-1).context.message, "Player 1, Click When Ready");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: duplicate daily login auto-claim requests are deduped within one login cycle", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    claimDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: () => {},
      showTokenReward: () => {},
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async (username) => ({ username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} }),
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: false,
              profile: { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-10T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-10T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          },
          getDailyChallenges: async () => ({
            dailyLogin: { eligible: false, msUntilReset: 3600000 },
            daily: { msUntilReset: 3600000, challenges: [] },
            weekly: { msUntilReset: 7200000, challenges: [] }
          })
        }
      }
    };

    app.username = "GuardUser";
    app.profile = { username: "GuardUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
    await app.ensureDailyLoginAutoClaim({ showToasts: true, requestKey: "login:GuardUser" });

    assert.equal(calls.claimDailyLoginReward, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: showing menu after a login-cycle daily login claim does not trigger a second auto-claim", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    claimDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: () => {},
      showTokenReward: () => {},
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          ensureProfile: async (username) => ({ username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} }),
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: false,
              profile: { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-10T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-10T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          },
          getDailyChallenges: async () => ({
            dailyLogin: { eligible: false, msUntilReset: 3600000 },
            daily: { msUntilReset: 3600000, challenges: [] },
            weekly: { msUntilReset: 7200000, challenges: [] }
          })
        }
      }
    };

    app.username = "GuardUser";
    app.profile = { username: "GuardUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
    app.dailyChallenges = {
      dailyLogin: { eligible: false, msUntilReset: 3600000 },
      daily: { challenges: [], msUntilReset: 3600000 },
      weekly: { challenges: [], msUntilReset: 7200000 }
    };
    app.refreshDailyChallengesForMenu = async () => {};
    app.refreshMenuAnnouncement = async () => {};
    app.refreshMenuBoostEvent = async () => {};
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.maybeShowNewCosmeticsAnnouncement = async () => {};

    await app.ensureDailyLoginAutoClaim({ showToasts: true, requestKey: "login:GuardUser" });
    app.showMenu({
      autoClaimDailyLogin: true,
      showDailyLoginToasts: true,
      skipInitialDailyChallengesRefresh: true
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.claimDailyLoginReward, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: an in-flight daily login auto-claim ignores a second menu-triggered attempt", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    claimDailyLoginReward: 0
  };
  let resolveClaim;
  const claimSettled = new Promise((resolve) => {
    resolveClaim = resolve;
  });

  const app = createUpdateSafetyController();

  try {
    globalThis.window = {
      elemintz: {
        state: {
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            await claimSettled;
            return {
              granted: false,
              profile: { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-05-14T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-05-14T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          }
        }
      }
    };

    app.username = "DailyInflightUser";
    app.profile = { username: "DailyInflightUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

    const firstAttempt = app.ensureDailyLoginAutoClaim({
      showToasts: false,
      requestKey: "login:DailyInflightUser"
    });
    const secondAttempt = app.ensureDailyLoginAutoClaim({
      showToasts: false,
      requestKey: "menu:DailyInflightUser"
    });

    await Promise.resolve();
    assert.equal(calls.claimDailyLoginReward, 1);

    resolveClaim();
    await firstAttempt;
    await secondAttempt;
    assert.equal(calls.claimDailyLoginReward, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: showOnlinePlay refreshes the active profile from the multiplayer snapshot after connect", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "OnlineUser";
  app.profile = { username: "OnlineUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            calls.localGetProfile += 1;
            return { username: "OnlineUser", tokens: 110, playerXP: 2, playerLevel: 1, equippedCosmetics: {} };
          }
        },
        multiplayer: {
          onUpdate: () => () => {},
          getState: async () => ({
            connectionStatus: "disconnected",
            socketId: null,
            room: null,
            lastError: null,
            statusMessage: "Offline."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          getProfile: async ({ username }) => {
            calls.multiplayerGetProfile += 1;
            return {
              username: canonicalizeUsername(username),
              profile: {
                username: canonicalizeUsername(username),
                playerXP: 44,
                playerLevel: 3
              },
              cosmetics: {
                equipped: {
                  avatar: "default_avatar",
                  background: "bg_celestial_observatory",
                  cardBack: "default_card_back",
                  elementCardVariant: {
                    fire: "default_fire_card",
                    water: "default_water_card",
                    earth: "default_earth_card",
                    wind: "default_wind_card"
                  },
                  title: "Initiate",
                  badge: "none"
                },
                owned: {}
              },
              stats: {
                summary: {
                  wins: 12,
                  losses: 5,
                  gamesPlayed: 17,
                  warsEntered: 3,
                  warsWon: 2,
                  cardsCaptured: 28
                },
                modes: {}
              },
              currency: {
                tokens: 310
              },
              progression: {
                dailyChallenges: { challenges: [], msUntilReset: 3600000 },
                weeklyChallenges: { challenges: [], msUntilReset: 7200000 },
                dailyLogin: { eligible: false, msUntilReset: 3600000 }
              }
            };
          }
        }
      }
    };

    await app.showOnlinePlay();

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 1);
    assert.equal(app.username, "OnlineUser-Canonical");
    assert.equal(app.profile.tokens, 310);
    assert.equal(app.profile.wins, 12);
    assert.equal(app.profile.equippedCosmetics.background, "bg_celestial_observatory");
    assert.equal(app.profile.playerLevel, 3);
    assert.equal(shownScreens.at(-1).name, "onlinePlay");
    assert.equal(shownScreens.at(-1).context.username, "OnlineUser-Canonical");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: daily login auto-claim promise clears after a successful claim settles", async () => {
  const originalWindow = globalThis.window;
  const app = createUpdateSafetyController();

  try {
    globalThis.window = {
      elemintz: {
        state: {
          claimDailyLoginReward: async (username) => ({
            granted: true,
            profile: { username, tokens: 120, playerXP: 5, playerLevel: 1, equippedCosmetics: {} },
            dailyLoginStatus: {
              eligible: false,
              loginDayKey: "2026-05-14T00:00:00.000Z",
              lastDailyLoginClaimDate: "2026-05-14T00:00:00.000Z",
              msUntilReset: 3600000
            }
          })
        }
      }
    };

    app.username = "DailySuccessUser";
    app.profile = { username: "DailySuccessUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

    assert.equal(app.dailyLoginAutoClaimPromise, null);
    await app.ensureDailyLoginAutoClaim({ showToasts: false, requestKey: "menu:DailySuccessUser" });
    assert.equal(app.dailyLoginAutoClaimPromise, null);
    assert.equal(app.getUpdateSafetyState().reasons.includes("daily_login_claim_in_flight"), false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: daily login auto-claim promise clears after an ineligible result settles", async () => {
  const originalWindow = globalThis.window;
  const app = createUpdateSafetyController();

  try {
    globalThis.window = {
      elemintz: {
        state: {
          claimDailyLoginReward: async (username) => ({
            granted: false,
            profile: { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
            dailyLoginStatus: {
              eligible: false,
              loginDayKey: "2026-05-14T00:00:00.000Z",
              lastDailyLoginClaimDate: "2026-05-14T00:00:00.000Z",
              msUntilReset: 3600000
            }
          })
        }
      }
    };

    app.username = "DailyNoGrantUser";
    app.profile = { username: "DailyNoGrantUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

    await app.ensureDailyLoginAutoClaim({ showToasts: false, requestKey: "menu:DailyNoGrantUser" });
    assert.equal(app.dailyLoginAutoClaimPromise, null);
    assert.equal(app.getUpdateSafetyState().safe, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: daily login auto-claim promise clears after a failed claim rejects", async () => {
  const originalWindow = globalThis.window;
  const app = createUpdateSafetyController();

  try {
    globalThis.window = {
      elemintz: {
        state: {
          claimDailyLoginReward: async () => {
            throw new Error("daily login offline");
          }
        }
      }
    };

    app.username = "DailyFailUser";
    app.profile = { username: "DailyFailUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

    await assert.rejects(
      app.ensureDailyLoginAutoClaim({ showToasts: false, requestKey: "menu:DailyFailUser" }),
      /daily login offline/i
    );
    assert.equal(app.dailyLoginAutoClaimPromise, null);
    assert.equal(app.getUpdateSafetyState().reasons.includes("daily_login_claim_in_flight"), false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: eligible menu daily login auto-claim refreshes menu state once without looping challenge fetches", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    refreshDailyChallenges: 0,
    refreshMenuAnnouncement: 0,
    refreshMenuBoostEvent: 0,
    showDailyLoginReward: 0,
    dailyLoginRewardPayloads: []
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {}, clearStaleOverlay: () => false },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: (payload) => {
        calls.showDailyLoginReward += 1;
        calls.dailyLoginRewardPayloads.push(payload);
      },
      showTokenReward: () => {},
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          claimDailyLoginReward: async (username) => ({
            granted: true,
            profile: { username, tokens: 140, playerXP: 10, playerLevel: 1, equippedCosmetics: {} },
            streakDay: 7,
            rewardSummary: {
              day: 7,
              tokens: 0,
              xp: 0,
              chestAwarded: { chestType: "epic", chestLabel: "Epic Chest", amount: 1 }
            },
            rewardTokens: 0,
            rewardXp: 0,
            chestAwarded: { chestType: "epic", chestLabel: "Epic Chest", amount: 1 },
            dailyLoginStatus: {
              eligible: false,
              streakDay: 7,
              loginDayKey: "2026-05-14T00:00:00.000Z",
              lastDailyLoginClaimDate: "2026-05-14T00:00:00.000Z",
              msUntilReset: 3600000
            }
          })
        }
      }
    };

    app.username = "DailySuccessUser";
    app.profile = { username: "DailySuccessUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
    app.dailyChallenges = {
      dailyLogin: { eligible: true, msUntilReset: 3600000 },
      daily: { challenges: [], msUntilReset: 3600000 },
      weekly: { challenges: [], msUntilReset: 7200000 }
    };
    app.refreshDailyChallengesForMenu = async () => {
      calls.refreshDailyChallenges += 1;
      return app.dailyChallenges;
    };
    app.refreshMenuAnnouncement = async () => {
      calls.refreshMenuAnnouncement += 1;
      return null;
    };
    app.refreshMenuBoostEvent = async () => {
      calls.refreshMenuBoostEvent += 1;
      return null;
    };
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.maybeShowNewCosmeticsAnnouncement = async () => {};

    app.showMenu({ autoClaimDailyLogin: true, showDailyLoginToasts: true });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.refreshDailyChallenges, 1);
    assert.equal(calls.refreshMenuAnnouncement, 1);
    assert.equal(calls.refreshMenuBoostEvent, 1);
    assert.equal(calls.showDailyLoginReward, 1);
    assert.deepEqual(calls.dailyLoginRewardPayloads, [{
      tokens: 0,
      xp: 0,
      xpConversionTokenBonus: 0,
      streakDay: 7,
      rewardSummary: {
        day: 7,
        tokens: 0,
        xp: 0,
        chestAwarded: { chestType: "epic", chestLabel: "Epic Chest", amount: 1 }
      },
      chestAwarded: { chestType: "epic", chestLabel: "Epic Chest", amount: 1 }
    }]);
    assert.equal(app.profile.tokens, 140);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: ineligible menu daily login auto-claim does not show a reward toast or loop refreshes", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    refreshDailyChallenges: 0,
    refreshMenuAnnouncement: 0,
    refreshMenuBoostEvent: 0,
    showDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {}, clearStaleOverlay: () => false },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: () => {
        calls.showDailyLoginReward += 1;
      },
      showTokenReward: () => {},
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          claimDailyLoginReward: async (username) => ({
            granted: false,
            profile: { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
            dailyLoginStatus: {
              eligible: false,
              loginDayKey: "2026-05-14T00:00:00.000Z",
              lastDailyLoginClaimDate: "2026-05-14T00:00:00.000Z",
              msUntilReset: 3600000
            }
          })
        }
      }
    };

    app.username = "DailyNoGrantUser";
    app.profile = { username: "DailyNoGrantUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };
    app.dailyChallenges = {
      dailyLogin: { eligible: false, msUntilReset: 3600000 },
      daily: { challenges: [], msUntilReset: 3600000 },
      weekly: { challenges: [], msUntilReset: 7200000 }
    };
    app.refreshDailyChallengesForMenu = async () => {
      calls.refreshDailyChallenges += 1;
      return app.dailyChallenges;
    };
    app.refreshMenuAnnouncement = async () => {
      calls.refreshMenuAnnouncement += 1;
      return null;
    };
    app.refreshMenuBoostEvent = async () => {
      calls.refreshMenuBoostEvent += 1;
      return null;
    };
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.maybeShowNewCosmeticsAnnouncement = async () => {};

    app.showMenu({ autoClaimDailyLogin: true, showDailyLoginToasts: true });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.refreshDailyChallenges, 1);
    assert.equal(calls.refreshMenuAnnouncement, 1);
    assert.equal(calls.refreshMenuBoostEvent, 1);
    assert.equal(calls.showDailyLoginReward, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: idle menu after completed daily login claim is updater-safe", async () => {
  const originalWindow = globalThis.window;
  const app = createUpdateSafetyController();

  try {
    globalThis.window = {
      elemintz: {
        state: {
          claimDailyLoginReward: async (username) => ({
            granted: false,
            profile: { username, tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} },
            dailyLoginStatus: {
              eligible: false,
              loginDayKey: "2026-05-14T00:00:00.000Z",
              lastDailyLoginClaimDate: "2026-05-14T00:00:00.000Z",
              msUntilReset: 3600000
            }
          })
        }
      }
    };

    app.screenFlow = "menu";
    app.username = "IdleMenuUser";
    app.profile = { username: "IdleMenuUser", tokens: 100, playerXP: 0, playerLevel: 1, equippedCosmetics: {} };

    await app.ensureDailyLoginAutoClaim({ showToasts: false, requestKey: "menu:IdleMenuUser" });

    const safety = app.getUpdateSafetyState();
    assert.equal(safety.safe, true);
    assert.equal(safety.reasons.includes("daily_login_claim_in_flight"), false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: non-authenticated online profile load keeps local fallback when multiplayer snapshot is unavailable", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "FallbackUser";
  app.onlinePlayState = {
    connectionStatus: "connected"
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async (username) => {
            calls.localGetProfile += 1;
            return { username, tokens: 150, playerXP: 5, playerLevel: 1, equippedCosmetics: {} };
          }
        },
        multiplayer: {
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return null;
          }
        }
      }
    };

    const result = await app.loadPreferredProfileForOnlineSession({
      username: "FallbackUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 1);
    assert.equal(result.tokens, 150);
    assert.equal(app.profile.tokens, 150);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated online profile load rejects local fallback when multiplayer snapshot is unavailable", async () => {
  const originalWindow = globalThis.window;
  const calls = {
    multiplayerGetProfile: 0,
    localGetProfile: 0
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "FallbackUser";
  app.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "FallbackUser"
    }
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async (username) => {
            calls.localGetProfile += 1;
            return { username, tokens: 150, playerXP: 5, playerLevel: 1, equippedCosmetics: {} };
          }
        },
        multiplayer: {
          getProfile: async () => {
            calls.multiplayerGetProfile += 1;
            return null;
          }
        }
      }
    };

    const result = await app.loadPreferredProfileForOnlineSession({
      username: "FallbackUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    assert.equal(calls.multiplayerGetProfile, 1);
    assert.equal(calls.localGetProfile, 0);
    assert.equal(result, null);
    assert.equal(app.profile, null);
    assert.equal(app.ownProfileHydration.status, "error");
    assert.equal(app.ownProfileHydration.username, "FallbackUser");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated startGame is blocked while own profile hydration is not ready", async () => {
  const originalWindow = globalThis.window;
  const modalCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: {
      show: (config) => modalCalls.push(config),
      hide: () => {}
    },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "HydrationGateUser";
  app.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "HydrationGateUser"
    }
  };
  app.setOwnProfileHydrationState("pending", { username: "HydrationGateUser" });
  app.profile = null;

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        },
        multiplayer: {
          getProfile: async () => null
        }
      }
    };

    app.startGame(MATCH_MODE.PVE);

    assert.equal(app.gameController, null);
    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Profile Loading");
    assert.match(modalCalls[0].body, /Profile is still loading\. Please wait\./);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: pass screen remains stable during timer ticks", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const timerLabel = { textContent: "" };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 3 }, ui: { reducedMotion: true } };
  app.username = "LocalFlowUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };

  try {
    globalThis.document = {
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: (id) => (id === "pass-timer-label" ? timerLabel : null)
    };
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);
    const startIndex = shownScreens.length - 1;
    await new Promise((resolve) => setTimeout(resolve, 2100));

    const newScreens = shownScreens.slice(startIndex);
    assert.equal(newScreens.length, 1);
    assert.ok(newScreens.every((entry) => entry.name === "pass"));
    assert.equal(timerLabel.textContent, "Time Remaining: 1s");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("appController: local player turn remains on game screen while timer ticks", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 3 }, ui: { reducedMotion: true } };
  app.username = "LocalFlowUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };

  try {
    globalThis.Audio = class {
      play() {
        return Promise.resolve();
      }
    };

    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);
    await shownScreens.at(-1).context.actions.continue();

    const before = shownScreens.length;
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const updates = shownScreens.slice(before - 1);
    const gameUpdates = updates.filter((entry) => entry.name === "game");
    assert.ok(gameUpdates.length >= 2);
    assert.equal(updates.at(-1).name, "game");
    assert.ok(gameUpdates.at(-1).context.game.timerSeconds < 3);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
  }
});

test("appController: local hotseat shows both strict privacy pass screens", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;

  const shownScreens = [];
  const screenManager = {
    register: () => {},
    show: (name, context) => {
      shownScreens.push({ name, context });
    }
  };

  const app = new AppController({
    screenManager,
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = {
    gameplay: { timerSeconds: 30 },
    ui: { reducedMotion: true }
  };
  app.username = "LocalFlowUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };
  const resolutionCalls = [];

  try {
    globalThis.Audio = class {
      play() {
        return Promise.resolve();
      }
    };

    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };
    app.showSharedResolutionPopup = async (result, mode) => {
      resolutionCalls.push({ result, mode });
    };
    app.showPlayer1TurnPass = async () => {
      shownScreens.push({
        name: "pass",
        context: { message: "Player 1, Click When Ready", summary: null }
      });
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);

    await app.handleGameCardSelection(0);
    let last = shownScreens.at(-1);
    assert.equal(last.name, "pass");
    assert.equal(last.context.message, "Player 2, Click When Ready");

    await last.context.actions.continue();
    await app.handleGameCardSelection(0);

    last = shownScreens.at(-1);
    assert.equal(last.name, "pass");
    assert.equal(last.context.message, "Player 1, Click When Ready");
    assert.equal(last.context.summary, null);
    assert.equal(resolutionCalls.length, 1);
    assert.equal(resolutionCalls[0].mode, MATCH_MODE.LOCAL_PVP);

    assert.ok(
      resolutionCalls[0].result?.status === "round_resolved" ||
      resolutionCalls[0].result?.status === "war_continues"
    );
  } finally {
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    app.clearPassTimer();
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
  }
});

test("appController: pass-screen timeout auto-picks for Player 2 turn", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  let pickedTurn = null;
  app.showPassScreen = async ({ onTimeout }) => {
    await onTimeout();
  };
  app.autoPickForTurn = async (turn) => {
    pickedTurn = turn;
  };

  try {
    globalThis.window = { elemintz: { state: {} } };
    await app.showPassToPlayer2();
    assert.equal(pickedTurn, "p2");
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("appController: Player 2 timeout resolves immediately without an extra Player 1-only reveal popup", async () => {
  const originalWindow = globalThis.window;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  let resolved = false;

  app.gameController = {
    pickRandomCardIndex: (turn) => {
      assert.equal(turn, "p2");
      return 1;
    },
    submitHotseatSelection: async (index) => {
      assert.equal(index, 1);
      return { status: "pass_to_p1" };
    }
  };

  app.presentHotseatResolution = async () => {
    resolved = true;
  };

  try {
    globalThis.window = { elemintz: { state: {} } };
    await app.autoPickForTurn("p2");

    assert.equal(resolved, true);
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("gameController: 5-minute timer resolves by card count and supports ties", async () => {
  const originalWindow = globalThis.window;

  const completions = [];
  const controller = new GameController({
    username: "TimerUser",
    mode: MATCH_MODE.PVE,
    matchTimeLimitSeconds: 1,
    onUpdate: () => {},
    onMatchComplete: ({ match }) => completions.push(match)
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.match.players.p1.hand = ["fire", "water", "wind"];
    controller.match.players.p2.hand = ["earth"];
    controller.match.meta.totalCards = 4;
    controller.totalMatchSeconds = 1;
    controller.startMatchClock();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.endReason, "time_limit");
    assert.equal(controller.match.winner, "p1");

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.match.players.p1.hand = ["fire"];
    controller.match.players.p2.hand = ["earth"];
    controller.match.meta.totalCards = 2;
    controller.completionNotified = false;
    controller.totalMatchSeconds = 1;
    controller.startMatchClock();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.endReason, "time_limit");
    assert.equal(controller.match.winner, "draw");
    assert.ok(completions.length >= 2);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: quit mid-game finalizes and persists", async () => {
  const originalWindow = globalThis.window;
  const calls = [];

  const controller = new GameController({
    username: "QuitUser",
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async (payload) => {
            calls.push(payload);
            return { ok: true };
          }
        }
      }
    };

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });

    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(controller.match.endReason, "quit_forfeit");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].matchState.status, "completed");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: local persistence records results for both local players", async () => {
  const originalWindow = globalThis.window;

  const calls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "SignedInUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async (payload) => {
            calls.push(payload);
            return { profile: { username: payload.username }, stats: { cardsCaptured: 1 } };
          }
        }
      }
    };

    const match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      status: "completed",
      winner: "p1",
      round: 1
    };

    await app.persistLocalPvpResult(match);

    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((entry) => [entry.username, entry.perspective]),
      [
        ["Alice", "p1"],
        ["Bob", "p2"]
      ]
    );
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("appController: gameplay uses equipped profile background", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "BgUser";
  app.profile = {
    username: "BgUser",
    equippedCosmetics: { background: "default_background" },
    cosmetics: { background: "default_background" }
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.PVE);
    const last = shownScreens.at(-1);
    assert.equal(last.name, "game");
    assert.match(last.context.arenaBackground, /EleMintzIcon\.png/);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: selecting Easy from the difficulty screen starts PvE with easy difficulty", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "hard", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "EasyPicker";
  app.profile = { username: "EasyPicker" };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.showAiDifficultySelect();
    await shownScreens.at(-1).context.actions.start({ aiDifficulty: "easy" });

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.gameController?.aiDifficulty, "easy");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: selecting Normal from the difficulty screen starts PvE with normal difficulty", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "easy", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "NormalPicker";
  app.profile = { username: "NormalPicker" };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.showAiDifficultySelect();
    await shownScreens.at(-1).context.actions.start({ aiDifficulty: "normal" });

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.gameController?.aiDifficulty, "normal");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: selecting Hard from the difficulty screen starts PvE with hard difficulty", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "HardPicker";
  app.profile = { username: "HardPicker" };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.showAiDifficultySelect();
    await shownScreens.at(-1).context.actions.start({ aiDifficulty: "hard" });

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.gameController?.aiDifficulty, "hard");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: selecting Featured Rival starts PvE with rival config instead of a fake aiDifficulty", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "easy", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "RivalPicker";
  app.profile = {
    username: "RivalPicker",
    equippedCosmetics: { background: "default_background" }
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.showAiDifficultySelect();
    await shownScreens.at(-1).context.actions.start({ featuredRivalId: "crownfire_duelist" });

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.gameController?.featuredRivalId, "crownfire_duelist");
    assert.equal(app.gameController?.aiDifficulty, "hard");
    assert.match(shownScreens.at(-1).context.arenaBackground, /bg_crownfire_arena\.png/);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: selecting Gauntlet starts PvE with dedicated gauntlet routing while keeping normal PvE fallback behavior", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const gauntletStatCalls = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletPicker";
  app.gauntletRandom = () => 0;
  app.chooseRandomElementCardVariantMap = () => ({
    fire: "fire_variant_ember",
    water: "water_variant_crystal",
    earth: "earth_variant_titan",
    wind: "wind_variant_sky_serpent"
  });
  app.profile = {
    username: "GauntletPicker",
    equippedCosmetics: { background: "default_background" }
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => {
            gauntletStatCalls.push(payload);
            return {
              profile: {
                username: payload.username,
                gauntletBestStreak: 0,
                gauntletRuns: 1,
                gauntletWins: 0,
                gauntletLosses: 0,
                gauntletRivalsDefeated: 0
              }
            };
          }
        }
      }
    };

    app.showAiDifficultySelect();
    await shownScreens.at(-1).context.actions.start({ gauntletMode: true });
    await Promise.resolve();

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.pveGauntletMode, true);
    assert.equal(app.pveFeaturedRivalId, null);
    assert.deepEqual(app.gauntletRunState, {
      active: true,
      sessionId: null,
      previousSessionId: null,
      currentStreak: 0,
      currentRivalIndex: 1,
      currentRivalId: "tide_witch",
      rivalBag: [
        "stonewall",
        "storm_chaser",
        "inferno_drummer",
        "river_spiral",
        "stone_march",
        "fourfold_monk",
        "cyclebound",
        "mimic_rival",
        "vampire_rival",
        "lycan_rival",
        "street_duelist",
        "frostveil_heir",
        "goldbound_archon",
        "pyro_maniac"
      ],
      lastRivalId: null,
      claimedMilestoneStreaks: [],
      defeatedRivalIds: [],
      lastResult: null
    });
    assert.equal(app.gameController?.featuredRivalId, null);
      assert.equal(app.gameController?.gauntletRivalId, "tide_witch");
      assert.equal(app.gameController?.match?.gauntletRivalId, "tide_witch");
      assert.equal(app.gameController?.aiDifficulty, "normal");
      assert.equal(shownScreens.at(-1).context.opponentDisplay.name, "Tide Witch");
      assert.equal(shownScreens.at(-1).context.opponentDisplay.title, "Tidecaller");
      assert.match(shownScreens.at(-1).context.opponentDisplay.avatar, /gauntlet\/avatars\/avatar_gauntlet_tide_witch\.png/);
      assert.doesNotMatch(shownScreens.at(-1).context.opponentDisplay.avatar, /assets\/avatars\//);
      assert.deepEqual(shownScreens.at(-1).context.opponentCardVariants, {
        fire: "fire_variant_ember",
        water: "water_variant_crystal",
        earth: "earth_variant_titan",
        wind: "wind_variant_sky_serpent"
      });
      assert.deepEqual(gauntletStatCalls, [
        {
          username: "GauntletPicker",
          runStarted: true,
          matchWon: false,
          runEndedWithLoss: false,
          currentStreak: 0,
          claimedMilestoneStreaks: []
        }
      ]);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: gauntlet start creates a shuffled rival bag and first rival is pulled from it", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.gauntletRandom = () => 0;

  const firstRival = app.startFreshGauntletRun();

  assert.equal(firstRival?.id, "tide_witch");
  assert.deepEqual(app.gauntletRunState.rivalBag, [
    "stonewall",
    "storm_chaser",
    "inferno_drummer",
    "river_spiral",
    "stone_march",
    "fourfold_monk",
    "cyclebound",
    "mimic_rival",
    "vampire_rival",
    "lycan_rival",
    "street_duelist",
    "frostveil_heir",
    "goldbound_archon",
    "pyro_maniac"
  ]);
  assert.equal(app.gauntletRunState.currentRivalId, "tide_witch");
  assert.equal(app.gauntletRunState.lastRivalId, null);
  assert.deepEqual(app.gauntletRunState.claimedMilestoneStreaks, []);
});

test("appController: gauntlet win increments streak, queues a confirmation transition, and pulls the next rival from the bag", () => {
  const starts = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    sessionId: null,
    previousSessionId: null,
    currentStreak: 0,
    currentRivalIndex: 1,
    currentRivalId: "tide_witch",
    rivalBag: ["stonewall", "storm_chaser", "inferno_drummer"],
    lastRivalId: null,
    claimedMilestoneStreaks: [],
    defeatedRivalIds: [],
    lastResult: null
  };

  const continued = app.handleGauntletMatchCompletion({ winner: "p1", endReason: "normal" });

  assert.deepEqual(continued, {
    handled: true,
    type: "victory",
    nextRival: app.getCurrentGauntletRival(),
    streak: 1
  });
  assert.deepEqual(app.gauntletRunState, {
    active: true,
    sessionId: null,
    previousSessionId: null,
    currentStreak: 1,
    currentRivalIndex: 2,
    currentRivalId: "stonewall",
    rivalBag: ["storm_chaser", "inferno_drummer"],
    lastRivalId: "tide_witch",
    claimedMilestoneStreaks: [],
    defeatedRivalIds: ["tide_witch"],
      lastResult: "win"
    });
  assert.deepEqual(app.pendingGauntletContinuation, {
    mode: MATCH_MODE.PVE,
    options: {
      gauntletMode: true,
      gauntletContinue: true,
      gauntletRivalId: "stonewall"
    }
  });
  assert.deepEqual(starts, []);
  assert.equal(app.flushPendingGauntletContinuation(), false);
  assert.equal(app.flushPendingGauntletContinuation({ force: true }), true);
  assert.deepEqual(starts, [
    {
      mode: MATCH_MODE.PVE,
      options: {
        gauntletMode: true,
        gauntletContinue: true,
        gauntletRivalId: "stonewall"
      }
    }
  ]);
});

test("appController: gauntlet bag use never selects the same rival twice in a row", () => {
  const starts = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentStreak: 3,
    currentRivalIndex: 0,
    currentRivalId: "pyro_maniac",
    rivalBag: ["pyro_maniac", "tide_witch", "stonewall"],
    lastRivalId: null,
    claimedMilestoneStreaks: [],
    defeatedRivalIds: [],
    lastResult: null
  };

  const continued = app.handleGauntletMatchCompletion({ winner: "p1", endReason: "normal" });

  assert.deepEqual(continued, {
    handled: true,
    type: "victory",
    nextRival: app.getCurrentGauntletRival(),
    streak: 4
  });
  assert.notEqual(app.gauntletRunState.currentRivalId, "pyro_maniac");
  assert.equal(app.gauntletRunState.currentRivalId, "tide_witch");
  assert.equal(app.flushPendingGauntletContinuation({ force: true }), true);
  assert.equal(starts.at(-1)?.options?.gauntletRivalId, "tide_witch");
});

test("appController: gauntlet bag refill recreates all 15 rivals and avoids an immediate repeat", () => {
  const starts = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.gauntletRandom = () => 0;
  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentStreak: 7,
    currentRivalIndex: 1,
    currentRivalId: "tide_witch",
    rivalBag: [],
    lastRivalId: null,
    claimedMilestoneStreaks: [],
    defeatedRivalIds: ["pyro_maniac"],
    lastResult: null
  };

  const continued = app.handleGauntletMatchCompletion({ winner: "p1", endReason: "normal" });

  assert.deepEqual(continued, {
    handled: true,
    type: "victory",
    nextRival: app.getCurrentGauntletRival(),
    streak: 8
  });
  assert.equal(app.gauntletRunState.currentStreak, 8);
  assert.equal(app.gauntletRunState.lastRivalId, "tide_witch");
  assert.notEqual(app.gauntletRunState.currentRivalId, "tide_witch");
  assert.equal(app.gauntletRunState.currentRivalId, "stonewall");
  assert.equal(app.gauntletRunState.currentRivalIndex, 2);
  assert.equal(app.gauntletRunState.rivalBag.length, 14);
  assert.deepEqual(app.gauntletRunState.rivalBag, [
    "tide_witch",
    "storm_chaser",
    "inferno_drummer",
    "river_spiral",
    "stone_march",
    "fourfold_monk",
    "cyclebound",
    "mimic_rival",
    "vampire_rival",
    "lycan_rival",
    "street_duelist",
    "frostveil_heir",
    "goldbound_archon",
    "pyro_maniac"
  ]);
  assert.equal(app.gauntletRunState.defeatedRivalIds.at(-1), "tide_witch");
  assert.equal(app.flushPendingGauntletContinuation(), false);
  assert.equal(app.flushPendingGauntletContinuation({ force: true }), true);
  assert.deepEqual(starts.at(-1), {
    mode: MATCH_MODE.PVE,
    options: {
      gauntletMode: true,
      gauntletContinue: true,
      gauntletRivalId: "stonewall"
    }
  });
});

test("appController: gauntlet loss ends the run without starting another match", () => {
  const starts = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentStreak: 2,
    currentRivalIndex: 2,
    currentRivalId: "stonewall",
    rivalBag: ["storm_chaser"],
    lastRivalId: "tide_witch",
    claimedMilestoneStreaks: [],
    defeatedRivalIds: ["pyro_maniac", "tide_witch"],
    lastResult: null
  };

  const continued = app.handleGauntletMatchCompletion({ winner: "p2", endReason: "normal" });

  assert.deepEqual(continued, {
    handled: false,
    type: "ended",
    result: "loss",
    showSummary: true,
    finalStreak: 2,
    rivalsDefeated: 2,
    rivalLabel: "Lost To",
    rivalName: "Stonewall"
  });
  assert.equal(app.pveGauntletMode, true);
  assert.equal(app.gauntletRunState.active, false);
  assert.equal(app.gauntletRunState.lastResult, "loss");
  assert.deepEqual(starts, []);
});

test("appController: gauntlet draw ends the run without starting another match", () => {
  const starts = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentStreak: 1,
    currentRivalIndex: 1,
    currentRivalId: "tide_witch",
    rivalBag: ["stonewall"],
    lastRivalId: "pyro_maniac",
    claimedMilestoneStreaks: [],
    defeatedRivalIds: ["pyro_maniac"],
    lastResult: null
  };

  const continued = app.handleGauntletMatchCompletion({ winner: "draw", endReason: "hand_exhaustion" });

  assert.deepEqual(continued, {
    handled: false,
    type: "ended",
    result: "draw",
    showSummary: true,
    finalStreak: 1,
    rivalsDefeated: 1,
    rivalLabel: "Final Rival",
    rivalName: "Tide Witch"
  });
  assert.equal(app.pveGauntletMode, true);
  assert.equal(app.gauntletRunState.active, false);
  assert.equal(app.gauntletRunState.lastResult, "draw");
  assert.deepEqual(starts, []);
});

test("appController: gauntlet hand-exhaustion loss ends the run without starting another match", () => {
  const starts = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentStreak: 2,
    currentRivalIndex: 2,
    currentRivalId: "stonewall",
    rivalBag: ["storm_chaser"],
    lastRivalId: "tide_witch",
    claimedMilestoneStreaks: [],
    defeatedRivalIds: ["pyro_maniac", "tide_witch"],
    lastResult: null
  };

  const continued = app.handleGauntletMatchCompletion({ winner: "p2", endReason: "hand_exhaustion" });

  assert.deepEqual(continued, {
    handled: false,
    type: "ended",
    result: "loss",
    showSummary: true,
    finalStreak: 2,
    rivalsDefeated: 2,
    rivalLabel: "Lost To",
    rivalName: "Stonewall"
  });
  assert.equal(app.pveGauntletMode, true);
  assert.equal(app.gauntletRunState.active, false);
  assert.equal(app.gauntletRunState.lastResult, "loss");
  assert.deepEqual(starts, []);
});

test("appController: gauntlet match win records persistent win stats without incrementing runs again", async () => {
  const originalWindow = globalThis.window;
  const gauntletStatCalls = [];
  const continuedStarts = [];
  const modalManager = createModalCapture();
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager,
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletWinner";
  app.gauntletRandom = () => 0;
  app.profile = { username: "GauntletWinner", equippedCosmetics: { background: "default_background" } };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.buildMatchCompleteModalPayload = () => ({ title: "unused", bodyHtml: "", mode: MATCH_MODE.PVE });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => {
            gauntletStatCalls.push(payload);
            return {
              profile: {
                username: payload.username,
                gauntletBestStreak: payload.matchWon ? payload.currentStreak : 0,
                gauntletRuns: 1,
                gauntletWins: payload.matchWon ? 1 : 0,
                gauntletLosses: payload.runEndedWithLoss ? 1 : 0,
                gauntletRivalsDefeated: payload.matchWon ? 1 : 0
              },
              claimedMilestoneStreaks: payload.matchWon ? [3] : payload.claimedMilestoneStreaks ?? [],
              milestoneRewards: payload.matchWon
                ? [{ streak: 3, xp: 0, tokens: 25, chests: [] }]
                : [],
              xpConversionTokenBonus: payload.matchWon ? 2 : 0
            };
          }
        }
      }
    };
    const originalDocument = globalThis.document;
    const continueButton = createFakeDomElement();
    const returnButton = createFakeDomElement();
    globalThis.document = {
      getElementById: (id) =>
        id === "gauntlet-continue-btn"
          ? continueButton
          : id === "gauntlet-return-menu-btn"
            ? returnButton
            : null,
      querySelector: () => null
    };

    try {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();
      app.roundPresentation = { phase: "reveal", busy: true, selectedCardIndex: 0 };
      app.screenFlow = "game";
      const originalStartGame = app.startGame.bind(app);
      app.startGame = (mode, options = {}) => {
        continuedStarts.push({ mode, options });
        return originalStartGame(mode, options);
      };

      await app.gameController.onMatchComplete({
        match: { winner: "p1", endReason: "normal" },
        persisted: { profile: { username: "GauntletWinner" } }
      });

      assert.equal(modalManager.shows.length, 0);
      assert.ok(app.pendingGauntletVictoryPayload);

      app.roundPresentation = { phase: "idle", busy: false, selectedCardIndex: null };
      app.screenFlow = "idle";
      assert.equal(app.flushPendingGauntletVictoryModal(), true);

      assert.equal(modalManager.shows.length, 1);
      assert.equal(modalManager.shows[0].title, "Gauntlet Victory!");
      assert.match(modalManager.shows[0].bodyHtml, /Streak: 1/);
      assert.match(modalManager.shows[0].bodyHtml, /Next Rival:/);
      assert.match(modalManager.shows[0].bodyHtml, /Milestone Reward!/);
      assert.match(modalManager.shows[0].bodyHtml, /\+25 Tokens/);
      assert.match(modalManager.shows[0].bodyHtml, /Max Level Bonus: \+2 Tokens/);
      assert.match(modalManager.shows[0].bodyHtml, /Continue Gauntlet/);
      assert.doesNotMatch(modalManager.shows[0].bodyHtml, /Gauntlet Run Ended|Lost To/);
      assert.equal(continuedStarts.length, 0);
      assert.ok(app.pendingGauntletContinuation);
      assert.equal(app.pendingGauntletContinuationRequiresConfirm, true);

      await continueButton.listeners.get("click")?.();

      assert.deepEqual(gauntletStatCalls, [
        {
          username: "GauntletWinner",
          runStarted: true,
          matchWon: false,
          runEndedWithLoss: false,
          currentStreak: 0,
          claimedMilestoneStreaks: []
        },
        {
          username: "GauntletWinner",
          runStarted: false,
          matchWon: true,
          runEndedWithLoss: false,
          currentStreak: 1,
          claimedMilestoneStreaks: []
        }
      ]);
      assert.equal(app.profile.gauntletRuns, 1);
      assert.equal(app.profile.gauntletWins, 1);
      assert.equal(app.profile.gauntletRivalsDefeated, 1);
      assert.equal(app.profile.gauntletBestStreak, 1);
      assert.deepEqual(app.gauntletRunState.claimedMilestoneStreaks, [3]);
      assert.equal(continuedStarts.length, 1);
      await continueButton.listeners.get("click")?.();
      assert.equal(continuedStarts.length, 1);
      assert.equal(app.pendingGauntletContinuation, null);
      assert.equal(app.pendingGauntletContinuationRequiresConfirm, false);
      assert.equal(app.pendingGauntletVictoryPayload, null);
      assert.equal(gauntletStatCalls.length, 2);
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: gauntlet time-limit win records persistent win stats and continues like a normal victory", async () => {
  const originalWindow = globalThis.window;
  const gauntletStatCalls = [];
  const continuedStarts = [];
  const modalManager = createModalCapture();
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager,
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletTimerWinner";
  app.gauntletRandom = () => 0;
  app.profile = { username: "GauntletTimerWinner", equippedCosmetics: { background: "default_background" } };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.buildMatchCompleteModalPayload = () => ({ title: "unused", bodyHtml: "", mode: MATCH_MODE.PVE });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => {
            gauntletStatCalls.push(payload);
            return {
              profile: {
                username: payload.username,
                gauntletBestStreak: payload.matchWon ? payload.currentStreak : 0,
                gauntletRuns: 1,
                gauntletWins: payload.matchWon ? 1 : 0,
                gauntletLosses: payload.runEndedWithLoss ? 1 : 0,
                gauntletRivalsDefeated: payload.matchWon ? 1 : 0
              },
              claimedMilestoneStreaks: payload.matchWon ? [3] : payload.claimedMilestoneStreaks ?? [],
              milestoneRewards: payload.matchWon
                ? [{ streak: 3, xp: 0, tokens: 25, chests: [] }]
                : [],
              xpConversionTokenBonus: payload.matchWon ? 2 : 0
            };
          }
        }
      }
    };
    const originalDocument = globalThis.document;
    const continueButton = createFakeDomElement();
    const returnButton = createFakeDomElement();
    globalThis.document = {
      getElementById: (id) =>
        id === "gauntlet-continue-btn"
          ? continueButton
          : id === "gauntlet-return-menu-btn"
            ? returnButton
            : null,
      querySelector: () => null
    };

    try {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();
      app.roundPresentation = { phase: "reveal", busy: true, selectedCardIndex: 0 };
      app.screenFlow = "game";
      const originalStartGame = app.startGame.bind(app);
      app.startGame = (mode, options = {}) => {
        continuedStarts.push({ mode, options });
        return originalStartGame(mode, options);
      };

      await app.gameController.onMatchComplete({
        match: { winner: "p1", endReason: "time_limit" },
        persisted: { profile: { username: "GauntletTimerWinner" } }
      });

      assert.equal(modalManager.shows.length, 0);
      assert.ok(app.pendingGauntletVictoryPayload);

      app.roundPresentation = { phase: "idle", busy: false, selectedCardIndex: null };
      app.screenFlow = "idle";
      assert.equal(app.flushPendingGauntletVictoryModal(), true);

      assert.equal(modalManager.shows.length, 1);
      assert.equal(modalManager.shows[0].title, "Gauntlet Victory!");
      assert.match(modalManager.shows[0].bodyHtml, /Streak: 1/);
      assert.match(modalManager.shows[0].bodyHtml, /Next Rival:/);
      assert.match(modalManager.shows[0].bodyHtml, /Continue Gauntlet/);
      assert.doesNotMatch(modalManager.shows[0].bodyHtml, /Gauntlet Run Ended|Lost To/);
      assert.ok(app.pendingGauntletContinuation);
      assert.equal(app.pendingGauntletContinuationRequiresConfirm, true);

      await continueButton.listeners.get("click")?.();

      assert.deepEqual(gauntletStatCalls, [
        {
          username: "GauntletTimerWinner",
          runStarted: true,
          matchWon: false,
          runEndedWithLoss: false,
          currentStreak: 0,
          claimedMilestoneStreaks: []
        },
        {
          username: "GauntletTimerWinner",
          runStarted: false,
          matchWon: true,
          runEndedWithLoss: false,
          currentStreak: 1,
          claimedMilestoneStreaks: []
        }
      ]);
      assert.equal(app.profile.gauntletRuns, 1);
      assert.equal(app.profile.gauntletWins, 1);
      assert.equal(app.profile.gauntletRivalsDefeated, 1);
      assert.equal(app.profile.gauntletBestStreak, 1);
      assert.deepEqual(app.gauntletRunState.claimedMilestoneStreaks, [3]);
      assert.equal(continuedStarts.length, 1);
      assert.equal(continuedStarts.at(-1)?.options?.gauntletContinue, true);
      assert.equal(app.pendingGauntletContinuation, null);
      assert.equal(app.pendingGauntletContinuationRequiresConfirm, false);
      assert.equal(app.pendingGauntletVictoryPayload, null);
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: gauntlet time-limit loss ends the run without starting another match", () => {
  const starts = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentStreak: 2,
    currentRivalIndex: 2,
    currentRivalId: "stonewall",
    rivalBag: ["storm_chaser"],
    lastRivalId: "tide_witch",
    claimedMilestoneStreaks: [],
    defeatedRivalIds: ["pyro_maniac", "tide_witch"],
    lastResult: null
  };

  const continued = app.handleGauntletMatchCompletion({ winner: "p2", endReason: "time_limit" });

  assert.deepEqual(continued, {
    handled: false,
    type: "ended",
    result: "loss",
    showSummary: true,
    finalStreak: 2,
    rivalsDefeated: 2,
    rivalLabel: "Lost To",
    rivalName: "Stonewall"
  });
  assert.equal(app.pveGauntletMode, true);
  assert.equal(app.gauntletRunState.active, false);
  assert.equal(app.gauntletRunState.lastResult, "loss");
  assert.deepEqual(starts, []);
});

test("appController: gauntlet victory return to menu clears queued continuation and temporary run state safely", async () => {
  const originalWindow = globalThis.window;
  const modalManager = createModalCapture();
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager,
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletReturnUser";
  app.gauntletRandom = () => 0;
  app.profile = { username: "GauntletReturnUser", equippedCosmetics: { background: "default_background" } };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.buildMatchCompleteModalPayload = () => ({ title: "unused", bodyHtml: "", mode: MATCH_MODE.PVE });

  let returnedToMenu = 0;
  app.showMenu = () => {
    returnedToMenu += 1;
  };
  app.refreshDailyChallengesForMenu = async () => {};

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => ({
            profile: {
              username: payload.username,
              gauntletBestStreak: payload.matchWon ? payload.currentStreak : 0,
              gauntletRuns: 1,
              gauntletWins: payload.matchWon ? 1 : 0,
              gauntletLosses: 0,
              gauntletRivalsDefeated: payload.matchWon ? 1 : 0,
              equippedCosmetics: { background: "default_background" }
            },
            claimedMilestoneStreaks: payload.claimedMilestoneStreaks ?? [],
            milestoneRewards: []
          })
        }
      }
    };
    const originalDocument = globalThis.document;
    const continueButton = createFakeDomElement();
    const returnButton = createFakeDomElement();
    globalThis.document = {
      getElementById: (id) =>
        id === "gauntlet-continue-btn"
          ? continueButton
          : id === "gauntlet-return-menu-btn"
            ? returnButton
            : null,
      querySelector: () => null
    };

    try {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();

      await app.gameController.onMatchComplete({
        match: { winner: "p1", endReason: "normal" },
        persisted: { profile: { username: "GauntletReturnUser" } }
      });

      assert.equal(modalManager.shows.length, 1);
      assert.ok(app.pendingGauntletContinuation);
      await returnButton.listeners.get("click")?.();

      assert.equal(returnedToMenu, 1);
      assert.equal(app.pendingGauntletContinuation, null);
      assert.equal(app.pendingGauntletContinuationRequiresConfirm, false);
      assert.equal(app.pveGauntletMode, false);
      assert.equal(app.gauntletRunState.active, false);
      assert.deepEqual(app.profile.equippedCosmetics, { background: "default_background" });
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated Gauntlet stat persistence uses multiplayer authority after each win and avoids the local duplicate path", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "GauntletAuthorityUser";
  app.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "GauntletAuthorityUser"
    }
  };
  app.profile = {
    username: "GauntletAuthorityUser",
    gauntletBestStreak: 1,
    gauntletWins: 1,
    gauntletRivalsDefeated: 1,
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "default_background",
      cardBack: "default_card_back",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  app.currentGauntletLocalMatchSession = {
    sessionId: "gauntlet-session-1",
    status: "active",
    metadata: {
      currentStreak: 2,
      claimedMilestoneStreaks: []
    }
  };
  app.gauntletRunState = {
    ...app.gauntletRunState,
    active: true,
    sessionId: "gauntlet-session-1",
    previousSessionId: null,
    currentStreak: 2,
    currentRivalId: "stonewall",
    claimedMilestoneStreaks: [],
    defeatedRivalIds: ["pyro_maniac", "tide_witch"]
  };

  const calls = [];

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          recordGauntletStats: async (payload) => {
            calls.push({ source: "multiplayer", payload });
            return {
              gauntletStats: {
                gauntletBestStreak: 3,
                gauntletWins: 2,
                gauntletRivalsDefeated: 2
              },
              snapshot: {
                username: "GauntletAuthorityUser",
                profile: {
                  username: "GauntletAuthorityUser",
                  gauntletBestStreak: 3,
                  gauntletRuns: 1,
                  gauntletWins: 2,
                  gauntletLosses: 0,
                  gauntletRivalsDefeated: 2,
                  equippedCosmetics: app.profile.equippedCosmetics
                },
                cosmetics: {
                  equipped: app.profile.equippedCosmetics,
                  owned: {
                    avatar: ["default_avatar"],
                    cardBack: ["default_card_back"],
                    background: ["default_background"],
                    elementCardVariant: [
                      "default_fire_card",
                      "default_water_card",
                      "default_earth_card",
                      "default_wind_card"
                    ],
                    badge: ["none"],
                    title: ["Initiate"]
                  }
                },
                stats: {
                  summary: {
                    wins: 0,
                    losses: 0,
                    gamesPlayed: 0,
                    warsEntered: 0,
                    warsWon: 0,
                    cardsCaptured: 0
                  },
                  modes: {}
                },
                currency: {
                  tokens: 200
                },
                progression: {
                  xp: {
                    playerXP: 0,
                    playerLevel: 1
                  }
                }
              }
            };
          }
        },
        state: {
          recordGauntletStats: async () => {
            throw new Error("local gauntlet stat persistence should not run for authenticated authority");
          }
        }
      }
    };

    const result = await app.recordGauntletProfileStats({
      matchWon: true,
      currentStreak: 3,
      claimedMilestoneStreaks: []
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      source: "multiplayer",
      payload: {
        username: "GauntletAuthorityUser",
        runStarted: false,
        matchWon: true,
        runEndedWithLoss: false,
        currentStreak: 3,
        claimedMilestoneStreaks: [],
        localMatchSessionId: "gauntlet-session-1"
      }
    });
    assert.equal(result.profile.gauntletBestStreak, 3);
    assert.equal(result.profile.gauntletWins, 2);
    assert.equal(result.profile.gauntletRivalsDefeated, 2);
    assert.equal(app.profile.gauntletBestStreak, 3);
    assert.equal(app.profile.gauntletWins, 2);
    assert.equal(app.profile.gauntletRivalsDefeated, 2);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: local Gauntlet stat persistence still uses the local state path", async () => {
  const originalWindow = globalThis.window;
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "LocalGauntletPersist";
  app.onlinePlayState = {
    connectionStatus: "disconnected",
    session: {
      authenticated: false,
      username: null
    }
  };
  app.profile = {
    username: "LocalGauntletPersist",
    gauntletBestStreak: 0,
    gauntletWins: 0,
    gauntletRivalsDefeated: 0,
    equippedCosmetics: {}
  };

  const calls = [];

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          recordGauntletStats: async () => {
            throw new Error("multiplayer gauntlet stat persistence should not run for local profiles");
          }
        },
        state: {
          recordGauntletStats: async (payload) => {
            calls.push(payload);
            return {
              profile: {
                ...app.profile,
                gauntletBestStreak: 2,
                gauntletWins: 1,
                gauntletRivalsDefeated: 1
              }
            };
          }
        }
      }
    };

    const result = await app.recordGauntletProfileStats({
      matchWon: true,
      currentStreak: 2
    });

    assert.deepEqual(calls, [
      {
        username: "LocalGauntletPersist",
        runStarted: false,
        matchWon: true,
        runEndedWithLoss: false,
        currentStreak: 2,
        claimedMilestoneStreaks: []
      }
    ]);
    assert.equal(result.profile.gauntletBestStreak, 2);
    assert.equal(app.profile.gauntletWins, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: gauntlet streaks above 20 continue the run without granting repeated milestone rewards", async () => {
  const originalWindow = globalThis.window;
  const gauntletStatCalls = [];
  const modalManager = createModalCapture();
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager,
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletTwentyOne";
  app.gauntletRandom = () => 0;
  app.profile = { username: "GauntletTwentyOne", equippedCosmetics: { background: "default_background" } };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.buildMatchCompleteModalPayload = () => ({ title: "unused", bodyHtml: "", mode: MATCH_MODE.PVE });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({ tokenDelta: 9, xpDelta: 11 }),
          recordGauntletStats: async (payload) => {
            gauntletStatCalls.push(payload);
            return {
              profile: {
                username: payload.username,
                gauntletBestStreak: payload.matchWon ? payload.currentStreak : 20,
                gauntletRuns: 1,
                gauntletWins: payload.matchWon ? 21 : 20,
                gauntletLosses: 0,
                gauntletRivalsDefeated: payload.matchWon ? 21 : 20
              },
              claimedMilestoneStreaks: [3, 5, 10, 15, 20],
              milestoneRewards: []
            };
          }
        }
      }
    };
    const originalDocument = globalThis.document;
    globalThis.document = {
      getElementById: () => createFakeDomElement(),
      querySelector: () => null
    };

    try {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();
      app.gauntletRunState = {
        ...app.gauntletRunState,
        active: true,
        currentStreak: 20,
        claimedMilestoneStreaks: [3, 5, 10, 15, 20]
      };

      await app.gameController.onMatchComplete({
        match: { winner: "p1", endReason: "hand_exhaustion" },
        persisted: { profile: { username: "GauntletTwentyOne" }, tokenDelta: 9, xpDelta: 11 }
      });

      assert.equal(modalManager.shows.length, 1);
      assert.match(modalManager.shows[0].bodyHtml, /Streak: 21/);
      assert.doesNotMatch(modalManager.shows[0].bodyHtml, /Milestone Reward!/);
      assert.equal(app.gauntletRunState.currentStreak, 21);
      assert.ok(app.pendingGauntletContinuation);
      assert.deepEqual(gauntletStatCalls.at(-1), {
        username: "GauntletTwentyOne",
        runStarted: false,
        matchWon: true,
        runEndedWithLoss: false,
        currentStreak: 21,
        claimedMilestoneStreaks: [3, 5, 10, 15, 20]
      });
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: gauntlet terminal draw records one persistent loss and quit does not", async () => {
  const originalWindow = globalThis.window;
  const gauntletStatCalls = [];
  const matchCompletePayloads = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletTerminal";
  app.gauntletRandom = () => 0;
  app.profile = { username: "GauntletTerminal", equippedCosmetics: { background: "default_background" } };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.showMatchCompleteModal = (payload) => {
    matchCompletePayloads.push(payload);
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => {
            gauntletStatCalls.push(payload);
            return {
              profile: {
                username: payload.username,
                gauntletBestStreak: 0,
                gauntletRuns: 1,
                gauntletWins: 0,
                gauntletLosses: payload.runEndedWithLoss ? 1 : 0,
                gauntletRivalsDefeated: 0
              }
            };
          }
        }
      }
    };

    app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
    await Promise.resolve();
    const gauntletLossRivalName = app.getCurrentGauntletRival()?.displayName ?? "";
    gauntletStatCalls.length = 0;

    await app.gameController.onMatchComplete({
      match: { winner: "draw", endReason: "hand_exhaustion" },
      persisted: { profile: { username: "GauntletTerminal" } }
    });

    assert.deepEqual(gauntletStatCalls, [
        {
          username: "GauntletTerminal",
          runStarted: false,
          matchWon: false,
          runEndedWithLoss: true,
          currentStreak: 0,
          claimedMilestoneStreaks: []
        }
      ]);
    assert.equal(matchCompletePayloads.length, 1);
    assert.equal(matchCompletePayloads[0].title, "Gauntlet Run Ended");
    assert.match(matchCompletePayloads[0].bodyHtml, /Lost To|Final Rival/);
    if (gauntletLossRivalName) {
      assert.match(matchCompletePayloads[0].bodyHtml, new RegExp(gauntletLossRivalName));
    }
    assert.match(matchCompletePayloads[0].bodyHtml, /Final Streak/);
    assert.match(matchCompletePayloads[0].bodyHtml, /Best Streak/);
    assert.match(matchCompletePayloads[0].bodyHtml, /Rivals Defeated/);
    assert.match(matchCompletePayloads[0].bodyHtml, /match-complete-stat-value">0<\/strong>/);

    app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
    await Promise.resolve();
    gauntletStatCalls.length = 0;
    matchCompletePayloads.length = 0;

    await app.gameController.onMatchComplete({
      match: { winner: "p2", endReason: "quit_forfeit" },
      persisted: { profile: { username: "GauntletTerminal" } }
    });

    assert.deepEqual(gauntletStatCalls, []);
    assert.equal(matchCompletePayloads[0].title, "Match Complete");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: gauntlet loss wrap-up survives async completion context resets", async () => {
  const originalWindow = globalThis.window;
  const gauntletStatCalls = [];
  const matchCompletePayloads = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletContext";
  app.gauntletRandom = () => 0;
  app.profile = { username: "GauntletContext", equippedCosmetics: { background: "default_background" } };
  app.applyPostMatchCosmeticRandomization = async () => {
    app.clearGauntletRunState();
  };
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.showMatchCompleteModal = (payload) => {
    matchCompletePayloads.push(payload);
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => {
            gauntletStatCalls.push(payload);
            return {
              profile: {
                username: payload.username,
                gauntletBestStreak: 0,
                gauntletRuns: 1,
                gauntletWins: 0,
                gauntletLosses: payload.runEndedWithLoss ? 1 : 0,
                gauntletRivalsDefeated: 0
              }
            };
          }
        }
      }
    };

    const scenarios = [
      {
        match: { winner: "p2", endReason: "normal" },
        expectedTitle: "Gauntlet Run Ended",
        expectedResult: "loss",
        expectedLabel: /Lost To/
      },
      {
        match: { winner: "p2", endReason: "hand_exhaustion" },
        expectedTitle: "Gauntlet Run Ended",
        expectedResult: "loss",
        expectedLabel: /Lost To/
      },
      {
        match: { winner: "p2", endReason: "time_limit" },
        expectedTitle: "Gauntlet Run Ended",
        expectedResult: "loss",
        expectedLabel: /Lost To/
      },
      {
        match: { winner: "draw", endReason: "hand_exhaustion" },
        expectedTitle: "Gauntlet Run Ended",
        expectedResult: "draw",
        expectedLabel: /Final Rival/
      }
    ];

    for (const scenario of scenarios) {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();
      const rivalName = app.getCurrentGauntletRival()?.displayName ?? "";
      gauntletStatCalls.length = 0;
      matchCompletePayloads.length = 0;

      await app.gameController.onMatchComplete({
        match: scenario.match,
        persisted: { profile: { username: "GauntletContext" } }
      });

      assert.deepEqual(gauntletStatCalls, [
        {
          username: "GauntletContext",
          runStarted: false,
          matchWon: false,
          runEndedWithLoss: true,
          currentStreak: 0,
          claimedMilestoneStreaks: []
        }
      ]);
      assert.equal(matchCompletePayloads.length, 1);
      assert.equal(matchCompletePayloads[0].title, scenario.expectedTitle);
      assert.match(matchCompletePayloads[0].bodyHtml, scenario.expectedLabel);
      if (rivalName) {
        assert.match(matchCompletePayloads[0].bodyHtml, new RegExp(rivalName));
      }
      assert.equal(app.gauntletRunState.lastResult, scenario.expectedResult);
    }

    app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
    await Promise.resolve();
    gauntletStatCalls.length = 0;
    matchCompletePayloads.length = 0;

    await app.gameController.onMatchComplete({
      match: { winner: "p2", endReason: "quit_forfeit" },
      persisted: { profile: { username: "GauntletContext" } }
    });

    assert.deepEqual(gauntletStatCalls, []);
    assert.equal(matchCompletePayloads.length, 1);
    assert.equal(matchCompletePayloads[0].title, "Match Complete");

    app.startGame(MATCH_MODE.PVE, {});
    await Promise.resolve();
    gauntletStatCalls.length = 0;
    matchCompletePayloads.length = 0;

    await app.gameController.onMatchComplete({
      match: { winner: "p2", endReason: "hand_exhaustion" },
      persisted: { profile: { username: "GauntletContext" } }
    });

    assert.deepEqual(gauntletStatCalls, []);
    assert.equal(matchCompletePayloads.length, 1);
    assert.equal(matchCompletePayloads[0].title, "Match Complete");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: gauntlet victory modal does not show milestone reward text when no milestone is earned", async () => {
  const originalWindow = globalThis.window;
  const modalManager = createModalCapture();
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager,
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletNoMilestone";
  app.gauntletRandom = () => 0;
  app.profile = { username: "GauntletNoMilestone", equippedCosmetics: { background: "default_background" } };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.buildMatchCompleteModalPayload = () => ({ title: "unused", bodyHtml: "", mode: MATCH_MODE.PVE });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => ({
            profile: {
              username: payload.username,
              gauntletBestStreak: payload.matchWon ? payload.currentStreak : 0,
              gauntletRuns: 1,
              gauntletWins: payload.matchWon ? 1 : 0,
              gauntletLosses: 0,
              gauntletRivalsDefeated: payload.matchWon ? 1 : 0
            },
            claimedMilestoneStreaks: payload.claimedMilestoneStreaks ?? [],
            milestoneRewards: []
          })
        }
      }
    };
    const originalDocument = globalThis.document;
    const continueButton = createFakeDomElement();
    const returnButton = createFakeDomElement();
    globalThis.document = {
      getElementById: (id) =>
        id === "gauntlet-continue-btn"
          ? continueButton
          : id === "gauntlet-return-menu-btn"
            ? returnButton
            : null,
      querySelector: () => null
    };

    try {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();
      await app.gameController.onMatchComplete({
        match: { winner: "p1", endReason: "normal" },
        persisted: { profile: { username: "GauntletNoMilestone" } }
      });

      assert.equal(modalManager.shows.length, 1);
      assert.doesNotMatch(modalManager.shows[0].bodyHtml, /Milestone Reward!/);
      assert.doesNotMatch(modalManager.shows[0].bodyHtml, /\+\d+\s+Tokens/);
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: Gauntlet milestone XP shows a Level Up toast when the streak reward levels the player", async () => {
  const originalWindow = globalThis.window;
  const modalManager = createModalCapture();
  const levelUpCalls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager,
    toastManager: {
      showAchievement: () => {},
      showLevelUp: (payload) => levelUpCalls.push(payload)
    }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletLevelUp";
  app.gauntletRandom = () => 0;
  app.profile = {
    username: "GauntletLevelUp",
    equippedCosmetics: { background: "default_background" }
  };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.buildMatchCompleteModalPayload = () => ({ title: "unused", bodyHtml: "", mode: MATCH_MODE.PVE });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => ({
            profile: {
              username: payload.username,
              gauntletBestStreak: payload.currentStreak,
              gauntletRuns: 1,
              gauntletWins: 1,
              gauntletLosses: 0,
              gauntletRivalsDefeated: 1
            },
            claimedMilestoneStreaks: [3, 5, 10, 15],
            milestoneRewards: [{ type: "xp", amount: 100 }],
            levelBefore: 14,
            levelAfter: 15,
            levelRewards: [{ kind: "tokens", amount: 75, label: "Level 15 Reward" }]
          })
        }
      }
    };
    const originalDocument = globalThis.document;
    const continueButton = createFakeDomElement();
    const returnButton = createFakeDomElement();
    globalThis.document = {
      getElementById: (id) =>
        id === "gauntlet-continue-btn"
          ? continueButton
          : id === "gauntlet-return-menu-btn"
            ? returnButton
            : null,
      querySelector: () => null
    };

    try {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();
      await app.gameController.onMatchComplete({
        match: { winner: "p1", endReason: "normal" },
        persisted: { profile: { username: "GauntletLevelUp" } }
      });

      assert.deepEqual(levelUpCalls, [{
        fromLevel: 14,
        toLevel: 15,
        rewards: [{ kind: "tokens", amount: 75, label: "Level 15 Reward" }],
        playerName: "GauntletLevelUp"
      }]);
      assert.equal(app.profile.gauntletWins, 1);
      assert.deepEqual(app.gauntletRunState.claimedMilestoneStreaks, [3, 5, 10, 15]);
      assert.equal(modalManager.shows.length, 1);
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: Gauntlet milestone XP does not show a Level Up toast when the streak reward does not level the player", async () => {
  const originalWindow = globalThis.window;
  const modalManager = createModalCapture();
  const levelUpCalls = [];
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager,
    toastManager: {
      showAchievement: () => {},
      showLevelUp: (payload) => levelUpCalls.push(payload)
    }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletNoLevelUp";
  app.gauntletRandom = () => 0;
  app.profile = {
    username: "GauntletNoLevelUp",
    equippedCosmetics: { background: "default_background" }
  };
  app.applyPostMatchCosmeticRandomization = async () => {};
  app.maybeEmitPveAiTaunt = () => {};
  app.sound.playMatchComplete = () => {};
  app.emitRewardToastsForResult = () => {};
  app.buildMatchCompleteModalPayload = () => ({ title: "unused", bodyHtml: "", mode: MATCH_MODE.PVE });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          recordGauntletStats: async (payload) => ({
            profile: {
              username: payload.username,
              gauntletBestStreak: payload.currentStreak,
              gauntletRuns: 1,
              gauntletWins: 1,
              gauntletLosses: 0,
              gauntletRivalsDefeated: 1
            },
            claimedMilestoneStreaks: [3],
            milestoneRewards: [{ type: "tokens", amount: 25 }],
            levelBefore: 8,
            levelAfter: 8,
            levelRewards: []
          })
        }
      }
    };
    const originalDocument = globalThis.document;
    const continueButton = createFakeDomElement();
    const returnButton = createFakeDomElement();
    globalThis.document = {
      getElementById: (id) =>
        id === "gauntlet-continue-btn"
          ? continueButton
          : id === "gauntlet-return-menu-btn"
            ? returnButton
            : null,
      querySelector: () => null
    };

    try {
      app.startGame(MATCH_MODE.PVE, { gauntletMode: true });
      await Promise.resolve();
      await app.gameController.onMatchComplete({
        match: { winner: "p1", endReason: "normal" },
        persisted: { profile: { username: "GauntletNoLevelUp" } }
      });

      assert.equal(levelUpCalls.length, 0);
      assert.equal(app.profile.gauntletWins, 1);
      assert.deepEqual(app.gauntletRunState.claimedMilestoneStreaks, [3]);
      assert.equal(modalManager.shows.length, 1);
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE round win does not trigger gauntlet continuation before full match completion", async () => {
  let matchCompleteCalls = 0;
  let roundResolvedCalls = 0;
  const controller = new GameController({
    username: "GauntletRoundOnly",
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    onUpdate: () => {},
    onRoundResolved: () => {
      roundResolvedCalls += 1;
    },
    onMatchComplete: () => {
      matchCompleteCalls += 1;
    }
  });

  try {
    controller.startNewMatch();
    const result = await controller.playCard(0);

    assert.ok(result?.status === "resolved" || result?.status === "war_continues");
    assert.equal(controller.match?.status, "active");
    assert.equal(roundResolvedCalls >= 0, true);
    assert.equal(matchCompleteCalls, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("appController: starting non-gauntlet PvE clears temporary gauntlet run state", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletReset";
  app.profile = { username: "GauntletReset" };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    sessionId: null,
    previousSessionId: null,
    currentStreak: 4,
    currentRivalIndex: 3,
    currentRivalId: "storm_chaser",
    rivalBag: ["inferno_drummer"],
    lastRivalId: "stonewall",
    claimedMilestoneStreaks: [3],
    defeatedRivalIds: ["pyro_maniac"],
    lastResult: "win"
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.PVE, { aiDifficulty: "hard" });

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.pveGauntletMode, false);
    assert.deepEqual(app.gauntletRunState, {
      active: false,
      sessionId: null,
      previousSessionId: null,
      currentStreak: 0,
      currentRivalIndex: -1,
      currentRivalId: null,
      rivalBag: [],
      lastRivalId: null,
      claimedMilestoneStreaks: [],
      defeatedRivalIds: [],
      lastResult: null
    });
    assert.equal(app.gameController?.gauntletRivalId, null);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: starting Featured Rival clears temporary gauntlet run state", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "GauntletToRival";
  app.profile = { username: "GauntletToRival", equippedCosmetics: { background: "default_background" } };
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentStreak: 2,
    currentRivalIndex: 2,
    currentRivalId: "stonewall",
    rivalBag: ["storm_chaser"],
    lastRivalId: "tide_witch",
    claimedMilestoneStreaks: [3],
    defeatedRivalIds: ["pyro_maniac"],
    lastResult: "win"
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.PVE, { featuredRivalId: "crownfire_duelist" });

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.pveGauntletMode, false);
    assert.equal(app.pveFeaturedRivalId, "crownfire_duelist");
    assert.equal(app.gameController?.gauntletRivalId, null);
    assert.equal(app.gameController?.featuredRivalId, "crownfire_duelist");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: selected PvE difficulty override beats the Settings fallback", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "easy", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "OverrideUser";
  app.profile = { username: "OverrideUser" };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.PVE, { aiDifficulty: "hard" });

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.gameController?.aiDifficulty, "hard");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: PvE still uses the Settings difficulty when no override is provided", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "hard", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "FallbackUser";
  app.profile = { username: "FallbackUser" };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.PVE);

    assert.equal(shownScreens.at(-1).name, "game");
    assert.equal(app.gameController?.aiDifficulty, "hard");
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: Crownfire rival display uses fixed rival-only identity assets", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { aiDifficulty: "normal", gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "DisplayUser";
  app.profile = {
    username: "DisplayUser",
    equippedCosmetics: { background: "default_background" }
  };

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    app.startGame(MATCH_MODE.PVE, { featuredRivalId: "crownfire_duelist" });
    const payload = shownScreens.at(-1).context;

    assert.equal(payload.opponentDisplay.name, "Crownfire Duelist");
    assert.equal(payload.hotseat.p2Name, "Crownfire Duelist");
    assert.equal(payload.opponentDisplay.title, "Inferno Regent");
    assert.match(payload.opponentDisplay.avatar, /rival_crownfire_duelist_avatar\.png/);
    assert.match(payload.opponentDisplay.titleIcon, /title_crownfire_inferno_regent\.png/);
    assert.match(payload.opponentDisplay.featuredBadge, /badge_crownfire_sigil\.png/);
    assert.match(payload.cardBacks.p2, /cardback_crownfire_regent\.png/);
    assert.match(payload.opponentCardVariants.fire, /variant_fire_crownfire\.png/);
    assert.match(payload.opponentCardVariants.water, /variant_water_crownfire\.png/);
    assert.match(payload.opponentCardVariants.earth, /variant_earth_crownfire\.png/);
    assert.match(payload.opponentCardVariants.wind, /variant_wind_crownfire\.png/);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local WAR continuation requires additional player choices", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWar",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "water", "earth"], wonRounds: 0 },
        p2: { hand: ["fire", "earth", "wind"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 6 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    let confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "war_continues");
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 2);

    await controller.submitHotseatSelection(0); // water
    await controller.submitHotseatSelection(0); // earth -> no effect in WAR
    confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "war_continues");
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 4);

    await controller.submitHotseatSelection(0); // earth
    await controller.submitHotseatSelection(0); // wind -> p1 wins
    confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.lastRound.capturedCards, 6);
    assert.equal(controller.captured.p1, 3);
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.match.currentPile.length, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP resolved WAR clears active WAR state in the view model", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarVmClear",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "water"], wonRounds: 0 },
        p2: { hand: ["fire", "fire"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 4 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const first = await controller.confirmHotseatRound();
    assert.equal(first.status, "war_continues");

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const resolved = await controller.confirmHotseatRound();

    assert.equal(resolved.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");

    const vm = controller.getViewModel();
    assert.equal(vm.warActive, false);
    assert.equal(vm.roundOutcome.key, "player_win");
    assert.equal(vm.pileCount, 0);
    assert.deepEqual(vm.warPileCards, []);
    assert.deepEqual(vm.warPileSizes, []);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP later rounds cannot reassign an already-resolved WAR pile", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarNoReassign",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "water", "fire"], wonRounds: 0 },
        p2: { hand: ["fire", "fire", "water"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 6 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    let result = await controller.confirmHotseatRound();
    assert.equal(result.status, "war_continues");

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    result = await controller.confirmHotseatRound();
    assert.equal(result.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.captured.p1, 2);

    const capturedAfterWar = controller.captured.p1;

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    result = await controller.confirmHotseatRound();

    assert.equal(result.status, "round_resolved");
    assert.equal(controller.captured.p1, capturedAfterWar);
    assert.equal(controller.captured.p2, 1);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP WAR auto-resolves when p1 cannot continue", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarExhaustP1",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire"], wonRounds: 0 },
        p2: { hand: ["fire", "earth"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 3 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p2");
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.match.currentPile.length, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP WAR auto-resolves when p2 cannot continue", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarExhaustP2",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire", "earth"], wonRounds: 0 },
        p2: { hand: ["fire"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 3 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.match.currentPile.length, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local WAR exhaustion helper uses engine card requirement threshold", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarThreshold",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: {
          hand: Array.from({ length: Math.max(0, WAR_REQUIRED_CARDS - 1) }, () => "fire"),
          wonRounds: 0
        },
        p2: {
          hand: Array.from({ length: WAR_REQUIRED_CARDS }, () => "earth"),
          wonRounds: 0
        }
      },
      war: { active: true, clashes: 1, pendingClashes: 1, pendingPileSizes: [2] },
      currentPile: ["fire", "fire"],
      history: [],
      meta: { totalCards: Math.max(0, WAR_REQUIRED_CARDS - 1) + WAR_REQUIRED_CARDS + 2 }
    };

    const result = await controller.maybeAutoResolveLocalWarExhaustion();

    assert.equal(result?.status, "round_resolved");
    assert.equal(controller.match.war.active, false);
    assert.equal(controller.lastRound.result, "p2");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: local PvP WAR draw auto-resolves when both players run out", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "LocalWarExhaustBoth",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      players: {
        p1: { hand: ["fire"], wonRounds: 0 },
        p2: { hand: ["fire"], wonRounds: 0 }
      },
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      currentPile: [],
      history: [],
      meta: { totalCards: 2 }
    };

    await controller.submitHotseatSelection(0);
    await controller.submitHotseatSelection(0);
    const confirm = await controller.confirmHotseatRound();

    assert.equal(confirm.status, "round_resolved");
    assert.equal(controller.lastRound.result, "draw");
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "draw");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("appController: reward toasts are labeled with receiving player", () => {
  const achievementCalls = [];
  const tokenCalls = [];
  const chestCalls = [];
  const xpCalls = [];
  const levelCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showAchievement: (achievement, options) => achievementCalls.push({ achievement, options }),
      showTokenReward: (payload) => tokenCalls.push(payload),
      showChestGrant: (payload) => chestCalls.push(payload),
      showXpBreakdown: (payload) => xpCalls.push(payload),
      showLevelUp: (payload) => levelCalls.push(payload)
    }
  });

  app.emitRewardToastsForResult(
    {
      profile: { username: "Alice", chests: { basic: 3 } },
      unlockedAchievements: [
        { id: "first_flame", name: "First Flame", description: "Win first match." }
      ],
      dailyRewards: [{ id: "daily_win_1_match", rewardTokens: 1 }],
      weeklyRewards: [],
      levelRewardTokenDelta: 50,
      xpBreakdown: { lines: [{ label: "Match Completed", amount: 1 }] },
      xpDelta: 1,
      levelBefore: 1,
      levelAfter: 2,
      levelRewards: [{ id: "lvl2_tokens", name: "+50 Tokens" }]
    },
    "Player 1",
    { username: "Alice", chests: { basic: 1 } }
  );

  assert.equal(achievementCalls.length, 1);
  assert.equal(achievementCalls[0].options.playerName, "Alice");
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].label, "Alice reward payout");
  assert.equal(tokenCalls[0].amount, 51);
  assert.equal(chestCalls.length, 1);
  assert.equal(chestCalls[0].amount, 2);
  assert.equal(chestCalls[0].chestLabel, "Basic Chest");
  assert.equal(chestCalls[0].chestType, "basic");
  assert.equal(xpCalls.length, 1);
  assert.equal(xpCalls[0].label, "Alice XP");
  assert.equal(levelCalls.length, 1);
  assert.equal(levelCalls[0].playerName, "Alice");
});

test("appController: reward toasts preserve chest type for milestone, epic, and legendary grant popups", () => {
  const chestCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showAchievement: () => {},
      showTokenReward: () => {},
      showChestGrant: (payload) => chestCalls.push(payload),
      showXpBreakdown: () => {},
      showLevelUp: () => {}
    }
  });

  const previousProfile = {
    username: "Alice",
    chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
  };
  const nextProfile = {
    username: "Alice",
    chests: { basic: 0, milestone: 1, epic: 1, legendary: 1 }
  };

  app.emitRewardToastsForResult(
    {
      profile: nextProfile,
      unlockedAchievements: [],
      dailyRewards: [],
      weeklyRewards: [],
      levelRewardTokenDelta: 0,
      xpBreakdown: { lines: [] },
      xpDelta: 0,
      levelBefore: 1,
      levelAfter: 1,
      levelRewards: []
    },
    "Player 1",
    previousProfile
  );

  assert.deepEqual(
    chestCalls.map((payload) => [payload.chestType, payload.chestLabel]),
    [
      ["milestone", "Milestone Chest"],
      ["epic", "Epic Chest"],
      ["legendary", "Legendary Chest"]
    ]
  );
});

test("appController: opening a basic chest from profile shows the fake open visual, then refreshes and emits reward toast", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const chestOpenCalls = [];
  const chestToastCalls = [];

  const initialProfile = {
    username: "ChestUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 1 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
  };
  const openedProfile = {
    ...initialProfile,
    playerXP: 5,
    chests: { basic: 0 }
  };
  let profileReads = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: (payload) => chestToastCalls.push(payload)
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            profileReads += 1;
            return profileReads === 1 ? initialProfile : openedProfile;
          },
          getCosmetics: async () => ({
            equipped: initialProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            chestOpenCalls.push(payload);
            return {
              profile: openedProfile,
              chestType: "basic",
              consumed: 1,
              remaining: 0,
              rewards: { xp: 5, tokens: 0, cosmetic: null }
            };
          }
        }
      }
    };

    app.username = "ChestUser";

    await app.showProfile();
    assert.equal(shownScreens.at(-1).context.profile.chests.basic, 1);
    assert.equal(shownScreens.at(-1).context.basicChestVisualState.basicOpen, false);

    await shownScreens.at(-1).context.actions.openBasicChest();

    assert.deepEqual(chestOpenCalls, [{ username: "ChestUser", chestType: "basic" }]);
    assert.equal(chestToastCalls.length, 1);
    assert.deepEqual(chestToastCalls[0], {
      chestType: "basic",
      rewards: { xp: 5, tokens: 0, cosmetic: null }
    });
    assert.equal(shownScreens.at(-2).context.basicChestVisualState.basicOpen, true);
    assert.equal(shownScreens.at(-1).name, "profile");
    assert.equal(shownScreens.at(-1).context.basicChestVisualState.basicOpen, false);
    assert.equal(shownScreens.at(-1).context.profile.chests.basic, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("appController: opening a chest at max level suppresses stale raw xp in the chest-open toast and keeps the max level bonus", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const chestToastCalls = [];

  const maxLevelProfile = {
    username: "MaxChestUser",
    title: "Master of EleMintz",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 900,
    playerXP: 28824,
    playerLevel: 100,
    supporterPass: false,
    chests: { basic: 1 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Master of EleMintz", badge: "none" }
  };
  const openedProfile = {
    ...maxLevelProfile,
    tokens: 903,
    chests: { basic: 0 }
  };
  let profileReads = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: (payload) => chestToastCalls.push(payload)
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            profileReads += 1;
            return profileReads === 1 ? maxLevelProfile : openedProfile;
          },
          getCosmetics: async () => ({
            equipped: maxLevelProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Master of EleMintz", name: "Master of EleMintz", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async () => ({
            profile: openedProfile,
            chestType: "basic",
            consumed: 1,
            remaining: 0,
            rewards: { xp: 29, tokens: 0, cosmetic: null, xpConversionTokenBonus: 2, overflowXp: 29 }
          })
        }
      }
    };

    app.username = "MaxChestUser";

    await app.showProfile();
    await shownScreens.at(-1).context.actions.openBasicChest();

    assert.equal(chestToastCalls.length, 1);
    assert.deepEqual(chestToastCalls[0], {
      chestType: "basic",
      rewards: { xp: 0, tokens: 0, cosmetic: null, xpConversionTokenBonus: 2, overflowXp: 29 }
    });
    assert.equal(shownScreens.at(-1).context.profile.playerXP, 28824);
    assert.equal(shownScreens.at(-1).context.profile.tokens, 903);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("appController: opening a milestone chest at max level suppresses stale raw xp and preserves the max level bonus", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const chestToastCalls = [];

  const maxLevelProfile = {
    username: "MaxMilestoneChestUser",
    title: "Master of EleMintz",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 900,
    playerXP: 28824,
    playerLevel: 100,
    supporterPass: false,
    chests: { basic: 0, milestone: 1, epic: 0, legendary: 0 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Master of EleMintz", badge: "none" }
  };
  const openedProfile = {
    ...maxLevelProfile,
    tokens: 912,
    chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
  };
  let profileReads = 0;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: (payload) => chestToastCalls.push(payload)
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            profileReads += 1;
            return profileReads === 1 ? maxLevelProfile : openedProfile;
          },
          getCosmetics: async () => ({
            equipped: maxLevelProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Master of EleMintz", name: "Master of EleMintz", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async () => ({
            profile: openedProfile,
            chestType: "milestone",
            consumed: 1,
            remaining: 0,
            rewards: { xp: 14, tokens: 12, cosmetic: null, xpConversionTokenBonus: 1, overflowXp: 5 }
          })
        }
      }
    };

    app.username = "MaxMilestoneChestUser";

    await app.showProfile();
    await shownScreens.at(-1).context.actions.openMilestoneChest();

    assert.equal(chestToastCalls.length, 1);
    assert.deepEqual(chestToastCalls[0], {
      chestType: "milestone",
      rewards: { xp: 0, tokens: 12, cosmetic: null, xpConversionTokenBonus: 1, overflowXp: 5 }
    });
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

for (const [chestType, xpReward, tokenReward, bonusTokens, overflowXp] of [
  ["epic", 35, 80, 2, 14],
  ["legendary", 92, 140, 6, 51]
]) {
  test(`appController: opening a ${chestType} chest at max level suppresses stale raw xp and preserves the max level bonus`, async () => {
    const originalWindow = globalThis.window;
    const originalSetTimeout = globalThis.setTimeout;
    const shownScreens = [];
    const chestToastCalls = [];
    let serverProfileSnapshot = null;

    const maxLevelProfile = {
      username: `Max${chestType}User`,
      title: "Master of EleMintz",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 900,
      playerXP: 28824,
      playerLevel: 100,
      supporterPass: false,
      chests: { basic: 0, milestone: 0, epic: chestType === "epic" ? 1 : 0, legendary: chestType === "legendary" ? 1 : 0 },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Master of EleMintz", badge: "none" },
      ownedCosmetics: {}
    };
    const openedProfile = {
      ...maxLevelProfile,
      tokens: maxLevelProfile.tokens + tokenReward + bonusTokens,
      chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
    };
    const openedSnapshot = {
      authority: "server",
      source: "multiplayer",
      profile: openedProfile,
      progression: {}
    };
    serverProfileSnapshot = {
      authority: "server",
      source: "multiplayer",
      profile: maxLevelProfile,
      progression: {}
    };

    const app = new AppController({
      screenManager: {
        register: () => {},
        show: (name, context) => shownScreens.push({ name, context })
      },
      modalManager: { show: () => {}, hide: () => {} },
      toastManager: {
        showChestOpenReward: (payload) => chestToastCalls.push(payload)
      }
    });

    try {
      globalThis.setTimeout = (callback) => {
        callback();
        return 0;
      };
      globalThis.window = {
        elemintz: {
          state: {
            getProfile: async () => {
              throw new Error("local profile path should not be used");
            },
            getCosmetics: async () => ({
              equipped: maxLevelProfile.equippedCosmetics,
              catalog: {
                avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
                cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
                background: [{ id: "default_background", name: "Default", owned: true }],
                elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
                badge: [{ id: "none", name: "No Badge", owned: true }],
                title: [{ id: "Master of EleMintz", name: "Master of EleMintz", owned: true }]
              }
            }),
            getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
            listProfiles: async () => [],
            openChest: async () => ({})
          },
          multiplayer: {
            getProfile: async () => serverProfileSnapshot,
            getCosmetics: async () => ({
              equipped: maxLevelProfile.equippedCosmetics,
              catalog: {
                avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
                cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
                background: [{ id: "default_background", name: "Default", owned: true }],
                elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
                badge: [{ id: "none", name: "No Badge", owned: true }],
                title: [{ id: "Master of EleMintz", name: "Master of EleMintz", owned: true }]
              }
            }),
            openChest: async () => {
              serverProfileSnapshot = openedSnapshot;
              return {
                chestType,
                consumed: 1,
                remaining: 0,
                rewards: {
                  xp: xpReward,
                  tokens: tokenReward,
                  cosmetic: null,
                  xpConversionTokenBonus: bonusTokens,
                  overflowXp
                },
                snapshot: openedSnapshot
              };
            }
          }
        }
      };

      app.username = maxLevelProfile.username;
      app.profile = maxLevelProfile;
      app.onlinePlayState = app.normalizeOnlinePlayState({
        connectionStatus: "connected",
        session: {
          active: true,
          username: maxLevelProfile.username,
          sessionId: `${chestType}-session`,
          accountId: `${chestType}-account`,
          profileKey: maxLevelProfile.username,
          authenticated: true
        }
      });

      await app.showProfile();
      if (chestType === "epic") {
        await shownScreens.at(-1).context.actions.openEpicChest();
      } else {
        await shownScreens.at(-1).context.actions.openLegendaryChest();
      }

      assert.equal(chestToastCalls.length, 1);
      assert.deepEqual(chestToastCalls[0], {
        chestType,
        rewards: {
          xp: 0,
          tokens: tokenReward,
          cosmetic: null,
          xpConversionTokenBonus: bonusTokens,
          overflowXp
        }
      });
      assert.equal(shownScreens.at(-1).context.profile.playerXP, 28824);
      assert.equal(
        shownScreens.at(-1).context.profile.tokens,
        maxLevelProfile.tokens + tokenReward + bonusTokens
      );
    } finally {
      globalThis.window = originalWindow;
      globalThis.setTimeout = originalSetTimeout;
    }
  });
}

for (const [chestType, tokenReward, bonusTokens, overflowXp] of [
  ["basic", 0, 2, 21],
  ["milestone", 12, 1, 5],
  ["epic", 80, 2, 14],
  ["legendary", 140, 6, 51]
]) {
  test(`appController: authenticated ${chestType} chest-open toast uses server progression cap data to suppress raw xp`, async () => {
    const originalWindow = globalThis.window;
    const originalSetTimeout = globalThis.setTimeout;
    const shownScreens = [];
    const chestToastCalls = [];
    let serverProfileSnapshot = null;

    const maxLevelProfile = {
      username: `AuthMax${chestType}User`,
      title: "Master of EleMintz",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 900,
      playerXP: 28824,
      playerLevel: 100,
      supporterPass: false,
      chests: {
        basic: chestType === "basic" ? 1 : 0,
        milestone: chestType === "milestone" ? 1 : 0,
        epic: chestType === "epic" ? 1 : 0,
        legendary: chestType === "legendary" ? 1 : 0
      },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Master of EleMintz", badge: "none" },
      ownedCosmetics: {}
    };
    const staleSnapshotProfile = {
      ...maxLevelProfile,
      playerXP: 28700,
      playerLevel: 99
    };
    const openedSnapshot = {
      authority: "server",
      source: "multiplayer",
      profile: {
        ...staleSnapshotProfile,
        tokens: maxLevelProfile.tokens + tokenReward + bonusTokens,
        chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
      },
      progression: {
        xp: {
          playerXP: 28824,
          playerLevel: 100,
          maxLevel: 100,
          currentLevelXp: 28824,
          nextLevelXp: 28824,
          progressRatio: 1,
          nextReward: null,
          levelCapReached: true
        }
      }
    };
    serverProfileSnapshot = {
      authority: "server",
      source: "multiplayer",
      profile: staleSnapshotProfile,
      progression: {
        xp: {
          playerXP: 28824,
          playerLevel: 100,
          maxLevel: 100,
          currentLevelXp: 28824,
          nextLevelXp: 28824,
          progressRatio: 1,
          nextReward: null,
          levelCapReached: true
        }
      }
    };

    const app = new AppController({
      screenManager: {
        register: () => {},
        show: (name, context) => shownScreens.push({ name, context })
      },
      modalManager: { show: () => {}, hide: () => {} },
      toastManager: {
        showChestOpenReward: (payload) => chestToastCalls.push(payload)
      }
    });

    try {
      globalThis.setTimeout = (callback) => {
        callback();
        return 0;
      };
      globalThis.window = {
        elemintz: {
          state: {
            getProfile: async () => {
              throw new Error("local profile path should not be used");
            },
            getCosmetics: async () => ({
              equipped: maxLevelProfile.equippedCosmetics,
              catalog: {
                avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
                cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
                background: [{ id: "default_background", name: "Default", owned: true }],
                elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
                badge: [{ id: "none", name: "No Badge", owned: true }],
                title: [{ id: "Master of EleMintz", name: "Master of EleMintz", owned: true }]
              }
            }),
            getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
            listProfiles: async () => [],
            openChest: async () => ({})
          },
          multiplayer: {
            getProfile: async () => serverProfileSnapshot,
            getCosmetics: async () => ({
              equipped: maxLevelProfile.equippedCosmetics,
              catalog: {
                avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
                cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
                background: [{ id: "default_background", name: "Default", owned: true }],
                elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
                badge: [{ id: "none", name: "No Badge", owned: true }],
                title: [{ id: "Master of EleMintz", name: "Master of EleMintz", owned: true }]
              }
            }),
            openChest: async () => {
              serverProfileSnapshot = openedSnapshot;
              return {
                chestType,
                consumed: 1,
                remaining: 0,
                rewards: {
                  xp: overflowXp + 17,
                  tokens: tokenReward,
                  cosmetic: null,
                  xpConversionTokenBonus: bonusTokens,
                  overflowXp
                },
                snapshot: openedSnapshot
              };
            }
          }
        }
      };

      app.username = maxLevelProfile.username;
      app.profile = staleSnapshotProfile;
      app.onlinePlayState = app.normalizeOnlinePlayState({
        connectionStatus: "connected",
        session: {
          active: true,
          username: maxLevelProfile.username,
          sessionId: `${chestType}-auth-session`,
          accountId: `${chestType}-auth-account`,
          profileKey: maxLevelProfile.username,
          authenticated: true
        }
      });

      await app.showProfile();
      if (chestType === "basic") {
        await shownScreens.at(-1).context.actions.openBasicChest();
      } else if (chestType === "milestone") {
        await shownScreens.at(-1).context.actions.openMilestoneChest();
      } else if (chestType === "epic") {
        await shownScreens.at(-1).context.actions.openEpicChest();
      } else {
        await shownScreens.at(-1).context.actions.openLegendaryChest();
      }

      assert.equal(chestToastCalls.length, 1);
      assert.deepEqual(chestToastCalls[0], {
        chestType,
        rewards: {
          xp: 0,
          tokens: tokenReward,
          cosmetic: null,
          xpConversionTokenBonus: bonusTokens,
          overflowXp
        }
      });
      assert.equal(shownScreens.at(-1).context.profile.playerXP, 28824);
      assert.equal(shownScreens.at(-1).context.profile.playerLevel, 100);
    } finally {
      globalThis.window = originalWindow;
      globalThis.setTimeout = originalSetTimeout;
    }
  });
}

for (const [chestType, xpReward, tokenReward] of [
  ["epic", 26, 80],
  ["legendary", 68, 140]
]) {
  test(`appController: opening a ${chestType} chest below max level preserves normal xp display`, async () => {
    const originalWindow = globalThis.window;
    const originalSetTimeout = globalThis.setTimeout;
    const shownScreens = [];
    const chestToastCalls = [];
    let serverProfileSnapshot = null;

    const profile = {
      username: `Below${chestType}User`,
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 200,
      playerXP: 2300,
      playerLevel: 24,
      supporterPass: false,
      chests: { basic: 0, milestone: 0, epic: chestType === "epic" ? 1 : 0, legendary: chestType === "legendary" ? 1 : 0 },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" },
      ownedCosmetics: {}
    };
    const openedProfile = {
      ...profile,
      tokens: profile.tokens + tokenReward,
      playerXP: profile.playerXP + xpReward,
      playerLevel: 25,
      chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
    };
    const openedSnapshot = {
      authority: "server",
      source: "multiplayer",
      profile: openedProfile,
      progression: {}
    };
    serverProfileSnapshot = {
      authority: "server",
      source: "multiplayer",
      profile,
      progression: {}
    };

    const app = new AppController({
      screenManager: {
        register: () => {},
        show: (name, context) => shownScreens.push({ name, context })
      },
      modalManager: { show: () => {}, hide: () => {} },
      toastManager: {
        showChestOpenReward: (payload) => chestToastCalls.push(payload)
      }
    });

    try {
      globalThis.setTimeout = (callback) => {
        callback();
        return 0;
      };
      globalThis.window = {
        elemintz: {
          state: {
            getProfile: async () => {
              throw new Error("local profile path should not be used");
            },
            getCosmetics: async () => ({
              equipped: profile.equippedCosmetics,
              catalog: {
                avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
                cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
                background: [{ id: "default_background", name: "Default", owned: true }],
                elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
                badge: [{ id: "none", name: "No Badge", owned: true }],
                title: [{ id: "Initiate", name: "Initiate", owned: true }]
              }
            }),
            getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
            listProfiles: async () => [],
            openChest: async () => ({})
          },
          multiplayer: {
            getProfile: async () => serverProfileSnapshot,
            getCosmetics: async () => ({
              equipped: profile.equippedCosmetics,
              catalog: {
                avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
                cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
                background: [{ id: "default_background", name: "Default", owned: true }],
                elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
                badge: [{ id: "none", name: "No Badge", owned: true }],
                title: [{ id: "Initiate", name: "Initiate", owned: true }]
              }
            }),
            openChest: async () => {
              serverProfileSnapshot = openedSnapshot;
              return {
                chestType,
                consumed: 1,
                remaining: 0,
                rewards: {
                  xp: xpReward,
                  tokens: tokenReward,
                  cosmetic: null,
                  xpConversionTokenBonus: 0,
                  overflowXp: 0
                },
                snapshot: openedSnapshot
              };
            }
          }
        }
      };

      app.username = profile.username;
      app.profile = profile;
      app.onlinePlayState = app.normalizeOnlinePlayState({
        connectionStatus: "connected",
        session: {
          active: true,
          username: profile.username,
          sessionId: `below-${chestType}-session`,
          accountId: `below-${chestType}-account`,
          profileKey: profile.username,
          authenticated: true
        }
      });

      await app.showProfile();
      if (chestType === "epic") {
        await shownScreens.at(-1).context.actions.openEpicChest();
      } else {
        await shownScreens.at(-1).context.actions.openLegendaryChest();
      }

      assert.equal(chestToastCalls.length, 1);
      assert.deepEqual(chestToastCalls[0], {
        chestType,
        rewards: {
          xp: xpReward,
          tokens: tokenReward,
          cosmetic: null,
          xpConversionTokenBonus: 0,
          overflowXp: 0
        }
      });
    } finally {
      globalThis.window = originalWindow;
      globalThis.setTimeout = originalSetTimeout;
    }
  });
}

test("appController: opening a basic chest is a no-op when the profile has zero chests", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const chestOpenCalls = [];

  const profile = {
    username: "NoChestUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 0 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: () => {}
    }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => profile,
          getCosmetics: async () => ({
            equipped: profile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            chestOpenCalls.push(payload);
            return {};
          }
        }
      }
    };

    app.username = "NoChestUser";

    await app.showProfile();
    const beforeCount = shownScreens.length;
    await shownScreens.at(-1).context.actions.openBasicChest();

    assert.equal(chestOpenCalls.length, 0);
    assert.equal(shownScreens.length, beforeCount);
    assert.equal(shownScreens.at(-1).context.basicChestVisualState.basicOpen, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: authenticated online profile chest opening uses multiplayer authority for epic chests", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const multiplayerOpenCalls = [];
  const localOpenCalls = [];
  const chestToastCalls = [];
  let serverProfileSnapshot = null;

  const onlineProfile = {
    username: "OnlineChestUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 200,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 0, milestone: 0, epic: 1, legendary: 0 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" },
    ownedCosmetics: {}
  };
  const serverSnapshotBeforeOpen = {
    authority: "server",
    source: "multiplayer",
    profile: {
      ...onlineProfile
    },
    progression: {}
  };
  serverProfileSnapshot = serverSnapshotBeforeOpen;
  const openedSnapshot = {
    authority: "server",
    source: "multiplayer",
    profile: {
      ...onlineProfile,
      tokens: 280,
      playerXP: 30,
      chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
    },
    progression: {}
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showChestOpenReward: (payload) => chestToastCalls.push(payload)
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            throw new Error("local profile path should not be used");
          },
          getCosmetics: async () => ({
            equipped: onlineProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            localOpenCalls.push(payload);
            return {};
          }
        },
        multiplayer: {
          getProfile: async () => serverProfileSnapshot,
          getCosmetics: async () => ({
            equipped: onlineProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          openChest: async (payload) => {
            multiplayerOpenCalls.push(payload);
            serverProfileSnapshot = openedSnapshot;
            return {
              chestType: "epic",
              consumed: 1,
              remaining: 0,
              rewards: { xp: 30, tokens: 80, cosmetic: null },
              snapshot: openedSnapshot
            };
          }
        }
      }
    };

    app.username = "OnlineChestUser";
    app.profile = onlineProfile;
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "OnlineChestUser",
        sessionId: "session-1",
        accountId: "account-1",
        profileKey: "OnlineChestUser",
        authenticated: true
      }
    });

    await app.showProfile();
    await shownScreens.at(-1).context.actions.openEpicChest();

    assert.deepEqual(multiplayerOpenCalls, [{ username: "OnlineChestUser", chestType: "epic" }]);
    assert.deepEqual(localOpenCalls, []);
    assert.equal(chestToastCalls.length, 1);
    assert.deepEqual(chestToastCalls[0], {
      chestType: "epic",
      rewards: { xp: 30, tokens: 80, cosmetic: null }
    });
    assert.equal(shownScreens.at(-1).context.profile.chests.epic, 0);
    assert.equal(shownScreens.at(-2).context.basicChestVisualState.epicOpen, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("appController: authenticated profile chest opening still uses multiplayer authority when local chest IPC is blocked", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const modalCalls = [];
  const multiplayerOpenCalls = [];
  const localOpenCalls = [];
  let localProfileReads = 0;

  const initialProfile = {
    username: "BlockedLocalChestUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 200,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 1, milestone: 0, epic: 0, legendary: 0 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" },
    ownedCosmetics: {}
  };
  const openedProfile = {
    ...initialProfile,
    tokens: 245,
    playerXP: 11,
    chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
  };
  const openedSnapshot = {
    authority: "server",
    source: "multiplayer",
    profile: openedProfile,
    progression: {}
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: {
      show: (config) => modalCalls.push(config),
      hide: () => {}
    },
    toastManager: {
      showChestOpenReward: () => {}
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => {
            localProfileReads += 1;
            return localProfileReads === 1 ? initialProfile : openedProfile;
          },
          getCosmetics: async () => ({
            equipped: initialProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            localOpenCalls.push(payload);
            throw new Error("Legacy local authority path 'state:openChest' is disabled for authenticated online profiles.");
          }
        },
        multiplayer: {
          openChest: async (payload) => {
            multiplayerOpenCalls.push(payload);
            return {
              chestType: "basic",
              consumed: 1,
              remaining: 0,
              rewards: { xp: 11, tokens: 45, cosmetic: null },
              snapshot: openedSnapshot
            };
          }
        }
      }
    };

    app.username = "BlockedLocalChestUser";
    app.profile = initialProfile;
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "disconnected",
      session: {
        active: true,
        username: "BlockedLocalChestUser",
        sessionId: "session-blocked",
        accountId: "account-blocked",
        profileKey: "BlockedLocalChestUser",
        authenticated: true
      }
    });

    await app.showProfile();
    await shownScreens.at(-1).context.actions.openBasicChest();

    assert.deepEqual(multiplayerOpenCalls, [{ username: "BlockedLocalChestUser", chestType: "basic" }]);
    assert.deepEqual(localOpenCalls, []);
    assert.equal(modalCalls.length, 0);
    assert.equal(shownScreens.at(-1).context.profile.chests.basic, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("appController: authenticated profile chest opening shows readable server error without falling back to local IPC", async () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const shownScreens = [];
  const modalCalls = [];
  const multiplayerOpenCalls = [];
  const localOpenCalls = [];

  const initialProfile = {
    username: "OnlineChestErrorUser",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 200,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    chests: { basic: 1, milestone: 0, epic: 0, legendary: 0 },
    achievements: {},
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" },
    ownedCosmetics: {}
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: {
      show: (config) => modalCalls.push(config),
      hide: () => {}
    },
    toastManager: {
      showChestOpenReward: () => {}
    }
  });

  try {
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => initialProfile,
          getCosmetics: async () => ({
            equipped: initialProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          getDailyChallenges: async () => ({ xp: {}, daily: { challenges: [], msUntilReset: 0 }, weekly: { challenges: [], msUntilReset: 0 } }),
          listProfiles: async () => [],
          openChest: async (payload) => {
            localOpenCalls.push(payload);
            return {};
          }
        },
        multiplayer: {
          openChest: async (payload) => {
            multiplayerOpenCalls.push(payload);
            throw new Error("Unable to open authoritative chest.");
          }
        }
      }
    };

    app.username = "OnlineChestErrorUser";
    app.profile = initialProfile;
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "disconnected",
      session: {
        active: true,
        username: "OnlineChestErrorUser",
        sessionId: "session-error",
        accountId: "account-error",
        profileKey: "OnlineChestErrorUser",
        authenticated: true
      }
    });

    await app.showProfile();
    await shownScreens.at(-1).context.actions.openBasicChest();

    assert.deepEqual(multiplayerOpenCalls, [{ username: "OnlineChestErrorUser", chestType: "basic" }]);
    assert.deepEqual(localOpenCalls, []);
    assert.equal(modalCalls.at(-1)?.title, "Chest Open Failed");
    assert.equal(modalCalls.at(-1)?.body, "Unable to open authoritative chest.");
  } finally {
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("appController: summary and turn flow update only after resolved hotseat round", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;

  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.username = "HotseatUser";
  app.localPlayers = { p1: "Alice", p2: "Bob" };
  const resolutionCalls = [];

  try {
    globalThis.Audio = class {
      play() {
        return Promise.resolve();
      }
    };

    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({}),
          getProfile: async () => ({}),
          getCosmetics: async () => ({})
        }
      }
    };
    app.showSharedResolutionPopup = async (result, mode) => {
      resolutionCalls.push(app.buildResolutionPopupContent(result, mode));
    };

    app.startGame(MATCH_MODE.LOCAL_PVP);
    await shownScreens.at(-1).context.actions.continue(); // P1 turn starts
    app.showPlayer1TurnPass = async () => {
      shownScreens.push({
        name: "pass",
        context: { message: "Player 1, Click When Ready", summary: null }
      });
    };

    await app.handleGameCardSelection(0); // P1 select
    let last = shownScreens.at(-1);
    assert.equal(last.name, "pass");
    assert.equal(last.context.message, "Player 2, Click When Ready");
    assert.equal(last.context.summary, null);

    await last.context.actions.continue(); // P2 turn starts
    await app.handleGameCardSelection(0); // P2 select

    assert.equal(resolutionCalls.length, 1);
    assert.match(resolutionCalls[0].message, /wins|No effect|WAR/);

    const afterResolvePass = shownScreens.at(-1);
    assert.equal(afterResolvePass.name, "pass");
    assert.equal(afterResolvePass.context.message, "Player 1, Click When Ready");
    assert.equal(afterResolvePass.context.summary, null);
  } finally {
    app.clearPassTimer();
    app.gameController?.stopTimer();
    app.gameController?.stopMatchClock();
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
  }
});

test("gameController: captured totals track only actual captured transfers", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "CaptureAudit",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      players: {
        p1: { hand: ["fire", "water", "fire"], wonRounds: 0 },
        p2: { hand: ["earth", "earth", "water"], wonRounds: 0 }
      },
      currentPile: [],
      history: [],
      meta: { totalCards: 6 }
    };

    await controller.finalizeRound({ p1CardIndex: 0, p2CardIndex: 0 }); // fire vs earth => p1 captures 2
    assert.equal(controller.captured.p1, 1);

    await controller.finalizeRound({ p1CardIndex: 0, p2CardIndex: 0 }); // water vs earth => no effect
    assert.equal(controller.captured.p1, 1);
    assert.equal(controller.captured.p2, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: time-limit and quit do not fabricate captured cards", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "CaptureEndings",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.captured = { p1: 3, p2: 1 };
    await controller.finalizeByTimeLimit();
    assert.deepEqual(controller.captured, { p1: 3, p2: 1 });

    controller.match = createMinimalMatch(MATCH_MODE.PVE);
    controller.match.status = "active";
    controller.completionNotified = false;
    controller.captured = { p1: 3, p2: 1 };
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });
    assert.deepEqual(controller.captured, { p1: 3, p2: 1 });
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});




test("appController: menu uses default background when profile has none", () => {
  const shownScreens = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "MenuBgUser";
  app.profile = { username: "MenuBgUser" };
  app.showMenu();

  const menu = shownScreens.at(-1);
  assert.equal(menu.name, "menu");
  assert.match(menu.context.backgroundImage, /EleMintzIcon\.png/);
});

test("appController: profile view falls back to default background when not equipped", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "ProfileBgUser";

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => ({ username: "ProfileBgUser", title: "Initiate", equippedCosmetics: {}, cosmetics: {}, achievements: {}, wins: 0, losses: 0, warsEntered: 0, warsWon: 0, longestWar: 0, cardsCaptured: 0, modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } } }),
          getCosmetics: async () => ({ equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: "default_element_cards", badge: "none", title: "Initiate" }, catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_element_cards", name: "Default", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] } }),
          listProfiles: async () => []
        }
      }
    };

    await app.showProfile();
    const profile = shownScreens.at(-1);
    assert.equal(profile.name, "profile");
    assert.match(profile.context.backgroundImage, /EleMintzIcon\.png/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: own profile and viewed profile retroactively unlock the same Longest Match achievements from stale snapshots", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const baseProfile = {
    username: "VampyrLee",
    title: "Initiate",
    wins: 0,
    losses: 0,
    warsEntered: 0,
    warsWon: 0,
    longestWar: 0,
    cardsCaptured: 0,
    gamesPlayed: 0,
    bestWinStreak: 0,
    tokens: 0,
    playerXP: 0,
    playerLevel: 1,
    supporterPass: false,
    achievements: {},
    longestMatch: {
      rounds: 97,
      mode: "gauntlet",
      opponentName: "Countess Veyra",
      result: "timer_win",
      capturedFor: 43,
      capturedAgainst: 40,
      achievedAt: "2026-06-01T00:00:00.000Z"
    },
    modeStats: {
      pve: { wins: 0, losses: 0 },
      local_pvp: { wins: 0, losses: 0 },
      online_pvp: { wins: 0, losses: 0 }
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      title: "Initiate",
      badge: "none",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    },
    ownedCosmetics: {}
  };
  const serverSnapshot = {
    authority: "server",
    source: "multiplayer",
    username: "VampyrLee",
    profile: baseProfile,
    progression: { xp: null }
  };
  const viewedSnapshot = {
    authority: "server",
    source: "multiplayer",
    username: "VampyrLee",
    profile: baseProfile
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getCosmetics: async () => ({
            equipped: baseProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          listProfiles: async () => []
        },
        multiplayer: {
          getProfile: async () => serverSnapshot,
          viewProfile: async () => viewedSnapshot,
          getCosmetics: async () => ({
            equipped: baseProfile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          })
        }
      }
    };

    app.username = "VampyrLee";
    app.profile = { ...baseProfile, achievements: {} };
    app.viewedProfileUsername = "VampyrLee";
    app.onlinePlayState = app.normalizeOnlinePlayState({
      connectionStatus: "connected",
      session: {
        active: true,
        username: "VampyrLee",
        sessionId: "profile-session",
        accountId: "profile-account",
        profileKey: "VampyrLee",
        authenticated: true
      }
    });

    await app.showProfile();

    const context = shownScreens.at(-1).context;
    const ownIds = context.achievementCatalog.filter((item) => item.unlocked).map((item) => item.id);
    const viewedIds = buildAchievementCatalog(context.viewedProfile)
      .filter((item) => item.unlocked)
      .map((item) => item.id);

    assert.deepEqual(ownIds.filter((id) => id.startsWith("long_match_")), [
      "long_match_25",
      "long_match_50",
      "long_match_75"
    ]);
    assert.deepEqual(viewedIds.filter((id) => id.startsWith("long_match_")), [
      "long_match_25",
      "long_match_50",
      "long_match_75"
    ]);
    assert.ok(!ownIds.includes("long_match_100"));
    assert.ok(!viewedIds.includes("long_match_100"));
    assert.equal(
      context.achievementCatalog.filter((item) => item.unlocked).length,
      buildAchievementCatalog(context.viewedProfile).filter((item) => item.unlocked).length
    );
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: equipped background is used on menu, profile, and game screens", async () => {
  const originalWindow = globalThis.window;
  const shown = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "BgEverywhere";
  app.profile = {
    username: "BgEverywhere",
    title: "Initiate",
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "wind_background",
      cardBack: "default_card_back",
      badge: "none",
      title: "Initiate",
      elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }
    },
    cosmetics: { background: "wind_background" }
  };

  app.showMenu();
  assert.equal(shown.at(-1).name, "menu");
  assert.match(shown.at(-1).context.backgroundImage, /windBattleArena\.png/);

  try {
    globalThis.window = {
      elemintz: {
        state: {
          getProfile: async () => app.profile,
          getCosmetics: async () => ({
            equipped: app.profile.equippedCosmetics,
            catalog: {
              avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
              cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
              background: [{ id: "default_background", name: "Default", owned: true }, { id: "wind_background", name: "Wind", owned: true }],
              elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
              badge: [{ id: "none", name: "No Badge", owned: true }],
              title: [{ id: "Initiate", name: "Initiate", owned: true }]
            }
          }),
          listProfiles: async () => []
        }
      }
    };

    await app.showProfile();
    assert.equal(shown.at(-1).name, "profile");
    assert.match(shown.at(-1).context.backgroundImage, /windBattleArena\.png/);
  } finally {
    globalThis.window = originalWindow;
  }

  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: "pve",
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();
  assert.equal(shown.at(-1).name, "game");
  assert.match(shown.at(-1).context.arenaBackground, /windBattleArena\.png/);
});

test("appController: authenticated Gauntlet showGame uses merged equipped background, card back, and variants from the server cosmetic snapshot", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "SnapshotGauntlet";
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentRivalId: "tide_witch"
  };
  app.profile = {
    username: "SnapshotGauntlet",
    equippedCosmetics: {},
    cosmetics: {
      snapshot: {
        equipped: {
          avatar: "avatar_neon_pyre_entity",
          background: "bg_crystal_nexus",
          cardBack: "cardback_neon_arcana",
          elementCardVariant: {
            fire: "fire_variant_neon_arcana",
            water: "water_variant_neon_arcana",
            earth: "earth_variant_neon_arcana",
            wind: "wind_variant_neon_arcana"
          }
        }
      }
    }
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.PVE,
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();

  const payload = shown.at(-1).context;
  assert.match(payload.arenaBackground, /bg_crystal_nexus\.png/);
  assert.match(payload.playerDisplay.avatar, /avatar_neon_pyre_entity\.png/);
  assert.match(payload.cardBacks.p1, /cardback_neon_arcana\.png/);
  assert.deepEqual(payload.cosmeticIds.cardBacks, {
    p1: "cardback_neon_arcana",
    p2: "default_card_back"
  });
  assert.deepEqual(payload.cosmeticIds.variants.p1, {
    fire: "fire_variant_neon_arcana",
    water: "water_variant_neon_arcana",
    earth: "earth_variant_neon_arcana",
    wind: "wind_variant_neon_arcana"
  });
  assert.match(payload.cardImages.p1.fire, /fire_variant_neon_arcana\.png/);
  assert.match(payload.cardImages.p1.water, /water_variant_neon_arcana\.png/);
  assert.match(payload.cardImages.p1.earth, /earth_variant_neon_arcana\.png/);
  assert.match(payload.cardImages.p1.wind, /wind_variant_neon_arcana\.png/);
});

test("appController: Goldbound Relics equipped cosmetics resolve across profile identity and Gauntlet match display paths", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "GoldboundUser";
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentRivalId: "cyclebound"
  };
  app.profile = {
    username: "GoldboundUser",
    equippedCosmetics: {},
    cosmetics: {
      snapshot: {
        equipped: {
          avatar: "avatar_aurelian_archon",
          background: "default_background",
          cardBack: "cardback_goldbound_relic",
          title: "title_goldbound",
          elementCardVariant: {
            fire: "fire_variant_goldbound_relics",
            water: "water_variant_goldbound_relics",
            earth: "earth_variant_goldbound_relics",
            wind: "wind_variant_goldbound_relics"
          }
        }
      }
    }
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.PVE,
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();

  const payload = shown.at(-1).context;
  assert.match(payload.playerDisplay.avatar, /avatar_aurelian_archon\.png/);
  assert.equal(payload.playerDisplay.title, "Goldbound");
  assert.match(payload.cardBacks.p1, /cardback_goldbound_relic\.png/);
  assert.match(payload.cardImages.p1.fire, /fire_variant_goldbound_relics\.png/);
  assert.match(payload.cardImages.p1.water, /water_variant_goldbound_relics\.png/);
  assert.match(payload.cardImages.p1.earth, /earth_variant_goldbound_relics\.png/);
  assert.match(payload.cardImages.p1.wind, /wind_variant_goldbound_relics\.png/);
});

test("appController: Frostveil Court equipped cosmetics resolve across profile identity and match display paths", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "FrostveilUser";
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentRivalId: "cyclebound"
  };
  app.profile = {
    username: "FrostveilUser",
    equippedCosmetics: {},
    cosmetics: {
      snapshot: {
        equipped: {
          avatar: "avatar_frostveil_heir",
          background: "default_background",
          cardBack: "cardback_glacier_sigil",
          title: "title_shiverborne",
          elementCardVariant: {
            fire: "fire_variant_aurora_flare",
            water: "water_variant_frostbloom",
            earth: "earth_variant_icebound_crag",
            wind: "wind_variant_sleet_spiral"
          }
        }
      }
    }
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.PVE,
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();

  const payload = shown.at(-1).context;
  assert.match(payload.playerDisplay.avatar, /avatar_frostveil_heir\.png/);
  assert.equal(payload.playerDisplay.title, "Shiverborne");
  assert.match(payload.cardBacks.p1, /cardback_glacier_sigil\.png/);
  assert.match(payload.cardImages.p1.fire, /fire_variant_aurora_flare\.png/);
  assert.match(payload.cardImages.p1.water, /water_variant_frostbloom\.png/);
  assert.match(payload.cardImages.p1.earth, /earth_variant_icebound_crag\.png/);
  assert.match(payload.cardImages.p1.wind, /wind_variant_sleet_spiral\.png/);
});

test("appController: Featured Rival arena override still beats the player's equipped background", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "BossOverrideUser";
  app.profile = {
    username: "BossOverrideUser",
    cosmetics: {
      snapshot: {
        equipped: {
          background: "bg_crystal_nexus"
        }
      }
    },
    equippedCosmetics: {}
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.PVE,
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };
  app.pveFeaturedRivalId = "crownfire_duelist";

  app.showGame();

  assert.match(shown.at(-1).context.arenaBackground, /bg_crownfire_arena\.png/);
});

test("appController: local Gauntlet showGame still respects directly equipped local cosmetics", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "LocalGauntlet";
  app.pveGauntletMode = true;
  app.gauntletRunState = {
    active: true,
    currentRivalId: "cyclebound"
  };
  app.profile = {
    username: "LocalGauntlet",
    equippedCosmetics: {
      background: "wind_background",
      cardBack: "cardback_arcane_galaxy",
      elementCardVariant: {
        fire: "fire_variant_phoenix",
        water: "water_variant_crystal",
        earth: "earth_variant_titan",
        wind: "wind_variant_storm_eye"
      }
    }
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.PVE,
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();

  const payload = shown.at(-1).context;
  assert.match(payload.arenaBackground, /windBattleArena\.png/);
  assert.match(payload.cardBacks.p1, /cardback_arcane_galaxy\.png/);
  assert.match(payload.cardImages.p1.fire, /fire_variant_phoenix\.png/);
});

test("appController: background change is reflected immediately across screens", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "BgSwap";
  app.profile = { username: "BgSwap", equippedCosmetics: { background: "default_background" } };

  app.showMenu();
  assert.match(shown.at(-1).context.backgroundImage, /EleMintzIcon\.png/);

  app.profile = { username: "BgSwap", equippedCosmetics: { background: "wind_background" } };
  app.showMenu();
  assert.match(shown.at(-1).context.backgroundImage, /windBattleArena\.png/);
});

test("appController: PvE quit shows warning and applies forfeit loss path", async () => {
  let lastModal = null;
  const quitCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: {
      show: (config) => {
        lastModal = config;
      },
      hide: () => {}
    },
    toastManager: { showAchievement: () => {} }
  });

  app.gameController = {
    getViewModel: () => ({ status: "active", mode: MATCH_MODE.PVE }),
    quitMatch: async (payload) => {
      quitCalls.push(payload);
    }
  };

  await app.quitCurrentMatch();
  assert.match(lastModal.body, /Quitting gives you a loss and no achievements will be awarded for this match\./);

  await lastModal.actions[0].onClick();
  assert.deepEqual(quitCalls, [{ quitter: "p1", reason: "quit_forfeit" }]);
});

test("appController: local quit requires approval and enforces 30s cooldown", async () => {
  let lastModal = null;
  const quitCalls = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: {
      show: (config) => {
        lastModal = config;
      },
      hide: () => {}
    },
    toastManager: { showAchievement: () => {} }
  });

  app.localPlayers = { p1: "Alice", p2: "Bob" };
  app.gameController = {
    getViewModel: () => ({ status: "active", mode: MATCH_MODE.LOCAL_PVP, hotseatTurn: "p1" }),
    quitMatch: async (payload) => {
      quitCalls.push(payload);
    }
  };

  await app.quitCurrentMatch();
  assert.match(lastModal.body, /Both players must agree to quit\./);
  await lastModal.actions[1].onClick();
  assert.equal(quitCalls.length, 0);

  await app.quitCurrentMatch();
  assert.equal(lastModal.title, "Quit Cooldown");

  app.localQuitLastRequestAt = Date.now() - 31000;
  await app.quitCurrentMatch();
  await lastModal.actions[0].onClick();

  assert.deepEqual(quitCalls, [{ quitter: "both", reason: "quit_forfeit" }]);
});

test("appController: pass screen Enter key triggers continue and cleans key listener", async () => {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  let continueCalls = 0;
  let prevented = false;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  try {
    globalThis.document = {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type, handler) => {
        if (listeners.get(type) === handler) {
          listeners.delete(type);
        }
      }
    };

    const pending = app.showPassScreen({
      message: "Player 1, Click When Ready",
      includeSummary: false,
      onContinue: async () => {
        continueCalls += 1;
      },
      onTimeout: async () => {}
    });

    const keyHandler = listeners.get("keydown");
    assert.equal(typeof keyHandler, "function");

    await keyHandler({ key: "x", preventDefault: () => { prevented = true; } });
    assert.equal(continueCalls, 0);

    await keyHandler({ key: "Enter", preventDefault: () => { prevented = true; } });
    await pending;
    assert.equal(prevented, true);
    assert.equal(continueCalls, 1);
    assert.equal(listeners.has("keydown"), false);
    assert.equal(app.passKeyHandler, null);
  } finally {
    app.clearPassTimer();
    globalThis.document = originalDocument;
  }
});

test("appController: pass screen countdown uses configured timer seconds for ready prompts", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 12 }, ui: { reducedMotion: true } };

  try {
    globalThis.window = { elemintz: { state: {} } };
    const pending = app.showPlayer1TurnPass(false);
    assert.equal(shownScreens.at(-1).context.secondsLeft, 12);
    app.clearPassTimer();
    await pending;
  } finally {
    app.clearPassTimer();
    globalThis.window = originalWindow;
  }
});

test("appController: resolution popup content reflects WAR continuation without stale capture text", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const content = app.buildResolutionPopupContent(
    {
      status: "war_continues",
      war: {
        pileSize: 6,
        clashes: 2
      }
    },
    MATCH_MODE.LOCAL_PVP
  );

  assert.equal(content.message, "WAR continues");
  assert.match(content.summary, /No cards were captured/);
  assert.match(content.summary, /6 card\(s\)/);
});

test("appController: local WAR summary uses opponent-card capture counts after WAR resolution", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.gameController = {
    getViewModel: () => ({
      lastRound: {
        result: "p1",
        warClashes: 2,
        capturedCards: 4,
        capturedOpponentCards: 2
      }
    }),
    roundResultText: "unused"
  };

  assert.equal(
    app.getLastRoundSummary(),
    "Last Round: Player 1 won. Captured 2 opponent card(s)."
  );
});

test("appController: PvE WAR resolution popup uses opponent-safe wording for player wins", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const content = app.buildResolutionPopupContent(
    {
      status: "round_resolved",
      round: {
        result: "p1",
        warClashes: 2,
        capturedCards: 4,
        capturedOpponentCards: 2
      }
    },
    MATCH_MODE.PVE
  );

  assert.equal(content.message, "Player wins");
  assert.equal(content.summary, "WAR resolved. You captured 2 opponent card(s).");
});

test("appController: PvE WAR resolution popup never shows zero opponent-card wording for opponent wins", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  const content = app.buildResolutionPopupContent(
    {
      status: "round_resolved",
      round: {
        result: "p2",
        warClashes: 2,
        capturedCards: 4,
        capturedOpponentCards: 0
      }
    },
    MATCH_MODE.PVE
  );

  assert.equal(content.message, "Opponent wins");
  assert.equal(content.summary, "WAR resolved. Opponent captured 2 of your card(s).");
  assert.doesNotMatch(content.summary, /captured 0 opponent card\(s\)/);
});

test("appController: local hotseat WAR resolution popup uses named winner-safe wording", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.localPlayerNames = {
    p1: "Player 1",
    p2: "Player 2"
  };

  const p1Content = app.buildResolutionPopupContent(
    {
      status: "round_resolved",
      round: {
        result: "p1",
        warClashes: 2,
        capturedCards: 4,
        capturedOpponentCards: 2
      }
    },
    MATCH_MODE.LOCAL_PVP
  );
  const p2Content = app.buildResolutionPopupContent(
    {
      status: "round_resolved",
      round: {
        result: "p2",
        warClashes: 2,
        capturedCards: 4,
        capturedOpponentCards: 0
      }
    },
    MATCH_MODE.LOCAL_PVP
  );

  assert.equal(p1Content.summary, "WAR resolved. Player 1 captured 2 opponent card(s).");
  assert.equal(p2Content.summary, "WAR resolved. Player 2 captured 2 of Player 1's card(s).");
});

test("appController: PvE shared resolution popup is suppressed when the same round result is already shown in-game", async () => {
  let captured = null;
  let onShownCalls = 0;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.showPassScreen = async (options) => {
    captured = options;
  };

  await app.showSharedResolutionPopup(
    { status: "round_resolved", round: { result: "p1", warClashes: 0, capturedOpponentCards: 1 } },
    MATCH_MODE.PVE,
    {
      onShown: async () => {
        onShownCalls += 1;
      }
    }
  );

  assert.equal(captured, null);
  assert.equal(onShownCalls, 1);
});

test("appController: local hotseat shared resolution popup still uses 3-second skippable pass screen", async () => {
  let captured = null;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.showPassScreen = async (options) => {
    captured = options;
  };

  await app.showSharedResolutionPopup(
    { status: "round_resolved", round: { result: "p1", warClashes: 0, capturedOpponentCards: 1 } },
    MATCH_MODE.LOCAL_PVP
  );

  assert.equal(captured.secondsLeft, 3);
  assert.equal(captured.showContinueButton, true);
  assert.equal(captured.allowEnter, true);
  assert.equal(typeof captured.onContinue, "function");
});

test("appController: local hotseat waits for shared resolution popup before re-entering the next selectable turn", async () => {
  let releaseResolution;
  let enterCalls = 0;
  let passCalls = 0;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.enterHotseatTurn = () => {
    enterCalls += 1;
  };
  app.showPlayer1TurnPass = async () => {
    passCalls += 1;
    app.screenFlow = "pass";
  };
  app.showSharedResolutionPopup = () =>
    new Promise((resolve) => {
      releaseResolution = resolve;
    });
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    getViewModel: () => ({ status: "active", warActive: false }),
    confirmHotseatRound: async () => ({
      status: "round_resolved",
      round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
      revealedCards: { p1Card: "fire", p2Card: "earth" }
    })
  };
  app.sound = { playReveal: () => {}, play: () => {} };

  const pending = app.presentHotseatResolution();
  await Promise.resolve();
  assert.equal(enterCalls, 0);

  releaseResolution();
  await pending;
  assert.equal(enterCalls, 0);
  assert.equal(passCalls, 1);
});

test("appController: local hotseat resolved round returns to the player 1 privacy pass before the next turn", async () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showSharedResolutionPopup = async () => {};
  app.sound = { playReveal: () => {}, play: () => {} };
  app.showPlayer1TurnPass = async () => {
    app.screenFlow = "pass";
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resetTimer: () => {},
    resumeLocalTurnTimer: () => {},
    rearmActiveRoundPresentation: () => {},
    getViewModel: () => ({
      status: "active",
      warActive: false,
      mode: MATCH_MODE.LOCAL_PVP,
      canSelectCard: true,
      hotseatTurn: "p1",
      hotseatPending: false,
      round: 1,
      roundResult: "Choose a card to begin the next clash.",
      lastRound: null
    }),
    confirmHotseatRound: async () => ({
      status: "round_resolved",
      round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
      revealedCards: { p1Card: "fire", p2Card: "earth" }
    })
  };

  await app.presentHotseatResolution();

  assert.equal(app.screenFlow, "pass");
  assert.deepEqual(app.roundPresentation, {
    phase: "idle",
    busy: false,
    selectedCardIndex: null
  });
});

test("appController: local hotseat WAR continuation clears the busy lock if popup flow is interrupted", async () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.showPlayer1TurnPass = async () => {};
  app.showSharedResolutionPopup = async () => {
    throw new Error("popup interrupted");
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    getViewModel: () => ({ status: "active", warActive: true }),
    confirmHotseatRound: async () => ({
      status: "war_continues",
      war: { clashes: 1, pileSize: 2, pileSizes: [2] },
      revealedCards: { p1Card: "fire", p2Card: "fire" }
    })
  };
  app.sound = { playReveal: () => {}, play: () => {} };

  await assert.rejects(() => app.presentHotseatResolution(), /popup interrupted/);
  assert.deepEqual(app.roundPresentation, {
    phase: "idle",
    busy: false,
    selectedCardIndex: null
  });
});

test("appController: PvE match-complete modal waits for shared resolution popup to finish", async () => {
  let releaseResolution;
  let flushCalls = 0;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.flushPendingMatchCompleteModal = () => {
    flushCalls += 1;
  };
  app.waitForRevealSoundSpacing = async () => {};
  app.showSharedResolutionPopup = () =>
    new Promise((resolve) => {
      releaseResolution = resolve;
    });
  app.gameController = {
    stopTimer: () => {},
    playCard: async () => ({
      status: "resolved",
      round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
      revealedCards: { p1Card: "fire", p2Card: "earth" }
    }),
    getViewModel: () => ({ status: "completed", warActive: false })
  };
  app.sound = { playReveal: () => {}, play: () => {} };

  const pending = app.presentPveRound(0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(flushCalls, 0);
  assert.equal(typeof releaseResolution, "function");

  releaseResolution();
  await pending;
  assert.equal(flushCalls, 1);
});

test("appController: Featured Rival Play Again preserves crownfire_duelist launch config", () => {
  const originalDocument = global.document;
  const listeners = new Map();
  const starts = [];

  global.document = {
    getElementById: (id) =>
      id === "match-complete-play-again"
        ? {
            addEventListener: (event, handler) => {
              listeners.set(`${id}:${event}`, handler);
            }
          }
        : id === "match-complete-return-menu"
          ? {
              addEventListener: () => {}
            }
          : null
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };
  app.pveFeaturedRivalId = "crownfire_duelist";

  try {
    app.showMatchCompleteModal({
      title: "Match Complete",
      bodyHtml:
        '<button id="match-complete-play-again" class="btn btn-primary">Play Again</button><button id="match-complete-return-menu" class="btn">Return to Menu</button>',
      mode: MATCH_MODE.PVE,
      startOptions: { featuredRivalId: "crownfire_duelist" }
    });

    listeners.get("match-complete-play-again:click")?.();

    assert.deepEqual(starts, [
      {
        mode: MATCH_MODE.PVE,
        options: { featuredRivalId: "crownfire_duelist" }
      }
    ]);
  } finally {
    global.document = originalDocument;
  }
});

test("appController: normal PvE Play Again stays on generic Elemental AI flow", () => {
  const originalDocument = global.document;
  const listeners = new Map();
  const starts = [];

  global.document = {
    getElementById: (id) =>
      id === "match-complete-play-again"
        ? {
            addEventListener: (event, handler) => {
              listeners.set(`${id}:${event}`, handler);
            }
          }
        : id === "match-complete-return-menu"
          ? {
              addEventListener: () => {}
            }
          : null
  };

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.startGame = (mode, options = {}) => {
    starts.push({ mode, options });
  };

  try {
    app.showMatchCompleteModal({
      title: "Match Complete",
      bodyHtml:
        '<button id="match-complete-play-again" class="btn btn-primary">Play Again</button><button id="match-complete-return-menu" class="btn">Return to Menu</button>',
      mode: MATCH_MODE.PVE,
      startOptions: {}
    });

    listeners.get("match-complete-play-again:click")?.();

    assert.deepEqual(starts, [
      {
        mode: MATCH_MODE.PVE,
        options: {}
      }
    ]);
  } finally {
    global.document = originalDocument;
  }
});

test("appController: PvE WAR continuation clears the busy lock if popup flow is interrupted", async () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.waitForRevealSoundSpacing = async () => {};
  app.showSharedResolutionPopup = async () => {
    throw new Error("popup interrupted");
  };
  app.gameController = {
    stopTimer: () => {},
    playCard: async () => ({
      status: "war_continues",
      war: { clashes: 1, pileSize: 2, pileSizes: [2] },
      revealedCards: { p1Card: "fire", p2Card: "fire" }
    }),
    getViewModel: () => ({ status: "active", warActive: true })
  };
  app.sound = { playReveal: () => {}, play: () => {}, playRoundResolved: () => {} };

  await assert.rejects(() => app.presentPveRound(0), /popup interrupted/);
  assert.deepEqual(app.roundPresentation, {
    phase: "idle",
    busy: false,
    selectedCardIndex: null
  });
});

test("appController: PvE round plays player reveal sound before popup and outcome sound on popup mount", async () => {
  const order = [];

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {
    order.push("showGame");
  };
  app.waitForRevealSoundSpacing = async () => {
    order.push("wait");
  };
  app.showSharedResolutionPopup = async (_result, _mode, options) => {
    order.push("popup");
    await options.onShown?.();
  };
  app.gameController = {
    stopTimer: () => {},
    playCard: async () => {
      app.deferredPveRoundSound = {
        result: "p1",
        p1Card: "fire",
        p2Card: "earth",
        warClashes: 0,
        capturedOpponentCards: 1
      };
      return {
        status: "resolved",
        round: { result: "p1", p1Card: "fire", p2Card: "earth", warClashes: 0, capturedOpponentCards: 1 },
        revealedCards: { p1Card: "fire", p2Card: "earth" }
      };
    },
    getViewModel: () => ({ status: "active", warActive: false })
  };
  app.sound = {
    playReveal: (payload) => {
      order.push(`reveal:${payload.cards.join(",")}`);
      return true;
    },
    play: () => {},
    playRoundResolved: () => {
      order.push("outcome");
    }
  };

  await app.presentPveRound(0);

  assert.deepEqual(order, [
    "showGame",
    "showGame",
    "reveal:fire",
    "wait",
    "popup",
    "outcome",
    "showGame"
  ]);
});

test("gameController: PvE WAR requires additional player choices while AI auto-selects", async () => {
  const originalWindow = globalThis.window;
  let submitCount = 0;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 1, earth: 1, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 1, wind: 1 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const warRoomTwo = createAuthoritativeLocalRoom({
    roundNumber: 3,
    hostHand: { fire: 0, water: 1, earth: 1, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 1 },
    warActive: true,
    warRounds: [
      { round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" },
      { round: 2, hostMove: "water", guestMove: "water", outcomeType: "war" }
    ],
    warPot: { host: ["fire", "water"], guest: ["fire", "water"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 4,
    hostHand: { fire: 4, water: 0, earth: 1, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 1 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "water",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 3,
        hostMove: "earth",
        guestMove: "wind",
        outcomeType: "war_resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });

  const controller = new GameController({
    username: "PveWarUser",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    aiDifficulty: "normal",
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => {
          submitCount += 1;
          if (submitCount === 1) {
            return {
              ok: true,
              room: warRoom,
              roundResult: {
                round: 1,
                hostMove: "fire",
                guestMove: "fire",
                outcomeType: "war",
                hostResult: "war",
                guestResult: "war",
                warRounds: [{ round: 1, outcomeType: "war" }],
                warPot: { host: ["fire"], guest: ["fire"] }
              }
            };
          }

          if (submitCount === 2) {
            return {
              ok: true,
              room: warRoomTwo,
              roundResult: {
                round: 2,
                hostMove: "water",
                guestMove: "water",
                outcomeType: "war",
                hostResult: "war",
                guestResult: "war",
                warRounds: [{ round: 1, outcomeType: "war" }, { round: 2, outcomeType: "war" }],
                warPot: { host: ["fire", "water"], guest: ["fire", "water"] }
              }
            };
          }

          return {
            ok: true,
            room: resolvedRoom,
            roundResult: {
              round: 3,
              hostMove: "earth",
              guestMove: "wind",
              outcomeType: "war_resolved",
              hostResult: "win",
              guestResult: "lose",
              warRounds: [
                { round: 1, outcomeType: "war" },
                { round: 2, outcomeType: "war" },
                { round: 3, outcomeType: "war_resolved" }
              ],
              warPot: { host: [], guest: [] }
            }
          };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = {
      elemintz: {
        state: {
          recordMatchResult: async () => ({})
        }
      }
    };

    controller.startNewMatch();

    const first = await controller.playCard(0);
    assert.equal(first.status, "war_continues");
    assert.equal(controller.match.war.active, true);
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 2);

    const second = await controller.playCard(0);
    assert.equal(second.status, "war_continues");
    assert.equal(controller.match.war.active, true);
    assert.equal(controller.lastRound, null);
    assert.equal(controller.match.currentPile.length, 4);

    const third = await controller.playCard(0);
    assert.equal(third.status, "resolved");
    assert.equal(controller.lastRound.result, "p1");
    assert.equal(controller.lastRound.p2Card, "wind");
    assert.equal(controller.lastRound.capturedCards, 6);
    assert.equal(controller.match.war.active, false);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: rearming an active local WAR clears stale cards while preserving authoritative WAR continuation text", () => {
  const controller = new GameController({
    username: "WarResetUser",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    controller.match = {
      ...createMinimalMatch(MATCH_MODE.LOCAL_PVP),
      status: "active",
      war: { active: true, clashes: 1, pendingClashes: 1, pendingPileSizes: [2] }
    };
    controller.lastRound = {
      round: 1,
      p1Card: "fire",
      p2Card: "fire",
      result: "none",
      warClashes: 1,
      capturedOpponentCards: 0
    };
    controller.roundResultText = "WAR triggered";

    controller.rearmActiveRoundPresentation();

    assert.deepEqual(controller.lastRound, {
      round: 1,
      p1Card: "fire",
      p2Card: "fire",
      result: "none",
      warClashes: 1,
      capturedOpponentCards: 0
    });
    assert.equal(controller.roundResultText, "WAR continues. Choose new cards for the next clash.");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("gameController: PvE WAR resolved Opponent wins summary uses winner-safe capture counts", () => {
  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.gameController = {
    getViewModel: () => ({
      lastRound: {
        result: "p2",
        warClashes: 2,
        capturedCards: 4,
        capturedOpponentCards: 0
      }
    }),
    roundResultText: "unused"
  };

  assert.equal(
    app.getLastRoundSummary(),
    "Last Round: Player 2 won. Player 2 captured 2 of Player 1's card(s)."
  );
});

test("gameController: local authoritative history uses stored per-card capture values", () => {
  const controller = new GameController({
    username: "LocalCaptureTruth",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    controller.syncLocalAuthorityState(
      createAuthoritativeLocalRoom({
        roundNumber: 4,
        winner: "host",
        roundHistory: [
          {
            round: 1,
            hostMove: "fire",
            guestMove: "fire",
            outcomeType: "war",
            hostResult: "war",
            guestResult: "war",
            capturedCards: 0,
            capturedOpponentCards: 0
          },
          {
            round: 2,
            hostMove: "water",
            guestMove: "water",
            outcomeType: "no_effect",
            hostResult: "no_effect",
            guestResult: "no_effect",
            capturedCards: 0,
            capturedOpponentCards: 0
          },
          {
            round: 3,
            hostMove: "earth",
            guestMove: "wind",
            outcomeType: "war_resolved",
            hostResult: "win",
            guestResult: "lose",
            capturedCards: 6,
            capturedOpponentCards: 3
          }
        ]
      }),
      null
    );

    assert.deepEqual(controller.match.history, [
      {
        result: "none",
        warClashes: 0,
        capturedCards: 0,
        capturedOpponentCards: 0,
        p1Card: "fire",
        p2Card: "fire"
      },
      {
        result: "none",
        warClashes: 0,
        capturedCards: 0,
        capturedOpponentCards: 0,
        p1Card: "water",
        p2Card: "water"
      },
      {
        result: "p1",
        warClashes: 3,
        capturedCards: 6,
        capturedOpponentCards: 3,
        p1Card: "earth",
        p2Card: "wind"
      }
    ]);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("foundation: online warClashes ignores pre-WAR no_effect rows before a WAR chain", () => {
  const history = buildOnlineMatchStateFromRoom({
    roundHistory: [
      {
        round: 1,
        hostMove: "wind",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 2,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        capturedCards: 0,
        capturedOpponentCards: 0
      },
      {
        round: 3,
        hostMove: "water",
        guestMove: "fire",
        outcomeType: "war_resolved",
        hostResult: "win",
        guestResult: "lose",
        capturedCards: 4,
        capturedOpponentCards: 2
      }
    ]
  }).history;

  assert.equal(history.at(-1)?.warClashes, 2);
});

test("gameController: PvE time-limit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "host",
    winReason: "time_limit",
    roundNumber: 3,
    hostHand: { fire: 3, water: 1, earth: 1, wind: 1 },
    guestHand: { fire: 0, water: 1, earth: 0, wind: 0 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });

  const controller = new GameController({
    username: "PveTimeLimitAuthority",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        completeMatchByCardCount: (_socketId, options) => {
          completionCalls.push(options);
          return { ok: true, room: completedRoom };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.finalizeByTimeLimit();

    assert.deepEqual(completionCalls, [{ reason: "time_limit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p1");
    assert.equal(controller.match.endReason, "time_limit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE time-limit completion deferred during resolution flushes once the round finishes", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const matchCompleteCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "host",
    winReason: "time_limit",
    roundNumber: 4,
    hostHand: { fire: 3, water: 1, earth: 1, wind: 1 },
    guestHand: { fire: 1, water: 0, earth: 0, wind: 0 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      },
      {
        round: 2,
        hostMove: "water",
        guestMove: "wind",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });

  const controller = new GameController({
    username: "DeferredTimeLimitAuthority",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        completeMatchByCardCount: (_socketId, options) => {
          completionCalls.push(options);
          return { ok: true, room: completedRoom };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: ({ match }) => {
      matchCompleteCalls.push({
        winner: match?.winner ?? null,
        endReason: match?.endReason ?? null
      });
    }
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    controller.isResolvingRound = true;

    await controller.finalizeByTimeLimit();

    assert.equal(controller.pendingTimeLimitFinalization, true);
    assert.deepEqual(completionCalls, []);
    assert.deepEqual(matchCompleteCalls, []);
    assert.equal(controller.match.status, "active");

    controller.isResolvingRound = false;
    assert.equal(await controller.flushPendingTimeLimitFinalization(), true);

    assert.equal(controller.pendingTimeLimitFinalization, false);
    assert.deepEqual(completionCalls, [{ reason: "time_limit" }]);
    assert.deepEqual(matchCompleteCalls, [{ winner: "p1", endReason: "time_limit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p1");
    assert.equal(controller.match.endReason, "time_limit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE quit completion comes from the authoritative room bridge", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const completedRoom = createAuthoritativeLocalRoom({
    matchComplete: true,
    winner: "guest",
    winReason: "quit_forfeit",
    roundNumber: 2,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
  });

  const controller = new GameController({
    username: "PveQuitAuthority",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        completeMatch: (_socketId, options) => {
          completionCalls.push(options);
          return { ok: true, room: completedRoom };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    await controller.quitMatch({ quitter: "p1", reason: "quit_forfeit" });

    assert.deepEqual(completionCalls, [{ winner: "guest", reason: "quit_forfeit" }]);
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(controller.match.endReason, "quit_forfeit");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE authoritative restart resets to a fresh room-backed state", async () => {
  const originalWindow = globalThis.window;
  const createdRooms = [];
  const roomA = createAuthoritativeLocalRoom({
    roomCode: "PVE111",
    roundNumber: 4,
    hostHand: { fire: 5, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 1, earth: 1, wind: 1 },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostResult: "win",
        guestResult: "lose"
      }
    ]
  });
  const roomB = createAuthoritativeLocalRoom({
    roomCode: "PVE222",
    roundNumber: 1,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    roundHistory: []
  });

  const controller = new GameController({
    username: "PveRestartAuthority",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        createRoom: () => {
          const room = createdRooms.length === 0 ? roomA : roomB;
          createdRooms.push(room.roomCode);
          return { ok: true, room };
        },
        joinRoom: () => {
          const room = createdRooms.length === 1 ? roomA : roomB;
          return {
            ok: true,
            room: {
              ...room,
              guest: {
                username: "EleMintz AI",
                bot: true,
                aiDifficulty: "normal"
              }
            }
          };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();
    assert.equal(controller.match.id, "PVE111:match:1");
    assert.equal(controller.match.round, 3);
    assert.ok(controller.match.history.length > 0);

    controller.startNewMatch();
    assert.deepEqual(createdRooms, ["PVE111", "PVE222"]);
    assert.equal(controller.match.id, "PVE222:match:1");
    assert.equal(controller.match.round, 0);
    assert.deepEqual(controller.match.history, []);
    assert.equal(controller.match.players.p1.hand.length, 8);
    assert.equal(controller.match.players.p2.hand.length, 8);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("rooms: gauntlet rival bot branch activates only when gauntletRivalId exists", () => {
  const originalMathRandom = Math.random;
  const gauntletStore = createRoomStore({ random: () => 0.75 });
  const gauntletHost = { id: "gauntlet-host" };
  const gauntletGuest = { id: "gauntlet-guest" };
  const gauntletRoom = gauntletStore.createRoom(gauntletHost, { username: "Host" }).room;
  const gauntletJoin = gauntletStore.joinRoom(gauntletGuest, gauntletRoom.roomCode, {
    username: "Loop Rival",
    bot: true,
    aiDifficulty: "easy",
    gauntletRivalId: "fourfold_monk"
  });

  try {
    Math.random = () => 0.75;

    assert.equal(gauntletJoin.ok, true);
    assert.equal(gauntletJoin.room.gauntletRivalId, "fourfold_monk");
    const gauntletSubmit = gauntletStore.submitMove(gauntletHost.id, "fire");
    assert.equal(gauntletSubmit.ok, true);
    assert.equal(gauntletSubmit.roundResult?.guestMove, "fire");

    const normalStore = createRoomStore({ random: () => 0.75 });
    const normalHost = { id: "normal-host" };
    const normalGuest = { id: "normal-guest" };
    const normalRoom = normalStore.createRoom(normalHost, { username: "Host" }).room;
    const normalJoin = normalStore.joinRoom(normalGuest, normalRoom.roomCode, {
      username: "Easy Bot",
      bot: true,
      aiDifficulty: "easy"
    });

    assert.equal(normalJoin.ok, true);
    assert.equal(normalJoin.room.gauntletRivalId, null);
    const normalSubmit = normalStore.submitMove(normalHost.id, "fire");
    assert.equal(normalSubmit.ok, true);
    assert.equal(normalSubmit.roundResult?.guestMove, "wind");
  } finally {
    Math.random = originalMathRandom;
  }
});

test("gameController: PvE captured totals ignore unresolved WAR pile stake", async () => {
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "CapturePileUser",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      players: {
        p1: { hand: ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind", "fire"], wonRounds: 0 },
        p2: { hand: ["fire", "water", "earth", "wind", "fire", "water", "earth"], wonRounds: 0 }
      },
      currentPile: ["fire", "fire", "water", "earth"],
      meta: { totalCards: 16 },
      history: []
    };

    controller.recalculateCapturedTotals();
    assert.equal(controller.captured.p1, 0);
    assert.equal(controller.captured.p2, 0);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE WAR resolves immediately on non-tie continuation reveal", async () => {
  const originalWindow = globalThis.window;
  let submitCount = 0;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 1, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 1, earth: 0, wind: 0 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 3,
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 2, water: 0, earth: 0, wind: 0 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      {
        round: 2,
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win"
      }
    ]
  });

  const controller = new GameController({
    username: "PveWarResolve",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => {
          submitCount += 1;
          return submitCount === 1
            ? {
                ok: true,
                room: warRoom,
                roundResult: {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war",
                  hostResult: "war",
                  guestResult: "war",
                  warRounds: [{ round: 1, outcomeType: "war" }],
                  warPot: { host: ["fire"], guest: ["fire"] }
                }
              }
            : {
                ok: true,
                room: resolvedRoom,
                roundResult: {
                  round: 2,
                  hostMove: "fire",
                  guestMove: "water",
                  outcomeType: "war_resolved",
                  hostResult: "lose",
                  guestResult: "win",
                  warRounds: [
                    { round: 1, outcomeType: "war" },
                    { round: 2, outcomeType: "war_resolved" }
                  ],
                  warPot: { host: [], guest: [] }
                }
              };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const first = await controller.playCard(0);
    assert.equal(first.status, "war_continues");
    assert.equal(controller.match.war.active, true);

    const second = await controller.playCard(0);
    assert.equal(second.status, "resolved");
    assert.equal(controller.lastRound.result, "p2");
    assert.equal(controller.match.war.active, false);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE simultaneous WAR exhaustion resolves immediately without waiting for timer", async () => {
  const originalWindow = globalThis.window;
  let submitCount = 0;
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 0, water: 1, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 1, wind: 0 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const resolvedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    matchComplete: true,
    winner: "draw",
    winReason: "hand_exhaustion",
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });

  const controller = new GameController({
    username: "PveWarExhaust",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => {
          submitCount += 1;
          return submitCount === 1
            ? {
                ok: true,
                room: warRoom,
                roundResult: {
                  round: 1,
                  hostMove: "fire",
                  guestMove: "fire",
                  outcomeType: "war",
                  hostResult: "war",
                  guestResult: "war",
                  warRounds: [{ round: 1, outcomeType: "war" }],
                  warPot: { host: ["fire"], guest: ["fire"] }
                }
              }
            : {
                ok: true,
                room: resolvedRoom,
                roundResult: {
                  round: 1,
                  hostMove: "water",
                  guestMove: "earth",
                  outcomeType: "no_effect",
                  hostResult: "no_effect",
                  guestResult: "no_effect",
                  warRounds: [{ round: 1, outcomeType: "war" }],
                  warPot: { host: [], guest: [] }
                }
              };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const first = await controller.playCard(0);
    assert.equal(first.status, "war_continues");
    assert.equal(controller.match.status, "active");

    const second = await controller.playCard(0);
    assert.equal(second.status, "resolved");
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "draw");
    assert.equal(controller.timerSeconds, 30);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE WAR exhaustion completes immediately as a loss when the player cannot continue", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const matchCompleteCalls = [];
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: WAR_REQUIRED_CARDS, wind: 0 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const completedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    matchComplete: true,
    winner: "guest",
    winReason: "hand_exhaustion",
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: WAR_REQUIRED_CARDS, wind: 0 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: warRoom.roundHistory
  });

  const controller = new GameController({
    username: "PveWarLoseNow",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => ({
          ok: true,
          room: warRoom,
          roundResult: {
            round: 1,
            hostMove: "fire",
            guestMove: "fire",
            outcomeType: "war",
            hostResult: "war",
            guestResult: "war",
            warRounds: [{ round: 1, outcomeType: "war" }],
            warPot: { host: ["fire"], guest: ["fire"] }
          }
        }),
        completeMatch: (_socketId, options) => {
          completionCalls.push(options);
          return { ok: true, room: completedRoom };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: ({ match }) => {
      matchCompleteCalls.push({
        winner: match?.winner ?? null,
        endReason: match?.endReason ?? null
      });
    }
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const result = await controller.playCard(0);

    assert.equal(result.status, "resolved");
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(controller.match.endReason, "hand_exhaustion");
    assert.deepEqual(completionCalls, [{ winner: "guest", reason: "hand_exhaustion" }]);
    assert.deepEqual(matchCompleteCalls, [{ winner: "p2", endReason: "hand_exhaustion" }]);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: PvE WAR exhaustion completes immediately as a win when the opponent cannot continue", async () => {
  const originalWindow = globalThis.window;
  const completionCalls = [];
  const matchCompleteCalls = [];
  const initialRoom = createAuthoritativeLocalRoom();
  const warRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    hostHand: { fire: 0, water: WAR_REQUIRED_CARDS, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    warActive: true,
    warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
    warPot: { host: ["fire"], guest: ["fire"] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });
  const completedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    matchComplete: true,
    winner: "host",
    winReason: "hand_exhaustion",
    hostHand: { fire: 0, water: WAR_REQUIRED_CARDS, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: warRoom.roundHistory
  });

  const controller = new GameController({
    username: "PveWarWinNow",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    persistMatchResults: false,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => ({
          ok: true,
          room: warRoom,
          roundResult: {
            round: 1,
            hostMove: "fire",
            guestMove: "fire",
            outcomeType: "war",
            hostResult: "war",
            guestResult: "war",
            warRounds: [{ round: 1, outcomeType: "war" }],
            warPot: { host: ["fire"], guest: ["fire"] }
          }
        }),
        completeMatch: (_socketId, options) => {
          completionCalls.push(options);
          return { ok: true, room: completedRoom };
        }
      }),
    onUpdate: () => {},
    onMatchComplete: ({ match }) => {
      matchCompleteCalls.push({
        winner: match?.winner ?? null,
        endReason: match?.endReason ?? null
      });
    }
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const result = await controller.playCard(0);

    assert.equal(result.status, "resolved");
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p1");
    assert.equal(controller.match.endReason, "hand_exhaustion");
    assert.deepEqual(completionCalls, [{ winner: "host", reason: "hand_exhaustion" }]);
    assert.deepEqual(matchCompleteCalls, [{ winner: "p1", endReason: "hand_exhaustion" }]);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});

test("gameController: completed authoritative terminal PvE WAR rebuild preserves countable WAR stats for draw, win, and loss", () => {
  const scenarios = [
    {
      label: "draw",
      winner: "draw",
      expectedWinner: "draw",
      warDepth: 2,
      expectedWarsWon: 0,
      hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
      guestHand: { fire: 0, water: 0, earth: 0, wind: 0 }
    },
    {
      label: "win",
      winner: "host",
      expectedWinner: "p1",
      warDepth: 1,
      expectedWarsWon: 1,
      hostHand: { fire: 0, water: WAR_REQUIRED_CARDS, earth: 0, wind: 0 },
      guestHand: { fire: 0, water: 0, earth: 0, wind: 0 }
    },
    {
      label: "loss",
      winner: "guest",
      expectedWinner: "p2",
      warDepth: 3,
      expectedWarsWon: 0,
      hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
      guestHand: { fire: 0, water: 0, earth: WAR_REQUIRED_CARDS, wind: 0 }
    }
  ];

  for (const scenario of scenarios) {
    const initialRoom = createAuthoritativeLocalRoom();
    const controller = new GameController({
      username: `PveTerminalWar-${scenario.label}`,
      timerSeconds: 30,
      mode: MATCH_MODE.PVE,
      persistMatchResults: false,
      localAuthorityStoreFactory: () => createAuthoritativePveStore({ initialRoom }),
      onUpdate: () => {},
      onMatchComplete: () => {}
    });

    try {
      controller.startNewMatch();

      const warRoundEntry = {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        warDepth: scenario.warDepth,
        warRounds: Array.from({ length: scenario.warDepth }, (_, index) => ({
          round: index + 1,
          outcomeType: index === 0 ? "war" : "no_effect"
        }))
      };
      const completedRoom = createAuthoritativeLocalRoom({
        roundNumber: 2,
        matchComplete: true,
        winner: scenario.winner,
        winReason: "hand_exhaustion",
        hostHand: scenario.hostHand,
        guestHand: scenario.guestHand,
        warActive: false,
        warRounds: [],
        warPot: { host: [], guest: [] },
        roundHistory: [warRoundEntry]
      });

      controller.syncLocalAuthorityState(completedRoom, null);

      const stats = deriveMatchStats(controller.match, "p1");
      assert.equal(controller.match?.status, "completed", `${scenario.label}: match should complete`);
      assert.equal(controller.match?.winner, scenario.expectedWinner, `${scenario.label}: winner should map correctly`);
      assert.equal(controller.match?.history?.at(-1)?.warClashes, scenario.warDepth, `${scenario.label}: history should retain terminal WAR depth`);
      assert.equal(stats?.warsEntered, 1, `${scenario.label}: warsEntered should count terminal WAR`);
      assert.equal(stats?.longestWar, scenario.warDepth, `${scenario.label}: longestWar should match terminal WAR depth`);
      assert.equal(stats?.warsWon, scenario.expectedWarsWon, `${scenario.label}: warsWon should follow final perspective result`);
    } finally {
      controller.stopTimer();
      controller.stopMatchClock();
    }
  }
});

test("foundation: completed terminal online WAR rows reconstruct countable WAR stats", () => {
  const room = {
    roomCode: "ROOMWAR",
    matchComplete: true,
    winner: "guest",
    winReason: "hand_exhaustion",
    roundNumber: 2,
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war",
        warDepth: 4,
        warRounds: Array.from({ length: 4 }, (_, index) => ({
          round: index + 1,
          outcomeType: index === 0 ? "war" : "no_effect"
        }))
      }
    ]
  };

  const match = buildOnlineMatchStateFromRoom(room);
  assert.equal(match.history.length, 1);
  assert.deepEqual(match.history[0], {
    result: "p2",
    warClashes: 4,
    capturedCards: 0,
    capturedOpponentCards: 0,
    p1Card: "fire",
    p2Card: "fire"
  });

  const stats = deriveMatchStats(match, "p1");
  assert.equal(stats.warsEntered, 1);
  assert.equal(stats.longestWar, 4);
  assert.equal(stats.warsWon, 0);
});

test("gameController: completed authoritative match counts resolved and terminal active-WAR no-effect chains", () => {
  const controller = new GameController({
    username: "TerminalWarChainUser",
    timerSeconds: 30,
    matchTimeLimitSeconds: 300,
    mode: MATCH_MODE.PVE,
    localAuthorityStoreFactory: () => createAuthoritativePveStore({
      initialRoom: createAuthoritativeLocalRoom()
    }),
    onUpdate: () => {}
  });

  try {
    controller.startNewMatch();

    const completedRoom = createAuthoritativeLocalRoom({
      roundNumber: 7,
      matchComplete: true,
      winner: "host",
      winReason: "hand_exhaustion",
      hostHand: { fire: 1, water: 0, earth: 0, wind: 0 },
      guestHand: { fire: 0, water: 0, earth: 0, wind: 0 },
      warActive: false,
      warRounds: [],
      warPot: { host: [], guest: [] },
      roundHistory: [
        {
          round: 2,
          hostMove: "fire",
          guestMove: "water",
          outcomeType: "war_resolved",
          hostResult: "lose",
          guestResult: "win",
          capturedCards: 4,
          capturedOpponentCards: 2
        },
        {
          round: 6,
          hostMove: "earth",
          guestMove: "fire",
          outcomeType: "no_effect",
          hostResult: "no_effect",
          guestResult: "no_effect",
          warDepth: 4,
          warRounds: [
            { round: 3, outcomeType: "war" },
            { round: 4, outcomeType: "no_effect" },
            { round: 5, outcomeType: "no_effect" },
            { round: 6, outcomeType: "no_effect" }
          ]
        }
      ]
    });

    controller.syncLocalAuthorityState(completedRoom, null);

    const stats = deriveMatchStats(controller.match, "p1");
    assert.equal(controller.match?.history?.length, 2);
    assert.equal(controller.match?.history?.[0]?.warClashes, 1);
    assert.equal(controller.match?.history?.[1]?.warClashes, 4);
    assert.equal(stats?.warsEntered, 2);
    assert.equal(stats?.longestWar, 4);
    assert.equal(stats?.warsWon, 1);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
  }
});

test("foundation: completed terminal online active-WAR no-effect rows reconstruct countable WAR stats", () => {
  const room = {
    roomCode: "ROOMWARNOEFFECT",
    matchComplete: true,
    winner: "host",
    winReason: "hand_exhaustion",
    roundNumber: 7,
    roundHistory: [
      {
        round: 2,
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "war_resolved",
        hostResult: "lose",
        guestResult: "win",
        capturedCards: 4,
        capturedOpponentCards: 2
      },
      {
        round: 6,
        hostMove: "earth",
        guestMove: "fire",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect",
        warDepth: 4,
        warRounds: [
          { round: 3, outcomeType: "war" },
          { round: 4, outcomeType: "no_effect" },
          { round: 5, outcomeType: "no_effect" },
          { round: 6, outcomeType: "no_effect" }
        ]
      }
    ]
  };

  const match = buildOnlineMatchStateFromRoom(room);
  assert.equal(match.history.length, 2);
  assert.equal(match.history[0].warClashes, 1);
  assert.deepEqual(match.history[1], {
    result: "p1",
    warClashes: 4,
    capturedCards: 0,
    capturedOpponentCards: 0,
    p1Card: "earth",
    p2Card: "fire"
  });

  const stats = deriveMatchStats(match, "p1");
  assert.equal(stats.warsEntered, 2);
  assert.equal(stats.longestWar, 4);
  assert.equal(stats.warsWon, 1);
});

test("gameController: PvE completed authoritative WAR result does not return war_continues", async () => {
  const originalWindow = globalThis.window;
  let onMatchCompleteCalls = 0;
  const initialRoom = createAuthoritativeLocalRoom();
  const completedRoom = createAuthoritativeLocalRoom({
    roundNumber: 2,
    matchComplete: true,
    winner: "guest",
    winReason: "hand_exhaustion",
    hostHand: { fire: 0, water: 0, earth: 0, wind: 0 },
    guestHand: { fire: 0, water: 0, earth: 0, wind: 2 },
    warActive: false,
    warRounds: [],
    warPot: { host: [], guest: [] },
    roundHistory: [
      {
        round: 1,
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      }
    ]
  });

  const controller = new GameController({
    username: "PveCompletedWar",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    localAuthorityStoreFactory: () =>
      createAuthoritativePveStore({
        initialRoom,
        submitMove: () => ({
          ok: true,
          room: completedRoom,
          roundResult: {
            round: 1,
            hostMove: "water",
            guestMove: "earth",
            outcomeType: "war",
            hostResult: "lose",
            guestResult: "win",
            warRounds: [{ round: 1, outcomeType: "war" }],
            warPot: { host: [], guest: [] }
          }
        })
      }),
    onUpdate: () => {},
    onMatchComplete: async () => {
      onMatchCompleteCalls += 1;
    }
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };
    controller.startNewMatch();

    const result = await controller.playCard(0);

    assert.equal(result.status, "resolved");
    assert.notEqual(result.status, "war_continues");
    assert.equal(controller.match.status, "completed");
    assert.equal(controller.match.winner, "p2");
    assert.equal(onMatchCompleteCalls, 1);
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    globalThis.window = originalWindow;
  }
});


import test from "node:test";
import assert from "node:assert/strict";

import { GameController, MATCH_MODE } from "../../src/renderer/systems/gameController.js";
import { AppController } from "../../src/renderer/systems/appController.js";
import { WAR_REQUIRED_CARDS } from "../../src/engine/index.js";

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

test("gameController: AI selection is independent from player's current card", async () => {
  const originalRandom = Math.random;
  const originalWindow = globalThis.window;

  const controller = new GameController({
    username: "FairnessUser",
    timerSeconds: 30,
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

    controller.match = createMinimalMatch();
    await controller.playCard(0);

    assert.equal(controller.lastRound.p1Card, "fire");
    assert.equal(controller.lastRound.p2Card, "earth");
  } finally {
    controller.stopTimer();
    controller.stopMatchClock();
    Math.random = originalRandom;
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

  const controller = new GameController({
    username: "LocalTester",
    timerSeconds: 30,
    mode: MATCH_MODE.LOCAL_PVP,
    aiDifficulty: "hard",
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = createMinimalMatch(MATCH_MODE.LOCAL_PVP);

    const p1Selection = await controller.submitHotseatSelection(1);
    assert.equal(p1Selection.status, "pass_to_p2");

    const p2Selection = await controller.submitHotseatSelection(1);
    assert.equal(p2Selection.status, "pass_to_p1");
    assert.equal(controller.lastRound, null);

    const confirmed = await controller.confirmHotseatRound();
    assert.equal(confirmed.status, "round_resolved");
    assert.equal(controller.lastRound.p1Card, "wind");
    assert.equal(controller.lastRound.p2Card, "water");
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
  app.showMenu();
  shownScreens.at(-1).context.actions.startLocalGame();

  assert.equal(shownScreens.at(-1).name, "localSetup");
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

test("appController: online play create join submit-move and ready-rematch actions use the multiplayer bridge", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    createRoom: [],
    joinRoom: [],
    submitMove: [],
    readyRematch: 0
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
          getState: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
          connect: async () => ({
            connectionStatus: "connected",
            socketId: "socket-1",
            room: null,
            lastError: null,
            statusMessage: "Connected. Create a room or join one."
          }),
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
            return {};
          },
          joinRoom: async (payload) => {
            calls.joinRoom.push(payload);
            return {};
          },
          submitMove: async ({ move }) => {
            calls.submitMove.push(move);
            return {};
          },
          readyRematch: async () => {
            calls.readyRematch += 1;
            return {};
          },
          disconnect: async () => ({})
        }
      }
    };

    app.username = "SignedInUser";
    app.profile = { username: "SignedInUser", equippedCosmetics: {} };
    await app.showOnlinePlay();

    await shownScreens.at(-1).context.actions.createRoom();
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

    assert.deepEqual(calls.createRoom, [expectedIdentityPayload]);
    assert.deepEqual(calls.joinRoom, [{ roomCode: "ABC123", ...expectedIdentityPayload }]);
    assert.deepEqual(calls.submitMove, ["fire"]);
    assert.equal(calls.readyRematch, 1);
    assert.equal(app.onlinePlayJoinCode, "ABC123");
    assert.equal(app.username, "SignedInUser-Canonical");
    assert.equal(app.profile.tokens, 415);
    assert.equal(app.profile.wins, 9);
    assert.equal(app.profile.equippedCosmetics.background, "bg_crystal_nexus");
  } finally {
    globalThis.window = originalWindow;
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
  } finally {
    globalThis.window = originalWindow;
  }
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
  } finally {
    globalThis.window = originalWindow;
  }
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

test("appController: eligible login auto-claims daily login reward and requests toast", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    ensureProfile: 0,
    claimDailyLoginReward: 0,
    getDailyChallenges: 0,
    dailyToast: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: {
      showAchievement: () => {},
      showDailyLoginReward: () => {
        calls.dailyToast += 1;
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

    assert.equal(calls.ensureProfile, 1);
    assert.equal(calls.claimDailyLoginReward, 1);
    assert.equal(calls.dailyToast, 1);
    assert.ok(calls.getDailyChallenges >= 1);
    assert.equal(app.profile.tokens, 105);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("appController: login prefers the multiplayer profile snapshot when the session is already online-connected", async () => {
  const originalWindow = globalThis.window;
  const shownScreens = [];
  const calls = {
    ensureProfile: 0,
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
    await shownScreens.at(-1).context.actions.login("ConnectedUser");

    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.multiplayerGetProfile, 2);
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
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: false,
              profile: { username, tokens: 260, playerXP: 24, playerLevel: 2, equippedCosmetics: {} },
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-28T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
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
        username: "",
        email: "player@example.com",
        password: "password123"
      }
    ]);
    assert.equal(calls.multiplayerGetState, 1);
    assert.equal(calls.multiplayerGetProfile, 2);
    assert.equal(calls.ensureProfile, 0);
    assert.equal(calls.claimDailyLoginReward, 1);
    assert.equal(calls.getDailyChallenges, 0);
    assert.equal(app.username, "AccountUser");
    assert.equal(app.profile.tokens, 260);
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
          claimDailyLoginReward: async (username) => {
            calls.claimDailyLoginReward += 1;
            return {
              granted: false,
              profile: { username, tokens: 275, playerXP: 22, playerLevel: 2, equippedCosmetics: {} },
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-28T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          },
          getDailyChallenges: async () => ({
            dailyLogin: { eligible: false, msUntilReset: 3600000 },
            daily: { msUntilReset: 3600000, challenges: [] },
            weekly: { msUntilReset: 7200000, challenges: [] }
          })
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
    assert.equal(calls.multiplayerGetProfile, 2);
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

test("appController: restored authenticated startup still exposes local setup and creates both local PvP profiles", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const shownScreens = [];
  const calls = {
    restoreSession: 0,
    multiplayerGetProfile: 0,
    ensureProfile: [],
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
          ensureProfile: async (username) => {
            calls.ensureProfile.push(username);
            return {
              username,
              tokens: username === "LocalP2" ? 210 : 275,
              playerXP: 12,
              playerLevel: 2,
              equippedCosmetics: {}
            };
          },
          claimDailyLoginReward: async (username) => {
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
              dailyLoginStatus: {
                eligible: false,
                loginDayKey: "2026-03-28T00:00:00.000Z",
                lastDailyLoginClaimDate: "2026-03-28T00:00:00.000Z",
                msUntilReset: 3600000
              }
            };
          },
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
          }
        }
      }
    };

    await app.init();
    assert.equal(shownScreens.at(-1).name, "menu");

    await shownScreens.at(-1).context.actions.startLocalGame();
    assert.equal(shownScreens.at(-1).name, "localSetup");
    assert.equal(shownScreens.at(-1).context.defaultNames.p1, "RestoredUser");
    assert.equal(shownScreens.at(-1).context.defaultNames.p2, "");

    await shownScreens.at(-1).context.actions.start("RestoredUser", "LocalP2");

    assert.deepEqual(calls.ensureProfile, ["RestoredUser", "LocalP2"]);
    assert.deepEqual(calls.claimDailyLoginReward, ["RestoredUser", "RestoredUser", "LocalP2"]);
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
  const shownScreens = [];
  const calls = {
    claimDailyLoginReward: 0
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shownScreens.push({ name, context })
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

    app.showLogin();
    await shownScreens.at(-1).context.actions.login("GuardUser");
    await app.ensureDailyLoginAutoClaim({ showToasts: true, requestKey: "login:GuardUser" });

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

test("appController: online profile load keeps local fallback when multiplayer snapshot is unavailable", async () => {
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
  assert.equal(xpCalls.length, 1);
  assert.equal(xpCalls[0].label, "Alice XP");
  assert.equal(levelCalls.length, 1);
  assert.equal(levelCalls[0].playerName, "Alice");
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

test("appController: shared resolution popup uses 3-second skippable pass screen", async () => {
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
    MATCH_MODE.PVE
  );

  assert.equal(captured.secondsLeft, 3);
  assert.equal(captured.showContinueButton, true);
  assert.equal(captured.allowEnter, true);
  assert.equal(typeof captured.onContinue, "function");
});

test("appController: local hotseat waits for shared resolution popup before showing Player 1 ready prompt", async () => {
  let releaseResolution;
  let readyCalls = 0;

  const app = new AppController({
    screenManager: { register: () => {}, show: () => {} },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.settings = { gameplay: { timerSeconds: 30 }, ui: { reducedMotion: true } };
  app.showGame = () => {};
  app.showPlayer1TurnPass = async () => {
    readyCalls += 1;
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
  assert.equal(readyCalls, 0);

  releaseResolution();
  await pending;
  assert.equal(readyCalls, 1);
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
  const originalRandom = Math.random;

  const controller = new GameController({
    username: "PveWarUser",
    mode: MATCH_MODE.PVE,
    timerSeconds: 30,
    aiDifficulty: "normal",
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    Math.random = () => 0; // AI always picks first available card.
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
        p1: { hand: ["fire", "water", "earth"], wonRounds: 0 },
        p2: { hand: ["fire", "earth", "wind"], wonRounds: 0 }
      },
      currentPile: [],
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      history: [],
      meta: { totalCards: 6 }
    };

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
    Math.random = originalRandom;
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
  const originalRandom = Math.random;

  const controller = new GameController({
    username: "PveWarResolve",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    Math.random = () => 0;
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      players: {
        p1: { hand: ["fire", "fire"], wonRounds: 0 },
        p2: { hand: ["fire", "water"], wonRounds: 0 }
      },
      currentPile: [],
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      history: [],
      meta: { totalCards: 4 }
    };

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
    Math.random = originalRandom;
  }
});

test("gameController: PvE simultaneous WAR exhaustion resolves immediately without waiting for timer", async () => {
  const originalWindow = globalThis.window;
  const originalRandom = Math.random;

  const controller = new GameController({
    username: "PveWarExhaust",
    timerSeconds: 30,
    mode: MATCH_MODE.PVE,
    onUpdate: () => {},
    onMatchComplete: () => {}
  });

  try {
    Math.random = () => 0;
    globalThis.window = { elemintz: { state: { recordMatchResult: async () => ({}) } } };

    controller.match = {
      ...createMinimalMatch(MATCH_MODE.PVE),
      players: {
        p1: { hand: ["fire", "water"], wonRounds: 0 },
        p2: { hand: ["fire", "earth"], wonRounds: 0 }
      },
      currentPile: [],
      war: { active: false, clashes: 0, pendingClashes: 0, pendingPileSizes: [] },
      history: [],
      meta: { totalCards: 4 }
    };

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
    Math.random = originalRandom;
  }
});


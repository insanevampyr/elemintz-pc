import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MultiplayerClient } from "../../src/main/multiplayer/multiplayerClient.js";
import { AppController } from "../../src/renderer/systems/appController.js";
import { onlinePlayScreen } from "../../src/renderer/ui/screens/onlinePlayScreen.js";

function createMockRoom({ roomCode, host, guest = null, status = "waiting", visibility = "private" }) {
  return {
    roomCode,
    createdAt: "2026-03-20T12:00:00.000Z",
    visibility,
    host,
    guest,
    status,
    closingAt: null,
    disconnectState: null,
    hostScore: 0,
    guestScore: 0,
    roundNumber: 1,
    lastOutcomeType: null,
    matchComplete: false,
    winner: null,
    winReason: null,
    rematch: {
      hostReady: false,
      guestReady: false
    },
    rewardSettlement: null,
    hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
    warPot: { host: [], guest: [] },
    warActive: false,
    warDepth: 0,
    warRounds: [],
    roundHistory: [],
    serverMatchState: null,
    moveSync: {
      hostSubmitted: false,
      guestSubmitted: false,
      submittedCount: 0,
      bothSubmitted: false,
      updatedAt: null
    }
  };
}

function createAuthoritativeMatchState({
  roomCode = "ABC123",
  matchId = `${roomCode}:match:1`,
  currentRound = 1,
  activeStepId = `${matchId}:round:${currentRound}:step:round:warDepth:0`,
  lastResolvedOutcome = null,
  turnTimer = {
    active: false,
    stepId: activeStepId,
    durationMs: 20000,
    startedAt: null,
    expiresAt: null
  }
} = {}) {
  return {
    roomCode,
    matchId,
    players: {
      host: { socketId: "host-1", sessionId: "host-session", username: "HostPlayer" },
      guest: { socketId: "guest-1", sessionId: "guest-session", username: "GuestPlayer" }
    },
    currentRound,
    activeStep: {
      id: activeStepId,
      round: currentRound,
      type: "round",
      warDepth: 0,
      status: "collecting"
    },
    playerHands: {
      host: { fire: 2, water: 2, earth: 2, wind: 2 },
      guest: { fire: 2, water: 2, earth: 2, wind: 2 }
    },
    warState: {
      active: false,
      depth: 0
    },
    pendingActions: {
      host: null,
      guest: null
    },
    matchStatus: "active",
    lastResolvedOutcome,
    turnTimer,
    turnState: {
      waitingOn: ["host", "guest"],
      lockedIn: [],
      resolutionReady: false
    }
  };
}

function createAuthoritativeServerRoundResult({
  roomCode = "ABC123",
  round = 1,
  stepId = `${roomCode}:match:1:round:${round}:step:round:warDepth:0`,
  matchId = `${roomCode}:match:1`,
  authoritativeOutcomeType = "win",
  authoritativeWinner = "host",
  hostMove = "fire",
  guestMove = "earth",
  currentRound = round + 1
} = {}) {
  return {
    roomCode,
    matchId,
    stepId,
    submittedCards: {
      host: hostMove,
      guest: guestMove
    },
    authoritativeOutcomeType,
    authoritativeWinner,
    roundResult: {
      roomCode,
      round,
      hostMove,
      guestMove,
      outcomeType: authoritativeOutcomeType === "win" ? "resolved" : authoritativeOutcomeType,
      hostScore: authoritativeWinner === "host" ? 1 : 0,
      guestScore: authoritativeWinner === "guest" ? 1 : 0,
      roundNumber: currentRound,
      lastOutcomeType: authoritativeOutcomeType === "win" ? "resolved" : authoritativeOutcomeType,
      matchComplete: false,
      winner: null,
      winReason: null,
      rematch: {
        hostReady: false,
        guestReady: false
      },
      hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
      guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      warRounds: [],
      hostResult: authoritativeWinner === "host" ? "win" : authoritativeWinner === "guest" ? "lose" : "no_effect",
      guestResult: authoritativeWinner === "guest" ? "win" : authoritativeWinner === "host" ? "lose" : "no_effect"
    },
    matchSnapshot: createAuthoritativeMatchState({
      roomCode,
      matchId,
      currentRound,
      activeStepId: `${matchId}:round:${currentRound}:step:round:warDepth:0`,
      lastResolvedOutcome: {
        stepId,
        resolvedAt: "2026-03-29T12:00:00.000Z",
        round,
        type: authoritativeOutcomeType,
        winner: authoritativeWinner,
        hostMove,
        guestMove
      }
    }),
    animation: {
      clearWarStateAfterDelay: authoritativeOutcomeType === "war_resolved",
      matchComplete: false
    }
  };
}

function createRewardSettlement({
  roomCode = "ABC123",
  settlementKey = `${roomCode}:match:1`,
  winner = "host",
  hostRewards = { tokens: 25, xp: 20, basicChests: 1 },
  guestRewards = { tokens: 5, xp: 5, basicChests: 0 }
} = {}) {
  return {
    granted: true,
    grantedAt: "2026-03-29T12:00:00.000Z",
    settlementKey,
    decision: {
      matchId: settlementKey,
      roomCode,
      winner,
      isDraw: winner === "draw",
      settlementKey,
      rewards: {
        host: { ...hostRewards },
        guest: { ...guestRewards }
      },
      participants: {
        hostUsername: "HostPlayer",
        guestUsername: "GuestPlayer"
      },
      decidedAt: "2026-03-29T12:00:00.000Z"
    },
    summary: {
      granted: true,
      winner,
      settledHostUsername: "HostPlayer",
      settledGuestUsername: "GuestPlayer",
      hostRewards: { tokens: 1, xp: 1, basicChests: 0 },
      guestRewards: { tokens: 1, xp: 1, basicChests: 0 }
    }
  };
}

function createCompletedLocalMatch({
  mode = "pve",
  winner = "p1",
  endReason = null,
  round = 3
} = {}) {
  return {
    status: "completed",
    mode,
    winner,
    endReason,
    round,
    history: [
      {
        round: 1,
        result: winner === "draw" ? "none" : winner,
        p1Card: "fire",
        p2Card: "earth",
        warClashes: 0,
        capturedCards: winner === "draw" ? 0 : 2,
        capturedOpponentCards: winner === "draw" ? 0 : 1
      }
    ],
    players: {
      p1: { hand: [] },
      p2: { hand: [] }
    },
    meta: {
      totalCards: 8,
      startedAt: "2026-05-12T12:00:00.000Z",
      endedAt: "2026-05-12T12:03:00.000Z"
    }
  };
}

function createAppController() {
  const screenCalls = [];
  return new AppController({
    screenManager: {
      register: () => {},
      show: (screen, payload) => {
        screenCalls.push({ screen, payload });
      }
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      show: () => {}
    }
  });
}

class FakeSocket {
  constructor() {
    this.id = "socket-1";
    this.connected = true;
    this.conn = { transport: { name: "websocket" } };
    this.listeners = new Map();
    this.sentEvents = [];
    this.sessionUsername = null;
    this.sessionAuthenticated = false;
    queueMicrotask(() => {
      this.serverEmit("connect");
    });
  }

  on(eventName, listener) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }

    this.listeners.get(eventName).add(listener);
    return this;
  }

  once(eventName, listener) {
    const wrapped = (...args) => {
      this.off(eventName, wrapped);
      listener(...args);
    };
    return this.on(eventName, wrapped);
  }

  off(eventName, listener) {
    this.listeners.get(eventName)?.delete(listener);
    return this;
  }

  emit(eventName, payload, ack) {
    this.sentEvents.push({ eventName, payload });

    if (eventName === "session:bootstrap") {
      queueMicrotask(() => {
        this.sessionUsername = payload?.username ?? null;
        this.sessionAuthenticated = false;
        ack?.({
          ok: true,
          session: {
            token: "session-token-1",
            sessionId: "session-id-1",
            username: this.sessionUsername,
            profileKey: this.sessionUsername,
            accountId: null,
            authenticated: false
          }
        });
      });
    }

    if (eventName === "auth:register" || eventName === "auth:login") {
      queueMicrotask(() => {
        this.sessionUsername = payload?.username ?? "RegisteredUser";
        this.sessionAuthenticated = true;
        ack?.({
          ok: true,
          account: {
            accountId: "account-id-1",
            email: payload?.email ?? "player@example.com",
            username: this.sessionUsername,
            profileKey: this.sessionUsername,
            createdAt: "2026-03-28T12:00:00.000Z",
            updatedAt: "2026-03-28T12:00:00.000Z"
          },
          session: {
            token: "session-token-1",
            sessionId: "session-id-1",
            username: this.sessionUsername,
            profileKey: this.sessionUsername,
            accountId: "account-id-1",
            authenticated: true
          }
        });
      });
    }

    if (eventName === "session:resume") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          session: {
            token: payload?.sessionToken ?? "session-token-1",
            sessionId: "session-id-1",
            username: "VampyrLee",
            profileKey: "VampyrLee",
            accountId: this.sessionAuthenticated ? "account-id-1" : null,
            authenticated: this.sessionAuthenticated
          }
        });
      });
    }

    if (eventName === "session:logout") {
      queueMicrotask(() => {
        this.sessionUsername = null;
        this.sessionAuthenticated = false;
        ack?.({ ok: true });
      });
    }

    if (eventName === "room:create") {
      queueMicrotask(() => {
        this.serverEmit(
          "room:created",
          createMockRoom({
            roomCode: "ABC123",
            visibility: payload?.visibility ?? "private",
            host: {
              socketId: this.id,
              username: this.sessionUsername ?? payload?.username ?? null,
              equippedCosmetics: payload?.equippedCosmetics ?? null
            }
          })
        );
      });
    }

    if (eventName === "room:listPublic") {
      queueMicrotask(() => {
        const payload = {
          ok: true,
          rooms: [
            {
              roomCode: "PUB123",
              createdAt: "2026-03-20T12:00:00.000Z",
              hostUsername: "OpenHost",
              hostCosmetics: createEquippedCosmetics(),
              visibility: "public",
              status: "waiting"
            }
          ]
        };
        ack?.(payload);
        this.serverEmit("room:publicList", payload);
      });
    }

    if (eventName === "feedback:submit") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            feedbackId: "fb_mock",
            storedAt: "2026-05-13T12:00:00.000Z"
          }
        });
      });
    }

    if (eventName === "room:join") {
      queueMicrotask(() => {
        this.serverEmit(
          "room:joined",
          createMockRoom({
            roomCode: payload?.roomCode ?? "ABC123",
            status: "full",
            host: {
              socketId: "host-1",
              username: "ExistingHost",
              equippedCosmetics: {
                avatar: "avatar_fourfold_lord",
                background: "bg_elemental_throne",
                cardBack: "cardback_elemental_nexus",
                elementCardVariant: {
                  fire: "fire_variant_phoenix",
                  water: "water_variant_crystal",
                  earth: "earth_variant_titan",
                  wind: "wind_variant_storm_eye"
                },
                badge: "badge_arena_legend",
                title: "title_war_master"
              }
            },
            guest: {
              socketId: this.id,
              username: this.sessionUsername ?? payload?.username ?? null,
              equippedCosmetics: payload?.equippedCosmetics ?? null
            }
          })
        );
      });
    }

    if (eventName === "profile:get") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          profile: {
            authority: "server",
            source: "multiplayer",
            profile: {
              username: this.sessionUsername ?? payload?.username ?? null,
              tokens: 225,
              playerXP: 18,
              playerLevel: 1,
              equippedCosmetics: createEquippedCosmetics(),
              ownedCosmetics: {}
            },
            progression: {
              xp: {
                playerXP: 18,
                playerLevel: 1
              },
              dailyChallenges: { challenges: [] },
              weeklyChallenges: { challenges: [] },
              dailyLogin: { eligible: false }
            }
          }
        });
      });
    }

    if (eventName === "announcements:list") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            announcements: [
              {
                id: "patch-2-1-9",
                title: "v2.1.9 Patch Live",
                message: "Fixed the Profile reward popup loop reported by Bane.",
                type: "patch",
                priority: 10,
                active: true,
                dismissible: true,
                startsAt: null,
                endsAt: null
              }
            ],
            snapshot: {
              authority: "server",
              source: "multiplayer",
              profile: {
                username: this.sessionUsername ?? payload?.username ?? null,
                seenAnnouncements: {}
              },
              progression: {}
            }
          }
        });
      });
    }

    if (eventName === "announcements:dismiss") {
      queueMicrotask(() => {
        const dismissedId = payload?.id ?? "patch-2-1-9";
        ack?.({
          ok: true,
          result: {
            id: dismissedId,
            announcements: [],
            snapshot: {
              authority: "server",
              source: "multiplayer",
              profile: {
                username: this.sessionUsername ?? payload?.username ?? null,
                seenAnnouncements: {
                  [`announcement:${dismissedId}`]: true
                }
              },
              progression: {}
            }
          }
        });
      });
    }

    if (eventName === "shopRotation:getActive") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            rotation: {
              activeRotationId: "void-week-01",
              title: "Void Week",
              message: "Void Collection cosmetics are featured this week.",
              startsAt: null,
              endsAt: null,
              featuredCosmeticIds: [
                "avatar_voidbound_entity",
                "cardback_void_tease",
                "void_card_back",
                "void_altar_background",
                "title_void_doll"
              ]
            }
          }
        });
      });
    }

    if (eventName === "boostEvent:getActive") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            boostEvent: {
              enabled: true,
              title: "Online Players X2 XP Weekend",
              message: "Earn double XP in Online Play this weekend.",
              startsAt: "2026-05-22T18:00:00.000Z",
              endsAt: "2026-05-25T06:00:00.000Z",
              scope: "online",
              excludeDifficulties: [],
              xpMultiplier: 2,
              tokenMultiplier: 1
            }
          }
        });
      });
    }

    if (eventName === "profile:claimDailyLoginReward") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            granted: true,
            rewardTokens: 5,
            rewardXp: 2,
            profile: {
              username: this.sessionUsername ?? payload?.username ?? null,
              tokens: 230,
              playerXP: 20,
              playerLevel: 1,
              equippedCosmetics: createEquippedCosmetics(),
              ownedCosmetics: {}
            },
            dailyLoginStatus: {
              eligible: false,
              loginDayKey: "2026-03-29T23:00:00.000Z",
              lastDailyLoginClaimDate: "2026-03-29T23:00:00.000Z",
              nextResetAt: "2026-03-30T23:00:00.000Z",
              msUntilReset: 86400000
            },
            snapshot: {
              authority: "server",
              source: "multiplayer",
              profile: {
                username: this.sessionUsername ?? payload?.username ?? null,
                tokens: 230,
                playerXP: 20,
                playerLevel: 1,
                equippedCosmetics: createEquippedCosmetics(),
                ownedCosmetics: {}
              },
              progression: {
                xp: {
                  playerXP: 20,
                  playerLevel: 1
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: {
                  eligible: false,
                  loginDayKey: "2026-03-29T23:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-29T23:00:00.000Z",
                  nextResetAt: "2026-03-30T23:00:00.000Z",
                  msUntilReset: 86400000
                }
              }
            }
          }
        });
      });
    }

    if (eventName === "profile:acknowledgeMilestoneChestReward") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            pendingMilestoneChestRewardLevel: null,
            snapshot: {
              authority: "server",
              source: "multiplayer",
              username: this.sessionUsername ?? payload?.username ?? null,
              profile: {
                username: this.sessionUsername ?? payload?.username ?? null,
                playerLevel: Number(payload?.level ?? 5) || 5,
                pendingMilestoneChestRewardLevel: null,
                chests: {
                  basic: 0,
                  milestone: 1,
                  epic: 0,
                  legendary: 0
                },
                equippedCosmetics: createEquippedCosmetics(),
                ownedCosmetics: {}
              },
              progression: {}
            }
          }
        });
      });
    }

    if (eventName === "profile:buyStoreItem") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            profile: {
              username: this.sessionUsername ?? payload?.username ?? null,
              tokens: 160,
              ownedCosmetics: {
                avatar: ["default_avatar", payload?.cosmeticId ?? "fireavatarF"]
              },
              equippedCosmetics: createEquippedCosmetics()
            },
            purchase: {
              status: "purchased",
              type: payload?.type ?? "avatar",
              cosmeticId: payload?.cosmeticId ?? "fireavatarF",
              price: 40,
              tokensLeft: 160
            },
            tracking: {
              unlockedMilestones: ["FIRST_AVATAR_PURCHASED"],
              totalOwnedDelta: 1
            },
            store: {
              tokens: 160,
              supporterPass: false,
              catalog: {}
            },
            snapshot: {
              authority: "server",
              source: "multiplayer",
              profile: {
                username: this.sessionUsername ?? payload?.username ?? null,
                tokens: 160,
                ownedCosmetics: {
                  avatar: ["default_avatar", payload?.cosmeticId ?? "fireavatarF"]
                },
                equippedCosmetics: createEquippedCosmetics()
              },
              progression: {}
            }
          }
        });
      });
    }

    if (eventName === "profile:openChest") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            chestType: payload?.chestType ?? "epic",
            consumed: 1,
            remaining: 0,
            rewards: {
              tokens: 80,
              xp: 30,
              cosmetic: null
            },
            profile: {
              username: this.sessionUsername ?? payload?.username ?? null,
              tokens: 280,
              playerXP: 30,
              playerLevel: 1,
              chests: {
                basic: 0,
                milestone: 0,
                epic: 0,
                legendary: 0
              },
              equippedCosmetics: createEquippedCosmetics()
            },
            snapshot: {
              authority: "server",
              source: "multiplayer",
              profile: {
                username: this.sessionUsername ?? payload?.username ?? null,
                tokens: 280,
                playerXP: 30,
                playerLevel: 1,
                chests: {
                  basic: 0,
                  milestone: 0,
                  epic: 0,
                  legendary: 0
                },
                equippedCosmetics: createEquippedCosmetics()
              },
              progression: {}
            }
          }
        });
      });
    }

    if (eventName === "profile:applyLocalMatchResult") {
      queueMicrotask(() => {
        const username = this.sessionUsername ?? payload?.username ?? null;
        ack?.({
          ok: true,
          result: {
            duplicate: false,
            matchResult: {
              profile: {
                username,
                tokens: 225,
                playerXP: 20,
                playerLevel: 1
              },
              stats: {
                gamesPlayed: 1
              },
              dailyChallenges: {
                challenges: []
              },
              weeklyChallenges: {
                challenges: []
              }
            },
            snapshot: {
              authority: "server",
              source: "multiplayer",
              profile: {
                username,
                tokens: 225,
                playerXP: 20,
                playerLevel: 1,
                equippedCosmetics: createEquippedCosmetics(),
                ownedCosmetics: {}
              },
              progression: {
                xp: {
                  playerXP: 20,
                  playerLevel: 1
                },
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: { eligible: false }
              }
            }
          }
        });
      });
    }

    if (eventName === "admin:confirmGrantReceipt") {
      queueMicrotask(() => {
        ack?.({
          ok: true,
          result: {
            transactionId: payload?.transactionId ?? null,
            targetUsername: this.sessionUsername ?? payload?.username ?? null,
            confirmationStatus: "confirmed",
            status: "success"
          }
        });
      });
    }

    return true;
  }

  disconnect() {
    this.connected = false;
    this.serverEmit("disconnect", "io client disconnect");
  }

  serverEmit(eventName, payload) {
    const listeners = [...(this.listeners.get(eventName) ?? [])];
    for (const listener of listeners) {
      listener(payload);
    }
  }
}

class DeferredChestSocket extends FakeSocket {
  constructor() {
    super();
    this.pendingChestAcks = [];
    this.remainingChests = {
      basic: 3,
      milestone: 2,
      epic: 10,
      legendary: 10
    };
  }

  emit(eventName, payload, ack) {
    if (eventName === "profile:openChest") {
      this.sentEvents.push({ eventName, payload });
      this.pendingChestAcks.push({ payload, ack });
      return this;
    }

    return super.emit(eventName, payload, ack);
  }

  resolveNextChestOpen() {
    const next = this.pendingChestAcks.shift();
    if (!next) {
      return;
    }

    const chestType = next.payload?.chestType ?? "basic";
    const currentCount = Math.max(0, Number(this.remainingChests[chestType] ?? 0));
    this.remainingChests[chestType] = Math.max(0, currentCount - 1);
    queueMicrotask(() => {
      next.ack?.({
        ok: true,
        result: {
          chestType,
          consumed: 1,
          remaining: this.remainingChests[chestType],
          rewards: {
            tokens: chestType === "legendary" ? 140 : chestType === "epic" ? 80 : 20,
            xp: chestType === "legendary" ? 70 : chestType === "epic" ? 30 : 5,
            cosmetic: null
          },
          snapshot: {
            authority: "server",
            source: "multiplayer",
            profile: {
              username: this.sessionUsername ?? next.payload?.username ?? null,
              chests: {
                ...this.remainingChests
              },
              equippedCosmetics: createEquippedCosmetics()
            },
            progression: {}
          }
        }
      });
    });
  }
}

async function waitFor(predicate, { attempts = 20 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return false;
}

class InvalidResumeSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "session:resume") {
      this.sentEvents.push({ eventName, payload });
      queueMicrotask(() => {
        ack?.({
          ok: false,
          error: {
            code: "SESSION_NOT_FOUND",
            message: "Stored session is no longer valid."
          }
        });
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

class AuthRequiredProfileSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "profile:get") {
      this.sentEvents.push({ eventName, payload });
      queueMicrotask(() => {
        ack?.({
          ok: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "Session expired. Please sign in again."
          }
        });
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

class AuthoritativeRoundSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "room:submitMove") {
      this.sentEvents.push({ eventName, payload });
      queueMicrotask(() => {
        this.serverEmit("room:moveSync", {
          ...createMockRoom({
            roomCode: "ABC123",
            status: "full",
            host: { socketId: this.id, username: "HostPlayer" },
            guest: { socketId: "guest-1", username: "GuestPlayer" }
          }),
          moveSync: {
            hostSubmitted: true,
            guestSubmitted: true,
            submittedCount: 2,
            bothSubmitted: true,
            updatedAt: "2026-03-29T12:00:00.000Z"
          }
        });
        this.serverEmit("room:roundResult", {
          roomCode: "ABC123",
          round: 1,
          hostMove: payload?.move ?? "fire",
          guestMove: "earth",
          outcomeType: "resolved",
          hostResult: "win",
          guestResult: "lose"
        });
        this.serverEmit(
          "room:serverRoundResult",
          createAuthoritativeServerRoundResult({
            hostMove: payload?.move ?? "fire",
            guestMove: "earth"
          })
        );
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

class SilentRoomActionSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    this.sentEvents.push({ eventName, payload });

    if (eventName === "room:create" || eventName === "room:join" || eventName === "room:submitMove") {
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

class PublicRoomFailureSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "room:listPublic") {
      queueMicrotask(() => {
        ack?.({
          ok: false,
          error: {
            code: "SESSION_REQUIRED",
            message: "A session is required to browse public rooms."
          }
        });
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

class PublicRoomEventOnlySocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "room:listPublic") {
      queueMicrotask(() => {
        this.serverEmit("room:publicList", {
          ok: true,
          rooms: [
            {
              roomCode: "PUB123",
              createdAt: "2026-03-20T12:00:00.000Z",
              hostUsername: "OpenHost",
              hostCosmetics: createEquippedCosmetics(),
              visibility: "public",
              status: "waiting"
            }
          ]
        });
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

class LateAuthoritativeRoundSocket extends FakeSocket {
  emit(eventName, payload, ack) {
    if (eventName === "room:submitMove") {
      this.sentEvents.push({ eventName, payload });
      queueMicrotask(() => {
        this.serverEmit(
          "room:serverRoundResult",
          createAuthoritativeServerRoundResult({
            roomCode: "ABC123",
            hostMove: payload?.move ?? "fire",
            guestMove: "earth"
          })
        );
      });
      return true;
    }

    return super.emit(eventName, payload, ack);
  }
}

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "elemintz-mp-client-"));
}

function createEquippedCosmetics() {
  return {
    avatar: "avatar_crystal_soul",
    background: "bg_verdant_shrine",
    cardBack: "cardback_arcane_galaxy",
    elementCardVariant: {
      fire: "fire_variant_crownfire",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_transparent_crystal",
      wind: "wind_variant_vortex_spirit"
    },
    badge: "badge_element_initiate",
    title: "title_apprentice"
  };
}

test("multiplayer client: room create emits equipped cosmetics in the socket payload", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const equippedCosmetics = createEquippedCosmetics();
  await client.createRoom({
    username: "VampyrLee",
    equippedCosmetics
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "VampyrLee"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:create",
    payload: {
      equippedCosmetics
    }
  });

  assert.deepEqual(client.getState().room?.host?.equippedCosmetics, equippedCosmetics);
});

test("multiplayer client: room create forwards public visibility when requested", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  await client.createRoom({
    username: "VampyrLee",
    visibility: "public"
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:create",
    payload: {
      visibility: "public"
    }
  });

  assert.equal(client.getState().room?.visibility, "public");
});

test("multiplayer client: room join emits equipped cosmetics in the socket payload", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const equippedCosmetics = createEquippedCosmetics();
  await client.joinRoom({
    roomCode: "abc123",
    username: "VampyrLee",
    equippedCosmetics
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "VampyrLee"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:join",
    payload: {
      roomCode: "abc123",
      equippedCosmetics
    }
  });

  assert.deepEqual(client.getState().room?.guest?.equippedCosmetics, equippedCosmetics);
});

test("multiplayer client: public room list request returns summarized waiting rooms", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const rooms = await client.listPublicRooms({
    username: "VampyrLee"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "VampyrLee"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "room:listPublic",
    payload: {}
  });

  assert.deepEqual(rooms, [
    {
      roomCode: "PUB123",
      createdAt: "2026-03-20T12:00:00.000Z",
      hostUsername: "OpenHost",
      hostCosmetics: createEquippedCosmetics(),
      visibility: "public",
      status: "waiting"
    }
  ]);
});

test("multiplayer client: public room list request surfaces readable auth failure without timing out", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new PublicRoomFailureSocket(),
    logger: { info: () => {}, error: () => {} }
  });

  const rooms = await client.listPublicRooms({
    username: "VampyrLee"
  });

  assert.equal(rooms, null);
  assert.equal(client.getState().lastError?.code, "SESSION_REQUIRED");
  assert.equal(client.getState().lastError?.message, "A session is required to browse public rooms.");
  assert.equal(client.getState().statusMessage, "A session is required to browse public rooms.");
});

test("multiplayer client: public room list request can resolve from the room:publicList event when ack is missing", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new PublicRoomEventOnlySocket(),
    logger: { info: () => {}, error: () => {} }
  });

  const rooms = await client.listPublicRooms({
    username: "VampyrLee"
  });

  assert.deepEqual(rooms, [
    {
      roomCode: "PUB123",
      createdAt: "2026-03-20T12:00:00.000Z",
      hostUsername: "OpenHost",
      hostCosmetics: createEquippedCosmetics(),
      visibility: "public",
      status: "waiting"
    }
  ]);
  assert.equal(client.getState().lastError, null);
  assert.equal(client.getState().statusMessage, "Loaded 1 public room.");
});

test("multiplayer client: server profile requests return authoritative snapshots", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const snapshot = await client.getProfile({
    username: "ServerOwnedUser"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "ServerOwnedUser"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:get",
    payload: {}
  });
  assert.equal(snapshot?.authority, "server");
  assert.equal(snapshot?.profile?.username, "ServerOwnedUser");
  assert.equal(snapshot?.progression?.xp?.playerXP, 18);
});

test("multiplayer client: announcements list returns active server announcements", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.listAnnouncements({
    username: "AnnouncementUser"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "AnnouncementUser"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "announcements:list",
    payload: {}
  });
  assert.equal(result?.announcements?.[0]?.id, "patch-2-1-9");
  assert.equal(result?.snapshot?.profile?.username, "AnnouncementUser");
});

test("multiplayer client: announcement dismiss returns updated seen state and next announcement list", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.dismissAnnouncement({
    username: "AnnouncementUser",
    id: "patch-2-1-9"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "AnnouncementUser"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "announcements:dismiss",
    payload: {
      id: "patch-2-1-9"
    }
  });
  assert.equal(result?.snapshot?.profile?.seenAnnouncements?.["announcement:patch-2-1-9"], true);
  assert.deepEqual(result?.announcements, []);
});

test("multiplayer client: active shop rotation returns the sanitized featured rotation payload", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.getActiveShopRotation({
    username: "AnnouncementUser"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "AnnouncementUser"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "shopRotation:getActive",
    payload: {}
  });
  assert.equal(result?.activeRotationId, "void-week-01");
  assert.deepEqual(result?.featuredCosmeticIds, [
    "avatar_voidbound_entity",
    "cardback_void_tease",
    "void_card_back",
    "void_altar_background",
    "title_void_doll"
  ]);
});

test("multiplayer client: active boost event returns the current server event", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.getActiveBoostEvent({
    username: "AnnouncementUser"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "AnnouncementUser"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "boostEvent:getActive",
    payload: {}
  });
  assert.equal(result?.title, "Online Players X2 XP Weekend");
  assert.equal(result?.scope, "online");
  assert.equal(result?.xpMultiplier, 2);
});

test("multiplayer client: authoritative daily login claims return updated server profile state", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.claimDailyLoginReward({
    username: "AuthorityUser"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "AuthorityUser"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:claimDailyLoginReward",
    payload: {}
  });
  assert.equal(result?.granted, true);
  assert.equal(result?.rewardTokens, 5);
  assert.equal(result?.snapshot?.profile?.tokens, 230);
  assert.equal(result?.snapshot?.progression?.dailyLogin?.eligible, false);
});

test("multiplayer client: authoritative milestone reward acknowledgement returns updated server profile state", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.acknowledgeMilestoneChestReward({
    username: "RewardAuthorityUser",
    level: 5
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "RewardAuthorityUser"
    }
  });
  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:acknowledgeMilestoneChestReward",
    payload: {
      level: 5
    }
  });
  assert.equal(result?.pendingMilestoneChestRewardLevel, null);
  assert.equal(result?.snapshot?.profile?.pendingMilestoneChestRewardLevel, null);
  assert.equal(result?.snapshot?.profile?.chests?.milestone, 1);
});

test("multiplayer client: server-authoritative store purchases return updated profile state", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.buyStoreItem({
    username: "StoreAuthorityUser",
    type: "avatar",
    cosmeticId: "fireavatarF"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "StoreAuthorityUser"
    }
  });
  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:buyStoreItem",
    payload: {
      type: "avatar",
      cosmeticId: "fireavatarF"
    }
  });
  assert.equal(result?.purchase?.status, "purchased");
  assert.equal(result?.purchase?.tokensLeft, 160);
  assert.equal(result?.snapshot?.profile?.tokens, 160);
  assert.ok(result?.snapshot?.profile?.ownedCosmetics?.avatar?.includes("fireavatarF"));
});

test("multiplayer client: server-authoritative chest opening returns updated profile state", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.openChest({
    username: "ChestAuthorityUser",
    chestType: "epic"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "ChestAuthorityUser"
    }
  });
  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:openChest",
    payload: {
      chestType: "epic"
    }
  });
  assert.equal(result?.chestType, "epic");
  assert.equal(result?.rewards?.tokens, 80);
  assert.equal(result?.snapshot?.profile?.chests?.epic, 0);
});

test("multiplayer client: server-authoritative legendary chest opening returns updated profile state", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.openChest({
    username: "ChestAuthorityUser",
    chestType: "legendary"
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "ChestAuthorityUser"
    }
  });
  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:openChest",
    payload: {
      chestType: "legendary"
    }
  });
  assert.equal(result?.chestType, "legendary");
  assert.equal(result?.rewards?.tokens, 80);
  assert.equal(result?.snapshot?.profile?.chests?.legendary, 0);
});

test("multiplayer client: feedback submission uses the authoritative feedback route", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const result = await client.submitFeedback({
    username: "FeedbackAuthorityUser",
    category: "Bug / Error",
    message: "The room browser did not refresh for me.",
    includeDebugInfo: true,
    clientContext: {
      screen: "menu",
      connectionStatus: "connected"
    }
  });

  assert.deepEqual(lastSocket.sentEvents.at(0), {
    eventName: "session:bootstrap",
    payload: {
      username: "FeedbackAuthorityUser"
    }
  });
  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "feedback:submit",
    payload: {
      category: "Bug / Error",
      message: "The room browser did not refresh for me.",
      includeDebugInfo: true,
      clientContext: {
        screen: "menu",
        connectionStatus: "connected"
      }
    }
  });
  assert.equal(result?.feedbackId, "fb_mock");
});

test("multiplayer client: rejects concurrent chest opens while a request is already in flight", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new DeferredChestSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const firstOpenPromise = client.openChest({
    username: "ChestAuthorityUser",
    chestType: "legendary"
  });
  assert.equal(await waitFor(() => lastSocket?.pendingChestAcks?.length === 1), true);

  const secondResult = await client
    .openChest({
      username: "ChestAuthorityUser",
      chestType: "legendary"
    })
    .then(
      () => ({ ok: true }),
      (error) => ({ ok: false, message: String(error?.message ?? "") })
    );

  assert.equal(
    lastSocket.sentEvents.filter((event) => event.eventName === "profile:openChest").length,
    1
  );
  assert.equal(secondResult.ok, false);
  assert.match(secondResult.message, /already being opened/i);

  lastSocket.resolveNextChestOpen();
  const firstResult = await firstOpenPromise;
  assert.equal(firstResult?.chestType, "legendary");
  assert.equal(client.isOpeningChest, false);
});

test("multiplayer client: sequential and mixed chest opens complete after each prior request resolves", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new DeferredChestSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  const requestOrder = ["legendary", "epic", "legendary", "epic"];
  const results = [];

  for (const chestType of requestOrder) {
    const openPromise = client.openChest({
      username: "ChestAuthorityUser",
      chestType
    });
    assert.equal(await waitFor(() => lastSocket?.pendingChestAcks?.length === 1), true);
    lastSocket.resolveNextChestOpen();
    results.push(await openPromise);
  }

  assert.deepEqual(
    lastSocket.sentEvents
      .filter((event) => event.eventName === "profile:openChest")
      .map((event) => event.payload?.chestType),
    requestOrder
  );
  assert.deepEqual(
    results.map((result) => result?.chestType),
    requestOrder
  );
  assert.equal(client.isOpeningChest, false);
});

test("multiplayer client: receives admin grant notices and confirms them through the authoritative socket path", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} }
  });

  await client.connect();
  await client.ensureSession({ username: "NoticePlayer" });

  lastSocket.serverEmit("admin:grantNotice", {
    transactionId: "grant-1",
    targetUsername: "NoticePlayer",
    message: "EleMintz has sent you 50 XP. Click OK to confirm.",
    payload: { xp: 50, tokens: 0, chests: [] },
    timestamp: "2026-04-05T12:00:00.000Z"
  });

  assert.equal(client.getState().pendingAdminGrantNotices.length, 1);
  assert.equal(client.getState().pendingAdminGrantNotices[0].transactionId, "grant-1");

  const result = await client.confirmAdminGrantNotice({ transactionId: "grant-1" });

  assert.equal(result?.transactionId, "grant-1");
  assert.equal(result?.confirmationStatus, "confirmed");
  assert.equal(client.getState().pendingAdminGrantNotices.length, 0);
  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "admin:confirmGrantReceipt",
    payload: {
      transactionId: "grant-1"
    }
  });
});

test("multiplayer client: authenticated login reuses the server-issued session for later room actions", async () => {
  let lastSocket = null;
  const dataDir = await createTempDataDir();
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} },
    dataDir
  });

  try {
    const loginResult = await client.login({
      email: "player@example.com",
      password: "password123"
    });

    assert.equal(loginResult?.ok, true);
    assert.deepEqual(lastSocket.sentEvents.at(0), {
      eventName: "auth:login",
      payload: {
        email: "player@example.com",
        password: "password123"
      }
    });
    assert.equal(client.getState().session?.authenticated, true);
    assert.equal(client.getState().session?.accountId, "account-id-1");

    const equippedCosmetics = createEquippedCosmetics();
    await client.createRoom({
      equippedCosmetics
    });

    assert.deepEqual(lastSocket.sentEvents.at(-1), {
      eventName: "room:create",
      payload: {
        equippedCosmetics
      }
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: logout clears the stored session identity", async () => {
  let lastSocket = null;
  const dataDir = await createTempDataDir();
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} },
    dataDir
  });

  try {
    await client.login({
      email: "player@example.com",
      password: "password123"
    });
    await client.logout();

    assert.deepEqual(lastSocket.sentEvents.at(-1), {
      eventName: "session:logout",
      payload: {}
    });
    assert.equal(client.getState().session?.active, false);
    assert.equal(client.getState().session?.accountId, null);
    assert.equal(client.getState().session?.authenticated, false);

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: hotseat identity authentication uses an isolated account session without replacing the primary session", async () => {
  const sockets = [];
  const client = new MultiplayerClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  const loginResult = await client.login({
    email: "player@example.com",
    password: "password123"
  });
  assert.equal(loginResult?.ok, true);

  const resolved = await client.authenticateHotseatIdentity({
    mode: "register",
    username: "HotseatGuest",
    email: "guest@example.com",
    password: "guestpassword"
  });

  assert.equal(resolved?.ok, true);
  assert.equal(resolved?.profile?.profile?.username, "HotseatGuest");
  assert.equal(client.getState().session?.authenticated, true);
  assert.equal(client.getState().session?.username, "RegisteredUser");
  assert.equal(sockets.length, 2);
  assert.deepEqual(sockets[1].sentEvents.map((entry) => entry.eventName), [
    "auth:register",
    "profile:get",
    "session:logout"
  ]);
});

test("multiplayer client: authoritative local match settlement uses the primary session when no hotseat token is supplied", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new FakeSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  const matchState = createCompletedLocalMatch({ mode: "pve", winner: "p1" });
  await client.login({
    email: "player@example.com",
    password: "password123"
  });

  const result = await client.applyLocalMatchResult({
    username: "RegisteredUser",
    perspective: "p1",
    matchState,
    settlementKey: "PVE:server:1"
  });

  assert.deepEqual(lastSocket.sentEvents.at(-1), {
    eventName: "profile:applyLocalMatchResult",
    payload: {
      perspective: "p1",
      matchState,
      settlementKey: "PVE:server:1"
    }
  });
  assert.equal(result.snapshot?.profile?.username, "RegisteredUser");
});

test("multiplayer client: authoritative local hotseat settlement uses an isolated session token without replacing the primary session", async () => {
  const sockets = [];
  const client = new MultiplayerClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  const matchState = createCompletedLocalMatch({ mode: "local_pvp", winner: "p1" });
  await client.login({
    email: "player@example.com",
    password: "password123"
  });

  const result = await client.applyLocalMatchResult({
    username: "HotseatGuest",
    perspective: "p2",
    matchState,
    settlementKey: "LPVP:server:1",
    sessionToken: "hotseat-session-token"
  });

  assert.equal(sockets.length, 2);
  assert.deepEqual(sockets[1].sentEvents.at(0), {
    eventName: "profile:applyLocalMatchResult",
    payload: {
      sessionToken: "hotseat-session-token",
      perspective: "p2",
      matchState,
      settlementKey: "LPVP:server:1"
    }
  });
  assert.equal(client.getState().session?.username, "RegisteredUser");
  assert.equal(result.snapshot?.profile?.username, null);
});

test("multiplayer client: authenticated session restores from persisted storage on app restart", async () => {
  const dataDir = await createTempDataDir();
  let firstSocket = null;
  let secondSocket = null;

  try {
    const firstClient = new MultiplayerClient({
      socketFactory: () => {
        firstSocket = new FakeSocket();
        return firstSocket;
      },
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    await firstClient.login({
      email: "player@example.com",
      password: "password123"
    });

    const secondClient = new MultiplayerClient({
      socketFactory: () => {
        secondSocket = new FakeSocket();
        secondSocket.sessionAuthenticated = true;
        secondSocket.sessionUsername = "RegisteredUser";
        return secondSocket;
      },
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    const restoreResult = await secondClient.restoreSession();

    assert.equal(restoreResult?.ok, true);
    assert.equal(restoreResult?.restored, true);
    assert.deepEqual(secondSocket.sentEvents.at(0), {
      eventName: "session:resume",
      payload: {
        sessionToken: "session-token-1"
      }
    });
    assert.equal(secondClient.getState().session?.authenticated, true);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: expired persisted session is cleared before restore connects", async () => {
  const dataDir = await createTempDataDir();
  let socketCreated = false;

  try {
    await fs.writeFile(
      path.join(dataDir, "multiplayer-session.json"),
      JSON.stringify({
        schemaVersion: 1,
        session: {
          token: "expired-token",
          serverUrl: "http://127.0.0.1:3001",
          username: "ExpiredUser",
          sessionId: "expired-session-id",
          accountId: "expired-account-id",
          profileKey: "ExpiredUser",
          authenticated: true,
          persistedAt: "2026-03-01T00:00:00.000Z"
        }
      }),
      "utf8"
    );

    const originalNow = Date.now;
    Date.now = () => Date.parse("2026-03-28T12:00:00.000Z");
    try {
      const client = new MultiplayerClient({
        socketFactory: () => {
          socketCreated = true;
          return new FakeSocket();
        },
        logger: { info: () => {}, error: () => {} },
        dataDir
      });

      const restoreResult = await client.restoreSession();

      assert.equal(restoreResult?.ok, false);
      assert.equal(restoreResult?.invalid, true);
      assert.equal(restoreResult?.error?.code, "SESSION_EXPIRED");
      assert.equal(socketCreated, false);
      assert.equal(client.getState().session?.authenticated, false);
    } finally {
      Date.now = originalNow;
    }

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: invalid persisted session is cleared during restore", async () => {
  const dataDir = await createTempDataDir();

  try {
    await fs.writeFile(
      path.join(dataDir, "multiplayer-session.json"),
      JSON.stringify({
        schemaVersion: 1,
        session: {
          token: "stale-token",
          serverUrl: "http://127.0.0.1:3001",
          username: "StaleUser",
          sessionId: "stale-session-id",
          accountId: "stale-account-id",
          profileKey: "StaleUser",
          authenticated: true,
          persistedAt: "2026-03-28T15:00:00.000Z"
        }
      }),
      "utf8"
    );

    const client = new MultiplayerClient({
      socketFactory: () => new InvalidResumeSocket(),
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    const restoreResult = await client.restoreSession();

    assert.equal(restoreResult?.ok, false);
    assert.equal(restoreResult?.invalid, true);
    assert.equal(client.getState().session?.authenticated, false);

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: invalid authenticated server request clears session state", async () => {
  let lastSocket = null;
  const dataDir = await createTempDataDir();

  try {
    const client = new MultiplayerClient({
      socketFactory: () => {
        lastSocket = new AuthRequiredProfileSocket();
        return lastSocket;
      },
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    await client.login({
      email: "player@example.com",
      password: "password123"
    });

    const snapshot = await client.getProfile({
      username: "RegisteredUser"
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(snapshot, null);
    assert.equal(client.getState().session?.authenticated, false);
    assert.equal(client.getState().lastError?.code, "AUTH_REQUIRED");
    assert.equal(lastSocket.connected, false);

    const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "multiplayer-session.json"), "utf8"));
    assert.equal(persisted.session, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: room snapshots preserve the server-authoritative match state foundation", async () => {
  const dataDir = await createTempDataDir();

  try {
    const client = new MultiplayerClient({
      socketFactory: () => new FakeSocket(),
      logger: { info: () => {}, error: () => {} },
      dataDir
    });

    await client.connect();

    const room = createMockRoom({
      roomCode: "ABC123",
      status: "full",
      host: {
        socketId: "host-1",
        username: "HostPlayer",
        sessionId: "host-session"
      },
      guest: {
        socketId: "guest-1",
        username: "GuestPlayer",
        sessionId: "guest-session"
      }
    });
    room.serverMatchState = createAuthoritativeMatchState({
      roomCode: "ABC123"
    });
    room.serverMatchState.playerHands.host.fire = 1;
    room.serverMatchState.pendingActions.host = {
      selectedCard: "fire",
      submittedAt: "2026-03-29T12:00:00.000Z"
    };

    client.socket.serverEmit("room:update", room);

    assert.deepEqual(client.getState().room?.serverMatchState, room.serverMatchState);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("multiplayer client: online move submission waits for room:serverRoundResult and stores authoritative state", async () => {
  let lastSocket = null;
  const client = new MultiplayerClient({
    socketFactory: () => {
      lastSocket = new AuthoritativeRoundSocket();
      return lastSocket;
    },
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();
  client.updateState({
    room: createMockRoom({
      roomCode: "ABC123",
      status: "full",
      host: { socketId: "host-1", username: "HostPlayer" },
      guest: { socketId: "socket-1", username: "GuestPlayer" }
    }),
    socketId: "socket-1"
  });

  await client.submitMove({ move: "water" });

  const submitEvents = lastSocket.sentEvents.filter((entry) => entry.eventName === "room:submitMove");
  assert.equal(submitEvents.length, 1);
  assert.deepEqual(submitEvents[0], {
    eventName: "room:submitMove",
    payload: {
      move: "water"
    }
  });
  assert.equal(client.getState().latestRoundResult?.hostMove, "water");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.authoritativeOutcomeType, "win");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:1:step:round:warDepth:0");
});

test("multiplayer client: authoritative room result becomes online truth while compatibility roundResult does not", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();
  client.updateState({
    socketId: "guest-1",
    room: {
      ...createMockRoom({
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1", username: "HostPlayer" },
        guest: { socketId: "guest-1", username: "GuestPlayer" }
      }),
      serverMatchState: createAuthoritativeMatchState()
    }
  });

  client.socket.serverEmit("room:roundResult", {
    roomCode: "ABC123",
    round: 1,
    hostMove: "fire",
    guestMove: "water",
    outcomeType: "resolved",
    hostResult: "lose",
    guestResult: "win"
  });

  assert.equal(client.getState().latestRoundResult, null);
  assert.equal(client.getState().latestAuthoritativeRoundResult, null);

  const authoritativeResult = createAuthoritativeServerRoundResult({
    authoritativeWinner: "guest",
    hostMove: "fire",
    guestMove: "water"
  });
  client.socket.serverEmit("room:serverRoundResult", authoritativeResult);

  assert.equal(client.getState().latestRoundResult?.guestMove, "water");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.authoritativeWinner, "guest");
  assert.equal(client.getState().statusMessage, "You Win Room ABC123");

  client.socket.serverEmit("room:roundResult", {
    roomCode: "ABC123",
    round: 1,
    hostMove: "earth",
    guestMove: "wind",
    outcomeType: "resolved",
    hostResult: "win",
    guestResult: "lose"
  });

  assert.equal(client.getState().latestRoundResult?.guestMove, "water");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.authoritativeWinner, "guest");
});

test("multiplayer client: stale and duplicate authoritative round results are ignored", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();
  client.updateState({
    socketId: "host-1",
    room: {
      ...createMockRoom({
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1", username: "HostPlayer" },
        guest: { socketId: "guest-1", username: "GuestPlayer" }
      }),
      serverMatchState: createAuthoritativeMatchState()
    }
  });

  const firstResult = createAuthoritativeServerRoundResult({
    round: 2,
    stepId: "ABC123:match:1:round:2:step:round:warDepth:0",
    currentRound: 3
  });
  client.socket.serverEmit("room:serverRoundResult", firstResult);
  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:2:step:round:warDepth:0");

  const duplicateResult = createAuthoritativeServerRoundResult({
    round: 2,
    stepId: "ABC123:match:1:round:2:step:round:warDepth:0",
    authoritativeWinner: "guest",
    hostMove: "earth",
    guestMove: "wind",
    currentRound: 3
  });
  client.socket.serverEmit("room:serverRoundResult", duplicateResult);
  assert.equal(client.getState().latestAuthoritativeRoundResult?.authoritativeWinner, "host");
  assert.equal(client.getState().latestRoundResult?.hostMove, "fire");

  const staleResult = createAuthoritativeServerRoundResult({
    round: 1,
    stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
    authoritativeWinner: "guest",
    hostMove: "water",
    guestMove: "fire",
    currentRound: 2
  });
  client.socket.serverEmit("room:serverRoundResult", staleResult);
  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:2:step:round:warDepth:0");
  assert.equal(client.getState().latestRoundResult?.hostMove, "fire");
});

test("multiplayer client: stale room:update cannot roll back settled post-match reward state", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();

  const settledRoom = createMockRoom({
    roomCode: "ABC123",
    status: "closing",
    host: { socketId: "host-1", username: "HostPlayer" },
    guest: { socketId: "guest-1", username: "GuestPlayer" }
  });
  settledRoom.matchComplete = true;
  settledRoom.winner = "host";
  settledRoom.rewardSettlement = createRewardSettlement();
  settledRoom.serverMatchState = createAuthoritativeMatchState({
    roomCode: "ABC123",
    currentRound: 9,
    activeStepId: "ABC123:match:1:round:9:step:round:warDepth:0",
    lastResolvedOutcome: {
      stepId: "ABC123:match:1:round:8:step:round:warDepth:0",
      resolvedAt: "2026-03-29T12:00:08.000Z",
      round: 8,
      type: "win",
      winner: "host",
      hostMove: "wind",
      guestMove: "water"
    }
  });
  client.socket.serverEmit("room:update", settledRoom);

  const staleRoom = createMockRoom({
    roomCode: "ABC123",
    status: "full",
    host: { socketId: "host-1", username: "HostPlayer" },
    guest: { socketId: "guest-1", username: "GuestPlayer" }
  });
  staleRoom.matchComplete = false;
  staleRoom.rewardSettlement = null;
  staleRoom.serverMatchState = createAuthoritativeMatchState({
    roomCode: "ABC123",
    currentRound: 9,
    activeStepId: "ABC123:match:1:round:9:step:round:warDepth:0",
    lastResolvedOutcome: {
      stepId: "ABC123:match:1:round:8:step:round:warDepth:0",
      resolvedAt: "2026-03-29T12:00:08.000Z",
      round: 8,
      type: "win",
      winner: "host",
      hostMove: "wind",
      guestMove: "water"
    }
  });
  client.socket.serverEmit("room:update", staleRoom);

  assert.equal(client.getState().room?.status, "closing");
  assert.equal(client.getState().room?.matchComplete, true);
  assert.equal(client.getState().room?.rewardSettlement?.settlementKey, "ABC123:match:1");
});

test("multiplayer client: transient disconnect preserves last authoritative online snapshot for reconnect", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();

  const room = createMockRoom({
    roomCode: "ABC123",
    status: "paused",
    host: { socketId: "host-1", username: "HostPlayer" },
    guest: { socketId: "guest-1", username: "GuestPlayer" }
  });
  room.serverMatchState = createAuthoritativeMatchState({
    roomCode: "ABC123",
    currentRound: 2,
    activeStepId: "ABC123:match:1:round:2:step:round:warDepth:0",
    lastResolvedOutcome: {
      stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
      resolvedAt: "2026-03-29T12:00:00.000Z",
      round: 1,
      type: "win",
      winner: "host",
      hostMove: "fire",
      guestMove: "earth"
    }
  });
  client.socket.serverEmit("room:joined", room);
  client.socket.serverEmit("disconnect", "transport close");

  assert.equal(client.getState().connectionStatus, "disconnected");
  assert.equal(client.getState().room?.roomCode, "ABC123");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:1:step:round:warDepth:0");
  assert.match(client.getState().statusMessage, /awaiting reconnect/i);
});

test("multiplayer client: timed out room action does not clear current authoritative state", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new SilentRoomActionSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();
  client.updateState({
    room: createMockRoom({
      roomCode: "ABC123",
      status: "waiting",
      host: { socketId: "socket-1", username: "ExistingHost" }
    }),
    latestRoundResult: {
      roomCode: "ABC123",
      round: 1,
      hostMove: "fire",
      guestMove: "earth",
      outcomeType: "resolved"
    },
    latestAuthoritativeRoundResult: {
      roomCode: "ABC123",
      matchId: "ABC123:match:1",
      stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
      submittedCards: { host: "fire", guest: "earth" },
      authoritativeOutcomeType: "win",
      authoritativeWinner: "host"
    }
  });

  await client.joinRoom({ roomCode: "ABC123", username: "VampyrLee" });

  assert.equal(client.getState().room?.roomCode, "ABC123");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:1:step:round:warDepth:0");
  assert.equal(client.getState().lastError?.code, "REQUEST_TIMEOUT");
});

test("multiplayer client: late authoritative round result still resolves submit when moveSync is dropped", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new LateAuthoritativeRoundSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();
  client.updateState({
    room: createMockRoom({
      roomCode: "ABC123",
      status: "full",
      host: { socketId: "socket-1", username: "HostPlayer" },
      guest: { socketId: "guest-1", username: "GuestPlayer" }
    })
  });

  await client.submitMove({ move: "fire" });

  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:1:step:round:warDepth:0");
  assert.equal(client.getState().latestRoundResult?.hostMove, "fire");
  assert.equal(client.getState().lastError, null);
});

test("multiplayer client: room snapshots preserve the full authoritative server match state for online rendering", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();

  const room = createMockRoom({
    roomCode: "ABC123",
    status: "full",
    host: {
      socketId: "host-1",
      username: "HostPlayer",
      sessionId: "host-session"
    },
    guest: {
      socketId: "guest-1",
      username: "GuestPlayer",
      sessionId: "guest-session"
    }
  });
  room.serverMatchState = createAuthoritativeMatchState({
    roomCode: "ABC123",
    lastResolvedOutcome: {
      stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
      resolvedAt: "2026-03-29T12:00:00.000Z",
      round: 1,
      type: "win",
      winner: "host",
      hostMove: "fire",
      guestMove: "earth"
    }
  });

  client.socket.serverEmit("room:update", room);

  assert.deepEqual(client.getState().room?.serverMatchState, room.serverMatchState);
});

test("multiplayer client: reconnect room join rehydrates authoritative round state from the server snapshot", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();

  const room = createMockRoom({
    roomCode: "ABC123",
    status: "full",
    host: {
      socketId: "host-1",
      username: "HostPlayer",
      sessionId: "host-session"
    },
    guest: {
      socketId: "guest-1",
      username: "GuestPlayer",
      sessionId: "guest-session"
    }
  });
  room.hostScore = 1;
  room.roundNumber = 2;
  room.moveSync = {
    hostSubmitted: true,
    guestSubmitted: false,
    submittedCount: 1,
    bothSubmitted: false,
    updatedAt: "2026-03-29T12:00:01.000Z"
  };
  room.serverMatchState = createAuthoritativeMatchState({
    roomCode: "ABC123",
    currentRound: 2,
    activeStepId: "ABC123:match:1:round:2:step:round:warDepth:0",
    lastResolvedOutcome: {
      stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
      resolvedAt: "2026-03-29T12:00:00.000Z",
      round: 1,
      type: "win",
      winner: "host",
      hostMove: "fire",
      guestMove: "earth"
    }
  });

  client.socket.serverEmit("room:joined", room);

  assert.deepEqual(client.getState().room?.serverMatchState, room.serverMatchState);
  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:1:step:round:warDepth:0");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.syncSource, "room_snapshot");
  assert.equal(client.getState().latestRoundResult?.hostMove, "fire");
  assert.equal(client.getState().latestRoundResult?.outcomeType, "resolved");
});

test("multiplayer client: stale reconnect room snapshot is ignored after newer authoritative state exists", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();

  const newerRoom = createMockRoom({
    roomCode: "ABC123",
    status: "full",
    host: { socketId: "host-1", username: "HostPlayer", sessionId: "host-session" },
    guest: { socketId: "guest-1", username: "GuestPlayer", sessionId: "guest-session" }
  });
  newerRoom.serverMatchState = createAuthoritativeMatchState({
    roomCode: "ABC123",
    currentRound: 3,
    activeStepId: "ABC123:match:1:round:3:step:round:warDepth:0",
    lastResolvedOutcome: {
      stepId: "ABC123:match:1:round:2:step:round:warDepth:0",
      resolvedAt: "2026-03-29T12:00:02.000Z",
      round: 2,
      type: "win",
      winner: "guest",
      hostMove: "earth",
      guestMove: "wind"
    }
  });
  client.socket.serverEmit("room:joined", newerRoom);

  const staleRoom = createMockRoom({
    roomCode: "ABC123",
    status: "full",
    host: { socketId: "host-1", username: "HostPlayer", sessionId: "host-session" },
    guest: { socketId: "guest-1", username: "GuestPlayer", sessionId: "guest-session" }
  });
  staleRoom.serverMatchState = createAuthoritativeMatchState({
    roomCode: "ABC123",
    currentRound: 2,
    activeStepId: "ABC123:match:1:round:2:step:round:warDepth:0",
    lastResolvedOutcome: {
      stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
      resolvedAt: "2026-03-29T12:00:00.000Z",
      round: 1,
      type: "win",
      winner: "host",
      hostMove: "fire",
      guestMove: "earth"
    }
  });
  client.socket.serverEmit("room:joined", staleRoom);

  assert.equal(client.getState().latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:2:step:round:warDepth:0");
  assert.equal(client.getState().latestAuthoritativeRoundResult?.authoritativeWinner, "guest");
  assert.equal(client.getState().room?.serverMatchState?.activeStep?.id, "ABC123:match:1:round:3:step:round:warDepth:0");
});

test("multiplayer client: room snapshots preserve authoritative reward decisions for online display", async () => {
  const client = new MultiplayerClient({
    socketFactory: () => new FakeSocket(),
    logger: { info: () => {}, error: () => {} },
    persistSession: false
  });

  await client.connect();

  const room = createMockRoom({
    roomCode: "ABC123",
    status: "full",
    host: { socketId: "host-1", username: "HostPlayer" },
    guest: { socketId: "guest-1", username: "GuestPlayer" }
  });
  room.matchComplete = true;
  room.winner = "host";
  room.rewardSettlement = createRewardSettlement();

  client.socket.serverEmit("room:update", room);

  assert.deepEqual(client.getState().room?.rewardSettlement?.decision, room.rewardSettlement.decision);
  assert.equal(client.getState().room?.rewardSettlement?.settlementKey, "ABC123:match:1");
});

test("app controller: online cosmetic helpers prefer authoritative server snapshot over stale local cosmetic state", () => {
  const controller = createAppController();
  const profileLike = {
    equippedCosmetics: {
      avatar: "local_avatar",
      background: "local_background",
      cardBack: "local_card_back",
      elementCardVariant: {
        fire: "local_fire_variant",
        water: "local_water_variant",
        earth: "local_earth_variant",
        wind: "local_wind_variant"
      },
      title: "local_title",
      badge: "local_badge"
    },
    cosmetics: {
      authority: "server",
      snapshot: {
        equipped: {
          avatar: "server_avatar",
          background: "server_background",
          cardBack: "server_card_back",
          elementCardVariant: {
            fire: "fire_variant_phoenix",
            water: "water_variant_crystal",
            earth: "earth_variant_titan",
            wind: "wind_variant_storm_eye"
          },
          title: "server_title",
          badge: "server_badge"
        }
      }
    }
  };

  const equipped = controller.buildOnlineEquippedCosmetics(profileLike);
  assert.equal(equipped.avatar, "server_avatar");
  assert.equal(equipped.background, "server_background");
  assert.equal(equipped.cardBack, "server_card_back");
  assert.equal(equipped.elementCardVariant.fire, "fire_variant_phoenix");
  assert.equal(equipped.title, "server_title");
  assert.equal(equipped.badge, "server_badge");
  assert.equal(controller.getBackgroundIdFromProfile(profileLike), "server_background");
});

test("app controller: server profile snapshots keep authoritative cosmetics when merged with local profile state", () => {
  const controller = createAppController();
  const localProfile = {
    username: "AuthorityUser",
    equippedCosmetics: {
      avatar: "local_avatar"
    },
    ownedCosmetics: {
      avatar: ["local_avatar"]
    }
  };
  const serverSnapshot = {
    authority: "server",
    username: "AuthorityUser",
    profile: {
      username: "AuthorityUser",
      equippedCosmetics: {
        avatar: "stale_server_profile_avatar"
      },
      ownedCosmetics: {
        avatar: ["stale_server_profile_avatar"]
      }
    },
    cosmetics: {
      authority: "server",
      source: "profileAuthority",
      snapshot: {
        equipped: {
          avatar: "server_avatar"
        },
        owned: {
          avatar: ["server_avatar"]
        },
        loadouts: [],
        preferences: {}
      },
      equipped: {
        avatar: "server_avatar"
      },
      owned: {
        avatar: ["server_avatar"]
      },
      loadouts: [],
      preferences: {}
    }
  };

  const merged = controller.mergeServerOwnedProfileDomains(localProfile, serverSnapshot);
  assert.equal(merged.equippedCosmetics.avatar, "server_avatar");
  assert.deepEqual(merged.ownedCosmetics.avatar, ["server_avatar"]);
  assert.equal(merged.cosmetics.authority, "server");
  assert.equal(merged.cosmetics.snapshot.equipped.avatar, "server_avatar");
});

test("app controller: reconnect snapshot resync is not cleared as stale local round state", () => {
  const controller = createAppController();
  const previousState = controller.normalizeOnlinePlayState({
    room: {
      ...createMockRoom({
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1", username: "HostPlayer" },
        guest: { socketId: "guest-1", username: "GuestPlayer" }
      }),
      moveSync: {
        hostSubmitted: false,
        guestSubmitted: false,
        submittedCount: 0,
        bothSubmitted: false,
        updatedAt: null
      }
    },
    latestRoundResult: null,
    latestAuthoritativeRoundResult: null
  });
  const nextState = controller.normalizeOnlinePlayState({
    room: {
      ...createMockRoom({
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1", username: "HostPlayer" },
        guest: { socketId: "guest-1", username: "GuestPlayer" }
      }),
      moveSync: {
        hostSubmitted: true,
        guestSubmitted: false,
        submittedCount: 1,
        bothSubmitted: false,
        updatedAt: "2026-03-29T12:00:01.000Z"
      }
    },
    latestRoundResult: {
      roomCode: "ABC123",
      round: 1,
      hostMove: "fire",
      guestMove: "earth",
      outcomeType: "resolved"
    },
    latestAuthoritativeRoundResult: {
      stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
      matchId: "ABC123:match:1",
      authoritativeOutcomeType: "win",
      authoritativeWinner: "host",
      submittedCards: {
        host: "fire",
        guest: "earth"
      },
      syncSource: "room_snapshot"
    }
  });

  const reconciled = controller.reconcileOnlinePlayRoundState(previousState, nextState);
  assert.equal(reconciled.latestRoundResult?.hostMove, "fire");
  assert.equal(reconciled.latestAuthoritativeRoundResult?.stepId, "ABC123:match:1:round:1:step:round:warDepth:0");
  assert.equal(reconciled.latestAuthoritativeRoundResult?.syncSource, "room_snapshot");
});

test("app controller: authenticated online profile load does not fall back to local profile restore", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };
  controller.profile = {
    username: "AuthorityUser",
    cosmetics: {
      authority: "server",
      snapshot: {
        equipped: {
          avatar: "server_avatar"
        },
        owned: {},
        loadouts: [],
        preferences: {}
      }
    }
  };

  let localProfileReads = 0;
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => null
      },
      state: {
        getProfile: async () => {
          localProfileReads += 1;
          return {
            username: "AuthorityUser",
            equippedCosmetics: {
              avatar: "local_avatar"
            }
          };
        }
      }
    }
  };

  const profile = await controller.loadPreferredProfileForOnlineSession({
    username: "AuthorityUser",
    onlineState: controller.onlinePlayState,
    allowEnsureLocal: false
  });

  assert.equal(localProfileReads, 0);
  assert.equal(profile?.username, "AuthorityUser");
  assert.equal(profile?.cosmetics?.snapshot?.equipped?.avatar, "server_avatar");
});

test("app controller: authenticated online daily login claim uses multiplayer authority instead of legacy local mutation", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.profile = {
    username: "AuthorityUser",
    tokens: 225,
    playerXP: 18,
    playerLevel: 1
  };
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };

  let localClaims = 0;
  let multiplayerClaims = 0;
  globalThis.window = {
    elemintz: {
      multiplayer: {
        claimDailyLoginReward: async ({ username }) => {
          multiplayerClaims += 1;
          assert.equal(username, "AuthorityUser");
          return {
            granted: true,
            rewardTokens: 5,
            rewardXp: 2,
            profile: {
              username: "AuthorityUser",
              tokens: 230,
              playerXP: 20,
              playerLevel: 1
            },
            snapshot: {
              authority: "server",
              source: "multiplayer",
              profile: {
                username: "AuthorityUser",
                tokens: 230,
                playerXP: 20,
                playerLevel: 1,
                equippedCosmetics: {},
                ownedCosmetics: {}
              },
              progression: {
                dailyChallenges: { challenges: [] },
                weeklyChallenges: { challenges: [] },
                dailyLogin: {
                  eligible: false,
                  loginDayKey: "2026-03-29T23:00:00.000Z",
                  lastDailyLoginClaimDate: "2026-03-29T23:00:00.000Z",
                  nextResetAt: "2026-03-30T23:00:00.000Z",
                  msUntilReset: 86400000
                }
              }
            }
          };
        },
        getProfile: async () => null
      },
      state: {
        claimDailyLoginReward: async () => {
          localClaims += 1;
          return {
            granted: true
          };
        }
      }
    }
  };

  const result = await controller.claimDailyLoginRewardFor("AuthorityUser", {
    showToasts: true
  });

  assert.equal(multiplayerClaims, 1);
  assert.equal(localClaims, 0);
  assert.equal(result?.granted, true);
  assert.equal(controller.profile?.tokens, 230);
  assert.equal(controller.dailyChallenges?.dailyLogin?.eligible, false);
});

test("app controller: authenticated online store view does not read stale local store state", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.profile = {
    username: "AuthorityUser",
    tokens: 12
  };
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };

  let localStoreReads = 0;
  const screenCalls = [];
  controller.screenManager.show = (screen, payload) => {
    screenCalls.push({ screen, payload });
  };
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => ({
          authority: "server",
          profile: {
            username: "AuthorityUser",
            tokens: 225,
            ownedCosmetics: {},
            equippedCosmetics: {}
          },
          progression: {}
        })
      },
      state: {
        getStore: async () => {
          localStoreReads += 1;
          return {
            tokens: 5,
            supporterPass: false,
            catalog: {}
          };
        }
      }
    }
  };

  await controller.showStore();

  assert.equal(localStoreReads, 0);
  assert.equal(screenCalls.at(-1)?.screen, "store");
  assert.equal(screenCalls.at(-1)?.payload?.store?.tokens, 225);
});

test("app controller: authenticated online store purchase uses multiplayer authority instead of the legacy block", async () => {
  const modalCalls = [];
  const screenCalls = [];
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screen, payload) => {
        screenCalls.push({ screen, payload });
      }
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: {
      show: () => {}
    }
  });
  controller.username = "AuthorityUser";
  controller.profile = {
    username: "AuthorityUser",
    tokens: 200,
    ownedCosmetics: {
      avatar: ["default_avatar"]
    },
    equippedCosmetics: {}
  };
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };

  let purchaseCalls = 0;
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => ({
          authority: "server",
          profile: {
            username: "AuthorityUser",
            tokens: 200,
            ownedCosmetics: {
              avatar: ["default_avatar"]
            },
            equippedCosmetics: {}
          },
          progression: {}
        }),
        buyStoreItem: async ({ type, cosmeticId }) => {
          purchaseCalls += 1;
          assert.equal(type, "avatar");
          assert.equal(cosmeticId, "fireavatarF");
          return {
            purchase: {
              status: "purchased",
              type,
              cosmeticId,
              price: 40,
              tokensLeft: 160
            },
            snapshot: {
              authority: "server",
              profile: {
                username: "AuthorityUser",
                tokens: 160,
                ownedCosmetics: {
                  avatar: ["default_avatar", "fireavatarF"]
                },
                equippedCosmetics: {}
              },
              progression: {}
            }
          };
        }
      },
      state: {
        getStore: async () => {
          throw new Error("local store read should not be used for authenticated online purchases");
        }
      }
    }
  };

  await controller.showStore();
  await screenCalls.at(-1).payload.actions.buy("avatar", "fireavatarF");

  assert.equal(purchaseCalls, 1);
  assert.equal(modalCalls.some((entry) => entry?.title === "Online Authority Only"), false);
  assert.equal(controller.profile?.tokens, 160);
  assert.ok(controller.profile?.ownedCosmetics?.avatar?.includes("fireavatarF"));
});

test("app controller: authenticated online achievements view does not read stale local achievement state", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };

  let localAchievementReads = 0;
  const screenCalls = [];
  controller.screenManager.show = (screen, payload) => {
    screenCalls.push({ screen, payload });
  };
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => ({
          authority: "server",
          profile: {
            username: "AuthorityUser",
            achievements: {
              first_flame: {
                count: 1,
                firstUnlockedAt: "2026-03-29T12:00:00.000Z",
                lastUnlockedAt: "2026-03-29T12:00:00.000Z"
              }
            },
            ownedCosmetics: {},
            equippedCosmetics: {}
          },
          progression: {}
        })
      },
      state: {
        getAchievements: async () => {
          localAchievementReads += 1;
          return {
            achievements: []
          };
        }
      }
    }
  };

  await controller.showAchievements();

  assert.equal(localAchievementReads, 0);
  assert.equal(screenCalls.at(-1)?.screen, "achievements");
  assert.ok(screenCalls.at(-1)?.payload?.achievements?.some((item) => item.id === "first_flame"));
});

test("app controller: authenticated online achievements view reuses authoritative profile state when server refresh is unavailable", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.profile = {
    username: "AuthorityUser",
    achievements: {
      first_flame: {
        count: 1,
        firstUnlockedAt: "2026-03-29T12:00:00.000Z",
        lastUnlockedAt: "2026-03-29T12:00:00.000Z"
      }
    }
  };
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };

  let localAchievementReads = 0;
  const screenCalls = [];
  controller.screenManager.show = (screen, payload) => {
    screenCalls.push({ screen, payload });
  };
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => null
      },
      state: {
        getAchievements: async () => {
          localAchievementReads += 1;
          return {
            achievements: []
          };
        }
      }
    }
  };

  await controller.showAchievements();

  assert.equal(localAchievementReads, 0);
  assert.equal(screenCalls.at(-1)?.screen, "achievements");
  assert.ok(screenCalls.at(-1)?.payload?.achievements?.some((item) => item.id === "first_flame"));
});

test("app controller: authenticated online profile screen surfaces authoritative achievement state", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.profile = {
    username: "AuthorityUser",
    achievements: {}
  };
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };

  let localProfileReads = 0;
  const screenCalls = [];
  controller.screenManager.show = (screen, payload) => {
    screenCalls.push({ screen, payload });
  };
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => ({
          authority: "server",
          username: "AuthorityUser",
          profile: {
            username: "AuthorityUser",
            achievements: {
              first_flame: {
                count: 1,
                firstUnlockedAt: "2026-03-29T12:00:00.000Z",
                lastUnlockedAt: "2026-03-29T12:00:00.000Z"
              }
            },
            equippedCosmetics: {},
            ownedCosmetics: {}
          },
          progression: {
            xp: {
              playerXP: 18,
              playerLevel: 1
            }
          }
        }),
        getCosmetics: async () => ({
          equipped: {},
          owned: {},
          catalog: {},
          loadouts: [],
          preferences: {}
        })
      },
      state: {
        getProfile: async () => {
          localProfileReads += 1;
          return {
            username: "AuthorityUser",
            achievements: {}
          };
        },
        getDailyChallenges: async () => ({
          xp: {
            playerXP: 5,
            playerLevel: 1
          }
        }),
        listProfiles: async () => []
      }
    }
  };

  await controller.showProfile();

  assert.equal(localProfileReads, 0);
  assert.equal(screenCalls.at(-1)?.screen, "profile");
  assert.equal(screenCalls.at(-1)?.payload?.profile?.achievements?.first_flame?.count, 1);
  assert.ok(screenCalls.at(-1)?.payload?.achievementCatalog?.some((item) => item.id === "first_flame" && item.unlocked));
});

test("app controller: duplicate authoritative achievement unlock toasts are suppressed", () => {
  const achievementCalls = [];
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      showAchievement: (achievement, options) => achievementCalls.push({ achievement, options })
    }
  });

  const result = {
    profile: {
      username: "AuthorityUser",
      chests: { basic: 0 },
      playerLevel: 1
    },
    unlockedAchievements: [
      {
        id: "first_flame",
        name: "First Flame",
        description: "Win your first match.",
        count: 1,
        firstUnlockedAt: "2026-03-29T12:00:00.000Z",
        lastUnlockedAt: "2026-03-29T12:00:00.000Z"
      }
    ],
    dailyRewards: [],
    weeklyRewards: [],
    xpBreakdown: { lines: [], total: 0 },
    xpDelta: 0,
    levelBefore: 1,
    levelAfter: 1,
    levelRewards: [],
    tokenDelta: 0,
    matchTokenDelta: 0,
    challengeTokenDelta: 0
  };

  controller.emitRewardToastsForResult(result, "AuthorityUser", null);
  controller.emitRewardToastsForResult(result, "AuthorityUser", null);

  assert.equal(achievementCalls.length, 1);
  assert.equal(achievementCalls[0].options.playerName, "AuthorityUser");
});

test("app controller: authenticated online challenge refresh does not fall back to stale local challenge state", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    }
  };

  let localChallengeReads = 0;
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => null
      },
      state: {
        getDailyChallenges: async () => {
          localChallengeReads += 1;
          return {
            daily: { challenges: [] },
            weekly: { challenges: [] },
            dailyLogin: { eligible: true }
          };
        }
      }
    }
  };

  await controller.refreshDailyChallengesForMenu();

  assert.equal(localChallengeReads, 0);
});

test("app controller: online settlement refresh reuses one authoritative server profile fetch", async () => {
  const controller = createAppController();
  controller.username = "AuthorityUser";
  controller.profile = {
    username: "AuthorityUser",
    tokens: 12
  };
  controller.dailyChallenges = {
    dailyLogin: {
      eligible: false
    }
  };
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityUser"
    },
    room: {
      roomCode: "ABC123",
      matchComplete: true,
      rewardSettlement: {
        granted: true,
        grantedAt: "2026-03-29T12:00:00.000Z",
        decision: {
          participants: {
            hostUsername: "AuthorityUser",
            guestUsername: "GuestUser"
          }
        }
      }
    }
  };
  controller.maybeRandomizeCosmeticsAfterMatchFor = async (_username, profile) => profile;

  let profileReads = 0;
  globalThis.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => {
          profileReads += 1;
          return {
            authority: "server",
            profile: {
              username: "AuthorityUser",
              tokens: 225,
              playerXP: 44,
              playerLevel: 2,
              ownedCosmetics: {},
              equippedCosmetics: {}
            },
            progression: {
              dailyChallenges: {
                challenges: [{ id: "daily-win" }]
              },
              weeklyChallenges: {
                challenges: [{ id: "weekly-play" }]
              },
              dailyLogin: {
                eligible: false
              },
              xp: {
                playerXP: 44,
                playerLevel: 2
              }
            },
            cosmetics: {
              snapshot: {
                equipped: {},
                owned: {},
                loadouts: [],
                preferences: {}
              }
            }
          };
        }
      },
      state: {
        getProfile: async () => {
          throw new Error("local fallback should not be used");
        },
        getDailyChallenges: async () => {
          throw new Error("local challenge fallback should not be used");
        }
      }
    }
  };

  const result = await controller.refreshOnlineSettlementStateFromServer(controller.onlinePlayState);

  assert.equal(profileReads, 1);
  assert.equal(result.profile?.username, "AuthorityUser");
  assert.deepEqual(result.challengeSummary?.daily, {
    challenges: [{ id: "daily-win" }]
  });
  assert.deepEqual(result.challengeSummary?.weekly, {
    challenges: [{ id: "weekly-play" }]
  });
  assert.equal(controller.profile?.tokens, 225);
});

test("app controller: authenticated PvE settlement uses server authority before local fallback", async () => {
  const originalWindow = globalThis.window;
  const controller = createAppController();
  controller.username = "AuthorityPveUser";
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "AuthorityPveUser",
      accountId: "account-id-1"
    }
  };

  const serverCalls = [];
  const fallbackCalls = [];
  const match = createCompletedLocalMatch({ mode: "pve", winner: "p1" });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => null,
          applyLocalMatchResult: async (payload) => {
            serverCalls.push(payload);
            return {
              profile: { username: payload.username },
              snapshot: {
                profile: {
                  username: payload.username,
                  tokens: 225,
                  playerXP: 20,
                  playerLevel: 1
                }
              }
            };
          }
        },
        state: {
          recordMatchResult: async (payload) => {
            fallbackCalls.push(payload);
            return { profile: { username: payload.username } };
          }
        }
      }
    };

    const result = await controller.persistPveResult(match);

    assert.equal(serverCalls.length, 1);
    assert.equal(fallbackCalls.length, 0);
    assert.equal(serverCalls[0].username, "AuthorityPveUser");
    assert.equal(serverCalls[0].perspective, "p1");
    assert.equal(serverCalls[0].matchState, match);
    assert.ok(serverCalls[0].settlementKey);
    assert.equal(result.snapshot?.profile?.username, "AuthorityPveUser");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("app controller: authenticated local PvP settlement updates both players through server authority", async () => {
  const originalWindow = globalThis.window;
  const controller = createAppController();
  controller.localPlayers = {
    p1: "HotseatHost",
    p2: "HotseatGuest"
  };
  controller.localPlayerAuthorities = {
    p1: {
      username: "HotseatHost",
      accountId: "host-account",
      sessionToken: null
    },
    p2: {
      username: "HotseatGuest",
      accountId: "guest-account",
      sessionToken: "guest-session-token"
    }
  };
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "HotseatHost",
      accountId: "host-account"
    }
  };

  const serverCalls = [];
  const fallbackCalls = [];
  const match = createCompletedLocalMatch({ mode: "local_pvp", winner: "p1" });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => null,
          applyLocalMatchResult: async (payload) => {
            serverCalls.push(payload);
            return {
              profile: { username: payload.username ?? "HotseatGuest" },
              snapshot: {
                profile: {
                  username: payload.username ?? "HotseatGuest"
                }
              }
            };
          }
        },
        state: {
          recordMatchResult: async (payload) => {
            fallbackCalls.push(payload);
            return { profile: { username: payload.username } };
          }
        }
      }
    };

    const result = await controller.persistLocalPvpResult(match);

    assert.equal(serverCalls.length, 2);
    assert.equal(fallbackCalls.length, 0);
    assert.equal(serverCalls[0].username, "HotseatHost");
    assert.equal(serverCalls[0].perspective, "p1");
    assert.equal(serverCalls[1].sessionToken, "guest-session-token");
    assert.equal(serverCalls[1].perspective, "p2");
    assert.equal(result.p1?.snapshot?.profile?.username, "HotseatHost");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("app controller: authoritative local settlement falls back to local persistence when the server write fails", async () => {
  const originalWindow = globalThis.window;
  const controller = createAppController();
  controller.username = "FallbackPveUser";
  controller.onlinePlayState = {
    connectionStatus: "connected",
    session: {
      authenticated: true,
      username: "FallbackPveUser",
      accountId: "account-id-1"
    }
  };

  const fallbackCalls = [];
  const match = createCompletedLocalMatch({ mode: "pve", winner: "p1" });

  try {
    globalThis.window = {
      elemintz: {
        multiplayer: {
          getProfile: async () => null,
          applyLocalMatchResult: async () => {
            throw new Error("server unavailable");
          }
        },
        state: {
          recordMatchResult: async (payload) => {
            fallbackCalls.push(payload);
            return {
              profile: { username: payload.username },
              duplicate: false
            };
          }
        }
      }
    };

    const result = await controller.persistPveResult(match);

    assert.equal(fallbackCalls.length, 1);
    assert.equal(fallbackCalls[0].username, "FallbackPveUser");
    assert.equal(fallbackCalls[0].perspective, "p1");
    assert.ok(fallbackCalls[0].settlementKey);
    assert.equal(result.profile?.username, "FallbackPveUser");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("online play screen: match rewards render from authoritative decision instead of legacy summary", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "/arena.png",
    profile: {
      chests: {
        basic: 4
      }
    },
    username: "HostPlayer",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        ...createMockRoom({
          roomCode: "ABC123",
          status: "full",
          host: { socketId: "host-1", username: "HostPlayer" },
          guest: { socketId: "guest-1", username: "GuestPlayer" }
        }),
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        rewardSettlement: createRewardSettlement()
      },
      latestRoundResult: null,
      latestAuthoritativeRoundResult: null,
      lastError: null,
      statusMessage: "Match complete in room ABC123."
    },
    taunts: {
      panelOpen: false,
      messages: [],
      presetLines: [],
      cooldownRemainingMs: 0,
      canSend: true
    },
    now: Date.parse("2026-03-29T12:05:00.000Z"),
    joinCode: ""
  });

  assert.match(html, /\+25 Tokens, \+20 XP, \+1 Basic Chest/);
  assert.doesNotMatch(html, /\+1 Tokens, \+1 XP/);
});

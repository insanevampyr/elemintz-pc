import { escapeHtml } from "../../utils/dom.js";

function findMoveButtonFromEvent(event) {
  const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
  for (const entry of path) {
    if (entry?.classList?.contains?.("online-move-btn")) {
      return entry;
    }
  }

  let node = event?.target ?? null;
  while (node) {
    if (node?.classList?.contains?.("online-move-btn")) {
      return node;
    }

    node = node.parentNode ?? node.parentElement ?? null;
  }

  return null;
}

function deriveRoleLabel(context) {
  const room = context.multiplayer?.room;
  const socketId = context.multiplayer?.socketId;

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

function deriveMoveSyncView(context) {
  const room = context.multiplayer?.room;
  const roleLabel = deriveRoleLabel(context);
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

function formatMoveLabel(move) {
  const normalized = String(move ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function deriveRoundResultView(context) {
  const result = context.multiplayer?.latestRoundResult;
  const roleLabel = deriveRoleLabel(context);

  if (!result || !roleLabel) {
    return null;
  }

  const perspectiveResult =
    roleLabel === "Host" ? result.hostResult : roleLabel === "Guest" ? result.guestResult : null;
  const perspectiveLabel =
    perspectiveResult === "win"
      ? "You Win"
      : perspectiveResult === "lose"
        ? "You Lose"
        : perspectiveResult === "draw"
          ? "Draw"
          : "";

  if (!perspectiveLabel) {
    return null;
  }

  return {
    hostMove: formatMoveLabel(result.hostMove),
    guestMove: formatMoveLabel(result.guestMove),
    perspectiveLabel
  };
}

export const onlinePlayScreen = {
  render(context) {
    const multiplayer = context.multiplayer;
    const room = multiplayer?.room ?? null;
    const roleLabel = deriveRoleLabel(context);
    const moveSync = deriveMoveSyncView(context);
    const roundResult = deriveRoundResultView(context);
    const joinCode = escapeHtml(context.joinCode ?? "");
    const isBusy = multiplayer?.connectionStatus === "connecting";
    const statusMessage = escapeHtml(multiplayer?.statusMessage ?? "Offline. Open Online Play to connect.");
    const errorMessage = multiplayer?.lastError?.message ? escapeHtml(multiplayer.lastError.message) : "";
    const roomCode = escapeHtml(room?.roomCode ?? "");
    const roomStatus = escapeHtml(room?.status ?? "");
    const safeConnectionStatus = escapeHtml(multiplayer?.connectionStatus ?? "disconnected");
    const safeRoleLabel = roleLabel ? escapeHtml(roleLabel) : "";
    const moveSyncLabel = moveSync
      ? moveSync.bothSubmitted
        ? "Both players submitted."
        : `${moveSync.submittedCount}/2 submitted.`
      : "";

    return `
      <section class="screen screen-online-play">
        <section class="arena-board screen-themed-surface" style="background-image: url('${context.backgroundImage}')">
          <div class="panel themed-screen-panel stack-sm">
            <h2 class="view-title">Online Play</h2>
            <p><strong>Connection:</strong> ${safeConnectionStatus}</p>
            <p>${statusMessage}</p>
            ${errorMessage ? `<p><strong>Error:</strong> ${errorMessage}</p>` : ""}
            <div class="stack-sm">
              <button id="online-create-room-btn" class="btn" ${isBusy ? "disabled" : ""}>Create Room</button>
              <form id="online-join-room-form" class="stack-sm">
                <label for="online-room-code-input">Join Room Code</label>
                <input
                  id="online-room-code-input"
                  name="roomCode"
                  type="text"
                  maxlength="6"
                  value="${joinCode}"
                  placeholder="ABC123"
                />
                <button id="online-join-room-btn" type="submit" class="btn" ${isBusy ? "disabled" : ""}>Join Room</button>
              </form>
            </div>
            ${
              room
                ? `
                  <section class="panel stack-sm">
                    <h3 class="section-title">Current Room</h3>
                    <p><strong>Room Code:</strong> ${roomCode}</p>
                    <p><strong>Status:</strong> ${roomStatus}</p>
                    ${safeRoleLabel ? `<p><strong>Role:</strong> ${safeRoleLabel}</p>` : ""}
                    ${
                      moveSync
                        ? `
                          <p><strong>Move Sync:</strong> ${escapeHtml(moveSyncLabel)}</p>
                          <p><strong>Host Submitted:</strong> ${moveSync.hostSubmitted ? "Yes" : "No"}</p>
                          <p><strong>Guest Submitted:</strong> ${moveSync.guestSubmitted ? "Yes" : "No"}</p>
                        `
                        : ""
                    }
                  </section>
                `
                : ""
            }
            ${
              moveSync
                ? `
                  <section class="panel stack-sm">
                    <h3 class="section-title">Submit Move</h3>
                    <p>${moveSync.ownSubmitted ? "Your move is locked in." : "Pick one move to submit to the server."}</p>
                    <div id="online-move-actions" class="grid two-col">
                      <button type="button" class="btn online-move-btn" data-move="fire" ${moveSync.ownSubmitted ? "disabled" : ""}>Submit Fire</button>
                      <button type="button" class="btn online-move-btn" data-move="water" ${moveSync.ownSubmitted ? "disabled" : ""}>Submit Water</button>
                      <button type="button" class="btn online-move-btn" data-move="earth" ${moveSync.ownSubmitted ? "disabled" : ""}>Submit Earth</button>
                      <button type="button" class="btn online-move-btn" data-move="wind" ${moveSync.ownSubmitted ? "disabled" : ""}>Submit Wind</button>
                    </div>
                  </section>
                `
                : ""
            }
            ${
              roundResult
                ? `
                  <section class="panel stack-sm">
                    <h3 class="section-title">Round Result</h3>
                    <p><strong>Host Move:</strong> ${escapeHtml(roundResult.hostMove)}</p>
                    <p><strong>Guest Move:</strong> ${escapeHtml(roundResult.guestMove)}</p>
                    <p><strong>Result:</strong> ${escapeHtml(roundResult.perspectiveLabel)}</p>
                  </section>
                `
                : ""
            }
            <button id="online-play-back-btn" class="btn">Back</button>
          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("online-create-room-btn").addEventListener("click", context.actions.createRoom);
    document.getElementById("online-play-back-btn").addEventListener("click", context.actions.back);

    const moveActions = document.getElementById("online-move-actions");
    if (moveActions) {
      moveActions.addEventListener("click", async (event) => {
        console.info("[OnlinePlay][Renderer] move button click received", {
          targetType: event?.target?.nodeName ?? typeof event?.target
        });

        const button = findMoveButtonFromEvent(event);
        if (!button || button.hasAttribute("disabled")) {
          return;
        }

        const move = button.getAttribute("data-move") ?? "";
        console.info("[OnlinePlay][Renderer] move extracted from button", {
          move
        });
        await context.actions.submitMove(move);
      });
    }

    const joinForm = document.getElementById("online-join-room-form");
    joinForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const roomCode = String(formData.get("roomCode") ?? "").trim();
      await context.actions.joinRoom(roomCode);
    });
  }
};

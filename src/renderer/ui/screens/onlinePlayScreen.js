import { escapeHtml } from "../../utils/dom.js";

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

export const onlinePlayScreen = {
  render(context) {
    const multiplayer = context.multiplayer;
    const room = multiplayer?.room ?? null;
    const roleLabel = deriveRoleLabel(context);
    const joinCode = escapeHtml(context.joinCode ?? "");
    const isBusy = multiplayer?.connectionStatus === "connecting";
    const statusMessage = escapeHtml(multiplayer?.statusMessage ?? "Offline. Open Online Play to connect.");
    const errorMessage = multiplayer?.lastError?.message ? escapeHtml(multiplayer.lastError.message) : "";
    const roomCode = escapeHtml(room?.roomCode ?? "");
    const roomStatus = escapeHtml(room?.status ?? "");
    const safeConnectionStatus = escapeHtml(multiplayer?.connectionStatus ?? "disconnected");
    const safeRoleLabel = roleLabel ? escapeHtml(roleLabel) : "";

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

    const joinForm = document.getElementById("online-join-room-form");
    joinForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const roomCode = String(formData.get("roomCode") ?? "").trim();
      await context.actions.joinRoom(roomCode);
    });
  }
};

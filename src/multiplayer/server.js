import { createMultiplayerFoundation } from "./foundation.js";

const server = createMultiplayerFoundation();
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info("[Multiplayer] shutting down", { signal });

  try {
    await server.stop();
  } catch (error) {
    console.error("[Multiplayer] failed to shut down cleanly", {
      signal,
      message: error?.message,
      stack: error?.stack
    });
  }
}

server.start().catch((error) => {
  console.error("[Multiplayer] failed to start", {
    message: error?.message,
    stack: error?.stack
  });
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  shutdown("SIGINT").finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").finally(() => process.exit(0));
});

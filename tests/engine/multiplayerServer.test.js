import test from "node:test";
import assert from "node:assert/strict";

import { createMultiplayerFoundation } from "../../src/multiplayer/foundation.js";

test("multiplayer foundation: health endpoint responds for deployment checks", async () => {
  const logEntries = [];
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: {
      info: (...args) => logEntries.push(args)
    }
  });

  try {
    const port = await foundation.start();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      ok: true,
      service: "elemintz-multiplayer",
      phase: 1,
      transport: "socket.io"
    });
    assert.ok(logEntries.some((entry) => entry[0] === "[Multiplayer] server listening"));
    assert.equal(typeof foundation.io.on, "function");
  } finally {
    await foundation.stop();
  }
});

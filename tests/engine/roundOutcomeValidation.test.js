import test from "node:test";
import assert from "node:assert/strict";

import { buildRoundResult, determineOutcome } from "../../src/multiplayer/rooms.js";
import { createMultiplayerFoundation } from "../../src/multiplayer/foundation.js";

const ELEMENTS = ["fire", "water", "earth", "wind"];
const BEATS = new Map([
  ["fire", "earth"],
  ["earth", "wind"],
  ["wind", "water"],
  ["water", "fire"]
]);

function expectedOutcome(hostMove, guestMove) {
  if (hostMove === guestMove) {
    return {
      hostResult: "war",
      guestResult: "war",
      outcomeType: "war"
    };
  }

  if (BEATS.get(hostMove) === guestMove) {
    return {
      hostResult: "win",
      guestResult: "lose",
      outcomeType: "resolved"
    };
  }

  if (BEATS.get(guestMove) === hostMove) {
    return {
      hostResult: "lose",
      guestResult: "win",
      outcomeType: "resolved"
    };
  }

  return {
    hostResult: "no_effect",
    guestResult: "no_effect",
    outcomeType: "no_effect"
  };
}

function createRoundRoom({
  hostMove,
  guestMove,
  roundNumber = 1,
  warActive = false,
  roomCode = "ROUND1"
} = {}) {
  return {
    roomCode,
    roundNumber,
    warActive,
    moves: {
      hostMove,
      guestMove
    }
  };
}

test("round outcome validation: multiplayer health reports phase 22", async () => {
  const foundation = createMultiplayerFoundation({
    port: 0,
    logger: { info: () => {} }
  });

  try {
    const port = await foundation.start();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.phase, 22);
  } finally {
    await foundation.stop();
  }
});

for (const hostMove of ELEMENTS) {
  for (const guestMove of ELEMENTS) {
    test(`round outcome validation: ${hostMove} vs ${guestMove} resolves deterministically`, () => {
      const expected = expectedOutcome(hostMove, guestMove);
      const deterministicOutcome = determineOutcome(hostMove, guestMove);
      const roundResult = buildRoundResult(
        createRoundRoom({
          hostMove,
          guestMove,
          roundNumber: 3,
          warActive: false,
          roomCode: "PAIR16"
        })
      );

      assert.deepEqual(deterministicOutcome, {
        hostResult: expected.hostResult,
        guestResult: expected.guestResult
      });

      assert.ok(roundResult);
      assert.equal(roundResult.roomCode, "PAIR16");
      assert.equal(roundResult.round, 3);
      assert.equal(roundResult.hostMove, hostMove);
      assert.equal(roundResult.guestMove, guestMove);
      assert.equal(roundResult.outcomeType, expected.outcomeType);
      assert.equal(roundResult.hostResult, expected.hostResult);
      assert.equal(roundResult.guestResult, expected.guestResult);

      assert.ok(["resolved", "war", "war_resolved", "no_effect"].includes(roundResult.outcomeType));
      assert.ok(["win", "lose", "war", "no_effect"].includes(roundResult.hostResult));
      assert.ok(["win", "lose", "war", "no_effect"].includes(roundResult.guestResult));

      if (hostMove === guestMove) {
        assert.equal(roundResult.outcomeType, "war");
        assert.equal(roundResult.hostResult, "war");
        assert.equal(roundResult.guestResult, "war");
      } else if (expected.outcomeType === "resolved") {
        assert.notEqual(roundResult.hostResult, roundResult.guestResult);
        assert.ok(
          (roundResult.hostResult === "win" && roundResult.guestResult === "lose") ||
            (roundResult.hostResult === "lose" && roundResult.guestResult === "win")
        );
      } else {
        assert.equal(roundResult.outcomeType, "no_effect");
        assert.equal(roundResult.hostResult, "no_effect");
        assert.equal(roundResult.guestResult, "no_effect");
      }
    });
  }
}

test("round outcome validation: war-context round classification stays consistent", () => {
  const resolvedWarRound = buildRoundResult(
    createRoundRoom({
      hostMove: "fire",
      guestMove: "earth",
      roundNumber: 5,
      warActive: true,
      roomCode: "WARWIN"
    })
  );
  const tiedWarRound = buildRoundResult(
    createRoundRoom({
      hostMove: "fire",
      guestMove: "fire",
      roundNumber: 5,
      warActive: true,
      roomCode: "WARTIE"
    })
  );
  const neutralWarRound = buildRoundResult(
    createRoundRoom({
      hostMove: "fire",
      guestMove: "wind",
      roundNumber: 5,
      warActive: true,
      roomCode: "WARNEUTRAL"
    })
  );

  assert.equal(resolvedWarRound.outcomeType, "war_resolved");
  assert.equal(resolvedWarRound.hostResult, "win");
  assert.equal(resolvedWarRound.guestResult, "lose");

  assert.equal(tiedWarRound.outcomeType, "war");
  assert.equal(tiedWarRound.hostResult, "war");
  assert.equal(tiedWarRound.guestResult, "war");

  assert.equal(neutralWarRound.outcomeType, "no_effect");
  assert.equal(neutralWarRound.hostResult, "no_effect");
  assert.equal(neutralWarRound.guestResult, "no_effect");
});

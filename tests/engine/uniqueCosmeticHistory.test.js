import test from "node:test";
import assert from "node:assert/strict";

import { queryUniqueCosmeticHistory } from "../../src/state/uniqueCosmeticHistory.js";

test("Unique history omits private payloads and does not fabricate royalty details", async () => {
  const purchaseEntries = [
    {
      transactionId: "history-no-royalty-1",
      buyerUsername: "Enab",
      cosmeticType: "avatar",
      cosmeticId: "retired_unique_avatar",
      price: 400,
      saleLimitMode: "unlimited",
      saleLimitSoldBefore: 0,
      saleLimitSoldAfter: 0,
      royaltyEnabled: false,
      royaltyRecipientUsername: "MustNotAppear",
      royaltyTokenPercent: 50,
      royaltyAmount: 200,
      royaltyStatus: "none",
      royaltyNotificationStatus: "none",
      status: "completed",
      completedAt: "2026-06-19T17:00:00.000Z",
      result: {
        adminNotes: "private"
      }
    }
  ];
  const result = await queryUniqueCosmeticHistory({
    storePurchaseLedgerStore: {
      listEntries: async () => purchaseEntries
    },
    adminGrantStore: {
      listEntries: async () => []
    },
    filters: {
      limit: 10
    }
  });

  assert.equal(result.total, 1);
  assert.deepEqual(
    {
      rarity: result.items[0].rarity,
      royaltyEnabled: result.items[0].royaltyEnabled,
      recipient: result.items[0].royaltyRecipientUsername,
      percent: result.items[0].royaltyTokenPercent,
      amount: result.items[0].royaltyAmount,
      status: result.items[0].royaltyStatus
    },
    {
      rarity: "Unique",
      royaltyEnabled: false,
      recipient: null,
      percent: null,
      amount: null,
      status: null
    }
  );
  assert.equal(JSON.stringify(result).includes("adminNotes"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("MustNotAppear"), false);
});

test("Unique history validates bounded paging and filter inputs", async () => {
  const stores = {
    storePurchaseLedgerStore: { listEntries: async () => [] },
    adminGrantStore: { listEntries: async () => [] }
  };

  await assert.rejects(
    () => queryUniqueCosmeticHistory({ ...stores, filters: { limit: 101 } }),
    /integer from 1 to 100/
  );
  await assert.rejects(
    () => queryUniqueCosmeticHistory({ ...stores, filters: { offset: -1 } }),
    /non-negative integer/
  );
  await assert.rejects(
    () => queryUniqueCosmeticHistory({ ...stores, filters: { recordType: "raw_payload" } }),
    /Invalid Unique history record type/
  );
});

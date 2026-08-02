# Event Chest Operator Guide

## Purpose and authority

This guide covers safe Admin handling of Event Chest drafts. The server is authoritative for deletion eligibility and deletion. Never edit Event Chest JSON or player data directly.

## Drafts, published revisions, and archives

- A draft is unpublished authoring state identified by its exact draft ID and draft revision ID.
- A published revision is retained server history. Publishing does not turn that revision into a deletable draft.
- Delete removes only an eligible unpublished draft.
- Archive preserves a published revision and its audit/replay history while removing it from normal active presentation.
- Published revisions, lifecycle history, player progress, pity, entitlements, settlements, and replay records must remain retained.
- Daily Chest is a separate system and has no Event Chest draft deletion action.

## Deletion statuses

- **Safe to delete:** the current exact unpublished draft has no protected references.
- **Deletion blocked:** one or more bounded reference categories require retention.
- **Deletion safety unavailable:** persistence is malformed, ambiguous, or cannot be inspected conclusively. Stop; do not bypass the proof.
- **Draft changed:** the selected revision is stale. Refresh and review the new exact revision before acting.
- **Draft no longer exists:** refresh the list and confirm the selection has cleared.

Common blocking categories include published-source identity, shared published-chest identity, child-draft lineage, lifecycle/history, profile progress, pity, entitlements, and settlement/replay references. These records are part of the audit and replay paper trail, not disposable clutter.

## Safe operator workflow

1. Select the exact draft.
2. Review the server-authoritative safety status and bounded reasons.
3. Confirm the displayed draft ID and revision ID.
4. Cancel if anything is unexpected; otherwise use the destructive confirmation to delete.
5. Allow the request to finish. Eligibility and deletion are single-flight operations; do not repeat-click or open parallel mutations.
6. Verify the exact selection clears and the authoritative draft list refreshes.

If the status is unavailable, stop and inspect the bounded reason. Escalate malformed or ambiguous persistence as a separate repair task with backups and rollback proof. Never delete published revisions or player records to make a draft eligible.

## Chest Review

Chest Review gives Admin operators a read-only preview of one exact draft revision. It is advisory: publish validation remains the authority that decides whether a draft can be published.

To review a chest:

1. Select the draft and open its Review step.
2. Choose **Refresh Review** to load the exact current draft revision.
3. Read the compact summary for readiness, schedule, opening methods, token cost, reward count, and important warnings.
4. Review **Standard odds**. Expand **Epic+ guarantee** or **Legendary guarantee** when needed.
5. Optionally select one exact published version of the same chest to see what changed. No comparison is selected automatically.
6. Expand technical IDs only when exact identity verification is needed.

Reward odds are deterministic, profile-free projections of the runtime rarity rules. Rewards within a selected rarity are equally likely. If ownership preference is enabled, runtime selection may favor unowned rewards within that rolled rarity. Chest Review does not calculate personalized odds and does not read a player's ownership.

Critical and high warnings identify objective conditions that need attention. Informational notices are advisory. Warnings do not replace validation and do not authorize publication.

Chest Review does not save, publish, delete, open, grant, spend, update pity, or mutate player or Event Chest persistence. A stale result means the draft changed; reload the exact current revision. If review data is unavailable, stop and retry only after the authoritative server and registry are available.

Artwork is shown when the Admin app can resolve the configured player-app asset. Missing or unavailable artwork uses a clean fallback and does not change the review result.

Connected Electron smoke was accepted by the owner: the exact review loaded, the compact summary and rarity odds were understandable, pity scenarios and exact published-version comparison worked, technical IDs remained available, artwork rendered or used the fallback, existing filters and draft controls remained functional, deletion and lifecycle/history behavior remained intact, and review performed no mutation.

## Acceptance and recovery record

Manual Electron smoke passed: eligible unpublished drafts were deleted successfully; protected drafts remained blocked with bounded reasons; exact selection and refresh behavior were correct; Event Chest category filters worked; published history and Daily Chest remained protected.

A smoke that was previously waived must remain recorded as waived; do not rewrite waived history as passed. Record later completed smoke separately with its actual date and result.

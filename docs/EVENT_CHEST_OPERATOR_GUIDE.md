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

## Acceptance and recovery record

Manual Electron smoke passed: eligible unpublished drafts were deleted successfully; protected drafts remained blocked with bounded reasons; exact selection and refresh behavior were correct; Event Chest category filters worked; published history and Daily Chest remained protected.

A smoke that was previously waived must remain recorded as waived; do not rewrite waived history as passed. Record later completed smoke separately with its actual date and result.

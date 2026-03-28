# Online-Only Phase 2: Server-Authoritative Profile Foundation

## New authority boundary

- Online profile reads after multiplayer settlement should prefer the multiplayer server profile snapshot.
- Online match-result mutation is now routed through `MultiplayerProfileAuthority`.
- Offline profile mutation remains on local `state:*` IPC for now.

## Server entry points

- `src/multiplayer/profileAuthority.js`
  - `getProfile(username)`
  - `updateProfile(username, changes)`
  - `applyMatchResult({ username, result, perspective, settlementKey, rewards })`

## Still intentionally local in Phase 2

- `state:recordMatchResult` for offline PvE/local PvP
- `state:getProfile` and `state:getDailyChallenges` for offline/profile screens
- Shop, chest, cosmetics, and other local progression writes outside online settlement

## Planned later removals/replacements

- Renderer online settlement fallback reads through `window.elemintz.state.getProfile(...)`
- Renderer online settlement fallback reads through `window.elemintz.state.getDailyChallenges(...)`
- Main-process `state:*` IPC as the source of truth for online-owned profile domains
- Direct server usage of `StateCoordinator` outside `MultiplayerProfileAuthority`

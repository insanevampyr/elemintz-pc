# Online-Only Phase 2: Server-Authoritative Profile Foundation

## New authority boundary

- Online profile reads after multiplayer settlement should prefer the multiplayer server profile snapshot.
- Online session-start profile reads now prefer the multiplayer server profile snapshot whenever the renderer is already in an online-connected flow or is entering Online Play.
- Online match-result mutation is now routed through `MultiplayerProfileAuthority`.
- Online username, equipped/owned cosmetics, stats, and currency/tokens now have an explicit multiplayer server snapshot domain for connected online flows.
- Offline profile mutation remains on local `state:*` IPC for now.

## Server entry points

- `src/multiplayer/profileAuthority.js`
  - `getProfile(username)`
  - `updateProfile(username, changes)`
  - `applyMatchResult({ username, result, perspective, settlementKey, rewards })`

## Server-owned online snapshot domains

- `username`
- `currency.tokens`
- `cosmetics.equipped`
- `cosmetics.owned`
- `cosmetics.loadouts`
- `cosmetics.preferences`
- `stats.summary`
- `stats.modes`
- `progression.xp`
- `progression.dailyChallenges`
- `progression.weeklyChallenges`
- `progression.dailyLogin`

## Still intentionally local in Phase 2

- Login/offline startup still falls back to `state:ensureProfile` / `state:getProfile` when no multiplayer-connected session is active.
- `state:recordMatchResult` for offline PvE/local PvP
- `state:getProfile` and `state:getDailyChallenges` for offline/profile screens
- Shop, chest, cosmetics, and other local progression writes outside online settlement

## Planned later removals/replacements

- Renderer login/session bootstrap fallback reads through local `window.elemintz.state.ensureProfile(...)` and `window.elemintz.state.getProfile(...)`
- Renderer online settlement fallback reads through `window.elemintz.state.getProfile(...)`
- Renderer online settlement fallback reads through `window.elemintz.state.getDailyChallenges(...)`
- Main-process `state:*` IPC as the source of truth for online-owned profile domains
- Direct server usage of `StateCoordinator` outside `MultiplayerProfileAuthority`
- Remaining online profile reads outside session start / settlement / room identity payloads
- Online writes for shop, chest, inventory, and other progression domains that still go through local `state:*`
- Offline-mode local profile storage until the later online-only cutoff

# Online-Only Phase 1 Authority Map

## Server-authoritative today

- Online room lifecycle in `src/multiplayer/foundation.js`
  - `createMultiplayerFoundation(...)`
  - `buildRewardSummary(room, ...)`
  - `buildOnlineMatchStateFromRoom(room)`
- Online live match state in `src/multiplayer/rooms.js`
  - `createRoom(...)`
  - `joinRoom(...)`
  - `submitMove(...)`
  - disconnect / reconnect handling inside `removeSocket(...)`
- Online reward and result persistence entrypoints in `src/multiplayer/server.js`
  - `rewardPersister(...)`
  - `disconnectTracker(...)`

## Client-authoritative today

- Desktop profile persistence through `src/main/ipc/stateIpc.js`
  - `state:recordMatchResult`
  - `state:buyStoreItem`
  - `state:grantSupporterPass`
  - `state:openChest`
  - `state:equipCosmetic`
  - `state:updateCosmeticPreferences`
  - `state:randomizeOwnedCosmetics`
  - loadout save/apply/rename handlers
- Local persistence backends
  - `src/state/profileSystem.js`
  - `src/state/saveSystem.js`
  - `src/state/storage/jsonStore.js`
- Core mutation coordinator
  - `src/state/stateCoordinator.js`

## Client display-only state

- Renderer-only view state in `src/renderer/systems/appController.js`
  - screen flow
  - search/filter state
  - locally rendered online room snapshot copies
  - modal visibility / countdown UI / hover state

## Duplicated or unsafe trust boundaries

- `src/multiplayer/rooms.js`
  - room create/join accepts client-supplied `username`
  - room create/join accepts client-supplied `equippedCosmetics`
- `src/multiplayer/server.js`
  - dedicated server persists rewards and progression by username without a real account/session proof yet
- `src/main/ipc/stateIpc.js`
  - renderer can request direct profile, inventory, currency, progression, and reward mutations on the local machine
- `src/state/stateCoordinator.js`
  - same coordinator supports both local/offline mutation flows and dedicated-server online reward flows

## Phase 1 hardening applied

- `src/multiplayer/rooms.js`
  - usernames are normalized and bounded before entering live room state
  - equipped cosmetic ids are normalized and bounded before entering live room state
  - a guest can no longer join a room using the same username as the active host
- `src/multiplayer/foundation.js`
  - reward settlement now refuses to persist profile rewards/results when both sides resolve to the same username

## Phase 2+ migration targets

- Profiles
  - move `ProfileSystem` storage from local JSON to server-owned persistence
  - replace `state:getProfile` / `state:ensureProfile` local authority with authenticated server fetch/update
- Inventory / cosmetics
  - migrate `buyStoreItem`, `openChest`, `equipCosmetic`, and loadout mutations behind authenticated server APIs
- Progression / rewards
  - migrate `recordMatchResult`, `grantOnlineMatchRewards`, daily login, achievements, daily challenges, and level rewards to server-owned writes
- Match results
  - persist online and later offline-compatible results through a server-owned match history service
- Persistence
  - replace direct renderer-to-local-store critical writes with validated request/response calls to the backend

## Risks intentionally left for later phases

- No account or session authentication yet
- No ownership verification for client-supplied equipped cosmetics yet
- Offline/local gameplay still writes directly to local profile storage
- Renderer IPC still exposes local-authoritative economy/progression mutations until migration phases replace them

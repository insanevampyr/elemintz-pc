# AGENTS.md

## 1. Project Overview
EleMintz is a desktop card game built with Electron. The codebase is structured so core gameplay logic lives in the engine layer, while renderer/UI handles presentation and interaction only. State and persistence are managed through the state layer and IPC.

## 2. Core Game Rules
- Elements: Fire, Water, Earth, Wind.
- Element beat rules:
  - Fire beats Earth
  - Earth beats Wind
  - Wind beats Water
  - Water beats Fire
- If both players play the same element card, a WAR is triggered.
- WAR continues under engine rules until a winner is resolved.

## 3. Starting Hand Rules
- Each player must start with exactly 8 cards total.
- Exact per-player starting distribution:
  - 2 Fire
  - 2 Water
  - 2 Earth
  - 2 Wind
- Both players start with identical balanced composition.

## 4. Architecture Rules
- Maintain layered architecture:
  - Game Engine (pure rules and match resolution)
  - Application State (profiles, saves, settings, stats)
  - Renderer/UI (screens, visuals, input)
  - Platform/Main (Electron app lifecycle, IPC, preload)
- Changes should preserve clear layer boundaries and explicit data flow.

## 5. Engine vs UI Separation
- Renderer/UI must never contain gameplay logic.
- Engine must not depend on DOM, renderer state, or Electron APIs.
- UI interacts with gameplay only through controller/system boundaries.
- Match rules, round resolution, WAR behavior, and card handling must stay in engine modules.

## 6. AI Fairness Rule
- AI must never know the player's current selected card before choosing its own card for that round.
- Remove/avoid any current-round leakage inputs (for example, passing the player's selected card into AI selection for the same round).
- AI may use:
  - Difficulty setting
  - Randomness
  - Prior round history
  - Remaining hand composition

## 7. Persistence Rules
- Persistence must use Electron userData paths only.
- Runtime data location should be under user profile storage (for example, `app.getPath("userData") + /elemintz-data`).
- Do not write runtime save data to protected OS directories (such as `System32`) or source-controlled project directories.
- Profile/save/settings operations must be resilient to missing directories/files.

## 8. Card Conservation Rule
- Card counts must remain consistent at all times.
- Every round must preserve total card count across both hands plus active pile.
- WAR resolution must preserve card conservation.
- Any change that can alter card movement must keep this invariant intact.

## 9. UI Guidelines
- UI should present state from controllers/view-models, not compute game outcomes.
- Keep screens modular (login, menu, game, profile, settings).
- Keep asset usage data-driven (paths/helpers/catalog), so visuals can be swapped without gameplay changes.
- UI polish changes should avoid touching engine/state logic unless explicitly required.

## 10. Safe Change Rules
- Prefer narrow, targeted fixes over broad refactors.
- Do not modify unrelated systems when addressing a scoped issue.
- Diagnose with explicit runtime evidence before changing behavior.
- Preserve existing architecture and avoid introducing cross-layer coupling.

## 11. Testing Expectations
- Update/add tests for any rule, distribution, fairness, persistence, or flow change.
- Keep regression coverage for:
  - Element rule outcomes
  - WAR behavior
  - Match conservation
  - Starting hand distribution
  - AI fairness constraints
  - State persistence integration
- Do not bypass failing tests; fix root causes.

## 12. Current Known Working Features
- Engine modules implemented (`rules`, `deck`, `war`, `match`, `ai`).
- Match creation starts each side with balanced 8-card hands (2 per element).
- WAR handling and capture flow integrated into match history.
- AI selection path fixed to avoid current-round player-card leakage.
- State layer implemented (`profileSystem`, `saveSystem`, `settingsService`, stats derivation, coordinator).
- Renderer screen flow implemented with screen/modal managers and controllers.
- Asset-based card backs/backgrounds/sound hooks integrated.
- Tests currently pass for engine/state/game-controller fairness coverage.

## 13. Development Priorities
1. Preserve gameplay correctness and fairness invariants.
2. Preserve persistence reliability and writable path guarantees.
3. Keep engine/UI separation strict.
4. Maintain and expand automated test coverage for changed behavior.
5. Favor incremental, reviewable changes over large rewrites.

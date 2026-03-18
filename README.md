# EleMintz PC

Engine-first desktop card game scaffold based on the build specification.

## Layers

- `src/engine`: pure game logic (`rules`, `deck`, `war`, `match`, `ai`)
- `src/state`: profile, save, stats, settings, JSON persistence coordination
- `src/renderer`: UI shell and presentation modules
- `src/main` + `src/preload`: Electron platform layer + IPC bridge
- `data`: local persistence files (`profiles.json`, `saves.json`, `settings.json`)

## Commands

- `npm install`
- `npm test`
- `npm start`

## Current status

- Project scaffold created
- Engine modules implemented and exported
- Application state layer implemented and connected to match results
- IPC bridge added for renderer state operations
- Unit tests passing for engine and state layers

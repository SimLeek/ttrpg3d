# ttrpg3d roadmap

Full migration off Godot 4.6 + `godot_voxel` to a browser-native stack:
**noa-engine (Babylon.js)** client + **Colyseus (Node.js)** server, porting
the old game's systems from `/home/simleek/gamedev/ttrpg-3d` one by one --
same rules/content, different implementation throughout. This doc is the
scannable phase list + standing decisions; it's not a narrative history.

## Standing decisions

- **No anti-cheat / physics verification.** Client owns its own movement
  sim and reports position; the server's job is persistence, broadcast,
  and DM-permission gating -- not re-validating moves.
- **Persistence**: one real file per world. Accounts/worlds-registry
  metadata is a plain JSON file (`packages/server/src/data/store.ts`);
  per-world voxel chunks are `node:sqlite`
  (`packages/server/src/world/storage.ts`) -- `better-sqlite3` was tried
  first and its native build failed outright in this sandbox; `node:sqlite`
  needs no native build at all and ships with Node itself. Sparse-diff
  model: only edited chunks are ever stored, unmodified terrain always
  regenerates from the generator + seed.
- **Auth**: dev-only named accounts, no passwords/OAuth yet. `root` is a
  seeded implicit superuser (sees/admins every world). Real login is its
  own later research track.
- **Networking**: Colyseus rooms, one room instance per world
  (`WorldRoom.filterBy(['worldId'])`). Raw binary messages for chunk
  streaming/voxel edits; `@colyseus/schema` Schema state for player
  transforms. REST for the lobby API goes through Colyseus's own
  `createEndpoint`/`createRouter` (`@colyseus/better-call`), not Express.
- **Mods are per-world**, not platform-wide -- each world's metadata
  records which mods it has enabled; registration happens per-`WorldRoom`
  instance, not once globally at server boot.
- **Testing split**: `@colyseus/testing` for server/room logic (the
  successor to the old `dev_console.gd` command-queue pattern), real
  Vitest unit tests for pure logic with no 3D/physics involved, and actual
  playtesting (not automated tests) for movement feel, UI, and anything
  else that needs a human's judgment.

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Scaffolding -- monorepo, client/server hello-world | DONE |
| 1 | Testing infra (`@colyseus/testing`, Vitest) + Docker | DONE |
| 2 | MVP -- full movement port, floating-origin shift, chunk streaming | DONE |
| -- | Worlds lobby (accounts, per-world registry, fuzzy search) -- pulled forward from Phase 4 | DONE |
| 3 | Low-risk data/math ports -- `game_settings` distance math, `full_period_lcg`, `spatial_hash_3d`, voxel type catalog | NOT STARTED |
| 4 | Real world management | **PARTIAL** -- per-world voxel storage + basic place/break DONE; real hilly terrain generator and DM world-create/admin-grant UI still open |
| 5 | Voxel interaction -- `voxel_interactor.gd` full multi-block placement, hand-equipment dispatch rework, soft-body-library swap for `blob_body_3d.gd` | NOT STARTED |
| 6 | Inventory/items -- catalog + hotbar, server-authoritative item actions | NOT STARTED |
| 7 | Mod system v2 -- per-world data-only mod registration | NOT STARTED |
| 8 | DM tools -- world CRUD UI, structure saver/placer, draw tools | NOT STARTED |
| 9 | Lighting + voxel tick system -- needs fresh design, not a port (see `docs/PORTING_CHECKLIST.md`) | NOT STARTED |
| 10 | Battle mode / turn tracker, server-authoritative | NOT STARTED |
| 11 | NPC/AI -- WANDER/CHASE/ATTACK state machine, FOV/LOS (vision-cone *rendering* deferred further) | NOT STARTED |
| 12+ | Polish -- remaining UI, chunk-streaming perf, mod-ecosystem hardening, Google/OAuth + payments research | NOT STARTED |

Per-file porting decisions (port/redesign/drop/defer for every old `.gd`
file) live in `docs/PORTING_CHECKLIST.md`, not here.

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

**Sequenced by playtest visibility, not by risk/dependency order.** An
earlier version of this table had a standalone "low-risk data/math ports"
phase up front, on the theory that zero-dependency pure functions are easy
wins to bank early -- in practice that was backwards: those functions (an
LCG, a spatial hash, distance math, the voxel type table) are *inputs* to
later systems, invisible and unverifiable on their own until something
actually uses them. Each now ships as part of the phase that makes it show
up during play (see `docs/PORTING_CHECKLIST.md` for exactly where).

| # | Phase | Status |
|---|---|---|
| 0 | Scaffolding -- monorepo, client/server hello-world | DONE |
| 1 | Testing infra (`@colyseus/testing`, Vitest) + Docker | DONE |
| 2 | MVP -- full movement port, floating-origin shift, chunk streaming | DONE |
| -- | Worlds lobby (accounts, per-world registry, fuzzy search) -- pulled forward from Phase 3 | DONE |
| 3 | Real world management -- real hilly terrain generator + voxel type catalog, DM world-create/admin-grant UI | **PARTIAL** -- per-world voxel storage + basic place/break DONE |
| 4 | Voxel interaction -- `voxel_interactor.gd` full multi-block placement, hand-equipment dispatch rework, soft-body-library swap for `blob_body_3d.gd` | NOT STARTED |
| 5 | Inventory/items -- catalog + hotbar, server-authoritative item actions | NOT STARTED |
| 6 | Mod system v2 -- per-world data-only mod registration | NOT STARTED |
| 7 | DM tools -- world CRUD UI, structure saver/placer, draw tools | NOT STARTED |
| 8 | Lighting + voxel tick system -- needs fresh design, not a port; also where the LCG + spatial hash land, if/when actually needed | NOT STARTED |
| 9 | Battle mode / turn tracker, server-authoritative -- also where the distance math lands | NOT STARTED |
| 10 | NPC/AI -- WANDER/CHASE/ATTACK state machine, FOV/LOS (vision-cone *rendering* deferred further) | NOT STARTED |
| 11+ | Polish -- remaining UI, chunk-streaming perf, mod-ecosystem hardening, Google/OAuth + payments research | NOT STARTED |

Per-file porting decisions (port/redesign/drop/defer for every old `.gd`
file) live in `docs/PORTING_CHECKLIST.md`, not here.

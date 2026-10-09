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
- **Core/mod boundary.** This project's actual pitch is "roll20 for any
  tabletop system," not one fixed ruleset -- so gameplay RULES (combat,
  health, movement feel, respawn policy) need to be swappable per world,
  not hardcoded. Settled shape, confirmed through real design discussion
  (not aspirational):
  - **Core (engine infrastructure, never a mod):** voxel storage/
    streaming/sync/persistence, accounts/world registry, the rendering
    plumbing (atlas/shader registration *mechanism*, not any specific
    shader), and the mod-registration seams themselves (e.g.
    `MovementProvider`, `packages/client/src/movement/MovementProvider.ts`
    -- the interface is core, what implements it isn't).
  - **Core primitives + mod/default-policy calling them:** a few systems
    split cleanly this way -- the *functions* are core, *when/who calls
    them* is policy. Respawn: `PlayerController.teleportTo` + the
    world-bottom crossing-detector (`worldBottomCatch.ts`) are core;
    deciding Shift+R manually respawns anyone and only an admin can set an
    anchor (`respawnControl.ts`) is the one fixed default policy today
    (not yet a swappable object -- revisit once a second policy actually
    needs to differ). GM powers: a core, always-available admin-override
    escape hatch (`gmOverride.ts`, gated on `PlayerState.isAdmin` --
    reuses `store.ts`'s existing owner/admin/root model, nothing new
    invented there) is core since every ruleset needs *some* GM safety
    valve; the SPECIFIC powers bundled behind it today (fly, pass through
    terrain, instant build/delete -- no "immortal", nothing to mean that
    against yet, Phase 5 is NOT STARTED) are the default, not yet a
    swappable set.
  - **Default-mod territory (ships out of the box, meant to become
    swappable once Phase 6 exists):** movement feel beyond the core
    walk/jump/fall/swim baseline (`CoreMovementProvider`) -- flying,
    noclip, wall-jump, ledge-grab are all separate `MovementProvider`
    implementations layered on the same seam, not special-cased into
    `PlayerController.ts`. Combat/health (deliberately NOT a port of the
    old game's stamina/health system -- that was built for a stealth
    platformer, not a TTRPG; a real character-sheet-based model is new
    design, Phase 5). Inventory rules (DM-vs-player stock split, equip
    schemes).
  - **Not built yet, explicitly deferred:** making the default-mod
    territory above actually swappable at runtime (dynamic loading,
    per-world config, in-game toggle UI) is Phase 6's full scope, not
    assumed done just because the seam exists.

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
| 3 | Real world management -- real hilly terrain generator + voxel type catalog, DM world-create/admin-grant UI | **PARTIAL** -- per-world voxel storage + basic place/break + real hilly terrain generator (textures, caves, ore, trees, foliage) DONE; DM world-create/admin-grant UI remains |
| 4 | Voxel interaction -- `voxel_interactor.gd` full multi-block placement, hand-equipment dispatch rework, soft-body-library swap for `blob_body_3d.gd` | **PARTIAL** -- real hotbar + full inventory grid + multi-block-type placement (with real icons, a self-overlap placement guard, and a minimal input-capture layer), third-person zoom + universal xray-cutout shader + real water/quartz transparency + swimming, the core/mod-boundary movement-provider refactor (`CoreMovementProvider`/`NoclipFlyProvider`, `phasing_gloves_item.gd`/`wings_item.gd`'s fly/noclip ported as the first real non-core provider) DONE; dual-hand equip/hand-equipment dispatch, soft-body swap, health/fall-damage, and squeezer-rays remain |
| 5 | Inventory/items -- catalog + hotbar, server-authoritative item actions | **PARTIAL** -- catalog + hotbar DONE (pulled forward, see Phase 4); character-sheet-based combat/health (a fresh design, NOT a port of the old game's stealth-platformer stamina/health system) and the DM-vs-player inventory split remain |
| 6 | Mod system v2 -- per-world data-only AND behavior-mod registration (see Standing decisions' core/mod boundary) | **PARTIAL** -- the minimal `MovementProvider` seam + GM admin-override escape hatch + respawn core primitives exist (core/mod-boundary PR); dynamic mod loading/packaging, in-game mod-toggle UI, per-world persisted mod config, and widening the voxel wire format past 255 ids all remain |
| 7 | DM tools -- world CRUD UI, structure saver/placer, draw tools | NOT STARTED |
| 8 | Lighting + voxel tick system -- needs fresh design, not a port; also where the LCG + spatial hash land, if/when actually needed | NOT STARTED |
| 9 | Battle mode / turn tracker, server-authoritative -- also where the distance math lands | NOT STARTED |
| 10 | NPC/AI -- WANDER/CHASE/ATTACK state machine, FOV/LOS (vision-cone *rendering* deferred further) | NOT STARTED |
| 11+ | Polish -- remaining UI, chunk-streaming perf, mod-ecosystem hardening, Google/OAuth + payments research | NOT STARTED |

Per-file porting decisions (port/redesign/drop/defer for every old `.gd`
file) live in `docs/PORTING_CHECKLIST.md`, not here.

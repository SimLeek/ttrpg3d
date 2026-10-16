# ttrpg3d roadmap

Full migration off Godot 4.6 + `godot_voxel` to a browser-native stack:
**noa-engine (Babylon.js)** client + **Colyseus (Node.js)** server, porting
the old game's systems from `/home/simleek/gamedev/ttrpg-3d` one by one --
same rules/content, different implementation throughout. This doc is the
scannable phase list + standing decisions; it's not a narrative history --
finished-work detail and bug postmortems live in
[`docs/COMPLETED.md`](COMPLETED.md), linked from here where relevant.

## MVP goal

**A working online multiplayer 3D voxel VTT ("roll20 for any tabletop
system").** This is the actual north star, not the phase table below --
the phase table is sequenced by playtest visibility (what's easiest to
verify next), which is a useful execution tactic but NOT the same thing
as priority. Called out explicitly (2026-10-15 user correction) after the
phase table drifted into picking small, easy-to-verify leftovers
(movement-provider polish, admin-grant UI, a procedural skybox) while
the actual MVP-blocking work sat untouched. None of this existed even as
a real design in the old game -- its own TODO docs only ever floated
"character actions... maybe via a character-sheet mod" as an unbuilt
idea (`TODO_modding_and_worlds.md`), confirmed by reading it directly.
This is genuinely new, foundational design work, scoped via direct user
discussion (2026-10-15), in dependency order:

0. ~~**Chat + dice rolling**~~ -- **DONE** (2026-10-15, see
   [COMPLETED.md](COMPLETED.md#mvp-goal-item-0--chat--dice-rolling) for
   the full implementation). The `[[notation+var]]` character-sheet
   variable reference specifically is NOT done -- character sheets
   (item 1 below) don't exist yet; `[[...]]` today only evaluates plain
   dice notation, no variable interpolation.
1. **Character sheets** -- the actual VTT-core data model (per-system
   stats, not the old game's stealth-platformer health/stamina). Blocks
   real combat, blocks anything "roll20-like" being true of this
   project yet. Scoped shape:
   - **Mod-system-based templates**: a Game picks/configures a
     character-sheet template the same way it already picks a world
     generator -- NOT one hardcoded schema, since the pitch is "roll20
     for any tabletop system."
   - Template authored in a safe markup format (markdown/RST-like,
     supports images) -- never raw HTML/script injection.
   - **Paginated, typed variable system**: a sheet has N pages, each
     with any number of named/typed variables. Input widget follows the
     type: a wide numeric range gets a scrollbar/slider; a fractional or
     x-of-y value (e.g. current/max HP) gets two boxes; a plain single
     value gets one box.
   - **A safe/sandboxed scripting system** for calculated variables
     (e.g. a derived modifier) and RNG-driven attacks that auto-roll and
     post to the chat above.
   - **Ownership: per-USER (account), not per-game.** A character is
     portable across games by construction, rather than needing an
     export/import step between two games.
   - **Importing** is also mod-based: rather than bespoke native parsers
     for every external format (Excel sheets from paid westmarches
     servers, Roll20/Foundry JSON exports, etc.), the import mechanism
     itself is a pluggable mod interface -- a handful of built-in
     importer mods to start, swappable/extensible later.
2. **Character 3D token representation** -- keep the old game's real
   billboard dialog system for NPC dialog (`billboard` system, direct
   port); add HP/MP/etc. bars shown on the token itself (new, no old
   equivalent); right-click your own character (zoomed out, or after
   Esc) opens a dialog to edit that 3D token's own details.
3. **Full panel UI chrome**, each side collapsible/draggable outward from
   its own edge. Sized by actual information density (2026-10-15,
   corrected from an earlier draft of this same list): chat (right) is
   OUTERMOST and gets the most room, since it's the most important/
   highest-volume panel; top and bottom panels are mid-sized; left
   (mode select) is INNERMOST and smallest, since there are only a
   handful of core modes to switch between, freeing space for the
   higher-value panels elsewhere.
   - **Right (outermost): chat** (item 0 above).
   - **Left (innermost): mode selection**, including an upgraded version
     of the old game's real 3D yellow-line distance/battle-mode overlay
     -- with a way to explicitly FINALIZE a measurement and start a new
     one, not just end-turn to reset it (the old game only had the
     latter).
   - **Bottom (mid): party list** -- clicking a player's icon snaps the
     camera to them and shows them through terrain (an x-ray highlight
     for that specific character, distinct from the existing per-player
     near-camera xray-cutout effect).
   - **Top (mid): quick actions**, defined by the character sheet's own
     template (item 1 above).
4. **A turn-based battle system**, more detailed than the old Godot
   game's (which deliberately didn't even enforce turn order -- see
   Phase 9 below) -- its own UI lives inside the left mode-select panel
   (item 3 above) and it integrates with chat/dice (item 0) and
   character sheets (item 1), so it's sequenced after all three.

Everything else currently sequenced into Phase 2/3/4/6/7/8/10/11+ below
is real, worth doing, and NOT dropped -- but it's supporting/polish work
relative to 0-4 above, not a substitute for them. When picking what to
work on next, default to advancing 0-4 in order unless there's a
specific reason (a live-reported bug, a small blocking dependency) to
detour.

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
  seeded implicit superuser (sees/admins every game). Real login is its
  own later research track.
- **Games contain Worlds**: a roll20-style "campaign contains multiple
  pages" model. `Game` is the top-level owned/administered unit the lobby
  lists/creates; `World` is a page WITHIN a game, created/switched from an
  in-game admin-gated panel, not the lobby -- it carries no owner/admin of
  its own, permissions resolve through its parent game. No cross-client
  page-sync yet (each client switches its own view independently) -- see
  [COMPLETED.md](COMPLETED.md#standing-decisions--background) for the
  full background/file references.
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
  not hardcoded. Settled shape (full background/file references in
  [COMPLETED.md](COMPLETED.md#standing-decisions--background)):
  - **Core (engine infrastructure, never a mod):** voxel storage/sync/
    persistence, accounts/world registry, rendering plumbing, and the
    mod-registration seams themselves (e.g. `MovementProvider`) -- the
    interface is core, what implements it isn't.
  - **Core primitives + mod/default-policy calling them:** respawn
    (`PlayerController.teleportTo`/`worldBottomCatch.ts` are core; who
    calls them is policy) and GM powers (the admin-override escape hatch
    is core; the specific powers bundled behind it are the default, not
    yet swappable) both split this way.
  - **Default-mod territory**, meant to become swappable once Phase 6
    exists: movement feel beyond the core walk/jump/fall/swim baseline,
    combat/health (a fresh character-sheet design, NOT a port of the old
    stealth-platformer stamina/health system), inventory rules.
  - **Not built yet:** making default-mod territory actually swappable
    at runtime (dynamic loading, per-world config, toggle UI) is Phase
    6's full scope, not assumed done just because the seam exists.
- **Default world generator**: `DEFAULT_GENERATOR_ID` (`packages/shared/
  src/worldGenerators.ts`) is `"plains"`, not `"hilly"` -- a 2026-10-11,
  aesthetics/marketability-driven decision confirmed against real
  reference screenshots (both catalog entries stay fully selectable; see
  [COMPLETED.md](COMPLETED.md#phase-3--real-world-management) for the
  detail).

## Phases

**Sequenced by playtest visibility within a phase, not by cross-phase
priority** -- see the MVP goal above for actual priority; don't read this
table top-to-bottom as a todo-list order. An earlier version of this
table had a standalone "low-risk data/math ports" phase up front, on the
theory that zero-dependency pure functions are easy wins to bank early --
in practice that was backwards: those functions (an LCG, a spatial hash,
distance math, the voxel type table) are *inputs* to later systems,
invisible and unverifiable on their own until something actually uses
them. Each now ships as part of the phase that makes it show up during
play (see `docs/PORTING_CHECKLIST.md` for exactly where).

| # | Phase | Status | Remaining |
|---|---|---|---|
| 0 | Scaffolding -- monorepo, client/server hello-world | DONE | -- |
| 1 | Testing infra (`@colyseus/testing`, Vitest) + Docker | DONE | -- |
| 2 | MVP -- full movement port, floating-origin shift, chunk streaming | **PARTIAL** | wall-jump/ledge-grab/stair-stepper `MovementProvider`s |
| -- | Worlds lobby (accounts, per-world registry, fuzzy search) -- pulled forward from Phase 3 | DONE | -- |
| 3 | Real world management -- generator catalog, DM world-create/admin-grant UI | **PARTIAL** | structure/windmill generator ports, procedural skybox, admin-GRANT UI, old-world import |
| 4 | Voxel interaction -- multi-block placement, hand-equipment dispatch, soft-body swap | **PARTIAL** | dual-hand equip/dispatch, soft-body library spike, health/fall-damage, squeezer-rays, phasing-gloves-as-an-item |
| 5 | Inventory/items -- catalog + hotbar, server-authoritative item actions | **PARTIAL** | **⭐ MVP: character sheets** -- full scope (mod-based templates, per-user ownership, pluggable import) in the MVP goal section above, item 1; chat/dice (item 0) comes first; combat/health is built on this once it exists; DM-vs-player stock split, item tooltip, dual-hand equip scheme |
| 6 | Mod system v2 -- per-world data-only AND behavior-mod registration | **PARTIAL** | dynamic mod loading/packaging, in-game toggle UI, per-world persisted config, Uint16 wire-format widening |
| 7 | DM tools -- world CRUD UI, structure saver/placer, draw tools | NOT STARTED | everything |
| 8 | Lighting + voxel tick system -- needs fresh design, not a port; also where the LCG + spatial hash land, if/when actually needed | NOT STARTED | everything |
| 9 | **⭐ MVP: Battle mode / turn tracker, server-authoritative, more detailed than the old game's** -- also where the distance math lands; full scope (item 4 in the MVP goal section above) depends on chat/dice, character sheets, and the panel UI chrome (items 0-3) existing first | NOT STARTED | everything |
| 10 | NPC/AI -- WANDER/CHASE/ATTACK state machine, FOV/LOS (vision-cone *rendering* deferred further) | NOT STARTED | everything |
| 11+ | Polish -- remaining UI, chunk-streaming perf, mod-ecosystem hardening, Google/OAuth + payments research | NOT STARTED | everything |

Per-file porting decisions (port/redesign/drop/defer for every old `.gd`
file) live in `docs/PORTING_CHECKLIST.md` (open items only); finished work
is in `docs/COMPLETED.md`.

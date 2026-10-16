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
   project yet. **Real dependency found via direct discussion
   (2026-10-16), splits this item into two sub-phases that do NOT build
   in top-to-bottom order** -- the token/billboard visuals (item 2
   below) are what a player actually SEES first, the instant they load
   into a game, before any character-sheet UI is ever opened; they only
   need a small DATA CONTRACT (owner, a token/model reference, HP/MP
   current+max, status effects), not the full authoring system below.
   So **1a ships before item 2; 1b ships after item 2**, not before it:
   - **1a (build FIRST, minimal -- unblocks item 2)**: a minimal
     per-user Character record: `ownerAccountId`, a reference to that
     character's token/model (what item 2 actually renders), HP
     current/max, MP current/max (or whatever stat pair a system
     needs), a status-effect list. Fixed shape for now, not yet the
     mod-based template below -- just enough real data for item 2's
     bars/billboard to bind to instead of inventing placeholder state.
   - **1b (the rest -- the full authoring system, ships AFTER item 2)**:
     - **Mod-system-based templates**: a Game picks/configures a
       character-sheet template the same way it already picks a world
       generator -- NOT one hardcoded schema, since the pitch is
       "roll20 for any tabletop system."
     - Template authored in a safe markup format (markdown/RST-like,
       supports images) -- never raw HTML/script injection.
     - **Paginated, typed variable system**: a sheet has N pages, each
       with any number of named/typed variables. Input widget follows
       the type: a wide numeric range gets a scrollbar/slider; a
       fractional or x-of-y value (e.g. current/max HP) gets two boxes;
       a plain single value gets one box. (1a's HP/MP pair is the
       first real instance of the "x-of-y" case -- 1b's general
       variable system should subsume it, not duplicate it.)
     - **A safe/sandboxed scripting system** for calculated variables
       (e.g. a derived modifier) and RNG-driven attacks that auto-roll
       and post to the chat above.
     - **Ownership: per-USER (account), not per-game** (already true of
       1a's minimal record too). A character is portable across games
       by construction, rather than needing an export/import step
       between two games.
     - **Importing** is also mod-based: rather than bespoke native
       parsers for every external format (Excel sheets from paid
       westmarches servers, Roll20/Foundry JSON exports, etc.), the
       import mechanism itself is a pluggable mod interface -- a
       handful of built-in importer mods to start, swappable/
       extensible later.
2. **Character 3D token representation** -- depends ONLY on item 1a
   above (the minimal record), not 1b. Scope, including new interaction
   requirements from direct discussion (2026-10-16):
   - Keep the old game's real billboard dialog system for NPC dialog
     (`billboard` system, direct port).
   - **HP/MP/etc. bars** shown on the token's billboard (new, no old
     equivalent) -- READ from 1a's character record, never duplicated
     local state; editing a bar writes back to that same record (see
     the click-to-edit requirement below).
   - **NEW -- status-effect icon billboard**: an additional billboard
     element, placed above the HP/MP/etc. bars, showing one equal-sized
     icon per active status effect (32x32 raster or SVG), fit into a
     256-wide row that wraps and expands UPWARD as more icons are
     added (so it grows away from the bars below it, not over them).
   - **NEW -- raycast/hover interactions**:
     - Hovering an HP/MP bar shows its exact current/max value.
     - Clicking a bar lets you edit the CURRENT value by typing a
       number, rather than any other input method (drag, click-to-
       increment, etc.).
     - Hovering a token you own (can edit) highlights it.
     - Left-click on your own token is a no-op for now. **Deferred,
       NOT this phase**: double-click switches which character you're
       currently controlling/viewing from, for a user who owns more
       than one character.
     - Right-click opens a context menu on that token:
       **"Open character sheet"** (1b, once it exists), **"Edit token
       properties"** (replaces this item's own earlier single-action
       "right-click opens an edit dialog" bullet -- now one of several
       menu choices, not the only thing right-click does), **"Select
       status effects"** (edits the list the icon billboard above
       renders).
   - The party-list panel's existing placeholder avatars (already
     shipped, `docs/COMPLETED.md`'s panel-UI-chrome entry) should
     switch to each player's real token image once 1a's record exists
     -- same dependency as the separate "switch avatar by selecting a
     character in chat" follow-up already noted below, just the
     simpler "show the token you already have" half of it.
3. ~~**Full panel UI chrome**~~ -- **DONE** (2026-10-16, see
   [COMPLETED.md](COMPLETED.md#mvp-goal-item-3--panel-ui-chrome) for
   the full implementation) for the chrome itself: all 4 panels exist
   and are correctly positioned/collapsible/resizable. Still open within
   this item:
   - The mode panel's **Distance-measurement/Turn-tracker buttons are
     intentionally stubbed** (visible, disabled, no logic) -- their
     real behavior (the old game's real 3D yellow-line distance/battle-
     mode overlay, upgraded with an explicit FINALIZE-and-restart
     action instead of just end-turn-to-reset) is Phase 9 (item 4
     below), not built yet.
   - **Party-list click-to-focus is NOT built**: clicking a player's
     icon to snap the camera to them and show them through terrain (an
     x-ray highlight for that specific character, distinct from the
     existing per-player near-camera xray-cutout effect) -- the panel
     today only displays who's present, with a generic placeholder
     avatar per player, no click interaction yet.
   - **NEW follow-up, explicitly scoped as not-this-PR** (user request,
     2026-10-16): once characters exist (item 1a's minimal record is
     enough for this, not all of 1b), a user should be able to SELECT
     which character they're currently playing via a chat command/UI
     (from their own list of characters), and their party-list avatar
     should switch to reflect that selected character's real token
     image -- "a lot for right now," depends on 1a + item 2 (the token
     image itself) existing first.
   - Quick actions (top panel) is built but still genuinely empty --
     content is item 1b's own character-sheet-template scope, not this
     item's.
4. **A turn-based battle system**, more detailed than the old Godot
   game's (which deliberately didn't even enforce turn order -- see
   Phase 9 below) -- its own UI lives inside the left mode-select panel
   (item 3 above) and it integrates with chat/dice (item 0) and the
   full character-sheet system (item 1b specifically -- real stats to
   act on, not just 1a's minimal record), so it's sequenced after chat,
   tokens, and the full character-sheet system all exist.
5. **Default blocks as a real mod** -- pull the current built-in voxel
   type catalog (`packages/shared/src/voxelTypes.ts`'s `VOXEL_TYPES`,
   hardcoded in the shared package) out into an actual mod file. Full
   scope in `docs/PORTING_CHECKLIST.md`'s Phase 6. Operationalizes a
   design principle this project has carried since Phase 6 was first
   scoped but never actually enforced.
6. **Default terrain generators as a real mod** -- same treatment for
   the current built-in generator catalog
   (`packages/shared/src/worldGenerators.ts`'s hilly/plains/
   limestone_slab). Full scope in `docs/PORTING_CHECKLIST.md`'s Phase 6.
   Together with item 5, this is also what makes item 1b's "a Game
   picks a character-sheet template the same way it already picks a
   world generator" literally true (today's generator "picking" is
   just a hardcoded 3-entry catalog, not a real mod file) rather than
   just an analogy.
7. **Mod-management settings tab, inside the chat panel** (user
   request, 2026-10-16) -- a Game's set of included mod files
   (including items 5/6's default mods, and eventually character-sheet-
   template mods) is configured from a new settings tab inside the
   already-shipped chat panel (item 0), not hand-edited JSON. Full
   scope in `docs/PORTING_CHECKLIST.md`'s Phase 6 -- this is also the
   first real consumer of "a Game includes these mod files," which
   items 5/6 need to actually be selectable/deselectable per game, not
   just technically extracted.

Everything else currently sequenced into Phase 2/3/4/7/8/10/11+ below
is real, worth doing, and NOT dropped -- but it's supporting/polish work
relative to 0-7 above, not a substitute for them (Phase 6 itself is now
fully covered by items 5-7). When picking what to work on next, default
to advancing 0-7 in order, WITH ONE EXCEPTION (2026-10-16 correction):
item 1 is split into 1a/1b, and 1a interleaves with item 2 rather than
finishing first -- 1a, then item 2, then 1b, not 1 (whole) then 2.
Detour for any other specific reason (a live-reported bug, a small
blocking dependency) as before.

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
| 5 | Inventory/items -- catalog + hotbar, server-authoritative item actions | **PARTIAL** | **⭐ MVP: character sheets** -- full scope in the MVP goal section above, item 1, split into two sub-phases that do NOT build in order: 1a (a small data contract -- owner, token reference, HP/MP, status effects) ships BEFORE item 2 (tokens/billboards, which only need 1a); 1b (the full mod-based-template/scripting/import authoring system) ships AFTER item 2. Chat/dice (item 0) comes first either way; combat/health is built on 1b once it exists; DM-vs-player stock split, item tooltip, dual-hand equip scheme |
| 6 | **⭐ MVP: Mod system v2** -- per-world data-only AND behavior-mod registration | **PARTIAL** | full scope now covered by the MVP goal section's items 5-7 above: default-blocks mod, default-generators mod, mod-management settings tab in the chat panel; also dynamic mod loading/packaging, per-world persisted config, Uint16 wire-format widening |
| 7 | DM tools -- world CRUD UI, structure saver/placer, draw tools | NOT STARTED | everything |
| 8 | Lighting + voxel tick system -- needs fresh design, not a port; also where the LCG + spatial hash land, if/when actually needed | NOT STARTED | everything |
| 9 | **⭐ MVP: Battle mode / turn tracker, server-authoritative, more detailed than the old game's** -- also where the distance math lands; full scope (item 4 in the MVP goal section above) depends on chat/dice, character sheets, and the panel UI chrome (items 0-3) existing first | NOT STARTED | everything |
| 10 | NPC/AI -- WANDER/CHASE/ATTACK state machine, FOV/LOS (vision-cone *rendering* deferred further) | NOT STARTED | everything |
| 11+ | Polish -- remaining UI, chunk-streaming perf, mod-ecosystem hardening, Google/OAuth + payments research | NOT STARTED | everything |

Per-file porting decisions (port/redesign/drop/defer for every old `.gd`
file) live in `docs/PORTING_CHECKLIST.md` (open items only); finished work
is in `docs/COMPLETED.md`.

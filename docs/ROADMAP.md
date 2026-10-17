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
   (item 3 below) don't exist yet; `[[...]]` today only evaluates plain
   dice notation, no variable interpolation.
1. ~~**Minimal character record**~~ -- **DONE** (2026-10-16, see
   [COMPLETED.md](COMPLETED.md#mvp-goal-items-1-2--minimal-character-record--3d-token-representation)
   for the full implementation).
2. ~~**Character 3D token representation**~~ -- **DONE** (2026-10-16,
   same COMPLETED.md entry as item 1 -- built together per explicit
   request). Still open within this item:
   - **Context-menu actions are placeholders, not real implementations**
     (real feedback, 2026-10-16: "that edit token properties... well
     they're placeholders tbh"). "Edit token properties" is just a raw
     color swatch (no name/other property editing); "Select status
     effects" is a hardcoded 3-entry catalog (poison/stun/blessed), not
     a real mod-based status-effect catalog/definitions system; "Open
     character sheet" is correctly disabled (item 3 doesn't exist yet)
     but needs wiring once it does. None of these were meant to be the
     final UI -- revisit once item 3's mod-template system exists to
     build real versions on top of, rather than extending the
     placeholders in place.
   - **Ownership check is too literal, needs a real admin/GM override**
     (real feedback, 2026-10-16: "I can't select root's bob from
     another tab though I can select if it's the same character... I
     think [we need] better ownership check (maybe game.owned_by or
     something)"). Today's `owned` predicate (`net.ts`) is a flat
     `token.characterId === myResolvedCharacterId()` -- it only ever
     matches the EXACT character a session itself joined with, so a
     second session on the SAME account (another tab, same character)
     can interact with it, but a game's actual owner/admin can't select
     or edit anyone else's token at all, even though `WorldRoom.ts`'s
     `setCharacterStat`/`setStatusEffects`/`setCharacterToken` handlers
     ALREADY admin-gate correctly server-side (same pattern as
     `setRespawnAnchor`'s existing GM admin-override escape hatch). The
     gap is purely client-side: `pickOwnedToken`/`pickHoveredStatBar`
     should also treat a hover/click as valid when `gmOverride.isActive()`
     (or a plain `isWorldAdmin` check, already resolved at join and
     available as `PlayerState.isAdmin`) is true for the local session,
     not just on an exact characterId match.
   - **Party-list real token colors**: DONE as part of this item
     (`partyListPanel.ts` now renders each player's real
     `PlayerPresence.tokenColor` instead of a placeholder initial). The
     separate "switch avatar by selecting a character in chat" follow-up
     noted under item 4 below is still not built -- that's about
     CHANGING which character a session is playing mid-session, not
     just displaying the one it already has.
3. **Full character-sheet authoring system** -- ships AFTER item 2
   (not before it -- see item 1's own note on why). The actual
   VTT-core data model (per-system stats, not the old game's stealth-
   platformer health/stamina). Blocks real combat, blocks anything
   "roll20-like" being true of this project yet. Scoped shape:
   - **Mod-system-based templates**: a Game picks/configures a
     character-sheet template the same way it already picks a world
     generator -- NOT one hardcoded schema, since the pitch is "roll20
     for any tabletop system."
   - Template authored in a safe markup format (markdown/RST-like,
     supports images) -- never raw HTML/script injection.
   - **Paginated, typed variable system**: a sheet has N pages, each
     with any number of named/typed variables. Input widget follows the
     type: a wide numeric range gets a scrollbar/slider; a fractional
     or x-of-y value (e.g. current/max HP) gets two boxes; a plain
     single value gets one box. (Item 1's HP/MP pair is the first real
     instance of the "x-of-y" case -- this general variable system
     should subsume it, not duplicate it.)
   - **A safe/sandboxed scripting system** for calculated variables
     (e.g. a derived modifier) and RNG-driven attacks that auto-roll and
     post to the chat above.
   - **Ownership: per-USER (account), not per-game** (already true of
     item 1's minimal record too). A character is portable across
     games by construction, rather than needing an export/import step
     between two games.
   - **Importing** is also mod-based: rather than bespoke native parsers
     for every external format (Excel sheets from paid westmarches
     servers, Roll20/Foundry JSON exports, etc.), the import mechanism
     itself is a pluggable mod interface -- a handful of built-in
     importer mods to start, swappable/extensible later.
   - **NEW -- player body size becomes a permanent character-sheet
     variable** (real request, 2026-10-17): `playerBodyMesh.ts`/
     `net.ts`'s `PLAYER_BODY_WIDTH`/`HEIGHT`/`DEPTH` (today fixed
     constants, same for every character) move into the character-sheet
     variable system as ALWAYS-PRESENT, reserved variables -- every
     template has them (unlike ordinary template-defined variables,
     these aren't optional/removable), driving each character's actual
     body-box dimensions and derived token placement (`net.ts`'s
     `TOKEN_Y_OFFSET` math already derives from `PLAYER_BODY_HEIGHT`, so
     this becomes per-character instead of one fixed value for everyone).
   - **NEW -- HP/MP become DEFAULT (not permanent/fixed) character-sheet
     variables, linked to the billboard bars** (real request,
     2026-10-17): unlike body size above, HP/MP should NOT be hardcoded
     into the core variable system -- they're part of the DEFAULT
     template (so a new sheet starts with them, matching item 1's
     current fixed hp/maxHp/mp/maxMp shape), but a template can
     theoretically omit or replace them. `characterToken.ts`'s HP/MP
     bars need to read whichever variables the active template actually
     resolves as HP/MP instead of the hardcoded `CharacterRecord.hp/mp`
     fields item 1 built -- a real migration of item 1's minimal fields
     onto this general variable system once it exists, not a separate,
     parallel path.
   - **NEW -- chat should show the character's name, not the account's**
     (real request, 2026-10-17): chat currently sends/displays the
     account's own `displayName` (`chatNet.ts`'s `connectChat`,
     `GameRoom.ts`'s `senderName`) -- once a character is actually
     selected, the chat sender name should be that CHARACTER's name
     instead, so party members see "Aria said..." not "bob said...".
     Needs real character data to resolve against (the account's
     currently-controlled character), hence sequenced here rather than
     attempted with item 1's minimal record alone.
4. ~~**Full panel UI chrome**~~ -- **DONE** (2026-10-16, see
   [COMPLETED.md](COMPLETED.md#mvp-goal-item-3--panel-ui-chrome) for
   the full implementation) for the chrome itself: all 4 panels exist
   and are correctly positioned/collapsible/resizable. Still open within
   this item:
   - The mode panel's **Distance-measurement/Turn-tracker buttons are
     intentionally stubbed** (visible, disabled, no logic) -- their
     real behavior (the old game's real 3D yellow-line distance/battle-
     mode overlay, upgraded with an explicit FINALIZE-and-restart
     action instead of just end-turn-to-reset) is Phase 9 (item 5
     below), not built yet.
   - **Party-list click-to-focus is NOT built**: clicking a player's
     icon to snap the camera to them and show them through terrain (an
     x-ray highlight for that specific character, distinct from the
     existing per-player near-camera xray-cutout effect) -- the panel
     today only displays who's present, with a generic placeholder
     avatar per player, no click interaction yet.
   - **NEW follow-up, explicitly scoped as not-this-PR** (user request,
     2026-10-16): once characters exist (item 1's minimal record is
     enough for this, not item 3's full system), a user should be able
     to SELECT which character they're currently playing via a chat
     command/UI (from their own list of characters), and their
     party-list avatar should switch to reflect that selected
     character's real token image -- "a lot for right now," depends on
     items 1 + 2 (the token image itself) existing first.
   - Quick actions (top panel) is built but still genuinely empty --
     content is item 3's own character-sheet-template scope, not this
     item's.
5. **A turn-based battle system**, more detailed than the old Godot
   game's (which deliberately didn't even enforce turn order -- see
   Phase 9 below) -- its own UI lives inside the left mode-select panel
   (item 4 above) and it integrates with chat/dice (item 0) and the
   full character-sheet system (item 3 specifically -- real stats to
   act on, not just item 1's minimal record), so it's sequenced after
   chat, tokens, and the full character-sheet system all exist.
6. **Mod load/unload mechanism, with a minimal (not yet polished) UI**
   -- split out of the settings-tab item below (2026-10-16 correction)
   because items 7/8 need SOME real way to load/unload a mod before
   they're meaningfully testable at all, by BOTH a script test AND a
   person manually trying one -- a person can't drive a server-side
   function call directly, so some UI (even a crude, no-styling one --
   a plain list with load/unload buttons is enough) is genuinely
   required here, not deferred to item 9. Just the mechanism and that
   bare-minimum UI: a Game's list of included mod files, real load/
   unload calls a test can call directly, and a rough manual control
   for a person to do the same thing -- NOT item 9's polished,
   integrated settings tab inside the chat panel, which replaces this
   item's crude UI afterward rather than building on top of it.
7. **Default blocks as a real mod** -- pull the current built-in voxel
   type catalog (`packages/shared/src/voxelTypes.ts`'s `VOXEL_TYPES`,
   hardcoded in the shared package) out into an actual mod file, using
   item 6's load/unload mechanism to verify it actually works as a mod
   (not just that the file exists). Full scope in
   `docs/PORTING_CHECKLIST.md`'s Phase 6. Operationalizes a design
   principle this project has carried since Phase 6 was first scoped
   but never actually enforced.
8. **Default terrain generators as a real mod** -- same treatment for
   the current built-in generator catalog
   (`packages/shared/src/worldGenerators.ts`'s hilly/plains/
   limestone_slab). Full scope in `docs/PORTING_CHECKLIST.md`'s Phase 6.
   Together with item 7, this is also what makes item 3's "a Game
   picks a character-sheet template the same way it already picks a
   world generator" literally true (today's generator "picking" is
   just a hardcoded 3-entry catalog, not a real mod file) rather than
   just an analogy.
9. **Mod-management settings tab, inside the chat panel** (user
   request, 2026-10-16) -- replaces item 6's crude manual UI with a
   polished one integrated into the chat panel, on the SAME underlying
   load/unload mechanism: a Game's set of included mod files
   (including items 7/8's default mods, and eventually character-
   sheet-template mods) is configured from a new settings tab inside
   the already-shipped chat panel (item 0), not hand-edited JSON or a
   test-only call. Full scope in `docs/PORTING_CHECKLIST.md`'s Phase 6.

Everything else currently sequenced into Phase 2/3/4/7/8/10/11+ below
is real, worth doing, and NOT dropped -- but it's supporting/polish work
relative to 0-9 above, not a substitute for them (Phase 6 itself is now
fully covered by items 6-9). When picking what to work on next, default
to advancing 0-9 in strict order -- this list IS the build order now
(2026-10-16 correction: an earlier draft numbered this as 0,1,2,3,4...
with 1 split into non-adjacent 1a/1b sub-parts around item 2, which
wasn't actually sequential despite the numbers; this version renumbers
everything so top-to-bottom reading is literally the order to build in,
no sub-letters -- and a second 2026-10-16 correction split the old last
item into a minimal mechanism, item 6, that now comes BEFORE the
extraction items it unblocks, with the polished UI moved to the new
last item, 9). Detour only for a specific reason (a live-reported bug,
a small blocking dependency).

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
| 5 | Inventory/items -- catalog + hotbar, server-authoritative item actions | **PARTIAL** | **⭐ MVP: character sheets** -- full scope in the MVP goal section above, now split into item 1 (a small data contract -- owner, token reference, HP/MP, status effects, ships BEFORE item 2), item 2 (tokens/billboards, which only need item 1), and item 3 (the full mod-based-template/scripting/import authoring system, ships AFTER item 2). Chat/dice (item 0) comes first either way; combat/health is built on item 3 once it exists; DM-vs-player stock split, item tooltip, dual-hand equip scheme |
| 6 | **⭐ MVP: Mod system v2** -- per-world data-only AND behavior-mod registration | **PARTIAL** | full scope now covered by the MVP goal section's items 6-9 above: a minimal load/unload mechanism first, then default-blocks mod, default-generators mod, and the mod-management settings tab in the chat panel; also dynamic mod loading/packaging, per-world persisted config, Uint16 wire-format widening |
| 7 | DM tools -- world CRUD UI, structure saver/placer, draw tools | NOT STARTED | everything |
| 8 | Lighting + voxel tick system -- needs fresh design, not a port; also where the LCG + spatial hash land, if/when actually needed | NOT STARTED | everything |
| 9 | **⭐ MVP: Battle mode / turn tracker, server-authoritative, more detailed than the old game's** -- also where the distance math lands; full scope (item 5 in the MVP goal section above) depends on chat/dice, tokens, the full character-sheet system, and the panel UI chrome (items 0-4) existing first | NOT STARTED | everything |
| 10 | NPC/AI -- WANDER/CHASE/ATTACK state machine, FOV/LOS (vision-cone *rendering* deferred further) | NOT STARTED | everything |
| 11+ | Polish -- remaining UI, chunk-streaming perf, mod-ecosystem hardening, Google/OAuth + payments research | NOT STARTED | everything |

Per-file porting decisions (port/redesign/drop/defer for every old `.gd`
file) live in `docs/PORTING_CHECKLIST.md` (open items only); finished work
is in `docs/COMPLETED.md`.

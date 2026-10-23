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
   (item 4 below) don't exist yet; `[[...]]` today only evaluates plain
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
     character sheet" is correctly disabled (item 4 doesn't exist yet)
     but needs wiring once it does. None of these were meant to be the
     final UI -- revisit once item 4's mod-template system exists to
     build real versions on top of, rather than extending the
     placeholders in place.
   - ~~**Ownership check is too literal, needs a real admin/GM
     override**~~ -- **DONE** (see
     [COMPLETED.md](COMPLETED.md#mvp-goal-item-4-follow-up--multiple-character-instances-persistence-gm-token-override)).
     `pickOwnedToken`/`resolveHoveredBar` now also accept a pick while
     `gmOverride.isActive()`, and `focusCharacter`/
     `removeCharacterInstance` gained the same admin bypass their
     sibling instance-scoped handlers already had.
   - **Party-list real token colors**: DONE as part of this item
     (`partyListPanel.ts` now renders each player's real
     `PlayerPresence.tokenColor` instead of a placeholder initial). The
     separate "switch avatar by selecting a character in chat" follow-up
     noted under item 5 below is still not built -- that's about
     CHANGING which character a session is playing mid-session, not
     just displaying the one it already has.
3. ~~**Mod load/unload mechanism, with a minimal (not yet polished) UI**~~
   -- **DONE** (2026-10-21, see
   [COMPLETED.md](COMPLETED.md#mvp-goal-items-3--9--mod-loadunload-mechanism-gm-only-settings-ui)
   for the full implementation, including two real corrections during
   the work: mods moved from per-world to per-game scope, and the UI's
   final shape is a GM-only tab inside the chat panel, not a crude
   standalone one -- see that entry). Shipped together with item 9
   below, which this entry also now marks done -- real iteration
   converged directly on item 9's polished shape rather than building
   this item's originally-planned crude UI first and replacing it
   later. **Moved up from its original position after the character-
   sheet system (2026-10-17 correction)**: item 4 below explicitly
   requires "mod-system-based templates," but no mod-loading mechanism
   existed anywhere in this codebase before this -- item 4 can depend
   on it directly instead of the other way around.
4. **Full character-sheet authoring system** -- depends on item 3
   above (not item 2 -- see item 3's own 2026-10-17 note on why it
   moved ahead of this item). The actual VTT-core data model
   (per-system stats, not the old game's stealth-platformer health/
   stamina). Blocks real combat, blocks anything "roll20-like" being
   true of this project yet. Scoped shape:
   - **Mod-system-based templates**: a Game picks/configures a
     character-sheet template the same way it already picks a world
     generator -- NOT one hardcoded schema, since the pitch is "roll20
     for any tabletop system." Built on item 3's mod mechanism directly,
     not a placeholder/non-mod template system to be retrofitted later.
   - Template authored in a safe markup format (markdown/RST-like,
     supports images) -- never raw HTML/script injection.
   - **Paginated, typed variable system**: a sheet has N pages, each
     with any number of named/typed variables. Input widget follows the
     type: a wide numeric range gets a scrollbar/slider; a fractional
     or x-of-y value (e.g. current/max HP) gets two boxes; a plain
     single value gets one box. (Item 1's HP/MP pair is the first real
     instance of the "x-of-y" case -- this general variable system
     should subsume it, not duplicate it.)
   - **Ownership: per-USER (account), not per-game** (already true of
     item 1's minimal record too). A character is portable across
     games by construction, rather than needing an export/import step
     between two games.
   - A safe/sandboxed scripting system for calculated variables, and
     mod-based sheet importers, were both originally scoped here --
     **moved to `docs/BACKLOG.md`** (2026-10-21, real correction: "I
     wouldn't call those small follow ups. We'll probably only do a
     portion of them... we should probably move them to a backlog/
     deferred page... so we can come back to those later while getting
     a working system now"). Of the items below, body size, drag-and-
     drop placement, Tab/Shift+Tab cycling, and deleting a character
     are this item's actual MVP-scope finish, being built now
     (2026-10-21) -- chat-sender-name stays partial/blocked and the
     ModContext split is in `docs/BACKLOG.md` too (see their own notes
     below).
   - ~~**NEW -- player body size becomes a permanent character-sheet
     variable**~~ -- **DONE**. `bodyWidth`/`bodyHeight`/`bodyDepth` are
     live, reserved sheet variables driving each character's actual
     body-box dimensions AND its physics collision box (`net.ts` calls
     `resizeLocalPlayerBody`/`resizeEntityBody` whenever a synced
     player's/instance's body size changes, resolved server-side via
     `applyBodySizeToCharacterTarget`; `playerBodyMesh.ts`'s
     `resizeEntityBody` calls noa's `entities.setEntitySize`, not just
     the visual mesh).
   - ~~**NEW -- HP/MP become DEFAULT (not permanent/fixed) character-sheet
     variables, linked to the billboard bars**~~ -- **DONE** (2026-10-21,
     PR #29). Generalized further than originally scoped: not just HP/MP
     specifically but an arbitrary, per-sheet-configured list of
     `{variableId, color}` bars (any `xOfY` variable, any count, any
     color) -- `characterToken.ts`'s billboard renders whichever bars
     the sheet defines, capped at 4 reserved slots. The old fixed
     `CharacterRecord.hp/maxHp/mp/maxMp` fields are gone entirely.
   - ~~**NEW -- chat should show the character's name, not the
     account's**~~ -- **DONE** (2026-10-21, PR #29), accepted in this
     manual-dropdown shape by explicit user call (2026-10-22) rather
     than building the automatic-from-currently-controlling version
     this bullet originally scoped: `chatSend` takes an optional
     `asCharacterId`, and the compose row has a "post as" dropdown
     defaulting to "My username." A real "currently controlling"
     concept does now exist (Tab/Shift+Tab, below) if automatic
     derivation is ever wanted later, but it's not planned work.
   - ~~**NEW -- a third top-level page, scoped to the ACCOUNT (not a
     game), for viewing/testing character sheets outside any game**~~
     -- **DONE** (2026-10-21, PR #29): the standalone `/characters`
     page, with its own local test-chat panel standing in for "post to
     chat" (an out-of-game test harness, not just a read-only viewer --
     the sub-bullet below is DONE along with it).
     - ~~**An out-of-game test harness, not just a read-only viewer**~~
       -- **DONE** (2026-10-21, PR #29). The ModContext game-state
       split this page's mods would eventually need is tracked in
       `docs/BACKLOG.md` now, not here -- unexercised by any real mod
       yet, so not actually blocking this page's own done-ness.
   - ~~**NEW -- an in-game "Characters" tab + character-sheet popup/
     popout**~~ -- **DONE** (2026-10-21, PR #29, following real
     requests the same day). A many-to-many game<->character link
     (`GameCharacterLink`, with optional folders and a `visibility:
     "all" | string[]` list), a "Characters" tab inside `chatPanel.ts`
     (tab order Chat, Characters, GM) listing characters visible to the
     account in the current game, and a centered popup (+ a "Pop out"
     into a real separate browser window) showing that character's
     sheet -- `canEdit: false` for a shared character you don't own or
     admin.
   - ~~**NEW -- drag a character from the Characters tab onto the 3D
     world to place/move their token**~~ -- **DONE** (PR #33/#34, see
     [COMPLETED.md](COMPLETED.md#mvp-goal-item-4-follow-up--multiple-character-instances-persistence-gm-token-override)).
     Also gained, beyond the original scope: placing creates a genuinely
     SEPARATE, independent instance each time (even for the same
     character -- "multiple instances... for monsters"), and every
     placed instance now persists per-world, not just for the placing
     session.
   - ~~**NEW -- Tab/Shift+Tab cycles control + camera focus between the
     player's own character instances present in the world**~~ --
     **DONE** (PR #33/#34, same COMPLETED.md entry as the bullet
     above), plus a right-click "Control" item for a direct jump
     (not just ring order), and the chat-sender-name item's own
     "currently controlling" concept it was waiting on now exists --
     see that item's own note on why it's staying a manual dropdown
     anyway.
   - ~~**NEW -- deleting a character**~~ -- **DONE**. A real `DELETE
     /characters/:id` endpoint (`server.ts`, backed by
     `store.deleteCharacter`), with a confirmation step wired from both
     the standalone `/characters` page and the in-game Characters tab.
5. ~~**Full panel UI chrome**~~ -- **DONE** (2026-10-16, see
   [COMPLETED.md](COMPLETED.md#mvp-goal-item-3--panel-ui-chrome) for
   the full implementation) for the chrome itself: all 4 panels exist
   and are correctly positioned/collapsible/resizable. Still open within
   this item:
   - The mode panel's **Distance-measurement/Turn-tracker buttons are
     intentionally stubbed** (visible, disabled, no logic) -- their
     real behavior (the old game's real 3D yellow-line distance/battle-
     mode overlay, upgraded with an explicit FINALIZE-and-restart
     action instead of just end-turn-to-reset) is Phase 9 (item 6
     below), not built yet.
   - **Party-list click-to-focus is NOT built**: clicking a player's
     icon to snap the camera to them and show them through terrain (an
     x-ray highlight for that specific character, distinct from the
     existing per-player near-camera xray-cutout effect) -- the panel
     today only displays who's present, with a generic placeholder
     avatar per player, no click interaction yet.
   - **NEW follow-up, explicitly scoped as not-this-PR** (user request,
     2026-10-16): once characters exist (item 1's minimal record is
     enough for this, not item 4's full system), a user should be able
     to SELECT which character they're currently playing via a chat
     command/UI (from their own list of characters), and their
     party-list avatar should switch to reflect that selected
     character's real token image -- "a lot for right now," depends on
     items 1 + 2 (the token image itself) existing first.
   - Quick actions (top panel) is built but still genuinely empty --
     content is item 4's own character-sheet-template scope, not this
     item's.
6. **A turn-based battle system**, more detailed than the old Godot
   game's (which deliberately didn't even enforce turn order -- see
   Phase 9 below) -- its own UI lives inside the left mode-select panel
   (item 5 above) and it integrates with chat/dice (item 0) and the
   full character-sheet system (item 4 specifically -- real stats to
   act on, not just item 1's minimal record), so it's sequenced after
   chat, tokens, and the full character-sheet system all exist.
7. **Default blocks as a real mod** -- pull the current built-in voxel
   type catalog (`packages/shared/src/voxelTypes.ts`'s `VOXEL_TYPES`,
   hardcoded in the shared package) out into an actual mod file, using
   item 3's load/unload mechanism to verify it actually works as a mod
   (not just that the file exists). Full scope in
   `docs/PORTING_CHECKLIST.md`'s Phase 6. Operationalizes a design
   principle this project has carried since Phase 6 was first scoped
   but never actually enforced.
8. **Default terrain generators as a real mod** -- same treatment for
   the current built-in generator catalog
   (`packages/shared/src/worldGenerators.ts`'s hilly/plains/
   limestone_slab). Full scope in `docs/PORTING_CHECKLIST.md`'s Phase 6.
   Together with item 7, this is also what makes item 4's "a Game
   picks a character-sheet template the same way it already picks a
   world generator" literally true (today's generator "picking" is
   just a hardcoded 3-entry catalog, not a real mod file) rather than
   just an analogy.
9. ~~**Mod-management settings tab, inside the chat panel**~~ -- **DONE**
   (2026-10-21, same [COMPLETED.md](COMPLETED.md#mvp-goal-items-3--9--mod-loadunload-mechanism-gm-only-settings-ui)
   entry as item 3 above -- shipped together). Real correction beyond
   this item's original framing: it's a **GM-only tab** (appears/
   disappears with GM mode itself), not a settings tab visible to every
   player with just the mutation admin-gated -- "mods should definitely
   also be GM only." Also gained a `seeThroughWalls` toggle in the same
   tab (not originally scoped here, added alongside once the tab
   existed). Items 7/8's default mods and any future character-sheet-
   template mods still need to actually EXIST as real mods before this
   tab has anything beyond today's one fixture mod to manage --
   unaffected by this item being done.

Everything else currently sequenced into Phase 2/3/4/7/8/10/11+ below
is real, worth doing, and NOT dropped -- but it's supporting/polish work
relative to 0-9 above, not a substitute for them (Phase 6 itself is now
fully covered by items 3/7/8/9). When picking what to work on next,
default to advancing 0-9 in strict order -- this list IS the build
order now (2026-10-16 correction: an earlier draft numbered this as
0,1,2,3,4... with 1 split into non-adjacent 1a/1b sub-parts around
item 2, which wasn't actually sequential despite the numbers; that
version renumbered everything so top-to-bottom reading is literally
the order to build in, no sub-letters -- and a second 2026-10-16
correction split the old last item into a minimal mechanism that came
BEFORE the extraction items it unblocks, with the polished UI moved to
the new last item, 9. A third correction, 2026-10-17, moved that
minimal mod mechanism (item 3 now, was item 6) BEFORE the full
character-sheet system (item 4 now, was item 3) -- item 4 names "mod-
system-based templates" as an explicit requirement, which can't be
literally true without item 3 existing first; the earlier ordering
would have meant building character-sheet templates against a mod
interface that doesn't exist, then reworking them once it does).
Detour only for a specific reason (a live-reported bug, a small
blocking dependency).

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
- **Mods are per-GAME**, not platform-wide and not per-world (real
  correction, 2026-10-17 -- see
  [COMPLETED.md](COMPLETED.md#mvp-goal-items-3--9--mod-loadunload-mechanism-gm-only-settings-ui)):
  each game's metadata records which mods it has enabled; registration
  still happens per-`WorldRoom` instance (reading its world's parent
  game's enabled list), not once globally at server boot.
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
| 6 | **⭐ MVP: Mod system v2** -- per-game data-only AND behavior-mod registration | **PARTIAL** | full scope now covered by the MVP goal section's items 3/7/8/9 above: the load/unload mechanism + GM-only management tab are DONE (items 3, 9); default-blocks mod (item 7) and default-generators mod (item 8) are not started; also dynamic mod loading/packaging beyond today's per-game enable/disable, Uint16 wire-format widening (needed before 7/8 can allocate real mod voxel ids) |
| 7 | DM tools -- world CRUD UI, structure saver/placer, draw tools | NOT STARTED | everything |
| 8 | Lighting + voxel tick system -- needs fresh design, not a port; also where the LCG + spatial hash land, if/when actually needed | NOT STARTED | everything |
| 9 | **⭐ MVP: Battle mode / turn tracker, server-authoritative, more detailed than the old game's** -- also where the distance math lands; full scope (item 5 in the MVP goal section above) depends on chat/dice, tokens, the full character-sheet system, and the panel UI chrome (items 0-4) existing first | NOT STARTED | everything |
| 10 | NPC/AI -- WANDER/CHASE/ATTACK state machine, FOV/LOS (vision-cone *rendering* deferred further) | NOT STARTED | everything |
| 11+ | Polish -- remaining UI, chunk-streaming perf, mod-ecosystem hardening, Google/OAuth + payments research | NOT STARTED | everything |

Per-file porting decisions (port/redesign/drop/defer for every old `.gd`
file) live in `docs/PORTING_CHECKLIST.md` (open items only); finished work
is in `docs/COMPLETED.md`.

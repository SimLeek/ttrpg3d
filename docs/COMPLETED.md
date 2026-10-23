# Completed work

Everything already shipped, moved out of `docs/ROADMAP.md`/
`docs/PORTING_CHECKLIST.md` so those stay scannable for what's actually
left. Organized the same way those two docs are (standing-decision
background first, then per-phase, same phase numbers/headers) — this file
is pure history/reference, never a planning doc; don't add new work here.

## Standing decisions — background

The rules themselves live in `docs/ROADMAP.md`'s Standing Decisions. The
detail behind two of them got long enough to move here:

**Games contain Worlds** (games-and-world-generators PR): a roll20-style
"campaign contains multiple pages" model, confirmed via real design
discussion ("one game can have many pcg voxel worlds in it"). `Game`
(`packages/server/src/data/store.ts`'s `GameRecord`) is the top-level
owned/administered unit the lobby lists/creates; `World` (`WorldRecord`)
is a page WITHIN a game, created/switched from an in-game admin-gated
panel (`pageManager.ts`), not the lobby -- it carries no owner/admin of
its own, permissions resolve through its parent game
(`isWorldAdmin` -> `isGameAdmin`). Switching pages is a full client-side
`stop()`+`startGame()` cycle against the new world, reusing the same
proven teardown/setup the lobby->game handoff already used, rather than
trying to clear noa's loaded chunks/entities in place. Real limitation:
no cross-client page-sync yet -- each client switches its own view
independently, the GM's active-page choice doesn't push to other
connected players automatically.

**Core/mod boundary.** This project's actual pitch is "roll20 for any
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

## MVP goal item 0 — Chat + dice rolling

The first item in `docs/ROADMAP.md`'s MVP goal section (added this
session after "what's next" had drifted into small phase-table
leftovers instead of the actual north star -- a working multiplayer VTT,
not just a voxel sandbox). Genuinely new design, no old-game equivalent
at all -- its own TODO docs only ever floated "character actions...
maybe via a character-sheet mod" as an unbuilt idea.

- **New `GameRoom`** (`packages/server/src/rooms/GameRoom.ts`), one per
  Game (not per World/page) via `.filterBy(["gameId"])` -- mirrors
  `WorldRoom`'s existing room-per-scope pattern. Deliberately NO Colyseus
  Schema state (`HelloRoom.ts` is direct proof `extends Room` with no
  generic is already a normal pattern here) -- chat is a discrete event
  log (broadcast + persist), not continuously-synced live state.
- **Rejected an initial design** before writing any code: pushing chat
  history via a `client.send(...)` from `onJoin`. `WorldState.ts`'s own
  header comment documents this exact codebase already having hit and
  fixed that bug class (a message sent from `onJoin` can arrive before
  the client's own listener is registered) -- so ALL history (initial +
  scrollback) goes through a new REST endpoint instead
  (`GET /games/:id/chat`, `server.ts`), and the room only ever
  broadcasts NEW messages.
- **Dice rolls are server-authoritative only** -- `packages/server/src/
  chat/diceRoll.ts` wraps `@dice-roller/rpg-dice-roller` (real, maintained
  npm package, confirmed directly: `new DiceRoll(notation)` throws a real
  `peg$SyntaxError`/`RequiredArgumentError` on bad input, not assumed from
  its docs), added as a server-only dependency -- the client never computes
  a roll, only ever sends raw chat text. `/roll <bad notation>` errors to
  the SENDER ONLY, never broadcast/persisted; a bad `[[...]]` segment
  inside an otherwise-fine message degrades to an inline
  `[invalid dice: ...]` marker, delivering the rest of the message rather
  than dropping it entirely.
- **Chat persistence**: `packages/server/src/chat/chatStorage.ts`, a
  direct structural mirror of `world/storage.ts`'s per-world voxel
  storage (`node:sqlite` `DatabaseSync`, one file per `gameId`).
- **Detection vs. evaluation split**: `packages/shared/src/
  chatCommands.ts`'s `parseSlashRoll`/`findInlineRolls` are pure string
  logic (no dependency on the dice library) and shared; the actual RNG
  execution stays server-only.
- **Client**: a SECOND, independent Colyseus room connection
  (`chatNet.ts`) alongside `net.ts`'s existing per-world one -- Colyseus
  supports concurrent room connections per tab with no special handling.
  Deliberately NOT opened inside `main.ts`'s `launchGame` (confirmed that
  function is called fresh on every page switch, via its own
  `onSwitchWorld` closure) -- a second persistent reference (`runningChat`)
  is opened/closed by a new `enterGame()` wrapper instead, only
  reconnecting when actually entering/leaving a game, not on a page
  switch within one.
- **Chat panel** (`chatPanel.ts`, same DOM-overlay pattern as
  `hotbar.ts`/`pageManager.ts`): docked right, drag-resizable via a
  handle on its left edge (real user correction -- an earlier version
  only had a click-to-collapse toggle between two fixed sizes, which
  wasn't what was wanted; the toggle still exists separately for a full
  quick-collapse, remembering the dragged width to restore on expand).
  Enter with nothing focused opens the compose box; Enter while
  composing sends and blurs back to gameplay; Escape while composing
  clears without closing the whole panel.
- **Real bug found live**: the chat panel's container is created in
  `main.ts` BEFORE a game session's `startGame()` ever runs (so it
  survives page switches) -- meaning noa's own canvas is always a LATER
  DOM sibling on every page switch and painted over it with no explicit
  z-index set, reproduced live as "no chat panel visible at all" (it was
  there, just hidden). Fixed with `z-index: 50` on the panel.
  `pageManager.ts` needed the identical fix for an unrelated reason (its
  own `z-index: 10`), confirmed by reading it directly rather than
  guessing at a cause.
- **Real, newly-discovered gap, fixed alongside this**: `inputCapture.ts`'s
  `isCaptured()` had ZERO consumers anywhere in the client before chat --
  none of the existing single-key `keydown` listeners (`hotbar.ts`'s
  inventory/hotbar-slots, `pageManager.ts`'s panel toggle,
  `respawnControl.ts`'s respawn/anchor-set, `gmOverride.ts`'s noclip
  toggle) guarded against it, so typing a chat message containing "e", a
  digit, "m", or "g" would ALSO have fired those hotkeys. Added a one-line
  guard to each (excepting a panel's own already-open state, so Escape
  still closes it even while that's the thing holding capture). Also
  elevated to in-scope per explicit direction: `PlayerController.ts`'s
  tick handler now treats movement input as fully released whenever
  anything has capture, REGARDLESS of noa's own raw input state (noa's
  listener still sees keystrokes typed into an unrelated text field,
  since nothing calls `stopPropagation` on them) -- a held-key move in
  progress winds down through the same deceleration blending a normal
  key-release already uses, not a new halt mechanism.

## MVP goal item 3 — Panel UI chrome

The three remaining panels around the already-shipped chat panel
(item 0), user's own layout spec (2026-10-16): left panel (full height)
for mode-select buttons, top panel (spanning mode-panel's right edge to
chat's live left edge) for quick actions, bottom panel (same horizontal
span) for the party list.

- **Scope decision, confirmed via AskUserQuestion**: the mode panel's
  Distance-measurement and Turn-tracker buttons are real Phase 9
  (battle system) features that don't exist yet -- shipped VISIBLE but
  STUBBED (disabled, no handler, a tooltip naming what they're for)
  rather than half-building battle-mode logic just because a button
  exists for it.
- **New `GameState.ts`** (direct structural mirror of `WorldState.ts`'s
  `PlayerState`/`WorldState` pair) -- real Colyseus Schema state added
  to `GameRoom.ts` for presence (who's currently in this game), a
  DELIBERATELY different mechanism from chat itself (still a discrete
  event log, broadcast+persisted, unchanged). Rejected pushing presence
  via a join-time message for the same reason chat's own history
  already avoided it: `WorldState.ts`'s own header documents this exact
  codebase having hit that race once already (a message sent from
  `onJoin` can arrive before the client's listener is registered) --
  Schema's initial snapshot has no such race.
- **Mode-select panel** (`modePanel.ts`) is mounted INSIDE `game.ts`'s
  `startGame()`, same per-page lifecycle as `hotbar.ts` -- NOT in
  `main.ts` like chat/quick-actions/party-list. Justified by its own
  real content: pointer-lock is inherently a per-noa-session concept,
  and the future real battle-mode buttons will be per-world/page too.
  Default/Select are real, wired to a new `RunningGame.setPointerLock`/
  `isPointerLocked`/`onPointerLockChange` -- the last one relays noa's
  own real `gainedPointerLock`/`lostPointerLock` events (confirmed
  directly in noa-engine's `container.d.ts`: it `extends EventEmitter`,
  driven by actual browser pointer-lock-change detection) so the panel
  stays correctly highlighted even when the BROWSER force-exits lock
  via Escape, not just when one of its own buttons is clicked --
  nothing in this codebase listened to those events before this.
- **Quick-actions panel** (`quickActionsPanel.ts`) and **party-list
  panel** (`partyListPanel.ts`) are mounted in `main.ts` alongside chat
  (game-scoped, surviving page switches) -- party-list's data source
  (the new presence Schema) is game-scoped by the same reasoning chat
  itself already established; quick-actions is empty today (content is
  item 1's character-sheet scope) but mounted the same way for
  consistency with the panel sharing its horizontal span. Party list
  shows a generic placeholder avatar (initial letter) per connected
  player -- NOT character-token-driven yet, see the new follow-up noted
  directly in `docs/ROADMAP.md`'s MVP goal section.
- **Chat panel's drag-resizable width exposed via a CSS custom
  property** (`panelLayout.ts`'s `SAFE_AREA_RIGHT_VAR`, set on
  `document.documentElement` from inside `chatPanel.ts`'s own
  `applyWidth`/`setCollapsed`) -- the top/bottom panels' own CSS just
  reads it (`left`/`right` with no explicit `width`, letting the
  browser compute the gap), zero JS coupling to chat's internals.
  Chosen over a ResizeObserver per panel (would lag a frame behind a
  live drag) or an exported getter (no natural subscription point for
  a value that changes continuously during a drag) -- this one variable
  later became the first of a real 4-sided contract once more panels
  needed the same treatment, see the follow-up round below.
- **New shared `panelLayout.ts`**: a z-index constant (two independently
  -chosen magic numbers already existed -- `pageManager.ts`'s `10`,
  chat's `50` -- before any shared source of truth did) and the mode
  panel's fixed, non-resizable width. Deliberately NOT a shared
  "collapsible docked panel" component -- only chat has that exact
  toggle+drag+collapse mechanic; the new panels are each their own file,
  per this project's "three similar things before abstracting"
  principle (and aren't even all the same sub-pattern as chat).
- **Real bug found live while building this**: `partyListPanel.ts`'s
  first draft interpolated player display names (user-set at account
  creation) directly into `innerHTML` -- a real XSS hole, caught before
  ever running rather than live. Fixed by building DOM nodes via
  `createElement`/`textContent` instead, same safe pattern
  `chatPanel.ts`'s own message rendering already used.
- **Follow-up round, reported live**: the mode-select and party-list
  panels initially shipped without a collapse toggle at all (chat and
  quick-actions already had one) -- added the same toggle-tab mechanic
  to both.
  - **Real bug this surfaced**: with the bottom party-list panel now
    real screen real estate, `hotbar.ts`'s own row (the 0-9 slot bar)
    turned out to be hardcoded to `bottom: 16px` (the raw viewport
    edge), so it rendered BEHIND the new panel. Generalized the fix
    rather than patching hotbar alone, per direct request: the
    one-off `--chat-width` CSS variable chat's own drag-resize already
    published became a real 4-sided contract
    (`panelLayout.ts`'s `SAFE_AREA_LEFT/RIGHT/TOP/BOTTOM_VAR` +
    `setSafeAreaInset`) -- every docked panel publishes its own live
    occupied inset, and hotbar's row (plus the `E`/`M` modal overlays,
    see below) reads all four instead of raw screen edges, so it
    automatically re-flows as any panel resizes/collapses without
    needing its own fix the next time a panel is added.
  - **Second real bug, reported live** ("repeatable... only need to add
    a first check upon game load-in"): the initial safe-area
    measurement (`getBoundingClientRect()` right after mounting) could
    land before the browser had actually finished laying out a panel
    mounted asynchronously (quick-actions/party-list, gated on
    `main.ts`'s chat-connection network round-trip) -- baking in a
    wrong value nothing then corrected, until an unrelated resize
    happened to force a fresh (correct) measurement and masked the real
    bug rather than fixed it. Fixed generally with
    `panelLayout.ts`'s `observeSafeAreaInset` -- a `ResizeObserver`
    per panel that re-measures (via `getBoundingClientRect`, not the
    observer's own `contentRect`, which excludes borders) on its
    guaranteed initial callback and on every later real size change, a
    permanent self-correcting backstop instead of another one-shot
    measurement that could race the same way. Not available in this
    project's jsdom test environment (confirmed directly, not assumed)
    -- degrades to a no-op there; real browsers have had
    `ResizeObserver` support for years, and the existing manual
    measurement calls stay in place as an immediate (if occasionally
    premature) first value.
  - **Third real correction**: the `E` (inventory grid) and `M`
    (page-manager) modal overlays centered on the raw viewport, not the
    actual free space between the side panels -- `hotbar.ts`/
    `pageManager.ts`'s overlay `inset: 0` replaced with the same four
    safe-area variables.

## MVP goal items 1-2 — Minimal character record + 3D token representation

Built together per explicit request (2026-10-16: "let's get working on
the next incomplete todo items: minimal character record and token
stuff, let's do them in one"). Genuinely new design, no old-game
equivalent -- its NPC dialog billboard system (`npc_dialog_system.gd`)
is proximity-triggered dialog TEXT, a different concept from an
always-visible HP/MP+status billboard, which the old game never built
(a dead, never-wired "hp above head maybe" comment is the only trace).

**Server**: `CharacterRecord` in `store.ts` (`ownerAccountId`, `token:
{color}`, hp/maxHp/mp/maxMp, `statusEffects`), full CRUD, REST endpoints
(`GET`/`POST /accounts/:id/characters`). `WorldState.ts`'s `PlayerState`
and `GameState.ts`'s `PlayerPresence` gained flattened character fields
(same precedent as `isAdmin`/the respawn anchor -- resolved once at
join, never a live per-message lookup). New `WorldRoom`/`GameRoom`
message handlers `setCharacterStat`/`setStatusEffects`/
`setCharacterToken`, gated to the character's own session or an admin.
**`store.getDefaultCharacterForAccount`**: real follow-up request after
first playtest confirmed a characterless join left every interaction
feature inert (nothing to "own") -- resolves the account's oldest
character, auto-creating one if it has none yet, called from both
rooms' `onJoin` whenever no real `characterId` was given. Covers a
brand-new account AND "deleted your last character" (the very next join
recreates a default) in one function, matching both framings the user
offered.

**Client**: `characterToken.ts` (billboard plane + `@babylonjs/gui`
content: name, HP/MP bars, status-icon row), `tokenPicking.ts` (coarse
mesh-level pick), `characterContextMenu.ts` (right-click menu DOM
overlay), lobby character dropdown/create form, `partyListPanel.ts`
real token colors. `net.ts` wires local + remote tokens, hover
highlighting (real outline via Babylon's `renderOutline`, not a subtle
material tint), and click-to-edit HP/MP via an HTML `<input>` overlay
(this project's established text-entry convention, not a Babylon GUI
`InputText`).

This was also this session's deepest real-bug-finding investigation --
every fix below was confirmed by reading actual source or reproducing
via console logging, never guessed:

- **Billboards were invisible**: a mesh built via plain `MeshBuilder`
  and just parented, without going through noa's own rendering API, is
  never registered in noa's custom octree-based active-mesh selection
  (`sceneOctreeManager.js`) -- Babylon's render loop only ever draws
  what THAT returns. `noa.rendering.addMeshToScene(mesh, false)` fixes
  it, same call noa's own `mesh` ECS component already makes for box
  meshes.
- **Right-click/picking silently did nothing**: `Scene.pickWithRay`/
  `createPickingRay` are stub no-ops in `@babylonjs/core` unless
  `Culling/ray.js` (which patches `Scene.prototype` as a side effect)
  survives bundling -- nothing else in the app referenced `Ray` by name,
  a real tree-shaking risk. Fixed with an explicit side-effect import,
  confirmed present in the actual built bundle afterward.
- **HP/MP-bar hover could never work via `AdvancedDynamicTexture`'s own
  pointer system**: it depends on Babylon's automatic per-pointer-move
  scene picking, but noa unconditionally sets `scene.skipPointerMovePicking
  = true` (a real perf necessity -- a full-scene raycast against every
  chunk mesh on every mouse move would be disastrous). Replaced with a
  geometric hit-test in the token's own local plane space, driven by the
  same camera-center/mouse-position ray `tokenPicking.ts` already uses.
- **Context menu opened then instantly closed**: the same right-click
  mousedown that opens it (via `game-inputs`, synchronously emitted from
  a bubble-phase listener on noa's container, closer to the canvas) was
  bubbling up to `characterContextMenu.ts`'s own `document`-level
  "click outside closes it" listener within that SAME event dispatch --
  open() and close() both completing before a frame ever rendered.
  Fixed with a same-tick guard (the standard fix for this class of bug).
- **Stat-edit `<input>` lost focus instantly**: calling `.focus()`
  synchronously within the same mousedown that created the input raced
  the browser's own default focus-to-canvas handling for that click,
  which won and immediately blurred (committed/closed) it. Fixed by
  deferring focus to the next tick.
- **Overlays opened at the PREVIOUS click's position**: the click-
  position tracker was a bubble-phase `document` listener, but noa's
  own click handling (closer to the canvas) fires first in bubble
  order. Fixed by switching to the capture phase, which always runs
  before any bubble-phase listener regardless of where it's attached.
- **"Select" mode hover/click never worked at all**: picking always
  used the viewport-center ray (correct for pointer-locked "Default"
  play) -- real mouse position was never read. Worse, `scene.pointerX`/
  `pointerY` turned out to be permanently stuck at `(0,0)` in this
  project: Babylon's own pointer tracking is wired up by
  `scene.attachControl`, which noa never calls (it drives input through
  its own separate pipeline). Fixed with a real `mousemove` listener on
  noa's own canvas.
- **Billboard visually overlapped/floated away from the character,
  across several follow-up rounds**: ultimately FOUR compounding
  issues, found one at a time via real screenshots and debug logging,
  not all at once --
  1. the billboard's Y offset was a bare magic number, not derived from
     the player's actual height (fixed: derived from `PLAYER_BODY_HEIGHT`
     + a small gap + half the billboard's own height);
  2. the billboard plane was a full square with content occupying only
     its top ~40%, so "half the plane's height" didn't correspond to
     where the content actually ended (fixed: sized the texture/plane
     to the content's real extent instead of an arbitrary square);
  3. the actual root cause of every "bars are in the wrong place"
     report: `@babylonjs/gui` `Control`s default to CENTER alignment,
     with `top`/`left` as offsets FROM center, not from the top-left
     corner this file's whole pixel-to-local-space math assumed
     (confirmed directly in `Control`'s constructor) -- fixed by
     forcing top/left alignment on every positioned control, with a new
     regression test asserting the actual alignment, not just that the
     math is internally self-consistent;
  4. a parenting math error: the billboard is a child of the body box,
     and noa already positions that box's own origin at its CENTER in
     world space (feet + half its height), not its feet -- the offset
     was being added on top of that already-elevated origin instead of
     being measured from it, landing the billboard `PLAYER_BODY_HEIGHT
     / 2` too high.

**Known gaps, carried into `docs/ROADMAP.md`'s item 2 follow-ups**:
context-menu actions ("Edit token properties", "Select status effects")
are intentionally minimal placeholders, not final UI. The client-side
`owned` ownership check being a literal characterId match with no
admin/GM override is now fixed -- see "GM token override" below.

## MVP goal item 4 (partial) — Character pages/tabs, body size, chat sender name, character deletion

PR #29 (2026-10-21) plus a couple of directly-related follow-ups,
never previously logged here despite being done:

- **Standalone `/characters` page**, scoped to the ACCOUNT (not a
  game) -- for viewing/testing character sheets outside any game, with
  its own local test-chat panel standing in for "post to chat" (an
  out-of-game test harness, not just a read-only viewer). The
  `ModContext` game-state split this page's mods would eventually need
  is tracked in `docs/BACKLOG.md`, not here -- unexercised by any real
  mod yet, so not actually blocking this page's own done-ness.
- **In-game "Characters" tab + character-sheet popup/popout** -- a
  many-to-many game<->character link (`GameCharacterLink`, with
  optional folders and a `visibility: "all" | string[]` list), a tab
  inside `chatPanel.ts` (tab order Chat, Characters, GM) listing
  characters visible to the account in the current game, and a
  centered popup (+ a "Pop out" into a real separate browser window)
  showing that character's sheet -- `canEdit: false` for a shared
  character you don't own or admin.
- **HP/MP generalized into an arbitrary, per-sheet-configured list of
  billboard bars** -- not just HP/MP specifically, any `xOfY`
  variable, any count, any color (`{variableId, color}`), capped at 4
  reserved slots. The old fixed `CharacterRecord.hp/maxHp/mp/maxMp`
  fields are gone entirely.
- **Chat shows the character's name, not the account's** -- `chatSend`
  takes an optional `asCharacterId`, and the compose row has a "post
  as" dropdown defaulting to "My username." Accepted in this
  manual-dropdown shape (2026-10-22 user call) rather than
  automatically deriving it from whichever character the account is
  currently controlling -- a real "currently controlling" concept does
  exist now (Tab/Shift+Tab, below) if that's ever wanted later.
- **Player body size is a live, reserved character-sheet variable** --
  `bodyWidth`/`bodyHeight`/`bodyDepth` drive each character's actual
  body-box dimensions AND its physics collision box (`net.ts` calls
  `resizeLocalPlayerBody`/`resizeEntityBody` whenever a synced
  player's/instance's body size changes, resolved server-side via
  `applyBodySizeToCharacterTarget`; `playerBodyMesh.ts`'s
  `resizeEntityBody` calls noa's `entities.setEntitySize`, not just the
  visual mesh).
- **Deleting a character** -- a real `DELETE /characters/:id` endpoint
  (`server.ts`, backed by `store.deleteCharacter`), with a confirmation
  step wired from both the standalone `/characters` page and the
  in-game Characters tab -- distinct from that tab's own "Unlink,"
  which only removes the game<->character LINK, not the character
  itself.

## MVP goal item 4 follow-up — Multiple character instances, persistence, GM token override

PR #33 (multi-character presence) + PR #34 (this round) + a follow-up
GM-override fix, built directly on real playtest feedback after each
merge, not speculative scope:

- **Drag-and-drop character placement onto the 3D world**
  (`characterPlacement.ts` + `WorldRoom.ts`'s `placeCharacter` handler),
  **multiple independent instances of the same character**
  (`OtherCharacterState.instanceId`, real request: "I can't add
  multiple instances of the same character. I would want to do that
  for monsters"), and **Tab/Shift+Tab + a right-click "Control" item**
  to cycle/jump control between an account's own placed instances
  (`focusCycling.ts`, `characterContextMenu.ts`, `WorldRoom.ts`'s
  `focusCharacter` handler, shared by both UI paths).
- **Placed instances now persist per-WORLD, not per-session**: moved
  `otherCharacters` from `PlayerState` onto `WorldState` (top-level,
  shared by the whole room) specifically because a session-scoped
  array can never survive that session disconnecting -- real feedback:
  "the tokens do not persist upon exiting and re-entering games... they
  should be stored and loaded with the page/world." `store.ts`'s
  `PlacedCharacterInstanceRecord`/`WorldRecord.placedCharacters` is the
  actual disk-backed half, loaded back in `WorldRoom.onCreate`.
- **Each instance's own stat/color/status-effect deviations are
  independent**, not a shared pool -- `instanceVariableOverrides`
  (reversing an earlier "deliberately ephemeral" call, per explicit
  user steer, once persistence existed to make it safe).
- **Your own currently-focused character's live edits are ALSO
  isolated** (`focusedVariableOverrides`) -- real correction found
  live: editing your own focused character's bar used to write
  straight through to the shared `CharacterRecord`, retroactively
  resetting every sibling instance/session with no override of its
  own yet, and a focus swap had the same problem in reverse. A real
  edit still survives a disconnect (baked into the permanent record in
  `onLeave`, since the focused slot has nowhere else to carry it to).
- **GM token override**: `net.ts`'s `pickOwnedToken`/`resolveHoveredBar`
  (and the matching hover-highlight check) now also accept a pick
  while `gmOverride.isActive()` -- same G-key-toggled escape hatch
  `voxelEditor.ts`'s block-edit bypass already uses. Closes the
  long-standing item-2 gap above. Also found while fixing it:
  `focusCharacter`/`removeCharacterInstance` never had the admin bypass
  their sibling instance-scoped handlers already had, so opening the
  client-side gate would have left "Control"/"Delete instance"
  silently no-op for a GM on someone else's instance -- both fixed
  together.
- **Real bugs found live, each confirmed by direct evidence, not
  guessed**:
  - Default/Select mode bleed-through (right-click in Default mode
    opened the context menu instead of placing a block; leftover
    floating stat/color/status-effect UI never dismissed) -- fixed by
    making `voxelEditor.ts`'s click handlers a clean either/or on
    `noa.container.hasPointerLock`.
  - `placeCharacter` used to silently reject placing the character you
    were already focused on (a stale rule from before multiple
    instances existed) -- real correction: "if you're controlling an
    instance of 'bob' and you drag in another 'bob', that should still
    work."
  - "Control" teleported the wrong thing: its callback sent the
    `focusCharacter` message but never called
    `playerController.teleportTo(...)` like Tab/Shift+Tab already did,
    so the local physics entity stayed put while the Schema fields
    relabeled it with the target's data.
  - The local player's own body box was stuck rendering its
    creation-time fixed blue regardless of the focused character's
    real color. Root cause (confirmed by direct experiment, not a
    guess): the material OBJECT attached to `noa.playerEntity` (via a
    raw `addComponent` call, unlike every remote/other box's fresh
    `noa.entities.add()` entity) never visually reflected a
    `.diffuseColor` property reassignment, even though a live console
    check confirmed the property held the correct value continuously.
    Swapping in a brand-new `StandardMaterial` whenever the target
    color changes (disposing the old one) fixed it.
  - A hard refresh while already in-game resumed whichever character
    was last stored in `localStorage`'s `CHARACTER_STORAGE_KEY`, which
    was only ever written at the original lobby pick -- never updated
    when Tab/Shift+Tab/Control changed the actually-focused character,
    so a refresh after switching silently resumed the wrong one (or
    characterless). Fixed by keeping that key in sync with the local
    player's live `characterId` every tick it actually changes.

## MVP goal items 3 + 9 — Mod load/unload mechanism, GM-only settings UI

Shipped together (2026-10-21) rather than items 3's originally-planned
"crude" UI followed later by item 9's polished replacement -- real
iteration during this work converged directly on the polished version
(see corrections below), so the standalone crude-UI step was skipped
entirely rather than built and then thrown away.

**Mechanism** (`packages/server/src/mods/modLoader.ts`): directory-based
-- `mods/<mod-id>/mod.json` manifest (`id`/`name`/`version`/`entry`) +
an entry module exporting `register(ctx)`/`unregister(ctx)`.
`ModContext` is deliberately an empty type for now -- real direction
during planning: "you're not going to be able to just do the mod
mechanism fully and then all the other things, because the
requirements... will be fully detailed only when we do those tasks, so
really we should be doing a full base mod mechanism," i.e. generic
lifecycle only, not pre-built with content-specific registration APIs
(voxel types, character-sheet variables) that items 4/7/8 will add once
their real needs are known. No hot-reload (same precedent the old
Godot game's own real mod system had) -- toggling only takes effect
the next time a world's room is (re)created.

**Real correction (2026-10-17), mid-implementation**: the first version
scoped mods per-WORLD with a crude list bolted onto `pageManager.ts`.
Rejected directly: "mods for this page... too fine grained... I think
they should be per game, not per page." Reworked to `GameRecord.modIds`
(per-GAME scope), while registration TIMING stays per-`WorldRoom`
creation (reading its world's *parent game's* modIds) -- the
`docs/PORTING_CHECKLIST.md` Phase 6 note about per-world registration
timing was never actually about which record owns the enabled-mod list.

**Second real correction (2026-10-21)**: the per-game UI first moved
into a new Settings tab inside `chatPanel.ts` (visible to every player,
only the *mutation* REST calls admin-gated server-side). Rejected:
"mods should definitely also be GM only... everything on current
settings should be on the gm only panel, which should appear and
disappear whenever gm mode is toggled." A standalone floating overlay
(`gmPanel.ts`) was tried next, gated on `gmOverride.ts`'s own G-key
toggle -- also rejected: "don't just make everything a window... this
should be a gm-only panel in the same space as chat, so it should be
another tab... GM on means the tab appears, GM off means the tab
disappears." Final shape: a **GM tab inside `chatPanel.ts`**, whose tab
bar only exists in the DOM while GM mode is active (no separate
hotkey) -- `gmOverride.ts` gained an `onActiveChange` callback as the
single source of truth, forwarded through `game.ts`'s `RunningGame`
(`onGmActiveChange`/`onSeeThroughWallsChange` subscriptions,
`setSeeThroughWalls`/`reloadWorld` methods) up to `main.ts`, which
re-subscribes on every `launchGame` call since each page switch creates
a fresh `RunningGame`. A real pitfall caught and avoided before
shipping: `gmOverride.ts`'s own KeyG handler checks `isCaptured()` on
*every* press, including the one meant to turn GM mode back off -- the
standalone overlay's planned `requestCapture()` while visible would
have permanently locked GM mode on with no way to exit it; the shipped
tab never claims capture (no free-text input to protect, unlike
`pageManager.ts`).

**Also added in the same pass**: `seeThroughWalls`, a GM-only, per-game,
live-synced (no reload -- unlike mods) toggle for `blockShaders.ts`'s
third-person xray-cutout shader. New `WorldState.seeThroughWalls`
Schema field (room-level, same tier as `worldBottomY`/`hasRespawnAnchor`),
persisted to `GameRecord.seeThroughWalls` for the next room creation.
Disabling it feeds the *same point* as both the shader's player/camera
uniforms -- the shader's own early-exit (`distance(cameraPos,
playerPos) > xray_cameraMinDist`) then never fires, for every material
using the plugin, on every draw call including shadow passes, with no
heuristic needed. Real follow-up correction found live: that alone only
removed the visual fade -- the camera could still physically clip
through walls, since `cameraZoom.ts` permanently disables noa's own
collision clamp for an unrelated reason (letting a zoomed-out camera
see past thin terrain, the whole reason the xray shader exists).
`cameraZoom.ts` now exposes `setWallClipAllowed()`, toggled alongside
the shader: `seeThroughWalls` off also restores noa's real
`Camera.prototype.updateAfterEntityRenderSystems` (removing the no-op
override reveals it again), so both effects track together -- genuinely
two distinct exploration modes (hidden spaces vs. a fully visible 3D
dungeon map) from one GM toggle, confirmed working both ways live.

**Known, accepted limitation**: `seeThroughWalls` persists to the
world's PARENT game, but only the room that received the toggle updates
its OWN live state immediately -- another already-running world/room
in the same game won't see the change until it's next (re)created. Same
class of limitation mods themselves already had (per-game config,
per-room-creation timing).

## Phase 2 — MVP

- `scripts/movement_resource.gd`, `basic_jump_resource.gd`,
  `fall_resource.gd`, `spring_arm_3d_look.gd`, `player_blob_ctrl.gd` —
  walk/sprint/jump/fall/zoom, now `CoreMovementProvider` (core/mod-
  boundary PR) — see the Phase 2 entry below for why this moved behind a
  `MovementProvider` seam instead of being `PlayerController.ts`'s own
  hardcoded logic. **Correction**: this bullet previously ALSO claimed
  `wall_jump_resource.gd` and `ledge_safety_resource.gd`/`playable/
  ledge_grabber.gd` as DONE — confirmed live (core/mod-boundary PR's
  research) that was wrong, neither was ever actually built, only
  mentioned in a comment as later work; moved back to
  `PORTING_CHECKLIST.md` as NOT STARTED, scoped as future
  `MovementProvider` implementations (same pattern `NoclipFlyProvider`
  established). `stair_stepper_resource.gd` also NOT STARTED, same
  reason — both still live in the checklist, not here.
  Note: `spring_arm_3d_look.gd`'s own first/third-person zoom-distance
  piece specifically landed LATER than the rest of this bullet (as part
  of the xray-shader PR below) — its Ctrl+scroll binding and 0..8 zoom
  range are a direct port, but its collision-raycast wall-avoidance was
  deliberately NOT ported: noa-engine's own camera already clamps zoom
  to avoid clipping into terrain, and that clamp was then found to
  actively fight the xray-cutout shader (snapping to first person in
  almost any tunnel) and disabled in favor of letting the shader handle
  near-camera geometry.
- `3dAssets/shaders/xray_if_behind_cutout.gdshader` /
  `xray_if_behind_transparent.gdshader`, `playable/
  player_camera_with_cutout.gd` — `packages/client/src/
  blockShaders.ts`'s `XrayFadePlugin`, applied universally (every cube +
  plant type, confirmed by grepping every real `shader_*.tres` in the
  old repo, not just water/quartz). Real water/watertop/quartz
  transparency (genuine alpha blend, not the atlas cutout path) landed
  alongside it, fixing the "water invisible from inside" bug reported
  during Phase 4 playtesting. **NEW** (no old-repo equivalent, grepped
  `swim|underwater|in_water` across every `.gd` file — zero matches):
  swimming controls (`movement/SwimResource.ts`, layered on noa's
  already-real fluid buoyancy/drag physics) and an underwater fog effect
  (`underwaterEffect.ts`). Also added: a visible local third-person
  player body mesh (`playerBodyMesh.ts`) — previously nonexistent since
  the camera could never leave the player's eye before this PR.
- Core/mod-boundary PR — `packages/client/src/movement/
  MovementProvider.ts` (the interface every movement mode implements:
  update/reset/optional onActivate/onDeactivate), `CoreMovementProvider`
  (today's walk/jump/fall/swim repackaged behind it, not rewritten — see
  the bullet above), `NoclipFlyProvider` (direct port of `scripts/items/
  phasing_gloves_item.gd`'s intangibility + `wings_item.gd`'s flying —
  both used the same no-gravity, direct-vertical-control path in the old
  game, confirmed directly). Also: the GM admin-override escape hatch
  (`gmOverride.ts`, gated on `PlayerState.isAdmin` — server-side via
  `store.isWorldAdmin`, reusing `store.ts`'s existing owner/admin/root
  model, nothing new invented) toggling fly+noclip+instant-build/delete;
  respawn core primitives (`worldBottomCatch.ts`, `PlayerController.
  teleportTo`, `WorldRoom`'s respawn-anchor Schema fields) plus one fixed
  default policy (`respawnControl.ts` — Shift+R for anyone, Shift+T
  admin-only anchor-set; NOT Ctrl+T, a browser-reserved new-tab shortcut
  a page can't intercept, caught live). See `docs/ROADMAP.md`'s Standing
  Decisions (and this file's own background section above) for the full
  core/mod boundary this PR established. Respawn anchors were in-memory
  per room at this point, NOT yet persisted — fixed later, see the
  games-and-world-generators entry under Phase 3 below.
- `levels/center_of_universe.gd` — floating-origin re-anchoring concept;
  turned out noa-engine already does this itself, so this became test
  markers + console logging rather than new re-anchoring logic.
- `scripts/pcg/limestone_slab_generator.gd` — basis for the Phase 2 test
  area (steps/gap/wall), later extended into an infinite flat plane with
  grid pillars once the hand-built area proved too small to exercise
  origin-shifting. That hand-built area (`testArea.ts`) was retired
  entirely in the games-and-world-generators PR (Phase 3, confirmed
  explicitly) now that real per-world generator selection exercises
  origin-shifting/movement instead -- this generator got a real, clean,
  generic port at that point too (see Phase 3's own entry below) instead
  of staying loosely approximated by the old test scaffolding.
- `scripts/items/voxelitem.gd`/`del_vox_item.gd` — collapsed to a single
  hardcoded block type initially; full multi-type system is Phase 4.
- **Sprint/slow-walk keybind fix** (reported live): held-Ctrl for
  slow-walk collided with real browser shortcuts (Ctrl+W closes the tab,
  Ctrl+S saves the page, etc.) while holding it alongside WASD. Ctrl is
  now unused entirely -- slow-walk moved onto sprint's old held-Shift
  binding, and sprint itself became the old game's own real mechanic
  after all: double-tap any movement key (`PlayerController.
  updateSprintState`), not a held key, cancelling only once every
  movement key is released (not on direction change, so
  strafing/backpedaling mid-sprint doesn't interrupt it). `MoverResource.
  ts`'s header comment had flagged this exact double-tap port as
  deferred ("worth revisiting... if it's missed during playtesting") --
  it was.

## Phase 3 — Real world management

- Per-world voxel storage (`node:sqlite`-backed, not the originally
  planned `better-sqlite3` — its native build failed outright in this
  sandbox) and basic place/break — both landed ahead of the real terrain
  generator below, since storage needs something to store.
- `scripts/world/world_manager.gd` (167L) — reshaped
  (games-and-world-generators PR): read in full, it turned out to be
  "roll20-page-style: switch between [worlds] without restarting the
  game" -- confirmed directly, not assumed. This is the real origin of
  the Game/World split (see this file's Standing Decisions background
  above) -- `Game` is the new top-level owned/administered unit (what
  `WorldRecord` used to be), `WorldRecord` is a page within a game.
  `create_world`/`switch_to_world` are now `store.createWorld` +
  `pageManager.ts`'s switch button (a full client-side
  `stop()`+`startGame()` cycle against the new world, not an in-place
  noa reset -- noa has no supported API for that, and the existing
  teardown/setup pair was already proven). No cross-client page-sync yet
  (a real, flagged limitation) -- unlike the old game's single-process
  model, this one has independent clients, and nothing pushes the GM's
  active-page choice to other connected players.
- `scripts/pcg/world_generator_catalog.gd` (92L) — (games-and-world-
  generators PR): read in full, confirmed repeatable/non_repeatable/
  finite are classification TAGS on each catalog entry (shown in the old
  DM creation UI), not the world types themselves -- the real catalog
  had exactly 3 entries ("hilly" repeatable, "limestone_slab"
  repeatable+finite, "plains" repeatable -- see below), now
  `packages/shared/src/worldGenerators.ts`'s `WORLD_GENERATORS` table,
  same shape as `voxelTypes.ts`'s shared-table pattern. The
  "non_repeatable" category itself (WFC etc.) stays empty, same as the
  old game -- see the DEFER/NEW bullet in the checklist.
- `scripts/pcg/hilly_terrain_region_generator.gd` (464L) — landed before
  the games-and-world-generators PR (see Phase 2 above); that PR added
  the real `heightScale`/`treesEnabled` params `mods/plains_biome/
  register.gd`'s real "plains" variant needs -- confirmed the old mod
  reused this EXACT generator with `trees_enabled=false, height_scale=
  0.12` fixed params, not a separate algorithm, so that's how it's
  modeled here too: `worldGen.ts` dispatches "hilly" and "plains" to the
  same `hillyTerrain.ts` functions with different fixed params.
- `scripts/pcg/tree_generator.gd` (73L) — landed alongside
  `hilly_terrain_region_generator.gd` above, not separately called out at
  the time: `hillyTerrain.ts`'s `generateTreeShape`/`stampTrees` are a
  direct port of its real trunk/branch/leaf-shell algorithm, seeded from
  `(worldId, anchor position)` instead of Godot's global (non-seeded) RNG
  so a world's trees are stable across reloads. Found still listed as
  open while scanning for "what's next" after the docs split -- real
  work, just never marked done.
- `scripts/pcg/limestone_slab_generator.gd` — (games-and-world-
  generators PR), read in full: a solid width x height x depth slab of
  one configurable voxel type, no randomness, bounded (not
  endless-streaming -- the "finite" classification tag).
  `packages/server/src/world/limestoneSlab.ts`, a clean direct port --
  separate from (and replacing, now that it's retired) `testArea.ts`'s
  old hand-built area, which only ever loosely resembled this
  generator's spirit, not its real params/behavior. Old default voxel
  ("limestone") isn't a real block in this project's voxel table;
  defaults to DIRT instead, noted directly in the new file.
- World CREATE UI — (games-and-world-generators PR), but not where
  originally planned: NOT the outer worlds lobby page (that now only
  lists/creates GAMES -- `lobby.ts`) -- it's an in-game, admin-gated
  panel (`pageManager.ts`, direct UI-shape port of the old game's real
  `scripts/ui/dm_world_menu.gd`: generator-type picker + per-generator
  param fields + create button), since worlds are pages WITHIN a game
  now, confirmed explicitly ("this is essentially the 'pages' in
  roll20"). The lobby's own "Create game" flow also auto-creates one
  starter `hilly` world per new game (same pattern
  `store.ensureSeedData()` already used for the seeded games), since a
  world-less game would have nothing for `pageManager.ts` to be reached
  from in the first place.
- Real bugs found and fixed during the games-and-world-generators PR's
  playtesting (kept here since they're done, not open work):
  - The client never actually applied the server's computed spawn
    position to the local player at all -- it sat at a hardcoded
    cosmetic placeholder (`game.ts`'s old `SPAWN` constant) that only
    ever coincidentally matched the old fixed test area. Every newly
    created world appeared to spawn underground until this was traced
    and fixed (`net.ts` now waits for the player's own synced state and
    teleports there once via `PlayerController.teleportTo`, gated so the
    position-send loop can't race and overwrite the correction).
  - A fixed "surface height + 3" spawn guess wasn't actually safe for
    arbitrary terrain/params -- replaced with a real safe-spawn scan
    (first 2 consecutive air voxels, scanning up from a generator-
    appropriate floor), per the user's own suggested algorithm
    (`worldGen.ts`'s `spawnPositionFor`).
  - Respawn anchors only lived in a room's in-memory Schema state, which
    Colyseus disposes when a room empties (exactly what happens during a
    page switch) -- now persisted to the world record itself
    (`store.setWorldRespawnAnchor`), seeded back into Schema state on
    room creation, and validated server-side so an anchor can't be set
    inside solid terrain (reachable even for an admin via the noclip GM
    override).
  - A raw voxel-id number input in the create-page form showed
    un-memorizable internal IDs -- replaced with a real named picker,
    direct port of the old game's `voxel_catalog.gd` intent.
  - Escape didn't close the page-management panel; Ctrl+T (an earlier
    anchor-set binding) collided with the browser's own new-tab
    shortcut, moved to Shift+T.
- **Default world generator: switch to the less-hilly preset** (2026-10-11
  user decision). Confirmed by directly comparing the real reference
  screenshots (`~/claude_code/cad_pics/ttrpg3dgame.png` vs.
  `ttrpg3dgame-newdef.png`): `"hilly"`'s default `heightScale=1.0`
  produces dramatic, near-vertical mountains ("amplified minecraft" per
  the user's own description); `"plains"` (`heightScale=0.12`, confirmed
  live as "more just normal gen") matches the gentler rolling-hills look
  of the new reference image, including its lack of trees (consistent
  with plains' own `treesEnabled=false`). Fixed by adding
  `packages/shared/src/worldGenerators.ts`'s `DEFAULT_GENERATOR_ID =
  "plains"` as the single source of truth, used by every call site that
  previously hardcoded `"hilly"` as an assumed default: `store.ts`'s
  `ensureSeedData()`, `lobby.ts`'s "Create game" starter-world creation,
  `pageManager.ts`'s create-page form's initially-selected generator, and
  `WorldRoom.ts`'s own no-WorldRecord-found fallback. The catalog itself
  is unchanged -- both `"hilly"` and `"plains"` stay fully selectable,
  this only changes which one a NEW world defaults to.
- **Games lobby couldn't scroll** -- found live once the games list grew
  past one screen (search was the only way to reach an entry below the
  fold). Root cause: `index.html`'s `html, body { overflow: hidden;
  height: 100% }` (needed so the full-screen noa canvas never grows
  document scrollbars) also blocked the lobby page's own document-level
  scroll. Fixed by making `.lobby` a flex column with a bounded
  `max-height` and only `#games-list` itself scrollable
  (`overflow-y: auto; flex: 1 1 auto; min-height: 0`), keeping the
  account/search controls always visible above it.
- **Xray-cutout shader cut out world geometry right above the player**
  when jumping into a cavern, going away once the camera zoomed out even
  slightly. Root cause: noa's camera sits at the player's EYE
  (`[0, 0.9*height, 0]`) even in pure first person, but the position fed
  into the cutout shader (`blockShaders.ts`) is the player's body
  CENTER -- a fixed ~0.4*height gap between "camera" and "player
  position" that exists even standing still, bigger than the old game's
  literal ported `cameraMinDist=0.5` (calibrated against that game's own
  eye-based convention, not this project's body-center one). Fixed by
  raising `DEFAULT_XRAY_PARAMS.cameraMinDist` to `2.0` so the shader
  early-exits (no cutout at all) whenever the camera is this close to/
  inside/in front of the player, with real headroom against the
  intrinsic offset.
- **`WorldRoom.test.ts` was leaking real accounts/games into the actual
  dev data store on every test run** (`@colyseus/testing`'s `boot()`
  boots the real `server.ts`, which imports the real `store` singleton --
  no clean injection point to isolate it without a bigger DI
  restructure). Found live once the lobby could finally scroll far enough
  to reveal dozens of accumulated `WorldRoom-test-*` entries. Fixed at
  the root: `WorldRoom.test.ts` now tracks every account/game/world id it
  creates and removes them all in a single top-level `afterAll`; `store.ts`
  gained real `deleteAccount`/`deleteGame` (cascades to that game's
  worlds)/`deleteWorld` methods to make this possible -- also genuinely
  useful on their own (a future DM delete-world tool needs exactly this).
  The pre-existing cruft (33 accounts, 22 games) was removed from the real
  dev store with a one-off script, not committed.
- `scripts/pcg/voxel_types.gd` (194L) — **PORT**ed the ~20 types actually
  wired to a real display name/model in the old game's own
  `voxel_catalog.gd` (its `DISPLAY_NAMES` dict, confirmed directly, not
  guessed), not all ~59 reserved constants there: 16 of those 20 were
  already in `voxelTypes.ts` from earlier phases; this added the
  remaining `GRANITE`/`LIMESTONE` (real source textures copied from
  `3dAssets/blocks/stone/16x{granite,limestone}.png`) and `GLASS` (`16x
  glass.png`, a real alpha-cutout texture -- opaque cell border, fully
  transparent interior, confirmed by reading its actual alpha channel).
  Granite/limestone are placeable-only, matching the old game's own real
  behavior -- confirmed directly in `hilly_terrain_region_generator.gd`
  that neither was ever actually wired into terrain generation there
  either (only DIRT/MUDSTONE are used as base rock), despite their
  PCG-flavor doc comments in `voxel_types.gd` describing intended rules
  that were never built. `LIGHT` (the 20th wired type) is deliberately
  NOT ported yet -- its only real behavior (lighting up surroundings) is
  Phase 8 (lighting) territory, not built; adding the block now with no
  working behavior would be a half-finished feature, not a real port.
  Real bug found live porting GLASS: the shared core-atlas material
  (`game.ts`) never set `hasAlpha` on its atlas texture, since every
  other cutout-mode type's source texture happened to be fully opaque
  (alpha=255 throughout) -- harmless until GLASS's own real alpha
  variance needed it actually read instead of assumed 1.0, which silently
  rendered it fully opaque. Fixed with `coreAtlasTexture.hasAlpha = true`;
  confirmed live afterward that glass renders as a real see-through
  cutout cube, not opaque, and that nothing regressed for the other
  (uniformly-opaque) cutout types.
  **Follow-up bug reported live**: looking through a placed glass block
  showed straight into the ground/unrelated far geometry where a solid
  neighbor block should have been visible instead. Root cause was a
  separate concern from the alpha fix above -- noa's terrain mesher culls
  the shared face between two NEIGHBORING blocks whenever both are
  `opaque` (the standard greedy-mesher optimization: that face can never
  be seen, so don't render it), and GLASS defaulted to `opaque: true`
  same as every other cutout type, so the mesher culled the face of
  whatever solid block sat behind it -- but glass's own shader lets the
  camera see past its near face, turning that culled neighbor face into
  a real hole straight through to whatever wasn't culled further away.
  Fixed by adding a new `VoxelTypeDef.opaque` field (defaults true,
  independent of `transparencyMode`), set `false` only for GLASS, threaded
  into `game.ts`'s `registerBlock` call; confirmed live that glass now
  shows the solid block behind it correctly, same as looking through
  water/quartz (which already had `opaque: false` via their own separate
  registration branch).
  **Second follow-up bug reported live**: `opaque: false` fixed glass
  against SOLID neighbors, but glass placed in or at the surface of water
  was partially/fully invisible instead -- "just in the water cull
  group." Root cause, confirmed directly against noa-engine's own bundled
  mesher source (`constructMeshMask`) and its real GitHub history
  (`fenomas/noa` issue #184, where the maintainer calls this "a general
  problem" with non-opaque terrain neighbors they hadn't resolved): the
  greedy mesher only ever draws a face between two voxels when at least
  ONE side is opaque or literal air -- two DIFFERENT non-opaque types
  (glass, water) fall through every branch and get no face on EITHER
  side. Not fixable via any `registerBlock` option; the real fix (new
  `packages/client/src/cubeObjectMesh.ts`, GLASS's `mesh` changed to a
  new `"cube-object"` kind in `voxelTypes.ts`) takes glass out of the
  greedy-meshed terrain grid entirely, registering it via noa's
  object-mesher instead (`blockMesh`, the same mechanism the cross/plant
  meshes already use) -- object-mesh blocks render all 6 of their own
  faces unconditionally, with no neighbor-culling logic at all. Hit a
  second real bug immediately after, also found live: the cube mesh's
  material initially copied plant mesh's `backFaceCulling = false`
  (needed there for a double-sided flat sprite), which on a real
  watertight cube meant two adjacent glass blocks' exactly-coincident
  internal faces (the top block's bottom face and the block below it's
  top face) each rendered both their front AND back, producing visible
  z-fighting through the cutout gaps. Fixed by leaving Babylon's own
  default (`backFaceCulling: true`) and rebuilding the cube from
  Babylon's own `CreateBoxVertexData` primitive instead of hand-wound
  quads, to remove any risk of getting the winding backwards by hand
  (confirmed directly in Babylon's real source: its default
  `sideOrientation` and per-face `faceUV` of `(0,0,1,1)` already match
  exactly what a uniform, non-atlas cube texture needs). Confirmed live
  afterward: glass renders correctly fully submerged, at the waterline,
  and stacked against other glass, with no z-fighting.

## Phase 4 — Voxel interaction

Movement moved to Phase 2 already. This phase extended Phase 2's single-
hardcoded-block placement to the real multi-block-type system.

- `scripts/item_resources/voxel_interactor.gd` (328L) — differently than
  planned: its ~328 lines turned out to be mostly manual raycasting +
  face-normal detection + placement-position math that noa-engine's own
  `targetedBlock.position`/`.adjacent` already does for free (confirmed
  by tracing noa's source) -- nothing to port there. What WAS worth
  porting, and is: the character-overlap guard
  (`_is_voxel_overlapping_character`), now `packages/shared/src/
  collision.ts`'s `aabbsOverlap` + `voxelEditor.ts`'s use of it. The
  placement-plane/targeting-beam *visuals* are still not ported (cosmetic
  polish, deferred -- see the checklist).
- `scripts/items/voxelitem.gd`, `del_vox_item.gd` — the "one generic
  placer item, configured per catalog entry" pattern is
  `packages/shared/src/items.ts`'s `Item`/`buildBlockCatalog`.
  `del_vox_item.gd`'s type-agnostic delete was already how
  `voxelEditor.ts`'s break ("fire") worked before this phase; unchanged.
- `scripts/ui/player_inventory.gd` (368L, actually cataloged under
  Phase 5 but pulled forward here) — `packages/client/src/hotbar.ts`, a
  direct port of its real shape (10 hotbar slots, number keys +
  mouse-wheel cycling, a toggleable full-inventory grid where clicking an
  item loads it into the selected hotbar slot) -- not the originally-
  planned smaller ad hoc "just a palette" version; corrected after it
  became clear picking which block to place *is* the hotbar, not
  separable, deferrable Phase 5 scope. Equip-into-hand is simplified to a
  single equip slot read directly by voxelEditor.ts (no `HandController`/
  dual-hand object) -- see the two_handed_resource/left_hand_gripper
  entry in the checklist for why dual-hand itself stayed deferred.
  Native-tooltip/hint text not ported (a plain `title` attribute stands
  in).

## Phase 5 — Inventory/items

- `scripts/pcg/item_catalog.gd` (132L) — pulled forward into Phase 4:
  `packages/shared/src/items.ts`.
- `scripts/ui/player_inventory.gd` (368L) — pulled forward into Phase 4:
  `packages/client/src/hotbar.ts`. See that phase's own entry above for
  exactly what was/wasn't ported.
- ~~**DEFER** — item icon polish~~ — done earlier than planned:
  `scripts/build-block-icons.mjs` crops each block's real top-face
  texture into a standalone icon (not the originally-cosmetic-deferred
  rendered-emoji/3D-cube-render approach) -- cheap enough once the real
  per-face block textures already existed that there was no reason to
  ship flat color swatches first and redo this later.

## Phase 8 — Lighting + voxel tick system

- Check early: does Babylon.js have the same transparent-depth-write
  quirk that forced an alpha-scissor-cutout workaround for glass/battle
  waypoint lines in Godot? **Answered** (xray-shader PR): yes, a related
  one — an alpha-blended, backface-uncull material can still cull its own
  far faces when the camera is inside the mesh (confirmed live on water,
  and via the Babylon forum, not Godot-specific). Fixed with
  `material.separateCullingPass = true` + `forceDepthWrite = true`
  (`game.ts`'s water/watertop/quartz materials) — so the alpha-scissor-
  cutout *workaround itself* isn't needed, but real alpha-blended
  geometry viewed from inside still needs this pair of flags set.

## Cross-cutting

- `scripts/dev/dev_console.gd` (760L) — its function is fully superseded
  by `@colyseus/testing` (Phase 1, merged). No further porting needed.

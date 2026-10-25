# Battle / turn-tracking system — requirements

MVP goal item 6 in `docs/ROADMAP.md` was, until this doc, a single
paragraph. This is the real requirements pass -- scoped via direct
user discussion (2026-10-23) -- that paragraph now points here instead
of trying to hold all of this itself.

## Philosophy (read this before the feature list)

**This is a virtual tabletop, not a rules engine.** The pitch is "roll20
for any tabletop system" -- there are too many different combat rule
sets to actually encode one as *the* combat system. Real user framing,
directly: "there could be a lot of different rule systems too, in fact
too many to account for."

That has one concrete, load-bearing consequence that shapes every
feature below: **turn order is advisory, not enforced.** Nothing in
this system blocks a character from acting because it isn't their
turn. The old Godot game already worked this way (`turn_tracker.gd`'s
`next_turn()` has no permission/gating check at all) and that's being
kept on purpose, not just inherited by default. The system's job is to
track and display whose turn it notionally is, and to protect against
the one real problem that causes in practice (see "Reset Turn" below)
-- not to adjudicate rules.

**Standing design principle, going forward, not just for this doc**
(direct user instruction, 2026-10-23): assume every player's
connection is unreliable -- they WILL randomly refresh the page or
disconnect-and-rejoin mid-session. Default to treating that as a
no-op for whatever state they were part of, not a reason to drop them
from it, unless there's a real reason otherwise. Turn order's own
persistence requirement below is the concrete instance of this for
this doc specifically.

## Core features (in scope for this pass)

### 1. Turn-order tracker widget

A floating, non-modal, draggable + minimizable panel -- same shape the
old game's `turn_tracker_menu.gd` already had, styled closer to
Roll20's own turn-order tracker (explicit reference point, per user
call) than redesigned from scratch:

- **Add** a token to the order manually (any character/instance
  present in the world) -- the GM's manual-override path; most entries
  are expected to arrive via "Initiative rolls" below instead.
- **Remove** a single entry (old game's per-row "x").
- **Clear All**.
- **Next Turn** -- advances `current_index`, wrapping back to 0 and
  incrementing a round counter on wrap (direct port of the old game's
  logic). Triggers the Reset Turn snapshot below. **GM-only** --
  confirmed by direct user call ("Only the GM should be able to click
  next turn"), a deliberate change from the old game's own
  no-permission-check behavior, not a port of it. **Real clarification
  found during phase 1 playtesting**: "GM-only" here means the real
  admin/owner permission check stays server-side-enforced regardless,
  but the CLIENT only shows/enables these controls when that admin
  ALSO has the G-key `gmOverride` toggle on -- "the gm should be able
  to see what players will see" by toggling it off. Applies to every
  "GM-only" item in this doc, not just Next Turn.
- Header shows round number + whose turn it notionally is.
- Reordering is **up/down buttons per row**, not drag-and-drop --
  drag-and-drop was tried during phase 1 and dropped after a direct
  playtest verdict ("I just tried it as GM and it's pretty bad").
  Stays available for manual correction, on top of whatever the
  automatic roll-value sort "Initiative rolls" below (once built) or
  the phase-1 GM-editable roll number + manual Sort ascending/
  descending buttons produce.
- **Persists across a disconnect/refresh/rejoin** -- who's in the
  order, whose turn it is, and the round number all survive a session
  dropping and reconnecting (see the Philosophy section above: a mid-
  combat internet glitch must not remove that player from combat).

### 2. Initiative rolls → turn order

Real correction replacing an earlier, wrong "Add Me" framing: a plain
"add yourself" button doesn't work once one character sheet can back
several independent placed instances (five goblins sharing one
"Goblin" sheet). The real flow, in the user's own words:

> there should be a function in the character sheet that will take a
> number and send that to the turn order given the currently
> controlled token, and put the instance of that token in the 3d game
> as the one in the turn order, so if we have 5 goblins with 1
> character sheet, I can tab between them, press 'initiative roll',
> the roll will be calculated, and then that roll will be sent to the
> initiative function, and then that function will send both that
> token instance and the roll result value to the turn tracker, and
> that turn tracker can then be organized based on that roll return
> value for each instance, high to low or low to high.

Concretely:

- **Real correction**: "Initiative Roll" is NOT its own bespoke,
  fixed, one-per-sheet feature. The actual building block is making
  `[[notation]]` (item 0's existing dice notation, used today for
  inline chat-message evaluation) callable as a general **function**
  that calls the SAME rolling system chat already uses, returning a
  plain number -- not a one-off reimplementation scoped just to
  initiative. Direct correction: "just add `[[]]` roll eval as a
  function that calls the rolling system we already have... then we
  can give the result to any other function that uses it as well,
  which would be an 'initiative' function in this case." Once that
  primitive exists, "Initiative Roll" is just a sheet action composed
  from two already-general pieces: evaluate a `[[...]]` expression
  (the roll), then hand the result to "submit this value for the
  currently-piloted instance to the turn tracker" -- and the SAME
  roll-eval primitive is reusable by whatever else ends up wanting a
  computed number later, not re-derived per feature.
- That submit-to-tracker step operates on **whichever instance the
  pressing session is currently piloting** --
  `focusCycling.ts`'s Tab/Shift+Tab/Control "currently controlling"
  concept, which now actually exists.
- The result is sent, as one unit, to the turn tracker: `{instance
  identity, roll value}`. The tracker inserts or updates that
  instance's own entry and keeps the whole list sorted by roll value
  (high-to-low or low-to-high -- a per-tracker configurable setting,
  GM's choice, not a hardcoded direction).
- Manually-`Add`ed entries (no roll value) sort as a separate concern
  from the above -- exact interaction left open below.
- **Partial precursor already shipped in phase 1**: every entry
  (manually-added or not) now has a GM-editable roll NUMBER (defaults
  to 0) and GM-only Sort ascending/descending buttons that sort the
  whole order by it -- a manual stand-in for "keep the whole list
  sorted by roll value" above, built ahead of the `[[]]` roll-eval
  submit path this section describes. The automatic
  "roll → submit → auto-insert-sorted" flow itself is still not built;
  only the number + manual sort exist so far.

### 3. Reset Turn / Ctrl+Z+Ctrl+Y (real correction, 2026-10-24: reverses the earlier "Ctrl+Z is the wrong mechanism" call)

**History of this section, for context**: the first draft of this doc
scoped Ctrl+Z as a single special-cased "revert to turn start" action,
decided that was the wrong framing, split "Reset Turn" out as plain
buttons/a context-menu item instead, and pushed "a real general-
purpose Ctrl+Z undo history" to `docs/DEFERRED.md`. **That deferral is
now reversed** (direct user call, 2026-10-24): "Reset turn would be
nice but let's just add that in with a whole ctrl+z ctrl+y system
which would include placing and removing blocks as well, and
potentially movement/controls or at least pose snapshots." So this is
now ONE feature again -- a real multi-step Ctrl+Z/Ctrl+Y undo/redo
history whose scope explicitly includes block placement/removal and
the turn-start revert this section always described, plus possibly
movement/pose snapshots. **Not started yet** -- sequenced after
"Measurement shapes" below (see that section's own note on why
distance measurement, not this, is the actual next priority). Treat
everything below as the STILL-VALID shape of the turn-revert half of
this feature; the block-undo/pose-snapshot half needs its own design
pass once work on it actually starts (what exactly "pose" snapshots
means -- just position/yaw, or full movement state -- is explicitly
open).

The turn-revert problem being solved, unchanged from the original
framing: *"if it's A's turn, and someone moves their character around
to see something then forgets where they went... so that A can start
their turn in an actual fair setup."*

- Every time **Next Turn** fires, snapshot every character currently
  in the turn order (position + relevant stat values) as of that
  moment. **Stored as a diff against live state**, not a full copy --
  confirmed by direct user call ("would need less storage and would
  rarely cause issues"). Likely the same storage shape the new block-
  edit undo history wants too (a diff-based change log), though that's
  not confirmed -- worth checking for shared implementation once this
  is actually picked up.
- **"Reset char"**: a right-click context-menu item on a token's own
  ROW in the turn-tracker widget (a separate context menu from the
  existing 3D-world token right-click menu, scoped to the tracker
  itself) -- reverts that one character/instance (position + stats) to
  its state at the start of the current turn. Chosen over a keybind on
  purpose: "the context menu makes more sense since there can only be
  so many buttons."
- **A GM-only button**, visible only to GMs, that applies the same
  revert to EVERY character in the order at once -- for when not
  everyone remembers to self-correct individually.
- Scoped to while the turn tracker is actively running an order --
  there's no snapshot to revert to otherwise.
- **Ctrl+Z/Ctrl+Y now ARE live keybinds** for the general undo/redo
  history (real reversal of the earlier "no keybind... a keybind can
  be decided later" framing, which only applied to the turn-revert-
  alone version of this feature) -- scope/interaction with block
  placement/removal and movement/pose is still open design work, not
  specified further here yet.

### 4. Waypoint / distance measurement

Ported close to the old game's `battle_mode_manager.gd`, confirmed via
direct user call ("port close to as-is").

**Correction** (2026-10-23): the earlier claim here that M/N were
"completely unused anywhere in this codebase" was WRONG -- the grep
behind it only matched `event.code === "KeyM"`-style comparisons and
missed `pageManager.ts`'s own `event.code !== "KeyM"` (a negated
check, different pattern, same collision), which is the real page/
world-switch hotkey. Resolved by moving pages to **P** instead
(confirmed free, same thorough re-check this time) -- M stays free
for this section's own use. N remains confirmed free either way.

- **UI panel, not keybind-only** -- real correction, this round:
  "since it's only appearing when turn order is there, I think we
  should just attach it as a panel to the turn order on the right of
  it." A collapsible panel docked to the RIGHT edge of the turn-order
  tracker widget (`turnTracker.ts`), not a separate floating panel of
  its own -- follows the tracker's own position when it's dragged,
  and is visible whenever the tracker itself is, **regardless of
  whether the turn order currently has any entries** -- real
  correction: the panel's own visibility is cosmetic/per-client (the
  tracker can be opened/closed by anyone, at any time), so it isn't
  the right signal for "is distance measurement relevant right now"
  -- that's the `waypointsEnabled` state below instead, which gates
  whether the panel's buttons/M/N actually DO anything, not whether
  the panel exists. Three buttons: **`W+`** (add waypoint) and
  **`W-`** (revert waypoint) -- plain text labels for now, real icons
  later -- each triggering the EXACT same action its keybind does (M /
  N respectively, including N/`W-`'s own "walk back to the last
  waypoint first" semantics below); and a GM-only **on/off toggle**
  (see below) for `waypointsEnabled` itself. Hovering `W+`/`W-` shows
  a tooltip spelling out the keybind: "Add waypoint (M)" / "Revert
  waypoint (N)".
- **M** marks a waypoint at the player's current position; **N**
  removes it -- same "walk back to the last waypoint first, then a
  second press actually removes it" semantics the old game had (so you
  can't accidentally delete a waypoint you've since wandered away
  from).
- A selectable distance metric (Manhattan / Euclidean / Minkowski-n),
  matching `GameSettings`' old equivalent -- lives as a GM-only
  dropdown inside the panel's expanded state (a world-level setting
  shared by everyone's displayed distances, not a per-player one, same
  as the old `GameSettings` equivalent).
- Waypoints snap to voxel-grid centers by default.
- **Every consecutive pair of waypoints gets its own distance label on
  the segment between them** -- real correction: this is NOT just
  about a single live segment from the last waypoint to the player.
  With waypoints W1, W2, W3 placed in order: the W1-W2 segment shows
  its own distance, the W2-W3 segment shows its own distance, each
  independently, same as the old game's per-segment labels. On top of
  that, there's additionally one more live segment from the LAST
  placed waypoint to the player's current position, continuously
  updating as they move (this one line is the only "live" one; every
  waypoint-to-waypoint segment is fixed once both its endpoints are
  placed).
- Visuals: yellow sphere markers + cylinder "line" segments, each
  segment carrying a 3D billboard distance label.
- **Reuse this project's existing billboard mechanism** (real
  direction: "we should try to use the same billboard system or close
  to it") -- `characterToken.ts`'s `@babylonjs/gui`-based billboard
  plane is the thing to extend for these distance labels, not a
  separate one-off text-rendering approach. Also check the old Godot
  game's own billboard node type (`Label3D`/`Sprite3D`-equivalent) for
  anything worth matching beyond "it's a billboard."
- LMB/RMB stay free for their existing jobs (block edit / item use,
  voxelEditor.ts) -- M/N only, matching the old game's own split.
- **Finalize**: bound to **Enter** ("I don't think anything else is
  using it at this point"). Confirmed true for the global/uncaptured
  case, but Enter IS already used while focus is inside a text input
  -- `chatPanel.ts`'s compose box sends on Enter, and `openStatEditor`'s
  bar-value `<input>` commits on Enter. The Finalize handler MUST use
  the same `isCaptured()`/`document.activeElement` guard this codebase
  already applies to Tab (`focusCycling.ts`) and Escape (`hotbar.ts`),
  or it will hijack Enter while someone's typing in chat or editing a
  stat value.
- **`waypointsEnabled`: a real, server-authoritative, per-world
  on/off state** -- real correction, replacing the first draft's
  attempt to derive this purely from entry count. "These waypoints
  should be on whenever turn order is on" is still the DEFAULT
  behavior, but it's now an explicit, GM-adjustable mechanism, not an
  always-on derived rule, because the GM needs a way to override it
  either direction (see "tricky" below):
  - **Auto-ON**: when the turn order goes from 0 entries to its FIRST
    entry (empty → non-empty), `waypointsEnabled` is set to `true` --
    but only if the GM settings checkbox **"Waypoint system auto-on
    when 1+ character turns"** (default ON) is checked.
  - **Auto-OFF**: when the turn order goes from 1+ entries down to 0
    (its LAST entry removed/cleared), `waypointsEnabled` is set to
    `false` -- but only if the GM settings checkbox **"Waypoint
    system auto-off when 0 character turns"** (default ON) is
    checked.
  - Both checkboxes live in `chatPanel.ts`'s existing GM-only tab
    (same place `seeThroughWalls`/mod enable-disable already live),
    default ON, per-GAME (not per-world) same as every other GM
    setting there.
  - **Manual override**: the waypoint panel's own on/off toggle
    button (GM-only) sets `waypointsEnabled` directly, at ANY time,
    regardless of the current entry count or either checkbox. This is
    genuinely "tricky," confirmed directly by the user ("...kinda
    tricky") -- the manual value STICKS until the next 0→1+ or 1+→0
    TRANSITION whose own checkbox is checked, which then overwrites
    it again unconditionally. A manual toggle made mid-combat (entry
    count staying non-zero the whole time) is never touched by either
    auto-rule, since neither transition happens again until the order
    actually empties and refills.
  - **Gated the same way every other "GM-only" turn-tracker control
    now is** (real correction from the turn-tracker phase-1 round):
    the toggle button and both checkboxes are admin-only server-side,
    but the CLIENT only shows them to an admin who also has the G-key
    `gmOverride` toggle on, so a GM previewing the player view (G off)
    doesn't see any of them.
  - M/N and the panel's `W+`/`W-` buttons do nothing for EVERYONE,
    GM included, while `waypointsEnabled` is `false`.

- **Distance labels read through the "ft per voxel" world setting**
  (real correction, 2026-10-24) -- introduced in section 6's own
  "Measurement shapes" settings below, defaults to 5, and applies HERE
  too, not just to the new shapes: a label shows feet (voxels × ft-
  per-voxel), not a bare voxel count.

### 5. Character-size-aware waypoint markers

Marker/line scale (and the wireframe-box variant mentioned in the
porting checklist) should account for a character's actual body size
(`bodyWidth`/`bodyHeight`/`bodyDepth` -- real, live sheet variables as
of this round's earlier work, not a fixed constant the old game had no
equivalent of). Confirmed in scope for this pass (low-risk, the sizing
data already exists for other reasons).

### 6. Measurement shapes (distance chain, cube, sphere, cone, beam)

**The actual next priority** (direct user call, 2026-10-24), ahead of
Initiative Rolls and the Reset Turn/Ctrl+Z+Ctrl+Y system above:
"distance measurement makes more sense" to build next than Initiative
Rolls, which isn't MVP-blocking since a GM can already type a roll
number in by hand (phase 1's own GM-editable roll field). Not started
yet -- this section is the requirements pass, same as every other
section in this doc before it was built.

Its own floating, non-modal panel -- **NOT** docked to the turn
tracker, unlike the existing waypoint panel (real distinction, direct
user call: "this should have its own floating box, similar to how
the turn tracker had its floating ui"). Usable any time, independent
of turn order/combat state entirely -- `waypointsEnabled` and the
turn tracker are not involved.

**Shared interaction model, every shape type:**

- **Measure mode** -- real correction, 2026-10-24: "Measure should be
  the distance button in the mode panel. It should put you in measure
  mode, and you control and tab through the points then, not the
  character, and the view/camera remain in place while the wasd space
  shift are pressed and while the mouse moves." The mode-panel's own
  "Distance" button (`modePanel.ts`, previously stubbed) is the real
  entry point -- a THIRD exclusive mode alongside Default/Select.
  While active: character movement is frozen entirely (WASD/Space/
  Shift are repurposed for point-editing below, not movement), and
  the camera does not rotate from mouse movement (same free-cursor
  state Select mode already has) -- aiming to place a NEW point still
  works via the free cursor's own click/ghost-preview, same as always,
  just with the 3D view itself held fixed rather than mouse-look-
  rotatable. Picking a shape-type button in the measurement panel
  also auto-enters Measure mode as a convenience; clicking Default or
  Select exits it again (not a second click on Distance itself).
- Clicking a shape-type button in the panel starts placing that
  shape. The first click (on terrain OR a character instance, same
  target choice waypoints/`characterPlacement.ts` already support)
  places the first point -- real correction, 2026-10-24: this is
  ALWAYS a real click, never auto-seeded from the player's current
  position ("when I select a shape it should reset the points" -- the
  first implementation wrongly seeded point 1 from the player's live
  position the moment a shape type was picked, which is why every
  shape looked like it "started from the character" whether or not
  that was ever clicked).
- Moving the mouse afterward shows a live PREVIEW of where the NEXT
  point would land if clicked now -- the same ghost-preview mechanism
  `characterPlacement.ts` already has for dropping a character onto
  the world.
- The most-recently-placed point is selected by default.
- **WASD** moves the selected point exactly like it moves a
  character instance, just a single voxel step at a time instead of
  continuous -- real correction, 2026-10-24: "there shouldn't be a
  left right handedness issue since the wasd should be controlling
  the point similar to a character instance just snapped to voxel."
  The SAME camera-heading-relative direction formula every real
  movement provider in this codebase already uses (MoverResource.ts/
  SwimResource.ts/NoclipFlyProvider.ts), not a separate "snap the
  direction to one of 4 cardinal axes" scheme -- only the STEP SIZE
  (one voxel per press, rounded) is what "snapped to voxel" means
  here, not the direction itself.
- **Space** moves the selected point up one voxel; **Shift** moves it
  down one voxel.
- **Tab** selects the next point; **Shift+Tab** selects the previous
  one -- wraps at either end (last point -> first, first point ->
  last).
- **Snap mode**: center / corner / free -- whether a placed/moved
  point snaps to a voxel's center, a voxel's corner, or doesn't snap
  at all. Exact scope (global panel setting vs. per-point) not yet
  specified.
- **Broadcast to others** checkbox -- whether this measurement object
  is visible to every connected session, or stays local/private to
  whoever placed it.
- Each session has ONE current measurement object at a time -- same
  "one chain" precedent waypoints already established (starting a new
  one replaces whatever was active before).
- Once placed/finalized, a measurement object PERSISTS in the world
  (it does not auto-clear), rendered semi-transparent. **Right-
  clicking it in the 3D world opens a context menu** (real correction,
  2026-10-24: not an immediate delete) -- scoped separately from the
  existing character-token context menu, same "its own menu, not
  reusing an unrelated one" precedent "Reset char"'s own tracker-row
  context menu already set. For now its only entry is **Delete**. The
  panel also has its own "remove my current measurement object"
  button, so deleting one doesn't strictly require aiming a right-
  click at it in the 3D view.
- **Every shape gets its own measurement billboard** (real correction,
  2026-10-24, resolving what was an open question above), reusing the
  SAME billboard mechanism waypoints already use
  (`characterToken.ts`'s billboard plane).
  - **Sizing -- ONE shared function for every shape, except the
    distance chain and beam** (real correction, 2026-10-24: "these
    should all be using the same function to keep the code clean"):
    compute the AXIS-ALIGNED BOUNDING BOX that contains the shape
    (for a cube that's just the cube itself; for a sphere, its
    bounding box; for a cone/frustum, the bounding box of its own
    mesh), then size the billboard exactly as if a CHARACTER had that
    bounding box as its own body dimensions -- the same scale formula
    a character's billboard already uses, fed this AABB's own LARGEST
    axis (real correction, 2026-10-24: "should probably select the max
    largest axis, since I just made a wide short box and it had a tiny
    billboard" -- not just the AABB's height; applies to the
    character's own billboard sizing in net.ts too now, not only
    measurement shapes: `max(bodyWidth, bodyHeight, bodyDepth)`
    instead of `bodyHeight` alone). One function, called with a
    different box per shape, not four separate sizing rules. The
    distance chain and beam are excepted -- their billboards stay the
    existing fixed/default size (a thin
    line's own AABB wouldn't produce a meaningful character-equivalent
    box), same as the waypoint system's segment labels already are.
  - **Positioning -- per shape**:
    - **Distance chain**: same as the existing waypoint system -- one
      label per segment, positioned at that segment's own midpoint.
    - **Cube**: above the cube.
    - **Sphere**: above the sphere.
    - **Beam**: above its MIDDLE, same positioning style the waypoint
      system already uses for a segment's label.
    - **Cone/frustum**: above the mesh's own TOPMOST VERTEX along the
      vertical axis (global Y, or whichever axis is "up" in this
      engine) -- real correction, 2026-10-24: NOT "the tip for a
      pointed cone, the near-cap's topmost point for a frustum"
      (wrong -- that framing assumes a fixed orientation; rotate the
      shape in roll/pitch/yaw and the geometric tip is no longer
      necessarily the topmost point at all). Since a cone/frustum is
      approximated as a mesh (a true point at the near end always,
      plus points arranged around the far end's own base -- circular
      for a cone, 4 corners for a frustum, see this section's own
      cone/frustum bullet -- no true curved geometry), "topmost
      vertex by the up-axis" is a single rule that already handles
      every rotation correctly, tip-vs-cap
      distinction or not -- no special-casing needed.
  - Exact TEXT content per solid shape (radius? full dimensions? both?)
    still open -- see "Open questions" below.

**Per-shape point count and meaning:**

- **Distance chain**: like the existing waypoint chain, but its own
  separate tool/object, independent of the turn-tracker-gated waypoint
  feature. Arbitrary number of points; each consecutive pair gets its
  own distance-labeled segment, same as waypoints already do. Tab
  cycles through every placed point, not just two.
- **Cube**: exactly 2 points, opposite corners. Tab toggles between
  them. Shows a ghost cube preview following the mouse until the
  second point is actually placed/confirmed.
- **Sphere**: 2 points -- the first is the center, the second sets
  only the RADIUS (its distance from the center), not an independent
  3D position. Tabbable between the two, same as cube.
- **Cone**: a start point and an end point (its axis), plus a numeric
  **degrees** setting (the cone's angle) and a toggle between **cone**
  and **frustum**. Real correction, 2026-10-24 (the earlier "truncated
  cone with a flat near-cap" framing was wrong): BOTH options are a
  true point at the near end, always -- "it's a cone/frustum from a
  point." The toggle only changes the FAR end's own cross-section
  shape: **cone** = round, **frustum** = "just a rectangle/square end
  instead of circular" (a square-based pyramid, not a truncated
  cone). **Point order is fixed and confirmed**: "it should still be
  first point start and second part wide flat part" -- the FIRST
  point placed is always the narrow/point end, the SECOND is always
  the wide flat end, regardless of which one happens to be nearer the
  player when placing.
- **Beam**: a start point and an end point, plus a numeric **beam
  width** setting.
- Each shape type's own settings (degrees/frustum toggle for cone,
  width for beam) show in the panel while that shape type is active --
  "each of these at least some UI."

**Settings:**

- **ft per voxel**: a new per-world setting (lives in the world's own
  settings/detail page, same place the generator/its params already
  live), defaulting to **5** -- converts voxel-unit distances into a
  feet display for every distance label this tool shows. **Real
  correction, 2026-10-24: this ALSO retroactively applies to the
  existing waypoint system's own distance labels** (section 4 above) --
  resolves what was an open question below; both features now read
  through this one setting, not two independent ones.

## Explicitly OUT of scope for this pass

Tracked in `docs/DEFERRED.md` under "From item 6" instead of here:

- **Terrain & multi-projective drawing.** Explicitly scoped by the
  user as later work, not part of this pass or the measurement-shapes
  section above ("the drawing on ground later on would just draw on
  ground with an offset..."). Full technical capture lives in
  `docs/DEFERRED.md`, not repeated here. Related to, but a fresh/
  different design from, the existing voxel-fill draw tools already
  scoped in `docs/PORTING_CHECKLIST.md`'s Phase 7 (DM tools) -- that
  entry predates this one and should be reconciled with it once this
  is actually picked up.
- **Auto-triggering an encounter** (some trigger condition starts
  battle mode automatically, with AI/end-condition behavior). Real
  user call: "while it's fun, it's not quite vtt." The original old-
  game TODO left trigger/AI/end-condition all unspecified anyway --
  there's no existing design to even port.
- **Line-of-sight lines.** Real user call: "actually helpful... but
  out of scope for the MVP stuff... might come up as a needed feature
  for some games later." Also blocked on Phase 10 (AI/vision cones)
  existing first, per the porting checklist.

**Not a gap at all, confirmed by direct user call**: a dedicated dice-
roller + per-turn character-action menu was flagged as a possible gap
in the old porting checklist, but is already substantially covered by
existing, unrelated work -- chat/dice (item 0) and the character-sheet
system (item 4) -- so no NEW battle-specific UI is needed for it here.

## Gherkin scenarios

```gherkin
Feature: Turn-order tracker

  Scenario: Advancing to the next turn (GM only)
    Given the turn order has characters [A, B, C] and it is A's turn
    When the GM clicks "Next Turn"
    Then it becomes B's turn
    And the round number is unchanged

  Scenario: A non-GM session cannot advance the turn
    Given the turn order has characters [A, B, C] and it is A's turn
    When a non-GM session attempts to advance the turn
    Then nothing changes -- it is still A's turn

  Scenario: Wrapping the order increments the round
    Given the turn order has characters [A, B, C] and it is C's turn
    When the GM clicks "Next Turn"
    Then it becomes A's turn
    And the round number increases by 1

  Scenario: Turn order is advisory, not enforced
    Given the turn order has characters [A, B, C] and it is A's turn
    When a session controlling character B moves or acts
    Then the action succeeds normally
    And nothing in the system blocks or flags it

  Scenario: Turn order survives a disconnect and rejoin
    Given a turn order is running with character B mid-combat
    When the session controlling B disconnects and rejoins
    Then B is still in the turn order, in the same position, unaffected

Feature: Initiative rolls

  Scenario: Rolling initiative adds the currently-piloted instance
    Given a session is currently piloting one specific placed instance
      of a character
    When that session presses "Initiative Roll" on that character's sheet
    Then a roll value is computed
    And that specific instance (not just the character) is added to the
      turn order with that roll value

  Scenario: Several instances of the same character each get their own entry
    Given one character sheet backs five separately placed goblin instances
    When a session tabs between them and presses "Initiative Roll" for each
    Then the turn order contains five separate entries, one per instance,
      each with its own independently rolled value

  Scenario: The turn order sorts by roll value
    Given multiple instances have been added via "Initiative Roll" with
      different values
    When the sort direction is set to high-to-low
    Then the turn order lists them from highest roll value to lowest

Feature: Reset Turn

  Scenario: A snapshot is taken on every turn advance
    Given the turn order is running
    When the GM clicks "Next Turn"
    Then every character currently in the turn order has its position and
      relevant stats captured (as a diff against live state) for "the
      start of the new current turn"

  Scenario: A player resets their own character via the turn-order menu
    Given it became A's turn one minute ago
    And a session controlling character B moved B away from where B was
      when A's turn started
    When that session right-clicks B's row in the turn tracker and
      selects "Reset char"
    Then B's position and stats revert to what they were when A's turn started

  Scenario: The GM resets everyone at once
    Given it became A's turn, and several characters have since drifted
    When the GM clicks the GM-only "reset everyone" button
    Then every character's position and stats revert to what they were
      when A's turn started

  Scenario: The GM-only reset-everyone button is not visible to non-GMs
    Given a non-GM session has the turn tracker open
    Then that session does not see a "reset everyone" button at all

Feature: Waypoint distance measurement

  Scenario: Marking a waypoint
    Given a player is standing at some position
    When they press M
    Then a yellow waypoint marker is placed at their current position,
      snapped to the nearest voxel-grid center

  Scenario: Distance is shown between two placed waypoints
    Given waypoints W1 and W2 have both been placed, in that order
    Then a line segment with its own live-updating 3D distance label
      connects W1 to W2, independent of the player's current position

  Scenario: Each additional waypoint adds its own segment and label
    Given waypoints W1 and W2 already exist with a labeled segment
      between them
    When the player places a third waypoint, W3
    Then a second segment with its own distance label connects W2 to W3
    And the W1-to-W2 segment and label are unchanged

  Scenario: A live segment also tracks the player from the last waypoint
    Given at least one waypoint has been placed
    When the player moves
    Then a line segment and a live, updating 3D distance label are shown
      from the LAST placed waypoint to the player's current position,
      separate from any waypoint-to-waypoint segments

  Scenario: Removing a waypoint requires standing on it
    Given a waypoint exists and the player has walked away from it
    When they press N
    Then they are moved back to that waypoint first, and it is NOT removed

  Scenario: Removing a waypoint while standing on it
    Given a waypoint exists and the player is standing exactly on it
    When they press N
    Then that waypoint is removed

  Scenario: Finalizing the current waypoint chain
    Given one or more waypoints are placed
    When the player presses Enter outside of any text input
    Then the current waypoint chain is committed/cleared explicitly,
      without needing to end the current turn to do it

  Scenario: Enter does not finalize while typing
    Given a player's focus is in the chat compose box or a stat-edit input
    When they press Enter
    Then that input's own normal Enter behavior happens
    And no waypoint chain is finalized

  Scenario: Waypoints turn on automatically with the turn order (default)
    Given the turn order is EMPTY and `waypointsEnabled` is false
    And the GM settings checkbox "Waypoint system auto-on when 1+
      character turns" is checked (the default)
    When a character is added to the turn order (0 -> 1 entries)
    Then `waypointsEnabled` becomes true, and the waypoint/distance
      system becomes active for all players

  Scenario: Waypoints turn off automatically when the turn order empties (default)
    Given the turn order has 1 entry and `waypointsEnabled` is true
    And the GM settings checkbox "Waypoint system auto-off when 0
      character turns" is checked (the default)
    When that last entry is removed (1 -> 0 entries)
    Then `waypointsEnabled` becomes false for everyone

  Scenario: The GM can disable the auto-on checkbox
    Given the GM settings checkbox "Waypoint system auto-on when 1+
      character turns" is UNCHECKED
    And the turn order is EMPTY and `waypointsEnabled` is false
    When a character is added to the turn order (0 -> 1 entries)
    Then `waypointsEnabled` stays false -- the GM must turn it on
      manually via the panel's own toggle

  Scenario: The GM can disable the auto-off checkbox
    Given the GM settings checkbox "Waypoint system auto-off when 0
      character turns" is UNCHECKED
    And the turn order has 1 entry and `waypointsEnabled` is true
    When that last entry is removed (1 -> 0 entries)
    Then `waypointsEnabled` stays true -- a GM measuring distances
      between combats doesn't get interrupted

  Scenario: The GM's manual toggle overrides the current state
    Given the turn order has 2 entries and `waypointsEnabled` is true
    When the GM clicks the panel's own on/off toggle
    Then `waypointsEnabled` becomes false, even though the turn order
      still has entries in it (neither auto-rule applies -- no 0<->1+
      TRANSITION happened)

  Scenario: A later transition still overrides a manual toggle
    Given the GM manually turned `waypointsEnabled` OFF while the turn
      order had 2 entries (as in the scenario above)
    And "Waypoint system auto-off when 0 character turns" is checked
    When the turn order is later cleared down to 0 entries
    Then `waypointsEnabled` becomes false (already was, no visible
      change) -- but if it had instead gone from 0 back up to 1+ with
      auto-on checked, it would flip back to true, overriding the
      GM's earlier manual OFF

  Scenario: M/N and the panel's W+/W- do nothing while disabled
    Given `waypointsEnabled` is false
    When a player presses M, presses N, or clicks "W+"/"W-"
    Then nothing happens -- no waypoint is placed, moved to, or removed

  Scenario: The manual toggle button is GM-only, gated by G-key mode
    Given a turn order is running
    When a GM with G-key mode OFF looks at the waypoint panel
    Then the on/off toggle button is not visible to them, same as the
      turn tracker's other GM-only controls
    When that GM turns G-key mode back ON
    Then the toggle button appears again

Feature: Waypoint panel UI (docked to the turn-order tracker)

  Scenario: The panel is docked to the right of the turn tracker, regardless of entry count
    Given the turn tracker widget is visible
    Then a waypoint panel appears attached to the RIGHT edge of it,
      not as its own independent floating panel -- even if the turn
      order is currently EMPTY

  Scenario: The panel follows the tracker when it's dragged
    Given the waypoint panel is docked next to the turn tracker
    When the player drags the turn tracker to a new position
    Then the waypoint panel moves along with it, staying docked to its
      right edge

  Scenario: The panel is hidden whenever the turn tracker itself is hidden
    Given the turn order is running and waypoints are active
    When the player closes/hides the turn tracker widget
    Then the waypoint panel is hidden too, even though waypoints are
      still technically active

  Scenario: The panel is collapsible, independent of the tracker's own minimize state
    Given the waypoint panel is visible, expanded
    When the player clicks the panel's own collapse control
    Then the panel shrinks to a minimal form (buttons only, no expanded
      settings like the metric dropdown)
    And the turn tracker's own minimize state is unaffected

  Scenario: W+ places a waypoint, same as pressing M
    Given the waypoint panel is visible
    When the player clicks "W+"
    Then a waypoint is placed at their current position, identically
      to pressing M

  Scenario: W- reverts a waypoint, same as pressing N (including the walk-back-first guard)
    Given the waypoint panel is visible and the player has walked away
      from the last placed waypoint
    When the player clicks "W-"
    Then they are moved back to that waypoint first, and it is NOT
      removed -- identical to pressing N while not standing on it

  Scenario: Hovering a panel button shows its keybind as a tooltip
    Given the waypoint panel is visible
    When the player hovers "W+"
    Then a tooltip reading "Add waypoint (M)" appears
    When the player hovers "W-"
    Then a tooltip reading "Revert waypoint (N)" appears

  Scenario: A non-GM session sees the panel's W+/W- but not the toggle or the metric dropdown
    Given a non-GM session has the waypoint panel open, expanded
    Then "W+"/"W-" are visible and usable (everyone can place/revert
      their OWN waypoints, as long as `waypointsEnabled` is true)
    And the on/off toggle button and the distance-metric dropdown are
      not visible to them

Feature: Measurement shapes (its own panel, independent of the turn tracker)

  Scenario: The panel is its own floating window, not docked to the turn tracker
    Given no turn order is running at all
    When a session opens the measurement-shapes panel
    Then it appears as its own independent floating window
    And it is fully usable with no turn order and no `waypointsEnabled` state involved

  Scenario: Clicking Distance in the mode panel enters Measure mode, freezing movement and camera look
    Given a session is in Default mode, free to move and look around
    When they click "Distance" in the mode panel
    Then character movement stops responding to WASD/Space/Shift
    And mouse movement no longer rotates the camera
    And the panel's own shape-type buttons are now the way to start placing something

  Scenario: Selecting a shape type also enters Measure mode as a convenience
    Given a session is in Default mode, not yet in Measure mode
    When they select a shape type directly from the measurement panel
    Then Measure mode becomes active, same as clicking "Distance" first would have

  Scenario: Clicking Default or Select exits Measure mode
    Given a session is in Measure mode
    When they click "Default" (or "Select") in the mode panel
    Then character movement and camera look both work normally again
    And whatever shape was still being placed (not yet finalized) is discarded

  Scenario: Selecting a shape type never auto-seeds a point from the player's position
    Given a session has just selected a shape type, with no click in the 3D world yet
    Then no point exists yet at all -- not even one at the player's own current position
    When they click somewhere in the 3D world
    Then THAT click places the first point, wherever it was aimed

  Scenario: Selecting a DIFFERENT shape type resets the points, discarding whatever was in progress
    Given a session has placed one point of a "Cube" and not yet finished it
    When they select "Sphere" instead
    Then the cube's in-progress point is discarded
    And the sphere starts completely fresh, with no points carried over

  Scenario: Starting a distance chain and placing its first point
    Given the measurement-shapes panel is open
    And the session is in Measure mode
    When they select "Distance chain" and click on terrain
    Then a first point is placed there, and it becomes the selected point

  Scenario: A live preview follows the mouse before the next point is placed
    Given a shape is actively being placed and has at least one point so far
    When the session moves the mouse over new terrain (not yet clicking)
    Then a ghost preview of the next point's position follows the cursor
    And no new point is actually placed until the next click

  Scenario: A distance chain supports more than two points, each segment labeled independently
    Given a distance chain has points P1 and P2 placed, with a labeled
      segment between them
    When a third point P3 is placed
    Then a second labeled segment connects P2 to P3
    And the P1-to-P2 segment and its label are unchanged

  Scenario: Cube placement shows a ghost cube until the second corner is confirmed
    Given a session selects "Cube" and places its first corner
    When they move the mouse before placing the second corner
    Then a ghost preview of the resulting cube (first corner to the
      cursor's current position) follows the cursor
    And the real cube is not created until the second corner is placed

  Scenario: Sphere's second point sets only the radius, not an independent position
    Given a session selects "Sphere" and places its center point
    When they place a second point elsewhere
    Then the sphere's radius becomes the distance from the center to
      that second point, not an independent 3D position

  Scenario: Tab/Shift+Tab cycles through a shape's points, wrapping at the ends
    Given a distance chain has points [P1, P2, P3] and P3 is selected
    When the session presses Tab
    Then P1 becomes selected (wrapped from the last point back to the first)
    When the session then presses Shift+Tab
    Then P3 becomes selected again (wrapped from the first point back to the last)

  Scenario: WASD moves the selected point exactly like a character turns and moves, just one voxel step at a time
    Given a point is selected
    When the session presses W
    Then the selected point moves one voxel step using the SAME
      camera-heading-relative direction formula a real character's
      own movement already uses (not a separate direction-snapping
      scheme)
    And every other point is unaffected
    When the session's camera heading changes and they press W again
    Then the point moves in the NEW forward direction, same as turning
      and walking forward with a real character would

  Scenario: Space/Shift move the selected point up/down one voxel
    Given a point is selected
    When the session presses Space
    Then the selected point moves up by one voxel
    When the session then presses Shift
    Then the selected point moves back down by one voxel

  Scenario: Cone has a degrees setting and a cone/frustum toggle
    Given a session selects "Cone" and has placed its start and end point
    Then the panel shows a numeric "degrees" field and a toggle between
      "Cone" (round far end) and "Frustum" (square far end) -- both
      options are a true point at the near end, always

  Scenario: A cone's first point is always the narrow end, regardless of which point is nearer the player
    Given a session places a cone's FIRST point far away, then its
      SECOND point right next to themselves
    Then the far point (placed first) is the narrow/point end
    And the near point (placed second) is the wide flat end
    And this holds the same way even if the points are placed in the
      opposite physical arrangement -- point ORDER decides which end
      is which, not proximity to the player

  Scenario: Beam has a width setting
    Given a session selects "Beam" and has placed its start and end point
    Then the panel shows a numeric "beam width" field

  Scenario: A finalized measurement object persists in the world and is visually transparent
    Given a shape has been fully placed (all its required points set)
    Then it remains visible in the 3D world, rendered semi-transparent,
      and does not disappear on its own

  Scenario: Right-clicking a measurement object opens a context menu, not an immediate delete
    Given a finalized measurement object exists in the world
    When a session right-clicks it
    Then a context menu opens, with "Delete" as its only entry
    And the object is NOT deleted yet

  Scenario: Choosing Delete from that context menu removes the object
    Given a session right-clicked a measurement object and its context
      menu is open
    When they select "Delete"
    Then that object is removed from the world

  Scenario: The panel's own "remove current" button deletes your active measurement object
    Given a session has an active/finalized measurement object
    When they click the panel's "remove my current measurement object" button
    Then that object is deleted, without needing to right-click it in the 3D view

  Scenario: Starting a new measurement object replaces the previous one
    Given a session already has one measurement object placed
    When that session starts placing a new one
    Then the previous one is removed -- each session has only ONE
      current measurement object at a time

  Scenario: The broadcast checkbox controls whether others see your measurement object
    Given a session is placing a measurement object with "Broadcast to
      others" UNCHECKED
    Then no other connected session sees that object
    When that session checks "Broadcast to others"
    Then every connected session sees it

  Scenario: Distance labels read through the world's "ft per voxel" setting
    Given a world's "ft per voxel" setting is 5 (the default)
    And two points are 3 voxels apart
    Then their distance label reads 15 ft, not "3" (a bare voxel count)

  Scenario: The "ft per voxel" setting also applies to the existing waypoint system
    Given a world's "ft per voxel" setting is 5 (the default)
    And two placed waypoints are 3 voxels apart
    Then their segment's distance label ALSO reads 15 ft, same
      conversion as a measurement-shape label

  Scenario: A cube's billboard sits above it, sized via its own AABB (which for a cube is just itself)
    Given a cube has been placed with specific width/height/depth
    Then its billboard appears above the cube
    And its size matches whatever a character's own billboard would be
      IF that character's body dimensions equaled this cube's own
      axis-aligned bounding box (the SAME scale formula every other
      sized shape below also uses, not a fixed size)

  Scenario: A sphere's billboard sits above it, sized via its own bounding box through the SAME shared function
    Given a sphere has been placed with a specific radius
    Then its billboard appears above the sphere
    And its size matches whatever a character's own billboard would be
      IF that character's body dimensions equaled the sphere's own
      axis-aligned bounding box -- the exact same sizing function the
      cube scenario above used, just given a different box

  Scenario: A cone/frustum's billboard sits above its topmost vertex, regardless of rotation, sized via its own bounding box
    Given a cone (or frustum) has been placed and then rotated in
      roll/pitch/yaw to some arbitrary orientation
    Then its billboard appears above whichever of its own vertices has
      the highest value along the vertical (up) axis -- NOT
      necessarily its geometric tip or cap, since rotation can put
      either one anywhere
    And its size matches whatever a character's own billboard would be
      IF that character's body dimensions equaled the cone/frustum's
      own (rotation-aware) axis-aligned bounding box -- again, the
      SAME shared sizing function, not a shape-specific one

  Scenario: The distance chain and beam are excepted from AABB-based sizing -- they keep the existing fixed waypoint-style size
    Given a distance-chain segment and a beam have each been placed
    Then both of their billboards use the SAME fixed/default size the
      existing waypoint system's segment labels already use
    And neither one is sized via the AABB-to-character-scale function
      the cube/sphere/cone scenarios above use

  Scenario: A beam's billboard sits above its middle
    Given a beam has been placed between a start and end point
    Then its billboard appears above the segment's own midpoint, same
      positioning style the waypoint system already uses for a
      segment label

  Scenario: A distance chain's billboards match the waypoint system's own per-segment labels
    Given a distance chain has points P1, P2, and P3 placed in order
    Then each consecutive segment (P1-P2, P2-P3) has its own billboard
      at that segment's own midpoint, same as the waypoint system
```

## UI/interaction reference

- **Turn tracker**: Roll20's own turn-order tracker (explicit
  reference point, user call: "Roll20 (Recommended)") -- a small
  floating, draggable window (not docked/fixed), entries in order with
  the active entry visually distinguished, a round counter, drag-to-
  reorder. This project's own old game already converged on the same
  non-modal/draggable/add-remove/round-counter shape independently
  (`turn_tracker_menu.gd`) -- Roll20 is the reference for *polish and
  interaction details* more than a wholesale redesign. **One real
  divergence from Roll20, found during phase 1 playtesting**:
  drag-to-reorder itself was tried and dropped ("I just tried it as GM
  and it's pretty bad") in favor of plain up/down buttons per row.
- **Distance labels**: this project's own existing character-token
  billboard (`characterToken.ts`, `@babylonjs/gui`-based billboard
  plane) is the mechanism to reuse/extend, per direct user call --
  check the old Godot game's own billboard node setup for anything
  else worth matching.
- **Waypoint panel**: docked beside the turn tracker, not its own
  floating window -- no existing precedent for a panel attached to
  ANOTHER panel in this codebase (every other panel here is either a
  docked safe-area one or an independent floating one), so
  `turnTracker.ts`'s own position-tracking (its drag handler) is what
  the waypoint panel's position needs to follow, not a separate
  mechanism of its own.

## Open questions / assumptions still worth confirming

1. **Manual `Add` vs. roll-value sorting**: an entry added manually
   (no roll value) needs *some* defined position relative to rolled
   entries -- sort to one end, keep it pinned wherever manually placed,
   or something else. Not specified above.
2. **Sort-direction default**: high-to-low vs. low-to-high -- confirmed
   configurable, not which one is the default. **Resolved by the
   phase-1 UI, at least for the manual roll-number case**: there's no
   implicit default at all -- two explicit GM-only buttons ("Sort
   ascending"/"Sort descending"), picked each time, same as Roll20's
   own tracker leaves it to the GM rather than baking in one. Whether
   the FUTURE automatic "insert sorted on every Initiative Roll" path
   needs its own separate default is still open.
3. **"Reset char"/GM-reset-everyone has no keybind of its own** -- still
   true, but real correction 2026-10-24: this no longer means the
   WHOLE feature is keybind-free. Ctrl+Z/Ctrl+Y are now live keybinds
   for the broader undo/redo history this section is now part of (see
   section 3's own history note) -- just not bound specifically to
   "Reset char"/"reset everyone," which stay buttons/a context-menu
   item.
4. **No Finalize ("Enter") button in the waypoint panel**: the panel
   spec above only names `W+`/`W-` buttons, matching what was asked
   for directly -- Finalize stays keybind-only (Enter) for now. A
   third button could be added later if that turns out to matter in
   practice.
5. **The distance-metric dropdown's exact placement/behavior** (GM-only,
   inside the panel's expanded state, a world-level setting) is this
   doc's own best guess at where it should live -- never directly
   specified by the user, unlike everything else in this section.
6. **Measurement shapes' snap mode** (center/corner/free): whether this
   is one setting for the whole panel, one per shape type, or one per
   individual point, isn't specified.
7. **Measurement shapes' billboard POSITION is now specified for every
   shape** (resolved, 2026-10-24 -- see section 6's own billboard
   bullet). Still open: the exact TEXT content for the solid shapes'
   billboards (radius? full dimensions? both?) -- the distance chain's
   content is obvious (segment distance, same as waypoints).
8. ~~**Whether the existing waypoint distance labels should also read
   through the new "ft per voxel" world setting**~~ -- **resolved,
   2026-10-24**: yes, confirmed by direct user call. One setting, both
   features.
9. **Measurement-shapes point placement/movement isn't specified as
   network-synced or not**, beyond the "Broadcast to others" checkbox
   controlling whether the FINALIZED object is shared -- whether the
   live drag/placement-in-progress is itself visible to others (if
   broadcast is checked) or only becomes visible once finalized isn't
   specified.

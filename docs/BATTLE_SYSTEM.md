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

### 3. Reset Turn (replaces the earlier Ctrl+Z framing entirely)

**Real correction**: Ctrl+Z was the wrong mechanism. A real Ctrl+Z, if
ever built, should be a genuine multi-step undo history -- not a
single special-cased "revert to turn start" action wearing that
keybind. That real undo history is now `docs/DEFERRED.md` work, not
part of this pass. **No keybind at all for this feature right now** --
plain buttons and a context-menu item; a keybind can be decided later
once there's a reason to.

The actual problem being solved, unchanged from before: *"if it's A's
turn, and someone moves their character around to see something then
forgets where they went... so that A can start their turn in an
actual fair setup."*

- Every time **Next Turn** fires, snapshot every character currently
  in the turn order (position + relevant stat values) as of that
  moment. **Stored as a diff against live state**, not a full copy --
  confirmed by direct user call ("would need less storage and would
  rarely cause issues").
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

- **M** marks a waypoint at the player's current position; **N**
  removes it -- same "walk back to the last waypoint first, then a
  second press actually removes it" semantics the old game had (so you
  can't accidentally delete a waypoint you've since wandered away
  from).
- A selectable distance metric (Manhattan / Euclidean / Minkowski-n),
  matching `GameSettings`' old equivalent.
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
- **Waypoints are automatically active whenever a turn order is
  running**, not a separately-toggled mode -- real direction: "these
  waypoints should be on whenever turn order is on." The **GM can
  disable them** for a given turn order (a toggle, GM-only) -- useful
  for a pure roleplay/conversation-turn-order use case where distance
  measurement isn't relevant, as opposed to actual combat.

### 5. Character-size-aware waypoint markers

Marker/line scale (and the wireframe-box variant mentioned in the
porting checklist) should account for a character's actual body size
(`bodyWidth`/`bodyHeight`/`bodyDepth` -- real, live sheet variables as
of this round's earlier work, not a fixed constant the old game had no
equivalent of). Confirmed in scope for this pass (low-risk, the sizing
data already exists for other reasons).

## Explicitly OUT of scope for this pass

Tracked in `docs/DEFERRED.md` under "From item 6" instead of here:

- **A general-purpose, multi-step Ctrl+Z undo history.** Real
  correction: the earlier draft of this doc wrongly scoped Ctrl+Z as a
  single "revert to turn start" action. If a real undo history is
  ever built, it should actually be one -- not this. "Reset Turn"
  above is the actual feature; it's buttons/context-menu items, no
  keybind, for now.
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

  Scenario: Waypoints turn on automatically with the turn order
    Given no turn order is currently running
    When the GM starts a turn order
    Then the waypoint/distance system becomes active for all players

  Scenario: The GM can disable waypoints for a turn order
    Given a turn order is running with waypoints active
    When the GM disables waypoints for this turn order
    Then M/N/distance labels stop functioning until re-enabled,
      while the turn order itself keeps running
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
3. **"Reset char"/GM-reset keybind**, if any, is explicitly deferred
   ("we'll decide a keybind later") -- not blocking this pass.

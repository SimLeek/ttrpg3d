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
`next_turn()` has no permission/gating check at all -- anyone can
advance it) and that's being kept on purpose, not just inherited by
default. The system's job is to track and display whose turn it
notionally is, and to protect against the one real problem that
causes in practice (see "Per-turn fairness snapshot" below) -- not to
adjudicate rules.

## Core features (in scope for this pass)

### 1. Turn-order tracker widget

A floating, non-modal, draggable + minimizable panel -- same shape the
old game's `turn_tracker_menu.gd` already had, styled closer to
Roll20's own turn-order tracker (explicit reference point, per user
call) than redesigned from scratch:

- **Add** a token to the order (any character present in the world).
- **Add Me** -- adds whichever character the clicking session is
  currently piloting (`focusCycling.ts`'s "currently controlling"
  concept, which now actually exists -- it didn't when the old game
  built this).
- **Remove** a single entry (old game's per-row "x").
- **Clear All**.
- **Next Turn** -- advances `current_index`, wrapping back to 0 and
  incrementing a round counter on wrap (direct port of the old game's
  logic). Triggers the fairness snapshot below. *Assumed: any
  connected session can press this, matching the old game's own
  no-permission-check behavior -- confirm, or restrict to GM-only, if
  that assumption is wrong.*
- Header shows round number + whose turn it notionally is.

Reordering (drag a row to change initiative order) is standard for a
Roll20-style tracker and should be included, even though the old
game's version didn't have it -- the old version never needed it
because it had no real players using it as anything but a prop.

### 2. Per-turn fairness snapshot + undo

The actual real-world problem this is solving, in the user's own
words: *"if it's A's turn, and someone moves their character around to
see something then forgets where they went, they can press ctrl+z...
so that A can start their turn in an actual fair setup."*

- Every time **Next Turn** fires, snapshot EVERY character currently
  in the turn order (position + relevant stat values -- "the original
  position/stats of the characters should be kept, or at least a
  diff" -- diff-vs-full is an implementation choice, not a requirement,
  as long as the revert below is correct). This is a snapshot of the
  WHOLE board at the moment a new turn starts, not just the character
  whose turn it now is.
- **Ctrl+Z**, pressed by a session piloting character X, reverts X
  (position + stats) to its state at the START of the CURRENT turn --
  i.e., undoes any drift that happened since the last Next Turn, not a
  general-purpose multi-step undo history.
- The GM has the same capability applied to EVERY character at once in
  one action (a bulk revert), for the case where not everyone
  remembers to self-correct. Whether this reuses the same Ctrl+Z
  keybind (scoped by admin status) or is a separate explicit button
  ("Reset All to Turn Start") is an implementation detail to settle
  during design, not fixed here.
- This mechanic is scoped to while the turn tracker is actively
  running an order -- it has no meaning (and no snapshot to revert to)
  outside that.
- Standard web-app guard needed either way: Ctrl+Z must not fire while
  focus is in a text input (chat box, a stat-edit `<input>`, etc.),
  same `isCaptured()`/`document.activeElement` guard this codebase
  already uses for Tab (`focusCycling.ts`) and Escape (`hotbar.ts`).

### 3. Waypoint / distance measurement

Ported close to the old game's `battle_mode_manager.gd`, confirmed via
direct user call ("port close to as-is"), with one concrete change
already verified safe: **M and N are completely unused anywhere in
this codebase or in noa-engine's own defaults** (grepped both --
nothing binds them), so the old keys can be reused without a
collision, unlike the original worry.

- **M** marks a waypoint at the player's current position; **N**
  removes it -- same "walk back to the last waypoint first, then a
  second press actually removes it" semantics the old game had (so you
  can't accidentally delete a waypoint you've since wandered away
  from).
- A selectable distance metric (Manhattan / Euclidean / Minkowski-n),
  matching `GameSettings`' old equivalent.
- Waypoints snap to voxel-grid centers by default.
- Visuals: yellow sphere markers + cylinder "line" segments between
  consecutive waypoints, each segment carrying a live 3D billboard
  distance label (not a flat 2D HUD number) -- plus one live segment
  from the last placed waypoint to the player's CURRENT position,
  updated continuously, not just on waypoint placement.
- LMB/RMB stay free for their existing jobs (block edit / item use,
  voxelEditor.ts) -- M/N only, matching the old game's own split.
- **Upgrade over the old game** (roadmap's own prior wording, now
  concrete): a real **Finalize** action that commits/clears the
  current waypoint chain explicitly, instead of the old game's only
  reset path being "end turn happens to clear it."

### 4. Character-size-aware waypoint markers

Marker/line scale (and the wireframe-box variant mentioned in the
porting checklist) should account for a character's actual body size
(`bodyWidth`/`bodyHeight`/`bodyDepth` -- real, live sheet variables as
of this round's earlier work, not a fixed constant the old game had no
equivalent of). Confirmed in scope for this pass (low-risk, the sizing
data already exists for other reasons).

## Explicitly OUT of scope for this pass

Tracked in `docs/BACKLOG.md` under "From item 6" instead of here:

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

  Scenario: Adding the currently-controlled character to the order
    Given the turn tracker is open and empty
    When I click "Add Me"
    Then my currently-focused character appears as the last entry in the order

  Scenario: Advancing to the next turn
    Given the turn order has characters [A, B, C] and it is A's turn
    When anyone clicks "Next Turn"
    Then it becomes B's turn
    And the round number is unchanged

  Scenario: Wrapping the order increments the round
    Given the turn order has characters [A, B, C] and it is C's turn
    When anyone clicks "Next Turn"
    Then it becomes A's turn
    And the round number increases by 1

  Scenario: Turn order is advisory, not enforced
    Given the turn order has characters [A, B, C] and it is A's turn
    When a session controlling character B moves or acts
    Then the action succeeds normally
    And nothing in the system blocks or flags it

Feature: Per-turn fairness snapshot and undo

  Scenario: A snapshot is taken on every turn advance
    Given the turn order is running
    When "Next Turn" is clicked
    Then every character currently in the turn order has its position and
      relevant stats captured as "the start of the new current turn"

  Scenario: A player reverts their own drift
    Given it became A's turn one minute ago
    And a session controlling character B moved B away from where B was
      when A's turn started
    When that session presses Ctrl+Z
    Then B's position and stats revert to what they were when A's turn started

  Scenario: The GM reverts everyone at once
    Given it became A's turn, and several characters have since drifted
    When the GM triggers the bulk revert
    Then every character's position and stats revert to what they were
      when A's turn started

  Scenario: Ctrl+Z does nothing outside an active turn order
    Given no turn order is currently running
    When a session presses Ctrl+Z
    Then nothing happens (there is no turn-start snapshot to revert to)

  Scenario: Ctrl+Z while typing is not intercepted
    Given a session's focus is in the chat compose box
    When that session presses Ctrl+Z
    Then the browser's normal text-undo behavior happens
    And no character position/stat revert is triggered

Feature: Waypoint distance measurement

  Scenario: Marking a waypoint
    Given a player is standing at some position
    When they press M
    Then a yellow waypoint marker is placed at their current position,
      snapped to the nearest voxel-grid center

  Scenario: Live distance to the last waypoint
    Given a waypoint has been placed
    When the player moves
    Then a line segment and a live, updating 3D distance label are shown
      from that waypoint to the player's current position

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
    When the player uses the Finalize action
    Then the current waypoint chain is committed/cleared explicitly,
      without needing to end the current turn to do it
```

## UI/interaction reference: Roll20's turn tracker

Explicit reference point (user call: "Roll20 (Recommended)"), for
anyone designing the actual widget: Roll20's turn-order tracker is a
small floating, draggable window (not docked/fixed), showing entries
in order with the active entry visually distinguished, a round
counter, and drag-to-reorder on the entries themselves. Tokens are
added to it either by dragging them in or via a right-click "Add to
Turn Order" action on the token itself. This project's own old game
already converged on the same non-modal/draggable/add-remove/round-
counter shape independently (`turn_tracker_menu.gd`) -- Roll20 is the
reference for *polish and interaction details* (drag-to-reorder, the
add-from-token-context-menu pattern, matching this project's own
existing right-click character context menu) more than a wholesale
redesign.

## Open questions / assumptions still worth confirming

These are called out so they don't get silently decided during
implementation -- flag if any assumption here is wrong before building
against it:

1. **Who can press "Next Turn"?** Assumed: anyone connected (matches
   the old game's own no-permission-check behavior). Could instead be
   GM-only.
2. **Ctrl+Z scope mechanism**: same keybind scoped by admin status, vs.
   a separate explicit GM-only "Reset All to Turn Start" button/action.
   Both satisfy the requirement; this is a UI decision, not a
   behavioral one.
3. **Snapshot storage**: full per-character snapshot vs. a diff against
   current live state. Pick whichever is simpler to implement
   correctly first; either satisfies the Gherkin above.
4. **Turn-order persistence**: does the tracker's state (who's in it,
   whose turn it is, the round number) need to survive a room
   restart/refresh the way placed character instances now do
   (this round's own persistence work), or is it acceptable for it to
   reset on room recreation? Not addressed above -- needs its own
   call before implementation.

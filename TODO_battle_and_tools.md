# Battle mode polish, combat/inventory rework, and dev tooling

Branch: `feature/battle-and-tools` (off `master`, after `feature/modding-system`
merged via PR #3). One giant message with ~30 distinct asks -- captured here
in full *before* starting implementation so nothing gets lost across what
will necessarily be many sessions, not one. Explicit ordering from the
message: **"Terminal first, then the other things."**

Starting state: your own WIP (splitting `xray_if_behind_full.gdshader` into
`xray_if_behind_cutout.gdshader` + `xray_if_behind_transparent.gdshader`,
every material `.tres` repointed) was sitting uncommitted on
`feature/modding-system` -- committed as-is on this branch first, not
touched further yet.

**Standing reminder, applies to everything below:** the worlds under
`user://world_saves/` have real built content now ("the worlds have some
interesting stuff in them now so keep them pls") -- don't run
delete/reset against them while testing, use throwaway worlds instead.
Also: keep tunable values (colors, sizes, thresholds, speeds) exposed via
settings/@export rather than hardcoded constants, per "Keep all details
that aren't in 2d/3d billboards/hints in UIs so I can modify them."

## Phase 0 -- Dev tooling / terminal [priority: first, done]

- [x] Command-line startup args: `godot --scene res://levels/voxel_main_world.tscn --
      --world=hilly --pos=x,y,z --rot=x,y,z --hold=<item id or name>`,
      parsed in the new `DevConsole` autoload (`scripts/dev/dev_console.gd`)
      from `OS.get_cmdline_user_args()`. `--world` matches by saved-world
      id, display name, *or* generator id (so `--world=hilly` works
      without knowing which specific saved world to target). `--hold`
      matches by item id (`block_5`) or display name
      (`"Wood Plank"`/`wood_plank`). Verified end-to-end headless: world
      switch -> position -> item all applied correctly in sequence, with
      output confirming each step
      (`world hilly -> switching to world_0 (matched generator hilly)`,
      `goto 5 20 5 -> moved to (5.0, 20.0, 5.0)`,
      `hold wood_plank -> equipped wood_plank to primary hand`). Real bug
      caught and fixed on the way: applying pos/hold immediately after
      a world switch raced the scene reload (switching worlds frees and
      recreates the player node asynchronously) -- now properly awaits
      the old player reference going away and a new one appearing first.
- [x] `pos` command reports player position + rotation; `point` reports
      what's being aimed at (voxel id, world position, distance) --
      raycasts via `VoxelTool.raycast()`, same reliable mechanism as
      voxel_interactor.gd/battle mode's range check, and works regardless
      of battle mode (unlike hud.gd's range check, which is
      battle-mode-only by design).
- [x] In-game command console: `\` (not `/`, which was already
      `tooltip_toggle`) opens `dev_console_ui.gd` -- a scrolling log plus
      a command-line input. Commands: `help`, `pos`, `point`, `goto`,
      `hold`, `world`, `battle`, `mark`, `undo`, `quit`.
- [x] Mirrors real stdout: tails `user://logs/godot.log` (Godot's own
      default file log, already capturing every print()/push_warning()/
      push_error()) rather than only re-printing what this script itself
      outputs -- confirmed live, the on-screen log showed the pre-existing
      `biome_wind_controller.gd` error spam that this feature had nothing
      to do with.
- [x] Three more real bugs found and fixed via live testing of the
      console itself: (1) the `pause` action was bound to **both** Escape
      and Enter -- meaning pressing Enter to submit *any* text field in
      the game (world name, combatant name, and now console commands)
      also toggled the pause menu; removed the Enter binding, Escape only
      now. (2) A held/auto-repeating key fired `_unhandled_input` many
      times for one physical press (16 stray backslashes ended up typed
      into the console's own input field from a single `\` press) -- now
      guarded with `not event.is_echo()`. (3) The `\` keypress that opens
      the console could itself leak into the newly-focused input field;
      now explicitly cleared on open. **Not fully self-verified** after
      those three fixes -- boot-checks clean and the CLI-args path is
      solidly verified, but the last live interactive test of typing a
      command hit apparent xdotool timing flakiness on my end (mouse/key
      simulation, not a reproduced code error) rather than a clean pass;
      worth a real try when convenient.
- [x] Fixed a real GDScript name collision (`var _input` and `func
      _input()` on the same script) that broke the console script
      entirely -- see the dedicated commit for how this was missed twice
      (routine boot-check loads the main menu scene by default, never
      touching this script; the one time it *was* tested with the right
      scene, output was grepped for specific strings that didn't match
      "Parse Error"). Confirmed via live testing this was also the actual
      cause of your "mouse input isn't working at all" report.
- [x] Console no longer pauses the game (physics/chunk-loading/etc. keep
      running while typing a command) -- deliberately different from the
      DM-facing menus, since this is a dev/testing tool where you
      generally want to watch the game keep going. Confirmed live via the
      new command queue below (position changed between two `pos` calls
      purely from gravity, with no command in between).
- [x] New reliable test channel: appending a line to
      `user://dev_console_commands.txt` (reset empty on every launch)
      runs it as a command, independent of the in-game UI or window focus
      -- xdotool's OS-level input simulation turned out to have too many
      of its own quirks (held-key auto-repeat, dead/compose-key
      swallowing depending on the specific key, focus races) to be a
      reliable way to verify game state from outside the process.
      Verified live: three commands piped in via plain `echo >> file`
      from a separate shell, all executed correctly in order.
- [x] Redesigned per your feedback ("E still tries to do ledge grabbing in
      the console... I think we should just give all controls back to the
      player including the mouse, but show the text on the screen, fading
      away after about 10 seconds slowly, unless they press \ again and it
      focuses"): the console no longer toggles a show/hide panel or mouse
      mode at all -- `\` now only toggles keyboard FOCUS
      (`DevConsole.is_focused`, renamed from `is_open`) on the command
      input. The log + input bar stay in the tree permanently and just
      fade to transparent ~10s after the last activity (new log line, or
      focus changing) unless focused, in which case they stay at full
      opacity. Removed the black dim background entirely -- fully
      transparent now, per "we probably don't want the transparent black
      background for the dev console, just fully transparent background
      so we can see the game."
    - The old WASD-only gate wasn't enough on its own: since the mouse
      never leaves the player anymore, the previous `Input.mouse_mode ==
      CAPTURED` check (which used to also cover the console, back when it
      switched mouse mode) is now a no-op for the console specifically.
      `DevConsole.is_focused` is the explicit state every gameplay input
      path checks instead: `player_blob_ctrl.gd`'s `_input()` (double-tap
      fly/intangible, wall-jump/basic-jump immediate input) and
      `_physics_process()` (WASD, slow/sprint, fly-vertical, slide),
      `ledge_grabber.gd` and `left_hand_gripper.gd` ("E" ledge grab, both
      the real grab logic and the hand's own reaching-visual poll, which
      read the action independently), and `two_handed_resource.gd`
      (attack/place-block clicks and battle-mode mark/undo clicks). Godot's
      GUI focus system only intercepts *event*-based input for whichever
      Control has focus -- it does nothing for `Input.is_action_pressed()`
      polling elsewhere in the tree, which is how most of these read
      input, so a state check was required regardless of the redesign.
    - Real latent bug found and fixed on the way: `player_blob_ctrl.gd`
      recomputed `input_dir` a second time, ungated, a few lines after the
      correctly-gated first read, silently overwriting it and feeding
      `wall_jumper.handle_wall_slide()` an ungated direction even while
      typing. Removed the redundant re-read.
    - Boot-checked clean (`godot-mono --headless --scene
      res://levels/voxel_main_world.tscn`, no parse/script errors in any
      touched file) and smoke-tested via a real (non-headless) launch
      driven entirely through the command-queue file -- `pos` commands
      round-tripped correctly and `quit` shut the process down cleanly.
      **Not yet independently confirmed**: the actual focus-gating and
      10s-fade behavior need your live testing, since they depend on real
      window keyboard focus/keystrokes and elapsed wall-clock idle time,
      neither of which the command-queue channel exercises.
- [x] Fixed the "console is always on" / "clicking re-focuses it" report:
      the fade timer was resetting on *any* new log line, and DevConsole
      tails real stdout project-wide -- so `two_handed_resource.gd`'s
      `print("prim")`/`print("sec")` on every click was resetting it too,
      making the UI look permanently visible/"re-opened" on click when it
      was really just never fading. Fade is now driven purely by
      `DevConsole.is_focused`, nothing else.
    - Per your follow-up spec, `\`/Esc/Tab/Enter are no longer a single
      toggle: `\` only GAINS focus (does nothing if already focused, but
      still consumes the keypress so it can't leak into the field as
      text); Esc, Tab, and Enter (submitting a command) each only REMOVE
      it, never grant it.
    - Extracted the fade math into a standalone, dependency-free class,
      `DevConsoleFadeState` (`scripts/ui/dev_console_fade_state.gd`) --
      `compute_alpha(is_focused, now_msec)` takes time as a parameter
      instead of calling `Time.get_ticks_msec()` itself, specifically so
      it's exhaustively testable with spoofed timestamps. Per your
      suggestion, added `unit_fade_new`/`unit_fade_step`/`unit_set_focused`/
      `unit_ui_alpha` commands to DevConsole (hidden from `help`) as the
      testing back door: `unit_fade_step` drives the pure math directly
      with hand-picked timestamps (no real waiting), `unit_set_focused`
      does exactly what a real keypress would do to `is_focused` without
      needing one, and `unit_ui_alpha` reads the real on-screen UI's
      actual rendered alpha back out to confirm the wiring, not just the
      isolated math. All four verified live through the command-queue file
      -- fade curve is exactly linear 1.0->0.0 over 10000ms and snaps back
      to 1.0 the instant focus returns, and the real UI's alpha tracks it
      correctly (checked before/after `unit_set_focused`).
    - Found and fixed a genuine race while auditing this: `_input()` order
      between separate nodes isn't guaranteed, and `set_input_as_handled()`
      doesn't stop *other* nodes' `_input()` from still running the same
      frame -- so if `dev_console_ui.gd`'s Escape handler happened to run
      before `pause_menu.gd`'s, it would flip `is_focused` to false and
      the pause menu's `not DevConsole.is_focused` check would then read
      *true*, opening the pause menu on the same Escape press that just
      unfocused the console. `pause_menu.gd` now also checks
      `not get_viewport().is_input_handled()`, which catches this
      regardless of which node's `_input()` happens to run first.

## Phase 1 -- Battle mode controls & movement rework

- [x] New `InputController` autoload (`scripts/input/input_controller.gd`),
      built *before* starting the rest of this phase per your call ("these
      if statements that reference each other across files is... gross...
      we're getting into double tap and lmb/rmb stuff next, so I think
      that's good to do first"). Replaces the pattern that had spread
      across `player_blob_ctrl.gd`, `ledge_grabber.gd`,
      `left_hand_gripper.gd`, and `two_handed_resource.gd`: each one
      independently checking `Input.mouse_mode == CAPTURED` and/or
      `DevConsole.is_focused` (combined slightly differently each time)
      before trusting a raw `Input` call.
    - `request_capture(owner)`/`release_capture(owner)`: same
      reference-counted-by-key pattern as `UiPauseGate`, and now the ONE
      place that owns `Input.mouse_mode` -- `pause_menu.gd`,
      `player_inventory.gd`, `dm_world_menu.gd`, and `dev_console.gd`
      (which requests capture without hiding the mouse, matching its
      earlier redesign) all migrated off calling `Input.set_mouse_mode()`
      directly.
    - `is_action_pressed()`/`get_action_strength()`/`get_vector()`:
      capture-aware wrappers -- gameplay scripts call these instead of
      `Input`'s directly and the gating is automatic, nothing left for
      each caller to check itself. `player_blob_ctrl.gd`,
      `ledge_grabber.gd`, `left_hand_gripper.gd`, and
      `two_handed_resource.gd` all migrated to these, dropping their
      individual `DevConsole`/mouse-mode checks entirely.
    - `was_double_tapped(action, window_ms, now_msec=-1)`: one shared
      double-tap timer instead of `player_blob_ctrl.gd`'s fly/intangible
      gestures and `movement_resource.gd`'s sprint gesture each keeping
      their own last-press-time bookkeeping. `now_msec` takes the same
      "pass time in explicitly" shape as `DevConsoleFadeState` for the
      same reason -- spoofable via a new `unit_input_double_tap` console
      command instead of needing real waiting/a real keypress to test.
    - `register_sequence(name, steps, window_ms)`/`sequence_matched`: a
      general ordered-sequence matcher (Konami-code style) for anything
      with more shape than a same-action double-tap -- came out of "lmao,
      I found a reason for a state machine: up up down down left right
      left right 'b' 'a' 'start' should immediately kill and respawn the
      player... state machine would also be used for double tapping tbh
      and potentially some other stuff like item based usage, wall
      jumping." Kept `was_double_tapped()` as its own lightweight
      synchronous primitive rather than routing double-tap through this
      too -- same-action-twice doesn't need the general matcher's
      signal-based shape, and it was already working -- but built this as
      the mechanism for actual multi-step gestures going forward. Wired
      the literal Konami code into `player_blob_ctrl.gd` as both an
      easter egg and the dogfood test of the new API: up/up/down/down/
      left/right/left/right/secondary_item_click/primary_item_click/Enter
      (a new `cheat_konami_start` action, registered via
      `InputController.register_action()` since nothing existing binds
      plain Enter) calls the existing `die()` respawn.
    - `register_action(name, events)`: wraps `InputMap` so mods can define
      new bindings at runtime and get the same capture-aware
      polling/signals/sequence-matching as everything above for free,
      purely by name -- no special-casing anywhere for mod- vs
      built-in actions.
    - Verified live via the command-queue channel: `unit_input_captured`
      (mirrors `unit_set_focused`'s downstream effect on the real
      autoload), `unit_input_double_tap` (exact window-boundary/consume-
      on-trigger behavior, matches design), `unit_input_sequence_register`/
      `unit_input_sequence_feed` (a custom 3-step test sequence correctly
      ignored intervening noise and rejected a stale window; the real
      11-step Konami sequence matched exactly on the 11th press and -- once
      the test command was fixed to also emit `sequence_matched`, which
      `record_press_for_sequences()` alone deliberately doesn't do -- drove
      an actual `die()`/respawn end to end, confirmed via `pos` before/
      after). Boot-checked clean. **Not yet independently confirmed**:
      real physical keypresses actually reaching `InputController._input()`
      and firing the signals -- the command-queue channel calls
      `record_press_for_sequences()`/`was_double_tapped()` directly, it
      doesn't exercise the real `_input()` dispatch path itself.
- [x] Live Konami-code attempt ("wwssadad" + right-click + left-click +
      Enter) didn't trigger it -- found and fixed a real design flaw in
      `record_press_for_sequences()`, not a timing issue (the reported
      default window, 6600ms total, was already generous). The first
      version shared ONE rolling buffer across all registered sequences,
      capped to the longest one's step count -- so literally any OTHER
      action press during an attempt (a stray scroll-wheel tick, "slow",
      anything) evicted an earlier step and silently broke the match.
      Rewrote it as independent per-sequence progress tracking instead:
      each sequence has its own index into its own steps, a press that
      isn't the next expected step resets ONLY that sequence's progress
      (unless the press also happens to be a valid restart, i.e. equals
      step 0), and window_ms is now the max gap between two CONSECUTIVE
      correct steps (default 600ms) rather than a fixed budget for the
      whole sequence, which would unfairly penalize slow early steps.
      Also bumped the Konami sequence's own window to 1500ms/step, since
      it makes you move a hand from keyboard to mouse and back (clicks,
      then Enter) -- slower than a same-device combo. Verified live via
      the command queue: a clean attempt matches; the exact bug scenario
      (an unrelated "slow" press mid-combo) now correctly fails without
      corrupting state, and an immediate clean retry right after still
      succeeds; a >1500ms gap between two consecutive correct steps
      correctly forces a restart, and completing cleanly from there still
      works. **Still not independently confirmed** end-to-end with a real
      keyboard/mouse -- please try the Konami code again when you get a
      chance.
- [x] Second live attempt still didn't trigger it. Added a temporary
      diagnostic (`InputController.debug_log_input`, on by default right
      now, prints every action press and how it moves each registered
      sequence's progress -- also usable as its own dev-console command
      surface later, not just for this) and asked you to try again with
      the game window open so it'd get captured -- caught the real
      attempt live. Root cause: right-click is bound to BOTH "slide" and
      "secondary_item_click" in this project (crouch-slide + item-use on
      the same button), and `record_press_for_sequences()` was called
      once per action, one at a time -- "slide" happens to be defined
      earlier in `project.godot` so it iterated first and reset the
      Konami sequence's progress (right when it was 8/11 through) before
      "secondary_item_click", the step actually needed, ever got checked.
      Enter has the same issue less consequentially (also fires several
      of Godot's built-in `ui_accept`/`ui_text_*` actions alongside the
      custom `cheat_konami_start` action).
    - Fixed at the root: `InputController._input()` now collects EVERY
      action one physical event satisfies into a batch before touching
      sequence state at all, and `record_press_for_sequences()` takes that
      batch (not a single action) -- a sequence advances if its expected
      next step is ANYWHERE in the batch, so which action Godot happens to
      iterate first no longer matters. `unit_input_sequence_feed` now
      takes comma-separated actions for testing this directly.
    - Verified live via the command queue by replaying the EXACT
      real-world batches ("slide,secondary_item_click" for the right-click
      step; all five Enter-bound actions together for the start step) --
      confirmed match + actual `die()`/respawn end to end.

- [ ] Stop using LMB/RMB for waypoint mark/undo in battle mode -- players
      need those free for items/spells/attacks. Move to **M** (mark
      current position / add node) and **N** (undo), via the input action
      map (not fixed keys -- audit this generally, see Phase 9).
- [ ] N's exact behavior (this is the "make moving and undoing much
      easier" part, not simple undo): if the player is **not** standing
      on the last marked waypoint, N moves them **back onto it** (no
      undo). If they **are** standing on it, N undoes it like normal
      (removes it from the list) -- and since they're now standing at a
      position that isn't the new last waypoint, pressing N again first
      returns them to *that* one, then undoes on the press after, and so
      on. One key walks you back through history AND lets you jump back
      onto whichever waypoint you're currently reasoning about.
- [x] Battle mode no longer force-enables flying/intangible on entry or
      clears them on exit -- whatever movement type was already active
      (walking, or manually double-tapped flying/intangible) stays
      exactly as it was the whole time. The transparency visual cue
      stays. The rest of this item (movement speed while in battle mode
      coming from an *equipped item* once flight/dig move to mod items)
      is still Phase 8 -- this was just "stop overriding it", not the
      full rework. Boot-checked; live-tested enough to confirm the player
      stays grounded/walking normally on entering battle mode rather than
      lifting off.
- [ ] Double-tap-jump-to-fly interferes with wall jumping -- remove the
      built-in double-tap gesture detection from `player_blob_ctrl.gd`
      entirely. Fly and "dig"/intangible move to mod items instead (see
      Phase 8), not built-in double-tap keys. ("Right the double ctrl and
      double space things were a bad idea it seems" -- confirmed worth
      doing, not done yet.)
- [x] Battle-mode waypoint lines were using true alpha-blend transparency
      -- same underlying flicker issue as everything else layered on the
      xray cutout system (Godot doesn't depth-sort overlapping alpha-
      blended transparents). Switched to `TRANSPARENCY_ALPHA_SCISSOR`
      (Godot's built-in "cutout" mode -- binary discard by threshold, no
      blending, so nothing to sort) and made the line radius thinner
      (0.09 -> 0.05). Live-tested: line renders solid/stable, visibly
      thinner. The live-segment color also had to become an actual
      different shade rather than a lower alpha, since alpha-scissor
      doesn't preserve a translucent look the way alpha-blend did.
- [x] Range-check distance detection was using plain camera-forward,
      which drifts from what the actual voxel-targeting beam aims at as
      zoom changes (the camera itself moves further from the character in
      third person; a ray from its position traces a different path than
      one from near the character's body at the same look angle). Added
      `VoxelInteractor.get_aim_ray()`, extracting the exact
      origin/direction math `update_target()`'s own beam already used, so
      `hud.gd`'s range check and `DevConsole`'s `point` command both agree
      with what placing/breaking a block would actually hit. Live-tested,
      confirmed distance now updates correctly and consistently whether
      zoomed in or out.
- [x] Zoom changed from plain mouse-scroll to **Ctrl+scroll**
      (`spring_arm_3d_look.gd`); plain scroll now cycles the hotbar
      selection instead (`player_inventory.gd`, Minecraft-style). Live-
      tested: plain scroll cycling confirmed working (slot 3 -> 4).
      Ctrl+scroll's own zoom behavior wasn't independently confirmed in
      the same session -- the test attempt was confounded by the
      synthetic Ctrl key-hold accidentally also triggering the unrelated
      double-tap-Ctrl-for-intangible gesture. Code review looks correct
      (`event.ctrl_pressed` gate); worth a real check.
- [ ] "Change ctrl-down to shift": rebind `fly_descend` from Ctrl to
      Shift. The same Shift key, when grounded (not flying), triggers
      ledge-safety instead (Phase 6) -- context-dependent like `jump`
      already is (ground jump vs. fly ascend).

## Phase 2 -- Character size system

- [ ] New mod-provided "PlayerInfo" concept: player name (auto-entered)
      and size. Size is a **plain number of voxels**, not a name string
      -- the *mod* can define a dict like `{small: 1}` for its own
      convenience, but what the main game actually receives/stores is
      just `1` (voxel count). No hardcoded size-name dictionary in core
      game code.
- [ ] Waypoint markers become **wireframe cubes** sized to the character,
      not spheres: 1 voxel for small/medium, 1/2 voxel (l,w,h) for tiny,
      2 voxels for large, 3 voxels for huge. (D&D-ish tiers, no
      gargantuan mentioned.)
- [ ] Snapping respects size: small characters (< 1 voxel) snap to
      `1/n` sub-voxel positions where `n = ceil(voxel_height / char_height)`.
      Large+ characters (>= 1 voxel) snap to whole-voxel positions as
      normal (current behavior).
- [ ] The player should have a voxel-sized wireframe box around them in
      battle mode (scaled to their size) instead of the live segment line
      just ending at a point.
- [ ] Temporary wireframe box around whatever's being aimed at in battle
      mode (a target-highlight reticle, Minecraft-block-outline-style) --
      reuses the existing battle-mode range-check raycast.

## Phase 3 -- Turn tracker fixes

- [ ] Fix vertical sizing: currently very tall even when minimized: it
      should shrink to fit just the title's height.
- [ ] When minimized, the title text should **become** the "<X>'s
      turn"/"Your Turn" text instead of staying static "Turn Tracker"
      with that info duplicated as a separate line below it.
- [ ] Player's origin/last-safe-position should update to their last
      marked battle-mode waypoint once it's no longer their turn (i.e. on
      `TurnTracker.next_turn()`, if the combatant whose turn just ended
      was the local player) -- "movement mostly matters within a turn."
      Needs combatants linked to actual entities, not just names (the
      `is_local_player` flag is a start).

## Phase 4 -- Combat: pickaxe, block health, hand/equip system rework

Final intended behavior (a later clarification superseded an earlier,
simpler statement in the same message -- this is the one to build):
- Which hand (LMB primary / RMB secondary) does what depends entirely on
  **what's equipped in that hand**, not a fixed global mapping:
  - Empty hand -> that hand's click = **interact** (default).
  - Pickaxe equipped -> that hand's click = **attack/mine** (see below).
  - A block item equipped -> that hand's click = **place**.
- Remove the current right-click-always-deletes behavior
  (`del_vox_item.gd`) entirely in favor of the above.
- New **pickaxe** item/tool: attacking (holding the attack click while
  targeting a block) removes 1 health per attack, 1 attack/second
  (rate-limited). Every voxel type gets its own health value. Health
  regenerates **the moment** the block stops being continuously attacked
  -- simple model: the instant the player releases the attack click (or
  stops targeting that block), not a gradual regen over time.
- Equip scheme:
  - Double-click an inventory item -> equips to the **right** hand (RMB).
  - Single-click an inventory item -> equips to the **left** hand (LMB).
  - Ctrl+number (hotbar slot) -> equips that item to the **right** hand.
    (Plain number key presumably still equips left/primary as today --
    confirm current behavior before changing.)
  - Once dual-hand hotbar selection exists per the above: plain
    mouse-wheel cycles the **left**-hand hotbar selection (already built,
    this round -- see player_inventory.gd), Shift+wheel should cycle the
    **right**-hand selection. Not built yet since there's only one
    hotbar selection today; noted for when this phase actually lands.

## Phase 5 -- Inventory split (DM vs. player)

- [ ] The current inventory (infinite items) becomes the **DM
      inventory** -- shown above/separate from a new **player
      inventory**.
- [ ] Player inventory has **limited stock** per item; the DM drags or
      clicks items from the DM inventory into the player inventory to
      stock it.
- [ ] Placing a block consumes 1 from the player's limited count for that
      item. Default stack limit **9999** for any item that doesn't
      otherwise specify a limit.

## Phase 6 -- Ledge safety / crouch (Shift)

- [ ] Holding Shift while grounded should prevent walking off the edge of
      the current voxel, with a small (~1/8 voxel) horizontal margin
      allowed beyond it before treating it as a collision. Mechanic as
      described: register the voxel below on shift-down; when moving (no
      longer directly above that voxel), query for a new voxel below the
      new position -- if there isn't one and the player is beyond the
      ~1/8 margin, push them back to stay within voxel+margin; otherwise
      collide normally.
- [ ] Moving while holding Shift (grounded) = **half speed** (the
      "crouch" part of the mechanic, separate from the ledge-safety part
      but same key).

## Phase 7 -- Lighting

- [ ] Voxels get a "light level" property; when set, the material's
      emission increases accordingly.
- [ ] Whether light-level blocks also act as **actual point-light
      sources** (not just emissive-looking) is a graphics setting, not
      automatic (real dynamic lights are expensive) --
      `settings -> graphics -> light-blocks-are-point-light-sources`.
- [ ] New settings **submenu structure** needed for this:
      `settings -> graphics -> ...`, `settings -> ttrpg -> meter vs 5
      feet` (moves the existing distance-unit toggle under a "ttrpg"
      category rather than flat in the root settings screen).
- [ ] Test/demo light block: "just make a simple white light cube not a
      torch" -- no fancy mesh needed, a plain emissive white voxel is
      enough to prove it out.

## Phase 8 -- Movement items (mod items, replacing double-tap gestures)

- [ ] Move flight and "dig"/intangible movement out of built-in
      double-tap key detection entirely and into **mod items** (e.g. a
      "Wings" item, a "Phasing Gloves" item) with their own speed stats.
      Equipping/activating one grants that movement mode; switching which
      one's active switches movement mode and speed. Directly enables the
      Phase 1 battle-mode-movement-uses-equipped-item-speed behavior.
- [ ] Enemy spawn eggs: "we do have the enemy slime AI so we can add in
      enemy spawn eggs with not too much effort" -- a DM item that spawns
      a `blob_ai_resource.gd`-driven enemy on use.

## Phase 9 -- Misc fixes and polish

- [ ] Audit: confirm everything actually uses the Godot input action map
      (`Input.is_action_pressed("...")`) rather than hardcoded
      `event.keycode == KEY_X` checks, so keys stay rebindable. "Haven't
      checked, just making sure."
- [ ] Purple procedural skybox: bump `ProceduralSkybox.generate_cubemap()`
      size up to 512 (check the actual current value first -- the message
      guessed "8x8" but the code as last known passed 64).
- [ ] Copy the saved limestone tower structure into an "example
      structures" location, renamed `structure_2.tres` -- **do not
      delete the original**. (Need to find where saved structures
      currently live first -- `structure_saver_item.gd`/
      `structure_placer_item.gd`/`saved_structure.gd`.)
- [ ] 3D billboards (structure-placer info display, etc.) tied to a held
      item should be removed/cleaned up when the item changes, not
      linger.
- [ ] Structure placer: pressing **C** (the existing `structure_cycle`
      action) to cycle structures should show the **name** of the
      structure that will be placed on its billboard.
- [ ] "There is also a scroll bar on one of the billboards and idk how to
      use it" -- investigate (likely `item_tooltip.gd`'s pagination,
      given `tooltip_next_page`/`tooltip_prev_page` actions already
      exist) and either make it usable or remove it if it's not needed.
- [ ] Found while poking at `tooltip_toggle` (`/`) chasing an unrelated
      dev-console-keybind question: after pressing it, mouse movement
      stops affecting the player/camera, and no tooltips pop up on
      hovering items afterward -- something about that toggle is leaving
      input/mouse-mode state stuck. Not investigated yet.
- [ ] World save-size ("KB info") in the F1 menu doesn't update until the
      player dies -- diagnose whether that's because the world genuinely
      hasn't saved yet (fix: **autosave periodically**, not just on
      switch/death/exit, in case of a crash) or because the F1 menu is
      showing a stale cached size rather than re-reading the file fresh
      each time it's opened.
- [ ] World saving confirmed working on world-switch, **not** confirmed
      working on plain game exit -- hook a save into the exit/quit path
      too (`_on_exit_pressed()` and ideally a window-close-request
      handler), not just switch/death.
- [ ] Undo stack for block placements/building (structure) placements,
      capped around 3 -- "good enough for one building undo."
- [ ] Structure paste: the structure's **pivot block** should replace
      (overwrite) whatever block is currently being pointed at, rather
      than whatever placement-anchor behavior it currently has.
- [ ] Missing-mod-blocks warning: mod voxel ids are assigned append-only
      when `ModManager.apply_voxel_registrations()` runs, so a world
      saved with mod blocks placed, then loaded with that mod disabled
      (or in a different enable-order), will have those voxel ids
      missing or pointing at the wrong block entirely -- silent data
      corruption, not just a missing texture. Loading a world should
      check for this and show a warning; practical fallback is swapping
      the missing ids for empty/air, plus a link from the warning
      straight to a mod-enable dialog so the user can re-enable the
      missing mod and reload instead of losing the blocks.

## Phase 10 -- Glass voxel (simplified scope)

- [ ] Dropped the neighbor-aware border-texture-merging requirement from
      the original ask (still logged in `TODO_modding_and_worlds.md` as a
      future idea) -- for now, glass is just: edges white and mostly
      (not fully) transparent, face centers **fully** transparent,
      otherwise a normal voxel (solid collision etc.). Much simpler,
      tractable now.
- [ ] Per your clarification on the transparent-rendering-order issue:
      Godot's shader system here is "not a blender level thing" -- it
      can't handle many simultaneous true alpha-blended transparent
      cutouts well. The **cutout** variant (alpha-scissor/discard, binary
      opaque-or-invisible per pixel) is what lets grass render correctly
      without flickering through blocks or at a distance, specifically
      *because* it has no sorting problem (nothing to sort -- each pixel
      is either drawn or not). True alpha-blended transparency (battle
      lines, presumably glass too) is what has the draw-order flicker
      issue. Worth trying glass as a cutout/alpha-scissor effect instead
      of true blending when it's built, if the visual (hard-edged
      mostly-transparent rather than smoothly blended) works for the
      "edges white-transparent, center pure transparent" look -- would
      sidestep the sorting problem entirely rather than needing to fix
      Godot's transparent rendering/sorting order.

## Notes / already-resolved, no action needed

- Confirmed positive: the distance-metric `n` SpinBox already allows
  fractional values (step 0.1), not integer-only -- "Surprised the n-norm
  isn't an integer, good." Keep this pattern for future numeric settings.
- Mixed feedback on all the runtime-code-built UI (DM World Menu, Turn
  Tracker, Settings): "not sure I like the code-gen menu and stuff but
  it's fine I guess if that's easier to make/change" -- tolerated for
  now, not a mandate to rewrite as `.tscn` scenes, but worth reconsidering
  if a future UI ask is more visually complex or the feedback sharpens.

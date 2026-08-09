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

## Phase 0 -- Dev tooling / terminal [priority: first]

- [ ] Command-line startup args (godot `--` args, parsed in an autoload):
      load a specific world, hold a specific item, position/rotate the
      player to an exact location.
- [ ] Report player position to stdout on request/change.
- [ ] Report what's being pointed at (raycast target info) to stdout.
- [ ] In-game command console: `/` or `\|` opens a text input, typed
      commands execute with "full control" -- meant to replace fragile
      xdotool pixel-clicking for testing going forward.
- [ ] Mirror anything printed to the terminal onto an on-screen overlay
      too (so a live windowed session's stdout is visible without needing
      to tail a log file).

## Phase 1 -- Battle mode controls & movement rework

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
- [ ] Battle mode should not force-enable flying/intangible automatically
      anymore. Movement in battle mode is **normal movement** unless the
      player has a flight or dig-speed item equipped (see Phase 8) -- in
      which case movement uses that item's speed, and switching equipped
      movement items switches movement mode/speed.
- [ ] Double-tap-jump-to-fly interferes with wall jumping -- remove the
      built-in double-tap gesture detection from `player_blob_ctrl.gd`
      entirely. Fly and "dig"/intangible move to mod items instead (see
      Phase 8), not built-in double-tap keys.
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

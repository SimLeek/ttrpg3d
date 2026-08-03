# 3D building tools (extrusion-style workflow)

Building in 3D takes an order of magnitude more placements than 2D (an 8x8x8
box is ~296 face-blocks vs. ~28 for an 8x8 perimeter in 2D). The fix used by
every 3D modeling tool: select a plane, draw a flat pattern on it, then turn
that flat pattern into a volume (extrude/revolve/sweep) instead of placing
every block by hand.

Branch: `feature/3d-build-tools`.

## Shared state: BuildSession

A node (found via the `"build_session"` group, same lookup pattern as
`player_inventory`/`item_tooltip`) holding the stuff every plane/draw/volume
tool needs to agree on:

- Current plane: origin + two basis vectors (+ derived normal), OR none.
- Current drawing: a `Dictionary` of plane-local `Vector2i -> voxel_id`
  (sparse -- most planes are mostly empty).
- Recent drawings: a small ring buffer (~10?) of `{plane, drawing}` snapshots
  pushed whenever the active drawing gets consumed (extrude/etc.), so
  "destroy on use" doesn't mean "gone forever."

All the tools below are `kind: "tool"` `ItemCatalog` entries, same as the
structure saver/placer, each `preload`ing their own script + a hint string.

## Phase 0 -- Plane selection tool [done, on feature/3d-build-tools]

- [x] `PlaneSelectorItem`: click sets point 1, 2, 3 in sequence (reuse the
      corner-setting pattern from `StructureSaverItem`). Always 3 points --
      an earlier version let 2 points commit immediately if they shared an
      axis, but that shortcut was confusing in practice and got removed.
  - [x] 3 non-collinear points = the plane. Verified live: a near-collinear
        3-point pick (small camera-only rotation between clicks) correctly
        got rejected; moving the player between clicks (guaranteeing real
        spread) correctly committed and showed "Plane set."
  - [x] Reject collinear picks (cross product length < 0.5) with an
        ItemTooltip message instead of crashing or silently no-op'ing.
- [x] If the voxel raycast doesn't hit anything: fall back to a point near
      the player's feet instead of requiring terrain -- these are tool
      picks, not world edits.
- [x] Visual: DebugDraw3D gizmos -- point 1/2/3 in cyan/orange/magenta, the
      resolved plane drawn as a 4-line quad outline (yellow) sized to the
      actual selected span.
- [x] `BuildSession.set_plane(origin, basis_u, basis_v)`.

### Future refinement, once we're back on planes (not started)

- [ ] Planes should have adjustable, bounded size after the fact, like the
      structure-saver box's resize/translate modal editing (see below) --
      but for a plane you adjust all 3 corner points individually (not a
      single anchor+size), with a 4th point always mirrored across the
      triangle edge it's not connected to (completing a parallelogram).
- [ ] Draw tools should be able to paint on the plane regardless of
      distance from it -- unlike normal add/remove-voxel interaction,
      which is range-limited via the raycast. Needs `DrawPointItem` (Phase
      1) built first to actually verify this against a real plane.

## Structure saver/placer rework [done, on feature/3d-build-tools]

Not part of the plane/draw pipeline directly, but the same modal-editing
pattern (R/T mode + U/I/O/J/K/L axis keys) is what Phase 1's draw tools and
future plane resizing will reuse, so it landed here first as the simplest
real test case. Two-corner-click selection turned out to be a hassle in
practice.

- [x] `StructureSaverItem`: click places a single anchor corner (aim target,
      or near the player if not aiming at anything) instead of two
      independent corners. `R` enters resize mode, `T` enters translate
      mode; while in a mode, U/I/O grow/translate+ and J/K/L shrink/
      translate- on X/Y/Z respectively. `G` still saves. Verified live:
      resize grew a visible white wireframe box from 1x1x1 to 3x3x3, saved
      structure's `voxel_types` on disk matched real terrain content.
  - [x] Size can go negative per-axis (skips over 0 -- growing from -1
        jumps to 1, shrinking from 1 jumps to -1), extending the box the
        other way from the anchor instead of only ever growing positive.
        Verified live and via the saved `.tres`: 3 J presses took size.x
        from 1 to -3, and the saved structure correctly came out as
        `size=(3,1,1)` with `pivot=(2,0,0)` -- i.e. the anchor ended up at
        the box's *max* X corner, not min, exactly as expected when the
        box extends backward.
  - [x] Explicit pivot is back (`structure_set_pivot`/P), defaulting to the
        anchor if never pressed -- useful for placing a structure by one of
        its inner corners rather than always its min corner. Drawn as a red
        box, distinct from the cyan anchor and dim-white full-box outlines
        (a default pivot overlaps the anchor box exactly until moved
        elsewhere, which is expected).
- [x] `StructurePlacerItem`: `T`/`R` for translate/rotate mode (same U/I/O
      J/K/L axes), `M`/`N` grow/shrink the rotation step (default 90 deg,
      partial steps intentionally supported -- "hilarious" per request).
      `C` (was `R`) cycles between saved structures now that `R` means
      rotate. Rotated placement samples the *nearest* source voxel per
      destination cell (inverse-rotate + round) rather than forward-mapping
      the source grid, which would leave gaps.
- [x] Placement is now a full overwrite (every voxel in the rotated bounds,
      including air), not `paste_masked` -- fixes trees/dirt poking through
      placed structures, and means structures can now be placed
      underground (surrounding stone gets cleared where the structure says
      air). Destination cells outside the rotated structure's bounds are
      left untouched.
- [x] Ghost preview updated to a real rotated wireframe box (12 edges from
      the 8 rotated corners), not just an axis-aligned bounding box.

## DM-mode flying + intangible movement [done, on feature/3d-build-tools]

Two *separate* toggles, both double-tap:
- [x] Flying (double-jump/Space): disables gravity/normal jump/wall-jump/
      stair-stepping; direct vertical control (jump=up, new `fly_descend`
      action=Ctrl=down). Still collides with terrain normally.
- [x] Intangible (double-`fly_descend`/Ctrl): separately disables collision
      entirely (bypasses `move_and_slide()` + the custom voxel collision
      raycast, direct position update instead) so you can pass through
      terrain. Implies the same direct vertical control flying does
      (otherwise you'd just fall through everything with no way to stop),
      but is a distinct flag from `is_flying` -- you can be intangible
      without flying's "no gravity feel" mattering, or flying without
      being able to pass through walls.

Verified live: ascended clearly above the treeline while flying; separately
descended straight through solid ground into an underground cross-section
view while intangible, then toggled both off and landed normally again --
all with zero script errors across the whole session. Should still get a
real human playtest for movement *feel* (asked for, not something
screenshots capture well).

- [x] HUD indicator (`hud.gd`) shows "FLYING (double-Space to stop)" and/or
      "INTANGIBLE (double-Ctrl to stop)" at the top of the screen whenever
      either is active -- both exit on a double-tap that's easy to mix up,
      so it's spelled out rather than left to memory. Verified live, both
      solo and combined (color shifts to pink/magenta when intangible is
      on, to match the pivot-vs-anchor "this is the unusual one" language
      used elsewhere).

## ItemTooltip rework: toggleable, persistent, paginated [done, on feature/3d-build-tools]

- [x] `tooltip_toggle` (/) hides/shows the billboard without clearing its
      content -- a mode-switch call while hidden still updates what's ready
      to reappear. Verified live: toggled off (panel disappeared), toggled
      back on (previous message reappeared unchanged).
- [x] Persistent by default (`default_duration` changed from a 4s auto-hide
      to 0 = no auto-hide) -- it's meant to sit there showing current mode +
      instructions while a tool is actively in use, not flash and vanish.
      Replaced naturally when a new message comes in.
- [x] `tooltip_next_page`/`tooltip_prev_page` (`.`/`,`, not `[`/`]` since
      those already mean hotbar-slot-cycle) page through long messages,
      split a few lines at a time, with a "(page/total)" footer when there's
      more than one page. Not independently live-tested this pass (would
      need a deliberately long message to trigger) -- low risk, same
      array-slicing logic as everything else here, but worth a real check
      if a tool ends up with a genuinely long status message.
- [x] `PlaneSelectorItem` now calls `_notify()` at each point placement,
      including a note when corner 2 goes down that the preview quad's far
      corner mirrors one of the 3 points across the opposite edge (not a
      4th point you click yourself) -- ties into the "adjustable 3-corner
      plane, 4th point always mirrored" future-refinement note above.

## Phase 1 -- Draw tools (write into BuildSession's drawing)

Each below is its own hotbar item (per your note: direct/line/circle/
rectangle as separate tools, not one tool with a mode switch), all reading/
writing the same `BuildSession` drawing:

- [ ] `DrawPointItem` -- aim at the plane, click paints one cell. The
      baseline/default, "to the right of" the plane selector in the hotbar.
- [ ] `DrawLineItem` -- click start, click end, rasterize (Bresenham on the
      plane's local 2D grid).
- [ ] `DrawRectangleItem` -- click two corners, fill or outline (probably
      needs a fill/outline toggle -- ask/decide when building this).
- [ ] `DrawCircleItem` -- click center, click radius point.
- [ ] All draw tools need a "what voxel type am I painting with" -- reuse
      the currently-equipped-elsewhere block selection? Or their own
      picker? Needs a decision before building.
- [ ] Ghost/ preview via DebugDraw3D before committing (esp. for
      line/rect/circle -- show the shape following the mouse/aim before
      click-to-commit).

## Phase 2 -- Drawing persistence + reuse

- [ ] Serializable drawing resource, same shape as `SavedVoxelStructure`
      (plane basis + sparse `Vector2i -> voxel_id`), saved under
      `user://drawings/*.tres`.
- [ ] "Recent drawings" list UI -- reuse the inventory-grid visual pattern
      (`player_inventory.gd`'s grid-of-icons) rather than inventing a new
      browser.
- [ ] Explicit save action + explicit "load into current plane" action.

## Phase 3 -- Volume generation from a drawing

- [ ] `ExtrudeItem` -- sweep the active drawing along the plane normal by N
      cells (click = +1? drag? number-key for count?). Consumes the
      drawing into "recent" on commit.
- [ ] `RevolveItem` -- rotate the drawing around a chosen axis/angle-step.
      More setup needed (axis pick reuses plane-selector output?).
- [ ] `SweepItem` -- move the drawing along an arbitrary path. Most complex
      of the three; do this last, and only if extrude+revolve prove the
      plumbing out.
- [ ] All write into the terrain via `VoxelTool.paste_masked`, matching how
      `StructurePlacerItem` already avoids clobbering air-into-terrain.

## Ongoing: keep this mod-friendly

Not a separate phase -- a constraint on how the above gets built. Long-term
goal: the base game becomes a library, the shipped game a detailed example
of using it, and someone can add new items/blocks as a mod without forking
engine code. We're not there, but not far either -- keep leaning on the
patterns already established rather than inventing new ones:

- New tools = new `ItemCatalog` entries (script + hint + icon), not new
  special-cased branches elsewhere.
- Shared state lives on lookup-by-group nodes (`BuildSession` joins
  `player_inventory`/`item_tooltip`), not hardcoded NodePaths.
- Avoid anything that requires editing `Blob.tscn` per new tool beyond the
  one-time `ItemCatalog` registration.
- When it's time to actually design the plugin loader (later, not now):
  probably a `res://mods/*/manifest + scripts` directory Godot scans at
  startup to extend `ItemCatalog`/`VoxelCatalog`, but that's a separate,
  dedicated pass -- don't half-build it while doing the above.

## Open questions to resolve before/while building

- Draw tools' voxel-type source: shared with the block hotbar selection,
  or their own?
- Rectangle: fill vs. outline, and how the player picks which.
- Extrude depth: click-to-add-one-layer vs. drag vs. numeric input.
- Recent-drawings capacity and eviction (oldest-first is the obvious
  default, no reason to overthink it yet).

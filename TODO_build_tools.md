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
      corner-setting pattern from `StructureSaverItem`).
  - [x] 2 points = axis-aligned plane when they share exactly one
        coordinate (that shared axis is the normal); ambiguous/non-matching
        picks fall through to 3-point mode instead of guessing.
  - [x] 3 non-collinear points = arbitrary plane. Verified live: a
        near-collinear 3-point pick (small camera-only rotation between
        clicks) correctly got rejected; moving the player between clicks
        (guaranteeing real spread) correctly committed and showed
        "Plane set."
  - [x] Reject collinear 3-point picks (cross product length < 0.5) with an
        ItemTooltip message instead of crashing or silently no-op'ing.
- [x] If the voxel raycast doesn't hit anything: fall back to a point near
      the player's feet instead of requiring terrain -- these are tool
      picks, not world edits.
- [x] Visual: DebugDraw3D gizmos -- point 1/2/3 in cyan/orange/magenta, the
      resolved plane drawn as a 4-line quad outline (yellow) sized to the
      actual selected span, not a fixed preview size.
- [x] `BuildSession.set_plane(origin, basis_u, basis_v)`.

Not yet verified live: the 2-point axis-aligned path specifically (needs
genuinely flat terrain between two aim points to trigger the shared-axis
branch -- the 3-point path it falls back to when terrain isn't flat was
confirmed instead, and shares the same `_set_plane()`/commit plumbing).
Worth a real check next time flat ground is handy.

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

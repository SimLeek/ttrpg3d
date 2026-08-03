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

## Phase 0 -- Plane selection tool

- [ ] `PlaneSelectorItem`: click sets point 1, 2, 3 in sequence (reuse the
      corner-setting pattern from `StructureSaverItem`).
  - 2 points = axis-aligned plane (like the structure selector's box, but
    a plane, not a volume -- need to decide which axis it's normal to, or
    just require the two points to already share one coordinate).
  - 3 non-collinear points = arbitrary plane (any two points can share an
    axis and it still works, unlike the 2-point case).
  - Reject collinear 3-point picks (cross product ~0) with an inventory
    tooltip-style message, not a crash.
- [ ] If the voxel raycast doesn't hit anything: fall back to a plane at the
      player's feet/facing instead of requiring terrain. These are tool
      picks, not world edits, so they shouldn't be gated on hitting a block.
- [ ] Visual: DebugDraw3D gizmos again -- point 1/2/3 distinguishable colors,
      the resolved plane drawn as a bounded quad/grid so its extent is
      readable, consistent with the corner/pivot language from the structure
      tools.
- [ ] `BuildSession.set_plane(origin, basis_u, basis_v)`.

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

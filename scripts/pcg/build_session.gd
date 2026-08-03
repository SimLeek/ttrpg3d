extends Node
class_name BuildSession

## Shared state for the plane-select -> draw -> extrude/revolve/sweep
## building workflow (see TODO_build_tools.md). Found via the
## "build_session" group by the plane-selector and (future) draw tools,
## same lookup pattern as player_inventory/item_tooltip.

const RECENT_DRAWINGS_CAP := 10

var has_plane: bool = false
var plane_origin: Vector3i = Vector3i.ZERO
## Span vectors from plane_origin to the far edge of the selection along
## each plane axis -- not necessarily unit/axis-aligned (a 3-point plane
## can point anywhere). Draw tools (Phase 1) rasterize onto the nearest
## voxel per grid step; not built yet, so not a concern for plane
## selection itself.
var plane_basis_u: Vector3i = Vector3i.RIGHT
var plane_basis_v: Vector3i = Vector3i.UP

## Sparse plane-local coords (Vector2i, in basis_u/basis_v steps from
## plane_origin) -> voxel type id. Written by draw tools (Phase 1, not
## built yet).
var drawing: Dictionary = {}

## Ring buffer of {origin, basis_u, basis_v, drawing} snapshots, most
## recent last, pushed whenever the active drawing is consumed (e.g. by a
## volume-generation tool) instead of just being discarded.
var recent_drawings: Array[Dictionary] = []

func _ready() -> void:
	add_to_group("build_session")

func set_plane(origin: Vector3i, basis_u: Vector3i, basis_v: Vector3i) -> void:
	has_plane = true
	plane_origin = origin
	plane_basis_u = basis_u
	plane_basis_v = basis_v
	drawing.clear()

func clear_plane() -> void:
	has_plane = false
	drawing.clear()

func paint(local: Vector2i, voxel_id: int) -> void:
	drawing[local] = voxel_id

func erase(local: Vector2i) -> void:
	drawing.erase(local)

## Pushes the current drawing into recent history and clears the active
## drawing -- call before a volume-generation tool consumes it, so
## "destroy on use" doesn't mean "gone forever."
func consume_drawing() -> void:
	if not drawing.is_empty():
		recent_drawings.append({
			"origin": plane_origin,
			"basis_u": plane_basis_u,
			"basis_v": plane_basis_v,
			"drawing": drawing.duplicate(),
		})
		while recent_drawings.size() > RECENT_DRAWINGS_CAP:
			recent_drawings.pop_front()
	drawing.clear()

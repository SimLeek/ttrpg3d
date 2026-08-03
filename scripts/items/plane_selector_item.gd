extends BaseItem
class_name PlaneSelectorItem

## Defines the shared BuildSession plane that draw tools (Phase 1, not
## built yet) will paint onto.
##
## Click sets points in order. Two points commit immediately as an
## axis-aligned plane if they share exactly one coordinate (e.g. same Y --
## a horizontal plane, matching "top-left/bottom-right corner" style
## selection); otherwise a third, non-collinear point is needed to fully
## determine an arbitrary plane. Clicking again after a plane is resolved
## starts a fresh selection.
##
## If the voxel raycast doesn't hit anything, falls back to a point near
## the player's feet -- these are tool picks, not world edits, so they
## shouldn't be gated on aiming at a block.

@export var voxel_interactor: VoxelInteractor

var _points: Array = []  # Vector3i, up to 3

const POINT_COLORS := [Color.CYAN, Color.ORANGE, Color.MAGENTA]
const PLANE_OUTLINE_COLOR := Color(1, 1, 0, 0.8)

func set_character(chara: CharacterBody3D) -> void:
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)


func _physics_process(_delta: float) -> void:
	if not voxel_interactor or not character:
		return
	voxel_interactor.update_target(character)
	_draw_gizmos()


func use_item(pressure: float) -> void:
	super.use_item(pressure)
	var pos = _target_point()
	if pos == null:
		return

	_points.append(pos)
	if _points.size() == 2:
		var axis := _shared_axis(_points[0], _points[1])
		if axis >= 0:
			_commit_axis_aligned(_points[0], _points[1], axis)
			_points.clear()
	elif _points.size() >= 3:
		_commit_three_point(_points[0], _points[1], _points[2])
		_points.clear()


func _target_point():
	if voxel_interactor.has_valid_target():
		var hit = voxel_interactor.get_hit_info()
		if hit:
			return Vector3i(hit.position)
	# Tool picks aren't world edits -- don't require a raycast hit.
	if character and character.voxel_terrain:
		return Vector3i((character.global_position - character.voxel_terrain.global_position).floor())
	return null


## Returns which axis (0=x, 1=y, 2=z) is shared between the two points, or
## -1 if zero or more than one axis matches (can't make a unique
## axis-aligned plane from that -- need a third point instead).
func _shared_axis(a: Vector3i, b: Vector3i) -> int:
	var matches := int(a.x == b.x) + int(a.y == b.y) + int(a.z == b.z)
	if matches != 1:
		return -1
	if a.x == b.x: return 0
	if a.y == b.y: return 1
	return 2


func _commit_axis_aligned(a: Vector3i, b: Vector3i, axis: int) -> void:
	var origin: Vector3i
	var basis_u: Vector3i
	var basis_v: Vector3i
	match axis:
		0:
			origin = Vector3i(a.x, min(a.y, b.y), min(a.z, b.z))
			basis_u = Vector3i(0, abs(a.y - b.y), 0)
			basis_v = Vector3i(0, 0, abs(a.z - b.z))
		1:
			origin = Vector3i(min(a.x, b.x), a.y, min(a.z, b.z))
			basis_u = Vector3i(abs(a.x - b.x), 0, 0)
			basis_v = Vector3i(0, 0, abs(a.z - b.z))
		_:
			origin = Vector3i(min(a.x, b.x), min(a.y, b.y), a.z)
			basis_u = Vector3i(abs(a.x - b.x), 0, 0)
			basis_v = Vector3i(0, abs(a.y - b.y), 0)
	_set_plane(origin, basis_u, basis_v)


func _commit_three_point(a: Vector3i, b: Vector3i, c: Vector3i) -> void:
	var u := b - a
	var v := c - a
	var normal := Vector3(u).cross(Vector3(v))
	if normal.length() < 0.5:
		_notify("Those 3 points are in a line -- can't make a plane from them.")
		return
	_set_plane(a, u, v)


func _set_plane(origin: Vector3i, basis_u: Vector3i, basis_v: Vector3i) -> void:
	var session = get_tree().get_first_node_in_group("build_session")
	if session:
		session.set_plane(origin, basis_u, basis_v)
	_notify("Plane set.")


func _notify(text: String) -> void:
	var tooltip = get_tree().get_first_node_in_group("item_tooltip")
	if tooltip:
		tooltip.show_message(text)


func _draw_gizmos() -> void:
	if not voxel_interactor._terrain:
		return
	var origin: Vector3 = voxel_interactor._terrain.global_position

	for i in range(_points.size()):
		DebugDraw3D.draw_aabb(AABB(Vector3(_points[i]) + origin, Vector3.ONE), POINT_COLORS[i])

	var session = get_tree().get_first_node_in_group("build_session")
	if session and session.has_plane:
		_draw_plane_outline(session, origin)


func _draw_plane_outline(session, origin: Vector3) -> void:
	var o := Vector3(session.plane_origin) + origin
	var u := Vector3(session.plane_basis_u)
	var v := Vector3(session.plane_basis_v)
	var c1 := o
	var c2 := o + u
	var c3 := o + u + v
	var c4 := o + v
	DebugDraw3D.draw_line(c1, c2, PLANE_OUTLINE_COLOR)
	DebugDraw3D.draw_line(c2, c3, PLANE_OUTLINE_COLOR)
	DebugDraw3D.draw_line(c3, c4, PLANE_OUTLINE_COLOR)
	DebugDraw3D.draw_line(c4, c1, PLANE_OUTLINE_COLOR)


func on_unequipped() -> void:
	super.on_unequipped()
	_points.clear()
	if voxel_interactor:
		voxel_interactor.cleanup()

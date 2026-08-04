extends BaseItem
class_name PlaneSelectorItem

## Defines the shared BuildSession plane that draw tools (Phase 1, not
## built yet) will paint onto.
##
## Click sets points 1, 2, 3 in sequence; the plane commits once all three
## are placed, rejected if they're collinear. (Earlier version allowed
## committing after just 2 points if they happened to share an axis --
## removed per feedback, that shortcut was confusing in practice. Always
## 3 points now.)
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
	if _points.size() == 1:
		_notify("Corner 1 set (cyan)\nClick 2 more points (not in a line)")
	elif _points.size() == 2:
		_notify("Corner 2 set (orange)\nOne more -- the preview quad's far corner\nwill mirror one of your points across it")
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

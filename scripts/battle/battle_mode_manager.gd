extends Node

## Autoload. Turn-based "battle mode" -- toggled with toggle_battle_mode (B).
##
## While active, the player becomes a translucent, flying, intangible
## "ghost" (reusing the existing DM-mode fly/intangible movement already in
## player_blob_ctrl.gd, just force-enabled instead of requiring the
## double-tap) so a move can be planned by flying to preview positions
## without needing a separate ghost node or camera. primary/secondary item
## clicks are repurposed while active (see two_handed_resource.gd) to mark
## a waypoint / undo the last one, instead of using the currently-held
## item. Distance uses whichever single metric GameSettings.distance_norm_mode
## selects (Manhattan / Euclidean / a custom Minkowski n-norm) -- a game
## usually sticks to one, so this reports one number, not every metric at
## once.
##
## Waypoints snap to the center of whichever voxel they're marked in by
## default (GameSettings.snap_waypoints_to_grid) -- the TTRPG-grid-
## appropriate behavior -- with floating (exact position) as a non-default
## option. Each segment between waypoints, plus a live segment from the
## last marked waypoint to wherever the player currently is, gets its own
## distance shown on a 3D billboard label above its midpoint (not just in
## the 2D HUD), so anyone else looking at the same screen/world can read
## it too.

signal battle_mode_changed(is_active: bool)
signal waypoints_changed(waypoints: Array)

const MARKER_COLOR := Color(1.0, 0.85, 0.2)
const MARKER_RADIUS := 0.15
const LINE_COLOR := Color(1.0, 0.85, 0.2, 0.85)
const LINE_RADIUS := 0.09
const LIVE_LINE_COLOR := Color(1.0, 0.85, 0.2, 0.5)
const LABEL_Y_OFFSET := 0.4
const VOXEL_SIZE := 1.0

var active: bool = false
var waypoints: Array[Vector3] = []

var _marker_container: Node3D = null
var _live_line: MeshInstance3D = null
var _live_label: Label3D = null

func _ready() -> void:
	# Re-label already-placed segments immediately if the unit or distance
	# metric changes mid-battle-mode, rather than waiting for the next
	# mark/undo to pick it up.
	GameSettings.distance_unit_changed.connect(_refresh_markers)
	GameSettings.distance_norm_changed.connect(_refresh_markers)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_battle_mode"):
		toggle()
		get_viewport().set_input_as_handled()

func _physics_process(_delta: float) -> void:
	if active:
		_update_live_segment()

func toggle() -> void:
	set_active(not active)

func set_active(value: bool) -> void:
	if value == active:
		return
	active = value
	var player := _get_player()
	if active:
		# array-literal-in-a-ternary infers as plain Array, not
		# Array[Vector3] -- assigning that to the typed waypoints var
		# throws at runtime ("Trying to assign an array of type Array to
		# a variable of type Array[Vector3]"). clear()+append() instead.
		waypoints.clear()
		if player:
			waypoints.append(_snap_if_enabled(player.global_position, player))
			player.is_flying = true
			player.is_intangible = true
			_set_player_alpha(player, 0.35)
	else:
		if player:
			player.is_flying = false
			player.is_intangible = false
			_set_player_alpha(player, 1.0)
		waypoints.clear()
		_hide_live_segment()
	_refresh_markers()
	battle_mode_changed.emit(active)
	waypoints_changed.emit(waypoints)

func mark_current_position() -> void:
	if not active:
		return
	var player := _get_player()
	if not player:
		return
	waypoints.append(_snap_if_enabled(player.global_position, player))
	_refresh_markers()
	waypoints_changed.emit(waypoints)

func undo_last_waypoint() -> void:
	if not active or waypoints.size() <= 1:
		return
	waypoints.remove_at(waypoints.size() - 1)
	_refresh_markers()
	waypoints_changed.emit(waypoints)

func get_total_distance() -> float:
	var total := 0.0
	for i in range(1, waypoints.size()):
		total += GameSettings.compute_distance(waypoints[i], waypoints[i - 1])
	return total

func _get_player() -> Node:
	return get_tree().get_first_node_in_group("player")

func _set_player_alpha(player: Node, alpha: float) -> void:
	if not ("softy" in player) or not player.softy:
		return
	var mat: Material = player.softy.get_surface_override_material(0)
	if mat and mat is ShaderMaterial:
		var color: Color = mat.get_shader_parameter("albedo_color")
		color.a = alpha
		mat.set_shader_parameter("albedo_color", color)

## Snaps to the center of the voxel `pos` falls in, in the terrain's own
## local space (voxel grid boundaries are defined relative to the terrain,
## which isn't always at world origin -- shift_origin() in
## center_of_universe.gd re-centers $World periodically for large-world
## float precision), then converts back to world space. Controlled by
## GameSettings.snap_waypoints_to_grid; when off, returns `pos` unchanged
## for exact/floating placement.
func _snap_if_enabled(pos: Vector3, player: Node) -> Vector3:
	if not GameSettings.snap_waypoints_to_grid:
		return pos
	if not ("voxel_terrain" in player) or not player.voxel_terrain:
		return pos
	var terrain_origin: Vector3 = player.voxel_terrain.global_position
	var local_pos := pos - terrain_origin
	var snapped_local := Vector3(
		floor(local_pos.x / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE * 0.5,
		floor(local_pos.y / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE * 0.5,
		floor(local_pos.z / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE * 0.5
	)
	return snapped_local + terrain_origin

## Small floating markers at each waypoint, connected by thin cylinder
## "lines" between consecutive ones, so the planned path is actually
## visible in the world -- not just a number in the HUD, and not just
## disconnected dots either. Parented under the current scene so they're
## cleaned up automatically on world switch/reload.
func _refresh_markers() -> void:
	var scene := get_tree().current_scene
	if not scene:
		return
	if not _marker_container or not is_instance_valid(_marker_container):
		_marker_container = Node3D.new()
		_marker_container.name = "BattleModeWaypointMarkers"
		scene.add_child(_marker_container)
	for child in _marker_container.get_children():
		child.queue_free()
	for pos in waypoints:
		var marker := MeshInstance3D.new()
		var mesh := SphereMesh.new()
		mesh.radius = MARKER_RADIUS
		mesh.height = MARKER_RADIUS * 2.0
		marker.mesh = mesh
		var mat := StandardMaterial3D.new()
		mat.albedo_color = MARKER_COLOR
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		marker.material_override = mat
		_marker_container.add_child(marker)
		marker.global_position = pos
	for i in range(1, waypoints.size()):
		var from: Vector3 = waypoints[i - 1]
		var to: Vector3 = waypoints[i]
		# The cylinder's actual length is always the true geometric
		# (Euclidean) span between the two points -- that's a rendering
		# fact, not a measurement convention. Only the *label text* uses
		# whichever metric is selected (Manhattan/Euclidean/custom n-norm).
		var segment := _make_line_segment(LINE_COLOR, from.distance_to(to))
		_marker_container.add_child(segment)
		_orient_line_segment(segment, from, to)
		var label := _make_distance_label(GameSettings.compute_distance(from, to))
		_marker_container.add_child(label)
		label.global_position = (from + to) / 2.0 + Vector3(0, LABEL_Y_OFFSET, 0)

## The last marked waypoint to wherever the player is *right now* --
## updated every physics frame while active (unlike the committed
## waypoints/lines above, which only rebuild on mark/undo/enter/exit) so
## it tracks live movement. Reuses the same MeshInstance3D/Label3D each
## frame (just mutates their mesh height and transform) rather than
## recreating nodes 60 times a second.
func _update_live_segment() -> void:
	var player := _get_player()
	if not player or waypoints.is_empty():
		_hide_live_segment()
		return
	var last: Vector3 = waypoints[waypoints.size() - 1]
	var current: Vector3 = _snap_if_enabled(player.global_position, player)
	# The cylinder's length is always the true geometric (Euclidean) span;
	# only the label uses whichever metric is selected -- same split as
	# _refresh_markers() above.
	var dist := last.distance_to(current)
	if dist < 0.01:
		_hide_live_segment()
		return
	if not _live_line or not is_instance_valid(_live_line):
		_live_line = _make_line_segment(LIVE_LINE_COLOR, dist)
		var scene := get_tree().current_scene
		if scene:
			scene.add_child(_live_line)
	if not _live_label or not is_instance_valid(_live_label):
		_live_label = _make_distance_label(dist)
		var scene := get_tree().current_scene
		if scene:
			scene.add_child(_live_label)
	(_live_line.mesh as CylinderMesh).height = dist
	_orient_line_segment(_live_line, last, current)
	_live_line.visible = true
	_live_label.text = GameSettings.format_distance(GameSettings.compute_distance(last, current))
	_live_label.global_position = (last + current) / 2.0 + Vector3(0, LABEL_Y_OFFSET, 0)
	_live_label.visible = true

func _hide_live_segment() -> void:
	if _live_line and is_instance_valid(_live_line):
		_live_line.visible = false
	if _live_label and is_instance_valid(_live_label):
		_live_label.visible = false

## A solid cylinder for a connecting line -- thin PRIMITIVE_LINES worked
## (correctly positioned) but rendered at a fixed ~1px width with no way
## to make it visibly thicker; a real mesh has an adjustable radius.
## `initial_height` just needs to be > 0 so the mesh isn't degenerate
## before the first _orient_line_segment() call; callers that reuse this
## node every frame (the live segment) update mesh.height separately.
func _make_line_segment(color: Color, initial_height: float) -> MeshInstance3D:
	var line := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = LINE_RADIUS
	mesh.bottom_radius = LINE_RADIUS
	mesh.height = max(initial_height, 0.001)
	line.mesh = mesh

	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	line.material_override = mat
	return line

## Orients a Y-aligned CylinderMesh to point from `from` to `to`. An
## earlier hand-built 3-axis Basis (two cross products) rendered every
## line perpendicular to the intended direction -- this uses
## Quaternion(from_vec, to_vec), a single well-defined Godot constructor
## ("the shortest arc rotating from_vec to to_vec"), instead. That
## constructor has no unique rotation axis when the two vectors point
## exactly opposite each other (a waypoint marked directly below the
## previous one) -- the cross product it uses internally to find the axis
## is a zero vector there, which made some cylinders disappear (a
## degenerate/NaN transform renders nothing); falls back to an explicit
## 180-degree flip in that case.
func _orient_line_segment(line: MeshInstance3D, from: Vector3, to: Vector3) -> void:
	var diff := to - from
	var dist := diff.length()
	line.global_position = (from + to) / 2.0
	if dist < 0.0001:
		return
	var target := diff / dist
	if target.dot(Vector3.UP) < -0.9999:
		line.global_transform.basis = Basis(Vector3.RIGHT, PI)
	else:
		line.global_transform.basis = Basis(Quaternion(Vector3.UP, target))

## A 3D billboard (always faces the camera) showing a segment's distance,
## so it's visible in-world to anyone looking at the same screen/scene --
## not just as 2D HUD text tied to the local camera.
func _make_distance_label(dist: float) -> Label3D:
	var label := Label3D.new()
	label.text = GameSettings.format_distance(dist)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 48
	label.outline_size = 8
	label.modulate = Color(1.0, 0.95, 0.7)
	return label

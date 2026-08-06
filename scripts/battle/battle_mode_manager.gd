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
## item. Distance is tracked both Euclidean (straight-line) and Manhattan
## (grid/voxel-step), since which one matters depends on the table's
## movement rules.

signal battle_mode_changed(is_active: bool)
signal waypoints_changed(waypoints: Array)

const MARKER_COLOR := Color(1.0, 0.85, 0.2)
const MARKER_RADIUS := 0.15
const LINE_COLOR := Color(1.0, 0.85, 0.2, 0.85)
const LINE_RADIUS := 0.09

var active: bool = false
var waypoints: Array[Vector3] = []

var _marker_container: Node3D = null

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_battle_mode"):
		toggle()
		get_viewport().set_input_as_handled()

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
			waypoints.append(player.global_position)
			player.is_flying = true
			player.is_intangible = true
			_set_player_alpha(player, 0.35)
	else:
		if player:
			player.is_flying = false
			player.is_intangible = false
			_set_player_alpha(player, 1.0)
		waypoints.clear()
	_refresh_markers()
	battle_mode_changed.emit(active)
	waypoints_changed.emit(waypoints)

func mark_current_position() -> void:
	if not active:
		return
	var player := _get_player()
	if not player:
		return
	waypoints.append(player.global_position)
	_refresh_markers()
	waypoints_changed.emit(waypoints)

func undo_last_waypoint() -> void:
	if not active or waypoints.size() <= 1:
		return
	waypoints.remove_at(waypoints.size() - 1)
	_refresh_markers()
	waypoints_changed.emit(waypoints)

func get_euclidean_distance() -> float:
	var total := 0.0
	for i in range(1, waypoints.size()):
		total += waypoints[i].distance_to(waypoints[i - 1])
	return total

func get_manhattan_distance() -> float:
	var total := 0.0
	for i in range(1, waypoints.size()):
		var d: Vector3 = (waypoints[i] - waypoints[i - 1]).abs()
		total += d.x + d.y + d.z
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
		var segment := _make_line_segment(waypoints[i - 1], waypoints[i])
		_marker_container.add_child(segment)
		_orient_line_segment(segment, waypoints[i - 1], waypoints[i])

## A solid cylinder for the connecting line -- thin PRIMITIVE_LINES worked
## (correctly positioned, per your confirmation) but rendered at a fixed
## ~1px width with no way to make it visibly thicker; a real mesh has an
## adjustable radius. mesh.height is set directly to the real distance
## here (not via a scale applied alongside the rotation in
## _orient_line_segment) to avoid entangling scale-order with rotation-
## order in the same Basis -- one less thing to get backwards.
func _make_line_segment(from: Vector3, to: Vector3) -> MeshInstance3D:
	var line := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = LINE_RADIUS
	mesh.bottom_radius = LINE_RADIUS
	mesh.height = max(from.distance_to(to), 0.001)
	line.mesh = mesh

	var mat := StandardMaterial3D.new()
	mat.albedo_color = LINE_COLOR
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	line.material_override = mat
	return line

## Orients a Y-aligned CylinderMesh to point from `from` to `to`. The
## previous attempt at this hand-built a 3-axis Basis from two cross
## products and rendered perpendicular to the intended direction instead
## -- rather than keep staring at that derivation for a sign/order
## mistake, this uses Quaternion(from_vec, to_vec), a single well-defined
## Godot constructor ("the shortest arc rotating from_vec to to_vec") that
## leaves much less room to get wrong. Also sets the transform only after
## the node is already inside the tree (previously set before add_child(),
## which is a plausible second contributor -- global_transform on an
## unparented Node3D is not something to rely on).
func _orient_line_segment(line: MeshInstance3D, from: Vector3, to: Vector3) -> void:
	var diff := to - from
	var dist := diff.length()
	line.global_position = (from + to) / 2.0
	if dist < 0.0001:
		return
	var target := diff / dist
	if target.dot(Vector3.UP) < -0.9999:
		# Quaternion(from_vec, to_vec) has no unique axis to rotate around
		# when the two vectors point exactly opposite each other (a
		# waypoint marked directly below the previous one) -- the cross
		# product it uses internally to find the rotation axis is a zero
		# vector there, which is almost certainly why some cylinders were
		# disappearing (a degenerate/NaN transform renders nothing).
		# Falls back to an explicit 180-degree flip around an arbitrary
		# perpendicular axis instead.
		line.global_transform.basis = Basis(Vector3.RIGHT, PI)
	else:
		line.global_transform.basis = Basis(Quaternion(Vector3.UP, target))

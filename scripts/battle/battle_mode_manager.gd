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
		waypoints = [player.global_position] if player else []
		if player:
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

## Small floating markers at each waypoint so the planned path is actually
## visible in the world, not just a number in the HUD. Parented under the
## current scene so they're cleaned up automatically on world switch/reload.
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

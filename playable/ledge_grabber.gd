@tool
extends Node3D
class_name LedgeGrabber
# this is a general ledge grabber that could be used for players, npcs, grappling hooks, etc.
# for grappling hooks, you should set the max fall velocity to much higher or infinite

signal ledge_grab_attempt(data: LedgeData)
signal ledge_grab_failed(reason: String)
signal hand_positions_updated(left_pos: Vector3, right_pos: Vector3, center_pos: Vector3, left_valid: bool, right_valid: bool)
signal ledge_grab_released()

class LedgeData:
	var ledge_pos: Vector3
	var wall_normal: Vector3
	var left_pos: Vector3
	var right_pos: Vector3
	var left_blocked: bool
	var right_blocked: bool
	var left_open: bool
	var right_open: bool

@export var ray_angle_deg: float = 45.0
@export var ray_length: float = 2.0
@export var rest_length: float = 1.5
@export var ledge_pull_strength: float = 5.0
@export var max_fall_velocity: float = 30.0
@export var ledge_grab_key: String = ""
@export var hand_distance: float = 0.5
@export var above_check_dist: float = 0.2
@export var forward_step_dist: float = 0.2
@export var debug_draw: bool = false
@export var debug_print: bool = false
## Add exclusions here, such as SoftBody3D nodes
@export var additional_exclusions: Array[Node3D] = []

@export_group("Advanced")
@export var wall_dot_limit: float = 0.1
@export var floor_dot_limit: float = 0.9

const EPSILON: float = 0.01
const MAX_BINARY_ITERS: int = 2

var character: CharacterBody3D
var space_state: PhysicsDirectSpaceState3D
var exclude: Array[RID]
var collision_body: StaticBody3D
var collision_shape: CollisionShape3D

var prev_left_failed: bool = false
var prev_right_failed: bool = false
var left_search_angle: float = 0.0
var right_search_angle: float = 0.0

var is_grabbing_ledge : bool= false

func _ready() -> void:
	character = get_parent() as CharacterBody3D
	exclude = [character.get_rid()]
	for child in character.get_children():
		if child is SoftBody3D:
			exclude.append(child.get_physics_rid())
	for node in additional_exclusions:
		exclude.append(node.get_rid())
	if Engine.is_editor_hint():
		debug_draw = true
		return
	if not character:
		_debug_print("LedgeGrabber ERROR: Must be child of CharacterBody3D")
		push_error("LedgeGrabber must be child of CharacterBody3D")
		return
	space_state = get_world_3d().direct_space_state
	

func _debug_print(message: String) -> void:
	if debug_print:
		print(message)

func _physics_process(delta: float) -> void:
	if character == null:
		character = get_parent() as CharacterBody3D
		if not character:
			_debug_print("LedgeGrabber: Character still null, returning")
			is_grabbing_ledge = false
			return
	if space_state == null:
		space_state = get_world_3d().direct_space_state
	
	var grab_input:bool
	if Engine.is_editor_hint():
		grab_input = true  # no input available in editor
	else:
		grab_input = ledge_grab_key.is_empty() or Input.is_action_pressed(ledge_grab_key)
	if not grab_input:
		_debug_print("LedgeGrabber: Grab input not pressed")
		if is_grabbing_ledge:
			is_grabbing_ledge = false
			ledge_grab_released.emit()
		return
	
	var fall_vel: float = -character.velocity.y
	if fall_vel >= max_fall_velocity:
		_debug_print("LedgeGrabber: Fall velocity too high: " + str(fall_vel) + " >= " + str(max_fall_velocity))
		ledge_grab_failed.emit("fall_velocity")
		if is_grabbing_ledge:
			is_grabbing_ledge = false
			ledge_grab_released.emit()
		return
	
	var origin: Vector3 = character.global_position
	var forward: Vector3 = -character.global_basis.z
	var up: Vector3 = character.global_basis.y
	
	var angle_rad: float = deg_to_rad(ray_angle_deg)
	var ray_vec_2d: Vector2 = Vector2(cos(angle_rad), sin(angle_rad))
	var dir: Vector3 = (forward * ray_vec_2d.x + up * ray_vec_2d.y).normalized() * ray_length
	
	var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(origin, origin + dir)
	query.exclude = exclude
	query.collide_with_areas = false
	query.collide_with_bodies = true
	
	var hit1: Dictionary = space_state.intersect_ray(query)
	if hit1.is_empty():
		_debug_print("LedgeGrabber: Initial ray missed (no wall detected)")
		_draw_debug(origin, origin + dir, Color.RED)
		if is_grabbing_ledge:
			is_grabbing_ledge = false
			ledge_grab_released.emit()
		return
	
	var wall_norm: Vector3 = hit1.normal
	if wall_norm.dot(forward) > -wall_dot_limit:
		_debug_print("LedgeGrabber: Wall normal check failed. Dot: " + str(wall_norm.dot(forward)) + " > " + str(-wall_dot_limit))
		_draw_debug(origin, hit1.position, Color.YELLOW)
		if is_grabbing_ledge:
			is_grabbing_ledge = false
			ledge_grab_released.emit()
		return
	
	var from2: Vector3 = hit1.position + dir.normalized() * EPSILON
	# needs to be reversed so we're checking outside, then going in. Inside to out doesn't work.
	query.to = from2
	query.from = from2 + dir - (hit1.position - origin)
	var hit2: Dictionary = space_state.intersect_ray(query)
	if hit2.is_empty():
		_debug_print("LedgeGrabber: Second ray missed (no floor/ledge detected)")
		_draw_debug(hit1.position, query.to, Color.RED)
		if is_grabbing_ledge:
			is_grabbing_ledge = false
			ledge_grab_released.emit()
		return
		
	# check inverse direction to make sure there is NOT a collision, because that means something is blocking
	query.from = from2
	query.to = from2 + dir - (hit1.position - origin)
	var hit3: Dictionary = space_state.intersect_ray(query)
	if not hit3.is_empty():
		_debug_print("LedgeGrabber: Second ray missed (no floor/ledge detected)")
		_draw_debug(hit1.position, query.to, Color.RED)
		if is_grabbing_ledge:
			is_grabbing_ledge = false
			ledge_grab_released.emit()
		return
	
	var floor_norm: Vector3 = hit2.normal
	if floor_norm.dot(up) < floor_dot_limit:
		_debug_print("LedgeGrabber: Floor normal check failed. Dot: " + str(floor_norm.dot(up)) + " < " + str(floor_dot_limit))
		_draw_debug(from2, hit2.position, Color.YELLOW)
		if is_grabbing_ledge:
			is_grabbing_ledge = false
			ledge_grab_released.emit()
		return
	
	var exit_pos: Vector3 = hit2.position
	var slope_tan: float = tan(deg_to_rad(character.floor_max_angle))
	var left_perp: Vector3 = wall_norm.cross(up).normalized()
	var right_perp: Vector3 = -left_perp
	
	var left_data: Array = _check_side(exit_pos, left_perp, slope_tan, forward, prev_left_failed, left_search_angle)
	var right_data: Array = _check_side(exit_pos, right_perp, slope_tan, forward, prev_right_failed, right_search_angle)
	
	prev_left_failed = left_data[3]
	prev_right_failed = right_data[3]
	left_search_angle = left_data[4]
	right_search_angle = right_data[4]
	
	_debug_print("LedgeGrabber: LEDGE FOUND! Left blocked: " + str(left_data[1]) + ", Right blocked: " + str(right_data[1]) + ", Left open: " + str(left_data[2]) + ", Right open: " + str(right_data[2]))
	
	var data: LedgeData = LedgeData.new()
	data.ledge_pos = exit_pos
	data.wall_normal = wall_norm
	data.left_pos = left_data[0]
	data.right_pos = right_data[0]
	data.left_blocked = left_data[1]
	data.right_blocked = right_data[1]
	data.left_open = left_data[2]
	data.right_open = right_data[2]
	
	# springy ledge grab physics:
	var rest_angle_rad: float = deg_to_rad(ray_angle_deg)
	var rest_vec_2d: Vector2 = Vector2(cos(rest_angle_rad), sin(rest_angle_rad))
	var rest_dir: Vector3 = (forward * rest_vec_2d.x + up * rest_vec_2d.y).normalized() * rest_length
	var ideal_pos: Vector3 = exit_pos - rest_dir

	# Calculate distance from ideal position
	var current_pos: Vector3 = character.global_position
	var diff: Vector3 = ideal_pos - current_pos
	var distance: float = diff.length()

	# Set velocity towards ledge point proportional to distance
	if character.velocity.y<0.001:
		if distance > 0.001:
			var pull_velocity: Vector3 = diff.normalized() * ledge_pull_strength * distance
			character.velocity = pull_velocity
		else:
			character.velocity = Vector3.ZERO

	var left_valid: bool = not data.left_blocked and not data.left_open
	var right_valid: bool = not data.right_blocked and not data.right_open
	
	hand_positions_updated.emit(data.left_pos, data.right_pos, data.ledge_pos, left_valid, right_valid)
	ledge_grab_attempt.emit(data)
	is_grabbing_ledge = true
	
	_draw_debug(origin, hit1.position, Color.GREEN)
	_draw_debug(from2, hit2.position, Color.GREEN)

func _check_side(exit_pos: Vector3, perp_dir: Vector3, slope_tan: float, forward: Vector3, prev_failed: bool, prev_angle: float) -> Array:
	var up: Vector3 = character.global_basis.y
	var search: bool = prev_failed
	var angle: float = prev_angle if search else 0.0
	var found_pos: Vector3 = Vector3.ZERO
	var blocked: bool = false
	var open: bool = false
	
	if search:
		_debug_print("LedgeGrabber: Searching for side ledge with binary search")
		var low: float = 0.0
		var high: float = 90.0
		for i in range(MAX_BINARY_ITERS):
			angle = (low + high) * 0.5
			var rot_dir: Vector3 = perp_dir.rotated(up, deg_to_rad(angle * sign(perp_dir.dot(forward))))
			var res: Array = _cast_side_rays(exit_pos, rot_dir, slope_tan)
			if res[0]:
				_debug_print("LedgeGrabber: Binary iter " + str(i) + " found valid at angle " + str(angle))
				high = angle
				found_pos = res[2]
			else:
				_debug_print("LedgeGrabber: Binary iter " + str(i) + " invalid at angle " + str(angle))
				low = angle
		angle = (low + high) * 0.5
	
	var res_final: Array = _cast_side_rays(exit_pos, perp_dir, slope_tan)
	var valid: bool = res_final[0]
	blocked = res_final[1]
	found_pos = res_final[2] if valid else Vector3.ZERO
	
	if not valid and not blocked:
		_debug_print("LedgeGrabber: Side check - edge is open (no surface found)")
		open = true
	
	if valid:
		_debug_print("LedgeGrabber: Side check - valid ledge position found")
	elif blocked:
		_debug_print("LedgeGrabber: Side check - blocked by wall")
	
	var failed: bool = not valid and not blocked
	return [found_pos, blocked, open, failed, angle]

func _cast_side_rays(exit_pos: Vector3, side_dir: Vector3, slope_tan: float) -> Array:
	var up: Vector3 = character.global_basis.y
	var offset_pos: Vector3 = exit_pos + side_dir * hand_distance
	var up_offset: float = slope_tan * hand_distance + EPSILON
	var ray_start: Vector3 = offset_pos + up * up_offset
	var ray_end_y: float = exit_pos.y - slope_tan * hand_distance - EPSILON
	var ray_end: Vector3 = Vector3(ray_start.x, ray_end_y, ray_start.z)
	
	var wall_query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(
		ray_start,
		ray_start - character.global_basis.z * above_check_dist
	)
	wall_query.exclude = exclude
	var wall_hit: Dictionary = space_state.intersect_ray(wall_query)
	var blocked: bool = not wall_hit.is_empty() and wall_hit.normal.dot(-character.global_basis.z) > 0.5
	
	if blocked:
		_debug_print("LedgeGrabber: Side ray blocked by wall above")
		_draw_debug(ray_start, wall_query.to, Color.RED)
		return [false, true, Vector3.ZERO]
	
	var down_query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(ray_start, ray_end)
	down_query.exclude = exclude
	var down_hit: Dictionary = space_state.intersect_ray(down_query)
	if down_hit.is_empty():
		_debug_print("LedgeGrabber: Side ray down missed (no floor)")
		_draw_debug(ray_start, ray_end, Color.RED)
		return [false, false, Vector3.ZERO]
	
	var dx_dir: Vector3 = side_dir * 0.01
	var dx_start: Vector3 = down_hit.position + dx_dir
	var dx_end: Vector3 = Vector3(dx_start.x, ray_end_y, dx_start.z)
	var dx_query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(dx_start, dx_end)
	dx_query.exclude = exclude
	var dx_hit: Dictionary = space_state.intersect_ray(dx_query)
	var dy: float = dx_hit.position.y - down_hit.position.y if not dx_hit.is_empty() else 0.0
	var slope: float = dy / 0.01
	if abs(slope) > slope_tan:
		_debug_print("LedgeGrabber: Side slope too steep: " + str(abs(slope)) + " > " + str(slope_tan))
		_draw_debug(ray_start, ray_end, Color.YELLOW)
		return [false, false, Vector3.ZERO]
	
	_debug_print("LedgeGrabber: Side ray valid!")
	_draw_debug(ray_start, ray_end, Color.GREEN)
	return [true, false, down_hit.position]

func _draw_debug(from: Vector3, to: Vector3, color: Color) -> void:
	if not debug_draw:
		return
		
	#if Engine.is_editor_hint():
		# Use DebugDraw3D instead of RenderingServer
	DebugDraw3D.draw_line(from, to, color)
	return
	
	var rid: RID = RenderingServer.instance_create()
	var mesh_rid: RID = RenderingServer.mesh_create()
	var verts: PackedVector3Array = [from - global_position, to - global_position]
	RenderingServer.mesh_add_surface_from_arrays(
		mesh_rid,
		RenderingServer.PRIMITIVE_LINES,
		[verts]
	)
	var mat_rid: RID = RenderingServer.material_create()
	RenderingServer.material_set_param(mat_rid, "albedo_color", color)
	#RenderingServer.material_set_transparency(mat_rid, RenderingServer.TRANSPAR)
	RenderingServer.instance_set_base(rid, mesh_rid)
	RenderingServer.instance_set_scenario(rid, get_world_3d().scenario)
	call_deferred("_free_debug", rid, mesh_rid, mat_rid)

func _free_debug(rid: RID, mesh: RID, mat: RID) -> void:
	RenderingServer.free_rid(rid)
	RenderingServer.free_rid(mesh)
	RenderingServer.free_rid(mat)

#func _notification(what: int) -> void:
#	if Engine.is_editor_hint() and what == 16:
#		_update_gizmo_collision_box()

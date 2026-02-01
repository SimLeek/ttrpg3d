extends Resource
class_name TerrainDetectionSystem

@export_group("Terrain Detection")
@export var check_in_front_dist: float = 0.75
@export var max_safe_drop: float = 2.4
@export var max_jump_height: float = 2.4
@export var min_obstacle_height_needed_to_jump_over: float = 0.3

const epsilon = 0.01

var cliff_detector: RayCast3D
var wall_detector: RayCast3D
var jump_detector: RayCast3D
var exclude: Array[RID]

var debug_bounce_normal
var debug_bounce_origin
#var bounce_normal

class ObstacleCheck:
	var move_dir:Vector3
	var bounced:bool
	var bounce_normal:Vector3
	
	func _init(_move_dir: Vector3, _bounced: bool, _bounce_normal: Vector3):
		move_dir = _move_dir
		bounced = _bounced
		bounce_normal = _bounce_normal

func setup(body: CharacterBody3D, players:Array[Node]) -> void:
	setup_raycasts(body, players)

func setup_raycasts(body: CharacterBody3D, players:Array[Node]) -> void:
	var forward_direction: Vector3 = -body.global_transform.basis.z.normalized()
	
	cliff_detector = _create_cliff_detector(body, forward_direction)
	wall_detector = _create_wall_detector(body, forward_direction)
	jump_detector = _create_jump_detector(body, forward_direction)
	
	exclude = [body.get_rid()]
	for child in body.get_children():
		if child is SoftBody3D:
			exclude.append(child.get_physics_rid())
	for player in players:
		for child in player.get_children():
			if child is SoftBody3D:
				exclude.append(child.get_physics_rid())

func check_for_obstacles(
	ai_body: CharacterBody3D,
	player: Node3D, 
	intended_dir: Vector3
	) -> ObstacleCheck:

	if intended_dir.length_squared() < 0.01:
		return ObstacleCheck.new(Vector3.ZERO, false, Vector3.ZERO)
		#return {"move_dir":Vector3.ZERO, "bounced":false}
	
	# Point detectors in intended direction
	jump_detector.position = intended_dir*check_in_front_dist + Vector3(0, max_jump_height, 0)
	jump_detector.target_position = Vector3(0, -max_jump_height, 0) + Vector3(0, 0.1, 0)

	cliff_detector.position = intended_dir*check_in_front_dist + Vector3(0, 0.1, 0)
	cliff_detector.target_position = Vector3(0, -1, 0) * max_safe_drop
	
	wall_detector.position = Vector3(0, 0.1, -check_in_front_dist*.1) # a bit behind us in case we're phasing into the wall
	wall_detector.target_position = intended_dir*check_in_front_dist*1.1
	
	cliff_detector.force_raycast_update()
	jump_detector.force_raycast_update()
	wall_detector.force_raycast_update()

	var can_jump_over = jump_detector.is_colliding()
	var has_cliff = not cliff_detector.is_colliding()
	var has_wall = GlobalLib.special_ray_check(wall_detector, ai_body, player, exclude) and not can_jump_over

	# If we can jump over obstacle, do it
	if can_jump_over:
		ai_body.jump()
		return ObstacleCheck.new(intended_dir, false, Vector3.ZERO)

	# If path is clear, go ahead
	if not has_cliff and not has_wall:
		return ObstacleCheck.new(intended_dir, false, Vector3.ZERO)

	# Hit obstacle - get normal and bounce
	var bounce_normal = Vector3.ZERO
	
	if has_wall:
		# Get wall normal directly from collision
		# for some reason minus stops it from rushing directly into walls
		print("wall bounce")
		bounce_normal = -wall_detector.get_collision_normal()
		bounce_normal.y = 0  # Keep it horizontal
		bounce_normal = bounce_normal.normalized()
		# Store for debug visualization
		debug_bounce_origin = wall_detector.get_collision_point()
		debug_bounce_normal = bounce_normal
	elif has_cliff:
		print("cliff bounce")

		# Use ledge-grabber style cliff detection
		bounce_normal = _get_cliff_edge_normal_ledge_style(ai_body, intended_dir)
		# Store for debug visualization
		debug_bounce_origin = ai_body.global_position + intended_dir * check_in_front_dist
		debug_bounce_normal = bounce_normal
	
	if bounce_normal.length_squared() < 0.01:
		# Fallback: just reverse direction
		bounce_normal = -intended_dir
		debug_bounce_origin = ai_body.global_position
		debug_bounce_normal = bounce_normal
	
	# Return zero for now to let other functions take over
	print("bounced")
	return ObstacleCheck.new(Vector3.ZERO, true, bounce_normal)

func _get_cliff_edge_normal_ledge_style(ai_body: CharacterBody3D, forward_dir: Vector3) -> Vector3:
	var up: Vector3 = Vector3.UP
	var origin: Vector3 = ai_body.global_position
	
	# First ray: angled down-forward to find wall
	var ray_angle_rad: float = deg_to_rad(45.0)
	var ray_vec_2d: Vector2 = Vector2(cos(ray_angle_rad), sin(ray_angle_rad))
	var ray_length: float = check_in_front_dist * 1.5
	var dir: Vector3 = (forward_dir * ray_vec_2d.x + -up * ray_vec_2d.y).normalized() * ray_length
	
	var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(origin, origin + dir)
	query.exclude = exclude
	query.collide_with_areas = false
	query.collide_with_bodies = true
	
	var space_state = ai_body.get_world_3d().direct_space_state
	var hit1: Dictionary = space_state.intersect_ray(query)
	if hit1.is_empty():
		# No wall found, just reverse
		return -forward_dir
	
	var wall_norm: Vector3 = hit1.normal
	var enter_pos: Vector3 = hit1.position
	
	# Calculate perpendicular directions along cliff edge
	var left_perp: Vector3 = wall_norm.cross(up).normalized()
	var right_perp: Vector3 = -left_perp
	
	# Check both sides to find edge positions
	var hand_distance: float = 0.5
	var left_data: Array = _check_cliff_side_ledge_style(ai_body, enter_pos, left_perp, forward_dir, hand_distance)
	var right_data: Array = _check_cliff_side_ledge_style(ai_body, enter_pos, right_perp, forward_dir, hand_distance)
	
	var left_pos: Vector3 = left_data[0]
	var right_pos: Vector3 = right_data[0]
	var left_found: bool = left_data[1]
	var right_found: bool = right_data[1]
	
	# Calculate cliff edge normal from the two side points
	if left_found and right_found:
		var edge_vector: Vector3 = right_pos - left_pos
		edge_vector.y = 0
		# Normal perpendicular to edge
		var normal: Vector3 = Vector3(edge_vector.z, 0, -edge_vector.x).normalized()
		
		# Make sure it points away from movement direction
		if normal.dot(forward_dir) > 0:
			normal = -normal
		
		return normal
	elif left_found:
		return -left_perp
	elif right_found:
		return -right_perp
	else:
		# Fallback to wall normal
		var result = wall_norm
		result.y = 0
		return result.normalized()


func _check_cliff_side_ledge_style(ai_body: CharacterBody3D, exit_pos: Vector3, side_dir: Vector3, forward_dir: Vector3, hand_distance: float) -> Array:
	var up: Vector3 = Vector3.UP
	var slope_tan: float = tan(deg_to_rad(ai_body.floor_max_angle))
	
	var offset_pos: Vector3 = exit_pos + side_dir * hand_distance
	var up_offset: float = slope_tan * hand_distance + epsilon
	var ray_start: Vector3 = offset_pos + up * up_offset
	var ray_end_y: float = exit_pos.y - slope_tan * hand_distance - epsilon
	var ray_end: Vector3 = Vector3(ray_start.x, ray_end_y, ray_start.z)
	
	# Check for wall blocking above
	var wall_query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(
		ray_start,
		ray_start + forward_dir * 0.2
	)
	wall_query.exclude = exclude
	var space_state = ai_body.get_world_3d().direct_space_state

	var wall_hit: Dictionary = space_state.intersect_ray(wall_query)
	if not wall_hit.is_empty():
		# Blocked
		return [Vector3.ZERO, false]
	
	# Check for floor below
	var down_query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(ray_start, ray_end)
	down_query.exclude = exclude
	var down_hit: Dictionary = space_state.intersect_ray(down_query)
	if down_hit.is_empty():
		# No floor
		return [Vector3.ZERO, false]
	
	# Check slope
	var dx_dir: Vector3 = side_dir * 0.01
	var dx_start: Vector3 = down_hit.position + dx_dir
	var dx_end: Vector3 = Vector3(dx_start.x, ray_end_y, dx_start.z)
	var dx_query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(dx_start, dx_end)
	dx_query.exclude = exclude
	var dx_hit: Dictionary = space_state.intersect_ray(dx_query)
	
	if not dx_hit.is_empty():
		var dy: float = dx_hit.position.y - down_hit.position.y
		var slope: float = dy / 0.01
		if abs(slope) > slope_tan:
			# Too steep
			return [Vector3.ZERO, false]
	
	return [down_hit.position, true]

func _create_cliff_detector(body: CharacterBody3D, forward: Vector3) -> RayCast3D:
	var detector = RayCast3D.new()
	detector.target_position = Vector3(0, -1, 0) * (max_safe_drop + 0.9)
	detector.enabled = true
	detector.collision_mask = 3
	detector.position = forward * check_in_front_dist + Vector3(0, 0.1, 0)
	detector.exclude_parent = true
	body.add_child(detector)
	return detector

func _create_wall_detector(body: CharacterBody3D, forward: Vector3) -> RayCast3D:
	var detector = RayCast3D.new()
	detector.target_position = forward * check_in_front_dist
	detector.enabled = true
	detector.collision_mask = 3
	detector.position = forward * check_in_front_dist
	detector.exclude_parent = true
	body.add_child(detector)
	return detector

func _create_jump_detector(body: CharacterBody3D, forward: Vector3) -> RayCast3D:
	var detector = RayCast3D.new()
	detector.target_position = forward * check_in_front_dist + Vector3(0, -1, 0) * 0.1
	detector.enabled = true
	detector.collision_mask = 3
	detector.position = forward * check_in_front_dist + Vector3(0, max_jump_height, 0)
	detector.exclude_parent = true
	body.add_child(detector)
	return detector
	
func draw_debug(ai_body: CharacterBody3D) -> void:
	# Cliff detector ray
	if cliff_detector:
		var start = ai_body.to_global(cliff_detector.position)
		var end = start + cliff_detector.target_position
		var color = Color.GREEN

		cliff_detector.force_raycast_update()
		if not cliff_detector.is_colliding():
			color = Color.RED
		else:
			var drop = ai_body.global_position.y - cliff_detector.get_collision_point().y
			if drop > max_safe_drop:
				color = Color.RED

		DebugDraw3D.draw_line(start, end, color, 0.0)
		if cliff_detector.is_colliding():
			DebugDraw3D.draw_sphere(cliff_detector.get_collision_point(), 0.15, Color.GREEN_YELLOW, 0.0)

	# Wall detector
	if wall_detector:
		var start = ai_body.to_global(wall_detector.position)
		var end = start + wall_detector.target_position
		var color = Color.GREEN if not wall_detector.is_colliding() else Color.RED

		wall_detector.force_raycast_update()
		DebugDraw3D.draw_line(start, end, color, 0.0)
		if wall_detector.is_colliding():
			DebugDraw3D.draw_sphere(wall_detector.get_collision_point(), 0.15, Color.INDIAN_RED, 0.0)

	# Jump detector
	if jump_detector:
		var start = ai_body.to_global(jump_detector.position)
		var end = start + jump_detector.target_position
		var color = Color.ORANGE if not jump_detector.is_colliding() else Color.GREEN

		jump_detector.force_raycast_update()
		DebugDraw3D.draw_line(start, end, color, 0.0)
		if jump_detector.is_colliding():
			DebugDraw3D.draw_sphere(jump_detector.get_collision_point(), 0.15, Color.GREEN_YELLOW, 0.0)
	

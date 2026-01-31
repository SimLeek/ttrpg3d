extends Resource
class_name BlobAIResource

@export_group("Detection")
@export var horiz_degree_view: float = 180.0
@export var vert_degree_view: float = 120.0
@export var detection_range: float = 60.0

@export_group("Wandering")
@export var wander_radius: float = 10.0
@export var wander_wait_time: float = 3.0
@export var return_pull_strength: float = 0.5

@export_group("Terrain Detection")
@export var check_in_front_dist: float = 0.75
@export var max_safe_drop: float = 2.4
@export var max_jump_height: float = 2.4
@export var min_obstacle_height_needed_to_jump_over: float = 0.3

@export_group("Combat")
@export var attack_range: float = 1.5
@export var attack_cooldown: float = 1.0

@export_group("Bounce Back")
@export var bounce_back_time: float = 2.0  # how long to bounce back after hitting obstacle

const epsilon = 0.01

enum AIState { WANDER, CHASE, ATTACK, BOUNCING }

# State
var current_state : AIState = AIState.WANDER
var player_last_seen_at: Vector3
var previous_state : AIState = AIState.WANDER  # store state before bouncing

var spawn_position: Vector3
var wander_target: Vector3
var wander_timer: float = 0.0
var attack_timer: float = 0.0
var bounce_timer: float = 0.0
var bounce_direction: Vector3 = Vector3.ZERO

# detectors
var cliff_detector: RayCast3D
var wall_detector: RayCast3D
var jump_detector: RayCast3D
var los_raycast: RayCast3D
var exclude: Array[RID]
var space_state: PhysicsDirectSpaceState3D
var first_run:bool = false

# Debug viz only
var debug_move_dir: Vector3 = Vector3.ZERO
var debug_look_dir: Vector3 = Vector3.ZERO
var debug_bounce_normal: Vector3 = Vector3.ZERO
var debug_bounce_origin: Vector3 = Vector3.ZERO

func setup_detection_systems(body:CharacterBody3D) -> void:
	var forward_direction: Vector3 = -body.global_transform.basis.z.normalized()
	
	# Cliff detector
	cliff_detector = RayCast3D.new()
	cliff_detector.target_position = Vector3(0, -1, 0) * (max_safe_drop + 0.9)
	cliff_detector.enabled = true
	cliff_detector.collision_mask = 3
	cliff_detector.position = forward_direction*check_in_front_dist + Vector3(0, 0.1, 0)
	cliff_detector.exclude_parent = true
	body.add_child(cliff_detector)
	
	wall_detector = RayCast3D.new()
	wall_detector.target_position = forward_direction*check_in_front_dist
	wall_detector.enabled = true
	wall_detector.collision_mask = 3
	wall_detector.position = forward_direction*check_in_front_dist
	wall_detector.exclude_parent = true
	body.add_child(wall_detector)
	
	# Jump detector
	jump_detector = RayCast3D.new()
	jump_detector.target_position = forward_direction*check_in_front_dist + Vector3(0, -1, 0) * 0.1
	jump_detector.enabled = true
	jump_detector.collision_mask = 3
	jump_detector.position = forward_direction*check_in_front_dist + Vector3(0, max_jump_height, 0)
	jump_detector.exclude_parent = true
	body.add_child(jump_detector)
	
	# Line of sight
	los_raycast = RayCast3D.new()
	los_raycast.enabled = true
	los_raycast.collision_mask = 3 # 1 and 2 bits
	los_raycast.exclude_parent = true
	los_raycast.hit_from_inside = true  # ai sometimes shoves faces into things
	los_raycast.position = Vector3(0, 0, -check_in_front_dist) # set behind a bit so ai doesn't shove eyes through walls
	body.add_child(los_raycast)
	
	exclude = [body.get_rid()]
	for child in body.get_children():
		if child is SoftBody3D:
			exclude.append(child.get_physics_rid())
			
	if space_state == null:
		space_state = body.get_world_3d().direct_space_state

func set_spawn_position(pos: Vector3) -> void:
	spawn_position = pos
	_generate_new_wander_target()

## Check if can see player
func can_see_player(
	ai_body: Node3D, 
	player: Node3D, 
	) -> bool:
	# soft body colliders aren't parented correctly for some reason
	if first_run:
		for child in player.get_children():
			if child is SoftBody3D:
				exclude.append(child.get_physics_rid())
		first_run = false
		
	if not player:
		print("no player to detect")
		return false
	
	if player.has_method("get") and player.get("can_be_seen") != null:
		if not player.can_be_seen:
			return false
	
	var to_player = player.global_position - los_raycast.global_position
	var distance = to_player.length()
	var to_player_dir = to_player.normalized()
	
	if distance > detection_range:
		return false
	
	# Horizontal FOV
	var forward = ai_body.global_transform.basis.z.normalized()
	var to_player_flat = Vector3(to_player.x, 0, to_player.z).normalized()
	var forward_flat = Vector3(forward.x, 0, forward.z).normalized()
	var horiz_angle = rad_to_deg(forward_flat.angle_to(to_player_flat))
	
	if horiz_angle > horiz_degree_view / 2.0:
		return false
	
	# Vertical FOV
	if distance > 0.01:
		var vert_angle = rad_to_deg(asin(to_player.y / distance))
		if abs(vert_angle) > vert_degree_view / 2.0:
			return false
	
	# Line of sight
	if los_raycast:
		los_raycast.target_position = to_player
		var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(los_raycast.global_position, los_raycast.global_position+los_raycast.target_position)
		query.exclude = exclude
		query.collide_with_areas = false
		query.collide_with_bodies = true
		query.hit_from_inside = true
		query.hit_back_faces = true
		los_raycast.force_raycast_update()
				
		var hit1: Dictionary = space_state.intersect_ray(query)
		if hit1.is_empty():
			return false
		else:
			var hit = hit1["collider"]
			if player.is_ancestor_of(hit) or hit == player:
				return true
			else:
				return false				
	return true

func ai_think(delta: float, ai_body: CharacterBody3D, player: Node3D) -> Array:
	# Update timers
	attack_timer -= delta
	
	# Handle bounce state
	if current_state == AIState.BOUNCING:
		bounce_timer -= delta
		if bounce_timer <= 0:
			current_state = previous_state
		else:
			# Just move in bounce direction
			debug_move_dir = bounce_direction
			debug_look_dir = bounce_direction
			bounce_direction = _check_for_obstacles(ai_body, player, bounce_direction)
			return [bounce_direction, bounce_direction]
	
	var move_dir := Vector3.ZERO
	var look_dir := Vector3.ZERO

	# Early out if player doesn't exist
	if not player:
		if current_state != AIState.WANDER:
			current_state = AIState.WANDER
		move_dir = get_wander_direction(ai_body.global_position, delta)
		move_dir = _check_for_obstacles(ai_body, player, move_dir)
		debug_move_dir = move_dir
		debug_look_dir = move_dir
		return [move_dir, move_dir]

	# Core visibility + distance checks
	var can_see = can_see_player(ai_body, player)
	var distance = ai_body.global_position.distance_to(player.global_position)

	if can_see:
		player_last_seen_at = player.global_position
	
	look_dir = player_last_seen_at - ai_body.global_position 

	# State machine transitions
	match current_state:
		AIState.ATTACK:
			if not can_see or distance > attack_range + 0.8:
				current_state = AIState.CHASE

		AIState.CHASE:				
			if can_see and distance <= attack_range:
				current_state = AIState.ATTACK
			if not can_see and (ai_body.global_position-player_last_seen_at).length()<1.0 and (player_last_seen_at - player.global_position).length()>2.0:
				current_state = AIState.WANDER

		AIState.WANDER:
			if can_see:
				current_state = AIState.CHASE

	# Execute behavior for current state
	match current_state:
		AIState.WANDER:
			move_dir = get_wander_direction(ai_body.global_position, delta)
			move_dir = _check_for_obstacles(ai_body, player, move_dir)
			if move_dir.length() > 0.01:
				look_dir = move_dir

		AIState.CHASE:
			move_dir = get_chase_direction(ai_body.global_position, player_last_seen_at)
			move_dir = _check_for_obstacles(ai_body, player, move_dir)
				
		AIState.ATTACK:
			if player:
				look_dir = (player.global_position - ai_body.global_position).normalized()
				look_dir = look_dir.normalized()
				if attack_timer <= 0:
					ai_body.attack(look_dir)
					attack_timer = attack_cooldown
			move_dir = Vector3.ZERO

	debug_move_dir = move_dir
	debug_look_dir = look_dir
	return [move_dir, look_dir]

## Get wander direction
func get_wander_direction(ai_pos: Vector3, delta: float) -> Vector3:
	wander_timer -= delta
	
	if wander_timer <= 0.0 or ai_pos.distance_to(wander_target) < 1.0:
		_generate_new_wander_target()
	
	var to_target = wander_target - ai_pos
	var to_spawn = spawn_position - ai_pos
	
	var spawn_distance = to_spawn.length()
	var pull_factor = minf(spawn_distance / wander_radius, 1.0) * return_pull_strength
	
	var combined = to_target.normalized() + to_spawn.normalized() * pull_factor
	return Vector3(combined.x, 0, combined.z).normalized()

## Get chase direction
func get_chase_direction(ai_pos: Vector3, player_pos: Vector3) -> Vector3:
	var to_player = player_pos - ai_pos
	return Vector3(to_player.x, 0, to_player.z).normalized()

func register_attack() -> void:
	attack_timer = attack_cooldown

func special_ray_check(ray, player, hit_from_inside=false, check_for_player=false, avoid_player=true):
	if ray:
		var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(ray.global_position, ray.global_position+ray.target_position)
		query.exclude = exclude
		query.collide_with_areas = false
		query.collide_with_bodies = true
		query.hit_from_inside = hit_from_inside
		query.hit_back_faces = true
				
		var hit1: Dictionary = space_state.intersect_ray(query)
		if hit1.is_empty():
			return false
		else:
			var hit = hit1["collider"]
			if player.is_ancestor_of(hit) or hit == player:
				return check_for_player
			else:
				return avoid_player

func _check_for_obstacles(
	ai_body: CharacterBody3D,
	player: Node3D, 
	intended_dir: Vector3
	) -> Vector3:

	if intended_dir.length_squared() < 0.01:
		return Vector3.ZERO
	
	# Point detectors in intended direction
	jump_detector.position = intended_dir*check_in_front_dist + Vector3(0, max_jump_height, 0)
	jump_detector.target_position = Vector3(0, -max_jump_height, 0) + Vector3(0, 0.1, 0)

	cliff_detector.position = intended_dir*check_in_front_dist + Vector3(0, 0.1, 0)
	cliff_detector.target_position = Vector3(0, -1, 0) * max_safe_drop
	
	wall_detector.position = Vector3(0, 0, 0) # a bit behind us in case we're phasing into the wall
	wall_detector.target_position = intended_dir*check_in_front_dist
	
	cliff_detector.force_raycast_update()
	jump_detector.force_raycast_update()
	wall_detector.force_raycast_update()

	var can_jump_over = jump_detector.is_colliding()
	var has_cliff = not cliff_detector.is_colliding()
	var has_wall = special_ray_check(wall_detector, player) and not can_jump_over

	# If we can jump over obstacle, do it
	if can_jump_over:
		ai_body.jump()
		return intended_dir

	# If path is clear, go ahead
	if not has_cliff and not has_wall:
		return intended_dir

	# Hit obstacle - get normal and bounce
	var bounce_normal = Vector3.ZERO
	
	if has_wall:
		# Get wall normal directly from collision
		bounce_normal = wall_detector.get_collision_normal()
		bounce_normal.y = 0  # Keep it horizontal
		bounce_normal = bounce_normal.normalized()
		# Store for debug visualization
		debug_bounce_origin = wall_detector.get_collision_point()
		debug_bounce_normal = bounce_normal
	elif has_cliff:
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
	
	_start_bounce_back(ai_body, bounce_normal)
	return bounce_direction

# Ledge-grabber style cliff detection
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
	
	var hit1: Dictionary = space_state.intersect_ray(query)
	if hit1.is_empty():
		# No wall found, just reverse
		return -forward_dir
	
	var wall_norm: Vector3 = hit1.normal
	var enter_pos: Vector3 = hit1.position
	
	# Second ray: from wall hit, look for ledge/floor
	#var from2: Vector3 = hit1.position + dir.normalized() * epsilon
	#query.from = from2 + dir - (hit1.position - origin)
	#query.to = from2
	
	#var hit2: Dictionary = space_state.intersect_ray(query)
	#if hit2.is_empty():
		# No floor found, use wall normal
	#	var result = wall_norm
	#	result.y = 0
	#	return result.normalized()
	
	#var exit_pos: Vector3 = hit2.position
	
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

func _start_bounce_back(ai_body: CharacterBody3D, collision_normal: Vector3) -> void:
	# Store current state
	if current_state != AIState.BOUNCING:
		previous_state = current_state
		current_state = AIState.BOUNCING
		bounce_timer = bounce_back_time
	
	# Bounce away using the collision normal
	bounce_direction = collision_normal
	bounce_direction.y = 0
	bounce_direction = bounce_direction.normalized()

func _generate_new_wander_target() -> void:
	var random_offset = Vector3(
		randf_range(-wander_radius, wander_radius),
		0,
		randf_range(-wander_radius, wander_radius)
	)
	wander_target = spawn_position + random_offset
	wander_timer = wander_wait_time

func debug_visualize(ai_body: CharacterBody3D, player: Node3D = null) -> void:
	# State label floating above head
	var state_name = AIState.keys()[current_state]
	DebugDraw3D.draw_text(ai_body.global_position + Vector3(0, 3.0, 0), state_name, 32, Color.WHITE)

	# Move direction: blue arrow from feet
	if debug_move_dir.length() > 0.01:
		DebugDraw3D.draw_arrow(
			ai_body.global_position,
			ai_body.global_position + debug_move_dir.normalized() * 3.0,
			Color.BLUE,
			0.0
		)

	# Look direction: cyan arrow slightly higher
	if debug_look_dir.length() > 0.01:
		DebugDraw3D.draw_arrow(
			ai_body.global_position + Vector3(0, 0.5, 0),
			ai_body.global_position + Vector3(0, 0.5, 0) + debug_look_dir.normalized() * 3.0,
			Color.CYAN,
			0.0
		)

	# Bounce normal: magenta arrow from collision point
	if debug_bounce_normal.length() > 0.01:
		DebugDraw3D.draw_arrow(
			debug_bounce_origin,
			debug_bounce_origin + debug_bounce_normal.normalized() * 2.0,
			Color.MAGENTA,
			0.0
		)

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
	
	# LOS raycast
	if player:
		var start = ai_body.to_global(los_raycast.position)
		var end = start + los_raycast.target_position
		var los_color = Color.GREEN if can_see_player(ai_body, player) else Color.RED
		DebugDraw3D.draw_line(start, end, los_color, 0.0)

		# Sphere at last seen
		DebugDraw3D.draw_sphere(player_last_seen_at, 0.5, Color.PURPLE, 0.0)

func reset() -> void:
	wander_timer = 0.0
	attack_timer = 0.0
	bounce_timer = 0.0

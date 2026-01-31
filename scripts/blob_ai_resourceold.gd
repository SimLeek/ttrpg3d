extends Resource
class_name BlobAIResourceOld

## AI behavior - stats and control logic together

@export_group("Detection")
@export var horiz_degree_view: float = 180.0
@export var vert_degree_view: float = 120.0
@export var detection_range: float = 60.0

@export_group("Wandering")
@export var wander_radius: float = 10.0
@export var wander_wait_time: float = 3.0
@export var return_pull_strength: float = 0.5

#@export_group("Personal Space")
#@export var max_personal_space_radius: float = 2.0
#@export var min_personal_space_radius: float = 0.5

@export_group("Terrain Detection")
@export var check_in_front_dist: float = 0.75
@export var max_safe_drop: float = 2.4
@export var max_jump_height: float = 2.4
@export var min_obstacle_height_needed_to_jump_over: float = 0.3

@export_group("Combat")
@export var attack_range: float = 1.5
@export var attack_cooldown: float = 1.0

@export_group("Cliff Following")
@export var wall_follow_turn_speed : float = 180.0    # deg/s
@export var wall_follow_max_time   : float = 30.0     # how long to follow before giving up
@export var chase_cooldown_time    : float = 15.0      # how long to ignore player after timeout

const epsilon = 0.01

enum AIState { WANDER, CHASE, ATTACK, WANDER_WALL_FOLLOW, CHASE_WALL_FOLLOW, CHASE_COOLDOWN }

# State
var current_state : AIState = AIState.WANDER
var player_last_seen_at: Vector3

var spawn_position: Vector3
var wander_target: Vector3
var wander_timer: float = 0.0
var attack_timer: float = 0.0

var wall_follow_timer : float = 0.0
var wall_follow_cooldown : float = 0.0
var wall_follow_side : int = 0          # 1 = right-hand rule, -1 = left-hand rule
var last_valid_direction : Vector3 = Vector3.FORWARD

# detectors
#var personal_space_cast: ShapeCast3D
var cliff_detector: RayCast3D
var wall_detector: RayCast3D
var jump_detector: RayCast3D
var los_raycast: RayCast3D
var side_cliff_detector: RayCast3D
var side_cliff_detector_front: RayCast3D
var side_cliff_detector_back: RayCast3D
var side_wall_detector: RayCast3D
var side_wall_detector_2: RayCast3D
var side_jump_detector: RayCast3D
var exclude: Array[RID]
var space_state: PhysicsDirectSpaceState3D
var first_run:bool = false
# These track exactly how far out the cliff edge is right now
var _cliff_trace_dist_front: float = 1.0
var _cliff_trace_dist_back: float = 1.0
# How fast the rays move in/out to find the edge (meters per second)
var _cliff_trace_speed: float = 5.0

# Debug viz only
var debug_move_dir: Vector3 = Vector3.ZERO
var debug_look_dir: Vector3 = Vector3.ZERO

func setup_detection_systems(body:CharacterBody3D) -> void:
	var forward_direction: Vector3 = body.global_transform.basis.z.normalized()
	
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
	
	side_wall_detector_2 = RayCast3D.new()
	side_wall_detector_2.enabled = true
	side_wall_detector_2.collision_mask = 3
	side_wall_detector_2.exclude_parent = true
	body.add_child(side_wall_detector_2)
	
	# Jump detector
	jump_detector = RayCast3D.new()
	jump_detector.target_position = forward_direction*check_in_front_dist + Vector3(0, -1, 0) * 0.1
	jump_detector.enabled = true
	jump_detector.collision_mask = 3
	jump_detector.position = forward_direction*check_in_front_dist + Vector3(0, max_jump_height, 0)
	jump_detector.exclude_parent = true
	body.add_child(jump_detector)
	
	# detects if there's a wall blocking the AI from moving
	# like jump detector, takes precedence over cliff detector
	side_wall_detector = RayCast3D.new()
	side_wall_detector.enabled = true
	side_wall_detector.collision_mask = 3
	side_wall_detector.exclude_parent = true
	body.add_child(side_wall_detector)
	
	# detects if ground does not exist when it should
	side_cliff_detector = RayCast3D.new()
	side_cliff_detector.enabled = true
	side_cliff_detector.collision_mask = 3
	side_cliff_detector.exclude_parent = true
	body.add_child(side_cliff_detector)
	
	# [NEW] Front inner cliff detector (pulled in closer to body, ahead)
	side_cliff_detector_front = RayCast3D.new()
	side_cliff_detector_front.enabled = true
	side_cliff_detector_front.collision_mask = 3
	side_cliff_detector_front.exclude_parent = true
	body.add_child(side_cliff_detector_front)

	# [NEW] Back inner cliff detector (pulled in closer to body, behind)
	side_cliff_detector_back = RayCast3D.new()
	side_cliff_detector_back.enabled = true
	side_cliff_detector_back.collision_mask = 3
	side_cliff_detector_back.exclude_parent = true
	body.add_child(side_cliff_detector_back)
	
	side_jump_detector = RayCast3D.new()
	side_jump_detector.enabled = true
	side_jump_detector.collision_mask = 3
	side_jump_detector.exclude_parent = true
	body.add_child(side_jump_detector)
	
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
		
	#smooth_look_dir = body.global_transform.basis.z.normalized()

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
			#print("player is hiding in shadows")
			return false
	
	var to_player = player.global_position - los_raycast.global_position
	var distance = to_player.length()
	var to_player_dir = to_player.normalized()
	
	if distance > detection_range:
		#print("player is out of detection range")
		return false
	
	# Horizontal FOV
	var forward = -ai_body.transform.basis.z
	var to_player_flat = Vector3(to_player.x, 0, to_player.z).normalized()
	var forward_flat = Vector3(forward.x, 0, forward.z).normalized()
	var horiz_angle = rad_to_deg(forward_flat.angle_to(to_player_flat))
	
	if horiz_angle > horiz_degree_view / 2.0:
		#print("player is out of horizontal angle")
		#print(horiz_angle)
		return false
	
	# Vertical FOV
	if distance > 0.01:
		var vert_angle = rad_to_deg(asin(to_player.y / distance))
		if abs(vert_angle) > vert_degree_view / 2.0:
			#print("player is out of vertical angle")
			return false
	
	# Line of sight
	if los_raycast:
		print("player might be in sight")
		los_raycast.target_position = to_player #+ to_player_dir*.1 # a bit thru player
		var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(los_raycast.global_position, los_raycast.global_position+los_raycast.target_position)
		query.exclude = exclude
		query.collide_with_areas = false
		query.collide_with_bodies = true
		query.hit_from_inside = true
		query.hit_back_faces = true
		los_raycast.force_raycast_update()
				
		var hit1: Dictionary = space_state.intersect_ray(query)
		if hit1.is_empty():
			print("raycast hit nothing")
			return false
		else:
		#if los_raycast.is_colliding():
			var hit = hit1["collider"]
			#var hit = los_raycast.get_collider()
			if player.is_ancestor_of(hit) or hit == player:
				#print("player is seen!")
				return true
			else:
				#print("player is blocked by line of sight")
				return false				
		#else:
		#	print("raycast hit nothing")
		#	return false
	print("raycast doesn't exist")
	return true

func ai_think(delta: float, ai_body: CharacterBody3D, player: Node3D) -> Array:
	# ── 1. Update timers that can cause state changes ────────────────────────
	if wall_follow_cooldown > 0:
		wall_follow_cooldown -= delta
	if wall_follow_cooldown <= 0 and current_state == AIState.CHASE_COOLDOWN:
		current_state = AIState.WANDER

	if wall_follow_timer > 0:
		wall_follow_timer -= delta
	if wall_follow_timer <= 0 and current_state == AIState.CHASE_WALL_FOLLOW:
		current_state = AIState.WANDER_WALL_FOLLOW
		wall_follow_cooldown = chase_cooldown_time

	attack_timer -= delta
	
	var move_dir := Vector3.ZERO
	var look_dir := Vector3.ZERO   # default: don't force look

	# ── 2. Early out if player doesn't exist ────────────────────────────────
	if not player:
		if current_state != AIState.WANDER:
			current_state = AIState.WANDER
		move_dir = get_wander_direction(ai_body.global_position, delta)
		debug_move_dir = move_dir
		debug_look_dir = look_dir
		return [move_dir, move_dir]

	# ── 3. Core visibility + distance checks ────────────────────────────────
	var can_see = can_see_player(ai_body, player)
	var distance = ai_body.global_position.distance_to(player.global_position)

	if can_see:
		#print("ai can see u")
		player_last_seen_at = player.global_position

	# ── 4. State machine transitions ────────────────────────────────────────
	match current_state:
		AIState.ATTACK:
			print("attack state")
			if not can_see or distance > attack_range + 0.8:
				current_state = AIState.CHASE

		AIState.CHASE, AIState.CHASE_WALL_FOLLOW:
			if can_see and distance <= attack_range:
				current_state = AIState.ATTACK

		AIState.WANDER:
			if can_see:
				current_state = AIState.CHASE
		
		AIState.WANDER_WALL_FOLLOW:
			if can_see:
				current_state = AIState.CHASE_WALL_FOLLOW

	# ── 5. Execute behavior for current state & return direction ─────────────
	var wish_dir
	match current_state:
		AIState.WANDER:
			move_dir = get_wander_direction(ai_body.global_position, delta)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, player, move_dir, delta)
			if move_dir.length() > 0.01:
				look_dir = move_dir

		AIState.CHASE:
			var raw_chase = get_chase_direction(ai_body.global_position, player_last_seen_at)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, player,raw_chase, delta)
			if move_dir.length() > 0.01:
				look_dir = move_dir
			elif current_state == AIState.CHASE_WALL_FOLLOW:
				# we instant state changed, so change behavior
				look_dir = _estimate_next_wall_follow_look(ai_body)
				
		AIState.CHASE_WALL_FOLLOW:
			wish_dir = get_wall_follow_direction(ai_body, player, delta)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, player,wish_dir, delta)
			if wish_dir.length() > 0.01:
				look_dir = wish_dir
			else:
				# wall following robot look dir code
				look_dir = _get_best_look_when_stuck(ai_body, player)
		AIState.WANDER_WALL_FOLLOW:
			wish_dir = get_wander_direction(ai_body.global_position, delta)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, player,wish_dir, delta)
			if wish_dir.length() > 0.01:
				look_dir = wish_dir
			else:
				# wall following robot look dir code
				look_dir = (move_dir - ai_body.global_position).normalized()
		AIState.ATTACK:
			if player:
				print("ai should attack")
				look_dir = (player.global_position - ai_body.global_position).normalized()
				#look_dir.y = 0
				look_dir = look_dir.normalized()
				if attack_timer <= 0:
					print("ai attack")
					ai_body.attack(look_dir)
					attack_timer = attack_cooldown
			move_dir = Vector3.ZERO   # or face player only

		AIState.CHASE_COOLDOWN:
			move_dir = get_wander_direction(ai_body.global_position, delta)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, player,move_dir, delta)
			if move_dir.length() > 0.01:
				look_dir = move_dir

	if look_dir.length_squared() < 0.001 and last_valid_direction.length() > 0.01:
		look_dir = last_valid_direction

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
	#if not player:
#		return Vector3.ZERO
	
	var to_player = player_pos - ai_pos
	return Vector3(to_player.x, 0, to_player.z).normalized()

## Check if can attack
#func can_attack(
#	ai_body: Node3D, #
#	player: Node3D, 
#	delta: float
#	) -> bool:
#	attack_timer -= delta
#
#		return false
#	
#	if not can_see_player(ai_body, player):
#		return false
#	
#	var distance = ai_body.global_position.distance_to(player.global_position)
#	return distance <= attack_range

func register_attack() -> void:
	attack_timer = attack_cooldown

func _estimate_next_wall_follow_look(ai_body: CharacterBody3D) -> Vector3:
	# Predict where wall-follow wants to go next frame
	var forward = ai_body.global_transform.basis.z
	var right = ai_body.global_transform.basis.x
	return (forward + right * wall_follow_side * 0.7).normalized()

func _get_best_look_when_stuck(ai_body: Node3D, player: Node3D) -> Vector3:
	if player and can_see_player(ai_body, player):
		var to_p = player.global_position - ai_body.global_position
		to_p.y = 0
		return to_p.normalized()
	return (player_last_seen_at - ai_body.global_position).normalized()

func _decide_wall_follow_side(ai_body: Node3D) -> void:
	var to_last_seen = (player_last_seen_at - ai_body.global_position).normalized()
	to_last_seen.y = 0

	var right = ai_body.global_transform.basis.x
	var dot = right.dot(to_last_seen)

	if abs(dot) < 0.01:
		# almost straight ahead → randomize
		wall_follow_side = 1 if randf() < 0.5 else -1
	else:
		# prefer the side that turns us toward player faster
		wall_follow_side = sign(dot)
	if wall_follow_side == 0:
		wall_follow_side = 1

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
			#print("raycast hit nothing")
			return false
		else:
		#if los_raycast.is_colliding():
			var hit = hit1["collider"]
			#var hit = los_raycast.get_collider()
			if player.is_ancestor_of(hit) or hit == player:
				#print("player is seen!")
				return check_for_player
			else:
				return avoid_player

# [CHANGED] Completely rewrote to isolate logic and use the new multi-ray setup
func get_wall_follow_direction(
	ai_body: CharacterBody3D,
	player: Node3D,
	delta: float
	) -> Vector3:

	if wall_follow_timer <= 0:
		wall_follow_cooldown = chase_cooldown_time
		current_state = AIState.WANDER_WALL_FOLLOW
		return Vector3.ZERO

	if current_state == AIState.CHASE_WALL_FOLLOW:
		wall_follow_timer -= delta

	# 1. Update all ray positions based on the current side (Left/Right)
	_update_wall_follow_sensors(ai_body, delta)

	# 2. Check for jump/forward blocks (Standard checks)
	
	cliff_detector.force_raycast_update()
	side_cliff_detector.force_raycast_update()
	wall_detector.force_raycast_update()
	side_jump_detector.force_raycast_update()

	# If forward path is clear (ground exists, no wall), break out of wall follow
	if cliff_detector.is_colliding() and not special_ray_check(wall_detector, player) and side_cliff_detector.is_colliding() and not special_ray_check(side_wall_detector, player) and not special_ray_check(side_wall_detector_2, player):
		print("wall path clear")
		last_valid_direction = Vector3.FORWARD
		_exit_wall_follow_state()
		return Vector3.FORWARD

	# If there is a low obstacle on the side, jump
	if side_jump_detector.is_colliding():
		print("wall path can jump")
		ai_body.jump()
		# Slight turn inward while jumping
		return (Vector3.FORWARD + (Vector3.RIGHT * wall_follow_side * 0.5)).normalized()

	# 3. Calculate steering based on the 5 side sensors (2 Wall, 3 Cliff)
	print("wall path blocked")
	var steering = _calculate_wall_steering(ai_body, player)
	
	return steering

func _exit_wall_follow_state():
	if current_state == AIState.WANDER_WALL_FOLLOW:
		current_state = AIState.WANDER
	elif current_state == AIState.CHASE_WALL_FOLLOW:
		current_state = AIState.CHASE

func _update_wall_follow_sensors(ai_body: Node3D, delta: float) -> void:
	var forward = Vector3.FORWARD
	var right = Vector3.RIGHT
	var side_dir = right * wall_follow_side
	
	var side_check_dist = check_in_front_dist * 1.4
	
	# -- WALL SENSORS --
	# Ray 1: Forward-ish side (The original)
	var wall_ray_dir_1 = (forward + side_dir * 0.9).normalized()
	side_wall_detector.position = wall_ray_dir_1 * (check_in_front_dist * 0.5) + Vector3(0, 0.2, 0)
	side_wall_detector.target_position = wall_ray_dir_1 * side_check_dist
	
	# Ray 2: Backward-ish side (NEW - prevents pivoting into wall)
	var wall_ray_dir_2 = (side_dir * 0.8 - forward * 0.2).normalized()
	side_wall_detector_2.position = wall_ray_dir_2 * (check_in_front_dist * 0.5) + Vector3(0, 0.2, 0)
	side_wall_detector_2.target_position = wall_ray_dir_2 * side_check_dist

	# -- CLIFF SEEKING LOGIC -- 
	# We continually push these out if hitting ground, and pull in if hitting void.
	# This keeps them hovering exactly on the cliff edge.
	
	var max_reach = check_in_front_dist * 2.0
	var min_reach = 0.2 # Don't pull inside the robot
	
	# 1. Update Positions based on LAST frame's distance
	var front_offset = forward * 0.5
	side_cliff_detector_front.position = (side_dir * _cliff_trace_dist_front) + front_offset + Vector3(0, 0.2, 0)
	side_cliff_detector_front.target_position = Vector3(0, -max_safe_drop, 0)
	
	var back_offset = -forward * 0.5
	side_cliff_detector_back.position = (side_dir * _cliff_trace_dist_back) + back_offset + Vector3(0, 0.2, 0)
	side_cliff_detector_back.target_position = Vector3(0, -max_safe_drop, 0)
	
	# 2. Check collisions
	side_cliff_detector_front.force_raycast_update()
	side_cliff_detector_back.force_raycast_update()
	
	# 3. Adjust distances for NEXT frame (The "Seeking" Logic)
	if side_cliff_detector_front.is_colliding():
		# Hitting ground -> Push out to find the edge
		_cliff_trace_dist_front += _cliff_trace_speed * delta
	else:
		# Hitting void -> Pull in to find the ground
		_cliff_trace_dist_front -= _cliff_trace_speed * delta
		
	if side_cliff_detector_back.is_colliding():
		_cliff_trace_dist_back += _cliff_trace_speed * delta
	else:
		_cliff_trace_dist_back -= _cliff_trace_speed * delta

	# Clamp to prevent runaway values
	_cliff_trace_dist_front = clampf(_cliff_trace_dist_front, min_reach, max_reach)
	_cliff_trace_dist_back = clampf(_cliff_trace_dist_back, min_reach, max_reach)
	
	# Also update the outer "feeler" (static check for wide turns)
	side_cliff_detector.position = (side_dir * side_check_dist) + Vector3(0, 0.2, 0)
	side_cliff_detector.target_position = Vector3(0, -max_safe_drop, 0)
	side_cliff_detector.force_raycast_update()
	
	# Jump detector
	var side_ray_dir = (forward + side_dir * 0.9).normalized()
	side_jump_detector.position = side_ray_dir * check_in_front_dist + Vector3(0, max_jump_height, 0)
	side_jump_detector.target_position = Vector3(0, -max_jump_height, 0) + Vector3(0, 0.1, 0)
	

func _calculate_wall_steering(ai_node:Node3D, player: Node3D) -> Vector3:
	var steer_accum = Vector3.ZERO
	var side_vec = Vector3.RIGHT * wall_follow_side
	var new_forward = Vector3.FORWARD
	# 1. Wall Avoidance (Push AWAY if hitting wall)
	#var wall_1_hit = special_ray_check(side_wall_detector, player)
	#var wall_2_hit = special_ray_check(side_wall_detector_2, player)	
	var wall_1_hit = side_wall_detector.is_colliding()
	var wall_2_hit = side_wall_detector_2.is_colliding()
	
	#if wall_1_hit and not wall_2_hit:
		# Front sensor hit: Hard turn away
	#	steer_accum -= side_vec * 0.2
	#if wall_2_hit and not wall_1_hit:
		# Back sensor hit: Moderate push away (prevents rear clipping)
	#	steer_accum -= side_vec * 0.1
	
	if wall_1_hit and wall_2_hit:
		new_forward = ai_node.to_local(side_wall_detector.get_collision_point() - side_wall_detector_2.get_collision_point()) # default to trace wall
	
	# 2. Cliff Steering using Seeking Rays
	# Since the rays are now "hunting" the edge, the variables _cliff_trace_dist_front/back
	# represent the ACTUAL distance to the cliff edge at the front and back of the robot.
	
	# A. Angle Correction (Parallelism)
	# If front is closer to body than back, we are angling INTO the cliff -> Steer Away
	# If front is further than back, we are angling AWAY -> Steer In
	if side_cliff_detector_front.is_colliding() and side_cliff_detector_back.is_colliding() and _cliff_trace_dist_front!=_cliff_trace_dist_back: 
		new_forward = ai_node.to_local(side_cliff_detector_front.get_collision_point() - side_cliff_detector_back.get_collision_point())
	
	# If angle_diff is NEGATIVE, front is closer (Danger). Steer AWAY (-side_vec)
	# If angle_diff is POSITIVE, front is farther (Safe). Steer TOWARD (+side_vec)
	# We multiply by a gain factor (e.g., 2.0)
	
	# B. Distance Maintenance (optional but good)
	# Keep a preferred distance from the edge (e.g. 0.8 units)
	var avg_dist = (_cliff_trace_dist_front + _cliff_trace_dist_back) / 2.0
	var target_dist = 0.8
	var dist_error = target_dist - avg_dist # If positive, we are too close.
	
	# If too close (dist_error > 0), steer away (-side_vec)
	#steer_accum -= side_vec * dist_error
	
	# 3. Outer Feeler Panic (Backup safety)
	# If the outer static feeler hits ground, we are WAY too safe/far from edge.
	#if side_cliff_detector.is_colliding():
	#	steer_accum += side_vec * 0.4

	return (new_forward).normalized()

func _apply_cliff_check_and_wall_transition_if_needed(
	ai_body: CharacterBody3D,
	player:Node3D, 
	intended_dir: Vector3,
	delta: float
	) -> Vector3:

	if intended_dir.length_squared() < 0.01:
		return Vector3.ZERO
	
	jump_detector.position = -intended_dir*check_in_front_dist + Vector3(0, max_jump_height, 0)
	jump_detector.target_position = Vector3(0, -max_jump_height, 0) +Vector3(0, 0.1, 0)

	cliff_detector.position = -intended_dir*check_in_front_dist + Vector3(0, 0.1, 0)
	cliff_detector.target_position = Vector3(0, -1, 0) * max_safe_drop
	
	wall_detector.position = -intended_dir*check_in_front_dist
	wall_detector.target_position = -intended_dir*check_in_front_dist
	
	var forward = ai_body.global_transform.basis.z
	var right   = ai_body.global_transform.basis.x   # already right vector

	# Side ray – checks if wall/cliff is still on our "hand" side	
	#var side_check_dist = check_in_front_dist * 1.4
	#var side_ray_dir = (forward + right * wall_follow_side * 0.9).normalized()
	
	#side_cliff_detector.position = side_ray_dir * side_check_dist + Vector3(0, 0.2, 0) #important that the ray is pointing directly down
	#side_cliff_detector.target_position = Vector3(0,-max_safe_drop,0)  # relative to local
	#side_cliff_detector.force_raycast_update()
	
	#side_wall_detector.position = Vector3(0, 0.2, 0) #important that the ray is pointing directly down
	#side_wall_detector.target_position = side_ray_dir * side_check_dist  # relative to local
	#side_wall_detector.force_raycast_update()
	
	#side_jump_detector.position = side_ray_dir*check_in_front_dist + Vector3(0, max_jump_height, 0)
	#side_jump_detector.target_position = Vector3(0, -max_jump_height, 0) +Vector3(0, 0.1, 0)
	#side_jump_detector.force_raycast_update()
	
	cliff_detector.force_raycast_update()
	jump_detector.force_raycast_update()
	wall_detector.force_raycast_update()

	#var has_cliff_on_side = (not side_cliff_detector.is_colliding())
	#var has_wall_on_side = side_cliff_detector.is_colliding() and not side_jump_detector.is_colliding()
	
	# these aren't actually in front, but in desired movement locations
	
	var can_jump_over = jump_detector.is_colliding()
	var has_cliff_in_front = (not cliff_detector.is_colliding())
	var has_wall_in_front = special_ray_check(wall_detector, player) and not can_jump_over
	
	var side_can_jump_over = side_jump_detector.is_colliding()
	var side_wall_collision = special_ray_check(side_wall_detector, player)
	var has_cliff_on_side = (not side_cliff_detector.is_colliding())
	var has_wall_on_side = side_wall_collision and not side_can_jump_over

	if can_jump_over:  # needs to be checked first so we jump
		if current_state == AIState.WANDER_WALL_FOLLOW:
			current_state = AIState.WANDER
		elif current_state == AIState.CHASE_WALL_FOLLOW:
			current_state = AIState.CHASE
		ai_body.jump()
		return intended_dir  # also safe
	elif not has_cliff_in_front and not has_wall_in_front:
		#if current_state == AIState.WANDER_WALL_FOLLOW:
		#	current_state = AIState.WANDER
		#elif current_state == AIState.CHASE_WALL_FOLLOW:
		#	current_state = AIState.CHASE
		#var drop = ai_body.global_position.y - cliff_detector.get_collision_point().y
		#if drop <= max_safe_drop:
		return intended_dir  # safe
	#if has_cliff_in_front:
	#	print("has cliff in front")
	#if has_wall_in_front:
	#	print("has wall in front")

	# cliff or unsafe drop → switch or stay in wall follow
	if current_state == AIState.WANDER_WALL_FOLLOW or current_state == AIState.CHASE_WALL_FOLLOW:
		# already wall following → let wall follow code handle it
		return get_wall_follow_direction(ai_body, player, delta)
	# switch to wall following no matter what
	if current_state == AIState.WANDER:
		current_state = AIState.WANDER_WALL_FOLLOW
	elif current_state == AIState.CHASE:
		current_state = AIState.CHASE_WALL_FOLLOW
	elif current_state == AIState.ATTACK:
		current_state = AIState.CHASE_WALL_FOLLOW
	elif current_state == AIState.CHASE_COOLDOWN:
		current_state = AIState.WANDER_WALL_FOLLOW
	
	wall_follow_timer = wall_follow_max_time
	_decide_wall_follow_side(ai_body)
	return Vector3.ZERO  # give one frame to turn

func _generate_new_wander_target() -> void:
	# this is a square but screw it
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

	# Cliff detector ray (angled down-forward)
	if cliff_detector:
		var start = ai_body.to_global(cliff_detector.position)
		var end = start + cliff_detector.target_position
		var color = Color.GREEN

		cliff_detector.force_raycast_update()  # ensure fresh
		if not cliff_detector.is_colliding():
			color = Color.RED  # no hit = cliff/void
		else:
			var drop = ai_body.global_position.y - cliff_detector.get_collision_point().y
			if drop > max_safe_drop:
				color = Color.RED  # too far drop = unsafe
		# else green = safe floor

		DebugDraw3D.draw_line(start, end, color, 0.0)
		if cliff_detector.is_colliding():
			DebugDraw3D.draw_sphere(cliff_detector.get_collision_point(), 0.15, Color.GREEN_YELLOW, 0.0)

	if wall_detector:
		var start = ai_body.to_global(wall_detector.position)
		var end = start + wall_detector.target_position
		var color = Color.GREEN

		wall_detector.force_raycast_update()  # ensure fresh
		if wall_detector.is_colliding():
			color = Color.RED  # no hit = cliff/void
		# else green = safe floor

		DebugDraw3D.draw_line(start, end, color, 0.0)
		if cliff_detector.is_colliding():
			DebugDraw3D.draw_sphere(wall_detector.get_collision_point(), 0.15, Color.INDIAN_RED, 0.0)

	# Jump detector ray (forward at head height, down a bit)
	if jump_detector:
		var start = ai_body.to_global(jump_detector.position)
		var end = start + jump_detector.target_position
		var color = Color.ORANGE if not jump_detector.is_colliding() else Color.GREEN  # green clear, orange obstacle

		jump_detector.force_raycast_update()
		DebugDraw3D.draw_line(start, end, color, 0.0)
		if jump_detector.is_colliding():
			DebugDraw3D.draw_sphere(jump_detector.get_collision_point(), 0.15, Color.GREEN_YELLOW, 0.0)
			
	if side_cliff_detector:
		var start = ai_body.to_global(side_cliff_detector.position)
		var end = start + side_cliff_detector.target_position
		var color = Color.GREEN

		side_cliff_detector.force_raycast_update()  # ensure fresh
		if not side_cliff_detector.is_colliding():
			color = Color.RED  # no hit = cliff/void
		else:
			var drop = ai_body.global_position.y - cliff_detector.get_collision_point().y
			if drop > max_safe_drop:
				color = Color.RED  # too far drop = unsafe
		# else green = safe floor

		DebugDraw3D.draw_line(start, end, color, 0.0)
		if cliff_detector.is_colliding():
			DebugDraw3D.draw_sphere(side_cliff_detector.get_collision_point(), 0.15, Color.GREEN_YELLOW, 0.0)

	if side_wall_detector:
		var start = ai_body.to_global(side_wall_detector.position)
		var end = start + side_wall_detector.target_position
		var color = Color.GREEN

		side_wall_detector.force_raycast_update()  # ensure fresh
		if side_wall_detector.is_colliding():
			color = Color.RED  # no hit = cliff/void
		# else green = safe floor

		DebugDraw3D.draw_line(start, end, color, 0.0)
		if cliff_detector.is_colliding():
			DebugDraw3D.draw_sphere(side_wall_detector.get_collision_point(), 0.15, Color.INDIAN_RED, 0.0)

	# Jump detector ray (forward at head height, down a bit)
	if side_jump_detector:
		var start = ai_body.to_global(side_jump_detector.position)
		var end = start + side_jump_detector.target_position
		var color = Color.ORANGE if not side_jump_detector.is_colliding() else Color.GREEN  # green clear, orange obstacle

		side_jump_detector.force_raycast_update()
		DebugDraw3D.draw_line(start, end, color, 0.0)
		if side_jump_detector.is_colliding():
			DebugDraw3D.draw_sphere(side_jump_detector.get_collision_point(), 0.15, Color.GREEN_YELLOW, 0.0)		
	
	# LOS raycast (approximate line to player if exists, color by can_see)
	if player:
		var start = ai_body.to_global(los_raycast.position)
		var end = start + los_raycast.target_position
		var los_color = Color.GREEN if can_see_player(ai_body, player) else Color.RED
		DebugDraw3D.draw_line(start, end, los_color, 0.0)

		# Optional: sphere at last seen
		DebugDraw3D.draw_sphere(player_last_seen_at, 0.5, Color.PURPLE, 0.0)

func reset() -> void:
	wander_timer = 0.0
	attack_timer = 0.0

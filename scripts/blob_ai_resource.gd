extends Resource
class_name BlobAIResource

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
var jump_detector: RayCast3D
var los_raycast: RayCast3D
var exclude: Array[RID]
var space_state: PhysicsDirectSpaceState3D
var first_run:bool = false

# Debug viz only
var debug_move_dir: Vector3 = Vector3.ZERO
var debug_look_dir: Vector3 = Vector3.ZERO

func setup_detection_systems(body:CharacterBody3D) -> void:
	# Personal space
	var forward_direction: Vector3 = body.global_transform.basis.z.normalized()
	
	#personal_space_cast = ShapeCast3D.new()
	#var sphere_shape = SphereShape3D.new()
	#sphere_shape.radius = max_personal_space_radius
	#personal_space_cast.shape = sphere_shape
	#personal_space_cast.target_position = Vector3.ZERO
	#personal_space_cast.enabled = true
	#personal_space_cast.collision_mask = 1
	#body.add_child(personal_space_cast)
	
	# Cliff detector
	cliff_detector = RayCast3D.new()
	cliff_detector.target_position = forward_direction*check_in_front_dist + Vector3(0, -1, 0) * (max_safe_drop + 0.5)
	cliff_detector.enabled = true
	cliff_detector.collision_mask = 1
	cliff_detector.position = forward_direction*check_in_front_dist + Vector3(0, 0.1, 0)
	body.add_child(cliff_detector)
	
	# Jump detector
	jump_detector = RayCast3D.new()
	jump_detector.target_position = forward_direction*check_in_front_dist + Vector3(0, -1, 0) * 0.1
	jump_detector.enabled = true
	jump_detector.collision_mask = 1
	jump_detector.position = forward_direction*check_in_front_dist + Vector3(0, max_jump_height, 0)
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
				print("player is seen!")
				return true
			else:
				print("player is blocked by line of sight")
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
		print("ai can see u")
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
	match current_state:
		AIState.WANDER:
			move_dir = get_wander_direction(ai_body.global_position, delta)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, move_dir, delta)
			if move_dir.length() > 0.01:
				look_dir = move_dir

		AIState.CHASE:
			var raw_chase = get_chase_direction(ai_body.global_position, player_last_seen_at)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, raw_chase, delta)
			if move_dir.length() > 0.01:
				look_dir = move_dir
			elif current_state == AIState.CHASE_WALL_FOLLOW:
				# we instant state changed, so change behavior
				look_dir = _estimate_next_wall_follow_look(ai_body)
				
		AIState.CHASE_WALL_FOLLOW:
			move_dir = get_wall_follow_direction(ai_body, delta)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, move_dir, delta)
			if move_dir.length() > 0.01:
				look_dir = move_dir
			else:
				# wall following robot look dir code
				look_dir = _get_best_look_when_stuck(ai_body, player)
		AIState.WANDER_WALL_FOLLOW:
			move_dir = get_wander_direction(ai_body.global_position, delta)
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, move_dir, delta)
			if move_dir.length() > 0.01:
				look_dir = move_dir
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
			move_dir = _apply_cliff_check_and_wall_transition_if_needed(ai_body, move_dir, delta)
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

	if abs(dot) < 0.1:
		# almost straight ahead → randomize
		wall_follow_side = 1 if randf() < 0.5 else -1
	else:
		# prefer the side that turns us toward player faster
		wall_follow_side = sign(dot)
	if wall_follow_side == 0:
		wall_follow_side = 1

func get_wall_follow_direction(
	ai_body: CharacterBody3D,
	delta: float
) -> Vector3:

	if wall_follow_timer <= 0:
		# timeout → give up
		wall_follow_cooldown = chase_cooldown_time
		current_state = AIState.CHASE_COOLDOWN
		return Vector3.ZERO

	if current_state == AIState.CHASE_WALL_FOLLOW:
		wall_follow_timer -= delta

	var forward = ai_body.global_transform.basis.z
	var right   = ai_body.global_transform.basis.x   # already right vector

	# Side ray – checks if wall/cliff is still on our "hand" side	
	var side_check_dist = check_in_front_dist * 1.4
	var side_ray_dir = (forward + right * wall_follow_side * 0.9).normalized()

	var side_cast = RayCast3D.new()  # temporary helper ray
	side_cast.target_position = side_ray_dir * side_check_dist + Vector3(0,-1,0) * max_safe_drop
	side_cast.position = side_ray_dir * side_check_dist + Vector3(0, 0.2, 0) #important that the ray is pointing directly down
	side_cast.collision_mask = cliff_detector.collision_mask
	ai_body.add_child(side_cast)
	side_cast.force_raycast_update()

	var has_wall_on_side = (not side_cast.is_colliding())

	side_cast.queue_free()

	# Main forward cliff check
	cliff_detector.force_raycast_update()

	if cliff_detector.is_colliding():
		# no cliff ahead anymore → try go forward again
		last_valid_direction = forward
		return forward

	if has_wall_on_side:
		# good – keep wall on right/left → slight turn away from wall + forward
		var turn_away = -right * wall_follow_side * 0.4
		var wish_dir = (forward + turn_away).normalized()
		return wish_dir

	else:
		# lost the wall on our side → turn toward wall
		var turn_toward = right * wall_follow_side * 1.2
		var wish_dir = (forward + turn_toward).lerp(forward, 0.3).normalized()
		return wish_dir

func _apply_cliff_check_and_wall_transition_if_needed(
	ai_body: CharacterBody3D,
	intended_dir: Vector3,
	delta: float
	) -> Vector3:

	if intended_dir.length_squared() < 0.01:
		return Vector3.ZERO
	
	jump_detector.position = -intended_dir*check_in_front_dist + Vector3(0, max_jump_height, 0)
	jump_detector.target_position = Vector3(0, -max_jump_height, 0) +Vector3(0, 0.1, 0)

	cliff_detector.position = -intended_dir*check_in_front_dist + Vector3(0, 0.1, 0)
	cliff_detector.target_position = Vector3(0, -1, 0) * max_safe_drop

	cliff_detector.force_raycast_update()
	jump_detector.force_raycast_update()

	if jump_detector.is_colliding():  # needs to be checked first so we jump
		if current_state == AIState.WANDER_WALL_FOLLOW:
			current_state = AIState.WANDER
		elif current_state == AIState.CHASE_WALL_FOLLOW:
			current_state = AIState.CHASE
		ai_body.jump()
		return intended_dir  # also safe
	elif cliff_detector.is_colliding():
		if current_state == AIState.WANDER_WALL_FOLLOW:
			current_state = AIState.WANDER
		elif current_state == AIState.CHASE_WALL_FOLLOW:
			current_state = AIState.CHASE
		#var drop = ai_body.global_position.y - cliff_detector.get_collision_point().y
		#if drop <= max_safe_drop:
		return intended_dir  # safe
	

	# cliff or unsafe drop → switch or stay in wall follow
	if current_state == AIState.WANDER_WALL_FOLLOW or current_state == AIState.CHASE_WALL_FOLLOW:
		# already wall following → let wall follow code handle it
		return get_wall_follow_direction(ai_body, delta)
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
			DebugDraw3D.draw_sphere(cliff_detector.get_collision_point(), 0.15, Color.YELLOW, 0.0)

	# Jump detector ray (forward at head height, down a bit)
	if jump_detector:
		var start = ai_body.to_global(jump_detector.position)
		var end = start + jump_detector.target_position
		var color = Color.GREEN if not jump_detector.is_colliding() else Color.ORANGE  # green clear, orange obstacle

		jump_detector.force_raycast_update()
		DebugDraw3D.draw_line(start, end, color, 0.0)
		if jump_detector.is_colliding():
			DebugDraw3D.draw_sphere(jump_detector.get_collision_point(), 0.15, Color.YELLOW, 0.0)

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

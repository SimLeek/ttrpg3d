extends Resource
class_name BlobAIResource

@export_group("Detection")
@export var horiz_degree_view: float = 90.0
@export var vert_degree_view: float = 60.0
@export var detection_range: float = 120.0
@export var chase_timer: float = 10
@export var los_back_dist: float = 0.75

@export var terrain_detection: TerrainDetectionSystem

@export_group("Wandering")
@export var wander_radius: float = 10.0
@export var wander_wait_time: float = 3.0
@export var return_pull_strength: float = 0.5

@export_group("Combat")
@export var attack_range: float = 1.5
@export var attack_cooldown: float = 1.0

@export_group("Bounce Back")
@export var bounce_back_time: float = 2.0  # how long to bounce back after hitting obstacle

@export_group("Stop and Turn Behavior")
@export var brake_timer: float = 1.0 # time to be stopped for
@export var turn_wiggle_angle: float = 30.0 # Degrees to look left/right
@export var turn_wiggle_duration: float = 0.3 # How long to look in each direction

const epsilon = 0.01

enum AIState { WANDER, CHASE, ATTACK, BOUNCING, STOP_AND_TURN }
enum TurnStage { BRAKING, LOOK_LEFT, LOOK_RIGHT }

# State
var brake_timer_elapsed:float = 0.0
var current_state : AIState = AIState.WANDER
var player_last_seen_at: Vector3
var previous_state : AIState = AIState.WANDER  # store state before bouncing

var spawn_position: Vector3
var wander_target: Vector3
var wander_timer: float = 0.0
var attack_timer: float = 0.0
var bounce_timer: float = 0.0
var bounce_direction: Vector3 = Vector3.ZERO
var chase_timer_elapsed:float = 0.0

# Stop and Turn State Vars
var turn_stage: TurnStage = TurnStage.BRAKING
var turn_timer: float = 0.0
var turn_intended_next_state: AIState
var turn_intended_direction: Vector3
var turn_stored_look_dir: Vector3 # Where we were looking before stopping

# detectors
var los_raycast: RayCast3D
var exclude: Array[RID]
var space_state: PhysicsDirectSpaceState3D

# Debug viz only
var debug_move_dir: Vector3 = Vector3.ZERO
var debug_look_dir: Vector3 = Vector3.ZERO
var debug_bounce_normal: Vector3 = Vector3.ZERO
var debug_bounce_origin: Vector3 = Vector3.ZERO

func setup(body:CharacterBody3D, players: Array[Node]) -> void:
	if not terrain_detection: terrain_detection = TerrainDetectionSystem.new()
	terrain_detection.setup(body, players)
	setup_detection_systems(body, players)

func setup_detection_systems(body:CharacterBody3D, players: Array[Node]) -> void:
	# Line of sight
	los_raycast = RayCast3D.new()
	los_raycast.enabled = true
	los_raycast.collision_mask = 3 # 1 and 2 bits
	los_raycast.exclude_parent = true
	los_raycast.hit_from_inside = true  # ai sometimes shoves faces into things
	los_raycast.position = Vector3(0, 0, -los_back_dist) # set behind a bit so ai doesn't shove eyes through walls
	body.add_child(los_raycast)
	
	exclude = [body.get_rid()]
	for child in body.get_children():
		if child is SoftBody3D:
			exclude.append(child.get_physics_rid())
	for player in players:
		for child in player.get_children():
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
		
	if not player:
		#print("no player to detect")
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

## SUB-ROUTINE: Called by Wander and Bouncing to handle the stop-wiggle-turn behavior
func initiate_turn_sequence(ai_body: CharacterBody3D, next_state: AIState, next_dir: Vector3) -> void:
	current_state = AIState.STOP_AND_TURN
	brake_timer_elapsed = 0.0
	turn_intended_next_state = next_state
	turn_intended_direction = next_dir
	turn_stage = TurnStage.BRAKING
	
	# Store current forward look direction so we keep looking that way while stopping
	var current_forward = ai_body.global_transform.basis.z
	turn_stored_look_dir = Vector3(current_forward.x, 0, current_forward.z).normalized()
	if turn_stored_look_dir.length_squared() < 0.01:
		turn_stored_look_dir = Vector3.FORWARD

func ai_think(delta: float, ai_body: CharacterBody3D, player: Node3D) -> Array:
	# Update timers
	attack_timer -= delta
	
	var move_dir := Vector3.ZERO
	var look_dir := Vector3.ZERO
	var can_see

	# ------------------------------------------------------------------
	# Handle STOP AND TURN Sub-routine State
	# ------------------------------------------------------------------
	
	if current_state == AIState.STOP_AND_TURN:
		match turn_intended_next_state:
				AIState.CHASE:
					can_see = can_see_player(ai_body, player)
					if not can_see and (player_last_seen_at - player.global_position).length()>2.0:
						chase_timer_elapsed += delta
						#print(chase_timer_elapsed)
		match turn_stage:
			TurnStage.BRAKING:
				# Keep looking forward
				look_dir = turn_stored_look_dir
				brake_timer_elapsed += delta
				# manual braking doesn't work, so just set to zero and pray
				move_dir = Vector3.ZERO
				
				if brake_timer_elapsed > brake_timer:
					# Stopped, move to wiggle
					turn_stage = TurnStage.LOOK_LEFT
					turn_timer = turn_wiggle_duration
			
			TurnStage.LOOK_LEFT:
				move_dir = Vector3.ZERO
				turn_timer -= delta
				# Rotate look dir left
				look_dir = turn_stored_look_dir.rotated(Vector3.UP, deg_to_rad(turn_wiggle_angle))
				
				if turn_timer <= 0:
					turn_stage = TurnStage.LOOK_RIGHT
					turn_timer = turn_wiggle_duration
			
			TurnStage.LOOK_RIGHT:
				move_dir = Vector3.ZERO
				turn_timer -= delta
				# Rotate look dir right
				look_dir = turn_stored_look_dir.rotated(Vector3.UP, deg_to_rad(-turn_wiggle_angle))
				
				if turn_timer <= 0:
					# Sequence complete, switch to intended state
					current_state = turn_intended_next_state
					
					# Initialize timers for the new states
					if current_state == AIState.BOUNCING:
						bounce_timer = bounce_back_time
						bounce_direction = turn_intended_direction # Ensure bounce dir is set
						move_dir = bounce_direction
						look_dir = bounce_direction
					elif current_state == AIState.WANDER:
						# Wander target was already set before sequence started
						move_dir = turn_intended_direction
						look_dir = turn_intended_direction

		debug_move_dir = move_dir
		debug_look_dir = look_dir
		return [move_dir, look_dir]

	# ------------------------------------------------------------------
	# Handle BOUNCING State
	# ------------------------------------------------------------------
	if current_state == AIState.BOUNCING:
		match previous_state:
				AIState.CHASE:
					if not can_see and (player_last_seen_at - player.global_position).length()>2.0:
						chase_timer_elapsed += delta
						#print(chase_timer_elapsed)
		bounce_timer -= delta
		if bounce_timer <= 0:
			current_state = previous_state
			move_dir = Vector3.ZERO # Momentary pause before resuming previous state
		else:
			# Just move in bounce direction
			debug_move_dir = bounce_direction
			debug_look_dir = bounce_direction
			# Note: We do NOT check obstacles while bouncing, or we might infinite loop
			return [bounce_direction, bounce_direction]

	# ------------------------------------------------------------------
	# Standard Logic (Wander, Chase, Attack)
	# ------------------------------------------------------------------
	
	# Early out if player doesn't exist
	if not player:
		if current_state != AIState.WANDER:
			current_state = AIState.WANDER
		
		# Separate Wander logic here to handle the stop sequence
		move_dir = get_wander_direction_no_timer(ai_body.global_position)
		wander_timer -= delta
		
		# If timer up, trigger sequence
		if wander_timer <= 0.0 or ai_body.global_position.distance_to(wander_target) < 1.0:
			_generate_new_wander_target()
			var new_dir = get_wander_direction_no_timer(ai_body.global_position)
			initiate_turn_sequence(ai_body, AIState.WANDER, new_dir)
			return [Vector3.ZERO, turn_stored_look_dir]
			
		var obstacle_check= terrain_detection.check_for_obstacles(ai_body, player, move_dir)
		move_dir = obstacle_check.move_dir
		
		if obstacle_check.bounced:
			# TRIGGER BOUNCE via TURN SEQUENCE
			previous_state = current_state # Store old state (likely wander)
			# Start the stop/turn sequence, ending in the BOUNCING state with the calculated direction
			initiate_turn_sequence(ai_body, AIState.BOUNCING, terrain_detection.bounce_normal)
		
		debug_move_dir = move_dir
		debug_look_dir = move_dir
		return [move_dir, move_dir]

	# Core visibility + distance checks
	can_see = can_see_player(ai_body, player)
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
			if not can_see and (chase_timer_elapsed > chase_timer) and (player_last_seen_at - player.global_position).length()>2.0:
				current_state = AIState.WANDER
				chase_timer_elapsed = 0.0
				#print("chase done. wandering.")
		AIState.WANDER:
			if can_see:
				current_state = AIState.CHASE

	# Execute behavior for current state
	match current_state:
		AIState.WANDER:
			wander_timer -= delta
			
			# Check if we need to pick a new target
			if wander_timer <= 0.0 or ai_body.global_position.distance_to(wander_target) < 1.0:
				_generate_new_wander_target()
				var new_dir = get_wander_direction_no_timer(ai_body.global_position)
				# Call the subroutine!
				initiate_turn_sequence(ai_body, AIState.WANDER, new_dir)
				# Return zero for this frame to prevent jitter
				return [Vector3.ZERO, turn_stored_look_dir]
			
			move_dir = get_wander_direction_no_timer(ai_body.global_position)
			var obstacle_check = terrain_detection.check_for_obstacles(ai_body, player, move_dir)
			move_dir = obstacle_check.move_dir
			if obstacle_check.bounced:
				previous_state = current_state # Store old state (likely wander)
				# Start the stop/turn sequence, ending in the BOUNCING state with the calculated direction
				initiate_turn_sequence(ai_body, AIState.BOUNCING, obstacle_check.bounce_normal)
				
			if move_dir.length() > 0.01:
				look_dir = move_dir

		AIState.CHASE:
			move_dir = get_chase_direction(ai_body.global_position, player_last_seen_at)
			
			var obstacle_check = terrain_detection.check_for_obstacles(ai_body, player, move_dir)
			move_dir = obstacle_check.move_dir
			if obstacle_check.bounced:
				previous_state = current_state # Store old state (likely wander)
				# Start the stop/turn sequence, ending in the BOUNCING state with the calculated direction
				initiate_turn_sequence(ai_body, AIState.BOUNCING, obstacle_check.bounce_normal)
			
			if not can_see and (player_last_seen_at - player.global_position).length()>2.0:
				chase_timer_elapsed += delta
				
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

## Helper to get direction without modifying timer
func get_wander_direction_no_timer(ai_pos: Vector3) -> Vector3:
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
	if current_state == AIState.STOP_AND_TURN:
		state_name += "\n" + TurnStage.keys()[turn_stage]
		
	DebugDraw3D.draw_text(ai_body.global_position + Vector3(0, 3.0, 0), state_name, 32, Color.WHITE)

	terrain_detection.draw_debug(ai_body)

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

	# LOS raycast
	if player:
		var start = ai_body.to_global(los_raycast.position)
		var end = start + los_raycast.target_position
		var los_color = Color.GREEN if can_see_player(ai_body, player) else Color.RED
		DebugDraw3D.draw_line(start, end, los_color, 0.0)

		# Sphere at last seen
		DebugDraw3D.draw_sphere(player_last_seen_at, 0.5, Color.PURPLE, 0.0)

## Update visualization with a sliding window of FIXED size (units, not degrees)
func update_vision_cone_display(
	vision_mesh_instance: MeshInstance3D, 
	ai_body: CharacterBody3D, 
	player: Node3D,
	window_width: float = 4.0,   # Width in meters/units
	window_height: float = 4.0   # Height in meters/units
	) -> void:
	if not vision_mesh_instance or not ai_body:
		return
	
	# 1. Capture Material and Setup Mesh
	# We grab the material first so we can re-apply it after rebuilding the surface
	var original_material = vision_mesh_instance.get_active_material(0)
	
	var vision_cone_mesh: ArrayMesh
	if vision_mesh_instance.mesh is ArrayMesh:
		vision_cone_mesh = vision_mesh_instance.mesh
	else:
		vision_cone_mesh = ArrayMesh.new()
		vision_mesh_instance.mesh = vision_cone_mesh

	# 2. Calculate Environmental Depth (Wall Hit)
	var forward_global = ai_body.global_transform.basis.z.normalized()
	var origin_global = ai_body.global_position + Vector3(0, 0.5, 0)
	var target_global = origin_global + forward_global * detection_range
	
	var env_depth = detection_range
	var query = PhysicsRayQueryParameters3D.create(origin_global, target_global)
	query.exclude = exclude
	var hit = space_state.intersect_ray(query)
	if not hit.is_empty():
		env_depth = origin_global.distance_to(hit.position)
	
	# 3. Calculate Final Depth (Player vs Wall)
	var actual_depth = env_depth
	var local_p = Vector3.ZERO
	
	var player_pos
	if player:
		if current_state in [AIState.CHASE, AIState.ATTACK]:
			if (player.global_position-player_last_seen_at).length()<1:
				original_material.albedo_color = Color(1.0, 0.0, 0.0, 0.25)
			else:
				original_material.albedo_color = Color(1.0, 0.464, 0.007, 0.25)
			player_pos = player_last_seen_at
		else:
			original_material.albedo_color = Color(1.0, 210.0/255.0, 120.0/255.0, 138.0/255)
			player_pos = player.global_position
			
		#local_p = ai_body.to_local(player.global_position)
		local_p = ai_body.to_local(player_pos)
		# Per your code logic, +Z is forward. 
		var player_depth = local_p.z 
		
		# If player is in front and closer than the wall/max range, 
		# we shrink the frustum to end exactly at the player's depth.
		if player_depth > 0.1 and player_depth < env_depth:
			actual_depth = player_depth
		
		# in case player is hiding behind a wall, restrict the frustum
		query = PhysicsRayQueryParameters3D.create(origin_global, player_pos)
		query.exclude = exclude
		hit = space_state.intersect_ray(query)
		if not hit.is_empty():
			player_depth = origin_global.distance_to(hit.position)
			if player_depth > 0.1 and player_depth < env_depth:
				actual_depth = player_depth
	
	# Safety floor to prevent division by zero or inverted geometry
	actual_depth = maxf(actual_depth, 0.5)

	# 4. Calculate Maximum FOV boundaries at this specific depth
	var half_fov_h = deg_to_rad(horiz_degree_view / 2.0)
	var half_fov_v = deg_to_rad(vert_degree_view / 2.0)
	
	var max_half_w = tan(half_fov_h) * actual_depth
	var max_half_h = tan(half_fov_v) * actual_depth

	# 5. Project Player onto the Far Plane
	var center_x = 0.0
	var center_y = 0.0
	
	if player:
		# Project the player's position onto the plane at Z = actual_depth
		# If actual_depth == player_depth, this just results in local_p.x
		var p_z = maxf(local_p.z, 0.1) # Avoid division by zero
		center_x = (local_p.x / p_z) * actual_depth
		center_y = (local_p.y / p_z) * actual_depth

	# 6. Slide and Clamp the Window
	var half_win_w = window_width / 2.0
	var half_win_h = window_height / 2.0
	
	# Clamp window size if it exceeds FOV at this distance
	half_win_w = minf(half_win_w, max_half_w)
	half_win_h = minf(half_win_h, max_half_h)
	
	# Keep the window center within the FOV bounds
	center_x = clampf(center_x, -max_half_w + half_win_w, max_half_w - half_win_w)
	center_y = clampf(center_y, -max_half_h + half_win_h, max_half_h - half_win_h)
	
	var x_left = center_x - half_win_w
	var x_right = center_x + half_win_w
	var y_top = center_y + half_win_h
	var y_bottom = center_y - half_win_h

	# 7. Build the Mesh
	var vertices = PackedVector3Array()
	var indices = PackedInt32Array()
	var near_offset = 0.2
	var n_scale = near_offset / actual_depth
	
	# Near Plane (Indices 0-3)
	vertices.push_back(Vector3(x_left * n_scale,  y_top * n_scale,    near_offset)) 
	vertices.push_back(Vector3(x_right * n_scale, y_top * n_scale,    near_offset)) 
	vertices.push_back(Vector3(x_right * n_scale, y_bottom * n_scale, near_offset)) 
	vertices.push_back(Vector3(x_left * n_scale,  y_bottom * n_scale, near_offset)) 
	
	# Far Plane (Indices 4-7)
	vertices.push_back(Vector3(x_left,  y_top,    actual_depth)) 
	vertices.push_back(Vector3(x_right, y_top,    actual_depth)) 
	vertices.push_back(Vector3(x_right, y_bottom, actual_depth)) 
	vertices.push_back(Vector3(x_left,  y_bottom, actual_depth)) 
	
	# Build Triangles
	indices.append_array([0, 5, 4, 0, 1, 5]) # Top
	indices.append_array([1, 6, 5, 1, 2, 6]) # Right
	indices.append_array([2, 7, 6, 2, 3, 7]) # Bottom
	indices.append_array([3, 4, 7, 3, 0, 4]) # Left
	indices.append_array([4, 5, 6, 4, 6, 7]) # Far Cap
	
	var arrays = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_INDEX] = indices
	
	# Clear and Update
	vision_cone_mesh.clear_surfaces()
	vision_cone_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	
	# Re-apply the material to the new surface index
	if original_material:
		vision_mesh_instance.set_surface_override_material(0, original_material)
		
## Renders a simple vision frustum. 
## If 'override_depth' is greater than 0, it uses that instead of 'detection_range'.
func set_static_vision_cone_display(
	vision_mesh_instance: MeshInstance3D, 
	ai_body: CharacterBody3D, 
	override_depth: float = -1.0
	) -> void:
	
	if not vision_mesh_instance or not ai_body:
		return

	# 1. Capture Material BEFORE clearing the mesh
	var original_material = vision_mesh_instance.get_active_material(0)

	# 2. Determine Depth
	var actual_depth = override_depth if override_depth > 0 else detection_range
	actual_depth = maxf(actual_depth, 0.1)

	# 3. Setup Mesh
	var vision_cone_mesh: ArrayMesh
	if vision_mesh_instance.mesh is ArrayMesh:
		vision_cone_mesh = vision_mesh_instance.mesh
	else:
		vision_cone_mesh = ArrayMesh.new()
		vision_mesh_instance.mesh = vision_cone_mesh

	# 4. Calculate FOV Bounds
	var half_fov_h = deg_to_rad(horiz_degree_view / 2.0)
	var half_fov_v = deg_to_rad(vert_degree_view / 2.0)
	var x_bound = tan(half_fov_h) * actual_depth
	var y_bound = tan(half_fov_v) * actual_depth

	# 5. Build Geometry
	var vertices = PackedVector3Array()
	var indices = PackedInt32Array()
	var near_offset = 0.1
	var n_scale = near_offset / actual_depth
	
	# Near Plane
	vertices.push_back(Vector3(-x_bound * n_scale,  y_bound * n_scale,  near_offset)) 
	vertices.push_back(Vector3( x_bound * n_scale,  y_bound * n_scale,  near_offset)) 
	vertices.push_back(Vector3( x_bound * n_scale, -y_bound * n_scale,  near_offset)) 
	vertices.push_back(Vector3(-x_bound * n_scale, -y_bound * n_scale,  near_offset)) 
	
	# Far Plane
	vertices.push_back(Vector3(-x_bound,  y_bound,  actual_depth)) 
	vertices.push_back(Vector3( x_bound,  y_bound,  actual_depth)) 
	vertices.push_back(Vector3( x_bound, -y_bound,  actual_depth)) 
	vertices.push_back(Vector3(-x_bound, -y_bound,  actual_depth)) 
	
	indices.append_array([0, 5, 4, 0, 1, 5]) # Top
	indices.append_array([1, 6, 5, 1, 2, 6]) # Right
	indices.append_array([2, 7, 6, 2, 3, 7]) # Bottom
	indices.append_array([3, 4, 7, 3, 0, 4]) # Left
	indices.append_array([4, 5, 6, 4, 6, 7]) # Far Cap
	
	# 6. Commit Mesh and Re-apply Material
	var arrays = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_INDEX] = indices
	
	vision_cone_mesh.clear_surfaces()
	vision_cone_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)

	# Re-apply the material so it actually shows up
	if original_material:
		vision_mesh_instance.set_surface_override_material(0, original_material)

func reset() -> void:
	wander_timer = 0.0
	attack_timer = 0.0
	bounce_timer = 0.0

extends Resource
class_name TerrainDetectionSystem
## Terrain Detection system for AIs
##
## Use this instead of NavMeshes or volumes for AIs that should try to go everywhere on the ground. [br]
## Use NavMeshes or volumes if you have many, many AIs and low processing power, or want to keep AIs in a strict area. [br]
## [br]
## Uses rays to detect walls, cliffs, and jumps. [br]
## If something can be jumped over, it does so. [br]
## Gives the normal to cliffs and walls so other behaviors can use it.

@export_group("Terrain Detection")
## How far in front of itself the AI will check for walls or cliffs.
@export var check_in_front_dist: float = 0.75
## How far the AI can safely fall, or how far it can get back up from.
@export var max_safe_drop: float = 2.4
## The max height the AI can jump over.
@export var max_jump_height: float = 2.4
## The min height the AI has to jump over. 
## This assumes a stair stepper will automatically pull the AI over this height.
@export var min_obstacle_height_needed_to_jump_over: float = 0.3

const epsilon = 0.01

## Ray starting ahead of the AI and pointing directly down to check for cliffs
## If it does not collide, then there is a cliff
var cliff_detector: RayCast3D
## Ray starting inside the AI and pointing directly ahead to check for walls
## If it collides, then there is a wall
var wall_detector: RayCast3D
## Ray starting ahead of the AI at wall detector position and pointing down to the floor
## if it collides, then the "wall" can be jumped over
var jump_detector: RayCast3D
## List of exclusions when checking for terrain. 
## So we don't detect ourselves as a wall or try to jump over the player
var exclude: Array[RID]

## the last bounce normal that was detected, for debugging purposes
var debug_bounce_normal
## the last bounce origin that was detected, for debugging purposes
var debug_bounce_origin

var enable_cliff_debug: bool = false  # Toggle for visual debugging

## Obstacle Check result returned by check_for_obstacles [br]
## [br]
## [param move_dir] direction we should move. Zero if we hit something. [br]
## [param bounced] True if we hit a wall or cliff. False otherwise. [br]
## [param bounce_normal] The normal of our collision. Zero if no bounce.
class ObstacleCheck:
	var move_dir:Vector3
	var bounced:bool
	var bounce_normal:Vector3
	
	func _init(_move_dir: Vector3, _bounced: bool, _bounce_normal: Vector3):
		move_dir = _move_dir
		bounced = _bounced
		bounce_normal = _bounce_normal

## This function needs to be called in setup or else the rest of the script won't run. [br]
## [br]
## [param body] The main AI body.[br]
## [param players] The list of players.
func setup(body: CharacterBody3D, players:Array[Node]) -> void:
	setup_raycasts(body, players)

## Initializes the internal raycasts and sets up the collision exclusion list. [br]
## [br]
## [param body] The main AI body.[br]
## [param players] The list of players to exclude from raycast detection.
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

## Detects walls, cliffs, and jumpable gaps.[br]
## [br]
## [param ai_body] The CharacterBody3D currently moving. [br]
## [param player] A reference node to help with specific visibility or ray checks. [br]
## [param intended_dir] The direction the AI wants to move. [br]
## [return] An ObstacleCheck object containing the modified direction and bounce normal.
func check_for_obstacles(
	ai_body: CharacterBody3D,
	player: Node3D, 
	intended_dir: Vector3
	) -> ObstacleCheck:

	if intended_dir.length_squared() < 0.01:
		return ObstacleCheck.new(Vector3.ZERO, false, Vector3.ZERO)
	
	# positions have minus because -z is forward
	jump_detector.position = intended_dir*-check_in_front_dist + Vector3(0, max_jump_height, 0)
	jump_detector.target_position = Vector3(0, -max_jump_height, 0) + Vector3(0, 0.1, 0)

	cliff_detector.position = intended_dir*-check_in_front_dist + Vector3(0, 0.1, 0)
	cliff_detector.target_position = Vector3(0, -1, 0) * max_safe_drop
	
	wall_detector.position = Vector3(0, 0.1, check_in_front_dist*.1) # a bit behind us in case we're phasing into the wall
	wall_detector.target_position = intended_dir*-check_in_front_dist*1.1
	
	cliff_detector.force_raycast_update()
	jump_detector.force_raycast_update()
	wall_detector.force_raycast_update()

	var can_jump_over = jump_detector.is_colliding()
	var has_cliff = not cliff_detector.is_colliding()
	
	var wall_collision = GlobalLib.special_ray_check(wall_detector, ai_body, player, exclude) 
	var has_wall = wall_collision != null and not wall_collision["player"] and not can_jump_over

	if can_jump_over:
		ai_body.jump()
		return ObstacleCheck.new(intended_dir, false, Vector3.ZERO)

	if not has_cliff and not has_wall:
		return ObstacleCheck.new(intended_dir, false, Vector3.ZERO)

	var bounce_normal = Vector3.ZERO
	
	if has_wall:
		print("wall bounce")
		# this seems to be the surface normal
		# to get the reflected ray, do R=I-2(I*N)N
		# to get a wall follow direction, take the cross product with Vector3.UP
		bounce_normal = wall_collision["normal"] 

		bounce_normal.y = 0
		bounce_normal = bounce_normal.normalized()

		debug_bounce_origin = wall_detector["position"]
		debug_bounce_normal = bounce_normal
	elif has_cliff:
		print("cliff bounce")
		# this also now gets the cliff edge "surface normal"
		var bounce_norm_and_pos = _get_cliff_edge_normal_ledge_style(ai_body, intended_dir)
		bounce_normal = bounce_norm_and_pos[0]
		debug_bounce_origin = ai_body.global_position + intended_dir * check_in_front_dist
		debug_bounce_normal = bounce_normal
	
	if bounce_normal.length_squared() < 0.01:
		bounce_normal = -intended_dir
		debug_bounce_origin = ai_body.global_position
		debug_bounce_normal = bounce_normal
	
	# Returning zero for now to let other functions take over with other behaviors
	print("bounced")
	#return ObstacleCheck.new(Vector3.ZERO, false, Vector3.ZERO)  # stop so I see debug stuff
	return ObstacleCheck.new(Vector3.ZERO, true, bounce_normal)

## Visualizes the internal raycasts and bounce normals for debugging purposes. [br]
## [br]
## [param ai_body] The AI body used as a reference for global positions.
func draw_debug(ai_body: CharacterBody3D) -> void:
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

	if wall_detector:
		var start = ai_body.to_global(wall_detector.position)
		var end = start + wall_detector.target_position
		var color = Color.GREEN if not wall_detector.is_colliding() else Color.RED

		wall_detector.force_raycast_update()
		DebugDraw3D.draw_line(start, end, color, 0.0)
		if wall_detector.is_colliding():
			DebugDraw3D.draw_sphere(wall_detector.get_collision_point(), 0.15, Color.INDIAN_RED, 0.0)

	if jump_detector:
		var start = ai_body.to_global(jump_detector.position)
		var end = start + jump_detector.target_position
		var color = Color.ORANGE if not jump_detector.is_colliding() else Color.GREEN

		jump_detector.force_raycast_update()
		DebugDraw3D.draw_line(start, end, color, 0.0)
		if jump_detector.is_colliding():
			DebugDraw3D.draw_sphere(jump_detector.get_collision_point(), 0.15, Color.GREEN_YELLOW, 0.0)
	
	if debug_bounce_normal and debug_bounce_normal.length() > 0.01:
		DebugDraw3D.draw_arrow(
			debug_bounce_origin,
			debug_bounce_origin + debug_bounce_normal.normalized() * 2.0,
			Color.MAGENTA,
			0.0
		)

func _get_cliff_edge_normal_ledge_style(ai_body: CharacterBody3D, forward_dir: Vector3) -> Array:
	var up: Vector3 = Vector3.UP
	var origin: Vector3 = ai_body.global_position
	
	# Get the radius to scan at (distance from player to cliff detector)
	var scan_radius: float = Vector2(cliff_detector.position.x, cliff_detector.position.z).length()
	
	# Binary search to find left and right cliff edges
	var left_angle: float = _find_cliff_edge_angle(ai_body, origin, forward_dir, scan_radius, true)
	var right_angle: float = _find_cliff_edge_angle(ai_body, origin, forward_dir, scan_radius, false)
	
	# Convert angles to world positions
	var left_pos: Vector3 = origin + _angle_to_direction(forward_dir, left_angle) * scan_radius
	var right_pos: Vector3 = origin + _angle_to_direction(forward_dir, right_angle) * scan_radius
	
	# cliff left and right are always "found". If they're max (180), then we're standing on a sharp edge, 
	# and the left and right really are nearly 180 from us, or we're on a point
	# and if we're on a point, we're kinga screwed anyway
	
	_debug_draw_side_checks(left_pos, right_pos)
	
	# Calculate cliff edge normal from the two side points
	#if left_found and right_found:
	print("full cliff normal")
	var edge_vector: Vector3 = right_pos - left_pos
	edge_vector.y = 0
	# Normal perpendicular to edge (cross with up to get perpendicular)
	var normal: Vector3 = edge_vector.cross(up).normalized()
	var position: Vector3 = (right_pos + left_pos)/2
	
	# Make sure it points away from movement direction
	if normal.dot(forward_dir) > 0:
		normal = -normal
	
	_debug_draw_final_normal(origin, normal, "FULL_EDGE")
	return [normal, position]

func _find_cliff_edge_angle(ai_body: CharacterBody3D, origin: Vector3, forward_dir: Vector3, radius: float, is_left: bool) -> float:
	# Binary search parameters
	var max_angle: float = 90.0
	var current_angle: float = 90
	var step: float = max_angle /2
	
	var iterations: int = 0
	var max_iterations: int = 8  # 170, 85, 42.5, 21.25, 10.625, 5.3125, 2.65625, 1.328125
	
	var space_state = ai_body.get_world_3d().direct_space_state
	
	while iterations < max_iterations:
		var test_dir: Vector3 = _angle_to_direction(forward_dir, current_angle if is_left else -current_angle)
		var scan_pos: Vector3 = origin + test_dir * radius
		scan_pos.y = origin.y  # Keep at player height
		
		var ray_end: Vector3 = scan_pos + Vector3.DOWN * abs(cliff_detector.target_position.y)
		
		# Cast ray downward to check for floor
		var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(scan_pos, ray_end)
		query.exclude = exclude
		query.collide_with_areas = false
		query.collide_with_bodies = true
		
		var hit: Dictionary = space_state.intersect_ray(query)
		
		# Debug each test ray
		_debug_draw_search_ray(scan_pos, ray_end, hit.is_empty(), iterations)
		
		if hit.is_empty():
			# No floor = we're over the cliff, angle is too wide
			current_angle += step
		else:
			# Floor found = we're not over cliff yet, angle is too narrow
			current_angle -= step
		
		step /= 2.0
		iterations += 1
	
	# putting the minus sign here to reduce confusion
	if is_left:
		return current_angle
	else:
		return -current_angle


func _angle_to_direction(forward_dir: Vector3, angle_degrees: float) -> Vector3:
	# Rotate forward_dir by angle_degrees around the Y axis
	print(angle_degrees)
	var angle_rad: float = deg_to_rad(angle_degrees)
	print(angle_rad)
	var forward_2d: Vector2 = Vector2(forward_dir.x, forward_dir.z)
	var rotated: Vector2 = forward_2d.rotated(angle_rad)
	return Vector3(rotated.x, 0, rotated.y).normalized()


func _debug_draw_search_ray(start: Vector3, end: Vector3, is_empty: bool, iteration: int) -> void:
	if not enable_cliff_debug:
		return
	
	# Color code by iteration depth for visualization
	var colors = [Color.RED, Color.ORANGE, Color.YELLOW, Color.GREEN, 
				  Color.CYAN, Color.BLUE, Color.PURPLE, Color.MAGENTA]
	var color = colors[iteration % colors.size()]
	color.a = 0.5  # Semi-transparent
	
	if is_empty:
		color = color.darkened(0.3)  # Darker if no hit
	
	DebugDraw3D.draw_line(start, end, color, 0.0)
	if not is_empty:
		DebugDraw3D.draw_sphere(end, 0.08, color, 0.0)


func _debug_draw_side_checks(left_pos: Vector3, right_pos: Vector3) -> void:
	if not enable_cliff_debug:
		return
	
	DebugDraw3D.draw_line(left_pos, right_pos, Color.WHITE, 0.0)


func _debug_draw_final_normal(origin: Vector3, normal: Vector3, label: String) -> void:
	if not enable_cliff_debug:
		return
	
	var color: Color
	match label:
		"FULL_EDGE":
			color = Color.GREEN
		"LEFT_ONLY":
			color = Color.LIGHT_BLUE
		"RIGHT_ONLY":
			color = Color.LIGHT_CORAL
		"FALLBACK":
			color = Color.GRAY
		_:
			color = Color.WHITE
	
	DebugDraw3D.draw_arrow(
		origin,
		origin + normal * 2.5,
		color,
		0.0
	)

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


# Debug visualization functions
func _debug_draw_initial_ray(origin: Vector3, dir: Vector3, hit: Dictionary) -> void:
	if not enable_cliff_debug:
		return
	
	var end = origin + dir
	var color = Color.CYAN if not hit.is_empty() else Color.DARK_CYAN
	DebugDraw3D.draw_line(origin, end, color, 0.0)
	
	if not hit.is_empty():
		DebugDraw3D.draw_sphere(hit.position, 0.2, Color.CYAN, 0.0)


func _debug_draw_wall_hit(hit_pos: Vector3, wall_normal: Vector3) -> void:
	if not enable_cliff_debug:
		return
	
	DebugDraw3D.draw_sphere(hit_pos, 0.15, Color.YELLOW, 0.0)
	DebugDraw3D.draw_arrow(
		hit_pos,
		hit_pos + wall_normal * 1.5,
		Color.YELLOW,
		0.0
	)

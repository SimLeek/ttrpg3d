extends Node


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	pass # Replace with function body.


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	pass
'''
func get_wall_follow_direction(
	ai_body: CharacterBody3D,
	player: Node3D,
	delta: float
	) -> Vector3:

	if wall_follow_timer <= 0:
		# timeout → give up
		wall_follow_cooldown = chase_cooldown_time
		current_state = AIState.WANDER_WALL_FOLLOW
		return Vector3.ZERO

	if current_state == AIState.CHASE_WALL_FOLLOW:
		wall_follow_timer -= delta

	var forward = ai_body.global_transform.basis.z
	var right   = ai_body.global_transform.basis.x   # already right vector

	# Side ray – checks if wall/cliff is still on our "hand" side	
	var side_check_dist = check_in_front_dist * 1.4
	var side_ray_dir = (forward + right * wall_follow_side * 0.9).normalized()

	side_cliff_detector.position = side_ray_dir * side_check_dist + Vector3(0, 0.2, 0) #important that the ray is pointing directly down
	side_cliff_detector.target_position = Vector3(0,-max_safe_drop,0)  # relative to local
	side_cliff_detector.force_raycast_update()
	
	side_wall_detector.position = side_ray_dir * side_check_dist #important that the ray is pointing directly down
	side_wall_detector.target_position = side_ray_dir * side_check_dist   # relative to local
	#side_wall_detector.force_raycast_update()
	var side_wall_collision = special_ray_check(side_wall_detector, player)
	
	
	side_jump_detector.position = side_ray_dir*check_in_front_dist + Vector3(0, max_jump_height, 0)
	side_jump_detector.target_position = Vector3(0, -max_jump_height, 0) +Vector3(0, 0.1, 0)
	side_jump_detector.force_raycast_update()
	#var side_jump_collision = special_ray_check(side_wall_detector, player)
	var side_jump_collision = side_jump_detector.is_colliding()

	var has_cliff_on_side = (not side_cliff_detector.is_colliding())
	var has_wall_on_side = side_wall_collision and not side_jump_collision

	# Main forward cliff check
	cliff_detector.force_raycast_update()
	wall_detector.force_raycast_update()

	if cliff_detector.is_colliding() and not special_ray_check(wall_detector, player):
		# no cliff ahead anymore → try go forward again
		last_valid_direction = forward
		if current_state == AIState.WANDER_WALL_FOLLOW:
			current_state = AIState.WANDER
		elif current_state == AIState.CHASE_WALL_FOLLOW:
			current_state = AIState.CHASE
		return forward

	if side_jump_collision:  # jump over wall if possible
		ai_body.jump()
		var turn_toward = right * wall_follow_side * 1.2
		var wish_dir = (forward + turn_toward).lerp(forward, 0.3).normalized()
		if current_state == AIState.WANDER_WALL_FOLLOW:
			current_state = AIState.WANDER
		elif current_state == AIState.CHASE_WALL_FOLLOW:
			current_state = AIState.CHASE
		return wish_dir

	if has_wall_on_side or has_cliff_on_side:
		# good – keep wall on right/left → slight turn away from wall + forward
		var turn_away = -right * wall_follow_side * 0.4
		var wish_dir = (forward + turn_away).normalized()
		return wish_dir
	else:
		# lost the wall on our side → turn toward wall
		var turn_toward = right * wall_follow_side * 1.2
		var wish_dir = (forward + turn_toward).lerp(forward, 0.3).normalized()
		return wish_dir
'''

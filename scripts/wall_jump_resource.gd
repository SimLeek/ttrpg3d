extends Resource
class_name WallJumperResource

## Wall interactions - stats and control logic together

@export_group("Wall Jump")
@export var wall_jump_velocity: float = 12.0
@export var wall_kick_strength_multiplier: float = 1.25
@export var wall_kick_vertical_multiplier: float = 0.75
@export var wall_slide_speed: float = 4.0
@export var wall_slide_angle_tolerance: float = 45.0

## 0.0 is pure side, 1.0 is pure forward/back. 
## 0.7 allows for roughly 45 degrees of "sideways-ness".
@export var side_jump_threshold: float = 0.7

var jump_requested:bool = false

func apply_jump(vel_xyz:Vector3, body: CharacterBody3D, is_grounded: bool) -> Vector3:
	if jump_requested and body.is_on_wall() and not is_grounded:
		var wall_normal = body.get_wall_normal()
		var forward = -body.global_transform.basis.z
		var alignment = abs(forward.dot(wall_normal))
		if alignment > side_jump_threshold:
			return vel_xyz
		var kick_strength = abs(wall_jump_velocity) * wall_kick_strength_multiplier
		print("wall vel xyz modding")
		print(vel_xyz)
		vel_xyz.x = wall_normal.x * kick_strength
		vel_xyz.z = wall_normal.z * kick_strength
		vel_xyz.y = wall_jump_velocity * wall_kick_vertical_multiplier
		print(vel_xyz)
		print("wall vel xyz modded")

		#coyote_time_left = 0.0
		jump_requested = false
	return vel_xyz

## Handle wall sliding
func handle_wall_slide(vel_xyz:Vector3, body: CharacterBody3D, movement_direction: Vector3) -> Vector3:
	if not body.is_on_wall() or movement_direction.length() <= 0.1:
		return vel_xyz
	
	var wall_normal := body.get_wall_normal()
	var input_3d = movement_direction.normalized()
	var dot = input_3d.dot(-wall_normal)
	var cos_tolerance = cos(deg_to_rad(wall_slide_angle_tolerance))
	
	if dot > cos_tolerance and body.velocity.y<-wall_slide_speed:
		vel_xyz.y = -wall_slide_speed
	return vel_xyz

func reset() -> void:
	pass

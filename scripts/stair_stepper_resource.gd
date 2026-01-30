extends Resource
class_name StairStepperResource

## Gravity and falling - stats and control logic together

@export var STEP_UP: float = 0.2

var step_cast: ShapeCast3D

func handle_step_up(delta: float, body:CharacterBody3D, sv_xyz:Vector3) -> Vector3:
	step_cast.global_position.x = body.global_position.x + sv_xyz.x * delta
	step_cast.global_position.z = body.global_position.z + sv_xyz.z * delta

	step_cast.force_shapecast_update()

	if body.is_on_floor() and step_cast.is_colliding() and sv_xyz.y <= 0.0:
		var normal: Vector3 = step_cast.get_collision_normal(0)
		if normal.angle_to(Vector3.UP) < body.floor_max_angle:
			body.global_position.y = step_cast.get_collision_point(0).y + STEP_UP
			sv_xyz.y = 0.0
	return sv_xyz

func reset() -> void:
	pass

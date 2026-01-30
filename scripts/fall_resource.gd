extends Resource
class_name FallerResource

## Gravity and falling - stats and control logic together

@export var terminal_velocity: float = 150.0

## Apply gravity with terminal velocity
func apply_gravity(vel_xyz: Vector3, body: CharacterBody3D, delta: float) -> Vector3:
	vel_xyz += body.get_gravity() * delta
	
	if terminal_velocity>0 and vel_xyz.y < -terminal_velocity:
		vel_xyz.y = -terminal_velocity
	
	return vel_xyz

## Check if should be falling
func should_fall(body: CharacterBody3D, ledge_grabber = null) -> bool:
	var on_ground = body.is_on_floor()
	var grabbing_ledge = ledge_grabber and ledge_grabber.is_grabbing_ledge
	return not on_ground and not grabbing_ledge

func reset() -> void:
	pass

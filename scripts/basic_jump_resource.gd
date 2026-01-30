extends Resource
class_name BasicJumpResource

## Jump mechanics - stats and control logic together

@export_group("Basic Jump")
@export var jump_velocity: float = 12.0
@export var coyote_time: float = 0.25
@export var jump_cutoff_factor: float = 0.5

# State
var coyote_time_left: float = 0.0
var jump_requested: bool = false
var jump_release_requested: bool = false

## Request jump
func request_jump() -> void:
	jump_requested = true
	jump_release_requested = false

## Release jump
func release_jump() -> void:
	jump_release_requested = true

func handle_immediate_input(event: InputEvent) -> void:
	if event.is_action_pressed("jump"):
		jump_requested = true
		jump_release_requested = false  # This and the elif fix a weird bug

	elif event.is_action_released("jump"):
		jump_release_requested = true

## Update coyote time
func update_coyote_time(is_grounded: bool, delta: float) -> void:
	if is_grounded:
		coyote_time_left = coyote_time
	else:
		coyote_time_left = maxf(0.0, coyote_time_left - delta)

func apply_jump(vel_xyz:Vector3, is_grounded: bool) -> Vector3:
	if jump_requested and (is_grounded or coyote_time_left > 0.0):
		vel_xyz[1] = jump_velocity  # modifies in place
		coyote_time_left = 0.0
		jump_requested = false
	if jump_release_requested and vel_xyz.y > 0.0:
		vel_xyz *= jump_cutoff_factor
		jump_release_requested = false
	return vel_xyz
	
func reset() -> void:
	coyote_time_left = 0.0
	jump_requested = false
	jump_release_requested = false

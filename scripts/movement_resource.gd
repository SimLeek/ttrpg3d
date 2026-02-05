extends Resource
class_name MoverResource

@export_group("Speeds")
@export var normal_speed: float = 7.5
@export var sprint_speed: float = 15.0
@export var slow_speed: float = 3.75

@export_group("Sprint Stamina")
@export var sprint_time_limit: float = 10.0
@export var sprint_recovery_time: float = 5.0

@export_group("Input")
@export var double_tap_time: float = 0.25

# State
var sprinting: bool = false
var sprint_elapsed: float = 0.0
var sprint_exhausted: bool = false
var sprint_progress: float = 0.0
var last_key: String = ""
var tap_timer: float = 0.0

func handle_immediate_input(event: InputEvent, left="left", right="right", up="up", down="down") -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var current_key: String = event.as_text()

		if current_key == last_key and tap_timer > 0.0:
			for action in [left, right, up, down]:
				if event.is_action_pressed(action):
					sprinting = true
					break
		else:
			tap_timer = double_tap_time
			last_key = current_key

func handle_physics_process_input(
	input_dir: Vector2,
	is_slow: bool,
	is_sprint: bool,
	vel_xyz: Vector3,
	delta: float,
	transform: Transform3D
)-> Vector3:
	if tap_timer > 0.0:
		tap_timer -= delta
	
	if is_sprint:
		sprinting = true

	#var input_dir: Vector2 = Input.get_vector("left", "right", "up", "down")
	var direction: Vector3 = (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	#var is_slow: bool = Input.is_action_pressed("slow")

	return get_vel_xyz(vel_xyz, direction, delta, is_slow)

func get_vel_xyz(
	vel_xyz: Vector3,
	direction: Vector3,
	delta: float,
	is_slow: bool = false,
) -> Vector3:
	_update_sprint(delta)
	
	var speed: float = (sprint_speed if sprinting else (slow_speed if is_slow else normal_speed))
	
	if direction.length() > 0.01:
		vel_xyz[0] += direction.x * speed
		vel_xyz[2] += direction.z * speed
	else:
		sprinting = false
		#vel_xyz[0] += 0.0
		#vel_zyz[2] += 0.0
	
	return vel_xyz

func _update_sprint(delta: float) -> void:
	if sprinting:
		if sprint_exhausted:
			sprinting = false
		else:
			sprint_elapsed += delta
			if sprint_elapsed >= sprint_time_limit:
				sprint_elapsed = sprint_time_limit
				sprint_exhausted = true
	
	#if sprint_exhausted:
	if not sprinting:
		var recovery_rate: float = sprint_time_limit / sprint_recovery_time
		sprint_elapsed -= recovery_rate * delta
		if sprint_elapsed <= 0.0:
			sprint_elapsed = 0.0
			sprint_exhausted = false
	
	sprint_progress = sprint_elapsed / sprint_time_limit if sprint_time_limit > 0 else 0.0

func reset() -> void:
	sprinting = false
	sprint_elapsed = 0.0
	sprint_exhausted = false

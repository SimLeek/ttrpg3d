extends CharacterBody3D

@export var SPEED: float = 7.5
@export var SPRINT_SPEED: float = 15.0
@export var SLOW_SPEED: float = 3.75
@export var SPRINT_TIME_LIMIT: float = 10.0
@export var SPRINT_RECOVERY_TIME: float = 5.0

@export var DOUBLE_TAP_TIME: float = 0.25
@export var SPEED_DECAY_AIR: float = 0.5
@export var SPEED_DECAY_GROUND: float = 2.5
@export var JUMP_VELOCITY: float = 12.0
@export var TERMINAL_VELOCITY: float = 150.0
@export var STEP_UP: float = 0.2
@export var COYOTE_TIME: float = 0.25
@export var JUMP_CUTOFF_FACTOR: float = 0.5

@export var WALL_SLIDE_SPEED: float = 4.0          # downward speed while sliding on wall
@export var WALL_SLIDE_ANGLE_TOLERANCE: float = 45 # degrees

@onready var default_floor_angle: float = floor_max_angle

@onready var ledge_grabber_node: Node = $LedgeGrabber
@onready var step_cast: ShapeCast3D = $StepCast
@onready var softy: SoftBody3D = $SoftBody3D
@onready var hardy: CollisionShape3D = $CollisionShape3D
@onready var squeezer_node: Node3D = $SqueezerRays

var tap_timer: float = 0.0
var last_key: String = ""
var sprinting: bool = false
var sprint_elapsed: float = 0.0
var sprint_exhausted: bool = false

var coyote_time_left: float = 0.0
var jump_requested: bool = false
var jump_release_requested: bool = false

func _ready() -> void:
	step_cast.add_exception_rid(hardy.shape.get_rid())
	step_cast.add_exception_rid(softy.get_physics_rid())

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var current_key: String = event.as_text()

		if current_key == last_key and tap_timer > 0.0:
			for action in ["left", "right", "up", "down"]:
				if event.is_action_pressed(action):
					sprinting = true
					break
		else:
			tap_timer = DOUBLE_TAP_TIME
			last_key = current_key

	if event.is_action_pressed("jump"):
		jump_requested = true
		jump_release_requested = false  # This and the elif fix a weird bug

	elif event.is_action_released("jump"):
		jump_release_requested = true

func _physics_process(delta: float) -> void:
	if tap_timer > 0.0:
		tap_timer -= delta

	handle_sprint(delta)

	var friction: float = SPEED_DECAY_GROUND
	var should_fall: bool = not is_on_floor() and not (ledge_grabber_node and ledge_grabber_node.is_grabbing_ledge)

	if should_fall:
		velocity += get_gravity() * delta
		friction = SPEED_DECAY_AIR

		if velocity.y < -TERMINAL_VELOCITY:
			velocity.y = -TERMINAL_VELOCITY
	else:
		coyote_time_left = COYOTE_TIME

	if should_fall:
		coyote_time_left = maxf(0.0, coyote_time_left - delta)

	# Jump impulse
	if jump_requested and (not should_fall or coyote_time_left > 0.0):
		velocity.y = JUMP_VELOCITY
		coyote_time_left = 0.0
		jump_requested = false
	elif jump_requested and is_on_wall():
		var wall_normal = get_wall_normal()
		
		var kick_strength = abs(JUMP_VELOCITY) * 1.25
		velocity.x = wall_normal.x * kick_strength
		velocity.z = wall_normal.z * kick_strength
		
		velocity.y = JUMP_VELOCITY * 0.75
		coyote_time_left = 0.0
		jump_requested = false

	# Variable jump height: cut on release while still ascending
	if jump_release_requested and velocity.y > 0.0:
		print("jump release request")
		velocity.y *= JUMP_CUTOFF_FACTOR
		jump_release_requested = false

	# Movement input
	var input_dir: Vector2 = Input.get_vector("left", "right", "up", "down")
	var direction: Vector3 = (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()

	var squeeze_factor: float = 1.0
	if squeezer_node and squeezer_node.has_method("calculate_squeeze_factor"):
		squeeze_factor = squeezer_node.calculate_squeeze_factor(direction)

	var speed: float = SPEED
	if sprinting:
		speed = SPRINT_SPEED
	if Input.is_action_pressed("slow"):
		speed = SLOW_SPEED
	
	# Apply squeeze slowdown (only when there's meaningful forward movement)
	if direction.length() > 0.05:
		speed *= squeeze_factor
	
	handle_wall_slide(direction)

	if Input.is_action_pressed("slide"):
		floor_max_angle = 0.0
	else:
		floor_max_angle = default_floor_angle

	if direction:
		velocity.x = move_toward(velocity.x, direction.x * speed, friction)
		velocity.z = move_toward(velocity.z, direction.z * speed, friction)
	else:
		sprinting = false
		velocity.x = move_toward(velocity.x, 0.0, friction)
		velocity.z = move_toward(velocity.z, 0.0, friction)

	handle_step_up(delta)
	move_and_slide()

func handle_sprint(delta: float) -> void:
	if Input.is_action_pressed("sprint"):
		sprinting = true

	if sprinting:
		if sprint_exhausted:
			sprinting = false
		else:
			sprint_elapsed += delta
			if sprint_elapsed >= SPRINT_TIME_LIMIT:
				sprint_elapsed = SPRINT_TIME_LIMIT
				sprint_exhausted = true

	if sprint_exhausted:
		var recovery_rate: float = SPRINT_TIME_LIMIT / SPRINT_RECOVERY_TIME
		sprint_elapsed -= recovery_rate * delta
		if sprint_elapsed <= 0.0:
			sprint_elapsed = 0.0
			sprint_exhausted = false

func handle_step_up(delta: float) -> void:
	step_cast.global_position.x = global_position.x + velocity.x * delta
	step_cast.global_position.z = global_position.z + velocity.z * delta

	step_cast.force_shapecast_update()

	if is_on_floor() and step_cast.is_colliding() and velocity.y <= 0.0:
		var normal: Vector3 = step_cast.get_collision_normal(0)
		if normal.angle_to(Vector3.UP) < floor_max_angle:
			global_position.y = step_cast.get_collision_point(0).y + STEP_UP
			velocity.y = 0.0

func handle_wall_slide(direction):
	var wall_normal := get_wall_normal() if is_on_wall() else Vector3.ZERO
	if is_on_wall() and direction.length() > 0.1:
		var input_3d = direction.normalized()
		var dot = input_3d.dot(-wall_normal)   # >0 = pressing towards wall
		var cos_tolerance = cos(deg_to_rad(WALL_SLIDE_ANGLE_TOLERANCE))

		if dot > cos_tolerance:
			velocity.y = maxf(velocity.y, -WALL_SLIDE_SPEED)

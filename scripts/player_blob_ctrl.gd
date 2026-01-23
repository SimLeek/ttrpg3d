extends CharacterBody3D

@export var SPEED = 7.5
@export var JUMP_VELOCITY = 12
@export var TERMINAL_VELOCITY = 150.0 # m/s

# Capture the default inspector value at startup
@onready var default_floor_angle = floor_max_angle

func _physics_process(delta: float) -> void:
	# 2. Add the gravity
	if not is_on_floor():
		velocity += get_gravity() * delta
		
		# Clamp the downward velocity to terminal velocity
		# velocity.y is negative when falling
		if velocity.y < -TERMINAL_VELOCITY:
			velocity.y = -TERMINAL_VELOCITY

	# 3. Handle jump
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = JUMP_VELOCITY

	# 4. Handle movement
	var input_dir := Input.get_vector("left", "right", "up", "down")
	
	var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	
	if Input.is_action_pressed("slide"):
		floor_max_angle = 0.0
	else:
		floor_max_angle = default_floor_angle
	
	if direction:
		velocity.x = direction.x * SPEED
		velocity.z = direction.z * SPEED
	else:
		velocity.x = move_toward(velocity.x, 0, SPEED)
		velocity.z = move_toward(velocity.z, 0, SPEED)

	move_and_slide()

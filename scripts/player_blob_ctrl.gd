extends CharacterBody3D

@export var SPEED = 7.5	
@export var SPRINT_SPEED = 15
@export var SLOW_SPEED = 3.75
@export var SPRINT_TIME_LIMIT = 10
@export var SPRINT_RECOVERY_TIME = 5

@export var DOUBLE_TAP_TIME = 0.25
# only sprint creates noise
@export var SPEED_DECAY_AIR = .5
@export var SPEED_DECAY_GROUND = 2.5
@export var JUMP_VELOCITY = 12
@export var TERMINAL_VELOCITY = 150.0 # m/s
@export var step_up = 0.2

# Capture the default inspector value at startup
@onready var default_floor_angle = floor_max_angle

@onready var ledge_grabber_node = $LedgeGrabber
@onready var step_cast = $StepCast
@onready var softy = $SoftBody3D
@onready var hardy = $CollisionShape3D

var tap_timer: float = 0.0
var last_key: String = ""
var double_tapped = false
var sprinting = false
var sprint_elapsed = 0.0
var sprint_exhausted = false

var grounded = false
func get_child_classes() -> Node:
	print("getting child classes")
	for child in get_children():
		if child.get_class() == "LedgeGrabber":
			print("ledge grabber found")
			ledge_grabber_node =  child
	return null # Return null if no child of that class is found

func _ready() -> void:
	step_cast.add_exception_rid(hardy.shape.get_rid())
	step_cast.add_exception_rid(softy.get_physics_rid())
	get_child_classes()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var current_key = event.as_text()

		# Check if same key was pressed within the window
		if current_key == last_key and tap_timer > 0:
			double_tapped = true
			print("double tapped %s" % [current_key])
			#if current_key in ["left", "right", "up", "down"]:
			for action in ["left", "right", "up", "down"]:
				if event.is_action_pressed(action):
					print("sprinting")
					sprinting = true
					break
		else:
			double_tapped = false
			tap_timer = DOUBLE_TAP_TIME
			last_key = current_key

func _physics_process(delta: float) -> void:
	if tap_timer > 0:
		tap_timer -= delta
	if Input.is_action_pressed("sprint"):
		sprinting = true
	if sprinting:
		if sprint_exhausted:
			sprinting = false
		else:
			sprint_elapsed += delta
			print(sprint_elapsed)
			if sprint_elapsed>=SPRINT_TIME_LIMIT:
				print("exhausted")
				sprint_elapsed = SPRINT_TIME_LIMIT
				sprint_exhausted = true
	if sprint_exhausted:
		sprint_elapsed -= SPRINT_TIME_LIMIT/SPRINT_RECOVERY_TIME * delta
		if sprint_elapsed<=0.0:
			sprint_elapsed = 0.0
			sprint_exhausted = false
	# 2. Add the gravity
	var damping = 0
	var should_fall = not is_on_floor() and not (ledge_grabber_node != null and ledge_grabber_node.is_grabbing_ledge)
	if should_fall:
		velocity += get_gravity() * delta
		
		damping = SPEED_DECAY_AIR
		# Clamp the downward velocity to terminal velocity
		# velocity.y is negative when falling
		if velocity.y < -TERMINAL_VELOCITY:
			velocity.y = -TERMINAL_VELOCITY
	else:
		damping = SPEED_DECAY_GROUND

	# 3. Handle jump
	if Input.is_action_pressed("jump") and not should_fall:
		velocity.y = JUMP_VELOCITY

	# 4. Handle movement
	var input_dir := Input.get_vector("left", "right", "up", "down")
	
	var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	
	var speed = SPEED
	if sprinting:
		print("sprint2")
		speed = SPRINT_SPEED
	if Input.is_action_pressed("slow"):
		speed = SLOW_SPEED
		print("slow")
	
	if Input.is_action_pressed("slide"):
		floor_max_angle = 0.0
	else:
		floor_max_angle = default_floor_angle
	
	if direction:
		velocity.x = move_toward(velocity.x, direction.x * speed, damping)
		velocity.z = move_toward(velocity.z, direction.z * speed, damping)
	else:
		sprinting = false
		velocity.x = move_toward(velocity.x, 0, damping)
		velocity.z = move_toward(velocity.z, 0, damping)

	move(delta)

func move(delta):
	step_cast.global_position.x = global_position.x + velocity.x * delta
	step_cast.global_position.z = global_position.z + velocity.z * delta
	
	step_cast.force_shapecast_update()
	
	if is_on_floor() and step_cast.is_colliding() && velocity.y<=0 && step_cast.get_collision_normal(0).angle_to(Vector3.UP) < floor_max_angle:
		print("stepping up")
		global_position.y = step_cast.get_collision_point(0).y + step_up
		velocity.y = 0.0
		grounded = true
	else:
		grounded = false
	move_and_slide()
		
func is_grounded():
	return grounded || is_on_floor()

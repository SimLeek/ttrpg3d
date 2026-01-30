extends CharacterBody3D

@export var movement: MovementResource

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
@onready var health_node: Node3D = $Health
@onready var hud_node: CanvasLayer = $HUD
@onready var left_hand: HandController = $LeftHandMesh
@onready var right_hand: HandController = $RightHandMesh
@onready var pause_menu_node: Node = $PauseMenu

var can_be_seen: bool = true  # For enemy AI detection

var tap_timer: float = 0.0

var coyote_time_left: float = 0.0
var jump_requested: bool = false
var jump_release_requested: bool = false

func _ready() -> void:
	# Initialize resources if not assigned
	if not movement: movement = MovementResource.new()
	
	step_cast.add_exception_rid(hardy.shape.get_rid())
	step_cast.add_exception_rid(softy.get_physics_rid())
	
	if health_node and hud_node:
		health_node.health_changed.connect(hud_node.update_health_ui)

func _input(event: InputEvent) -> void:
	movement.handle_immediate_input(event)

	if event.is_action_pressed("jump"):
		jump_requested = true
		jump_release_requested = false  # This and the elif fix a weird bug

	elif event.is_action_released("jump"):
		jump_release_requested = true
		
	if event.is_action_pressed("primary_item_click"):
		print("prim")
		_handle_primary_hand_input(1.0)
		
	# Right click = right hand (or non-primary if has item)
	elif event.is_action_pressed("secondary_item_click"):
		print("sec")
		_handle_non_primary_hand_input(1.0)
	

func _physics_process(delta: float) -> void:
	
	var v_xyz = [0.0, 0.0, 0.0]
	v_xyz = movement.handle_physics_process_input(v_xyz, delta, transform)

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
	
	# Apply squeeze slowdown (only when there's meaningful forward movement)
	if direction.length() > 0.05:
		v_xyz[0] *= squeeze_factor
		v_xyz[2] *= squeeze_factor
		
	# ITEM USE SECTION
	var right_trigger = Input.get_action_strength("primary_item_trigger")  # Primary hand
	var left_trigger = Input.get_action_strength("secondary_item_trigger")    # Non-primary hand
	
	if right_trigger > 0.0:
		_handle_primary_hand_input(right_trigger)
	
	if left_trigger > 0.0:
		_handle_non_primary_hand_input(left_trigger)
	
	handle_wall_slide(direction)

	if Input.is_action_pressed("slide"):
		floor_max_angle = 0.0
	else:
		floor_max_angle = default_floor_angle
	# END ITEM USE SECTION

	if direction:
		velocity.x = move_toward(velocity.x, v_xyz[0], friction)
		velocity.z = move_toward(velocity.z, v_xyz[2], friction)
	else:
		velocity.x = move_toward(velocity.x, 0.0, friction)
		velocity.z = move_toward(velocity.z, 0.0, friction)

	handle_step_up(delta)
	move_and_slide()

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

func _handle_primary_hand_input(pressure: float) -> void:
	# Use whichever hand is marked as primary
	if right_hand.primary:
		right_hand.use_hand(pressure)
	elif left_hand.primary:
		left_hand.use_hand(pressure)
	else:
		push_warning("character should have a primary hand")
		right_hand.use_hand(pressure)

func _handle_non_primary_hand_input(pressure: float) -> void:
	# Use whichever hand is NOT primary
	if right_hand.primary:
		left_hand.use_hand(pressure)
	elif left_hand.primary:
		right_hand.use_hand(pressure)
	else:
		push_warning("character should have at least one non-primary hand")
		left_hand.use_hand(pressure)

func die() -> void:
	print("Player died. Reloading...")
	get_tree().call_deferred("reload_current_scene")

# Not used in this file. Used by other scripts.
func handle_pause_menu_visibility(is_paused: bool) -> void:
	# Hide/show items and HUDs when pause menu toggles
	if left_hand and left_hand.held_item:
		left_hand.held_item.handle_pause(not is_paused)
	if right_hand and right_hand.held_item:
		right_hand.held_item.handle_pause(not is_paused)
	
	# Hide main HUD during pause
	if hud_node:
		hud_node.visible = not is_paused

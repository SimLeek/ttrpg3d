extends CharacterBody3D

@export var movement: MovementResource
@export var basic_jump: BasicJumpResource
@export var wall_jump: WallJumpResource

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

func _ready() -> void:
	# Initialize resources if not assigned
	if not movement: movement = MovementResource.new()
	if not basic_jump: basic_jump = BasicJumpResource.new()
	if not wall_jump: wall_jump = WallJumpResource.new()

	step_cast.add_exception_rid(hardy.shape.get_rid())
	step_cast.add_exception_rid(softy.get_physics_rid())
	
	if health_node and hud_node:
		health_node.health_changed.connect(hud_node.update_health_ui)

func _input(event: InputEvent) -> void:
	movement.handle_immediate_input(event)
	basic_jump.handle_immediate_input(event)
	#wall_jump.handle_immediate_input(event)
		
	if event.is_action_pressed("primary_item_click"):
		print("prim")
		_handle_primary_hand_input(1.0)
		
	# Right click = right hand (or non-primary if has item)
	elif event.is_action_pressed("secondary_item_click"):
		print("sec")
		_handle_non_primary_hand_input(1.0)
	

func _physics_process(delta: float) -> void:
	
	var sv_xyz = velocity  # immediate set velocity vector
	var gv_xyz = Vector3.ZERO  # goal velocity vector
	
	gv_xyz = movement.handle_physics_process_input(gv_xyz, delta, transform)

	var friction: float = SPEED_DECAY_GROUND
	var should_fall: bool = not is_on_floor() and not (ledge_grabber_node and ledge_grabber_node.is_grabbing_ledge)

	if should_fall:
		sv_xyz += get_gravity() * delta
		friction = SPEED_DECAY_AIR

		if sv_xyz.y < -TERMINAL_VELOCITY:
			sv_xyz.y = -TERMINAL_VELOCITY

	basic_jump.update_coyote_time(not should_fall, delta)
	# Messy jump stuff. Maybe wall jump should extend basic jump. Idk.
	sv_xyz = basic_jump.apply_jump(sv_xyz, not should_fall)
	wall_jump.jump_requested = basic_jump.jump_requested
	sv_xyz = wall_jump.apply_jump(sv_xyz, self, not should_fall)
	basic_jump.jump_requested = wall_jump.jump_requested

	# Movement input
	var input_dir: Vector2 = Input.get_vector("left", "right", "up", "down")
	var direction: Vector3 = (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()

	var squeeze_factor: float = 1.0
	if squeezer_node and squeezer_node.has_method("calculate_squeeze_factor"):
		squeeze_factor = squeezer_node.calculate_squeeze_factor(direction)
	
	# Apply squeeze slowdown (only when there's meaningful forward movement)
	if direction.length() > 0.05:
		gv_xyz[0] *= squeeze_factor
		gv_xyz[2] *= squeeze_factor
		
	# ITEM USE SECTION
	var right_trigger = Input.get_action_strength("primary_item_trigger")  # Primary hand
	var left_trigger = Input.get_action_strength("secondary_item_trigger")    # Non-primary hand
	
	if right_trigger > 0.0:
		_handle_primary_hand_input(right_trigger)
	
	if left_trigger > 0.0:
		_handle_non_primary_hand_input(left_trigger)
	
	sv_xyz = wall_jump.handle_wall_slide(sv_xyz, self, direction)

	if Input.is_action_pressed("slide"):
		floor_max_angle = 0.0
	else:
		floor_max_angle = default_floor_angle
	# END ITEM USE SECTION

	velocity = sv_xyz
	if direction:
		velocity.x = move_toward(velocity.x, gv_xyz[0], friction)
		velocity.z = move_toward(velocity.z, gv_xyz[2], friction)
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

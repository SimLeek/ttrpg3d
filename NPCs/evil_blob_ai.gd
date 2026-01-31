extends CharacterBody3D
class_name BlobAICharacter

# the AI is a...
@export var mover: MoverResource
@export var basic_jumper: BasicJumperResource
@export var faller: FallerResource
@export var two_handed: TwoHandedResource
@export var stair_stepper: StairStepperResource

@export var blob_ai: BlobAIResource

@export var SPEED_DECAY_AIR: float = 0.5
@export var SPEED_DECAY_GROUND: float = 2.5
@export var rotation_smooth_speed: float = 4.0  # rad/s, tune for turn sharpness vs smoothness

@export var debug_ai: bool = false

@onready var default_floor_angle: float = floor_max_angle

# the AI has a ...
@onready var softy: SoftBody3D = $SoftBody3D
@onready var hardy: CollisionShape3D = $CollisionShape3D
@onready var squeezer_node: Node3D = $SqueezerRays
@onready var health_node: Node3D = $Health
@onready var vision_cone: MeshInstance3D = $VisionCone  # Child MeshInstance3D
@onready var near_vision_cone: MeshInstance3D = $NearVisionCone  # Child MeshInstance3D

#var can_be_seen: bool = true  # For enemy AI detection
var players

func _ready() -> void:
	# Initialize resources if not assigned
	if not mover: mover = MoverResource.new()
	if not basic_jumper: basic_jumper = BasicJumperResource.new()
	if not faller: faller = FallerResource.new()
	if not two_handed: two_handed = TwoHandedResource.new()
	two_handed.left_hand = $LeftHandMesh
	two_handed.right_hand = $RightHandMesh
	if not stair_stepper: stair_stepper = StairStepperResource.new()
	stair_stepper.step_cast = $StepCast
	stair_stepper.step_cast.add_exception_rid(hardy.shape.get_rid())
	stair_stepper.step_cast.add_exception_rid(softy.get_physics_rid())
	if not blob_ai: blob_ai = BlobAIResource.new()
	blob_ai.set_spawn_position(global_position)  # for restricting wandering
	blob_ai.setup_detection_systems(self)
	#blob_ai.update_vision_cone_display(vision_cone)
	

	players = get_tree().get_nodes_in_group("player")
	if players.size()<=0:
		return
	blob_ai.update_vision_cone_display(
		vision_cone, 
		self, 
		players[0],
		3.0,   # Width in meters/units
		3.0   # Height in meters/units
	)
	
	blob_ai.set_static_vision_cone_display(
		near_vision_cone, 
		self, 
		2.0
	)
		
	# saving this as commented for hp above head maybe
	#if health_node:
	#	health_node.health_changed.connect(hud_node.update_health_ui)

func jump():
	print("ai jump")
	basic_jumper.request_jump()
	
func attack(look_dir:Vector3):
	#look_at(look_dir, Vector3.UP)
	# just a simple double bonk for now
	print("AI is attacking")
	two_handed.handle_primary_hand_input(1.0)
	two_handed.handle_non_primary_hand_input(1.0)

func _physics_process(delta: float) -> void:
	if players.size()<=0:
		return
	var move_look = blob_ai.ai_think(delta, self, players[0])
	var move_dir = move_look[0]
	var look_dir = move_look[1]
		
	if look_dir.length() > 0.02:
		# Smooth look-at style
		#var target_pos = global_position + look_dir
		#look_at(target_pos, Vector3.UP, true)  #use model front is true
		var target_basis = Basis.looking_at(-look_dir.normalized(), Vector3.UP)
		global_transform.basis = global_transform.basis.slerp(target_basis, delta * rotation_smooth_speed)
	
	var sv_xyz = velocity  # immediate set velocity vector
	var gv_xyz = Vector3.ZERO  # goal velocity vector
	
	var local_move_dir = global_transform.basis.inverse() * -move_dir
	var input_dir: Vector2 = Vector2(local_move_dir.x, local_move_dir.z)
	var is_slow: bool = blob_ai.current_state in [blob_ai.AIState.WANDER]
	var is_sprint: bool = blob_ai.current_state == blob_ai.AIState.CHASE
	gv_xyz = mover.handle_physics_process_input(input_dir, is_slow,is_sprint, gv_xyz, delta, transform)

	var friction: float = SPEED_DECAY_GROUND
	var should_fall: bool = not is_on_floor()

	sv_xyz = faller.apply_gravity(sv_xyz, self, delta)

	basic_jumper.update_coyote_time(not should_fall, delta)
	# Messy jump stuff. Maybe wall jump should extend basic jump. Idk.
	sv_xyz = basic_jumper.apply_jump(sv_xyz, not should_fall)

	# Movement input
	var direction: Vector3 = (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()

	var squeeze_factor: float = 1.0
	if squeezer_node and squeezer_node.has_method("calculate_squeeze_factor"):
		squeeze_factor = squeezer_node.calculate_squeeze_factor(direction)
	
	# Apply squeeze slowdown (only when there's meaningful forward movement)
	if direction.length() > 0.05:
		gv_xyz[0] *= squeeze_factor
		gv_xyz[2] *= squeeze_factor
		
	# ITEM USE SECTION
	#two_handed.handle_physics_process_input()
	
	if Input.is_action_pressed("slide"):
		floor_max_angle = 0.0
	else:
		floor_max_angle = default_floor_angle
	# END ITEM USE SECTION
	
	sv_xyz = stair_stepper.handle_step_up(delta, self, sv_xyz)

	velocity = sv_xyz
	if direction:
		velocity.x = move_toward(velocity.x, gv_xyz[0], friction)
		velocity.z = move_toward(velocity.z, gv_xyz[2], friction)
	else:
		velocity.x = move_toward(velocity.x, 0.0, friction)
		velocity.z = move_toward(velocity.z, 0.0, friction)

	move_and_slide()
	
	# honestly these should probably both be in the _process function, which is for displaying
	# since these are display functions
	if debug_ai:
		blob_ai.debug_visualize(self, players[0] if players and not players.is_empty() else null)
		
	blob_ai.update_vision_cone_display(
		vision_cone, 
		self, 
		players[0],
		3.0,   # Width in meters/units
		3.0   # Height in meters/units
	)


func die() -> void:
	print("Enemy died. Deleting...")
	queue_free()

extends CharacterBody3D

# the player is a...
@export var mover: MoverResource
@export var basic_jumper: BasicJumperResource
@export var wall_jumper: WallJumperResource
@export var faller: FallerResource
@export var two_handed: TwoHandedResource
@export var stair_stepper: StairStepperResource

@export var SPEED_DECAY_AIR: float = 0.5
@export var SPEED_DECAY_GROUND: float = 2.5

@onready var default_floor_angle: float = floor_max_angle

# the player has a ...

# VoxelLODTerrain is faster, but is has collision glitches and voxel tool glitches
# Under the same testing, standard VoxelTerrain was much more reliable
@export var voxel_terrain: VoxelTerrain  
@onready var ledge_grabber_node: Node = $LedgeGrabber
@onready var softy: SoftBody3D = $SoftBody3D
@onready var hardy: CollisionShape3D = $CollisionShape3D
@onready var squeezer_node: Node3D = $SqueezerRays
@onready var health_node: Node3D = $Health
@onready var hud_node: CanvasLayer = $HUD
#@onready var left_hand: HandController = $LeftHandMesh
#@onready var right_hand: HandController = $RightHandMesh
@onready var pause_menu_node: Node = $PauseMenu

var can_be_seen: bool = true  # For enemy AI detection
var vt: VoxelToolTerrain
#var stuck_timer: float = 0.0
var last_safe_pos: Vector3

const check_time:float = 1.0
var check_timer:float = 0.0

func _ready() -> void:
	# Initialize resources if not assigned
	if not mover: mover = MoverResource.new()
	if not basic_jumper: basic_jumper = BasicJumperResource.new()
	if not wall_jumper: wall_jumper = WallJumperResource.new()
	if not faller: faller = FallerResource.new()
	if not two_handed: two_handed = TwoHandedResource.new()
	two_handed.left_hand = $LeftHandMesh
	two_handed.right_hand = $RightHandMesh
	if not stair_stepper: stair_stepper = StairStepperResource.new()
	stair_stepper.step_cast = $StepCast
	stair_stepper.step_cast.add_exception_rid(hardy.shape.get_rid())
	stair_stepper.step_cast.add_exception_rid(softy.get_physics_rid())
	
	if health_node and hud_node:
		health_node.health_changed.connect(hud_node.update_health_ui)
		
	if voxel_terrain:
		vt = voxel_terrain.get_voxel_tool()
		vt.channel = VoxelBuffer.CHANNEL_TYPE
	if voxel_terrain:
		var true_position = global_position-voxel_terrain.global_position
		last_safe_pos = true_position

func _input(event: InputEvent) -> void:
	mover.handle_immediate_input(event)
	basic_jumper.handle_immediate_input(event)
	#wall_jump.handle_immediate_input(event)
	two_handed.handle_immediate_input(event)

func _physics_process(delta: float) -> void:
	var sv_xyz = velocity  # immediate set velocity vector
	var gv_xyz = Vector3.ZERO  # goal velocity vector
	
	var input_dir: Vector2 = Input.get_vector("left", "right", "up", "down")
	var is_slow: bool = Input.is_action_pressed("slow")
	var is_sprint: bool = Input.is_action_pressed("sprint")
	gv_xyz = mover.handle_physics_process_input(input_dir, is_slow,is_sprint, gv_xyz, delta, transform)

	var friction: float = SPEED_DECAY_GROUND
	var should_fall: bool = not is_on_floor() and not (ledge_grabber_node and ledge_grabber_node.is_grabbing_ledge)
	if should_fall:
		friction = SPEED_DECAY_AIR

	sv_xyz = faller.apply_gravity(sv_xyz, self, delta)

	basic_jumper.update_coyote_time(not should_fall, delta)
	# Messy jump stuff. Maybe wall jump should extend basic jump. Idk.
	sv_xyz = basic_jumper.apply_jump(sv_xyz, not should_fall)
	wall_jumper.jump_requested = basic_jumper.jump_requested
	sv_xyz = wall_jumper.apply_jump(sv_xyz, self, not should_fall)
	basic_jumper.jump_requested = wall_jumper.jump_requested

	# Movement input
	input_dir = Input.get_vector("left", "right", "up", "down")
	var direction: Vector3 = (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()

	var squeeze_factor: float = 1.0
	if squeezer_node and squeezer_node.has_method("calculate_squeeze_factor"):
		squeeze_factor = squeezer_node.calculate_squeeze_factor(direction)
	
	# Apply squeeze slowdown (only when there's meaningful forward movement)
	if direction.length() > 0.05:
		
		gv_xyz[0] *= squeeze_factor
		gv_xyz[2] *= squeeze_factor
	# ITEM USE SECTION
	two_handed.handle_physics_process_input()
	
	sv_xyz = wall_jumper.handle_wall_slide(sv_xyz, self, direction)

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
		
	if hud_node:
		hud_node.update_stamina_ui(mover.sprint_time_limit-mover.sprint_elapsed, mover.sprint_time_limit)

	move_and_slide()
	
	var is_stuck = false
	check_timer += delta
	# the voxels are threaded, so do this rarely
	if vt and check_timer>= check_time:
		var true_position = global_position-voxel_terrain.global_position
		#var check_pos = global_position
		#var check_pos = global_transform.origin
		var vox_num = vt.get_voxel(Vector3i(true_position.round()))
		var vox_num2 = vt.get_voxel(Vector3i(true_position.round()+Vector3.UP))
		var vox_num3 = vt.get_voxel(Vector3i(true_position.round()+Vector3.RIGHT))
		var vox_num4 = vt.get_voxel(Vector3i(true_position.round()-Vector3.RIGHT))

		#var hit = vt.raycast(check_pos, Vector3.UP, 10)
		#print(hit)
		if vox_num>=1 and vox_num2>=1 and vox_num3>=1 and vox_num4>=1: # list of solid block types here
			print(Vector3i(true_position.round()))
			print("under voxel")
			#print(hit.position)
			#print(vt.get_voxel(hit.position))
			print(vt.get_voxel(Vector3i(true_position.round())))
			print(vt.get_voxel(true_position))
			is_stuck = true
		
		check_timer = 0.0
			
	if is_stuck:
		print("oh no I'm stuck")
		global_position = last_safe_pos+voxel_terrain.global_position
		velocity = Vector3.ZERO
	elif is_on_floor():
		last_safe_pos = global_position-voxel_terrain.global_position

func die() -> void:
	print("Player died. Reloading...")
	get_tree().call_deferred("reload_current_scene")

# Not used in this file. Used by other scripts.
func handle_pause_menu_visibility(is_paused: bool) -> void:
	# Hide/show items and HUDs when pause menu toggles
	if two_handed.left_hand and two_handed.left_hand.held_item:
		two_handed.left_hand.held_item.handle_pause(not is_paused)
	if two_handed.right_hand and two_handed.right_hand.held_item:
		two_handed.right_hand.held_item.handle_pause(not is_paused)
	
	# Hide main HUD during pause
	if hud_node:
		hud_node.visible = not is_paused

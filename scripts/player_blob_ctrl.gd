extends CharacterBody3D

## Display name for the turn tracker ("<name>'s turn" / highlighted "Your
## Turn" when this is the local player's combatant entry).
@export var character_name: String = "Player"

# the player is a...
@export var mover: MoverResource
@export var basic_jumper: BasicJumperResource
@export var wall_jumper: WallJumperResource
@export var faller: FallerResource
@export var two_handed: TwoHandedResource
@export var stair_stepper: StairStepperResource

@export var SPEED_DECAY_AIR: float = 0.5
@export var SPEED_DECAY_GROUND: float = 2.5

## DM-mode movement, both toggled by double-tapping within
## DOUBLE_TAP_WINDOW_MS. Two separate things: flying (double-jump) just
## disables gravity/normal jump for direct vertical control; intangible
## (double-fly_descend, i.e. double-Ctrl) separately disables collision
## entirely so you can pass through terrain. Either can be on without the
## other, though intangible without flying would just free-fall through
## everything with no way to stop, so intangible also uses the same direct
## vertical control flying does.
@export var FLY_SPEED: float = 6.0
const DOUBLE_TAP_WINDOW_MS := 350
var is_flying: bool = false
var is_intangible: bool = false
var _last_jump_tap_time: int = -100000
var _last_descend_tap_time: int = -100000

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
@onready var spring_arm: SpringArm3D = $SpringArm3D

#@onready var left_hand: HandController = $LeftHandMesh
#@onready var right_hand: HandController = $RightHandMesh
@onready var pause_menu_node: Node = $PauseMenu

var can_be_seen: bool = true  # For enemy AI detection
var vt: VoxelTool
#var stuck_timer: float = 0.0
var last_safe_pos: Vector3

const check_time:float = 1.0
var check_timer:float = 0.0
var stuck_count:int = 0
var _is_on_voxel_floor: bool = false
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
		#voxel_terrain.full_load_mode_enabled = true
	if voxel_terrain:
		var true_position = global_position-voxel_terrain.global_position
		last_safe_pos = true_position

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("jump") and not event.is_echo():
		var now := Time.get_ticks_msec()
		if now - _last_jump_tap_time <= DOUBLE_TAP_WINDOW_MS:
			is_flying = not is_flying
			_last_jump_tap_time = -100000  # don't let a 3rd tap immediately re-toggle
			if hud_node: hud_node.update_flight_status(is_flying, is_intangible)
		else:
			_last_jump_tap_time = now

	if event.is_action_pressed("fly_descend") and not event.is_echo():
		var now2 := Time.get_ticks_msec()
		if now2 - _last_descend_tap_time <= DOUBLE_TAP_WINDOW_MS:
			is_intangible = not is_intangible
			_last_descend_tap_time = -100000
			if hud_node: hud_node.update_flight_status(is_flying, is_intangible)
		else:
			_last_descend_tap_time = now2

	mover.handle_immediate_input(event)
	basic_jumper.handle_immediate_input(event)
	#wall_jump.handle_immediate_input(event)
	two_handed.handle_immediate_input(event)

func _physics_process(delta: float) -> void:
	var sv_xyz = velocity  # immediate set velocity vector
	var gv_xyz = Vector3.ZERO  # goal velocity vector
	
	# Mouse released means some UI has the player's attention (typing a
	# world/combatant name, a dev console command, etc.) -- same gate
	# two_handed_resource.gd already uses for item-use input, extended to
	# movement. This only matters for UI that *doesn't* also pause the
	# tree (the dev console, deliberately, so physics/chunk-loading keep
	# running while you type) -- WASD was otherwise still moving the
	# player out from under you while a command was mid-type.
	var input_dir: Vector2 = Vector2.ZERO
	var is_slow: bool = false
	var is_sprint: bool = false
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		input_dir = Input.get_vector("left", "right", "up", "down")
		is_slow = Input.is_action_pressed("slow")
		is_sprint = Input.is_action_pressed("sprint")
	gv_xyz = mover.handle_physics_process_input(input_dir, is_slow,is_sprint, gv_xyz, delta, transform)

	var friction: float = SPEED_DECAY_GROUND
	var should_fall: bool = not (is_on_floor() or _is_on_voxel_floor) and not (ledge_grabber_node and ledge_grabber_node.is_grabbing_ledge)
	if should_fall:
		friction = SPEED_DECAY_AIR

	var no_gravity := is_flying or is_intangible
	if no_gravity:
		friction = SPEED_DECAY_AIR
		var vertical := 0.0
		if Input.is_action_pressed("jump"):
			vertical += FLY_SPEED
		if Input.is_action_pressed("fly_descend"):
			vertical -= FLY_SPEED
		sv_xyz.y = move_toward(sv_xyz.y, vertical, FLY_SPEED * 4.0 * delta)
	else:
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

	if not no_gravity:
		sv_xyz = wall_jumper.handle_wall_slide(sv_xyz, self, direction)

	if Input.is_action_pressed("slide"):
		floor_max_angle = 0.0
	else:
		floor_max_angle = default_floor_angle
	# END ITEM USE SECTION

	if not no_gravity:
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

	if is_intangible:
		# No collision at all -- pass straight through terrain.
		global_position += velocity * delta
		return

	_handle_voxel_collisions(delta)
	var true_position = global_position-voxel_terrain.global_position
	var current_voxel = Vector3i((global_position).floor())
	# todo: this code SHOULD be in here, but we may need to override automatic_loading_enabled. Right now it blocks air.
	#if not vt.is_area_editable(AABB(Vector3(current_voxel), Vector3.ONE)) and stuck_count==0:
	#	global_position = last_safe_pos + voxel_terrain.global_position
	#	velocity = Vector3.ZERO
	#	stuck_count +=1
	#else:
	var stuck_hit = vt.raycast(global_position, Vector3.UP, 0.01)
	if stuck_hit and stuck_count==0:
		global_position = last_safe_pos + voxel_terrain.global_position
		velocity = Vector3.ZERO
		stuck_count +=1
	elif is_on_floor() or _is_on_voxel_floor:
		last_safe_pos = true_position
		stuck_count = 0

	move_and_slide()

func _get_unloaded_normal(current_pos: Vector3, target_voxel_pos: Vector3i) -> Vector3:
	# The AABB of the unloaded voxel in world space
	var voxel_min = Vector3(target_voxel_pos)
	var voxel_max = voxel_min + Vector3.ONE
	var center = voxel_min + Vector3(0.5, 0.5, 0.5)
	
	# Vector from voxel center to the player
	var to_player = current_pos - center
	
	# Find which axis the player is most "on top of" relative to the voxel
	# This gives us the cardinal normal of the face we hit
	var abs_to_player = to_player.abs()
	if abs_to_player.x > abs_to_player.y and abs_to_player.x > abs_to_player.z:
		return Vector3(sign(to_player.x), 0, 0)
	elif abs_to_player.y > abs_to_player.z:
		return Vector3(0, sign(to_player.y), 0)
	else:
		return Vector3(0, 0, sign(to_player.z))

func _handle_voxel_collisions(delta: float) -> void:
	if not vt: return
	
	_is_on_voxel_floor = false
	
	#var ray_dir = velocity.normalized()
	#var ray_dist = velocity.length() * delta + 0.01 # collision margin
	var world_dir = global_transform.basis * velocity.normalized()
	var ray_dist = (velocity.length() * delta) + 0.01 # Predict next frame + margin
	#var true_position = global_position-voxel_terrain.global_position
	
	# todo: this should work, but it doesn't
	#var target_pos = global_position + (world_dir * ray_dist)
	#var target_voxel_pos = Vector3i(target_pos.floor())
	#if not vt.is_area_editable(AABB(Vector3(target_voxel_pos), Vector3.ONE)):
	#	var boundary_normal = _get_unloaded_normal(true_position, target_voxel_pos)
	#	velocity = velocity.slide(boundary_normal)
	#	return
	var hit = vt.raycast(global_position, world_dir, ray_dist)
	if hit:
		if hit.normal.angle_to(Vector3.UP) <= floor_max_angle:
			_is_on_voxel_floor = true
		velocity = velocity.slide(hit.normal)
	if not _is_on_voxel_floor:
		var down_hit = vt.raycast(global_position, Vector3.DOWN, 0.1) # Short margin
		if down_hit:
			if down_hit.normal.angle_to(Vector3.UP) <= floor_max_angle:
				_is_on_voxel_floor = true

func die() -> void:
	print("Player died. Reloading...")
	# reload_current_scene() re-instantiates the scene file's own baked-in
	# default terrain (Hilly World), dropping whatever world the player
	# had actually switched to -- WorldManager tracks that separately and
	# reloads back into it instead.
	WorldManager.call_deferred("respawn_in_current_world")

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

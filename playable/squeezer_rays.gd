@tool
extends Node3D

@export var left_ray_length: float = 0.52
@export var top_ray_length: float = 0.415
@export var right_ray_length: float = 0.52

@export var blockage_max: float = 0.5

@export var ray_angle_deg: float = 90	
@export var min_speed_factor: float = 0.2
@export var blocked_threshold: float = 0.92  # normalized dist < this → counts as blocked
@export var debug_color: Color = Color(1, 1, 0, 0.6)  # semi-transparent yellow
@export var debug_draw: bool = true
@export var additional_exclusions: Array[Node3D] = []  # drag nodes to ignore (e.g. other softbodies)

var character: CharacterBody3D
var exclude: Array[RID] = []
var space_state: PhysicsDirectSpaceState3D

func _ready() -> void:
	character = get_parent() as CharacterBody3D
	if not character:
		push_error("SqueezerRays must be child of CharacterBody3D")
		return
	
	exclude = [character.get_rid()]
	for child in character.get_children():
		if child is SoftBody3D:
			exclude.append(child.get_physics_rid())
	for node in additional_exclusions:
		if node:
			exclude.append(node.get_rid())
	
	if not Engine.is_editor_hint():
		space_state = get_world_3d().direct_space_state

func _process(_delta: float) -> void:
	if Engine.is_editor_hint() and debug_draw:
		_draw_debug_rays()

func _draw_debug_rays() -> void:
	var origin := global_position
	var forward := -global_basis.z.normalized()
	var dirs := [
		Vector3.UP.rotated(forward, deg_to_rad(-ray_angle_deg)),  # left
		Vector3.UP,                                                  # center
		Vector3.UP.rotated(forward, deg_to_rad(ray_angle_deg)),   # right
	]
	
	#for d in dirs:
	var start := origin
	var end :Vector3= origin + dirs[0] * left_ray_length
	DebugDraw3D.draw_line(start, end, debug_color)
	start = origin
	end = origin + dirs[1] * top_ray_length
	DebugDraw3D.draw_line(start, end, debug_color)
	start = origin
	end = origin + dirs[2] * right_ray_length
	DebugDraw3D.draw_line(start, end, debug_color)

func calculate_squeeze_factor(intended_direction: Vector3) -> float:
	if not space_state or not character:
		return 1.0
		
	# If player isn't trying to move, no squeeze check needed
	if intended_direction.length_squared() < 0.001:
		return 1.0
	
	var move_dir := intended_direction.normalized()
	var origin := global_position
	var dirs := [
		Vector3.UP.rotated(move_dir, deg_to_rad(-ray_angle_deg)),
		Vector3.UP,
		Vector3.UP.rotated(move_dir, deg_to_rad(ray_angle_deg)),
	]
	
	var hits: Array[float] = []  # 0..1 normalized distance (1 = no hit/full length)
	
	var ray_length:float
	var i=0
	for d in dirs:
		if i==0:
			ray_length = left_ray_length
		elif i==1:
			ray_length = top_ray_length
		else :
			ray_length = right_ray_length

		var query := PhysicsRayQueryParameters3D.create(origin, origin + d * ray_length)
		query.exclude = exclude
		query.collide_with_areas = false
		query.collide_with_bodies = true
		
		var result := space_state.intersect_ray(query)
		if result.is_empty():
			hits.append(1.0)
		else:
			var dist :float= (result.position - origin).length()
			hits.append(dist / ray_length)
		i+=1
	
	# Count blocked rays and average blockage
	var blocked_count := 0
	var total_blockage := 0.0
		
	for h in hits:
		if h < blocked_threshold:
			blocked_count += 1
			total_blockage += (1.0 - h)
	
	if blocked_count >= 2:
		var avg_blockage := total_blockage / blocked_count
		var scaled_blockage :float= clamp(avg_blockage/blockage_max,0,1)
		var slowdown := 1.0 - (scaled_blockage * (1.0 - min_speed_factor))
		return clampf(slowdown, min_speed_factor, 1.0)
	
	return 1.0

extends SoftBody3D

@export_group("Constraint Settings")
@export var stiffness: float = 100.0
@export var max_force: float = 100.0 
@export var max_distance: float = 0.2      # Start of the Tan/Buffer zone
@export var max_distance_hard: float = 1.2 # The "No-Go" zone
@export var vertex_mass_multiplier: float = 0.5
@export var velocity_match_multiplier: float = 0.2 # Smaller version of the mass multiplier
@export var follow_node: Node3D

@export_group("Rotation Offsets")
@export_range(-180, 180) var offset_pitch: float = 0.0
@export_range(-180, 180) var offset_yaw: float = 0.0
@export_range(-180, 180) var offset_roll: float = 0.0

const epsilon = 0.001

var original_local_positions: PackedVector3Array
var last_positions: PackedVector3Array
var vertex_count: int = 0
var vertex_mass: float = 0.0

# Track parent movement
var last_parent_pos: Vector3
var parent_velocity: Vector3

var store_collision_layer
var store_collision_mask

var offset_basis

func _ready() -> void:	
	store_collision_layer = collision_layer
	store_collision_mask = collision_mask
	if mesh:
		var surface_tool = SurfaceTool.new()
		surface_tool.create_from(mesh, 0)
		var mesh_data = surface_tool.commit_to_arrays()
		original_local_positions = mesh_data[Mesh.ARRAY_VERTEX]
		vertex_count = original_local_positions.size()
		last_positions = PackedVector3Array()
		last_positions.resize(vertex_count)
		
		vertex_mass = total_mass / float(vertex_count)
	
	if not follow_node:
		follow_node = get_parent()
	
	if follow_node:
		last_parent_pos = follow_node.global_position
		
	offset_basis = Basis.from_euler(Vector3(
		deg_to_rad(offset_pitch),
		deg_to_rad(offset_yaw),
		deg_to_rad(offset_roll)
	))

# as far I can tell, this wasn't needed, because get_point_transform is local
func reconcile_after_origin_shift(shift_vector: Vector3):
	# Shift the history so velocity calculations don't explode
	last_parent_pos -= shift_vector
	for i in range(vertex_count):
		last_positions[i] -= shift_vector
	
	# "Poke" the simulation to reset the internal 'simulation_started' flag
	# This helps mitigate the 1-frame graphical glitch mentioned in the bug report
	var old_precision = simulation_precision
	simulation_precision = old_precision

func _physics_process(delta: float) -> void:
	if not follow_node or vertex_count == 0 or delta == 0:
		return
		

	# Calculate Parent Velocity
	var current_parent_pos = follow_node.global_position
	parent_velocity = (current_parent_pos - last_parent_pos) / delta
	last_parent_pos = current_parent_pos
	
	var target_xform = follow_node.global_transform
	target_xform.basis = target_xform.basis * offset_basis

	var needs_rebuild = false
	collision_layer = store_collision_layer
	collision_mask = store_collision_mask

	for i in range(vertex_count):
		var ideal_global_pos = target_xform * original_local_positions[i]
		var current_pos = get_point_transform(i)
		
		var diff = ideal_global_pos - current_pos
		var distance = diff.length()
		
		var vertex_velocity = (current_pos - last_positions[i]) / delta
		last_positions[i] = current_pos
		
		# --- HARD LIMIT CHECK ---
		if distance > max_distance_hard:
			#if not needs_rebuild:
			#	print("have to rebuild squishy mesh")

			needs_rebuild = true
		# 1. PRIORITY: KINEMATIC HARD LIMIT (Distance Constraint)
		if distance > max_distance:
				
			var range_dist = max_distance_hard - max_distance
			var normalized_dist = (distance - max_distance) / range_dist
			var smooth_weight = tanh(normalized_dist * 2.0)
			
			var dir_to_ideal = diff.normalized()
			var boundary_pos = ideal_global_pos - (dir_to_ideal * max_distance)
			
			var displacement = boundary_pos - current_pos
			var accel = 2.0 * (displacement - vertex_velocity * delta) / (delta * delta)
			
			var effective_mass = vertex_mass * vertex_mass_multiplier * smooth_weight
			apply_force(i, effective_mass * accel)
		else:
			# 2. VELOCITY MATCHING (Inertia/Drag Constraint)
			# If the parent is moving faster than epsilon, influence vertex to follow velocity
			if parent_velocity.length_squared() > (epsilon * epsilon):
				# Calculate acceleration needed to reach parent_velocity in one delta
				var vel_diff = parent_velocity - vertex_velocity
				var accel = vel_diff / delta
				
				# Apply force using the smaller multiplier
				var force_vector = (vertex_mass * velocity_match_multiplier) * accel
				apply_force(i, force_vector)

			# 3. ELASTIC TAN ZONE (Positional Spring)
			if distance > 0.001 and distance <= max_distance:
				var ratio = clamp(distance / max_distance, 0.0, 0.99)
				var force_magnitude = stiffness * tan(ratio * (PI / 2.0))
				force_magnitude = min(force_magnitude, max_force)
				
				var force_vector = diff.normalized() * force_magnitude
				apply_force(i, force_vector)
	if needs_rebuild:
		# disable colissions to extra force softbody to stop attaching to things
		collision_layer = 0
		collision_mask = 0

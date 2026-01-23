extends SoftBody3D

@export_group("Constraint Settings")
@export var stiffness: float = 100.0
@export var max_force: float = 100.0 
@export var max_distance: float = 0.2      # Start of the Tan/Buffer zone
@export var max_distance_hard: float = 1.2 # The "No-Go" zone
@export var vertex_mass_multiplier: float = 0.5
@export var velocity_match_multiplier: float = 0.2 # Smaller version of the mass multiplier
@export var follow_node: Node3D

const epsilon = 0.001

var original_local_positions: PackedVector3Array
var last_positions: PackedVector3Array
var vertex_count: int = 0
var vertex_mass: float = 0.0

# Track parent movement
var last_parent_pos: Vector3
var parent_velocity: Vector3

func _ready() -> void:	
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

func _physics_process(delta: float) -> void:
	if not follow_node or vertex_count == 0 or delta == 0:
		return

	# Calculate Parent Velocity
	var current_parent_pos = follow_node.global_position
	parent_velocity = (current_parent_pos - last_parent_pos) / delta
	last_parent_pos = current_parent_pos

	var target_xform = follow_node.global_transform

	for i in range(vertex_count):
		var ideal_global_pos = target_xform * original_local_positions[i]
		var current_pos = get_point_transform(i)
		
		var diff = ideal_global_pos - current_pos
		var distance = diff.length()
		
		var vertex_velocity = (current_pos - last_positions[i]) / delta
		last_positions[i] = current_pos
		
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

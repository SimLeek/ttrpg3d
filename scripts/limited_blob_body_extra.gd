extends SoftBody3D

@export_group("Constraint Settings")
@export var stiffness: float = 22.5
@export var pressure_stiffness: float = 20
@export var angular_stiffness: float = 20.0
@export var max_force: float = 200.0
@export var max_distance: float = 0.2
@export var max_distance_hard: float = 0.6
@export var vertex_mass_multiplier: float = 0.25
@export var velocity_match_multiplier: float = 0.75
@export var antigrav_percent: float = 0.75
@export var follow_node: Node3D
@export var damping: float = 1.5
@export var global_restoration_stiffness: float = 50.0

@export_group("Rotation Offsets")
@export_range(-180, 180) var offset_pitch: float = 0.0
@export_range(-180, 180) var offset_yaw: float = 0.0
@export_range(-180, 180) var offset_roll: float = 0.0

const epsilon = 0.001

var original_local_positions: PackedVector3Array
var last_positions: PackedVector3Array
var vertex_count: int = 0
var vertex_mass: float = 0.0

var last_parent_pos: Vector3
var parent_velocity: Vector3
var last_parent_vel: Vector3
var store_collision_layer
var store_collision_mask

var offset_basis
var global_correction_force: Vector3 = Vector3.ZERO

func _ready() -> void:	
	store_collision_layer = collision_layer
	store_collision_mask = collision_mask
	
	# pressure from SoftBody3D was causing errors when far from the origin
	# And if it was lowered, then it did not inflate the character enough
	# so we replace it with a simpler simulation relative to the parent node
	pressure_coefficient = 0.0
	
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
		last_parent_vel = Vector3.ZERO
	offset_basis = Basis.from_euler(Vector3(
		deg_to_rad(offset_pitch),
		deg_to_rad(offset_yaw),
		deg_to_rad(offset_roll)
	))

func _physics_process(delta: float) -> void:
	if not follow_node or vertex_count == 0 or delta == 0:
		return
		
	var global_to_local: Transform3D = global_transform.affine_inverse()

	last_parent_vel = parent_velocity
	if follow_node is CharacterBody3D:
		parent_velocity = follow_node.velocity  # lower error
	else:
		var current_parent_pos = follow_node.global_position
		parent_velocity = (current_parent_pos - last_parent_pos) / delta
		last_parent_pos = current_parent_pos
	
	var target_xform = follow_node.transform
	target_xform.basis = target_xform.basis * offset_basis

	var needs_rebuild = false
	collision_layer = store_collision_layer
	collision_mask = store_collision_mask
	
	_update_global_correction(global_to_local, target_xform)
	#print(global_correction_force)

	for i in range(vertex_count):
		var ideal_local_pos = target_xform * original_local_positions[i]
		var current_pos = global_to_local*get_point_transform(i)
		
		# 1. Radial Components (r)
		var ideal_dir = ideal_local_pos.normalized()
		var current_dir = current_pos.normalized()
		
		var current_r = current_pos.length()
		
		var diff = ideal_local_pos - current_pos
		var distance = diff.length()
		
		var vertex_velocity = (current_pos - last_positions[i]) / delta
		last_positions[i] = current_pos
		
		#var force_vector = Vector3.ZERO #+ Vector3.UP*antigrav_percent
		var force_vector = global_correction_force
		
		#var current_dist_to_center = current_pos.length()
		#var ideal_dist_to_center = ideal_local_pos.length()
		
		# spring pressure
		#if current_dist_to_center < ideal_dist_to_center:
		#var compression = ideal_dist_to_center - current_dist_to_center
		#var repulsion_dir = ideal_local_pos.normalized()
		#force_vector += repulsion_dir* (compression * pressure_stiffness)
		
		# orientation fixing
		#var tilt_axis = current_dir.cross(ideal_dir)
		#var restoration_dir = tilt_axis.cross(current_dir)  # don't normalize. Length contains error info.
		#force_vector += restoration_dir * (angular_stiffness * current_r)
		
		# --- HARD LIMIT CHECK ---
		if distance > max_distance_hard:
			if not needs_rebuild:
				print("have to rebuild squishy mesh")

			needs_rebuild = true
		# 1. PRIORITY: KINEMATIC HARD LIMIT (Distance Constraint)
		if distance > max_distance:
			var range_dist = max_distance_hard - max_distance
			var normalized_dist = (distance - max_distance) / range_dist
			var smooth_weight = tanh(normalized_dist * 2.0)
			
			var dir_to_ideal = diff.normalized()
			var boundary_pos = ideal_local_pos - (dir_to_ideal * max_distance)
			
			var displacement = boundary_pos - current_pos
			var accel = 2.0 * (displacement - vertex_velocity * delta) / (delta * delta)
			
			var effective_mass = vertex_mass * vertex_mass_multiplier * smooth_weight
			force_vector += effective_mass * accel
		else:
			pass
		# 2. VELOCITY MATCHING (Inertia/Drag Constraint)
			var vel_diff = parent_velocity - vertex_velocity
			var accel = vel_diff * delta
			#var accel = (parent_velocity-last_parent_vel) / delta
			force_vector += (vertex_mass * velocity_match_multiplier) * accel
			#apply_force(i, (vertex_mass * velocity_madtch_multiplier) * accel)

		# 3. ELASTIC TAN ZONE (Positional Spring)
		#if distance > 0.001: #and distance <= max_distance:
		# this is actually a stronger version of the spring constant
			var ratio = clamp(distance / max_distance, 0.0, 0.99)
			#var force_magnitude = stiffness * tan(ratio * (PI / 2.0))
			var force_magnitude = stiffness * tan(ratio * (PI / 2.0))
			force_magnitude = min(force_magnitude, max_force)
			force_vector += diff.normalized() * force_magnitude
		#apply_force(i, diff.normalized() * force_magnitude)
				
		# damping
		# didn't work.
		#var relative_velocity = vertex_velocity - parent_velocity
		#var accel_vec = force_vector / vertex_mass
		#var relative_vf = relative_velocity+accel_vec*delta
		#rapid position change damping. dx=vi*t+.5*a*t^2
		#var pos_change = (relative_velocity*0.5*delta+accel_vec*delta*delta) 
		#force_vector -= (relative_vf-relative_velocity)*vertex_mass
		#force_vector -= pos_change*damping*vertex_mass
		if force_vector.length() > max_force:
			force_vector = force_vector.limit_length(max_force)

		apply_force(i, force_vector)
	if needs_rebuild:
		# disable colissions to extra force softbody to stop attaching to things
		collision_layer = 0
		collision_mask = 0


func _update_global_correction(global_to_local: Transform3D, target_xform: Transform3D) -> void:
	var total_displacement := Vector3.ZERO
	
	# Sum up the displacement vector (Ideal - Current) for every vertex
	for i in range(vertex_count):
		var ideal_pos = target_xform * original_local_positions[i]
		var current_pos = (global_to_local * get_point_transform(i))
		total_displacement += (ideal_pos - current_pos)
	
	# Get the average displacement vector (the "Center of Mass" shift)
	var avg_displacement = total_displacement / float(vertex_count)
	
	# Convert this shift into a restorative force. 
	# Because avg_displacement is (Ideal - Current), it already points toward the target.
	global_correction_force = avg_displacement * global_restoration_stiffness

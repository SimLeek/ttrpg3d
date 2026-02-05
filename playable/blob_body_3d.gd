@tool
extends Node3D
class_name CustomSoftBody

@export_group("Physics Parameters")
## Mass per vertex (kg). Total mass = mass_per_vertex * vertex_count
@export var mass_per_vertex: float = 0.1:
	set(value):
		mass_per_vertex = value
		_calculate_damping_state()

## Spring constant (N/m). Higher = stiffer, returns to rest faster. [br]
## Typical range: 10-1000
@export var spring_constant: float = 100.0:
	set(value):
		spring_constant = value
		_calculate_damping_state()

## Damping coefficient (N·s/m). Controls oscillation decay. [br]
## Higher = less bouncy, more viscous. [br]
## Typical range: 0.1-10
@export var damping_coefficient: float = 2.0:
	set(value):
		damping_coefficient = value
		_calculate_damping_state()

@export_multiline var _damping_display: String

## Gravity acceleration (m/s²)
@export var gravity: Vector3 = Vector3(0, -9.81, 0)

## Collision layers to detect (bitmask)
@export_flags_3d_physics var collision_mask: int = 3

## Velocity threshold below which vertices are considered at rest. [br]
## Prevents jitter from continuous micro-collisions. [br]
## Source: https://www.gamedev.net/forums/topic/588247-gravity-and-jitter/
@export var velocity_rest_threshold: float = 0.005

@export var additional_exclusions: Array[Node3D] = []  # drag nodes to ignore (e.g. other softbodies)


@export_group("Debug")
## If true, draws the collision raycasts for every vertex in real-time.
## REQUIRES: DebugDraw3D addon.
@export var draw_debug_collisions: bool = false

# ============================================================================
# INTERNAL VARIABLES
# ============================================================================

# Mesh manipulation
var mesh_instance: MeshInstance3D  # Retrieved from child node
var array_mesh: ArrayMesh
var mesh_data_tool: MeshDataTool

# Vertex data (all in LOCAL COORDINATES to avoid floating-point errors)
var rest_positions: PackedVector3Array  # Original vertex positions (local)
var current_positions: PackedVector3Array  # Current positions (local)
var velocities: PackedVector3Array  # Current velocities (local space)
var vertex_count: int = 0

# DAMPING ANALYSIS - Calculate and display via export_placeholder
## Damping ratio ζ (zeta): c / (2√(km))
var damping_ratio: float = 0.0
## Critical damping value: 2√(km)
var critical_damping: float = 0.0
## Human-readable damping state
var damping_state: String = "Not Initialized"

var exclude: Array[RID] = []

# ============================================================================
# PHYSICS CONSTANTS
# ============================================================================

const EPSILON: float = 0.001

# ============================================================================
# INITIALIZATION
# ============================================================================

func _ready() -> void:
	if not Engine.is_editor_hint():
		_setup_mesh()
		_calculate_damping_state()
	else:
		# In editor, set up for preview
		_setup_mesh()
		_calculate_damping_state()
		
	var parent = get_parent()
	if parent:
		exclude = [parent.get_rid()]
		for child in parent.get_children():
			if child is SoftBody3D:
				exclude.append(child.get_physics_rid())
			if child is CollisionObject3D:
				exclude.append(child.get_rid())
	for node in additional_exclusions:
		if node:
			exclude.append(node.get_rid())
	
func _get_mesh_instance() -> MeshInstance3D:
	"""Find the MeshInstance3D child node"""
	for child in get_children():
		if child is MeshInstance3D:
			return child
	return null

func _setup_mesh() -> void:
	"""Extract vertex data from the MeshInstance3D child's mesh"""
	mesh_instance = _get_mesh_instance()
	
	if not mesh_instance:
		return
	
	if not mesh_instance.mesh:
		return
	
	# [FIX 1] DUPLICATE THE MESH
	# We must duplicate the mesh resource, otherwise modifications to vertex positions
	# will persist in the editor memory, causing the "sinking further every restart" bug.
	# Website reference: https://docs.godotengine.org/en/stable/classes/class_resource.html#class-resource-method-duplicate
	var source_mesh = mesh_instance.mesh.duplicate()
	mesh_instance.mesh = source_mesh
	
	# Convert to ArrayMesh if needed
	if source_mesh is ArrayMesh:
		array_mesh = source_mesh
	else:
		# Convert source mesh to ArrayMesh for modification
		# Reference: https://docs.godotengine.org/en/stable/classes/class_surfacetool.html
		array_mesh = ArrayMesh.new()
		var surface_tool = SurfaceTool.new()
		surface_tool.create_from(source_mesh, 0)
		var arrays = surface_tool.commit_to_arrays()
		array_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh_instance.mesh = array_mesh
	
	# Extract vertex positions using MeshDataTool
	# Reference: https://docs.godotengine.org/en/stable/tutorials/3d/procedural_geometry/meshdatatool.html
	mesh_data_tool = MeshDataTool.new()
	var error = mesh_data_tool.create_from_surface(array_mesh, 0)
	if error != OK:
		push_error("CustomSoftBody: Failed to create MeshDataTool from surface")
		return
	
	vertex_count = mesh_data_tool.get_vertex_count()
	
	# Initialize arrays - ALL IN LOCAL SPACE
	rest_positions.resize(vertex_count)
	current_positions.resize(vertex_count)
	velocities.resize(vertex_count)
	
	for i in range(vertex_count):
		var pos = mesh_data_tool.get_vertex(i)
		rest_positions[i] = pos
		current_positions[i] = pos
		velocities[i] = Vector3.ZERO
	
	if not Engine.is_editor_hint():
		print("CustomSoftBody: Initialized with %d vertices" % vertex_count)

func _calculate_damping_state() -> void:
	"""
	Calculate damping ratio ζ (zeta) and determine damping state.
	
	For spring-mass-damper system: ma + cv + kx = F
	Natural frequency: ω₀ = sqrt(k/m)
	Damping ratio: ζ = c / (2 * sqrt(k * m))
	
	- ζ < 1: Underdamped (oscillates)
	- ζ = 1: Critically damped (fastest return without overshoot)
	- ζ > 1: Overdamped (slow return, no oscillation)
	
	Sources:
	- https://en.wikipedia.org/wiki/Harmonic_oscillator
	- https://phys.libretexts.org/Bookshelves/University_Physics/University_Physics_I_-_Mechanics_Sound_Oscillations_and_Waves_(OpenStax)/15:_Oscillations/15.06:_Damped_Oscillations
	"""
	if mass_per_vertex <= 0 or spring_constant <= 0:
		damping_state = "Invalid (check mass and spring constant)"
		critical_damping = 0.0
		damping_ratio = 0.0
		_damping_display = damping_state
		notify_property_list_changed()
		return
	
	# Calculate critical damping coefficient: c_crit = 2√(km)
	critical_damping = 2.0 * sqrt(spring_constant * mass_per_vertex)
	
	# Calculate damping ratio ζ
	damping_ratio = damping_coefficient / critical_damping
	
	# Determine state with tolerance for "approximately critical"
	if abs(damping_ratio - 1.0) < 0.05:  # Within 5% of critical
		damping_state = "Critically Damped (ζ ≈ %.3f)" % damping_ratio
	elif damping_ratio < 1.0:
		damping_state = "Underdamped (ζ = %.3f)" % damping_ratio
	else:
		damping_state = "Overdamped (ζ = %.3f)" % damping_ratio
	
	# Update the export_placeholder display
	_damping_display = "ζ=%.3f \n c_crit=%.2f \n %s" % [damping_ratio, critical_damping, damping_state]
	notify_property_list_changed()
	
	# Only print in game mode, not in editor
	if not Engine.is_editor_hint():
		print("CustomSoftBody Damping Analysis:")
		print("  Spring constant k = %.2f N/m" % spring_constant)
		print("  Mass m = %.4f kg" % mass_per_vertex)
		print("  Damping c = %.2f N·s/m" % damping_coefficient)
		print("  Critical damping c_crit = %.2f N·s/m" % critical_damping)
		print("  Damping ratio ζ = %.3f" % damping_ratio)
		print("  State: %s" % damping_state)

func _get_property_list() -> Array:
	var properties = []
	properties.append({
		"name": "_damping_display",
		"type": TYPE_STRING,
		"usage": PROPERTY_USAGE_EDITOR | PROPERTY_USAGE_READ_ONLY,
		"hint": PROPERTY_HINT_PLACEHOLDER_TEXT,
		"hint_string": _damping_display if _damping_display else "Not calculated yet"
	})
	return properties

# ============================================================================
# PHYSICS SIMULATION
# ============================================================================

func _physics_process(delta: float) -> void:
	# Don't run physics in editor
	if Engine.is_editor_hint():
		return
		
	if vertex_count == 0 or delta <= 0:
		return
	
	# Simulate each vertex independently
	for i in range(vertex_count):
		_simulate_vertex(i, delta)
	# Update the mesh with new positions
	_update_mesh()

func _simulate_vertex(vertex_index: int, delta: float) -> void:
	"""
	Simulate one vertex using spring-mass-damper physics with collision detection.
	
	Physics equation: ma + cv + kx = F
	Where:
	  m = mass
	  a = acceleration
	  c = damping coefficient
	  v = velocity
	  k = spring constant
	  x = displacement from rest position
	  F = external forces (gravity, collisions)
	
	Rearranging: a = (F - cv - kx) / m
	
	JITTER PREVENTION:
	Vertices at rest (velocity below threshold) have collision forces clamped to prevent
	micro-vibrations from continuous force/counter-force cycles.
	Source: https://www.gamedev.net/forums/topic/588247-gravity-and-jitter/
	
	ALL COORDINATES ARE LOCAL - no global transforms needed since we're a MeshInstance3D
	"""
	var current_pos = current_positions[vertex_index]
	var velocity = velocities[vertex_index]
	
	
	# Rest position is simply the original vertex position in local space
	# No transformation needed - we want vertices to spring back to their original mesh positions
	var rest_pos_local = rest_positions[vertex_index]
	
	
	# --- FORCE ACCUMULATION ---
	var total_force = Vector3.ZERO
	
	
	# 1. GRAVITY (already in local space since gravity is typically world-space down)
	# For a local coordinate system, gravity just applies as-is
	#total_force += gravity * mass_per_vertex
	
	
	# 2. SPRING FORCE: F_spring = -k * displacement
	#var displacement = current_pos - rest_pos_local
	#print(displacement)
	#var spring_force = -spring_constant * displacement
	#total_force += spring_force
	if vertex_index==1:
		print(spring_constant)
	
	# 3. DAMPING FORCE: F_damping = -c * velocity
	var damping_force = -damping_coefficient * velocity
	total_force += damping_force
	
	# [FIX 2] CORRECT COLLISION HANDLING
	# We now capture the returned dictionary. Vector3 params are NOT passed by reference in GDScript.
	var move_vec = velocity * delta
	var collision_result = _check_collision(current_pos, move_vec)
	var has_collision = not collision_result.is_empty()
	
	if draw_debug_collisions:
		_draw_vertex_debug(current_pos, move_vec, has_collision)
	
	if has_collision:
		var collision_normal = collision_result.normal
		
		# [FIX 1] IMPROVED PHYSICS RESPONSE
		# Instead of strictly checking "is_at_rest" and killing ALL forces,
		# we just verify if the net force is pushing INTO the ground.
		# If so, we apply a "Normal Force" to cancel ONLY the component pushing into the ground.
		
		# Slide Logic: Remove velocity component pointing into the wall
		if velocity.dot(collision_normal) < 0:
			var velocity_pushing_in = velocity.dot(collision_normal) * collision_normal
			velocity -= velocity_pushing_in
		
		# Force Logic: Remove force component pushing into the wall
		var force_pushing_in = total_force.dot(collision_normal)
		if force_pushing_in < 0:
			# Apply Normal Force (Newton's 3rd Law): Push back exactly enough to stop penetration
			total_force -= force_pushing_in * collision_normal
			
		# NOTE: We removed the "total_force = Vector3.ZERO" line.
		# This ensures that sideways spring forces still apply, allowing the mesh
		# to "un-pancake" itself even while resting on the floor.
	
	var acceleration = total_force / mass_per_vertex
	velocity += acceleration * delta
	
	if velocity.length_squared() < (velocity_rest_threshold * velocity_rest_threshold):
		velocity = Vector3.ZERO
	
	current_pos += velocity * delta
	
	velocities[vertex_index] = velocity
	current_positions[vertex_index] = current_pos

func _draw_vertex_debug(local_pos: Vector3, move_vec: Vector3, collided: bool) -> void:
	if not Engine.has_singleton("DebugDraw3D"):
		return
		
	var start_global = global_transform * local_pos
	
	# [FIX 3] VISUALIZE SLEEPING VERTICES
	# If velocity is near zero, 'move_vec' is zero.
	# Previous code tried to normalize zero, getting zero, making invisible lines.
	if move_vec.length_squared() < 1e-8:
		# Draw a BLUE sphere to indicate "Sleeping / At Rest"
		DebugDraw3D.draw_sphere(start_global, 0.03, Color.BLUE)
		return
	
	# Ensure the ray is visible even if movement is tiny
	var display_vec = move_vec if move_vec.length() > 0.1 else move_vec.normalized() * 0.2
	var end_global = global_transform * (local_pos + display_vec)
	
	var color = Color.RED if collided else Color.GREEN
	
	# DebugDraw3D.draw_line(start, end, color, duration)
	if Engine.has_singleton("DebugDraw3D"):
		DebugDraw3D.draw_line(start_global, end_global, color)
		if collided:
			DebugDraw3D.draw_sphere(end_global, 0.02, Color.ORANGE)

 # [FIX 3] CHANGED RETURN TYPE
# Changed from returning bool + void param to returning Dictionary.
# GDScript Vector3 arguments are passed by value, so 'collision_normal_out' was never updating.
func _check_collision(from_pos: Vector3, move_vector: Vector3) -> Dictionary:
	"""
	Returns the RayCast result dictionary.
	Dictionary is empty if no collision.
	If collision: { "position": Vector3, "normal": Vector3, ... }
	"""
	if move_vector.length_squared() < EPSILON * EPSILON:
		return {}

	var from_global = global_transform * from_pos
	
	# [FIX 4] RAY BUFFER
	# We add a tiny buffer (0.01) to ensure we hit the floor even if we are very close.
	# Without this, resting contact can fail due to float precision.
	var to_global_2 = global_transform * (from_pos + move_vector)
	var ray_dir = (to_global_2 - from_global).normalized()
	# Ensure ray has minimum length for detection
	var ray_dist = from_global.distance_to(to_global_2)
	var ray_end = from_global + ray_dir * (ray_dist + 0.01) 
	
	var space_state = get_world_3d().direct_space_state
	var query = PhysicsRayQueryParameters3D.create(from_global, ray_end)
	query.collision_mask = collision_mask
	query.exclude = exclude
	query.collide_with_areas = false
	query.collide_with_bodies = true
	
	var result = space_state.intersect_ray(query)

	if result.is_empty():
		return {}

	# Convert global normal to local space for physics calculation
	# Note: result["normal"] is in Global Space.
	# We need to return the Local Normal for the force calculations above.
	var local_normal = global_transform.basis.inverse() * result.normal
	
	# We inject the local normal back into the result so _simulate_vertex uses it correctly
	result["normal"] = local_normal.normalized()
	
	return result

func _update_mesh() -> void:
	"""
	Update the mesh with new vertex positions.
	Uses MeshDataTool to modify vertices and commits back to ArrayMesh.
	
	Reference: https://docs.godotengine.org/en/stable/tutorials/3d/procedural_geometry/meshdatatool.html
	"""
	mesh_data_tool.create_from_surface(array_mesh, 0)
	# Update MeshDataTool with new positions
	for i in range(vertex_count):
		mesh_data_tool.set_vertex(i, current_positions[i])
	
	# Commit changes back to mesh
	array_mesh.clear_surfaces()
	mesh_data_tool.commit_to_surface(array_mesh)

# ============================================================================
# EDITOR DISPLAY (only actual warnings)
# ============================================================================

func _get_configuration_warnings() -> PackedStringArray:
	"""Display only actual warnings in editor"""
	var warnings = PackedStringArray()
	
	var mesh_inst = _get_mesh_instance()
	if not mesh_inst:
		warnings.append("⚠ Missing MeshInstance3D child node! Add a MeshInstance3D as a child.")
	elif not mesh_inst.mesh:
		warnings.append("⚠ MeshInstance3D child has no mesh assigned!")
	
	return warnings

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

func reset_to_rest() -> void:
	"""Reset all vertices to their rest positions with zero velocity"""
	for i in range(vertex_count):
		current_positions[i] = rest_positions[i]
		velocities[i] = Vector3.ZERO
	_update_mesh()

func get_damping_info() -> Dictionary:
	"""Get information about the current damping configuration"""
	return {
		"damping_ratio": damping_ratio,
		"damping_state": damping_state,
		"spring_constant": spring_constant,
		"damping_coefficient": damping_coefficient,
		"mass_per_vertex": mass_per_vertex,
		"is_critically_damped": abs(damping_ratio - 1.0) < 0.05,
		"is_underdamped": damping_ratio < 1.0,
		"is_overdamped": damping_ratio > 1.0
	}

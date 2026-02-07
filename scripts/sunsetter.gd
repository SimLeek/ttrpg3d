extends Node3D

@export_group("Required Nodes")
## The DirectionalLight3D representing the sun.
@export var sun: DirectionalLight3D
## The WorldEnvironment containing the environment to modify.
@export var world_env: WorldEnvironment
## The character body to ignore during the raycast.
@export var additional_exclusions: Array[Node3D] = []  # drag nodes to ignore (e.g. other softbodies)

@export_group("Raycast Settings")
## How far to check for sun blockages.
@export var ray_distance: float = 1000.0
## Collision mask for the raycast (defaulting to layer 1).
@export_flags_3d_physics var collision_mask: int = 1

@export_group("Transition Settings")
## The time in seconds it takes to fully transition between states.
@export var transition_duration: float = 1.0
## Energy multiplier when the sun is visible.
@export var bright_bg_value: float = 1.0
## Energy multiplier when the sun is blocked.
@export var dark_bg_value: float = 0.25
@export var bright_ambient_value: float = 0.75
## Energy multiplier when the sun is blocked.
@export var dark_ambient_value: float = 0.05
@export var bright_sun_value: float = 0.75
@export var dark_sun_value: float = 0.05

var character: CharacterBody3D
var exclude: Array[RID] = []

func _physics_process(delta: float) -> void:
	if not sun or not world_env or not world_env.environment:
		return
		
	character = get_parent() as CharacterBody3D
	if not character:
		push_error("Sunsetter must be child of CharacterBody3D")
		return
	
	exclude = [character.get_rid()]
	for child in character.get_children():
		if child is SoftBody3D:
			exclude.append(child.get_physics_rid())
	for node in additional_exclusions:
		if node:
			exclude.append(node.get_rid())

	# 1. Determine the direction of the sun. 
	# In Godot, DirectionalLight3D points toward -Basis.Z, 
	# so the light is coming FROM Basis.Z.
	var sun_direction: Vector3 = sun.global_transform.basis.z.normalized()
	
	# 2. Perform the Raycast
	var space_state = get_world_3d().direct_space_state
	var query = PhysicsRayQueryParameters3D.create(
		global_position, 
		global_position + (sun_direction * ray_distance),
		collision_mask
	)
	
	# Exclude the character body if provided
	query.exclude = exclude

	var result = space_state.intersect_ray(query)
	#print(world_env.environment.background_energy_multiplier)

	# 3. Handle the Lerp
	# Determine target value based on hit
	var target_energy = dark_bg_value if result else bright_bg_value
	var target_ambient = dark_ambient_value if result else bright_ambient_value
	var target_sun = dark_sun_value if result else bright_sun_value

	# Calculate speed: (Difference between states) / time
	var transition_speed = abs(bright_bg_value - dark_bg_value) / transition_duration
	var transition_ambient_speed = abs(bright_ambient_value - dark_ambient_value) / transition_duration
	var transition_sun_speed = abs(bright_sun_value - dark_sun_value) / transition_duration

	# Apply the lerp to the background_energy_multiplier
	world_env.environment.background_energy_multiplier = move_toward(
		world_env.environment.background_energy_multiplier,
		target_energy,
		transition_speed * delta
	)
	world_env.environment.ambient_light_energy = move_toward(
		world_env.environment.ambient_light_energy,
		target_ambient,
		transition_ambient_speed * delta
	)
	sun.light_energy = move_toward(
		sun.light_energy,
		target_sun,
		transition_sun_speed * delta
	)

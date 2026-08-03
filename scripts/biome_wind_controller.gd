extends Node3D

@export_group("Required Nodes")
@export var player: CharacterBody3D
@export var wind_generator: Node # Point to the C# WindGenerator

@export_group("Occlusion Settings")
## How far to check for walls around the player
@export var horizontal_dist: float = 300.0
## How far to check for a roof
@export var vertical_dist: float = 1000.0
@export_flags_3d_physics var collision_mask: int = 1

@export_group("Volume Levels")
@export var outdoor_db: float = 0.0
@export var semi_indoor_db: float = -12.0
@export var indoor_db: float = -80.0
@export var transition_speed: float = 30.0 # dB per second

@export_group("Curves")
@export var height_intensity_curve: Curve
@export var velocity_intensity_curve: Curve
@export var whistle_profile_curve: Curve

func _physics_process(delta: float) -> void:
	if not player or not wind_generator:
		return
	
	# 1. Procedural Wind Logic
	var height = player.global_position.y - global_position.y
	var velocity = player.velocity.length()
	
	var height_influence = height_intensity_curve.sample(height)
	var base_h = remap(height_influence, 0.0, 1.0, 0.025, 2.0)
	var vel_influence = velocity_intensity_curve.sample(velocity)
	var whistle_factor = whistle_profile_curve.sample(height)
	
	wind_generator.BaseIntensity = move_toward(wind_generator.BaseIntensity, base_h + (vel_influence * 1.0), delta)
	wind_generator.GustStrength = move_toward(wind_generator.GustStrength, base_h, delta)
	wind_generator.WhistleVolume = move_toward(wind_generator.WhistleVolume, whistle_factor * 0.1, delta)
	wind_generator.WhistlePitchBase = move_toward(wind_generator.WhistlePitchBase, 500.0 + (whistle_factor * 1500.0), delta)

	# 2. Multi-Ray Occlusion Detection
	var space_state = get_world_3d().direct_space_state
	var pos = player.global_position + Vector3.UP # Raycast from chest height
	var basis = player.global_transform.basis

	# Define our 5 directions
	var directions = {
		"up": Vector3.UP * vertical_dist,
		"fwd": -basis.z * horizontal_dist,
		"back": basis.z * horizontal_dist,
		"left": -basis.x * horizontal_dist,
		"right": basis.x * horizontal_dist
	}

	var results = {}
	for key in directions:
		var query = PhysicsRayQueryParameters3D.create(pos, pos + directions[key], collision_mask)
		query.exclude = [player.get_rid()]
		results[key] = not space_state.intersect_ray(query).is_empty()

	# 3. Logic: Semi vs Fully Indoors
	var walls_blocked = results["fwd"] and results["back"] and results["left"] and results["right"]
	var roof_blocked = results["up"]

	var target_db = outdoor_db
	if walls_blocked and roof_blocked:
		target_db = indoor_db
	elif walls_blocked:
		target_db = semi_indoor_db

	# 4. Apply Volume Move Toward
	var audio_player = wind_generator.Player
	if audio_player:
		audio_player.volume_db = move_toward(audio_player.volume_db, target_db, transition_speed * delta)

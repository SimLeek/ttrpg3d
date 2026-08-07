extends Node3D

@export var threshold: float = 128 # detected soft body numerical instability past here
@export var soft_bodies: Array[SoftBody3D] = []

var _soft_body_templates: Array[SoftBody3D] = []
var _soft_body_parents: Dictionary = {}
var _soft_body_local_transforms: Dictionary = {} 
var camera: Camera3D

func _ready() -> void:
	# Runs after CharacterBody3D's own _ready() (children _ready() before
	# parent's), so player_blob_ctrl.gd has already computed last_safe_pos
	# from the scene's default spawn -- fix that up too when overriding
	# position here, or the "stuck in floor" safety check has a stale
	# fallback position for one frame.
	_apply_pending_world()

	for body in soft_bodies:
		if body:
			_soft_body_parents[body] = body.get_parent()
			_soft_body_local_transforms[body] = body.transform
			var template = body.duplicate()
			_soft_body_templates.append(template)

func _apply_pending_world() -> void:
	var world: Dictionary = WorldManager.pending_world
	if world.is_empty():
		# No explicit switch queued -- this is a fresh load of the scene
		# (first launch, or the scene run directly), not a switch or a
		# death-respawn. Fall back to WorldManager's notion of the current
		# world (worlds[0] by default) instead of leaving the scene's own
		# baked-in default terrain in place, so a fresh start always loads
		# whatever the first existing world actually is.
		world = WorldManager.current_world
	if world.is_empty():
		return
	WorldManager.pending_world = {}
	WorldManager.current_world = world

	var gen_def := WorldGeneratorCatalog.get_generator(world.get("generator_id", ""))
	if gen_def.is_empty():
		push_warning("[World] Unknown generator id: %s" % world.get("generator_id", "?"))
		return
	var params: Dictionary = world.get("params", {})

	var terrain: VoxelTerrain = $World/VoxelTerrain
	terrain.generator = WorldGeneratorCatalog.instantiate_generator(gen_def, params)

	# Per-world save file so voxel edits (placing/breaking blocks) persist
	# across world switches/relaunches instead of regenerating fresh from
	# the generator every time. "Reset" (WorldManager.reset_world) just
	# deletes this file.
	var world_id: String = world.get("id", "")
	if not world_id.is_empty():
		DirAccess.make_dir_recursive_absolute(WorldManager.WORLD_SAVES_DIR)
		var stream := VoxelStreamSQLite.new()
		stream.database_path = WorldManager.get_stream_path(world_id)
		terrain.stream = stream

	var spawn = WorldGeneratorCatalog.get_spawn_position(gen_def, params)
	if spawn != null:
		$CharacterBody3D.global_position = spawn
		$CharacterBody3D.last_safe_pos = spawn - terrain.global_position
		$CharacterBody3D.velocity = Vector3.ZERO
		_grant_spawn_protection()

	# Real procedural skybox for finite/non-default worlds -- a seamless
	# generated cubemap (ProceduralSkybox), sampled by a plain cubemap sky
	# shader with no panini distortion anywhere in the chain. Proves the
	# "actual skyboxes" half of the panini-removal goal on new content,
	# even though the default hilly world's own sky still uses
	# panini_sky.gdshader for now (see TODO_modding_and_worlds.md).
	if gen_def.get("id", "") == "limestone_slab":
		var cubemap := ProceduralSkybox.generate_cubemap(
			64, Color(0.18, 0.05, 0.32), Color(0.62, 0.32, 0.85))

		var sky_material := ShaderMaterial.new()
		sky_material.shader = load("res://3dAssets/shaders/simple_cubemap_sky.gdshader")
		sky_material.set_shader_parameter("sky_cubemap", cubemap)

		var sky := Sky.new()
		sky.sky_material = sky_material

		var env := Environment.new()
		env.background_mode = Environment.BG_SKY
		env.sky = sky
		env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		env.ambient_light_energy = 0.75
		$World/WorldEnvironment.environment = env

## A generator-driven spawn teleport (limestone_slab, plains) drops the
## player into freshly-streaming terrain -- if the chunks under them
## haven't finished generating yet, they can fall much further than the
## spawn height math assumes before solid ground actually exists, and
## Health.gd's fall-damage curve (max_health = 1.0, quadratic past a
## velocity threshold) makes that reliably fatal. Disable fall damage
## briefly so a slow chunk-load can't kill the player before they've even
## seen the world -- reproduced live: switching to Plains killed the
## player via "Player died. Reloading..." every time before this fix.
func _grant_spawn_protection(duration: float = 2.0) -> void:
	var health := $CharacterBody3D/Health
	if not health or not ("turn_on_fall_damage" in health):
		return
	var was_enabled: bool = health.turn_on_fall_damage
	health.turn_on_fall_damage = false
	get_tree().create_timer(duration).timeout.connect(func():
		if is_instance_valid(health):
			health.turn_on_fall_damage = was_enabled
	)

func shift_origin() -> void:
	var shift_vector = $CharacterBody3D.global_position
	
	# This stops the physics server from trying to simulate them during the shift
	#for body in soft_bodies:
	#	if body.get_parent():
	#		body.get_parent().remove_child(body)

	$World.global_position -= shift_vector
	$CharacterBody3D.global_position = Vector3.ZERO

	# Soft bodies just don't really work with transforms well
	# the best way to shift them turned out to be setting every single vertex manually.
	# Transforming the soft body kept them transformed relative to the character/parent
	# whether it was a global or local transform, which is not how transforms usually work.
	#  https://github.com/godotengine/godot-proposals/issues/12698
	#  https://github.com/godotengine/godot/issues/108090
	for body in soft_bodies:
		var m = body.mesh
		
		var mdt = MeshDataTool.new()
		var array_mesh = ArrayMesh.new()
		
		if m is ArrayMesh:
			array_mesh = m
		else:
			var st = SurfaceTool.new()
			st.create_from(m, 0)
			array_mesh = st.commit()

		mdt.create_from_surface(array_mesh, 0)
		
		for i in range(mdt.get_vertex_count()):
			var v = mdt.get_vertex(i)
			mdt.set_vertex(i, v - shift_vector)
		
		var new_mesh = ArrayMesh.new()
		mdt.commit_to_surface(new_mesh)
		
		body.mesh = new_mesh
		
		# as far I can tell, this wasn't needed, because get_point_transform is local
		# however, the max force limit on the limited_blob_body script and the single frame nature
		# of this made it hard to tell. So I'm leaving the code in just indssssssssssss
		#if body.has_method("reconcile_after_origin_shift"):
		#	body.reconcile_after_origin_shift(-shift_vector)

	print("Origin shifted. SoftBodies hard-reset via Mesh-Reassignment.")

func _physics_process(_delta: float) -> void:
	camera = get_viewport().get_camera_3d() 
	if camera and $CharacterBody3D.global_position.length() > threshold: 
		#$WorldEnvironment.environment.sdfgi_enabled = false
		shift_origin()
		#await get_tree().process_frame
		#$WorldEnvironment.environment.sdfgi_enabled = true

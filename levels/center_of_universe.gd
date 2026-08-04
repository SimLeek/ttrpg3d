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
		return
	WorldManager.pending_world = {}

	var gen_def := WorldGeneratorCatalog.get_generator(world.get("generator_id", ""))
	if gen_def.is_empty():
		push_warning("[World] Unknown generator id: %s" % world.get("generator_id", "?"))
		return
	var params: Dictionary = world.get("params", {})

	var terrain: VoxelTerrain = $World/VoxelTerrain
	terrain.generator = WorldGeneratorCatalog.instantiate_generator(gen_def, params)

	var spawn = WorldGeneratorCatalog.get_spawn_position(gen_def, params)
	if spawn != null:
		$CharacterBody3D.global_position = spawn
		$CharacterBody3D.last_safe_pos = spawn - terrain.global_position

	# Simple distinct-color sky for finite/non-default worlds for now --
	# a real image-based skybox (the game already has an unused skybox
	# texture asset) needs panini removed from the sky shader first, see
	# TODO_modding_and_worlds.md.
	if gen_def.get("id", "") == "limestone_slab":
		var env := Environment.new()
		env.background_mode = Environment.BG_COLOR
		env.background_color = Color(0.55, 0.35, 0.65)
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color(0.55, 0.35, 0.65)
		env.ambient_light_energy = 0.75
		$World/WorldEnvironment.environment = env

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

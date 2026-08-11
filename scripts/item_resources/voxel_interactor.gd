extends Resource
class_name VoxelInteractor
## Voxel placement and interaction system for items
##
## Attaches to items that need to interact with voxels, such as placing, removing, or modifying them.[br]
## Projects a ray from the character to find valid voxel targets.[br]
## Manages visual aids like placement plane and targeting beam.[br]
##[br]
## Items using this should call [method setup] when equipped, [method update_target] in _physics_process,[br]
## and [method cleanup] when unequipped.[br]
## Use [method has_valid_target], [method get_hit_info], and [method get_placement_position] to query target information.

class HitInfo:
	## Container for voxel hit information
	##
	## Holds the position, ID, and metadata of a hit voxel.
	var position: Vector3
	var voxel_id: int
	var metadata: Variant

	func _init(_position: Vector3, _voxel_id: int, _metadata: Variant) -> void:
		position = _position
		voxel_id = _voxel_id
		metadata = _metadata

## Aim origin+direction anchored near the character, not the camera --
## exactly the same math update_target() uses to orient its own targeting
## beam (first/third-person pitch, height offset, avoid-distance pull-back),
## extracted here so other systems that need to know "what would this
## character actually hit if they tried to place/break a block right now"
## (hud.gd's battle-mode range check, DevConsole's `point` command) agree
## with the real targeting tool instead of using plain camera-forward.
## Camera-forward diverges from this as zoom changes: the camera itself
## moves further from the character in third person, so a ray cast from
## its position traces a different path through the world than one from
## near the character's own body, even at the same look angle.
## `raycast_distance`/`beam_height_offset`/etc. default to
## VoxelInteractor's own @export defaults -- override only if a specific
## tool's tuning actually differs. The distance you actually want to cast
## the resulting ray is a separate, independent choice; pass it to
## VoxelTool.raycast() yourself.
static func get_aim_ray(character: CharacterBody3D, raycast_distance: float = 5.0,
		beam_height_offset: float = 0.25, third_person_rotation_offset: float = 5.0 * PI / 8.0,
		beam_character_avoid_dist: float = 0.1) -> Dictionary:
	var rot_x: float = character.spring_arm.rotation.x
	rot_x += (PI / 2.0) if character.spring_arm.is_first_person else third_person_rotation_offset
	var dist := raycast_distance + beam_character_avoid_dist
	var local_pos := Vector3(0, beam_height_offset - cos(rot_x) * dist / 2.0, -sin(rot_x) * dist / 2.0)
	var local_basis := Basis(Vector3.RIGHT, rot_x)
	var beam_transform: Transform3D = character.global_transform * Transform3D(local_basis, local_pos)
	var forward: Vector3 = -beam_transform.basis.y.normalized()
	var origin: Vector3 = beam_transform.origin - forward * beam_character_avoid_dist - forward * (raycast_distance / 2.0)
	return {"origin": origin, "direction": forward}

@export_group("Terrain")
## Size of each voxel in the terrain grid. Assumes cubic voxels.
@export var voxel_size: float = 1.0

@export_group("Raycast")
## Maximum distance for the targeting raycast.
@export var raycast_distance: float = 5.0

@export_group("Placement Plane")
## Texture for the placement plane visual.
@export var plane_texture: Texture2D = null
## Size of the placement plane visual.
@export var plane_size: Vector2 = Vector2(1.0, 1.0)
## Small offset to position the plane slightly inside the placement voxel for visual alignment.
@export var plane_offset: float = 0.05

@export_group("Visual Beam")
## Whether to show the targeting beam.
@export var show_beam: bool = true
## Color of the targeting beam.
@export var beam_color: Color = Color(0.0, 1.0, 1.0, 0.5)
## Width of the targeting beam.
@export var beam_width: float = 0.02
## Height offset for the beam position, related to character model height.
@export var beam_height_offset: float = 0.25
## Distance from character origin to make sure we don't shove the player into a voxel
@export var beam_character_avoid_dist: float = 0.1  # cube root of 3, or 1+1+1 for x+y+z + default height offset
## Rotation offset for the beam in third-person view.
@export var third_person_rotation_offset: float = 5.0 * PI / 8.0

@export_group("Debug")
@export var debug_collision: bool = false

var _terrain: VoxelTerrain = null
var _terrain_tool: VoxelTool = null
var _placement_plane: MeshInstance3D = null
var _beam: MeshInstance3D = null
var _has_valid_target: bool = false
var _hit_snapped_position: Vector3 = Vector3.ZERO
var _hit_normal: Vector3 = Vector3.ZERO
var _hit_voxel_id: int = 0
var _hit_metadata: Variant = null
var _placement_position: Variant = null
var _character: CharacterBody3D = null

## Initializes the voxel placer with the given character.[br]
##[br]
## Finds the voxel terrain and tool.[br]
## Creates visual aids.[br]
##[br]
##[param character] The character using the item.
func setup(character: CharacterBody3D) -> void:
	_character = character
	_terrain = character.voxel_terrain as VoxelTerrain
	if not _terrain:
		push_error("VoxelPlacer: Could not find voxel_terrain on character")
		return
	
	_terrain_tool = _terrain.get_voxel_tool()
	if not _terrain_tool:
		push_error("VoxelPlacer: Failed to get VoxelTool")
		return
	
	_terrain_tool.channel = VoxelBuffer.CHANNEL_TYPE
	_create_placement_plane()
	_create_beam(character)

## Updates the targeting raycast and visuals.[br]
##[br]
## Should be called every physics frame by the owning item.[br]
##[br]
##[param character] The character using the item.
func update_target(character: CharacterBody3D) -> void:
	if not _terrain_tool:
		return
	
	_update_beam_orientation(character)
	var forward: Vector3 = -_beam.global_transform.basis.y.normalized()
	var origin: Vector3 = _beam.global_position-forward*beam_character_avoid_dist - (forward * (raycast_distance / 2.0))
	var origin0: Vector3 = _beam.global_position - (forward * (raycast_distance / 2.0))
	var hit0 = _terrain_tool.raycast(origin0, forward, beam_character_avoid_dist)
	var hit = _terrain_tool.raycast(origin, forward, raycast_distance)
	
	if hit0:
		_set_bad_target()
	elif hit:
		_has_valid_target = true
		_hit_voxel_id = _terrain_tool.get_voxel(hit.position)
		_hit_metadata = _terrain_tool.get_voxel_metadata(hit.position)
		# this test was because things weren't getting hit
		# The solution was that you need to set collision AABBs on voxel items, NOT normal collisions.
		# keep this note here to save hours of work for anyone else looking here
		#print("hit %d" % _hit_voxel_id)
		var diff: Vector3 = hit.position - hit.previous_position
		_hit_normal = _calculate_hit_normal(diff)
		_hit_snapped_position = _snap_to_grid(hit.position)
		# .floor() is needed in order to deal with positive and negative voxel position values for some reason
		_placement_position = (_hit_snapped_position - _hit_normal * voxel_size).floor()
		if _is_voxel_overlapping_character(character, _placement_position):
			_placement_position = null  # Can't place. Can delete.
			#return # Bail out so we don't try to draw the plane
		_update_placement_plane()
	else:
		_set_bad_target()

func _set_bad_target():
	_has_valid_target = false
	_hit_snapped_position = Vector3.ZERO
	_hit_normal = Vector3.ZERO
	_hit_voxel_id = 0
	_hit_metadata = null
	_placement_position = null
	if _placement_plane:
		_placement_plane.visible = false

## Returns whether there is a valid voxel target.[br]
##[br]
##[return] True if a valid target is detected, false otherwise.
func has_valid_target() -> bool:
	return _has_valid_target

## Returns information about the hit voxel.[br]
##[br]
## Includes the snapped center position, voxel ID, and metadata.[br]
##[br]
##[return] A HitInfo object if valid target, null otherwise.
func get_hit_info() -> HitInfo:
	if not _has_valid_target:
		return null
	# .floor() is needed in order to deal with positive and negative voxel position values for some reason
	return HitInfo.new(_hit_snapped_position.floor(), _hit_voxel_id, _hit_metadata)

## Returns the position where a new voxel would be placed.[br]
##[br]
## This is the snapped center of the adjacent voxel in the outward direction.[br]
##[br]
##[return] The placement position if valid target, Vector3.ZERO otherwise.
func get_placement_position():
	if not _has_valid_target:
		return null
	return _placement_position

## Cleans up visuals and resources.[br]
##[br]
## Should be called when the item is unequipped.
func cleanup() -> void:
	if _placement_plane:
		_placement_plane.queue_free()
		_placement_plane = null
	if _beam:
		_beam.queue_free()
		_beam = null

func _is_voxel_overlapping_character(character: CharacterBody3D, voxel_pos: Vector3) -> bool:
	# 1. Define the Voxel AABB
	var voxel_aabb = AABB(voxel_pos, Vector3.ONE * voxel_size)
	
	# 2. Define the Character AABB
	# We'll calculate it from the collision shape to be precise
	var capsule: CollisionShape3D = character.find_child("CollisionShape3D", true)
	if not capsule:
		return false
		
	# Get the local AABB and move it to world space
	var char_aabb = capsule.shape.get_debug_mesh().get_aabb()
	char_aabb.position += character.global_position# - (char_aabb.size / 2.0)
	
	# 3. Handle Debug Drawing
	if debug_collision:
		var overlap = voxel_aabb.intersects(char_aabb)
		var draw_color = Color.RED if overlap else Color.GREEN
		
		# DebugDraw3D Syntax: draw_aabb(aabb, color, duration)
		# Duration 0 means it draws for exactly one frame (perfect for _physics_process)
		DebugDraw3D.draw_aabb(voxel_aabb, draw_color)
		DebugDraw3D.draw_aabb(char_aabb, Color.AQUA)
		
		# Optional: Draw a line between centers to see the distance
		DebugDraw3D.draw_line(voxel_aabb.get_center(), char_aabb.get_center(), Color.YELLOW)

	return voxel_aabb.intersects(char_aabb)

func _create_placement_plane() -> void:
	var plane_mesh := PlaneMesh.new()
	plane_mesh.size = plane_size
	
	_placement_plane = MeshInstance3D.new()
	_placement_plane.mesh = plane_mesh
	
	var material := StandardMaterial3D.new()
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	# Render priority 1 ensures the plane draws in front of voxel terrain.
	material.render_priority = 1
	
	if plane_texture:
		material.albedo_texture = plane_texture
	else:
		material.albedo_color = Color(1.0, 1.0, 1.0, 0.5)
	
	_placement_plane.material_override = material
	_placement_plane.visible = false
	
	_character.get_tree().root.add_child(_placement_plane)

func _create_beam(character: CharacterBody3D) -> void:
	if not show_beam or not character:
		return
	
	var cylinder_mesh := CylinderMesh.new()
	cylinder_mesh.top_radius = beam_width
	cylinder_mesh.bottom_radius = beam_width
	cylinder_mesh.height = raycast_distance
	
	_beam = MeshInstance3D.new()
	_beam.mesh = cylinder_mesh
	
	var material := StandardMaterial3D.new()
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = beam_color
	material.disable_receive_shadows = true
	# Render priority 2 ensures the beam draws in front of voxel terrain and the placement plane.
	material.render_priority = 2
	_beam.material_override = material
	
	character.add_child(_beam)
	_beam.position = Vector3(0, 0, -(raycast_distance+beam_character_avoid_dist) / 2.0)
	_beam.rotation.x = PI / 2.0

func _update_beam_orientation(character: CharacterBody3D) -> void:
	if not _beam:
		return
	
	if character.spring_arm.is_first_person:
		_beam.rotation.x = character.spring_arm.rotation.x + PI / 2.0
	else:
		_beam.rotation.x = character.spring_arm.rotation.x + third_person_rotation_offset
	_beam.position = Vector3(
		0, 
		beam_height_offset - cos(_beam.rotation.x) * (raycast_distance+beam_character_avoid_dist) / 2.0, 
		-sin(_beam.rotation.x) *  (raycast_distance+beam_character_avoid_dist) / 2.0)

func _snap_to_grid(position: Vector3) -> Vector3:
	return Vector3(
		floor(position.x / voxel_size) * voxel_size + voxel_size * 0.5,
		floor(position.y / voxel_size) * voxel_size + voxel_size * 0.5,
		floor(position.z / voxel_size) * voxel_size + voxel_size * 0.5
	)

func _calculate_hit_normal(diff: Vector3) -> Vector3:
	var abs_diff := Vector3(abs(diff.x), abs(diff.y), abs(diff.z))
	var normal := Vector3.ZERO
	if abs_diff.x > abs_diff.y and abs_diff.x > abs_diff.z:
		normal = Vector3(sign(diff.x), 0, 0)
	elif abs_diff.y > abs_diff.z:
		normal = Vector3(0, sign(diff.y), 0)
	else:
		normal = Vector3(0, 0, sign(diff.z))
	return normal

func _update_placement_plane() -> void:
	if not _placement_plane:
		return
	
	_placement_plane.visible = true
	# Position slightly inside the placement voxel (offset > voxel_size/2 from hit center).
	# Addning _terrain.global_position is necessary due to origin shifting for large worlds
	_placement_plane.global_position = _hit_snapped_position + _terrain.global_position - _hit_normal * (voxel_size / 2.0 + plane_offset)
	
	var up := _hit_normal
	var right := up.cross(Vector3.FORWARD if abs(up.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
	var fwd := right.cross(up)
	_placement_plane.global_transform.basis = Basis(right, up, fwd)

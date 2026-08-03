extends BaseItem
class_name StructureSaverItem

## Selects a box region of voxels and saves it as a SavedVoxelStructure resource.
##
## Controls (only active while this tool is equipped):
##   primary click (use_item)  -- set corner A, then corner B, then restart
##   structure_set_pivot (P)   -- set the pivot, once both corners are set
##   structure_save (G)        -- save the current selection
## If no pivot is set, the structure's min corner is used as the pivot when
## saved (i.e. it places flush with whatever surface you're aiming at).
##
## Visual feedback every physics frame via DebugDraw3D -- wireframe boxes
## are non-occluding/"see-through" by construction, and each element gets
## its own color so corners, the rest of the volume, and the pivot are all
## distinguishable from each other:
##   corner A       -- cyan box
##   corner B       -- orange box
##   full selection -- dim white box
##   pivot          -- red sphere

const STRUCTURES_DIR := "user://structures"

@export var voxel_interactor: VoxelInteractor

var _corner_a = null  # Vector3i once set
var _corner_b = null  # Vector3i once set
var _pivot: Vector3i = Vector3i.ZERO
var _has_pivot: bool = false

func set_character(chara: CharacterBody3D) -> void:
	tooltip_text = "[b]Structure Saver[/b]\nClick: set corner A, then B  |  P: set pivot  |  G: save"
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)


func _physics_process(_delta: float) -> void:
	if not voxel_interactor or not character:
		return
	voxel_interactor.update_target(character)
	_draw_selection()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("structure_set_pivot"):
		_set_pivot()
	elif event.is_action_pressed("structure_save"):
		save_structure()


func use_item(pressure: float) -> void:
	super.use_item(pressure)

	if not voxel_interactor or not voxel_interactor.has_valid_target():
		return
	var hit = voxel_interactor.get_hit_info()
	if not hit:
		return

	var pos := Vector3i(hit.position)
	if _corner_a == null:
		_corner_a = pos
	elif _corner_b == null:
		_corner_b = pos
	else:
		# Both already set -- start a fresh selection from here.
		_corner_a = pos
		_corner_b = null
		_has_pivot = false


func _set_pivot() -> void:
	if _corner_a == null or _corner_b == null:
		return
	if not voxel_interactor or not voxel_interactor.has_valid_target():
		return
	var hit = voxel_interactor.get_hit_info()
	if not hit:
		return
	_pivot = Vector3i(hit.position)
	_has_pivot = true


func _min_corner() -> Vector3i:
	return Vector3i(min(_corner_a.x, _corner_b.x), min(_corner_a.y, _corner_b.y), min(_corner_a.z, _corner_b.z))


func _max_corner() -> Vector3i:
	return Vector3i(max(_corner_a.x, _corner_b.x), max(_corner_a.y, _corner_b.y), max(_corner_a.z, _corner_b.z))


func _draw_selection() -> void:
	if not voxel_interactor._terrain:
		return
	var origin: Vector3 = voxel_interactor._terrain.global_position

	if _corner_a != null:
		DebugDraw3D.draw_aabb(AABB(Vector3(_corner_a) + origin, Vector3.ONE), Color.CYAN)
	if _corner_b != null:
		DebugDraw3D.draw_aabb(AABB(Vector3(_corner_b) + origin, Vector3.ONE), Color.ORANGE)
	if _corner_a != null and _corner_b != null:
		var mn := _min_corner()
		var mx := _max_corner()
		DebugDraw3D.draw_aabb(AABB(Vector3(mn) + origin, Vector3(mx - mn) + Vector3.ONE), Color(1, 1, 1, 0.6))
	if _has_pivot:
		DebugDraw3D.draw_sphere(Vector3(_pivot) + Vector3(0.5, 0.5, 0.5) + origin, 0.2, Color.RED)


func save_structure() -> void:
	if _corner_a == null or _corner_b == null:
		return

	var mn := _min_corner()
	var mx := _max_corner()
	var size := mx - mn + Vector3i.ONE

	var buffer := VoxelBuffer.new()
	buffer.create(size.x, size.y, size.z)
	voxel_interactor._terrain_tool.copy(mn, buffer, 1 << VoxelBuffer.CHANNEL_TYPE)

	var structure := SavedVoxelStructure.new()
	structure.from_voxel_buffer(buffer)
	structure.pivot = (_pivot - mn) if _has_pivot else Vector3i.ZERO

	DirAccess.make_dir_recursive_absolute(STRUCTURES_DIR)
	var path := "%s/structure_%d.tres" % [STRUCTURES_DIR, _next_index()]
	var err := ResourceSaver.save(structure, path)
	if err == OK:
		print("Saved structure to ", path)
	else:
		push_error("Failed to save structure (%d): %s" % [err, path])

	_corner_a = null
	_corner_b = null
	_has_pivot = false


func _next_index() -> int:
	var i := 1
	while FileAccess.file_exists("%s/structure_%d.tres" % [STRUCTURES_DIR, i]):
		i += 1
	return i


func on_unequipped() -> void:
	super.on_unequipped()
	if voxel_interactor:
		voxel_interactor.cleanup()

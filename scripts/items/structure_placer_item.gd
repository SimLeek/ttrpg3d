extends BaseItem
class_name StructurePlacerItem

## Places a previously saved SavedVoxelStructure (see StructureSaverItem) into
## the world, aligned so the structure's pivot lands on the placement
## target -- the same adjacent-empty-voxel spot VoxelPlacerItem uses.
##
## Controls (only active while this tool is equipped):
##   primary click (use_item)  -- paste the current structure
##   structure_cycle (R)       -- cycle to the next saved structure
##
## Visual feedback: a dim green wireframe ghost box (DebugDraw3D -- inherently
## non-occluding/"transparent") showing where the structure would land.
## Placement uses paste_masked() so empty (air) voxels in the structure
## don't carve into surrounding terrain.

const STRUCTURES_DIR := "user://structures"

@export var voxel_interactor: VoxelInteractor

var _structures: Array[SavedVoxelStructure] = []
var _selected_index: int = 0

func set_character(chara: CharacterBody3D) -> void:
	tooltip_text = "[b]Structure Placer[/b]\nClick: place structure  |  R: cycle structures"
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)
	_load_structures()


func _load_structures() -> void:
	_structures.clear()
	_selected_index = 0
	if not DirAccess.dir_exists_absolute(STRUCTURES_DIR):
		return
	var dir := DirAccess.open(STRUCTURES_DIR)
	if not dir:
		return
	dir.list_dir_begin()
	var file_name := dir.get_next()
	while file_name != "":
		if file_name.ends_with(".tres"):
			var structure := load("%s/%s" % [STRUCTURES_DIR, file_name]) as SavedVoxelStructure
			if structure:
				_structures.append(structure)
		file_name = dir.get_next()
	dir.list_dir_end()


func _physics_process(_delta: float) -> void:
	if not voxel_interactor or not character:
		return
	voxel_interactor.update_target(character)
	_draw_ghost()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("structure_cycle") and not _structures.is_empty():
		_selected_index = (_selected_index + 1) % _structures.size()


func _current_structure() -> SavedVoxelStructure:
	if _selected_index < _structures.size():
		return _structures[_selected_index]
	return null


func _target_pos():
	var structure := _current_structure()
	if not structure or not voxel_interactor.has_valid_target():
		return null
	var placement_pos = voxel_interactor.get_placement_position()
	if placement_pos == null:
		return null
	return Vector3i(placement_pos) - structure.pivot


func _draw_ghost() -> void:
	var structure := _current_structure()
	if not structure or not voxel_interactor._terrain:
		return
	var target_pos = _target_pos()
	if target_pos == null:
		return
	var origin: Vector3 = voxel_interactor._terrain.global_position
	DebugDraw3D.draw_aabb(AABB(Vector3(target_pos) + origin, Vector3(structure.size)), Color(0.2, 1.0, 1.0, 0.9))


func use_item(pressure: float) -> void:
	super.use_item(pressure)
	var structure := _current_structure()
	if not structure:
		return
	var target_pos = _target_pos()
	if target_pos == null:
		return
	voxel_interactor._terrain_tool.paste_masked(
		target_pos, structure.to_voxel_buffer(),
		1 << VoxelBuffer.CHANNEL_TYPE, VoxelBuffer.CHANNEL_TYPE, VoxelTypes.AIR)


func on_unequipped() -> void:
	super.on_unequipped()
	if voxel_interactor:
		voxel_interactor.cleanup()

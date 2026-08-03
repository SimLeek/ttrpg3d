extends BaseItem
class_name VoxelPlacerItem

## Item that allows placing or interacting with voxels using a raycast-based placer.
##
## Delegates all voxel targeting, visualization, and hit detection logic to a VoxelPlacer resource.
## Maintains the original interface expected by the inventory/equipment system.

@export var voxel_interactor: VoxelInteractor

## Voxel types that currently have real block models in voxel_library.tres
## (gases/fluids are excluded since they aren't meant to be hand-placed solids).
## Cycle with the voxel_select_next/voxel_select_prev input actions.
const PLACEABLE_VOXELS: Array[Dictionary] = [
	{"id": VoxelTypes.DIRT, "name": "Dirt"},
	{"id": VoxelTypes.GRASS, "name": "Grass"},
	{"id": VoxelTypes.LOG, "name": "Log"},
	{"id": VoxelTypes.LEAVES, "name": "Leaves"},
	{"id": VoxelTypes.TALL_GRASS, "name": "Tall Grass"},
	{"id": VoxelTypes.DEAD_SHRUB, "name": "Dead Shrub"},
	{"id": VoxelTypes.GRANITE, "name": "Granite"},
	{"id": VoxelTypes.LIMESTONE, "name": "Limestone"},
	{"id": VoxelTypes.MUDSTONE, "name": "Mudstone"},
	{"id": VoxelTypes.PLASTIGLOMERATE, "name": "Plastiglomerate"},
	{"id": VoxelTypes.COAL_ORE, "name": "Coal Ore"},
	{"id": VoxelTypes.GYPSUM_ORE, "name": "Gypsum Ore"},
	{"id": VoxelTypes.HALITE_ORE, "name": "Halite Ore"},
	{"id": VoxelTypes.COPPER_ORE, "name": "Copper Ore"},
	{"id": VoxelTypes.QUARTZ, "name": "Quartz"},
	{"id": VoxelTypes.MAGNETITE, "name": "Magnetite"},
]

var _selected_index: int = 0

func set_character(chara: CharacterBody3D) -> void:
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)
	_update_selection_ui()


func _physics_process(delta: float) -> void:
	if not voxel_interactor or not character:
		return

	voxel_interactor.update_target(character)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("voxel_select_next"):
		_selected_index = (_selected_index + 1) % PLACEABLE_VOXELS.size()
		_update_selection_ui()
	elif event.is_action_pressed("voxel_select_prev"):
		_selected_index = (_selected_index - 1 + PLACEABLE_VOXELS.size()) % PLACEABLE_VOXELS.size()
		_update_selection_ui()


func use_item(pressure: float) -> void:
	super.use_item(pressure)

	if not voxel_interactor or not voxel_interactor.has_valid_target():
		return

	var placement_pos = voxel_interactor.get_placement_position()
	if placement_pos == null:
		return

	voxel_interactor._terrain_tool.set_voxel(placement_pos, PLACEABLE_VOXELS[_selected_index].id)


func _update_selection_ui() -> void:
	if not character:
		return
	var hud = character.get("hud_node")
	if hud and hud.has_method("update_selected_voxel_ui"):
		hud.update_selected_voxel_ui(PLACEABLE_VOXELS[_selected_index].name)


func on_unequipped() -> void:
	super.on_unequipped()
	
	if voxel_interactor:
		voxel_interactor.cleanup()

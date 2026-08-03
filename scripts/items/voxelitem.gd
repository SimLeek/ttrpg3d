extends BaseItem
class_name VoxelPlacerItem

## Item that allows placing or interacting with voxels using a raycast-based placer.
##
## Delegates all voxel targeting, visualization, and hit detection logic to a VoxelPlacer resource.
## Maintains the original interface expected by the inventory/equipment system.

@export var voxel_interactor: VoxelInteractor

## The active block type comes from the VoxelHotbar UI (scripts/ui/voxel_hotbar.gd),
## found via the "voxel_hotbar" group -- see that script for selection/cycling input.

func set_character(chara: CharacterBody3D) -> void:
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)


func _physics_process(delta: float) -> void:
	if not voxel_interactor or not character:
		return

	voxel_interactor.update_target(character)


func use_item(pressure: float) -> void:
	super.use_item(pressure)

	if not voxel_interactor or not voxel_interactor.has_valid_target():
		return

	var placement_pos = voxel_interactor.get_placement_position()
	if placement_pos == null:
		return

	var hotbar = get_tree().get_first_node_in_group("voxel_hotbar")
	var voxel_id: int = hotbar.get_selected_voxel_id() if hotbar else VoxelTypes.DIRT
	voxel_interactor._terrain_tool.set_voxel(placement_pos, voxel_id)


func on_unequipped() -> void:
	super.on_unequipped()
	
	if voxel_interactor:
		voxel_interactor.cleanup()

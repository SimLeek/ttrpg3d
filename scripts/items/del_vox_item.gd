extends BaseItem
class_name VoxelDeleterItem

## Item that allows placing or interacting with voxels using a raycast-based placer.
##
## Delegates all voxel targeting, visualization, and hit detection logic to a VoxelPlacer resource.
## Maintains the original interface expected by the inventory/equipment system.

@export var voxel_interactor: VoxelInteractor

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
	
	# -----------------------------------------------------------------
	# Place your actual voxel placement / removal / modification logic here
	# -----------------------------------------------------------------
	# Example placeholder behavior:
	#var placement_pos = voxel_interactor.get_placement_position()
	#placement_pos = Vector3i(placement_pos.round())

	#placement_pos.x -= 1
	var hit_info = voxel_interactor.get_hit_info()
	
	#if placement_pos != null:
	#	print("VoxelPlacerItem: Attempting to place voxel at ", placement_pos)
	#	voxel_interactor._terrain_tool.set_voxel(placement_pos, 1)
	
	# Or example removal:
	print("setting?")
	if hit_info and hit_info.voxel_id != 0:
		print("deleting vox")
		voxel_interactor._terrain_tool.set_voxel(hit_info.position, 0)


func on_unequipped() -> void:
	super.on_unequipped()
	
	if voxel_interactor:
		voxel_interactor.cleanup()

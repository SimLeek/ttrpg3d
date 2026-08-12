extends BaseItem
class_name VoxelPlacerItem

## Item that allows placing or interacting with voxels using a raycast-based placer.
##
## Delegates all voxel targeting, visualization, and hit detection logic to a VoxelPlacer resource.
## Maintains the original interface expected by the inventory/equipment system.

@export var voxel_interactor: VoxelInteractor

## Which block type this placer instance places. One VoxelPlacerItem is
## instantiated per block inventory item (see scripts/pcg/item_catalog.gd),
## configured with this right after instantiate() -- it isn't queried
## from a shared selector, so several placers with different ids could
## exist (or be equipped) independently.
@export var voxel_id: int = VoxelTypes.DIRT

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

	voxel_interactor._terrain_tool.set_voxel(placement_pos, voxel_id)
	_maybe_apply_light(placement_pos)


## Phase 7: "settings -> graphics -> light blocks affect surroundings" --
## opt-in (costs more than the block's own always-on emissive material
## glow, hence a graphics setting rather than automatic) extra effect for
## light-level voxels (VoxelTypes.LIGHT_LEVELS) beyond their own material
## glow, which by itself only lights the block's own surface -- Godot's
## renderer doesn't bounce emission onto neighboring geometry.
## REAL_LIGHTS: pooled shadow-casting OmniLight3D via LightRegistry,
## correct occlusion. GLOW mode is currently disabled -- the planned
## implementation (VoxelLighting, painting VoxelBuffer.CHANNEL_COLOR data
## for VoxelMesherBlocky's TINT_RAW_COLOR to bake into vertex colors) hit
## real problems live-testing (channel-depth mismatches between chunks
## generated before/after enabling the channel, cascading to visibly
## broken/white-washed terrain) that go deeper than this session had room
## to chase down safely -- see TODO_battle_and_tools.md's Phase 7 entry.
## voxel_lighting.gd is left in place, unused, as a starting point.
##
## Not tracked for removal if a light block is later broken -- there's no
## working break mechanic in this codebase yet (scripts/items/del_vox_item.gd
## is an unregistered stub, never wired into ItemCatalog), so nothing can
## remove this block to begin with.
func _maybe_apply_light(local_pos: Vector3i) -> void:
	if not VoxelTypes.LIGHT_LEVELS.has(voxel_id):
		return
	if not character or not character.voxel_terrain:
		return
	if GameSettings.light_block_mode != GameSettings.LightBlockMode.REAL_LIGHTS:
		return
	var world_pos: Vector3 = Vector3(local_pos) + Vector3(0.5, 0.5, 0.5) + character.voxel_terrain.global_position
	LightRegistry.register_light_block(world_pos)


func on_unequipped() -> void:
	super.on_unequipped()
	
	if voxel_interactor:
		voxel_interactor.cleanup()

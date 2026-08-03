extends RefCounted
class_name ItemCatalog

## Everything that can occupy an inventory/hotbar slot -- items, not just
## blocks. A block is one *kind* of item (kind == "block"): picking it up
## equips a generic VoxelPlacerItem configured to place that voxel id.
## Non-block tools (deleting, structure save/place, eventually weapons)
## are kind == "tool": equipping just instantiates their item_script as-is.
## Each entry's item_script is instantiated fresh and set on a plain Node3D
## when equipped -- matching how items are already defined in Blob.tscn
## (bare Node3D + script, no dedicated mesh).

const BLOCK_PLACER_SCRIPT := preload("res://scripts/items/voxelitem.gd")

## Fixed non-block tools available from the inventory, beyond whatever
## blocks the voxel library currently defines. Add new tools here as they
## are built (e.g. a structure saver/placer).
const TOOL_ITEMS: Array[Dictionary] = []

static func get_available_items(library: VoxelBlockyLibrary) -> Array[Dictionary]:
	var items: Array[Dictionary] = []
	items.append_array(TOOL_ITEMS)
	for block in VoxelCatalog.get_placeable_voxels(library):
		items.append({
			"kind": "block",
			"id": "block_%d" % block.id,
			"voxel_id": block.id,
			"name": block.name,
			"icon": block.icon,
			"item_script": BLOCK_PLACER_SCRIPT,
		})
	return items

## Instantiates a fresh item node for the given catalog entry, ready to
## hand to HandController.equip_item().
static func instantiate_item(entry: Dictionary) -> Node3D:
	var instance := Node3D.new()
	instance.set_script(entry.item_script)
	if entry.kind == "block":
		instance.voxel_id = entry.voxel_id
	return instance

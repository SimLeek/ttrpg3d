extends RefCounted
class_name ItemCatalog

## Everything that can occupy an inventory/hotbar slot -- items, not just
## blocks. A block is one *kind* of item (kind == "block"): picking it up
## equips a generic VoxelPlacerItem configured to place that voxel id.
## Non-block tools (structure save/place, eventually weapons) are
## kind == "tool": equipping just instantiates their item_script as-is.
## Each entry's item_script is instantiated fresh and set on a plain Node3D
## when equipped -- matching how items are already defined in Blob.tscn
## (bare Node3D + script, no dedicated mesh).
##
## Each entry's optional "hint" is the single source of truth for that
## item's control hint -- shown both in the 2D inventory hover tooltip
## (scripts/ui/player_inventory.gd) and, on equip, via the in-world
## ItemTooltip billboard (BaseItem.tooltip_text, set by instantiate_item()).

const BLOCK_PLACER_SCRIPT := preload("res://scripts/items/voxelitem.gd")
const STRUCTURE_SAVER_SCRIPT := preload("res://scripts/items/structure_saver_item.gd")
const STRUCTURE_PLACER_SCRIPT := preload("res://scripts/items/structure_placer_item.gd")
const PLANE_SELECTOR_SCRIPT := preload("res://scripts/items/plane_selector_item.gd")
const WINGS_SCRIPT := preload("res://scripts/items/wings_item.gd")
const PHASING_GLOVES_SCRIPT := preload("res://scripts/items/phasing_gloves_item.gd")

static func get_available_items(library: VoxelBlockyLibrary) -> Array[Dictionary]:
	# Mod-registered voxels get appended to the library (assigning them an
	# id) the first time it's seen -- do this before scanning, so mod
	# blocks show up in the same pass as built-in ones, no separate merge
	# step needed for those.
	ModManager.apply_voxel_registrations(library)

	var items: Array[Dictionary] = []
	for block in VoxelCatalog.get_placeable_voxels(library):
		items.append({
			"kind": "block",
			"id": "block_%d" % block.id,
			"voxel_id": block.id,
			"name": block.name,
			"icon": block.icon,
			"item_script": BLOCK_PLACER_SCRIPT,
			"hint": "Click to place",
		})
	# Tools are appended after blocks so existing default hotbar slots keep
	# their familiar block ordering; the tools just land in the slots after.
	items.append_array(_tool_items())
	# Mod-registered non-block items (tools, etc.) -- ItemCatalog is the
	# merge point for these since they don't go through VoxelBlockyLibrary.
	items.append_array(ModManager.registered_items)
	return items

## Fixed non-block tools available from the inventory, beyond whatever
## blocks the voxel library currently defines. Add new tools here as
## they're built.
static func _tool_items() -> Array[Dictionary]:
	return [
		{
			"kind": "tool",
			"id": "tool_structure_saver",
			"name": "Structure Saver",
			"icon": _solid_icon(Color(0.2, 0.8, 0.8)),
			"item_script": STRUCTURE_SAVER_SCRIPT,
			"hint": "Click: set corner  |  R: resize  T: translate\nU/I/O + J/K/L -  X/Y/Z  |  P: pivot  G: save",
		},
		{
			"kind": "tool",
			"id": "tool_structure_placer",
			"name": "Structure Placer",
			"icon": _solid_icon(Color(0.7, 0.3, 0.9)),
			"item_script": STRUCTURE_PLACER_SCRIPT,
			"hint": "Click: place  |  C: cycle structure\nR: rotate  T: translate  |  U/I/O + J/K/L -  X/Y/Z\nM/N: rotation step",
		},
		{
			"kind": "tool",
			"id": "tool_plane_selector",
			"name": "Plane Selector",
			"icon": _solid_icon(Color(1.0, 0.85, 0.2)),
			"item_script": PLANE_SELECTOR_SCRIPT,
			"hint": "Click 3 points (not in a line) to define a build plane",
		},
		{
			"kind": "tool",
			"id": "tool_wings",
			"name": "Wings",
			"icon": _solid_icon(Color(0.6, 0.9, 1.0)),
			"item_script": WINGS_SCRIPT,
			"hint": "Equip: fly (Jump ascends, Shift descends). Unequip to stop.",
		},
		{
			"kind": "tool",
			"id": "tool_phasing_gloves",
			"name": "Phasing Gloves",
			"icon": _solid_icon(Color(0.9, 0.4, 0.9)),
			"item_script": PHASING_GLOVES_SCRIPT,
			"hint": "Equip: pass through terrain (Jump/Shift move vertically). Unequip to stop.",
		},
	]

## Flat-color placeholder icon for tools that don't have real art yet.
static func _solid_icon(color: Color) -> ImageTexture:
	var img := Image.create(16, 16, false, Image.FORMAT_RGBA8)
	img.fill(color)
	return ImageTexture.create_from_image(img)

## Instantiates a fresh item node for the given catalog entry, ready to
## hand to HandController.equip_item().
static func instantiate_item(entry: Dictionary) -> Node3D:
	var instance := Node3D.new()
	instance.set_script(entry.item_script)
	if entry.kind == "block":
		instance.voxel_id = entry.voxel_id
	instance.tooltip_text = entry.get("hint", "")
	return instance

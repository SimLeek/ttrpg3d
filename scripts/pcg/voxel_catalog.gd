extends RefCounted
class_name VoxelCatalog

## Discovers which voxel types have a real, placeable block model in a
## VoxelBlockyLibrary and returns their id, display name, and icon texture.
## New block types added to the library show up automatically with no
## script changes -- only the display name needs adding here.

const DISPLAY_NAMES: Dictionary = {
	VoxelTypes.DIRT: "Dirt",
	VoxelTypes.GRASS: "Grass",
	VoxelTypes.WATER_FULL: "Water",
	VoxelTypes.WATER_TOP: "Water (Top)",
	VoxelTypes.LOG: "Log",
	VoxelTypes.LEAVES: "Leaves",
	VoxelTypes.TALL_GRASS: "Tall Grass",
	VoxelTypes.DEAD_SHRUB: "Dead Shrub",
	VoxelTypes.GRANITE: "Granite",
	VoxelTypes.LIMESTONE: "Limestone",
	VoxelTypes.MUDSTONE: "Mudstone",
	VoxelTypes.PLASTIGLOMERATE: "Plastiglomerate",
	VoxelTypes.COAL_ORE: "Coal Ore",
	VoxelTypes.GYPSUM_ORE: "Gypsum Ore",
	VoxelTypes.HALITE_ORE: "Halite Ore",
	VoxelTypes.COPPER_ORE: "Copper Ore",
	VoxelTypes.QUARTZ: "Quartz",
	VoxelTypes.MAGNETITE: "Magnetite",
	VoxelTypes.GLASS: "Glass",
	VoxelTypes.LIGHT: "Light",
}

## Returns [{id, name, icon}] for every model in the library that has a real
## mesh and a readable albedo texture (gas/air placeholders and fluids are
## skipped since they aren't meant to be hand-placed).
static func get_placeable_voxels(library: VoxelBlockyLibrary) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	if not library:
		return result
	var models: Array = library.get("models")
	if models == null:
		return result
	for id in range(models.size()):
		var model = models[id]
		if model == null or not (model is VoxelBlockyModelMesh):
			continue
		var icon := _extract_icon(model)
		if icon == null:
			continue
		result.append({
			"id": id,
			"name": _display_name(id),
			"icon": icon,
		})
	return result

## Built-in name if this is a known id, else whatever a mod registered it
## with (ModManager.apply_voxel_registrations appends mod voxels to the
## library and records their assigned id -> name), else a generic fallback.
static func _display_name(id: int) -> String:
	if DISPLAY_NAMES.has(id):
		return DISPLAY_NAMES[id]
	var mod_name: String = ModManager.get_voxel_name(id)
	return mod_name if mod_name != "" else "Voxel %d" % id

static func _extract_icon(model: VoxelBlockyModelMesh) -> Texture2D:
	for surface in range(2):
		var material = model.get("material_override_%d" % surface)
		if material is ShaderMaterial:
			var tex = material.get_shader_parameter("albedo_texture")
			if tex is Texture2D:
				return tex
		elif material is StandardMaterial3D and material.albedo_texture:
			return material.albedo_texture
	return null

#tool
extends VoxelGeneratorScript

var HillyTerrainGenerator = preload("./hilly_terrain_region_generator.gd")

var _hilly_terrain_generator : TerrainGenerator

## Passthroughs so WorldGeneratorCatalog.instantiate_generator() (which
## just does instance.set(key, value) for each param) can reach the inner
## TerrainGenerator's own properties -- used by the plains_biome mod to
## get a tree-less, windmill-less, flatter variant without duplicating
## this whole generator.
@export var trees_enabled: bool = true:
	set(value):
		trees_enabled = value
		if _hilly_terrain_generator:
			_hilly_terrain_generator.trees_enabled = value

@export var windmills_enabled: bool = true:
	set(value):
		windmills_enabled = value
		if _hilly_terrain_generator:
			_hilly_terrain_generator.windmills_enabled = value

@export var height_scale: float = 1.0:
	set(value):
		height_scale = value
		if _hilly_terrain_generator:
			_hilly_terrain_generator.height_scale = value

func _init() -> void:
	_hilly_terrain_generator = HillyTerrainGenerator.new()
	_hilly_terrain_generator.trees_enabled = trees_enabled
	_hilly_terrain_generator.windmills_enabled = windmills_enabled
	_hilly_terrain_generator.height_scale = height_scale

func _get_used_channels_mask() -> int:
	return _hilly_terrain_generator.get_used_channels_mask()

func _generate_block(buffer: VoxelBuffer, origin_in_voxels: Vector3i, _unused_lod: int) -> void:
	_hilly_terrain_generator.generate_block(buffer, origin_in_voxels)

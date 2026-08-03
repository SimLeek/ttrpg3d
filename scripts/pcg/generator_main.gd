#tool
extends VoxelGeneratorScript

var HillyTerrainGenerator = preload("./hilly_terrain_region_generator.gd")

var _hilly_terrain_generator : TerrainGenerator

func _init() -> void:
	_hilly_terrain_generator = HillyTerrainGenerator.new()

func _get_used_channels_mask() -> int:
	return _hilly_terrain_generator.get_used_channels_mask()

func _generate_block(buffer: VoxelBuffer, origin_in_voxels: Vector3i, _unused_lod: int) -> void:
	_hilly_terrain_generator.generate_block(buffer, origin_in_voxels)

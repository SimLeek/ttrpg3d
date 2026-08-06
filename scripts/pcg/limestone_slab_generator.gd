extends VoxelGeneratorScript
class_name LimestoneSlabGenerator

## A finite, repeatable world generator: a solid width x height x depth
## slab of limestone starting at the origin, air everywhere else. No
## randomness at all -- same params always produce the same (trivial)
## result, and it's bounded (not an endless streaming terrain), which is
## what makes it "finite" in WorldGeneratorCatalog's classification.

@export var width: int = 32
@export var height: int = 8
@export var depth: int = 32

func _get_used_channels_mask() -> int:
	return 1 << VoxelBuffer.CHANNEL_TYPE

func _generate_block(buffer: VoxelBuffer, origin_in_voxels: Vector3i, _lod: int) -> void:
	var bs := buffer.get_size()
	for x in range(bs.x):
		var wx := origin_in_voxels.x + x
		if wx < 0 or wx >= width:
			continue
		for y in range(bs.y):
			var wy := origin_in_voxels.y + y
			if wy < 0 or wy >= height:
				continue
			for z in range(bs.z):
				var wz := origin_in_voxels.z + z
				if wz < 0 or wz >= depth:
					continue
				buffer.set_voxel(VoxelTypes.LIMESTONE, x, y, z, VoxelBuffer.CHANNEL_TYPE)

## Where the player should spawn for a slab of these dimensions -- centered
## above it, not inside/under it.
static func spawn_position(w: int, h: int, d: int) -> Vector3:
	return Vector3(w / 2.0, h + 2.0, d / 2.0)

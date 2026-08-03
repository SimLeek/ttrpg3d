extends Resource
class_name SavedVoxelStructure

## A player-saved voxel structure: size, a pivot offset (from the min
## corner, used to align placement), and the voxel-type data as a flat
## byte array. Saved/loaded as user://structures/*.tres by
## StructureSaverItem/StructurePlacerItem.
##
## Distinct from the PCG system's own Structure (scripts/pcg/structure.gd,
## an in-memory offset+VoxelBuffer pair used by the terrain generators) --
## that one is never saved to disk, so it doesn't need this class's
## byte-array serialization, and VoxelBuffer itself is a RefCounted (not a
## Resource) so it can't be embedded directly in a saved .tres here.

@export var size: Vector3i = Vector3i.ONE
@export var pivot: Vector3i = Vector3i.ZERO
## Flattened voxel type ids, x + y*size.x + z*size.x*size.y.
## get/set_channel_as_byte_array() hit an engine-side size assertion on
## copied (possibly-uniform/compressed) regions, so this goes through the
## plain per-voxel API instead -- slower, but robust, and structures here
## are small enough (rooms/buildings, not whole terrain chunks) that it's
## not a real cost.
@export var voxel_types: PackedInt32Array = PackedInt32Array()

func from_voxel_buffer(buffer: VoxelBuffer) -> void:
	size = buffer.get_size()
	voxel_types = PackedInt32Array()
	voxel_types.resize(size.x * size.y * size.z)
	var i := 0
	for z in size.z:
		for y in size.y:
			for x in size.x:
				voxel_types[i] = buffer.get_voxel(x, y, z, VoxelBuffer.CHANNEL_TYPE)
				i += 1

func to_voxel_buffer() -> VoxelBuffer:
	var buffer := VoxelBuffer.new()
	buffer.create(size.x, size.y, size.z)
	var i := 0
	for z in size.z:
		for y in size.y:
			for x in size.x:
				buffer.set_voxel(voxel_types[i], x, y, z, VoxelBuffer.CHANNEL_TYPE)
				i += 1
	return buffer

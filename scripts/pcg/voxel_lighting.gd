extends RefCounted
class_name VoxelLighting

## Phase 7 "cheap" light mode: paints a real per-voxel light falloff into
## nearby solid voxels' CHANNEL_COLOR data (a per-voxel-instance channel
## the voxel plugin already supports -- the same kind of mechanism games
## use for chest contents/toggle state via voxel metadata, just the
## *color* channel specifically, since VoxelMesherBlocky can bake that one
## into vertex colors via tint_mode = TINT_RAW_COLOR, see
## levels/voxel_main_world_mesher.tres). The shared cutout shader
## (xray_if_behind_cutout.gdshader) reads the baked vertex color to boost
## EMISSION -- real per-block data, not a shader-side distance
## computation against a list of light positions.
##
## Deliberately a one-shot CPU paint at placement time, not a continuously
## recomputed field: cheap (only visits a small radius), but means it
## doesn't retroactively light up if the graphics setting is turned on
## *after* a light block was already placed, and multiple overlapping
## lights just take whichever was painted last rather than combining --
## acceptable for the "prove it out" scope of this demo block, revisit if
## it needs to be more correct later.

const RADIUS := 8

## Paints falloff (1.0 at the light itself, 0.0 at RADIUS) x `level` into
## every non-air voxel within RADIUS of `terrain_local_pos`. `vt` must
## already be set up against the right terrain (VoxelInteractor's own
## _terrain_tool, same one placement itself just used).
static func apply_light(vt: VoxelTool, terrain_local_pos: Vector3i, level: float) -> void:
	for dx in range(-RADIUS, RADIUS + 1):
		for dy in range(-RADIUS, RADIUS + 1):
			for dz in range(-RADIUS, RADIUS + 1):
				var offset := Vector3i(dx, dy, dz)
				var dist := Vector3(offset).length()
				if dist > RADIUS:
					continue
				var pos := terrain_local_pos + offset
				vt.set_channel(VoxelBuffer.CHANNEL_TYPE)
				if vt.get_voxel(pos) == VoxelTypes.AIR:
					continue
				var falloff: float = clamp(1.0 - dist / float(RADIUS), 0.0, 1.0) * level
				vt.set_channel(VoxelBuffer.CHANNEL_COLOR)
				# color_to_u32, not color_to_u16: matches the DEPTH_32_BIT
				# (8 bits/component) hilly_terrain_region_generator.gd now
				# forces CHANNEL_COLOR to -- the only two depths
				# TINT_RAW_COLOR supports are 16-bit (4 bits/component) and
				# 32-bit (8 bits/component), and the encoding must match
				# the buffer's actual depth or this is silently wrong.
				vt.set_voxel(pos, vt.color_to_u32(Color(falloff, falloff, falloff)))
	vt.set_channel(VoxelBuffer.CHANNEL_TYPE)

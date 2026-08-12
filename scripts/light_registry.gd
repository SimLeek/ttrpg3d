extends Node

## Autoload. Phase 7 "real" light mode: tracks every placed light-level
## voxel's world position (VoxelTypes.LIGHT_LEVELS), and keeps a pool of
## real shadow-casting OmniLight3D instances positioned at the
## GameSettings.active_light_count nearest ones to the player -- correct
## occlusion (blocked by walls, unlike the cheap GLOW mode's baked-color
## boost), but real dynamic shadow-casting lights are expensive, so the
## count is capped and only recomputed periodically, not every frame.
##
## Only matters when GameSettings.light_block_mode == REAL_LIGHTS; GLOW
## mode doesn't use this at all (see scripts/pcg/voxel_lighting.gd -- a
## one-shot CPU paint at placement time, no ongoing tracking needed).
##
## Registered positions are re-validated every refresh (see
## _prune_removed_lights()) -- confirmed live that blocks CAN be removed
## (contrary to this file's earlier assumption that nothing could), and a
## removed light block's OmniLight3D was staying lit with nothing backing
## it. Rather than hook into whichever specific removal path did it (there
## may be more than one), this just re-checks each tracked position's
## actual current voxel id against VoxelTypes.LIGHT_LEVELS and drops it if
## it no longer qualifies -- self-heals regardless of *how* a block
## stopped being a light source (broken, overwritten by a structure
## paste, whatever).

const REFRESH_INTERVAL := 0.5
const LIGHT_ENERGY := 2.0
const LIGHT_RANGE := 10.0

var _light_block_positions: Array[Vector3] = []
var _pool: Array[OmniLight3D] = []
var _timer := 0.0

func register_light_block(world_pos: Vector3) -> void:
	_light_block_positions.append(world_pos)
	_refresh()

func _process(delta: float) -> void:
	if GameSettings.light_block_mode != GameSettings.LightBlockMode.REAL_LIGHTS:
		if not _pool.is_empty():
			_clear_pool()
		return
	_timer += delta
	if _timer < REFRESH_INTERVAL:
		return
	_timer = 0.0
	_refresh()

func _refresh() -> void:
	if GameSettings.light_block_mode != GameSettings.LightBlockMode.REAL_LIGHTS:
		return
	var player := get_tree().get_first_node_in_group("player")
	_prune_removed_lights(player)
	if _light_block_positions.is_empty():
		_clear_pool()
		return
	var origin: Vector3 = player.global_position if player else Vector3.ZERO
	var sorted := _light_block_positions.duplicate()
	sorted.sort_custom(func(a, b): return a.distance_squared_to(origin) < b.distance_squared_to(origin))
	var count: int = min(GameSettings.active_light_count, sorted.size())
	while _pool.size() < count:
		var light := OmniLight3D.new()
		light.shadow_enabled = true
		light.light_energy = LIGHT_ENERGY
		light.omni_range = LIGHT_RANGE
		light.light_color = Color(1, 1, 1)
		add_child(light)
		_pool.append(light)
	for i in range(_pool.size()):
		if i < count:
			_pool[i].global_position = sorted[i]
			_pool[i].visible = true
		else:
			_pool[i].visible = false

## Drops any tracked position whose voxel no longer has a registered light
## level -- broken, overwritten, whatever. Needs the player purely to
## reach voxel_terrain/get_voxel_tool(); if there's no player yet, skip
## pruning this cycle rather than guess.
func _prune_removed_lights(player: Node) -> void:
	if not player or not ("voxel_terrain" in player) or not player.voxel_terrain:
		return
	var terrain: VoxelTerrain = player.voxel_terrain
	var vt := terrain.get_voxel_tool()
	if not vt:
		return
	vt.set_channel(VoxelBuffer.CHANNEL_TYPE)
	var still_lit: Array[Vector3] = []
	for world_pos in _light_block_positions:
		var local: Vector3 = world_pos - terrain.global_position
		var pos := Vector3i(floori(local.x), floori(local.y), floori(local.z))
		if VoxelTypes.LIGHT_LEVELS.has(vt.get_voxel(pos)):
			still_lit.append(world_pos)
	_light_block_positions = still_lit

func _clear_pool() -> void:
	for light in _pool:
		light.queue_free()
	_pool.clear()

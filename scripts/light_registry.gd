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
## Not tracked for removal if a light block is later broken -- see
## voxelitem.gd's own note: no working break mechanic exists in this
## codebase yet, so nothing can remove a placed light block to begin with.

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
	if _light_block_positions.is_empty():
		_clear_pool()
		return
	var player := get_tree().get_first_node_in_group("player")
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

func _clear_pool() -> void:
	for light in _pool:
		light.queue_free()
	_pool.clear()

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
##
## Persistence: "if I place them then it works, but if I save the world
## and come back to it, then the lights no longer turn on" --
## register_light_block() only ever got called from voxelitem.gd's own
## placement code, so a light block from a previous session (this list is
## pure runtime state, never itself saved) was never in the list to begin
## with. First attempt was scanning every loaded chunk's voxels for
## LIGHT_LEVELS matches (VoxelTerrain.block_loaded) -- worked, but (a) was
## expensive enough to cause noticeable pauses while moving (checking
## get_data_block_size()^3 voxels per loaded chunk), and (b) surfaced a
## real, separate bug live: mod-registered voxel ids are assigned
## `library.models.size()` at registration time (scripts/modding/mod_manager.gd),
## so adding Glass/Light as new built-in blocks shifted what ids 24/25
## mean in any older saved world that had a mod voxel occupying those
## slots -- the scan found a bunch of what used to be a mod's wood-plank
## block, now misread as "Light" purely because of the id collision.
## Confirmed with you as low-impact/acceptable to leave for now (only the
## wood-plank mod block was affected), but not something to build more
## discovery logic on top of.
##
## Replaced with an explicit per-world save file instead
## (user://world_saves/<world_id>_lights.json) -- register_light_block()
## and _prune_removed_lights() both write it, and switching to a world
## (detected by polling WorldManager.current_world's id, same as how
## WorldManager itself is the source of truth for which world is active)
## loads it. No voxel scanning at all, so no id-collision risk and no
## per-chunk cost -- just a small JSON array, same category of file as
## WorldManager's own world_saves/<id>.sqlite.

const REFRESH_INTERVAL := 0.5
const LIGHT_ENERGY := 2.0
const LIGHT_RANGE := 10.0

var _light_block_positions: Array[Vector3] = []
var _pool: Array[OmniLight3D] = []
var _timer := 0.0
var _current_world_id: String = ""

## Dedups against already-tracked positions -- placement can otherwise
## register the same spot more than once (e.g. re-running use_item at the
## same target), which would just waste sort/pool/save work, not cause
## incorrect behavior, but there's no reason to let it grow unbounded.
func register_light_block(world_pos: Vector3) -> void:
	for existing in _light_block_positions:
		if existing.distance_squared_to(world_pos) < 0.01:
			return
	_light_block_positions.append(world_pos)
	_save_lights_for_world()
	_refresh()

func _process(delta: float) -> void:
	_maybe_switch_world()
	if GameSettings.light_block_mode != GameSettings.LightBlockMode.REAL_LIGHTS:
		if not _pool.is_empty():
			_clear_pool()
		return
	_timer += delta
	if _timer < REFRESH_INTERVAL:
		return
	_timer = 0.0
	_refresh()

## Loads the current world's saved light positions once per world (id
## change), same "poll WorldManager.current_world" pattern other systems
## in this codebase use to notice a switch -- no signal needed since
## WorldManager already keeps this field authoritative and up to date.
func _maybe_switch_world() -> void:
	var world_id: String = WorldManager.current_world.get("id", "")
	if world_id == _current_world_id:
		return
	_current_world_id = world_id
	_light_block_positions.clear()
	_clear_pool()
	if world_id != "":
		_load_lights_for_world(world_id)

func _lights_path(world_id: String) -> String:
	return "%s%s_lights.json" % [WorldManager.WORLD_SAVES_DIR, world_id]

func _load_lights_for_world(world_id: String) -> void:
	var path := _lights_path(world_id)
	if not FileAccess.file_exists(path):
		return
	var f := FileAccess.open(path, FileAccess.READ)
	if not f:
		return
	var parsed = JSON.parse_string(f.get_as_text())
	if parsed is Array:
		for p in parsed:
			if p is Array and p.size() == 3:
				_light_block_positions.append(Vector3(p[0], p[1], p[2]))

func _save_lights_for_world() -> void:
	if _current_world_id == "":
		return
	DirAccess.make_dir_recursive_absolute(WorldManager.WORLD_SAVES_DIR)
	var f := FileAccess.open(_lights_path(_current_world_id), FileAccess.WRITE)
	if not f:
		return
	var out := []
	for p in _light_block_positions:
		out.append([p.x, p.y, p.z])
	f.store_string(JSON.stringify(out))

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
## pruning this cycle rather than guess. Persists the change so a removed
## light doesn't come back on the next world load.
##
## Critical: a position whose containing chunk isn't currently LOADED
## (out of streaming range, or mid-world-switch while the old terrain is
## tearing down) must NOT be treated as "not a light anymore" -- confirmed
## live that get_voxel() on an unloaded block just reads back a default/
## empty value rather than erroring, which was wrongly pruning (and
## persisting the loss of) lights the moment their chunk streamed out or
## the world switched away, corrupting the very save file this exists to
## protect. has_data_block() gates the check so an unloaded position is
## just left alone/assumed still valid, not proven gone.
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
		if not terrain.has_data_block(terrain.voxel_to_data_block(local)):
			still_lit.append(world_pos)  # unloaded -- can't tell, assume still valid
		elif VoxelTypes.LIGHT_LEVELS.has(vt.get_voxel(pos)):
			still_lit.append(world_pos)
	if still_lit.size() != _light_block_positions.size():
		_light_block_positions = still_lit
		_save_lights_for_world()

func _clear_pool() -> void:
	for light in _pool:
		light.queue_free()
	_pool.clear()

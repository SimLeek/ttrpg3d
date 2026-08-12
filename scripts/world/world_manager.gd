extends Node

## Autoload. Tracks known "worlds" (Roll20-page-style: switch between them
## without restarting the game) -- each is a generator id + params + a
## display name, persisted to user://worlds.json. Switching sets
## pending_world and reloads the level scene; center_of_universe.gd (the
## scene root) reads pending_world in _ready() and applies the generator/
## spawn position/sky before the terrain starts streaming chunks.

const WORLDS_FILE := "user://worlds.json"
const LEVEL_SCENE := "res://levels/voxel_main_world.tscn"
const WORLD_SAVES_DIR := "user://world_saves/"

var worlds: Array[Dictionary] = []  # {id, name, generator_id, params}

## Set by switch_to_world() right before reloading the scene; read (and
## should be cleared to {} after use) by whatever applies it on the new
## scene's _ready().
var pending_world: Dictionary = {}

## Whichever world is actually loaded right now -- kept up to date by
## switch_to_world() rather than only tracked via the transient
## pending_world handoff, so respawn_in_current_world() (player death)
## knows which world to reload back into instead of falling back to
## whatever the level scene's own default terrain config is.
var current_world: Dictionary = {}

func _ready() -> void:
	_load_worlds()
	if worlds.is_empty():
		_add_world("Hilly World", "hilly", {})
	current_world = worlds[0]

func create_world(display_name: String, generator_id: String, params: Dictionary) -> Dictionary:
	return _add_world(display_name, generator_id, params)

func switch_to_world(world: Dictionary) -> void:
	# Switching can be triggered from a menu that paused the tree (e.g.
	# dm_world_menu.gd, so WASD doesn't move the player while typing a
	# world name) without that menu ever explicitly closing/unpausing
	# first -- get_tree().paused persists across change_scene_to_file, and
	# UiPauseGate's reasons dict would too (it's an autoload; the menu
	# instances that requested a pause don't survive the reload to release
	# it themselves) -- so without this the freshly-loaded world would
	# come up frozen, and stay that way. Same story for InputController's
	# capture reasons (dm_world_menu.gd's own "dm_world_menu" reason, most
	# likely, from switching worlds without closing the menu first) --
	# without releasing those too, the new world comes up with movement
	# and item use silently blocked instead of frozen outright, since both
	# are gated on InputController.is_captured() now.
	UiPauseGate.release_all()
	InputController.release_all_captures()
	await _flush_current_world()
	current_world = world
	pending_world = world
	get_tree().change_scene_to_file(LEVEL_SCENE)

## Reload the level scene back into whatever world the player was actually
## in (e.g. on death) instead of get_tree().reload_current_scene(), which
## re-instantiates the scene file's own baked-in default terrain config --
## silently dropping the player into "Hilly World" regardless of which
## world they'd switched to.
func respawn_in_current_world() -> void:
	if current_world.is_empty():
		get_tree().reload_current_scene()
		return
	switch_to_world(current_world)

## Voxel edits only get written to a VoxelStreamSQLite when a block
## unloads or save_modified_blocks() is called explicitly -- freeing the
## terrain node via change_scene_to_file() does neither, so without this
## every edit made since the last block-unload would be silently lost on
## world switch.
func _flush_current_world() -> void:
	var scene := get_tree().current_scene
	if not scene:
		return
	var terrain: VoxelTerrain = scene.get_node_or_null("World/VoxelTerrain")
	if not terrain:
		return
	var tracker := terrain.save_modified_blocks()
	if not tracker:
		return
	while not tracker.is_complete():
		await get_tree().process_frame

## Per-world save file for a VoxelStreamSQLite -- voxel edits made in a
## world persist here across switches/relaunches. One file per world id,
## so "reset" is just deleting this file (regenerates fresh from the
## generator next load) and "delete" removes it plus the world's list
## entry.
func get_stream_path(world_id: String) -> String:
	return "%s%s.sqlite" % [WORLD_SAVES_DIR, world_id]

## Human-readable size of a world's save file ("no save data" if it hasn't
## been written to yet -- e.g. a brand new world, or right after Reset).
func get_save_size_string(world_id: String) -> String:
	var path := get_stream_path(world_id)
	if not FileAccess.file_exists(path):
		return "no save data"
	var f := FileAccess.open(path, FileAccess.READ)
	if not f:
		return "no save data"
	return _format_bytes(f.get_length())

func _format_bytes(size: int) -> String:
	var units := ["B", "KB", "MB", "GB"]
	var value := float(size)
	var unit_index := 0
	while value >= 1024.0 and unit_index < units.size() - 1:
		value /= 1024.0
		unit_index += 1
	if unit_index == 0:
		return "%d %s" % [size, units[unit_index]]
	return "%.1f %s" % [value, units[unit_index]]

func reset_world(world_id: String) -> void:
	var path := get_stream_path(world_id)
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)

func delete_world(world_id: String) -> void:
	for i in range(worlds.size()):
		if worlds[i].get("id", "") == world_id:
			worlds.remove_at(i)
			break
	_save_worlds()
	reset_world(world_id)

func _add_world(display_name: String, generator_id: String, params: Dictionary) -> Dictionary:
	var world := {
		"id": "world_%d" % _next_world_number(),
		"name": display_name,
		"generator_id": generator_id,
		"params": params,
	}
	worlds.append(world)
	_save_worlds()
	return world

## Derived from existing world ids (max "world_N" suffix + 1) rather than
## worlds.size(), so a deleted-then-recreated world can't collide with an
## older world's still-on-disk save file.
func _next_world_number() -> int:
	var max_n := -1
	for w in worlds:
		var id: String = w.get("id", "")
		if id.begins_with("world_"):
			max_n = max(max_n, id.substr(6).to_int())
	return max_n + 1

func _load_worlds() -> void:
	if not FileAccess.file_exists(WORLDS_FILE):
		return
	var f := FileAccess.open(WORLDS_FILE, FileAccess.READ)
	if not f:
		return
	var parsed = JSON.parse_string(f.get_as_text())
	if parsed is Array:
		for w in parsed:
			if w is Dictionary:
				worlds.append(w)

func _save_worlds() -> void:
	var f := FileAccess.open(WORLDS_FILE, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(worlds, "\t"))

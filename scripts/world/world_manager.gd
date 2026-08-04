extends Node

## Autoload. Tracks known "worlds" (Roll20-page-style: switch between them
## without restarting the game) -- each is a generator id + params + a
## display name, persisted to user://worlds.json. Switching sets
## pending_world and reloads the level scene; center_of_universe.gd (the
## scene root) reads pending_world in _ready() and applies the generator/
## spawn position/sky before the terrain starts streaming chunks.

const WORLDS_FILE := "user://worlds.json"
const LEVEL_SCENE := "res://levels/voxel_main_world.tscn"

var worlds: Array[Dictionary] = []  # {id, name, generator_id, params}

## Set by switch_to_world() right before reloading the scene; read (and
## should be cleared to {} after use) by whatever applies it on the new
## scene's _ready().
var pending_world: Dictionary = {}

func _ready() -> void:
	_load_worlds()
	if worlds.is_empty():
		_add_world("Hilly World", "hilly", {})

func create_world(display_name: String, generator_id: String, params: Dictionary) -> Dictionary:
	return _add_world(display_name, generator_id, params)

func switch_to_world(world: Dictionary) -> void:
	pending_world = world
	get_tree().change_scene_to_file(LEVEL_SCENE)

func _add_world(display_name: String, generator_id: String, params: Dictionary) -> Dictionary:
	var world := {
		"id": "world_%d" % worlds.size(),
		"name": display_name,
		"generator_id": generator_id,
		"params": params,
	}
	worlds.append(world)
	_save_worlds()
	return world

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

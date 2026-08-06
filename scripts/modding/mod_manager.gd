extends Node

## Autoload. Discovers mods, loads the enable/disable checklist, and runs
## each enabled mod's entry script. See TODO_modding_and_worlds.md Phase 0
## for the full design writeup -- short version:
##
## - Mods live in res://mods/<id>/ (bundled/dev, checked into git) or
##   user://mods/<id>/ (actually user-installed, not checked in). Both get
##   scanned.
## - Each mod folder has a mod.json manifest: id, name, version, and an
##   entry_script path (relative to the mod folder) whose script defines
##   `static func register() -> void` and calls back into this autoload
##   (ModManager.register_item()/register_voxel()/register_generator()) to
##   add content.
## - user://mods_enabled.json is a flat {mod_id: bool} checklist. Newly
##   discovered mods default to enabled and get added automatically.
##   Editing the file by hand is the whole UI for now -- no in-game toggle
##   screen yet.
## - Toggling a mod off takes effect on next launch, not live -- voxel
##   registration appends to a level's VoxelBlockyLibrary in place, and
##   there's no clean way to un-append a model from an already-running
##   level. Not attempting hot-reload for this.

const MOD_SEARCH_DIRS := ["res://mods/", "user://mods/"]
const ENABLED_CHECKLIST_PATH := "user://mods_enabled.json"

## Discovered mods: {id, name, version, entry_script, path, enabled}.
var mods: Array[Dictionary] = []

## Entries contributed by register_item(), same shape as ItemCatalog's
## built-in entries -- ItemCatalog merges these in alongside its own.
var registered_items: Array[Dictionary] = []

## Entries contributed by register_voxel(): {name, model}. Queued at mod
## load time (boot, before any level's VoxelBlockyLibrary exists) and
## actually appended to a library the first time apply_voxel_registrations()
## sees it.
var registered_voxels: Array[Dictionary] = []

## Entries contributed by register_generator(), same shape as
## WorldGeneratorCatalog's built-in entries -- it merges these in alongside
## its own. Mods add these as data (id/name/classifications/script/params)
## pointing at an existing generator script rather than needing their own
## generation code -- see mods/plains_biome, which just reuses the core
## hilly generator with a different trees_enabled param.
var registered_generators: Array[Dictionary] = []

var _applied_libraries: Array = []
var _voxel_names_by_id: Dictionary = {}

func _ready() -> void:
	_discover_mods()
	_load_enabled_checklist()
	_run_enabled_mods()

# ---------------------------------------------------------------------
# Mod API -- called by mod entry scripts
# ---------------------------------------------------------------------

func register_item(entry: Dictionary) -> void:
	registered_items.append(entry)

func register_voxel(def: Dictionary) -> void:
	registered_voxels.append(def)

func register_generator(def: Dictionary) -> void:
	registered_generators.append(def)

## Appends any not-yet-applied registered_voxels to this library, assigning
## each the next free integer id (library.models.size() at append time).
## Idempotent per library instance. Called from player_inventory.gd's
## _refresh_items(), which already fetches the level's library each call.
func apply_voxel_registrations(library: VoxelBlockyLibrary) -> void:
	if not library or library in _applied_libraries or registered_voxels.is_empty():
		return
	_applied_libraries.append(library)

	var models: Array = library.get("models")
	if models == null:
		return
	for def in registered_voxels:
		var new_id := models.size()
		models.append(def.get("model"))
		_voxel_names_by_id[new_id] = def.get("name", "Voxel %d" % new_id)
	library.set("models", models)

## Name for a mod-registered voxel id, or "" if id isn't one (checked by
## VoxelCatalog as a fallback after its own built-in DISPLAY_NAMES).
func get_voxel_name(id: int) -> String:
	return _voxel_names_by_id.get(id, "")

# ---------------------------------------------------------------------
# Discovery / checklist / loading
# ---------------------------------------------------------------------

func _discover_mods() -> void:
	for base in MOD_SEARCH_DIRS:
		if not DirAccess.dir_exists_absolute(base):
			continue
		var dir := DirAccess.open(base)
		if not dir:
			continue
		dir.list_dir_begin()
		var name := dir.get_next()
		while name != "":
			if dir.current_is_dir() and not name.begins_with("."):
				var manifest_path := "%s%s/mod.json" % [base, name]
				var manifest := _read_json(manifest_path)
				if not manifest.is_empty():
					manifest["path"] = "%s%s/" % [base, name]
					mods.append(manifest)
				else:
					push_warning("[ModManager] '%s' has no readable mod.json, skipping" % name)
			name = dir.get_next()
		dir.list_dir_end()

func _load_enabled_checklist() -> void:
	var checklist := _read_json(ENABLED_CHECKLIST_PATH)
	var changed := false
	for mod in mods:
		var id: String = mod.get("id", "")
		if not checklist.has(id):
			checklist[id] = true  # default: enabled when first discovered
			changed = true
		mod["enabled"] = checklist[id]
	if changed:
		_write_json(ENABLED_CHECKLIST_PATH, checklist)

func _run_enabled_mods() -> void:
	for mod in mods:
		if not mod.get("enabled", false):
			continue
		var entry_script: String = mod.get("entry_script", "")
		if entry_script == "":
			push_warning("[ModManager] mod '%s' has no entry_script" % mod.get("id", "?"))
			continue
		var script_path: String = mod["path"] + entry_script
		if not FileAccess.file_exists(script_path):
			push_warning("[ModManager] mod '%s' entry script missing: %s" % [mod.get("id", "?"), script_path])
			continue
		var script: Script = load(script_path)
		if not script or not script.has_method("register"):
			push_warning("[ModManager] mod '%s' entry script has no static register()" % mod.get("id", "?"))
			continue
		script.call("register")
		print("[ModManager] Loaded mod: %s" % mod.get("id", "?"))

func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if not f:
		return {}
	var parsed = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}

func _write_json(path: String, data: Dictionary) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data, "\t"))

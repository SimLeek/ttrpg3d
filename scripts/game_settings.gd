extends Node

## Autoload. Persisted user-facing display settings -- currently just the
## distance unit shown in range-check/battle-mode HUD text. Separate from
## worlds/mods (user://worlds.json, user://mods_enabled.json): this is a
## single small file since it's just simple preferences, not structured
## data with its own lifecycle.

signal distance_unit_changed

const SETTINGS_FILE := "user://settings.json"

## Real-world scale per voxel: FEET_5_PER_BLOCK is the D&D-battlemap
## convention (each voxel/grid square = 5ft); METERS treats a voxel as a
## literal meter -- which is also how distances are already computed
## internally (voxel_size = 1.0 everywhere else in the project), so
## METERS is a straight passthrough and FEET_5_PER_BLOCK just scales the
## displayed number.
enum DistanceUnit { METERS, FEET_5_PER_BLOCK }

var distance_unit: int = DistanceUnit.METERS

func _ready() -> void:
	_load()

func set_distance_unit(unit: int) -> void:
	if unit == distance_unit:
		return
	distance_unit = unit
	_save()
	distance_unit_changed.emit()

## Converts a raw in-engine distance (1 unit = 1 voxel = 1 meter) into the
## currently selected display unit, formatted with a suffix.
func format_distance(raw_distance: float) -> String:
	if distance_unit == DistanceUnit.FEET_5_PER_BLOCK:
		return "%.1f ft" % (raw_distance * 5.0)
	return "%.1f m" % raw_distance

func _load() -> void:
	if not FileAccess.file_exists(SETTINGS_FILE):
		return
	var f := FileAccess.open(SETTINGS_FILE, FileAccess.READ)
	if not f:
		return
	var parsed = JSON.parse_string(f.get_as_text())
	if parsed is Dictionary and parsed.has("distance_unit"):
		distance_unit = parsed["distance_unit"]

func _save() -> void:
	var f := FileAccess.open(SETTINGS_FILE, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({"distance_unit": distance_unit}))

extends Node

## Autoload. Persisted user-facing display settings -- currently just the
## distance unit shown in range-check/battle-mode HUD text. Separate from
## worlds/mods (user://worlds.json, user://mods_enabled.json): this is a
## single small file since it's just simple preferences, not structured
## data with its own lifecycle.

signal distance_unit_changed
signal snap_waypoints_changed
signal distance_norm_changed
signal light_block_mode_changed
signal active_light_count_changed

const SETTINGS_FILE := "user://settings.json"

## Real-world scale per voxel: FEET_5_PER_BLOCK is the D&D-battlemap
## convention (each voxel/grid square = 5ft); METERS treats a voxel as a
## literal meter -- which is also how distances are already computed
## internally (voxel_size = 1.0 everywhere else in the project), so
## METERS is a straight passthrough and FEET_5_PER_BLOCK just scales the
## displayed number.
enum DistanceUnit { METERS, FEET_5_PER_BLOCK }

var distance_unit: int = DistanceUnit.METERS

## Battle-mode waypoint marking: snap to the center of the voxel you're
## in (the TTRPG-grid-appropriate default) vs. mark the exact floating
## position you're at (useful for measuring precise distances rather than
## grid movement).
var snap_waypoints_to_grid: bool = true

## Which distance metric battle mode measures/displays with -- a game
## usually sticks to one, so this is a single selectable mode rather than
## reporting every metric at once. MANHATTAN and EUCLIDEAN are just
## named shortcuts for the general Minkowski n-norm CUSTOM mode uses
## (n=1 and n=2 respectively); CUSTOM lets the table pick any n, since
## various tabletop/pathfinding diagonal-movement conventions land
## somewhere in between (or beyond) those two.
enum DistanceNorm { MANHATTAN, EUCLIDEAN, CUSTOM }

var distance_norm_mode: int = DistanceNorm.EUCLIDEAN
var custom_distance_n: float = 3.0

## Phase 7: how light-level voxels (see VoxelTypes.LIGHT_LEVELS) affect
## their surroundings, beyond their own always-on emissive material glow.
## OFF: no extra effect. REAL_LIGHTS: actual shadow-casting OmniLight3D
## instances (LightRegistry pools/repositions them) -- correctly blocked
## by walls, but real dynamic shadow-casting lights are expensive, so only
## the nearest `active_light_count` to the player are ever instantiated.
## Defaults off -- not automatic, per your original ask.
##
## GLOW was meant to be a cheap alternative (paint a light falloff into
## nearby voxels' real per-voxel CHANNEL_COLOR data, baked into vertex
## colors via VoxelMesherBlocky's TINT_RAW_COLOR, read by the shared
## cutout shader to boost emission -- see scripts/pcg/voxel_lighting.gd)
## but hit channel-depth mismatches between chunks generated before/after
## enabling the channel that went deeper than this session had room to
## chase down safely, and got reverted -- not currently selectable from
## the settings UI (pause_menu.gd), left in the enum in case it's picked
## back up later.
enum LightBlockMode { OFF, GLOW, REAL_LIGHTS }
var light_block_mode: int = LightBlockMode.OFF

## How many of the nearest-to-player registered light blocks stay active
## (glow uniform slots or real OmniLight3D instances, depending on
## light_block_mode) -- the cost-bounding cap for either mode.
var active_light_count: int = 8

func _ready() -> void:
	_load()

func set_distance_unit(unit: int) -> void:
	if unit == distance_unit:
		return
	distance_unit = unit
	_save()
	distance_unit_changed.emit()

func set_snap_waypoints_to_grid(value: bool) -> void:
	if value == snap_waypoints_to_grid:
		return
	snap_waypoints_to_grid = value
	_save()
	snap_waypoints_changed.emit()

func set_distance_norm_mode(mode: int) -> void:
	if mode == distance_norm_mode:
		return
	distance_norm_mode = mode
	_save()
	distance_norm_changed.emit()

func set_custom_distance_n(n: float) -> void:
	if n == custom_distance_n:
		return
	custom_distance_n = n
	_save()
	if distance_norm_mode == DistanceNorm.CUSTOM:
		distance_norm_changed.emit()

func set_light_block_mode(mode: int) -> void:
	if mode == light_block_mode:
		return
	light_block_mode = mode
	_save()
	light_block_mode_changed.emit()

func set_active_light_count(n: int) -> void:
	n = max(1, n)
	if n == active_light_count:
		return
	active_light_count = n
	_save()
	active_light_count_changed.emit()

## Short label for whichever distance metric is currently active, for HUD/
## billboard text ("12.0 m (Manhattan)") so it's clear which convention a
## shown number is using.
func distance_norm_label() -> String:
	match distance_norm_mode:
		DistanceNorm.MANHATTAN:
			return "Manhattan"
		DistanceNorm.CUSTOM:
			return "n=%s norm" % _format_n(custom_distance_n)
		_:
			return "Euclidean"

func _current_n() -> float:
	match distance_norm_mode:
		DistanceNorm.MANHATTAN:
			return 1.0
		DistanceNorm.CUSTOM:
			return custom_distance_n
		_:
			return 2.0

func _format_n(n: float) -> String:
	if n == round(n):
		return "%d" % int(n)
	return "%s" % n

## Minkowski "n-norm" distance between two points using whichever mode is
## currently selected -- n=1 (Manhattan) and n=2 (Euclidean) get their own
## fast/exact paths, anything else (a CUSTOM n) uses the general formula.
func compute_distance(a: Vector3, b: Vector3) -> float:
	var d := (a - b).abs()
	var n := _current_n()
	if n == 2.0:
		return d.length()
	if n == 1.0:
		return d.x + d.y + d.z
	return pow(pow(d.x, n) + pow(d.y, n) + pow(d.z, n), 1.0 / n)

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
	if parsed is Dictionary:
		if parsed.has("distance_unit"):
			distance_unit = parsed["distance_unit"]
		if parsed.has("snap_waypoints_to_grid"):
			snap_waypoints_to_grid = parsed["snap_waypoints_to_grid"]
		if parsed.has("distance_norm_mode"):
			distance_norm_mode = parsed["distance_norm_mode"]
		if parsed.has("custom_distance_n"):
			custom_distance_n = parsed["custom_distance_n"]
		if parsed.has("light_block_mode"):
			light_block_mode = parsed["light_block_mode"]
		if parsed.has("active_light_count"):
			active_light_count = parsed["active_light_count"]

func _save() -> void:
	var f := FileAccess.open(SETTINGS_FILE, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({
			"distance_unit": distance_unit,
			"snap_waypoints_to_grid": snap_waypoints_to_grid,
			"distance_norm_mode": distance_norm_mode,
			"custom_distance_n": custom_distance_n,
			"light_block_mode": light_block_mode,
			"active_light_count": active_light_count,
		}))

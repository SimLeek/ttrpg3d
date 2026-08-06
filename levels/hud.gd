extends CanvasLayer

## Max range for the battle-mode "what am I looking at" distance check --
## purely a UI readout (range-check info for the player/DM), not a
## gameplay interaction range. Generous on purpose: some TTRPG moves/spells
## reach 200+ ft (well past a typical 5ft-per-block battlemap's visible
## area), and a single raycast this long costs nothing extra to run.
const RANGE_CHECK_MAX_DIST := 500.0

@export var health_bar: TextureProgressBar
@export var stamina_bar: TextureProgressBar

var _flight_label: Label
var _battle_label: Label
var _range_check_label: Label

func _ready() -> void:
	visible = true  # don't start paused while being able to move
	_build_flight_label()
	_build_battle_label()
	_build_range_check_label()
	BattleModeManager.battle_mode_changed.connect(_on_battle_mode_changed)
	BattleModeManager.waypoints_changed.connect(_on_waypoints_changed)
	GameSettings.distance_unit_changed.connect(_refresh_battle_label)
	GameSettings.distance_norm_changed.connect(_refresh_battle_label)

func _physics_process(_delta: float) -> void:
	_update_range_check()

func update_health_ui(current: float, max_hp: float) -> void:
	# This converts the 0.0-1.0 range to a 0-100 percentage
	health_bar.value = (current / max_hp) * 100.0

func update_stamina_ui(current: float, max_hp: float) -> void:
	# This converts the 0.0-1.0 range to a 0-100 percentage
	stamina_bar.value = (current / max_hp) * 100.0

func _build_flight_label() -> void:
	_flight_label = Label.new()
	_flight_label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_flight_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_flight_label.position.y = 8
	_flight_label.add_theme_font_size_override("font_size", 18)
	_flight_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_flight_label.add_theme_constant_override("shadow_offset_x", 1)
	_flight_label.add_theme_constant_override("shadow_offset_y", 1)
	_flight_label.visible = false
	add_child(_flight_label)

## Called from player_blob_ctrl.gd whenever flying/intangible are toggled --
## both exit on a double-tap (double-Space, double-Ctrl respectively) that's
## easy to forget which is which, so name it explicitly on screen.
func update_flight_status(is_flying: bool, is_intangible: bool) -> void:
	if not is_flying and not is_intangible:
		_flight_label.visible = false
		return
	var parts: Array[String] = []
	if is_flying:
		parts.append("FLYING (double-Space to stop)")
	if is_intangible:
		parts.append("INTANGIBLE (double-Ctrl to stop)")
	_flight_label.text = "   |   ".join(parts)
	_flight_label.add_theme_color_override("font_color", Color(1.0, 0.5, 1.0) if is_intangible else Color(0.3, 1.0, 1.0))
	_flight_label.visible = true


func _build_battle_label() -> void:
	_battle_label = Label.new()
	_battle_label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_battle_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_battle_label.position.y = 32
	_battle_label.add_theme_font_size_override("font_size", 18)
	_battle_label.add_theme_color_override("font_color", Color(1.0, 0.85, 0.2))
	_battle_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_battle_label.add_theme_constant_override("shadow_offset_x", 1)
	_battle_label.add_theme_constant_override("shadow_offset_y", 1)
	_battle_label.visible = false
	add_child(_battle_label)


func _on_battle_mode_changed(is_active: bool) -> void:
	_battle_label.visible = is_active
	_refresh_battle_label()


func _on_waypoints_changed(_waypoints: Array) -> void:
	_refresh_battle_label()


func _refresh_battle_label() -> void:
	if not BattleModeManager.active:
		return
	_battle_label.text = "BATTLE MODE  --  waypoints: %d  |  %s (%s)  (LMB mark, RMB undo, B to end)" % [
		BattleModeManager.waypoints.size(),
		GameSettings.format_distance(BattleModeManager.get_total_distance()),
		GameSettings.distance_norm_label(),
	]


func _build_range_check_label() -> void:
	_range_check_label = Label.new()
	_range_check_label.set_anchors_preset(Control.PRESET_CENTER)
	_range_check_label.position += Vector2(0, 28)
	_range_check_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_range_check_label.add_theme_font_size_override("font_size", 14)
	_range_check_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.85))
	_range_check_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_range_check_label.add_theme_constant_override("shadow_offset_x", 1)
	_range_check_label.add_theme_constant_override("shadow_offset_y", 1)
	_range_check_label.visible = false
	add_child(_range_check_label)


## Battle-mode-only "range check": raycast along the camera's look
## direction and, if it hits a voxel, show the distance from the player
## (not the camera -- that's what actually matters for TTRPG range/spell
## checks) to the hit point.
##
## Uses VoxelTool.raycast() -- the same underlying mechanism
## voxel_interactor.gd's place/delete targeting uses -- rather than a
## generic PhysicsDirectSpaceState3D raycast. The generic physics raycast
## was intermittent (voxel terrain collision shapes apparently aren't
## always reliably queryable that way, especially on freshly-streamed
## chunks); VoxelTool's raycast is voxel-native and "always works" per
## live testing of the placement system. It also can't ever hit the
## player's own body (it only intersects voxel geometry), so there's no
## need for an explicit self-exclusion the way the physics raycast needed.
func _update_range_check() -> void:
	if not BattleModeManager.active:
		_range_check_label.visible = false
		return
	var camera := get_viewport().get_camera_3d()
	var player := get_tree().get_first_node_in_group("player")
	if not camera or not player or not ("vt" in player) or not player.vt or not player.voxel_terrain:
		_range_check_label.visible = false
		return
	var forward: Vector3 = -camera.global_transform.basis.z
	var hit = player.vt.raycast(camera.global_position, forward, RANGE_CHECK_MAX_DIST)
	if not hit:
		_range_check_label.visible = false
		return
	# hit.position comes back in terrain-local space (same as
	# voxel_interactor.gd's placement-plane math) as a Vector3i -- add the
	# terrain's own global position to get back to world space before
	# measuring (explicit Vector3() cast: GDScript won't implicitly mix
	# Vector3i and Vector3 in a + operator).
	var hit_world_pos: Vector3 = Vector3(hit.position) + player.voxel_terrain.global_position
	_range_check_label.text = GameSettings.format_distance(player.global_position.distance_to(hit_world_pos))
	_range_check_label.visible = true

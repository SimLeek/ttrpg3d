extends CanvasLayer

@export var hud: CanvasLayer

var _settings_panel: Control
var _meters_btn: Button
var _feet_btn: Button
var _snap_btn: Button
var _float_btn: Button

func _ready() -> void:
	visible = false
	_build_settings_panel()

func _input(event):
	if event.is_action_pressed("pause"):
		handle_pause()

func handle_pause():
		var new_pause_state = not get_tree().paused
		get_tree().paused = new_pause_state
		visible = new_pause_state
		hud.visible = not new_pause_state
		# Optional: Show/hide mouse cursor
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if new_pause_state else Input.MOUSE_MODE_CAPTURED)


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	pass


func _on_continue_pressed() -> void:
	handle_pause()


func _on_config_pressed() -> void:
	_settings_panel.visible = not _settings_panel.visible


## Distance display unit (D&D tables measure in 5ft squares, not meters)
## and whether battle-mode waypoints snap to voxel centers or float at
## the exact marked position. Built here (rather than a dedicated menu
## like DMWorldMenu/TurnTrackerMenu) since the Config button already
## existed and did nothing.
func _build_settings_panel() -> void:
	_settings_panel = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.1, 0.1, 0.13, 0.97)
	style.border_width_left = 2
	style.border_width_top = 2
	style.border_width_right = 2
	style.border_width_bottom = 2
	style.border_color = Color(0.6, 0.6, 0.65)
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 16
	style.content_margin_bottom = 16
	_settings_panel.add_theme_stylebox_override("panel", style)
	_settings_panel.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	_settings_panel.position += Vector2(-260, 0)
	_settings_panel.custom_minimum_size = Vector2(240, 0)
	_settings_panel.visible = false
	add_child(_settings_panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	_settings_panel.add_child(vbox)

	var title := Label.new()
	title.text = "Settings"
	title.add_theme_font_size_override("font_size", 18)
	vbox.add_child(title)

	var unit_label := Label.new()
	unit_label.text = "Distance display:"
	vbox.add_child(unit_label)

	_meters_btn = Button.new()
	_meters_btn.text = "1 block = 1 meter"
	_meters_btn.toggle_mode = true
	_meters_btn.pressed.connect(func(): GameSettings.set_distance_unit(GameSettings.DistanceUnit.METERS); _refresh_unit_buttons())
	vbox.add_child(_meters_btn)

	_feet_btn = Button.new()
	_feet_btn.text = "1 block = 5 feet (D&D)"
	_feet_btn.toggle_mode = true
	_feet_btn.pressed.connect(func(): GameSettings.set_distance_unit(GameSettings.DistanceUnit.FEET_5_PER_BLOCK); _refresh_unit_buttons())
	vbox.add_child(_feet_btn)

	vbox.add_child(HSeparator.new())

	var snap_label := Label.new()
	snap_label.text = "Battle-mode waypoints:"
	vbox.add_child(snap_label)

	_snap_btn = Button.new()
	_snap_btn.text = "Snap to voxel centers"
	_snap_btn.toggle_mode = true
	_snap_btn.pressed.connect(func(): GameSettings.set_snap_waypoints_to_grid(true); _refresh_unit_buttons())
	vbox.add_child(_snap_btn)

	_float_btn = Button.new()
	_float_btn.text = "Floating (exact position)"
	_float_btn.toggle_mode = true
	_float_btn.pressed.connect(func(): GameSettings.set_snap_waypoints_to_grid(false); _refresh_unit_buttons())
	vbox.add_child(_float_btn)

	_refresh_unit_buttons()


func _refresh_unit_buttons() -> void:
	_meters_btn.button_pressed = GameSettings.distance_unit == GameSettings.DistanceUnit.METERS
	_feet_btn.button_pressed = GameSettings.distance_unit == GameSettings.DistanceUnit.FEET_5_PER_BLOCK
	_snap_btn.button_pressed = GameSettings.snap_waypoints_to_grid
	_float_btn.button_pressed = not GameSettings.snap_waypoints_to_grid


func _on_respawn_pressed() -> void:
	get_parent().die()  # kill and respawn player


func _on_main_menu_pressed() -> void:
	get_tree().paused = false  # always do this when going to a new scene
	get_tree().change_scene_to_file("res://menus/main_menu.tscn")
	
	
func _on_exit_pressed() -> void:
	get_tree().paused = false
	get_tree().quit()

extends CanvasLayer

@export var hud: CanvasLayer

@onready var _main_box: Control = $Control/MarginContainer

var _settings_screen: Control
var _meters_btn: Button
var _feet_btn: Button
var _snap_btn: Button
var _float_btn: Button
var _manhattan_btn: Button
var _euclidean_btn: Button
var _custom_norm_btn: Button
var _custom_n_row: HBoxContainer
var _custom_n_spin: SpinBox

func _ready() -> void:
	visible = false
	_build_settings_screen()

func _input(event):
	if not event.is_action_pressed("pause") or DevConsole.is_focused:
		return
	# Escape always closes the pause menu once it's open, regardless of
	# InputController.is_captured() below -- that'll read true here purely
	# because handle_pause() itself requested capture ("pause_menu") while
	# open, not because anything ELSE is blocking it.
	if get_tree().paused:
		handle_pause()
		return
	# Not paused yet: don't steal Escape from whatever else currently has
	# exclusive input (inventory, DM world menu, dev console, ...) -- "esc
	# should exit the tab menu (and f1 and every other menu) to get back
	# to playing, not just pause." Those menus each handle their own
	# Escape-to-close (see player_inventory.gd/dm_world_menu.gd); this
	# just needs to not race them for it. is_input_handled() is still the
	# belt-and-suspenders check for whichever of us happens to run first
	# in Node._input() order this frame (not guaranteed, same reasoning as
	# the dev-console case this replaced).
	if not InputController.is_captured() and not get_viewport().is_input_handled():
		handle_pause()

func handle_pause():
		var new_pause_state = not get_tree().paused
		get_tree().paused = new_pause_state
		visible = new_pause_state
		hud.visible = not new_pause_state
		# Re-opening the pause menu always lands back on the main list,
		# not wherever Settings happened to be left last time.
		if new_pause_state:
			_show_main_menu()
		# InputController owns Input.mouse_mode now, not individual menus --
		# see input_controller.gd.
		if new_pause_state:
			InputController.request_capture("pause_menu")
		else:
			InputController.release_capture("pause_menu")


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	pass


func _on_continue_pressed() -> void:
	handle_pause()


func _on_config_pressed() -> void:
	_main_box.visible = false
	_settings_screen.visible = true


func _show_main_menu() -> void:
	_settings_screen.visible = false
	_main_box.visible = true


## Full-screen settings, styled the same way the actual pause screen is
## (semi-transparent dim ColorRect + centered button list, same themes)
## rather than a small floating panel -- per your note that it "should
## take up the whole screen and have a transparent background like the
## real pause menu does." Replaces the main pause list entirely while
## open; Back returns to it, matching PauseMenu's existing
## show-one-screen-at-a-time pattern rather than stacking on top.
func _build_settings_screen() -> void:
	_settings_screen = Control.new()
	_settings_screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	_settings_screen.visible = false
	add_child(_settings_screen)

	var dim := ColorRect.new()
	dim.color = Color(0.28485027, 0.28485027, 0.28485027, 0.5019608)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_settings_screen.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_settings_screen.add_child(center)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 24)
	vbox.custom_minimum_size = Vector2(360, 0)
	center.add_child(vbox)

	var title_theme: Theme = load("res://menus/title_theme.tres")
	var button_theme: Theme = load("res://menus/menu_button_theme.tres")

	var title := Label.new()
	title.text = "Settings"
	title.theme = title_theme
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	vbox.add_child(_make_section_label("Distance display:"))

	_meters_btn = _make_option_button(button_theme, "1 block = 1 meter",
		func(): GameSettings.set_distance_unit(GameSettings.DistanceUnit.METERS); _refresh_settings_buttons())
	vbox.add_child(_meters_btn)

	_feet_btn = _make_option_button(button_theme, "1 block = 5 feet (D&D)",
		func(): GameSettings.set_distance_unit(GameSettings.DistanceUnit.FEET_5_PER_BLOCK); _refresh_settings_buttons())
	vbox.add_child(_feet_btn)

	vbox.add_child(_make_section_label("Battle-mode waypoints:"))

	_snap_btn = _make_option_button(button_theme, "Snap to voxel centers",
		func(): GameSettings.set_snap_waypoints_to_grid(true); _refresh_settings_buttons())
	vbox.add_child(_snap_btn)

	_float_btn = _make_option_button(button_theme, "Floating (exact position)",
		func(): GameSettings.set_snap_waypoints_to_grid(false); _refresh_settings_buttons())
	vbox.add_child(_float_btn)

	# Distance measurement: a game usually sticks to one metric, so this
	# is a single selectable mode rather than reporting every metric at
	# once (which is what battle mode used to do -- Euclidean AND
	# Manhattan shown together).
	vbox.add_child(_make_section_label("Distance measurement:"))

	_manhattan_btn = _make_option_button(button_theme, "Manhattan (grid steps)",
		func(): GameSettings.set_distance_norm_mode(GameSettings.DistanceNorm.MANHATTAN); _refresh_settings_buttons())
	vbox.add_child(_manhattan_btn)

	_euclidean_btn = _make_option_button(button_theme, "Euclidean (straight-line)",
		func(): GameSettings.set_distance_norm_mode(GameSettings.DistanceNorm.EUCLIDEAN); _refresh_settings_buttons())
	vbox.add_child(_euclidean_btn)

	_custom_norm_btn = _make_option_button(button_theme, "Custom n-norm",
		func(): GameSettings.set_distance_norm_mode(GameSettings.DistanceNorm.CUSTOM); _refresh_settings_buttons())
	vbox.add_child(_custom_norm_btn)

	_custom_n_row = HBoxContainer.new()
	_custom_n_row.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(_custom_n_row)
	var n_label := Label.new()
	n_label.text = "n = "
	_custom_n_row.add_child(n_label)
	_custom_n_spin = SpinBox.new()
	_custom_n_spin.min_value = 0.1
	_custom_n_spin.max_value = 20.0
	_custom_n_spin.step = 0.1
	_custom_n_spin.value = GameSettings.custom_distance_n
	_custom_n_spin.value_changed.connect(func(v): GameSettings.set_custom_distance_n(v))
	_custom_n_row.add_child(_custom_n_spin)

	var back_btn := Button.new()
	back_btn.text = "Back"
	back_btn.theme = button_theme
	back_btn.pressed.connect(_show_main_menu)
	vbox.add_child(back_btn)

	_refresh_settings_buttons()


func _make_section_label(text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return label


func _make_option_button(theme: Theme, text: String, on_pressed: Callable) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.theme = theme
	btn.toggle_mode = true
	btn.pressed.connect(on_pressed)
	return btn


func _refresh_settings_buttons() -> void:
	_meters_btn.button_pressed = GameSettings.distance_unit == GameSettings.DistanceUnit.METERS
	_feet_btn.button_pressed = GameSettings.distance_unit == GameSettings.DistanceUnit.FEET_5_PER_BLOCK
	_snap_btn.button_pressed = GameSettings.snap_waypoints_to_grid
	_float_btn.button_pressed = not GameSettings.snap_waypoints_to_grid
	_manhattan_btn.button_pressed = GameSettings.distance_norm_mode == GameSettings.DistanceNorm.MANHATTAN
	_euclidean_btn.button_pressed = GameSettings.distance_norm_mode == GameSettings.DistanceNorm.EUCLIDEAN
	_custom_norm_btn.button_pressed = GameSettings.distance_norm_mode == GameSettings.DistanceNorm.CUSTOM
	_custom_n_row.visible = GameSettings.distance_norm_mode == GameSettings.DistanceNorm.CUSTOM


func _on_respawn_pressed() -> void:
	get_parent().die()  # kill and respawn player


func _on_main_menu_pressed() -> void:
	get_tree().paused = false  # always do this when going to a new scene
	get_tree().change_scene_to_file("res://menus/main_menu.tscn")


func _on_exit_pressed() -> void:
	get_tree().paused = false
	get_tree().quit()

extends Control

## DM-facing turn tracker: an always-on-screen, draggable, minimizable
## widget (Roll20-style -- it doesn't pause/dim the game like DMWorldMenu,
## it just sits on screen). Drag by its title bar to reposition; the
## minimize button collapses it to a small "<name>'s turn" / "Your Turn"
## bar. No dedicated open/close key -- it's interactive whenever the mouse
## happens to be visible for any other reason (Tab/F1/Escape), since it's
## just another Control in the same always-visible HUD tree.

const DEFAULT_MARGIN := 16.0
const PANEL_WIDTH := 260.0
const YOUR_TURN_COLOR := Color(0.4, 1.0, 0.5)
const OTHER_TURN_COLOR := Color(1.0, 0.85, 0.2)

var _panel: PanelContainer
var _title_bar: PanelContainer
var _minimize_btn: Button
var _expanded_box: VBoxContainer
var _minimized_label: Label
var _round_label: Label
var _list: VBoxContainer
var _name_edit: LineEdit

var _minimized: bool = false
var _dragging: bool = false
var _drag_offset: Vector2 = Vector2.ZERO

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_ui()
	call_deferred("_place_default_position")
	TurnTracker.combatants_changed.connect(_refresh)
	TurnTracker.turn_changed.connect(_refresh)
	_refresh()


func _input(event: InputEvent) -> void:
	if not _dragging:
		return
	if event is InputEventMouseMotion:
		_panel.position = get_global_mouse_position() - _drag_offset
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		_dragging = false


func _place_default_position() -> void:
	var viewport_size := get_viewport_rect().size
	_panel.position = Vector2(viewport_size.x - PANEL_WIDTH - DEFAULT_MARGIN, DEFAULT_MARGIN)


func _build_ui() -> void:
	_panel = PanelContainer.new()
	_panel.custom_minimum_size = Vector2(PANEL_WIDTH, 0)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.1, 0.1, 0.13, 0.92)
	style.border_width_left = 2
	style.border_width_top = 2
	style.border_width_right = 2
	style.border_width_bottom = 2
	style.border_color = Color(0.6, 0.6, 0.65)
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	_panel.add_theme_stylebox_override("panel", style)
	add_child(_panel)

	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 6)
	_panel.add_child(outer)

	# --- Title bar: drag handle + minimize toggle ---
	var title_row := HBoxContainer.new()
	title_row.mouse_filter = Control.MOUSE_FILTER_STOP
	title_row.gui_input.connect(_on_title_bar_gui_input)
	outer.add_child(title_row)

	var title := Label.new()
	title.text = "Turn Tracker"
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_row.add_child(title)

	_minimize_btn = Button.new()
	_minimize_btn.text = "_"
	_minimize_btn.custom_minimum_size = Vector2(24, 0)
	_minimize_btn.focus_mode = Control.FOCUS_NONE
	_minimize_btn.pressed.connect(_on_minimize_pressed)
	title_row.add_child(_minimize_btn)

	# --- Minimized bar (click to re-expand) ---
	_minimized_label = Label.new()
	_minimized_label.mouse_filter = Control.MOUSE_FILTER_STOP
	_minimized_label.gui_input.connect(_on_minimized_label_gui_input)
	_minimized_label.add_theme_font_size_override("font_size", 16)
	_minimized_label.visible = false
	outer.add_child(_minimized_label)

	# --- Expanded contents ---
	_expanded_box = VBoxContainer.new()
	_expanded_box.add_theme_constant_override("separation", 8)
	outer.add_child(_expanded_box)

	_round_label = Label.new()
	_expanded_box.add_child(_round_label)

	_expanded_box.add_child(HSeparator.new())

	_list = VBoxContainer.new()
	_expanded_box.add_child(_list)

	_expanded_box.add_child(HSeparator.new())

	var add_row := HBoxContainer.new()
	_expanded_box.add_child(add_row)
	_name_edit = LineEdit.new()
	_name_edit.placeholder_text = "Combatant name"
	_name_edit.custom_minimum_size = Vector2(140, 0)
	_name_edit.text_submitted.connect(func(_text): _on_add_pressed())
	_name_edit.focus_entered.connect(func(): UiPauseGate.request("turn_tracker_name"))
	_name_edit.focus_exited.connect(func(): UiPauseGate.release("turn_tracker_name"))
	add_row.add_child(_name_edit)
	var add_btn := Button.new()
	add_btn.text = "Add"
	add_btn.focus_mode = Control.FOCUS_NONE
	add_btn.pressed.connect(_on_add_pressed)
	add_row.add_child(add_btn)

	var add_me_btn := Button.new()
	add_me_btn.text = "Add Me"
	add_me_btn.focus_mode = Control.FOCUS_NONE
	add_me_btn.pressed.connect(_on_add_me_pressed)
	_expanded_box.add_child(add_me_btn)

	var control_row := HBoxContainer.new()
	control_row.add_theme_constant_override("separation", 6)
	_expanded_box.add_child(control_row)
	var next_btn := Button.new()
	next_btn.text = "Next Turn"
	next_btn.focus_mode = Control.FOCUS_NONE
	next_btn.pressed.connect(func(): TurnTracker.next_turn(); _refresh())
	control_row.add_child(next_btn)
	var clear_btn := Button.new()
	clear_btn.text = "Clear All"
	clear_btn.focus_mode = Control.FOCUS_NONE
	clear_btn.pressed.connect(func(): TurnTracker.clear(); _refresh())
	control_row.add_child(clear_btn)


func _on_title_bar_gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_dragging = true
			_drag_offset = get_global_mouse_position() - _panel.position
		else:
			_dragging = false


func _on_minimize_pressed() -> void:
	_minimized = not _minimized
	_refresh()


func _on_minimized_label_gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_minimized = false
		_refresh()


func _on_add_pressed() -> void:
	TurnTracker.add_combatant(_name_edit.text)
	_name_edit.text = ""
	_name_edit.grab_focus()
	_refresh()


func _on_add_me_pressed() -> void:
	var player := get_tree().get_first_node_in_group("player")
	var player_name: String = player.character_name if player and ("character_name" in player) else "Player"
	TurnTracker.add_combatant(player_name, true)
	_refresh()


func _current_turn_text() -> Dictionary:
	if TurnTracker.current_index < 0 or TurnTracker.current_index >= TurnTracker.combatants.size():
		return {"text": "No combatants", "color": OTHER_TURN_COLOR}
	var combatant: Dictionary = TurnTracker.combatants[TurnTracker.current_index]
	if combatant.get("is_local_player", false):
		return {"text": "Your Turn", "color": YOUR_TURN_COLOR}
	return {"text": "%s's turn" % combatant.get("name", "?"), "color": OTHER_TURN_COLOR}


func _refresh() -> void:
	_minimize_btn.text = "[]" if _minimized else "_"
	_expanded_box.visible = not _minimized
	_minimized_label.visible = _minimized

	var current := _current_turn_text()
	if _minimized:
		_minimized_label.text = current.text
		_minimized_label.add_theme_color_override("font_color", current.color)
		return

	_round_label.text = "Round %d  --  %s" % [TurnTracker.round_number, current.text]
	_round_label.add_theme_color_override("font_color", current.color)

	for child in _list.get_children():
		child.queue_free()
	for i in range(TurnTracker.combatants.size()):
		var combatant: Dictionary = TurnTracker.combatants[i]
		var row := HBoxContainer.new()
		_list.add_child(row)

		var label := Label.new()
		label.text = combatant.get("name", "?")
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if i == TurnTracker.current_index:
			label.text = "-> " + label.text
			label.add_theme_color_override("font_color", current.color)
		row.add_child(label)

		var remove_btn := Button.new()
		remove_btn.text = "x"
		remove_btn.focus_mode = Control.FOCUS_NONE
		remove_btn.pressed.connect(_on_remove_pressed.bind(i))
		row.add_child(remove_btn)


func _on_remove_pressed(index: int) -> void:
	TurnTracker.remove_combatant(index)
	_refresh()

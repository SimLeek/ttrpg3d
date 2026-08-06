extends Control

## DM-facing turn tracker: an ordered combatant list with a "whose turn is
## it" highlight and a round counter. Toggled by toggle_turn_tracker (F2).
## Same modal-panel-with-mouse-release pattern as dm_world_menu.gd.

var _root: Control
var _round_label: Label
var _list: VBoxContainer
var _name_edit: LineEdit

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_ui()
	_root.visible = false
	TurnTracker.combatants_changed.connect(_refresh_list)
	TurnTracker.turn_changed.connect(_on_turn_changed)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_turn_tracker"):
		_set_menu_visible(not _root.visible)
		get_viewport().set_input_as_handled()


func _set_menu_visible(show_it: bool) -> void:
	_root.visible = show_it
	if show_it:
		_refresh_list()
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if show_it else Input.MOUSE_MODE_CAPTURED)


func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(center)

	var panel := PanelContainer.new()
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
	panel.add_theme_stylebox_override("panel", style)
	panel.custom_minimum_size = Vector2(360, 0)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "Turn Tracker  (F2 to close)"
	title.add_theme_font_size_override("font_size", 22)
	vbox.add_child(title)

	_round_label = Label.new()
	vbox.add_child(_round_label)

	vbox.add_child(HSeparator.new())

	_list = VBoxContainer.new()
	vbox.add_child(_list)

	vbox.add_child(HSeparator.new())

	var add_row := HBoxContainer.new()
	vbox.add_child(add_row)
	_name_edit = LineEdit.new()
	_name_edit.placeholder_text = "Combatant name"
	_name_edit.custom_minimum_size = Vector2(200, 0)
	_name_edit.text_submitted.connect(func(_text): _on_add_pressed())
	add_row.add_child(_name_edit)
	var add_btn := Button.new()
	add_btn.text = "Add"
	add_btn.pressed.connect(_on_add_pressed)
	add_row.add_child(add_btn)

	var control_row := HBoxContainer.new()
	control_row.add_theme_constant_override("separation", 6)
	vbox.add_child(control_row)
	var next_btn := Button.new()
	next_btn.text = "Next Turn"
	next_btn.pressed.connect(func(): TurnTracker.next_turn())
	control_row.add_child(next_btn)
	var clear_btn := Button.new()
	clear_btn.text = "Clear All"
	clear_btn.pressed.connect(func(): TurnTracker.clear())
	control_row.add_child(clear_btn)


func _on_add_pressed() -> void:
	TurnTracker.add_combatant(_name_edit.text)
	_name_edit.text = ""
	_name_edit.grab_focus()


func _on_turn_changed(_current_index: int, _round_number: int) -> void:
	_refresh_list()


func _refresh_list() -> void:
	_round_label.text = "Round %d" % TurnTracker.round_number
	for child in _list.get_children():
		child.queue_free()
	for i in range(TurnTracker.combatants.size()):
		var combatant: Dictionary = TurnTracker.combatants[i]
		var row := HBoxContainer.new()
		_list.add_child(row)

		var label := Label.new()
		label.text = combatant.get("name", "?")
		label.custom_minimum_size = Vector2(220, 0)
		if i == TurnTracker.current_index:
			label.text = "-> " + label.text
			label.add_theme_color_override("font_color", Color(1.0, 0.85, 0.2))
		row.add_child(label)

		var remove_btn := Button.new()
		remove_btn.text = "Remove"
		remove_btn.pressed.connect(_on_remove_pressed.bind(i))
		row.add_child(remove_btn)


func _on_remove_pressed(index: int) -> void:
	TurnTracker.remove_combatant(index)

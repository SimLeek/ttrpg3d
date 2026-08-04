extends Control

## DM menu: switch between existing worlds (Roll20-page style -- click a
## world to jump to it) or create a new one, picking a classified PCG
## generator (WorldGeneratorCatalog) and, for finite generators, its
## params. Toggled by toggle_dm_menu (F1). Same modal-panel-with-mouse-
## release pattern player_inventory.gd's inventory grid already uses, so
## clicks here don't bleed through into placing/using the held item
## (two_handed_resource.gd already gates hand input on mouse capture state
## for that reason).

var _root: Control
var _worlds_list: VBoxContainer
var _name_edit: LineEdit
var _generator_buttons: Dictionary = {}  # generator id -> Button
var _param_fields: Dictionary = {}  # generator id -> {"group": Control, "fields": {key -> SpinBox}}
var _param_container: VBoxContainer
var _selected_generator_id: String = "hilly"

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_ui()
	_root.visible = false


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_dm_menu"):
		_set_menu_visible(not _root.visible)
		get_viewport().set_input_as_handled()


func _set_menu_visible(show_it: bool) -> void:
	_root.visible = show_it
	if show_it:
		_refresh_worlds_list()
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
	panel.custom_minimum_size = Vector2(440, 0)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "DM World Menu  (F1 to close)"
	title.add_theme_font_size_override("font_size", 22)
	vbox.add_child(title)

	var worlds_label := Label.new()
	worlds_label.text = "Worlds -- click to switch:"
	vbox.add_child(worlds_label)

	_worlds_list = VBoxContainer.new()
	vbox.add_child(_worlds_list)

	vbox.add_child(HSeparator.new())

	var create_label := Label.new()
	create_label.text = "Create New World"
	create_label.add_theme_font_size_override("font_size", 18)
	vbox.add_child(create_label)

	var name_row := HBoxContainer.new()
	vbox.add_child(name_row)
	var name_label := Label.new()
	name_label.text = "Name: "
	name_row.add_child(name_label)
	_name_edit = LineEdit.new()
	_name_edit.text = "New World"
	_name_edit.custom_minimum_size = Vector2(220, 0)
	name_row.add_child(_name_edit)

	var gen_row := HBoxContainer.new()
	gen_row.add_theme_constant_override("separation", 6)
	vbox.add_child(gen_row)
	for gen_def in WorldGeneratorCatalog.get_generators():
		var btn := Button.new()
		btn.text = "%s\n[%s]" % [gen_def.name, ", ".join(gen_def.classifications)]
		btn.toggle_mode = true
		btn.button_pressed = gen_def.id == _selected_generator_id
		btn.pressed.connect(_on_generator_selected.bind(gen_def.id))
		gen_row.add_child(btn)
		_generator_buttons[gen_def.id] = btn

	_param_container = VBoxContainer.new()
	vbox.add_child(_param_container)
	_build_param_fields()

	var create_btn := Button.new()
	create_btn.text = "Create & Switch"
	create_btn.pressed.connect(_on_create_pressed)
	vbox.add_child(create_btn)


func _on_generator_selected(id: String) -> void:
	_selected_generator_id = id
	for gid in _generator_buttons:
		_generator_buttons[gid].button_pressed = gid == id
	_update_param_visibility()


func _build_param_fields() -> void:
	for gen_def in WorldGeneratorCatalog.get_generators():
		var group := VBoxContainer.new()
		group.visible = gen_def.id == _selected_generator_id
		_param_container.add_child(group)
		var fields := {}
		for p in gen_def.params:
			var row := HBoxContainer.new()
			group.add_child(row)
			var label := Label.new()
			label.text = "%s: " % p.label
			label.custom_minimum_size = Vector2(80, 0)
			row.add_child(label)
			var spin := SpinBox.new()
			spin.min_value = p.min
			spin.max_value = p.max
			spin.value = p.default
			row.add_child(spin)
			fields[p.key] = spin
		_param_fields[gen_def.id] = {"group": group, "fields": fields}


func _update_param_visibility() -> void:
	for gid in _param_fields:
		_param_fields[gid]["group"].visible = gid == _selected_generator_id


func _on_create_pressed() -> void:
	var params := {}
	if _param_fields.has(_selected_generator_id):
		for key in _param_fields[_selected_generator_id]["fields"]:
			params[key] = int(_param_fields[_selected_generator_id]["fields"][key].value)
	var world := WorldManager.create_world(_name_edit.text, _selected_generator_id, params)
	WorldManager.switch_to_world(world)


func _refresh_worlds_list() -> void:
	for child in _worlds_list.get_children():
		child.queue_free()
	for world in WorldManager.worlds:
		var btn := Button.new()
		btn.text = "%s  (%s)" % [world.name, world.generator_id]
		btn.pressed.connect(_on_world_selected.bind(world))
		_worlds_list.add_child(btn)


func _on_world_selected(world: Dictionary) -> void:
	WorldManager.switch_to_world(world)

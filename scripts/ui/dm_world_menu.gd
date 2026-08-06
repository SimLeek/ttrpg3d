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
## generator id -> {"group": Control, "fields": {key -> {"node": Control, "type": String}}}
var _param_fields: Dictionary = {}
var _param_container: VBoxContainer
var _selected_generator_id: String = "hilly"
var _context_menu: PopupMenu
## The world a right-click/hover is currently targeting, for the shared
## context menu and the Delete-key shortcut -- {} when nothing is targeted.
var _context_world: Dictionary = {}
var _hovered_world: Dictionary = {}

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_ui()
	_root.visible = false


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_dm_menu"):
		_set_menu_visible(not _root.visible)
		get_viewport().set_input_as_handled()
		return
	if _root.visible and not _hovered_world.is_empty() and event is InputEventKey \
			and event.pressed and event.keycode == KEY_DELETE:
		_delete_world(_hovered_world)
		get_viewport().set_input_as_handled()


func _set_menu_visible(show_it: bool) -> void:
	_root.visible = show_it
	if show_it:
		_refresh_worlds_list()
		_refresh_voxel_pickers()
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if show_it else Input.MOUSE_MODE_CAPTURED)
	# Without this, WASD etc. kept moving the player while typing into the
	# "Name" field -- player_blob_ctrl.gd reads movement input directly
	# every physics frame regardless of mouse mode. get_tree().paused (via
	# UiPauseGate, so this doesn't stomp on some other menu also wanting a
	# pause) is the same mechanism pause_menu.gd already uses; this menu's
	# own Control tree keeps working through it since it lives under HUD,
	# which is process_mode ALWAYS.
	if show_it:
		UiPauseGate.request("dm_world_menu")
	else:
		UiPauseGate.release("dm_world_menu")


## The current level's VoxelBlockyLibrary, or null if there isn't one
## ready yet -- used to populate voxel_picker param fields. Mod voxels
## only show up once ModManager.apply_voxel_registrations() has run for
## this library; player_inventory.gd's own refresh already triggers that
## shortly after level load, but call it again here too (idempotent) so
## the picker is correct even if this menu opens first.
func _get_current_library() -> VoxelBlockyLibrary:
	var character = get_tree().get_first_node_in_group("player")
	if character and character.voxel_terrain and character.voxel_terrain.mesher:
		var library: VoxelBlockyLibrary = character.voxel_terrain.mesher.library
		ModManager.apply_voxel_registrations(library)
		return library
	return null


func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(dim)

	_context_menu = PopupMenu.new()
	_context_menu.add_item("Reset", 0)
	_context_menu.add_item("Delete", 1)
	_context_menu.id_pressed.connect(_on_context_menu_id_pressed)
	_root.add_child(_context_menu)

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

			var type: String = p.get("type", "number")
			if type == "voxel_picker":
				var option := OptionButton.new()
				option.custom_minimum_size = Vector2(180, 0)
				row.add_child(option)
				fields[p.key] = {"node": option, "type": type, "default": p.default}
			else:
				var spin := SpinBox.new()
				spin.min_value = p.min
				spin.max_value = p.max
				spin.value = p.default
				row.add_child(spin)
				fields[p.key] = {"node": spin, "type": type}
		_param_fields[gen_def.id] = {"group": group, "fields": fields}


func _update_param_visibility() -> void:
	for gid in _param_fields:
		_param_fields[gid]["group"].visible = gid == _selected_generator_id


## Populates every voxel_picker field's OptionButton from the current
## level's block library (built-in + mod blocks alike -- VoxelCatalog
## doesn't distinguish, it just scans whatever's in the library).
func _refresh_voxel_pickers() -> void:
	var library := _get_current_library()
	var blocks := VoxelCatalog.get_placeable_voxels(library) if library else []
	for gid in _param_fields:
		for key in _param_fields[gid]["fields"]:
			var field = _param_fields[gid]["fields"][key]
			if field.type != "voxel_picker":
				continue
			var option: OptionButton = field.node
			var previous_id = option.get_selected_metadata() if option.item_count > 0 else field.get("default", -1)
			option.clear()
			var select_index := 0
			for i in range(blocks.size()):
				option.add_item(blocks[i].name)
				option.set_item_metadata(i, blocks[i].id)
				if blocks[i].id == previous_id:
					select_index = i
			if option.item_count > 0:
				option.select(select_index)


func _on_create_pressed() -> void:
	var params := {}
	if _param_fields.has(_selected_generator_id):
		for key in _param_fields[_selected_generator_id]["fields"]:
			var field = _param_fields[_selected_generator_id]["fields"][key]
			if field.type == "voxel_picker":
				var option: OptionButton = field.node
				if option.item_count > 0:
					params[key] = option.get_selected_metadata()
			else:
				params[key] = int(field.node.value)
	var world := WorldManager.create_world(_name_edit.text, _selected_generator_id, params)
	WorldManager.switch_to_world(world)


func _refresh_worlds_list() -> void:
	_hovered_world = {}
	for child in _worlds_list.get_children():
		child.queue_free()
	for world in WorldManager.worlds:
		var btn := Button.new()
		var size_str := WorldManager.get_save_size_string(world.get("id", ""))
		btn.text = "%s  (%s)  [%s]" % [world.name, world.generator_id, size_str]
		btn.pressed.connect(_on_world_selected.bind(world))
		btn.gui_input.connect(_on_world_button_gui_input.bind(world))
		btn.mouse_entered.connect(func(): _hovered_world = world)
		btn.mouse_exited.connect(func(): _hovered_world = {})
		_worlds_list.add_child(btn)


func _on_world_selected(world: Dictionary) -> void:
	WorldManager.switch_to_world(world)


## Right-click on a world row opens the Reset/Delete context menu instead
## of switching to it (the button's own pressed signal only fires on
## left-click, so this doesn't need to suppress that).
func _on_world_button_gui_input(event: InputEvent, world: Dictionary) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_RIGHT:
		_context_world = world
		# DisplayServer.mouse_get_position() is desktop-global and lands far
		# outside this window's bounds once the window itself isn't at the
		# desktop origin -- PopupMenu.position (embedded subwindow) wants
		# viewport-local coordinates instead.
		_context_menu.position = get_viewport().get_mouse_position()
		_context_menu.popup()


func _on_context_menu_id_pressed(id: int) -> void:
	if _context_world.is_empty():
		return
	if id == 0:
		_reset_world(_context_world)
	elif id == 1:
		_delete_world(_context_world)
	_context_world = {}


func _reset_world(world: Dictionary) -> void:
	WorldManager.reset_world(world.get("id", ""))


func _delete_world(world: Dictionary) -> void:
	WorldManager.delete_world(world.get("id", ""))
	_hovered_world = {}
	_refresh_worlds_list()

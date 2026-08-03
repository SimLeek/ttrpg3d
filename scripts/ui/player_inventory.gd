extends Control

## Terraria-style inventory: an always-visible hotbar row plus a Tab-toggled
## full inventory grid, both auto-populated from ItemCatalog (blocks today,
## non-block tools -- structure save/place, etc. -- as they're built).
##
## The hotbar isn't just a picker: selecting a slot actually equips that
## item into the player's primary hand via HandController.equip_item(),
## same as the existing pause menu / other UI already assumes items are
## dynamic. The full inventory is "everything available"; the hotbar is
## "what's currently reachable without opening the inventory" -- clicking
## an item in the inventory loads it into the selected hotbar slot (and
## equips it immediately).

@export var hotbar_size: int = 10
@export var slot_size: int = 56

const SLOT_BG := Color(0.08, 0.08, 0.1, 0.75)
const SLOT_BORDER := Color(0.6, 0.6, 0.65, 0.9)
const SLOT_SELECTED_BORDER := Color(1.0, 0.85, 0.2, 1.0)

var _items: Array[Dictionary] = []
var _hotbar_item_ids: Array[String] = []
var _selected_slot: int = 0

var _hotbar_slots: Array[Panel] = []
var _name_label: Label
var _name_label_timer: Timer

var _inventory_root: Control
var _inventory_grid: GridContainer

func _ready() -> void:
	add_to_group("player_inventory")
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

	_build_hotbar()
	_build_inventory()
	_refresh_items()

	# The voxel terrain's mesher/library, and the character's two_handed
	# resource, may not be assigned yet on the same frame this UI enters
	# the tree (child _ready() runs before the player's own _ready()), so
	# try again shortly after.
	get_tree().create_timer(0.5).timeout.connect(_refresh_items)

func _refresh_items() -> void:
	var character := get_tree().get_first_node_in_group("player")
	var library: VoxelBlockyLibrary = null
	if character and character.voxel_terrain and character.voxel_terrain.mesher:
		library = character.voxel_terrain.mesher.library
	var found := ItemCatalog.get_available_items(library)
	if found.is_empty():
		return
	_items = found
	if _hotbar_item_ids.is_empty():
		for i in range(min(hotbar_size, _items.size())):
			_hotbar_item_ids.append(_items[i].id)
	_rebuild_hotbar_icons()
	_rebuild_inventory_grid()
	_equip_selected_item()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_inventory"):
		_set_inventory_visible(not _inventory_root.visible)
		get_viewport().set_input_as_handled()
		return

	if _hotbar_item_ids.is_empty():
		return

	if event.is_action_pressed("voxel_select_next"):
		_select_slot((_selected_slot + 1) % _hotbar_item_ids.size())
	elif event.is_action_pressed("voxel_select_prev"):
		_select_slot((_selected_slot - 1 + _hotbar_item_ids.size()) % _hotbar_item_ids.size())
	else:
		for i in range(10):
			if event.is_action_pressed("hotbar_slot_%d" % (i + 1)) and i < _hotbar_item_ids.size():
				_select_slot(i)

func _select_slot(index: int) -> void:
	_selected_slot = index
	_rebuild_hotbar_icons()
	_show_selected_name()
	_equip_selected_item()

func _set_inventory_visible(show_it: bool) -> void:
	_inventory_root.visible = show_it
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if show_it else Input.MOUSE_MODE_CAPTURED)

# ---------------------------------------------------------------------
# Equipping -- hotbar selection drives what's actually in the hand
# ---------------------------------------------------------------------

func _get_primary_hand(character: Node):
	var two_handed = character.get("two_handed")
	if not two_handed or not two_handed.right_hand or not two_handed.left_hand:
		return null
	if two_handed.right_hand.primary:
		return two_handed.right_hand
	elif two_handed.left_hand.primary:
		return two_handed.left_hand
	return two_handed.right_hand

func _equip_selected_item() -> void:
	var character = get_tree().get_first_node_in_group("player")
	if not character:
		return
	var hand = _get_primary_hand(character)
	if not hand:
		return

	var entry = _find_item_entry(_current_item_id())
	if not entry:
		hand.unequip_item()
		return

	hand.equip_item(ItemCatalog.instantiate_item(entry))

func _current_item_id() -> String:
	if _selected_slot < _hotbar_item_ids.size():
		return _hotbar_item_ids[_selected_slot]
	return ""

# ---------------------------------------------------------------------
# Hotbar row
# ---------------------------------------------------------------------

func _build_hotbar() -> void:
	var wrapper := CenterContainer.new()
	wrapper.name = "HotbarWrapper"
	wrapper.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	wrapper.custom_minimum_size = Vector2(0, slot_size + 56)
	wrapper.grow_vertical = Control.GROW_DIRECTION_BEGIN
	wrapper.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(wrapper)

	var vbox := VBoxContainer.new()
	vbox.alignment = BoxContainer.ALIGNMENT_END
	vbox.add_theme_constant_override("separation", 6)
	wrapper.add_child(vbox)

	_name_label = Label.new()
	_name_label.add_theme_font_size_override("font_size", 20)
	_name_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_name_label.add_theme_constant_override("shadow_offset_x", 1)
	_name_label.add_theme_constant_override("shadow_offset_y", 1)
	_name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_name_label.visible = false
	vbox.add_child(_name_label)

	_name_label_timer = Timer.new()
	_name_label_timer.wait_time = 1.5
	_name_label_timer.one_shot = true
	_name_label_timer.timeout.connect(func(): _name_label.visible = false)
	add_child(_name_label_timer)

	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 6)
	vbox.add_child(row)

	for i in range(hotbar_size):
		var slot := _make_slot_panel()
		var num_label := Label.new()
		num_label.text = str((i + 1) % 10)  # slot 10 shows "0", Minecraft-style
		num_label.add_theme_font_size_override("font_size", 12)
		num_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
		num_label.position = Vector2(3, 1)
		slot.add_child(num_label)
		row.add_child(slot)
		_hotbar_slots.append(slot)

func _make_slot_panel() -> Panel:
	var panel := Panel.new()
	panel.custom_minimum_size = Vector2(slot_size, slot_size)
	var icon := TextureRect.new()
	icon.name = "Icon"
	icon.set_anchors_preset(Control.PRESET_FULL_RECT)
	icon.offset_left = 6
	icon.offset_top = 6
	icon.offset_right = -6
	icon.offset_bottom = -6
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	panel.add_child(icon)
	return panel

func _slot_style(selected: bool) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = SLOT_BG
	sb.border_width_left = 2
	sb.border_width_top = 2
	sb.border_width_right = 2
	sb.border_width_bottom = 2
	sb.border_color = SLOT_SELECTED_BORDER if selected else SLOT_BORDER
	sb.corner_radius_top_left = 4
	sb.corner_radius_top_right = 4
	sb.corner_radius_bottom_left = 4
	sb.corner_radius_bottom_right = 4
	return sb

func _rebuild_hotbar_icons() -> void:
	for i in range(_hotbar_slots.size()):
		var slot := _hotbar_slots[i]
		slot.add_theme_stylebox_override("panel", _slot_style(i == _selected_slot))
		var icon: TextureRect = slot.get_node("Icon")
		icon.texture = null
		slot.tooltip_text = ""
		if i < _hotbar_item_ids.size():
			var entry = _find_item_entry(_hotbar_item_ids[i])
			if entry:
				icon.texture = entry.icon
				slot.tooltip_text = _tooltip_text_for(entry)

func _find_item_entry(id: String):
	for entry in _items:
		if entry.id == id:
			return entry
	return null

## Native Control tooltip (built-in engine popup, positioned near the mouse
## automatically on hover) -- name plus the item's control hint, if any.
## Used for both hotbar slots and the full inventory grid so players can
## see what a tool does / how to use it without equipping it first.
func _tooltip_text_for(entry: Dictionary) -> String:
	var hint: String = entry.get("hint", "")
	return "%s\n%s" % [entry.name, hint] if hint != "" else entry.name

func _show_selected_name() -> void:
	var entry = _find_item_entry(_current_item_id())
	if entry:
		_name_label.text = entry.name
		_name_label.visible = true
		_name_label_timer.start()

# ---------------------------------------------------------------------
# Full inventory grid (Tab to toggle)
# ---------------------------------------------------------------------

func _build_inventory() -> void:
	_inventory_root = Control.new()
	_inventory_root.name = "Inventory"
	_inventory_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_inventory_root.visible = false
	add_child(_inventory_root)

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.5)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_inventory_root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_inventory_root.add_child(center)

	var panel := PanelContainer.new()
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.12, 0.12, 0.14, 0.95)
	panel_style.border_width_left = 2
	panel_style.border_width_top = 2
	panel_style.border_width_right = 2
	panel_style.border_width_bottom = 2
	panel_style.border_color = SLOT_BORDER
	panel_style.content_margin_left = 14
	panel_style.content_margin_right = 14
	panel_style.content_margin_top = 14
	panel_style.content_margin_bottom = 14
	panel.add_theme_stylebox_override("panel", panel_style)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "Inventory  --  click an item to load it into the selected hotbar slot"
	title.add_theme_font_size_override("font_size", 16)
	vbox.add_child(title)

	_inventory_grid = GridContainer.new()
	_inventory_grid.columns = 8
	_inventory_grid.add_theme_constant_override("h_separation", 4)
	_inventory_grid.add_theme_constant_override("v_separation", 4)
	vbox.add_child(_inventory_grid)

func _rebuild_inventory_grid() -> void:
	for child in _inventory_grid.get_children():
		child.queue_free()
	for entry in _items:
		var slot := _make_slot_panel()
		slot.mouse_filter = Control.MOUSE_FILTER_STOP
		slot.tooltip_text = _tooltip_text_for(entry)
		slot.gui_input.connect(_on_inventory_slot_input.bind(entry.id))
		var icon: TextureRect = slot.get_node("Icon")
		icon.texture = entry.icon
		slot.add_theme_stylebox_override("panel", _slot_style(false))
		_inventory_grid.add_child(slot)

func _on_inventory_slot_input(event: InputEvent, id: String) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		while _hotbar_item_ids.size() <= _selected_slot:
			_hotbar_item_ids.append(_items[0].id)
		_hotbar_item_ids[_selected_slot] = id
		_rebuild_hotbar_icons()
		_show_selected_name()
		_equip_selected_item()

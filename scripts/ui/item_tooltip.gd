extends Node3D
class_name ItemTooltip

## A small billboard "here's how to use this" hint, shown above the player.
## Tools call show_message() explicitly at the points where it's useful
## (equip, mode switch, click) -- see StructureSaverItem/StructurePlacerItem/
## PlaneSelectorItem for the pattern. Found via the "item_tooltip" group.
##
## Persistent by default (no auto-hide) -- it's meant to sit there showing
## "current mode + how to use it" while a tool is actively being used, not
## flash and vanish. tooltip_toggle (/) hides/shows it without clearing the
## content (a mode-switch call while hidden still updates what's ready to
## show again). tooltip_next_page/tooltip_prev_page (./,) page through long
## messages (split by line, a few lines per page) instead of cramming
## everything into one crowded box.
##
## Reuses the visual construction NPCs/npc_dialog_system.gd uses for NPC
## speech (a SubViewport rendering a Panel/TextureRect/RichTextLabel, texture-
## mapped onto a billboard Sprite3D) but without any of that system's
## proximity detection, spring-follow, or jump-to-advance dialog logic.

@export var box_size: Vector2 = Vector2(420, 90)
@export var font_size: int = 20
@export var text_color: Color = Color.WHITE
@export var billboard_height: float = 0.7
@export var lines_per_page: int = 4
## <= 0 means persistent (no auto-hide). Callers can still pass a positive
## duration for one-off flashes if that's ever actually wanted.
@export var default_duration: float = 0.0

var _viewport: SubViewport
var _sprite: Sprite3D
var _label: RichTextLabel
var _icon_rect: TextureRect
var _hide_timer: Timer

var _visible_enabled: bool = true
var _pages: Array[String] = []
var _page_index: int = 0
var _current_icon: Texture2D = null

func _ready() -> void:
	add_to_group("item_tooltip")
	_setup_nodes()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("tooltip_toggle"):
		_visible_enabled = not _visible_enabled
		_refresh_visibility()
	elif event.is_action_pressed("tooltip_next_page"):
		if _page_index < _pages.size() - 1:
			_page_index += 1
			_render_page()
	elif event.is_action_pressed("tooltip_prev_page"):
		if _page_index > 0:
			_page_index -= 1
			_render_page()


func show_message(text: String, icon: Texture2D = null, duration: float = -1.0) -> void:
	_pages = _paginate(text)
	_page_index = 0
	_current_icon = icon
	_render_page()
	_refresh_visibility()

	var wait_time := default_duration if duration < 0.0 else duration
	if wait_time > 0.0:
		_hide_timer.start(wait_time)
	else:
		_hide_timer.stop()


func hide_message() -> void:
	_sprite.hide()


func _refresh_visibility() -> void:
	_sprite.visible = _visible_enabled and not _pages.is_empty()


func _paginate(text: String) -> Array[String]:
	var lines := text.split("\n")
	if lines.size() <= lines_per_page:
		return [text]
	var pages: Array[String] = []
	var i := 0
	while i < lines.size():
		var chunk := lines.slice(i, min(i + lines_per_page, lines.size()))
		pages.append("\n".join(chunk))
		i += lines_per_page
	return pages


func _render_page() -> void:
	if _pages.is_empty():
		return
	var text := _pages[_page_index]
	if _pages.size() > 1:
		text += "\n[right][i](%d/%d -- ,/. to page)[/i][/right]" % [_page_index + 1, _pages.size()]
	_label.text = text
	if _current_icon:
		_icon_rect.texture = _current_icon
		_icon_rect.show()
	else:
		_icon_rect.hide()


func _setup_nodes() -> void:
	_viewport = SubViewport.new()
	_viewport.size = box_size
	_viewport.transparent_bg = true
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_viewport)

	var panel := Panel.new()
	panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0, 0, 0, 0.75)
	style.corner_radius_top_left = 10
	style.corner_radius_top_right = 10
	style.corner_radius_bottom_left = 10
	style.corner_radius_bottom_right = 10
	panel.add_theme_stylebox_override("panel", style)
	_viewport.add_child(panel)

	var hbox := HBoxContainer.new()
	hbox.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hbox.offset_left = 10
	hbox.offset_right = -10
	panel.add_child(hbox)

	_icon_rect = TextureRect.new()
	_icon_rect.custom_minimum_size = Vector2(box_size.y - 20, 0)
	_icon_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_icon_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_icon_rect.hide()
	hbox.add_child(_icon_rect)

	_label = RichTextLabel.new()
	_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_label.bbcode_enabled = true
	_label.add_theme_font_size_override("normal_font_size", font_size)
	_label.add_theme_color_override("default_color", text_color)
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	hbox.add_child(_label)

	_sprite = Sprite3D.new()
	_sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_sprite.no_depth_test = true
	_sprite.position.y = billboard_height
	_sprite.pixel_size = 0.006
	_sprite.texture = _viewport.get_texture()
	_sprite.hide()
	add_child(_sprite)

	_hide_timer = Timer.new()
	_hide_timer.one_shot = true
	_hide_timer.timeout.connect(hide_message)
	add_child(_hide_timer)

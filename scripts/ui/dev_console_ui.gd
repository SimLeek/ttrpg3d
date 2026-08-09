extends Control

## Dev console UI: \ toggles a text-input command line plus a scrolling log
## that mirrors DevConsole.log_lines (which itself tails Godot's real
## stdout log file) -- so the on-screen console shows the same thing a
## terminal watching this process would.

var _root: Control
var _log_label: RichTextLabel
var _input: LineEdit

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_ui()
	_root.visible = false
	DevConsole.visibility_toggled.connect(_on_visibility_toggled)
	DevConsole.log_updated.connect(_on_log_updated)
	_refresh_log()

func _unhandled_input(event: InputEvent) -> void:
	if _root.visible and event.is_action_pressed("ui_cancel"):
		_set_visible(false)
		get_viewport().set_input_as_handled()

func _on_visibility_toggled(is_open: bool) -> void:
	_set_visible(is_open)

func _set_visible(show_it: bool) -> void:
	_root.visible = show_it
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if show_it else Input.MOUSE_MODE_CAPTURED)
	if show_it:
		UiPauseGate.request("dev_console")
		# Defensive: the \ keypress that opened the console can otherwise
		# leak into this field the moment it grabs focus (seen live).
		_input.text = ""
		_input.grab_focus()
		_refresh_log()
	else:
		UiPauseGate.release("dev_console")

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.7)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(dim)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 24)
	margin.add_theme_constant_override("margin_right", 24)
	margin.add_theme_constant_override("margin_top", 24)
	margin.add_theme_constant_override("margin_bottom", 24)
	_root.add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	margin.add_child(vbox)

	var title := Label.new()
	title.text = "Dev Console  (Esc to close)"
	title.add_theme_font_size_override("font_size", 18)
	vbox.add_child(title)

	_log_label = RichTextLabel.new()
	_log_label.custom_minimum_size = Vector2(0, 500)
	_log_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_log_label.scroll_following = true
	_log_label.bbcode_enabled = false
	_log_label.add_theme_font_size_override("normal_font_size", 14)
	vbox.add_child(_log_label)

	_input = LineEdit.new()
	_input.placeholder_text = "type a command, e.g. 'help'"
	_input.text_submitted.connect(_on_command_submitted)
	vbox.add_child(_input)


func _on_command_submitted(text: String) -> void:
	DevConsole.run_command(text)
	_input.text = ""
	_input.grab_focus()


func _on_log_updated(_new_lines: Array) -> void:
	if _root.visible:
		_refresh_log()


func _refresh_log() -> void:
	_log_label.text = "\n".join(DevConsole.log_lines)

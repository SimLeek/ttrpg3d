extends Control

## Dev console UI: \ toggles a text-input command line plus a scrolling log
## that mirrors DevConsole.log_lines (which itself tails Godot's real
## stdout log file) -- so the on-screen console shows the same thing a
## terminal watching this process would.

var _root: Control
var _log_label: RichTextLabel
var _command_input: LineEdit

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_ui()
	_root.visible = false
	DevConsole.visibility_toggled.connect(_on_visibility_toggled)
	DevConsole.log_updated.connect(_on_log_updated)
	_refresh_log()

## _input(), not _unhandled_input()+"ui_cancel": with the console's LineEdit
## focused, Escape was getting consumed by the LineEdit's own built-in
## defocus-on-Escape behavior first (so the console stayed open, just with
## keyboard/mouse control silently handed back to the player), and a
## second Escape then reached pause_menu.gd's _input() (bound to the same
## key) before this handler ever saw it -- opening the pause menu instead
## of closing the console. _input() runs before both of those, same fix
## as the Tab-focus-stealing bug in turn_tracker_menu.gd.
func _input(event: InputEvent) -> void:
	if DevConsole.is_open and event is InputEventKey and event.pressed \
			and event.keycode == KEY_ESCAPE and not event.is_echo():
		_command_input.release_focus()
		DevConsole.set_open(false)
		get_viewport().set_input_as_handled()

func _on_visibility_toggled(is_open: bool) -> void:
	_root.visible = is_open
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if is_open else Input.MOUSE_MODE_CAPTURED)
	if is_open:
		UiPauseGate.request("dev_console")
		# Defensive: the toggle keypress can otherwise leak into this
		# field the moment it grabs focus (seen live).
		_command_input.text = ""
		_command_input.grab_focus()
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

	_command_input = LineEdit.new()
	_command_input.placeholder_text = "type a command, e.g. 'help'"
	_command_input.text_submitted.connect(_on_command_submitted)
	vbox.add_child(_command_input)


func _on_command_submitted(text: String) -> void:
	DevConsole.run_command(text)
	_command_input.text = ""
	_command_input.grab_focus()


func _on_log_updated(_new_lines: Array) -> void:
	if _root.visible:
		_refresh_log()


func _refresh_log() -> void:
	_log_label.text = "\n".join(DevConsole.log_lines)

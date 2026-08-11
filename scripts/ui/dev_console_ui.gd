extends Control

## Dev console UI: always in the tree, showing the log tail (which mirrors
## DevConsole.log_lines -- itself tailing Godot's real stdout log file) and
## a command input. Never touches mouse mode or pauses anything -- \
## toggles keyboard FOCUS on the input, nothing else, so the player always
## has the mouse and camera; DevConsole.is_focused is what the rest of the
## game gates on to stop gameplay actions leaking in while you type. No dim
## background either: fully transparent so the game stays visible behind
## the log. The log fades out ~10s after the last activity (a new line, or
## focus changing) so it doesn't sit on screen forever after a command.

const IDLE_BEFORE_FADE_SEC := 10.0
const FADE_DURATION_SEC := 2.0

var _root: Control
var _title_label: Label
var _log_label: RichTextLabel
var _command_input: LineEdit
var _last_activity_msec: int = 0

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_ui()
	_last_activity_msec = Time.get_ticks_msec()
	DevConsole.focus_toggled.connect(_on_focus_toggled)
	DevConsole.log_updated.connect(_on_log_updated)
	_refresh_log()
	_update_title()

## Focus "babysitter": whatever is actually stealing it back after Enter
## (LineEdit's own post-submit internal handling, most likely) isn't worth
## chasing further when this just keeps it pinned unconditionally while
## DevConsole considers itself focused.
func _process(_delta: float) -> void:
	if DevConsole.is_focused and not _command_input.has_focus():
		_command_input.grab_focus()
	_update_fade()

## _input(), not _unhandled_input()+"ui_cancel": with the console's LineEdit
## focused, Escape was getting consumed by the LineEdit's own built-in
## defocus-on-Escape behavior first (so the console stayed "focused" per
## DevConsole, just with keyboard control silently handed back to the
## player), and a second Escape then reached pause_menu.gd's _input()
## (bound to the same key) before this handler ever saw it -- opening the
## pause menu instead of unfocusing the console. _input() runs before both
## of those, same fix as the Tab-focus-stealing bug in turn_tracker_menu.gd.
func _input(event: InputEvent) -> void:
	if DevConsole.is_focused and event is InputEventKey and event.pressed \
			and event.keycode == KEY_ESCAPE and not event.is_echo():
		DevConsole.set_focused(false)
		get_viewport().set_input_as_handled()

func _on_focus_toggled(is_focused: bool) -> void:
	_last_activity_msec = Time.get_ticks_msec()
	_update_title()
	if is_focused:
		_command_input.grab_focus()
	else:
		_command_input.release_focus()

func _update_fade() -> void:
	if DevConsole.is_focused:
		_root.modulate.a = 1.0
		return
	var idle_sec: float = (Time.get_ticks_msec() - _last_activity_msec) / 1000.0
	if idle_sec <= IDLE_BEFORE_FADE_SEC:
		_root.modulate.a = 1.0
	else:
		var fade_t: float = (idle_sec - IDLE_BEFORE_FADE_SEC) / FADE_DURATION_SEC
		_root.modulate.a = clamp(1.0 - fade_t, 0.0, 1.0)

func _update_title() -> void:
	_title_label.text = "Dev Console  (Esc to unfocus)" if DevConsole.is_focused else "Dev Console  (\\ to type)"

func _build_ui() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_theme_constant_override("margin_left", 24)
	margin.add_theme_constant_override("margin_right", 24)
	margin.add_theme_constant_override("margin_top", 24)
	margin.add_theme_constant_override("margin_bottom", 24)
	_root.add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vbox.add_theme_constant_override("separation", 8)
	margin.add_child(vbox)

	_title_label = Label.new()
	_title_label.add_theme_font_size_override("font_size", 18)
	vbox.add_child(_title_label)

	_log_label = RichTextLabel.new()
	_log_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_log_label.custom_minimum_size = Vector2(0, 500)
	_log_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_log_label.scroll_following = true
	_log_label.bbcode_enabled = false
	_log_label.add_theme_font_size_override("normal_font_size", 14)
	vbox.add_child(_log_label)

	# IGNORE, not the default STOP/PASS: the mouse never leaves the player
	# now (no mode switch on focus), so this must never intercept a click
	# meant for gameplay. Keyboard focus is only ever granted via
	# grab_focus() from the \ toggle above, never by clicking.
	_command_input = LineEdit.new()
	_command_input.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_command_input.placeholder_text = "type a command, e.g. 'help'"
	_command_input.text_submitted.connect(_on_command_submitted)
	vbox.add_child(_command_input)


func _on_command_submitted(text: String) -> void:
	DevConsole.run_command(text)
	_command_input.text = ""
	# Refocusing is handled by the _process() babysitter above.


func _on_log_updated(_new_lines: Array) -> void:
	_last_activity_msec = Time.get_ticks_msec()
	_refresh_log()


func _refresh_log() -> void:
	_log_label.text = "\n".join(DevConsole.log_lines)

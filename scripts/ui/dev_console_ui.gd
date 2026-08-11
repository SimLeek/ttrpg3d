extends Control

## Dev console UI: always in the tree, showing the log tail (which mirrors
## DevConsole.log_lines -- itself tailing Godot's real stdout log file) and
## a command input. Never touches mouse mode or pauses anything -- \
## GAINS keyboard focus on the input (never removes it); Esc/Tab/Enter
## REMOVE it (never gain it) -- so the player always has the mouse and
## camera, and DevConsole.is_focused is what the rest of the game gates on
## to stop gameplay actions leaking in while typing. No dim background
## either: fully transparent so the game stays visible behind the log.
##
## Fade math lives in DevConsoleFadeState (a plain, dependency-free class)
## rather than inline here, specifically so it's unit-testable through
## DevConsole's unit_fade_* commands with spoofed timestamps -- live/visual
## testing of fade timing kept missing real bugs (most recently: an
## earlier fade-on-any-log-activity design reset the timer on every stdout
## line project-wide, including two_handed_resource.gd's "prim"/"sec"
## click prints, which looked like "the console is always on" and "clicking
## the screen re-focuses it" when it was really just never fading at all).

var _root: Control
var _title_label: Label
var _log_label: RichTextLabel
var _command_input: LineEdit
var _fade_state := DevConsoleFadeState.new()

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_to_group("dev_console_ui")  # lets DevConsole's unit_ui_alpha find this instance
	_build_ui()
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
	_root.modulate.a = _fade_state.compute_alpha(DevConsole.is_focused, Time.get_ticks_msec())

## _input(), not _unhandled_input()+"ui_cancel": with the console's LineEdit
## focused, Escape/Tab were getting consumed by the LineEdit's own built-in
## behavior first (Escape defocuses it internally; Tab moves focus
## elsewhere), silently handing keyboard control back to the player without
## DevConsole ever finding out -- and a stray Escape then reached
## pause_menu.gd's _input() (bound to the same key) before this handler
## saw it, opening the pause menu instead. _input() runs before GUI
## dispatch, same fix as the Tab-focus-stealing bug in turn_tracker_menu.gd.
## Esc/Tab only ever REMOVE focus here, matching \ only ever GAINING it in
## dev_console.gd -- neither one is a toggle anymore.
func _input(event: InputEvent) -> void:
	if not DevConsole.is_focused or not (event is InputEventKey) or not event.pressed or event.is_echo():
		return
	if event.keycode == KEY_ESCAPE or event.keycode == KEY_TAB:
		DevConsole.set_focused(false)
		get_viewport().set_input_as_handled()

func _on_focus_toggled(is_focused: bool) -> void:
	_update_title()
	if is_focused:
		_command_input.grab_focus()
	else:
		_command_input.release_focus()

func _update_title() -> void:
	_title_label.text = "Dev Console  (Esc to unfocus)" if DevConsole.is_focused else "Dev Console  (\\ to type)"

## For DevConsole's unit_ui_alpha test command -- see dev_console.gd.
func get_debug_alpha() -> float:
	return _root.modulate.a

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

	# mouse_filter IGNORE, not the default STOP/PASS: the mouse never
	# leaves the player now (no mode switch on focus), so this must never
	# intercept a click meant for gameplay. focus_mode CLICK, not the
	# LineEdit default ALL: keeps it out of Tab's focus-traversal chain
	# entirely (Tab should only ever REMOVE focus here, never grant it),
	# while still allowing the programmatic grab_focus() calls above.
	_command_input = LineEdit.new()
	_command_input.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_command_input.focus_mode = Control.FOCUS_CLICK
	_command_input.placeholder_text = "type a command, e.g. 'help'"
	_command_input.text_submitted.connect(_on_command_submitted)
	vbox.add_child(_command_input)


func _on_command_submitted(text: String) -> void:
	DevConsole.run_command(text)
	_command_input.text = ""
	# Enter removes focus (per spec: only \ gains it) -- release_focus()
	# alone isn't enough since the _process() babysitter would just grab
	# it right back while DevConsole still considers itself focused.
	DevConsole.set_focused(false)


func _on_log_updated(_new_lines: Array) -> void:
	_refresh_log()


func _refresh_log() -> void:
	_log_label.text = "\n".join(DevConsole.log_lines)

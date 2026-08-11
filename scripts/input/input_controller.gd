extends Node

## Autoload. Single place for "what is currently allowed to read player
## input" -- built to replace the pattern that was spreading across
## player_blob_ctrl.gd, ledge_grabber.gd, left_hand_gripper.gd, and
## two_handed_resource.gd: each one independently checking
## `Input.mouse_mode == CAPTURED` and/or `DevConsole.is_focused` (or both,
## combined slightly differently each time) before trusting a raw
## Input.is_action_pressed()/get_vector() call. Any UI that wants exclusive
## input now just calls request_capture()/release_capture() here (same
## reference-counted-by-key pattern as UiPauseGate, for the same reason --
## more than one thing might want it at overlapping times); this also now
## OWNS Input.mouse_mode, so individual menus don't call
## Input.set_mouse_mode() directly anymore either.
##
## Gameplay code should read input through THIS (is_action_pressed(),
## get_action_strength(), get_vector(), the action_pressed/action_released
## signals) instead of the Input singleton directly -- capture-awareness is
## then automatic, with nothing left for each caller to check itself.
##
## Also owns the one double-tap-detection timer (was_double_tapped()) so
## player_blob_ctrl.gd's fly/intangible gestures and movement_resource.gd's
## sprint gesture don't each reimplement their own last-press-time
## bookkeeping; a general ordered-sequence matcher (register_sequence()/
## sequence_matched, Konami-code style -- see player_blob_ctrl.gd's
## easter egg) for anything with more shape than a same-action double-tap;
## and register_action() so mods can define new bindings at runtime and get
## the same capture-aware polling/signals for free, purely by name.

signal capture_changed(is_captured: bool)
signal action_pressed(action: String, event: InputEvent)
signal action_released(action: String, event: InputEvent)
signal sequence_matched(name: String)

var _capture_reasons: Dictionary = {}  # owner key -> hide_mouse: bool
var _last_tap_msec: Dictionary = {}  # action -> int
var _sequences: Dictionary = {}  # name -> {"steps": Array[String], "window_ms": int}
var _recent_presses: Array = []  # [{"action": String, "msec": int}, ...], newest last

## ---------------------------------------------------------------------
## Exclusive capture -- also owns Input.mouse_mode
## ---------------------------------------------------------------------

## hide_mouse: whether this reason also wants the OS cursor visible
## (menus, generally) vs not (the dev console, deliberately -- see
## dev_console.gd). The mouse is shown if ANY active reason wants it shown.
func request_capture(owner: String, hide_mouse: bool = true) -> void:
	var was_captured := is_captured()
	_capture_reasons[owner] = hide_mouse
	_apply_mouse_mode()
	if not was_captured:
		capture_changed.emit(true)

func release_capture(owner: String) -> void:
	if not _capture_reasons.has(owner):
		return
	_capture_reasons.erase(owner)
	_apply_mouse_mode()
	if not is_captured():
		capture_changed.emit(false)

func is_captured() -> bool:
	return not _capture_reasons.is_empty()

func _apply_mouse_mode() -> void:
	var want_visible := false
	for owner in _capture_reasons:
		if _capture_reasons[owner]:
			want_visible = true
			break
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if want_visible else Input.MOUSE_MODE_CAPTURED)

## ---------------------------------------------------------------------
## Capture-aware polling -- gameplay should call these, not Input directly
## ---------------------------------------------------------------------

func is_action_pressed(action: String) -> bool:
	return not is_captured() and Input.is_action_pressed(action)

func get_action_strength(action: String) -> float:
	return 0.0 if is_captured() else Input.get_action_strength(action)

func get_vector(neg_x: String, pos_x: String, neg_y: String, pos_y: String) -> Vector2:
	return Vector2.ZERO if is_captured() else Input.get_vector(neg_x, pos_x, neg_y, pos_y)

## ---------------------------------------------------------------------
## Event-driven consumers -- capture-aware, is_echo-filtered, generic by
## action name so mod-registered actions (see register_action() below)
## work the same as built-in ones with no special-casing anywhere.
## Menus/the console still handle their OWN toggle keys directly in their
## own scripts (request_capture() is how they take exclusive input, not
## this) -- this is only for gameplay-facing actions.
## ---------------------------------------------------------------------

func _input(event: InputEvent) -> void:
	if is_captured() or event.is_echo():
		return
	for action in InputMap.get_actions():
		if event.is_action_pressed(action):
			action_pressed.emit(action, event)
			for matched_name in record_press_for_sequences(action, Time.get_ticks_msec()):
				sequence_matched.emit(matched_name)
		elif event.is_action_released(action):
			action_released.emit(action, event)

## ---------------------------------------------------------------------
## Double-tap detection, generalized. Call from a fresh-press point (an
## action_pressed handler, or an is_action_pressed(...)-and-not-echo check
## like player_blob_ctrl.gd's). Consumes the stored timestamp on a
## positive result so a rapid 3rd tap starts a fresh pair instead of
## instantly re-triggering.
##
## now_msec takes the same "pass time in explicitly" shape as
## DevConsoleFadeState.compute_alpha() -- -1 (the default) means "use the
## real clock"; anything else lets DevConsole's unit_input_double_tap
## command drive this deterministically with spoofed timestamps, same
## reasoning as that class (live/visual testing of timing-sensitive logic
## kept missing real bugs).
## ---------------------------------------------------------------------

func was_double_tapped(action: String, window_ms: int = 350, now_msec: int = -1) -> bool:
	var now: int = now_msec if now_msec >= 0 else Time.get_ticks_msec()
	var last: int = _last_tap_msec.get(action, -window_ms - 1)
	var is_double: bool = (now - last) <= window_ms
	if is_double:
		_last_tap_msec.erase(action)
	else:
		_last_tap_msec[action] = now
	return is_double

## ---------------------------------------------------------------------
## Sequence / gesture detection -- generalizes "N presses in order, within
## a time window" (Konami-code style: up up down down left right left
## right B A start). Complements was_double_tapped() above rather than
## replacing it -- same-action-twice is common enough to want that
## lightweight synchronous check -- but this is the mechanism for anything
## with more shape than that: multi-step combos, item-use gestures, wall-
## jump timing windows, mod-defined gestures, all by the same action-name
## strings register_action()/is_action_pressed()/etc. already use.
##
## Matching is a plain rolling-buffer tail-check: every fresh press appends
## to _recent_presses, trimmed to the longest registered sequence, and each
## registered sequence is checked against the buffer's tail. A match clears
## the whole buffer (so overlapping/repeated steps, like the Konami code's
## own up-up-down-down, can't double-fire on a shared prefix).
## ---------------------------------------------------------------------

## window_ms: how long the WHOLE sequence has to land in, start to finish.
## -1 (the default) picks a generous 600ms per step.
func register_sequence(name: String, steps: Array, window_ms: int = -1) -> void:
	if window_ms < 0:
		window_ms = 600 * steps.size()
	_sequences[name] = {"steps": steps, "window_ms": window_ms}

func unregister_sequence(name: String) -> void:
	_sequences.erase(name)

## Normally only called internally from _input() above with the real
## clock -- exposed (not `_`-prefixed) specifically so DevConsole's
## unit_input_sequence_feed command can drive it with spoofed timestamps,
## same reasoning as was_double_tapped()'s now_msec parameter. Returns the
## names of any sequences that completed on this press.
func record_press_for_sequences(action: String, now_msec: int) -> Array:
	_recent_presses.append({"action": action, "msec": now_msec})
	var max_len := 1
	for name in _sequences:
		max_len = max(max_len, _sequences[name].steps.size())
	if _recent_presses.size() > max_len:
		_recent_presses = _recent_presses.slice(_recent_presses.size() - max_len)
	var matched: Array = []
	for name in _sequences:
		var steps: Array = _sequences[name].steps
		var window_ms: int = _sequences[name].window_ms
		if _recent_presses.size() < steps.size():
			continue
		var tail: Array = _recent_presses.slice(_recent_presses.size() - steps.size())
		if now_msec - tail[0].msec > window_ms:
			continue
		var ok := true
		for i in range(steps.size()):
			if tail[i].action != steps[i]:
				ok = false
				break
		if ok:
			matched.append(name)
	if not matched.is_empty():
		_recent_presses.clear()
	return matched

## ---------------------------------------------------------------------
## Mod extensibility -- lets a mod define a new action at runtime and get
## the same capture-aware polling/signals as everything above, purely by
## name; idempotent so a mod can call this unconditionally on load.
## ---------------------------------------------------------------------

func register_action(action: String, events: Array = [], deadzone: float = 0.2) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action, deadzone)
	for event in events:
		InputMap.action_add_event(action, event)

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

## Prints every action press and how it affects each registered sequence's
## progress -- diagnosed the Konami-code sequence not firing live despite
## matching correctly through the command queue (turned out to be a real
## bug in the matcher, since fixed) by catching a real attempt this way.
## Off by default now that it did its job; flip on again (from the
## Inspector, or a future dev-console command) for the same kind of
## input-sequence debugging later rather than deleting this.
@export var debug_log_input: bool = false

signal capture_changed(is_captured: bool)
signal action_pressed(action: String, event: InputEvent)
signal action_released(action: String, event: InputEvent)
signal sequence_matched(name: String)

var _capture_reasons: Dictionary = {}  # owner key -> hide_mouse: bool
var _last_tap_msec: Dictionary = {}  # action -> int
var _sequences: Dictionary = {}  # name -> {"steps": Array[String], "window_ms": int}
var _sequence_progress: Dictionary = {}  # name -> {"index": int, "since_msec": int}

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

## Unconditionally drops every capture reason -- same purpose as
## UiPauseGate.release_all(), called from the same place
## (WorldManager.switch_to_world()) for the same reason: this autoload
## survives scene reloads, but a menu that requested capture (e.g.
## dm_world_menu.gd switching worlds without closing itself first) does
## not, so its reason would otherwise be stuck forever with nothing left
## to release it -- silently blocking ALL movement and item use in the
## freshly-loaded world, since both are gated on is_captured().
func release_all_captures() -> void:
	_capture_reasons.clear()
	_apply_mouse_mode()
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

## Collects every action this ONE event satisfies before touching sequence
## state -- a single physical press routinely fires more than one action
## (e.g. right-click is bound to both "slide" and "secondary_item_click"
## in this project), and feeding them to record_press_for_sequences() one
## at a time let whichever one iterates first (definition order in
## project.godot, not anything meaningful) reset progress before the
## actually-relevant one got its turn. This is exactly what broke the
## live Konami-code attempt that the debug prints below caught: "slide"
## fired before "secondary_item_click" for the same right-click.
func _input(event: InputEvent) -> void:
	if is_captured() or event.is_echo():
		if debug_log_input and event is InputEventKey and event.pressed and not event.is_echo():
			print("[InputController] key event ignored, is_captured()=%s: %s" % [is_captured(), event.as_text()])
		return
	var pressed_actions: Array = []
	for action in InputMap.get_actions():
		if event.is_action_pressed(action):
			pressed_actions.append(action)
			action_pressed.emit(action, event)
		elif event.is_action_released(action):
			action_released.emit(action, event)
	if pressed_actions.is_empty():
		return
	if debug_log_input:
		print("[InputController] actions_pressed: %s" % ", ".join(pressed_actions))
	for matched_name in record_press_for_sequences(pressed_actions, Time.get_ticks_msec()):
		sequence_matched.emit(matched_name)

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
## Each registered sequence tracks its OWN progress index rather than
## sharing one rolling buffer across all of them (an earlier version did
## that, and it had a real bug: the buffer was capped to the longest
## registered sequence's length, so literally any OTHER action press
## during an attempt -- a stray scroll-wheel tick, "slow", anything --
## evicted an earlier step and silently broke the match; a live Konami-code
## attempt failed because of exactly this). A press that isn't this
## sequence's next expected step resets ONLY this sequence's progress
## (matching genre convention -- a wrong button breaks the combo) without
## touching any other registered sequence's progress at all.
## ---------------------------------------------------------------------

## window_ms: max gap allowed between two CONSECUTIVE correct steps (not a
## fixed budget for the whole sequence, which would unfairly penalize slow
## early steps) -- default 600ms, forgiving enough for deliberate manual
## input but tight enough to require real intent.
func register_sequence(name: String, steps: Array, window_ms: int = 600) -> void:
	_sequences[name] = {"steps": steps, "window_ms": window_ms}
	_sequence_progress[name] = {"index": 0, "since_msec": 0}

func unregister_sequence(name: String) -> void:
	_sequences.erase(name)
	_sequence_progress.erase(name)

## actions: every action name ONE physical event satisfied (not just one --
## see the doc comment on _input()'s pressed_actions collection above for
## why this has to be a batch, not a single string). Normally only called
## internally from _input() with the real clock -- exposed (not
## `_`-prefixed) specifically so DevConsole's unit_input_sequence_feed
## command can drive it with spoofed timestamps, same reasoning as
## was_double_tapped()'s now_msec parameter. Returns the names of any
## sequences that completed on this press.
func record_press_for_sequences(actions: Array, now_msec: int) -> Array:
	var matched: Array = []
	for name in _sequences:
		var steps: Array = _sequences[name].steps
		var window_ms: int = _sequences[name].window_ms
		var progress: Dictionary = _sequence_progress[name]
		var index: int = progress.index

		var timed_out: bool = index > 0 and now_msec - progress.since_msec > window_ms
		if timed_out:
			index = 0  # took too long since the last correct step -- start over

		var expected: String = steps[index]
		if expected in actions:
			index += 1
		elif steps[0] in actions:
			# Wrong next step, but one of this batch's actions is also a
			# valid START -- treat it as a fresh attempt beginning here
			# instead of losing it.
			index = 1
		else:
			index = 0

		if debug_log_input:
			print("[InputController] sequence '%s': actions=%s expected=%s%s index %d -> %d" % [
				name, ", ".join(actions), expected, " (timed out)" if timed_out else "", progress.index, index])

		if index >= steps.size():
			matched.append(name)
			index = 0

		_sequence_progress[name] = {"index": index, "since_msec": now_msec}
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

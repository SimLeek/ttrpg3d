extends Node

## Autoload. Dev/testing console -- "make sure to keep making progress" on
## the rest of the backlog needs a much less fragile way to drive the game
## than pixel-precise xdotool clicking, so this is a real command console:
## toggled in-game with \ (backslash -- see toggle_dev_console in the
## input map; `/` was already taken by tooltip_toggle. Apostrophe was
## tried too but did nothing at all for you, live -- most likely your
## system's input method treats it as a compose/dead-key for accented
## characters and swallows it before Godot ever sees a keypress; reverted
## rather than debug an X11/IME quirk further), plus startup CLI args for
## the same operations so a whole test scenario can be scripted with no
## interaction at all.
##
## The console never takes control away from the player: mouse mode is
## never touched, and the log/input bar stay in the scene tree at all
## times (dev_console_ui.gd just fades the log out ~10s after the last
## activity). \ only toggles keyboard FOCUS on the command input --
## is_focused below is the single source of truth other gameplay scripts
## check ("if DevConsole.is_focused: don't act on this key") since Godot's
## GUI focus system only intercepts *event*-based input for the focused
## Control, not Input.is_action_pressed()-style polling elsewhere in the
## tree -- see player_blob_ctrl.gd/ledge_grabber.gd/two_handed_resource.gd
## for the actual gates.
##
## Launch example:
##   godot --scene res://levels/voxel_main_world.tscn -- --world=hilly --pos=10,64,10 --hold=wood_plank
## Everything after the bare `--` is a user arg (OS.get_cmdline_user_args()),
## parsed as --key=value pairs and applied once the player exists.
##
## Also tails user://logs/godot.log (Godot's own default file log, which
## already captures every print()/push_warning()/push_error() call) so the
## on-screen console mirrors real stdout output, rather than only whatever
## this script itself prints.
##
## For automated testing specifically: appending a line to
## COMMAND_QUEUE_PATH (a plain text file, reset empty on every launch)
## runs it as a command too, independent of the in-game UI or window
## focus entirely -- simulating keypresses/clicks into the actual OS
## window turned out to be unreliable for this (xdotool-specific quirks:
## held-key auto-repeat, dead-key/compose-key swallowing, focus races),
## so driving the game by writing to this file and reading results back
## out of the log is the actually-reliable way to verify game state from
## outside the process.

signal log_updated(new_lines: Array)
signal focus_toggled(is_focused: bool)

const LOG_PATH := "user://logs/godot.log"
const MAX_LOG_LINES := 500
## A plain text file polled for new lines each frame, each run as a
## command -- lets an external process (a test harness, a human echoing
## into it from a terminal) drive the game directly by appending to a
## file, sidestepping window-focus/OS-input-simulation entirely. Reset
## empty on every launch so a previous session's leftover commands never
## replay. Independent of whether the in-game \ console UI is even open.
const COMMAND_QUEUE_PATH := "user://dev_console_commands.txt"

## Canonical focus state -- other scripts (pause_menu.gd, player_blob_ctrl.gd,
## ledge_grabber.gd, two_handed_resource.gd) check this directly rather than
## racing input-handler order against dev_console_ui.gd, since both it and
## pause_menu.gd react to Escape and which node's _input() runs first
## between two separate nodes isn't something to rely on.
var is_focused: bool = false

var log_lines: Array[String] = []
var command_history: Array[String] = []

var _log_file: FileAccess = null
var _log_read_pos: int = 0
var _command_queue_file: FileAccess = null
var _command_queue_read_pos: int = 0
var _commands: Dictionary = {}  # name -> Callable(args: Array[String]) -> String

func _ready() -> void:
	_register_builtin_commands()
	_open_log_tail()
	_open_command_queue()
	_apply_startup_args()

func _process(_delta: float) -> void:
	_poll_log_tail()
	_poll_command_queue()

## _input(), not _unhandled_input(): Node._input() runs before the Viewport
## dispatches to whichever Control has GUI focus, so consuming the event
## here (set_input_as_handled()) stops \ from ever reaching the focused
## LineEdit as a typed character.
##
## \ only GAINS focus, never removes it -- Esc/Tab/Enter are the only ways
## to remove it (dev_console_ui.gd handles Esc/Tab; Enter via
## LineEdit.text_submitted). Still consumed even when already focused, so
## pressing \ again doesn't leak a literal "\" into whatever you'd typed.
func _input(event: InputEvent) -> void:
	# is_echo() guard: a held/auto-repeating key otherwise fires this
	# handler many times for one physical press (seen live: 16 stray
	# backslashes ended up typed into the newly-focused input field from
	# a single \ press during testing).
	if event.is_action_pressed("toggle_dev_console") and not event.is_echo():
		if not is_focused:
			set_focused(true)
		get_viewport().set_input_as_handled()

func set_focused(value: bool) -> void:
	if value == is_focused:
		return
	is_focused = value
	# hide_mouse=false: the console deliberately never takes the mouse away
	# from the player (see dev_console_ui.gd) -- InputController.is_captured()
	# still becomes true while focused, though, so gameplay input
	# (movement, ledge grab, item use, etc.) is gated through the one
	# shared mechanism instead of every gameplay script importing
	# DevConsole and checking is_focused itself.
	if is_focused:
		InputController.request_capture("dev_console", false)
	else:
		InputController.release_capture("dev_console")
	focus_toggled.emit(is_focused)

## Runs a command line like "goto 10 64 10" or "hold wood_plank left".
## Returns the result text (also appended to log_lines/log_updated so both
## the console UI and anything tailing the real log see it).
func run_command(line: String) -> String:
	line = line.strip_edges()
	if line.is_empty():
		return ""
	command_history.append(line)
	var parts := line.split(" ", false)
	var cmd_name: String = parts[0].to_lower()
	var args: Array[String] = []
	for i in range(1, parts.size()):
		args.append(parts[i])
	var result: String
	if _commands.has(cmd_name):
		result = _commands[cmd_name].call(args)
	else:
		result = "Unknown command: %s (try 'help')" % cmd_name
	_append_log("> %s" % line)
	_append_log(result)
	print("[DevConsole] %s -> %s" % [line, result])
	return result

func register_command(name: String, fn: Callable) -> void:
	_commands[name.to_lower()] = fn

func _get_player() -> Node:
	return get_tree().get_first_node_in_group("player")

## ---------------------------------------------------------------------
## Built-in commands
##
## GDScript has no decorators to self-register a function the moment it's
## defined, but reflection gets close enough: every method here named
## _cmd_<name> is picked up automatically via get_method_list(), so adding
## a new command is *only* writing the function -- no separate list to
## remember to update. All of them share one signature,
## func _cmd_x(args: Array[String]) -> String, purely so this scan can
## call any of them uniformly.
## ---------------------------------------------------------------------

func _register_builtin_commands() -> void:
	for method in get_method_list():
		var method_name: String = method.get("name", "")
		if method_name.begins_with("_cmd_"):
			register_command(method_name.substr(5), Callable(self, method_name))

func _cmd_help(_args: Array[String]) -> String:
	# unit_* commands are deliberately left out -- they're a testing-only
	# back door for driving/inspecting the console's own UI state (see
	# below), not something a player/DM ever needs to know exists.
	var names: Array = _commands.keys().filter(func(n): return not n.begins_with("unit_"))
	names.sort()
	return "Commands: %s" % ", ".join(names)

func _cmd_pos(_args: Array[String]) -> String:
	var player := _get_player()
	if not player:
		return "no player"
	return "pos=%s rot_deg=%s" % [player.global_position, player.rotation_degrees]

func _cmd_battle(_args: Array[String]) -> String:
	BattleModeManager.toggle()
	return "battle mode: %s" % BattleModeManager.active

func _cmd_mark(_args: Array[String]) -> String:
	BattleModeManager.mark_current_position()
	return _waypoints_summary()

## Not a plain undo -- see battle_mode_manager.gd's doc comment for the
## walk-back-then-undo behavior. Reports player position too since which
## of those two things happened isn't otherwise visible from "undone"
## alone -- position changing (with waypoint count unchanged) means it
## walked back; count decreasing means it actually removed one.
func _cmd_undo(_args: Array[String]) -> String:
	BattleModeManager.undo_last_waypoint()
	var player := _get_player()
	var pos_str: String = str(player.global_position) if player else "no player"
	return "%s pos=%s" % [_waypoints_summary(), pos_str]

func _waypoints_summary() -> String:
	return "waypoints=%d last=%s" % [
		BattleModeManager.waypoints.size(),
		BattleModeManager.waypoints[-1] if not BattleModeManager.waypoints.is_empty() else "none",
	]

func _cmd_quit(_args: Array[String]) -> String:
	get_tree().quit()
	return "quitting"

## Raycast along the player's look direction using the same voxel-native
## VoxelTool.raycast() as battle mode's range check (reliable; a generic
## physics raycast was intermittent -- see TODO_modding_and_worlds.md).
## Works regardless of battle mode, unlike hud.gd's range check.
func _cmd_point(_args: Array[String]) -> String:
	var player := _get_player()
	if not player or not ("vt" in player) or not player.vt or not player.voxel_terrain or not ("spring_arm" in player):
		return "no player/voxel tool"
	# Same aim origin+direction the real targeting beam uses (anchored
	# near the character, not the camera -- see hud.gd's range check for
	# why that matters), so this agrees with what placing/breaking a
	# block would actually hit.
	var aim := VoxelInteractor.get_aim_ray(player)
	var hit = player.vt.raycast(aim.origin, aim.direction, 500.0)
	if not hit:
		return "pointing at: nothing within range"
	var world_pos: Vector3 = Vector3(hit.position) + player.voxel_terrain.global_position
	var voxel_id: int = player.vt.get_voxel(hit.position)
	return "pointing at: voxel_id=%d world_pos=%s dist=%.2f" % [voxel_id, world_pos, player.global_position.distance_to(world_pos)]

func _cmd_goto(args: Array[String]) -> String:
	var player := _get_player()
	if not player:
		return "no player"
	if args.size() < 3:
		return "usage: goto x y z [rx ry rz]"
	var pos := Vector3(args[0].to_float(), args[1].to_float(), args[2].to_float())
	player.global_position = pos
	player.velocity = Vector3.ZERO
	if args.size() >= 6:
		player.rotation_degrees = Vector3(args[3].to_float(), args[4].to_float(), args[5].to_float())
	return "moved to %s" % pos

func _cmd_hold(args: Array[String]) -> String:
	var player := _get_player()
	if not player:
		return "no player"
	if args.is_empty():
		return "usage: hold <item_id> [left|right]"
	var item_id: String = args[0]
	var hand_name: String = args[1] if args.size() > 1 else "primary"
	if not ("voxel_terrain" in player) or not player.voxel_terrain or not player.voxel_terrain.mesher:
		return "no voxel terrain/mesher"
	var library: VoxelBlockyLibrary = player.voxel_terrain.mesher.library
	ModManager.apply_voxel_registrations(library)
	var entry = null
	for e in ItemCatalog.get_available_items(library):
		if e.id == item_id or String(e.name).to_lower() == item_id.to_lower().replace("_", " "):
			entry = e
			break
	if not entry:
		var available: Array[String] = []
		for e in ItemCatalog.get_available_items(library):
			available.append("%s (%s)" % [e.id, e.name])
		return "no such item: %s. Available: %s" % [item_id, ", ".join(available)]
	var two_handed = player.get("two_handed")
	if not two_handed:
		return "player has no two_handed resource"
	var hand
	match hand_name:
		"left":
			hand = two_handed.left_hand
		"right":
			hand = two_handed.right_hand
		_:
			hand = two_handed.right_hand if two_handed.right_hand.primary else two_handed.left_hand
	if not hand:
		return "no such hand: %s" % hand_name
	hand.equip_item(ItemCatalog.instantiate_item(entry))
	return "equipped %s to %s hand" % [item_id, hand_name]

## Grabs whatever the main viewport rendered this frame and writes it to
## user://<name>.png -- the only way to visually inspect a running headless
## game instance from outside (no GUI to look at directly).
func _cmd_screenshot(args: Array[String]) -> String:
	var name: String = args[0] if not args.is_empty() else "screenshot"
	var img := get_viewport().get_texture().get_image()
	var path := "user://%s.png" % name
	img.save_png(path)
	return "saved %s" % ProjectSettings.globalize_path(path)

func _cmd_world(args: Array[String]) -> String:
	if args.is_empty():
		var ids: Array[String] = []
		for w in WorldManager.worlds:
			ids.append("%s (%s, gen=%s)" % [w.get("id", "?"), w.get("name", "?"), w.get("generator_id", "?")])
		return "worlds: %s" % ", ".join(ids)
	var target: String = args[0]
	# Try an exact id/name match first, then fall back to "first world
	# using this generator" -- lets a test script say `world hilly`
	# without needing to know the specific saved world's generated id.
	for w in WorldManager.worlds:
		if w.get("id", "") == target or w.get("name", "") == target:
			WorldManager.switch_to_world(w)
			return "switching to %s" % target
	for w in WorldManager.worlds:
		if w.get("generator_id", "") == target:
			WorldManager.switch_to_world(w)
			return "switching to %s (matched generator %s)" % [w.get("id", "?"), target]
	return "no such world: %s" % target

## ---------------------------------------------------------------------
## Testing back door for the console's OWN ui/focus state -- live/visual
## testing of dev_console_ui.gd (fade timing, focus gating) kept missing
## real bugs (xdotool quirks, and separately a fade-reset-on-any-log-line
## design that made the fade look "always on"). These commands let an
## external harness (the COMMAND_QUEUE_PATH file) drive and inspect that
## state directly and deterministically -- spoofed timestamps for the pure
## fade math, no real waiting or window focus required.
## ---------------------------------------------------------------------

var _test_fade_state: DevConsoleFadeState = null

## unit_fade_new: starts a fresh, isolated DevConsoleFadeState -- doesn't
## touch the real UI's own fade state, so this can be exercised mid-game
## without disturbing what's actually on screen.
func _cmd_unit_fade_new(_args: Array[String]) -> String:
	_test_fade_state = DevConsoleFadeState.new()
	return "ok"

## unit_fade_step <0|1> <now_msec>: feeds one (is_focused, now) pair into
## the test fade state and returns the resulting alpha -- call repeatedly
## with hand-picked timestamps to check exact fade-curve behavior (e.g. at
## exactly +10000ms, +10001ms, +5000ms after unfocusing) without waiting
## real seconds for each check.
func _cmd_unit_fade_step(args: Array[String]) -> String:
	if not _test_fade_state:
		_test_fade_state = DevConsoleFadeState.new()
	if args.size() < 2:
		return "usage: unit_fade_step <0|1> <now_msec>"
	var focused: bool = args[0] == "1" or args[0].to_lower() == "true"
	var alpha: float = _test_fade_state.compute_alpha(focused, args[1].to_int())
	return "alpha=%.4f" % alpha

## unit_set_focused <0|1>: does exactly what a real \/Esc/Tab/Enter would
## do to is_focused, without needing a real keypress to land on the real
## game window -- lets a test check the *downstream effects* of a focus
## change (movement gating, the real UI's alpha) deterministically.
func _cmd_unit_set_focused(args: Array[String]) -> String:
	if args.is_empty():
		return "usage: unit_set_focused <0|1>"
	set_focused(args[0] == "1" or args[0].to_lower() == "true")
	return "is_focused=%s" % is_focused

## unit_ui_alpha: reports the REAL dev_console_ui.gd instance's current
## rendered alpha, to confirm it's actually wired to DevConsoleFadeState
## correctly in the live scene (not just correct in isolation via
## unit_fade_step above).
func _cmd_unit_ui_alpha(_args: Array[String]) -> String:
	var ui := get_tree().get_first_node_in_group("dev_console_ui")
	if not ui:
		return "no dev_console_ui node found"
	return "alpha=%.4f focused=%s" % [ui.get_debug_alpha(), is_focused]

## unit_input_captured: reports InputController's real, current capture
## state -- confirms set_focused() above actually reaches it (and lets a
## test check the SAME thing gameplay scripts now check).
func _cmd_unit_input_captured(_args: Array[String]) -> String:
	return "captured=%s mouse_mode=%s" % [InputController.is_captured(), Input.mouse_mode]

## unit_input_request_capture <owner>: simulates a menu opening (without
## needing the real menu/keypress) -- specifically for testing that
## WorldManager.switch_to_world() correctly releases it via
## InputController.release_all_captures(), the same way a menu that opened
## then switched worlds without closing itself first would otherwise leave
## a stuck capture reason behind (silently blocking all movement/item use
## in the new world).
func _cmd_unit_input_request_capture(args: Array[String]) -> String:
	InputController.request_capture(args[0] if not args.is_empty() else "unit_test")
	return "captured=%s" % InputController.is_captured()

## unit_jump: calls player.basic_jumper.request_jump() directly -- jump is
## handled entirely through a real InputEvent
## (basic_jump_resource.gd::handle_immediate_input(), wired from
## player_blob_ctrl.gd's _input()), so unlike held-action mechanics
## (unit_input_press/release, which only affect Input.is_action_pressed()
## polling) there's no way to simulate a jump through the command queue
## without this -- confirmed live while testing the ledge-safety
## jump-arc fix: unit_input_press("jump") produced no vertical velocity
## at all, since nothing in the jump path polls Input directly.
func _cmd_unit_jump(_args: Array[String]) -> String:
	var player := _get_player()
	if not player or not ("basic_jumper" in player) or not player.basic_jumper:
		return "no player/basic_jumper"
	player.basic_jumper.request_jump()
	return "jump requested"

## unit_toggle_fly/unit_toggle_intangible: F/double-Ctrl are ALSO real
## InputEvents (player_blob_ctrl.gd's _input()), same event-vs-polling gap
## as unit_jump above. Call try_toggle_flying()/try_toggle_intangible()
## directly -- the same methods _input() calls -- rather than just setting
## is_flying/is_intangible, so this exercises the real hotbar-possession
## gate too, not a bypass of it.
func _cmd_unit_toggle_fly(_args: Array[String]) -> String:
	var player := _get_player()
	if not player or not player.has_method("try_toggle_flying"):
		return "no player"
	player.try_toggle_flying()
	return "is_flying=%s" % player.is_flying

func _cmd_unit_toggle_intangible(_args: Array[String]) -> String:
	var player := _get_player()
	if not player or not player.has_method("try_toggle_intangible"):
		return "no player"
	player.try_toggle_intangible()
	return "is_intangible=%s" % player.is_intangible

## unit_set_hotbar_slot <index> <item_id>: puts `item_id` into hotbar slot
## `index` -- same effect as clicking an item in the inventory grid while
## that slot's selected. `hold <item>` (existing command) equips a hand
## directly and never touches the hotbar array, so it can't test Phase 8's
## hotbar-possession-gated movement items at all -- this is the only way
## to get an item into the hotbar through the command queue.
func _cmd_unit_set_hotbar_slot(args: Array[String]) -> String:
	if args.size() < 2:
		return "usage: unit_set_hotbar_slot <index> <item_id>"
	var inv := get_tree().get_first_node_in_group("player_inventory")
	if not inv:
		return "no player_inventory"
	inv.set_hotbar_slot(args[0].to_int(), args[1])
	return "set hotbar slot %s to %s" % [args[0], args[1]]

## unit_use_item [left|right]: calls HandController.use_hand(1.0) directly
## -- primary_item_click/secondary_item_click are ALSO real InputEvents
## (two_handed_resource.gd::handle_immediate_input(), from
## player_blob_ctrl.gd's _input()), same event-vs-polling gap as
## unit_jump above, so there'd be no way to test click-triggered items
## (the enemy spawn egg, block placement, punching, ...) through the
## command queue without this.
func _cmd_unit_use_item(args: Array[String]) -> String:
	var player := _get_player()
	if not player or not ("two_handed" in player) or not player.two_handed:
		return "no player/two_handed"
	var hand_name: String = args[0] if not args.is_empty() else "right"
	var hand = player.two_handed.left_hand if hand_name == "left" else player.two_handed.right_hand
	if not hand:
		return "no such hand: %s" % hand_name
	hand.use_hand(1.0)
	return "used %s hand's item" % hand_name

## unit_input_press/unit_input_release <action>: Godot's own
## Input.action_press()/action_release() -- a software-held action state,
## not a single event, so is_action_pressed() reads it as held across
## multiple physics frames the same way a real held key would. The
## sequence-matcher commands above simulate discrete *events*; this is for
## testing HELD-button mechanics instead (ledge safety, anything else that
## reads InputController.is_action_pressed() continuously) without a real
## keyboard.
func _cmd_unit_input_press(args: Array[String]) -> String:
	if args.is_empty():
		return "usage: unit_input_press <action>"
	Input.action_press(args[0])
	return "pressed %s" % args[0]

func _cmd_unit_input_release(args: Array[String]) -> String:
	if args.is_empty():
		return "usage: unit_input_release <action>"
	Input.action_release(args[0])
	return "released %s" % args[0]

## unit_input_double_tap <action> <window_ms> <now_msec>: drives
## InputController.was_double_tapped() with a spoofed timestamp -- call
## twice with the same action and hand-picked now_msec values to check the
## exact window boundary without waiting real time or a real keypress.
func _cmd_unit_input_double_tap(args: Array[String]) -> String:
	if args.size() < 3:
		return "usage: unit_input_double_tap <action> <window_ms> <now_msec>"
	var result: bool = InputController.was_double_tapped(args[0], args[1].to_int(), args[2].to_int())
	return "double_tapped=%s" % result

## unit_input_sequence_register <name> <window_ms> <step1,step2,...>: wraps
## InputController.register_sequence() for testing -- steps are a single
## comma-separated arg since sequences can be longer than a normal command
## line's word count comfortably allows.
func _cmd_unit_input_sequence_register(args: Array[String]) -> String:
	if args.size() < 3:
		return "usage: unit_input_sequence_register <name> <window_ms> <step1,step2,...>"
	var steps: Array = Array(args[2].split(","))
	InputController.register_sequence(args[0], steps, args[1].to_int())
	return "registered %s: %s" % [args[0], ", ".join(steps)]

## unit_input_sequence_feed <action1,action2,...> <now_msec>: drives
## InputController.record_press_for_sequences() with a spoofed timestamp --
## call once per step of a sequence under test, in order, to check exact
## matching/window-boundary behavior without a real keyboard or real
## waiting. Actions is comma-separated (usually just one) so a test can
## reproduce a single physical press satisfying multiple actions at once --
## e.g. "slide,secondary_item_click" for a real right-click in this
## project -- which is exactly what broke the live Konami-code attempt
## (record_press_for_sequences() takes a batch for this reason; see
## _input()'s doc comment). Also emits sequence_matched for anything that
## completes (which record_press_for_sequences() alone does NOT do -- only
## the real _input() path does that normally), so this exercises whatever's
## actually connected to the signal too, not just the matching math.
func _cmd_unit_input_sequence_feed(args: Array[String]) -> String:
	if args.size() < 2:
		return "usage: unit_input_sequence_feed <action1,action2,...> <now_msec>"
	var actions: Array = Array(args[0].split(","))
	var matched: Array = InputController.record_press_for_sequences(actions, args[1].to_int())
	for matched_name in matched:
		InputController.sequence_matched.emit(matched_name)
	return "matched=%s" % (", ".join(matched) if not matched.is_empty() else "none")

## ---------------------------------------------------------------------
## Startup CLI args
## ---------------------------------------------------------------------

func _apply_startup_args() -> void:
	var parsed := _parse_cmdline_args()
	if parsed.is_empty():
		return
	await get_tree().process_frame
	while not _get_player():
		await get_tree().process_frame
	if parsed.has("world"):
		run_command("world %s" % parsed["world"])
		# switch_to_world() reloads the whole scene asynchronously --
		# without waiting this out, pos/rot/hold below would race the
		# reload and apply to (or via) a player that's already being
		# freed. Wait for the old player reference to stop resolving,
		# then for a new one to appear.
		var old_player := _get_player()
		await get_tree().process_frame
		while not _get_player() or _get_player() == old_player:
			await get_tree().process_frame
	var player := _get_player()
	if parsed.has("pos"):
		var coords: PackedStringArray = parsed["pos"].split(",")
		if coords.size() >= 3:
			run_command("goto %s %s %s" % [coords[0], coords[1], coords[2]])
	if parsed.has("rot"):
		var rot: PackedStringArray = parsed["rot"].split(",")
		if rot.size() >= 3 and ("global_position" in player):
			player.rotation_degrees = Vector3(rot[0].to_float(), rot[1].to_float(), rot[2].to_float())
	if parsed.has("hold"):
		run_command("hold %s" % parsed["hold"])

## Godot passes everything after a bare "--" on the command line through
## unparsed, as OS.get_cmdline_user_args() -- e.g.
## `godot --scene res://... -- --world=hilly --pos=1,2,3` gives
## ["--world=hilly", "--pos=1,2,3"] here.
func _parse_cmdline_args() -> Dictionary:
	var result := {}
	for arg in OS.get_cmdline_user_args():
		if not arg.begins_with("--"):
			continue
		var stripped: String = arg.substr(2)
		var eq := stripped.find("=")
		if eq == -1:
			result[stripped] = true
		else:
			result[stripped.substr(0, eq)] = stripped.substr(eq + 1)
	return result

## ---------------------------------------------------------------------
## External command queue (see COMMAND_QUEUE_PATH above)
## ---------------------------------------------------------------------

func _open_command_queue() -> void:
	# Truncate to empty on every launch (fresh each run -- a leftover
	# command from a previous session should never replay), then reopen
	# for reading.
	var writer := FileAccess.open(COMMAND_QUEUE_PATH, FileAccess.WRITE)
	if writer:
		writer.close()
	_command_queue_file = FileAccess.open(COMMAND_QUEUE_PATH, FileAccess.READ)
	_command_queue_read_pos = 0

func _poll_command_queue() -> void:
	if not _command_queue_file:
		return
	var current_len := _command_queue_file.get_length()
	if current_len <= _command_queue_read_pos:
		return
	_command_queue_file.seek(_command_queue_read_pos)
	var new_text := _command_queue_file.get_buffer(current_len - _command_queue_read_pos).get_string_from_utf8()
	_command_queue_read_pos = current_len
	for line in new_text.split("\n", false):
		run_command(line)

## ---------------------------------------------------------------------
## Log tailing (mirrors real stdout -- Godot's own file log already
## captures every print()/push_warning()/push_error() call)
## ---------------------------------------------------------------------

func _open_log_tail() -> void:
	if not FileAccess.file_exists(LOG_PATH):
		return
	_log_file = FileAccess.open(LOG_PATH, FileAccess.READ)
	if _log_file:
		_log_read_pos = _log_file.get_length()  # start at end -- only tail new output

func _poll_log_tail() -> void:
	if not _log_file:
		_open_log_tail()
		return
	var current_len := _log_file.get_length()
	if current_len <= _log_read_pos:
		return
	_log_file.seek(_log_read_pos)
	var new_text := _log_file.get_buffer(current_len - _log_read_pos).get_string_from_utf8()
	_log_read_pos = current_len
	var new_lines := new_text.split("\n", false)
	for line in new_lines:
		_append_log(line)

func _append_log(line: String) -> void:
	if line.is_empty():
		return
	log_lines.append(line)
	if log_lines.size() > MAX_LOG_LINES:
		log_lines = log_lines.slice(log_lines.size() - MAX_LOG_LINES)
	log_updated.emit([line])

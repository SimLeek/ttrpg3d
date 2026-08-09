extends Node

## Autoload. Dev/testing console -- "make sure to keep making progress" on
## the rest of the backlog needs a much less fragile way to drive the game
## than pixel-precise xdotool clicking, so this is a real command console:
## toggled in-game with \ (backslash -- see toggle_dev_console in the input
## map; `/` was already taken by tooltip_toggle), plus startup CLI args for
## the same operations so a whole test scenario can be scripted with no
## interaction at all.
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

signal log_updated(new_lines: Array)
signal visibility_toggled(is_open: bool)

const LOG_PATH := "user://logs/godot.log"
const MAX_LOG_LINES := 500

var log_lines: Array[String] = []
var command_history: Array[String] = []

var _log_file: FileAccess = null
var _log_read_pos: int = 0
var _commands: Dictionary = {}  # name -> Callable(args: Array[String]) -> String

func _ready() -> void:
	_register_builtin_commands()
	_open_log_tail()
	_apply_startup_args()

func _process(_delta: float) -> void:
	_poll_log_tail()

func _unhandled_input(event: InputEvent) -> void:
	# is_echo() guard: a held/auto-repeating key otherwise fires this
	# handler many times for one physical press (seen live: 16 stray
	# backslashes ended up typed into the newly-focused input field from
	# a single \ press during testing).
	if event.is_action_pressed("toggle_dev_console") and not event.is_echo():
		visibility_toggled.emit(true)
		get_viewport().set_input_as_handled()

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
## ---------------------------------------------------------------------

func _register_builtin_commands() -> void:
	register_command("help", func(_a): return _cmd_help())
	register_command("pos", func(_a): return _cmd_pos())
	register_command("point", func(_a): return _cmd_point())
	register_command("goto", _cmd_goto)
	register_command("hold", _cmd_hold)
	register_command("world", _cmd_world)
	register_command("battle", func(_a): BattleModeManager.toggle(); return "battle mode: %s" % BattleModeManager.active)
	register_command("mark", func(_a): BattleModeManager.mark_current_position(); return "marked")
	register_command("undo", func(_a): BattleModeManager.undo_last_waypoint(); return "undone")
	register_command("quit", func(_a): get_tree().quit(); return "quitting")

func _cmd_help() -> String:
	var names := _commands.keys()
	names.sort()
	return "Commands: %s" % ", ".join(names)

func _cmd_pos() -> String:
	var player := _get_player()
	if not player:
		return "no player"
	return "pos=%s rot_deg=%s" % [player.global_position, player.rotation_degrees]

## Raycast along the player's look direction using the same voxel-native
## VoxelTool.raycast() as battle mode's range check (reliable; a generic
## physics raycast was intermittent -- see TODO_modding_and_worlds.md).
## Works regardless of battle mode, unlike hud.gd's range check.
func _cmd_point() -> String:
	var player := _get_player()
	var camera := get_viewport().get_camera_3d()
	if not player or not camera or not ("vt" in player) or not player.vt or not player.voxel_terrain:
		return "no player/camera/voxel tool"
	var forward: Vector3 = -camera.global_transform.basis.z
	var hit = player.vt.raycast(camera.global_position, forward, 500.0)
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

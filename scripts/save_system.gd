extends Node

var current_save: String = ""
const global_save = "user://saves/global.save"

const SAVE_DIR = "user://saves/"
const SAVE_EXTENSION = ".save"

var save_data: Dictionary = {};
var global_data: Dictionary = {};

func set_current_save(save_name: String) -> void:
	current_save = SAVE_DIR + save_name + SAVE_EXTENSION

func quick_save() -> void:
	# Should never happen. This is a bug, so stop the editor:
	assert( 
		!current_save.is_empty(), 
		"ERROR: Quick save should always be called after current save is set."
	);

	var file = FileAccess.open(current_save, FileAccess.WRITE)
	
	if file:
		file.store_string(JSON.stringify(save_data))
		file.close()
		print("Game saved to: ", current_save)
	else:
		# todo: make this a popup so players can actually see this in the rare case it happens.
		print("Error saving game. Make sure the game save directory is writable by the current user.")

func save_global() -> void:
	# Should never happen. This is a bug, so stop the editor:
	assert( 
		!global_save.is_empty(), 
		"ERROR: Master save should always be called after current save is set."
	);

	var file = FileAccess.open(global_save, FileAccess.WRITE)
	
	if file:
		file.store_string(JSON.stringify(global_data))
		file.close()
		print("Game saved to: ", global_save)
	else:
		# todo: make this a popup so players can actually see this in the rare case it happens.
		print("Error saving game. Make sure the game save directory is writable by the current user.")

func save_game(save_name: String) -> void:
	set_current_save(save_name)
	quick_save()

func load_game() -> void:
	# Should never happen, so alert a programmer
	assert(not(current_save.is_empty() or not FileAccess.file_exists(current_save)),
	"Error: Save file not found at %s" % [current_save])

	var file = FileAccess.open(current_save, FileAccess.READ)
	var content = file.get_as_text()
	file.close()
	var data = JSON.parse_string(content)
	# if this happens it's a serious bug too:
	assert(
		data is Dictionary, 
		"Save data could not be parsed from %s" % [current_save]
		)
	save_data = data
	print("Game data loaded from: ", current_save)

func load_global_save() -> void:
	# first time global is used. Just make it.
	if not FileAccess.file_exists(global_save):
		print("creating new global save")
		save_global()
		return

	var file = FileAccess.open(global_save, FileAccess.READ)
	var content = file.get_as_text()
	file.close()
	var data = JSON.parse_string(content)
	# if this happens it's a serious bug too:
	assert(
		data is Dictionary, 
		"Global data could not be parsed from %s" % [current_save]
		)
	global_data = data
	print("Global data loaded from: ", current_save)

func get_available_saves() -> Array:
	var saves: Array = []
	var dir = DirAccess.open(SAVE_DIR)
	print(dir)
	if dir:
		var global_filename := global_save.get_file()
		print(global_filename)
		dir.list_dir_begin()
		var file_name = dir.get_next()
		while file_name != "":
			print(file_name)
			if file_name.ends_with(SAVE_EXTENSION) and file_name != global_filename:
					saves.append(file_name.replace(SAVE_EXTENSION, ""))
			file_name = dir.get_next()
	return saves

func get_current_save_index() -> int:
	var saves = get_available_saves()
	var current_save_name = current_save.get_file().replace(SAVE_EXTENSION, "")
	return saves.find(current_save_name)

func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(SAVE_DIR)
	load_global_save()
	print(ProjectSettings.localize_path(global_save))
	print(OS.get_user_data_dir())


# Called every frame. 'delta' is the elapsed time since the previous frame.
#func _process(delta: float) -> void:
#	pass

extends CanvasLayer


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	visible = false  # don't start paused while being able to move

func _input(event):
	if event.is_action_pressed("pause"):
		handle_pause()

func handle_pause():
		var new_pause_state = not get_tree().paused
		get_tree().paused = new_pause_state
		visible = new_pause_state
		# Optional: Show/hide mouse cursor
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE if new_pause_state else Input.MOUSE_MODE_CAPTURED)


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	pass


func _on_continue_pressed() -> void:
	handle_pause()


func _on_config_pressed() -> void:
	pass # Nothing for now


func _on_respawn_pressed() -> void:
	pass # Nothing for now


func _on_main_menu_pressed() -> void:
	get_tree().paused = false  # always do this when going to a new scene
	get_tree().change_scene_to_file("res://menus/main_menu.tscn")
	
	
func _on_exit_pressed() -> void:
	get_tree().paused = false
	get_tree().quit()

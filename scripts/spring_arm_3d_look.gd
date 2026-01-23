extends SpringArm3D

@export var mouse_sensitivity := 0.1
@export var player_body: CharacterBody3D  # Link your player node here in the Inspector

@export_group("Zoom Settings")
@export var zoom_speed := 0.5
@export var min_zoom := 1.5
@export var max_zoom := 8.0
@export var zoom_smoothness := 10.0 # Higher = faster snap

var target_zoom: float = 5.0

func _ready():
	# If not manually linked, try to find the parent CharacterBody3D
	if not player_body:
		player_body = get_parent() as CharacterBody3D
		
	# Note: this doesn't work for web dev. Instead, every menu entry that goes to a game should set this.
	# https://docs.godotengine.org/en/3.2/getting_started/workflow/export/exporting_for_web.html#full-screen-and-mouse-capture
	# it specifically has to be from _input or _unhandled_input, not calling Input.something
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	
	# Exclude player from camera collision to prevent "jitter"
	add_excluded_object(player_body.get_rid())
	# Initialize target zoom to the starting spring length
	target_zoom = spring_length

func _unhandled_input(event):
	if event.is_action_pressed("ui_cancel"): # Usually mapped to Escape
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		#DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	if event is InputEventMouseMotion:
		# 1. Rotate the PLAYER horizontally (Y-axis)
		player_body.rotate_y(deg_to_rad(-event.relative.x * mouse_sensitivity))
		
		# 2. Rotate the CAMERA verticaly (X-axis)
		#rotate_x(deg_to_rad(-event.relative.y * mouse_sensitivity))
		rotation.x -= deg_to_rad(event.relative.y * mouse_sensitivity)

		# 3. Clamp vertical rotation so you don't flip upside down
		rotation.x = clamp(rotation.x, deg_to_rad(-70), deg_to_rad(30))
	# 2. MOUSE SCROLL ZOOM
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			print("zoom in")
			target_zoom = clamp(target_zoom - zoom_speed, min_zoom, max_zoom)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			print("zoom out")
			target_zoom = clamp(target_zoom + zoom_speed, min_zoom, max_zoom)
		elif event.button_index == MOUSE_BUTTON_LEFT:
			print("left button pressed")
			if event.pressed:
				print("web compatible pointer capture")
				#DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
				Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
			

func _process(delta):
	# 3. SMOOTH THE ZOOM
	# lerp ensures the camera doesn't "snap" instantly when scrolling
	spring_length = lerp(spring_length, target_zoom, delta * zoom_smoothness)

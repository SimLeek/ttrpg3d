extends SpringArm3D

@export var mouse_sensitivity := 0.1
@export var controller_sensitivity := 3.0
@export var player_body: CharacterBody3D  # Link your player node here in the Inspector
@export var min_length_percent = .1
@export var cam: Camera3D

@export_group("Zoom Settings")
@export var zoom_speed := 0.5
@export var min_zoom := 0.0
@export var max_zoom := 8.0
@export var first_person_zoom := 1.0
@export var zoom_smoothness := 10.0 # Higher = faster snap

var target_zoom: float = 5.0
var push_dist: float = 0.0
var final_dist: float = 0.0
var is_first_person:bool=false
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
	final_dist = target_zoom

func _unhandled_input(event):
	if event.is_action_pressed("ui_cancel"): # Usually mapped to Escape
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		#DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
		
	if event.is_action_pressed("zoom_click"):
		target_zoom = target_zoom - zoom_speed
		if target_zoom < min_zoom:
			target_zoom = max_zoom
		
	#if event.is_action_pressed("zoom_out"):
	#	target_zoom = clamp(target_zoom + zoom_speed, min_zoom, max_zoom)
		
	if event is InputEventMouseMotion:
		# 1. Rotate the PLAYER horizontally (Y-axis)
		player_body.rotate_y(deg_to_rad(-event.relative.x * mouse_sensitivity))
		
		# 2. Rotate the CAMERA verticaly (X-axis)
		#rotate_x(deg_to_rad(-event.relative.y * mouse_sensitivity))
		rotation.x -= deg_to_rad(event.relative.y * mouse_sensitivity)

		# 3. Clamp vertical rotation so you don't flip upside down
		rotation.x = clamp(rotation.x, deg_to_rad(-89.9), deg_to_rad(89.9))
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
	# --- CONTROLLER LOOK ---
	var input_dir = Input.get_vector("look_left", "look_right", "look_up", "look_down")
	if input_dir.length() > 0:
		player_body.rotate_y(deg_to_rad(-input_dir.x * controller_sensitivity))
		rotation.x -= deg_to_rad(input_dir.y * controller_sensitivity)
		rotation.x = clamp(rotation.x, deg_to_rad(-89.9), deg_to_rad(89.9))
	# 3. SMOOTH THE ZOOM
	# lerp ensures the camera doesn't "snap" instantly when scrolling
	spring_length = lerp(spring_length, target_zoom, delta * zoom_smoothness)
	
	var min_allowed_distance = min_length_percent * target_zoom
	var current_collision_dist = get_hit_length()
	if current_collision_dist < min_allowed_distance:
		push_dist = lerp(push_dist, min_allowed_distance, delta * zoom_smoothness)
	else:
		# Reset offset when not colliding or when collision is far enough away
		push_dist = lerp(push_dist, 0.0, delta * zoom_smoothness)
	final_dist = lerp(final_dist, current_collision_dist + push_dist, delta * zoom_smoothness)
	cam.global_transform = global_transform
	cam.position += cam.transform.basis.z * final_dist
	if final_dist>first_person_zoom:
		cam.look_at(player_body.global_position, Vector3.UP)
		player_body.softy.visible = true
		is_first_person = false
	else:
		player_body.softy.visible = false
		is_first_person = true

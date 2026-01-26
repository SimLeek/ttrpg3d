extends MeshInstance3D
class_name HandVisualizer

enum HandSide { LEFT, RIGHT }

@export var hand_side: HandSide = HandSide.LEFT
## if neither left nor right is valid, this hand will grab the center.
@export var primary: bool = false
@export var ledge_grabber_path: NodePath
@export var lerp_speed: float = 20.0  # Higher = faster movement

var ledge_grabber: LedgeGrabber
var ledge_grabbed: bool = false
var target_position: Vector3
var is_lerping: bool = false

func _ready() -> void:
	ledge_grabber = get_node(ledge_grabber_path) as LedgeGrabber
	if ledge_grabber:
		ledge_grabber.hand_positions_updated.connect(_on_hand_positions_updated)
		ledge_grabber.ledge_grab_released.connect(_on_ledge_grab_released)
	visible = false

func _on_hand_positions_updated(left_pos: Vector3, right_pos: Vector3, center_pos:Vector3, left_valid: bool, right_valid: bool) -> void:
	var my_valid: bool = primary or (left_valid if hand_side == HandSide.LEFT else right_valid)
	var my_pos: Vector3 = left_pos if hand_side == HandSide.LEFT and left_valid else right_pos if hand_side == HandSide.RIGHT and right_valid else center_pos

	ledge_grabbed = true
	if my_valid:
		target_position = my_pos
		is_lerping = true
		visible = true
	else:
		target_position = ledge_grabber.character.global_position
		is_lerping = true
		visible = true
		#stow_hands(delta)
		#visible = false
		#is_lerping = false

func _process(delta: float) -> void:
	if ledge_grabbed:
		if is_lerping:
			global_position = global_position.lerp(target_position, lerp_speed * delta)
			# Stop lerping when close enough
			if global_position.distance_to(target_position) < 0.01:
				global_position = target_position
				is_lerping = false
	else:
		if Input.is_action_pressed(ledge_grabber.ledge_grab_key):
			var base_pos = ledge_grabber.dir + ledge_grabber.character.global_position
			if hand_side == HandSide.LEFT:
				base_pos += ledge_grabber.left_perp / 2
			else:
				base_pos -= ledge_grabber.left_perp / 2
			
			target_position = base_pos
			global_position = global_position.lerp(target_position, lerp_speed * delta)
			visible = true
		else:
			stow_hands(delta)

func stow_hands(delta):
	target_position = ledge_grabber.character.global_position
	global_position = global_position.lerp(target_position, lerp_speed * delta)
	if global_position.distance_to(target_position) < 0.01:
		global_position = target_position
		is_lerping = false
		visible = false

func _on_ledge_grab_released() -> void:
	ledge_grabbed = false
	#is_lerping = false

extends MeshInstance3D
class_name HandVisualizer

enum HandSide { LEFT, RIGHT }

@export var hand_side: HandSide = HandSide.LEFT
## if neither left nor right is valid, this hand will grab the center.
@export var primary: bool = false
@export var ledge_grabber_path: NodePath

var ledge_grabber: LedgeGrabber

func _ready() -> void:
	ledge_grabber = get_node(ledge_grabber_path) as LedgeGrabber
	if ledge_grabber:
		ledge_grabber.hand_positions_updated.connect(_on_hand_positions_updated)
		ledge_grabber.ledge_grab_released.connect(_on_ledge_grab_released)
	visible = false

func _on_hand_positions_updated(left_pos: Vector3, right_pos: Vector3, center_pos:Vector3, left_valid: bool, right_valid: bool) -> void:
	var my_valid: bool = primary or (left_valid if hand_side == HandSide.LEFT else right_valid)
	var my_pos: Vector3 = left_pos if hand_side == HandSide.LEFT and left_valid else right_pos if hand_side == HandSide.RIGHT and right_valid else center_pos
	print("ledge grabbed. showing mesh.")

	if my_valid:
		global_position = my_pos
		visible = true
	else:
		visible = false

func _on_ledge_grab_released() -> void:
	print("ledge released. Hiding mesh.")
	visible = false

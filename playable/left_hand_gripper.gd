extends MeshInstance3D
class_name HandController

enum HandSide { LEFT, RIGHT }

@export var hand_side: HandSide = HandSide.LEFT
## if neither left nor right is valid, this hand will grab the center.
@export var primary: bool = false
@export var ledge_grabber_path: NodePath
@export var character_path: NodePath
@export var lerp_speed: float = 20.0  # Higher = faster movement
@export var held_item: BaseItem = null

@export_group("Combat")
@export var punch_damage: float = 1.01
@export var punch_duration: float = 0.2
@export var punch_reach: float = 1.0
@export var punch_radius: float = 0.3
@export var hand_side_distance: float = .3

var is_punching: bool = false
var punch_timer: float = 0.0
var punch_collider: Area3D = null

var ledge_grabber: LedgeGrabber
var character: CharacterBody3D
var ledge_grabbed: bool = false
var target_position: Vector3
var is_lerping: bool = false
var first_run_item_fix:bool =false

func _ready() -> void:
	ledge_grabber = get_node(ledge_grabber_path) as LedgeGrabber
	character = get_node(character_path) as CharacterBody3D
	if ledge_grabber:
		ledge_grabber.hand_positions_updated.connect(_on_hand_positions_updated)
		ledge_grabber.ledge_grab_released.connect(_on_ledge_grab_released)
	visible = false
	
	_setup_punch_collider()
	
	if held_item:
		first_run_item_fix = true
	#	_setup_held_item()

func _setup_punch_collider() -> void:
	punch_collider = Area3D.new()
	var collision_shape = CollisionShape3D.new()
	var sphere_shape = SphereShape3D.new()
	sphere_shape.radius = punch_radius
	collision_shape.shape = sphere_shape
	
	punch_collider.add_child(collision_shape)
	add_child(punch_collider)
	punch_collider.monitoring = false  # Off by default
	punch_collider.monitorable = false

func _setup_held_item() -> void:
	if held_item and character:
		held_item.set_character(character)
		held_item.on_equipped()

func equip_item(item: BaseItem) -> void:
	if held_item:
		unequip_item()
	
	held_item = item
	if held_item:
		_setup_held_item()
		add_child(held_item)
		held_item.on_equipped()

func unequip_item() -> void:
	if held_item:
		held_item.on_unequipped()
		remove_child(held_item)
		held_item.queue_free()
		held_item = null

func use_hand(pressure: float) -> void:
	if held_item:
		held_item.use_item(pressure)
	else:
		# No item, so punch
		perform_punch()

func perform_punch() -> void:
	if is_punching or is_lerping:  # wait until travel back
		return
	
	is_punching = true
	punch_timer = punch_duration
	
	# Enable collider
	punch_collider.monitoring = true
	
	# Move hand forward for haymaker swing
	var punch_direction = -get_parent().transform.basis.z if has_node("..") else Vector3.FORWARD
	if hand_side == HandSide.LEFT:
		punch_direction += -get_parent().transform.basis.x*hand_side_distance if has_node("..") else -Vector3.RIGHT*hand_side_distance
	else:
		punch_direction += get_parent().transform.basis.x*hand_side_distance if has_node("..") else Vector3.RIGHT*hand_side_distance
	target_position = global_position + punch_direction * punch_reach
	visible=true
	is_lerping = true

func _check_punch_collision() -> void:
	if not punch_collider or not punch_collider.monitoring:
		return
	
	var overlapping_bodies = punch_collider.get_overlapping_bodies()
	for body in overlapping_bodies:
		if body == get_parent():  # Don't punch yourself
			continue
		
		# Search for Health node in parent first, then children
		var health_node = _find_health_node(body)
		if health_node and health_node.has_method("apply_damage"):
			health_node.apply_damage(punch_damage)
			print("Punched %s for %.2f damage!" % [body.name, punch_damage])

func _find_health_node(node: Node) -> Node:
	# Check parent
	var parent = node.get_parent()
	if parent:
		for child in parent.get_children():
			if child.name == "Health" or child is Node3D and child.has_method("apply_damage"):
				return child
	
	# Check children
	for child in node.get_children():
		if child.name == "Health" or child is Node3D and child.has_method("apply_damage"):
			return child
	
	return null

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
	if first_run_item_fix:
		_setup_held_item()
		first_run_item_fix = false
	
	if is_punching:
		punch_timer -= delta
		_check_punch_collision()
	
	if punch_timer <= 0.0:
		is_punching = false
		punch_collider.monitoring = false
	
	if is_punching:
		global_position = global_position.lerp(target_position, lerp_speed * delta)
		visible = true
	elif ledge_grabbed:
		if is_lerping:
			global_position = global_position.lerp(target_position, lerp_speed * delta)
			# Stop lerping when close enough
			if global_position.distance_to(target_position) < 0.01:
				global_position = target_position
				is_lerping = false
	else:
		if ledge_grabber and Input.is_action_pressed(ledge_grabber.ledge_grab_key):
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
	target_position = character.global_position
	global_position = global_position.lerp(target_position, lerp_speed * delta)
	if global_position.distance_to(target_position) < 0.01:
		global_position = target_position
		is_lerping = false
		visible = false

func _on_ledge_grab_released() -> void:
	ledge_grabbed = false
	#is_lerping = false

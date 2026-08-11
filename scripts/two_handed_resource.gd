extends Resource
class_name TwoHandedResource

## Gravity and falling - stats and control logic together

var left_hand: HandController
var right_hand: HandController

func handle_immediate_input(event):
	if not left_hand or not right_hand:
		push_error("Assign the hands in the _ready function of the script that uses this.")

	# InputController.is_captured(): true while a menu has released the
	# mouse for its own UI, or the dev console is focused (which doesn't
	# release the mouse at all, hence not just checking mouse mode) --
	# either way, clicks are for that UI, not for using the held item.
	if InputController.is_captured():
		return

	# In battle mode, the same clicks mark/undo movement waypoints instead
	# of using the held item -- you're flying as a ghost to plan a move,
	# not placing/breaking blocks.
	if BattleModeManager.active:
		if event.is_action_pressed("primary_item_click"):
			BattleModeManager.mark_current_position()
		elif event.is_action_pressed("secondary_item_click"):
			BattleModeManager.undo_last_waypoint()
		return

	if event.is_action_pressed("primary_item_click"):
		print("prim")
		handle_primary_hand_input(1.0)
	elif event.is_action_pressed("secondary_item_click"):
		print("sec")
		handle_non_primary_hand_input(1.0)

func handle_physics_process_input():
	if not left_hand or not right_hand:
		push_error("Assign the hands in the _ready function of the script that uses this.")
	if InputController.is_captured():
		return
	var right_trigger = InputController.get_action_strength("primary_item_trigger")  # Primary hand
	var left_trigger = InputController.get_action_strength("secondary_item_trigger")    # Non-primary hand
	
	if right_trigger > 0.0:
		handle_primary_hand_input(right_trigger)
	
	if left_trigger > 0.0:
		handle_non_primary_hand_input(left_trigger)

func handle_primary_hand_input(pressure: float) -> void:
	# Use whichever hand is marked as primary
	if right_hand.primary:
		right_hand.use_hand(pressure)
	elif left_hand.primary:
		left_hand.use_hand(pressure)
	else:
		push_warning("character should have a primary hand")
		right_hand.use_hand(pressure)

func handle_non_primary_hand_input(pressure: float) -> void:
	# Use whichever hand is NOT primary
	if right_hand.primary:
		left_hand.use_hand(pressure)
	elif left_hand.primary:
		right_hand.use_hand(pressure)
	else:
		push_warning("character should have at least one non-primary hand")
		left_hand.use_hand(pressure)

func reset() -> void:
	pass

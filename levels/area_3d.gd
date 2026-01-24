extends Area3D


func _on_body_entered(body: Node3D) -> void:
	print("entered")
	if body.is_in_group("player"):
		# Use call_deferred to safely reload during physics processing
		get_tree().call_deferred("reload_current_scene")
		#Input.start_joy_vibration(0, 0.5, 0.5, 0.5)
		#get_tree().reload_current_scene()

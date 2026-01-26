# CameraCutout.gd - attach to Camera3D or SpringArm3D
extends Camera3D  # or Node3D if on SpringArm

@export var player_node: Node3D
@export var update_interval: float = 0.05  # optional throttle

var time_accum: float = 0.0

func _process(delta: float) -> void:
	#time_accum += delta
	#if time_accum < update_interval:
	#	return
	#time_accum = 0.0
	
	if not player_node:
		push_error("player node must be assigned for cutout")
	
	RenderingServer.global_shader_parameter_set("player_position", player_node.global_position)
	RenderingServer.global_shader_parameter_set("camera_position", global_position)
	RenderingServer.global_shader_parameter_set("camera_far", self.far)

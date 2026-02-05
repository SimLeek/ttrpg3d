extends Node3D

@export var threshold: float = 30  # soft bodies tend to die beyond this distance for some reason
@export var soft_bodies: Array[SoftBody3D] = []

var _soft_body_templates: Array[SoftBody3D] = []
var _soft_body_parents: Dictionary = {}
var _soft_body_local_transforms: Dictionary = {} # idk if this even helps. the transforms are all zero.
var camera: Camera3D

func _ready() -> void:
	for body in soft_bodies:
		if body:
			_soft_body_parents[body] = body.get_parent()
			# Store the EXACT local transform from the editor
			_soft_body_local_transforms[body] = body.transform
			
			# Create the clean template
			var template = body.duplicate()
			_soft_body_templates.append(template)

func shift_origin() -> void:
	var shift_vector = $CharacterBody3D.global_position
	$World.global_position -= shift_vector
	$CharacterBody3D.global_position = Vector3.ZERO

	# 4. Replace Soft Bodies
	for i in range(soft_bodies.size()):
		var old_body = soft_bodies[i]
		var template = _soft_body_templates[i]
		var parent = _soft_body_parents[old_body]
		var original_local_trans = _soft_body_local_transforms[old_body]
		
		# Remove old body references
		_soft_body_parents.erase(old_body)
		_soft_body_local_transforms.erase(old_body)
		old_body.queue_free()
		
		# Spawn fresh from template
		var new_instance = template.duplicate()
		parent.add_child(new_instance)
		
		# Snap to the exact local position it had in the editor
		#new_instance.transform = original_local_trans
		
		
		# Update tracking for the NEXT shift
		soft_bodies[i] = new_instance
		_soft_body_parents[new_instance] = parent
		_soft_body_local_transforms[new_instance] = original_local_trans

	print("Origin shifted to Player. SoftBodies reset to editor local positions.")

func _physics_process(_delta: float) -> void:
	camera = get_viewport().get_camera_3d() 
	
	# Use the CharacterBody's distance for the threshold check for better stability
	if camera and $CharacterBody3D.global_position.length() > threshold: 
		print($CharacterBody3D.global_position)
		shift_origin()

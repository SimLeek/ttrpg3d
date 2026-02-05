# attribution.gd
@tool
extends Node
class_name Attribution

@export var asset_name: String = ""
@export var creator_name: String = ""
@export_enum("CC0", "CC BY 4.0", "CC BY-SA 4.0", "CC BY-NC 4.0", "All Rights Reserved") var license: String = "CC BY 4.0"
@export var source_url: String = ""
@export_enum("model", "music", "sfx", "ambiance", "texture") var asset_type: String = "model"
@export_multiline var additional_info: String = ""

var mesh_instance: MeshInstance3D = null

func _ready():
	# Auto-register this attribution
	if not Engine.is_editor_hint():
		register_self()
		
		# If parent is a MeshInstance3D, store reference
		if get_parent() is MeshInstance3D:
			mesh_instance = get_parent()

func register_self():
	var attr = AttributionData.AssetAttribution.new(
		asset_name,
		creator_name,
		license,
		source_url,
		asset_type,
		additional_info
	)
	attr.mesh_instance = mesh_instance
	
	# Use parent's name as ID
	var id = get_parent().name
	AttributionManager.register_attribution(id, attr)

func get_attribution_text() -> String:
	return "%s by %s (%s)" % [asset_name, creator_name, license]

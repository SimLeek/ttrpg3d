# attribution_data.gd
class_name AttributionData

class AssetAttribution:
	var asset_name: String
	var creator_name: String
	var license: String
	var source_url: String
	var asset_type: String
	var additional_info: String
	var thumbnail_path: String = ""
	var mesh_instance: MeshInstance3D = null
	
	func _init(name: String, creator: String, lic: String, url: String, type: String, info:String):
		asset_name = name
		creator_name = creator
		license = lic
		source_url = url
		asset_type = type
		additional_info = info

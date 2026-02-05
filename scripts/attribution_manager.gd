# attribution_manager.gd (autoload)
extends Node

var attributions: Dictionary = {}

func register_attribution(id: String, attr):
	attributions[id] = attr

func get_attribution(id: String):
	return attributions.get(id, null)

func get_attributions_by_type(type: String) -> Array:
	var result = []
	for attr in attributions.values():
		if attr.asset_type == type:
			result.append(attr)
	return result

func get_all_attributions() -> Array:
	return attributions.values()

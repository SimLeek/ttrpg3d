extends RefCounted
class_name WorldGeneratorCatalog

## Classifies available PCG world generators for the DM world-creation menu.
##
## - "repeatable": same seed/params -> same world regardless of the path
##   taken to generate it (chunk-based, order-independent). The existing
##   hilly-terrain generator already is this.
## - "non_repeatable": order/path-dependent (e.g. wave function collapse --
##   not built yet, category left empty on purpose).
## - "finite": fixed total size, not an endless streaming world. The
##   limestone slab is this (and also repeatable).
##
## Fine for a category to have zero entries -- the classification is the
## point, not filling every bucket immediately.

const HILLY_SCRIPT := preload("res://scripts/pcg/generator_main.gd")
const LIMESTONE_SLAB_SCRIPT := preload("res://scripts/pcg/limestone_slab_generator.gd")

static func get_generators() -> Array[Dictionary]:
	return [
		{
			"id": "hilly",
			"name": "Hilly Terrain",
			"classifications": ["repeatable"],
			"script": HILLY_SCRIPT,
			"params": [],
		},
		{
			"id": "limestone_slab",
			"name": "Limestone Slab",
			"classifications": ["repeatable", "finite"],
			"script": LIMESTONE_SLAB_SCRIPT,
			"params": [
				{"key": "width", "label": "Width", "default": 32, "min": 1, "max": 256},
				{"key": "height", "label": "Height", "default": 8, "min": 1, "max": 64},
				{"key": "depth", "label": "Depth", "default": 32, "min": 1, "max": 256},
			],
		},
	]

static func get_generator(id: String) -> Dictionary:
	for g in get_generators():
		if g.id == id:
			return g
	return {}

## Instantiates the generator script and applies params to matching
## @export vars (e.g. limestone_slab's width/height/depth). Generators
## with no configurable params (params == []) just ignore an empty dict.
static func instantiate_generator(gen_def: Dictionary, params: Dictionary) -> Object:
	var instance = gen_def.script.new()
	for key in params:
		if key in instance:
			instance.set(key, params[key])
	return instance

## Where the player should spawn for this generator+params, or null to
## leave whatever spawn position the scene already has (used by the
## infinite/repeatable generators, which don't have fixed bounds to spawn
## relative to).
static func get_spawn_position(gen_def: Dictionary, params: Dictionary):
	if gen_def.get("id", "") == "limestone_slab":
		return LimestoneSlabGenerator.spawn_position(
			params.get("width", 32), params.get("height", 8), params.get("depth", 32))
	return null

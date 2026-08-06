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
	var generators: Array[Dictionary] = [
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
				# No real reason to cap these tightly -- the generator itself
				# has no size limit, it's just bounds-checked per voxel.
				# (What actually limits how much of a large slab you can see
				# at once is VoxelTerrain.max_view_distance on the terrain
				# node -- a streaming/performance setting, not a world-size
				# one; a huge slab still generates fully, chunks just stream
				# in as you approach like any open world.) SpinBox needs
				# *some* numeric max, so these are generous rather than
				# unbounded.
				{"key": "width", "label": "Width", "type": "number", "default": 32, "min": 1, "max": 100000},
				{"key": "height", "label": "Height", "type": "number", "default": 8, "min": 1, "max": 100000},
				{"key": "depth", "label": "Depth", "type": "number", "default": 32, "min": 1, "max": 100000},
				{"key": "voxel_id", "label": "Block Type", "type": "voxel_picker", "default": VoxelTypes.LIMESTONE},
			],
		},
	]
	generators.append_array(ModManager.registered_generators)
	return generators

static func get_generator(id: String) -> Dictionary:
	for g in get_generators():
		if g.id == id:
			return g
	return {}

## Instantiates the generator script and applies params to matching
## @export vars (e.g. limestone_slab's width/height/depth). Generators
## with no configurable params (params == []) just ignore an empty dict.
## fixed_params (if the def has any) apply first and unconditionally --
## for generator variants that reuse an existing script with a baked-in
## override that isn't a user-facing DM-menu field (e.g. plains_biome
## setting trees_enabled = false on the core hilly generator).
static func instantiate_generator(gen_def: Dictionary, params: Dictionary) -> Object:
	var instance = gen_def.script.new()
	for key in gen_def.get("fixed_params", {}):
		if key in instance:
			instance.set(key, gen_def.fixed_params[key])
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
	if gen_def.get("id", "") == "plains":
		# Scene's default spawn assumes the full hilly height range; plains'
		# height_scale flattens that range toward its ~32 midpoint (heightmap
		# range is -32..96, see heightmap_curve.tres), so the default spawn
		# point can end up underground. 48 clears the flattened range (up to
		# ~40 at the extremes) with room to spare.
		return Vector3(0, 48, 0)
	return null

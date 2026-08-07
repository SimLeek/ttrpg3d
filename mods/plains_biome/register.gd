extends RefCounted

## Plains Biome mod -- registers a second world generator for the DM menu:
## the same core hilly-terrain generator (scripts/pcg/generator_main.gd),
## just with trees, windmills, and most of the height variation turned off
## via its exports, rather than duplicating any generation logic. A direct
## game -> mod dependency (this mod depends on the core generator script;
## nothing depends back on this mod), matching the "nearly direct"
## dependency shape mods should have -- if a mod ever needs another mod's
## internals, that's a sign to stop and ask rather than build a deeper
## chain.

const HILLY_SCRIPT := preload("res://scripts/pcg/generator_main.gd")

static func register() -> void:
	ModManager.register_generator({
		"id": "plains",
		"name": "Plains",
		"classifications": ["repeatable"],
		"script": HILLY_SCRIPT,
		"params": [],
		"fixed_params": {
			"trees_enabled": false,
			"windmills_enabled": false,
			"height_scale": 0.12,
		},
	})

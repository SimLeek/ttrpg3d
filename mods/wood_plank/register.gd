extends RefCounted

## Wood Plank mod -- registers a new placeable voxel with a code-generated
## (not hand-drawn) texture resembling the inner-ring pattern of the
## existing log voxel. Doubles as the mod system's proof of concept
## (TODO_modding_and_worlds.md Phase 0): this is the only place this voxel
## is defined anywhere -- nothing in scripts/ knows about "wood plank"
## specifically, it only exists if this mod folder is present and enabled
## in user://mods_enabled.json.

const CUBE_MESH := preload("res://3dAssets/blocks/dirt.obj")
const XRAY_SHADER := preload("res://3dAssets/shaders/xray_if_behind_cutout.gdshader")

static func register() -> void:
	var material := ShaderMaterial.new()
	material.shader = XRAY_SHADER
	material.set_shader_parameter("albedo_texture", _generate_ring_texture())

	var model := VoxelBlockyModelMesh.new()
	model.mesh = CUBE_MESH
	model.collision_aabbs = [AABB(Vector3.ZERO, Vector3.ONE)]
	# material_override_N/collision_enabled_N aren't static members on this
	# class (dynamic per-surface properties) -- set() them like
	# VoxelCatalog's icon-extraction code already reads them, rather than
	# direct attribute assignment which the compiler can't verify exists.
	model.set("material_override_0", material)
	model.set("collision_enabled_0", true)

	ModManager.register_voxel({"name": "Wood Plank", "model": model})


## 16x16, concentric rings around an off-center point (so it doesn't read
## as a perfect target) with a little angular wobble, alternating between
## two brown shades -- same idea as the log voxel's rings, generated
## instead of hand-drawn.
static func _generate_ring_texture() -> ImageTexture:
	const SIZE := 16
	var img := Image.create(SIZE, SIZE, false, Image.FORMAT_RGBA8)
	var center := Vector2(SIZE * 0.5 - 1.0, SIZE * 0.5 + 1.5)
	var dark := Color(0.36, 0.24, 0.14)
	var light := Color(0.55, 0.38, 0.22)
	for y in range(SIZE):
		for x in range(SIZE):
			var d := Vector2(x, y).distance_to(center)
			var wobble := sin(atan2(y - center.y, x - center.x) * 5.0) * 0.6
			var band := fmod(d + wobble, 3.0)
			img.set_pixel(x, y, dark if band < 1.4 else light)
	return ImageTexture.create_from_image(img)

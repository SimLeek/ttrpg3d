extends Resource
class_name TerrainGenerator

const VoxelTypesPre = preload("./voxel_types.gd")
const Structure = preload("./structure.gd")
const TreeGenerator = preload("./tree_generator.gd")
const HeightmapCurve = preload("./heightmap_curve.tres")
const WindmillGenerator = preload("./windmill_generator.gd")

const CHANNEL: int = VoxelBuffer.CHANNEL_TYPE
const CHUNK_SIZE: int = 16
const TREE_INSTANCES_PER_CHUNK: int = 1
const DIRT_LAYER_THICKNESS: int = 5
const FOLIAGE_CHANCE: float = 0.2
const DEAD_SHRUB_CHANCE: float = 0.1
const SEA_LEVEL: int = 0
const CAVE_THRESHOLD: float = 0.01
const CAVE_FREQUENCY: float = 1.0 / 128.0
const CAVE_NOISE_FREQUENCY: float = 1.0 / 64.0

const CAVE_OCTAVES: int = 3

# Generation thresholds and parameters
const PLASTIGLOMERATE_MIN_Y: int = 40
const PLASTIGLOMERATE_MAX_Y: int = 70
const PLASTIGLOMERATE_THRESH: float = 0.3
const GYPSUM_THRESH: float = 0.7
const HALITE_THRESH: float = 0.7
const COAL_THRESH: float = 0.85
const COPPER_THRESH: float = 0.85
const QUARTZ_THRESH: float = 0.9
const MAGNETITE_THRESH: float = 0.9
const WINDMILL_CHANCE := 1.0 # Currently, setting this below 100% results in partial windmills

var tree_structures: Array[Structure] = []
var windmill_structure: Structure # The fix for your identifier error

var heightmap_min_y: int
var heightmap_max_y: int
var heightmap_range: int
var heightmap_noise: FastNoiseLite
var cave_noise: FastNoiseLite
var detail_cave_noise: FastNoiseLite
var plast_noise: FastNoiseLite
var gypsum_noise: FastNoiseLite
var halite_noise: FastNoiseLite
var coal_noise: FastNoiseLite
var copper_noise: FastNoiseLite
var quartz_noise: FastNoiseLite
var magnetite_noise: FastNoiseLite
var trees_min_y: int
var trees_max_y: int

class DetailCaveCarver:
	var cave_noise: FastNoiseLite
	var detail_noise: FastNoiseLite
	var threshold: float
	var spawn_threshold: float = 0.45 # High fixed value for the "core" of the cave
	var water_table:float

	func _init(c: FastNoiseLite, d: FastNoiseLite, t: float, st:float, wt:float=0):
		cave_noise = c
		detail_noise = d
		threshold = t
		spawn_threshold = st
		water_table = wt

	func process_voxel(_buffer: VoxelBuffer, voxel: int, pos: Vector3i, _local_pos: Vector3i, is_stone: bool) -> int:
		if not is_stone:
			return voxel

		var n_big := cave_noise.get_noise_3d(pos.x, pos.y, pos.z)
		var n_small := detail_noise.get_noise_3d(pos.x * 1.8, pos.y * 1.8, pos.z * 1.8)
		var combined := n_big + (n_small * 0.5)

		if combined > threshold:
			if combined > spawn_threshold:
				# Use set_voxel_v because we are already passing the local_pos
				#buffer.set_voxel_metadata(local_pos.x, local_pos.y, local_pos.z, {"spawn_number": 32})
				#return VoxelTypes.WATER_FULL # VoxelTypes.WATER_SPAWN
				
				# caves below the water table are usually filled with water, so, get good
				# Actually, get good scuba gear
				return VoxelTypes.AIR if pos.y< water_table else VoxelTypes.WATER_FULL
			return VoxelTypes.WATER_FULL if pos.y< water_table else VoxelTypes.AIR
		
		return voxel

var carver :DetailCaveCarver
## Initializes the terrain generator, precomputing tree structures and noise settings.
func _init() -> void:
	var tree_generator: TreeGenerator = TreeGenerator.new()
	tree_generator.log_type = VoxelTypes.LOG
	tree_generator.leaves_type = VoxelTypes.LEAVES
	for i: int in TREE_INSTANCES_PER_CHUNK * 4:  # Generate more for variety
		var structure: Structure = tree_generator.generate()
		tree_structures.append(structure)

	var tallest_tree_height: int = 0
	for structure: Structure in tree_structures:
		var height: int = int(structure.voxels.get_size().y)
		tallest_tree_height = max(tallest_tree_height, height)
		
	var windmill_gen := WindmillGenerator.new()
	# Map the generator's internal types to your VoxelTypes constants
	#windmill_gen.aluminum_type = VoxelTypes.ALUMINUM
	#windmill_gen.wire_type     = VoxelTypes.ALUMINUM_WIRE
	#windmill_gen.conv_type     = VoxelTypes.FREQUENCY_CONVERTER
	#windmill_gen.phase_type    = VoxelTypes.PHASE_MATCHER
	#windmill_gen.boost_type    = VoxelTypes.BOOST_BUCK
	#windmill_gen.motor_type    = VoxelTypes.AC_MOTOR
	windmill_gen.aluminum_type = VoxelTypes.MAGNETITE
	windmill_gen.wire_type     = VoxelTypes.MAGNETITE
	windmill_gen.conv_type     = VoxelTypes.MAGNETITE
	windmill_gen.phase_type    = VoxelTypes.MAGNETITE
	windmill_gen.boost_type    = VoxelTypes.MAGNETITE
	windmill_gen.motor_type    = VoxelTypes.MAGNETITE
	
	windmill_structure = windmill_gen.generate()

	heightmap_min_y = int(HeightmapCurve.min_value)
	heightmap_max_y = int(HeightmapCurve.max_value)
	trees_min_y = heightmap_min_y
	trees_max_y = heightmap_max_y + tallest_tree_height

	heightmap_noise = FastNoiseLite.new()
	heightmap_noise.seed = 1
	heightmap_noise.frequency = 1.0 / 128.0
	heightmap_noise.fractal_octaves = 4

	cave_noise = FastNoiseLite.new()
	cave_noise.seed = 2
	cave_noise.noise_type = FastNoiseLite.TYPE_CELLULAR
	cave_noise.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	cave_noise.fractal_octaves = CAVE_OCTAVES
	cave_noise.fractal_gain = 0.4
	cave_noise.fractal_lacunarity = 2.0
	cave_noise.frequency = CAVE_FREQUENCY
	
	detail_cave_noise = FastNoiseLite.new()
	detail_cave_noise.seed = 3
	detail_cave_noise.noise_type = FastNoiseLite.TYPE_CELLULAR
	detail_cave_noise.frequency = CAVE_NOISE_FREQUENCY
	detail_cave_noise.fractal_octaves = 2
	detail_cave_noise.fractal_gain = 0.45
	
	carver = DetailCaveCarver.new(cave_noise, detail_cave_noise, CAVE_THRESHOLD, 0.3)

	plast_noise = FastNoiseLite.new()
	plast_noise.seed = 3
	plast_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	plast_noise.frequency = 1.0 / 20.0
	plast_noise.fractal_octaves = 2

	gypsum_noise = FastNoiseLite.new()
	gypsum_noise.seed = 4
	gypsum_noise.seed = 1
	gypsum_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	gypsum_noise.frequency = 1.0 / 25.0
	gypsum_noise.fractal_octaves = 3

	halite_noise = FastNoiseLite.new()
	halite_noise.seed = 5
	halite_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	halite_noise.frequency = 1.0 / 25.0
	halite_noise.fractal_octaves = 3

	coal_noise = FastNoiseLite.new()
	coal_noise.seed = 6
	coal_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	coal_noise.frequency = 1.0 / 30.0
	coal_noise.fractal_octaves = 2

	copper_noise = FastNoiseLite.new()
	copper_noise.seed = 7
	copper_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	copper_noise.frequency = 1.0 / 15.0
	copper_noise.fractal_octaves = 2

	quartz_noise = FastNoiseLite.new()
	quartz_noise.seed = 8
	quartz_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	quartz_noise.frequency = 1.0 / 15.0
	quartz_noise.fractal_octaves = 2

	magnetite_noise = FastNoiseLite.new()
	magnetite_noise.seed = 9
	magnetite_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	magnetite_noise.frequency = 1.0 / 15.0
	magnetite_noise.fractal_octaves = 2

	# Pre-bake the curve to avoid threading issues
	HeightmapCurve.bake()

## Returns the bitmask of channels used by this generator.
func get_used_channels_mask() -> int:
	return 1 << CHANNEL

## Generates voxel data for a block at the given origin.
func generate_block(buffer: VoxelBuffer, origin: Vector3i) -> void:
	var block_size: int = buffer.get_size().x
	var chunk_pos: Vector3i = origin / CHUNK_SIZE
	var rng := create_rng_for_chunk(chunk_pos)
	
	# Pre-calculate chunk-wide vertical flags to skip logic entirely if out of range
	var chunk_flags = {
		"evaporites": origin.y <= SEA_LEVEL + 1 and (origin.y + block_size) >= SEA_LEVEL - 1,
		"plast": origin.y <= PLASTIGLOMERATE_MAX_Y and (origin.y + block_size) >= PLASTIGLOMERATE_MIN_Y,
		"coal": origin.y <= 100
	}

	for local_z in block_size:
		for local_x in block_size:
			var global_x := origin.x + local_x
			var global_z := origin.z + local_z
			var surface_height := get_height_at(global_x, global_z)
			
			# top down processing is required to create water in caves
			for local_y in range(block_size):
				var global_y := origin.y + local_y
				var pos := Vector3i(global_x, global_y, global_z)
				
				# 1. Base Terrain
				var voxel := _get_base_voxel(global_y, surface_height)
				
				# 2. Ore Replacement (Only if current voxel is Mudstone)
				if voxel == VoxelTypes.MUDSTONE:
					voxel = _apply_ores(voxel, pos, chunk_flags)
					
				voxel = carver.process_voxel(buffer, voxel, pos, pos, is_stone_voxel(voxel))
				
				# 3. Cave Carving (Only if current voxel is stone/ore)
				#if is_stone_voxel(voxel):
				#	voxel = _apply_caves(voxel, pos)

				buffer.set_voxel(voxel, local_x, local_y, local_z, CHANNEL)

			# 4. Surface Decoration (Run once per column after the Y loop)
			_decorate_surface(buffer, local_x, local_z, surface_height, origin.y, block_size, rng)

	generate_trees(buffer, origin, block_size, chunk_pos)
	#if (origin.y + block_size) > PLASTIGLOMERATE_MIN_Y:
	generate_windmills(buffer, origin, block_size, chunk_pos)
	buffer.compress_uniform_channels()

# --- MODULAR PROCESSORS ---

func generate_windmills(buffer: VoxelBuffer, origin: Vector3i, block_size: int, chunk_pos: Vector3i) -> void:
	# Windmills are tall and wide; if the chunk is way below or way above the peak zones, skip.
	if origin.y > PLASTIGLOMERATE_MAX_Y + 50 or origin.y + block_size < PLASTIGLOMERATE_MIN_Y - 10:
		return

	var voxel_tool: VoxelTool = buffer.get_voxel_tool()
	var windmill_positions: Array[Vector3i] = []

	# Check the current chunk column and all 8 surrounding columns (Moore neighborhood on XZ)
	# We only need to check neighbors in X and Z because windmills are anchored to the ground.
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var neighbor_chunk_xz := Vector3i(chunk_pos.x + dx, 0, chunk_pos.z + dz)
			_collect_windmill_instances(neighbor_chunk_xz, windmill_positions)

	var block_aabb := AABB(Vector3(origin), Vector3(buffer.get_size()))
	
	for global_peak_pos in windmill_positions:
		# Calculate the AABB of where the windmill WOULD be
		var structure_origin := global_peak_pos - windmill_structure.offset
		var structure_size := Vector3(windmill_structure.voxels.get_size())
		var structure_aabb := AABB(Vector3(structure_origin), structure_size)

		# Only paste if the windmill actually overlaps this specific chunk buffer
		if block_aabb.intersects(structure_aabb):
			var local_pos := structure_origin - origin
			# Paste using AIR as the mask so we don't overwrite ground with the windmill's empty internal air
			voxel_tool.paste_masked(local_pos, windmill_structure.voxels, 1 << CHANNEL, CHANNEL, VoxelTypes.AIR)

## Deterministically finds the peak of a chunk column to see if a windmill should exist there.
func _collect_windmill_instances(chunk_pos_xz: Vector3i, instances: Array[Vector3i]) -> void:
	# We use a specific seed offset so it doesn't spawn exactly where trees do
	var rng := create_rng_for_chunk(chunk_pos_xz + Vector3i(500, 0, 500))
	
	# Only 5% of valid peaks get a windmill
	if rng.randf() > WINDMILL_CHANCE: 
		return

	var chunk_origin_x := chunk_pos_xz.x * CHUNK_SIZE
	var chunk_origin_z := chunk_pos_xz.z * CHUNK_SIZE
	
	var max_y := -9999
	#var peak_coords := Vector2i(0, 0)
	
	# Find the highest point in this neighbor's 16x16 area
	# This must be deterministic so every neighboring chunk "agrees" on where the peak is
	for x in range(CHUNK_SIZE):
		for z in range(CHUNK_SIZE):
			var h := get_height_at(chunk_origin_x + x, chunk_origin_z + z)
			if h > max_y:
				max_y = h

	if max_y <= PLASTIGLOMERATE_MIN_Y:
		return
	
	var min_x := 16; var max_x := -1
	var min_z := 16; var max_z := -1
	var touches_border := false

	for x in range(CHUNK_SIZE):
		for z in range(CHUNK_SIZE):
			if get_height_at(chunk_origin_x + x, chunk_origin_z + z) == max_y:
				# If the peak touches the chunk edge, it's not a "local" peak
				if x == 0 or x == CHUNK_SIZE - 1 or z == 0 or z == CHUNK_SIZE - 1:
					touches_border = true
					break
				
				# Update bounding box of the peak area
				if x < min_x: min_x = x
				if x > max_x: max_x = x
				if z < min_z: min_z = z
				if z > max_z: max_z = z
		if touches_border: break

	# 3. CALCULATE CENTER AND SPAWN
	# We only spawn if the peak is fully contained (didn't touch borders)
	if not touches_border and max_x != -1:
		var width := (max_x - min_x) + 1
		var depth := (max_z - min_z) + 1
		
		# Find the center of the peak plateau
		var center_x := chunk_origin_x + min_x + (width / 2)
		var center_z := chunk_origin_z + min_z + (depth / 2)
		
		instances.append(Vector3i(center_x, max_y, center_z))
		
	
func _get_base_voxel(gy: int, surface_h: int) -> int:
	if gy < surface_h:
		return VoxelTypes.DIRT if (surface_h - gy) < DIRT_LAYER_THICKNESS else VoxelTypes.MUDSTONE
	elif gy < SEA_LEVEL:
		return VoxelTypes.WATER_FULL if gy < SEA_LEVEL - 1 else VoxelTypes.WATER_TOP
	return VoxelTypes.AIR

func _apply_ores(current_voxel: int, pos: Vector3i, flags: Dictionary) -> int:
	# Evaporites
	if flags.evaporites and pos.y > SEA_LEVEL - 1 and pos.y < SEA_LEVEL + 1:
		if gypsum_noise.get_noise_3d(pos.x, pos.y, pos.z) > GYPSUM_THRESH: return VoxelTypes.GYPSUM_ORE
		if halite_noise.get_noise_3d(pos.x, pos.y, pos.z) > HALITE_THRESH: return VoxelTypes.HALITE_ORE
	
	# Plastiglomerate
	if flags.plast and pos.y >= PLASTIGLOMERATE_MIN_Y and pos.y <= PLASTIGLOMERATE_MAX_Y:
		var mid_y := (PLASTIGLOMERATE_MIN_Y + PLASTIGLOMERATE_MAX_Y) / 2.0
		var height_factor :float = 1.0 - (abs(pos.y - mid_y) / ((PLASTIGLOMERATE_MAX_Y - PLASTIGLOMERATE_MIN_Y) / 2.0))
		if ((plast_noise.get_noise_3d(pos.x, pos.y, pos.z) + 1.0) / 2.0) * height_factor > PLASTIGLOMERATE_THRESH:
			return VoxelTypes.PLASTIGLOMERATE

	# Standard Ores & Coal
	if flags.coal and (coal_noise.get_noise_3d(pos.x, pos.y, pos.z) + 1.0) / 2.0 > COAL_THRESH:
		return VoxelTypes.COAL_ORE
		
	if (copper_noise.get_noise_3d(pos.x, pos.y, pos.z) + 1.0) / 2.0 > COPPER_THRESH: return VoxelTypes.COPPER_ORE
	if (quartz_noise.get_noise_3d(pos.x, pos.y, pos.z) + 1.0) / 2.0 > QUARTZ_THRESH: return VoxelTypes.QUARTZ
	if (magnetite_noise.get_noise_3d(pos.x, pos.y, pos.z) + 1.0) / 2.0 > MAGNETITE_THRESH: return VoxelTypes.MAGNETITE
	
	return current_voxel

func _apply_caves(current_voxel: int, pos: Vector3i) -> int:
	var n_big := cave_noise.get_noise_3d(pos.x, pos.y, pos.z)
	var n_small := detail_cave_noise.get_noise_3d(pos.x * 1.8, pos.y * 1.8, pos.z * 1.8)
	if (n_big + n_small * 0.5) > CAVE_THRESHOLD:
		return VoxelTypes.AIR
	return current_voxel

func _decorate_surface(buffer: VoxelBuffer, lx: int, lz: int, surface_h: int, origin_y: int, size: int, rng: RandomNumberGenerator) -> void:
	var rel_h := surface_h - origin_y
	if surface_h >= SEA_LEVEL and rel_h >= 0 and rel_h < size:
		buffer.set_voxel(VoxelTypes.GRASS, lx, rel_h, lz, CHANNEL)
		if rel_h + 1 < size and rng.randf() < FOLIAGE_CHANCE:
			var foliage := VoxelTypes.TALL_GRASS if rng.randf() >= DEAD_SHRUB_CHANCE else VoxelTypes.DEAD_SHRUB
			buffer.set_voxel(foliage, lx, rel_h + 1, lz, CHANNEL)


## Determines if a voxel is solid (can be carved by caves).
func is_solid_voxel(voxel: int) -> bool:
	return voxel != VoxelTypes.AIR && voxel != VoxelTypes.WATER_FULL && voxel != VoxelTypes.WATER_TOP
	
func is_stone_voxel(voxel: int) -> bool:
	return is_solid_voxel(voxel) && voxel != VoxelTypes.DIRT && voxel != VoxelTypes.GRASS

## Generates trees within the block's vertical range, including from neighboring chunks.
func generate_trees(buffer: VoxelBuffer, origin: Vector3i, block_size: int, chunk_pos: Vector3i) -> void:
	if origin.y > trees_max_y or origin.y + block_size < trees_min_y:
		return

	var voxel_tool: VoxelTool = buffer.get_voxel_tool()
	var structure_instances: Array = []

	collect_tree_instances(chunk_pos, origin, block_size, structure_instances)

	for direction: Vector3i in VoxelTypes.MOORE_DIRECTIONS:
		var neighbor_chunk_pos: Vector3i = chunk_pos + direction
		collect_tree_instances(neighbor_chunk_pos, origin, block_size, structure_instances)

	var block_aabb: AABB = AABB(Vector3(), buffer.get_size() + Vector3i(1, 1, 1))
	for instance: Array in structure_instances:
		var pos: Vector3i = instance[0]
		var structure: Structure = instance[1]
		var lower_corner_pos: Vector3i = pos - structure.offset
		var structure_aabb: AABB = AABB(lower_corner_pos, structure.voxels.get_size() + Vector3i(1, 1, 1))

		if structure_aabb.intersects(block_aabb):
			voxel_tool.paste_masked(lower_corner_pos, structure.voxels, 1 << CHANNEL, CHANNEL, VoxelTypes.AIR)

## Collects potential tree instances for a given chunk.
func collect_tree_instances(chunk_pos: Vector3i, origin: Vector3i, block_size: int, instances: Array) -> void:
	var rng: RandomNumberGenerator = create_rng_for_chunk(chunk_pos)

	for i: int in TREE_INSTANCES_PER_CHUNK:
		var local_pos: Vector3i = Vector3i(rng.randi() % CHUNK_SIZE, 0, rng.randi() % CHUNK_SIZE)
		var global_pos: Vector3i = local_pos + chunk_pos * CHUNK_SIZE
		global_pos.y = get_height_at(global_pos.x, global_pos.z)

		if global_pos.y > SEA_LEVEL:
			global_pos -= origin
			var structure_index: int = rng.randi() % tree_structures.size()
			var structure: Structure = tree_structures[structure_index]
			instances.append([global_pos, structure])

## Creates a seeded RNG for a chunk to ensure consistent generation.
func create_rng_for_chunk(chunk_pos: Vector3i) -> RandomNumberGenerator:
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = get_chunk_seed_2d(chunk_pos)
	return rng

## Computes a 2D seed for a chunk position.
static func get_chunk_seed_2d(chunk_pos: Vector3i) -> int:
	return int(chunk_pos.x) ^ (31 * int(chunk_pos.z))

## Samples the height at a global (x, z) position using noise and curve.
func get_height_at(x: int, z: int) -> int:
	var normalized_noise: float = 0.5 + 0.5 * heightmap_noise.get_noise_2d(x, z)
	return int(HeightmapCurve.sample_baked(normalized_noise))

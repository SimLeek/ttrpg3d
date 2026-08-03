# why didn't I make this in game or some editor?
# Look... I have a problem, okay? Don't judge me.

const Structure = preload("./structure.gd")

# Voxel Type IDs (Assign these to your VoxelTypes constants)
var aluminum_type := 3
var wire_type := 4
var conv_type := 5
var phase_type := 6
var boost_type := 7
var motor_type := 8

const CHANNEL := VoxelBuffer.CHANNEL_TYPE
const PETAL_COUNT := 4.0 # Rose Curve petals
const BLADE_RADIUS := 12.0
const WINDMILL_HEIGHT := 30.0

func generate() -> Structure:
	var voxels := {} # Dictionary: Vector3i -> int
	
	# 1. TRUNK GENERATION (y from -5 to 30 to handle uneven terrain)
	for y in range(-5, WINDMILL_HEIGHT):
		for z in 5:
			for x in 5:
				# Base Trunk: 5x5 with 3 voxels removed from back center (z=4)
				# Removing (1,4), (2,4), (3,4)
				if z == 4 and (x >= 1 and x <= 3):
					continue
				
				var pos := Vector3i(x, y, z)
				voxels[pos] = aluminum_type
				
		# --- TRUNK LOGIC: BACK RIGHT (Coord 3,3) ---
		# Remove block: starts at 4, then every 2
		if y >= 0:
			var should_remove_right := false
			if y == 4: should_remove_right = true
			elif y > 4 and (y - 4) % 2 == 0: should_remove_right = true
			
			if should_remove_right:
				voxels.erase(Vector3i(3, y, 3))
				
		# --- TRUNK LOGIC: LEFT (Coord 1,4) ---
		# Add block every 4 levels
		if y >= 0 and y % 4 == 0:
			voxels[Vector3i(1, y, 4)] = aluminum_type

	# 2. THE NACELLE (Top Room)
	# Floor at y=30, Walls at 31-33, Ceiling at 34
	var nacelle_start_y := WINDMILL_HEIGHT
	for y in range(nacelle_start_y, nacelle_start_y + 5):
		var is_floor_or_ceiling := (y == nacelle_start_y or y == nacelle_start_y + 4)
		
		# Floor/Ceiling are 5 wide, 6 deep (jutting out back at z=5)
		for z in range(-2,6):
			for x in 5:
				var pos := Vector3i(x, y, z)
				if is_floor_or_ceiling:
					# Floor/Ceiling pattern: xxxxx, xxxxx, xxxxx, x   x, xxxxx, xxxxx
					if (z == 3 or z==4) and (x >= 1 and x <= 3):
						continue # Ladder/Access opening
					voxels[pos] = aluminum_type
				else:
					# Walls
					if x == 0 or x == 4 or z == -2 or z == 5:
						voxels[pos] = aluminum_type

	# 3. SPECIAL BLOCKS (Inside Nacelle on Floor y=31)
	# Internal space is 3x4 (x:1-3, z:1-4)
	voxels[Vector3i(2, 31, 1)] = motor_type # Center front
	voxels[Vector3i(2, 31, 2)] = conv_type  # Connected to motor
	voxels[Vector3i(1, 31, 2)] = boost_type # Next to converter
	voxels[Vector3i(3, 31, 2)] = phase_type # Next to converter

	# 4. BLADES (Rose Curve)
	# Center of curve is 1 in front of nacelle center (x=2, y=32, z=-3)
	var center := Vector2(2.0, 32.0)
	var blade_z := -3
	for lx in range(-12, 17): # Todo: make this modifiable
		for ly in range(18, 46):
			var rel_pos := Vector2(lx, ly) - center
			var r := rel_pos.length()
			if r < BLADE_RADIUS:
				var theta := rel_pos.angle()
				# Rose Curve: r = a * cos(k * theta)
				var rose_r : float= BLADE_RADIUS * abs(cos(PETAL_COUNT * theta))
				if r < rose_r:
					voxels[Vector3i(lx, ly, blade_z)] = aluminum_type

	return _create_structure_from_dict(voxels)

func _create_structure_from_dict(voxels: Dictionary) -> Structure:
	var aabb := AABB()
	for pos in voxels:
		aabb = aabb.expand(pos)

	var structure := Structure.new()
	# Set offset so (0,0,0) is the base of the trunk at ground level
	structure.offset = -Vector3i(aabb.position) + Vector3i(0, 5, 0) 

	var buffer := structure.voxels
	buffer.create(int(aabb.size.x) + 1, int(aabb.size.y) + 1, int(aabb.size.z) + 1)

	for pos in voxels:
		var rpos = pos - Vector3i(aabb.position)
		buffer.set_voxel(voxels[pos], rpos.x, rpos.y, rpos.z, CHANNEL)

	return structure

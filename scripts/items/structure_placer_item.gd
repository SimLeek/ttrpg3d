extends BaseItem
class_name StructurePlacerItem

## Places a previously saved SavedVoxelStructure (see StructureSaverItem)
## into the world, aligned so the structure's pivot lands on the placement
## target -- the same adjacent-empty-voxel spot VoxelPlacerItem uses.
##
## Controls (only active while this tool is equipped):
##   primary click (use_item)  -- paste the current structure
##   structure_cycle (C)       -- cycle to the next saved structure
##   build_mode_t (T)          -- enter translate mode
##   build_mode_r (R)          -- enter rotate mode
##   build_axis_x/y/z_pos/neg
##   (U/I/O, J/K/L)            -- in translate mode: nudge the placement
##                                 offset along that axis.
##                                 in rotate mode: rotate about that axis
##                                 by the current step (default 90 degrees;
##                                 partial rotations are supported and,
##                                 per request, hilarious).
##   build_rot_step_up (M)     -- increase the rotation step
##   build_rot_step_down (N)   -- decrease the rotation step
##
## Placement is a full overwrite, not masked -- every destination voxel in
## the (rotated) structure's bounds gets set, including air, so leftover
## trees/dirt poking into a placed structure get cleared out instead of
## staying. That also makes underground placement work (surrounding stone
## gets cleared to air where the structure says so). For a rotated
## structure, each destination cell samples the *nearest* source voxel
## (inverse-rotate the destination offset, round to nearest index) rather
## than forward-mapping the source grid, which would leave gaps; a
## destination cell outside the structure's rotated bounds is left
## untouched.
##
## Visual feedback: a green wireframe ghost (DebugDraw3D -- inherently
## non-occluding/"transparent") of the rotated structure's bounding box at
## the placement target.

const STRUCTURES_DIR := "user://structures"
const MIN_ROT_STEP_DEG := 1.0
const MAX_ROT_STEP_DEG := 180.0

@export var voxel_interactor: VoxelInteractor

var _structures: Array[SavedVoxelStructure] = []
var _selected_index: int = 0

var _mode: String = "none"  # "none" | "translate" | "rotate"
var _translate_offset: Vector3i = Vector3i.ZERO
var _rotation_deg: Vector3 = Vector3.ZERO
var _rotation_step_deg: float = 90.0

func set_character(chara: CharacterBody3D) -> void:
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)
	_load_structures()


func _load_structures() -> void:
	_structures.clear()
	_selected_index = 0
	if not DirAccess.dir_exists_absolute(STRUCTURES_DIR):
		return
	var dir := DirAccess.open(STRUCTURES_DIR)
	if not dir:
		return
	dir.list_dir_begin()
	var file_name := dir.get_next()
	while file_name != "":
		if file_name.ends_with(".tres"):
			var structure := load("%s/%s" % [STRUCTURES_DIR, file_name]) as SavedVoxelStructure
			if structure:
				_structures.append(structure)
		file_name = dir.get_next()
	dir.list_dir_end()


func _physics_process(_delta: float) -> void:
	if not voxel_interactor or not character:
		return
	voxel_interactor.update_target(character)
	_draw_ghost()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("structure_cycle"):
		if not _structures.is_empty():
			_selected_index = (_selected_index + 1) % _structures.size()
		return
	if event.is_action_pressed("build_mode_t"):
		_mode = "translate"
		_notify("Translate mode\nU/I/O +, J/K/L -  X/Y/Z")
		return
	if event.is_action_pressed("build_mode_r"):
		_mode = "rotate"
		_notify("Rotate mode (step %.0f deg)\nU/I/O +, J/K/L -  X/Y/Z\nM/N: change step" % _rotation_step_deg)
		return
	if event.is_action_pressed("build_rot_step_up"):
		_rotation_step_deg = min(MAX_ROT_STEP_DEG, _rotation_step_deg + 15.0)
		_notify("Rotation step: %.0f deg" % _rotation_step_deg)
		return
	if event.is_action_pressed("build_rot_step_down"):
		_rotation_step_deg = max(MIN_ROT_STEP_DEG, _rotation_step_deg - 15.0)
		_notify("Rotation step: %.0f deg" % _rotation_step_deg)
		return
	_handle_axis_input(event)


func _handle_axis_input(event: InputEvent) -> void:
	if _mode == "translate":
		if event.is_action_pressed("build_axis_x_pos"): _translate_offset.x += 1
		elif event.is_action_pressed("build_axis_x_neg"): _translate_offset.x -= 1
		elif event.is_action_pressed("build_axis_y_pos"): _translate_offset.y += 1
		elif event.is_action_pressed("build_axis_y_neg"): _translate_offset.y -= 1
		elif event.is_action_pressed("build_axis_z_pos"): _translate_offset.z += 1
		elif event.is_action_pressed("build_axis_z_neg"): _translate_offset.z -= 1
	elif _mode == "rotate":
		if event.is_action_pressed("build_axis_x_pos"): _rotation_deg.x += _rotation_step_deg
		elif event.is_action_pressed("build_axis_x_neg"): _rotation_deg.x -= _rotation_step_deg
		elif event.is_action_pressed("build_axis_y_pos"): _rotation_deg.y += _rotation_step_deg
		elif event.is_action_pressed("build_axis_y_neg"): _rotation_deg.y -= _rotation_step_deg
		elif event.is_action_pressed("build_axis_z_pos"): _rotation_deg.z += _rotation_step_deg
		elif event.is_action_pressed("build_axis_z_neg"): _rotation_deg.z -= _rotation_step_deg


func _current_structure() -> SavedVoxelStructure:
	if _selected_index < _structures.size():
		return _structures[_selected_index]
	return null


func _rotation_basis() -> Basis:
	return Basis.from_euler(Vector3(deg_to_rad(_rotation_deg.x), deg_to_rad(_rotation_deg.y), deg_to_rad(_rotation_deg.z)))


func _pivot_world_pos():
	if not voxel_interactor.has_valid_target():
		return null
	var placement_pos = voxel_interactor.get_placement_position()
	if placement_pos == null:
		return null
	return Vector3i(placement_pos) + _translate_offset


## Bounding box (in integer offsets from the pivot, in world/rotated space)
## that fully contains the rotated structure.
func _rotated_bounds(structure: SavedVoxelStructure, basis: Basis) -> Array:
	var pivot_local := Vector3(structure.pivot)
	var size := Vector3(structure.size)
	var corners := [
		Vector3(0, 0, 0), Vector3(size.x, 0, 0), Vector3(0, size.y, 0), Vector3(0, 0, size.z),
		Vector3(size.x, size.y, 0), Vector3(size.x, 0, size.z), Vector3(0, size.y, size.z),
		Vector3(size.x, size.y, size.z),
	]
	var mn := Vector3(INF, INF, INF)
	var mx := Vector3(-INF, -INF, -INF)
	for c in corners:
		var rotated: Vector3 = basis * (c - pivot_local)
		mn = mn.min(rotated)
		mx = mx.max(rotated)
	var start := Vector3i(floori(mn.x), floori(mn.y), floori(mn.z))
	var end := Vector3i(ceili(mx.x), ceili(mx.y), ceili(mx.z))
	return [start, end]


func _draw_ghost() -> void:
	var structure := _current_structure()
	if not structure or not voxel_interactor._terrain:
		return
	var pivot_world = _pivot_world_pos()
	if pivot_world == null:
		return
	var origin: Vector3 = voxel_interactor._terrain.global_position
	var basis := _rotation_basis()
	var pivot_local := Vector3(structure.pivot)
	var size := Vector3(structure.size)
	var local_corners := [
		Vector3(0, 0, 0), Vector3(size.x, 0, 0), Vector3(size.x, size.y, 0), Vector3(0, size.y, 0),
		Vector3(0, 0, size.z), Vector3(size.x, 0, size.z), Vector3(size.x, size.y, size.z), Vector3(0, size.y, size.z),
	]
	var world_corners := []
	for c in local_corners:
		world_corners.append(Vector3(pivot_world) + origin + basis * (c - pivot_local))

	var col := Color(0.2, 1.0, 1.0, 0.9)
	var edges := [
		[0, 1], [1, 2], [2, 3], [3, 0],  # bottom face
		[4, 5], [5, 6], [6, 7], [7, 4],  # top face
		[0, 4], [1, 5], [2, 6], [3, 7],  # verticals
	]
	for e in edges:
		DebugDraw3D.draw_line(world_corners[e[0]], world_corners[e[1]], col)


func use_item(pressure: float) -> void:
	super.use_item(pressure)
	var structure := _current_structure()
	if not structure:
		return
	var pivot_world = _pivot_world_pos()
	if pivot_world == null:
		return
	_place_structure(structure, pivot_world)


func _place_structure(structure: SavedVoxelStructure, pivot_world: Vector3i) -> void:
	var basis := _rotation_basis()
	var inv_basis := basis.inverse()
	var pivot_local := Vector3(structure.pivot)
	var size := structure.size
	var buffer := structure.to_voxel_buffer()

	var bounds := _rotated_bounds(structure, basis)
	var start: Vector3i = bounds[0]
	var end: Vector3i = bounds[1]

	for dx in range(start.x, end.x + 1):
		for dy in range(start.y, end.y + 1):
			for dz in range(start.z, end.z + 1):
				var d := Vector3(dx, dy, dz)
				var local: Vector3 = inv_basis * d + pivot_local
				var src := Vector3i(roundi(local.x), roundi(local.y), roundi(local.z))
				if src.x < 0 or src.x >= size.x or src.y < 0 or src.y >= size.y or src.z < 0 or src.z >= size.z:
					continue
				var voxel_id := buffer.get_voxel(src.x, src.y, src.z, VoxelBuffer.CHANNEL_TYPE)
				voxel_interactor._terrain_tool.set_voxel(pivot_world + Vector3i(dx, dy, dz), voxel_id)


func _notify(text: String) -> void:
	var tooltip = get_tree().get_first_node_in_group("item_tooltip")
	if tooltip:
		tooltip.show_message(text)


func on_unequipped() -> void:
	super.on_unequipped()
	if voxel_interactor:
		voxel_interactor.cleanup()

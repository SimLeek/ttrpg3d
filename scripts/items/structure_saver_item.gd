extends BaseItem
class_name StructureSaverItem

## Selects a box region of voxels and saves it as a SavedVoxelStructure
## resource.
##
## Controls (only active while this tool is equipped):
##   primary click (use_item)  -- (re)place the anchor corner at the aim
##                                 target, or near the player if not aiming
##                                 at anything. Resets size to 1x1x1.
##   build_mode_r (R)          -- enter resize mode
##   build_mode_t (T)          -- enter translate mode
##   build_axis_x/y/z_pos/neg
##   (U/I/O, J/K/L)            -- in resize mode: grow/shrink that axis.
##                                 in translate mode: move the anchor along
##                                 that axis.
##   structure_save (G)        -- save the current box
## The anchor is always the box's min corner (no separate pivot step --
## placement aligns on that corner).
##
## Visual feedback every physics frame via DebugDraw3D (wireframe --
## non-occluding/"transparent" by construction): the anchor voxel in cyan,
## the full box in dim white.

const STRUCTURES_DIR := "user://structures"
const MIN_SIZE := 1

@export var voxel_interactor: VoxelInteractor

var _anchor = null  # Vector3i once set
var _size: Vector3i = Vector3i.ONE
var _mode: String = "none"  # "none" | "resize" | "translate"

func set_character(chara: CharacterBody3D) -> void:
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)


func _physics_process(_delta: float) -> void:
	if not voxel_interactor or not character:
		return
	voxel_interactor.update_target(character)
	_draw_selection()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("build_mode_r"):
		_mode = "resize"
		_notify("Resize mode\nU/I/O grow, J/K/L shrink  X/Y/Z")
	elif event.is_action_pressed("build_mode_t"):
		_mode = "translate"
		_notify("Translate mode\nU/I/O +, J/K/L -  X/Y/Z")
	elif event.is_action_pressed("structure_save"):
		save_structure()
	elif _anchor != null:
		_handle_axis_input(event)


func _handle_axis_input(event: InputEvent) -> void:
	if _mode == "resize":
		if event.is_action_pressed("build_axis_x_pos"): _size.x = max(MIN_SIZE, _size.x + 1)
		elif event.is_action_pressed("build_axis_x_neg"): _size.x = max(MIN_SIZE, _size.x - 1)
		elif event.is_action_pressed("build_axis_y_pos"): _size.y = max(MIN_SIZE, _size.y + 1)
		elif event.is_action_pressed("build_axis_y_neg"): _size.y = max(MIN_SIZE, _size.y - 1)
		elif event.is_action_pressed("build_axis_z_pos"): _size.z = max(MIN_SIZE, _size.z + 1)
		elif event.is_action_pressed("build_axis_z_neg"): _size.z = max(MIN_SIZE, _size.z - 1)
	elif _mode == "translate":
		if event.is_action_pressed("build_axis_x_pos"): _anchor.x += 1
		elif event.is_action_pressed("build_axis_x_neg"): _anchor.x -= 1
		elif event.is_action_pressed("build_axis_y_pos"): _anchor.y += 1
		elif event.is_action_pressed("build_axis_y_neg"): _anchor.y -= 1
		elif event.is_action_pressed("build_axis_z_pos"): _anchor.z += 1
		elif event.is_action_pressed("build_axis_z_neg"): _anchor.z -= 1


func use_item(pressure: float) -> void:
	super.use_item(pressure)
	var pos = _target_point()
	if pos == null:
		return
	_anchor = pos
	_size = Vector3i.ONE
	_mode = "none"
	_notify("Corner set\nR: resize  T: translate  G: save")


func _target_point():
	if voxel_interactor.has_valid_target():
		var hit = voxel_interactor.get_hit_info()
		if hit:
			return Vector3i(hit.position)
	# Tool picks aren't world edits -- don't require a raycast hit.
	if character and character.voxel_terrain:
		return Vector3i((character.global_position - character.voxel_terrain.global_position).floor())
	return null


func _notify(text: String) -> void:
	var tooltip = get_tree().get_first_node_in_group("item_tooltip")
	if tooltip:
		tooltip.show_message(text)


func _draw_selection() -> void:
	if _anchor == null or not voxel_interactor._terrain:
		return
	var origin: Vector3 = voxel_interactor._terrain.global_position
	DebugDraw3D.draw_aabb(AABB(Vector3(_anchor) + origin, Vector3.ONE), Color.CYAN)
	DebugDraw3D.draw_aabb(AABB(Vector3(_anchor) + origin, Vector3(_size)), Color(1, 1, 1, 0.6))


func save_structure() -> void:
	if _anchor == null:
		return

	var buffer := VoxelBuffer.new()
	buffer.create(_size.x, _size.y, _size.z)
	voxel_interactor._terrain_tool.copy(_anchor, buffer, 1 << VoxelBuffer.CHANNEL_TYPE)

	var structure := SavedVoxelStructure.new()
	structure.from_voxel_buffer(buffer)
	structure.pivot = Vector3i.ZERO  # anchor is already the min corner

	DirAccess.make_dir_recursive_absolute(STRUCTURES_DIR)
	var path := "%s/structure_%d.tres" % [STRUCTURES_DIR, _next_index()]
	var err := ResourceSaver.save(structure, path)
	if err == OK:
		_notify("Saved: %s" % path.get_file())
	else:
		push_error("Failed to save structure (%d): %s" % [err, path])

	_anchor = null
	_mode = "none"


func _next_index() -> int:
	var i := 1
	while FileAccess.file_exists("%s/structure_%d.tres" % [STRUCTURES_DIR, i]):
		i += 1
	return i


func on_unequipped() -> void:
	super.on_unequipped()
	_anchor = null
	_mode = "none"
	if voxel_interactor:
		voxel_interactor.cleanup()

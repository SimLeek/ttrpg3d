extends BaseItem
class_name StructureSaverItem

## Selects a box region of voxels and saves it as a SavedVoxelStructure
## resource.
##
## Controls (only active while this tool is equipped):
##   primary click (use_item)  -- (re)place the anchor corner at the aim
##                                 target, or near the player if not aiming
##                                 at anything. Resets size to 1x1x1 and
##                                 clears any explicit pivot.
##   build_mode_r (R)          -- enter resize mode
##   build_mode_t (T)          -- enter translate mode
##   build_axis_x/y/z_pos/neg
##   (U/I/O, J/K/L)            -- in resize mode: grow/shrink that axis.
##                                 Size can go negative -- the box then
##                                 extends the other way from the anchor
##                                 instead of only ever growing positive.
##                                 in translate mode: move the anchor along
##                                 that axis.
##   structure_set_pivot (P)   -- set an explicit pivot at the aim target
##                                 (or near the player as fallback). If
##                                 never pressed, the pivot defaults to the
##                                 anchor -- useful for placing as-is, but
##                                 an explicit pivot elsewhere in the box is
##                                 handy for e.g. placing a structure by one
##                                 of its inner corners.
##   structure_save (G)        -- save the current box
##
## Visual feedback every physics frame via DebugDraw3D (wireframe --
## non-occluding/"transparent" by construction): the anchor voxel in cyan,
## the full box in dim white, and the *effective* pivot (anchor if not
## explicitly set, otherwise wherever it was placed) in red -- a distinct
## color so it reads clearly once it diverges from the anchor.

const STRUCTURES_DIR := "user://structures"

@export var voxel_interactor: VoxelInteractor

var _anchor = null  # Vector3i once set
var _size: Vector3i = Vector3i.ONE  # any component can be negative
var _pivot = null  # Vector3i once explicitly set; null = "use the anchor"
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
		_notify("Resize mode\nU/I/O grow, J/K/L shrink  X/Y/Z\n(can go negative -- box extends the other way)")
	elif event.is_action_pressed("build_mode_t"):
		_mode = "translate"
		_notify("Translate mode\nU/I/O +, J/K/L -  X/Y/Z")
	elif event.is_action_pressed("structure_set_pivot"):
		_set_pivot()
	elif event.is_action_pressed("structure_save"):
		save_structure()
	elif _anchor != null:
		_handle_axis_input(event)


func _handle_axis_input(event: InputEvent) -> void:
	if _mode == "resize":
		if event.is_action_pressed("build_axis_x_pos"): _size.x = _inc(_size.x)
		elif event.is_action_pressed("build_axis_x_neg"): _size.x = _dec(_size.x)
		elif event.is_action_pressed("build_axis_y_pos"): _size.y = _inc(_size.y)
		elif event.is_action_pressed("build_axis_y_neg"): _size.y = _dec(_size.y)
		elif event.is_action_pressed("build_axis_z_pos"): _size.z = _inc(_size.z)
		elif event.is_action_pressed("build_axis_z_neg"): _size.z = _dec(_size.z)
	elif _mode == "translate":
		if event.is_action_pressed("build_axis_x_pos"): _anchor.x += 1
		elif event.is_action_pressed("build_axis_x_neg"): _anchor.x -= 1
		elif event.is_action_pressed("build_axis_y_pos"): _anchor.y += 1
		elif event.is_action_pressed("build_axis_y_neg"): _anchor.y -= 1
		elif event.is_action_pressed("build_axis_z_pos"): _anchor.z += 1
		elif event.is_action_pressed("build_axis_z_neg"): _anchor.z -= 1


## +1/-1 that skips over 0 -- a size of 0 is meaningless, so growing from -1
## goes straight to 1 and shrinking from 1 goes straight to -1.
func _inc(v: int) -> int:
	v += 1
	return 1 if v == 0 else v

func _dec(v: int) -> int:
	v -= 1
	return -1 if v == 0 else v


func use_item(pressure: float) -> void:
	super.use_item(pressure)
	var pos = _target_point()
	if pos == null:
		return
	_anchor = pos
	_size = Vector3i.ONE
	_pivot = null
	_mode = "none"
	_notify("Corner set\nR: resize  T: translate  P: set pivot  G: save")


func _set_pivot() -> void:
	if _anchor == null:
		return
	var pos = _target_point()
	if pos == null:
		return
	_pivot = pos
	_notify("Pivot set")


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


## Min corner, max corner (inclusive) of the box, accounting for _size
## possibly being negative on any axis.
func _bounds() -> Array:
	var far: Vector3i = Vector3i(_anchor) + _size - Vector3i(sign(_size.x), sign(_size.y), sign(_size.z))
	var mn := Vector3i(min(_anchor.x, far.x), min(_anchor.y, far.y), min(_anchor.z, far.z))
	var mx := Vector3i(max(_anchor.x, far.x), max(_anchor.y, far.y), max(_anchor.z, far.z))
	return [mn, mx]


func _effective_pivot() -> Vector3i:
	return _pivot if _pivot != null else _anchor


func _draw_selection() -> void:
	if _anchor == null or not voxel_interactor._terrain:
		return
	var origin: Vector3 = voxel_interactor._terrain.global_position
	DebugDraw3D.draw_aabb(AABB(Vector3(_anchor) + origin, Vector3.ONE), Color.CYAN)

	var bounds := _bounds()
	var mn: Vector3i = bounds[0]
	var mx: Vector3i = bounds[1]
	DebugDraw3D.draw_aabb(AABB(Vector3(mn) + origin, Vector3(mx - mn) + Vector3.ONE), Color(1, 1, 1, 0.6))

	DebugDraw3D.draw_aabb(AABB(Vector3(_effective_pivot()) + origin, Vector3.ONE), Color.RED)


func save_structure() -> void:
	if _anchor == null:
		return

	var bounds := _bounds()
	var mn: Vector3i = bounds[0]
	var mx: Vector3i = bounds[1]
	var size := mx - mn + Vector3i.ONE

	var buffer := VoxelBuffer.new()
	buffer.create(size.x, size.y, size.z)
	voxel_interactor._terrain_tool.copy(mn, buffer, 1 << VoxelBuffer.CHANNEL_TYPE)

	var structure := SavedVoxelStructure.new()
	structure.from_voxel_buffer(buffer)
	structure.pivot = _effective_pivot() - mn

	DirAccess.make_dir_recursive_absolute(STRUCTURES_DIR)
	var path := "%s/structure_%d.tres" % [STRUCTURES_DIR, _next_index()]
	var err := ResourceSaver.save(structure, path)
	if err == OK:
		_notify("Saved: %s" % path.get_file())
	else:
		push_error("Failed to save structure (%d): %s" % [err, path])

	_anchor = null
	_pivot = null
	_mode = "none"


func _next_index() -> int:
	var i := 1
	while FileAccess.file_exists("%s/structure_%d.tres" % [STRUCTURES_DIR, i]):
		i += 1
	return i


func on_unequipped() -> void:
	super.on_unequipped()
	_anchor = null
	_pivot = null
	_mode = "none"
	if voxel_interactor:
		voxel_interactor.cleanup()

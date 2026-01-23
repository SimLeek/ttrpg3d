@tool
extends GridMap

@export_group("Model Adjustment")
@export var item_index: int = 0
@export var euler_angles: Vector3 = Vector3(0, 0, 0)

# Custom editor properties
var available_levels: Array = []
var selected_level_index: int = 0 : set = _set_level_index
var previous_euler: Vector3 = Vector3(0, 0, 0)

# Internal helper for gizmo drawing
var _gizmo_mesh: MeshInstance3D

func _ready() -> void:
	if Engine.is_editor_hint():
		_setup_gizmo()

func _setup_gizmo() -> void:
	# Check if gizmo already exists to avoid duplicates
	if has_node("__LevelGizmo__"):
		_gizmo_mesh = get_node("__LevelGizmo__")
	else:
		_gizmo_mesh = MeshInstance3D.new()
		_gizmo_mesh.name = "__LevelGizmo__"
		_gizmo_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_gizmo_mesh.mesh = ImmediateMesh.new()
		
		# Set up a simple unshaded material
		var mat = StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.albedo_color = Color.YELLOW
		mat.vertex_color_use_as_albedo = true
		_gizmo_mesh.material_override = mat
		
		add_child(_gizmo_mesh)
		_gizmo_mesh.set_owner(null) # Prevent saving it into the scene file

func _update_available_levels() -> void:
	var used_cells = get_used_cells()
	var levels_found = {}
	for cell in used_cells:
		levels_found[cell.y] = true
	
	available_levels = levels_found.keys()
	available_levels.sort()

func _set_level_index(val: int) -> void:
	selected_level_index = val
	_draw_level_box()

func _get_property_list() -> Array[Dictionary]:
	_update_available_levels()
	notify_property_list_changed()
	
	var props: Array[Dictionary] = []
	var dropdown_items = ["None"]
	for y in available_levels:
		dropdown_items.append("Level Y %s" % [str(y)])
	
	props.append({
		"name": "selected_level_index",
		"type": TYPE_INT,
		"hint": PROPERTY_HINT_ENUM,
		"hint_string": ",".join(dropdown_items),
		"usage": PROPERTY_USAGE_EDITOR
	})
	return props

func _draw_level_box() -> void:
	if not _gizmo_mesh: return
	var im: ImmediateMesh = _gizmo_mesh.mesh
	im.clear_surfaces()
	
	if selected_level_index <= 0 or available_levels.is_empty():
		return

	var current_y = available_levels[selected_level_index - 1]
	var min_c = Vector3(INF, INF, INF)
	var max_c = Vector3(-INF, -INF, -INF)
	var found = false

	for cell in get_used_cells():
		if cell.y == current_y:
			var pos = Vector3(cell)
			min_c = min_c.min(pos)
			max_c = max_c.max(pos)
			found = true
	
	if not found: return

	# Calculate local bounds (compensating for cell size)
	var cell_sz = cell_size
	var start = min_c * cell_sz
	var end = (max_c + Vector3.ONE) * cell_sz
	var aabb = AABB(start, end - start)

	# Draw 3D Box lines
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	var corners = [
		Vector3(aabb.position.x, aabb.position.y, aabb.position.z),
		Vector3(aabb.end.x, aabb.position.y, aabb.position.z),
		Vector3(aabb.end.x, aabb.position.y, aabb.end.z),
		Vector3(aabb.position.x, aabb.position.y, aabb.end.z),
		Vector3(aabb.position.x, aabb.end.y, aabb.position.z),
		Vector3(aabb.end.x, aabb.end.y, aabb.position.z),
		Vector3(aabb.end.x, aabb.end.y, aabb.end.z),
		Vector3(aabb.position.x, aabb.end.y, aabb.end.z)
	]
	
	var indices = [0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7]
	for i in indices:
		im.surface_add_vertex(corners[i])
	im.surface_end()

func _process(_delta: float) -> void:
	if Engine.is_editor_hint():
		if euler_angles != previous_euler:
			_apply_rotation()
			previous_euler = euler_angles

func _apply_rotation() -> void:
	if not mesh_library: return
	var rads = Vector3(deg_to_rad(euler_angles.x), deg_to_rad(euler_angles.y), deg_to_rad(euler_angles.z))
	var trans = mesh_library.get_item_mesh_transform(item_index)
	var basis = Basis.from_euler(rads).scaled(trans.basis.get_scale())
	mesh_library.set_item_mesh_transform(item_index, Transform3D(basis, trans.origin))
	_update_all_cells()

func _update_all_cells() -> void:
	for cell in get_used_cells():
		set_cell_item(cell, get_cell_item(cell), get_cell_item_orientation(cell))
	_update_available_levels()

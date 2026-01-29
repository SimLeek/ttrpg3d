@tool
extends Node3D

class_name NPCDialogSystem

# --- Exports ---

@export_group("Detection")
@export var interaction_radius: float = 5.0
@export var player_group: String = "player"
@export var allow_restart: bool = true
@export var restart_radius: float = 1.5

## whether to auto display when the user is nearby or require restarting by jumping
@export var displaying: bool = false

@export_group("Dialog Data")
@export var dialogs: Array[DialogEntry] = []:
	set(v): 
		dialogs = v
		_update_full_system()

@export var exit_dialogs: Array[DialogEntry] = []

@export_group("Visuals")
@export var billboard_height: float = 0.0
@export var spring_distance: float = .7
@export var spring_stiffness: float = 50.0
@export var spring_damping: float = 5.0
@export var box_size: Vector2 = Vector2(500, 180)
@export var font_size: int = 24
@export var text_color: Color = Color.WHITE

@export_group("Editor Tools")
@export var show_in_editor: bool = false:
	set(v):
		show_in_editor = v
		_update_full_system()

@export var preview_index: int = 0:
	set(v):
		preview_index = v
		_update_full_system()
		


# --- Internal Nodes ---
var _viewport: SubViewport
var _spring_bone: Node3D
var _sprite: Sprite3D
var _label: RichTextLabel
var _face_rect: TextureRect
var _panel: Panel

var _active_player: Node3D = null
var _is_playing: bool = false
var _reset_index = 0
var _spring_velocity: Vector3 = Vector3.ZERO

# --- Logic ---

func _ready() -> void:
	print("[NPCDialog] Initializing...")
	_reset_index = preview_index
	
	_setup_nodes()
	_update_full_system()
	
	if not Engine.is_editor_hint():
		_sprite.hide()

func _process(_delta: float) -> void:
	if Engine.is_editor_hint(): return
	
	_handle_proximity()
	
	var target_offset = Vector3.ZERO
	if _is_playing and displaying and _active_player:
		var to_player = _active_player.global_position - global_position
		var horizontal = to_player
		horizontal.y = 0
		var mid_distance = horizontal.length()
		
		if horizontal.length_squared() > 0:
			horizontal = horizontal.normalized()
			target_offset = horizontal * min(spring_distance, mid_distance)
	
	var displacement = target_offset - _spring_bone.position
	var force = displacement * spring_stiffness - _spring_velocity * spring_damping
	_spring_velocity += force * _delta
	_spring_bone.position += _spring_velocity * _delta

func _handle_proximity() -> void:
	if not _active_player:
		var p = get_tree().get_first_node_in_group(player_group)
		if p is Node3D: _active_player = p
		return
	
	var dist = global_position.distance_to(_active_player.global_position)
	
	if dist <= interaction_radius:
		
		if not _is_playing and displaying:
			print("[NPCDialog] Player entered range.")
			_play_dialog(0)
		
		_advance()
	elif _is_playing and displaying:
		print("[NPCDialog] Player left range.")
		_exit_flow()

# --- System Setup ---

func _setup_nodes() -> void:
	# Cleanup existing to prevent duplicates in tool mode
	for child in get_children():
		if child.name.begins_with("_internal_"):
			child.free()

	# 1. Viewport
	_viewport = SubViewport.new()
	_viewport.name = "_internal_viewport"
	_viewport.size = box_size
	_viewport.transparent_bg = true
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_viewport)

	# 2. UI Layout
	_panel = Panel.new()
	_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var style = StyleBoxFlat.new()
	style.bg_color = Color(0, 0, 0, 0.75)
	style.corner_radius_top_left = 15
	_panel.add_theme_stylebox_override("panel", style)
	_viewport.add_child(_panel)

	var hbox = HBoxContainer.new()
	hbox.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hbox.offset_left = 10; hbox.offset_right = -10
	_panel.add_child(hbox)

	_face_rect = TextureRect.new()
	_face_rect.custom_minimum_size = Vector2(box_size.y - 20, 0)
	_face_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_face_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	hbox.add_child(_face_rect)

	_label = RichTextLabel.new()
	_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_label.bbcode_enabled = true
	hbox.add_child(_label)

	# 3. Spring Bone
	_spring_bone = Node3D.new()
	_spring_bone.name = "_internal_spring_bone"
	add_child(_spring_bone)

	# 4. 3D Sprite
	_sprite = Sprite3D.new()
	_sprite.name = "_internal_sprite"
	_sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_sprite.no_depth_test = true # Appears on top
	_sprite.position.y = billboard_height
	#_sprite.alpha_cut = Sprite3D.ALPHA_CUT_DISCARD
	# Map the viewport to the sprite
	_sprite.texture = _viewport.get_texture()
	_spring_bone.add_child(_sprite)

func _update_full_system() -> void:
	if not _sprite: return
	
	# Update visibility
	_sprite.visible = show_in_editor if Engine.is_editor_hint() else (_is_playing and displaying)
	
	# Update content
	if dialogs.size() > preview_index:
		var entry = dialogs[preview_index]
		if entry != null: # Fixes the "Nil" error
			_apply_entry(entry)
		else:
			_label.text = "[center]Empty Dialog Slot[/center]"
	else:
		_label.text = "[center]No Data[/center]"
	
	# Refresh UI settings
	_label.add_theme_font_size_override("normal_font_size", font_size)
	_label.add_theme_color_override("default_color", text_color)

func _apply_entry(entry: DialogEntry) -> void:
	if not _label: return
	_label.text = entry.text
	if entry.face_texture:
		_face_rect.texture = entry.face_texture
		_face_rect.show()
	else:
		_face_rect.hide()

# --- Dialog Progression ---

func _play_dialog(idx: int) -> void:
	if idx < dialogs.size() and displaying:
		_is_playing = true
		var entry = dialogs[idx]
		if entry: _apply_entry(entry)
		_sprite.show()
	else:
		_close()

func _advance() -> void:
	# Basic logic: increment index
	# You can expand this with the 'action' enum jumps
	if Input.is_action_just_pressed("jump"):
		print("dialog jump detected")
		if allow_restart and not displaying:
			var dist = global_position.distance_to(_active_player.global_position)
			if dist <= restart_radius:
				print("restart triggered")
				displaying = true
				preview_index = _reset_index
		elif dialogs[preview_index].action == DialogEntry.Actions.EXIT:
			print("dialog exit reached")
			_close()
		else:
			print("dialog updating")
			preview_index = dialogs[preview_index].jump_to_index
		_update_full_system()
		
	#_close()

func _exit_flow() -> void:
	if exit_dialogs.size() > 0 and exit_dialogs[0] != null:
		_apply_entry(exit_dialogs[0])
		# Timer to auto-close after 2 seconds
		await get_tree().create_timer(2.0).timeout
	_close()

func _close() -> void:
	_is_playing = false
	displaying = false
	if _sprite: _sprite.hide()

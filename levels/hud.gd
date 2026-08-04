extends CanvasLayer

@export var health_bar: TextureProgressBar
@export var stamina_bar: TextureProgressBar

var _flight_label: Label

func _ready() -> void:
	visible = true  # don't start paused while being able to move
	_build_flight_label()

func update_health_ui(current: float, max_hp: float) -> void:
	# This converts the 0.0-1.0 range to a 0-100 percentage
	health_bar.value = (current / max_hp) * 100.0

func update_stamina_ui(current: float, max_hp: float) -> void:
	# This converts the 0.0-1.0 range to a 0-100 percentage
	stamina_bar.value = (current / max_hp) * 100.0

func _build_flight_label() -> void:
	_flight_label = Label.new()
	_flight_label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_flight_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_flight_label.position.y = 8
	_flight_label.add_theme_font_size_override("font_size", 18)
	_flight_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_flight_label.add_theme_constant_override("shadow_offset_x", 1)
	_flight_label.add_theme_constant_override("shadow_offset_y", 1)
	_flight_label.visible = false
	add_child(_flight_label)

## Called from player_blob_ctrl.gd whenever flying/intangible are toggled --
## both exit on a double-tap (double-Space, double-Ctrl respectively) that's
## easy to forget which is which, so name it explicitly on screen.
func update_flight_status(is_flying: bool, is_intangible: bool) -> void:
	if not is_flying and not is_intangible:
		_flight_label.visible = false
		return
	var parts: Array[String] = []
	if is_flying:
		parts.append("FLYING (double-Space to stop)")
	if is_intangible:
		parts.append("INTANGIBLE (double-Ctrl to stop)")
	_flight_label.text = "   |   ".join(parts)
	_flight_label.add_theme_color_override("font_color", Color(1.0, 0.5, 1.0) if is_intangible else Color(0.3, 1.0, 1.0))
	_flight_label.visible = true

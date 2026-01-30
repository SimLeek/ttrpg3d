extends CanvasLayer

@export var health_bar: TextureProgressBar

func _ready() -> void:
	visible = true  # don't start paused while being able to move

func update_health_ui(current: float, max_hp: float) -> void:
	# This converts the 0.0-1.0 range to a 0-100 percentage
	health_bar.value = (current / max_hp) * 100.0

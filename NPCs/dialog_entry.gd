extends Resource
class_name DialogEntry

enum Actions { NEXT, JUMP, EXIT }

@export var face_texture: Texture2D
@export_multiline var text: String = "Dialog Text Here"
@export_enum("Next", "Jump", "Exit") var action: int = 0
@export var jump_to_index: int = 0

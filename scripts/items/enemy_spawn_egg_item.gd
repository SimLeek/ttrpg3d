extends BaseItem
class_name EnemySpawnEggItem

## DM item (Phase 8): "we do have the enemy slime AI so we can add in
## enemy spawn eggs with not too much effort." Spawns a hostile enemy
## (NPCs/evil_blob.tscn) at wherever the player's aiming, on use. No
## dedicated "DM item" gate exists anywhere in this codebase (ItemCatalog
## lists everything -- blocks, tools, movement items -- in one flat list;
## see item_catalog.gd) -- this is a DM tool only by convention, same as
## the structure saver/placer/plane selector already are.
##
## evil_blob.tscn's own _ready() (NPCs/evil_blob_ai.gd) already does all
## the AI setup itself the moment it enters the tree -- finds players via
## the "player" group, calls blob_ai.setup()/set_spawn_position() using
## global_position -- so this item only needs to instantiate it, set its
## spawn point, and add it to the current scene. No manual AI wiring needed.
##
## Sets the local `position`, not `global_position`: a freshly-instantiate()d
## node isn't in the tree yet, so global_position can't resolve a parent
## transform and errors ("!is_inside_tree()"). current_scene's root has an
## identity transform (confirmed in voxel_main_world.tscn), so local
## position on a direct child equals global_position anyway -- and setting
## it before add_child() still means _ready() sees the right spawn point.

const ENEMY_SCENE := preload("res://NPCs/evil_blob.tscn")

@export var voxel_interactor: VoxelInteractor

func set_character(chara: CharacterBody3D) -> void:
	super.set_character(chara)
	if not voxel_interactor: voxel_interactor = VoxelInteractor.new()
	voxel_interactor.setup(chara)

func _physics_process(_delta: float) -> void:
	if not voxel_interactor or not character:
		return
	voxel_interactor.update_target(character)

func use_item(pressure: float) -> void:
	super.use_item(pressure)
	if not can_use or not character:
		return
	var scene := character.get_tree().current_scene
	if not scene:
		return
	var enemy := ENEMY_SCENE.instantiate()
	enemy.position = _spawn_position()
	scene.add_child(enemy)

## The empty voxel cell the player's aiming at (centered, not the raw
## corner -- matches battle_mode_manager.gd's own voxel-centering), one
## step out from whatever surface was hit so the enemy doesn't spawn
## embedded in it. Falls back to just in front of the player if nothing's
## targeted -- spawning shouldn't require aiming at a block, same
## reasoning plane_selector_item.gd's own fallback uses for its tool picks.
func _spawn_position() -> Vector3:
	if voxel_interactor and voxel_interactor.has_valid_target():
		var placement = voxel_interactor.get_placement_position()
		if placement != null and character.voxel_terrain:
			return Vector3(placement) + Vector3(0.5, 0.5, 0.5) + character.voxel_terrain.global_position
	return character.global_position + (-character.global_transform.basis.z) * 2.0

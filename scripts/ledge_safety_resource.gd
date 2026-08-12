extends Resource
class_name LedgeSafetyResource

## Ledge safety (Phase 6) -- holding "slow" (Shift) while grounded prevents
## walking off the edge of the current voxel, with a small margin allowed
## past it before it's treated as a collision. Lets a DM stand right at
## the edge of a ledge to look over without falling off by accident, while
## still being able to step off deliberately by releasing Shift. The
## "half speed while holding Shift" half of the Phase 6 crouch mechanic is
## already handled by the pre-existing "slow" action/MoverResource.slow_speed
## (already exactly half of normal_speed) -- this resource is only the new
## edge-safety part.
##
## Mechanic: register the voxel cell the player is standing on the moment
## Shift goes down (grounded); each physics frame after that, if they've
## moved to a different cell, check whether there's a voxel below the NEW
## cell -- if there is, that becomes the new registered "safe" cell (so
## walking across solid ground while holding Shift keeps working, not just
## protecting wherever you started); if there isn't (an edge), push them
## back to stay within the old cell's footprint plus `margin` instead of
## letting them walk off it.
##
## Horizontal (XZ) cell tracking only, matching the same reasoning as
## BattleModeManager's waypoint "standing on" check -- vertical precision
## isn't the point here, which voxel column you're over is.

@export var margin: float = 0.125  ## ~1/8 voxel, per the spec
@export var probe_down_distance: float = 1.5  ## how far to raycast down looking for a floor
@export var probe_up_offset: float = 0.1  ## raycast starts this far above the query position

const VOXEL_SIZE := 1.0

var _active: bool = false
var _safe_cell: Vector2i = Vector2i.ZERO

## terrain_origin: voxel_terrain.global_position, same relative-to-terrain
## approach player_blob_ctrl.gd/battle_mode_manager.gd already use so this
## stays correct across the large-world origin-shifting system.
func handle_physics_process(character: CharacterBody3D, vt: VoxelTool, terrain_origin: Vector3, is_held: bool, is_grounded: bool) -> void:
	if not is_held or not is_grounded or not vt:
		_active = false
		return

	var pos: Vector3 = character.global_position
	var local := pos - terrain_origin
	var cell := Vector2i(floori(local.x / VOXEL_SIZE), floori(local.z / VOXEL_SIZE))

	if not _active:
		_active = true
		_safe_cell = cell
		return

	if cell == _safe_cell:
		return  # still over the registered voxel -- nothing to check yet

	if _has_floor_below(vt, pos):
		_safe_cell = cell  # solid new ground -- that's the new safe cell
		return

	# No floor below the new cell -- clamp horizontally to the old cell's
	# footprint plus margin instead of letting the player walk off it.
	var cell_min := Vector2(_safe_cell.x, _safe_cell.y) * VOXEL_SIZE + Vector2(terrain_origin.x, terrain_origin.z)
	var cell_max := cell_min + Vector2(VOXEL_SIZE, VOXEL_SIZE)
	var clamped_x: float = clamp(pos.x, cell_min.x - margin, cell_max.x + margin)
	var clamped_z: float = clamp(pos.z, cell_min.y - margin, cell_max.y + margin)
	character.global_position = Vector3(clamped_x, pos.y, clamped_z)
	character.velocity.x = 0.0
	character.velocity.z = 0.0

func _has_floor_below(vt: VoxelTool, pos: Vector3) -> bool:
	var origin: Vector3 = pos + Vector3.UP * probe_up_offset
	var hit = vt.raycast(origin, Vector3.DOWN, probe_down_distance + probe_up_offset)
	return hit != null

func reset() -> void:
	_active = false

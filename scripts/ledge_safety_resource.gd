extends Resource
class_name LedgeSafetyResource

## Ledge safety (Phase 6) -- holding "slow" (Shift) while grounded prevents
## walking off the edge of the current voxel, with a small margin allowed
## past it before it's treated as a collision (Minecraft-sneak-style,
## which this is clearly modeled after). Lets a DM stand right at the edge
## of a ledge to look over without falling off by accident, while still
## being able to step off deliberately by releasing Shift (or jumping --
## this only ever touches horizontal velocity, never blocks a jump). The
## "half speed while holding Shift" half of the Phase 6 crouch mechanic is
## already handled by the pre-existing "slow" action/MoverResource.slow_speed
## (already exactly half of normal_speed) -- this resource is only the new
## edge-safety part.
##
## Called BEFORE move_and_slide(), not after: it PREDICTS where this
## frame's horizontal velocity would move the player and checks THAT
## position for a floor, clamping velocity so move_and_slide() never
## actually carries them past the edge in the first place. A first version
## corrected position *after* move_and_slide() instead, which had two real
## bugs found via live testing ("everything...works except holding shift
## and not falling off ledges"): (1) by the time the correction ran,
## is_on_floor() could already read false from that same frame's move,
## so the grounded-gated check would just skip doing anything -- one
## frame too late; (2) the floor probe reached a full 1.5 voxels down,
## so it happily treated an ordinary single-block step (a completely
## normal, common terrain feature) as "still safe ground" and only ever
## caught much deeper drops than what "ledge" actually means here.
##
## Mechanic: register the voxel cell the player is standing on the moment
## Shift goes down (grounded); each physics frame after that, predict
## where this frame's horizontal movement would land -- if that's still
## within the registered cell, or there's a floor there (within a SHORT
## probe distance, just past the character's own vertical size -- NOT a
## generous "any floor below" check, or every ordinary step down would
## count as "safe"), let it through and update the registered cell;
## otherwise clamp the velocity so this frame's move can only reach the
## old cell's footprint plus `margin`, not past it.
##
## Horizontal (XZ) cell tracking only, matching the same reasoning as
## BattleModeManager's waypoint "standing on" check -- vertical precision
## isn't the point here, which voxel column you're over is.

@export var margin: float = 0.125  ## ~1/8 voxel, per the spec
@export var probe_down_distance: float = 0.4  ## just past the character's own vertical extent -- NOT enough to reach a full voxel drop, which should count as an edge
@export var probe_up_offset: float = 0.1  ## raycast starts this far above the query position

const VOXEL_SIZE := 1.0

var _active: bool = false
var _safe_cell: Vector2i = Vector2i.ZERO

## terrain_origin: voxel_terrain.global_position, same relative-to-terrain
## approach player_blob_ctrl.gd/battle_mode_manager.gd already use so this
## stays correct across the large-world origin-shifting system. Call
## BEFORE move_and_slide(), with the velocity about to be applied this
## frame -- returns the (possibly horizontally-clamped) velocity to
## actually use.
func handle_physics_process(character: CharacterBody3D, vt: VoxelTool, terrain_origin: Vector3, is_held: bool, is_grounded: bool, velocity: Vector3, delta: float) -> Vector3:
	if not is_held or not is_grounded or not vt or delta <= 0.0:
		_active = false
		return velocity

	var pos: Vector3 = character.global_position
	var cell := _cell_of(pos, terrain_origin)

	if not _active:
		_active = true
		_safe_cell = cell
		return velocity

	var predicted: Vector3 = pos + Vector3(velocity.x, 0.0, velocity.z) * delta
	var predicted_cell := _cell_of(predicted, terrain_origin)

	if predicted_cell == _safe_cell or _has_floor_below(vt, predicted):
		_safe_cell = predicted_cell  # still safe (or solid new ground) -- track it
		return velocity

	# No floor under where this frame's movement would land -- clamp
	# velocity so move_and_slide() can only reach the old safe cell's
	# footprint plus margin, not past it. Deriving velocity from the
	# clamped predicted position (rather than just zeroing) means sliding
	# along an edge still works normally -- only the axis actually headed
	# off it gets reduced.
	var cell_min := Vector2(_safe_cell.x, _safe_cell.y) * VOXEL_SIZE + Vector2(terrain_origin.x, terrain_origin.z)
	var cell_max := cell_min + Vector2(VOXEL_SIZE, VOXEL_SIZE)
	var clamped_x: float = clamp(predicted.x, cell_min.x - margin, cell_max.x + margin)
	var clamped_z: float = clamp(predicted.z, cell_min.y - margin, cell_max.y + margin)
	var out_velocity := velocity
	out_velocity.x = (clamped_x - pos.x) / delta
	out_velocity.z = (clamped_z - pos.z) / delta
	return out_velocity

func _cell_of(pos: Vector3, terrain_origin: Vector3) -> Vector2i:
	var local := pos - terrain_origin
	return Vector2i(floori(local.x / VOXEL_SIZE), floori(local.z / VOXEL_SIZE))

func _has_floor_below(vt: VoxelTool, pos: Vector3) -> bool:
	var origin: Vector3 = pos + Vector3.UP * probe_up_offset
	var hit = vt.raycast(origin, Vector3.DOWN, probe_down_distance + probe_up_offset)
	return hit != null

func reset() -> void:
	_active = false

extends Resource
class_name LedgeSafetyResource

## Ledge safety (Phase 6) -- holding "slow" (Shift) while grounded prevents
## walking off the edge of the current voxel, with a small margin allowed
## past it before it's treated as a collision (Minecraft-sneak-style,
## which this is clearly modeled after). Lets a DM stand right at the edge
## of a ledge to look over without falling off by accident, while still
## being able to step off deliberately by releasing Shift or jumping. The
## "half speed while holding Shift" half of the Phase 6 crouch mechanic is
## already handled by the pre-existing "slow" action/MoverResource.slow_speed
## (already exactly half of normal_speed) -- this resource is only the new
## edge-safety part.
##
## Called AFTER move_and_slide(), correcting position/velocity if that
## move carried the player somewhere unsafe. Two earlier versions both
## failed live testing ("everything...works except holding shift and not
## falling off ledges" / "still doesn't work" on a controlled 1-block-wide
## test platform, confirmed via debug_log below):
## - v1 corrected position after move_and_slide() but gated on
##   is_grounded -- one frame too late, since crossing an edge in that
##   same move could already flip is_on_floor() false.
##   Also probe_down_distance (1.5) reached a full voxel down, treating an
##   ordinary single-block step as still-safe ground.
## - v2 moved the check to BEFORE move_and_slide() (predicting velocity),
##   still gated on is_grounded for every frame. This uncovered the real
##   issue: a capsule resting only partially over an edge (even within the
##   allowed margin) doesn't reliably keep is_on_floor() true -- Godot's
##   own collision naturally loses/regains floor contact right at a
##   boundary. Gating continued protection on that per-frame reading meant
##   ONE flaky "not grounded" frame threw away tracking entirely, letting
##   gravity take over uncorrected from then on (confirmed via
##   debug_log: activated -> two clamped frames within margin -> "is_held=true
##   is_grounded=false" -> deactivated, followed by an uninterrupted fall).
##
## This version only checks is_grounded to decide whether to START
## tracking (so it doesn't kick in mid-jump/mid-fall) -- once active, it
## keeps correcting every frame Shift is held, regardless of what
## is_on_floor() says that frame, only backing off for an actual deliberate
## jump (velocity.y meaningfully positive) rather than an edge-adjacent
## floor-contact flicker.
##
## Mechanic: register the voxel cell the player is standing on the moment
## Shift goes down (grounded); each physics frame after that, if they've
## moved to a different cell: a deliberate jump (velocity.y > threshold)
## is let through untouched; otherwise, solid floor at the new position
## (a SHORT probe, just past the character's own vertical size -- NOT a
## generous "any floor below" check, or every ordinary step down would
## count as "safe") updates the registered cell; no floor at all snaps
## the player back to the old cell's footprint plus `margin` and zeroes
## velocity entirely (not just horizontal -- otherwise gravity keeps
## compounding a fall move_and_slide() already started this frame).
##
## Horizontal (XZ) cell tracking only, matching the same reasoning as
## BattleModeManager's waypoint "standing on" check -- vertical precision
## isn't the point here, which voxel column you're over is.

@export var margin: float = 0.125  ## ~1/8 voxel, per the spec
@export var probe_down_distance: float = 0.4  ## just past the character's own vertical extent -- NOT enough to reach a full voxel drop, which should count as an edge
@export var probe_up_offset: float = 0.1  ## raycast starts this far above the query position
@export var jump_velocity_threshold: float = 0.1  ## velocity.y above this counts as "deliberately jumping," not "just walking" -- don't fight it

## Diagnostic -- flip on (Inspector, or a future dev-console command) to
## trace activation/cell-change/clamp decisions per frame, same pattern as
## InputController.debug_log_input. Two earlier versions of this mechanic
## both looked right on paper and both failed live; this is what actually
## caught the real bug (see the class doc comment above). Off by default
## now that it did its job.
@export var debug_log: bool = false

const VOXEL_SIZE := 1.0

var _active: bool = false
var _safe_cell: Vector2i = Vector2i.ZERO

## terrain_origin: voxel_terrain.global_position, same relative-to-terrain
## approach player_blob_ctrl.gd/battle_mode_manager.gd already use so this
## stays correct across the large-world origin-shifting system. Call AFTER
## move_and_slide() each physics frame; mutates character.global_position/
## velocity directly rather than returning a value, since it may need to
## touch both position and velocity depending on the case.
func handle_physics_process(character: CharacterBody3D, vt: VoxelTool, terrain_origin: Vector3, is_held: bool, was_grounded: bool) -> void:
	if not is_held or not vt:
		if debug_log and _active:
			print("[LedgeSafety] deactivating: is_held=%s vt=%s" % [is_held, vt != null])
		_active = false
		return

	var pos: Vector3 = character.global_position
	var cell := _cell_of(pos, terrain_origin)

	if not _active:
		if not was_grounded:
			return  # only start tracking from solid ground, not mid-air
		_active = true
		_safe_cell = cell
		if debug_log:
			print("[LedgeSafety] activated: pos=%s safe_cell=%s" % [pos, _safe_cell])
		return

	if cell == _safe_cell:
		return  # still over the registered cell -- nothing to check

	if character.velocity.y > jump_velocity_threshold:
		# Deliberately jumping -- don't fight it, just re-register wherever
		# they end up (same as landing on solid new ground normally).
		if debug_log:
			print("[LedgeSafety] jump detected (velocity.y=%.2f), letting through: %s -> %s" % [character.velocity.y, _safe_cell, cell])
		_safe_cell = cell
		return

	if _has_floor_below(vt, pos):
		if debug_log:
			print("[LedgeSafety] cell change OK: %s -> %s (floor found)" % [_safe_cell, cell])
		_safe_cell = cell
		return

	# No floor here, not jumping -- push back to the old cell's footprint
	# plus margin, and zero velocity entirely (not just horizontal) so
	# gravity can't keep compounding whatever fall this frame's
	# move_and_slide() already started.
	var cell_min := Vector2(_safe_cell.x, _safe_cell.y) * VOXEL_SIZE + Vector2(terrain_origin.x, terrain_origin.z)
	var cell_max := cell_min + Vector2(VOXEL_SIZE, VOXEL_SIZE)
	var clamped_x: float = clamp(pos.x, cell_min.x - margin, cell_max.x + margin)
	var clamped_z: float = clamp(pos.z, cell_min.y - margin, cell_max.y + margin)
	if debug_log:
		print("[LedgeSafety] CLAMPING: safe_cell=%s pos=%s -> (%.3f, %.3f)" % [_safe_cell, pos, clamped_x, clamped_z])
	character.global_position = Vector3(clamped_x, pos.y, clamped_z)
	character.velocity = Vector3.ZERO

func _cell_of(pos: Vector3, terrain_origin: Vector3) -> Vector2i:
	var local := pos - terrain_origin
	return Vector2i(floori(local.x / VOXEL_SIZE), floori(local.z / VOXEL_SIZE))

func _has_floor_below(vt: VoxelTool, pos: Vector3) -> bool:
	var origin: Vector3 = pos + Vector3.UP * probe_up_offset
	var hit = vt.raycast(origin, Vector3.DOWN, probe_down_distance + probe_up_offset)
	return hit != null

func reset() -> void:
	_active = false

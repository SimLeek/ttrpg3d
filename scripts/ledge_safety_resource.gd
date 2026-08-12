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
## jump (velocity.y meaningfully positive), which suspends protection for
## the WHOLE jump arc (not just the ascending frames) until landing --
## see the jump-detection branch below for why the descent half matters
## too (a real live bug: floating near the ground after jump+Shift+WASD
## near a block).
##
## Mechanic: register the voxel cell the player is standing on the moment
## Shift goes down (grounded); each physics frame after that, if they've
## moved to a different cell: a deliberate jump (velocity.y > threshold)
## suspends protection until they land again; otherwise, solid floor at
## the new position (a SHORT probe, just past the character's own
## vertical size -- NOT a generous "any floor below" check, or every
## ordinary step down would count as "safe") updates the registered cell;
## no floor at all snaps the player back to the old cell's footprint plus
## `margin` and zeroes velocity entirely (not just horizontal -- otherwise
## gravity keeps compounding a fall move_and_slide() already started this
## frame).
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
## The player's Y at the moment _safe_cell was last confirmed good --
## restored on every clamp (not just X/Z) so repeatedly re-clamping while
## pushed into an edge can't slowly bleed height away. See the clamp
## branch below for why this was needed: a real live bug ("I slowly float
## down if I shift on grass") turned out to have nothing to do with grass
## specifically -- it reproduced identically pushing into any edge for
## long enough. Each re-clamp zeroed velocity but left Y wherever gravity
## had already pulled it that one frame; gravity re-accumulates a little
## from rest before being zeroed again next frame, so height bled away a
## tiny bit every single corrective frame, invisible over a few frames but
## a visible slow sink over the many frames of continuously pushing into
## an edge.
var _safe_y: float = 0.0

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
		_safe_y = pos.y
		if debug_log:
			print("[LedgeSafety] activated: pos=%s safe_cell=%s" % [pos, _safe_cell])
		return

	if cell == _safe_cell:
		return  # still over the registered cell -- nothing to check

	if character.velocity.y > jump_velocity_threshold:
		# Deliberately jumping -- suspend protection entirely rather than
		# just letting this one frame through. A jump's velocity.y only
		# reads positive during the ASCENT; once it peaks and starts
		# falling back down, this check stops matching, and if protection
		# were still active it would see "moved to a new cell, no floor
		# within the short probe distance yet (still a bit above the
		# ground, mid-fall)" and clamp+zero-velocity the player mid-air --
		# a real bug found live: "if I jump while holding shift and moving
		# any direction with wasd I may float close to the ground once I'm
		# near a block." Deactivating for the WHOLE arc instead means
		# was_grounded's own check (above) naturally re-activates fresh
		# only once they've actually landed, with no ambiguity between
		# "still descending from a jump" and "walked off an edge."
		if debug_log:
			print("[LedgeSafety] jump detected (velocity.y=%.2f), suspending until landed" % character.velocity.y)
		_active = false
		return

	if _has_floor_below(vt, pos):
		if debug_log:
			print("[LedgeSafety] cell change OK: %s -> %s (floor found)" % [_safe_cell, cell])
		_safe_cell = cell
		_safe_y = pos.y
		return

	# No floor here, not jumping -- push back to the old cell's footprint
	# plus margin, restore Y to the last confirmed-safe height (not
	# whatever gravity left it at this frame -- see _safe_y's doc comment
	# above for why), and zero velocity entirely so gravity can't keep
	# compounding whatever fall this frame's move_and_slide() started.
	var cell_min := Vector2(_safe_cell.x, _safe_cell.y) * VOXEL_SIZE + Vector2(terrain_origin.x, terrain_origin.z)
	var cell_max := cell_min + Vector2(VOXEL_SIZE, VOXEL_SIZE)
	var clamped_x: float = clamp(pos.x, cell_min.x - margin, cell_max.x + margin)
	var clamped_z: float = clamp(pos.z, cell_min.y - margin, cell_max.y + margin)
	if debug_log:
		print("[LedgeSafety] CLAMPING: safe_cell=%s pos=%s -> (%.3f, %.3f, y=%.3f)" % [_safe_cell, pos, clamped_x, clamped_z, _safe_y])
	character.global_position = Vector3(clamped_x, _safe_y, clamped_z)
	character.velocity = Vector3.ZERO

func _cell_of(pos: Vector3, terrain_origin: Vector3) -> Vector2i:
	var local := pos - terrain_origin
	return Vector2i(floori(local.x / VOXEL_SIZE), floori(local.z / VOXEL_SIZE))

## VoxelTypes.is_player_collidable(): a raycast hit alone isn't enough --
## it hits anything with collision_aabbs (needed for targeting), which
## includes walk-through decorative voxels like tall grass/dead shrub
## (collision_enabled_0 = false in voxel_library.tres). Without this,
## ledge safety would treat standing on a tall-grass tuft as solid footing
## even though the player actually falls straight through it.
func _has_floor_below(vt: VoxelTool, pos: Vector3) -> bool:
	var origin: Vector3 = pos + Vector3.UP * probe_up_offset
	var hit = vt.raycast(origin, Vector3.DOWN, probe_down_distance + probe_up_offset)
	return hit != null and VoxelTypes.is_player_collidable(vt.get_voxel(hit.position))

func reset() -> void:
	_active = false

// docs/BATTLE_SYSTEM.md's waypoint/distance-measurement feature --
// ports the old game's `scripts/game_settings.gd` Minkowski-norm
// distance math only (per docs/PORTING_CHECKLIST.md's own scoping;
// the Godot autoload settings-persistence half doesn't apply here).
//
// A single real number `p` generalizes the usual named metrics rather
// than three fixed options: p=1 is Manhattan (taxicab) distance, p=2
// is ordinary Euclidean distance, and any other positive p is the
// general "Minkowski-n" case docs/BATTLE_SYSTEM.md's own feature list
// names explicitly.

export type Point3 = readonly [number, number, number];

/**
 * Minkowski-p distance between two 3D points. Falls back to Euclidean
 * (p=2) for a non-finite or non-positive p rather than producing NaN/
 * Infinity -- a bad value here should degrade gracefully, not corrupt
 * every displayed distance label.
 */
export function minkowskiDistance(a: Point3, b: Point3, p: number): number {
  const exponent = Number.isFinite(p) && p > 0 ? p : 2;
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  const dz = Math.abs(a[2] - b[2]);
  return Math.pow(Math.pow(dx, exponent) + Math.pow(dy, exponent) + Math.pow(dz, exponent), 1 / exponent);
}

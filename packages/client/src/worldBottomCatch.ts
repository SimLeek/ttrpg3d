// Core respawn primitive (per the core/mod-boundary plan: the respawn
// FUNCTIONS -- detecting a fall below the world bottom, teleporting to an
// anchor -- are core; CALLING them, i.e. deciding this check runs every
// tick and feeds respawnControl.ts's default policy, is the thin default-
// mod layer built on top). Pure, no noa/DOM dependency -- real unit test
// coverage, matching this project's "pure logic gets Vitest, movement/
// physics gets playtested" split.
//
// Lives client-side (not server-side): per the project's standing "client
// owns its own movement" decision, the fall-check runs locally against the
// player's own already-known Y each tick rather than round-tripping
// through the server's "pos" message handler -- the server's only job here
// is telling every client the shared worldBottomY/respawnAnchor values
// (WorldRoom.ts), not deciding when any individual client should respawn.
//
// Edge-triggered (only the tick a position first crosses below the
// threshold), not level-triggered -- a level-triggered check would keep
// firing every tick while a caught player is still below the line (e.g.
// the instant after teleporting them back up, if the anchor itself happens
// to sit near/at the threshold), which isn't what "respawn once when you
// fall" means.

export class WorldBottomCatch {
  private wasBelow = false;

  constructor(private readonly worldBottomY: number) {}

  /** Returns true exactly once per crossing from at-or-above to below worldBottomY. */
  update(y: number): boolean {
    const isBelow = y < this.worldBottomY;
    const justCrossed = isBelow && !this.wasBelow;
    this.wasBelow = isBelow;
    return justCrossed;
  }

  reset(): void {
    this.wasBelow = false;
  }
}

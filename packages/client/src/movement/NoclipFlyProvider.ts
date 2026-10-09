// Direct port of the old game's scripts/items/phasing_gloves_item.gd +
// wings_item.gd: phasing_gloves_item.gd sets `movement_mode = "intangible"`
// (collision off) and reuses the SAME no-gravity, direct-vertical-control
// path wings_item.gd's flying uses -- "otherwise free-fall through
// everything with no way to stop" per its own comment. Confirmed via the
// old repo directly, not guessed.
//
// Also this project's first real non-core MovementProvider -- proves the
// seam CoreMovementProvider was extracted behind actually works for a
// second, structurally different implementation (position-driven, not
// velocity-and-physics-integration-driven).
//
// Position-driven rather than velocity-driven: noa.entities.setPosition
// writes position directly with no collision sweep (confirmed directly in
// noa's entities.js -- the same mechanism net.ts already uses for remote
// players), which is the simplest way to get real pass-through-terrain
// without needing to find/flip some internal voxel-physics-engine
// collision-disable flag (no such flag was found; this project's RigidBody
// has no `collideTerrain`-style toggle, only gravityMultiplier). Velocity
// is zeroed every tick and gravityMultiplier is zeroed for the duration
// (restored on deactivate) purely so a provider switch back to
// CoreMovementProvider doesn't inherit stale velocity or lose the body's
// original gravity setting.

import type { Engine } from "noa-engine";
import type { MovementProvider, MovementInput } from "./MovementProvider.js";

export class NoclipFlyProvider implements MovementProvider {
  flySpeed = 10.0;
  private originalGravityMultiplier: number | null = null;

  onActivate(noa: Engine): void {
    const body = noa.entities.getPhysicsBody(noa.playerEntity);
    if (!body) return;
    this.originalGravityMultiplier = body.gravityMultiplier;
    body.gravityMultiplier = 0;
    body.velocity[0] = 0;
    body.velocity[1] = 0;
    body.velocity[2] = 0;
  }

  onDeactivate(noa: Engine): void {
    const body = noa.entities.getPhysicsBody(noa.playerEntity);
    if (body && this.originalGravityMultiplier !== null) {
      body.gravityMultiplier = this.originalGravityMultiplier;
    }
    this.originalGravityMultiplier = null;
  }

  update(noa: Engine, input: MovementInput): void {
    const body = noa.entities.getPhysicsBody(noa.playerEntity);
    if (!body) return;
    body.velocity[0] = 0;
    body.velocity[1] = 0;
    body.velocity[2] = 0;

    const sin = Math.sin(input.headingRad);
    const cos = Math.cos(input.headingRad);
    const dirX = input.inputX * cos + input.inputY * sin;
    const dirZ = -input.inputX * sin + input.inputY * cos;
    const len = Math.hypot(dirX, dirZ);

    let dx = 0;
    let dz = 0;
    if (len > 0.01) {
      dx = (dirX / len) * this.flySpeed * input.dt;
      dz = (dirZ / len) * this.flySpeed * input.dt;
    }
    // Jump/slow double as ascend/descend -- same continuous-hold mapping
    // SwimResource already uses for swim-up/down.
    const vertical = (input.jumpHeld ? 1 : 0) - (input.slowHeld ? 1 : 0);
    const dy = vertical * this.flySpeed * input.dt;

    const pos = noa.ents.getPosition(noa.playerEntity);
    noa.entities.setPosition(noa.playerEntity, [pos[0] + dx, pos[1] + dy, pos[2] + dz]);
  }

  reset(): void {
    // No internal timers/progress to clear (unlike CoreMovementProvider's
    // sprint/coyote-time state) -- position itself is reset externally by
    // whatever calls reset() (PlayerController.teleportTo), not here.
  }
}

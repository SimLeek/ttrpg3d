// The default/always-available movement provider -- today's whole walk/
// sprint/jump/fall/swim stack, repackaged behind MovementProvider rather
// than rewritten. This is a straight move of PlayerController.ts's own
// previous tick-closure logic into a class; MoverResource/
// BasicJumperResource/FallerResource/SwimResource themselves are
// untouched. Confirmed byte-for-byte equivalent behavior is the whole
// point here -- see the core/mod-boundary plan's verification section.

import type { Engine } from "noa-engine";
import type { MovementProvider, MovementInput } from "./MovementProvider.js";
import { MoverResource } from "./MoverResource.js";
import { BasicJumperResource } from "./BasicJumperResource.js";
import { FallerResource } from "./FallerResource.js";
import { SwimResource } from "./SwimResource.js";

const SPEED_DECAY_GROUND = 2.5;
const SPEED_DECAY_AIR = 0.5;
const SPEED_DECAY_WATER = 1.5;

function moveToward(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

export class CoreMovementProvider implements MovementProvider {
  readonly mover = new MoverResource();
  readonly jumper = new BasicJumperResource();
  readonly faller = new FallerResource();
  readonly swimmer = new SwimResource();
  private prevJumpHeld = false;

  update(noa: Engine, input: MovementInput): void {
    const body = noa.entities.getPhysicsBody(noa.playerEntity);
    if (!body) return;

    const hasInput = Math.hypot(input.inputX, input.inputY) > 0.05;
    const sv: [number, number, number] = [body.velocity[0], body.velocity[1], body.velocity[2]];
    const goal: [number, number, number] = [0, 0, 0];

    if (input.submerged) {
      // Jump/slow keys are repurposed as swim-up/swim-down while submerged
      // -- continuous (held), not edge-triggered like the ground jumper.
      this.swimmer.handlePhysicsInput(input.inputX, input.inputY, input.jumpHeld, input.slowHeld, goal, sv, input.headingRad);
    } else {
      this.mover.handlePhysicsInput(input.inputX, input.inputY, input.slowHeld, input.sprintHeld, goal, input.dt, input.headingRad);
      if (input.jumpHeld && !this.prevJumpHeld) this.jumper.requestJump();
      if (!input.jumpHeld && this.prevJumpHeld) this.jumper.releaseJump();
      this.jumper.updateCoyoteTime(input.grounded, input.dt);
      this.jumper.applyJump(sv, input.grounded);
    }
    this.prevJumpHeld = input.jumpHeld;

    this.faller.applyTerminalVelocity(sv);

    const friction = input.submerged ? SPEED_DECAY_WATER : input.grounded ? SPEED_DECAY_GROUND : SPEED_DECAY_AIR;
    sv[0] = moveToward(sv[0], hasInput ? goal[0] : 0, friction);
    sv[2] = moveToward(sv[2], hasInput ? goal[2] : 0, friction);

    body.velocity[0] = sv[0];
    body.velocity[1] = sv[1];
    body.velocity[2] = sv[2];
  }

  reset(): void {
    this.mover.reset();
    this.jumper.reset();
    this.faller.reset();
    this.swimmer.reset();
    this.prevJumpHeld = false;
  }
}

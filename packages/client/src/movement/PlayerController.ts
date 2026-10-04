// Ported from scripts/player_blob_ctrl.gd's _physics_process -- the part of
// it that's actually "core movement" (walk/sprint/jump/fall). Flying,
// intangible, two-handed item use, wall-kick, ledge-safety, and
// stair-stepping are the old script's other responsibilities but are
// explicitly later work (see docs/PORTING_CHECKLIST.md); this only wires up
// MoverResource + BasicJumperResource + FallerResource.
//
// Replaces noa's default 'movement' + 'receivesInputs' components on the
// player entity rather than tuning their options -- those implement a
// generic Quake-style force model, not this game's speed/stamina/
// coyote-time feel.

import type { Engine } from "noa-engine";
import { MoverResource } from "./MoverResource.js";
import { BasicJumperResource } from "./BasicJumperResource.js";
import { FallerResource } from "./FallerResource.js";

const SPEED_DECAY_GROUND = 2.5;
const SPEED_DECAY_AIR = 0.5;

function moveToward(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

export interface PlayerController {
  mover: MoverResource;
  jumper: BasicJumperResource;
  faller: FallerResource;
}

export function installPlayerController(noa: Engine): PlayerController {
  const mover = new MoverResource();
  const jumper = new BasicJumperResource();
  const faller = new FallerResource();

  // removeComponent is inherited from ent-comp's ECS base class -- real at
  // runtime (noa's own source uses it throughout), but ent-comp ships no
  // .d.ts of its own, so noa's generated types omit it. Cast rather than
  // fight the upstream declaration gap.
  const entitiesEcs = noa.entities as unknown as { removeComponent(id: number, name: string): void };
  entitiesEcs.removeComponent(noa.playerEntity, noa.entities.names.receivesInputs);
  entitiesEcs.removeComponent(noa.playerEntity, noa.entities.names.movement);

  const body = noa.entities.getPhysicsBody(noa.playerEntity);
  if (body) body.friction = 0; // all deceleration comes from this controller's own moveToward blending below, not the engine's built-in surface friction

  noa.inputs.bind("sprint", "ShiftLeft", "ShiftRight");
  noa.inputs.bind("slow", "ControlLeft", "ControlRight");

  let prevJumpHeld = false;

  noa.on("tick", (dtMs: number) => {
    const dt = dtMs / 1000;
    const body = noa.entities.getPhysicsBody(noa.playerEntity);
    if (!body) return;

    const input = noa.inputs.state as Record<string, boolean>;
    const grounded = body.atRestY() < 0;

    const inputY = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const inputX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const hasInput = Math.hypot(inputX, inputY) > 0.05;

    const goal: [number, number, number] = [0, 0, 0];
    mover.handlePhysicsInput(inputX, inputY, !!input.slow, !!input.sprint, goal, dt, noa.camera.heading);

    const jumpHeld = !!input.jump;
    if (jumpHeld && !prevJumpHeld) jumper.requestJump();
    if (!jumpHeld && prevJumpHeld) jumper.releaseJump();
    prevJumpHeld = jumpHeld;

    jumper.updateCoyoteTime(grounded, dt);

    const sv: [number, number, number] = [body.velocity[0], body.velocity[1], body.velocity[2]];
    jumper.applyJump(sv, grounded);
    faller.applyTerminalVelocity(sv);

    const friction = grounded ? SPEED_DECAY_GROUND : SPEED_DECAY_AIR;
    sv[0] = moveToward(sv[0], hasInput ? goal[0] : 0, friction);
    sv[2] = moveToward(sv[2], hasInput ? goal[2] : 0, friction);

    // voxel-physics-engine puts a body to sleep after ~10 ticks of no
    // applyForce/applyImpulse/setPosition call, and SKIPS integrating a
    // sleeping body's position entirely (checked its tick() source
    // directly) -- writing body.velocity[i] by index, as this controller
    // does, never resets that counter. Without this, a player-controlled
    // body would fall asleep ~1/6 second after spawning and then never
    // move again regardless of velocity, reproduced live (position frozen
    // across every diagnostic sample despite real, input-responsive
    // velocity values). A player's own body should never be allowed to
    // sleep in the first place.
    (body as unknown as { _markActive(): void })._markActive();

    body.velocity[0] = sv[0];
    body.velocity[1] = sv[1];
    body.velocity[2] = sv[2];
  });

  return { mover, jumper, faller };
}

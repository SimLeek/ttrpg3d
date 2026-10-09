// Ported from scripts/player_blob_ctrl.gd's _physics_process -- the part of
// it that's actually "core movement" (walk/sprint/jump/fall/swim). Owns the
// INPUT-GATHERING tick loop and which MovementProvider currently owns the
// player entity; the actual walk/jump/fall/swim logic lives in
// CoreMovementProvider (the default provider, always available) -- see
// MovementProvider.ts for why that split exists (the core/mod-boundary
// plan: alternate movement modes like NoclipFlyProvider's fly/pass-through-
// terrain are swappable providers layered on the same seam, not special-
// cased into this file).
//
// Replaces noa's default 'movement' + 'receivesInputs' components on the
// player entity rather than tuning their options -- those implement a
// generic Quake-style force model, not this game's speed/stamina/
// coyote-time feel.

import type { Engine } from "noa-engine";
import type { MovementProvider, MovementInput } from "./MovementProvider.js";
import { CoreMovementProvider } from "./CoreMovementProvider.js";
import { NoclipFlyProvider } from "./NoclipFlyProvider.js";

export interface PlayerController {
  core: CoreMovementProvider;
  noclip: NoclipFlyProvider;
  getActiveProvider(): MovementProvider;
  /** Switches the active provider (calling onDeactivate/onActivate and resetting the new one's internal state). Used by game.ts's GM admin-override toggle. */
  setProvider(provider: MovementProvider): void;
  /**
   * Moves the player entity directly (noa.entities.setPosition, bypassing
   * collision -- same mechanism NoclipFlyProvider uses), zeros velocity,
   * and resets the active provider's internal state so nothing carries
   * over incorrectly across a forced position change. Used by
   * respawnControl.ts today; this is also the entry point Phase 9's
   * battle-mode waypoint ctrl-z/ctrl-y teleport will call later, per the
   * core/mod-boundary plan -- it doesn't need its own teleport mechanism.
   */
  teleportTo(pos: readonly [number, number, number]): void;
}

export function installPlayerController(noa: Engine): PlayerController {
  const core = new CoreMovementProvider();
  const noclip = new NoclipFlyProvider();
  let activeProvider: MovementProvider = core;

  // removeComponent is inherited from ent-comp's ECS base class -- real at
  // runtime (noa's own source uses it throughout), but ent-comp ships no
  // .d.ts of its own, so noa's generated types omit it. Cast rather than
  // fight the upstream declaration gap.
  const entitiesEcs = noa.entities as unknown as { removeComponent(id: number, name: string): void };
  entitiesEcs.removeComponent(noa.playerEntity, noa.entities.names.receivesInputs);
  entitiesEcs.removeComponent(noa.playerEntity, noa.entities.names.movement);

  const body = noa.entities.getPhysicsBody(noa.playerEntity);
  if (body) body.friction = 0; // all deceleration comes from CoreMovementProvider's own moveToward blending, not the engine's built-in surface friction

  noa.inputs.bind("sprint", "ShiftLeft", "ShiftRight");
  noa.inputs.bind("slow", "ControlLeft", "ControlRight");

  function setProvider(provider: MovementProvider): void {
    if (provider === activeProvider) return;
    activeProvider.onDeactivate?.(noa);
    activeProvider = provider;
    activeProvider.reset();
    activeProvider.onActivate?.(noa);
  }

  function teleportTo(pos: readonly [number, number, number]): void {
    noa.entities.setPosition(noa.playerEntity, [pos[0], pos[1], pos[2]]);
    const b = noa.entities.getPhysicsBody(noa.playerEntity);
    if (b) {
      b.velocity[0] = 0;
      b.velocity[1] = 0;
      b.velocity[2] = 0;
    }
    activeProvider.reset();
  }

  noa.on("tick", (dtMs: number) => {
    const dt = dtMs / 1000;
    const b = noa.entities.getPhysicsBody(noa.playerEntity);
    if (!b) return;

    const input = noa.inputs.state as Record<string, boolean>;
    const movementInput: MovementInput = {
      inputX: (input.right ? 1 : 0) - (input.left ? 1 : 0),
      inputY: (input.forward ? 1 : 0) - (input.backward ? 1 : 0),
      jumpHeld: !!input.jump,
      slowHeld: !!input.slow,
      sprintHeld: !!input.sprint,
      grounded: b.atRestY() < 0,
      // body.inFluid is real, already-maintained state (set every physics
      // tick by voxel-physics-engine's applyFluidForces, which also already
      // drives real buoyancy/drag off it) -- not something computed here.
      submerged: b.inFluid,
      headingRad: noa.camera.heading,
      dt,
    };

    activeProvider.update(noa, movementInput);

    // voxel-physics-engine puts a body to sleep after ~10 ticks of no
    // applyForce/applyImpulse/setPosition call, and SKIPS integrating a
    // sleeping body's position entirely (checked its tick() source
    // directly) -- writing body.velocity[i] by index, as CoreMovementProvider
    // does, never resets that counter. Without this, a player-controlled
    // body would fall asleep ~1/6 second after spawning and then never
    // move again regardless of velocity, reproduced live (position frozen
    // across every diagnostic sample despite real, input-responsive
    // velocity values). A player's own body should never be allowed to
    // sleep in the first place.
    (b as unknown as { _markActive(): void })._markActive();
  });

  return {
    core,
    noclip,
    getActiveProvider: () => activeProvider,
    setProvider,
    teleportTo,
  };
}

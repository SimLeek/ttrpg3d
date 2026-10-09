// The seam the core/mod-boundary plan is actually about: before this,
// PlayerController.ts hardcoded one movement implementation directly into
// its tick closure, with no way to swap it -- confirmed by reading it in
// full, no plugin registry or injected strategy existed anywhere. Every
// alternate movement mode discussed (noclip/fly here, wall-jump/ledge-grab/
// Phase-9 battle-mode waypoint-teleport later) implements this interface
// instead of being bolted onto the one tick function.
//
// Deliberately NOT in packages/shared: movement/physics is a client-only
// concern (noa/Babylon), and the project's standing "no anti-cheat /
// physics verification" decision means the server never consumes a
// MovementProvider -- putting it in shared would just couple that package
// to noa-engine types for no real cross-package consumer.

import type { Engine } from "noa-engine";

export interface MovementInput {
  /** left(-1)/right(+1), camera-relative */
  inputX: number;
  /** backward(-1)/forward(+1), camera-relative */
  inputY: number;
  jumpHeld: boolean;
  slowHeld: boolean;
  sprintHeld: boolean;
  grounded: boolean;
  submerged: boolean;
  /** camera/body yaw, radians */
  headingRad: number;
  /** seconds */
  dt: number;
}

export interface MovementProvider {
  /**
   * Called once when this provider becomes the active one -- for anything
   * that needs a body-level flag changed while active (e.g. NoclipFlyProvider
   * zeroing gravityMultiplier). Optional; most providers don't need it.
   */
  onActivate?(noa: Engine): void;
  /** Undoes whatever onActivate changed. Optional. */
  onDeactivate?(noa: Engine): void;
  /** Called every tick while this provider is active -- owns moving the player entity for this tick (via the physics body's velocity and/or noa.entities.setPosition). */
  update(noa: Engine, input: MovementInput): void;
  /** Clears internal per-provider state (timers, coyote-time, sprint progress, etc.) -- called on provider switch and on teleport/respawn so stale state doesn't leak across a forced position change. */
  reset(): void;
}

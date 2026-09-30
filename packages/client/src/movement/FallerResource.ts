// Ported from scripts/fall_resource.gd (FallerResource). Gravity itself is
// NOT hand-applied here -- voxel-physics-engine already applies a
// continuous gravity force to the body each physics step (noa's
// `physics.gravity` option), unlike Godot where player_blob_ctrl.gd had to
// add `body.get_gravity() * delta` to velocity itself every frame. This
// resource now only owns the terminal-velocity clamp, applied once per
// tick (same cadence the original applied it at).

export class FallerResource {
  terminalVelocity = 150.0;

  applyTerminalVelocity(velocity: [number, number, number]): void {
    if (this.terminalVelocity > 0 && velocity[1] < -this.terminalVelocity) {
      velocity[1] = -this.terminalVelocity;
    }
  }

  reset(): void {}
}

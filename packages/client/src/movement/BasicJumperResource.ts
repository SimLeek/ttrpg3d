// Ported from scripts/basic_jump_resource.gd (BasicJumperResource).

export class BasicJumperResource {
  jumpVelocity = 12.0;
  coyoteTime = 0.25;
  jumpCutoffFactor = 0.5;

  coyoteTimeLeft = 0.0;
  jumpRequested = false;
  jumpReleaseRequested = false;

  requestJump(): void {
    this.jumpRequested = true;
    this.jumpReleaseRequested = false;
  }

  releaseJump(): void {
    this.jumpReleaseRequested = true;
  }

  updateCoyoteTime(isGrounded: boolean, dt: number): void {
    this.coyoteTimeLeft = isGrounded ? this.coyoteTime : Math.max(0, this.coyoteTimeLeft - dt);
  }

  /** Mutates velocity[1] (and scales the whole vector on jump-cutoff, matching the original). */
  applyJump(velocity: [number, number, number], isGrounded: boolean): void {
    if (this.jumpRequested && (isGrounded || this.coyoteTimeLeft > 0)) {
      velocity[1] = this.jumpVelocity;
      this.coyoteTimeLeft = 0;
      this.jumpRequested = false;
    }
    if (this.jumpReleaseRequested && velocity[1] > 0) {
      velocity[0] *= this.jumpCutoffFactor;
      velocity[1] *= this.jumpCutoffFactor;
      velocity[2] *= this.jumpCutoffFactor;
      this.jumpReleaseRequested = false;
    }
  }

  reset(): void {
    this.coyoteTimeLeft = 0;
    this.jumpRequested = false;
    this.jumpReleaseRequested = false;
  }
}

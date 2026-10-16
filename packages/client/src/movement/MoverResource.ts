// Ported from the old repo's scripts/movement_resource.gd (MoverResource).
// The old game triggered sprint via a double-tap gesture on a movement key
// (InputController.was_double_tapped) -- this port initially used a simpler
// held-Shift sprint instead, deferring double-tap. Reported live once
// Ctrl (slow-walk's own old key) kept colliding with real browser
// shortcuts: double-tap-WASD-to-sprint is now implemented after all
// (PlayerController's updateSprintState), freeing Shift to take over
// slow-walk's binding instead. `sprintHeld` below is just whatever
// PlayerController computes either way -- this resource's own speed/
// stamina logic doesn't know or care which input scheme produced it.

export class MoverResource {
  normalSpeed = 7.5;
  sprintSpeed = 15.0;
  slowSpeed = 3.75;

  sprintTimeLimit = 10.0;
  sprintRecoveryTime = 5.0;

  sprinting = false;
  sprintElapsed = 0.0;
  sprintExhausted = false;
  sprintProgress = 0.0;

  /**
   * @param headingRad camera/body yaw, radians -- direction "forward" (input.y > 0) faces
   * @param inputX left(-1)/right(+1)
   * @param inputY backward(-1)/forward(+1)
   * @param velocity mutated in place, [x, y, z]
   */
  handlePhysicsInput(
    inputX: number,
    inputY: number,
    isSlow: boolean,
    isSprint: boolean,
    velocity: [number, number, number],
    dt: number,
    headingRad: number,
  ): void {
    if (isSprint) this.sprinting = true;

    // transform.basis * Vector3(input.x, 0, input.y), y-axis rotation only
    const sin = Math.sin(headingRad);
    const cos = Math.cos(headingRad);
    const dirX = inputX * cos + inputY * sin;
    const dirZ = -inputX * sin + inputY * cos;
    const len = Math.hypot(dirX, dirZ);

    this._updateSprint(dt);

    const speed = this.sprinting ? this.sprintSpeed : isSlow ? this.slowSpeed : this.normalSpeed;

    if (len > 0.01) {
      velocity[0] += (dirX / len) * speed;
      velocity[2] += (dirZ / len) * speed;
    } else {
      this.sprinting = false;
    }
  }

  private _updateSprint(dt: number): void {
    if (this.sprinting) {
      if (this.sprintExhausted) {
        this.sprinting = false;
      } else {
        this.sprintElapsed += dt;
        if (this.sprintElapsed >= this.sprintTimeLimit) {
          this.sprintElapsed = this.sprintTimeLimit;
          this.sprintExhausted = true;
        }
      }
    }

    if (!this.sprinting) {
      const recoveryRate = this.sprintTimeLimit / this.sprintRecoveryTime;
      this.sprintElapsed -= recoveryRate * dt;
      if (this.sprintElapsed <= 0.0) {
        this.sprintElapsed = 0.0;
        this.sprintExhausted = false;
      }
    }

    this.sprintProgress = this.sprintTimeLimit > 0 ? this.sprintElapsed / this.sprintTimeLimit : 0;
  }

  reset(): void {
    this.sprinting = false;
    this.sprintElapsed = 0.0;
    this.sprintExhausted = false;
  }
}

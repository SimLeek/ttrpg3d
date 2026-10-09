// New work, not a port -- grepping the old repo for swim|underwater|in_water
// across every .gd file turned up zero matches, confirmed directly (see
// the session's plan notes). Deliberate swim *control*, layered on top of
// buoyancy/drag that voxel-physics-engine already applies automatically
// every physics tick once a body's `inFluid`/`ratioInFluid` are set (real,
// confirmed in voxel-physics-engine/src/index.js's applyFluidForces) --
// this resource doesn't reimplement or fight that, it just gives the
// player a way to actively swim up/down and move more slowly through
// water than on land, same one-resource-per-concern shape as
// MoverResource/BasicJumperResource/FallerResource.

export class SwimResource {
  swimSpeed = 4.0;
  swimUpSpeed = 4.0;
  swimDownSpeed = -4.0;

  /**
   * @param headingRad camera/body yaw, radians
   * @param inputX left(-1)/right(+1)
   * @param inputY backward(-1)/forward(+1)
   * @param goal horizontal swim target, summed into goal[0]/goal[2] -- same convention as MoverResource.handlePhysicsInput, blended toward via moveToward in PlayerController
   * @param velocity mutated in place for the vertical axis ONLY, and only while swimUp/swimDown is held -- left untouched otherwise so buoyancy/drag keeps owning vertical velocity naturally
   */
  handlePhysicsInput(
    inputX: number,
    inputY: number,
    swimUp: boolean,
    swimDown: boolean,
    goal: [number, number, number],
    velocity: [number, number, number],
    headingRad: number,
  ): void {
    const sin = Math.sin(headingRad);
    const cos = Math.cos(headingRad);
    const dirX = inputX * cos + inputY * sin;
    const dirZ = -inputX * sin + inputY * cos;
    const len = Math.hypot(dirX, dirZ);

    if (len > 0.01) {
      goal[0] += (dirX / len) * this.swimSpeed;
      goal[2] += (dirZ / len) * this.swimSpeed;
    }

    if (swimUp) velocity[1] = this.swimUpSpeed;
    else if (swimDown) velocity[1] = this.swimDownSpeed;
  }

  reset(): void {}
}

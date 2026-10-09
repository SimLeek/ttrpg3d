// Underwater visual effect -- new work, not a port (no swim/underwater
// code exists anywhere in the old repo, confirmed by grepping every .gd
// file). Uses Babylon's own scene.fog (confirmed completely untouched by
// anything else in this codebase, via reading game.ts/plantMesh.ts/noa's
// rendering.js in full) rather than noa's built-in camera-tint mechanism
// (_camScreen/checkCameraEffect in rendering.js), which is driven by the
// camera's exact eye-voxel rather than player submersion and requires a
// flat `color`+`alpha<1` material -- structurally incompatible with the
// texture+custom-plugin materials blockShaders.ts builds (registerMaterial
// always nulls `color` once a `textureURL`/`renderMaterial` is set).
//
// body.ratioInFluid (0..1, how much of the player's AABB is submerged) is
// real, already-maintained state (voxel-physics-engine's applyFluidForces
// sets it every physics tick, same as body.inFluid) -- not computed here.
// It's declared `@internal` as `_ratioInFluid` in voxel-physics-engine's
// own .d.ts, but the real field voxel-physics-engine actually assigns at
// runtime has no underscore (checked its real source, index.js: `body.
// ratioInFluid = ratioInFluid`) -- the .d.ts is simply stale, hence the
// cast below rather than trusting the declared (internal, wrong) name.

import type { Engine } from "noa-engine";
import * as BABYLON from "@babylonjs/core";

const FOG_COLOR = new BABYLON.Color3(0.05, 0.25, 0.45);
const FOG_DENSITY = 0.08;

export function installUnderwaterEffect(noa: Engine): void {
  const scene = noa.rendering.getScene();
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogColor = FOG_COLOR;
  scene.fogDensity = 0;

  scene.onBeforeRenderObservable.add(() => {
    const body = noa.entities.getPhysicsBody(noa.playerEntity);
    const ratioInFluid = (body as unknown as { ratioInFluid?: number } | null)?.ratioInFluid ?? 0;
    scene.fogDensity = FOG_DENSITY * ratioInFluid;
  });
}

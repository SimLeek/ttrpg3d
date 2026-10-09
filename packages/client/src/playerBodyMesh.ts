// New work, not a port in the file-copy sense, but filling a real gap the
// old game's spring_arm_3d_look.gd implied and this project was missing:
// that script set `player_body.softy.visible = false` once zoomed in close
// enough to be effectively first person -- meaning the body WAS visible
// otherwise, in third person. This project had no local player body mesh
// at all before cameraZoom.ts existed (only remote players get a visible
// box, in net.ts) -- harmless while the camera was always at the eye, but
// a real missing feature once third-person zoom shipped: confirmed live,
// zooming out showed no player model at all (just its shadow).
//
// Reuses noa's own 'mesh' entity component (the same mechanism
// `noa.entities.add()` uses internally for remote players in net.ts, and
// the one PlayerController.ts already casts around for removeComponent)
// attached directly to the EXISTING player entity, rather than a second
// tracked entity with manually-synced position -- noa's own render system
// already re-positions any entity with a 'mesh' component from that same
// entity's position every frame, confirmed directly in noa's
// components/mesh.js.

import type { Engine } from "noa-engine";
import * as BABYLON from "@babylonjs/core";

// camera.currentZoom is 0 exactly at first person (camera.js) -- a small
// nonzero threshold (rather than `> 0`) avoids the body mesh flickering
// in/out at the exact boundary while currentZoom eases through near-zero
// values during a zoom transition.
const FIRST_PERSON_ZOOM_THRESHOLD = 0.5;

export function installPlayerBodyMesh(noa: Engine): void {
  const scene = noa.rendering.getScene();

  // Same box dims/material style as net.ts's remote-player avatars (just a
  // different color, so you can tell your own body apart from a nearby
  // remote player) -- a real model is future work, not scope here.
  const mesh = BABYLON.MeshBuilder.CreateBox("local-player-body", { width: 0.6, height: 1.8, depth: 0.6 }, scene);
  const material = new BABYLON.StandardMaterial("local-player-body-mat", scene);
  material.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9);
  mesh.material = material;
  mesh.isVisible = false; // starts in first person (camera.currentZoom starts at 0)

  // addComponent is inherited from ent-comp's ECS base class -- real at
  // runtime (noa's own entities.js uses it internally the exact same way,
  // `this.addComponent(eid, this.names.mesh, {...})`), but ent-comp ships
  // no .d.ts of its own. Same cast rationale as PlayerController.ts's
  // removeComponent usage.
  const entitiesEcs = noa.entities as unknown as { addComponent(id: number, name: string, state: { mesh: BABYLON.Mesh; offset: [number, number, number] }): void };
  // Offset matches net.ts's remote-player boxes (`[0, 0.9, 0]`) -- centers
  // the 1.8-tall box on the entity's feet-anchored position.
  entitiesEcs.addComponent(noa.playerEntity, noa.entities.names.mesh, { mesh, offset: [0, 0.9, 0] });

  scene.onBeforeRenderObservable.add(() => {
    mesh.isVisible = noa.camera.currentZoom > FIRST_PERSON_ZOOM_THRESHOLD;
  });
}

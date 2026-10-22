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

// The single source of truth for the player body box's dimensions --
// net.ts's remote-player boxes use the SAME numbers (confirmed duplicated
// there before this export existed) and its character-token billboard
// derives its vertical offset from PLAYER_BODY_HEIGHT rather than its own
// separately-chosen fixed number (real request: reference the player's
// actual height instead of a magic offset).
export const PLAYER_BODY_WIDTH = 0.6;
export const PLAYER_BODY_HEIGHT = 1.8;
export const PLAYER_BODY_DEPTH = 0.6;

export interface PlayerBodyMesh {
  mesh: BABYLON.Mesh;
  material: BABYLON.StandardMaterial;
  /** Same visibility threshold this file already uses for its own box -- exposed so a child attachment (net.ts's local character-token billboard, MVP goal items 1-2) can mirror it instead of duplicating the constant. */
  isThirdPerson(): boolean;
}

/**
 * MVP goal item 4 follow-up -- real bug found live: "I tried adjusting
 * the character width/height/depth and that did nothing." Resizes ANY
 * entity's body in place -- scales the SAME mesh object (never
 * replaces it, so a caller's own `mesh.parent = ...`/hit-testing
 * references keep working unchanged), re-anchors the mesh ECS
 * component's vertical offset for the new height, and resizes the REAL
 * collision box via noa's `entities.setEntitySize` (confirmed directly
 * in noa's own source: mutates the live physics body's AABB in place
 * -- a no-op for an entity with no physics component at all, like
 * net.ts's remote players, confirmed via `_updateDerivedPositionData`'s
 * own `if (physDat) ...` guard, so this is equally safe to call for
 * local (physics) and remote (no physics) entities).
 *
 * Real bug found live, second pass ("the character no longer displays
 * ... just a circle shadow and then nothing"): the offset re-anchor
 * used to go through `entities.addComponentAgain`, which -- confirmed
 * directly in noa's own mesh component source -- is "remove the
 * component, then add it," and the mesh component's `onRemove` calls
 * `state.mesh.dispose()`. That disposed the exact mesh object this
 * function was trying to REUSE (scaled, not rebuilt), so every resize
 * silently destroyed the visible box -- collision kept working because
 * `setEntitySize` touches a completely separate (physics) component,
 * unaffected by the mesh component being torn down. Fixed by mutating
 * the mesh component's OWN existing state object in place instead
 * (`entities.getMeshData`, also noa's own, typed API) -- no
 * remove/re-add, no dispose, nothing else touched.
 */
export function resizeEntityBody(noa: Engine, entityId: number, mesh: BABYLON.Mesh, width: number, height: number, depth: number): void {
  mesh.scaling.set(width / PLAYER_BODY_WIDTH, height / PLAYER_BODY_HEIGHT, depth / PLAYER_BODY_DEPTH);
  const meshData = noa.entities.getMeshData(entityId);
  if (meshData) meshData.offset[1] = height / 2;
  noa.entities.setEntitySize(entityId, width, height, depth);
}

/** The local player's own half of resizeEntityBody -- `noa.playerEntity` is noa's single built-in entity id, always the local player's. */
export function resizeLocalPlayerBody(noa: Engine, body: PlayerBodyMesh, width: number, height: number, depth: number): void {
  resizeEntityBody(noa, noa.playerEntity, body.mesh, width, height, depth);
}

export function installPlayerBodyMesh(noa: Engine): PlayerBodyMesh {
  const scene = noa.rendering.getScene();

  // Same box dims/material style as net.ts's remote-player avatars (just a
  // different color, so you can tell your own body apart from a nearby
  // remote player) -- a real model is future work, not scope here.
  const mesh = BABYLON.MeshBuilder.CreateBox("local-player-body", { width: PLAYER_BODY_WIDTH, height: PLAYER_BODY_HEIGHT, depth: PLAYER_BODY_DEPTH }, scene);
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

  return {
    mesh,
    material,
    isThirdPerson: () => noa.camera.currentZoom > FIRST_PERSON_ZOOM_THRESHOLD,
  };
}

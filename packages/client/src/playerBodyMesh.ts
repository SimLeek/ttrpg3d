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

// Real request: "there should be a minimum size so that things still
// print." Moved here (2026-10-24) from net.ts's own local scope so
// docs/BATTLE_SYSTEM.md's measurement-shapes billboards (cube/sphere/
// cone) can use the EXACT SAME function net.ts's own character-token
// billboards already do -- "these should all be using the same
// function to keep the code clean," fed each shape's own axis-aligned
// bounding box instead of a real character's body height.
export const MIN_TOKEN_SCALE = 0.5;
export function tokenScaleFor(bodyHeight: number): number {
  return Math.max(MIN_TOKEN_SCALE, bodyHeight / PLAYER_BODY_HEIGHT);
}

export interface PlayerBodyMesh {
  mesh: BABYLON.Mesh;
  material: BABYLON.StandardMaterial;
  /**
   * MVP goal item 4 follow-up -- real bug found live: "the billboard is
   * now getting squished when character height is shrunk... if you
   * scale it up the billboard should still be right above the box, not
   * way above, and not intersecting." Root cause: the character-token
   * billboard is parented to THIS body mesh so it follows position for
   * free (noa's own render system repositions the body mesh every
   * frame) -- but Babylon's parent-child transform means the child also
   * inherits the parent's SCALE. Once bodies resize non-uniformly
   * (`resizeEntityBody` below), that scale both distorted the
   * billboard's own aspect ratio AND double-counted into its vertical
   * offset (the offset is set in the parent's LOCAL space, which
   * Babylon then multiplies by the parent's current scale again when
   * computing world position).
   *
   * `tokenAnchor` is an invisible `TransformNode`, parented to `mesh`
   * (so it still follows position for free), whose OWN scale is kept
   * as the exact INVERSE of the body mesh's current scale (updated
   * alongside it in `resizeEntityBody`) -- so its effective WORLD
   * scale is always (1,1,1) regardless of the body's current size.
   * Parenting the token to THIS instead of `mesh` directly cancels the
   * distortion at the source: the token's own local position/scaling
   * can then be set in true world-equivalent units again, exactly like
   * before bodies were resizable at all.
   */
  tokenAnchor: BABYLON.TransformNode;
  /** Same visibility threshold this file already uses for its own box -- exposed so a child attachment (net.ts's local character-token billboard, MVP goal items 1-2) can mirror it instead of duplicating the constant. */
  isThirdPerson(): boolean;
}

/** The remote-player half of `PlayerBodyMesh.tokenAnchor`'s own doc -- net.ts creates one of these per remote player's body box, for the exact same reason. */
export function createBodyAnchor(mesh: BABYLON.Mesh): BABYLON.TransformNode {
  const anchor = new BABYLON.TransformNode(`${mesh.name}-token-anchor`, mesh.getScene());
  anchor.parent = mesh;
  return anchor;
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
export function resizeEntityBody(noa: Engine, entityId: number, mesh: BABYLON.Mesh, tokenAnchor: BABYLON.TransformNode, width: number, height: number, depth: number): void {
  const scaleX = width / PLAYER_BODY_WIDTH;
  const scaleY = height / PLAYER_BODY_HEIGHT;
  const scaleZ = depth / PLAYER_BODY_DEPTH;
  mesh.scaling.set(scaleX, scaleY, scaleZ);
  // Exact inverse -- see tokenAnchor's own doc on PlayerBodyMesh for why this has to stay in lockstep with the line above, not just be set once at creation.
  tokenAnchor.scaling.set(1 / scaleX, 1 / scaleY, 1 / scaleZ);
  const meshData = noa.entities.getMeshData(entityId);
  if (meshData) meshData.offset[1] = height / 2;
  noa.entities.setEntitySize(entityId, width, height, depth);
}

/**
 * The local player's own half of resizeEntityBody -- `noa.playerEntity`
 * is noa's single built-in entity id, always the local player's. Also
 * re-anchors the CAMERA's own eye-height follow offset -- real bug
 * found live: "the camera, when zoomed in fully, would be in the
 * character and not above them or at their feet." noa's own Camera
 * constructor sets this offset ONCE at startup (`0.9 * whatever height
 * the player entity had at that moment`, confirmed directly in noa's
 * camera.js) and never revisits it afterward; a later height change
 * (switching characters, a sheet-driven resize) left first-person eye
 * level pinned to the FIRST character's height regardless of the
 * current one. noa's own camera.js doc comment names the exact fix:
 * `noa.ents.getState(noa.camera.cameraTarget, 'followsEntity').
 * offset[1] = 0.9 * myPlayerHeight`.
 */
export function resizeLocalPlayerBody(noa: Engine, body: PlayerBodyMesh, width: number, height: number, depth: number): void {
  resizeEntityBody(noa, noa.playerEntity, body.mesh, body.tokenAnchor, width, height, depth);
  const ents = noa.ents as unknown as { getState(id: number, name: string): { offset: [number, number, number] } | null };
  const followState = ents.getState(noa.camera.cameraTarget, noa.entities.names.followsEntity);
  if (followState) followState.offset[1] = 0.9 * height;
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
  const tokenAnchor = createBodyAnchor(mesh);

  scene.onBeforeRenderObservable.add(() => {
    mesh.isVisible = noa.camera.currentZoom > FIRST_PERSON_ZOOM_THRESHOLD;
  });

  return {
    mesh,
    material,
    tokenAnchor,
    isThirdPerson: () => noa.camera.currentZoom > FIRST_PERSON_ZOOM_THRESHOLD,
  };
}

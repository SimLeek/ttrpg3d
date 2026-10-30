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

/**
 * docs/CHARACTER_SHEET_IMPORT.md, part 2 -- "rather than be a solid
 * opaque box, be basically the glass box voxel we had... colored
 * based on whatever color we chose," real correction: "if you can
 * use wireframe and set line width for the character box instead of
 * the glass texture idea, that would be even better." Plain
 * `material.wireframe = true` can't give a real, settable line width
 * (native WebGL line width is capped at 1px in effectively every
 * browser) -- `CreateGreasedLine` (confirmed present in this repo's
 * own installed @babylonjs/core) is the real mechanism, a thick-line
 * mesh with a genuinely configurable width. Builds the box's 12 edges
 * as one mesh, centered on local origin spanning -width/2..width/2
 * etc. -- the SAME convention `CreateBox` already used here.
 *
 * Real finding, confirmed by direct measurement (see this file's own
 * test): unlike a plain mesh, a GreasedLine mesh's bounding geometry
 * does NOT follow `mesh.scaling` afterward -- so this can't reuse the
 * EXISTING `mesh.scaling.set(...)`-based resize path every other body
 * mesh already uses (resizeEntityBody below). A body-size (or color --
 * GreasedLine's own color lives on a material plugin, not a plain
 * `diffuseColor` property, and this project already has a confirmed,
 * measured precedent for "don't fight a mesh's own material-mutation
 * quirks, just rebuild it" from the LOCAL player's own body color
 * swap in net.ts) change calls this function again at the new
 * dimensions/color and disposes the old mesh, rather than mutating
 * the existing one in place.
 */
export const WIREFRAME_LINE_WIDTH = 0.03;

export function buildWireframeBox(scene: BABYLON.Scene, name: string, width: number, height: number, depth: number, color: BABYLON.Color3, lineWidth: number = WIREFRAME_LINE_WIDTH): BABYLON.Mesh {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const corner = (sx: number, sy: number, sz: number): [number, number, number] => [sx * hw, sy * hh, sz * hd];
  const edges: number[][] = [];
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) edges.push([...corner(-1, sy, sz), ...corner(1, sy, sz)]);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) edges.push([...corner(sx, -1, sz), ...corner(sx, 1, sz)]);
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) edges.push([...corner(sx, sy, -1), ...corner(sx, sy, 1)]);
  }
  return BABYLON.CreateGreasedLine(name, { points: edges }, { width: lineWidth, color }, scene) as BABYLON.Mesh;
}

export interface PlayerBodyMesh {
  mesh: BABYLON.Mesh;
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
 * entity's body, re-anchors the mesh ECS component's vertical offset
 * for the new height, and resizes the REAL collision box via noa's
 * `entities.setEntitySize` (confirmed directly in noa's own source:
 * mutates the live physics body's AABB in place -- a no-op for an
 * entity with no physics component at all, like net.ts's remote
 * players, confirmed via `_updateDerivedPositionData`'s own `if
 * (physDat) ...` guard, so this is equally safe to call for local
 * (physics) and remote (no physics) entities).
 *
 * Real finding, docs/CHARACTER_SHEET_IMPORT.md part 2 (confirmed by
 * direct measurement, see buildWireframeBox's own test): a GreasedLine
 * mesh's bounding geometry does NOT follow `mesh.scaling`, so a resize
 * now REBUILDS the body mesh at the new dimensions/color (via
 * buildWireframeBox) and swaps it into the ECS mesh component's own
 * state object (`entities.getMeshData`, the SAME "mutate the state
 * object in place" API an earlier bug fix here already established --
 * see this function's own git history for why `addComponentAgain`
 * silently destroyed the box instead) rather than the OLD scale-in-
 * place approach a plain CreateBox mesh could get away with. The old
 * mesh is disposed only AFTER `tokenAnchor` is reparented onto the
 * NEW one -- Babylon's own `dispose()` cascades to children by
 * default, and tokenAnchor (plus whatever's attached to it -- the
 * name/bars billboard, the circular token-face billboard) is exactly
 * the kind of child that would otherwise vanish along with the mesh
 * being replaced.
 */
export function resizeEntityBody(noa: Engine, entityId: number, mesh: BABYLON.Mesh, tokenAnchor: BABYLON.TransformNode, width: number, height: number, depth: number, color: BABYLON.Color3): BABYLON.Mesh {
  const scene = noa.rendering.getScene();
  const newMesh = buildWireframeBox(scene, mesh.name, width, height, depth, color);
  tokenAnchor.parent = newMesh; // reparent BEFORE disposing the old mesh -- see this function's own doc on why
  const meshData = noa.entities.getMeshData(entityId);
  if (meshData) {
    meshData.mesh = newMesh;
    meshData.offset[1] = height / 2;
  }
  // Mirrors noa's own mesh component `onAdd` exactly (confirmed
  // directly in its source): passing the entity's current GLOBAL
  // position explicitly, rather than leaving `addMeshToScene` fall
  // back to the fresh mesh's own default (0,0,0) local position --
  // same "local vs. global, don't let it silently double-shift"
  // lesson this project has already paid for twice elsewhere
  // (characterPlacement.ts, measurementShapes.ts's raycastTerrain).
  // `renderSystem` would eventually correct a wrong initial position
  // on its own next frame regardless, but there's no reason to rely
  // on that when the real position is one call away.
  const posDat = noa.ents.getPositionData(entityId);
  noa.rendering.addMeshToScene(newMesh, false, posDat?.position);
  mesh.dispose();
  noa.entities.setEntitySize(entityId, width, height, depth);
  return newMesh;
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
 *
 * Mutates `body.mesh` in place to the REBUILT mesh (resizeEntityBody's
 * own return value) -- callers that read `playerBodyMesh.mesh`
 * afterward (net.ts's own `isVisible` toggling, tokenPicking.ts's
 * hitbox) see the new mesh automatically, same object identity
 * `PlayerBodyMesh` has always promised.
 */
export function resizeLocalPlayerBody(noa: Engine, body: PlayerBodyMesh, width: number, height: number, depth: number, color: BABYLON.Color3): void {
  body.mesh = resizeEntityBody(noa, noa.playerEntity, body.mesh, body.tokenAnchor, width, height, depth, color);
  const ents = noa.ents as unknown as { getState(id: number, name: string): { offset: [number, number, number] } | null };
  const followState = ents.getState(noa.camera.cameraTarget, noa.entities.names.followsEntity);
  if (followState) followState.offset[1] = 0.9 * height;
}

export function installPlayerBodyMesh(noa: Engine): PlayerBodyMesh {
  const scene = noa.rendering.getScene();

  // Same box dims/wireframe style as net.ts's remote-player avatars
  // (just a different starting color, so you can tell your own body
  // apart from a nearby remote player before a real character is
  // picked) -- a real model is future work, not scope here.
  const mesh = buildWireframeBox(scene, "local-player-body", PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT, PLAYER_BODY_DEPTH, new BABYLON.Color3(0.3, 0.5, 0.9));
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
    tokenAnchor,
    isThirdPerson: () => noa.camera.currentZoom > FIRST_PERSON_ZOOM_THRESHOLD,
  };
}

// Drag-and-drop character placement (MVP goal item 4 follow-up): drag a
// character row out of chatPanel.ts's Characters tab and drop it onto
// nearby terrain to place a live, static instance of it in the world
// (WorldState.ts's otherCharacters -- server-validated ownership + max
// distance, see WorldRoom.ts's "placeCharacter" handler; this file only
// ever shows a CLIENT-SIDE preview of that same check, never the real
// gate).
//
// Real request: "add a hover/not-dropped-yet display part of drag and
// drop character placement so that the player can see where they are
// going to drop the character to." A flat disc follows the cursor's
// terrain hit point continuously while dragging (the browser fires
// `dragover` repeatedly, not just once), colored green/red by whether
// the CURRENT point is within range -- shown live, before the player
// ever releases.
//
// Reuses noa's own voxel raycast (`noa.pick`) rather than inventing a
// parallel Babylon-mesh-based terrain pick: confirmed directly in noa's
// own source (`_localPick`, index.js) that it accepts an EXPLICIT
// pos/dir, not just its default crosshair/eye-position ray -- so an
// arbitrary screen point's ray (via Babylon's own `createPickingRay`,
// the same idiom tokenPicking.ts already uses for token picking) can be
// fed straight into it. This gets the exact same block-solidity
// semantics the game's native click-to-build/break already uses, not a
// second, possibly-inconsistent notion of "terrain."

import "@babylonjs/core/Culling/ray.js"; // see tokenPicking.ts's own identical import for why this side-effect import is required, not decorative
import * as BABYLON from "@babylonjs/core";
import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import { MAX_CHARACTER_PLACEMENT_DISTANCE } from "@ttrpg3d/shared";
import { CHARACTER_DRAG_MIME } from "./chatPanel.js";

// Generous margin over the valid-placement radius -- the marker should
// still show up (in its INVALID color) a little past the boundary, not
// just vanish right at it, so the player sees they've gone too far
// rather than wondering where the marker went.
const TERRAIN_PICK_MARGIN = 8;
const PLACEMENT_VALID_COLOR = new BABYLON.Color3(0.2, 0.9, 0.3);
const PLACEMENT_INVALID_COLOR = new BABYLON.Color3(0.9, 0.2, 0.2);

export function installCharacterPlacement(noa: Engine, room: Room): void {
  const scene = noa.rendering.getScene();
  const canvas = noa.container.canvas as HTMLCanvasElement;

  const marker = BABYLON.MeshBuilder.CreateDisc("placement-marker", { radius: 0.4, tessellation: 24 }, scene);
  marker.rotation.x = Math.PI / 2; // lie flat, facing up
  const material = new BABYLON.StandardMaterial("placement-marker-mat", scene);
  material.disableLighting = true;
  material.backFaceCulling = false; // visible from below too (looking up a slope/cliff at the marker)
  material.alpha = 0.55;
  marker.material = material;
  marker.isVisible = false;
  marker.isPickable = false; // never itself a terrain/token pick target
  // Same real bug/fix as every other hand-built mesh in this codebase
  // (playerBodyMesh.ts/net.ts's own tokens): a mesh never routed
  // through noa's own rendering API is invisible to Babylon's octree-
  // filtered render loop (confirmed directly in
  // OctreeSceneComponent.getActiveMeshCandidates).
  noa.rendering.addMeshToScene(marker, false);

  function raycastTerrain(screenPoint: { x: number; y: number }, source: "dragover" | "drop"): [number, number, number] | undefined {
    const camera = scene.activeCamera;
    if (!camera) return undefined;
    const ray = scene.createPickingRay(screenPoint.x, screenPoint.y, BABYLON.Matrix.Identity(), camera);
    const pos = [ray.origin.x, ray.origin.y, ray.origin.z];
    const dir = [ray.direction.x, ray.direction.y, ray.direction.z];
    const hit = noa.pick(pos, dir, MAX_CHARACTER_PLACEMENT_DISTANCE + TERRAIN_PICK_MARGIN);
    // TEMPORARY diagnostic logging -- real bug still unexplained after
    // the drop-coordinate fix: "the green circle matched the position
    // on screen, but the elevation was wrong... placement is also
    // still wrong." Needed real numbers instead of more guessing --
    // remove once the actual cause is confirmed from this output.
    // Everything logged is SNAPSHOTTED (spread into a fresh array/
    // object) -- noa reuses ONE mutable result object across every
    // pick() call, so logging a live reference to it would show
    // whatever the NEXT pick happens to mutate it to, not what this
    // call actually returned.
    console.log(`[characterPlacement:${source}]`, {
      screenPoint,
      cameraGlobalPosition: camera.globalPosition.asArray(),
      rayOrigin: [...pos],
      rayDirection: [...dir],
      worldOriginOffset: [...(noa as unknown as { worldOriginOffset: number[] }).worldOriginOffset],
      hitPosition: hit ? [...(hit.position as number[])] : undefined,
      // The anchor the user asked for -- the CONTROLLED character's
      // own feet position (noa.playerEntity, same entity the camera
      // itself follows), so a placement "next to" it has something
      // concrete to compare hitPosition against.
      controlledCharacterFeetPosition: [...(noa.ents.getPosition(noa.playerEntity) as number[])],
    });
    return hit ? (hit.position as [number, number, number]) : undefined;
  }

  // Client-side PREVIEW of WorldRoom.ts's own re-validation -- always
  // against the focused character's CURRENT live physics position
  // (noa.playerEntity), same reasoning the server checks against the
  // sender's own live x/y/z rather than anything the client claims.
  function withinPlacementRange(point: readonly [number, number, number]): boolean {
    const myPos = noa.ents.getPosition(noa.playerEntity) as number[];
    const dx = point[0] - myPos[0];
    const dy = point[1] - myPos[1];
    const dz = point[2] - myPos[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= MAX_CHARACTER_PLACEMENT_DISTANCE;
  }

  function screenPointFor(event: DragEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // Real bug found live: "placing a character now places them in
  // unexpected locations... super intermittent... the green circle was
  // correct for the most part when it showed up though, it was just
  // the final character placement that was off." Root cause: the
  // HTML5 drag-and-drop spec doesn't guarantee a `drop` event's own
  // clientX/clientY are meaningful -- a documented, long-standing
  // cross-browser quirk (seen in both Firefox and Chrome under
  // various drag-image/retargeting conditions) where `drop` can
  // report stale or zeroed coordinates even though the preceding
  // `dragover` stream was reporting correct ones the whole time --
  // which matches this exactly: the PREVIEW (continuously driven by
  // `dragover`) stayed right, only the one-shot `drop` read sometimes
  // didn't. Fix: `drop` no longer reads its own event's coordinates at
  // all -- it reuses the LAST known-good `dragover` screen point,
  // which is also better UX regardless (wherever the green marker was
  // last shown IS where the character lands, guaranteed WYSIWYG).
  let lastDragoverScreen: { x: number; y: number } | undefined;

  canvas.addEventListener("dragover", (event) => {
    event.preventDefault(); // required for "drop" to fire at all -- standard HTML5 drag-and-drop
    lastDragoverScreen = screenPointFor(event);
    const hit = raycastTerrain(lastDragoverScreen, "dragover");
    if (!hit) {
      marker.isVisible = false;
      return;
    }
    marker.position.set(hit[0], hit[1] + 0.02, hit[2]); // small lift to avoid z-fighting with the terrain surface
    const valid = withinPlacementRange(hit);
    material.diffuseColor = valid ? PLACEMENT_VALID_COLOR : PLACEMENT_INVALID_COLOR;
    material.emissiveColor = material.diffuseColor;
    marker.isVisible = true;
  });
  canvas.addEventListener("dragleave", () => {
    marker.isVisible = false;
  });
  canvas.addEventListener("dragend", () => {
    marker.isVisible = false;
    lastDragoverScreen = undefined;
  });
  canvas.addEventListener("drop", (event) => {
    event.preventDefault();
    marker.isVisible = false;
    const characterId = event.dataTransfer?.getData(CHARACTER_DRAG_MIME);
    if (!characterId || !lastDragoverScreen) return;
    const hit = raycastTerrain(lastDragoverScreen, "drop");
    // No message sent for an invalid drop (no terrain hit, or out of
    // range) -- same "no visible feedback for an invalid action"
    // convention as everywhere else in this codebase; the marker
    // already showed it was invalid before release.
    if (!hit || !withinPlacementRange(hit)) return;
    room.send("placeCharacter", { characterId, x: hit[0], y: hit[1], z: hit[2] });
    lastDragoverScreen = undefined;
  });
}

// Coarse mesh-level "which token is under the cursor" pick -- the first of
// the two-tier pick MVP goal items 1-2 call for (see characterToken.ts's own
// header for the GUI-level fine tier, now geometric rather than
// AdvancedDynamicTexture's own pointer system -- that tier consumes this
// pick's `worldPoint`). No noa built-in exists for this: noa.targetedBlock/
// pick() are strictly voxel-only (confirmed directly in noa-engine's own
// .d.ts, no entity-raycast API). Babylon's own scene.pickWithRay, filtered
// to tracked token hitbox meshes, is the idiomatic alternative -- gives
// "closest hit" for free among multiple nearby tokens.
//
// Side-effect import below is deliberate, not decorative: @babylonjs/core's
// Scene.pickWithRay/createPickingRay are stub no-ops that throw unless
// Culling/ray.js (which patches Scene.prototype as a side effect) actually
// ends up in the bundle -- confirmed directly in scene.js's own source.
// Nothing else in this file references `Ray` by name, so a bundler's
// tree-shaking could plausibly drop that module; this import guarantees
// it's included regardless.
import "@babylonjs/core/Culling/ray.js";
import * as BABYLON from "@babylonjs/core";

export interface TrackedToken {
  /** The OWNING session's id -- for a session's focused character this is also this token's own identity key (see `tokenKey`); for one of that session's placed-but-unfocused `otherCharacters` entries, this is still the owning session (for the `owned` check), even though the entry's OWN identity key is its characterId, not this. */
  sessionId: string;
  characterId: string;
  /**
   * MVP goal item 4 follow-up (multi-character presence): a session's
   * FOCUSED character and each of its `otherCharacters` entries are
   * all separately-tracked tokens now, so `sessionId` alone can no
   * longer uniquely identify "this specific token" the way it used to
   * (one session can have several at once). This is the stable string
   * callers use to track hover/highlight identity across ticks instead
   * -- the owning session's id for a focused-slot token (unchanged
   * behavior), or the characterId for an otherCharacters entry.
   */
  tokenKey: string;
  /**
   * MVP goal item 4 follow-up ("multiple instances of the same
   * character... for monsters"); real correction, 2026-10-23: always a
   * real id now, for a FOCUSED-slot token too (equal to `tokenKey` for
   * a placed/idle one -- kept as its own explicit field rather than
   * relying on callers to infer "is this token's tokenKey actually an
   * instanceId" from context). Callers (net.ts) pass this through to
   * setCharacterVariableValue/setStatusEffects/setCharacterToken/
   * removeCharacterInstance/addToTurnOrder so the server edits the
   * right instance.
   */
  instanceId: string;
  /**
   * Real correction, 2026-10-23: distinguishes a currently-PILOTED
   * token (a player's `currentInstance`) from an idle placed
   * `otherCharacters` one, now that both always have a real
   * `instanceId` -- "Control"/"Delete instance" stay structurally
   * disabled for whichever one is piloted (characterContextMenu.ts),
   * the same "can't delete/take over the character you're (or anyone
   * is) controlling" guarantee the old undefined-instanceId check used
   * to provide.
   */
  isPiloted: boolean;
  /** Whether the LOCAL client owns this token (its own character, or any of theirs once multi-character control exists) -- only an owned token highlights on hover, per the spec. */
  owned: boolean;
  /** The token's own billboard content plane (characterToken.ts's `mesh`) -- the precise pick target the bar geometric hit-test needs (net.ts checks a pick's `pickedMesh` against this before attempting it). */
  planeMesh: BABYLON.AbstractMesh;
  /**
   * Real request: "even if raycasting the billboard is hard, the player
   * [box] should be easier." The thin billboard plane sits well above the
   * body box (head height), so a coarse "which token" pick targeting only
   * the plane made the much bigger, more natural target -- the player's
   * own body -- not register as a hover/highlight/context-menu target at
   * all. These extra meshes (the body box) are additional pick targets for
   * the SAME token, used for highlighting/the context menu; hitting one
   * does NOT enable the precise bar hit-test (that needs `planeMesh`
   * specifically).
   */
  extraHitboxMeshes?: readonly BABYLON.AbstractMesh[];
}

export interface TokenPickResult {
  sessionId: string;
  characterId: string;
  tokenKey: string;
  instanceId: string;
  isPiloted: boolean;
  owned: boolean;
  /** The ray's world-space hit point -- callers (net.ts) transform this into the token's own local space via its mesh's world matrix to do the bar geometric hit-test (characterToken.ts's hitTestLocalPoint). */
  worldPoint: BABYLON.Vector3;
  /** Which exact mesh was hit -- precise bar-click editing only makes sense when this is the token's own `planeMesh`, not one of its coarser `extraHitboxMeshes`. */
  pickedMesh: BABYLON.AbstractMesh;
}

/**
 * Picks the closest tracked token hitbox under a screen point. Real bug
 * found live: this used to ALWAYS raycast from the dead-center of the
 * viewport (the right call for "Default" pointer-locked/crosshair play,
 * matching noa's own voxel-pick convention) -- but in "Select" mode
 * (modePanel.ts), the cursor is a real, freely-moving mouse pointer, and
 * hovering a token anywhere off-center never picked anything. Callers now
 * pass the screen point explicitly (net.ts picks `scene.pointerX/pointerY`
 * -- updated on every real mouse move regardless of noa's own
 * `skipPointerMovePicking`, confirmed directly in Babylon's InputManager
 * source -- while pointer-locked, vs. the viewport center while not).
 * Defaults to the viewport center when omitted, for the crosshair-style
 * callers that don't need the distinction.
 */
export function pickToken(scene: BABYLON.Scene, tokens: readonly TrackedToken[], screenPoint?: { x: number; y: number }): TokenPickResult | undefined {
  if (tokens.length === 0) return undefined;
  const camera = scene.activeCamera;
  if (!camera) return undefined;

  const sx = screenPoint?.x ?? scene.getEngine().getRenderWidth() / 2;
  const sy = screenPoint?.y ?? scene.getEngine().getRenderHeight() / 2;
  const ray = scene.createPickingRay(sx, sy, BABYLON.Matrix.Identity(), camera);
  const meshToToken = new Map<BABYLON.AbstractMesh, TrackedToken>();
  for (const token of tokens) {
    meshToToken.set(token.planeMesh, token);
    for (const extra of token.extraHitboxMeshes ?? []) meshToToken.set(extra, token);
  }

  const hit = scene.pickWithRay(ray, (mesh) => meshToToken.has(mesh));
  if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint) return undefined;

  const token = meshToToken.get(hit.pickedMesh);
  if (!token) return undefined;
  return { sessionId: token.sessionId, characterId: token.characterId, tokenKey: token.tokenKey, instanceId: token.instanceId, isPiloted: token.isPiloted, owned: token.owned, worldPoint: hit.pickedPoint, pickedMesh: hit.pickedMesh };
}

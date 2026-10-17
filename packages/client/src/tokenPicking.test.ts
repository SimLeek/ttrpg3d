import { describe, it, expect } from "vitest";
import * as BABYLON from "@babylonjs/core";
import { pickToken, type TrackedToken } from "./tokenPicking.js";

function makeSceneWithCamera(): BABYLON.Scene {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0, 0, -5), scene);
  camera.setTarget(BABYLON.Vector3.Zero());
  scene.activeCamera = camera;
  return scene;
}

describe("pickToken (coarse mesh-level pick, headless NullEngine)", () => {
  it("returns undefined when there are no tracked tokens", () => {
    const scene = makeSceneWithCamera();
    expect(pickToken(scene, [])).toBeUndefined();
  });

  it("returns undefined when the center-screen ray hits nothing tracked", () => {
    const scene = makeSceneWithCamera();
    const offscreenBox = BABYLON.MeshBuilder.CreateBox("offscreen", {}, scene);
    offscreenBox.position = new BABYLON.Vector3(100, 100, 100);
    const tokens: TrackedToken[] = [{ sessionId: "s1", characterId: "c1", owned: true, planeMesh: offscreenBox }];
    expect(pickToken(scene, tokens)).toBeUndefined();
  });

  it("returns the tracked token whose hitbox is directly in front of the camera", () => {
    const scene = makeSceneWithCamera();
    const box = BABYLON.MeshBuilder.CreateBox("token-hitbox", {}, scene);
    box.position = BABYLON.Vector3.Zero(); // directly ahead of the camera at (0,0,-5) looking at origin
    const tokens: TrackedToken[] = [{ sessionId: "s1", characterId: "c1", owned: true, planeMesh: box }];

    const result = pickToken(scene, tokens);
    expect(result?.sessionId).toBe("s1");
    expect(result?.characterId).toBe("c1");
    expect(result?.owned).toBe(true);
    expect(result?.worldPoint).toBeInstanceOf(BABYLON.Vector3);
    expect(result?.pickedMesh).toBe(box);
  });

  it("also picks a token via one of its extraHitboxMeshes (e.g. the player's body box, a much easier target than the thin billboard plane), reporting which exact mesh was hit", () => {
    const scene = makeSceneWithCamera();
    const plane = BABYLON.MeshBuilder.CreatePlane("billboard", { width: 0.1, height: 0.1 }, scene);
    plane.position = new BABYLON.Vector3(0, 10, 0); // well away from the camera ray -- only the body box is in front of it
    const bodyBox = BABYLON.MeshBuilder.CreateBox("body", {}, scene);
    bodyBox.position = BABYLON.Vector3.Zero();
    const tokens: TrackedToken[] = [{ sessionId: "s1", characterId: "c1", owned: true, planeMesh: plane, extraHitboxMeshes: [bodyBox] }];

    const result = pickToken(scene, tokens);
    expect(result?.sessionId).toBe("s1");
    expect(result?.pickedMesh).toBe(bodyBox);
  });

  it("picks a token that's off-center on screen when given an explicit screen point (Select-mode real-mouse picking, not just the crosshair center)", () => {
    const scene = makeSceneWithCamera();
    const centerBox = BABYLON.MeshBuilder.CreateBox("center-token", {}, scene);
    centerBox.position = BABYLON.Vector3.Zero();
    const offCenterBox = BABYLON.MeshBuilder.CreateBox("off-center-token", {}, scene);
    offCenterBox.position = new BABYLON.Vector3(1, 0, 0);
    const tokens: TrackedToken[] = [
      { sessionId: "center", characterId: "c1", owned: true, planeMesh: centerBox },
      { sessionId: "off-center", characterId: "c2", owned: true, planeMesh: offCenterBox },
    ];

    // Default (no screenPoint) hits the centered box, matching crosshair callers.
    expect(pickToken(scene, tokens)?.sessionId).toBe("center");

    // The off-center box's own real projected screen position -- derived,
    // not guessed, so the test isn't tied to this scene's specific camera
    // FOV/distance. scene.render() first: the camera's view/projection
    // matrices (scene.getTransformMatrix()) are only computed during a
    // render pass, confirmed directly by reproducing a stale/identity
    // projection without this call first.
    scene.render();
    const engine = scene.getEngine();
    const viewport = scene.activeCamera!.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const projected = BABYLON.Vector3.Project(offCenterBox.position, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), viewport);

    const result = pickToken(scene, tokens, { x: projected.x, y: projected.y });
    expect(result?.sessionId).toBe("off-center");
  });

  it("ignores an untracked mesh even if it's in front of the camera, when no tracked token's hitbox is there", () => {
    const scene = makeSceneWithCamera();
    const untracked = BABYLON.MeshBuilder.CreateBox("not-a-token", {}, scene);
    untracked.position = BABYLON.Vector3.Zero();
    expect(pickToken(scene, [])).toBeUndefined();
    void untracked;
  });
});

import { describe, it, expect, vi } from "vitest";
import * as BABYLON from "@babylonjs/core";
import { resizeLocalPlayerBody, createBodyAnchor, buildWireframeBox, PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT, PLAYER_BODY_DEPTH, type PlayerBodyMesh } from "./playerBodyMesh.js";
import type { Engine } from "noa-engine";

// Real bug found live: "the camera, when zoomed in fully, would be in
// the character and not above them or at their feet." noa's own Camera
// sets its first-person eye-height offset ONCE at startup from
// whatever height the player entity had at that moment, and never
// revisits it -- a later character-height change (switching
// characters, a sheet-driven resize) left the camera pinned to the
// FIRST character's height. resizeLocalPlayerBody is the one place
// every such height change already flows through (net.ts calls it
// whenever bodyHeight changes), so the fix lives here: also re-anchor
// the camera's own `followsEntity` offset to match.
function fakeEngine(scene: BABYLON.Scene) {
  const followState = { offset: [0, 0.9 * PLAYER_BODY_HEIGHT, 0] as [number, number, number] };
  const getState = vi.fn((id: number, name: string) => (id === 99 && name === "followsEntity" ? followState : null));
  const meshData: { mesh: BABYLON.Mesh | null; offset: [number, number, number] } = { mesh: null, offset: [0, 0.9, 0] };
  const noa = {
    playerEntity: 1,
    camera: { cameraTarget: 99 },
    ents: { getState, getPositionData: vi.fn(() => ({ position: [0, 0, 0] })) },
    entities: {
      names: { followsEntity: "followsEntity" },
      getMeshData: () => meshData,
      setEntitySize: vi.fn(),
    },
    rendering: { getScene: () => scene, addMeshToScene: vi.fn() },
  } as unknown as Engine;
  return { noa, followState, getState, meshData };
}

function fakeBody(scene: BABYLON.Scene): PlayerBodyMesh {
  const mesh = BABYLON.MeshBuilder.CreateBox("test-body", { width: PLAYER_BODY_WIDTH, height: PLAYER_BODY_HEIGHT, depth: PLAYER_BODY_DEPTH }, scene);
  return { mesh, tokenAnchor: createBodyAnchor(mesh), isThirdPerson: () => true };
}

describe("buildWireframeBox (docs/CHARACTER_SHEET_IMPORT.md, part 2 -- a real settable-width wireframe, not plain material.wireframe)", () => {
  function makeScene(): BABYLON.Scene {
    return new BABYLON.Scene(new BABYLON.NullEngine());
  }

  it("builds a mesh centered on local origin, spanning the full width/height/depth given", () => {
    const scene = makeScene();
    const mesh = buildWireframeBox(scene, "test-box", 2, 4, 6, new BABYLON.Color3(1, 0, 0));
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
    const { minimum, maximum } = mesh.getBoundingInfo().boundingBox;
    expect(minimum.x).toBeCloseTo(-1, 5);
    expect(maximum.x).toBeCloseTo(1, 5);
    expect(minimum.y).toBeCloseTo(-2, 5);
    expect(maximum.y).toBeCloseTo(2, 5);
    expect(minimum.z).toBeCloseTo(-3, 5);
    expect(maximum.z).toBeCloseTo(3, 5);
  });

  it("a size change needs a fresh mesh at the new dimensions -- GreasedLine's own bounding info does NOT follow mesh.scaling the way a plain mesh's does", () => {
    // Real finding, not an assumption: a first attempt at this
    // function assumed scaling a GreasedLine mesh after the fact
    // (mesh.scaling.set(...), the EXISTING resizeEntityBody path every
    // other body mesh already uses) would resize it like any other
    // mesh. Measured directly instead of guessed -- it does NOT: the
    // bounding box stays at the mesh's own ORIGINAL built dimensions
    // regardless of `.scaling`. So a body resize has to call
    // buildWireframeBox again at the new width/height/depth (disposing
    // the old mesh), not scale the existing one.
    const scene = makeScene();
    const mesh = buildWireframeBox(scene, "test-box", 1, 1, 1, new BABYLON.Color3(0, 1, 0));
    mesh.scaling.set(2, 3, 4);
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
    const { minimum, maximum } = mesh.getBoundingInfo().boundingBox;
    expect(maximum.x - minimum.x).toBeCloseTo(1, 5); // NOT 2 -- confirms scaling alone doesn't resize this mesh type
    expect(maximum.y - minimum.y).toBeCloseTo(1, 5); // NOT 3
    expect(maximum.z - minimum.z).toBeCloseTo(1, 5); // NOT 4

    const rebuilt = buildWireframeBox(scene, "test-box-2", 2, 3, 4, new BABYLON.Color3(0, 1, 0));
    rebuilt.computeWorldMatrix(true);
    rebuilt.refreshBoundingInfo();
    const rebuiltBounds = rebuilt.getBoundingInfo().boundingBox;
    expect(rebuiltBounds.maximum.x - rebuiltBounds.minimum.x).toBeCloseTo(2, 5);
    expect(rebuiltBounds.maximum.y - rebuiltBounds.minimum.y).toBeCloseTo(3, 5);
    expect(rebuiltBounds.maximum.z - rebuiltBounds.minimum.z).toBeCloseTo(4, 5);
  });

  it("defaults to WIREFRAME_LINE_WIDTH but accepts an explicit width override", () => {
    const scene = makeScene();
    const mesh = buildWireframeBox(scene, "test-box", 1, 1, 1, new BABYLON.Color3(0, 0, 1), 0.1);
    expect(mesh).toBeTruthy(); // real assertion is just that a custom width doesn't throw/break construction -- the line-width material property isn't introspectable through NullEngine
  });
});

describe("resizeLocalPlayerBody re-anchors the camera's own eye-height offset to the NEW height, not just the body mesh", () => {
  function makeScene(): BABYLON.Scene {
    return new BABYLON.Scene(new BABYLON.NullEngine());
  }
  const color = new BABYLON.Color3(0.3, 0.5, 0.9);

  it("sets the camera's followsEntity offset to 0.9 * the new height, same ratio noa's own Camera constructor uses", () => {
    const scene = makeScene();
    const { noa, followState, getState } = fakeEngine(scene);
    const body = fakeBody(scene);

    resizeLocalPlayerBody(noa, body, 0.6, 3.6, 0.6, color); // a much taller character

    expect(getState).toHaveBeenCalledWith(99, "followsEntity");
    expect(followState.offset[1]).toBe(0.9 * 3.6);
  });

  it("re-anchors again on a SECOND height change (e.g. tabbing to yet another character), not just once at creation", () => {
    const scene = makeScene();
    const { noa, followState } = fakeEngine(scene);
    const body = fakeBody(scene);

    resizeLocalPlayerBody(noa, body, 0.6, 3.6, 0.6, color);
    resizeLocalPlayerBody(noa, body, 0.4, 0.9, 0.4, color); // a short character next

    expect(followState.offset[1]).toBe(0.9 * 0.9);
  });

  it("is a no-op (no crash) if the camera's cameraTarget somehow has no followsEntity state", () => {
    const scene = makeScene();
    const { noa } = fakeEngine(scene);
    (noa.ents as unknown as { getState: ReturnType<typeof vi.fn> }).getState = vi.fn(() => null);
    const body = fakeBody(scene);

    expect(() => resizeLocalPlayerBody(noa, body, 0.6, 1.8, 0.6, color)).not.toThrow();
  });

  it("mutates body.mesh in place to the rebuilt mesh, and reparents tokenAnchor onto it (not left dangling on the disposed old mesh)", () => {
    const scene = makeScene();
    const { noa } = fakeEngine(scene);
    const body = fakeBody(scene);
    const oldMesh = body.mesh;

    resizeLocalPlayerBody(noa, body, 1.2, 2.4, 1.2, color);

    expect(body.mesh).not.toBe(oldMesh);
    expect(oldMesh.isDisposed()).toBe(true);
    expect(body.tokenAnchor.parent).toBe(body.mesh);
  });
});

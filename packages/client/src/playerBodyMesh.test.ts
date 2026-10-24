import { describe, it, expect, vi } from "vitest";
import * as BABYLON from "@babylonjs/core";
import { resizeLocalPlayerBody, createBodyAnchor, PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT, PLAYER_BODY_DEPTH, type PlayerBodyMesh } from "./playerBodyMesh.js";
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
function fakeEngine() {
  const followState = { offset: [0, 0.9 * PLAYER_BODY_HEIGHT, 0] as [number, number, number] };
  const getState = vi.fn((id: number, name: string) => (id === 99 && name === "followsEntity" ? followState : null));
  const noa = {
    playerEntity: 1,
    camera: { cameraTarget: 99 },
    ents: { getState },
    entities: {
      names: { followsEntity: "followsEntity" },
      getMeshData: () => ({ offset: [0, 0.9, 0] as [number, number, number] }),
      setEntitySize: vi.fn(),
    },
  } as unknown as Engine;
  return { noa, followState, getState };
}

function fakeBody(): PlayerBodyMesh {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const mesh = BABYLON.MeshBuilder.CreateBox("test-body", { width: PLAYER_BODY_WIDTH, height: PLAYER_BODY_HEIGHT, depth: PLAYER_BODY_DEPTH }, scene);
  return { mesh, material: new BABYLON.StandardMaterial("test-mat", scene), tokenAnchor: createBodyAnchor(mesh), isThirdPerson: () => true };
}

describe("resizeLocalPlayerBody re-anchors the camera's own eye-height offset to the NEW height, not just the body mesh", () => {
  it("sets the camera's followsEntity offset to 0.9 * the new height, same ratio noa's own Camera constructor uses", () => {
    const { noa, followState, getState } = fakeEngine();
    const body = fakeBody();

    resizeLocalPlayerBody(noa, body, 0.6, 3.6, 0.6); // a much taller character

    expect(getState).toHaveBeenCalledWith(99, "followsEntity");
    expect(followState.offset[1]).toBe(0.9 * 3.6);
  });

  it("re-anchors again on a SECOND height change (e.g. tabbing to yet another character), not just once at creation", () => {
    const { noa, followState } = fakeEngine();
    const body = fakeBody();

    resizeLocalPlayerBody(noa, body, 0.6, 3.6, 0.6);
    resizeLocalPlayerBody(noa, body, 0.4, 0.9, 0.4); // a short character next

    expect(followState.offset[1]).toBe(0.9 * 0.9);
  });

  it("is a no-op (no crash) if the camera's cameraTarget somehow has no followsEntity state", () => {
    const { noa } = fakeEngine();
    (noa.ents as unknown as { getState: ReturnType<typeof vi.fn> }).getState = vi.fn(() => null);
    const body = fakeBody();

    expect(() => resizeLocalPlayerBody(noa, body, 0.6, 1.8, 0.6)).not.toThrow();
  });
});

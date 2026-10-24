import { describe, it, expect, vi } from "vitest";
import * as BABYLON from "@babylonjs/core";
import { installCharacterPlacement } from "./characterPlacement.js";
import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import { CHARACTER_DRAG_MIME } from "./chatPanel.js";

// Two real bugs found live here, both in characterPlacement.ts:
//
// 1. "placing a character now places them in unexpected locations...
//    super intermittent... the green circle was correct for the most
//    part when it showed up though, it was just the final character
//    placement that was off." Root cause: the HTML5 drag-and-drop
//    spec doesn't guarantee a `drop` event's own clientX/clientY are
//    meaningful (a documented cross-browser quirk), unlike the
//    continuous `dragover` stream, which was reliable the whole time
//    -- fixed by having `drop` reuse the LAST `dragover` screen point
//    instead of trusting its own event's coordinates.
//
// 2. Follow-up, confirmed via diagnostic console logging: "the green
//    circle matched the position on screen, but the elevation was
//    wrong... placement is also still wrong." Root cause: `ray.origin`
//    from `scene.createPickingRay` is in noa's LOCAL (origin-shifted)
//    frame, but it was being passed straight into `noa.pick()`, a
//    PUBLIC API that expects a true GLOBAL position and does its own
//    local-shift internally -- a silent DOUBLE shift that only
//    happened to cancel out while `worldOriginOffset` was still
//    [0,0,0] (a fresh session, before walking far from spawn),
//    exactly matching "I was able to have it work for a bit, then
//    after that I couldn't figure out what the offset was." Fixed by
//    converting the local ray origin back to global first.
//
// These tests fake just enough of a DragEvent (plain objects with
// clientX/clientY/dataTransfer/preventDefault -- jsdom's own
// DragEvent doesn't carry a usable dataTransfer anyway) to drive both
// fixes directly, without needing a real browser drag gesture.

function fakeCanvas() {
  const handlers = new Map<string, (event: unknown) => void>();
  return {
    addEventListener: (name: string, cb: (event: unknown) => void) => handlers.set(name, cb),
    getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
    dispatch: (name: string, event: unknown) => handlers.get(name)!(event),
  };
}

function fakeDragEvent(clientX: number, clientY: number, characterId = "char-1") {
  return {
    clientX,
    clientY,
    preventDefault: vi.fn(),
    dataTransfer: { getData: (mime: string) => (mime === CHARACTER_DRAG_MIME ? characterId : "") },
  };
}

function makeSceneWithCamera(): BABYLON.Scene {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0, 10, 0), scene);
  camera.setTarget(new BABYLON.Vector3(0, 0, 1));
  scene.activeCamera = camera;
  return scene;
}

function fakeNoa(canvas: ReturnType<typeof fakeCanvas>, pick: ReturnType<typeof vi.fn>, worldOriginOffset: [number, number, number] = [0, 0, 0]) {
  const scene = makeSceneWithCamera();
  return {
    noa: {
      rendering: { getScene: () => scene, addMeshToScene: vi.fn() },
      container: { canvas },
      pick,
      ents: { getPosition: () => [0, 0, 0] },
      playerEntity: 1,
      worldOriginOffset,
      // The REAL implementation (noa's index.js): global = local + worldOriginOffset.
      localToGlobal: (local: number[], global: number[]) => {
        global[0] = local[0] + worldOriginOffset[0];
        global[1] = local[1] + worldOriginOffset[1];
        global[2] = local[2] + worldOriginOffset[2];
        return global;
      },
    } as unknown as Engine,
    scene,
  };
}

function fakeRoom() {
  return { send: vi.fn() } as unknown as Room & { send: ReturnType<typeof vi.fn> };
}

describe("installCharacterPlacement's drop position (real bug: drop event coordinates are NOT reliable cross-browser)", () => {
  it("drop sends placeCharacter using the LAST dragover's hit position, not whatever (possibly wrong) coordinates the drop event itself carries", () => {
    const pick = vi.fn((pos: number[]) => ({ position: [pos[0], 0, pos[2]] }));
    const canvas = fakeCanvas();
    const { noa } = fakeNoa(canvas, pick);
    const room = fakeRoom();
    installCharacterPlacement(noa, room);

    canvas.dispatch("dragover", fakeDragEvent(50, 50));
    const hitAfterDragover = pick.mock.results[0].value.position;

    // The drop event reports WILDLY different (e.g. zeroed/stale)
    // coordinates -- the exact class of browser quirk this fix
    // guards against.
    canvas.dispatch("drop", fakeDragEvent(0, 0));

    expect(room.send).toHaveBeenCalledWith("placeCharacter", { characterId: "char-1", x: hitAfterDragover[0], y: hitAfterDragover[1], z: hitAfterDragover[2] });
    // Only ONE additional pick call for the drop -- same screen point
    // as dragover's, confirming drop never re-derived its own.
    expect(pick).toHaveBeenCalledTimes(2);
    expect(pick.mock.calls[1][0]).toEqual(pick.mock.calls[0][0]);
  });

  it("drop is a no-op (sends nothing) if dragover never fired first -- no remembered screen point to fall back on", () => {
    const pick = vi.fn((pos: number[]) => ({ position: [pos[0], 0, pos[2]] }));
    const canvas = fakeCanvas();
    const { noa } = fakeNoa(canvas, pick);
    const room = fakeRoom();
    installCharacterPlacement(noa, room);

    canvas.dispatch("drop", fakeDragEvent(50, 50));

    expect(room.send).not.toHaveBeenCalled();
  });

  it("dragend clears the remembered screen point, so a stray drop after it is also a no-op", () => {
    const pick = vi.fn((pos: number[]) => ({ position: [pos[0], 0, pos[2]] }));
    const canvas = fakeCanvas();
    const { noa } = fakeNoa(canvas, pick);
    const room = fakeRoom();
    installCharacterPlacement(noa, room);

    canvas.dispatch("dragover", fakeDragEvent(50, 50));
    canvas.dispatch("dragend", {});
    canvas.dispatch("drop", fakeDragEvent(50, 50));

    expect(room.send).not.toHaveBeenCalled();
  });

  it("drop still refuses an out-of-range hit, same as before -- the remembered point doesn't bypass the distance check", () => {
    const pick = vi.fn((pos: number[], _dir: number[], dist: number) => ({ position: [pos[0] + dist, 0, pos[2]] })); // a deliberately far-away hit
    const canvas = fakeCanvas();
    const { noa } = fakeNoa(canvas, pick);
    const room = fakeRoom();
    installCharacterPlacement(noa, room);

    canvas.dispatch("dragover", fakeDragEvent(50, 50));
    canvas.dispatch("drop", fakeDragEvent(50, 50));

    expect(room.send).not.toHaveBeenCalled();
  });

  it("converts the ray's LOCAL origin to GLOBAL before calling noa.pick(), instead of double-shifting it -- real bug confirmed via diagnostic logging: a non-zero worldOriginOffset threw placement way off, but only once the player had actually walked far enough from spawn to trigger a real origin rebase", () => {
    const pickZeroOffset = vi.fn((pos: number[]) => ({ position: [...pos] }));
    const canvasA = fakeCanvas();
    installCharacterPlacement(fakeNoa(canvasA, pickZeroOffset, [0, 0, 0]).noa, fakeRoom());
    canvasA.dispatch("dragover", fakeDragEvent(50, 50));
    const [posAtZeroOffset] = pickZeroOffset.mock.calls[0];

    const pickRealOffset = vi.fn((pos: number[]) => ({ position: [...pos] }));
    const canvasB = fakeCanvas();
    installCharacterPlacement(fakeNoa(canvasB, pickRealOffset, [37, 14, 43]).noa, fakeRoom());
    canvasB.dispatch("dragover", fakeDragEvent(50, 50));
    const [posAtRealOffset] = pickRealOffset.mock.calls[0];

    // Same screen point, same camera setup -- the ONLY difference
    // between the two runs is worldOriginOffset, so whatever pick()
    // actually received must differ by EXACTLY that offset (added,
    // not left as the raw local ray origin, and not double-applied).
    expect(posAtRealOffset[0]).toBeCloseTo(posAtZeroOffset[0] + 37, 5);
    expect(posAtRealOffset[1]).toBeCloseTo(posAtZeroOffset[1] + 14, 5);
    expect(posAtRealOffset[2]).toBeCloseTo(posAtZeroOffset[2] + 43, 5);
  });
});

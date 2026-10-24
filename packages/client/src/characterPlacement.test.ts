import { describe, it, expect, vi } from "vitest";
import * as BABYLON from "@babylonjs/core";
import { installCharacterPlacement } from "./characterPlacement.js";
import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import { CHARACTER_DRAG_MIME } from "./chatPanel.js";

// Real bug found live: "placing a character now places them in
// unexpected locations... super intermittent... the green circle was
// correct for the most part when it showed up though, it was just the
// final character placement that was off." Root cause: the HTML5
// drag-and-drop spec doesn't guarantee a `drop` event's own
// clientX/clientY are meaningful (a documented cross-browser quirk),
// unlike the continuous `dragover` stream, which was reliable the
// whole time -- the fix makes `drop` reuse the LAST `dragover`
// screen point instead of trusting its own event's coordinates. These
// tests fake just enough of a DragEvent (plain objects with
// clientX/clientY/dataTransfer/preventDefault -- jsdom's own
// DragEvent doesn't carry a usable dataTransfer anyway) to drive that
// logic directly, without needing a real browser drag gesture.

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

function fakeNoa(canvas: ReturnType<typeof fakeCanvas>, pick: ReturnType<typeof vi.fn>) {
  const scene = makeSceneWithCamera();
  return {
    noa: {
      rendering: { getScene: () => scene, addMeshToScene: vi.fn() },
      container: { canvas },
      pick,
      ents: { getPosition: () => [0, 0, 0] },
      playerEntity: 1,
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
});

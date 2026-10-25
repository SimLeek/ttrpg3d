import { describe, it, expect, vi } from "vitest";
import * as BABYLON from "@babylonjs/core";
import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import type { PlayerController } from "./movement/PlayerController.js";
import { requiredPointCount, cycleIndex, snapPoint, movementStep, shapeAabb, frustumFarCorners, installMeasurementShapes } from "./measurementShapes.js";

describe("requiredPointCount", () => {
  it("chain has no fixed count -- keeps growing until Enter finalizes it", () => {
    expect(requiredPointCount("chain")).toBeUndefined();
  });

  it("cube/sphere/cone/beam all require exactly 2 points", () => {
    expect(requiredPointCount("cube")).toBe(2);
    expect(requiredPointCount("sphere")).toBe(2);
    expect(requiredPointCount("cone")).toBe(2);
    expect(requiredPointCount("beam")).toBe(2);
  });
});

describe("cycleIndex (Tab/Shift+Tab point selection, wrapping at either end)", () => {
  it("Tab (direction 1) advances, wrapping from the last point back to the first", () => {
    expect(cycleIndex(3, 2, 1)).toBe(0);
    expect(cycleIndex(3, 0, 1)).toBe(1);
  });

  it("Shift+Tab (direction -1) goes back, wrapping from the first point back to the last", () => {
    expect(cycleIndex(3, 0, -1)).toBe(2);
    expect(cycleIndex(3, 2, -1)).toBe(1);
  });

  it("a single point wraps to itself either direction", () => {
    expect(cycleIndex(1, 0, 1)).toBe(0);
    expect(cycleIndex(1, 0, -1)).toBe(0);
  });
});

describe("snapPoint (center / corner / free)", () => {
  it("center snaps to the voxel's own center, same as the existing waypoint system", () => {
    expect(snapPoint([1.7, 2.1, -0.3], "center")).toEqual([1.5, 2.5, -0.5]);
  });

  it("corner snaps to the voxel's own corner (floor, no recenter)", () => {
    expect(snapPoint([1.7, 2.1, -0.3], "corner")).toEqual([1, 2, -1]);
  });

  it("free passes the raw position through unsnapped", () => {
    expect(snapPoint([1.73, 2.14, -0.37], "free")).toEqual([1.73, 2.14, -0.37]);
  });
});

describe("movementStep (WASD point movement -- real correction, 2026-10-24: the SAME camera-heading formula real character movement already uses, not a separate cardinal-snapping scheme)", () => {
  it("at heading 0, forward/backward/right/left step along +Z/-Z/+X/-X -- matching MoverResource.ts's own dirX/dirZ formula exactly", () => {
    expect(movementStep(0, 1, 0)).toEqual([0, 1]); // forward (W)
    expect(movementStep(0, -1, 0)).toEqual([0, -1]); // backward (S)
    expect(movementStep(1, 0, 0)).toEqual([1, 0]); // right (D)
    expect(movementStep(-1, 0, 0)).toEqual([-1, 0]); // left (A)
  });

  it("rotates with heading, same as a real character turning in place", () => {
    const halfPi = Math.PI / 2;
    expect(movementStep(0, 1, halfPi)).toEqual([1, 0]); // "forward" now points where "right" used to
    expect(movementStep(1, 0, halfPi)).toEqual([0, -1]); // "right" now points where "backward" used to
  });

  it("always rounds to a whole voxel step, never a fractional one", () => {
    const [dx, dz] = movementStep(0, 1, Math.PI / 4); // a 45-degree heading -- fractional components before rounding
    expect(Number.isInteger(dx)).toBe(true);
    expect(Number.isInteger(dz)).toBe(true);
  });
});

function makeSceneWithCamera(): BABYLON.Scene {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0, 10, 0), scene);
  camera.setTarget(new BABYLON.Vector3(0, 0, 1));
  scene.activeCamera = camera;
  return scene;
}

describe("installMeasurementShapes -- real bug hunt, 2026-10-24: \"I don't see any billboards at all on cones or beams\" (headless render check against real Babylon geometry, not a guess)", () => {
  it("a finalized cone and a finalized beam each get a billboard plane that lands in the right LOCAL spot, surviving noa's own origin-shift exactly once -- not corrupted by a shared/aliased position vector", () => {
    const scene = makeSceneWithCamera();
    // A nonzero origin offset -- real bug only showed up "once a
    // session has moved far enough to trigger noa's own origin
    // rebase" (see measurementShapes.ts's own doc on the fix this
    // test guards). At [0,0,0] the bug this test targets cancels
    // itself out and would pass even broken.
    const worldOriginOffset = [1000, 50, -500]; // nonzero on every axis, so a corrupted X/Y/Z each show up distinctly
    let tick: (() => void) | undefined;
    const noa = {
      // Faithfully reproduces noa-engine's OWN rendering.js
      // addMeshToScene (confirmed by reading its real source): it
      // reads the mesh's CURRENT .position (treated as a GLOBAL
      // coordinate this file set), converts it to noa's LOCAL
      // (origin-shifted) frame, and overwrites `.position` IN PLACE
      // via `.fromArray()`. The real bug this test targets only shows
      // up when that in-place mutation lands on a Vector3 object this
      // file was still holding its own reference to (aliased via
      // `mesh.position = someSharedVector`, no clone) and reading
      // again afterward for something else (the billboard's own
      // position) -- a plain no-op stub would never exercise that.
      rendering: {
        getScene: () => scene,
        addMeshToScene: (mesh: BABYLON.AbstractMesh) => {
          const pos = mesh.position.asArray();
          mesh.position.fromArray([pos[0] - worldOriginOffset[0], pos[1] - worldOriginOffset[1], pos[2] - worldOriginOffset[2]]);
        },
      },
      container: { hasPointerLock: false, setPointerLock: () => {} },
      camera: { heading: 0 },
      pick: () => undefined,
      localToGlobal: (local: number[], global: number[]) => {
        global[0] = local[0] + worldOriginOffset[0];
        global[1] = local[1] + worldOriginOffset[1];
        global[2] = local[2] + worldOriginOffset[2];
        return global;
      },
      on: (event: string, cb: () => void) => {
        if (event === "tick") tick = cb;
      },
    } as unknown as Engine;

    const coneShape = {
      shapeId: "cone-1",
      kind: "cone",
      ownerAccountId: "acct1",
      points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }],
      broadcast: true,
      coneDegrees: 60,
      isFrustum: false,
      beamWidth: 1,
    };
    const beamShape = {
      shapeId: "beam-1",
      kind: "beam",
      ownerAccountId: "acct1",
      points: [{ x: 10, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }],
      broadcast: true,
      coneDegrees: 60,
      isFrustum: false,
      beamWidth: 1,
    };
    const room = { state: { measurementShapes: [coneShape, beamShape], ftPerVoxel: 5 }, send: () => {} } as unknown as Room;

    installMeasurementShapes(noa, room, {} as unknown as PlayerController, "acct1");
    tick!(); // drives the same "every finalized shape this session can see" rebuild a real noa tick would

    const labelPlanes = scene.meshes.filter((m) => m.name === "distance-label");
    expect(labelPlanes).toHaveLength(2); // one per finalized shape

    for (const plane of labelPlanes) {
      expect(plane.scaling.x).toBeGreaterThan(0);
      expect(plane.isEnabled()).toBe(true);
      expect(plane.isVisible).toBe(true);
    }

    // Exact expected LOCAL positions, worked out from the same formula
    // measurementShapes.ts itself uses -- this is what actually
    // catches the aliasing bug: under the bug, the shape mesh's own
    // addMeshToScene call corrupts the shared `mid` Vector3 BEFORE the
    // label position is read from it, so X/Z end up shifted by the
    // origin offset TWICE (once legitimately, once from the
    // corruption) while Y (never re-read from `mid`, only from the
    // separately-captured `topY` number) stays correct -- a very
    // specific, lopsided wrongness a plain "is it finite" check can't
    // tell apart from "not shifted at all."
    const conePlane = labelPlanes.find((m) => Math.abs(m.position.x - (0 - worldOriginOffset[0])) < 5)!;
    const coneTopDiameter = 2 * 5 * Math.tan((60 * Math.PI) / 180 / 2); // axisLength=5, coneDegrees=60
    const coneTopY = 5 + coneTopDiameter / 2; // mid.y(2.5) + halfAxis.y(2.5), the wide end sits higher than the point end (0) here
    expect(conePlane.position.x).toBeCloseTo(0 - worldOriginOffset[0], 6);
    expect(conePlane.position.y).toBeCloseTo(coneTopY + 0.3 - worldOriginOffset[1], 6);
    expect(conePlane.position.z).toBeCloseTo(0 - worldOriginOffset[2], 6);

    const beamPlane = labelPlanes.find((m) => m !== conePlane)!;
    const beamTopY = 0.5; // a flat beam: both ends are at y=0, each padded by beamWidth/2 (1/2)
    expect(beamPlane.position.x).toBeCloseTo(12.5 - worldOriginOffset[0], 6); // mid of [10,0,0]/[15,0,0]
    expect(beamPlane.position.y).toBeCloseTo(beamTopY + 0.3 - worldOriginOffset[1], 6);
    expect(beamPlane.position.z).toBeCloseTo(0 - worldOriginOffset[2], 6);
  });
});

describe("onPlacePoint -- real request, 2026-10-24: \"once I click the screen again, it should start making another cube... it would be nice to just click and drag to have it work\"", () => {
  it("clicking again after a cube is already complete starts a brand new cube, instead of a no-op -- no need to re-select the shape button", () => {
    const scene = makeSceneWithCamera();
    let pickCallCount = 0;
    const pick = vi.fn(() => {
      pickCallCount++;
      // A different hit position each call, so the 2nd cube is
      // provably a NEW shape, not the same points reused.
      return { position: [pickCallCount, 0, 0] };
    });
    const noa = {
      rendering: { getScene: () => scene, addMeshToScene: () => {} },
      container: { hasPointerLock: true, setPointerLock: () => {} },
      camera: { heading: 0 },
      pick,
      localToGlobal: (local: number[], global: number[]) => {
        global[0] = local[0];
        global[1] = local[1];
        global[2] = local[2];
        return global;
      },
      on: () => {},
    } as unknown as Engine;
    const room = { state: { measurementShapes: [], ftPerVoxel: 5 }, send: vi.fn() } as unknown as Room & { send: ReturnType<typeof vi.fn> };

    const controller = installMeasurementShapes(noa, room, {} as unknown as PlayerController, "acct1");
    controller.selectKind("cube");

    controller.onPlacePoint(); // starts the drag (point 1 + a duplicate point 2)
    document.dispatchEvent(new Event("mouseup")); // releases the drag -- persists immediately (no Enter/finalize step any more)
    expect(room.send).toHaveBeenCalledTimes(1);
    expect(room.send).toHaveBeenNthCalledWith(1, "placeMeasurementShape", expect.objectContaining({ kind: "cube" }));

    controller.onPlacePoint(); // a second click, with NO call to selectKind in between
    expect(controller.activeKind()).toBe("cube"); // never had to re-pick the shape button
    document.dispatchEvent(new Event("mouseup"));
    expect(room.send).toHaveBeenCalledTimes(2); // a real second shape was started and persisted, not a no-op

    const firstPoints = room.send.mock.calls[0][1].points;
    const secondPoints = room.send.mock.calls[1][1].points;
    expect(secondPoints).not.toEqual(firstPoints); // genuinely a NEW cube, not the same persisted points re-sent
  });
});

describe("frustumFarCorners (real request, 2026-10-24: \"the top and bottom lines of the frustum end square lay fully, so both points, on a plane that has its normal as the up vector... that should always be the case\")", () => {
  function expectLevelTopAndBottom(a: [number, number, number], b: [number, number, number], width: number): void {
    const [tr, tl, bl, br] = frustumFarCorners(a, b, width);
    expect(tr[1]).toBeCloseTo(tl[1], 9); // the "top" line -- both its points share one Y, i.e. lie in a plane whose normal is the up vector
    expect(bl[1]).toBeCloseTo(br[1], 9); // the "bottom" line, same guarantee
    expect(tr[1]).toBeGreaterThanOrEqual(bl[1] - 1e-9); // "top" is never below "bottom" (equal only for a dead-vertical axis -- see the dedicated test below)
  }

  it("holds for axis directions covering the whole sphere -- a deterministic grid in place of \"rotate in roll/pitch/yaw 100 times\"", () => {
    const start: [number, number, number] = [1, 2, 3]; // an arbitrary, non-origin point -- real placements are never at (0,0,0)
    for (let thetaDeg = 0; thetaDeg <= 180; thetaDeg += 15) {
      for (let phiDeg = 0; phiDeg < 360; phiDeg += 30) {
        const theta = (thetaDeg * Math.PI) / 180;
        const phi = (phiDeg * Math.PI) / 180;
        // Literally spherical coordinates, same framing the user used:
        // theta from the up axis, phi around it.
        const axis: [number, number, number] = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
        const end: [number, number, number] = [start[0] + axis[0] * 5, start[1] + axis[1] * 5, start[2] + axis[2] * 5];
        expectLevelTopAndBottom(start, end, 2);
      }
    }
  });

  it("an axis pointing exactly straight up or down has no defined \"yaw\" -- the far square degenerates to a single flat (and still level) plane", () => {
    expectLevelTopAndBottom([0, 0, 0], [0, 5, 0], 2);
    expectLevelTopAndBottom([0, 0, 0], [0, -5, 0], 2);
    const [tr, , bl] = frustumFarCorners([0, 0, 0], [0, 5, 0], 2);
    expect(tr[1]).toBeCloseTo(bl[1], 9); // all 4 corners share the same Y when the axis is vertical
  });

  it("the far square is centered on point b (the wide end), with the given full width -- not an independent position/size of its own", () => {
    const [tr, tl, bl, br] = frustumFarCorners([0, 0, 0], [10, 0, 0], 4);
    const center: [number, number, number] = [(tr[0] + tl[0] + bl[0] + br[0]) / 4, (tr[1] + tl[1] + bl[1] + br[1]) / 4, (tr[2] + tl[2] + bl[2] + br[2]) / 4];
    expect(center[0]).toBeCloseTo(10, 9);
    expect(center[1]).toBeCloseTo(0, 9);
    expect(center[2]).toBeCloseTo(0, 9);
    const topEdgeLength = Math.hypot(tr[0] - tl[0], tr[1] - tl[1], tr[2] - tl[2]);
    expect(topEdgeLength).toBeCloseTo(4, 9);
  });
});

describe("shapeAabb (the shared bounding box every sized billboard's scale is fed from)", () => {
  it("a cube's own AABB is exactly its two corners", () => {
    expect(shapeAabb("cube", [[0, 0, 0], [2, 3, 4]])).toEqual({ width: 2, height: 3, depth: 4 });
  });

  it("a sphere's own AABB is a cube of side 2*radius", () => {
    expect(shapeAabb("sphere", [[0, 0, 0], [3, 0, 0]])).toEqual({ width: 6, height: 6, depth: 6 });
  });

  it("a beam's own AABB pads the axis segment by its own width", () => {
    const aabb = shapeAabb("beam", [[0, 0, 0], [10, 0, 0]], 2); // beamWidth = 2
    expect(aabb.width).toBe(10 + 2); // axis length + radius*2
    expect(aabb.height).toBe(2); // 0 axis extent + radius*2
    expect(aabb.depth).toBe(2);
  });

  it("a cone's own AABB widens with a larger degrees setting", () => {
    const narrow = shapeAabb("cone", [[0, 0, 0], [0, 10, 0]], 30);
    const wide = shapeAabb("cone", [[0, 0, 0], [0, 10, 0]], 90);
    expect(wide.width).toBeGreaterThan(narrow.width);
  });
});

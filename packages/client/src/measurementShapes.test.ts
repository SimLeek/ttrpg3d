import { describe, it, expect } from "vitest";
import { requiredPointCount, cycleIndex, snapPoint, movementStep, shapeAabb } from "./measurementShapes.js";

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

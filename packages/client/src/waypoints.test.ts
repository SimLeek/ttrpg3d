import { describe, it, expect } from "vitest";
import { snapToVoxelGridCenter, isStandingOnWaypoint } from "./waypoints.js";

describe("snapToVoxelGridCenter", () => {
  it("snaps to the CENTER of the containing voxel cell, not its corner", () => {
    expect(snapToVoxelGridCenter([1.2, 2.9, -0.1])).toEqual([1.5, 2.5, -0.5]);
  });

  it("is idempotent -- snapping an already-snapped position leaves it unchanged", () => {
    const once = snapToVoxelGridCenter([3.7, 8.1, -2.4]);
    expect(snapToVoxelGridCenter(once)).toEqual(once);
  });

  it("handles exact integer coordinates (the cell boundary) consistently", () => {
    expect(snapToVoxelGridCenter([2, 2, 2])).toEqual([2.5, 2.5, 2.5]);
  });
});

describe("isStandingOnWaypoint", () => {
  it("is true anywhere inside the SAME voxel cell as the waypoint, not just at its exact center", () => {
    const waypoint: [number, number, number] = [5.5, 1.5, 5.5];
    expect(isStandingOnWaypoint([5.5, 1.5, 5.5], waypoint)).toBe(true);
    expect(isStandingOnWaypoint([5.01, 1.99, 5.9], waypoint)).toBe(true);
  });

  it("is false once the player has stepped into a different cell -- real request: \"walk back to the last waypoint first\"", () => {
    const waypoint: [number, number, number] = [5.5, 1.5, 5.5];
    expect(isStandingOnWaypoint([6.01, 1.5, 5.5], waypoint)).toBe(false);
    expect(isStandingOnWaypoint([5.5, 1.5, 4.99], waypoint)).toBe(false);
  });
});

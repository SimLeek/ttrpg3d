import { describe, it, expect } from "vitest";
import { blockAt, AIR, GROUND, MARKER, AREA_SIZE } from "./testArea.js";

describe("testArea generator: infinite plane beyond the hand-built area", () => {
  it("is solid ground far past the hand-built area, in every direction", () => {
    expect(blockAt(1000, 0, 1000)).toBe(GROUND);
    expect(blockAt(-500, 2, -500)).toBe(GROUND);
    expect(blockAt(AREA_SIZE + 200, 1, 50)).toBe(GROUND);
  });

  it("is air well above the plane, far from the hand-built area", () => {
    expect(blockAt(1000, 20, 1000)).toBe(AIR);
  });

  it("places a grid pillar every 16 blocks on both axes, far from spawn", () => {
    // Grid spacing is 16; 1600 and 1616 are both multiples of 16.
    expect(blockAt(1600, 3, 1600)).toBe(MARKER);
    expect(blockAt(1616, 3, 1600)).toBe(MARKER);
    // One block off the grid in either axis should NOT be a pillar.
    expect(blockAt(1601, 3, 1600)).toBe(AIR);
    expect(blockAt(1600, 3, 1601)).toBe(AIR);
  });

  it("negative coordinates hit the grid correctly too (JS %% is not true modulo)", () => {
    expect(blockAt(-16, 3, -16)).toBe(MARKER);
    expect(blockAt(-16, 3, 0)).toBe(MARKER);
  });
});

import { describe, it, expect } from "vitest";
import { blockAt, AIR, GROUND, MARKER, AREA_SIZE } from "./testArea.js";

describe("testArea generator: infinite plane beyond the hand-built area", () => {
  it("is solid ground far past the hand-built area, in every direction", () => {
    expect(blockAt("w1", 1000, 0, 1000)).toBe(GROUND);
    expect(blockAt("w1", -500, 2, -500)).toBe(GROUND);
    expect(blockAt("w1", AREA_SIZE + 200, 1, 50)).toBe(GROUND);
  });

  it("is air well above the plane, far from the hand-built area", () => {
    expect(blockAt("w1", 1000, 20, 1000)).toBe(AIR);
  });

  it("places a grid pillar every 16 blocks on both axes, far from spawn", () => {
    // Grid spacing is 16; 1600 and 1616 are both multiples of 16.
    expect(blockAt("w1", 1600, 3, 1600)).toBe(MARKER);
    expect(blockAt("w1", 1616, 3, 1600)).toBe(MARKER);
    // One block off the grid in either axis should NOT be a pillar.
    expect(blockAt("w1", 1601, 3, 1600)).toBe(AIR);
    expect(blockAt("w1", 1600, 3, 1601)).toBe(AIR);
  });

  it("negative coordinates hit the grid correctly too (JS %% is not true modulo)", () => {
    expect(blockAt("w1", -16, 3, -16)).toBe(MARKER);
    expect(blockAt("w1", -16, 3, 0)).toBe(MARKER);
  });
});

describe("testArea generator: per-world variant region", () => {
  // Region is x in [36,41), z in [20,25), one block above the floor (y=3).
  it("different world ids produce different patterns in the variant region", () => {
    // Sample the whole 5x5 footprint at y=3 for a handful of world ids and
    // confirm not every world produces the identical pattern -- this is
    // the actual bug being fixed ("impossible to tell which world I'm in").
    const sample = (worldId: string) => {
      const cells: boolean[] = [];
      for (let x = 36; x < 41; x++) {
        for (let z = 20; z < 25; z++) {
          cells.push(blockAt(worldId, x, 3, z) === MARKER);
        }
      }
      return cells.join("");
    };

    const patterns = new Set(["world-a", "world-b", "world-c", "world-d", "world-e"].map(sample));
    expect(patterns.size).toBeGreaterThan(1);
  });

  it("the same world id always produces the same pattern (deterministic)", () => {
    const sampleOnce = (worldId: string) => blockAt(worldId, 38, 3, 22);
    const first = sampleOnce("consistent-world");
    for (let i = 0; i < 5; i++) {
      expect(sampleOnce("consistent-world")).toBe(first);
    }
  });

  it("stays within the floor's solid region below y=FLOOR_TOP regardless of world id", () => {
    // Below the floor top, the variant region shouldn't override normal ground.
    expect(blockAt("world-a", 38, 1, 22)).toBe(GROUND);
    expect(blockAt("world-b", 38, 1, 22)).toBe(GROUND);
  });

  it("does not affect blocks outside the 5x5 variant footprint", () => {
    expect(blockAt("world-a", 35, 3, 22)).toBe(AIR); // one block west of the region
    expect(blockAt("world-a", 41, 3, 22)).toBe(AIR); // one block east of the region
  });
});

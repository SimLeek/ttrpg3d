import { describe, it, expect } from "vitest";
import { AIR, DIRT } from "@ttrpg3d/shared";
import { blockAt, GROUND, MARKER, AREA_SIZE } from "./testArea.js";
import { blockAt as hillyBlockAt } from "./hillyTerrain.js";

describe("testArea generator: delegates to real hilly terrain beyond the hand-built area", () => {
  // hillyTerrain.ts has its own dedicated test suite (hillyTerrain.test.ts)
  // for the generator's actual properties (determinism, height bounds,
  // per-world variation, trees, ...) -- these tests only check that
  // testArea.ts's blockAt() correctly delegates to it outside the
  // hand-built area's bounds, and still handles the hand-built area itself
  // inside them. GROUND is re-exported from testArea.ts as an alias for
  // the shared DIRT id (same old value, see testArea.ts's header comment).
  it("re-exports GROUND as an alias for the shared DIRT id", () => {
    expect(GROUND).toBe(DIRT);
  });

  it("matches hillyTerrain.ts's own output exactly outside the hand-built area", () => {
    const coords: Array<[number, number, number]> = [
      [1000, 0, 1000],
      [-500, 2, -500],
      [AREA_SIZE + 200, 1, 50],
      [1000, 60, 1000],
    ];
    for (const [x, y, z] of coords) {
      expect(blockAt("w1", x, y, z)).toBe(hillyBlockAt("w1", x, y, z));
    }
  });

  it("still handles the hand-built area itself (inside AREA_SIZE bounds), not delegated", () => {
    // y=1 inside the hand-built area's open floor is always DIRT,
    // regardless of what the hilly generator would put at that same XZ --
    // confirms the boundary check actually gates which generator runs.
    expect(blockAt("w1", 8, 1, 24)).toBe(DIRT); // the spawn column
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

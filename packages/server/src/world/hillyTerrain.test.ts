import { describe, it, expect } from "vitest";
import { AIR, DIRT, GRASS, MUDSTONE, WATER_FULL, LOG, LEAVES } from "@ttrpg3d/shared";
import { blockAt, getHeightAt, stampTrees } from "./hillyTerrain.js";

const CHUNK_SIZE = 32;
const noArea = () => false; // "inside hand-built area" predicate that's always false, for tree tests that don't care about that boundary

describe("hillyTerrain: height", () => {
  it("is deterministic -- same worldId and position always gives the same height", () => {
    const h1 = getHeightAt("world-a", 123, 456);
    const h2 = getHeightAt("world-a", 123, 456);
    expect(h1).toBe(h2);
  });

  it("stays within the configured height bounds", () => {
    for (let i = 0; i < 50; i++) {
      const h = getHeightAt("world-a", i * 37, i * 53);
      expect(h).toBeGreaterThanOrEqual(-32);
      expect(h).toBeLessThanOrEqual(96);
    }
  });

  it("different world ids produce different terrain (not every world looks the same)", () => {
    const heights = ["world-a", "world-b", "world-c"].map((w) => getHeightAt(w, 100, 100));
    expect(new Set(heights).size).toBeGreaterThan(1);
  });
});

describe("hillyTerrain: blockAt", () => {
  it("is deterministic", () => {
    const a = blockAt("world-a", 10, 5, 10);
    const b = blockAt("world-a", 10, 5, 10);
    expect(a).toBe(b);
  });

  it("is solid (dirt or mudstone) well below the surface height, air well above it", () => {
    const x = 10,
      z = 10;
    const worldId = "world-a";
    const surface = getHeightAt(worldId, x, z);
    const deep = blockAt(worldId, x, surface - 20, z);
    expect([DIRT, MUDSTONE]).toContain(deep);
    const sky = blockAt(worldId, x, surface + 50, z);
    expect(sky).toBe(AIR);
  });

  it("caps the surface column with grass when above sea level", () => {
    // Scan a handful of columns and confirm at least one surface voxel is
    // grass -- not every column (sea-level/underwater columns don't get
    // a grass cap), but somewhere in a reasonable sample.
    const worldId = "world-grass-check";
    let sawGrass = false;
    for (let x = 0; x < 200; x += 10) {
      for (let z = 0; z < 200; z += 10) {
        const surface = getHeightAt(worldId, x, z);
        if (surface >= 0 && blockAt(worldId, x, surface, z) === GRASS) sawGrass = true;
      }
    }
    expect(sawGrass).toBe(true);
  });

  it("produces at least some water somewhere below sea level across a wide sample", () => {
    const worldId = "world-water-check";
    let sawWater = false;
    for (let x = 0; x < 300; x += 15) {
      for (let z = 0; z < 300; z += 15) {
        if (blockAt(worldId, x, -5, z) === WATER_FULL) sawWater = true;
      }
    }
    expect(sawWater).toBe(true);
  });

  it("never places grass/foliage directly above a cave-carved (non-solid) surface -- no floating, unsupported crust", () => {
    // Regression test: blockAt used to return GRASS/TALL_GRASS/DEAD_SHRUB
    // unconditionally at a column's surfaceHeight/+1, bypassing cave
    // carving entirely -- a cave intersecting the surface left a solid
    // grass/dirt crust floating over open cave air with visible holes
    // around it (confirmed live via screenshot). Sample widely across a
    // world known to actually generate caves near the surface and assert
    // the invariant holds everywhere: if the surface voxel isn't solid
    // ground, nothing foliage-like sits directly above it.
    const worldId = "world-cave-surface-check";
    let sawCarvedSurface = false;
    for (let x = 0; x < 400; x += 4) {
      for (let z = 0; z < 400; z += 4) {
        const surface = getHeightAt(worldId, x, z);
        if (surface < 0) continue;
        const surfaceVoxel = blockAt(worldId, x, surface, z);
        const aboveVoxel = blockAt(worldId, x, surface + 1, z);
        if (surfaceVoxel !== GRASS) {
          sawCarvedSurface = true;
          expect([AIR]).toContain(aboveVoxel); // no TALL_GRASS/DEAD_SHRUB floating over a hollowed-out surface
        }
      }
    }
    expect(sawCarvedSurface).toBe(true); // sanity: the sample actually exercised a carved surface at least once
  });
});

describe("hillyTerrain: stampTrees", () => {
  it("is deterministic -- stamping the same chunk twice produces the same voxel array", () => {
    const worldId = "world-tree-det";
    const make = () => {
      const voxels = new Uint8Array(CHUNK_SIZE ** 3);
      stampTrees(voxels, CHUNK_SIZE, 0, 0, 0, worldId, noArea);
      return voxels;
    };
    expect(make()).toEqual(make());
  });

  it("places at least one LOG and LEAVES voxel somewhere across a wide sample of chunks", () => {
    const worldId = "world-tree-presence";
    let sawLog = false;
    let sawLeaves = false;
    for (let cx = 0; cx < 10 && !(sawLog && sawLeaves); cx++) {
      for (let cz = 0; cz < 10 && !(sawLog && sawLeaves); cz++) {
        const voxels = new Uint8Array(CHUNK_SIZE ** 3);
        stampTrees(voxels, CHUNK_SIZE, cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE, worldId, noArea);
        if (voxels.includes(LOG)) sawLog = true;
        if (voxels.includes(LEAVES)) sawLeaves = true;
      }
    }
    expect(sawLog).toBe(true);
    expect(sawLeaves).toBe(true);
  });

  it("never places a tree when the hand-built-area predicate rejects every anchor", () => {
    const worldId = "world-tree-presence"; // same world as above, which DOES place trees when allowed
    const voxels = new Uint8Array(CHUNK_SIZE ** 3);
    stampTrees(voxels, CHUNK_SIZE, 0, 0, 0, worldId, () => true); // "everything is inside the hand-built area"
    expect(voxels.includes(LOG)).toBe(false);
    expect(voxels.includes(LEAVES)).toBe(false);
  });
});

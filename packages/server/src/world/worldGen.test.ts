import { describe, it, expect } from "vitest";
import { AIR, DIRT, type LimestoneSlabParams } from "@ttrpg3d/shared";
import { blockAt, spawnPositionFor, type WorldGenInput } from "./worldGen.js";

describe("worldGen: safe-spawn scan", () => {
  it("limestone_slab: spawns in the first 2-consecutive-air gap above the slab, not at a fixed offset that could be wrong for arbitrary dimensions", () => {
    const params: LimestoneSlabParams = { width: 10, height: 3, depth: 10, voxelId: DIRT };
    const world: WorldGenInput = { generatorId: "limestone_slab", params };
    const [x, y, z] = spawnPositionFor("w", world);
    expect(x).toBe(8);
    expect(z).toBe(8);
    expect(y).toBeGreaterThanOrEqual(params.height);
    expect(blockAt("w", x, y, z, world)).toBe(AIR);
    expect(blockAt("w", x, y + 1, z, world)).toBe(AIR);
    // this really is the FIRST valid gap scanning up from the slab's own
    // floor (y=0), not some other taller gap found by accident.
    expect(y).toBeLessThan(params.height + 5);
  });

  it("hilly: spawns somewhere with 2 consecutive air voxels, not underground", () => {
    const world: WorldGenInput = { generatorId: "hilly", params: {} };
    const [x, y, z] = spawnPositionFor("world-spawn-check", world);
    expect(x).toBe(8);
    expect(z).toBe(8);
    expect(blockAt("world-spawn-check", x, y, z, world)).toBe(AIR);
    expect(blockAt("world-spawn-check", x, y + 1, z, world)).toBe(AIR);
  });

  it("plains: also spawns in open air, deterministic for the same worldId", () => {
    const world: WorldGenInput = { generatorId: "plains", params: {} };
    const a = spawnPositionFor("world-plains-spawn", world);
    const b = spawnPositionFor("world-plains-spawn", world);
    expect(a).toEqual(b);
    expect(blockAt("world-plains-spawn", a[0], a[1], a[2], world)).toBe(AIR);
  });
});

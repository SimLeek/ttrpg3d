import { describe, it, expect } from "vitest";
import { WORLD_GENERATORS, DEFAULT_GENERATOR_ID, getGeneratorDef } from "./worldGenerators.js";

describe("worldGenerators", () => {
  it("DEFAULT_GENERATOR_ID is a real, known catalog entry -- catches a future typo/rename silently breaking every new world's starter generator", () => {
    expect(WORLD_GENERATORS.some((g) => g.id === DEFAULT_GENERATOR_ID)).toBe(true);
  });

  it("getGeneratorDef resolves the default id without throwing", () => {
    expect(() => getGeneratorDef(DEFAULT_GENERATOR_ID)).not.toThrow();
  });

  it("getGeneratorDef throws for an unknown id", () => {
    // @ts-expect-error -- deliberately invalid id, exercising the runtime guard
    expect(() => getGeneratorDef("not-a-real-generator")).toThrow();
  });
});

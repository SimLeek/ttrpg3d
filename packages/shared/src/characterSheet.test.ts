import { describe, it, expect } from "vitest";
import { computeMissingModDependencies, RESERVED_BODY_SIZE_VARIABLES, findLibraryCalls, findVariableRefs } from "./characterSheet.js";

describe("computeMissingModDependencies", () => {
  it("returns an empty array when every required mod is available", () => {
    expect(computeMissingModDependencies(["default-character-sheet"], ["default-character-sheet", "other-mod"])).toEqual([]);
  });

  it("returns the missing ids, preserving required order, when some are unavailable", () => {
    expect(computeMissingModDependencies(["default-character-sheet", "stats-library"], ["default-character-sheet"])).toEqual(["stats-library"]);
  });

  it("includes the template mod itself as missing if it isn't available (not just its declared dependencies)", () => {
    expect(computeMissingModDependencies(["default-character-sheet"], [])).toEqual(["default-character-sheet"]);
  });

  it("returns an empty array for an empty requirement list regardless of what's available", () => {
    expect(computeMissingModDependencies([], ["default-character-sheet"])).toEqual([]);
  });
});

describe("RESERVED_BODY_SIZE_VARIABLES", () => {
  it("defines exactly the three always-present body-size variables, matching playerBodyMesh.ts's current fixed constants", () => {
    const ids = RESERVED_BODY_SIZE_VARIABLES.map((v) => v.id);
    expect(ids).toEqual(["bodyWidth", "bodyHeight", "bodyDepth"]);
    expect(RESERVED_BODY_SIZE_VARIABLES.every((v) => v.type === "number")).toBe(true);
  });
});

describe("findLibraryCalls (MVP goal item 4, round 2 -- mods as libraries, not just templates)", () => {
  it("finds a single call with no args", () => {
    const segments = findLibraryCalls("Modifier: {{default-character-sheet.modifier}}");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ modId: "default-character-sheet", functionName: "modifier", args: [] });
  });

  it("finds a call with args, splitting on commas and trimming whitespace", () => {
    const segments = findLibraryCalls("{{stats-lib.modifier( str , 2 )}}");
    expect(segments[0].args).toEqual(["str", "2"]);
  });

  it("finds a call with empty parens as a zero-arg call", () => {
    expect(findLibraryCalls("{{mod.fn()}}")[0].args).toEqual([]);
  });

  it("finds multiple segments in order, each with its own start/end", () => {
    const segments = findLibraryCalls("STR mod {{m.modifier(str)}}, DEX mod {{m.modifier(dex)}}");
    expect(segments.map((s) => s.args)).toEqual([["str"], ["dex"]]);
    expect(segments[1].start).toBeGreaterThan(segments[0].end);
  });

  it("returns an empty array for text with no calls, including plain [[dice]] notation (distinct bracket syntax)", () => {
    expect(findLibraryCalls("just prose, and [[2d6+3]] dice, no calls here")).toEqual([]);
  });

  it("defaults display to 'button' when no suffix is written; an explicit :box/:button suffix is honored (round 4)", () => {
    expect(findLibraryCalls("{{m.fn()}}")[0].display).toBe("button");
    expect(findLibraryCalls("{{m.fn():box}}")[0].display).toBe("box");
    expect(findLibraryCalls("{{m.fn():button}}")[0].display).toBe("button");
    expect(findLibraryCalls("{{m.fn(1,2):box}}")[0].args).toEqual(["1", "2"]);
  });
});

describe("findVariableRefs (MVP goal item 4, round 4 -- inline-in-markdown variable widgets)", () => {
  it("finds a single plain reference, defaulting to 'box' display", () => {
    const segments = findVariableRefs("HP: {hp}");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ variableId: "hp", display: "box" });
  });

  it("honors an explicit :button suffix", () => {
    expect(findVariableRefs("{hp:button}")[0].display).toBe("button");
  });

  it("finds multiple segments in order, each with its own start/end", () => {
    const segments = findVariableRefs("HP: {hp}, MP: {mp}");
    expect(segments.map((s) => s.variableId)).toEqual(["hp", "mp"]);
    expect(segments[1].start).toBeGreaterThan(segments[0].end);
  });

  it("does NOT mis-fire on a {{modId.fn(args)}} library call's own braces, even when mixed in the same text", () => {
    const segments = findVariableRefs("Strength: {str}, modifier: {{default.modifier(str)}}");
    expect(segments).toHaveLength(1);
    expect(segments[0].variableId).toBe("str");
  });

  it("does NOT mis-fire on a malformed {{id}} (missing the required .functionName) that would otherwise look like a nested single-brace ref", () => {
    expect(findVariableRefs("{{hp}}")).toEqual([]);
  });

  it("does NOT mis-fire on [[dice notation]] (distinct bracket syntax, reserved for the upcoming dice-in-sheets work)", () => {
    expect(findVariableRefs("Attack: [[1d20+3]] to hit, {str} for reference")).toHaveLength(1);
  });

  it("returns an empty array for text with no references", () => {
    expect(findVariableRefs("just prose, no references here")).toEqual([]);
  });
});

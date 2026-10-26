import { describe, it, expect } from "vitest";
import { computeMissingModDependencies, RESERVED_BODY_SIZE_VARIABLES, findLibraryCalls, findVariableRefs, findExpressionSegments, substituteVariableRefs, evaluateCharacterSheetExpression, xOfYMaxKey, resolveCharacterBars, type CharacterSheetTemplate } from "./characterSheet.js";

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

  it("round 5: .x/.y component selector, with and without a :style suffix", () => {
    expect(findVariableRefs("{hp}")[0].component).toBeUndefined();
    expect(findVariableRefs("{hp.x}")[0].component).toBe("x");
    expect(findVariableRefs("{hp.y}")[0].component).toBe("y");
    expect(findVariableRefs("{hp.y:button}")[0]).toMatchObject({ component: "y", display: "button" });
  });

  it("round 5: a real {{modId.x}}/{{modId.x()}} library call (function literally named x or y) never mis-fires as a variable ref's .x/.y component", () => {
    expect(findVariableRefs("{{default.x}}")).toEqual([]);
    expect(findVariableRefs("{{default.x()}}")).toEqual([]);
    expect(findVariableRefs("{{default.y(1)}}")).toEqual([]);
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

describe("findExpressionSegments (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- a real formula imported verbatim, not a mod function call)", () => {
  it("finds a single plain-arithmetic expression, defaulting to 'box' display", () => {
    const segments = findExpressionSegments("HP: {{20 + (10 * {toughness}) + {hpBonus}}}");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ expression: "20 + (10 * {toughness}) + {hpBonus}", display: "box" });
  });

  it("supports an explicit :box/:button display suffix, same convention the other two {{}}/{} kinds already use", () => {
    expect(findExpressionSegments("{{2+2:button}}")[0].display).toBe("button");
    expect(findExpressionSegments("{{2+2:box}}")[0].display).toBe("box");
  });

  it("does NOT mis-fire on a real {{modId.fn(args)}} library call -- the two share the same delimiter but never collide", () => {
    expect(findExpressionSegments("{{default.modifier(str)}}")).toEqual([]);
  });

  it("finds an expression and a library call side by side in the same text, each exactly once", () => {
    const text = "Modifier: {{default.modifier(str)}} HP: {{20 + {toughness}}}";
    const expressionSegments = findExpressionSegments(text);
    expect(expressionSegments).toHaveLength(1);
    expect(expressionSegments[0].expression).toBe("20 + {toughness}");
    expect(findLibraryCalls(text)).toHaveLength(1);
  });

  it("finds multiple separate expressions in the same text", () => {
    const segments = findExpressionSegments("A: {{1+1}} B: {{2+2}}");
    expect(segments.map((s) => s.expression)).toEqual(["1+1", "2+2"]);
  });

  it("returns an empty array for text with no {{}} at all", () => {
    expect(findExpressionSegments("just prose, {plainVar} only")).toEqual([]);
  });

  it("correctly finds the full expression when it ENDS in a bare variable ref -- real bug found live while writing this test (three closing braces in a row: the ref's own, then the outer two)", () => {
    const segments = findExpressionSegments("HP: {{20 + (10 * {toughness}) + {hpBonus}}}");
    expect(segments).toHaveLength(1);
    expect(segments[0].expression).toBe("20 + (10 * {toughness}) + {hpBonus}");
  });

  it("also handles a bare variable ref immediately followed by the :box/:button suffix before the close", () => {
    const segments = findExpressionSegments("{{{hp}:button}}");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ expression: "{hp}", display: "button" });
  });
});

describe("substituteVariableRefs (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- the shared text-substitution half both evaluateCharacterSheetExpression below AND the [[dice notation]] chat-roll system (packages/server/src/chat/diceRoll.ts) reuse)", () => {
  it("returns the text unchanged when it has no {variableId} references at all", () => {
    expect(substituteVariableRefs("2+2", {})).toBe("2+2");
  });

  it("substitutes a single reference with its current numeric value", () => {
    expect(substituteVariableRefs("20 + (10 * {toughness}) + {hpBonus}", { toughness: 5, hpBonus: 0 })).toBe("20 + (10 * 5) + 0");
  });

  it("substitutes multiple distinct references", () => {
    expect(substituteVariableRefs("{a} + {b} * {c}", { a: 1, b: 2, c: 3 })).toBe("1 + 2 * 3");
  });

  it("supports .x/.y component refs for an xOfY variable", () => {
    expect(substituteVariableRefs("{hp.x} + {hp.y}", { hp: 7, hpMax: 10 })).toBe("7 + 10");
  });

  it("coerces a numeric-STRING variable value (variableValues allows number | string)", () => {
    expect(substituteVariableRefs("{toughness} + 1", { toughness: "5" })).toBe("5 + 1");
  });

  it("fails gracefully (undefined, never throws) for an unknown variable", () => {
    expect(substituteVariableRefs("{doesNotExist} + 1", {})).toBeUndefined();
  });

  it("fails gracefully for a non-numeric string variable value", () => {
    expect(substituteVariableRefs("{name} + 1", { name: "Aria" })).toBeUndefined();
  });
});

describe("evaluateCharacterSheetExpression (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- real correction, 2026-10-25, second pass: plain arithmetic evaluates HERE, client-side, via expr-eval -- only a genuine dice roll still needs the server at all, see packages/server/src/chat/diceRoll.test.ts's rollCharacterSheetExpression)", () => {
  it("evaluates plain arithmetic with no dice and no variables at all", () => {
    expect(evaluateCharacterSheetExpression("2+2", {}, false)).toEqual({ value: 4 });
    expect(evaluateCharacterSheetExpression("20 + (10 * 5) + 0", {}, false)).toEqual({ value: 70 });
  });

  it("substitutes {variableId} references with their current numeric value before evaluating", () => {
    expect(evaluateCharacterSheetExpression("20 + (10 * {toughness}) + {hpBonus}", { toughness: 5, hpBonus: 0 }, false)).toEqual({ value: 70 });
  });

  it("re-evaluates to a NEW result when the underlying variable changes -- the whole point of \"live\", not a frozen snapshot", () => {
    const at5 = evaluateCharacterSheetExpression("20 + (10 * {toughness})", { toughness: 5 }, false);
    const at6 = evaluateCharacterSheetExpression("20 + (10 * {toughness})", { toughness: 6 }, false);
    expect(at5).toEqual({ value: 70 });
    expect(at6).toEqual({ value: 80 });
  });

  it("supports .x/.y component refs for an xOfY variable", () => {
    expect(evaluateCharacterSheetExpression("{hp.x} + {hp.y}", { hp: 7, hpMax: 10 }, false)).toEqual({ value: 17 });
  });

  it("fails gracefully with an error (never throws) for an unknown variable", () => {
    const result = evaluateCharacterSheetExpression("{doesNotExist} + 1", {}, false);
    expect(result.value).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it("fails gracefully with an error for malformed arithmetic (the library's own real parser error, not a generic message)", () => {
    const result = evaluateCharacterSheetExpression("2 + 3 foo", {}, false);
    expect(result.value).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it("fails gracefully with an error on division by zero -- the library itself doesn't throw, it returns Infinity/NaN, which this catches explicitly", () => {
    expect(evaluateCharacterSheetExpression("5 / 0", {}, false)).toEqual({ error: "division by zero" });
  });

  it("real request: dice notation (a literal 'd' followed by a digit) is rejected with the exact requested message when NOT allowed (a fixed/box display)", () => {
    expect(evaluateCharacterSheetExpression("1d20 + 5", {}, false)).toEqual({ error: "dice rolling not allowed in fixed displays" });
  });

  it("dice notation flags needsRoll when allowed (a button/clicked display) -- the actual roll needs real RNG, which only the server may compute", () => {
    expect(evaluateCharacterSheetExpression("1d20 + 5", {}, true)).toEqual({ needsRoll: true });
  });

  it("a variable NAME that happens to contain a letter 'd' followed by a digit (e.g. a variable literally called 'd4bonus') never false-positives the dice check, since substitution replaces the NAME with a plain number first", () => {
    expect(evaluateCharacterSheetExpression("{d4bonus} + 1", { d4bonus: 3 }, false)).toEqual({ value: 4 });
  });

  it("the dice check is case-insensitive on the SUBSTITUTED text (even though the real dice library itself only accepts lowercase 'd')", () => {
    expect(evaluateCharacterSheetExpression("1D20 + 5", {}, false)).toEqual({ error: "dice rolling not allowed in fixed displays" });
  });
});

describe("resolveCharacterBars (replaces the old hardcoded hp/mp billboard bars with configurable var-ref + color bars)", () => {
  const sheet: CharacterSheetTemplate = {
    name: "Test",
    pages: [],
    variables: [
      { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 },
      { id: "str", label: "Strength", type: "number", default: 10 },
    ],
    bars: [
      { variableId: "hp", color: [0.75, 0.22, 0.17] },
      { variableId: "str", color: [0, 0, 0] }, // not xOfY -- skipped
      { variableId: "nonexistent", color: [0, 0, 0] }, // stale id -- skipped
    ],
  };

  it("resolves an xOfY bar's current/max from variableValues, falling back to the definition's default/max before any value is set", () => {
    expect(resolveCharacterBars(sheet, {})).toEqual([{ variableId: "hp", label: "HP", value: 10, max: 10, color: [0.75, 0.22, 0.17] }]);
  });

  it("uses the character's own stored values once set, via the shared xOfYMaxKey convention", () => {
    expect(resolveCharacterBars(sheet, { hp: 4, [xOfYMaxKey("hp")]: 16 })).toEqual([{ variableId: "hp", label: "HP", value: 4, max: 16, color: [0.75, 0.22, 0.17] }]);
  });

  it("silently skips a bar pointing at a non-xOfY or missing variable, rather than throwing", () => {
    const resolved = resolveCharacterBars(sheet, {});
    expect(resolved).toHaveLength(1);
    expect(resolved.map((b) => b.variableId)).toEqual(["hp"]);
  });

  it("returns an empty array when the sheet is null or has no bars configured", () => {
    expect(resolveCharacterBars(null, {})).toEqual([]);
    expect(resolveCharacterBars({ variables: [] }, {})).toEqual([]);
  });
});

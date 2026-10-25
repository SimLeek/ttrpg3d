import { describe, it, expect } from "vitest";
import { computeMissingModDependencies, RESERVED_BODY_SIZE_VARIABLES, findLibraryCalls, findVariableRefs, findExpressionSegments, evaluateExpression, xOfYMaxKey, resolveCharacterBars, type CharacterSheetTemplate } from "./characterSheet.js";

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

describe("evaluateExpression (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- the real arithmetic evaluator, no eval()/Function() anywhere)", () => {
  it("evaluates plain arithmetic with no variables at all", () => {
    expect(evaluateExpression("2+2", {})).toBe(4);
    expect(evaluateExpression("10 - 3", {})).toBe(7);
    expect(evaluateExpression("3 * 4", {})).toBe(12);
    expect(evaluateExpression("10 / 4", {})).toBe(2.5);
  });

  it("respects standard operator precedence (* and / before + and -)", () => {
    expect(evaluateExpression("2 + 3 * 4", {})).toBe(14); // not 20
    expect(evaluateExpression("20 - 4 / 2", {})).toBe(18); // not 8
  });

  it("respects parentheses to override precedence", () => {
    expect(evaluateExpression("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateExpression("20 / (2 + 2)", {})).toBe(5);
  });

  it("supports nested parentheses", () => {
    expect(evaluateExpression("((1 + 2) * (3 + 4))", {})).toBe(21);
  });

  it("supports unary minus/plus", () => {
    expect(evaluateExpression("-5 + 10", {})).toBe(5);
    expect(evaluateExpression("10 + -5", {})).toBe(5);
    expect(evaluateExpression("-(2 + 3)", {})).toBe(-5);
    expect(evaluateExpression("+5", {})).toBe(5);
  });

  it("supports decimal literals", () => {
    expect(evaluateExpression("1.5 + 2.5", {})).toBe(4);
  });

  it("substitutes a single {variableId} reference with its current numeric value", () => {
    expect(evaluateExpression("20 + (10 * {toughness}) + {hpBonus}", { toughness: 5, hpBonus: 0 })).toBe(70);
  });

  it("substitutes multiple distinct variable references", () => {
    expect(evaluateExpression("{a} + {b} * {c}", { a: 1, b: 2, c: 3 })).toBe(7);
  });

  it("re-evaluates to a NEW result when the underlying variable changes -- the whole point of \"live\", not a frozen snapshot", () => {
    const toughness5 = evaluateExpression("20 + (10 * {toughness}) + {hpBonus}", { toughness: 5, hpBonus: 0 });
    const toughness6 = evaluateExpression("20 + (10 * {toughness}) + {hpBonus}", { toughness: 6, hpBonus: 0 });
    expect(toughness5).toBe(70);
    expect(toughness6).toBe(80);
  });

  it("supports .x/.y component refs for an xOfY variable, same as a plain {variableId} reference outside an expression", () => {
    expect(evaluateExpression("{hp.x} + {hp.y}", { hp: 7, hpMax: 10 })).toBe(17);
  });

  it("coerces a numeric-STRING variable value (variableValues allows number | string)", () => {
    expect(evaluateExpression("{toughness} + 1", { toughness: "5" })).toBe(6);
  });

  it("fails gracefully (undefined, never throws) for an unknown variable", () => {
    expect(evaluateExpression("{doesNotExist} + 1", {})).toBeUndefined();
  });

  it("fails gracefully for a non-numeric string variable value", () => {
    expect(evaluateExpression("{name} + 1", { name: "Aria" })).toBeUndefined();
  });

  it("fails gracefully for malformed arithmetic (unbalanced parens, stray operator, trailing garbage)", () => {
    expect(evaluateExpression("(2 + 3", {})).toBeUndefined();
    expect(evaluateExpression("2 +", {})).toBeUndefined();
    expect(evaluateExpression("2 + 3)", {})).toBeUndefined();
    expect(evaluateExpression("2 + 3 foo", {})).toBeUndefined();
    expect(evaluateExpression("", {})).toBeUndefined();
  });

  it("fails gracefully on division by zero, rather than returning Infinity/NaN", () => {
    expect(evaluateExpression("5 / 0", {})).toBeUndefined();
  });

  it("never uses eval/Function -- a variable value containing code-like text is treated as plain data, not executed", () => {
    expect(evaluateExpression("{x} + 1", { x: "1; console.log(1)" })).toBeUndefined(); // non-numeric string -- fails cleanly, definitely not executed
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

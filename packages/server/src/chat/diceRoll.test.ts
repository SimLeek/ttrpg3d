import { describe, it, expect } from "vitest";
import { rollNotation, evaluateCharacterSheetExpression } from "./diceRoll.js";

describe("rollNotation (real calls into @dice-roller/rpg-dice-roller, not mocked)", () => {
  it("resolves valid notation with a numeric total and a human-readable breakdown", () => {
    const result = rollNotation("1d1"); // deterministic: a 1-sided die always rolls 1
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.total).toBe(1);
      expect(result.text).toContain("1d1");
    }
  });

  it("applies modifiers correctly", () => {
    const result = rollNotation("1d1+5");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.total).toBe(6);
  });

  it("rejects genuinely malformed notation rather than throwing out of this function", () => {
    const result = rollNotation("not dice at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not dice at all");
  });

  it("rejects an empty notation string", () => {
    const result = rollNotation("");
    expect(result.ok).toBe(false);
  });

  it("real request, 2026-10-25 -- substitutes a {variableId} reference before rolling, same syntax {{expression}} sheet formulas use", () => {
    const result = rollNotation("1d1+{initiative}", { initiative: 7 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.total).toBe(8); // 1 (deterministic 1d1) + 7
  });

  it("rejects notation referencing an unknown variable, rather than silently treating it as 0", () => {
    const result = rollNotation("1d20+{doesNotExist}");
    expect(result.ok).toBe(false);
  });

  it("existing callers that never pass variableValues at all keep working unchanged (plain dice notation, no character context)", () => {
    const result = rollNotation("2d6");
    expect(result.ok).toBe(true);
  });
});

describe("evaluateCharacterSheetExpression (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- real correction, 2026-10-25: reuses @dice-roller/rpg-dice-roller instead of a hand-rolled parser)", () => {
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

  it("fails gracefully with an error on division by zero -- the library itself doesn't throw, it returns Infinity, which this catches explicitly", () => {
    expect(evaluateCharacterSheetExpression("5 / 0", {}, false)).toEqual({ error: "division by zero" });
  });

  it("real request: dice notation (a literal 'd' followed by a digit) is rejected with the exact requested message when NOT allowed (a fixed/box display)", () => {
    expect(evaluateCharacterSheetExpression("1d20 + 5", {}, false)).toEqual({ error: "dice rolling not allowed in fixed displays" });
  });

  it("dice notation IS allowed (and actually rolled) when the caller says so (a button/clicked display)", () => {
    const result = evaluateCharacterSheetExpression("1d1 + 5", {}, true); // 1d1 is deterministic
    expect(result.value).toBe(6);
    expect(result.text).toContain("1d1");
  });

  it("a variable NAME that happens to contain a letter 'd' followed by a digit (e.g. a variable literally called 'd4bonus') never false-positives the dice check, since substitution replaces the NAME with a plain number first", () => {
    expect(evaluateCharacterSheetExpression("{d4bonus} + 1", { d4bonus: 3 }, false)).toEqual({ value: 4 });
  });

  it("the dice check is case-insensitive on the SUBSTITUTED text (even though the real library itself only accepts lowercase 'd')", () => {
    // Confirmed directly against the library: uppercase "D" dice
    // notation isn't valid syntax at all (it throws its own parser
    // error) -- this still reports the SPECIFIC "not allowed" message
    // rather than a generic parse-error one, since the check runs
    // before the library ever sees the text.
    expect(evaluateCharacterSheetExpression("1D20 + 5", {}, false)).toEqual({ error: "dice rolling not allowed in fixed displays" });
  });
});

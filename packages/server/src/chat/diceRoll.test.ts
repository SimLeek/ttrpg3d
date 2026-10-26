import { describe, it, expect } from "vitest";
import { rollNotation, rollCharacterSheetExpression } from "./diceRoll.js";

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

describe("rollCharacterSheetExpression (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- real correction, 2026-10-25, second pass: the ONLY {{expression}} work left server-side, now that plain arithmetic evaluates client-side -- shared/characterSheet.ts's own evaluateCharacterSheetExpression)", () => {
  it("returns undefined for plain arithmetic -- the client already resolved this on its own, nothing for the server to add", () => {
    expect(rollCharacterSheetExpression("20 + (10 * 5) + 0", {}, false)).toBeUndefined();
    expect(rollCharacterSheetExpression("20 + (10 * 5) + 0", {}, true)).toBeUndefined();
  });

  it("returns undefined when dice notation isn't allowed (a fixed/box display) -- the client already reported its own 'not allowed' error", () => {
    expect(rollCharacterSheetExpression("1d20 + 5", {}, false)).toBeUndefined();
  });

  it("returns undefined for an unknown variable -- the client already reported its own error", () => {
    expect(rollCharacterSheetExpression("1d20 + {doesNotExist}", {}, true)).toBeUndefined();
  });

  it("actually rolls real dice when allowed (a button/clicked display) and dice notation is present", () => {
    const result = rollCharacterSheetExpression("1d1 + 5", {}, true); // 1d1 is deterministic
    expect(result?.value).toBe(6);
    expect(result?.text).toContain("1d1");
  });

  it("substitutes {variableId} references before rolling", () => {
    const result = rollCharacterSheetExpression("1d1 + {initiative}", { initiative: 7 }, true);
    expect(result?.value).toBe(8);
  });

  it("the dice check is case-insensitive on the SUBSTITUTED text (even though the real library itself only accepts lowercase 'd')", () => {
    const result = rollCharacterSheetExpression("1D1 + 5", {}, true);
    expect(result?.error).toBeTruthy(); // the library itself rejects uppercase D as invalid syntax
  });

  it("real request, 2026-10-26 -- actually rolls a BARE reference to a variable holding a complete dice-notation string (e.g. the real sheet's own Light/Heavy Damage, \"2d1+5\"), not just a formula that merely CONTAINS dice notation", () => {
    const result = rollCharacterSheetExpression("{heavyDamage}", { heavyDamage: "2d1+5" }, true); // 1-sided dice are deterministic
    expect(result?.value).toBe(7); // 2*1 + 5
    expect(result?.text).toContain("2d1");
  });
});

import { describe, it, expect } from "vitest";
import { rollNotation } from "./diceRoll.js";

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
});

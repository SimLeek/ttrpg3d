import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./index.js";

const names = ["Root's Test World", "Test1's Sandbox", "Dragon's Lair", "Haunted Mansion"];

describe("fuzzyMatch", () => {
  it("returns every item in input order when the query is empty", () => {
    const results = fuzzyMatch("", names, (n) => n);
    expect(results.map((r) => r.item)).toEqual(names);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it("is case-insensitive", () => {
    const results = fuzzyMatch("DRAGON", names, (n) => n);
    expect(results.map((r) => r.item)).toContain("Dragon's Lair");
  });

  it("matches an exact substring", () => {
    const results = fuzzyMatch("sandbox", names, (n) => n);
    expect(results[0]?.item).toBe("Test1's Sandbox");
  });

  it("matches a scattered (non-adjacent) subsequence, typo-tolerant style", () => {
    // "dsla" is a subsequence of "Dragon's Lair" (D...s...l...a) but not contiguous
    const results = fuzzyMatch("dsla", names, (n) => n);
    expect(results.map((r) => r.item)).toContain("Dragon's Lair");
  });

  it("excludes items where the query isn't an in-order subsequence at all", () => {
    const results = fuzzyMatch("xyz123notpresent", names, (n) => n);
    expect(results).toEqual([]);
  });

  it("ranks a contiguous substring match above a scattered match of the same length", () => {
    const candidates = ["abc-------", "a--b--c---"]; // "abc" contiguous vs scattered
    const results = fuzzyMatch("abc", candidates, (s) => s);
    expect(results[0]?.item).toBe("abc-------");
  });

  it("ranks an earlier match above a later one, all else equal", () => {
    const candidates = ["----target", "target----"];
    const results = fuzzyMatch("target", candidates, (s) => s);
    expect(results[0]?.item).toBe("target----");
  });

  it("works with non-string items via getText", () => {
    const worlds = [
      { id: "1", name: "Root's Test World" },
      { id: "2", name: "Haunted Mansion" },
    ];
    const results = fuzzyMatch("haunt", worlds, (w) => w.name);
    expect(results[0]?.item.id).toBe("2");
  });
});

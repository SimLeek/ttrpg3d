import { describe, it, expect } from "vitest";
import { recalculateTraitsCosts } from "./lyrianChronicles.js";
import type { CharacterSheetVariableDef } from "@ttrpg3d/shared";

function classDefs(id: string): CharacterSheetVariableDef[] {
  return [
    { id: `class${id}Tier`, label: `${id} Tier`, type: "number", default: 1 },
    { id: `class${id}Level`, label: `${id} Level`, type: "number", default: 1 },
    { id: `class${id}Cost`, label: `${id} Cost`, type: "number", default: 0 },
  ];
}

function breakthroughDefs(id: string): CharacterSheetVariableDef[] {
  return [
    { id: `breakthrough${id}Cost`, label: `${id} Cost`, type: "number", default: 0 },
    { id: `breakthrough${id}Description`, label: `${id} Description`, type: "text", default: "" },
  ];
}

describe("recalculateTraitsCosts (real request, 2026-10-26 -- \"the rule I said is exact... first level costs tier*100, and levels after that cost 100\")", () => {
  it("a tier 1 class's first level costs 100, with no extra levels added", () => {
    const defs = classDefs("Mage");
    const result = recalculateTraitsCosts({ classMageTier: 1, classMageLevel: 1 }, defs);
    expect(result.classMageCost).toBe(100);
  });

  it("real data, confirmed against the real sheet -- a tier 1 class at level 8 costs 800 (100 first level + 7 more at 100 each)", () => {
    const defs = classDefs("Mage");
    const result = recalculateTraitsCosts({ classMageTier: 1, classMageLevel: 8 }, defs);
    expect(result.classMageCost).toBe(800);
  });

  it("real data, confirmed against the real sheet -- a tier 2 class at level 4 costs 500 (200 first level + 3 more at 100 each)", () => {
    const defs = classDefs("Starcaller");
    const result = recalculateTraitsCosts({ classStarcallerTier: 2, classStarcallerLevel: 4 }, defs);
    expect(result.classStarcallerCost).toBe(500);
  });

  it("a tier 3 class's first level costs 300", () => {
    const defs = classDefs("Something");
    const result = recalculateTraitsCosts({ classSomethingTier: 3, classSomethingLevel: 1 }, defs);
    expect(result.classSomethingCost).toBe(300);
  });

  it("discovers every class row dynamically (no fixed id list) and recomputes ALL of them in one call", () => {
    const defs = [...classDefs("Mage"), ...classDefs("Rogue")];
    const result = recalculateTraitsCosts({ classMageTier: 1, classMageLevel: 8, classRogueTier: 1, classRogueLevel: 7 }, defs);
    expect(result.classMageCost).toBe(800);
    expect(result.classRogueCost).toBe(700);
  });

  it("real request, 2026-10-26 -- 'prefer the typed xp until that button is pressed, ... if the xlsx says 0 xp spent, assume starting' -- a breakthrough whose CURRENT cost is 0 is left alone (still free), never looked up", () => {
    const defs = breakthroughDefs("OnTheDraw");
    const result = recalculateTraitsCosts({ breakthroughOnTheDrawCost: 0 }, defs);
    expect(result.breakthroughOnTheDrawCost).toBeUndefined(); // untouched -- stays whatever it already was (0)
  });

  it("real request, 2026-10-26 -- 'once that button is pressed... the breakthroughs all list their exp requirements' -- a NON-zero breakthrough cost is overwritten from the real rulebook table by id, not trusted from whatever the player typed", () => {
    const defs = breakthroughDefs("LightSleeper");
    // The player's own sheet says they spent 999 on it (wrong/stale) -- auto-calc replaces it with the real rulebook cost (75).
    const result = recalculateTraitsCosts({ breakthroughLightSleeperCost: 999 }, defs);
    expect(result.breakthroughLightSleeperCost).toBe(75);
  });

  it("a breakthrough id not found in the hardcoded rulebook table falls back to whatever was already there, rather than silently zeroing a real cost out", () => {
    const defs = breakthroughDefs("SomeFutureBreakthroughNotYetTranscribed");
    const result = recalculateTraitsCosts({ breakthroughSomeFutureBreakthroughNotYetTranscribedCost: 123 }, defs);
    expect(result.breakthroughSomeFutureBreakthroughNotYetTranscribedCost).toBe(123);
  });

  it("real request, 2026-10-26 -- 'calculate the cost of all the levels and spirit core' -- Spirit Core becomes Total EXP minus every class's and breakthrough's own (freshly recomputed) cost", () => {
    const defs = [...classDefs("Mage"), ...breakthroughDefs("LightSleeper"), ...breakthroughDefs("OnTheDraw")];
    const result = recalculateTraitsCosts(
      {
        totalExp: 2600,
        classMageTier: 1,
        classMageLevel: 8, // -> 800
        breakthroughLightSleeperCost: 1, // non-zero -> looked up -> 75
        breakthroughOnTheDrawCost: 0, // starting -> stays free
      },
      defs,
    );
    expect(result.classMageCost).toBe(800);
    expect(result.breakthroughLightSleeperCost).toBe(75);
    expect(result.breakthroughOnTheDrawCost).toBeUndefined();
    expect(result.spiritCore).toBe(2600 - 800 - 75);
  });

  it("missing totalExp falls back to 0, never throwing or producing NaN", () => {
    const result = recalculateTraitsCosts({}, []);
    expect(result.spiritCore).toBe(0);
  });
});

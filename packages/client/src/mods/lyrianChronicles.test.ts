import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recalculateTraitsCosts, addAbility, autoPopulateAbilities } from "./lyrianChronicles.js";
import type { CharacterSheetVariableDef, CharacterSheetPageDef } from "@ttrpg3d/shared";
import type { ModActionContext, ModActionOutcome } from "../modActions.js";

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

/** Collects every `apply()` call's own variableValues into one merged object, same shape the old (pre-callback) recalculateTraitsCosts directly returned -- keeps these tests' own assertions unchanged, only the invocation style differs. */
function run(variableValues: Record<string, number | string>, defs: CharacterSheetVariableDef[]): Record<string, number | string> {
  let result: Record<string, number | string> = {};
  recalculateTraitsCosts({ variableValues, defs, pages: [], httpUrl: "http://test", accountId: "acct1" }, (outcome) => {
    result = { ...result, ...(outcome.variableValues ?? {}) };
  });
  return result;
}

describe("recalculateTraitsCosts (real request, 2026-10-26 -- \"the rule I said is exact... first level costs tier*100, and levels after that cost 100\")", () => {
  it("a tier 1 class's first level costs 100, with no extra levels added", () => {
    const defs = classDefs("Mage");
    const result = run({ classMageTier: 1, classMageLevel: 1 }, defs);
    expect(result.classMageCost).toBe(100);
  });

  it("real data, confirmed against the real sheet -- a tier 1 class at level 8 costs 800 (100 first level + 7 more at 100 each)", () => {
    const defs = classDefs("Mage");
    const result = run({ classMageTier: 1, classMageLevel: 8 }, defs);
    expect(result.classMageCost).toBe(800);
  });

  it("real data, confirmed against the real sheet -- a tier 2 class at level 4 costs 500 (200 first level + 3 more at 100 each)", () => {
    const defs = classDefs("Starcaller");
    const result = run({ classStarcallerTier: 2, classStarcallerLevel: 4 }, defs);
    expect(result.classStarcallerCost).toBe(500);
  });

  it("a tier 3 class's first level costs 300", () => {
    const defs = classDefs("Something");
    const result = run({ classSomethingTier: 3, classSomethingLevel: 1 }, defs);
    expect(result.classSomethingCost).toBe(300);
  });

  it("discovers every class row dynamically (no fixed id list) and recomputes ALL of them in one call", () => {
    const defs = [...classDefs("Mage"), ...classDefs("Rogue")];
    const result = run({ classMageTier: 1, classMageLevel: 8, classRogueTier: 1, classRogueLevel: 7 }, defs);
    expect(result.classMageCost).toBe(800);
    expect(result.classRogueCost).toBe(700);
  });

  it("real request, 2026-10-26 -- 'prefer the typed xp until that button is pressed, ... if the xlsx says 0 xp spent, assume starting' -- a breakthrough whose CURRENT cost is 0 is left alone (still free), never looked up", () => {
    const defs = breakthroughDefs("OnTheDraw");
    const result = run({ breakthroughOnTheDrawCost: 0 }, defs);
    expect(result.breakthroughOnTheDrawCost).toBeUndefined(); // untouched -- stays whatever it already was (0)
  });

  it("real request, 2026-10-26 -- 'once that button is pressed... the breakthroughs all list their exp requirements' -- a NON-zero breakthrough cost is overwritten from the real rulebook table by id, not trusted from whatever the player typed", () => {
    const defs = breakthroughDefs("LightSleeper");
    // The player's own sheet says they spent 999 on it (wrong/stale) -- auto-calc replaces it with the real rulebook cost (75).
    const result = run({ breakthroughLightSleeperCost: 999 }, defs);
    expect(result.breakthroughLightSleeperCost).toBe(75);
  });

  it("a breakthrough id not found in the hardcoded rulebook table falls back to whatever was already there, rather than silently zeroing a real cost out", () => {
    const defs = breakthroughDefs("SomeFutureBreakthroughNotYetTranscribed");
    const result = run({ breakthroughSomeFutureBreakthroughNotYetTranscribedCost: 123 }, defs);
    expect(result.breakthroughSomeFutureBreakthroughNotYetTranscribedCost).toBe(123);
  });

  it("real request, 2026-10-26 -- 'calculate the cost of all the levels and spirit core' -- Spirit Core becomes Total EXP minus every class's and breakthrough's own (freshly recomputed) cost", () => {
    const defs = [...classDefs("Mage"), ...breakthroughDefs("LightSleeper"), ...breakthroughDefs("OnTheDraw")];
    const result = run(
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
    const result = run({}, []);
    expect(result.spiritCore).toBe(0);
  });
});

function baseCtx(overrides: Partial<ModActionContext> = {}): ModActionContext {
  return { variableValues: {}, defs: [], pages: [], httpUrl: "http://test", accountId: "acct1", ...overrides };
}

const catalogFixture = [
  { name: "Sense Magic", keywords: "", range: "", description: "You can detect active magical effects.", requirement: "", cost: "1 AP", apCost: "1 AP", manaCost: "", rpCost: "", benefits: "" },
  { name: "Absorb Ice", keywords: "", range: "", description: "You gain Absorb Ice.", requirement: "", cost: "1 RP", apCost: "", manaCost: "", rpCost: "1 RP", benefits: "" },
];

describe("addAbility/autoPopulateAbilities (real request, 2026-10-28 -- \"an added ability isn't its own variable... baked as literal HTML\")", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(catalogFixture) } as Response)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll("div").forEach((el) => el.remove());
  });

  it("addAbility opens a popup, and never calls apply until a result is actually picked", async () => {
    const apply = vi.fn();
    await addAbility(baseCtx(), apply);
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.querySelector("#ability-search-input")).not.toBeNull();
  });

  it("typing a query and clicking its own 'Add' button applies a pageEdit with the picked ability's own name+description baked into the Abilities page, and never touches variableValues/variables", async () => {
    const apply = vi.fn();
    await addAbility(baseCtx(), apply);

    const input = document.body.querySelector<HTMLInputElement>("#ability-search-input")!;
    input.value = "sense";
    input.dispatchEvent(new Event("input"));
    const addBtn = document.body.querySelector<HTMLButtonElement>(".ability-search-add-btn")!;
    addBtn.click();

    expect(apply).toHaveBeenCalledTimes(1);
    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variableValues).toBeUndefined();
    expect(outcome.variables).toBeUndefined();
    expect(outcome.pageEdits).toHaveLength(1);
    expect(outcome.pageEdits![0].pageTitle).toBe("Abilities");
    expect(outcome.pageEdits![0].appendMarkdown).toContain('data-chip-label="Sense Magic"');
    expect(outcome.pageEdits![0].appendMarkdown).toContain('data-chip-value="You can detect active magical effects."');
    expect(outcome.pageEdits![0].appendMarkdown).toContain("<details>");
  });

  it("picking an ability already listed on the Abilities page is a no-op, not a duplicate row", async () => {
    const abilitiesPage: CharacterSheetPageDef = { title: "Abilities", markdown: '<div data-chip-label="Sense Magic"></div>', variableIds: [] };
    const apply = vi.fn();
    await addAbility(baseCtx({ pages: [abilitiesPage] }), apply);

    const input = document.body.querySelector<HTMLInputElement>("#ability-search-input")!;
    input.value = "sense";
    input.dispatchEvent(new Event("input"));
    document.body.querySelector<HTMLButtonElement>(".ability-search-add-btn")!.click();

    expect(apply).not.toHaveBeenCalled();
  });

  it("the ✕ button closes the popup without ever calling apply", async () => {
    const apply = vi.fn();
    await addAbility(baseCtx(), apply);
    document.body.querySelector<HTMLButtonElement>("#ability-search-close")!.click();
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.querySelector("#ability-search-input")).toBeNull();
  });

  it("real request, 2026-10-28 -- autoPopulateAbilities adds every ability linked to a race/class/breakthrough the character actually has, gated by class LEVEL where the link specifies one", async () => {
    const defs = [...classDefs("Chronomancer")];
    const apply = vi.fn();
    // ABILITY_LINKS has a real entry: "Absorb Ice" <- Sub-Race: Yuki-Onna (no level gate).
    await autoPopulateAbilities(baseCtx({ variableValues: { subRace: "Yuki-Onna" }, defs: [] }), apply);
    expect(apply).toHaveBeenCalledTimes(1);
    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.pageEdits![0].appendMarkdown).toContain('data-chip-label="Absorb Ice"');
    expect(outcome.pageEdits![0].appendMarkdown).toContain("You gain Absorb Ice.");
    void defs; // unused in this particular assertion, kept for symmetry with the level-gated test below
  });

  it("a class-linked ability is withheld until the character's own level in that class reaches the link's own required level", async () => {
    // ABILITY_LINKS has a real entry: "Accelerando" <- Class: Chronomancer, level 4.
    const belowLevel = baseCtx({ variableValues: { classChronomancerTier: 1, classChronomancerLevel: 1 }, defs: classDefs("Chronomancer") });
    const applyBelow = vi.fn();
    await autoPopulateAbilities(belowLevel, applyBelow);
    const belowMarkdown = applyBelow.mock.calls[0]?.[0]?.pageEdits?.[0]?.appendMarkdown ?? "";
    expect(belowMarkdown).not.toContain('data-chip-label="Accelerando"');

    const atLevel = baseCtx({ variableValues: { classChronomancerTier: 1, classChronomancerLevel: 4 }, defs: classDefs("Chronomancer") });
    const applyAt = vi.fn();
    await autoPopulateAbilities(atLevel, applyAt);
    const atMarkdown = applyAt.mock.calls[0]?.[0]?.pageEdits?.[0]?.appendMarkdown ?? "";
    expect(atMarkdown).toContain('data-chip-label="Accelerando"');
  });

  it("never re-adds an ability already listed on the Abilities page, and never calls apply at all when nothing qualifies", async () => {
    const apply = vi.fn();
    await autoPopulateAbilities(baseCtx({ variableValues: {}, defs: [] }), apply);
    expect(apply).not.toHaveBeenCalled(); // no race/class/subRace/breakthrough at all -- nothing qualifies
  });
});

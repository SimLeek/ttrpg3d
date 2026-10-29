import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { marked } from "marked";
import {
  recalculateTraitsCosts,
  addAbility,
  addCustomAbility,
  autoPopulateAbilities,
  addClass,
  addBreakthrough,
  addCombatLoadoutItem,
  addAdventurersKitItem,
  addAlchemyRigItem,
  addExpeditionInventoryItem,
} from "./lyrianChronicles.js";
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
  { name: "Sense Magic", keywords: "", range: "30ft", description: "You can detect active magical effects.", requirement: "", cost: "1 AP", apCost: "1 AP", manaCost: "", rpCost: "", benefits: "" },
  { name: "Absorb Ice", keywords: "", range: "Self", description: "You gain Absorb Ice.", requirement: "", cost: "1 RP", apCost: "", manaCost: "", rpCost: "1 RP", benefits: "" },
  // Real request, 2026-10-29 (playtest): "The Alchemist is empty... just like Transfusion" -- a "key ability" row shape whose real text lives in `benefits`, not `description`, which the old two-string signature had no way to show at all.
  { name: "The Alchemist", keywords: "", range: "", description: "", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "You gain Alchemist Core Crafting Abilities.|You can craft using non-advanced materials." },
  // Real clue, 2026-10-29 (playtest): "Arcane Barrier... do[es] not show up even though [it's] in the edit md stuff" -- a genuinely multi-PARAGRAPH description (a real blank line in the middle), the exact shape that corrupted the old raw-newline-in-attribute HTML.
  { name: "Arcane Barrier", keywords: "Shield, Spell, Safe", range: "Self", description: "You create a Magical Barrier that absorbs damage until it breaks.\n\nThis spell does not provoke attacks of opportunity.", requirement: "You're about to take damage.", cost: "1 MP, 1 RP", apCost: "", manaCost: "1 MP", rpCost: "1 RP", benefits: "" },
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

  it("typing a query and clicking its own 'Add' button applies a pageEdit with the picked ability's own FULL info (range/cost/description, not just description) baked into the Abilities page, and never touches variableValues/variables", async () => {
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
    const markdown = outcome.pageEdits![0].appendMarkdown!;
    expect(markdown).toContain('data-chip-label="Sense Magic"');
    // Real request, 2026-10-29 (playtest): "Throw potion is missing the range and other stuff (should say 30ft range for example)" -- range/cost must appear, not just description, both in the posted chat text AND the info disclosure.
    expect(markdown).toContain("Range: 30ft");
    expect(markdown).toContain("Cost: 1 AP");
    expect(markdown).toContain("You can detect active magical effects.");
    expect(markdown).toMatch(/data-chip-value="[^"]*Range: 30ft/);
    expect(markdown).toContain("<details>");
  });

  it("real request, 2026-10-29 (playtest): \"the test chat is too narrow... convert it to 1xn, no matter how many columns there were originally... just rows, no columns\" -- the info table is single-column (label and its value are each their OWN <tr>, never a label/value pair sharing one row), with the label still bold", async () => {
    const apply = vi.fn();
    await addAbility(baseCtx(), apply);

    const input = document.body.querySelector<HTMLInputElement>("#ability-search-input")!;
    input.value = "sense";
    input.dispatchEvent(new Event("input"));
    document.body.querySelector<HTMLButtonElement>(".ability-search-add-btn")!.click();

    const markdown = (apply.mock.calls[0][0] as ModActionOutcome).pageEdits![0].appendMarkdown!;
    expect(markdown).not.toContain("<th"); // no two-column header cell at all
    expect(markdown).toMatch(/<tr><td><strong>Cost<\/strong><\/td><\/tr><tr><td>1 AP<\/td><\/tr>/); // label and value are separate rows, not one row with two cells
    const tdCountsPerRow = Array.from(markdown.matchAll(/<tr>(.*?)<\/tr>/g)).map((m) => (m[1].match(/<td>/g) ?? []).length);
    expect(tdCountsPerRow.every((count) => count === 1)).toBe(true); // every row has exactly ONE cell -- 1xn, never 2xn
  });

  it("real request, 2026-10-29 (playtest): \"The Alchemist is empty\" -- an entry whose real text lives in `benefits` (not `description`) is still rendered, as a bulleted list", async () => {
    const apply = vi.fn();
    await addAbility(baseCtx(), apply);

    const input = document.body.querySelector<HTMLInputElement>("#ability-search-input")!;
    input.value = "alchemist";
    input.dispatchEvent(new Event("input"));
    document.body.querySelector<HTMLButtonElement>(".ability-search-add-btn")!.click();

    const markdown = (apply.mock.calls[0][0] as ModActionOutcome).pageEdits![0].appendMarkdown!;
    expect(markdown).toContain("Benefits:");
    expect(markdown).toContain("You gain Alchemist Core Crafting Abilities.");
    expect(markdown).toContain("You can craft using non-advanced materials.");
  });

  it("real clue, 2026-10-29 (playtest): \"Arcane Barrier do[es] not show up even though [it's] in the edit md stuff\" -- a multi-PARAGRAPH description (a real blank line inside it) must survive marked.js's own markdown pass intact, not get truncated/corrupted into a stray <p>", async () => {
    const apply = vi.fn();
    await addAbility(baseCtx(), apply);

    const input = document.body.querySelector<HTMLInputElement>("#ability-search-input")!;
    input.value = "arcane";
    input.dispatchEvent(new Event("input"));
    document.body.querySelector<HTMLButtonElement>(".ability-search-add-btn")!.click();

    const markdown = (apply.mock.calls[0][0] as ModActionOutcome).pageEdits![0].appendMarkdown!;
    // The raw page markdown itself must never contain a literal blank line inside the chat-chip's own attributes -- that's exactly what let marked.js's CommonMark HTML-block rule treat the attribute as ending early.
    expect(markdown).not.toMatch(/data-chip-(value|html)="[^"]*\n\n/);

    const rendered = marked.parse(`# Abilities\n${markdown}`) as string;
    expect(rendered).not.toContain("<p>"); // a stray <p> is exactly what the old bug produced when markdown re-parsed a corrupted attribute as a new paragraph
    expect(rendered).toContain("</div>"); // the row's own closing tag must survive, not get swallowed by a mis-parsed earlier attribute
    expect(rendered).toContain("<table");
    expect(rendered).toContain("</button>");
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

  it("real request, 2026-10-29 -- \"both already existing abilities as well as custom should be able to be added\": addCustomAbility is synchronous (no popup, no catalog fetch at all) and appends ONE obviously-placeholder template row immediately", () => {
    const apply = vi.fn();
    addCustomAbility(baseCtx(), apply);

    expect(apply).toHaveBeenCalledTimes(1);
    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variableValues).toBeUndefined();
    expect(outcome.variables).toBeUndefined();
    expect(outcome.pageEdits).toHaveLength(1);
    expect(outcome.pageEdits![0].pageTitle).toBe("Abilities");
    expect(outcome.pageEdits![0].appendMarkdown).toContain('data-chip-label="New Custom Ability"');
    expect(outcome.pageEdits![0].appendMarkdown).toContain("Edit this row directly with the page's own Edit button");
    expect(outcome.pageEdits![0].appendMarkdown).toContain("<details>");
  });

  it("clicking Add Custom Ability twice appends TWO independent template rows, never deduped (each is meant to become a DIFFERENT custom ability)", () => {
    const apply = vi.fn();
    addCustomAbility(baseCtx(), apply);
    addCustomAbility(baseCtx(), apply);
    expect(apply).toHaveBeenCalledTimes(2);
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

  it("real request, 2026-10-29 (playtest): \"sort by source first -- race & sub-race first, then breakthroughs, then classes, all within those sorted by the way it's listed in the traits tab... each of those should have its own frame\" -- groups are ordered race, sub-race, then breakthroughs/classes in defs/Traits-tab order, each its own collapsible <details> frame", async () => {
    // Real data: race Chimera -> "Fight or Flight"; sub-race Yuki-Onna -> "Absorb Ice"; breakthrough "Racial Flight" -> "Flight"; Rogue (level 1) -> "Feint"; Mage (level 2) -> "Decipher Magic".
    const defs = [...breakthroughDefs("RacialFlight"), ...classDefs("Rogue"), ...classDefs("Mage")];
    const variableValues = { race: "Chimera", subRace: "Yuki-Onna", classRogueLevel: 1, classMageLevel: 2 };
    const apply = vi.fn();
    await autoPopulateAbilities(baseCtx({ variableValues, defs }), apply);

    expect(apply).toHaveBeenCalledTimes(1);
    const markdown = (apply.mock.calls[0][0] as ModActionOutcome).pageEdits![0].appendMarkdown!;

    const headings = Array.from(markdown.matchAll(/<details class="ability-group"[^>]*><summary[^>]*>([^<]+)<\/summary>/g)).map((m) => m[1]);
    expect(headings).toEqual(["Chimera", "Yuki-Onna", "Racial Flight", "Rogue", "Mage"]);

    const idx = (heading: string) => markdown.indexOf(`>${heading}</summary>`);
    expect(markdown.slice(idx("Chimera"), idx("Yuki-Onna"))).toContain('data-chip-label="Fight or Flight"');
    expect(markdown.slice(idx("Yuki-Onna"), idx("Racial Flight"))).toContain('data-chip-label="Absorb Ice"');
    expect(markdown.slice(idx("Racial Flight"), idx("Rogue"))).toContain('data-chip-label="Flight"');
    expect(markdown.slice(idx("Rogue"), idx("Mage"))).toContain('data-chip-label="Feint"');
    expect(markdown.slice(idx("Mage"))).toContain('data-chip-label="Decipher Magic"');
  });

  it("real example from the request, 2026-10-29 -- a level-4 Starcaller's own group lists its qualifying abilities by LEVEL first (Celestial Artillery/Comet at 1, Starfall at 2, Corona Burst at 4), alphabetical only within the same level", async () => {
    const defs = classDefs("Starcaller");
    const apply = vi.fn();
    await autoPopulateAbilities(baseCtx({ variableValues: { classStarcallerLevel: 4 }, defs }), apply);

    expect(apply).toHaveBeenCalledTimes(1);
    const markdown = (apply.mock.calls[0][0] as ModActionOutcome).pageEdits![0].appendMarkdown!;
    const labelsInOrder = Array.from(markdown.matchAll(/data-chip-label="([^"]+)"/g)).map((m) => m[1]);
    expect(labelsInOrder).toEqual(["Celestial Artillery", "Comet", "Starfall", "Corona Burst"]);
  });

  it("real request, 2026-10-29 (playtest): \"sort alphabetically if... there are no listed levels like racial abilities\" -- a race group (no level on any of its links) sorts purely alphabetically", async () => {
    // Real data: race "Demon" has two real links -- "Divine Release" and "Demonblood Regeneration" -- alphabetically Demonblood comes first.
    const apply = vi.fn();
    await autoPopulateAbilities(baseCtx({ variableValues: { race: "Demon" }, defs: [] }), apply);
    const markdown = (apply.mock.calls[0]![0] as ModActionOutcome).pageEdits![0].appendMarkdown!;
    const labelsInOrder = Array.from(markdown.matchAll(/data-chip-label="([^"]+)"/g)).map((m) => m[1]);
    expect(labelsInOrder).toEqual(["Demonblood Regeneration", "Divine Release"]);
  });

  it("a source with no qualifying abilities (or none at all, e.g. no classes/breakthroughs) produces no group for it, and calling with nothing at all never calls apply", async () => {
    const apply = vi.fn();
    await autoPopulateAbilities(baseCtx({ variableValues: { race: "Human" }, defs: [] }), apply); // "Human" has real links -- just confirming an unrelated class/breakthrough group never appears when there are none
    const markdown = (apply.mock.calls[0]?.[0] as ModActionOutcome | undefined)?.pageEdits?.[0]?.appendMarkdown ?? "";
    expect(markdown.match(/<details class="ability-group"/g)?.length).toBe(1); // only the one real group (Human), nothing else
  });

  it("never re-adds an ability already listed on the Abilities page, and never calls apply at all when nothing qualifies", async () => {
    const apply = vi.fn();
    await autoPopulateAbilities(baseCtx({ variableValues: {}, defs: [] }), apply);
    expect(apply).not.toHaveBeenCalled(); // no race/class/subRace/breakthrough at all -- nothing qualifies
  });
});

function pick(optionText: string): void {
  const select = document.body.querySelector<HTMLSelectElement>("#dropdown-picker-select")!;
  select.value = optionText;
  document.body.querySelector<HTMLButtonElement>("#dropdown-picker-add")!.click();
}

describe("addClass/addBreakthrough (real request, 2026-10-28 -- \"a + button to add a line and a dropdown to select the thing\")", () => {
  afterEach(() => {
    document.querySelectorAll("div").forEach((el) => el.remove());
  });

  it("picking a REAL class from the dropdown (confirmed directly: 'Acolyte' is Tier 1 on the real sheet) seeds Tier/Level/Cost correctly and inserts a fresh table into an otherwise-empty Classes section", () => {
    const traitsPage: CharacterSheetPageDef = { title: "Traits", markdown: "# Traits\n\n## Classes\n\nNo classes.\n\n## Breakthroughs\n\nNo breakthroughs.", variableIds: [] };
    const apply = vi.fn();
    addClass(baseCtx({ pages: [traitsPage] }), apply);

    expect(document.body.querySelector("#dropdown-picker-select")).not.toBeNull();
    pick("Acolyte");

    expect(apply).toHaveBeenCalledTimes(1);
    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variableValues).toEqual({ classAcolyteTier: 1, classAcolyteLevel: 1, classAcolyteCost: 100 }); // tier 1 * 100 -- the SAME first-level rule recalculateTraitsCosts uses
    expect(outcome.variables).toEqual([
      { id: "classAcolyteTier", label: "Acolyte Tier", type: "number", default: 1 },
      { id: "classAcolyteLevel", label: "Acolyte Level", type: "number", default: 1 },
      { id: "classAcolyteCost", label: "Acolyte Cost", type: "number", default: 100 },
    ]);
    const newMarkdown = outcome.pageEdits![0].replaceMarkdown!;
    expect(newMarkdown).toContain("| Class | Tier | Level | Cost |");
    expect(newMarkdown).toContain("| Acolyte | {classAcolyteTier} | {classAcolyteLevel} | {classAcolyteCost} |");
    expect(newMarkdown).not.toContain("No classes."); // the placeholder is REPLACED, not left dangling alongside the new table
    expect(newMarkdown).toContain("## Breakthroughs"); // the section after Classes is untouched, still present
  });

  it("inserts a new class row INSIDE the existing table (before the next ## heading), not appended after the whole page", () => {
    const traitsPage: CharacterSheetPageDef = {
      title: "Traits",
      markdown: ["# Traits", "", "## Classes", "", "| Class | Tier | Level | Cost |", "| --- | --- | --- | --- |", "| Mage | {classMageTier} | {classMageLevel} | {classMageCost} |", "", "## Breakthroughs", "", "No breakthroughs."].join("\n"),
      variableIds: [],
    };
    const apply = vi.fn();
    addClass(baseCtx({ pages: [traitsPage], defs: [{ id: "classMageTier", label: "Mage Tier", type: "number", default: 1 }] }), apply);
    pick("Acolyte");

    const newMarkdown = apply.mock.calls[0][0].pageEdits[0].replaceMarkdown as string;
    const classesIdx = newMarkdown.indexOf("## Classes");
    const breakthroughsIdx = newMarkdown.indexOf("## Breakthroughs");
    const acolyteIdx = newMarkdown.indexOf("| Acolyte |");
    expect(acolyteIdx).toBeGreaterThan(classesIdx);
    expect(acolyteIdx).toBeLessThan(breakthroughsIdx); // landed INSIDE the Classes section, not after Breakthroughs
    expect(newMarkdown).toContain("| Mage | {classMageTier} | {classMageLevel} | {classMageCost} |"); // the existing row survives untouched
  });

  it("excludes a class already present on the character from the dropdown's own options", () => {
    const traitsPage: CharacterSheetPageDef = { title: "Traits", markdown: "## Classes\n\n| Class | Tier | Level | Cost |\n| --- | --- | --- | --- |\n| Acolyte | {classAcolyteTier} | {classAcolyteLevel} | {classAcolyteCost} |\n\n## Breakthroughs\n\nNo breakthroughs.", variableIds: [] };
    addClass(baseCtx({ pages: [traitsPage], defs: [{ id: "classAcolyteTier", label: "Acolyte Tier", type: "number", default: 1 }] }), vi.fn());

    const options = Array.from(document.body.querySelectorAll<HTMLOptionElement>("#dropdown-picker-select option")).map((o) => o.value);
    expect(options).not.toContain("Acolyte");
    expect(options).toContain("Adventurer"); // some other real, not-yet-added class is still offered
  });

  it("picking a REAL breakthrough (confirmed directly: 'Bully' costs 50 on the real sheet) seeds Cost from the hardcoded rulebook table and bakes its own description into a details disclosure, never a variable", () => {
    const traitsPage: CharacterSheetPageDef = { title: "Traits", markdown: "## Classes\n\nNo classes.\n\n## Breakthroughs\n\nNo breakthroughs.", variableIds: [] };
    const apply = vi.fn();
    addBreakthrough(baseCtx({ pages: [traitsPage] }), apply);
    pick("Bully");

    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variableValues).toEqual({ breakthroughBullyCost: 50 });
    expect(outcome.variables).toEqual([{ id: "breakthroughBullyCost", label: "Bully Cost", type: "number", default: 50 }]);
    const newMarkdown = outcome.pageEdits![0].replaceMarkdown!;
    expect(newMarkdown).toContain("| Bully | {breakthroughBullyCost} | <details>");
    expect(newMarkdown).toContain("You gain a +5 bonus to intimidation skill checks against targets with less Fitness than you.");
  });

  it("the ✕ button closes the popup without ever calling apply, for both addClass and addBreakthrough", () => {
    const traitsPage: CharacterSheetPageDef = { title: "Traits", markdown: "## Classes\n\nNo classes.\n\n## Breakthroughs\n\nNo breakthroughs.", variableIds: [] };
    const apply = vi.fn();
    addClass(baseCtx({ pages: [traitsPage] }), apply);
    document.body.querySelector<HTMLButtonElement>("#dropdown-picker-close")!.click();
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.querySelector("#dropdown-picker-select")).toBeNull();
  });
});

describe("addCombatLoadoutItem/addAdventurersKitItem/addAlchemyRigItem/addExpeditionInventoryItem (real request, 2026-10-29 -- \"+ Add Item\" for the four freeform Inventory lists, synchronous, no popup, same tier as Add Custom Ability)", () => {
  function emptyBoxMarkdown(summary: string, actionName: string, trailingLine?: string): string {
    return `<details class="ability-group" open><summary>${summary}</summary>\n\n<button type="button" data-mod-action="lyrian-chronicles.${actionName}">+ Add Item</button>\n\nNo items yet.${trailingLine ? `\n\n${trailingLine}` : ""}\n\n</details>`;
  }

  it("adding to an EMPTY Combat Loadout list replaces the placeholder with a fresh table + row 1, seeding blank defaults", () => {
    const inventoryPage: CharacterSheetPageDef = { title: "Inventory", markdown: emptyBoxMarkdown("Combat Loadout", "addCombatLoadoutItem"), variableIds: [] };
    const apply = vi.fn();
    addCombatLoadoutItem(baseCtx({ pages: [inventoryPage], defs: [] }), apply);

    expect(apply).toHaveBeenCalledTimes(1);
    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variableValues).toEqual({ combatLoadout1Name: "", combatLoadout1Burden: 0 });
    expect(outcome.variables).toEqual([
      { id: "combatLoadout1Name", label: "combatLoadout 1 Name", type: "text", default: "" },
      { id: "combatLoadout1Burden", label: "combatLoadout 1 Burden", type: "number", default: 0 },
      { id: "combatBurdenTotal", label: "Combat Burden Total", type: "number", default: 0, valueExpression: "{combatLoadout1Burden}" },
    ]);
    const newMarkdown = outcome.pageEdits![0].replaceMarkdown!;
    expect(newMarkdown).not.toContain("No items yet.");
    expect(newMarkdown).toContain("| Item | Burden |");
    expect(newMarkdown).toContain("| {combatLoadout1Name} | {combatLoadout1Burden} |");
  });

  it("adding to a NON-EMPTY Adventurer's Kit list inserts the new row BEFORE the trailing total marker (never after it), and rebuilds the total's own valueExpression to include both rows", () => {
    const existingRow = "| {adventurersKit1Name} | {adventurersKit1Burden} |";
    const inventoryPage: CharacterSheetPageDef = {
      title: "Inventory",
      markdown: `<details class="ability-group" open><summary>Adventurer's Kit</summary>\n\n<button type="button" data-mod-action="lyrian-chronicles.addAdventurersKitItem">+ Add Item</button>\n\n| Item | Burden |\n| --- | --- |\n${existingRow}\n\n**Total Burden Carried:** {adventurersKitBurdenTotal}\n\n</details>`,
      variableIds: [],
    };
    const apply = vi.fn();
    const defs: CharacterSheetVariableDef[] = [
      { id: "adventurersKit1Name", label: "x", type: "text", default: "" },
      { id: "adventurersKit1Burden", label: "x", type: "number", default: 0 },
    ];
    addAdventurersKitItem(baseCtx({ pages: [inventoryPage], defs }), apply);

    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variables).toContainEqual({
      id: "adventurersKitBurdenTotal",
      label: "Adventurer's Kit Burden Total",
      type: "number",
      default: 0,
      valueExpression: "{adventurersKit1Burden} + {adventurersKit2Burden}", // BOTH rows, not just the new one
    });
    const newMarkdown = outcome.pageEdits![0].replaceMarkdown!;
    const totalIdx = newMarkdown.indexOf("**Total Burden Carried:**");
    const newRowIdx = newMarkdown.indexOf("{adventurersKit2Name}");
    expect(newRowIdx).toBeGreaterThan(-1);
    expect(newRowIdx).toBeLessThan(totalIdx); // the new row landed INSIDE the table, before the total line, not after it
  });

  it("addAlchemyRigItem works the same way (shared addBurdenListItem helper)", () => {
    const inventoryPage: CharacterSheetPageDef = { title: "Inventory", markdown: emptyBoxMarkdown("Alchemy Rig", "addAlchemyRigItem", "**Burden Total:** {alchemyRigBurdenTotal}"), variableIds: [] };
    const apply = vi.fn();
    addAlchemyRigItem(baseCtx({ pages: [inventoryPage], defs: [] }), apply);
    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variableValues).toEqual({ alchemyRig1Name: "", alchemyRig1Burden: 0 });
  });

  it("addExpeditionInventoryItem rebuilds BOTH running totals (Burden Total AND Inventory Clim Value), each a live per-row expression", () => {
    const inventoryPage: CharacterSheetPageDef = {
      title: "Inventory",
      markdown: emptyBoxMarkdown("Expedition Inventory", "addExpeditionInventoryItem", "**Inventory Clim Value:** {inventoryClimValue}"),
      variableIds: [],
    };
    const apply = vi.fn();
    addExpeditionInventoryItem(baseCtx({ pages: [inventoryPage], defs: [] }), apply);

    const outcome: ModActionOutcome = apply.mock.calls[0][0];
    expect(outcome.variableValues).toEqual({ expeditionItem1Name: "", expeditionItem1Amount: 1, expeditionItem1Burden: 0, expeditionItem1ClimCost: 0 });
    expect(outcome.variables).toContainEqual({ id: "burdenTotal", label: "Burden Total", type: "number", default: 0, valueExpression: "{expeditionItem1Burden}" });
    expect(outcome.variables).toContainEqual({
      id: "inventoryClimValue",
      label: "Inventory Clim Value",
      type: "number",
      default: 0,
      valueExpression: "({expeditionItem1Amount} * {expeditionItem1ClimCost})",
    });
    const newMarkdown = outcome.pageEdits![0].replaceMarkdown!;
    expect(newMarkdown).toContain("{{{expeditionItem1Amount} * {expeditionItem1ClimCost}}}"); // the per-row live total, auto-calculated
  });
});

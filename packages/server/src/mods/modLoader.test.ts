import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listAvailableMods, createModLoader, listCharacterSheetTemplates, listCharacterSheetLibraries, resolveCharacterSheetMarkdown, importCharacterSheet } from "./modLoader.js";
import { evaluateCharacterSheetExpression } from "@ttrpg3d/shared";

// Mirrors mods/lyrian-chronicles/entry.ts's own SKILLS list and
// skillVariableId -- duplicated here (not imported) so these tests
// stay independent of that file's own internals; a real mismatch
// between the two would show up as the real fixture tests below
// failing, same as any other hand-verified expectation in this file.
const LYRIAN_SKILLS = ["Athletics", "Riding", "Stealth", "Deception", "Roguecraft", "Medicine", "Common Knowledge", "Linguistics", "Magic", "Religion", "Appraise", "History", "Flight", "Artifice", "Perception", "Insight", "Survival", "Animal Husbandry", "Art", "Negotiation", "Intimidation"];
function lyrianSkillId(name: string): string {
  return name
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}
function emptyLyrianSkillFields(): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  for (const name of LYRIAN_SKILLS) {
    const id = lyrianSkillId(name);
    // Real request, 2026-10-26 (skills rework): the governing-stat
    // column is never found in these fixtures (no skill rows at all),
    // so Bonus falls back to its OLD frozen-number behavior (0) --
    // still a flat variableValues entry, just with a new SkillPoints
    // sibling imported alongside it now.
    result[`${id}Bonus`] = 0;
    result[`${id}SkillPoints`] = 0;
    result[`${id}Expertise`] = "";
  }
  return result;
}
const EMPTY_CRAFTING_PAGE = { title: "Crafting", markdown: "# Crafting\n\nNo crafting skills.", variableIds: [] };
// Real request, 2026-10-26 (traits & abilities round): the fixed
// Race/Sub-Race/Total EXP Earned/Spirit Core fields, always present
// in variableValues regardless of whether the fixture's own workbook
// defines them.
// Mirrors entry.ts's own RACES/SUB_RACES/selectHtml -- duplicated
// here (not imported), same "tests stay independent of that file's
// own internals" spirit the SKILLS/skillVariableId mirrors above
// already follow.
const RACES = ["Chimera", "Demon", "Fae", "Human", "Youkai"];
const SUB_RACES = [
  "Ancient Marionette",
  "Anubis",
  "Bearfolk",
  "Bullfolk",
  "Cait Sith",
  "Catfolk",
  "Centaur",
  "Cowfolk",
  "Cu Sith",
  "Dogfolk",
  "Dryad",
  "Dullahan",
  "Gnome",
  "Harpy",
  "High Fae",
  "Horse-Folk",
  "Jiangshi",
  "Kitsune",
  "Lamiafolk",
  "Lizardfolk",
  "Mothfolk",
  "Nekomata",
  "Nio",
  "Oni",
  "Phoenix",
  "Pigfolk",
  "Pixie",
  "Rabbitfolk",
  "Raijin",
  "Ratfolk",
  "Red Pandafolk",
  "Ryujin",
  "Salamander",
  "Selkie",
  "Sheepfolk",
  "Slimefolk",
  "Spiderfolk",
  "Suryan",
  "Sylph",
  "Tengu",
  "Unseelie",
  "Willo Wisp",
  "Wolf-folk",
  "Yuki-Onna",
  "VAMPIRE",
];
function selectHtml(varKey: string, options: readonly string[], current: string): string {
  const opts = options.map((o) => `<option value="${o}"${o === current ? " selected" : ""}>${o}</option>`).join("");
  return `<select data-var-key="${varKey}">${opts}</select>`;
}
const AUTO_CALCULATE_TITLE =
  "Recomputes every class’s own Cost (tier’s first level costs tier × 100, every level after costs 100) and every breakthrough’s own Cost (already-free breakthroughs stay free; every other one gets its real cost from the rulebook), then Spirit Core from those.";

const EMPTY_TRAITS_FIELDS = { race: "", subRace: "", totalExp: 0, spiritCore: 0 };
const EMPTY_TRAITS_PAGE = {
  title: "Traits",
  markdown: [
    "# Traits",
    "",
    "## Identity",
    "",
    "| Race | Sub-Race |",
    "| --- | --- |",
    `| ${selectHtml("race", RACES, "")} | ${selectHtml("subRace", SUB_RACES, "")} |`,
    "",
    "## Currency",
    "",
    "| Total EXP Earned | Spirit Core (Remaining) |",
    "| --- | --- |",
    "| {totalExp} | {spiritCore} |",
    "",
    `<button type="button" data-mod-action="lyrian-chronicles.recalculateTraitsCosts" title="${AUTO_CALCULATE_TITLE}">Auto-Calculate Costs</button>`,
    "",
    "## Classes",
    "",
    '<button type="button" data-mod-action="lyrian-chronicles.addClass">+ Add Class</button>',
    "",
    "No classes.",
    "",
    "## Breakthroughs",
    "",
    '<button type="button" data-mod-action="lyrian-chronicles.addBreakthrough">+ Add Breakthrough</button>',
    "",
    "No breakthroughs.",
  ].join("\n"),
  variableIds: ["race", "subRace", "totalExp", "spiritCore"],
};

// Isolated synthetic mods directory per test, same spirit as store.test.ts's
// own mkdtempSync-per-test convention -- these tests shouldn't depend on
// (or be able to corrupt) the real, committed mods/example-noop fixture.
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ttrpg3d-mods-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeMod(modId: string, manifest: object, entrySource: string): void {
  const modDir = join(dir, modId);
  mkdirSync(modDir, { recursive: true });
  writeFileSync(join(modDir, "mod.json"), JSON.stringify(manifest));
  writeFileSync(join(modDir, "entry.ts"), entrySource);
}

describe("listAvailableMods (pure logic, no 3D/physics -- real unit tests)", () => {
  it("returns an empty array when the mods directory doesn't exist", () => {
    expect(listAvailableMods(join(dir, "does-not-exist"))).toEqual([]);
  });

  it("returns an empty array for an empty mods directory", () => {
    expect(listAvailableMods(dir)).toEqual([]);
  });

  it("parses every <mod-id>/mod.json manifest found", () => {
    writeMod("mod-a", { id: "mod-a", name: "Mod A", version: "1.0.0", entry: "entry.ts" }, "export function register(){} export function unregister(){}");
    writeMod("mod-b", { id: "mod-b", name: "Mod B", version: "2.0.0", entry: "entry.ts" }, "export function register(){} export function unregister(){}");

    const manifests = listAvailableMods(dir);
    expect(manifests.map((m) => m.id).sort()).toEqual(["mod-a", "mod-b"]);
    expect(manifests.find((m) => m.id === "mod-a")).toEqual({ id: "mod-a", name: "Mod A", version: "1.0.0", entry: "entry.ts" });
  });

  it("skips a directory with no mod.json, and a manifest that fails to parse, rather than throwing", () => {
    mkdirSync(join(dir, "not-a-mod"), { recursive: true }); // no mod.json at all
    const malformedDir = join(dir, "malformed");
    mkdirSync(malformedDir, { recursive: true });
    writeFileSync(join(malformedDir, "mod.json"), "{ not valid json");
    writeMod("real-mod", { id: "real-mod", name: "Real", version: "1.0.0", entry: "entry.ts" }, "export function register(){} export function unregister(){}");

    expect(() => listAvailableMods(dir)).not.toThrow();
    expect(listAvailableMods(dir).map((m) => m.id)).toEqual(["real-mod"]);
  });
});

describe("createModLoader (pure logic, no 3D/physics -- real unit tests)", () => {
  it("loadMod imports the entry module and calls register() exactly once; unloadMod calls unregister()", async () => {
    writeMod(
      "counter-mod",
      { id: "counter-mod", name: "Counter", version: "1.0.0", entry: "entry.ts" },
      `
      export let registerCount = 0;
      export let unregisterCount = 0;
      export function register() { registerCount++; }
      export function unregister() { unregisterCount++; }
      `,
    );
    const loader = createModLoader(dir);
    expect(loader.isLoaded("counter-mod")).toBe(false);

    await loader.loadMod("counter-mod");
    expect(loader.isLoaded("counter-mod")).toBe(true);
    const fixture = (await import(join(dir, "counter-mod", "entry.ts"))) as { registerCount: number; unregisterCount: number };
    expect(fixture.registerCount).toBe(1);
    expect(fixture.unregisterCount).toBe(0);

    // Loading an already-loaded mod is a no-op -- register() isn't called a second time.
    await loader.loadMod("counter-mod");
    expect(fixture.registerCount).toBe(1);

    await loader.unloadMod("counter-mod");
    expect(loader.isLoaded("counter-mod")).toBe(false);
    expect(fixture.unregisterCount).toBe(1);

    // Unloading an already-unloaded mod is a no-op.
    await loader.unloadMod("counter-mod");
    expect(fixture.unregisterCount).toBe(1);
  });

  it("loadMod is a no-op for an unknown mod id, same no-op-safe spirit as store.ts's own writes", async () => {
    const loader = createModLoader(dir);
    await expect(loader.loadMod("not-a-real-mod")).resolves.not.toThrow();
    expect(loader.isLoaded("not-a-real-mod")).toBe(false);
  });

  it("two separate loaders (one per WorldRoom instance) track their own loaded state independently", async () => {
    writeMod(
      "shared-mod",
      { id: "shared-mod", name: "Shared", version: "1.0.0", entry: "entry.ts" },
      "export function register(){} export function unregister(){}",
    );
    const loaderA = createModLoader(dir);
    const loaderB = createModLoader(dir);

    await loaderA.loadMod("shared-mod");
    expect(loaderA.isLoaded("shared-mod")).toBe(true);
    expect(loaderB.isLoaded("shared-mod")).toBe(false);
  });

  it("the real, committed mods/example-noop fixture is a valid, loadable mod", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const manifests = listAvailableMods(realModsDir);
    expect(manifests.find((m) => m.id === "example-noop")).toBeDefined();

    const loader = createModLoader(realModsDir);
    await loader.loadMod("example-noop");
    expect(loader.isLoaded("example-noop")).toBe(true);
    // Dynamic import with a computed path, not a static relative specifier
    // -- the real fixture lives outside tsconfig's `rootDir` (packages/
    // server/mods/, a sibling of src/, deliberately not mixed into the
    // compiled source tree), which a static import would fail typecheck
    // against even though it works fine at runtime.
    const fixture = (await import(pathToFileURL(join(realModsDir, "example-noop", "entry.ts")).href)) as { registered: boolean };
    expect(fixture.registered).toBe(true);

    await loader.unloadMod("example-noop");
    expect(fixture.registered).toBe(false);
  });

  it("loadMod/unloadMod are no-ops (not errors) for a mod that exports neither register nor unregister -- MVP goal item 4's pure-content character-sheet-template mods", async () => {
    writeMod("template-only-mod", { id: "template-only-mod", name: "Template Only", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetTemplate = { name: 'T', pages: [], variables: [] };");
    const loader = createModLoader(dir);
    await expect(loader.loadMod("template-only-mod")).resolves.not.toThrow();
    expect(loader.isLoaded("template-only-mod")).toBe(true);
    await expect(loader.unloadMod("template-only-mod")).resolves.not.toThrow();
  });
});

describe("listCharacterSheetTemplates (MVP goal item 4, docs/ROADMAP.md, slice 1)", () => {
  it("resolves the characterSheetTemplate export for each given mod id, skipping ones with none and unknown ids", async () => {
    writeMod(
      "sheet-mod",
      { id: "sheet-mod", name: "Sheet Mod", version: "1.0.0", entry: "entry.ts" },
      "export const characterSheetTemplate = { name: 'My Sheet', pages: [], variables: [{ id: 'hp', label: 'HP', type: 'xOfY', default: 10, max: 10 }] };",
    );
    writeMod("behavior-only-mod", { id: "behavior-only-mod", name: "Behavior Only", version: "1.0.0", entry: "entry.ts" }, "export function register(){} export function unregister(){}");

    const results = await listCharacterSheetTemplates(dir, ["sheet-mod", "behavior-only-mod", "not-a-real-mod"]);
    expect(results.length).toBe(1);
    expect(results[0].modId).toBe("sheet-mod");
    expect(results[0].template.name).toBe("My Sheet");
    expect(results[0].hasImporter).toBe(false); // this fixture mod exports no characterSheetImporter
  });

  it("resolves the real, committed mods/default fixture", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const results = await listCharacterSheetTemplates(realModsDir, ["default"]);
    expect(results.length).toBe(1);
    expect(results[0].template.variables.map((v) => v.id).sort()).toEqual(["hp", "mp", "str"]);
    expect(results[0].hasImporter).toBe(false); // the default mod is a template only, no importer
  });

  it("hasImporter is true for a mod that exports characterSheetImporter -- docs/CHARACTER_SHEET_IMPORT.md, part 1 (the real lyrian-chronicles fixture)", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const results = await listCharacterSheetTemplates(realModsDir, ["lyrian-chronicles"]);
    expect(results.length).toBe(1);
    expect(results[0].hasImporter).toBe(true);
  });
});

describe("listCharacterSheetLibraries / resolveCharacterSheetMarkdown (MVP goal item 4, round 2 -- mods as libraries, not just templates)", () => {
  it("loadMod/unloadMod are no-ops for a mod that exports only characterSheetLibrary (no register/unregister/template)", async () => {
    writeMod("library-only-mod", { id: "library-only-mod", name: "Library Only", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetLibrary = { double: (args) => Number(args[0]) * 2 };");
    const loader = createModLoader(dir);
    await expect(loader.loadMod("library-only-mod")).resolves.not.toThrow();
    expect(loader.isLoaded("library-only-mod")).toBe(true);
  });

  it("listCharacterSheetLibraries resolves the characterSheetLibrary export for each given mod id, skipping ones with none", async () => {
    writeMod("library-mod", { id: "library-mod", name: "Library Mod", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetLibrary = { double: (args) => Number(args[0]) * 2 };");
    writeMod("template-only-mod-2", { id: "template-only-mod-2", name: "Template Only", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetTemplate = { name: 'T', pages: [], variables: [] };");

    const results = await listCharacterSheetLibraries(dir, ["library-mod", "template-only-mod-2", "not-a-real-mod"]);
    expect(results.length).toBe(1);
    expect(results[0].modId).toBe("library-mod");
    expect(typeof results[0].library.double).toBe("function");
  });

  it("resolveCharacterSheetMarkdown calls a real function and substitutes its result, leaving surrounding text intact", async () => {
    writeMod("math-mod", { id: "math-mod", name: "Math Mod", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetLibrary = { double: (args) => Number(args[0]) * 2 };");

    const resolved = await resolveCharacterSheetMarkdown(dir, ["math-mod"], "Doubled: {{math-mod.double(21)}} done.", {});
    expect(resolved).toBe("Doubled: 42 done.");
  });

  it("resolveCharacterSheetMarkdown resolves a variable-id argument against variableValues", async () => {
    writeMod("math-mod-2", { id: "math-mod-2", name: "Math Mod 2", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetLibrary = { double: (args) => Number(args[0]) * 2 };");

    const resolved = await resolveCharacterSheetMarkdown(dir, ["math-mod-2"], "{{math-mod-2.double(str)}}", { str: 10 });
    expect(resolved).toBe("20");
  });

  it("resolveCharacterSheetMarkdown degrades to a bracketed marker for an unknown function, an unknown mod, and a mod that isn't in the allowed modIds list -- never throws", async () => {
    writeMod("known-mod", { id: "known-mod", name: "Known Mod", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetLibrary = { double: (args) => Number(args[0]) * 2 };");

    await expect(resolveCharacterSheetMarkdown(dir, ["known-mod"], "{{known-mod.notAFunction}}", {})).resolves.toBe("[missing function: known-mod.notAFunction]");
    await expect(resolveCharacterSheetMarkdown(dir, ["known-mod"], "{{not-a-real-mod.fn}}", {})).resolves.toBe("[missing function: not-a-real-mod.fn]");
    // Exists on disk, but not in the allowed modIds list -- treated as missing too (an account shouldn't get function calls from a mod it never imported).
    await expect(resolveCharacterSheetMarkdown(dir, [], "{{known-mod.double(1)}}", {})).resolves.toBe("[missing function: known-mod.double]");
  });

  it("resolves the real, committed mods/default fixture's modifier function", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const results = await listCharacterSheetLibraries(realModsDir, ["default"]);
    expect(results.length).toBe(1);
    expect(results[0].library.modifier([16], {})).toBe(3);

    const resolved = await resolveCharacterSheetMarkdown(realModsDir, ["default"], "Mod: {{default.modifier(str)}}", { str: 16 });
    expect(resolved).toBe("Mod: 3");
  });
});

describe("importCharacterSheet (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- un-deferred mod-based sheet importers)", () => {
  it("resolves undefined for an unknown mod id, and for a mod with no characterSheetImporter/characterSheetTemplate", async () => {
    writeMod("template-only", { id: "template-only", name: "Template Only", version: "1.0.0", entry: "entry.ts" }, "export const characterSheetTemplate = { name: 'T', pages: [], variables: [] };");

    await expect(importCharacterSheet(dir, "not-a-real-mod", {})).resolves.toBeUndefined();
    await expect(importCharacterSheet(dir, "template-only", {})).resolves.toBeUndefined();
  });

  it("calls the mod's own characterSheetImporter against the given workbook, returning it alongside the mod's template", async () => {
    writeMod(
      "importer-mod",
      { id: "importer-mod", name: "Importer Mod", version: "1.0.0", entry: "entry.ts" },
      `export const characterSheetTemplate = { name: 'Importer', pages: [], variables: [{ id: 'hp', label: 'HP', type: 'number', default: 0 }] };
       export const characterSheetImporter = (workbook) => ({ variableValues: { hp: workbook.Core[0][0] }, pages: [{ title: 'Imported', markdown: 'x', variableIds: [] }] });`,
    );

    const result = await importCharacterSheet(dir, "importer-mod", { Core: [[42]] });
    expect(result?.template.name).toBe("Importer");
    expect(result?.result.variableValues).toEqual({ hp: 42 });
    expect(result?.result.pages).toEqual([{ title: "Imported", markdown: "x", variableIds: [] }]);
  });

  it("resolves the real, committed mods/lyrian-chronicles fixture -- HP/Mana/Agility found by scanning Core's own label/value grid, not fixed coordinates", async () => {
    const realModsDir = join(process.cwd(), "mods");
    // Deliberately NOT at the same coordinates the real example sheet
    // happened to use (confirmed live: "Name" at A2/B2, "HP" at
    // E2/F2 for one real character) -- proves the scan is genuinely
    // coordinate-independent, not accidentally hardcoded.
    const workbook = {
      Core: [
        ["Unrelated", "Junk", "Row"],
        ["Agility", 6, "", "Toughness", 5],
        [],
        ["", "", "Mana", 11, "", "HP Bonus", 0],
      ],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    // hp/mp are no longer read off the sheet's own "HP"/"Mana" labels
    // directly -- both are computed from the SAME real formulas the
    // Core page's own `{{expression}}`s show live: HP = 20 + (10 *
    // Toughness) + HP Bonus; MP = ROUNDDOWN(6 + Power + Mana
    // Adjustments, 0); RP = IF(oldArmorCalc, 2+(Agility-equipment),
    // 2+Agility)-RP Adjustment. This fixture's own "Mana" cell is now
    // unused (power/manaAdjustments both fall back to 0, so MP =
    // trunc(6+0+0) = 6). hp/mp/rp carry no separate "Max" key at all
    // anymore -- each one's own max is a LIVE `maxExpression` on the
    // template itself (real request, 2026-10-26), resolved fresh
    // every render, not seeded at import time. Every OTHER stat this
    // fixture's own workbook doesn't define falls back to its own
    // default.
    expect(result?.result.variableValues).toEqual({
      hp: 70,
      mp: 6,
      rp: 8, // (0 ? ... : (2 + 6)) - 0
      agility: 6,
      toughness: 5,
      focus: 0,
      power: 0,
      fitness: 0,
      cunning: 0,
      reason: 0,
      awareness: 0,
      presence: 0,
      hpBonus: 0,
      manaAdjustments: 0,
      evasionBonus: 0,
      evasionEquipmentBonus: 0,
      dodgeBonus: 0,
      dodgeEquipmentBonus: 0,
      equipmentGuardValue: 0,
      equipmentBlockValue: 0,
      initiativeAdjustment: 0,
      initiativeEquipmentPenalty: 0,
      bonusSaveValue: 0,
      speed: 0,
      rpAdjustment: 0,
      oldArmorCalc: 0,
      lightDamage: "",
      heavyDamage: "",
      ...EMPTY_TRAITS_FIELDS,
      ...emptyLyrianSkillFields(),
    });
    expect(result?.result.pages).toEqual([EMPTY_CRAFTING_PAGE, EMPTY_TRAITS_PAGE]);
  });

  it("the real lyrian-chronicles fixture falls back to each variable's own default when its label isn't found at all", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", { Core: [["nothing", "relevant", "here"]] });
    // toughness/hpBonus/power/manaAdjustments/agility all fall back to
    // 0, so hp (20 + 10*0 + 0 = 20), mp (trunc(6+0+0) = 6), and rp
    // (2 + 0 - 0 = 2) are all purely the formula's own result -- none
    // has an independent default of its own anymore, since all three
    // are derived now, not read directly.
    expect(result?.result.variableValues).toEqual({
      hp: 20,
      mp: 6,
      rp: 2,
      agility: 0,
      toughness: 0,
      focus: 0,
      power: 0,
      fitness: 0,
      cunning: 0,
      reason: 0,
      awareness: 0,
      presence: 0,
      hpBonus: 0,
      manaAdjustments: 0,
      evasionBonus: 0,
      evasionEquipmentBonus: 0,
      dodgeBonus: 0,
      dodgeEquipmentBonus: 0,
      equipmentGuardValue: 0,
      equipmentBlockValue: 0,
      initiativeAdjustment: 0,
      initiativeEquipmentPenalty: 0,
      bonusSaveValue: 0,
      speed: 0,
      rpAdjustment: 0,
      oldArmorCalc: 0,
      lightDamage: "",
      heavyDamage: "",
      ...EMPTY_TRAITS_FIELDS,
      ...emptyLyrianSkillFields(),
    });
  });

  it("real request, 2026-10-25/26 -- MP/Evasion/Dodge/Guard/Block/Initiative/Save Bonus/Potency/RP's own inputs are read from the sheet's real, quirkier layouts (a bonus cell one or two rows BELOW its own label, an equipment-value cell TWO columns right, and a weapon/armor table's own equipped-rows SUMIF), and the resulting {{expression}} formulas compute the same number the real sheet does", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [
        ["Agility", 6, "", "Toughness", 5, "", "Power", 5, "", "Focus", 3],
        ["Evasion Bonus"],
        [3],
        ["Dodge Bonus"],
        [2],
        ["Equipment Guard Value", null, 4],
        ["Equipment Block Value", null, 1],
        ["Equipment Penalty", null, 2],
        ["Mana Adjustments"],
        [], // a stray row in between (same spirit as the real sheet's own "Add - for Negative" row) -- the real value sits 2 rows below the label, not 1
        [4],
        ["Bonus Save Value"],
        [],
        [6],
        ["Initiative Adjustment (Positive)"],
        [2],
        ["RP Adjustment (Negative)"],
        [1],
        ["Check Box if Old Armor Calc"],
        [true],
        ["Light Damage", "2d4+5", "", "Heavy Damage", "4d6+10"],
        ["Weapon", "Dodge\n- for negative", "Initiative Penalty", "Armor Equipped?"],
        ["Sword", 5, 7, false], // not equipped -- excluded from both SUMIFs
        ["Shield", 3, 1, true], // equipped -- counted in both
      ],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    const values = result?.result.variableValues ?? {};
    expect(values.evasionBonus).toBe(3);
    expect(values.dodgeBonus).toBe(2);
    expect(values.equipmentGuardValue).toBe(4);
    expect(values.equipmentBlockValue).toBe(1);
    expect(values.evasionEquipmentBonus).toBe(2); // reused directly from "Equipment Penalty"
    expect(values.dodgeEquipmentBonus).toBe(3); // summed from the table's own equipped row only
    expect(values.manaAdjustments).toBe(4);
    expect(values.bonusSaveValue).toBe(6);
    expect(values.initiativeAdjustment).toBe(2);
    expect(values.initiativeEquipmentPenalty).toBe(1);
    expect(values.rpAdjustment).toBe(1);
    expect(values.oldArmorCalc).toBe(1);
    expect(values.mp).toBe(15); // seeded at import time from the SAME formula: trunc(6+5+4)
    expect(values.rp).toBe(5); // (1 ? (2+(6-2)) : (2+6)) - 1
    expect(values.lightDamage).toBe("2d4+5");
    expect(values.heavyDamage).toBe("4d6+10");

    // Real request, 2026-10-26 -- the Core page's own "Rolls" table
    // reads these as a BARE reference (a complete dice-notation
    // string passed straight through, not plugged into arithmetic).
    expect(evaluateCharacterSheetExpression("{lightDamage}", values, true)).toEqual({ needsRoll: true });
    expect(evaluateCharacterSheetExpression("{heavyDamage}", values, true)).toEqual({ needsRoll: true });

    // Same numbers the Core page's own {{expression}} formulas would
    // show live, given these exact variableValues.
    expect(evaluateCharacterSheetExpression("trunc(6 + {power} + {manaAdjustments})", values, false)).toEqual({ value: 15 });
    expect(evaluateCharacterSheetExpression("7 + {agility} + {evasionBonus} + {evasionEquipmentBonus}", values, false)).toEqual({ value: 18 });
    expect(evaluateCharacterSheetExpression("20 + {agility} + {dodgeBonus} + {dodgeEquipmentBonus}", values, false)).toEqual({ value: 31 });
    expect(evaluateCharacterSheetExpression("trunc({toughness} + {equipmentGuardValue})", values, false)).toEqual({ value: 9 });
    expect(evaluateCharacterSheetExpression("({toughness} * 2) + {equipmentBlockValue}", values, false)).toEqual({ value: 11 });
    expect(evaluateCharacterSheetExpression("{agility} + {initiativeAdjustment} - {initiativeEquipmentPenalty}", values, false)).toEqual({ value: 7 });
    expect(evaluateCharacterSheetExpression("{toughness} + {bonusSaveValue}", values, false)).toEqual({ value: 11 });
    expect(evaluateCharacterSheetExpression("11 + {focus}", values, false)).toEqual({ value: 14 });
    expect(evaluateCharacterSheetExpression("({oldArmorCalc} ? (2 + ({agility} - {evasionEquipmentBonus})) : (2 + {agility})) - {rpAdjustment}", values, false)).toEqual({ value: 5 });
  });

  it("real request, 2026-10-26 (third pass -- skills rework) -- each skill's own governing substat (column F), Skill Points (column H), and Expertise (column I) are read by the skill's own name, one/three/four columns right respectively; Bonus becomes a LIVE valueExpression override (governing substat + skill points), not a frozen import snapshot", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [
        ["Fitness", 4],
        ["Presence", 2],
        ["Athletics", "Fitness", 2, 3, "Fit"],
        ["Intimidation", "Presence", 1, 1, "Soc"],
      ],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    const values = result?.result.variableValues ?? {};
    // The OLD "Total Bonus" column (G, offset 2) is no longer read at
    // all for a RECOGNIZED governing stat -- Bonus is computed live
    // from the substat + skill points instead, so it's never a flat
    // variableValues entry here.
    expect(values.athleticsBonus).toBeUndefined();
    expect(values.athleticsSkillPoints).toBe(3);
    expect(values.athleticsExpertise).toBe("Fit");
    expect(values.intimidationBonus).toBeUndefined();
    expect(values.intimidationSkillPoints).toBe(1);
    expect(values.intimidationExpertise).toBe("Soc");
    // Every OTHER skill this fixture's own workbook doesn't define
    // has no governing-stat row to read at all, so it falls back to
    // the OLD frozen-number behavior for Bonus (0), same as before
    // this feature existed.
    expect(values.ridingBonus).toBe(0);
    expect(values.ridingSkillPoints).toBe(0);
    expect(values.ridingExpertise).toBe("");

    const overrides = result?.result.variables ?? [];
    expect(overrides.find((v) => v.id === "athleticsBonus")?.valueExpression).toBe("{fitness} + {athleticsSkillPoints}");
    expect(overrides.find((v) => v.id === "intimidationBonus")?.valueExpression).toBe("{presence} + {intimidationSkillPoints}");
    // Riding's own Bonus got no override at all (no governing-stat row
    // found for it), so it stays the ordinary, non-live template def.
    expect(overrides.find((v) => v.id === "ridingBonus")).toBeUndefined();
  });

  it("real request, 2026-10-26 (third pass -- skills rework) -- crafting skills get the SAME 'Skill | Bonus | Skill Points | Expertise' shape as the fixed Skills list, via new per-character variable definitions (result.variables); Bonus is a LIVE formula (frozen base Total Bonus + live Skill Points); Expertise reads from column P (offset +3) despite that column's own header text misleadingly reading 'Equipment Bonus' (confirmed directly by the user)", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [
        ["Crafting Skill", "Total Bonus", "", "Equipment Bonus"],
        ["Alchemy", 5, "", "Potions"],
        [null, 0], // blank name -- "only add those if the crafting skill is not blank"
        ["Cooking", 3, "", ""],
      ],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    expect(result?.result.pages).toEqual([
      {
        title: "Crafting",
        markdown: [
          "# Crafting",
          "",
          "| Skill | Bonus | Skill Points | Expertise |",
          "| --- | --- | --- | --- |",
          "| {{Alchemy; roll: 1d20 + {craftingAlchemyBonus} | expertise: {craftingAlchemyExpertise}}} | {craftingAlchemyBonus} | {craftingAlchemySkillPoints} | {craftingAlchemyExpertise} |",
          "| {{Cooking; roll: 1d20 + {craftingCookingBonus} | expertise: {craftingCookingExpertise}}} | {craftingCookingBonus} | {craftingCookingSkillPoints} | {craftingCookingExpertise} |",
        ].join("\n"),
        variableIds: ["craftingAlchemyBonus", "craftingAlchemySkillPoints", "craftingAlchemyExpertise", "craftingCookingBonus", "craftingCookingSkillPoints", "craftingCookingExpertise"],
      },
      EMPTY_TRAITS_PAGE,
    ]);

    const variables = result?.result.variables ?? [];
    expect(variables.find((v) => v.id === "craftingAlchemyBonus")?.valueExpression).toBe("5 + {craftingAlchemySkillPoints}");
    expect(variables.find((v) => v.id === "craftingCookingBonus")?.valueExpression).toBe("3 + {craftingCookingSkillPoints}");
    expect(result?.result.variableValues.craftingAlchemyExpertise).toBe("Potions");
    expect(result?.result.variableValues.craftingCookingExpertise).toBe("");
  });

  it("no crafting skills at all (every 'Crafting Skill' row blank) still returns a real page, not an empty/missing one", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", { Core: [["nothing", "relevant", "here"]] });
    expect(result?.result.pages).toEqual([EMPTY_CRAFTING_PAGE, EMPTY_TRAITS_PAGE]);
  });

  it("real request, 2026-10-26 (traits & abilities round) -- Race/Sub-Race/Spirit Core import as plain label-scans off Core, Total EXP Earned imports as a single snapshot off the DIFFERENT 'EXP & Transactions' tab's own running total", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [
        ["Race", "Chimera", "Sub-Race | House", "Harpy"],
        ["Spirit Core", 2600],
      ],
      "EXP & Transactions": [["Event", "Date", "Amount of Experience Gained", "Experience Total"], ["Character Creation", "N/A", 1000, 2600]],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    const values = result?.result.variableValues ?? {};
    expect(values.race).toBe("Chimera");
    expect(values.subRace).toBe("Harpy");
    expect(values.spiritCore).toBe(2600);
    expect(values.totalExp).toBe(2600);
  });

  it("real data, confirmed against the real sheet -- the Class/Class Tier/Class Level/Cost (EXP) table imports verbatim (Cost is a flat PLAYER-TYPED number on the real sheet, never recomputed at import time), Tier parsed to a bare number for the auto-calculate button's own formula", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [
        ["Class", "Class Tier", "Class Level", "Cost (EXP)"],
        ["Mage", "Tier 1", "8", 800],
        ["Starcaller", "Tier 2", "4", 500],
        [null, "", null, 0], // blank padding row, same shape the real sheet's own reserved 21-row span has
      ],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    const values = result?.result.variableValues ?? {};
    expect(values.classMageTier).toBe(1);
    expect(values.classMageLevel).toBe(8);
    expect(values.classMageCost).toBe(800); // imported verbatim, not recomputed (100 + 7*100 would ALSO be 800 here, but that's not why -- see the dedicated auto-calc test in lyrianChronicles.test.ts)
    expect(values.classStarcallerTier).toBe(2);
    expect(values.classStarcallerLevel).toBe(4);
    expect(values.classStarcallerCost).toBe(500);

    const page = result?.result.pages.find((p) => p.title === "Traits");
    expect(page?.markdown).toContain("| Mage | {classMageTier} | {classMageLevel} | {classMageCost} |");
    expect(page?.markdown).toContain("| Starcaller | {classStarcallerTier} | {classStarcallerLevel} | {classStarcallerCost} |");
  });

  it("real request, 2026-10-26 (traits & abilities round) -- the character's own 'Breakthrough' tab (singular -- distinct from the game's own hidden 'Breakthroughs' rulebook tab, never available to this importer) imports Cost verbatim from 'XP Spent', by name", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [],
      Breakthrough: [
        ["Breakthrough", "XP Spent", "Requirement", "Description"],
        ["On the draw", 0, "", "You gain +1 to your initiative."],
        ["Light Sleeper", 999, "", "When asleep, you may roll Perception rolls as if you were awake."], // a wrong/stale typed number -- imported verbatim anyway; only the auto-calculate button ever corrects it
        [null, 0, "", ""], // blank name -- skipped
      ],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    const values = result?.result.variableValues ?? {};
    expect(values.breakthroughOnTheDrawCost).toBe(0);
    expect(values.breakthroughLightSleeperCost).toBe(999);

    // Real request, 2026-10-28: Description is NOT a variable at all
    // (it's reference text a player never edits) -- baked directly
    // into the row's own markdown as a plain `<details>` disclosure.
    expect(values.breakthroughOnTheDrawDescription).toBeUndefined();
    const page = result?.result.pages.find((p) => p.title === "Traits");
    expect(page?.markdown).toContain("| On the draw | {breakthroughOnTheDrawCost} | <details><summary>ℹ</summary>You gain +1 to your initiative.</details> |");
    expect(page?.markdown).toContain("| Light Sleeper | {breakthroughLightSleeperCost} | <details><summary>ℹ</summary>When asleep, you may roll Perception rolls as if you were awake.</details> |");
  });

  it("a breakthrough/class name with parentheses, apostrophes, or commas still produces a valid {variableId} (sanitized, unlike skill names which never need it)", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [["Class", "Class Tier", "Class Level", "Cost (EXP)"]],
      Breakthrough: [
        ["Breakthrough", "XP Spent", "Requirement", "Description"],
        ["Fae Flash Acrobat (Fae)", 50, "", "..."],
        ["Divine's Chosen", 0, "", "..."],
      ],
    };
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", workbook);
    const values = result?.result.variableValues ?? {};
    expect(values.breakthroughFaeFlashAcrobatFaeCost).toBe(50);
    expect(values.breakthroughDivinesChosenCost).toBe(0);
  });
});

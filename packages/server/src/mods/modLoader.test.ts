import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listAvailableMods, createModLoader, listCharacterSheetTemplates, listCharacterSheetLibraries, resolveCharacterSheetMarkdown, importCharacterSheet } from "./modLoader.js";
import { evaluateCharacterSheetExpression } from "@ttrpg3d/shared";

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
    // hp is no longer read off the sheet's own "HP" label directly --
    // it's computed from the same formula the Core page's own
    // `{{expression}}` shows live: 20 + (10 * Toughness) + HP Bonus.
    // Every OTHER stat this fixture's own workbook doesn't define
    // falls back to its own default (0, or 10 for mana).
    expect(result?.result.variableValues).toEqual({
      hp: 70,
      hpMax: 70,
      mana: 11,
      manaMax: 11,
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
      evasionBonus: 0,
      evasionEquipmentBonus: 0,
      dodgeBonus: 0,
      dodgeEquipmentBonus: 0,
      equipmentGuardValue: 0,
      equipmentBlockValue: 0,
      initiative: 0,
      saveBonus: 0,
      potency: 0,
      speed: 0,
      rp: 0,
    });
    expect(result?.result.pages).toEqual([]);
  });

  it("the real lyrian-chronicles fixture falls back to each variable's own default when its label isn't found at all", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const result = await importCharacterSheet(realModsDir, "lyrian-chronicles", { Core: [["nothing", "relevant", "here"]] });
    // toughness/hpBonus both fall back to 0, so the formula's own hp
    // (20 + 10*0 + 0 = 20) no longer matches the "hp" variable's own
    // unrelated default of 10 -- the formula wins, since hp is
    // derived from it now, not read from its own default directly.
    expect(result?.result.variableValues).toEqual({
      hp: 20,
      hpMax: 20,
      mana: 10,
      manaMax: 10,
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
      evasionBonus: 0,
      evasionEquipmentBonus: 0,
      dodgeBonus: 0,
      dodgeEquipmentBonus: 0,
      equipmentGuardValue: 0,
      equipmentBlockValue: 0,
      initiative: 0,
      saveBonus: 0,
      potency: 0,
      speed: 0,
      rp: 0,
    });
  });

  it("real request, 2026-10-25 -- Evasion/Dodge/Guard/Block's own inputs are read from the sheet's real, quirkier layouts (a bonus cell BELOW its own label, an equipment-value cell TWO columns right, and a weapon/armor table's own equipped-rows SUMIF), and the resulting {{expression}} formulas compute the same number the real sheet does", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const workbook = {
      Core: [
        ["Agility", 6, "", "Toughness", 5],
        ["Evasion Bonus"],
        [3],
        ["Dodge Bonus"],
        [2],
        ["Equipment Guard Value", null, 4],
        ["Equipment Block Value", null, 1],
        ["Equipment Penalty", null, 2],
        ["Weapon", "Dodge\n- for negative", "Armor Equipped?"],
        ["Sword", 5, false], // not equipped -- excluded from the SUMIF
        ["Shield", 3, true], // equipped -- counted
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

    // Same numbers the Core page's own {{expression}} formulas would
    // show live, given these exact variableValues.
    expect(evaluateCharacterSheetExpression("7 + {agility} + {evasionBonus} + {evasionEquipmentBonus}", values, false)).toEqual({ value: 18 });
    expect(evaluateCharacterSheetExpression("20 + {agility} + {dodgeBonus} + {dodgeEquipmentBonus}", values, false)).toEqual({ value: 31 });
    expect(evaluateCharacterSheetExpression("trunc({toughness} + {equipmentGuardValue})", values, false)).toEqual({ value: 9 });
    expect(evaluateCharacterSheetExpression("({toughness} * 2) + {equipmentBlockValue}", values, false)).toEqual({ value: 11 });
  });
});

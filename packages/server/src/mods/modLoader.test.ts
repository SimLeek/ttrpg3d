import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listAvailableMods, createModLoader, listCharacterSheetTemplates } from "./modLoader.js";

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
  });

  it("resolves the real, committed mods/default-character-sheet fixture", async () => {
    const realModsDir = join(process.cwd(), "mods");
    const results = await listCharacterSheetTemplates(realModsDir, ["default-character-sheet"]);
    expect(results.length).toBe(1);
    expect(results[0].template.variables.map((v) => v.id).sort()).toEqual(["hp", "mp"]);
  });
});

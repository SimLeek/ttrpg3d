import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountCharacterSheetView, type CharacterSheetViewOptions } from "./characterSheetView.js";
import type { CharacterRecord, CharacterSheetTemplateCatalogEntry, CharacterSheetLibraryCatalogEntry, CharacterSheetPreviewResult } from "./api.js";

let container: HTMLElement;
let character: CharacterRecord;
let previewResponse: CharacterSheetPreviewResult;
const posted: [string, string][] = [];
const saved: CharacterRecord[] = [];

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

function mockFetch(url: string, init?: { method?: string; body?: string }): Promise<Response> {
  const method = init?.method ?? "GET";
  if (url.includes("/character-sheet-preview") && method === "POST") return Promise.resolve(jsonResponse(previewResponse));
  if (url.includes("/sheet") && method === "PUT") {
    const body = JSON.parse(init!.body!) as { templateId: string | null; customSheet: CharacterRecord["customSheet"]; variableValues: Record<string, number | string> };
    character = { ...character, ...body };
    saved.push(character);
    return Promise.resolve(jsonResponse(character));
  }
  throw new Error(`unexpected fetch in test: ${method} ${url}`);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function baseOptions(overrides: Partial<CharacterSheetViewOptions> = {}): CharacterSheetViewOptions {
  return {
    httpUrl: "http://test",
    viewerAccountId: "viewer-1",
    sheetOwnerAccountId: "owner-1",
    character,
    templates: [] as CharacterSheetTemplateCatalogEntry[],
    libraries: [] as CharacterSheetLibraryCatalogEntry[],
    importedModIds: [] as string[],
    canEdit: true,
    onPostToChat: (label, value) => posted.push([label, value]),
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  posted.length = 0;
  saved.length = 0;
  previewResponse = { resolvedMarkdown: "", segments: [] };
  character = {
    id: "char-1",
    ownerAccountId: "owner-1",
    name: "Aria",
    token: { color: [1, 0, 0] },
    statusEffects: [],
    createdAt: 0,
    templateId: null,
    customSheet: {
      name: "Aria's Sheet",
      pages: [{ title: "Overview", markdown: "HP: {hp:button}", variableIds: ["hp"] }],
      variables: [{ id: "hp", label: "HP", type: "number", default: 7 }],
      bars: [],
    },
    variableValues: { hp: 7 },
  };
  vi.stubGlobal("fetch", vi.fn(mockFetch));
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

describe("mountCharacterSheetView", () => {
  it("canEdit: true shows the Core & Variables tab and an Edit-mode button on pages (unchanged from characters.ts's own prior behavior)", async () => {
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>(".sheet-tab")).map((t) => t.textContent);
    expect(tabs).toEqual(["Core & Variables", "Overview"]);
    expect(container.querySelector("#page-mode-toggle")).not.toBeNull();
  });

  it("canEdit: false drops the Core & Variables tab entirely, forces every page into View (no Edit button), but chips still post", async () => {
    mountCharacterSheetView(container, baseOptions({ canEdit: false }));
    await flush();

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>(".sheet-tab")).map((t) => t.textContent);
    expect(tabs).toEqual(["Overview"]); // no "Core & Variables"
    expect(container.querySelector("#page-mode-toggle")).toBeNull(); // no Edit button at all
    expect(container.querySelector("#add-page-btn")).toBeNull();
    expect(container.querySelector("#delete-page-btn")).toBeNull();

    const chip = container.querySelector<HTMLButtonElement>(".page-preview .chat-chip")!;
    expect(chip).not.toBeNull();
    chip.click();
    expect(posted).toEqual([["HP", "7"]]);
  });

  it("renders a {{expression}} inline as a computed value box, live against the character's REAL variableValues -- docs/CHARACTER_SHEET_IMPORT.md part 1", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "HP: {{20 + (10 * {toughness}) + {hpBonus}}}", variableIds: [] }];
    character.variableValues = { toughness: 5, hpBonus: 0 };
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const box = container.querySelector(".page-preview .computed-value")!;
    expect(box).not.toBeNull();
    expect(box.textContent).toBe("70"); // 20 + (10*5) + 0
  });

  it("an expression's own :button suffix renders a clickable chip, posting the expression text + computed value, same mechanism a variable/library-call chip already uses", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "Initiative check: {{10 + {agility}:button}}", variableIds: [] }];
    character.variableValues = { agility: 6 };
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const chip = container.querySelector<HTMLButtonElement>(".page-preview .chat-chip")!;
    expect(chip).not.toBeNull();
    chip.click();
    expect(posted).toEqual([["10 + {agility}", "16"]]);
  });

  it("an unresolvable expression (unknown variable) renders a bracketed error marker instead of silently showing nothing", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "X: {{1 + {doesNotExist}}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    expect(container.querySelector(".page-preview")!.textContent).toContain("invalid expression");
  });

  it("canEdit: false with no sheet yet shows a plain message, no 'start' buttons (those are editing actions)", async () => {
    character.customSheet = null;
    mountCharacterSheetView(container, baseOptions({ canEdit: false }));
    await flush();

    expect(container.textContent).toContain("doesn't have a sheet yet");
    expect(container.querySelector("#start-blank-btn")).toBeNull();
    expect(container.querySelector(".start-template-btn")).toBeNull();
  });

  it("canEdit: true with no sheet yet still offers 'start a blank sheet' / 'start from template'", async () => {
    character.customSheet = null;
    const templates: CharacterSheetTemplateCatalogEntry[] = [{ modId: "default", manifest: { id: "default", name: "Default", version: "0.1.0", entry: "entry.ts" }, template: { name: "Default", pages: [], variables: [] } }];
    mountCharacterSheetView(container, baseOptions({ templates }));
    await flush();

    expect(container.querySelector("#start-blank-btn")).not.toBeNull();
    expect(container.querySelector(".start-template-btn")).not.toBeNull();
  });

  it("saveSheet uses viewerAccountId (not sheetOwnerAccountId) for the PUT -- a GM editing a shared character authenticates as themselves", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { method?: string; body?: string }) => {
        if (url.includes("/sheet") && init?.method === "PUT") {
          bodies.push(init.body!);
          return Promise.resolve(jsonResponse(character));
        }
        return mockFetch(url, init);
      }),
    );
    mountCharacterSheetView(container, baseOptions({ viewerAccountId: "admin-9" }));
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // Core & Variables
    await flush();
    container.querySelector<HTMLButtonElement>("#add-variable-btn")!.click();
    await flush();

    expect(bodies.length).toBeGreaterThan(0);
    expect(JSON.parse(bodies[0]).accountId).toBe("admin-9");
  });

  it("refresh() re-renders the dependency warning and, if Core & Variables is the active tab, its content", async () => {
    character.templateId = "some-mod";
    const controller = mountCharacterSheetView(container, baseOptions());
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // Core & Variables
    await flush();
    expect(container.querySelector(".dependency-warning")).not.toBeNull();

    controller.refresh([{ modId: "some-mod", manifest: { id: "some-mod", name: "Some Mod", version: "0.1.0", entry: "entry.ts" }, template: { name: "Some Mod", pages: [], variables: [] } }], [], ["some-mod"]);
    expect(container.querySelector(".dependency-warning")).toBeNull(); // now imported, warning clears
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as XLSX from "xlsx";
import { mountCharacterSheetView, type CharacterSheetViewOptions } from "./characterSheetView.js";
import type { CharacterRecord, CharacterSheetTemplateCatalogEntry, CharacterSheetLibraryCatalogEntry, CharacterSheetPreviewResult } from "./api.js";

let container: HTMLElement;
let character: CharacterRecord;
let previewResponse: CharacterSheetPreviewResult;
const posted: [string, string][] = [];
const saved: CharacterRecord[] = [];

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
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
  previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [] };
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

  it("renders a {{expression}} inline as a computed value box -- docs/CHARACTER_SHEET_IMPORT.md part 1. Real correction, 2026-10-25: the server (not this client) actually evaluates it now (@dice-roller/rpg-dice-roller must never run client-side), so this test just confirms the client correctly RENDERS whatever expressionSegments the server's own preview response came back with", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "HP: {{20 + (10 * {toughness}) + {hpBonus}}}", variableIds: [] }];
    previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [{ start: 4, end: 44, expression: "20 + (10 * {toughness}) + {hpBonus}", display: "box", value: 70 }] };
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const box = container.querySelector(".page-preview .computed-value")!;
    expect(box).not.toBeNull();
    expect(box.textContent).toBe("70");
  });

  it("an expression's own :button suffix renders a clickable chip, posting the expression text + computed value, same mechanism a variable/library-call chip already uses", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "Initiative check: {{10 + {agility}:button}}", variableIds: [] }];
    previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [{ start: 19, end: 43, expression: "10 + {agility}", display: "button", value: 16, text: "10 + 6: 10+6 = 16" }] };
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const chip = container.querySelector<HTMLButtonElement>(".page-preview .chat-chip")!;
    expect(chip).not.toBeNull();
    chip.click();
    expect(posted).toEqual([["10 + {agility}", "16"]]);
  });

  it("an expression error (unknown variable, bad syntax, or dice-not-allowed) renders in red, not just a plain bracketed marker -- real request: \"catch and display other parser errors... in red\"", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "X: {{1 + {doesNotExist}}}", variableIds: [] }];
    previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [{ start: 3, end: 25, expression: "1 + {doesNotExist}", display: "box", error: "unknown or non-numeric variable" }] };
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const errorEl = container.querySelector<HTMLElement>(".page-preview .expression-error")!;
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toBe("unknown or non-numeric variable");
    expect(errorEl.style.color).toBe("red");
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
    const templates: CharacterSheetTemplateCatalogEntry[] = [{ modId: "default", manifest: { id: "default", name: "Default", version: "0.1.0", entry: "entry.ts" }, template: { name: "Default", pages: [], variables: [] }, hasImporter: false }];
    mountCharacterSheetView(container, baseOptions({ templates }));
    await flush();

    expect(container.querySelector("#start-blank-btn")).not.toBeNull();
    expect(container.querySelector(".start-template-btn")).not.toBeNull();
  });

  it("'Import from URL' only shows for a template whose mod actually has an importer (hasImporter), not every template", async () => {
    character.customSheet = null;
    const templates: CharacterSheetTemplateCatalogEntry[] = [
      { modId: "default", manifest: { id: "default", name: "Default", version: "0.1.0", entry: "entry.ts" }, template: { name: "Default", pages: [], variables: [] }, hasImporter: false },
      { modId: "lyrian-chronicles", manifest: { id: "lyrian-chronicles", name: "Lyrian Chronicles", version: "0.1.0", entry: "entry.ts" }, template: { name: "Lyrian Chronicles", pages: [], variables: [] }, hasImporter: true },
    ];
    mountCharacterSheetView(container, baseOptions({ templates }));
    await flush();

    const importRows = container.querySelectorAll(".import-row");
    expect(importRows).toHaveLength(1);
    expect(importRows[0].getAttribute("data-mod-id")).toBe("lyrian-chronicles");
  });

  it("importing from a URL fetches+parses the sheet, uploads it to the right mod's importer, and lands on the resulting sheet -- docs/CHARACTER_SHEET_IMPORT.md, part 1", async () => {
    character.customSheet = null;
    const templates: CharacterSheetTemplateCatalogEntry[] = [
      { modId: "lyrian-chronicles", manifest: { id: "lyrian-chronicles", name: "Lyrian Chronicles", version: "0.1.0", entry: "entry.ts" }, template: { name: "Lyrian Chronicles", pages: [], variables: [] }, hasImporter: true },
    ];
    const importedCharacter: CharacterRecord = { ...character, templateId: "lyrian-chronicles", customSheet: { name: "Lyrian Chronicles", pages: [{ title: "Core", markdown: "HP: {hp}", variableIds: ["hp"] }], variables: [{ id: "hp", label: "HP", type: "number", default: 70 }], bars: [] }, variableValues: { hp: 70 } };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name", "Alba", "HP", 70]]), "Core");
    const xlsxBuffer = XLSX.write(workbook, { type: "array" }) as ArrayBuffer;
    const importRequests: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { method?: string; body?: string }) => {
        if (url === "https://example.com/sheet.xlsx") return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(xlsxBuffer) } as Response);
        if (url.includes("/import-sheet") && init?.method === "POST") {
          importRequests.push({ url, body: init.body! });
          return Promise.resolve(jsonResponse(importedCharacter));
        }
        return mockFetch(url, init);
      }),
    );

    mountCharacterSheetView(container, baseOptions({ templates }));
    await flush();

    container.querySelector<HTMLInputElement>(".import-url-input")!.value = "https://example.com/sheet.xlsx";
    container.querySelector<HTMLButtonElement>(".import-from-url-btn")!.click();
    await flush();
    await flush(); // the real fetch+parse+upload chain is a few microtask hops deeper than a plain PUT

    expect(importRequests).toHaveLength(1);
    const body = JSON.parse(importRequests[0].body) as { accountId: string; modId: string };
    expect(body.accountId).toBe("viewer-1");
    expect(body.modId).toBe("lyrian-chronicles");
    expect(container.querySelector(".sheet-tab")?.textContent).toBe("Core & Variables"); // landed on the real sheet shell, not still the start-prompt
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

    controller.refresh([{ modId: "some-mod", manifest: { id: "some-mod", name: "Some Mod", version: "0.1.0", entry: "entry.ts" }, template: { name: "Some Mod", pages: [], variables: [] }, hasImporter: false }], [], ["some-mod"]);
    expect(container.querySelector(".dependency-warning")).toBeNull(); // now imported, warning clears
  });
});

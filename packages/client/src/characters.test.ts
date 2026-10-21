import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountCharactersPage } from "./characters.js";
import type { ModManifest, CharacterRecord, CharacterSheetTemplateCatalogEntry, CharacterSheetPreviewResult } from "./api.js";

let container: HTMLElement;

const availableMods: ModManifest[] = [
  { id: "default-character-sheet", name: "Default Character Sheet", version: "0.1.0", entry: "entry.ts", characterSheet: true },
  { id: "example-noop", name: "Example (no-op)", version: "0.1.0", entry: "entry.ts" }, // not characterSheet-flagged -- must NOT appear in the list
];
let importedModIds: string[];
let character: CharacterRecord;
let templates: CharacterSheetTemplateCatalogEntry[];
let previewResponse: CharacterSheetPreviewResult;

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

function mockFetch(url: string, init?: { method?: string; body?: string }): Promise<Response> {
  const method = init?.method ?? "GET";

  if (url.endsWith("/mods") && !url.includes("/accounts/")) return Promise.resolve(jsonResponse(availableMods));
  if (url.includes("/character-sheet-templates")) return Promise.resolve(jsonResponse(templates));
  if (url.includes("/character-sheet-preview") && method === "POST") return Promise.resolve(jsonResponse(previewResponse));

  if (/\/accounts\/[^/]+\/mods\/[^/]+$/.test(url) && method === "DELETE") {
    const modId = url.split("/mods/")[1]!;
    importedModIds = importedModIds.filter((id) => id !== modId);
    return Promise.resolve(jsonResponse(importedModIds));
  }

  if (url.endsWith("/mods") && url.includes("/accounts/")) {
    if (method === "POST") {
      const { modId } = JSON.parse(init!.body!) as { modId: string };
      if (!importedModIds.includes(modId)) importedModIds = [...importedModIds, modId];
      return Promise.resolve(jsonResponse(importedModIds));
    }
    return Promise.resolve(jsonResponse(importedModIds));
  }

  if (url.endsWith("/characters")) return Promise.resolve(jsonResponse([character]));

  if (url.includes("/sheet") && method === "PUT") {
    const body = JSON.parse(init!.body!) as { templateId: string | null; customSheet: CharacterRecord["customSheet"]; variableValues: Record<string, number | string> };
    character = { ...character, ...body };
    return Promise.resolve(jsonResponse(character));
  }

  throw new Error(`unexpected fetch in test: ${method} ${url}`);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  importedModIds = [];
  previewResponse = { resolvedMarkdown: "", segments: [] };
  character = {
    id: "char-1",
    ownerAccountId: "account-1",
    name: "Aria",
    token: { color: [1, 0, 0] },
    hp: 10,
    maxHp: 10,
    mp: 10,
    maxMp: 10,
    statusEffects: [],
    createdAt: 0,
    templateId: null,
    customSheet: null,
    variableValues: {},
  };
  templates = [
    {
      modId: "default-character-sheet",
      manifest: availableMods[0],
      template: {
        name: "Default Character Sheet",
        variables: [{ id: "str", label: "Strength", type: "number", default: 10 }],
        pages: [{ title: "Overview", markdown: "Strength modifier: {{default-character-sheet.modifier(str)}}", variableIds: ["str"] }],
      },
    },
  ];
  vi.stubGlobal("fetch", vi.fn(mockFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mountCharactersPage", () => {
  it("renders only character-sheet-flagged mods (example-noop is excluded) and the account's characters", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const modItems = container.querySelectorAll<HTMLLIElement>(".mod-list li");
    expect(modItems.length).toBe(1);
    expect(modItems[0].textContent).toContain("Default Character Sheet");
    expect(container.querySelector(".mod-list")!.textContent).not.toContain("Example");
    expect(container.querySelectorAll("#char-list button").length).toBe(1);
  });

  it("importing a mod flips only that button in place, without rebuilding the whole list", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const button = container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!;
    expect(button.textContent).toBe("Import");
    button.click();
    await flush();

    expect(button.textContent).toBe("Remove");
    expect(container.querySelectorAll(".mod-toggle-btn").length).toBe(1);
  });

  it("shows a start prompt for a character with no sheet yet; 'start blank' creates a tabbed sheet defaulting to the Overview page in View mode", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    expect(container.querySelector("#start-blank-btn")).not.toBeNull();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    expect(character.customSheet).not.toBeNull();
    const tabs = container.querySelectorAll<HTMLButtonElement>(".sheet-tab");
    expect(Array.from(tabs).map((t) => t.textContent)).toEqual(["Core & Variables", "Overview"]);
    expect(tabs[1].classList.contains("active")).toBe(true); // a freshly-started sheet lands on its one real page, not Core
    expect(container.querySelector(".page-preview")).not.toBeNull(); // View mode by default
    expect(container.querySelector(".page-markdown")).toBeNull();
  });

  it("'start from template' clones the template's pages/variables into customSheet -- editing afterward never touches the mod again", async () => {
    importedModIds = ["default-character-sheet"];
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    expect(character.templateId).toBe("default-character-sheet");
    expect(character.customSheet!.variables.map((v) => v.id)).toEqual(["str"]);
    character.customSheet!.variables.push({ id: "extra", label: "Extra", type: "number", default: 0 });
    expect(templates[0].template.variables.length).toBe(1); // independent copy, not a live reference
  });

  it("switching to the Core & Variables tab shows the reserved body-size widgets and the variable-definitions editor; switching back shows the page", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    const [coreTabBtn, pageTabBtn] = Array.from(container.querySelectorAll<HTMLButtonElement>(".sheet-tab"));
    coreTabBtn.click();
    await flush();
    expect(container.querySelector("#body-size-section")!.textContent).toContain("Body width");
    expect(container.querySelector("#variable-def-list")).not.toBeNull();

    pageTabBtn.click();
    await flush();
    expect(container.querySelector("#body-size-section")).toBeNull();
    expect(container.querySelector(".page-preview")).not.toBeNull();
  });

  it("View mode resolves the preview on initial render, without requiring a prior edit (round 3 bug fix)", async () => {
    importedModIds = ["default-character-sheet"];
    previewResponse = {
      resolvedMarkdown: "Strength modifier: 0",
      segments: [{ start: 20, end: 61, modId: "default-character-sheet", functionName: "modifier", args: ["str"], value: "0" }],
    };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    const preview = container.querySelector(".page-preview")!;
    expect(preview.textContent).toContain("Strength modifier:");
    expect(preview.querySelector(".roll-chip")).not.toBeNull(); // resolved as a clickable chip, not left as literal {{...}} text
    expect(preview.textContent).not.toContain("{{");
  });

  it("the Edit/View toggle swaps between the raw-markdown textarea and the rendered preview, each full-width (not side by side)", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    expect(container.querySelector(".page-preview")).not.toBeNull();
    expect(container.querySelector(".page-markdown")).toBeNull();

    container.querySelector<HTMLButtonElement>("#page-mode-toggle")!.click();
    await flush();
    expect(container.querySelector(".page-markdown")).not.toBeNull();
    expect(container.querySelector(".page-preview")).toBeNull();

    container.querySelector<HTMLButtonElement>("#page-mode-toggle")!.click();
    await flush();
    expect(container.querySelector(".page-preview")).not.toBeNull();
    expect(container.querySelector(".page-markdown")).toBeNull();
  });

  it("editing markdown in Edit mode debounce-saves", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#page-mode-toggle")!.click();
    await flush();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const textarea = container.querySelector<HTMLTextAreaElement>(".page-markdown")!;
    textarea.value = "New content";
    textarea.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(600);
    expect(character.customSheet!.pages[0].markdown).toBe("New content");
  });

  it("a page's own variables render their VALUE widgets directly on the page (not just in Core & Variables)", async () => {
    importedModIds = ["default-character-sheet"];
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    // The cloned "Overview" page lists "str" in its variableIds.
    expect(container.querySelector("#sheet-tab-content")!.textContent).toContain("Strength");
    expect(container.querySelector(".sheet-widget-number")).not.toBeNull();
  });

  it("adding and deleting a page works via the sheet tab bar, and always keeps at least one page", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    container.querySelector<HTMLButtonElement>("#add-page-btn")!.click();
    await flush();
    // "Core & Variables" + 2 pages = 3 tabs.
    expect(container.querySelectorAll(".sheet-tab").length).toBe(3);
    expect(character.customSheet!.pages.length).toBe(2);

    container.querySelector<HTMLButtonElement>("#delete-page-btn")!.click();
    await flush();
    expect(container.querySelectorAll(".sheet-tab").length).toBe(2);

    container.querySelector<HTMLButtonElement>("#delete-page-btn")!.click();
    await flush();
    expect(container.querySelectorAll(".sheet-tab").length).toBe(2); // can't delete the last page
  });

  it("adding a variable (in Core & Variables), assigning it to a page, and deleting it all work and persist", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // "Core & Variables" is the first tab
    await flush();

    container.querySelector<HTMLButtonElement>("#add-variable-btn")!.click();
    await flush();
    expect(character.customSheet!.variables.length).toBe(1);
    const newVarId = character.customSheet!.variables[0].id;

    const pagesSelect = container.querySelector<HTMLSelectElement>(".var-pages")!;
    pagesSelect.options[0].selected = true;
    pagesSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(character.customSheet!.pages[0].variableIds).toContain(newVarId);

    container.querySelector<HTMLButtonElement>(".delete-var-btn")!.click();
    await flush();
    expect(character.customSheet!.variables.length).toBe(0);
    expect(character.customSheet!.pages[0].variableIds).not.toContain(newVarId);
  });

  it("shows the dependency warning when the cloned-from mod isn't imported, and clears it once imported", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    expect(container.querySelector(".dependency-warning")).not.toBeNull();

    container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.click();
    await flush();
    expect(container.querySelector(".dependency-warning")).toBeNull();
  });

  it("clicking a roll chip posts its label and value to the test chat panel", async () => {
    importedModIds = ["default-character-sheet"];
    previewResponse = {
      resolvedMarkdown: "Strength modifier: 3",
      segments: [{ start: 20, end: 61, modId: "default-character-sheet", functionName: "modifier", args: ["str"], value: "3" }],
    };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    container.querySelector<HTMLButtonElement>(".roll-chip")!.click();
    const testChatMessages = container.querySelector("#test-chat-messages")!;
    expect(testChatMessages.textContent).toContain("Aria");
    expect(testChatMessages.textContent).toContain("default-character-sheet.modifier");
    expect(testChatMessages.textContent).toContain("3");
  });
});

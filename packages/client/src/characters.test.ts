import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountCharactersPage } from "./characters.js";
import type { ModManifest, CharacterRecord, CharacterSheetTemplateCatalogEntry } from "./api.js";

let container: HTMLElement;

const availableMods: ModManifest[] = [
  { id: "default-character-sheet", name: "Default Character Sheet", version: "0.1.0", entry: "entry.ts", characterSheet: true },
  { id: "example-noop", name: "Example (no-op)", version: "0.1.0", entry: "entry.ts" }, // not characterSheet-flagged -- must NOT appear in the list
];
let importedModIds: string[];
let character: CharacterRecord;
let templates: CharacterSheetTemplateCatalogEntry[];
let previewResolvedMarkdown: string;

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

function mockFetch(url: string, init?: { method?: string; body?: string }): Promise<Response> {
  const method = init?.method ?? "GET";

  if (url.endsWith("/mods") && !url.includes("/accounts/")) return Promise.resolve(jsonResponse(availableMods));
  if (url.includes("/character-sheet-templates")) return Promise.resolve(jsonResponse(templates));
  if (url.includes("/character-sheet-preview") && method === "POST") return Promise.resolve(jsonResponse({ resolvedMarkdown: previewResolvedMarkdown }));

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
  previewResolvedMarkdown = "";
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
        variables: [{ id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 }],
        pages: [{ title: "Overview", markdown: "# Overview\n\nSafe text.", variableIds: ["hp"] }],
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
    expect(container.querySelector("#sheet-section h2")!.textContent).toContain("Aria");
  });

  it("importing a mod flips only that button in place, without rebuilding the whole list", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const button = container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!;
    expect(button.textContent).toBe("Import");
    button.click();
    await flush();

    expect(button.textContent).toBe("Remove");
    expect(container.querySelectorAll(".mod-toggle-btn").length).toBe(1); // still the same single button, not duplicated/rebuilt
  });

  it("shows a start prompt for a character with no sheet yet; 'start blank' creates an empty, editable customSheet", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    expect(container.querySelector("#start-blank-btn")).not.toBeNull();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    expect(character.customSheet).not.toBeNull();
    expect(container.querySelector("#page-tabs")).not.toBeNull();
    expect(container.querySelector("#page-markdown")).not.toBeNull();
  });

  it("'start from template' clones the template's pages/variables into customSheet -- editing afterward never touches the mod again", async () => {
    importedModIds = ["default-character-sheet"];
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    expect(character.templateId).toBe("default-character-sheet");
    expect(character.customSheet!.variables.map((v) => v.id)).toEqual(["hp"]);
    // A real, independent copy -- mutating it must not mutate the catalog entry.
    character.customSheet!.variables.push({ id: "extra", label: "Extra", type: "number", default: 0 });
    expect(templates[0].template.variables.length).toBe(1);
  });

  it("always renders the three reserved body-size variables once a sheet exists, regardless of its content", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    const bodySection = container.querySelector("#body-size-section")!;
    expect(bodySection.textContent).toContain("Body width");
    expect(bodySection.textContent).toContain("Body height");
    expect(bodySection.textContent).toContain("Body depth");
  });

  it("editing the page markdown updates the local preview instantly, then debounce-fetches and renders the resolved preview", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    // Fake timers only from here on -- the setup above needs real
    // timers for its own setTimeout-based flush() to resolve at all.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const textarea = container.querySelector<HTMLTextAreaElement>("#page-markdown")!;
    previewResolvedMarkdown = "RESOLVED: 42";
    textarea.value = "{{some-mod.fn}}";
    textarea.dispatchEvent(new Event("input"));

    // Instant local render, before the debounce fires -- unresolved call shown literally.
    expect(container.querySelector("#page-preview")!.textContent).toContain("{{some-mod.fn}}");

    await vi.advanceTimersByTimeAsync(600);
    expect(container.querySelector("#page-preview")!.textContent).toContain("RESOLVED: 42");
  });

  it("adding and deleting a page works, and always keeps at least one page", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    container.querySelector<HTMLButtonElement>("#add-page-btn")!.click();
    await flush();
    expect(container.querySelectorAll(".page-tab").length).toBe(2);
    expect(character.customSheet!.pages.length).toBe(2);

    container.querySelector<HTMLButtonElement>("#delete-page-btn")!.click();
    await flush();
    expect(container.querySelectorAll(".page-tab").length).toBe(1);

    // Can't delete the last page.
    container.querySelector<HTMLButtonElement>("#delete-page-btn")!.click();
    await flush();
    expect(container.querySelectorAll(".page-tab").length).toBe(1);
  });

  it("adding a variable, assigning it to a page, and deleting it all work and persist", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();

    container.querySelector<HTMLButtonElement>("#add-variable-btn")!.click();
    await flush();
    expect(character.customSheet!.variables.length).toBe(1);
    const newVarId = character.customSheet!.variables[0].id;

    const pagesSelect = container.querySelector<HTMLSelectElement>(".var-pages")!;
    pagesSelect.options[0].selected = true;
    // The "change" listener is delegated on the parent <ul> -- needs
    // bubbles:true to reach it (unlike a real browser-dispatched
    // change event, which always bubbles by default).
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
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountCharactersPage } from "./characters.js";
import type { ModManifest, CharacterRecord, CharacterSheetTemplateCatalogEntry } from "./api.js";

let container: HTMLElement;

const availableMods: ModManifest[] = [{ id: "default-character-sheet", name: "Default Character Sheet", version: "0.1.0", entry: "entry.ts" }];
let importedModIds: string[];
let character: CharacterRecord;
let templates: CharacterSheetTemplateCatalogEntry[];

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

function mockFetch(url: string, init?: { method?: string; body?: string }): Promise<Response> {
  const method = init?.method ?? "GET";

  if (url.endsWith("/mods") && !url.includes("/accounts/")) return Promise.resolve(jsonResponse(availableMods));

  if (url.includes("/character-sheet-templates")) return Promise.resolve(jsonResponse(templates));

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
    const { templateId, variableValues } = JSON.parse(init!.body!) as { templateId: string | null; variableValues: Record<string, number | string> };
    character = { ...character, templateId, variableValues };
    return Promise.resolve(jsonResponse(character));
  }

  throw new Error(`unexpected fetch in test: ${method} ${url}`);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  importedModIds = [];
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
    variableValues: {},
  };
  templates = [
    {
      modId: "default-character-sheet",
      manifest: availableMods[0],
      template: {
        name: "Default Character Sheet",
        variables: [{ id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 }],
        pages: [{ title: "Overview", markdown: "# Overview\n\n<script>alert('xss')</script>\n\nSafe text.", variableIds: ["hp"] }],
      },
    },
  ];
  vi.stubGlobal("fetch", vi.fn(mockFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mountCharactersPage", () => {
  it("renders the mods list and the account's characters on mount", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const modItems = container.querySelectorAll<HTMLLIElement>(".mod-list li");
    expect(modItems.length).toBe(1);
    expect(modItems[0].querySelector<HTMLButtonElement>(".mod-toggle-btn")!.textContent).toBe("Import");

    expect(container.querySelectorAll("#char-list button").length).toBe(1);
    expect(container.querySelector("#sheet-section h2")!.textContent).toContain("Aria");
  });

  it("importing a mod flips its button and refreshes the dependency warning for the selected template", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    // Pick the template before it's imported -- the warning should appear.
    const templateSelect = container.querySelector<HTMLSelectElement>("#template-select")!;
    templateSelect.value = "default-character-sheet";
    templateSelect.dispatchEvent(new Event("change"));
    await flush();
    expect(container.querySelector(".dependency-warning")).not.toBeNull();

    container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.click();
    await flush();

    expect(container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.textContent).toBe("Remove");
    expect(container.querySelector(".dependency-warning")).toBeNull();
  });

  it("renders a template's pages with sanitized markdown (script tags stripped) and working variable widgets bound to the character", async () => {
    importedModIds = ["default-character-sheet"];
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const templateSelect = container.querySelector<HTMLSelectElement>("#template-select")!;
    templateSelect.value = "default-character-sheet";
    templateSelect.dispatchEvent(new Event("change"));
    await flush();

    const markdownEl = container.querySelector(".sheet-page .markdown")!;
    expect(markdownEl.innerHTML).not.toContain("<script>");
    expect(markdownEl.textContent).toContain("Overview");
    expect(markdownEl.textContent).toContain("Safe text.");

    const hpCurrent = container.querySelector<HTMLInputElement>(".sheet-widget-xofy-current")!;
    expect(hpCurrent.value).toBe("10"); // default, since character.variableValues.hp isn't set yet

    hpCurrent.value = "4";
    hpCurrent.dispatchEvent(new Event("change"));
    await flush();
    expect(character.variableValues.hp).toBe(4);
  });

  it("always renders the three reserved body-size variables regardless of template selection", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const bodySection = container.querySelector("#body-size-section")!;
    expect(bodySection.textContent).toContain("Body width");
    expect(bodySection.textContent).toContain("Body height");
    expect(bodySection.textContent).toContain("Body depth");
  });
});

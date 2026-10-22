import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountCharactersPage } from "./characters.js";
import type { ModManifest, CharacterRecord, CharacterSheetTemplateCatalogEntry, CharacterSheetLibraryCatalogEntry, CharacterSheetPreviewResult } from "./api.js";

let container: HTMLElement;

const availableMods: ModManifest[] = [
  { id: "default", name: "Default Character Sheet", version: "0.1.0", entry: "entry.ts", characterSheet: true },
  { id: "example-noop", name: "Example (no-op)", version: "0.1.0", entry: "entry.ts" }, // not characterSheet-flagged -- must NOT appear in the list
];
let importedModIds: string[];
let character: CharacterRecord;
let templates: CharacterSheetTemplateCatalogEntry[];
let libraries: CharacterSheetLibraryCatalogEntry[];
let previewResponse: CharacterSheetPreviewResult;

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

function mockFetch(url: string, init?: { method?: string; body?: string }): Promise<Response> {
  const method = init?.method ?? "GET";

  if (url.endsWith("/mods") && !url.includes("/accounts/")) return Promise.resolve(jsonResponse(availableMods));
  if (url.includes("/character-sheet-libraries")) return Promise.resolve(jsonResponse(libraries));
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

  if (url.endsWith("/characters") && method === "POST") {
    const { name, color } = JSON.parse(init!.body!) as { name: string; color: [number, number, number] };
    const created: CharacterRecord = { id: `char-${name}`, ownerAccountId: "account-1", name, token: { color }, statusEffects: [], createdAt: 0, templateId: null, customSheet: null, variableValues: {} };
    return Promise.resolve(jsonResponse(created));
  }
  if (url.endsWith("/characters")) return Promise.resolve(jsonResponse([character]));

  if (/\/characters\/[^/?]+\?accountId=/.test(url) && method === "DELETE") return Promise.resolve(jsonResponse({ ok: true }));

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
    statusEffects: [],
    createdAt: 0,
    templateId: null,
    customSheet: null,
    variableValues: {},
  };
  templates = [
    {
      modId: "default",
      manifest: availableMods[0],
      template: {
        name: "Default Character Sheet",
        variables: [{ id: "str", label: "Strength", type: "number", default: 10 }],
        pages: [{ title: "Overview", markdown: "Strength: {str}, modifier: {{default.modifier(str)}}", variableIds: ["str"] }],
      },
    },
  ];
  libraries = [];
  vi.stubGlobal("fetch", vi.fn(mockFetch));
});

afterEach(() => {
  // Real bug found live (test-only, not a characters.ts bug): leaving
  // the old container attached left its id="variable-def-list" (etc.)
  // duplicated across every later test's own container. An ID-anchored
  // descendant selector like `#variable-def-list .foo`, scoped via
  // `container.querySelector(...)`, can then resolve against the
  // FIRST such id in the whole document rather than the one actually
  // inside `container` -- confirmed directly (document had 2 matching
  // ids; `container.querySelectorAll` alone found the right one, but
  // the combined descendant selector didn't). Removing each test's
  // container keeps ids unique across the whole suite, like lobby.ts's
  // own real page would ever only have one on screen at a time.
  container.remove();
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
    expect(container.querySelectorAll("#char-list .select-char-btn").length).toBe(1);
  });

  it("MVP goal item 4 follow-up: the delete button asks for confirmation first -- declining leaves the character untouched, confirming deletes it and clears the empty sheet section", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    container.querySelector<HTMLButtonElement>(".delete-char-btn")!.click();
    await flush();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Aria"));
    expect(container.querySelectorAll("#char-list .select-char-btn").length).toBe(1); // declined -- still there

    confirmSpy.mockReturnValue(true);
    container.querySelector<HTMLButtonElement>(".delete-char-btn")!.click();
    await flush();
    expect(container.querySelectorAll("#char-list .select-char-btn").length).toBe(0);
    expect(container.querySelector("#sheet-section")!.innerHTML).toBe(""); // no character left selected
    confirmSpy.mockRestore();
  });

  it("MVP goal item 4 follow-up: '+ Create new character' actually creates one and selects it -- real gap found live (deleting your last character left no way to make a new one on this page)", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    container.querySelector<HTMLInputElement>("#new-character-name")!.value = "Bram";
    container.querySelector<HTMLButtonElement>("#create-character-btn")!.click();
    await flush();

    const names = Array.from(container.querySelectorAll<HTMLButtonElement>("#char-list .select-char-btn")).map((b) => b.textContent);
    expect(names).toEqual(["Aria", "Bram"]);
    expect(container.querySelector<HTMLButtonElement>(".select-char-btn.selected")!.textContent).toBe("Bram"); // newly created one is selected
    expect(container.querySelector<HTMLInputElement>("#new-character-name")!.value).toBe(""); // input cleared for the next one
  });

  it("'+ Create new character' does nothing for a blank name", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    container.querySelector<HTMLButtonElement>("#create-character-btn")!.click();
    await flush();
    expect(container.querySelectorAll("#char-list .select-char-btn").length).toBe(1); // unchanged
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
    importedModIds = ["default"];
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    expect(character.templateId).toBe("default");
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

  it("View mode resolves library calls AND inline variable refs on initial render, without requiring a prior edit (round 3 bug fix, round 4 inline refs)", async () => {
    importedModIds = ["default"];
    previewResponse = {
      resolvedMarkdown: "Strength: 12, modifier: 1",
      segments: [{ start: 18, end: 41, modId: "default", functionName: "modifier", args: ["str"], value: "1", display: "button" }],
    };
    character.variableValues = { str: 12 };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    const preview = container.querySelector(".page-preview")!;
    expect(preview.querySelector(".chat-chip")).not.toBeNull(); // the library call, resolved as a clickable chip
    expect(preview.querySelector(".sheet-widget-number")).not.toBeNull(); // {str} resolved as an inline, editable box -- round 4's actual request
    expect(preview.querySelector<HTMLInputElement>(".sheet-widget-number")!.value).toBe("12");
    expect(preview.textContent).not.toContain("{{");
    expect(preview.textContent).not.toContain("{str}");
  });

  it("an inline {variableId} box sits exactly where written in the markdown and is directly editable, persisting the change (round 4's actual request -- not a list below the page)", async () => {
    importedModIds = ["default"];
    previewResponse = { resolvedMarkdown: "Strength: 10, modifier: 0", segments: [{ start: 14, end: 37, modId: "default", functionName: "modifier", args: ["str"], value: "0", display: "button" }] };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    const input = container.querySelector<HTMLInputElement>(".sheet-widget-number")!;
    input.value = "16";
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(character.variableValues.str).toBe(16);
  });

  it("{variableId:button} renders as a clickable chip instead of a box, posting the CURRENT value to the test chat on click", async () => {
    character.customSheet = { name: "Sheet", pages: [{ title: "Overview", markdown: "HP: {hp:button}", variableIds: ["hp"] }], variables: [{ id: "hp", label: "HP", type: "number", default: 7 }] };
    character.variableValues = { hp: 7 };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const chip = container.querySelector<HTMLButtonElement>(".page-preview .chat-chip")!;
    expect(chip).not.toBeNull();
    chip.click();
    const testChatMessages = container.querySelector("#test-chat-messages")!;
    expect(testChatMessages.textContent).toContain("Aria");
    expect(testChatMessages.textContent).toContain("HP");
    expect(testChatMessages.textContent).toContain("7");
  });

  it("round 5 real correction: an inline xOfY reference shows exactly ONE box (not both together) -- {hp} is current, {hp.y} is max, each independently editable", async () => {
    character.customSheet = {
      name: "Sheet",
      pages: [{ title: "Overview", markdown: "Current: {hp}, Max: {hp.y}", variableIds: ["hp"] }],
      variables: [{ id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 }],
    };
    character.variableValues = { hp: 6 };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const boxes = container.querySelectorAll<HTMLInputElement>(".page-preview input");
    expect(boxes.length).toBe(2); // exactly one box per reference, never two boxes for one reference
    const current = container.querySelector<HTMLInputElement>(".page-preview .sheet-widget-xofy-current")!;
    const max = container.querySelector<HTMLInputElement>(".page-preview .sheet-widget-xofy-max")!;
    expect(current.value).toBe("6");
    expect(max.value).toBe("10");

    max.value = "14";
    max.dispatchEvent(new Event("change"));
    await flush();
    expect(character.variableValues.hpMax).toBe(14);
  });

  it("the Core & Variables tab's variable rows now show a REAL value widget (both boxes for xOfY) -- round 5, this is where round 4 mistakenly put the two-box widget inline instead", async () => {
    character.customSheet = { name: "Sheet", pages: [{ title: "Overview", markdown: "", variableIds: [] }], variables: [{ id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 }] };
    character.variableValues = { hp: 6 };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // "Core & Variables"
    await flush();

    const current = container.querySelector<HTMLInputElement>("#variable-def-list .sheet-widget-xofy-current")!;
    const max = container.querySelector<HTMLInputElement>("#variable-def-list .sheet-widget-xofy-max")!;
    expect(current.value).toBe("6");
    expect(max.value).toBe("10");

    current.value = "9";
    current.dispatchEvent(new Event("change"));
    await flush();
    expect(character.variableValues.hp).toBe(9);
  });

  it("changing a variable's type in Core & Variables swaps its value widget immediately -- xOfY's two boxes disappear, the new type's single box appears (real bug: both used to stay on screen at once)", async () => {
    character.customSheet = { name: "Sheet", pages: [{ title: "Overview", markdown: "", variableIds: [] }], variables: [{ id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 }] };
    character.variableValues = { hp: 6 };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // "Core & Variables"
    await flush();

    expect(container.querySelector("#variable-def-list .sheet-widget-xofy-current")).not.toBeNull();

    const typeSelect = container.querySelector<HTMLSelectElement>(".var-type")!;
    typeSelect.value = "number";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(container.querySelector("#variable-def-list .sheet-widget-xofy-current")).toBeNull();
    expect(container.querySelector("#variable-def-list .sheet-widget-xofy-max")).toBeNull();
    expect(container.querySelectorAll("#variable-def-list .var-value-host input").length).toBe(1); // exactly one box, not accumulated old + new
    expect(container.querySelector("#variable-def-list .sheet-widget-number")).not.toBeNull();
  });

  it("the Core & Variables tab lists each imported mod's library function names, updating when mods change (round 5 -- previously no way to tell)", async () => {
    libraries = [{ modId: "default", manifest: availableMods[0], functionNames: ["modifier"] }];
    character.customSheet = { name: "Sheet", pages: [{ title: "Overview", markdown: "", variableIds: [] }], variables: [] };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // "Core & Variables"
    await flush();

    const libraryList = container.querySelector(".library-list")!;
    expect(libraryList.textContent).toContain("default");
    expect(libraryList.textContent).toContain("modifier");

    libraries = [];
    container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.click(); // any mod toggle triggers a refresh
    await flush();
    expect(container.querySelector(".library-list")!.textContent).toContain("No imported mod provides any library functions");
  });

  it("a {{modId.fn(args):box}} library call renders as a plain, non-clickable value instead of a chat-chip", async () => {
    importedModIds = ["default"];
    previewResponse = { resolvedMarkdown: "Modifier: 1", segments: [{ start: 10, end: 44, modId: "default", functionName: "modifier", args: ["str"], value: "1", display: "box" }] };
    character.customSheet = { name: "Sheet", pages: [{ title: "Overview", markdown: "Modifier: {{default.modifier(str):box}}", variableIds: [] }], variables: [] };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();

    const preview = container.querySelector(".page-preview")!;
    expect(preview.querySelector(".computed-value")).not.toBeNull();
    expect(preview.querySelector(".chat-chip")).toBeNull();
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

  it("Bars section: Add is disabled with no xOfY variables, only offers xOfY variables once one exists, and add/recolor/delete all persist (\"set up what actually display as bars in game\")", async () => {
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // "Core & Variables"
    await flush();

    // No xOfY variable yet -- a plain "number" var doesn't make Add
    // enabled either (a bar needs a current AND a max).
    container.querySelector<HTMLButtonElement>("#add-variable-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#add-bar-btn")!.disabled).toBe(true);
    expect(container.querySelector(".bar-hint")).not.toBeNull();

    const typeSelect = container.querySelector<HTMLSelectElement>(".var-type")!;
    typeSelect.value = "xOfY";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    const addBarBtn = container.querySelector<HTMLButtonElement>("#add-bar-btn")!;
    expect(addBarBtn.disabled).toBe(false);
    addBarBtn.click();
    await flush();
    expect(character.customSheet!.bars).toHaveLength(1);
    const newVarId = character.customSheet!.variables[0].id;
    const barVarOptions = Array.from(container.querySelectorAll<HTMLOptionElement>(".bar-var option")).map((o) => o.value);
    expect(barVarOptions).toEqual([newVarId]); // only xOfY variables offered
    expect(character.customSheet!.bars![0].variableId).toBe(newVarId);

    const colorInput = container.querySelector<HTMLInputElement>(".bar-color")!;
    colorInput.value = "#c0392b";
    colorInput.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(character.customSheet!.bars![0].color.map((c) => Math.round(c * 255))).toEqual([192, 57, 43]);

    container.querySelector<HTMLButtonElement>(".delete-bar-btn")!.click();
    await flush();
    expect(character.customSheet!.bars).toHaveLength(0);
  });

  it("deleting a variable that a bar points at also removes the now-dangling bar entry", async () => {
    character.customSheet = {
      name: "Sheet",
      pages: [{ title: "Overview", markdown: "", variableIds: ["hp"] }],
      variables: [{ id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 }],
      bars: [{ variableId: "hp", color: [1, 0, 0] }],
    };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // "Core & Variables"
    await flush();

    container.querySelector<HTMLButtonElement>(".delete-var-btn")!.click();
    await flush();
    expect(character.customSheet!.bars).toHaveLength(0);
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

  it("clicking a library call's chat-chip posts its label and value to the test chat panel", async () => {
    importedModIds = ["default"];
    previewResponse = {
      resolvedMarkdown: "Strength: 10, modifier: 3",
      segments: [{ start: 14, end: 37, modId: "default", functionName: "modifier", args: ["str"], value: "3", display: "button" }],
    };
    mountCharactersPage(container, "http://test", "account-1");
    await flush();
    container.querySelector<HTMLButtonElement>(".start-template-btn")!.click();
    await flush();

    container.querySelector<HTMLButtonElement>(".chat-chip")!.click();
    const testChatMessages = container.querySelector("#test-chat-messages")!;
    expect(testChatMessages.textContent).toContain("Aria");
    expect(testChatMessages.textContent).toContain("default.modifier");
    expect(testChatMessages.textContent).toContain("3");
  });
});

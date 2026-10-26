import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as XLSX from "xlsx";
import { mountCharacterSheetView, type CharacterSheetViewOptions } from "./characterSheetView.js";
import type { CharacterRecord, CharacterSheetTemplateCatalogEntry, CharacterSheetLibraryCatalogEntry, CharacterSheetPreviewResult } from "./api.js";
import { xOfYMaxKey } from "@ttrpg3d/shared";

let container: HTMLElement;
let character: CharacterRecord;
let previewResponse: CharacterSheetPreviewResult;
const posted: [string, string][] = [];
const postedHtml: (string | undefined)[] = [];
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
    onPostToChat: (label, value, html) => {
      posted.push([label, value]);
      postedHtml.push(html);
    },
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  posted.length = 0;
  postedHtml.length = 0;
  saved.length = 0;
  previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [], compoundRollSegments: [] };
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

  it("renders a {{expression}} inline as a computed value box -- docs/CHARACTER_SHEET_IMPORT.md part 1. Real correction, 2026-10-25 (second pass): plain arithmetic now evaluates entirely client-side (expr-eval), with zero server round trip, so this test sets real variableValues rather than a mocked server response", async () => {
    character.variableValues = { toughness: 5, hpBonus: 0 };
    character.customSheet!.pages = [{ title: "Core", markdown: "HP: {{20 + (10 * {toughness}) + {hpBonus}}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const box = container.querySelector(".page-preview .computed-value")!;
    expect(box).not.toBeNull();
    expect(box.textContent).toBe("70");
  });

  it("an expression's own :button suffix renders a clickable chip, posting the expression text + computed value, same mechanism a variable/library-call chip already uses", async () => {
    character.variableValues = { agility: 6 };
    character.customSheet!.pages = [{ title: "Core", markdown: "Initiative check: {{10 + {agility}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const chip = container.querySelector<HTMLButtonElement>(".page-preview .chat-chip")!;
    expect(chip).not.toBeNull();
    chip.click();
    expect(posted).toEqual([["10 + {agility}", "16"]]);
  });

  it("real correction, 2026-10-26 -- a button-mode expression that genuinely contains dice notation renders as an inert 'Roll' button, NOT auto-rolled on render (a real trust/UX problem: silently re-rolling every time the page merely renders, with no click at all)", async () => {
    character.variableValues = { bonus: 3 };
    character.customSheet!.pages = [{ title: "Core", markdown: "Attack: {{1d20 + {bonus}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    // Nothing fetched yet -- no library calls on this page, and the
    // needsRoll segment doesn't trigger a round trip just to render.
    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .dice-roll-chip")!;
    expect(rollBtn).not.toBeNull();
    expect(rollBtn.textContent).toBe("Roll");
    expect(container.querySelector(".page-preview .chat-chip")).toBeNull(); // not pre-resolved into a chip

    // Clicking it fetches a FRESH roll for just this one segment --
    // real RNG, server-only, same trust boundary as before.
    previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [{ start: 0, end: 25, expression: "1d20 + {bonus}", display: "button", value: 15, text: "1d20+3: [12]+3 = 15" }], compoundRollSegments: [] };
    rollBtn.click();
    await flush();
    await flush();

    expect(rollBtn.textContent).toBe("1d20 + {bonus}: 15");
    expect(posted).toEqual([["1d20 + {bonus}", "15"]]);
    // Real correction, 2026-10-26: "it should just look like 22 and
    // when moused over that special 22 should display the formula
    // behind it, rather than that huge arrow" -- the plain `value`
    // posted above is already just the bare "15"; the richer `html`
    // carries the SAME number with the real breakdown as a tooltip.
    expect(postedHtml[0]).toContain('title="1d20+3: [12]+3 = 15"');
    expect(postedHtml[0]).toContain(">15</span>");
    expect(rollBtn.title).toBe("1d20+3: [12]+3 = 15"); // the button's own face also carries it, for hovering on the sheet itself
  });

  it("clicking a 'Roll' button twice fetches a genuinely FRESH roll each time, not a stale repost of the first result", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "Attack: {{1d20:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .dice-roll-chip")!;
    previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [{ start: 0, end: 11, expression: "1d20", display: "button", value: 5, text: "1d20: [5] = 5" }], compoundRollSegments: [] };
    rollBtn.click();
    await flush();
    await flush();
    expect(posted).toEqual([["1d20", "5"]]);

    previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [{ start: 0, end: 11, expression: "1d20", display: "button", value: 19, text: "1d20: [19] = 19" }], compoundRollSegments: [] };
    rollBtn.click();
    await flush();
    await flush();
    expect(posted).toEqual([
      ["1d20", "5"],
      ["1d20", "19"],
    ]);
  });

  it("a roll that errors (e.g. the server round trip itself fails) shows the error on the button and re-enables it, rather than getting stuck disabled", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "Attack: {{1d20:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .dice-roll-chip")!;
    previewResponse = { resolvedMarkdown: "", segments: [], expressionSegments: [{ start: 0, end: 11, expression: "1d20", display: "button", error: "division by zero" }], compoundRollSegments: [] };
    rollBtn.click();
    await flush();
    await flush();

    expect(rollBtn.textContent).toBe("Error: division by zero");
    expect(rollBtn.disabled).toBe(false);
    expect(posted).toEqual([]); // never posted a half-broken result
  });

  it("real request, 2026-10-26 -- a compound roll ({{Label; part: expr | part: expr}}) renders as one 'Roll <Label>' button, and clicking it bundles every part's own result into one posted message (plain fallback: 'label: value' per part, PLUS an extra 'max label' line for any part marked +max)", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "{{Light Attack; atk: 1d20 + {focus} | damage+max: {lightDamage}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .compound-roll-chip")!;
    expect(rollBtn).not.toBeNull();
    expect(rollBtn.textContent).toBe("Roll Light Attack");
    expect(container.querySelector(".page-preview .dice-roll-chip")).toBeNull(); // not treated as a plain single-expression roll

    previewResponse = {
      resolvedMarkdown: "",
      segments: [],
      expressionSegments: [],
      compoundRollSegments: [
        {
          start: 0,
          end: 74,
          actionLabel: "Light Attack",
          display: "button",
          parts: [
            { label: "atk", expression: "1d20 + {focus}", showMax: false, value: 24, text: "1d20 + 3: [21]+3 = 24" },
            { label: "damage", expression: "{lightDamage}", showMax: true, value: 12, text: "2d4+5: [3, 4]+5 = 12", maxValue: 13 },
          ],
        },
      ],
    };
    rollBtn.click();
    await flush();
    await flush();

    expect(rollBtn.textContent).toBe("Roll Light Attack");
    expect(posted).toEqual([["Light Attack", "atk: 24, damage: 12, max damage: 13"]]);
    const html = postedHtml[0]!;
    expect(html).toContain("<strong>Light Attack</strong>");
    expect(html).toContain('title="1d20 + 3: [21]+3 = 24"');
    expect(html).toContain(">24</span>");
    expect(html).toContain('title="2d4+5: [3, 4]+5 = 12"');
    expect(html).toContain(">12</span>");
    expect(html).toContain("max damage: 13");
  });

  it("a compound roll where one part errors posts nothing at all, rather than a half-rolled result", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "{{Light Attack; atk: 1d20 + {focus} | damage+max: {lightDamage}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .compound-roll-chip")!;
    previewResponse = {
      resolvedMarkdown: "",
      segments: [],
      expressionSegments: [],
      compoundRollSegments: [
        {
          start: 0,
          end: 74,
          actionLabel: "Light Attack",
          display: "button",
          parts: [
            { label: "atk", expression: "1d20 + {focus}", showMax: false, error: "unknown or non-numeric variable" },
            { label: "damage", expression: "{lightDamage}", showMax: true, value: 12, text: "2d4+5: [3, 4]+5 = 12", maxValue: 13 },
          ],
        },
      ],
    };
    rollBtn.click();
    await flush();
    await flush();

    expect(rollBtn.textContent).toBe("Error: unknown or non-numeric variable");
    expect(posted).toEqual([]);
  });

  it("real bug, found live on /characters -- a {variableId} ref NESTED inside a {{expression}} (e.g. the real Lyrian HP formula's own {toughness}) doesn't ALSO get matched as its own separate top-level ref, which would otherwise desync the substitution cursor and garble every segment after it on the page", async () => {
    character.variableValues = { toughness: 5, hpBonus: 0, agility: 6 };
    character.customSheet!.variables = [
      { id: "toughness", label: "Toughness", type: "number", default: 0 },
      { id: "hpBonus", label: "HP Bonus", type: "number", default: 0 },
      { id: "agility", label: "Agility", type: "number", default: 0 },
    ];
    character.customSheet!.pages = [{ title: "Core", markdown: "HP: {{20 + (10 * {toughness}) + {hpBonus}}}\n\nAgility: {agility}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const boxes = container.querySelectorAll(".page-preview .computed-value");
    expect(boxes).toHaveLength(1); // the nested {toughness} must NOT also render as its own separate box
    expect(boxes[0].textContent).toBe("70");
    expect(container.querySelector(".page-preview")!.textContent).toContain("Agility:");
    // The real garbled-output bug: the nested ref's own cursor rollback
    // left stray, un-substituted markdown markers in the final output.
    expect(container.querySelector(".page-preview")!.innerHTML).not.toContain("{toughness}");
    expect(container.querySelector(".page-preview")!.innerHTML).not.toContain("{hpBonus}");
  });

  it("real bug, found live -- a character that just started from a template (empty variableValues) still resolves an expression against each variable's own declared default, same as its plain {variableId} box neighbor already does", async () => {
    character.variableValues = {}; // exactly what renderStartPrompt's start-blank/start-template buttons leave behind
    character.customSheet!.variables = [
      { id: "toughness", label: "Toughness", type: "number", default: 4 },
      { id: "hpBonus", label: "HP Bonus", type: "number", default: 1 },
    ];
    character.customSheet!.pages = [{ title: "Core", markdown: "HP: {{20 + (10 * {toughness}) + {hpBonus}}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    expect(container.querySelector(".page-preview .expression-error")).toBeNull();
    const box = container.querySelector(".page-preview .computed-value")!;
    expect(box).not.toBeNull();
    expect(box.textContent).toBe("61"); // 20 + (10*4) + 1, using each variable's own declared default
  });

  it("an expression error (unknown variable, bad syntax, or dice-not-allowed) renders in red, not just a plain bracketed marker -- real request: \"catch and display other parser errors... in red\"", async () => {
    character.customSheet!.pages = [{ title: "Core", markdown: "X: {{1 + {doesNotExist}}}", variableIds: [] }];
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

  it("real request, 2026-10-26 (second pass) -- editing an xOfY's own {{formula}} max box on the Core & Variables tab updates the variable's own DEFINITION (maxExpression), not variableValues, and is immediately visible as the raw formula text", async () => {
    character.customSheet!.variables = [
      { id: "toughness", label: "Toughness", type: "number", default: 0 },
      { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10, maxExpression: "20 + (10 * {toughness})" },
    ];
    character.variableValues = { toughness: 5 };
    mountCharacterSheetView(container, baseOptions());
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // Core & Variables
    await flush();

    const formulaInput = container.querySelector<HTMLInputElement>(".sheet-widget-xofy-max-formula")!;
    expect(formulaInput).not.toBeNull();
    expect(formulaInput.value).toBe("{{20 + (10 * {toughness})}}");

    formulaInput.value = "{{30 + (10 * {toughness})}}";
    formulaInput.dispatchEvent(new Event("change"));
    await flush();

    expect(saved.at(-1)!.customSheet!.variables[1].maxExpression).toBe("30 + (10 * {toughness})");
    expect(saved.at(-1)!.variableValues.toughness).toBe(5); // unrelated variableValues left alone
  });

  it("real request, 2026-10-26 (second pass) -- typing a plain number into that same box toggles the formula OFF, reverting to an ordinary flat, per-character max", async () => {
    character.customSheet!.variables = [
      { id: "toughness", label: "Toughness", type: "number", default: 0 },
      { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10, maxExpression: "20 + (10 * {toughness})" },
    ];
    character.variableValues = { toughness: 5 };
    mountCharacterSheetView(container, baseOptions());
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // Core & Variables
    await flush();

    const formulaInput = container.querySelector<HTMLInputElement>(".sheet-widget-xofy-max-formula")!;
    formulaInput.value = "25";
    formulaInput.dispatchEvent(new Event("change"));
    await flush();

    const lastSaved = saved.at(-1)!;
    expect(lastSaved.customSheet!.variables[1].maxExpression).toBeUndefined();
    expect(lastSaved.variableValues[xOfYMaxKey("hp")]).toBe(25);
    // The box's own TYPE changes too, now that it's flat again.
    expect(container.querySelector(".sheet-widget-xofy-max-formula")).toBeNull();
    expect(container.querySelector<HTMLInputElement>(".sheet-widget-xofy-max")!.value).toBe("25");
  });
});

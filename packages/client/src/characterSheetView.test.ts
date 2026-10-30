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

let uploadedImages: string[] = [];

function mockFetch(url: string, init?: { method?: string; body?: string }): Promise<Response> {
  const method = init?.method ?? "GET";
  if (url.includes("/character-sheet-preview") && method === "POST") return Promise.resolve(jsonResponse(previewResponse));
  // Real request, 2026-10-29: renderTokenImageUpload (the Core &
  // Variables tab's tokenImage row) always fetches this account's own
  // uploaded-images list now -- defaults to empty so every PRE-
  // EXISTING test that merely opens that tab still works unchanged.
  if (url.includes("/uploads") && method === "GET") return Promise.resolve(jsonResponse({ urls: uploadedImages }));
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
  uploadedImages = [];
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

    // Real correction, 2026-10-26 (third pass): "it expands into the
    // formula being rolled instead of remaining 'roll'" -- the button
    // is a reusable ACTION trigger, not a one-shot display of its own
    // last result; it stays "Roll" whether it just succeeded or not.
    expect(rollBtn.textContent).toBe("Roll");
    expect(posted).toEqual([["1d20 + {bonus}", "15"]]);
    // "it should just look like 22 and when moused over that special
    // 22 should display the formula behind it, rather than that huge
    // arrow" -- the plain `value` posted above is already just the
    // bare "15"; the richer `html` carries the SAME number with the
    // real breakdown as a tooltip.
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

  it("real request, 2026-10-26 (third pass) -- a compound roll ({{Label; part: expr | part: expr}}) renders as a button showing just the label itself (not 'Roll <Label>'), and clicking it bundles every part's own result into one posted message (plain fallback: 'label: value' per part, PLUS an extra 'max label' line for any part marked +max)", async () => {
    character.variableValues = { hp: 7, focus: 3, lightDamage: "2d4+5" }; // real dice in both parts -- forces the server round trip
    character.customSheet!.pages = [{ title: "Core", markdown: "{{Light Attack; atk: 1d20 + {focus} | damage+max: {lightDamage}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .compound-roll-chip")!;
    expect(rollBtn).not.toBeNull();
    expect(rollBtn.textContent).toBe("Light Attack");
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

    expect(rollBtn.textContent).toBe("Light Attack");
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

  it("real request, 2026-10-26 (third pass) -- a single-part, no-dice compound roll (e.g. Evasion) resolves and posts ENTIRELY client-side, no server round trip at all", async () => {
    character.variableValues = { hp: 7, agility: 6, evasionBonus: 2 };
    character.customSheet!.pages = [{ title: "Core", markdown: "{{Evasion; evasion: 7 + {agility} + {evasionBonus}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .compound-roll-chip")!;
    expect(rollBtn.textContent).toBe("Evasion");
    previewResponse = undefined as unknown as CharacterSheetPreviewResult; // never consulted -- a fetch here would throw in mockFetch anyway if reached

    rollBtn.click();
    await flush();
    await flush();

    // Single-part posting format: the part's own label directly
    // ("evasion: 15"), no "Light Attack ->" actionLabel wrapper, and
    // an empty `label` arg so callers don't add their own "-> " either.
    expect(posted).toEqual([["", "evasion: 15"]]);
    expect(rollBtn.textContent).toBe("Evasion"); // button face stays the label, never the last result
    expect(rollBtn.disabled).toBe(false);
  });

  it("real request, 2026-10-26 (third pass) -- a single-part roll that DOES need real dice (e.g. a stat check, or Initiative's real 1d4 roll) still goes to the server, posting with the part's own label (not the action label)", async () => {
    character.variableValues = { hp: 7, fitness: 4 };
    character.customSheet!.pages = [{ title: "Core", markdown: "{{Fitness; fitness check: 1d20 + {fitness}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .compound-roll-chip")!;
    expect(rollBtn.textContent).toBe("Fitness");

    previewResponse = {
      resolvedMarkdown: "",
      segments: [],
      expressionSegments: [],
      compoundRollSegments: [
        {
          start: 0,
          end: 40,
          actionLabel: "Fitness",
          display: "button",
          parts: [{ label: "fitness check", expression: "1d20 + {fitness}", showMax: false, value: 16, text: "1d20 + 4: [12]+4 = 16" }],
        },
      ],
    };
    rollBtn.click();
    expect(rollBtn.textContent).toBe("Rolling...");
    await flush();
    await flush();

    expect(posted).toEqual([["", "fitness check: 16"]]);
    expect(rollBtn.textContent).toBe("Fitness");
  });

  it("real bug, found live during the skills rework (2026-10-26, third pass) -- a dice-containing part that references a LIVE valueExpression variable (e.g. a skill's own Bonus) posts the server its CURRENT computed value, not the stale flat number stored on the character -- the server has no defs of its own to resolve the formula with, so the client must resolve it before the round trip", async () => {
    character.customSheet!.variables = [
      { id: "fitness", label: "Fitness", type: "number", default: 0 },
      { id: "athleticsSkillPoints", label: "Athletics Skill Points", type: "number", default: 0 },
      { id: "athleticsBonus", label: "Athletics Bonus", type: "number", default: 0, valueExpression: "{fitness} + {athleticsSkillPoints}" },
    ];
    // The flat, stored athleticsBonus (0, whatever was last imported)
    // is deliberately STALE here -- fitness/skillPoints have since
    // moved on, same as raising a stat after import already does for
    // every other live formula on the sheet.
    character.variableValues = { hp: 7, fitness: 4, athleticsSkillPoints: 3, athleticsBonus: 0 };
    character.customSheet!.pages = [{ title: "Core", markdown: "{{Athletics; roll: 1d20 + {athleticsBonus}:button}}", variableIds: [] }];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const rollBtn = container.querySelector<HTMLButtonElement>(".page-preview .compound-roll-chip")!;
    previewResponse = {
      resolvedMarkdown: "",
      segments: [],
      expressionSegments: [],
      compoundRollSegments: [{ start: 0, end: 40, actionLabel: "Athletics", display: "button", parts: [{ label: "roll", expression: "1d20 + {athleticsBonus}", showMax: false, value: 19, text: "1d20 + 7: [12]+7 = 19" }] }],
    };
    rollBtn.click();
    await flush();
    await flush();

    const fetchMock = fetch as unknown as { mock: { calls: [string, { body?: string }][] } };
    const previewCall = fetchMock.mock.calls.find(([url]) => url.includes("/character-sheet-preview"));
    const body = JSON.parse(previewCall![1]!.body!);
    // 4 + 3 = 7, the LIVE value, not the stale stored 0.
    expect(body.variableValues.athleticsBonus).toBe(7);
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

  it("real request, 2026-10-29: \"we should be able to get the list of the image our specific account uploaded as well... please display the token image once it's chosen, either from a dropdown of already uploaded token pics or after uploading\" -- tokenImage's own row shows a live preview once set, and a dropdown of this account's past uploads that sets it when picked", async () => {
    uploadedImages = ["/uploads/one.png", "/uploads/two.png"];
    mountCharacterSheetView(container, baseOptions());
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // Core & Variables
    await flush();

    // No image set yet -- no preview at all, but the reuse dropdown is already there, populated from this account's own past uploads.
    expect(container.querySelector(".token-image-preview")).toBeNull();
    const select = container.querySelector<HTMLSelectElement>(".token-image-reuse-select")!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "/uploads/one.png", "/uploads/two.png"]);

    // Picking one sets tokenImage AND shows the live preview, resolved the SAME way net.ts's own resolveTokenImageUrl resolves it for the real in-game token.
    select.value = "/uploads/two.png";
    select.dispatchEvent(new Event("change"));
    await flush();

    expect(saved.at(-1)!.variableValues.tokenImage).toBe("/uploads/two.png");
    const preview = container.querySelector<HTMLImageElement>(".token-image-preview")!;
    expect(preview).not.toBeNull();
    expect(preview.src).toBe("http://test/uploads/two.png");
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

  it("real request, 2026-10-26 (third pass) -- editing a plain number variable's own {{formula}} box (valueExpression) on the Core & Variables tab updates the variable's own DEFINITION, not variableValues, same split as maxExpression above", async () => {
    character.customSheet!.variables = [
      { id: "fitness", label: "Fitness", type: "number", default: 0 },
      { id: "athleticsSkillPoints", label: "Athletics Skill Points", type: "number", default: 0 },
      { id: "athleticsBonus", label: "Athletics Bonus", type: "number", default: 0, valueExpression: "{fitness} + {athleticsSkillPoints}" },
    ];
    character.variableValues = { fitness: 2, athleticsSkillPoints: 0 };
    mountCharacterSheetView(container, baseOptions());
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // Core & Variables
    await flush();

    const formulaInput = container.querySelector<HTMLInputElement>(".sheet-widget-number-formula")!;
    expect(formulaInput).not.toBeNull();
    expect(formulaInput.value).toBe("{{{fitness} + {athleticsSkillPoints}}}");

    formulaInput.value = "{{{fitness} + {athleticsSkillPoints} + 1}}";
    formulaInput.dispatchEvent(new Event("change"));
    await flush();

    expect(saved.at(-1)!.customSheet!.variables[2].valueExpression).toBe("{fitness} + {athleticsSkillPoints} + 1");
    expect(saved.at(-1)!.variableValues.fitness).toBe(2); // unrelated variableValues left alone
  });

  it("real request, 2026-10-26 (third pass) -- typing a plain number into that same box toggles the formula OFF, reverting to an ordinary flat, per-character value", async () => {
    character.customSheet!.variables = [
      { id: "fitness", label: "Fitness", type: "number", default: 0 },
      { id: "athleticsSkillPoints", label: "Athletics Skill Points", type: "number", default: 0 },
      { id: "athleticsBonus", label: "Athletics Bonus", type: "number", default: 0, valueExpression: "{fitness} + {athleticsSkillPoints}" },
    ];
    character.variableValues = { fitness: 2, athleticsSkillPoints: 0 };
    mountCharacterSheetView(container, baseOptions());
    await flush();
    container.querySelector<HTMLButtonElement>(".sheet-tab")!.click(); // Core & Variables
    await flush();

    const formulaInput = container.querySelector<HTMLInputElement>(".sheet-widget-number-formula")!;
    formulaInput.value = "5";
    formulaInput.dispatchEvent(new Event("change"));
    await flush();

    const lastSaved = saved.at(-1)!;
    expect(lastSaved.customSheet!.variables[2].valueExpression).toBeUndefined();
    expect(lastSaved.variableValues.athleticsBonus).toBe(5);
    expect(container.querySelector(".sheet-widget-number-formula")).toBeNull();
  });

  it("real request, 2026-10-26 (traits & abilities round) -- a literal <button data-mod-action=\"modId.actionName\"> written directly into a mod's own page markdown (NOT a {{...}} segment) calls the registered function, merges its returned patch into variableValues, saves, and re-renders the page with the new values visible", async () => {
    character.customSheet!.variables = [{ id: "totalExp", label: "Total Exp", type: "number", default: 0 }];
    character.variableValues = { hp: 7, totalExp: 1000 };
    character.customSheet!.pages = [
      { title: "Traits", markdown: 'Remaining: {totalExp}\n\n<button type="button" data-mod-action="lyrian-chronicles.recalculateTraitsCosts">Auto-Calculate</button>', variableIds: ["totalExp"] },
    ];
    const recalc = vi.fn((ctx: { variableValues: Record<string, number | string> }, apply: (outcome: { variableValues?: Record<string, number | string> }) => void) =>
      apply({ variableValues: { totalExp: Number(ctx.variableValues.totalExp) - 1 } }),
    );
    mountCharacterSheetView(container, baseOptions({ modActions: { "lyrian-chronicles": { recalculateTraitsCosts: recalc } } }));
    await flush();

    const actionBtn = container.querySelector<HTMLButtonElement>('[data-mod-action="lyrian-chronicles.recalculateTraitsCosts"]')!;
    expect(actionBtn).not.toBeNull();
    actionBtn.click();
    await flush();

    expect(recalc).toHaveBeenCalledTimes(1);
    expect(saved.at(-1)!.variableValues.totalExp).toBe(999);
    // Re-rendered immediately -- the OTHER field on the same page
    // (never directly touched by the click) already reflects the
    // patched value, no tab switch needed.
    expect(container.querySelector<HTMLInputElement>('[data-var-key="totalExp"]')!.value).toBe("999");
  });

  it("a mod-action button for an action that isn't registered (or a mod id that isn't) does nothing, rather than throwing", async () => {
    character.customSheet!.pages = [{ title: "Traits", markdown: '<button type="button" data-mod-action="lyrian-chronicles.notRegistered">Auto-Calculate</button>', variableIds: [] }];
    mountCharacterSheetView(container, baseOptions({ modActions: { "lyrian-chronicles": {} } }));
    await flush();

    const actionBtn = container.querySelector<HTMLButtonElement>("[data-mod-action]")!;
    expect(() => actionBtn.click()).not.toThrow();
    await flush();
    expect(saved).toEqual([]);
  });

  it("real request, 2026-10-28 (Abilities round) -- a mod action can return new variable defs AND a page-markdown edit, not just a variableValues patch, and multiple apply() calls each independently commit+re-render", async () => {
    character.customSheet!.pages = [{ title: "Abilities", markdown: '# Abilities\n\n<button type="button" data-mod-action="lyrian-chronicles.addStuff">Go</button>', variableIds: [] }];
    character.customSheet!.variables = [];
    const action = vi.fn((_ctx, apply) => {
      apply({ variables: [{ id: "newVar", label: "New Var", type: "number", default: 5 }], pageEdits: [{ pageTitle: "Abilities", appendMarkdown: "\n\nRow one" }] });
      apply({ pageEdits: [{ pageTitle: "Abilities", appendMarkdown: "\n\nRow two" }] });
    });
    mountCharacterSheetView(container, baseOptions({ modActions: { "lyrian-chronicles": { addStuff: action } } }));
    await flush();
    container.querySelector<HTMLButtonElement>("[data-mod-action]")!.click();
    await flush();

    const lastSaved = saved.at(-1)!;
    expect(lastSaved.customSheet!.variables).toEqual([{ id: "newVar", label: "New Var", type: "number", default: 5 }]);
    expect(lastSaved.customSheet!.pages[0].markdown).toContain("Row one");
    expect(lastSaved.customSheet!.pages[0].markdown).toContain("Row two");
  });

  it("real request, 2026-10-28 (Abilities round) -- an ability row baked directly into a page's own markdown (a literal <button class=\"chat-chip\"> + a native <details> disclosure, no {{...}} involved at all) survives DOMPurify sanitization and both interactions work: clicking the name posts the baked description, and the info disclosure toggles open/closed", async () => {
    character.customSheet!.pages = [
      {
        title: "Abilities",
        markdown: '<div class="ability-row"><button type="button" class="chat-chip" data-chip-label="Sense Magic" data-chip-value="You can detect active magical effects.">Sense Magic</button> <details><summary>ℹ</summary>You can detect active magical effects.</details></div>',
        variableIds: [],
      },
    ];
    mountCharacterSheetView(container, baseOptions());
    await flush();

    const nameBtn = container.querySelector<HTMLButtonElement>('.chat-chip[data-chip-label="Sense Magic"]')!;
    expect(nameBtn).not.toBeNull();
    nameBtn.click();
    expect(posted).toEqual([["Sense Magic", "You can detect active magical effects."]]);

    const details = container.querySelector<HTMLDetailsElement>("details")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    details.open = true; // native <details> needs no JS of its own -- just confirming DOMPurify kept the element itself (and its toggle behavior) intact
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("You can detect active magical effects.");
  });
});

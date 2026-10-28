import { describe, it, expect, vi, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { fetchAndParseWorkbook } from "./characterSheetImport.js";

function buildTestWorkbookBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // A scattered label/value grid, same real shape the Lyrian sheet's
  // own "Core" tab uses (not a conventional header-row table).
  const coreSheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Alba", undefined, "HP", 70],
    [],
    [undefined, undefined, "Mana", 11],
  ]);
  XLSX.utils.book_append_sheet(wb, coreSheet, "Core");

  // A conventional header-row table.
  const abilitiesSheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Cost"],
    ["Sense Magic", "1 AP"],
  ]);
  XLSX.utils.book_append_sheet(wb, abilitiesSheet, "Abilities");

  // A hidden reference tab -- must be skipped entirely.
  const hiddenSheet = XLSX.utils.aoa_to_sheet([["should", "never", "appear"]]);
  XLSX.utils.book_append_sheet(wb, hiddenSheet, "Classes");

  // Real request, 2026-10-28: "All Abilities" is the ONE named
  // exception -- hidden, but let through anyway (see this file's own
  // ALWAYS_INCLUDED_HIDDEN_SHEETS).
  const allAbilitiesSheet = XLSX.utils.aoa_to_sheet([["Name", "Description"], ["Sense Magic", "You can detect active magical effects."]]);
  XLSX.utils.book_append_sheet(wb, allAbilitiesSheet, "All Abilities");

  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }, { Hidden: 1 }] };

  return XLSX.write(wb, { type: "array" }) as ArrayBuffer;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAndParseWorkbook (docs/CHARACTER_SHEET_IMPORT.md, part 1 -- the client-side fetch+parse half of the import flow)", () => {
  it("parses every VISIBLE sheet into a plain grid of rows, keyed by sheet name", async () => {
    const buffer = buildTestWorkbookBuffer();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response)));

    const workbook = await fetchAndParseWorkbook("https://example.com/sheet.xlsx");
    expect(workbook.Core).toEqual([
      ["Name", "Alba", null, "HP", 70],
      [null, null, null, null, null],
      [null, null, "Mana", 11, null],
    ]);
    expect(workbook.Abilities).toEqual([
      ["Name", "Cost"],
      ["Sense Magic", "1 AP"],
    ]);
  });

  it("skips hidden sheets entirely -- not just leaves them out of what a mod happens to read", async () => {
    const buffer = buildTestWorkbookBuffer();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response)));

    const workbook = await fetchAndParseWorkbook("https://example.com/sheet.xlsx");
    expect(workbook["Classes"]).toBeUndefined();
  });

  it("real request, 2026-10-28 -- 'All Abilities' is let through despite being hidden, the one named exception to the skip rule above (the 'Add Ability' search popup's own catalog needs it)", async () => {
    const buffer = buildTestWorkbookBuffer();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response)));

    const workbook = await fetchAndParseWorkbook("https://example.com/sheet.xlsx");
    expect(workbook["All Abilities"]).toEqual([
      ["Name", "Description"],
      ["Sense Magic", "You can detect active magical effects."],
    ]);
  });

  it("throws (not silently returns garbage) when the fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404, statusText: "Not Found" } as Response)));
    await expect(fetchAndParseWorkbook("https://example.com/missing.xlsx")).rejects.toThrow(/404/);
  });

  it("real bug, found live: an ordinary Google Sheets edit/share URL (what a session actually copies from the address bar) is rewritten to the real export URL before fetching -- fetching the EDIT url directly returns an HTML page, which XLSX.read doesn't even throw on (it silently returns fake empty sheets), so every stat previously came back 0 with no error at all", async () => {
    const buffer = buildTestWorkbookBuffer();
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetchedUrls.push(url);
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response);
      }),
    );

    await fetchAndParseWorkbook("https://docs.google.com/spreadsheets/d/19jeXTHGN7HKQfv9XYecgfWyY5IoYsAWE-OlYgr3Ekbw/edit?gid=391144986#gid=391144986");

    expect(fetchedUrls).toEqual(["https://docs.google.com/spreadsheets/d/19jeXTHGN7HKQfv9XYecgfWyY5IoYsAWE-OlYgr3Ekbw/export?format=xlsx"]);
  });

  it("a URL that's already the real export link is used unchanged", async () => {
    const buffer = buildTestWorkbookBuffer();
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetchedUrls.push(url);
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response);
      }),
    );

    await fetchAndParseWorkbook("https://docs.google.com/spreadsheets/d/19jeXTHGN7HKQfv9XYecgfWyY5IoYsAWE-OlYgr3Ekbw/export?format=xlsx");

    expect(fetchedUrls).toEqual(["https://docs.google.com/spreadsheets/d/19jeXTHGN7HKQfv9XYecgfWyY5IoYsAWE-OlYgr3Ekbw/export?format=xlsx"]);
  });

  it("a non-Google-Sheets URL is used exactly as given -- presumably already a direct file link", async () => {
    const buffer = buildTestWorkbookBuffer();
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetchedUrls.push(url);
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response);
      }),
    );

    await fetchAndParseWorkbook("https://example.com/some-other-host/sheet.xlsx");

    expect(fetchedUrls).toEqual(["https://example.com/some-other-host/sheet.xlsx"]);
  });
});

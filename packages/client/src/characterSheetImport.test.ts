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
  XLSX.utils.book_append_sheet(wb, hiddenSheet, "All Abilities");
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };

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
    expect(Object.keys(workbook)).toEqual(["Core", "Abilities"]);
    expect(workbook["All Abilities"]).toBeUndefined();
  });

  it("throws (not silently returns garbage) when the fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404, statusText: "Not Found" } as Response)));
    await expect(fetchAndParseWorkbook("https://example.com/missing.xlsx")).rejects.toThrow(/404/);
  });
});

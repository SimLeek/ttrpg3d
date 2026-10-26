// docs/CHARACTER_SHEET_IMPORT.md, part 1 -- the client half of "the
// import mechanism itself was always meant to be a pluggable mod
// interface." The BROWSER fetches the public export URL directly (the
// decided answer to that doc's own open-question-1: the server never
// fetches an arbitrary URL itself, a new security-sensitive capability
// this codebase doesn't otherwise have) and parses it into an
// ImportedWorkbook -- the server then just hands that already-parsed
// data to whichever mod's own characterSheetImporter is invoked.

import * as XLSX from "xlsx";
import type { ImportedWorkbook } from "@ttrpg3d/shared";

/**
 * Fetches `url` (a public spreadsheet export link, e.g. Google Sheets'
 * own `.../export?format=xlsx`) and parses it into one raw grid per
 * VISIBLE sheet -- hidden tabs are skipped entirely, not just left
 * out of what a mod happens to read. Confirmed directly against the
 * real Lyrian Chronicles sheet this was scoped against: its own
 * master-ability/class/race lookup tabs (backing data for the sheet's
 * OWN formulas, imported via IMPORTRANGE from a separate rulebook
 * spreadsheet) are marked hidden in the file itself -- skipping on
 * that flag is a general rule (works for any xlsx-based sheet that
 * hides its own reference data this way), not Lyrian-specific
 * knowledge, and keeps the uploaded payload to just the tabs an
 * importer mod could plausibly want instead of every row of a whole
 * rulebook nobody asked to import.
 */
export async function fetchAndParseWorkbook(url: string): Promise<ImportedWorkbook> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetMeta = workbook.Workbook?.Sheets ?? [];
  const result: ImportedWorkbook = {};
  workbook.SheetNames.forEach((name, i) => {
    if (sheetMeta[i]?.Hidden) return;
    const sheet = workbook.Sheets[name];
    // header:1 -- rows as plain arrays (ImportedWorkbook's own shape),
    // not objects keyed by a first-row "header" that a scattered
    // label/value grid (e.g. this sheet's own "Core" tab) doesn't
    // actually have. defval:null -- an empty cell becomes `null`
    // (ImportedWorkbook's own allowed shape), not `undefined` (which
    // sheet_to_json would otherwise just omit the array slot for,
    // leaving holes that shift column INDEXES between rows).
    result[name] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as ImportedWorkbook[string];
  });
  return result;
}

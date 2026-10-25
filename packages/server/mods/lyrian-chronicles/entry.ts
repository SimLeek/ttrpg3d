// First real `characterSheetImporter` mod -- docs/CHARACTER_SHEET_IMPORT.md
// part 1, un-deferring "mod-based sheet importers" (docs/DEFERRED.md,
// held since 2026-10-21 pending real test data) against a real public
// Lyrian Chronicles character sheet.
//
// Build-order step 1 ONLY (see that doc's own "Proposed build order"):
// plumbing proven with a FEW trivial, flat values pulled straight off
// the sheet's own "Core" tab -- HP/Mana/Agility, found by scanning for
// their own text label and reading the cell immediately to its right
// (a generic scan, not hardcoded cell coordinates, so it isn't fragile
// against a different character's own sheet shifting rows/columns
// around, which the real sheet's own layout already shows happens --
// Core is a scattered label/value grid, not a fixed form). Steps 2-3
// (porting the REAL formula graph -- point-buy arrays, racial/class
// bonuses, equipment SUMIFs -- so these recompute live instead of
// staying frozen at import time) and step 4 (the generated Abilities/
// Inventory pages) are deliberately NOT here yet -- this mod's own
// `characterSheetImporter` returns an empty `pages` array for now,
// proving the plumbing/merge path compiles and round-trips correctly
// without yet generating real content.

import { xOfYMaxKey, type CharacterSheetTemplate, type CharacterSheetImportResult, type ImportedWorkbook } from "@ttrpg3d/shared";

export const characterSheetTemplate: CharacterSheetTemplate = {
  name: "Lyrian Chronicles",
  variables: [
    { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 },
    { id: "mana", label: "Mana", type: "xOfY", default: 10, max: 10 },
    { id: "agility", label: "Agility", type: "number", default: 0 },
  ],
  bars: [
    { variableId: "hp", color: [0.753, 0.224, 0.169] },
    { variableId: "mana", color: [0.161, 0.502, 0.733] },
  ],
  pages: [
    {
      title: "Core",
      markdown: "# Core\n\nHP: {hp}\n\nMana: {mana}\n\nAgility: {agility}",
      variableIds: ["hp", "mana", "agility"],
    },
  ],
};

/**
 * Scans every cell of `grid` for one whose value is exactly `label`
 * (case-insensitive, trimmed) and returns the cell immediately to its
 * right -- the Lyrian "Core" tab's own real layout (confirmed directly
 * against the actual sheet, not guessed): a label and its value always
 * sit in adjacent cells on the SAME row, but at no fixed row/column
 * (e.g. "HP" at E2/F2 for one character, "Name" at A2/B2) -- so this
 * has to search, not assume a coordinate.
 */
function findLabelValue(grid: (string | number | boolean | null)[][], label: string): string | number | boolean | undefined {
  const target = label.trim().toLowerCase();
  for (const row of grid) {
    for (let col = 0; col < row.length - 1; col++) {
      const cell = row[col];
      if (typeof cell === "string" && cell.trim().toLowerCase() === target) {
        const value = row[col + 1];
        if (value !== null && value !== undefined) return value;
      }
    }
  }
  return undefined;
}

function asNumber(value: string | number | boolean | undefined, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

const importer = (workbook: ImportedWorkbook): CharacterSheetImportResult => {
  const core = workbook["Core"] ?? [];
  const hp = asNumber(findLabelValue(core, "HP"), 10);
  const mana = asNumber(findLabelValue(core, "Mana"), 10);
  const agility = asNumber(findLabelValue(core, "Agility"), 0);
  return {
    // HP/Mana import as full/current-equals-max (the sheet is a
    // character BUILD sheet, not a live combat tracker -- it has no
    // separate "current damage taken" of its own to import).
    variableValues: { hp, [xOfYMaxKey("hp")]: hp, mana, [xOfYMaxKey("mana")]: mana, agility },
    pages: [],
  };
};

export const characterSheetImporter = importer;

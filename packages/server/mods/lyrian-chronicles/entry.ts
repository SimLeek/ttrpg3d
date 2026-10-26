// First real `characterSheetImporter` mod -- docs/CHARACTER_SHEET_IMPORT.md
// part 1, un-deferring "mod-based sheet importers" (docs/DEFERRED.md,
// held since 2026-10-21 pending real test data) against a real public
// Lyrian Chronicles character sheet.
//
// Build-order step 1 (see that doc's own "Proposed build order"):
// plumbing proven with a FEW trivial, flat values pulled straight off
// the sheet's own "Core" tab -- found by scanning for a cell's own
// text label and reading a nearby cell (never a fixed coordinate, so
// it isn't fragile against a different character's own sheet shifting
// rows/columns around, which the real sheet's own layout already
// shows happens -- Core is a scattered label/value grid, not a fixed
// form).
//
// Steps 3/4 (Main+sub stats, the top stat block) -- real finding,
// 2026-10-25, that reshapes both: Google Sheets bakes in each formula
// cell's own LAST-COMPUTED value when it exports to XLSX, and the
// `xlsx` library this project's own client-side fetch already uses
// (characterSheetImport.ts) reads exactly that cached value, not the
// formula text (confirmed directly: fetching the real sheet and
// reading cell B9, labelled "Focus", returns the plain number 3 --
// the ALREADY-EVALUATED result of its own real formula, point-buy
// array lookup and racial/class bonus included). There is nothing
// left to re-derive for most of Core's stat block -- every Main/Sub
// stat, and most of the "top stat block" (Mana/Initiative/Save Bonus/
// Potency/Speed/RP), import as plain flat numbers via the exact same
// `findLabelValue` scan HP/Mana/Agility/Toughness already used.
//
// Evasion/Dodge/Guard/Block are the deliberate exception (real
// request, 2026-10-25): kept as LIVE `{{expression}}` formulas, same
// treatment as HP, because their own inputs (Agility/Toughness, and a
// GM-editable adjustment number) are things a session can plausibly
// change mid-game without a re-import. Each one's own EQUIPMENT
// contribution (the real sheet's own SUMIF over its weapon/armor
// table's "Armor Equipped?" column) is computed ONCE at import time
// into its own flat variable, same limitation this file's own HP
// comment already covers for the 3D token's bar: there is no live
// "toggle this gear on/off" mechanism in this project's variable
// system yet, so that one piece stays frozen until the next import --
// a real, separate follow-up, not pretended away.

import { xOfYMaxKey, type CharacterSheetTemplate, type CharacterSheetImportResult, type ImportedWorkbook } from "@ttrpg3d/shared";

export const characterSheetTemplate: CharacterSheetTemplate = {
  name: "Lyrian Chronicles",
  variables: [
    { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 },
    { id: "mana", label: "Mana", type: "xOfY", default: 10, max: 10 },
    { id: "agility", label: "Agility", type: "number", default: 0 },
    { id: "toughness", label: "Toughness", type: "number", default: 0 },
    { id: "focus", label: "Focus", type: "number", default: 0 },
    { id: "power", label: "Power", type: "number", default: 0 },
    { id: "fitness", label: "Fitness", type: "number", default: 0 },
    { id: "cunning", label: "Cunning", type: "number", default: 0 },
    { id: "reason", label: "Reason", type: "number", default: 0 },
    { id: "awareness", label: "Awareness", type: "number", default: 0 },
    { id: "presence", label: "Presence", type: "number", default: 0 },
    { id: "hpBonus", label: "HP Bonus", type: "number", default: 0 },
    { id: "evasionBonus", label: "Evasion Bonus", type: "number", default: 0 },
    { id: "evasionEquipmentBonus", label: "Evasion Equipment Bonus", type: "number", default: 0 },
    { id: "dodgeBonus", label: "Dodge Bonus", type: "number", default: 0 },
    { id: "dodgeEquipmentBonus", label: "Dodge Equipment Bonus", type: "number", default: 0 },
    { id: "equipmentGuardValue", label: "Equipment Guard Value", type: "number", default: 0 },
    { id: "equipmentBlockValue", label: "Equipment Block Value", type: "number", default: 0 },
    { id: "initiative", label: "Initiative", type: "number", default: 0 },
    { id: "saveBonus", label: "Save Bonus", type: "number", default: 0 },
    { id: "potency", label: "Potency", type: "number", default: 0 },
    { id: "speed", label: "Speed", type: "number", default: 0 },
    { id: "rp", label: "RP", type: "number", default: 0 },
  ],
  bars: [
    { variableId: "hp", color: [0.753, 0.224, 0.169] },
    { variableId: "mana", color: [0.161, 0.502, 0.733] },
  ],
  pages: [
    {
      title: "Core",
      markdown: [
        "# Core",
        "",
        "HP: {hp} / {hp.y}",
        "Max HP (live formula): {{20 + (10 * {toughness}) + {hpBonus}}}",
        "",
        "Mana: {mana}",
        "",
        // The real sheet's own formulas (confirmed directly): Evasion
        // = 7+Agility+EvasionBonus+equipment; Dodge = 20+Agility+
        // DodgeBonus+equipment; Guard = ROUNDDOWN(Toughness+equipment,
        // 0) (expr-eval's `trunc` matches ROUNDDOWN(x,0) for this
        // sheet's always-non-negative inputs); Block =
        // (Toughness*2)+equipment.
        "Evasion: {{7 + {agility} + {evasionBonus} + {evasionEquipmentBonus}}}",
        "Dodge: {{20 + {agility} + {dodgeBonus} + {dodgeEquipmentBonus}}}",
        "Guard: {{trunc({toughness} + {equipmentGuardValue})}}",
        "Block: {{({toughness} * 2) + {equipmentBlockValue}}}",
        "",
        "Initiative: {initiative}",
        "Save Bonus: {saveBonus}",
        "Potency: {potency}",
        "Speed: {speed}",
        "RP: {rp}",
        "",
        "Agility: {agility}",
        "Toughness: {toughness}",
        "Focus: {focus}",
        "Power: {power}",
        "",
        "Fitness: {fitness}",
        "Cunning: {cunning}",
        "Reason: {reason}",
        "Awareness: {awareness}",
        "Presence: {presence}",
      ].join("\n"),
      variableIds: [
        "hp",
        "mana",
        "agility",
        "toughness",
        "focus",
        "power",
        "fitness",
        "cunning",
        "reason",
        "awareness",
        "presence",
        "hpBonus",
        "evasionBonus",
        "evasionEquipmentBonus",
        "dodgeBonus",
        "dodgeEquipmentBonus",
        "equipmentGuardValue",
        "equipmentBlockValue",
        "initiative",
        "saveBonus",
        "potency",
        "speed",
        "rp",
      ],
    },
  ],
};

type Cell = string | number | boolean | null;

/**
 * Scans every cell of `grid` for one whose value is exactly `label`
 * (case-insensitive, trimmed) and returns the cell at `rowOffset`/
 * `colOffset` relative to IT -- never a fixed absolute coordinate, so
 * it isn't fragile against a different character's own sheet shifting
 * rows/columns around. The Core tab's real layout (confirmed directly,
 * not guessed) uses more than one offset depending on the cell: most
 * labels sit immediately LEFT of their own value (`rowOffset: 0,
 * colOffset: 1` -- see `findLabelValue` below, the common case); the
 * "Evasion Bonus"/"Dodge Bonus" adjustment cells instead sit ONE ROW
 * ABOVE their own value in the SAME column (`rowOffset: 1, colOffset:
 * 0`); "Equipment Guard/Block Value" and "Equipment Penalty" sit TWO
 * COLUMNS left of their own value, with a blank spacer column between
 * them (`rowOffset: 0, colOffset: 2`).
 *
 * Only the FIRST match (scanning rows top-to-bottom, each row's own
 * columns left-to-right) is used -- confirmed safe against the real
 * sheet for every label this mod actually reads: a stat's own label
 * cell (column A/C) always appears in an EARLIER row than any later,
 * unrelated reuse of the same word elsewhere on the tab (a skill's
 * own governing-stat column, or the point-buy array's own bonus-table
 * labels) -- real but coincidental to this sheet's own row ordering,
 * not a guaranteed property of every possible differently-laid-out
 * copy of this template.
 */
function findLabelValueAt(grid: Cell[][], label: string, rowOffset: number, colOffset: number): Cell | undefined {
  const target = label.trim().toLowerCase();
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const cell = grid[row][col];
      if (typeof cell === "string" && cell.trim().toLowerCase() === target) {
        const value = grid[row + rowOffset]?.[col + colOffset];
        if (value !== null && value !== undefined) return value;
      }
    }
  }
  return undefined;
}

function findLabelValue(grid: Cell[][], label: string): Cell | undefined {
  return findLabelValueAt(grid, label, 0, 1);
}

/**
 * The real sheet's own weapon/armor table (Core tab, rows 36-42):
 * a header row naming each column, then one row per equipment slot,
 * with a boolean "Armor Equipped?" column gating whether that row's
 * own bonus columns count at all -- exactly what the sheet's own
 * Evasion/Dodge/Guard/Block formulas each run a `SUMIF` over. Found by
 * header text, not a fixed row/column, same spirit as
 * `findLabelValueAt` above: locates the EXACT "Armor Equipped?" header
 * cell for the gating column, then the FIRST header cell in that same
 * row whose text CONTAINS `valueColumnContains` (case-insensitive --
 * the real header text for Evasion/Dodge's own columns has an
 * embedded newline, e.g. "Dodge\n- for negative", so an exact match
 * would never hit) for the value column. Stops at the first row below
 * the header whose own "Armor Equipped?" cell ISN'T a real boolean --
 * the real sheet always fills every equipment slot's own checkbox
 * with true/false, never leaves it blank, so this is a safe end-of-
 * table signal rather than a fixed row count.
 */
function sumIfEquipped(grid: Cell[][], valueColumnContains: string): number {
  const target = valueColumnContains.trim().toLowerCase();
  for (let row = 0; row < grid.length; row++) {
    const eqCol = grid[row].findIndex((cell) => typeof cell === "string" && cell.trim().toLowerCase() === "armor equipped?");
    if (eqCol === -1) continue;
    const valCol = grid[row].findIndex((cell) => typeof cell === "string" && cell.trim().toLowerCase().includes(target));
    if (valCol === -1) continue;
    let total = 0;
    for (let r = row + 1; typeof grid[r]?.[eqCol] === "boolean"; r++) {
      if (grid[r][eqCol] === true) total += asNumber(grid[r][valCol] as Cell | undefined, 0);
    }
    return total;
  }
  return 0;
}

function asNumber(value: Cell | undefined, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

const importer = (workbook: ImportedWorkbook): CharacterSheetImportResult => {
  const core = workbook["Core"] ?? [];
  const num = (label: string, fallback = 0) => asNumber(findLabelValue(core, label), fallback);

  const mana = num("Mana", 10);
  const agility = num("Agility");
  const toughness = num("Toughness");
  const focus = num("Focus");
  const power = num("Power");
  const fitness = num("Fitness");
  const cunning = num("Cunning");
  const reason = num("Reason");
  const awareness = num("Awareness");
  const presence = num("Presence");
  const hpBonus = num("HP Bonus");
  const evasionBonus = asNumber(findLabelValueAt(core, "Evasion Bonus", 1, 0), 0);
  const dodgeBonus = asNumber(findLabelValueAt(core, "Dodge Bonus", 1, 0), 0);
  const equipmentGuardValue = asNumber(findLabelValueAt(core, "Equipment Guard Value", 0, 2), 0);
  const equipmentBlockValue = asNumber(findLabelValueAt(core, "Equipment Block Value", 0, 2), 0);
  // "Equipment Penalty" is the real sheet's own pre-computed duplicate
  // of Evasion's equipment SUMIF (confirmed directly: identical
  // formula, same cell range) -- reused rather than re-summed.
  // Dodge's own equipment term has no such duplicate anywhere else on
  // the tab, so it's computed directly from the weapon/armor table.
  const evasionEquipmentBonus = asNumber(findLabelValueAt(core, "Equipment Penalty", 0, 2), 0);
  const dodgeEquipmentBonus = sumIfEquipped(core, "dodge");
  const initiative = num("Initiative");
  const saveBonus = num("Save Bonus");
  const potency = num("Potency");
  const speed = num("Speed");
  const rp = num("RP");

  // Same formula the Core page's own `{{expression}}` shows live --
  // this ONE-TIME snapshot just seeds the stored hp/hpMax the 3D
  // token's bar reads (see this file's own header comment for why
  // the bar can't read the live formula directly yet).
  const hp = 20 + 10 * toughness + hpBonus;

  return {
    // HP/Mana import as full/current-equals-max (the sheet is a
    // character BUILD sheet, not a live combat tracker -- it has no
    // separate "current damage taken" of its own to import).
    variableValues: {
      hp,
      [xOfYMaxKey("hp")]: hp,
      mana,
      [xOfYMaxKey("mana")]: mana,
      agility,
      toughness,
      focus,
      power,
      fitness,
      cunning,
      reason,
      awareness,
      presence,
      hpBonus,
      evasionBonus,
      evasionEquipmentBonus,
      dodgeBonus,
      dodgeEquipmentBonus,
      equipmentGuardValue,
      equipmentBlockValue,
      initiative,
      saveBonus,
      potency,
      speed,
      rp,
    },
    pages: [],
  };
};

export const characterSheetImporter = importer;

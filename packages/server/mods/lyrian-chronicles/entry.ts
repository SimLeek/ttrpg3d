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
// Steps 3/4 (Main+sub stats, the top stat block) -- real correction,
// 2026-10-25: Google's own XLSX export DOES carry every formula
// cell's real formula string (confirmed directly, on two separately
// exported copies of the real sheet -- B9 reads
// `=IFS(B45 = A9, A45, ...)+F45`, not just its cached number). Every
// stat that's genuinely a FORMULA on the real sheet (HP/Mana("MP")/
// Evasion/Dodge/Guard/Block/Initiative/Save Bonus/Potency/RP) is
// hand-transcribed here as a live `{{expression}}`/`maxExpression`,
// each one's real formula text read directly off the sheet (not
// guessed) and ported with each cell reference swapped for the
// matching `{variableId}`. Only the genuine LEAF inputs stay flat:
// the Main/Sub stats (Focus/Power/Agility/Toughness/Fitness/Cunning/
// Reason/Awareness/Presence -- each already a one-time point-buy-
// array + racial/class-bonus choice baked into ITS OWN cached value,
// not something this mod re-derives), the small named adjustment
// cells (HP Bonus, Evasion/Dodge Bonus, Mana/Initiative/RP
// Adjustment, Bonus Save Value, the "old armor calc" checkbox), and
// Speed (confirmed: a plain typed-in number on the real sheet, not a
// formula at all).
//
// Real request, 2026-10-26: "rename mana to MP, and add RP as a third
// bar... make HP green and first/top-most, make MP blue and second,
// make RP red and last/bottom-most... Any xOfY variable should have Y
// be the max of that... hp.y should just auto-set to the actual max
// hp." HP/MP/RP are now `xOfY` with a `maxExpression` (shared/
// characterSheet.ts's new `resolveVariableValue` -- a real, graph-
// cycle-checked live resolver, not a value frozen at import time) --
// `{hp.y}` alone now shows the live max, so the old separate "Max HP
// (live formula): {{...}}" display lines are gone; the ONLY thing the
// importer still seeds is each one's own CURRENT value (full/max at
// creation, same "character BUILD sheet, not a live combat tracker"
// reasoning as before -- RP has no separate "current RP spent"
// anywhere on the real sheet either, so it imports full too, trackable
// in-session from there same as HP/MP already are).
//
// Evasion/Dodge/Guard/Block/Initiative/Save Bonus/Potency are never
// their OWN stored variable at all -- only their own leaf inputs are
// (same shape HP's own `{toughness}`/`{hpBonus}` always had). Each
// one's own EQUIPMENT contribution (the real sheet's own `SUMIF` over
// its weapon/armor table's "Armor Equipped?" column) is computed ONCE
// at import time into its own flat leaf variable: there is no live
// "toggle this gear on/off" mechanism in this project's variable
// system yet, so that one piece alone stays frozen until the next
// import -- a real, separate follow-up, not pretended away.
//
// Real request, 2026-10-26: "a few buttons to click and roll, like
// heavy attack, initiative, etc." A genuine dice roll (real RNG)
// needs the server regardless of what it's rolling, so these are all
// `{{...:button}}` expressions same as everything else, each one
// containing real dice notation (confirmed directly off the sheet:
// `d[0-9]` somewhere in the substituted text is ALL that's needed to
// flag a `needsRoll` segment -- characterSheetView.ts now renders
// that as its own inert "Roll" button, fetching a FRESH result only
// once actually clicked, never silently re-rolled on page render).
// Initiative rolls `1d4` plus its own real modifier formula (the SAME
// formula the Combat table's own plain display already shows, with
// `1d4 +` prepended); Save Bonus rolls `2d10` the same way -- real
// correction, 2026-10-26: NOT `1d20` for either, which was guessed
// wrong (confirmed by the user directly, since neither die size
// appears anywhere on the sheet itself to check against).
//
// Real request, 2026-10-26 (second pass): Light/Heavy/Precise Attack
// are each a COMPOUND roll (shared/characterSheet.ts's own
// `{{Label; part: expr | part: expr}}` syntax, built specifically for
// this: "we want to display the attack to-hit result, the damage,
// and the max damage... some table in the chat"). Per the user's own
// real game rule (not on the sheet anywhere -- confirmed directly by
// asking): to-hit is `1d20 + Focus + <a manual, GM/player-editable
// "additional bonus" -- "a misc 'additional bonus' that will just
// apply to the heavy/light attacks so that the user can change their
// attack as needed... both currently before the weapon inventory
// features are added and in case of any general modifiers">` for
// Light/Heavy, DOUBLED (`(Focus + bonus) * 2`) for Precise. Precise
// deals the SAME damage as Light (`{lightDamage}`) but carries the
// "pinpoint" keyword -- just plain text in its own action label, no
// new mechanism needed for a tag that's never computed, only shown.
// Each attack's own `damage+max` part is a BARE `{{variableId}}`
// reference to a variable that's ITSELF a complete dice-notation
// string (e.g. "2d4+5") -- passed straight through rather than
// failing the strict substitution every other expression requires
// (shared/characterSheet.ts's own substituteForDiceCheck), with its
// own theoretical max (DiceRoll's own `.maxTotal`) shown alongside
// the real roll because of that `+max` label suffix.

import { type CharacterSheetTemplate, type CharacterSheetImportResult, type ImportedWorkbook } from "@ttrpg3d/shared";

export const characterSheetTemplate: CharacterSheetTemplate = {
  name: "Lyrian Chronicles",
  variables: [
    { id: "hp", label: "HP", type: "xOfY", default: 10, maxExpression: "20 + (10 * {toughness}) + {hpBonus}" },
    { id: "mp", label: "MP", type: "xOfY", default: 10, maxExpression: "trunc(6 + {power} + {manaAdjustments})" },
    {
      id: "rp",
      label: "RP",
      type: "xOfY",
      default: 2,
      maxExpression: "({oldArmorCalc} ? (2 + ({agility} - {evasionEquipmentBonus})) : (2 + {agility})) - {rpAdjustment}",
    },
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
    { id: "manaAdjustments", label: "Mana Adjustments", type: "number", default: 0 },
    { id: "evasionBonus", label: "Evasion Bonus", type: "number", default: 0 },
    { id: "evasionEquipmentBonus", label: "Evasion Equipment Bonus", type: "number", default: 0 },
    { id: "dodgeBonus", label: "Dodge Bonus", type: "number", default: 0 },
    { id: "dodgeEquipmentBonus", label: "Dodge Equipment Bonus", type: "number", default: 0 },
    { id: "equipmentGuardValue", label: "Equipment Guard Value", type: "number", default: 0 },
    { id: "equipmentBlockValue", label: "Equipment Block Value", type: "number", default: 0 },
    { id: "initiativeAdjustment", label: "Initiative Adjustment", type: "number", default: 0 },
    { id: "initiativeEquipmentPenalty", label: "Initiative Equipment Penalty", type: "number", default: 0 },
    { id: "bonusSaveValue", label: "Bonus Save Value", type: "number", default: 0 },
    { id: "speed", label: "Speed", type: "number", default: 0 },
    { id: "rpAdjustment", label: "RP Adjustment", type: "number", default: 0 },
    { id: "oldArmorCalc", label: "Old Armor Calc", type: "number", default: 0 },
    { id: "lightDamage", label: "Light Damage", type: "text", default: "" },
    { id: "heavyDamage", label: "Heavy Damage", type: "text", default: "" },
    // Real request, 2026-10-26: NOT imported from anywhere on the
    // sheet (confirmed: no "additional bonus" cell exists anywhere on
    // it) -- "a misc 'additional bonus' that will just apply to the
    // heavy/light attacks so that the user can change their attack as
    // needed... before the weapon inventory features are added and
    // in case of any general modifiers." A plain, manually-edited
    // number, same tier as HP Bonus/Evasion Bonus.
    { id: "attackBonus", label: "Attack Bonus", type: "number", default: 0 },
  ],
  // Order is top-to-bottom on the 3D token's own billboard (characterToken.ts's
  // `barSlots[i]` <-> `bars[i]`) -- real request: "make HP green and
  // first/top-most, make MP blue and second, make RP red and
  // last/bottom-most."
  bars: [
    { variableId: "hp", color: [0.2, 0.7, 0.2] },
    { variableId: "mp", color: [0.161, 0.502, 0.733] },
    { variableId: "rp", color: [0.753, 0.224, 0.169] },
  ],
  pages: [
    {
      title: "Core",
      // Every `{{...}}`/`maxExpression` below is the real sheet's own
      // formula (confirmed directly, not guessed), each cell
      // reference swapped for its matching `{variableId}`:
      //   HP     = 20+(10*Toughness)+HP Bonus
      //   MP     = ROUNDDOWN(6+Power+Mana Adjustments, 0)
      //   Evasion= 7+Agility+Evasion Bonus+equipment
      //   Dodge  = 20+Agility+Dodge Bonus+equipment
      //   Guard  = ROUNDDOWN(Toughness+equipment, 0)
      //   Block  = (Toughness*2)+equipment
      //   Initiative = Agility+Initiative Adjustment-equipment
      //   Save Bonus = Toughness+Bonus Save Value
      //   Potency    = 11+Focus
      //   RP = IF(oldArmorCalc, 2+(Agility-equipmentPenalty), 2+Agility)-RP Adjustment
      // (expr-eval's `trunc` matches ROUNDDOWN(x,0) for this sheet's
      // always-non-negative inputs; its `cond ? a : b` ternary matches
      // IF(), with the checkbox stored as 0/1 since this project's
      // variable system has no boolean type.)
      //
      // Real request, 2026-10-26: "see if you can organize the pages a
      // bit more neatly with tables, since the xlsx file had those by
      // just being an xlsx file" -- GFM pipe tables (marked's own
      // default table support, confirmed directly: renders fine with
      // raw inline HTML inside a cell, and DOMPurify's default
      // allowlist already keeps table/thead/tbody/tr/td/th intact, no
      // sanitizer config changes needed), one table per real section
      // of the sheet's own Core tab.
      markdown: [
        "# Core",
        "",
        "## Vitals",
        "",
        "| | Current | Max |",
        "| --- | --- | --- |",
        "| HP | {hp} | {hp.y} |",
        "| MP | {mp} | {mp.y} |",
        "| RP | {rp} | {rp.y} |",
        "",
        "## Combat",
        "",
        "| Evasion | Dodge | Guard | Block |",
        "| --- | --- | --- | --- |",
        "| {{7 + {agility} + {evasionBonus} + {evasionEquipmentBonus}}} | {{20 + {agility} + {dodgeBonus} + {dodgeEquipmentBonus}}} | {{trunc({toughness} + {equipmentGuardValue})}} | {{({toughness} * 2) + {equipmentBlockValue}}} |",
        "",
        "| Initiative | Save Bonus | Potency | Speed |",
        "| --- | --- | --- | --- |",
        "| {{{agility} + {initiativeAdjustment} - {initiativeEquipmentPenalty}}} | {{{toughness} + {bonusSaveValue}}} | {{11 + {focus}}} | {speed} |",
        "",
        "## Rolls",
        "",
        "| Initiative | Save Bonus |",
        "| --- | --- |",
        "| {{1d4 + {agility} + {initiativeAdjustment} - {initiativeEquipmentPenalty}:button}} | {{2d10 + {toughness} + {bonusSaveValue}:button}} |",
        "",
        "## Attacks",
        "",
        "- {{Light Attack; atk: 1d20 + {focus} + {attackBonus} | damage+max: {lightDamage}:button}}",
        "- {{Heavy Attack; atk: 1d20 + {focus} + {attackBonus} | damage+max: {heavyDamage}:button}}",
        "- {{Precise Attack (pinpoint); atk: 1d20 + ({focus} + {attackBonus}) * 2 | damage+max: {lightDamage}:button}}",
        "",
        "## Main Stats",
        "",
        "| Agility | Toughness | Focus | Power |",
        "| --- | --- | --- | --- |",
        "| {agility} | {toughness} | {focus} | {power} |",
        "",
        "## Sub Stats",
        "",
        "| Fitness | Cunning | Reason | Awareness | Presence |",
        "| --- | --- | --- | --- | --- |",
        "| {fitness} | {cunning} | {reason} | {awareness} | {presence} |",
      ].join("\n"),
      variableIds: [
        "hp",
        "mp",
        "rp",
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
        "manaAdjustments",
        "evasionBonus",
        "evasionEquipmentBonus",
        "dodgeBonus",
        "dodgeEquipmentBonus",
        "equipmentGuardValue",
        "equipmentBlockValue",
        "initiativeAdjustment",
        "initiativeEquipmentPenalty",
        "bonusSaveValue",
        "speed",
        "rpAdjustment",
        "oldArmorCalc",
        "lightDamage",
        "heavyDamage",
        "attackBonus",
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
 * colOffset: 1` -- see `findLabelValue` below, the common case);
 * "Evasion Bonus"/"Dodge Bonus"/"Initiative Adjustment (Positive)"/
 * "RP Adjustment (Negative)"/"Check Box if Old Armor Calc" each sit
 * ONE ROW ABOVE their own value in the SAME column (`rowOffset: 1,
 * colOffset: 0`) -- note the real label text includes that trailing
 * "(Positive)"/"(Negative)"; an exact match against the SHORTER name
 * alone silently finds nothing and falls back to the variable's own
 * default (found live: Initiative read 0 instead of its real
 * "Adjustment" value of 1 until this was caught). "Mana
 * Adjustments"/"Bonus Save Value" sit TWO ROWS above their own value
 * (`rowOffset: 2, colOffset: 0` -- a stray "Add - for Negative" text
 * row sits directly beneath the "Mana Adjustments" label itself,
 * pushing its real value down one extra row versus the other
 * adjustment cells); "Equipment Guard/Block Value" and "Equipment
 * Penalty" sit TWO COLUMNS right of their own label, with a blank
 * spacer column between them (`rowOffset: 0, colOffset: 2`).
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
 * Evasion/Dodge/Guard/Block/Initiative formulas each run a `SUMIF`
 * over. Found by header text, not a fixed row/column, same spirit as
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

/** Light/Heavy Damage are already a COMPLETE dice-notation string on the real sheet (e.g. "2d4+5") -- read verbatim, never coerced toward a number the way every other Core cell this mod reads is. */
function asText(value: Cell | undefined, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

const importer = (workbook: ImportedWorkbook): CharacterSheetImportResult => {
  const core = workbook["Core"] ?? [];
  const num = (label: string, fallback = 0) => asNumber(findLabelValue(core, label), fallback);

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
  const manaAdjustments = asNumber(findLabelValueAt(core, "Mana Adjustments", 2, 0), 0);
  const evasionBonus = asNumber(findLabelValueAt(core, "Evasion Bonus", 1, 0), 0);
  const dodgeBonus = asNumber(findLabelValueAt(core, "Dodge Bonus", 1, 0), 0);
  const equipmentGuardValue = asNumber(findLabelValueAt(core, "Equipment Guard Value", 0, 2), 0);
  const equipmentBlockValue = asNumber(findLabelValueAt(core, "Equipment Block Value", 0, 2), 0);
  // "Equipment Penalty" is the real sheet's own pre-computed duplicate
  // of Evasion's equipment SUMIF (confirmed directly: identical
  // formula, same cell range) -- reused rather than re-summed; RP's
  // own formula references this SAME cell too. Dodge's and
  // Initiative's own equipment terms have no such duplicate anywhere
  // else on the tab, so they're computed directly from the weapon/
  // armor table.
  const evasionEquipmentBonus = asNumber(findLabelValueAt(core, "Equipment Penalty", 0, 2), 0);
  const dodgeEquipmentBonus = sumIfEquipped(core, "dodge");
  const initiativeAdjustment = asNumber(findLabelValueAt(core, "Initiative Adjustment (Positive)", 1, 0), 0);
  const initiativeEquipmentPenalty = sumIfEquipped(core, "initiative penalty");
  const bonusSaveValue = asNumber(findLabelValueAt(core, "Bonus Save Value", 2, 0), 0);
  const speed = num("Speed");
  const rpAdjustment = asNumber(findLabelValueAt(core, "RP Adjustment (Negative)", 1, 0), 0);
  const oldArmorCalc = findLabelValueAt(core, "Check Box if Old Armor Calc", 1, 0) === true ? 1 : 0;
  const lightDamage = asText(findLabelValue(core, "Light Damage"), "");
  const heavyDamage = asText(findLabelValue(core, "Heavy Damage"), "");

  // HP/MP/RP's own MAX is live now (the template's own maxExpression,
  // resolved fresh every render -- see this file's own header
  // comment), so only the CURRENT value needs seeding here, computed
  // from the exact same formula ONE TIME at import (full/max at
  // creation -- the sheet is a character BUILD sheet, not a live
  // combat tracker, so there's no separate "current damage taken" of
  // its own to import for any of the three).
  const hp = 20 + 10 * toughness + hpBonus;
  const mp = Math.trunc(6 + power + manaAdjustments);
  const rp = (oldArmorCalc ? 2 + (agility - evasionEquipmentBonus) : 2 + agility) - rpAdjustment;

  return {
    variableValues: {
      hp,
      mp,
      rp,
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
      manaAdjustments,
      evasionBonus,
      evasionEquipmentBonus,
      dodgeBonus,
      dodgeEquipmentBonus,
      equipmentGuardValue,
      equipmentBlockValue,
      initiativeAdjustment,
      initiativeEquipmentPenalty,
      bonusSaveValue,
      speed,
      rpAdjustment,
      oldArmorCalc,
      lightDamage,
      heavyDamage,
    },
    pages: [],
  };
};

export const characterSheetImporter = importer;

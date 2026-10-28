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
// characterSheet.ts's `resolveVariableValue` -- a real, graph-cycle-
// checked live resolver, not a value frozen at import time) --
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
//
// Real request, 2026-10-26 (third pass -- "skills rework"): "let's put
// the number entry for the skill in between the skill and roll
// columns... if we could make the labels buttons instead, that would
// be best, so the Agility label would be a button... the Medicine
// label would now be a button, etc." Every label that triggers a roll
// is now the button itself (no separate "Roll" column/cell anywhere):
//
// - Every Main/Sub stat's own table HEADER cell (e.g. "Agility") is a
//   single-part compound roll button (`{{Agility; agility check:
//   1d20 + {agility}}}`), posting "agility check: 16" to chat. Its own
//   EDITABLE value box underneath is unchanged.
// - Every Combat-table value (Evasion/Dodge/Guard/Block/Initiative/
//   Save Bonus/Potency/Speed) is ALSO now a single-part compound-roll
//   button in its own HEADER cell, posting e.g. "evasion: 13" (no real
//   dice -- resolves and posts entirely CLIENT-side, no server round
//   trip) or "initiative: <real 1d4 roll>" (genuine dice -- Initiative
//   and Save Bonus are the only two with real dice in their own
//   formula, `1d4`/`2d10` respectively, matching the sheet's own real
//   die sizes, confirmed directly since neither appears as text
//   anywhere on the sheet to check against). The old separate "##
//   Rolls" table (which duplicated Initiative/Save Bonus as their own
//   extra roll buttons) is gone -- redundant now that the header cells
//   themselves roll. Each one's own EXISTING plain-number value row
//   stays exactly as it was.
// - Each Skill's own NAME cell is a 2-part compound roll button
//   (`{{Athletics; roll: 1d20 + {athleticsBonus} | expertise:
//   {athleticsExpertise}}}`), posting both the roll AND the
//   expertise text together (e.g. "Athletics -> roll: 15, expertise:
//   jumping") -- the formerly separate "Roll" column is gone, folded
//   into the name button; Bonus/Skill Points/Expertise remain their
//   own plain visible columns too (the SAME values the roll's own
//   parts reference), column order now "Skill | Bonus | Skill Points
//   | Expertise".
//
// A skill's own Bonus is now LIVE (`valueExpression: "{<governing
// substat>} + {<id>SkillPoints}"`, shared/characterSheet.ts's
// generalized `resolveVariableValue`), not a frozen import snapshot --
// "Bonus on the page should show the resulting number, and the
// core&variables should show that equation you put." The governing
// substat is read PER SKILL off the real sheet's own column F (one
// column right of the skill's own name in column E) rather than
// hand-listed here, since the sheet itself already states it
// per-row; Skill Points (column H, three columns right) imports as
// its own new, session-editable variable. If a skill's own governing-
// stat text doesn't match a known stat id (blank/unexpected), Bonus
// falls back to the OLD frozen-number behavior (column G, two columns
// right) rather than silently breaking its formula.
//
// Real architecture fix, same day: `CharacterSheetImportResult`
// previously had no way to add/refine a variable DEFINITION at all
// (only its per-character VALUE), so a crafting skill's own Bonus
// (dynamically named, varies per character) could never get this same
// live-formula/editable treatment -- a real, confirmed limitation.
// That type now also carries an optional `variables` array (merged by
// id into the character's own sheet, see server.ts), which closes this
// gap: Crafting now gets the SAME "Skill | Bonus | Skill Points |
// Expertise" shape as the fixed Skills list, with Bonus LIVE too
// (`valueExpression: "<frozen base bonus> + {<id>SkillPoints}"` --
// the base number itself still comes from a one-time import snapshot,
// same honest "equipment stays frozen until re-import" limitation as
// elsewhere in this file, but Skill Points on top of it is genuinely
// live/editable from here on). Crafting's own Expertise is read from
// column P (three columns right of the "Crafting Skill" header) --
// real correction, confirmed directly by the user: that column's own
// header text literally reads "Equipment Bonus" on the real sheet, but
// is actually used by this user's own sheet convention to hold
// Crafting Expertise, not an equipment bonus at all.
//
// "add the skill checks, from athletics at the top to intimidation at
// the bottom... for crafting it's 1d20+N9 to 1d20+N29 but only add
// those if the crafting skill is not blank." Confirmed directly
// against the real sheet: Core's own skill table (rows 9-29) is a
// genuinely FIXED, 21-row list -- same skill names, same order, on
// every Lyrian character (unlike a weapon slot or crafting skill,
// which vary per character) -- so these 21 are hand-listed here
// (`SKILLS` below) as part of the TEMPLATE's own fixed "Skills" page,
// same tier "Core" already is. Crafting skill NAMES themselves are NOT
// fixed (confirmed: the real sheet's own "Crafting Skill" column holds
// whatever this ONE character picked, e.g. just "Alchemy" -- 20 of its
// own 21 rows are blank), so a separate "Crafting" PAGE is generated
// by the IMPORTER itself instead (like Abilities/Inventory will be),
// one row per non-blank crafting skill.

import { type CharacterSheetTemplate, type CharacterSheetPageDef, type CharacterSheetVariableDef, type CharacterSheetImportResult, type ImportedWorkbook, type AbilityCatalogEntry } from "@ttrpg3d/shared";

/**
 * The real sheet's own skill list (Core tab, column E, rows 9-29,
 * confirmed directly, top to bottom) -- fixed, same for every
 * character using this template (never imported/generated).
 */
const SKILLS = [
  "Athletics",
  "Riding",
  "Stealth",
  "Deception",
  "Roguecraft",
  "Medicine",
  "Common Knowledge",
  "Linguistics",
  "Magic",
  "Religion",
  "Appraise",
  "History",
  "Flight",
  "Artifice",
  "Perception",
  "Insight",
  "Survival",
  "Animal Husbandry",
  "Art",
  "Negotiation",
  "Intimidation",
];

/** Every Main/Sub stat's own variable id -- used to recognize a skill's own governing-substat text (column F) as a REAL stat reference, not guessed/hand-mapped per skill (the real sheet already states each skill's own governing stat per-row). */
const STAT_IDS = new Set(["agility", "toughness", "focus", "power", "fitness", "cunning", "reason", "awareness", "presence"]);

/** "Common Knowledge" -> "commonKnowledge" -- a plain camelCase variable id derived from a skill's own display name, so SKILLS above is the ONE place each skill's name is actually spelled out. */
function skillVariableId(name: string): string {
  return name
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

/** Same derivation as `skillVariableId`, prefixed with "crafting" -- a crafting skill's own name is character-specific (e.g. "Alchemy"), never one of the fixed SKILLS above, but could coincidentally collide with one in the unlikely event a character's own crafting pick shares a name with a fixed skill; this prefix guarantees it never does. */
function craftingVariableId(name: string): string {
  const base = skillVariableId(name);
  return `crafting${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

/**
 * Real request, 2026-10-26 (traits & abilities round): sanitizes a
 * class/breakthrough's own display name into a valid `{variableId}`
 * (shared/characterSheet.ts's own findVariableRefs only ever matches
 * `[a-zA-Z0-9_-]+`) -- unlike a skill's own name (skillVariableId
 * above, which never needed this), a real class or breakthrough name
 * can contain parentheses, apostrophes, commas, or colons (e.g. "Fae
 * Flash Acrobat (Fae)", "Divine's Chosen", "Summon Contract: Fortuna,
 * Lady Luck"), which would otherwise break every `{variableId}`
 * reference built from it. Confirmed directly against the real
 * sheet's own 185 classes and 89 breakthroughs: no two distinct names
 * collide under this transform.
 */
function slugify(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word, i) => (i === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

/** `classVariableId`/`breakthroughVariableId` below are the SAME transform `packages/client/src/mods/lyrianChronicles.ts`'s own auto-calculate button duplicates (not imported -- that file is CLIENT code, this one's SERVER-only) to recover a row's own id shape without ever needing its display name again. */
function classVariableId(name: string): string {
  const base = slugify(name);
  return `class${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

function breakthroughVariableId(name: string): string {
  const base = slugify(name);
  return `breakthrough${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

const skillVariables: CharacterSheetVariableDef[] = SKILLS.flatMap((name) => {
  const id = skillVariableId(name);
  return [
    // No `valueExpression` here -- the governing substat isn't known
    // until import time (read per-skill off the real sheet's own
    // column F, see the importer below), which SETS it via the new
    // `CharacterSheetImportResult.variables` override. A character
    // that picks this template WITHOUT importing just gets an
    // ordinary flat, editable Bonus (default 0), same as before this
    // feature existed.
    { id: `${id}Bonus`, label: `${name} Bonus`, type: "number" as const, default: 0 },
    { id: `${id}SkillPoints`, label: `${name} Skill Points`, type: "number" as const, default: 0 },
    { id: `${id}Expertise`, label: `${name} Expertise`, type: "text" as const, default: "" },
  ];
});

function skillRowMarkdown(name: string, id: string): string {
  return `| {{${name}; roll: 1d20 + {${id}Bonus} | expertise: {${id}Expertise}}} | {${id}Bonus} | {${id}SkillPoints} | {${id}Expertise} |`;
}

const skillsPage: CharacterSheetPageDef = {
  title: "Skills",
  markdown: ["# Skills", "", "| Skill | Bonus | Skill Points | Expertise |", "| --- | --- | --- | --- |", ...SKILLS.map((name) => skillRowMarkdown(name, skillVariableId(name)))].join("\n"),
  variableIds: SKILLS.flatMap((name) => {
    const id = skillVariableId(name);
    return [`${id}Bonus`, `${id}SkillPoints`, `${id}Expertise`];
  }),
};

/**
 * Real request, 2026-10-28: "traits & abilities (2 tabs)." Starts
 * EMPTY (unlike Skills/Core, there's nothing on the real sheet this
 * page is imported FROM at all -- an ability gets added entirely
 * post-import, one at a time, via its own two client-side mod
 * actions below). A FIXED template page, not importer-generated,
 * specifically so it already exists (with its own two buttons ready
 * to click) the moment a character picks this template, import or
 * not -- same "the template's own shape doesn't vary per character,
 * only its CONTENT does" reasoning every other fixed page already
 * follows.
 *
 * `addAbility`/`autoPopulateAbilities` (packages/client/src/mods/
 * lyrianChronicles.ts) each append their own new ability rows
 * directly onto THIS page's own markdown by title match
 * (characterSheetView.ts's generic mod-action handler, `pageEdits`)
 * -- there is no per-character variable involved at all (see that
 * file's own "Abilities round" header for why a long, punctuation-
 * heavy description can't safely be one).
 */
const abilitiesPage: CharacterSheetPageDef = {
  title: "Abilities",
  // Deliberately no "no abilities yet" placeholder text below the
  // buttons -- `pageEdits` only ever APPENDS new rows (characterSheetView.ts's
  // generic mod-action handler), so static placeholder text would
  // never get cleared out once the first real ability lands.
  markdown: [
    "# Abilities",
    "",
    '<button type="button" data-mod-action="lyrian-chronicles.addAbility">Add Ability</button>',
    '<button type="button" data-mod-action="lyrian-chronicles.autoPopulateAbilities">Auto-Populate from Traits</button>',
  ].join("\n"),
  variableIds: [],
};

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
    // Real request, 2026-10-26 (traits & abilities round): "traits
    // will be character race... sub-race, character taken classes,
    // breakthroughs, and 'spirit core'." Race/Sub-Race are plain,
    // editable text (same tier as everything else in this mod);
    // Total EXP Earned is a single imported snapshot of the real
    // sheet's own running ledger total ('EXP & Transactions'!D2 --
    // the ledger ITSELF stays un-imported, same "a derived snapshot
    // is enough" precedent HP/MP/RP already set); Spirit Core is the
    // remaining currency after every class/breakthrough is paid for,
    // imported as the real sheet's own number until the Traits page's
    // own Auto-Calculate button recomputes it live (see
    // packages/client/src/mods/lyrianChronicles.ts).
    { id: "race", label: "Race", type: "text", default: "" },
    { id: "subRace", label: "Sub-Race", type: "text", default: "" },
    { id: "totalExp", label: "Total EXP Earned", type: "number", default: 0 },
    { id: "spiritCore", label: "Spirit Core (Remaining)", type: "number", default: 0 },
    ...skillVariables,
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
      // Real request, 2026-10-26 (third pass): every Combat-table/
      // Main-Stats/Sub-Stats HEADER cell below is now itself a
      // single-part compound-roll button (the label IS the button --
      // see this file's own header comment) -- each one's own EXISTING
      // value row underneath is UNCHANGED. The old separate "## Rolls"
      // table is gone entirely (Initiative/Save Bonus roll from their
      // own header cell now, same as everything else).
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
        "| {{Evasion; evasion: 7 + {agility} + {evasionBonus} + {evasionEquipmentBonus}}} | {{Dodge; dodge: 20 + {agility} + {dodgeBonus} + {dodgeEquipmentBonus}}} | {{Guard; guard: trunc({toughness} + {equipmentGuardValue})}} | {{Block; block: ({toughness} * 2) + {equipmentBlockValue}}} |",
        "| --- | --- | --- | --- |",
        "| {{7 + {agility} + {evasionBonus} + {evasionEquipmentBonus}}} | {{20 + {agility} + {dodgeBonus} + {dodgeEquipmentBonus}}} | {{trunc({toughness} + {equipmentGuardValue})}} | {{({toughness} * 2) + {equipmentBlockValue}}} |",
        "",
        "| {{Initiative; initiative: 1d4 + {agility} + {initiativeAdjustment} - {initiativeEquipmentPenalty}}} | {{Save Bonus; save bonus: 2d10 + {toughness} + {bonusSaveValue}}} | {{Potency; potency: 11 + {focus}}} | {{Speed; speed: {speed}}} |",
        "| --- | --- | --- | --- |",
        "| {{{agility} + {initiativeAdjustment} - {initiativeEquipmentPenalty}}} | {{{toughness} + {bonusSaveValue}}} | {{11 + {focus}}} | {speed} |",
        "",
        "## Attacks",
        "",
        "- {{Light Attack; atk: 1d20 + {focus} + {attackBonus} | damage+max: {lightDamage}:button}}",
        "- {{Heavy Attack; atk: 1d20 + {focus} + {attackBonus} | damage+max: {heavyDamage}:button}}",
        "- {{Precise Attack (pinpoint); atk: 1d20 + ({focus} + {attackBonus}) * 2 | damage+max: {lightDamage}:button}}",
        "",
        "## Main Stats",
        "",
        "| {{Agility; agility check: 1d20 + {agility}}} | {{Toughness; toughness check: 1d20 + {toughness}}} | {{Focus; focus check: 1d20 + {focus}}} | {{Power; power check: 1d20 + {power}}} |",
        "| --- | --- | --- | --- |",
        "| {agility} | {toughness} | {focus} | {power} |",
        "",
        "## Sub Stats",
        "",
        "| {{Fitness; fitness check: 1d20 + {fitness}}} | {{Cunning; cunning check: 1d20 + {cunning}}} | {{Reason; reason check: 1d20 + {reason}}} | {{Awareness; awareness check: 1d20 + {awareness}}} | {{Presence; presence check: 1d20 + {presence}}} |",
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
    skillsPage,
    abilitiesPage,
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
 * spacer column between them (`rowOffset: 0, colOffset: 2`). A skill's
 * own row (Skills table, column E) is its own 5-column layout: name
 * (colOffset 0), governing substat (colOffset 1), total bonus
 * (colOffset 2), skill points (colOffset 3), expertise (colOffset 4).
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

/**
 * The real sheet's own "Crafting Skill" table (Core tab, column M,
 * same 21-row span the fixed Skill list -- SKILLS above -- occupies
 * alongside it): found by its own header text, not a fixed row/column
 * (same spirit as `findLabelValueAt`), then every row below it whose
 * own name cell ISN'T blank -- "only add those if the crafting skill
 * is not blank" (confirmed directly: 20 of this real character's own
 * 21 crafting rows are empty, only "Alchemy" is filled in). Each row's
 * own Total Bonus sits ONE column right of its own name (confirmed:
 * M='Crafting Skill', N='Total Bonus'); Expertise sits THREE columns
 * right, at P -- real correction, confirmed directly by the user: that
 * column's own header text literally reads "Equipment Bonus," but is
 * actually used by this user's own sheet convention to hold Crafting
 * Expertise instead.
 */
function findCraftingSkills(grid: Cell[][]): { name: string; bonus: number; expertise: string }[] {
  for (let row = 0; row < grid.length; row++) {
    const col = grid[row].findIndex((cell) => typeof cell === "string" && cell.trim().toLowerCase() === "crafting skill");
    if (col === -1) continue;
    const results: { name: string; bonus: number; expertise: string }[] = [];
    for (let r = row + 1; r <= row + SKILLS.length && r < grid.length; r++) {
      const name = grid[r]?.[col];
      if (typeof name !== "string" || name.trim() === "") continue;
      results.push({ name: name.trim(), bonus: asNumber(grid[r][col + 1], 0), expertise: asText(grid[r]?.[col + 3], "") });
    }
    return results;
  }
  return [];
}

/**
 * Real request, 2026-10-26 (traits & abilities round): "the table
 * should go Class, tier, level, cost which would be like mage, 1, 8,
 * 800." The real sheet's own Class/Class Tier/Class Level/Cost (EXP)
 * table (Core tab, found by its own 4-cell header row, same "found by
 * text, not a fixed row/column" spirit as `findCraftingSkills` above)
 * -- confirmed a FIXED 21-row span (the real sheet's own Spirit Core
 * formula literally sums `D15:D35`, 21 rows), one row per class the
 * character has actually taken, blank rows padding the rest. Tier is
 * read as a bare NUMBER (the real sheet stores it as text, "Tier
 * 1"/"Tier 2"/"Tier 3") since the auto-calculate button's own cost
 * formula needs a number, not text. Cost is the real sheet's own
 * PLAYER-TYPED number -- real confirmation, 2026-10-26: "when
 * importing prefer the typed xp until that [auto-calculate] button is
 * pressed" -- so it's imported VERBATIM here, never recomputed at
 * import time (confirmed directly: this cell is a flat typed number
 * on the real sheet, never a live formula, for every real class row
 * checked).
 */
function findClasses(grid: Cell[][]): { name: string; tier: number; level: number; cost: number }[] {
  const MAX_ROWS = 21; // matches the real sheet's own reserved D15:D35 span (its own Spirit Core formula's SUM range)
  for (let row = 0; row < grid.length; row++) {
    if (!(typeof grid[row][0] === "string" && grid[row][0].trim().toLowerCase() === "class")) continue;
    if (!(typeof grid[row][1] === "string" && grid[row][1].trim().toLowerCase() === "class tier")) continue;
    const results: { name: string; tier: number; level: number; cost: number }[] = [];
    for (let r = row + 1; r <= row + MAX_ROWS && r < grid.length; r++) {
      const name = grid[r]?.[0];
      if (typeof name !== "string" || name.trim() === "") continue;
      const tierMatch = /(\d+)/.exec(asText(grid[r]?.[1], ""));
      results.push({ name: name.trim(), tier: tierMatch ? Number(tierMatch[1]) : 1, level: asNumber(grid[r]?.[2], 1), cost: asNumber(grid[r]?.[3], 0) });
    }
    return results;
  }
  return [];
}

/**
 * Real request, 2026-10-26 (traits & abilities round): "Breakthroughs
 * should go breakthrough, cost, description." The CHARACTER's own
 * "Breakthrough" tab (singular -- distinct from the game's own hidden
 * "Breakthroughs" rulebook tab, which is NEVER available to this
 * importer at all: `characterSheetImport.ts`'s own fetch-and-parse
 * step deliberately skips every hidden tab before the workbook ever
 * reaches the server, confirmed directly -- see packages/client/src/
 * mods/lyrianChronicles.ts's own header for how the auto-calculate
 * button still gets the real rulebook cost anyway, via a hand-
 * transcribed table instead). Header row names its own 4 columns
 * (Breakthrough/XP Spent/Requirement/Description); every row below
 * with a non-blank name is a real pick. Cost is imported VERBATIM
 * from "XP Spent" -- real confirmation, 2026-10-26: "when importing
 * prefer the typed xp until that button is pressed... if the xlsx
 * says 0 xp spent, then we can assume those are the starting
 * breakthroughs" (the one-time 300exp character-creation pool, never
 * costing ongoing Spirit Core -- the SAME 0-means-free rule the auto-
 * calculate button re-derives at click time, see that file).
 */
function findBreakthroughs(workbook: ImportedWorkbook): { name: string; cost: number; description: string }[] {
  const grid = workbook["Breakthrough"] ?? [];
  const results: { name: string; cost: number; description: string }[] = [];
  for (let r = 1; r < grid.length; r++) {
    const name = grid[r]?.[0];
    if (typeof name !== "string" || name.trim() === "") continue;
    results.push({ name: name.trim(), cost: asNumber(grid[r]?.[1], 0), description: asText(grid[r]?.[3], "") });
  }
  return results;
}

/**
 * Real request, 2026-10-28 (Abilities round): "gathered from their
 * imported character sheet xlsx since that has the updated list."
 * The real sheet's own hidden "All Abilities" tab IS the game's full
 * ability rulebook (confirmed directly) -- NEVER this character's own
 * data, see `CharacterSheetImportResult.abilityCatalog`'s own doc for
 * why it refreshes the uploading ACCOUNT's own stored catalog instead
 * of this character's `variableValues`/pages. Only reachable at all
 * when `workbook["All Abilities"]` exists -- characterSheetImport.ts's
 * own named exception is what lets it survive the client's general
 * "skip every hidden tab" rule in the first place.
 */
function findAbilityCatalog(workbook: ImportedWorkbook): AbilityCatalogEntry[] | undefined {
  const grid = workbook["All Abilities"];
  if (!grid) return undefined;
  const catalog: AbilityCatalogEntry[] = [];
  for (let r = 1; r < grid.length; r++) {
    const name = asText(grid[r]?.[0], "");
    if (name === "") continue;
    catalog.push({
      name,
      keywords: asText(grid[r]?.[2], ""),
      range: asText(grid[r]?.[3], ""),
      description: asText(grid[r]?.[4], ""),
      requirement: asText(grid[r]?.[5], ""),
      cost: asText(grid[r]?.[6], ""),
      apCost: asText(grid[r]?.[7], ""),
      manaCost: asText(grid[r]?.[8], ""),
      rpCost: asText(grid[r]?.[9], ""),
      benefits: asText(grid[r]?.[10], ""),
    });
  }
  return catalog;
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

  // Traits & abilities round, 2026-10-26: Race/Sub-Race are plain
  // label-scans, same convention as everything else on Core. Total
  // EXP Earned is a single snapshot off a DIFFERENT tab's own running
  // total ('EXP & Transactions'!D2, label "Experience Total" one row
  // below itself, same `findLabelValueAt` shape) -- the ledger itself
  // stays un-imported. Spirit Core is the real sheet's own number
  // (its own formula: Total EXP minus every class/breakthrough cost)
  // -- imported verbatim, "take from the xlsx" until the Traits
  // page's own Auto-Calculate button recomputes it live.
  const race = asText(findLabelValue(core, "Race"), "");
  const subRace = asText(findLabelValue(core, "Sub-Race | House"), "");
  const expTab = workbook["EXP & Transactions"] ?? [];
  const totalExp = asNumber(findLabelValueAt(expTab, "Experience Total", 1, 0), 0);
  const spiritCore = asNumber(findLabelValue(core, "Spirit Core"), 0);

  // Each fixed skill's own governing substat (column F, 1 right of its
  // own name in column E), Skill Points (column H, 3 right), and
  // Expertise (column I, 4 right) -- same label-scan convention as
  // everything else in this file. The governing substat drives a LIVE
  // `valueExpression` override for that skill's own Bonus (real
  // request, 2026-10-26, third pass) rather than importing a frozen
  // number for it; if the governing-stat text doesn't match a known
  // stat id (blank/unexpected), Bonus falls back to the OLD frozen
  // read (column G, 2 right) instead of silently breaking.
  const skillValues: Record<string, number | string> = {};
  const skillVariableOverrides: CharacterSheetVariableDef[] = [];
  for (const name of SKILLS) {
    const id = skillVariableId(name);
    const governingStat = asText(findLabelValueAt(core, name, 0, 1), "").trim().toLowerCase();
    const skillPoints = asNumber(findLabelValueAt(core, name, 0, 3), 0);
    const expertise = asText(findLabelValueAt(core, name, 0, 4), "");
    skillValues[`${id}SkillPoints`] = skillPoints;
    skillValues[`${id}Expertise`] = expertise;
    if (STAT_IDS.has(governingStat)) {
      skillVariableOverrides.push({ id: `${id}Bonus`, label: `${name} Bonus`, type: "number", default: 0, valueExpression: `{${governingStat}} + {${id}SkillPoints}` });
    } else {
      skillValues[`${id}Bonus`] = asNumber(findLabelValueAt(core, name, 0, 2), 0);
    }
  }

  // "for crafting it's 1d20+N9 to 1d20+N29 but only add those if the
  // crafting skill is not blank" -- a dynamically-generated page
  // (unlike Skills above, there's no fixed name list to reference by
  // `{variableId}`), one row per non-blank crafting skill, now with
  // the SAME "Skill | Bonus | Skill Points | Expertise" shape (real
  // request, 2026-10-26, third pass) via brand-new per-character
  // variable definitions (`skillVariableOverrides`'s own sibling
  // below, `craftingVariables`) -- Bonus's own frozen BASE number
  // (the real sheet's own "Total Bonus," one-time snapshot, same
  // equipment-derived limitation noted elsewhere in this file) plus a
  // genuinely live, session-editable Skill Points on top of it.
  const craftingSkills = findCraftingSkills(core);
  const craftingVariables: CharacterSheetVariableDef[] = [];
  const craftingValues: Record<string, number | string> = {};
  for (const skill of craftingSkills) {
    const id = craftingVariableId(skill.name);
    craftingVariables.push(
      { id: `${id}Bonus`, label: `${skill.name} Bonus`, type: "number", default: 0, valueExpression: `${skill.bonus} + {${id}SkillPoints}` },
      { id: `${id}SkillPoints`, label: `${skill.name} Skill Points`, type: "number", default: 0 },
      { id: `${id}Expertise`, label: `${skill.name} Expertise`, type: "text", default: "" },
    );
    craftingValues[`${id}Expertise`] = skill.expertise;
  }
  const craftingPage: CharacterSheetPageDef = {
    title: "Crafting",
    markdown:
      craftingSkills.length === 0
        ? "# Crafting\n\nNo crafting skills."
        : ["# Crafting", "", "| Skill | Bonus | Skill Points | Expertise |", "| --- | --- | --- | --- |", ...craftingSkills.map((skill) => skillRowMarkdown(skill.name, craftingVariableId(skill.name)))].join(
            "\n",
          ),
    variableIds: craftingVariables.map((v) => v.id),
  };

  // Traits & abilities round, 2026-10-26: "There should be one button
  // to auto-calculate costs on that traits page... but when importing
  // prefer the typed xp until that button is pressed" -- every
  // class/breakthrough row's own Cost is imported VERBATIM (the real
  // sheet's own player-typed number), never recomputed here; only the
  // Traits page's own Auto-Calculate button (packages/client/src/mods/
  // lyrianChronicles.ts) ever overwrites it, client-side, on request.
  const classes = findClasses(core);
  const classVariables: CharacterSheetVariableDef[] = [];
  const classValues: Record<string, number | string> = {};
  for (const cls of classes) {
    const id = classVariableId(cls.name);
    classVariables.push(
      { id: `${id}Tier`, label: `${cls.name} Tier`, type: "number", default: 1 },
      { id: `${id}Level`, label: `${cls.name} Level`, type: "number", default: 1 },
      { id: `${id}Cost`, label: `${cls.name} Cost`, type: "number", default: 0 },
    );
    classValues[`${id}Tier`] = cls.tier;
    classValues[`${id}Level`] = cls.level;
    classValues[`${id}Cost`] = cls.cost;
  }

  const breakthroughs = findBreakthroughs(workbook);
  const breakthroughVariables: CharacterSheetVariableDef[] = [];
  const breakthroughValues: Record<string, number | string> = {};
  for (const bt of breakthroughs) {
    const id = breakthroughVariableId(bt.name);
    breakthroughVariables.push({ id: `${id}Cost`, label: `${bt.name} Cost`, type: "number", default: 0 }, { id: `${id}Description`, label: `${bt.name} Description`, type: "text", default: "" });
    breakthroughValues[`${id}Cost`] = bt.cost;
    breakthroughValues[`${id}Description`] = bt.description;
  }

  const traitsPage: CharacterSheetPageDef = {
    title: "Traits",
    markdown: [
      "# Traits",
      "",
      "## Identity",
      "",
      "| Race | Sub-Race |",
      "| --- | --- |",
      "| {race} | {subRace} |",
      "",
      "## Currency",
      "",
      "| Total EXP Earned | Spirit Core (Remaining) |",
      "| --- | --- |",
      "| {totalExp} | {spiritCore} |",
      "",
      "Recomputes every class's own Cost (tier's first level costs tier × 100, every level after costs 100) and every breakthrough's own Cost (already-free breakthroughs stay free; every other one gets its real cost from the rulebook), then Spirit Core from those.",
      "",
      '<button type="button" data-mod-action="lyrian-chronicles.recalculateTraitsCosts">Auto-Calculate Costs</button>',
      "",
      "## Classes",
      "",
      classes.length === 0
        ? "No classes."
        : [
            "| Class | Tier | Level | Cost |",
            "| --- | --- | --- | --- |",
            ...classes.map((cls) => {
              const id = classVariableId(cls.name);
              return `| ${cls.name} | {${id}Tier} | {${id}Level} | {${id}Cost} |`;
            }),
          ].join("\n"),
      "",
      "## Breakthroughs",
      "",
      breakthroughs.length === 0
        ? "No breakthroughs."
        : [
            "| Breakthrough | Cost | Description |",
            "| --- | --- | --- |",
            ...breakthroughs.map((bt) => {
              const id = breakthroughVariableId(bt.name);
              return `| ${bt.name} | {${id}Cost} | {${id}Description} |`;
            }),
          ].join("\n"),
    ].join("\n"),
    variableIds: ["race", "subRace", "totalExp", "spiritCore", ...classVariables.map((v) => v.id), ...breakthroughVariables.map((v) => v.id)],
  };

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
      race,
      subRace,
      totalExp,
      spiritCore,
      ...skillValues,
      ...craftingValues,
      ...classValues,
      ...breakthroughValues,
    },
    pages: [craftingPage, traitsPage],
    variables: [...skillVariableOverrides, ...craftingVariables, ...classVariables, ...breakthroughVariables],
    abilityCatalog: findAbilityCatalog(workbook),
  };
};

export const characterSheetImporter = importer;

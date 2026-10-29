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
 * `addAbility`/`addCustomAbility`/`autoPopulateAbilities` (packages/
 * client/src/mods/lyrianChronicles.ts) each append their own new
 * ability rows directly onto THIS page's own markdown by title match
 * (characterSheetView.ts's generic mod-action handler, `pageEdits`)
 * -- there is no per-character variable involved at all (see that
 * file's own "Abilities round" header for why a long, punctuation-
 * heavy description can't safely be one). Real request, 2026-10-29:
 * "both already existing abilities as well as custom should be able
 * to be added" -- "Add Ability" (searches the real rulebook catalog)
 * and "Add Custom Ability" (a blank, obviously-placeholder template,
 * meant to be hand-edited afterward via this page's own EXISTING
 * Edit-mode button) are two SEPARATE, equally-available buttons, not
 * one replacing the other.
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
    '<button type="button" data-mod-action="lyrian-chronicles.addCustomAbility">Add Custom Ability</button>',
    '<button type="button" data-mod-action="lyrian-chronicles.autoPopulateAbilities">Auto-Populate from Traits</button>',
  ].join("\n"),
  variableIds: [],
};

// Real request, 2026-10-29 (playtest, inventory round): "the weapons
// table on the core page from A-36 to E-42, the armor table from
// F-36 to L-42... adding the injuries table to the core page." Both
// weapons and armor are a FIXED 6-slot table on the real sheet
// (confirmed directly: rows 37-42, always exactly 6, never a variable
// count the way a class/breakthrough row is), so -- unlike Classes/
// Breakthroughs -- these get a fixed, known id scheme declared
// directly here, no per-character override array needed. These SIX
// consts (not the rest of this round's own helper FUNCTIONS, which
// stay below, near where they're used -- see `sumIfArmorEquipped`,
// `findEquipmentTableRows`, etc.) have to live here, textually BEFORE
// `characterSheetTemplate`, specifically because the template object
// below references them directly while it's being constructed
// (`...weaponVariables`, `valueExpression: sumIfArmorEquipped(...)`);
// a plain `const` is only safely readable AFTER its own declaration
// line has executed (unlike a `function`, which is fully hoisted) --
// confirmed the hard way: moving these below the template (next to
// their own sibling helpers, which felt more natural) threw
// "Cannot access 'ARMOR_SLOT_COUNT' before initialization" the moment
// any character sheet loaded.
const WEAPON_SLOT_COUNT = 6;
const ARMOR_SLOT_COUNT = 6;
const weaponVariables: CharacterSheetVariableDef[] = Array.from({ length: WEAPON_SLOT_COUNT }, (_, i) => i + 1).flatMap(weaponVariableDefs);
const armorVariables: CharacterSheetVariableDef[] = Array.from({ length: ARMOR_SLOT_COUNT }, (_, i) => i + 1).flatMap(armorVariableDefs);
const INJURY_LABELS = ["Main Hand", "Muscle", "Spirit Circuit", "Off Hand", "Leg", "Head", "Wound", "Eye", "Laceration", "Foot"];
const injuryVariables: CharacterSheetVariableDef[] = INJURY_LABELS.map((label) => ({ id: injuryVariableId(label), label, type: "number", default: 0 }));
/** A brand-new (non-imported) character has no injuries yet -- every checkbox starts unchecked, same "blank default" tier as every other variable's own `default: 0`. */
const DEFAULT_INJURY_FLAGS: Record<string, boolean> = Object.fromEntries(INJURY_LABELS.map((label) => [injuryVariableId(label), false]));

/**
 * Real request, same day: "the inventory page would also have the
 * combat burden total and burden total at the top using the same
 * calculations in the inventory tab." These five are plain flat
 * numbers (default 0, matching "nothing carried yet" for a blank
 * character) in the STATIC template; the importer overwrites each
 * with a real `valueExpression` summing however many real rows that
 * ONE character's own Inventory tab actually has (see
 * `burdenListVariables` below) -- a per-character-LENGTH formula, so
 * it has to be built at import time, never a fixed string here.
 */
const inventoryTotalVariables: CharacterSheetVariableDef[] = [
  { id: "burdenTotal", label: "Burden Total", type: "number", default: 0 },
  { id: "combatBurdenTotal", label: "Combat Burden Total", type: "number", default: 0 },
  { id: "inventoryClimValue", label: "Inventory Clim Value", type: "number", default: 0 },
  { id: "adventurersKitBurdenTotal", label: "Adventurer's Kit Burden Total", type: "number", default: 0 },
  { id: "alchemyRigBurdenTotal", label: "Alchemy Rig Burden Total", type: "number", default: 0 },
];

/** Every weapon/armor slot's own `{variableId}` reference -- same fixed shape whether a character imports or not, so (unlike the four freeform Inventory-tab lists below) this needs no per-character override; only "Armor Equipped?"'s own baked `checked` state differs (`DEFAULT_ARMOR_EQUIPPED` below: every slot starts unequipped, same "blank default" reasoning as `DEFAULT_INJURY_FLAGS`). */
const DEFAULT_ARMOR_EQUIPPED: readonly boolean[] = Array.from({ length: ARMOR_SLOT_COUNT }, () => false);

/**
 * Real request, same day: "the inventory page would also have the
 * combat burden total and burden total at the top... then the combat
 * loadout, adventurer's kit, and alchemy rig, and below all of that
 * the expedition inventory itself." Fixed page (same tier as
 * Abilities above -- always exists, import or not); the four
 * freeform lists start as empty "No items yet." placeholders here,
 * same "importer overrides with real rows" shape Traits/Crafting
 * already use for their own dynamic content.
 */
const inventoryPage: CharacterSheetPageDef = {
  title: "Inventory",
  markdown: inventoryMarkdown(DEFAULT_ARMOR_EQUIPPED, "No items yet.", "No items yet.", "No items yet.", "No items yet."),
  variableIds: [...weaponVariables.map((v) => v.id), ...armorVariables.map((v) => v.id), ...inventoryTotalVariables.map((v) => v.id)],
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
    { id: "evasionEquipmentBonus", label: "Evasion Equipment Bonus", type: "number", default: 0, valueExpression: sumIfArmorEquipped("Evasion") },
    { id: "dodgeBonus", label: "Dodge Bonus", type: "number", default: 0 },
    { id: "dodgeEquipmentBonus", label: "Dodge Equipment Bonus", type: "number", default: 0, valueExpression: sumIfArmorEquipped("Dodge") },
    { id: "equipmentGuardValue", label: "Equipment Guard Value", type: "number", default: 0, valueExpression: sumIfArmorEquipped("Guard") },
    { id: "equipmentBlockValue", label: "Equipment Block Value", type: "number", default: 0, valueExpression: sumIfArmorEquipped("Block") },
    { id: "initiativeAdjustment", label: "Initiative Adjustment", type: "number", default: 0 },
    { id: "initiativeEquipmentPenalty", label: "Initiative Equipment Penalty", type: "number", default: 0, valueExpression: sumIfArmorEquipped("InitiativePenalty") },
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
    // Real request, 2026-10-29 (inventory round): "under attacks on
    // the core page, after the light/heavy/precise buttons, add
    // spinboxes default to zero for adding to focus or power for the
    // attacks. There are mods that do that for different weapons ppl
    // switch between." The real to-hit roll itself stays Focus-only
    // (confirmed directly: the real sheet's own formula, `=B9`, never
    // adds Power) -- these are two MORE flat manual modifiers on top
    // of `attackBonus` above, not a second Power-based roll; switching
    // between a Focus weapon and a Power-keyed one (post-weapon-table)
    // is just zeroing out whichever of the two doesn't apply.
    { id: "attackFocusBonus", label: "Attack Focus Bonus", type: "number", default: 0 },
    { id: "attackPowerBonus", label: "Attack Power Bonus", type: "number", default: 0 },
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
    ...weaponVariables,
    ...armorVariables,
    ...injuryVariables,
    ...inventoryTotalVariables,
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
      markdown: coreMarkdown(DEFAULT_INJURY_FLAGS),
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
        "attackFocusBonus",
        "attackPowerBonus",
        ...injuryVariables.map((v) => v.id),
      ],
    },
    skillsPage,
    abilitiesPage,
    inventoryPage,
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Real request, 2026-10-28: "each class should be a dropdown with the
 * specific class selected, each breakthrough the same, same with race
 * and sub-race" -- race/sub-race become real `<select>` dropdowns
 * (baked directly into the Traits page's own markdown at import time,
 * same "literal HTML a mod bakes in" precedent the Abilities page's
 * own rows already use) instead of a free-text box, since both are
 * fixed, known lists (confirmed directly off the real sheet's own
 * hidden "Races" tab). `data-var-key` is the SAME attribute
 * `wireVariableWidgets` (characterSheetWidgets.ts) already wires on
 * any input -- generalized to also recognize a `<select>` the same
 * way as a plain text box, so picking a new option here saves exactly
 * like any other edit, no new mechanism needed beyond that one-line
 * fix.
 */
function selectHtml(varKey: string, options: readonly string[], current: string): string {
  const opts = options.map((o) => `<option value="${escapeHtml(o)}"${o === current ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
  return `<select data-var-key="${varKey}">${opts}</select>`;
}

/** Real request, 2026-10-28: "the description of on the draw... should just be text only opened by an i button, since that text is not editable." A plain native disclosure -- zero JS, confirmed to survive DOMPurify sanitization live (characterSheetView.test.ts). */
function detailsHtml(text: string): string {
  const safe = escapeHtml(text).replace(/\n/g, "<br>");
  return `<details><summary>ℹ</summary>${safe}</details>`;
}

/**
 * Real request, 2026-10-29 (inventory round): "Armor Equipped?"/each
 * injury flag is a genuine checkbox on the real sheet, not a number
 * -- same "literal HTML widget baked into the page's own markdown"
 * precedent `selectHtml` above already set for race/sub-race, just a
 * checkbox instead of a dropdown (`wireVariableWidgets`, characterSheetWidgets.ts,
 * generalized the same way to recognize `input[type=checkbox]`).
 */
function checkboxHtml(varKey: string, checked: boolean): string {
  return `<input type="checkbox" data-var-key="${varKey}"${checked ? " checked" : ""}>`;
}

/** A collapsible, bordered "frame" around one Inventory-page section -- same `<details>` mechanism (and the SAME inline border style, duplicated rather than imported: this file is SERVER code, `packages/client/src/mods/lyrianChronicles.ts`'s own `.ability-group` styling is CLIENT-only) the Abilities page's own auto-populated groups already use, real request 2026-10-29: "add a collapse button... that collapses the entire class, race, or breakthrough" -- extended here to every Inventory section, open by default. */
function collapsibleSectionHtml(title: string, bodyMarkdown: string): string {
  return `\n\n<details class="ability-group" open style="border:1px solid rgba(150,150,150,0.5); border-radius:4px; padding:4px 10px 10px; margin:8px 0;"><summary style="font-weight:bold; cursor:pointer; padding:4px 0;">${escapeHtml(title)}</summary>\n\n${bodyMarkdown}\n\n</details>`;
}

/** The real sheet's own "Injuries" block, rendered as its real 2-column (M/N, O/P) layout -- `INJURY_LABELS`' own fixed order, paired left/right exactly as the real sheet pairs them (confirmed directly: M38/O38, M39/O39, ... each SAME row). */
function injuriesTableMarkdown(flags: Readonly<Record<string, boolean>>): string {
  const pairs: [string, string][] = [
    ["Main Hand", "Head"],
    ["Muscle", "Wound"],
    ["Spirit Circuit", "Eye"],
    ["Off Hand", "Laceration"],
    ["Leg", "Foot"],
  ];
  return [
    "| | | | |",
    "| --- | --- | --- | --- |",
    ...pairs.map(([left, right]) => {
      const leftId = injuryVariableId(left);
      const rightId = injuryVariableId(right);
      return `| ${left} | ${checkboxHtml(leftId, flags[leftId] ?? false)} | ${right} | ${checkboxHtml(rightId, flags[rightId] ?? false)} |`;
    }),
  ].join("\n");
}

/**
 * The Core page's own markdown, factored into one function so BOTH
 * the static template (a blank/non-imported character, every injury
 * unchecked -- `DEFAULT_INJURY_FLAGS`) and the importer (a REAL
 * character's own current injury state, read off the sheet by
 * `findInjuryFlags`) produce the exact same page shape, just with
 * different starting checkbox states baked in (same "no live toggle
 * mechanism yet for a literal baked widget" limitation race/sub-race's
 * own `<select>` and "Armor Equipped?" already accept).
 */
function coreMarkdown(injuryFlags: Readonly<Record<string, boolean>>): string {
  return [
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
    "- {{Light Attack; atk: 1d20 + {focus} + {attackFocusBonus} + {attackPowerBonus} + {attackBonus} | damage+max: {lightDamage}:button}}",
    "- {{Heavy Attack; atk: 1d20 + {focus} + {attackFocusBonus} + {attackPowerBonus} + {attackBonus} | damage+max: {heavyDamage}:button}}",
    "- {{Precise Attack (pinpoint); atk: 1d20 + ({focus} + {attackFocusBonus} + {attackPowerBonus} + {attackBonus}) * 2 | damage+max: {lightDamage}:button}}",
    "",
    "| Attack Focus Bonus | Attack Power Bonus |",
    "| --- | --- |",
    "| {attackFocusBonus} | {attackPowerBonus} |",
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
    "",
    "## Injuries",
    "",
    injuriesTableMarkdown(injuryFlags),
  ].join("\n");
}

/** Every one of the 6 fixed weapon slots' own row -- same shared `{{focus}}`/`{{focus * 2}}` live expression in EVERY row for Light/Heavy/Precise Attack (see `weaponVariableDefs`'s own header comment for why there's no per-row variable for these three columns at all). */
function weaponsTableMarkdown(): string {
  const rows = Array.from(
    { length: WEAPON_SLOT_COUNT },
    (_, i) => `| {weapon${i + 1}Name} | {{focus}} | {{focus * 2}} | {weapon${i + 1}LightDamage} | {weapon${i + 1}HeavyDamage} |`,
  );
  return ["| Weapon | Light/Heavy Attack | Precise Attack | Light Damage | Heavy Damage |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

/** Every one of the 6 fixed armor slots' own row -- "Equipped?" is the one column that's a baked checkbox (see `checkboxHtml`'s own header comment) rather than a plain `{variableId}` ref, since there's no genuine boolean widget type in this project. */
function armorTableMarkdown(equippedByIndex: readonly boolean[]): string {
  const rows = Array.from({ length: ARMOR_SLOT_COUNT }, (_, i) => {
    const n = i + 1;
    return `| {armor${n}Equipment} | {armor${n}Guard} | {armor${n}Evasion} | {armor${n}Dodge} | {armor${n}Block} | {armor${n}InitiativePenalty} | ${checkboxHtml(`armor${n}Equipped`, equippedByIndex[i] ?? false)} |`;
  });
  return ["| Equipment | Guard Bonus | Evasion Bonus | Dodge Bonus | Block Bonus | Initiative Penalty | Equipped? |", "| --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}

/**
 * Real request, same day: "then the combat loadout, adventurer's
 * kit, and alchemy rig" -- all three are the SAME shape on the real
 * sheet (a plain Name+Burden list, real data confirmed directly:
 * Combat Loadout G6:H31, Adventurer's Kit G34:H38, Alchemy Rig
 * G45:H49), so ONE function builds all three. `idPrefix` + a plain
 * 1-based index is the per-character variable id (never the item's
 * own NAME -- confirmed directly: "healing potion" appears TWICE in
 * the real Alchemy Rig, which would collide under a name-derived id
 * the way `classVariableId` safely uses for classes/breakthroughs,
 * since THOSE names are drawn from a fixed catalog with no real
 * duplicates). Returns the table markdown, the per-item variable
 * DEFS (brand new, per-character-sized -- same `CharacterSheetImportResult.variables`
 * mechanism `craftingVariables` already uses), their own VALUES, and
 * the live sum expression for this list's own running Burden Total
 * (built from exactly as many terms as there are real rows -- an
 * empty list's own total is a bare `"0"`, never a dangling `+`).
 */
function burdenListMarkdown(idPrefix: string, items: readonly { name: string; burden: number }[]): { markdown: string; variables: CharacterSheetVariableDef[]; values: Record<string, number | string>; totalExpression: string } {
  if (items.length === 0) return { markdown: "No items yet.", variables: [], values: {}, totalExpression: "0" };
  const variables: CharacterSheetVariableDef[] = [];
  const values: Record<string, number | string> = {};
  const rows = items.map((item, i) => {
    const n = i + 1;
    variables.push({ id: `${idPrefix}${n}Name`, label: `${idPrefix} ${n} Name`, type: "text", default: "" }, { id: `${idPrefix}${n}Burden`, label: `${idPrefix} ${n} Burden`, type: "number", default: 0 });
    values[`${idPrefix}${n}Name`] = item.name;
    values[`${idPrefix}${n}Burden`] = item.burden;
    return `| {${idPrefix}${n}Name} | {${idPrefix}${n}Burden} |`;
  });
  const markdown = ["| Item | Burden |", "| --- | --- |", ...rows].join("\n");
  const totalExpression = items.map((_, i) => `{${idPrefix}${i + 1}Burden}`).join(" + ");
  return { markdown, variables, values, totalExpression };
}

/**
 * Real request, same day: "below all of that the expedition
 * inventory itself, with the amount, burden, clim cost, and item
 * total clim value there, with the total clim value auto calculated."
 * Same per-item id/variables/values shape as `burdenListMarkdown`
 * above, but FOUR fields per item (never a name-derived id, same
 * duplicate-name reasoning) plus a live PER-ROW `{{amount * cost}}`
 * expression for its own "Item Total Clim Value" column (no stored
 * variable for that one at all -- same "derived, not a value anyone
 * types in" reasoning a skill's own live Bonus already uses) and the
 * overall running "Inventory Clim Value" sum expression (real sheet's
 * own `SUMPRODUCT` over amount*cost, confirmed directly) for the
 * page's own top-of-page total.
 */
function expeditionInventoryMarkdown(items: readonly { name: string; amount: number; burden: number; climCost: number }[]): { markdown: string; variables: CharacterSheetVariableDef[]; values: Record<string, number | string>; burdenTotalExpression: string; climValueExpression: string } {
  if (items.length === 0) return { markdown: "No items yet.", variables: [], values: {}, burdenTotalExpression: "0", climValueExpression: "0" };
  const variables: CharacterSheetVariableDef[] = [];
  const values: Record<string, number | string> = {};
  const rows = items.map((item, i) => {
    const n = i + 1;
    variables.push(
      { id: `expeditionItem${n}Name`, label: `Expedition Item ${n} Name`, type: "text", default: "" },
      { id: `expeditionItem${n}Amount`, label: `Expedition Item ${n} Amount`, type: "number", default: 1 },
      { id: `expeditionItem${n}Burden`, label: `Expedition Item ${n} Burden`, type: "number", default: 0 },
      { id: `expeditionItem${n}ClimCost`, label: `Expedition Item ${n} Clim Cost`, type: "number", default: 0 },
    );
    values[`expeditionItem${n}Name`] = item.name;
    values[`expeditionItem${n}Amount`] = item.amount;
    values[`expeditionItem${n}Burden`] = item.burden;
    values[`expeditionItem${n}ClimCost`] = item.climCost;
    return `| {expeditionItem${n}Name} | {expeditionItem${n}Amount} | {expeditionItem${n}Burden} | {expeditionItem${n}ClimCost} | {{expeditionItem${n}Amount * expeditionItem${n}ClimCost}} |`;
  });
  const markdown = ["| Item | Amount | Burden | Clim Cost (Price of 1 Item) | Item Total Clim Value |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
  const burdenTotalExpression = items.map((_, i) => `{expeditionItem${i + 1}Burden}`).join(" + ");
  const climValueExpression = items.map((_, i) => `({expeditionItem${i + 1}Amount} * {expeditionItem${i + 1}ClimCost})`).join(" + ");
  return { markdown, variables, values, burdenTotalExpression, climValueExpression };
}

/**
 * Assembles the whole Inventory page from its six collapsible
 * sections -- real request, same day: "the inventory tab should thus
 * have similar boxes from the ability table that can be collapsed,
 * and those boxes are: weapons, armor, combat loadout, adventurer's
 * kit, alchemy rig, and expedition inventory." Takes the ALREADY-BUILT
 * markdown for the four freeform lists (since only the IMPORTER knows
 * how many real rows each one has -- the static/blank-character
 * version below just passes "No items yet." for each).
 */
/** Real request, 2026-10-29 (follow-up): "Add Item" for the four FREEFORM lists (never a fixed-count slot the way Weapons/Armor are) -- same literal `<button data-mod-action="...">` precedent "+ Add Class"/"+ Add Breakthrough" already set on the Traits page. */
function addItemButtonHtml(actionName: string): string {
  return `<button type="button" data-mod-action="lyrian-chronicles.${actionName}">+ Add Item</button>`;
}

function inventoryMarkdown(armorEquippedByIndex: readonly boolean[], combatLoadoutMarkdown: string, adventurersKitMarkdown: string, alchemyRigMarkdown: string, expeditionInventoryMd: string): string {
  return [
    "# Inventory",
    "",
    "| Burden Total | Combat Burden Total |",
    "| --- | --- |",
    "| {burdenTotal} | {combatBurdenTotal} |",
    collapsibleSectionHtml("Weapons", weaponsTableMarkdown()),
    collapsibleSectionHtml("Armor", armorTableMarkdown(armorEquippedByIndex)),
    collapsibleSectionHtml("Combat Loadout", `${addItemButtonHtml("addCombatLoadoutItem")}\n\n${combatLoadoutMarkdown}`),
    collapsibleSectionHtml("Adventurer's Kit", `${addItemButtonHtml("addAdventurersKitItem")}\n\n${adventurersKitMarkdown}\n\n**Total Burden Carried:** {adventurersKitBurdenTotal}`),
    collapsibleSectionHtml("Alchemy Rig", `${addItemButtonHtml("addAlchemyRigItem")}\n\n${alchemyRigMarkdown}\n\n**Burden Total:** {alchemyRigBurdenTotal}`),
    collapsibleSectionHtml("Expedition Inventory", `${addItemButtonHtml("addExpeditionInventoryItem")}\n\n${expeditionInventoryMd}\n\n**Inventory Clim Value:** {inventoryClimValue}`),
  ].join("\n");
}

/** The real sheet's own 5 races (Core tab's own "Race" dropdown source, confirmed directly off the hidden "Races" tab) -- a fixed, essentially-never-changing list, same tier as SKILLS above. */
const RACES = ["Chimera", "Demon", "Fae", "Human", "Youkai"];

/** The real sheet's own 45 sub-races/houses, same source and tier as RACES above. */
const SUB_RACES = [
  "Ancient Marionette",
  "Anubis",
  "Bearfolk",
  "Bullfolk",
  "Cait Sith",
  "Catfolk",
  "Centaur",
  "Cowfolk",
  "Cu Sith",
  "Dogfolk",
  "Dryad",
  "Dullahan",
  "Gnome",
  "Harpy",
  "High Fae",
  "Horse-Folk",
  "Jiangshi",
  "Kitsune",
  "Lamiafolk",
  "Lizardfolk",
  "Mothfolk",
  "Nekomata",
  "Nio",
  "Oni",
  "Phoenix",
  "Pigfolk",
  "Pixie",
  "Rabbitfolk",
  "Raijin",
  "Ratfolk",
  "Red Pandafolk",
  "Ryujin",
  "Salamander",
  "Selkie",
  "Sheepfolk",
  "Slimefolk",
  "Spiderfolk",
  "Suryan",
  "Sylph",
  "Tengu",
  "Unseelie",
  "Willo Wisp",
  "Wolf-folk",
  "Yuki-Onna",
  "VAMPIRE",
];

// ---- Real request, 2026-10-29 (playtest, inventory round): weapon/
// armor/injury helper FUNCTIONS -- the six supporting CONSTS these
// reference (`WEAPON_SLOT_COUNT`, `ARMOR_SLOT_COUNT`, `weaponVariables`,
// `armorVariables`, `INJURY_LABELS`, `injuryVariables`) live earlier
// in this file, directly above `characterSheetTemplate`'s own
// declaration -- see that spot's own comment for why. -----------------

/** Light/Heavy/Precise Attack are NOT per-weapon on the real sheet at all -- confirmed directly: every one of the 6 rows' own "Light/Heavy Attack"/"Precise Attack" columns is the IDENTICAL formula (`=B9`/`=B9*2`, i.e. just Focus/Focus*2), never varying per row. No per-row variable is stored for them; the Inventory page's own weapons table just repeats this same live expression in every row. */
function weaponVariableDefs(n: number): CharacterSheetVariableDef[] {
  return [
    { id: `weapon${n}Name`, label: `Weapon ${n}`, type: "text", default: "" },
    { id: `weapon${n}LightDamage`, label: `Weapon ${n} Light Damage`, type: "text", default: "" },
    { id: `weapon${n}HeavyDamage`, label: `Weapon ${n} Heavy Damage`, type: "text", default: "" },
  ];
}

/** "Armor Equipped?" has no genuine boolean type in this project's variable system (`CharacterSheetVariableType` is only `"number" | "xOfY" | "text"`) -- stored as a plain 0/1 number, same tier as `oldArmorCalc` above, but rendered as a REAL `<input type="checkbox">` baked directly into the Inventory page's own markdown (same "literal HTML widget overriding the generic numeric render" precedent the Traits page's own race/sub-race `<select>` already set) rather than forcing a true/false toggle through a number box. */
function armorVariableDefs(n: number): CharacterSheetVariableDef[] {
  return [
    { id: `armor${n}Equipment`, label: `Armor ${n} Equipment`, type: "number", default: 0 },
    { id: `armor${n}Guard`, label: `Armor ${n} Guard Bonus`, type: "number", default: 0 },
    { id: `armor${n}Evasion`, label: `Armor ${n} Evasion Bonus`, type: "number", default: 0 },
    { id: `armor${n}Dodge`, label: `Armor ${n} Dodge Bonus`, type: "number", default: 0 },
    { id: `armor${n}Block`, label: `Armor ${n} Block Bonus`, type: "number", default: 0 },
    { id: `armor${n}InitiativePenalty`, label: `Armor ${n} Initiative Penalty`, type: "number", default: 0 },
    { id: `armor${n}Equipped`, label: `Armor ${n} Equipped?`, type: "number", default: 0 },
  ];
}

/**
 * Real request, same day: Evasion/Dodge/Guard/Block/Initiative's own
 * equipment contribution used to be a FLAT number frozen at import
 * time -- confirmed directly, the real sheet's own formula (e.g.
 * Evasion: `7+Agility+EvasionBonus+SUMIF($L$37:$L$42,TRUE,$H$37:$H$42)`)
 * is genuinely LIVE, re-summing the armor table on every recalc. Now
 * that the armor table is a real, visible, player-editable part of
 * the Inventory page (not just an import-time rollup), the SAME five
 * variables (`evasionEquipmentBonus` etc., already referenced by the
 * Core page's own Combat-table formulas and RP's own `maxExpression`
 * -- see the template's `variables` array below) get a live
 * `valueExpression` instead of a flat default, so toggling a slot's
 * own "Equipped?" checkbox actually changes Evasion/Dodge/Guard/
 * Block/Initiative immediately, with NO other formula text needing to
 * change at all.
 */
function sumIfArmorEquipped(field: "Guard" | "Evasion" | "Dodge" | "Block" | "InitiativePenalty"): string {
  return Array.from({ length: ARMOR_SLOT_COUNT }, (_, i) => `({armor${i + 1}Equipped} ? {armor${i + 1}${field}} : 0)`).join(" + ");
}

/**
 * The real sheet's own "Injuries" block (Core tab, M35:P42) -- ten
 * fixed checkboxes (confirmed directly: same ten labels, same M/N
 * left-pair + O/P right-pair layout, on every character using this
 * template), gated to the Core page per the user's own correction
 * ("Injuries is not part of that [the Inventory page's box list]
 * since it would be on the core page at the bottom"). Exhaustively
 * searched the whole workbook (every sheet, every formula) for any
 * reference to these ten cells (`N38:N42`/`P38:P42`) -- confirmed
 * NONE exists; nothing else on the real sheet reacts to an injury
 * being checked, so these are plain, independent toggles, same
 * "literal `<input type=checkbox>`, stored as 0/1" treatment as
 * "Armor Equipped?" above, never a live SUMIF target of their own.
 */
function injuryVariableId(label: string): string {
  const base = slugify(label);
  return `injury${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

/**
 * The real sheet's own weapon/armor table (Core tab, rows 36-42) --
 * same header-anchor technique `findCraftingSkills`/`findClasses`
 * already use (found by text, not a fixed row/column), extended to
 * read EVERY column across both the weapons (A-E) and armor (F-L)
 * halves of the SAME row range in one pass, since they share one
 * header row and one "Armor Equipped?"-gated end-of-table signal.
 * Always returns up to `WEAPON_SLOT_COUNT`/`ARMOR_SLOT_COUNT` entries
 * (padding with blanks never happens here -- the caller does that),
 * since the real sheet's own table is fixed-length, never longer.
 */
function findEquipmentTableRows(grid: Cell[][]): { weaponName: string; lightDamage: string; heavyDamage: string; armorEquipment: number; guard: number; evasion: number; dodge: number; block: number; initiativePenalty: number; armorEquipped: boolean }[] {
  const containsCol = (row: Cell[], text: string) => row.findIndex((cell) => typeof cell === "string" && cell.trim().toLowerCase().includes(text));
  const exactCol = (row: Cell[], text: string) => row.findIndex((cell) => typeof cell === "string" && cell.trim().toLowerCase() === text);
  for (let row = 0; row < grid.length; row++) {
    const weaponCol = exactCol(grid[row], "weapon");
    const eqCol = exactCol(grid[row], "armor equipped?");
    if (weaponCol === -1 || eqCol === -1) continue;
    const lightCol = exactCol(grid[row], "light damage");
    const heavyCol = exactCol(grid[row], "heavy damage");
    const equipCol = exactCol(grid[row], "equipment");
    const guardCol = containsCol(grid[row], "guard");
    const evasionCol = containsCol(grid[row], "evasion");
    const dodgeCol = containsCol(grid[row], "dodge");
    const blockCol = containsCol(grid[row], "block");
    const initCol = containsCol(grid[row], "initiative");
    const results: ReturnType<typeof findEquipmentTableRows> = [];
    for (let r = row + 1; typeof grid[r]?.[eqCol] === "boolean"; r++) {
      results.push({
        weaponName: asText(grid[r][weaponCol], ""),
        lightDamage: asText(grid[r][lightCol], ""),
        heavyDamage: asText(grid[r][heavyCol], ""),
        armorEquipment: asNumber(grid[r][equipCol], 0),
        guard: asNumber(grid[r][guardCol], 0),
        evasion: asNumber(grid[r][evasionCol], 0),
        dodge: asNumber(grid[r][dodgeCol], 0),
        block: asNumber(grid[r][blockCol], 0),
        initiativePenalty: asNumber(grid[r][initCol], 0),
        armorEquipped: grid[r][eqCol] === true,
      });
    }
    return results;
  }
  return [];
}

/**
 * The real sheet's own "Injuries" block -- ten fixed label cells
 * (`INJURY_LABELS`), each immediately followed by its own checkbox
 * one column right (same `findLabelValue` shape every other Core
 * cell this file reads already uses).
 */
function findInjuryFlags(grid: Cell[][]): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const label of INJURY_LABELS) {
    flags[injuryVariableId(label)] = findLabelValue(grid, label) === true;
  }
  return flags;
}

/**
 * The real sheet's own "Inventory" tab -- Expedition Inventory (A1:G1
 * header row, A2:E137 the item list itself, columns F/G unused by
 * this character's own real data -- see this function's own caller
 * for why Description (F) is skipped), Combat Loadout/Adventurer's
 * Kit/Alchemy Rig (three smaller Name+Burden lists further right, G/H
 * columns), plus the sheet's own two running totals ("Burden Total" --
 * G1 label, G2 value one row below; "Combat Burden Total" -- G32
 * label, H32 value one column right; same "label/value offset varies
 * per cell" lesson `findLabelValueAt`'s own header comment already
 * documents). Each list is bounded to its own real max span (same
 * "found by header text, fixed row cap" technique `findClasses`
 * already uses for Classes) so a later, UNRELATED total/note row
 * (e.g. "Adventurer's Kit Total Burden Carried") is never mistaken
 * for a real item.
 */
function findExpeditionInventoryItems(grid: Cell[][]): { name: string; amount: number; burden: number; climCost: number }[] {
  const header = grid.findIndex((row) => typeof row[0] === "string" && row[0].trim().toLowerCase() === "expedition inventory");
  if (header === -1) return [];
  const results: { name: string; amount: number; burden: number; climCost: number }[] = [];
  for (let r = header + 1; r < grid.length; r++) {
    const name = grid[r]?.[0];
    if (typeof name !== "string" || name.trim() === "") continue;
    results.push({ name: name.trim(), amount: asNumber(grid[r][1], 1), burden: asNumber(grid[r][2], 0), climCost: asNumber(grid[r][3], 0) });
  }
  return results;
}

function findBurdenList(grid: Cell[][], headerText: string, maxRows: number): { name: string; burden: number }[] {
  for (let row = 0; row < grid.length; row++) {
    if (!(typeof grid[row][6] === "string" && grid[row][6].trim().toLowerCase() === headerText.toLowerCase())) continue;
    // Real bug, found live against the real Alba sheet: Combat
    // Loadout genuinely carries an ITEM literally named "Adventurer's
    // Kit" (and another named "alchemy rig") -- a plain text match on
    // column G alone latches onto THAT item instead of the real
    // section header further down, reading the wrong rows entirely.
    // The real header row's own "Burden" column label (H, confirmed
    // on every one of these three sections) is what actually
    // disambiguates a genuine header from a same-named item.
    if (!(typeof grid[row][7] === "string" && grid[row][7].trim().toLowerCase() === "burden")) continue;
    const results: { name: string; burden: number }[] = [];
    for (let r = row + 1; r <= row + maxRows && r < grid.length; r++) {
      const name = grid[r]?.[6];
      if (typeof name !== "string" || name.trim() === "") continue;
      results.push({ name: name.trim(), burden: asNumber(grid[r][7], 0) });
    }
    return results;
  }
  return [];
}

/** Confirmed a 26-row span (Core Burden Total's own range, G6:H31, before row 32's own "Combat Burden Total" sum). */
function findCombatLoadoutItems(grid: Cell[][]): { name: string; burden: number }[] {
  return findBurdenList(grid, "Combat Loadout", 26);
}

/** Confirmed a 5-row span (G34:H38, before row 39's own "Adventurer's Kit Total Burden Carried" sum). */
function findAdventurersKitItems(grid: Cell[][]): { name: string; burden: number }[] {
  return findBurdenList(grid, "Adventurer's Kit", 5);
}

/** Confirmed a 5-row span (G45:H49, before row 50's own "Alchemy Rig Burden Total" sum). */
function findAlchemyRigItems(grid: Cell[][]): { name: string; burden: number }[] {
  return findBurdenList(grid, "Alchemy Rig", 5);
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
  // Real request, 2026-10-29 (inventory round): Evasion/Dodge/Guard/
  // Block/Initiative's own equipment contribution used to be read
  // HERE, once, as a flat frozen number (`sumIfEquipped`/"Equipment
  // Penalty"/"Equipment Guard Value"/"Equipment Block Value" label
  // scans) -- gone now that the armor table is a real, visible,
  // player-editable part of the Inventory page: `evasionEquipmentBonus`
  // etc. get a LIVE `valueExpression` instead (see the template's own
  // `variables` array, `sumIfArmorEquipped`), computed from the SAME
  // `armorNEquipped`/`armorNGuard`/etc. variables `equipmentRows`
  // below seeds. The only PLACE this file still needs the raw SUMMED
  // number directly (rather than letting the live formula handle it)
  // is RP's own CURRENT value, seeded once below same as HP/MP already
  // are.
  const equipmentRows = findEquipmentTableRows(core);
  const sumIfArmorEquippedAtImport = (field: "guard" | "evasion" | "dodge" | "block" | "initiativePenalty"): number =>
    equipmentRows.reduce((total, row) => total + (row.armorEquipped ? row[field] : 0), 0);
  const initiativeAdjustment = asNumber(findLabelValueAt(core, "Initiative Adjustment (Positive)", 1, 0), 0);
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

  // Real request, 2026-10-28: "the description of on the draw (and
  // every breakthrough) seems to be a text edit when it should just
  // be text only opened by an i button, since that text is not
  // editable." A breakthrough's own Description is reference text, a
  // player never edits it after import -- same tier as an ability's
  // own description (see this file's own header note on why THAT one
  // isn't a variable either). Baked directly into the row's own
  // markdown via `detailsHtml` below instead of a `<id>Description`
  // variable -- no editable text box, no per-character storage for
  // something nobody ever changes.
  const breakthroughs = findBreakthroughs(workbook);
  const breakthroughVariables: CharacterSheetVariableDef[] = [];
  const breakthroughValues: Record<string, number | string> = {};
  for (const bt of breakthroughs) {
    const id = breakthroughVariableId(bt.name);
    breakthroughVariables.push({ id: `${id}Cost`, label: `${bt.name} Cost`, type: "number", default: 0 });
    breakthroughValues[`${id}Cost`] = bt.cost;
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
      `| ${selectHtml("race", RACES, race)} | ${selectHtml("subRace", SUB_RACES, subRace)} |`,
      "",
      "## Currency",
      "",
      "| Total EXP Earned | Spirit Core (Remaining) |",
      "| --- | --- |",
      "| {totalExp} | {spiritCore} |",
      "",
      // Real request, 2026-10-28: "the 'Recomputes every class's own
      // Cost' text above 'auto-calculate costs' should just be the
      // alt text on the 'auto-calculate costs' button" -- a `title`
      // attribute (the real "alt text" for a button -- shown on
      // hover), not its own separate paragraph.
      '<button type="button" data-mod-action="lyrian-chronicles.recalculateTraitsCosts" title="Recomputes every class’s own Cost (tier’s first level costs tier × 100, every level after costs 100) and every breakthrough’s own Cost (already-free breakthroughs stay free; every other one gets its real cost from the rulebook), then Spirit Core from those.">Auto-Calculate Costs</button>',
      "",
      "## Classes",
      "",
      // Real request, 2026-10-28: "the classes didn't have a method to
      // add classes or breakthroughs, which should be done from a +
      // button to add a line and a dropdown to select the thing."
      '<button type="button" data-mod-action="lyrian-chronicles.addClass">+ Add Class</button>',
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
      '<button type="button" data-mod-action="lyrian-chronicles.addBreakthrough">+ Add Breakthrough</button>',
      "",
      breakthroughs.length === 0
        ? "No breakthroughs."
        : [
            "| Breakthrough | Cost | Description |",
            "| --- | --- | --- |",
            ...breakthroughs.map((bt) => {
              const id = breakthroughVariableId(bt.name);
              return `| ${bt.name} | {${id}Cost} | ${detailsHtml(bt.description)} |`;
            }),
          ].join("\n"),
    ].join("\n"),
    variableIds: ["race", "subRace", "totalExp", "spiritCore", ...classVariables.map((v) => v.id), ...breakthroughVariables.map((v) => v.id)],
  };

  // Real request, 2026-10-29 (inventory round): "the weapons table on
  // the core page from A-36 to E-42, the armor table from F-36 to
  // L-42... adding the injuries table to the core page." `equipmentRows`
  // (read above, needed earlier for RP's own current value) already
  // has every weapon/armor slot's real data -- just flatten it into
  // this character's own `weaponNName`/`armorNGuard`/etc. values here,
  // padding any slot the real sheet left blank with the SAME defaults
  // `weaponVariableDefs`/`armorVariableDefs` already declare.
  const weaponArmorValues: Record<string, number | string> = {};
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const n = i + 1;
    const row = equipmentRows[i];
    weaponArmorValues[`weapon${n}Name`] = row?.weaponName ?? "";
    weaponArmorValues[`weapon${n}LightDamage`] = row?.lightDamage ?? "";
    weaponArmorValues[`weapon${n}HeavyDamage`] = row?.heavyDamage ?? "";
  }
  const armorEquippedByIndex: boolean[] = [];
  for (let i = 0; i < ARMOR_SLOT_COUNT; i++) {
    const n = i + 1;
    const row = equipmentRows[i];
    weaponArmorValues[`armor${n}Equipment`] = row?.armorEquipment ?? 0;
    weaponArmorValues[`armor${n}Guard`] = row?.guard ?? 0;
    weaponArmorValues[`armor${n}Evasion`] = row?.evasion ?? 0;
    weaponArmorValues[`armor${n}Dodge`] = row?.dodge ?? 0;
    weaponArmorValues[`armor${n}Block`] = row?.block ?? 0;
    weaponArmorValues[`armor${n}InitiativePenalty`] = row?.initiativePenalty ?? 0;
    weaponArmorValues[`armor${n}Equipped`] = row?.armorEquipped ? 1 : 0;
    armorEquippedByIndex.push(row?.armorEquipped ?? false);
  }

  // Real request, same day: "Injuries is not part of that [the
  // Inventory page's box list] since it would be on the core page at
  // the bottom" -- read here (alongside everything else the Core page
  // override below needs), never on the Inventory page.
  const injuryFlags = findInjuryFlags(core);
  const injuryValues: Record<string, number | string> = {};
  for (const label of INJURY_LABELS) {
    const id = injuryVariableId(label);
    injuryValues[id] = injuryFlags[id] ? 1 : 0;
  }

  const corePage: CharacterSheetPageDef = {
    title: "Core",
    markdown: coreMarkdown(injuryFlags),
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
      "attackFocusBonus",
      "attackPowerBonus",
      ...injuryVariables.map((v) => v.id),
    ],
  };

  // Real request, same day: "the inventory page would also have the
  // combat burden total and burden total at the top... then the
  // combat loadout, adventurer's kit, and alchemy rig, and below all
  // of that the expedition inventory itself." The real sheet's own
  // "Inventory" tab (a DIFFERENT sheet than "Core" -- these four lists
  // live nowhere near the weapon/armor table).
  const inventorySheet = workbook["Inventory"] ?? [];
  const combatLoadout = burdenListMarkdown("combatLoadout", findCombatLoadoutItems(inventorySheet));
  const adventurersKit = burdenListMarkdown("adventurersKit", findAdventurersKitItems(inventorySheet));
  const alchemyRig = burdenListMarkdown("alchemyRig", findAlchemyRigItems(inventorySheet));
  const expeditionInventory = expeditionInventoryMarkdown(findExpeditionInventoryItems(inventorySheet));

  const inventoryTotalOverrides: CharacterSheetVariableDef[] = [
    { id: "burdenTotal", label: "Burden Total", type: "number", default: 0, valueExpression: expeditionInventory.burdenTotalExpression },
    { id: "combatBurdenTotal", label: "Combat Burden Total", type: "number", default: 0, valueExpression: combatLoadout.totalExpression },
    { id: "inventoryClimValue", label: "Inventory Clim Value", type: "number", default: 0, valueExpression: expeditionInventory.climValueExpression },
    { id: "adventurersKitBurdenTotal", label: "Adventurer's Kit Burden Total", type: "number", default: 0, valueExpression: adventurersKit.totalExpression },
    { id: "alchemyRigBurdenTotal", label: "Alchemy Rig Burden Total", type: "number", default: 0, valueExpression: alchemyRig.totalExpression },
  ];

  const inventoryPageOverride: CharacterSheetPageDef = {
    title: "Inventory",
    markdown: inventoryMarkdown(armorEquippedByIndex, combatLoadout.markdown, adventurersKit.markdown, alchemyRig.markdown, expeditionInventory.markdown),
    variableIds: [
      ...weaponVariables.map((v) => v.id),
      ...armorVariables.map((v) => v.id),
      ...inventoryTotalOverrides.map((v) => v.id),
      ...combatLoadout.variables.map((v) => v.id),
      ...adventurersKit.variables.map((v) => v.id),
      ...alchemyRig.variables.map((v) => v.id),
      ...expeditionInventory.variables.map((v) => v.id),
    ],
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
  const rp = (oldArmorCalc ? 2 + (agility - sumIfArmorEquippedAtImport("evasion")) : 2 + agility) - rpAdjustment;

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
      dodgeBonus,
      initiativeAdjustment,
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
      ...weaponArmorValues,
      ...injuryValues,
      ...combatLoadout.values,
      ...adventurersKit.values,
      ...alchemyRig.values,
      ...expeditionInventory.values,
    },
    pages: [craftingPage, traitsPage, corePage, inventoryPageOverride],
    variables: [
      ...skillVariableOverrides,
      ...craftingVariables,
      ...classVariables,
      ...breakthroughVariables,
      ...inventoryTotalOverrides,
      ...combatLoadout.variables,
      ...adventurersKit.variables,
      ...alchemyRig.variables,
      ...expeditionInventory.variables,
    ],
    abilityCatalog: findAbilityCatalog(workbook),
  };
};

export const characterSheetImporter = importer;

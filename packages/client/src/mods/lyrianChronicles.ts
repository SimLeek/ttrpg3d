// Real request, 2026-10-26 (traits & abilities round): "There should
// be one button to auto-calculate costs on that traits page which
// should calculate the cost of all the levels and spirit core...
// that button can go ahead and use an internal mod lib function."
// Real correction, same day: "that should be a client side
// calculation, just a mod function and not an equation put in the
// {{}} brackets" -- unlike every OTHER computed value on a sheet
// (which is either a plain `{{expression}}` formula or a server-
// resolved `{{modId.fn()}}` library call), this is a one-shot ACTION
// triggered by a button click, not a value re-evaluated on every
// render. It lives here, in the CLIENT (not packages/server/mods,
// where every other Lyrian-specific file lives) specifically because
// it must run with no server round trip at all -- plain, deterministic
// arithmetic over values the client already has, the same
// "only move work server-side for a real trust/RNG boundary" rule
// the rest of this project's dice-roll split already follows.
//
// Registered in modActions.ts under "lyrian-chronicles" (see that
// file for how a page's own literal `<button data-mod-action="...">`
// HTML -- NOT a `{{...}}` segment, characterSheetView.ts's generic
// renderer never touches this mechanism at all -- gets wired to a
// function here).
//
// Real request, same day: "the rule I said is exact" -- a class's own
// first level costs its tier number times 100 (Tier 1 -> 100, Tier 2
// -> 200, Tier 3 -> 300), every level after that costs a flat 100.
// Every class ROW is discovered dynamically (there's no fixed list of
// class ids the way SKILLS is fixed in the server-side Lyrian mod --
// a character can have any subset of the real sheet's 185 classes),
// by scanning `defs` for the `class<Id>Tier`/`class<Id>Level`/
// `class<Id>Cost` id SHAPE the importer gives each one (packages/
// server/mods/lyrian-chronicles/entry.ts's own `classVariableId`) --
// this file never needs to know any class's actual NAME, only its id
// shape, since the cost formula only needs tier+level.
//
// Breakthroughs are different: "when importing prefer the typed xp
// until that button is pressed... once that button is pressed... the
// breakthroughs all list their exp requirements" -- a breakthrough's
// real cost (unlike a class's) can't be DERIVED from anything else on
// the sheet, it has to be LOOKED UP by name against the game's own
// rulebook. That rulebook table (the real sheet's own hidden
// "Breakthroughs" tab) is NEVER available to the importer at all --
// confirmed directly: `characterSheetImport.ts`'s own fetch-and-parse
// step deliberately skips every hidden tab, by design, before the
// workbook ever reaches the server -- so there's no "re-fetch it
// later" option; this table is hand-transcribed here once (real data,
// read directly off the real sheet's own hidden "Breakthroughs" tab,
// confirmed with the user, not guessed) and kept in sync by hand if
// the game's own rulebook changes, same maintenance tier as the
// SERVER mod's own hardcoded SKILLS list. "If the xlsx says 0 xp
// spent... assume starting" (one of the one-time 300exp character-
// creation breakthroughs, never costs ongoing Spirit Core) -- re-
// derived here the SAME way at button-click time: a breakthrough row
// whose CURRENT cost is already 0 is left alone (still free), every
// other row's cost is OVERWRITTEN from this table by its own id (a
// breakthrough not found in the table -- the rulebook moved on since
// this was transcribed -- falls back to whatever was already there,
// rather than silently zeroing a real cost out).
//
// Spirit Core (the character's own remaining currency, after all
// classes/breakthroughs are paid for) = Total EXP earned (imported
// once from the real sheet's own 'EXP & Transactions'!D2 running
// total -- a single cell, not the whole ledger, same "skip the
// ledger tab, a derived snapshot is enough" precedent HP/MP/RP already
// set) minus every class's own (freshly recomputed) cost minus every
// breakthrough's own (freshly recomputed-or-left-alone) cost.

import type { CharacterSheetVariableDef } from "@ttrpg3d/shared";

/**
 * Real data, read directly off the real sheet's own hidden
 * "Breakthroughs" tab (89 rows, confirmed with the user) -- NEVER
 * available to the importer itself (hidden tabs are skipped before
 * upload), so it's transcribed here once. Keyed by the SAME id shape
 * `packages/server/mods/lyrian-chronicles/entry.ts`'s own
 * `breakthroughVariableId` produces for a character's own
 * `<id>Cost` variable, so a lookup never needs the breakthrough's
 * own display name at all, just its own variable id's "breakthrough"
 * prefix stripped and reapplied.
 */
const BREAKTHROUGH_COST_BY_ID: Record<string, number> = {
  "breakthrough8EyesSpiderfolk": 100, // 8 Eyes (Spiderfolk)
  "breakthroughAngelbloodedHumanRestricted": 0, // Angelblooded (Human) (Restricted)
  "breakthroughArachneSpiderfolk": 0, // Arachne (Spiderfolk)
  "breakthroughBecomeFireSalamander": 200, // Become Fire (Salamander)
  "breakthroughBecomeIceYuki-Onna": 200, // Become Ice (Yuki-Onna)
  "breakthroughBecomeLightningRaijin": 200, // Become Lightning (Raijin)
  "breakthroughBecomeWindSylph": 200, // Become Wind (Sylph)
  "breakthroughBlendInSlimefolk": 200, // Blend In (Slimefolk)
  "breakthroughBlendInIISlimefolk": 25, // Blend In II (Slimefolk)
  "breakthroughBlessedByKariHuman": 100, // Blessed by Kari (Human)
  "breakthroughBully": 50, // Bully
  "breakthroughCelestialDragonRyujin": 300, // Celestial Dragon (Ryujin)
  "breakthroughCombatDoggyCuSith": 100, // Combat Doggy (Cu Sith)
  "breakthroughCombatKittyCaitSith": 100, // Combat Kitty (Cait Sith)
  "breakthroughCurseOfVampirism": 300, // Curse of Vampirism
  "breakthroughDeepConnection": 50, // Deep Connection
  "breakthroughDeusExMachina": 600, // Deus Ex Machina
  "breakthroughDivineLuckI": 300, // Divine Luck I
  "breakthroughDivineLuckII": 600, // Divine Luck II
  "breakthroughDivinesChosen": 0, // Divine's Chosen
  "breakthroughDragAlongLamia": 200, // Drag along (Lamia)
  "breakthroughDualPersonality": 300, // Dual Personality
  "breakthroughEarlyAscension": 300, // Early Ascension
  "breakthroughElementalAffinity": 150, // Elemental Affinity
  "breakthroughElementalBreathRyujin": 100, // Elemental Breath (Ryujin)
  "breakthroughElixirAddict": 0, // Elixir Addict
  "breakthroughExpertSummoner": 0, // Expert Summoner
  "breakthroughFaeFlashAcrobatFae": 50, // Fae Flash Acrobat (Fae)
  "breakthroughFaerieFlashMasterFae": 100, // Faerie Flash Master (Fae)
  "breakthroughFaerie-ChimeraHybridRace": 200, // Faerie-Chimera Hybrid (Race)
  "breakthroughFastMetabolism": 150, // Fast Metabolism
  "breakthroughFastMovementCentaur": 200, // Fast Movement (Centaur)
  "breakthroughFearless": 200, // Fearless
  "breakthroughFightAndFlightChimera": 200, // Fight and Flight (Chimera)
  "breakthroughFlesheaterJiangshi": 100, // Flesheater (Jiangshi)
  "breakthroughFlyingCounterKitsune": 200, // Flying Counter (Kitsune)
  "breakthroughFourPawSprintCatfolk": 100, // Four Paw Sprint (Catfolk)
  "breakthroughGreatshieldTraining": 100, // Greatshield Training
  "breakthroughHeavyArmorTraining": 100, // Heavy Armor Training
  "breakthroughHideBehindAllyPixie": 300, // Hide Behind Ally (Pixie)
  "breakthroughHuman-ChimeraHybridRace": 200, // Human-Chimera Hybrid (Race)
  "breakthroughImprovedDemonicDivineReleaseDemon": 300, // Improved Demonic Divine Release (Demon)
  "breakthroughInSyncYoukai": 100, // In Sync (Youkai)
  "breakthroughKitExpert": 200, // Kit Expert
  "breakthroughLanguageTraining": 100, // Language Training
  "breakthroughLargeSpecimenNioBullfolkOrBearfolk": 100, // Large Specimen (Nio, Bullfolk or Bearfolk)
  "breakthroughLightArmorTraining": 25, // Light Armor Training
  "breakthroughLightSleeper": 75, // Light Sleeper
  "breakthroughMarkOfConflict": 0, // Mark of Conflict
  "breakthroughMediumArmorTraining": 50, // Medium Armor Training
  "breakthroughMentalTortureUnseelie": 100, // Mental Torture (Unseelie)
  "breakthroughMixedHouseDemon": 100, // Mixed House (Demon)
  "breakthroughMysticEyesOfFaerieLightFae": 100, // Mystic Eyes of Faerie Light (Fae)
  "breakthroughNaturalImmunityRatfolk": 100, // Natural Immunity (Ratfolk)
  "breakthroughOnTheDraw": 100, // On the draw
  "breakthroughOrganizedInventory": 100, // Organized Inventory
  "breakthroughOrganizedInventoryII": 200, // Organized Inventory II
  "breakthroughOrganizedInventoryIII": 300, // Organized Inventory III
  "breakthroughOverrunCentaur": 200, // Overrun (Centaur)
  "breakthroughPandaMartialArtsRedPanda": 100, // Panda Martial Arts (Red Panda)
  "breakthroughPhotosynthesisDryad": 100, // Photosynthesis (Dryad)
  "breakthroughPowerSavingModeAncientMarionette": 100, // Power Saving Mode (Ancient Marionette)
  "breakthroughPowerfulKiOni": 200, // Powerful Ki (Oni)
  "breakthroughPrimaryStatTraining": 400, // Primary Stat Training
  "breakthroughRacialFlight": 300, // Racial Flight
  "breakthroughRapidFlashHighFae": 100, // Rapid Flash (High Fae)
  "breakthroughRichParents": 300, // Rich Parents
  "breakthroughSecondaryStatTraining": 200, // Secondary Stat Training
  "breakthroughSkillTraining": 25, // Skill Training
  "breakthroughSkilledFlier": 100, // Skilled Flier
  "breakthroughSlimeSummoner": 100, // Slime Summoner
  "breakthroughSlowStarter": 300, // Slow Starter
  "breakthroughSmallDoggyCuSith": 0, // Small Doggy (Cu Sith)
  "breakthroughSmallSpecimenCowfolk": 25, // Small Specimen (Cowfolk)
  "breakthroughSpecialityWeaponTraining": 100, // Speciality Weapon Training
  "breakthroughSummonContractFortunaLadyLuck": 0, // Summon Contract: Fortuna, Lady Luck
  "breakthroughSummonContractIxiluneTheSwarm": 0, // Summon Contract: Ixilune, The Swarm
  "breakthroughSummonContractPipoltrTheGardener": 0, // Summon Contract: Pipoltr, The Gardener
  "breakthroughSuperiorEscapistRabbitfolk": 100, // Superior Escapist (Rabbitfolk)
  "breakthroughTenguDefensiveAuraTengu": 100, // Tengu Defensive Aura (Tengu)
  "breakthroughTheUnknownPaladin": 200, // The Unknown Paladin
  "breakthroughThirdEye": 200, // Third Eye
  "breakthroughTouchedByDeath": 200, // Touched by Death
  "breakthroughUniversalTraining": 700, // Universal Training
  "breakthroughWeaponTraining": 25, // Weapon Training
  "breakthroughWideCircuitsI": 150, // Wide Circuits I
  "breakthroughWideCircuitsII": 175, // Wide Circuits II
  "breakthroughWideCircuitsIII": 200, // Wide Circuits III
  "breakthroughWideCircuitsIV": 250, // Wide Circuits IV
};

function asNumber(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

/**
 * Finds every dynamically-imported class/breakthrough row id by
 * SHAPE (same "class<Id>Tier"/"breakthrough<Id>Cost" convention
 * `packages/server/mods/lyrian-chronicles/entry.ts`'s own
 * `classVariableId`/`breakthroughVariableId` produce) -- there's no
 * fixed list of ids to check against, since which classes/
 * breakthroughs a character has varies per character, same reasoning
 * Crafting's own dynamic skill rows already needed.
 */
function findRowIds(defs: readonly CharacterSheetVariableDef[], prefix: string, suffix: string): string[] {
  const pattern = new RegExp(`^${prefix}(.+)${suffix}$`);
  const ids: string[] = [];
  for (const def of defs) {
    const match = pattern.exec(def.id);
    if (match) ids.push(match[1]);
  }
  return ids;
}

/**
 * Real request, 2026-10-26: "one button to auto-calculate costs on
 * that traits page which should calculate the cost of all the levels
 * and spirit core" -- recomputes EVERY class row's own Cost from its
 * Tier/Level (tier*100 for the first level, +100 per level after),
 * EVERY breakthrough row's own Cost (left alone if already 0 --
 * still a free, starting breakthrough -- otherwise looked up by id
 * against `BREAKTHROUGH_COST_BY_ID` above), and Spirit Core
 * (Total EXP earned minus every one of those freshly-recomputed
 * costs). Returns only the keys that changed, to be merged into the
 * character's own `variableValues` by the caller (characterSheetView.ts's
 * generic mod-action click handler) -- this function itself never
 * touches the DOM or persists anything.
 */
export function recalculateTraitsCosts(variableValues: Readonly<Record<string, number | string>>, defs: readonly CharacterSheetVariableDef[]): Record<string, number | string> {
  const patch: Record<string, number | string> = {};
  let totalCost = 0;

  for (const classId of findRowIds(defs, "class", "Tier")) {
    const tier = asNumber(variableValues[`class${classId}Tier`], 1);
    const level = asNumber(variableValues[`class${classId}Level`], 1);
    const cost = tier * 100 + Math.max(0, level - 1) * 100;
    patch[`class${classId}Cost`] = cost;
    totalCost += cost;
  }

  for (const breakthroughId of findRowIds(defs, "breakthrough", "Cost")) {
    const key = `breakthrough${breakthroughId}Cost`;
    const current = asNumber(variableValues[key], 0);
    if (current === 0) continue; // a starting breakthrough (300exp character-creation pool) -- stays free, never looked up
    const looked = BREAKTHROUGH_COST_BY_ID[`breakthrough${breakthroughId}`];
    const cost = looked ?? current; // not in the table -- the rulebook moved on since this was transcribed; keep whatever was already there rather than zeroing a real cost
    patch[key] = cost;
    totalCost += cost;
  }

  const totalExp = asNumber(variableValues.totalExp, 0);
  patch.spiritCore = totalExp - totalCost;
  return patch;
}

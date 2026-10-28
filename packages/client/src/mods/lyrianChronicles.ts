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

import type { CharacterSheetVariableDef, CharacterSheetPageDef, AbilityCatalogEntry } from "@ttrpg3d/shared";
import type { ModActionFn } from "../modActions.js";
import { fetchAbilityCatalog } from "../api.js";
import { ABILITY_LINKS } from "./lyrianAbilityLinks.generated.js";

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
 * costs). Calls `apply` once with only the keys that changed, to be
 * merged into the character's own `variableValues` by the caller
 * (characterSheetView.ts's generic mod-action click handler) -- this
 * function itself never touches the DOM or persists anything. (Real
 * generalization, 2026-10-28: every mod action now receives a single
 * `ctx` object and an `apply` callback instead of returning a plain
 * patch -- see modActions.ts's own header for why; this action's own
 * body is otherwise unchanged.)
 */
export const recalculateTraitsCosts: ModActionFn = ({ variableValues, defs }, apply) => {
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
  apply({ variableValues: patch });
};

// ---- Abilities round, 2026-10-28 ---------------------------------
//
// Real request: "allow the user to click 'add ability' and then have
// a pop up where they can click a search button and have it narrow
// down to all the abilities in the game... Each ability should have
// an info click which should open a description, but clicking the
// ability name itself (a button) should roll the ability in chat,
// which means posting the description. We'll leave any dice rolls or
// other stuff out... We also want to auto-populate abilities based on
// classes, races, sub-races, and breakthroughs, with an auto-populate
// button."
//
// An added ability is NOT its own per-character variable (unlike a
// skill/class/breakthrough) -- it's purely reference info, baked as
// literal HTML directly into the Abilities page's own markdown the
// moment it's added (same "reference info stays literal text, never
// re-editable via Core & Variables" tier skill/class/breakthrough
// NAMES already use), for two concrete reasons: (1) a real
// description is long, multi-paragraph free text that would need its
// OWN new "read-only multi-line text" rendering mode to show
// correctly (the existing inline `{variableId}` text widget is a
// single-line `<input>`, confirmed wrong for this); (2) raw
// description text often contains `:`/`|` (e.g. "1 AP, 1 MP") that
// would corrupt `{{Label; part: expr}}` compound-roll parsing if
// embedded in one. Reusing TWO mechanisms that already exist solves
// both without inventing anything new:
//   - "click name -> post description to chat" is the EXACT same
//     `.chat-chip` mechanism a `{variableId:button}` ref already uses
//     (characterSheetView.ts's own click listener reads
//     `data-chip-label`/`data-chip-value` and posts them, verbatim --
//     baking those two attributes directly is all that's needed).
//   - "info click -> show description personally" is a plain native
//     `<details><summary>` disclosure -- zero JS, DOMPurify's own
//     default allowlist keeps it intact (confirmed live via this
//     file's own test).

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Same transform `packages/server/mods/lyrian-chronicles/entry.ts`'s
 * own `classVariableId`/`breakthroughVariableId` use, duplicated here
 * (not imported -- that file is SERVER code, this one's CLIENT-only)
 * so `autoPopulateAbilities` below can recognize "does this character
 * have a class/breakthrough named X" purely from `ABILITY_LINKS`'s
 * own `sourceName` text, without ever needing the REVERSE mapping
 * (id -> display name) at all.
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

function classVariableId(name: string): string {
  const base = slugify(name);
  return `class${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

function breakthroughVariableId(name: string): string {
  const base = slugify(name);
  return `breakthrough${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

/** The HTML an added ability's own row becomes -- plain `<div>` (not a markdown list item) specifically so marked.js never has to reconcile block-level HTML against list-item indentation rules. */
function abilityRowHtml(name: string, description: string): string {
  const safeName = escapeHtml(name);
  const safeDescAttr = escapeHtml(description); // HTML-escaping also covers attribute-safety here (the one extra thing an attribute needs beyond text content, a literal `"`, is already escaped to `&quot;`)
  const safeDescHtml = safeDescAttr.replace(/\n/g, "<br>");
  return `\n\n<div class="ability-row"><button type="button" class="chat-chip" data-chip-label="${safeName}" data-chip-value="${safeDescAttr}">${safeName}</button> <details><summary>ℹ</summary>${safeDescHtml}</details></div>`;
}

/** Whether `name` is already listed on the Abilities page -- checked against the page's own raw markdown (the `data-chip-label` an earlier `abilityRowHtml` call baked in), not a variable, since an added ability isn't one (see this section's own header). */
function abilityAlreadyListed(pages: readonly CharacterSheetPageDef[], name: string): boolean {
  const page = pages.find((p) => p.title === "Abilities");
  if (!page) return false;
  return page.markdown.includes(`data-chip-label="${escapeHtml(name)}"`);
}

/**
 * Real request, 2026-10-28: "allow the user to click 'add ability'
 * and then have a pop up where they can click a search button and
 * have it narrow down to all the abilities in the game (gathered from
 * their imported character sheet xlsx... and then a default list if
 * that wasn't imported)." Fetches this account's own stored catalog
 * (store.ts's own getAbilityCatalog, seeded from the mod's bundled
 * default until a real import refreshes it) and opens a self-
 * contained search popup; `apply` only ever runs if/when a session
 * actually picks a result.
 */
export const addAbility: ModActionFn = async (ctx, apply) => {
  const catalog = await fetchAbilityCatalog(ctx.httpUrl, ctx.accountId, "lyrian-chronicles");
  mountAbilitySearchPopup(catalog, (entry) => {
    if (abilityAlreadyListed(ctx.pages, entry.name)) return; // already have it -- a no-op, not a duplicate row
    apply({ pageEdits: [{ pageTitle: "Abilities", appendMarkdown: abilityRowHtml(entry.name, entry.description) }] });
  });
};

/** Self-contained search popup -- mounts/removes itself directly against `document.body`, same pattern measurementShapes.ts's own right-click context menu already uses. `onAdd` fires once per "Add" click; the popup stays open afterward (same session may want to add several abilities in a row) and only closes via its own ✕/outside-click/Escape. */
function mountAbilitySearchPopup(catalog: readonly AbilityCatalogEntry[], onAdd: (entry: AbilityCatalogEntry) => void): void {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; font-family:system-ui,sans-serif;";
  overlay.innerHTML = `
    <div style="background:rgba(24,24,28,0.97); border:1px solid rgba(200,200,200,0.4); border-radius:6px; padding:16px; width:min(500px,90vw); max-height:80vh; display:flex; flex-direction:column; color:#eee;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px;">
        <strong>Add Ability</strong>
        <button type="button" id="ability-search-close" style="background:none; border:none; color:#eee; cursor:pointer; font-size:16px;">&#x2715;</button>
      </div>
      <input type="text" id="ability-search-input" placeholder="Search abilities..." style="padding:6px; margin-bottom:8px; background:#111; border:1px solid rgba(200,200,200,0.4); color:#eee; border-radius:4px;" />
      <div id="ability-search-results" style="overflow-y:auto; flex:1;"></div>
    </div>
  `;
  document.body.append(overlay);

  const input = overlay.querySelector<HTMLInputElement>("#ability-search-input")!;
  const resultsEl = overlay.querySelector<HTMLDivElement>("#ability-search-results")!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>("#ability-search-close")!;

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }

  let currentMatches: AbilityCatalogEntry[] = [];
  function renderResults(): void {
    const query = input.value.trim().toLowerCase();
    currentMatches = query === "" ? [] : catalog.filter((e) => e.name.toLowerCase().includes(query)).slice(0, 30);
    resultsEl.innerHTML =
      currentMatches.length === 0
        ? `<div style="opacity:0.6; padding:8px;">${query === "" ? "Type to search..." : "No matches."}</div>`
        : currentMatches
            .map(
              (e, i) =>
                `<div style="padding:6px 0; border-bottom:1px solid rgba(200,200,200,0.15); display:flex; justify-content:space-between; align-items:center; gap:8px;">
                   <span>${escapeHtml(e.name)}</span>
                   <button type="button" class="ability-search-add-btn" data-index="${i}" style="padding:2px 10px; flex:none;">Add</button>
                 </div>`,
            )
            .join("");
    resultsEl.querySelectorAll<HTMLButtonElement>(".ability-search-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = currentMatches[Number(btn.dataset.index)];
        if (entry) onAdd(entry);
      });
    });
  }

  input.addEventListener("input", renderResults);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown);
  renderResults();
  input.focus();
}

/**
 * Real request, 2026-10-28: "auto-populate abilities based on
 * classes, races, sub-races, and breakthroughs, with an auto-populate
 * button." Cross-references `ABILITY_LINKS` (generated from the
 * user's own hand-filled linking workbook -- see scripts/generate-
 * lyrian-ability-data.mjs) against this character's CURRENT classes
 * (by level), race, sub-race, and breakthroughs, adding every
 * qualifying ability not already listed. Race/sub-race match by
 * plain string equality (`{race}`/`{subRace}` hold the real name
 * directly); a class/breakthrough matches by re-deriving the SAME
 * variable-id shape the server importer gives it from the link's own
 * `sourceName` (see `classVariableId`/`breakthroughVariableId` above)
 * and checking it's actually present in `defs` -- never the reverse
 * (id -> name), since this file never needs to know a class's real
 * name, only whether ONE THAT MATCHES this link exists at all.
 */
export const autoPopulateAbilities: ModActionFn = async (ctx, apply) => {
  const catalog = await fetchAbilityCatalog(ctx.httpUrl, ctx.accountId, "lyrian-chronicles");
  const descriptionByName = new Map(catalog.map((e) => [e.name, e.description]));

  const addedThisRun = new Set<string>();
  const newRows: string[] = [];
  for (const link of ABILITY_LINKS) {
    if (addedThisRun.has(link.name) || abilityAlreadyListed(ctx.pages, link.name)) continue;

    let qualifies = false;
    if (link.source === "race") {
      qualifies = ctx.variableValues.race === link.sourceName;
    } else if (link.source === "subRace") {
      qualifies = ctx.variableValues.subRace === link.sourceName;
    } else if (link.source === "class") {
      const id = classVariableId(link.sourceName); // already prefixed, e.g. "classChronomancer" -- see this function's own id-shape doc
      if (ctx.defs.some((d) => d.id === `${id}Tier`)) {
        const currentLevel = asNumber(ctx.variableValues[`${id}Level`], 1);
        qualifies = link.level === undefined || currentLevel >= link.level;
      }
    } else if (link.source === "breakthrough") {
      const id = breakthroughVariableId(link.sourceName); // already prefixed, e.g. "breakthroughLightSleeper"
      qualifies = ctx.defs.some((d) => d.id === `${id}Cost`);
    }
    if (!qualifies) continue;

    addedThisRun.add(link.name);
    newRows.push(abilityRowHtml(link.name, descriptionByName.get(link.name) ?? ""));
  }

  if (newRows.length > 0) apply({ pageEdits: [{ pageTitle: "Abilities", appendMarkdown: newRows.join("") }] });
};

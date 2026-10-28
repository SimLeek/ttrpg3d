// Real request, 2026-10-26 (traits & abilities round): "that should
// be a client side calculation, just a mod function and not an
// equation put in the {{}} brackets" -- a NEW, third kind of
// sheet-embedded action, alongside the existing two:
//   - a plain `{{expression}}`, evaluated fresh on every render
//     (shared/characterSheet.ts's evaluateCharacterSheetExpression)
//   - a `{{modId.fn(args)}}` library call, resolved via a SERVER
//     round trip (resolveCharacterSheetMarkdown)
// A "mod action" is neither -- it's a literal `<button data-mod-
// action="modId.actionName">` written directly into a mod's own page
// markdown (plain inline HTML, untouched by findExpressionSegments/
// findLibraryCalls/findCompoundRollSegments, since none of those
// look for anything but `{{...}}`/`{...}` shapes), wired up generically
// by characterSheetView.ts's own click handler. One-shot and client-
// only -- no RNG, no server trust boundary, same "only move work
// server-side when there's a REAL reason to" rule diceRoll.ts's own
// header already states for dice.
//
// Real generalization, 2026-10-28 (Abilities round): "Auto-Calculate
// Costs" (the ORIGINAL action, synchronous, just a values patch) was
// enough for itself, but "Add Ability" (opens a search popup, THEN
// applies whatever gets picked, an indeterminate time later) and
// "Auto-Populate Abilities" (needs new variable DEFS and a Markdown
// edit onto the Abilities page, not just values) both need more than
// that shape allows. Generalized via a CALLBACK instead of a return
// value -- `apply` can be invoked zero times (the action just opens
// UI and gives up if the session cancels out), once (the common
// case), or more than once, from WHENEVER the action is actually
// ready (immediately, for a pure calculation; after a popup's own
// "Add" button is clicked, for a search flow) -- one mechanism for
// every shape, rather than a growing union of action "kinds."
//
// This registry is the ONE place characterSheetView.ts (otherwise
// completely mod-agnostic) is told what a given mod's own action
// actually DOES -- every caller of `mountCharacterSheetView` passes
// this SAME constant as its `modActions` option, same as `templates`/
// `libraries` are already shared verbatim across every caller.

import type { CharacterSheetVariableDef, CharacterSheetPageDef } from "@ttrpg3d/shared";
import { recalculateTraitsCosts, addAbility, autoPopulateAbilities } from "./mods/lyrianChronicles.js";

/**
 * Everything an action needs to decide what to do -- a snapshot, not
 * a live reference (the action never mutates the sheet directly, it
 * only ever calls `apply`). An action that wants its OWN UI (a search
 * popup) mounts/removes it entirely on its own, directly against
 * `document.body` -- same self-contained pattern measurementShapes.ts's
 * own right-click context menu already uses -- there's nothing here
 * for that; `apply` is the only coordination point back into the
 * sheet.
 */
export interface ModActionContext {
  variableValues: Readonly<Record<string, number | string>>;
  defs: readonly CharacterSheetVariableDef[];
  /** This character's CURRENT pages -- lets an action read e.g. the Abilities page's own markdown before deciding whether an ability's already listed on it, without a second round trip. */
  pages: readonly CharacterSheetPageDef[];
  httpUrl: string;
  /** The character's OWNER's account -- same scope `sheetOwnerAccountId` already uses elsewhere in characterSheetView.ts, for any server data this action needs to fetch (e.g. the ability catalog). */
  accountId: string;
}

/** What an action hands back to actually commit -- merged into the character's own sheet by characterSheetView.ts's own generic handler (same merge-by-id `variables` logic server.ts's own import endpoint already uses for `pageEdits`'s sibling, just append-only for markdown instead of overwrite-by-id). */
export interface ModActionOutcome {
  variableValues?: Record<string, number | string>;
  variables?: CharacterSheetVariableDef[];
  pageEdits?: { pageTitle: string; appendMarkdown: string }[];
}

export type ModActionFn = (ctx: ModActionContext, apply: (outcome: ModActionOutcome) => void) => void | Promise<void>;

export const MOD_ACTIONS: Readonly<Record<string, Readonly<Record<string, ModActionFn>>>> = {
  "lyrian-chronicles": {
    recalculateTraitsCosts,
    addAbility,
    autoPopulateAbilities,
  },
};

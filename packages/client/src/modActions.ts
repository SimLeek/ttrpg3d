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
// by characterSheetView.ts's own click handler: look up `actionName`
// here, call it with the CURRENT effective variableValues/defs, merge
// whatever it returns into the character's own variableValues, save.
// One-shot and client-only -- no RNG, no server trust boundary, same
// "only move work server-side when there's a REAL reason to" rule
// diceRoll.ts's own header already states for dice.
//
// This registry is the ONE place characterSheetView.ts (otherwise
// completely mod-agnostic) is told what a given mod's own action
// actually DOES -- every caller of `mountCharacterSheetView` passes
// this SAME constant as its `modActions` option, same as `templates`/
// `libraries` are already shared verbatim across every caller.

import type { CharacterSheetVariableDef } from "@ttrpg3d/shared";
import { recalculateTraitsCosts } from "./mods/lyrianChronicles.js";

export type ModActionFn = (variableValues: Readonly<Record<string, number | string>>, defs: readonly CharacterSheetVariableDef[]) => Record<string, number | string>;

export const MOD_ACTIONS: Readonly<Record<string, Readonly<Record<string, ModActionFn>>>> = {
  "lyrian-chronicles": {
    recalculateTraitsCosts,
  },
};

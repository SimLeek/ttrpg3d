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
// Real correction, 2026-10-29: "this looks like special privileges
// for some mod... mods should be able to do this without elevated
// privileges." This file used to hardcode a `MOD_ACTIONS` constant
// keyed by "lyrian-chronicles," importing every one of its action
// functions directly. The actual registry (and the `ModActionContext`/
// `ModActionOutcome`/`ModActionFn` types) now lives in
// modActionRegistry.ts, which knows nothing about any specific mod;
// a mod's own client code self-registers by calling that file's own
// `registerModActions`. This file's only remaining job is the
// bootstrap list of which mods' own client files to eagerly import,
// so their self-registering side effect actually runs -- adding a new
// mod's client actions means adding ONE import line here, never
// touching the registry itself. (The registry/bootstrap split avoids
// a circular import: a mod's own file needs `registerModActions`, and
// this file needs to import that mod's file -- putting both in one
// file would make that a real cycle.)
//
// This genuinely isn't "mods need zero elevated privileges" yet --
// a mod's client file still has to physically live in this repo's own
// bundle for its import (below) to find it. A mod whose client code
// is instead fetched+loaded dynamically at runtime would close that
// gap entirely; a bigger, separate feature, not done here.

import "./mods/lyrianChronicles.js";

export { registerModActions, getAllModActions, type ModActionContext, type ModActionOutcome, type ModActionFn } from "./modActionRegistry.js";

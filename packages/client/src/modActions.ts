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
// `registerModActions`.
//
// Follow-up, same day: "can we just run what this does when the mod
// is imported by a user? Like when clicking the mod import button?"
// This file used to eagerly `import "./mods/lyrianChronicles.js"` at
// its own top level -- unconditionally, for EVERY account, whether or
// not they'd ever imported that mod. `MOD_CLIENT_LOADERS` below maps
// a modId to a dynamic `import()` instead; `ensureModActionsLoaded`
// runs that import (once, memoized) only when called. The three
// mounting files (characters.ts, characterSheetWindow.ts,
// characterSheetPopup.ts) call it for every id already in
// `importedModIds` -- both right after fetching it (covers a mod
// imported in an earlier session, reopened fresh) and right after the
// account mods list's own "Import" button click (covers importing it
// for the first time, this session). Adding a new mod's client
// actions still means adding ONE line to `MOD_CLIENT_LOADERS`, never
// touching the registry itself.
//
// This genuinely isn't "mods need zero elevated privileges" yet --
// a mod's client file still has to physically live in this repo's own
// bundle (as its own lazily-loaded chunk) for `MOD_CLIENT_LOADERS` to
// name it. A mod whose client code is instead fetched from somewhere
// outside this repo entirely would close that gap; a bigger, separate
// feature, not done here.

const MOD_CLIENT_LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  "lyrian-chronicles": () => import("./mods/lyrianChronicles.js"),
};

const loadedModIds = new Set<string>();
const loadingModIds = new Map<string, Promise<void>>();

/** No-ops for a modId with no client actions at all (not every mod needs any) or one already loaded/loading -- safe to call as often as a caller likes, e.g. once per id in `importedModIds` on every mount. */
export function ensureModActionsLoaded(modId: string): Promise<void> {
  if (loadedModIds.has(modId)) return Promise.resolve();
  const inFlight = loadingModIds.get(modId);
  if (inFlight) return inFlight;
  const loader = MOD_CLIENT_LOADERS[modId];
  if (!loader) return Promise.resolve();
  const promise = loader().then(() => {
    loadedModIds.add(modId);
  });
  loadingModIds.set(modId, promise);
  return promise;
}

export { registerModActions, getAllModActions, type ModActionContext, type ModActionOutcome, type ModActionFn } from "./modActionRegistry.js";

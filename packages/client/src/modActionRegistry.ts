// Real request, 2026-10-29: "For 'packages/client/src/modActions.ts',
// this looks like special privileges for some mod. That seems less
// like a 'don't reference lyrian chronicles in the main codebase'
// thing and more like a 'mods should be able to do this without
// elevated privileges' thing." modActions.ts used to hardcode a
// single `MOD_ACTIONS` constant keyed by "lyrian-chronicles," importing
// every one of that mod's own action functions directly -- any OTHER
// mod wanting client-side actions would have needed to edit THAT
// shared, non-mod-specific file too. This file knows nothing about
// any specific mod at all: a mod's own client code calls
// `registerModActions` on itself (self-registration), and the real
// app wiring (characters.ts/main.ts/characterSheetWindow.ts/
// characterSheetPopup.ts) reads back whatever's been registered via
// `getAllModActions`. modActions.ts itself is now just the bootstrap
// list of which mods' own client files to eagerly import for that
// self-registration side effect -- see its own header for the one
// remaining caveat this doesn't solve (a mod's client file still has
// to be IN this repo's bundle; genuine "no elevated privileges at
// all" would need the client to dynamically fetch+load a mod's own
// bundle at runtime, a bigger, separate feature).
//
// This registry/bootstrap split (not one file) avoids a circular
// import: modActions.ts needs to import a mod's client file (for the
// self-registering side effect), and that file needs to import
// `registerModActions` -- putting both the registry AND the bootstrap
// import in the SAME file would make that a real cycle.

import type { CharacterSheetVariableDef, CharacterSheetPageDef } from "@ttrpg3d/shared";

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

/**
 * What an action hands back to actually commit -- merged into the
 * character's own sheet by characterSheetView.ts's own generic
 * handler (same merge-by-id `variables` logic server.ts's own import
 * endpoint already uses).
 *
 * A page edit is either `appendMarkdown` (added to the END of that
 * page's own CURRENT markdown -- fine for the Abilities page, where
 * every new row is independent, order doesn't matter) or
 * `replaceMarkdown` (the action's own FULL replacement for that
 * page's markdown). Real request, 2026-10-28: "+ Add Class"/"+ Add
 * Breakthrough" need the latter -- a new row has to land INSIDE an
 * existing markdown TABLE (a table is a contiguous block; a bare row
 * appended at the very end of the whole PAGE would land after later
 * sections too, and wouldn't even render as part of the table at
 * all), so the action itself reads the page's CURRENT markdown
 * (`ModActionContext.pages`) and does the string surgery, handing
 * back the complete result rather than a fragment.
 */
export interface ModActionOutcome {
  variableValues?: Record<string, number | string>;
  variables?: CharacterSheetVariableDef[];
  pageEdits?: { pageTitle: string; appendMarkdown?: string; replaceMarkdown?: string }[];
}

export type ModActionFn = (ctx: ModActionContext, apply: (outcome: ModActionOutcome) => void) => void | Promise<void>;

const registry: Record<string, Record<string, ModActionFn>> = {};

/** A mod's own client code calls this ONCE, at its own module's top level, naming itself -- this file never imports or hardcodes any mod's own action functions. Merges by action name, so a mod split across multiple files/calls (or a hot-reload in dev) never silently drops an earlier registration. */
export function registerModActions(modId: string, actions: Readonly<Record<string, ModActionFn>>): void {
  registry[modId] = { ...registry[modId], ...actions };
}

/** A snapshot of everything registered so far -- passed as `CharacterSheetViewOptions.modActions` by every real caller, same shared-constant spirit the old `MOD_ACTIONS` export already had, just generically sourced instead of hardcoded. */
export function getAllModActions(): Readonly<Record<string, Readonly<Record<string, ModActionFn>>>> {
  return registry;
}

// MVP goal item 4 (docs/ROADMAP.md), slice 1 -- the data shapes a
// character-sheet-template mod's entry module exports as plain,
// side-effect-free data (`characterSheetTemplate`), readable via a
// dynamic `import()` with no `register()` call and no live
// WorldRoom/room context needed. This is deliberately the ONLY thing
// a pure-content template mod needs to export -- the same object is
// read identically by the standalone account-scoped characters page
// (no game at all) and, later, any in-game sheet view -- so "one mod
// implementation works unmodified in both places."

/**
 * Widget choice follows the type directly, per the roadmap's own
 * wording: a plain single value gets one box (`number`/`text`), a
 * wide numeric range gets a slider (`range`), a fractional/x-of-y
 * value (e.g. current/max HP) gets two boxes (`xOfY`).
 */
export type CharacterSheetVariableType = "number" | "range" | "xOfY" | "text";

export interface CharacterSheetVariableDef {
  id: string;
  label: string;
  type: CharacterSheetVariableType;
  /** Only meaningful for "range" (slider bounds) and "xOfY" (the "y" side's own bounds, if any). */
  min?: number;
  max?: number;
  default: number | string;
}

/** Which of the template's variables this page shows, in order -- a variable can appear on more than one page if a template author wants that. */
export interface CharacterSheetPageDef {
  title: string;
  markdown: string;
  variableIds: string[];
}

/**
 * A mod's own manifest id IS the template id -- no separate id field
 * here, same as every other mod-identified thing in this codebase
 * (modIds lists, etc.) already works.
 */
export interface CharacterSheetTemplate {
  name: string;
  pages: CharacterSheetPageDef[];
  variables: CharacterSheetVariableDef[];
}

/**
 * Core, always-present variables that exist on EVERY character
 * regardless of template -- unlike ordinary template-defined
 * variables, these aren't optional/removable (real request,
 * 2026-10-17, docs/ROADMAP.md item 4). Defaults match today's fixed
 * PLAYER_BODY_WIDTH/HEIGHT/DEPTH constants (packages/client/src/
 * playerBodyMesh.ts) -- this slice only defines/renders/edits these
 * as data; wiring them into the live 3D game's body mesh is a
 * follow-up (see docs/ROADMAP.md item 4's own follow-up list).
 */
export const RESERVED_BODY_SIZE_VARIABLES: CharacterSheetVariableDef[] = [
  { id: "bodyWidth", label: "Body width", type: "number", default: 0.6 },
  { id: "bodyHeight", label: "Body height", type: "number", default: 1.8 },
  { id: "bodyDepth", label: "Body depth", type: "number", default: 0.6 },
];

/**
 * Shared by the account-scoped characters page (checked against the
 * account's own `importedModIds`) and, later, the in-game context
 * (checked against a game's `modIds`) -- the same "is this
 * character's dependency set satisfied here" question, just against
 * a different available-set. Pure and fully unit-testable with no
 * mod loader involved.
 */
export function computeMissingModDependencies(requiredModIds: readonly string[], availableModIds: readonly string[]): string[] {
  const available = new Set(availableModIds);
  return requiredModIds.filter((id) => !available.has(id));
}

/**
 * A mod's "library" export (MVP goal item 4, round 2): plain, trusted
 * mod code (same trust level `register()` already has) that a sheet's
 * markdown can call by name via `{{modId.functionName(args)}}` --
 * see findLibraryCalls below. `args` are the call's own resolved
 * tokens (a variable id looked up against `variableValues`, or a bare
 * numeric/string literal); `variableValues` is also passed in full,
 * for a function that wants more than just its explicit args.
 */
export type CharacterSheetLibraryFunction = (args: (number | string)[], variableValues: Readonly<Record<string, number | string>>) => number | string;

export interface LibraryCallSegment {
  /** Index of the segment's opening `{{` in the original string. */
  start: number;
  /** Index just past the segment's closing `}}`. */
  end: number;
  modId: string;
  functionName: string;
  /** Raw, untrimmed-of-type tokens exactly as written -- a variable id or a bare literal, resolved against actual variableValues only at call time (this function never evaluates anything, same split chatCommands.ts's own findInlineRolls already uses against diceRoll.ts's real evaluation). */
  args: string[];
}

/**
 * Finds every `{{modId.functionName(arg1, arg2)}}` segment in `text`,
 * in order, left to right -- deliberately curly-braced, distinct from
 * chatCommands.ts's own `[[...]]` dice segments, so the two never
 * collide in the same text. The `(...)` argument list is optional
 * (`{{modId.fn}}` is a valid zero-arg call). Pure string-level
 * detection only -- actually CALLING the function is server-only (see
 * modLoader.ts's resolveCharacterSheetMarkdown), since a mod's real
 * function body is server-side Node code with no way to ship it to
 * the browser in this project's current architecture.
 */
export function findLibraryCalls(text: string): LibraryCallSegment[] {
  const segments: LibraryCallSegment[] = [];
  const pattern = /\{\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)(?:\(([^)]*)\))?\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const rawArgs = match[3] ?? "";
    const args = rawArgs.trim() === "" ? [] : rawArgs.split(",").map((a) => a.trim());
    segments.push({ start: match.index, end: match.index + match[0].length, modId: match[1], functionName: match[2], args });
  }
  return segments;
}

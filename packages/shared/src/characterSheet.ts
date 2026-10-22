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
 * Widget choice follows the type directly: a plain single value gets
 * one box (`number`/`text`), a fractional/x-of-y value (e.g.
 * current/max HP) gets two boxes (`xOfY`).
 *
 * A "range" (slider) type existed briefly but was removed before it
 * ever had a real use case -- it had no UI for setting its own
 * min/max, so it always fell back to the browser's native 0-100
 * default, which is meaningless for most stats. Revisit if/when a
 * concrete need for a slider-style variable actually comes up.
 */
export type CharacterSheetVariableType = "number" | "xOfY" | "text";

export interface CharacterSheetVariableDef {
  id: string;
  label: string;
  type: CharacterSheetVariableType;
  /** Only meaningful for "xOfY" (the "y" side's own bounds, if any). */
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

/**
 * How a resolved reference renders on the page -- "box" (an inert,
 * read-only displayed value for a library call; an editable input for
 * a variable reference) or "button" (a clickable chip that posts the
 * value to the test chat -- the default for a library call, since its
 * primary use case is a computed roll/action; opt-in for a variable
 * reference, whose default is "box" since its primary use case is
 * direct editing).
 */
export type InlineReferenceDisplay = "box" | "button";

export interface LibraryCallSegment {
  /** Index of the segment's opening `{{` in the original string. */
  start: number;
  /** Index just past the segment's closing `}}`. */
  end: number;
  modId: string;
  functionName: string;
  /** Raw, untrimmed-of-type tokens exactly as written -- a variable id or a bare literal, resolved against actual variableValues only at call time (this function never evaluates anything, same split chatCommands.ts's own findInlineRolls already uses against diceRoll.ts's real evaluation). */
  args: string[];
  /** Defaults to "button" when no `:box`/`:button` suffix is written. */
  display: InlineReferenceDisplay;
}

/**
 * Finds every `{{modId.functionName(arg1, arg2)}}` segment in `text`,
 * in order, left to right -- deliberately curly-braced, distinct from
 * chatCommands.ts's own `[[...]]` dice segments, so the two never
 * collide in the same text (dice notation is landing inside
 * character-sheet pages next -- `{{...}}`/`{...}`/`[[...]]` are three
 * deliberately non-overlapping delimiters reserved across this
 * project specifically so that work doesn't have to renegotiate
 * anything shipped here). The `(...)` argument list is optional
 * (`{{modId.fn}}` is a valid zero-arg call); an optional trailing
 * `:box`/`:button` picks the display style (round 2's original
 * always-a-chip behavior is now the explicit "button" default, not
 * the only option). Pure string-level detection only -- actually
 * CALLING the function is server-only (see modLoader.ts's
 * resolveCharacterSheetMarkdown), since a mod's real function body is
 * server-side Node code with no way to ship it to the browser in this
 * project's current architecture.
 */
export function findLibraryCalls(text: string): LibraryCallSegment[] {
  const segments: LibraryCallSegment[] = [];
  const pattern = /\{\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)(?:\(([^)]*)\))?(?::(box|button))?\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const rawArgs = match[3] ?? "";
    const args = rawArgs.trim() === "" ? [] : rawArgs.split(",").map((a) => a.trim());
    segments.push({ start: match.index, end: match.index + match[0].length, modId: match[1], functionName: match[2], args, display: (match[4] as InlineReferenceDisplay) ?? "button" });
  }
  return segments;
}

export interface VariableRefSegment {
  /** Index of the segment's opening `{` in the original string. */
  start: number;
  /** Index just past the segment's closing `}`. */
  end: number;
  variableId: string;
  /**
   * Which half of an `xOfY` variable to show -- `{hp}`/`{hp.x}` is
   * the current value, `{hp.y}` is the max (round 5 real correction:
   * "if it's xOfY you should just have to choose .x or .y to show
   * one in the sheet," not both boxes together inline). Undefined
   * when omitted (treated as "x"); meaningless and simply ignored for
   * every other variable type, which only ever has one value anyway.
   */
  component?: "x" | "y";
  /** Defaults to "box" when no `:box`/`:button` suffix is written. */
  display: InlineReferenceDisplay;
}

/**
 * Finds every `{variableId}` (optionally `{variableId.x}`/`{variableId.y}`,
 * optionally also `:box`/`:button`) segment in `text` -- a plain
 * reference to one of the character's own `variableValues`, resolved
 * entirely client-side (no mod/server involved at all, unlike
 * findLibraryCalls above). Single curly braces, deliberately distinct
 * from both `{{modId.fn(args)}}` (double) and `[[dice notation]]`
 * (square, reserved for the upcoming dice-in-sheets work) -- see this
 * file's own header on findLibraryCalls for the full three-way
 * reservation. The lookaround guards below make sure this never
 * mis-fires on the braces of a `{{...}}` call sitting in the same
 * text, confirmed directly against every real edge case this `.x`/
 * `.y` addition could plausibly create (a malformed `{{id}}` typo; a
 * real call to a function literally named `x`/`y`, with or without
 * `()`) -- none of them produce a false match, because a genuine
 * `{{...}}` call's own closing `}}` always trips the trailing
 * `(?!\})` guard below.
 */
export function findVariableRefs(text: string): VariableRefSegment[] {
  const segments: VariableRefSegment[] = [];
  const pattern = /(?<!\{)\{([a-zA-Z0-9_-]+)(?:\.(x|y))?(?::(box|button))?\}(?!\})/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    segments.push({
      start: match.index,
      end: match.index + match[0].length,
      variableId: match[1],
      component: match[2] as "x" | "y" | undefined,
      display: (match[3] as InlineReferenceDisplay) ?? "box",
    });
  }
  return segments;
}

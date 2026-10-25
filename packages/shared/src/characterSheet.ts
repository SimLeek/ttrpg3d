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
 * Which variables the in-game billboard token shows as fill bars
 * (MVP goal item 4 follow-up, docs/ROADMAP.md: "HP/MP become DEFAULT
 * ... not permanent/fixed ... linked to the billboard bars"). Only
 * `xOfY` variables make sense here (a bar needs a current AND a max
 * to compute a fill ratio) -- the authoring UI only offers those as
 * choices, and `resolveCharacterBars` below silently skips a bar
 * pointing at anything else (stale id, wrong type, or removed
 * variable -- same "stale id, not a crash" spirit used throughout
 * this codebase, not an error).
 */
export interface CharacterSheetBarDef {
  variableId: string;
  /** 0-1 floats, matching this project's one existing color convention (CharacterRecord.token.color, lobby.ts's colorToHex/hexToColor). */
  color: [number, number, number];
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
  /** Optional -- customSheet JSON persisted before this field existed won't have it; every reader defaults via `sheet.bars ?? []`, same backward-compat spirit as store.ts's `c.customSheet ?? null`. */
  bars?: CharacterSheetBarDef[];
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
 * docs/CHARACTER_SHEET_IMPORT.md, part 2 -- "import images for that
 * token, onto the character sheet as a fixed non-removable variable
 * similar to width height and depth." A separate array (not appended
 * to RESERVED_BODY_SIZE_VARIABLES itself) since it isn't a body-size
 * value and WorldRoom.ts's own body-size-specific lookups
 * (DEFAULT_BODY_WIDTH/HEIGHT/DEPTH) have no business iterating it by
 * accident -- `RESERVED_CHARACTER_VARIABLES` below is the "every
 * reserved variable, for UI/listing purposes" union the two existing
 * `RESERVED_BODY_SIZE_VARIABLES`-only callers (characterSheetView.ts's
 * editor section, its own id-lookup fallback) should actually use.
 * Empty string default -- "no image set" (resolved to the ASCII-
 * smiley fallback at render time, not a broken/blank texture).
 */
export const RESERVED_TOKEN_IMAGE_VARIABLES: CharacterSheetVariableDef[] = [{ id: "tokenImage", label: "Token image", type: "text", default: "" }];

/** Every reserved (fixed, non-removable) character-sheet variable, for callers that want "all of them" rather than specifically the body-size subset. */
export const RESERVED_CHARACTER_VARIABLES: CharacterSheetVariableDef[] = [...RESERVED_BODY_SIZE_VARIABLES, ...RESERVED_TOKEN_IMAGE_VARIABLES];

/**
 * MVP goal item 4 follow-up (drag-and-drop character placement) -- how
 * far (world units) a placed character can be from the one you're
 * currently controlling. Shared so the client's live hover-marker
 * preview (valid/invalid color while dragging) and the server's own
 * re-validation of a "placeCharacter" message (never trust the
 * client's own check) agree on the exact same number.
 *
 * Real feedback after the first playtest: "I should be able to zoom
 * out more and still place characters" -- 16 was too tight for
 * placing something while zoomed/scouted out. Bumped to 256 ("160 or
 * 320 or so").
 */
export const MAX_CHARACTER_PLACEMENT_DISTANCE = 256;

/**
 * x-of-y values store BOTH halves in `variableValues` -- the "current"
 * half lives under the variable's own id, the "max" half lives under
 * this derived key. Shared between the client (characterSheetWidgets.ts's
 * widgets, characters.ts's inline-ref rendering) and the server
 * (resolveCharacterBars below, WorldRoom.ts's click-to-edit) so both
 * sides agree on where the max half lives without duplicating the
 * convention.
 */
export function xOfYMaxKey(variableId: string): string {
  return `${variableId}Max`;
}

function asNumber(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

export interface ResolvedBar {
  variableId: string;
  label: string;
  value: number;
  max: number;
  color: [number, number, number];
}

/**
 * Resolves a sheet's configured bars against a character's actual
 * `variableValues`, for the in-game billboard (characterToken.ts) and
 * the Colyseus schema sync that feeds it (WorldRoom.ts's onJoin +
 * setCharacterVariableValue). A bar pointing at a missing or
 * non-`xOfY` variable is silently skipped -- same "stale id, not a
 * crash" spirit as computeMissingModDependencies above, since a
 * variable can be renamed/retyped/deleted after a bar was configured
 * for it.
 */
export function resolveCharacterBars(sheet: Pick<CharacterSheetTemplate, "variables" | "bars"> | null, variableValues: Readonly<Record<string, number | string>>): ResolvedBar[] {
  if (!sheet) return [];
  const bars: ResolvedBar[] = [];
  for (const bar of sheet.bars ?? []) {
    const def = sheet.variables.find((v) => v.id === bar.variableId);
    if (!def || def.type !== "xOfY") continue;
    const defaultFallback = typeof def.default === "number" ? def.default : 0;
    const value = asNumber(variableValues[def.id] ?? def.default, defaultFallback);
    const max = asNumber(variableValues[xOfYMaxKey(def.id)] ?? def.max, defaultFallback);
    bars.push({ variableId: def.id, label: def.label, value, max, color: bar.color });
  }
  return bars;
}

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

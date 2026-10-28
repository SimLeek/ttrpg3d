import { Parser } from "expr-eval";

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
  /** Only meaningful for "xOfY" (the "y" side's own bounds, if any). Ignored when `maxExpression` is set -- that always wins. */
  min?: number;
  max?: number;
  /**
   * Real request, 2026-10-26: "Any xOfY variable should have Y be the
   * max of that... hp.y should just auto-set to the actual max hp...
   * that {{}} stuff should also work in the core&variables section."
   * Only meaningful for "xOfY" -- when set, `{variableId.y}` (and
   * `resolveCharacterBars`'s own bar-max, and this variable's own
   * "max" box in the Core & Variables editor) ALWAYS evaluates this
   * expression live instead of reading a flat stored number (same
   * `{variableId}`/`{variableId.y}`-ref syntax and `expr-eval`
   * evaluation `{{expression}}` segments already use -- see
   * `resolveVariableValue` below, which actually does the cycle-aware
   * recursive resolution a max formula referencing ANOTHER variable's
   * own (possibly also live) max needs).
   */
  maxExpression?: string;
  /**
   * Real request, 2026-10-26 (third pass): "Bonus on the page should
   * show the resulting number, and the core&variables should show
   * that equation you put" -- the SAME live-formula idea as
   * `maxExpression` above, generalized to the "x"/current side of ANY
   * variable (most useful for a plain "number" variable that's
   * ENTIRELY derived, e.g. a skill's own Bonus = governing substat +
   * skill points): when set, `{variableId}`/`{variableId.x}` (and
   * this variable's own value box in the Core & Variables editor)
   * ALWAYS evaluates this expression live instead of reading a flat
   * stored number. Same cycle-aware resolution as `maxExpression`
   * (see `resolveVariableValue` below) -- a value formula referencing
   * ANOTHER variable's own (possibly also live) value or max needs
   * the exact same graph-cycle check.
   */
  valueExpression?: string;
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
 * docs/CHARACTER_SHEET_IMPORT.md, part 1 -- a parsed document, handed
 * to a mod's own `characterSheetImporter`, tab name -> that tab's own
 * raw grid of cell values (row-major, 0-indexed, no formatting/
 * formulas -- just whatever a cell's own last-computed value was).
 * Deliberately NOT a header-row/record shape: a real-world sheet's
 * tabs don't all agree on one layout (confirmed directly against the
 * Lyrian Chronicles sheet this type was scoped against -- its "Core"
 * tab is a scattered label/value grid with labels and values at
 * arbitrary positions, while its "Abilities"/"Inventory" tabs ARE
 * conventional header-row tables) -- interpreting a tab's own layout
 * is squarely the importing MOD's own job, never core code's, same
 * "core knows nothing about Lyrian specifics" split
 * `characterSheetImporter` itself follows.
 */
export type ImportedWorkbook = Record<string, (string | number | boolean | null)[][]>;

/** What a `characterSheetImporter` call produces -- `variableValues` overlays the mod's own `characterSheetTemplate` variable defaults (real values pulled from the imported document); `pages` are APPENDED after that template's own fixed pages (e.g. Lyrian's own "Core" page stays first, imported "Abilities"/"Inventory" pages come after) -- never a replacement for the template's own structure, since page content differs per character but the template's own shape doesn't. */
export interface CharacterSheetImportResult {
  variableValues: Record<string, number | string>;
  pages: CharacterSheetPageDef[];
  /**
   * Real request/architecture fix, 2026-10-26 (skills rework): new or
   * refined variable DEFINITIONS the importer wants merged into the
   * character's own (per-character, already-cloned) sheet.variables --
   * matched by id: an id that already exists on the template (e.g. a
   * FIXED skill's own `<id>Bonus`) is OVERRIDDEN in place (e.g. to set
   * its live `valueExpression` from this real sheet's own governing-
   * stat column); an id that doesn't exist yet (e.g. a DYNAMIC
   * crafting skill's own `<craftingId>Bonus`/`<craftingId>SkillPoints`,
   * whose name varies per character) is simply APPENDED. This is what
   * lets an importer give dynamically-named content (Crafting) the
   * same live-formula/editable-field treatment the FIXED Skills list
   * already gets from the template alone -- previously impossible
   * (this type had no way to add/refine a variable DEFINITION at all,
   * only its VALUE), a real, confirmed architectural gap this closes.
   */
  variables?: CharacterSheetVariableDef[];
  /**
   * Real request, 2026-10-28 (Abilities round): "gathered from their
   * imported character sheet xlsx since that has the updated list,
   * and then a default list if that wasn't imported." Game-SYSTEM
   * reference data (the real sheet's own hidden "All Abilities" tab,
   * the game's full ability rulebook), never this character's own
   * data -- NOT merged into `variableValues`/pages at all, instead
   * refreshes the uploading ACCOUNT's own stored ability catalog
   * (store.ts's `setAbilityCatalog`, scoped by account+modId, falling
   * back to a bundled default seed until an account's own import
   * supplies one) so every character under that account benefits,
   * not just the one being imported right now.
   */
  abilityCatalog?: AbilityCatalogEntry[];
}

/**
 * One row of the real sheet's own "All Abilities" rulebook tab --
 * confirmed directly: that tab (and the game's own master rulebook it
 * IMPORTRANGEs from) is the single authoritative list of every
 * ability that exists in Lyrian Chronicles, independent of which
 * character has which. See `CharacterSheetImportResult.abilityCatalog`
 * above for how/when this gets captured.
 */
export interface AbilityCatalogEntry {
  name: string;
  keywords: string;
  range: string;
  description: string;
  requirement: string;
  cost: string;
  apCost: string;
  manaCost: string;
  rpCost: string;
  benefits: string;
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
    // "y" (max) goes through resolveVariableValue so a bar whose own
    // max is a live `maxExpression` (real request, 2026-10-26) shows
    // the actual computed max, not a stale/never-written stored
    // number.
    const value = resolveVariableValue(def.id, "x", sheet.variables, variableValues) ?? defaultFallback;
    const max = resolveVariableValue(def.id, "y", sheet.variables, variableValues) ?? defaultFallback;
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

/**
 * docs/CHARACTER_SHEET_IMPORT.md, part 1 -- real correction, 2026-10-25:
 * a derived stat's formula imports VERBATIM as its own markdown text,
 * each operand swapped for a `{variableId}` reference, e.g.
 * `{{20 + (10 * {toughness}) + {hpBonus}}}` -- NOT a call into a
 * hand-written mod function. A THIRD `{{...}}` kind, alongside the
 * existing `findLibraryCalls` (`{{modId.fn(args)}}`) -- distinguished
 * by shape alone (a call always matches that exact dotted-identifier
 * pattern; a raw expression never does), so both can keep sharing the
 * same delimiter with no collision. Entirely plain arithmetic (`+ -
 * * /` and parentheses, numeric literals, nested `{variableId}` refs)
 * -- deliberately NOT a general scripting language (docs/DEFERRED.md's
 * own "a safe/sandboxed scripting system... is real design work, not
 * a quick add" stays deferred; this is just arithmetic, nothing to
 * sandbox). Resolved entirely CLIENT-side, same as a plain
 * `{variableId}` ref -- no mod code involved, so no server round trip
 * needed either.
 */
export interface ExpressionSegment {
  /** Index of the segment's opening `{{` in the original string. */
  start: number;
  /** Index just past the segment's closing `}}`. */
  end: number;
  /** The raw text between the braces, BEFORE any `{variableId}` substitution -- e.g. `"20 + (10 * {toughness}) + {hpBonus}"`. */
  expression: string;
  /** Defaults to "box" (an inert displayed value) -- unlike a library call, showing a computed stat isn't "a roll/action" by default. */
  display: InlineReferenceDisplay;
}

/**
 * The raw span-finding half of EVERY `{{...}}` segment kind (a
 * library call, a plain expression, or a compound roll below) --
 * factored out so each kind's OWN classification logic (library
 * call's dotted-identifier shape, a compound roll's `;`/`|` shape, a
 * plain expression as the fallback) doesn't have to re-implement this
 * same depth-tracking scan. A plain non-greedy regex (`\{\{(.+?)\}\}`)
 * genuinely mis-splits the common case of an expression ENDING in a
 * bare variable ref (e.g. `{{20 + {hpBonus}}}` -- found live while
 * writing findExpressionSegments' own tests, not a hypothetical): the
 * ref's own closing `}` sits directly against the outer `}}`, so
 * three `}` in a row, and a lazy match stops at the FIRST two it sees
 * (which belong to the ref, not the real close), leaving a dangling
 * `}` and a truncated expression. Scans manually instead, tracking
 * nested single-brace depth, so a ref's own braces are never mistaken
 * for the outer close. `excludeSpans` skips a span another kind (today:
 * library calls) already claimed.
 */
function findDoubleBraceSpans(text: string, excludeSpans: ReadonlySet<string>): { start: number; end: number; inner: string }[] {
  const spans: { start: number; end: number; inner: string }[] = [];
  let i = 0;
  while (i < text.length - 1) {
    if (text[i] !== "{" || text[i + 1] !== "{") {
      i++;
      continue;
    }
    let depth = 0; // unmatched inner '{' (a nested {variableId} ref's own opening brace)
    let j = i + 2;
    let closeAt = -1;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "{") {
        depth++;
        j++;
      } else if (ch === "}") {
        if (depth > 0) {
          depth--;
          j++;
        } else if (text[j + 1] === "}") {
          closeAt = j;
          break;
        } else {
          j++; // a stray unmatched '}' at depth 0 -- lenient, just skip past it rather than bailing the whole scan
        }
      } else {
        j++;
      }
    }
    if (closeAt === -1) {
      i++;
      continue; // no real "}}" close found for this "{{" -- not a valid segment here
    }
    const end = closeAt + 2;
    if (!excludeSpans.has(`${i}:${end}`)) spans.push({ start: i, end, inner: text.slice(i + 2, closeAt) });
    i = end;
  }
  return spans;
}

/** Strips a trailing `:box`/`:button` suffix, defaulting to `box` when neither is written -- the same display-suffix convention every `{{...}}` kind shares. */
function stripDisplaySuffix(inner: string): { text: string; display: InlineReferenceDisplay } {
  if (inner.endsWith(":button")) return { text: inner.slice(0, -":button".length), display: "button" };
  if (inner.endsWith(":box")) return { text: inner.slice(0, -":box".length), display: "box" };
  return { text: inner, display: "box" };
}

/**
 * Finds every `{{...}}` segment in `text` that is NEITHER a
 * `{{modId.fn(args)}}` library call (findLibraryCalls decides that
 * shape) NOR a `{{Label; part: expr | part: expr}}` compound roll
 * (findCompoundRollSegments decides THAT shape) -- i.e. a raw
 * arithmetic expression, the fallback/default `{{...}}` kind.
 */
export function findExpressionSegments(text: string): ExpressionSegment[] {
  const exclude = new Set([...findLibraryCalls(text).map((c) => `${c.start}:${c.end}`), ...findCompoundRollSegments(text).map((c) => `${c.start}:${c.end}`)]);
  return findDoubleBraceSpans(text, exclude).map((span) => {
    const { text: expression, display } = stripDisplaySuffix(span.inner);
    return { start: span.start, end: span.end, expression: expression.trim(), display };
  });
}

export interface CompoundRollPart {
  label: string;
  expression: string;
  /** Real request, 2026-10-26: "the max damage (used if crit or nat 20)" -- a part's own label ending in the literal suffix `+max` (stripped here) asks for an EXTRA, automatically-computed "max <label>" line alongside this part's own real roll (DiceRoll's own `.maxTotal`, no separate computation needed -- see diceRoll.ts). Opt-in per PART, not automatic for every dice-containing part, since a compound roll's own "to hit" part typically doesn't want one shown even though it also contains real dice. */
  showMax: boolean;
}

export interface CompoundRollSegment {
  start: number;
  end: number;
  /** The action's own name, shown as this roll's own header once posted to chat (e.g. "Light Attack", or "Precise Attack (pinpoint)" -- a keyword tag is just plain text IN this name, no separate mechanism needed for it). */
  actionLabel: string;
  parts: CompoundRollPart[];
  display: InlineReferenceDisplay;
}

/**
 * Finds every `{{<ActionLabel>; <label>: <expr> | <label>: <expr> ...}}`
 * segment -- a SINGLE clickable action that rolls/evaluates one OR
 * MORE labeled parts together and posts them as one bundled result
 * (real request, 2026-10-26: "For light attack, we want to display
 * the attack to-hit result, the damage, and the max damage... some
 * table in the chat"). Real correction, same day (second pass): a
 * SINGLE part is a genuine, common case too -- "the Agility label
 * would be a button... [that rolls] agility check: 16" needs its own
 * custom action label (shown on the button) and its own custom
 * posted-message label (e.g. "agility check"), neither of which a
 * plain `{{expression}}` has any syntax for -- so this is also the
 * general mechanism for "a labeled, clickable roll with a nicer name
 * than its own raw formula text," not just a multi-part bundle.
 * Distinguished from a plain `{{expression}}` by shape alone, same as
 * every other `{{...}}` kind: a plain expression's own grammar
 * (expr-eval's `+ - * / ^ % ()`, numeric literals, `{variableId}`
 * refs) never legitimately contains a `;` at all, so requiring an
 * action label (anything before the first `;`) never collides with a
 * genuine expression, regardless of how many `|`-separated parts
 * follow it. `{variableId}` refs never contain a `;`/`|`/`:` of their
 * own either (only a `.x`/`.y` component), so splitting on these
 * characters needs no depth-tracking of its own, unlike the OUTER
 * `{{`/`}}` span-finding above.
 */
export function findCompoundRollSegments(text: string): CompoundRollSegment[] {
  const libraryCallSpans = new Set(findLibraryCalls(text).map((c) => `${c.start}:${c.end}`));
  const segments: CompoundRollSegment[] = [];
  for (const span of findDoubleBraceSpans(text, libraryCallSpans)) {
    const { text: body, display } = stripDisplaySuffix(span.inner);
    const semiIdx = body.indexOf(";");
    if (semiIdx === -1) continue; // no action label -- not a compound roll
    const rawParts = body
      .slice(semiIdx + 1)
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (rawParts.length < 1) continue; // needs at least 1 real part
    const parts: CompoundRollPart[] = [];
    let malformed = false;
    for (const raw of rawParts) {
      const colonIdx = raw.indexOf(":");
      if (colonIdx === -1) {
        malformed = true;
        break;
      }
      let label = raw.slice(0, colonIdx).trim();
      const expression = raw.slice(colonIdx + 1).trim();
      const showMax = label.endsWith("+max");
      if (showMax) label = label.slice(0, -"+max".length).trim();
      parts.push({ label, expression, showMax });
    }
    if (malformed) continue; // a part missing its own "label:" -- not a valid compound roll, falls through to the plain-expression scanner instead
    segments.push({ start: span.start, end: span.end, actionLabel: body.slice(0, semiIdx).trim(), parts, display });
  }
  return segments;
}

/**
 * Real bug, found live during the skills rework (2026-10-26, third
 * pass): a blank "text"-typed variable's own stored value (`""`, e.g.
 * an unset skill Expertise) was silently coercing to 0 here --
 * `Number("")` is `0` in JS, which `Number.isFinite` happily accepts
 * -- so a bare `{skillExpertise}` reference inside a compound roll's
 * own part (shared/characterSheet.ts's own CompoundRollPart) resolved
 * to the NUMBER 0 instead of falling through to this file's own
 * bare-reference TEXT fallback (see evaluateCharacterSheetExpression
 * below). The empty-string guard below matches the convention every
 * OTHER numeric-coercion helper in this codebase already uses (e.g.
 * characterSheetWidgets.ts's own `asNumber`).
 */
function asFiniteNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Resolves ONE variable's own current ("x") or max ("y") value --
 * real request, 2026-10-26: "Any xOfY variable should have Y be the
 * max of that... hp.y should just auto-set to the actual max hp,"
 * generalized (third pass, same day) to the "x" side too: "Bonus on
 * the page should show the resulting number, and the core&variables
 * should show that equation you put" -- a plain "number" variable can
 * be ENTIRELY derived (e.g. a skill's own Bonus = governing substat +
 * skill points) the same way an xOfY's own max can be. Either side is
 * just a flat stored number (`variableId` for "x", `xOfYMaxKey` for
 * "y") UNLESS the variable's own def declares the matching
 * `valueExpression`/`maxExpression` -- then it's resolved by
 * evaluating THAT expression, recursively resolving any
 * `{ref}`/`{ref.x}`/`{ref.y}` IT contains through this SAME function
 * (so one variable's own live formula can depend on ANOTHER
 * variable's own, possibly also live, value or max).
 *
 * `visiting` is the real cycle guard the user explicitly asked for
 * ("graph theory visit check... when calculating"): each variable+
 * component pair currently being resolved is added to this set before
 * recursing and removed after, so a genuine cycle (A's value depends
 * on B's value depends on A's value) hits an already-visiting key and
 * returns undefined instead of recursing forever -- a real DFS-cycle
 * check, not a depth limit standing in for one.
 */
export function resolveVariableValue(
  variableId: string,
  component: "x" | "y",
  defs: readonly CharacterSheetVariableDef[],
  variableValues: Readonly<Record<string, number | string>>,
  visiting: Set<string> = new Set(),
): number | undefined {
  const def = defs.find((d) => d.id === variableId);
  const liveExpression = component === "y" ? def?.maxExpression : def?.valueExpression;
  if (liveExpression !== undefined) {
    const key = `${variableId}.${component}`;
    if (visiting.has(key)) return undefined; // cyclic dependency
    visiting.add(key);
    const substituted = substituteVariableRefs(liveExpression, variableValues, defs, visiting);
    visiting.delete(key);
    if (substituted === undefined) return undefined;
    try {
      return asFiniteNumber(arithmeticParser.evaluate(substituted) as number | string);
    } catch {
      return undefined;
    }
  }
  const key = component === "y" ? xOfYMaxKey(variableId) : variableId;
  return asFiniteNumber(variableValues[key] ?? (component === "y" ? def?.max : def?.default));
}

/**
 * Substitutes every `{variableId}`/`{variableId.x}`/`{variableId.y}`
 * reference found WITHIN `text` (findVariableRefs, reused directly --
 * same single-brace syntax, same rules) with its current numeric
 * value, resolved via `resolveVariableValue` above (so a `.y` ref
 * against a variable with a live `maxExpression` recurses correctly,
 * not just a flat lookup). `defs` is optional -- callers with no
 * variable-definition context at all (e.g. a chat `[[dice]]` roll,
 * which only ever has `variableValues`) simply never hit the live-max
 * branch, same as before this feature existed. A reference to a
 * variable that doesn't exist, or holds a non-numeric value, fails
 * the WHOLE substitution rather than silently defaulting to 0.
 * Returns undefined on any unresolvable reference. Shared by BOTH the
 * `{{expression}}` evaluator below AND the `[[dice notation]]` chat-
 * roll system (packages/server/src/chat/diceRoll.ts) -- real request:
 * "the rolling system should also be able to handle variables...
 * maybe for both systems" -- same rule, same syntax, one
 * implementation.
 */
export function substituteVariableRefs(
  text: string,
  variableValues: Readonly<Record<string, number | string>>,
  defs: readonly CharacterSheetVariableDef[] = [],
  visiting: Set<string> = new Set(),
): string | undefined {
  const refs = findVariableRefs(text);
  if (refs.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const ref of refs) {
    const component = ref.component === "y" ? "y" : "x";
    const value = resolveVariableValue(ref.variableId, component, defs, variableValues, visiting);
    if (value === undefined) return undefined;
    result += text.slice(cursor, ref.start) + String(value);
    cursor = ref.end;
  }
  result += text.slice(cursor);
  return result;
}

/**
 * What evaluating one `{{expression}}` segment produces -- plain data,
 * rendered by the client regardless of which side actually computed
 * it (see `evaluateCharacterSheetExpression` below for the split).
 * `needsRoll: true` means this segment contains real dice notation in
 * an allowed (`button`) spot -- the bare number isn't known yet,
 * since only the server may compute an actual roll (diceRoll.ts's own
 * "the server is the only place a roll is ever computed" rule); the
 * caller must ask the server (today: `rollCharacterSheetExpression`,
 * via `postCharacterSheetPreview`) for the real `value`/`text`.
 */
export interface ExpressionEvalResult {
  value?: number;
  /** Either a human-readable breakdown for a result that included a real dice roll (DiceRoll's own .output -- `value` is ALSO set in that case), or, real request 2026-10-26, the WHOLE result when the expression was a bare reference to plain informational text (e.g. a skill's own Expertise) -- `value` is absent then, this is the only thing to display. */
  text?: string;
  error?: string;
  needsRoll?: boolean;
  /** Real request, 2026-10-26: "the max damage (used if crit or nat 20)" -- the theoretical max this same roll could have produced (DiceRoll's own `.maxTotal`, computed on the SAME roll object, no separate calculation needed), set whenever a real dice roll actually happened. A compound roll's own `showMax` parts are the only thing that currently DISPLAYS this; it's populated on every real roll regardless, since it costs nothing extra to compute. */
  maxValue?: number;
}

/**
 * `d` immediately followed by a digit -- real dice notation (`1d20`,
 * `d6`), not a variable name that happens to contain both (checked
 * against the ALREADY-substituted text, after every `{variableId}`
 * ref has been swapped for its plain numeric value, specifically so a
 * variable literally named e.g. `d4bonus` can never false-positive
 * here -- its own NAME never survives into the text this pattern
 * actually sees). Shared by the client's own arithmetic evaluator
 * below and the server's real-roll path (diceRoll.ts) so both agree
 * on exactly the same definition of "this needs a real die."
 */
export const DICE_NOTATION_PATTERN = /d[0-9]/i;

const arithmeticParser = new Parser();

/**
 * Real request, 2026-10-26: "a few buttons to click and roll, like
 * heavy attack, initiative, etc." Light/Heavy Attack's own notation
 * (the real sheet's own Light/Heavy Damage cells, e.g. "2d4+5") is a
 * complete dice-notation STRING in its own right, not a number to
 * plug into arithmetic -- `{{heavyDamage}}` (a BARE reference to
 * exactly one variable, nothing else in the expression) needs to
 * pass that string through VERBATIM rather than fail the strict
 * numeric substitution every other expression correctly requires
 * (expr-eval has no notion of dice notation at all). Returns
 * undefined, same as `substituteVariableRefs`, for anything that
 * ISN'T this one narrow case (a genuinely unknown/non-numeric
 * variable in a LARGER expression still fails normally).
 */
export function substituteForDiceCheck(expression: string, variableValues: Readonly<Record<string, number | string>>, defs: readonly CharacterSheetVariableDef[] = []): string | undefined {
  const strict = substituteVariableRefs(expression, variableValues, defs);
  if (strict !== undefined) return strict;
  const bareRef = /^\{([a-zA-Z0-9_-]+)(?:\.(x|y))?\}$/.exec(expression.trim());
  if (!bareRef) return undefined;
  const component = bareRef[2] === "y" ? "y" : "x";
  const key = component === "y" ? xOfYMaxKey(bareRef[1]) : bareRef[1];
  const raw = variableValues[key];
  return typeof raw === "string" ? raw : undefined;
}

/**
 * Real correction, 2026-10-25: "the character sheet results for
 * displaying on the client side can all be done client side... if we
 * need a new library for the server not to have to execute arbitrary
 * math to fill out an MD file, we should do that rather than putting
 * calculations on the server side." Plain arithmetic (`+ - * / ^ %`,
 * parentheses, `{variableId}` refs already substituted to numbers) is
 * evaluated HERE, client-side, via `expr-eval` (a small, dependency-
 * free, non-`eval()` expression parser -- confirmed directly: division
 * by zero returns Infinity/NaN rather than throwing, so an explicit
 * `Number.isFinite` check below catches it; malformed syntax throws a
 * plain catchable `Error`). Only a genuine dice roll (real RNG) still
 * needs the server at all -- detected here via `DICE_NOTATION_PATTERN`
 * and reported back as `needsRoll: true` rather than attempted, since
 * this function itself has no access to (and must never gain access
 * to) real randomness.
 */
export function evaluateCharacterSheetExpression(expression: string, variableValues: Readonly<Record<string, number | string>>, allowDice: boolean, defs: readonly CharacterSheetVariableDef[] = []): ExpressionEvalResult {
  const lenient = substituteForDiceCheck(expression, variableValues, defs);
  if (lenient === undefined) return { error: "unknown or non-numeric variable" };
  if (DICE_NOTATION_PATTERN.test(lenient)) {
    if (!allowDice) return { error: "dice rolling not allowed in fixed displays" };
    return { needsRoll: true };
  }
  // No dice in play -- back to the STRICT substitution (expr-eval has
  // no use for a raw notation string, only the lenient dice-check
  // path above does).
  const substituted = substituteVariableRefs(expression, variableValues, defs);
  if (substituted === undefined) {
    // Real request, 2026-10-26: a skill's own Expertise ("jumping")
    // is plain informational TEXT, not a number or a roll -- the
    // STRICT substitution above only ever fails here because `lenient`
    // came from `substituteForDiceCheck`'s own BARE-reference fallback
    // (the only way `lenient` can be defined while `substituted` isn't),
    // meaning the whole expression really is just one `{variableId}`
    // ref to a non-numeric string. Shown verbatim as `text` (no
    // `value` at all) rather than failing -- a compound roll's own
    // part (shared/characterSheet.ts's own CompoundRollPart) can be a
    // plain display field, not every part is a number to roll.
    return { text: lenient };
  }
  try {
    const value = arithmeticParser.evaluate(substituted);
    if (typeof value !== "number" || !Number.isFinite(value)) return { error: "division by zero" };
    return { value };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

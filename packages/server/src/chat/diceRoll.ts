// Server-only dice evaluation -- the actual RNG execution. Never shipped
// to the client (packages/client's package.json does not depend on this
// library); the client only ever sends raw chat text, the server is the
// only place a roll is ever computed, matching this project's existing
// trust-boundary split (voxel edits/admin checks are server-checked even
// though movement itself is client-trusted -- see docs/ROADMAP.md's MVP
// goal section for dice joining that same "must be fair" category).
//
// @dice-roller/rpg-dice-roller's real throw behavior (confirmed live,
// not assumed from its docs): a syntax error throws a `peg$SyntaxError`,
// an empty/missing notation throws a `RequiredArgumentError` -- caught
// generically below rather than matched by type, since "something about
// this notation is invalid" is all this wrapper needs to know.

import { DiceRoll } from "@dice-roller/rpg-dice-roller";
import { substituteVariableRefs, substituteForDiceCheck, DICE_NOTATION_PATTERN, type ExpressionEvalResult, type CompoundRollPart } from "@ttrpg3d/shared";

export interface RollOk {
  ok: true;
  /** Human-readable breakdown, e.g. "2d20kh1+2: [18d, 5]+2 = 20" -- DiceRoll's own .output. */
  text: string;
  total: number;
}

export interface RollError {
  ok: false;
  reason: string;
}

/**
 * Real request, 2026-10-25 -- "the rolling system should also be able
 * to handle variables, and if that means you need to eval them first
 * and then give them as a string, then I think we'll have to do that
 * first, and maybe for both systems": `[[notation]]` chat rolls can
 * now reference a character's own `{variableId}` (e.g.
 * `[[1d20+{initiative}]]`), substituted to a plain number FIRST
 * (shared/characterSheet.ts's substituteVariableRefs -- the exact
 * same rule/syntax `{{expression}}` sheet formulas already use, one
 * implementation) -- `variableValues` defaults to `{}` so every
 * EXISTING caller (plain dice notation, no character context at all)
 * keeps working unchanged.
 */
export function rollNotation(notation: string, variableValues: Readonly<Record<string, number | string>> = {}): RollOk | RollError {
  const substituted = substituteVariableRefs(notation, variableValues);
  if (substituted === undefined) return { ok: false, reason: `invalid dice notation: ${notation} (an unknown or non-numeric variable reference)` };
  try {
    const roll = new DiceRoll(substituted);
    return { ok: true, text: roll.output, total: roll.total };
  } catch {
    return { ok: false, reason: `invalid dice notation: ${notation}` };
  }
}

/**
 * docs/CHARACTER_SHEET_IMPORT.md, part 1 -- real correction, 2026-10-25
 * (second pass): plain arithmetic now evaluates client-side (shared/
 * characterSheet.ts's own `evaluateCharacterSheetExpression`, via
 * `expr-eval`) -- "the character sheet results for displaying on the
 * client side can all be done client side... we should [add a
 * library] rather than putting calculations on the server side." This
 * function is now the ONLY `{{expression}}` work left that actually
 * needs the server at all: a genuine dice roll, which needs real RNG
 * (this file's own long-standing header: "the server is the only
 * place a roll is ever computed" -- a malicious/modified client could
 * otherwise fake any roll it wants). Everything else -- plain
 * arithmetic, an unknown-variable error, a disallowed-dice "box"
 * error -- the client has ALREADY resolved on its own by the time
 * this is even called, so this returns `undefined` for all of those
 * cases rather than redoing them; server.ts's own mapping drops every
 * `undefined` result instead of sending it back.
 */
export function rollCharacterSheetExpression(expression: string, variableValues: Readonly<Record<string, number | string>>, allowDice: boolean): ExpressionEvalResult | undefined {
  if (!allowDice) return undefined;
  // Same lenient substitution the client's own needsRoll DETECTION
  // already uses (shared/characterSheet.ts's substituteForDiceCheck)
  // -- a bare `{{heavyDamage}}` reference to a variable that's
  // ITSELF a complete dice-notation string (e.g. "4d6+10") passes
  // through verbatim here too, not just when merely checking for it.
  const substituted = substituteForDiceCheck(expression, variableValues);
  if (substituted === undefined || !DICE_NOTATION_PATTERN.test(substituted)) return undefined;
  try {
    const roll = new DiceRoll(substituted);
    // Confirmed directly: DiceRoll does NOT throw on division by
    // zero -- it silently returns Infinity (`5/0` -> total=Infinity).
    // That's exactly the kind of "technically a number, not actually
    // a sane result" this needs to catch and report, not display.
    if (!Number.isFinite(roll.total)) return { error: "division by zero" };
    // `.maxTotal` is DiceRoll's own theoretical-max property, computed
    // on this SAME roll object -- real request, 2026-10-26: "the max
    // damage (used if crit or nat 20)." Always populated on a real
    // roll (costs nothing extra); only a compound roll's own
    // `showMax` parts currently display it.
    return { value: roll.total, text: roll.output, maxValue: Number.isFinite(roll.maxTotal) ? roll.maxTotal : undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Real request, 2026-10-26: "For light attack, we want to display the
 * attack to-hit result, the damage, and the max damage... some table
 * in the chat." A compound roll's own parts are ALWAYS evaluated here
 * (unlike `rollCharacterSheetExpression` above, which only ever
 * handles the subset the client flagged `needsRoll`) -- a compound
 * roll is, by its own `;`/`|` syntax, ALWAYS an explicit button/
 * action a session chose to click, never a value shown passively on
 * a page, so there's no "the client already resolved this" case to
 * skip here. Reuses the exact same lenient dice-notation substitution
 * (a bare `{lightDamage}`-shaped part's own raw string passes
 * through) and the SAME `DiceRoll` call every other roll in this file
 * uses -- `DiceRoll` already evaluates plain arithmetic with no dice
 * term just fine, so a part with no real dice in it (unusual for a
 * compound roll, but not disallowed) still resolves correctly here.
 */
export function rollCompoundPart(part: Pick<CompoundRollPart, "expression">, variableValues: Readonly<Record<string, number | string>>): ExpressionEvalResult {
  const substituted = substituteForDiceCheck(part.expression, variableValues);
  if (substituted === undefined) return { error: "unknown or non-numeric variable" };
  try {
    const roll = new DiceRoll(substituted);
    if (!Number.isFinite(roll.total)) return { error: "division by zero" };
    return { value: roll.total, text: roll.output, maxValue: Number.isFinite(roll.maxTotal) ? roll.maxTotal : undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

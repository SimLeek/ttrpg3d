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
import { substituteVariableRefs, type ExpressionEvalResult } from "@ttrpg3d/shared";

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
 * docs/CHARACTER_SHEET_IMPORT.md, part 1 -- real correction, 2026-10-25:
 * replaces the earlier hand-rolled arithmetic parser (shared/
 * characterSheet.ts's own removed evaluateExpression) -- "we don't
 * want to risk mistakes when we can just use libraries... the dice
 * evaluator should be able to do everything there." Confirmed
 * directly (not assumed): DiceRoll evaluates plain arithmetic with NO
 * dice term at all just fine (e.g. "20 + (10 * 5)"), so one evaluator
 * covers both a sheet's own derived-stat formulas AND an actual dice
 * roll.
 *
 * `allowDice` is the caller's own "is this a fixed/always-shown
 * display, or a deliberate roll-button click" decision (an
 * `ExpressionSegment`'s `display === "button"`) -- real request:
 * "search 'd\d'... if that's found then have it display an error
 * 'dice rolling not allowed in fixed displays'." Checked AFTER
 * variable substitution (never on the raw, un-substituted text) --
 * substitution replaces every `{variableId}` with a plain number, so
 * a variable's own NAME can never produce a false positive here (a
 * name like "hp2d" is gone by the time this check runs).
 *
 * This is WHY `{{expression}}` resolution has to live here, server-
 * side, rather than back in shared/characterSheet.ts where the
 * client could run it directly: `@dice-roller/rpg-dice-roller` must
 * never be evaluated client-side at all (this file's own long-
 * standing header comment: "the server is the only place a roll is
 * ever computed" -- a malicious/modified client could otherwise fake
 * any roll it wants). A "box" (no dice allowed) expression has
 * nothing to cheat either way, but keeping ONE evaluation path for
 * both cases (rather than a client-side one for "safe" expressions
 * and a server one for dice-containing ones) means there's only ever
 * one place this logic can drift from being correct.
 */
const DICE_NOTATION_PATTERN = /d[0-9]/i;

export function evaluateCharacterSheetExpression(expression: string, variableValues: Readonly<Record<string, number | string>>, allowDice: boolean): ExpressionEvalResult {
  const substituted = substituteVariableRefs(expression, variableValues);
  if (substituted === undefined) return { error: "unknown or non-numeric variable" };
  if (!allowDice && DICE_NOTATION_PATTERN.test(substituted)) return { error: "dice rolling not allowed in fixed displays" };
  try {
    const roll = new DiceRoll(substituted);
    // Confirmed directly: DiceRoll does NOT throw on division by
    // zero -- it silently returns Infinity (`5/0` -> total=Infinity).
    // That's exactly the kind of "technically a number, not actually
    // a sane result" this needs to catch and report, not display.
    if (!Number.isFinite(roll.total)) return { error: "division by zero" };
    return allowDice ? { value: roll.total, text: roll.output } : { value: roll.total };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

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

export function rollNotation(notation: string): RollOk | RollError {
  try {
    const roll = new DiceRoll(notation);
    return { ok: true, text: roll.output, total: roll.total };
  } catch {
    return { ok: false, reason: `invalid dice notation: ${notation}` };
  }
}

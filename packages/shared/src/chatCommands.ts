// Pure string-level chat syntax detection -- the actual dice ROLLING
// (randomness) is server-only (packages/server/src/chat/diceRoll.ts),
// never computed client-side, since a roll result must be trusted/fair
// the same way this project already treats voxel edits and admin checks
// (see docs/ROADMAP.md's MVP goal section). This file only recognizes
// where a notation string sits inside a chat message -- it never rolls
// anything itself, so it has no dependency on the dice library and is
// safe to share between client and server.

/** `/roll <notation>` as a whole-message slash command -- returns the notation, or null if `text` isn't one. Case-sensitive on purpose (slash commands are a deliberate, typed action, not prose). */
export function parseSlashRoll(text: string): string | null {
  const match = /^\/roll\s+(.+)$/.exec(text.trim());
  return match ? match[1].trim() : null;
}

export interface InlineRollSegment {
  /** Index of the segment's opening `[[` in the original string. */
  start: number;
  /** Index just past the segment's closing `]]`. */
  end: number;
  notation: string;
}

/**
 * Finds every `[[...]]` segment in `text`, in order, left to right.
 * Non-greedy per segment (stops at the first `]]`) and does not support
 * nested brackets -- `[[1d6]]` and `[[1d6]] [[1d8]]` both work, `[[a[[b]]]]`
 * does not (treated as `[[a[[b]]` followed by a stray `]]`, matching the
 * simplest reasonable interpretation of malformed input rather than
 * guessing at nesting rules nothing in this project has ever needed).
 */
export function findInlineRolls(text: string): InlineRollSegment[] {
  const segments: InlineRollSegment[] = [];
  const pattern = /\[\[(.+?)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    segments.push({ start: match.index, end: match.index + match[0].length, notation: match[1].trim() });
  }
  return segments;
}

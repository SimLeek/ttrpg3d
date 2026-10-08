// Minimal reference-counted "who's claiming input right now" tracker --
// a direct, deliberately scoped-down port of the old game's
// input_controller.gd: just its core request_capture/release_capture/
// is_captured mechanism, not its gesture/sequence-matching, double-tap,
// or event-replay layers (no consumer for any of that here). Multiple
// simultaneous claimants are supported (a Set, not a single flag) so two
// unrelated UI pieces needing exclusive input (e.g. the inventory grid
// today, a DM chat box later) don't have to coordinate with each other.
//
// First real consumer: hotbar.ts's inventory grid needs the mouse free
// to click items, so it requests capture while open (and releases it on
// close) to suspend noa's pointer-lock mouse-look meanwhile.

const activeReasons = new Set<string>();

export function requestCapture(reason: string): void {
  activeReasons.add(reason);
}

export function releaseCapture(reason: string): void {
  activeReasons.delete(reason);
}

export function isCaptured(): boolean {
  return activeReasons.size > 0;
}

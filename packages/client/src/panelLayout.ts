// Shared constants + the "safe area" contract for the panel UI chrome
// (chat, mode-select, quick-actions, party-list -- docs/ROADMAP.md's
// MVP goal item 3).
//
// Real bug class worth avoiding up front: two independently-chosen
// magic z-index numbers already existed (pageManager.ts's 10,
// chatPanel.ts's 50, each justified by its own local comment re-
// deriving the same DOM-ordering fact) before a single shared source
// of truth existed -- cheap to centralize now, before a future panel
// picks a third number that silently loses to one of these.
//
// Deliberately NOT a shared "collapsible docked panel" component --
// only chatPanel.ts has that exact toggle+drag+collapse mechanic today;
// the new mode/quick-actions/party-list panels are each their own file
// (see docs/COMPLETED.md's panel-UI-chrome entry for why: this
// project's own "three similar things before abstracting" principle,
// and the new panels aren't even all the same sub-pattern as chat).

/** Every docked panel mounted BEFORE a game session's startGame() runs (chat itself, quick-actions, party-list -- see main.ts's enterGame) needs this: noa's own canvas is always a LATER DOM sibling on every page switch and would otherwise paint over them with no explicit z-index set (reproduced live once already, for chat). Panels mounted INSIDE startGame() (mode-select, same lifecycle as hotbar.ts) don't need this -- they're already a later DOM sibling by construction. */
export const PERSISTENT_PANEL_Z_INDEX = 50;

/** Expanded width of the left mode-select panel -- "smallest/innermost" by design (docs/ROADMAP.md's MVP goal item 3: only a handful of core modes to switch between), unlike chat's drag-resizable width. Still just a STARTING point now that the panel is collapsible too -- see SAFE_AREA_LEFT_VAR below for its actual live value. */
export const MODE_PANEL_WIDTH = 64;

// ---- Safe-area contract ----
//
// Real user correction (2026-10-16): the hotbar (hotbar.ts, the
// persistent 0-9 slot row) ended up hidden behind the new bottom
// party-list panel, because it was positioned relative to the raw
// viewport edge instead of whatever space the side panels actually
// leave free. Generalized fix: every docked panel publishes its own
// CURRENT occupied inset (collapsed or expanded, live) as a CSS custom
// property on `document.documentElement`; any other game UI (hotbar
// today, anything else later) reads the relevant one(s) instead of a
// raw screen edge, so it automatically re-flows whenever a panel
// resizes or collapses/expands -- "just use that to place all the game
// UI," per the user's own framing, rather than a one-off hotbar patch.
//
// Each panel is responsible for keeping ITS OWN variable accurate,
// including its own toggle tab's real footprint -- easiest to get
// right by measuring the panel's actual rendered box
// (getBoundingClientRect) right after every collapse/expand toggle
// (and once on initial mount) rather than hand-computing pixel sums
// from its own CSS, which drifts the moment that CSS changes. Chat is
// the one exception: its width changes continuously during a drag, not
// just between two toggle states, so it already computes an exact
// pixel value directly in applyWidth/setCollapsed rather than measuring
// after the fact -- same contract (this variable), different
// implementation, because its own source of truth is different.

export const SAFE_AREA_LEFT_VAR = "--safe-area-left";
export const SAFE_AREA_RIGHT_VAR = "--safe-area-right";
export const SAFE_AREA_TOP_VAR = "--safe-area-top";
export const SAFE_AREA_BOTTOM_VAR = "--safe-area-bottom";

/** Sets one of the SAFE_AREA_*_VAR custom properties to `pixels` (rounded -- sub-pixel values from getBoundingClientRect aren't meaningful here and just add visual jitter). */
export function setSafeAreaInset(cssVar: string, pixels: number): void {
  document.documentElement.style.setProperty(cssVar, `${Math.round(pixels)}px`);
}

/**
 * Keeps `cssVar` correct for as long as `element`'s real rendered size
 * keeps changing, not just once at mount/toggle time. Real bug found
 * live: a panel mounted asynchronously (quickActionsPanel.ts/
 * partyListPanel.ts, gated on main.ts's chat-connection network
 * round-trip) could publish its FIRST measurement before the browser
 * had actually finished laying it out, baking in a wrong value that
 * nothing then corrected -- reproduced live as "hotbar overlaps the
 * bottom panel on page load, fixes itself the instant any panel is
 * resized" (a resize/toggle re-measures, which happened to mask the
 * real bug rather than fix it). A ResizeObserver's own initial callback
 * fires once real layout has actually settled (and again on any later
 * real change, from any cause) -- the correct general fix, not another
 * one-shot measurement that could race the same way.
 *
 * Not available in this project's test environment (jsdom has no
 * ResizeObserver implementation, confirmed directly, not assumed) --
 * degrades to doing nothing there, which is fine: tests assert on
 * class-toggling behavior, not live pixel measurements, and real
 * browsers (where this actually matters) have had ResizeObserver
 * support for years.
 *
 * @returns a cleanup function (always safe to call, even when no
 * observer was actually created).
 */
export function observeSafeAreaInset(element: HTMLElement, cssVar: string, dimension: "width" | "height"): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  // Re-measure via getBoundingClientRect on every callback rather than
  // trusting the observer entry's own size fields -- those (contentRect
  // specifically) report the CONTENT box, excluding border/padding,
  // which would under-count every one of these panels' real visual
  // footprint (each has a real CSS border). getBoundingClientRect
  // always reports the full border box, matching the measurement this
  // function replaces exactly, so the observer here is purely a
  // reliable TRIGGER for "re-measure now," not a measurement source
  // itself.
  const observer = new ResizeObserver(() => {
    setSafeAreaInset(cssVar, dimension === "width" ? element.getBoundingClientRect().width : element.getBoundingClientRect().height);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

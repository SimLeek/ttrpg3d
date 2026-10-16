// Top quick-actions panel -- spans the horizontal gap between the left
// mode-select panel's right edge and the right chat panel's live left
// edge (docs/ROADMAP.md's MVP goal item 3). Entirely empty today -- its
// real content (character-sheet-defined quick actions) is MVP item 1
// (character sheets), not built yet. Collapsed by DEFAULT (explicit
// user request), expandable via its own toggle tab, same manual
// collapse/toggle pattern chatPanel.ts already established (not a
// shared component -- see panelLayout.ts's own header for why this
// project holds off on extracting one until a second file duplicates
// chat's EXACT toggle+drag mechanic, which this panel doesn't: no
// drag-resize here, just collapse/expand).
//
// Mounted in main.ts alongside chatPanel.ts/partyListPanel.ts (game-
// scoped, surviving page switches) -- empty today, but its eventual
// real content (character-sheet actions) will be user/character-scoped
// too, not page-scoped, so it shares chat's lifecycle for consistency
// rather than flickering independently of the panel below it.
//
// Publishes its own live height to panelLayout.ts's SAFE_AREA_TOP_VAR
// on mount and on every collapse/expand toggle, by measuring its actual
// rendered box -- see that file's own header for the general contract
// this is part of (hotbar.ts reads SAFE_AREA_BOTTOM_VAR the same way).
//
// Deliberately noa-free, same reasoning as every other panel file here.

import { PERSISTENT_PANEL_Z_INDEX, SAFE_AREA_LEFT_VAR, SAFE_AREA_RIGHT_VAR, SAFE_AREA_TOP_VAR, setSafeAreaInset, observeSafeAreaInset } from "./panelLayout.js";

export interface QuickActionsPanelController {
  destroy(): void;
}

export function mountQuickActionsPanel(container: HTMLElement): QuickActionsPanelController {
  container.innerHTML = `
    <style>
      .qa-panel { position: fixed; top: 0; left: var(${SAFE_AREA_LEFT_VAR}, 64px); right: var(${SAFE_AREA_RIGHT_VAR}, 320px); display: flex; flex-direction: column; background: rgba(20,20,24,0.85); border-bottom: 2px solid rgba(200,200,200,0.4); font-family: system-ui, sans-serif; color: #eee; z-index: ${PERSISTENT_PANEL_Z_INDEX}; }
      .qa-panel.collapsed .qa-body { display: none; }
      .qa-toggle { align-self: center; width: 48px; height: 14px; background: rgba(20,20,24,0.85); border: 1px solid rgba(200,200,200,0.4); border-top: none; border-radius: 0 0 6px 6px; cursor: pointer; color: #eee; font-size: 10px; line-height: 1; display: flex; align-items: center; justify-content: center; margin-top: -1px; }
      .qa-body { padding: 8px; font-size: 12px; color: #999; text-align: center; min-height: 32px; display: flex; align-items: center; justify-content: center; }
    </style>
    <div class="qa-panel collapsed" id="qa-panel">
      <div class="qa-body" id="qa-body">No quick actions yet -- these come from a character sheet.</div>
      <button class="qa-toggle" id="qa-toggle" type="button" title="Expand/collapse quick actions">&#x25BC;</button>
    </div>
  `;

  const panel = container.querySelector<HTMLDivElement>("#qa-panel")!;
  const toggle = container.querySelector<HTMLButtonElement>("#qa-toggle")!;

  let collapsed = true;
  function publishHeight(): void {
    setSafeAreaInset(SAFE_AREA_TOP_VAR, panel.getBoundingClientRect().height);
  }
  function setCollapsed(next: boolean): void {
    collapsed = next;
    panel.classList.toggle("collapsed", collapsed);
    toggle.innerHTML = collapsed ? "&#x25BC;" : "&#x25B2;";
    publishHeight();
  }
  toggle.addEventListener("click", () => setCollapsed(!collapsed));
  publishHeight();
  // Self-correcting backstop for the manual publishHeight() calls above
  // -- see panelLayout.ts's own doc comment on observeSafeAreaInset for
  // the real race this closes (this panel mounts asynchronously, gated
  // on main.ts's chat-connection network round-trip, which could land
  // its first measurement before the browser had actually finished
  // laying it out).
  const stopObserving = observeSafeAreaInset(panel, SAFE_AREA_TOP_VAR, "height");

  return {
    destroy(): void {
      stopObserving();
    },
  };
}

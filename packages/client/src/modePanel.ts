// Left mode-select panel -- full screen height, the INNERMOST and
// smallest of the panel UI chrome (docs/ROADMAP.md's MVP goal item 3:
// only a handful of core modes to switch between, unlike chat's
// higher-volume content). Mounted INSIDE game.ts's startGame() (same
// lifecycle as hotbar.ts -- per-page, recreated on every switch), NOT
// in main.ts like chat/quick-actions/party-list: pointer-lock is
// inherently a per-noa-session concept, and this panel's future real
// content (Phase 9's battle system) will be per-world/page too, so
// there's no reason for it to survive a page switch.
//
// Default/Select are real, wired to game.ts's RunningGame.setPointerLock
// (default = pointer-locked FPS-style look; select = cursor free to
// click UI). Distance-measurement and Turn-tracker are the real Phase 9
// (battle system) modes -- VISIBLE here but deliberately STUBBED
// (disabled, no handler) per explicit scope decision: their real
// behavior isn't built yet, and building it is a much larger, separate
// task, not something to half-wire just because this panel exists.
//
// Collapsible (real user request, same session chat's own drag-resize
// correction landed in) -- publishes its OWN live width to
// panelLayout.ts's SAFE_AREA_LEFT_VAR on mount and on every toggle, by
// measuring its actual rendered box rather than hand-computing pixel
// sums from its own CSS (see panelLayout.ts's own header for why this
// is the general contract hotbar.ts and any future game UI reads
// instead of a raw screen edge).
//
// Deliberately noa-free (same reasoning as hotbar.ts/chatPanel.ts) --
// pointer-lock control/state comes in via injected callbacks, not a
// direct noa import, so this stays jsdom-testable.

import { MODE_PANEL_WIDTH, SAFE_AREA_LEFT_VAR, setSafeAreaInset, observeSafeAreaInset } from "./panelLayout.js";

export interface ModePanelOptions {
  isPointerLocked: () => boolean;
  setPointerLock: (locked: boolean) => void;
  /** See game.ts's RunningGame.onPointerLockChange -- keeps this panel's own highlight correct even when the BROWSER force-exits lock via Escape, not just when one of this panel's own buttons is clicked. */
  onPointerLockChange: (cb: (locked: boolean) => void) => () => void;
}

export interface ModePanelController {
  destroy(): void;
}

export function mountModePanel(container: HTMLElement, options: ModePanelOptions): ModePanelController {
  container.innerHTML = `
    <style>
      /* No explicit z-index: mounted inside startGame(), so this
         container is appended to document.body AFTER noa's own canvas
         already exists -- natural DOM order already puts it on top,
         same reasoning hotbar.ts's own lack of a z-index relies on. */
      .mode-panel { position: fixed; top: 0; left: 0; bottom: 0; width: ${MODE_PANEL_WIDTH}px; display: flex; flex-direction: column; gap: 4px; padding: 6px; box-sizing: border-box; background: rgba(20,20,24,0.85); border-right: 2px solid rgba(200,200,200,0.4); font-family: system-ui, sans-serif; }
      .mode-panel.collapsed { width: 20px; padding: 6px 2px; }
      .mode-panel.collapsed .mode-btn { display: none; }
      .mode-btn { width: 100%; padding: 6px 2px; font-size: 11px; line-height: 1.2; background: rgba(0,0,0,0.3); border: 1px solid rgba(200,200,200,0.4); border-radius: 4px; color: #eee; cursor: pointer; text-align: center; }
      .mode-btn.active { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .mode-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .mode-toggle { margin-top: auto; width: 100%; padding: 4px 0; font-size: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(200,200,200,0.4); border-radius: 4px; color: #eee; cursor: pointer; }
    </style>
    <div class="mode-panel" id="mode-panel">
      <button class="mode-btn" id="mode-default" type="button" title="Pointer-locked FPS-style look">Default</button>
      <button class="mode-btn" id="mode-select" type="button" title="Free cursor to click UI">Select</button>
      <button class="mode-btn" id="mode-distance" type="button" disabled title="Coming with the battle system">Distance</button>
      <button class="mode-btn" id="mode-turns" type="button" disabled title="Coming with the battle system">Turns</button>
      <button class="mode-toggle" id="mode-toggle" type="button" title="Collapse/expand mode panel">&#x25C0;</button>
    </div>
  `;

  const panel = container.querySelector<HTMLDivElement>("#mode-panel")!;
  const toggle = container.querySelector<HTMLButtonElement>("#mode-toggle")!;
  const defaultBtn = container.querySelector<HTMLButtonElement>("#mode-default")!;
  const selectBtn = container.querySelector<HTMLButtonElement>("#mode-select")!;

  function render(locked: boolean): void {
    defaultBtn.classList.toggle("active", locked);
    selectBtn.classList.toggle("active", !locked);
  }
  render(options.isPointerLocked());

  defaultBtn.addEventListener("click", () => options.setPointerLock(true));
  selectBtn.addEventListener("click", () => options.setPointerLock(false));

  let collapsed = false;
  function publishWidth(): void {
    setSafeAreaInset(SAFE_AREA_LEFT_VAR, panel.getBoundingClientRect().width);
  }
  function setCollapsed(next: boolean): void {
    collapsed = next;
    panel.classList.toggle("collapsed", collapsed);
    toggle.innerHTML = collapsed ? "&#x25B6;" : "&#x25C0;";
    publishWidth();
  }
  toggle.addEventListener("click", () => setCollapsed(!collapsed));
  publishWidth();
  // Self-correcting backstop for the manual publishWidth() calls above
  // -- see panelLayout.ts's own doc comment on observeSafeAreaInset for
  // the real race this closes (a panel's first measurement landing
  // before the browser had actually finished laying it out).
  const stopObserving = observeSafeAreaInset(panel, SAFE_AREA_LEFT_VAR, "width");

  const unsubscribe = options.onPointerLockChange(render);

  return {
    destroy(): void {
      unsubscribe();
      stopObserving();
    },
  };
}

// Bottom party/user-list panel -- same horizontal span as
// quickActionsPanel.ts (mode-select panel's right edge to chat panel's
// live left edge, docs/ROADMAP.md's MVP goal item 3). Shows every
// currently-connected game participant with a generic placeholder
// avatar -- NOT character-sheet-driven yet (that's a separate,
// explicitly deferred follow-up noted in docs/ROADMAP.md: switching a
// user's avatar to a selected character's avatar, picked via chat,
// once characters exist).
//
// Mounted in main.ts alongside chatPanel.ts/quickActionsPanel.ts
// (game-scoped, surviving page switches) -- its data source
// (GameRoom's presence, via chatNet.ts's onPresenceChange) is
// game-scoped by the same reasoning chat itself already established,
// not per-world/page.
//
// Collapsible (real user request -- the hotbar below needs this panel's
// collapsed state to shrink out of its way, not just the expanded one).
// Publishes its own live height to panelLayout.ts's SAFE_AREA_BOTTOM_VAR
// on mount and on every collapse/expand toggle, by measuring its actual
// rendered box -- see that file's own header for the general contract
// this is part of (hotbar.ts reads SAFE_AREA_BOTTOM_VAR the same way).
//
// Deliberately noa-free, same reasoning as every other panel file here.

import { PERSISTENT_PANEL_Z_INDEX, SAFE_AREA_LEFT_VAR, SAFE_AREA_RIGHT_VAR, SAFE_AREA_BOTTOM_VAR, setSafeAreaInset, observeSafeAreaInset } from "./panelLayout.js";
import type { PresenceEntry } from "./chatNet.js";

export interface PartyListPanelOptions {
  initialPlayers: PresenceEntry[];
  /** Returns an unsubscribe function -- same shape as chatNet.ts's other subscribe methods. */
  onPresenceChange: (cb: (players: PresenceEntry[]) => void) => () => void;
}

export interface PartyListPanelController {
  destroy(): void;
}

// A colored circle with the player's own first initial -- the color is
// the real per-character token color (MVP goal items 1-2, docs/ROADMAP.md)
// once a player has selected a character; falls back to the original
// generic blue placeholder for a characterless join (real state, not an
// error -- see WorldRoom.ts's onJoin).
function buildEntry(name: string, tokenColor?: [number, number, number]): HTMLDivElement {
  const entry = document.createElement("div");
  entry.className = "party-entry";

  const avatar = document.createElement("div");
  avatar.className = "party-avatar";
  if (tokenColor) {
    const [r, g, b] = tokenColor;
    avatar.style.background = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }
  avatar.textContent = (name[0] ?? "?").toUpperCase();

  const label = document.createElement("div");
  label.className = "party-name";
  label.title = name;
  // textContent, not innerHTML -- player display names are user-set
  // (account creation takes an arbitrary string) and must never be
  // interpreted as HTML.
  label.textContent = name;

  entry.appendChild(avatar);
  entry.appendChild(label);
  return entry;
}

export function mountPartyListPanel(container: HTMLElement, options: PartyListPanelOptions): PartyListPanelController {
  container.innerHTML = `
    <style>
      .party-panel { position: fixed; bottom: 0; left: var(${SAFE_AREA_LEFT_VAR}, 64px); right: var(${SAFE_AREA_RIGHT_VAR}, 320px); display: flex; flex-direction: column; background: rgba(20,20,24,0.85); border-top: 2px solid rgba(200,200,200,0.4); font-family: system-ui, sans-serif; color: #eee; z-index: ${PERSISTENT_PANEL_Z_INDEX}; }
      .party-panel.collapsed .party-body { display: none; }
      .party-toggle { align-self: center; width: 48px; height: 14px; background: rgba(20,20,24,0.85); border: 1px solid rgba(200,200,200,0.4); border-bottom: none; border-radius: 6px 6px 0 0; cursor: pointer; color: #eee; font-size: 10px; line-height: 1; display: flex; align-items: center; justify-content: center; margin-bottom: -1px; order: -1; }
      .party-body { display: flex; align-items: center; gap: 8px; padding: 6px 10px; overflow-x: auto; }
      .party-entry { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: none; }
      .party-avatar { width: 32px; height: 32px; border-radius: 50%; background: rgb(80,110,160); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; }
      .party-name { font-size: 11px; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    </style>
    <div class="party-panel" id="party-panel">
      <button class="party-toggle" id="party-toggle" type="button" title="Expand/collapse party list">&#x25B2;</button>
      <div class="party-body" id="party-body"></div>
    </div>
  `;

  const panel = container.querySelector<HTMLDivElement>("#party-panel")!;
  const toggle = container.querySelector<HTMLButtonElement>("#party-toggle")!;
  const body = container.querySelector<HTMLDivElement>("#party-body")!;

  function render(players: PresenceEntry[]): void {
    body.innerHTML = "";
    for (const p of players) body.appendChild(buildEntry(p.name, p.tokenColor));
  }
  render(options.initialPlayers);

  let collapsed = false;
  function publishHeight(): void {
    setSafeAreaInset(SAFE_AREA_BOTTOM_VAR, panel.getBoundingClientRect().height);
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
  // laying it out -- also re-fires if the party list's own content
  // ever changes height, e.g. if a future design wraps to multiple
  // rows for a large party).
  const stopObserving = observeSafeAreaInset(panel, SAFE_AREA_BOTTOM_VAR, "height");

  const unsubscribe = options.onPresenceChange(render);

  return {
    destroy(): void {
      unsubscribe();
      stopObserving();
    },
  };
}

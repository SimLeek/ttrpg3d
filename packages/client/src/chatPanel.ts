// Game-wide chat panel, docked to the right edge -- the OUTERMOST,
// largest of the eventual panel UI chrome (docs/ROADMAP.md's MVP goal
// section, item 3): the other planned panels (mode-select, party list,
// quick-actions) don't exist yet, and chat is "the most important," so
// it gets the most room for now. Width is drag-resizable (a handle on
// the panel's left edge -- real user correction: an earlier version of
// this only had a click-to-collapse toggle between two fixed sizes,
// which wasn't what was actually wanted), plus a separate click-to-
// collapse toggle tab for quickly getting it out of the way entirely --
// the two aren't mutually exclusive, collapsing just remembers the
// dragged width to restore on expand.
//
// Deliberately noa-free (same reasoning as hotbar.ts), so this stays
// unit-testable against a real but detached DOM (jsdom) without a real
// Engine/WebGL context -- see chatPanel.test.ts. Pointer-lock suspend
// while typing is exposed as an `onFocusChange` callback for whatever
// mounts this to wire up (mirrors hotbar.ts's `onInventoryOpenChange`
// pattern -- NOT pageManager.ts's gap of requesting capture but never
// touching pointer-lock, which would leave the mouse locked while
// trying to type).
//
// Enter with no input focused opens/focuses the box; Enter while
// focused sends the message and blurs back to gameplay (same two-step
// convention most multiplayer games use); Escape while focused blurs
// WITHOUT sending and without closing the whole panel -- chat itself
// stays visible "for the entire game," unlike hotbar/pageManager's
// Escape-closes-the-overlay panels.
//
// GM-only tab (real correction, 2026-10-21, second pass -- a prior
// attempt put this GM content in a separate floating overlay,
// gmPanel.ts; explicitly rejected: "don't just make everything a
// window... this should be a gm-only panel in the same space as chat,
// so it should be another tab... GM on means the tab appears, GM off
// means the tab disappears"). So: a SECOND tab, "GM", exists in the DOM
// (and the tab bar itself is shown) ONLY while GM mode is active
// (gmOverride.ts's own toggle, forwarded through game.ts's RunningGame.
// onGmActiveChange -- see main.ts's wiring) -- `setGmTabVisible(false)`
// removes the tab bar entirely and snaps back to the plain Chat view,
// not just disables/hides it. Content: the per-game mods list (enable/
// disable + a dirty-flagged "Reload this page" button, since no hot-
// reload exists) and the seeThroughWalls checkbox (blockShaders.ts's
// xray-cutout shader + cameraZoom.ts's real wall-collision clamp, both
// toggled together -- see game.ts's own wiring for why). Stays "noa-
// free, pure presentational" like the rest of this file -- data/actions
// are props and setXState() push-methods (mirrors addMessage's "push
// updated data in after mount" shape); main.ts owns the actual
// fetching/mutation/room-message sends.

import type { ChatMessage, ModManifest } from "./api.js";
import { requestCapture, releaseCapture } from "./inputCapture.js";
import { PERSISTENT_PANEL_Z_INDEX, SAFE_AREA_RIGHT_VAR, setSafeAreaInset } from "./panelLayout.js";

const MIN_WIDTH = 180;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 320;
const COLLAPSED_WIDTH = 28;

type ChatPanelTab = "chat" | "gm";

export interface ChatPanelOptions {
  initialMessages: ChatMessage[];
  onSend: (text: string) => void;
  /** Called right after the compose box gains or loses focus, so the caller can suspend/restore pointer-lock mouse-look (a noa concern, kept out of this file). */
  onFocusChange?: (focused: boolean) => void;
  /** Fired when the GM tab's Enable/Disable button is clicked -- main.ts owns the actual `enableGameMod`/`disableGameMod` REST call and feeds the real result back via `setModsState`. */
  onToggleMod: (modId: string, enable: boolean) => void;
  /** Fired by the GM tab's Reload button -- main.ts re-launches the player's own current world (no hot-reload exists, this is the real "pick up the new mod list" mechanism). */
  onReloadWorld: () => void;
  /** Fired by the GM tab's seeThroughWalls checkbox -- main.ts sends the admin-gated room message via the current RunningGame. */
  onSetSeeThroughWalls: (enabled: boolean) => void;
}

export interface ChatPanelController {
  addMessage(message: ChatMessage): void;
  showError(reason: string): void;
  /** Shows/hides the GM tab (and its whole tab bar) -- driven by gmOverride.ts's own toggle (GM on = true), not a separate hotkey. Hiding while the GM tab is the active one snaps back to Chat. */
  setGmTabVisible(visible: boolean): void;
  /** Pushes fresh mod data into the GM tab (initial fetch, and after every toggle's REST response) -- same "data arrives after mount" shape as addMessage. */
  setModsState(availableMods: ModManifest[], enabledModIds: string[]): void;
  /** Reflects the room's current seeThroughWalls value in the GM tab's checkbox (initial value, and any live change -- e.g. another admin toggled it). */
  setSeeThroughWallsState(enabled: boolean): void;
  /** Removes this panel's window-level key listener and releases its input capture if the compose box was left focused. Mirrors hotbar.ts's destroy() pattern. */
  destroy(): void;
}

function formatMessage(message: ChatMessage): string {
  return `${message.senderName}: ${message.text}`;
}

export function mountChatPanel(container: HTMLElement, options: ChatPanelOptions): ChatPanelController {
  container.innerHTML = `
    <style>
      /* z-index needed: this panel's container is created in main.ts
         BEFORE a game session's startGame() ever runs (so it survives
         page switches -- see main.ts's enterGame), which means noa's own
         canvas element is always a LATER DOM sibling appended on every
         page switch and would otherwise paint on top with no explicit
         z-index -- reproduced live as "no chat panel visible at all"
         (it was there, just hidden underneath the canvas). pageManager.ts
         needed the same fix for an unrelated reason (its own z-index:10)
         -- this is set higher since chat is meant to be the outermost,
         always-visible panel. */
      /* No CSS width here -- the panel's width is set inline via JS
         (applyWidth below), which is the single source of truth while
         expanded; .collapsed overrides it back down to a fixed tab
         width, cleared again on expand. */
      .chat-panel { position: fixed; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column; background: rgba(20,20,24,0.85); border-left: 2px solid rgba(200,200,200,0.4); font-family: system-ui, sans-serif; color: #eee; z-index: ${PERSISTENT_PANEL_Z_INDEX}; }
      .chat-panel.collapsed { width: ${COLLAPSED_WIDTH}px !important; }
      .chat-panel.collapsed .chat-body { display: none; }
      .chat-panel.collapsed .chat-resize-handle { display: none; }
      .chat-resize-handle { position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; cursor: ew-resize; }
      .chat-toggle { position: absolute; top: 8px; left: -24px; width: 24px; height: 32px; background: rgba(20,20,24,0.85); border: 2px solid rgba(200,200,200,0.4); border-right: none; border-radius: 4px 0 0 4px; cursor: pointer; color: #eee; font-size: 14px; display: flex; align-items: center; justify-content: center; }
      .chat-body { display: flex; flex-direction: column; height: 100%; min-width: 0; }
      /* Hidden by default -- only shown while the GM tab exists
         (setGmTabVisible(true)). With just one real tab (Chat), the
         bar itself is dead chrome, not just an inert second button. */
      .chat-tabs { display: none; flex: none; border-bottom: 1px solid rgba(200,200,200,0.3); }
      .chat-tabs.show { display: flex; }
      .chat-tab-btn { flex: 1; padding: 6px 4px; font-size: 12px; background: none; border: none; color: #999; cursor: pointer; border-bottom: 2px solid transparent; }
      .chat-tab-btn.active { color: #eee; border-bottom-color: rgb(255,217,51); }
      .chat-tab-pane { display: none; flex-direction: column; flex: 1 1 auto; min-height: 0; }
      .chat-tab-pane.active { display: flex; }
      /* Only the message list scrolls -- NOT the panel or document (the
         exact class of bug lobby.ts's own scroll fix already dealt with:
         index.html's html/body overflow:hidden would otherwise make any
         chat longer than one screen simply unreachable). */
      .chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 13px; line-height: 1.4; word-break: break-word; }
      .chat-messages .msg { margin-bottom: 4px; }
      .chat-messages .err { margin-bottom: 4px; color: #e66; font-style: italic; }
      .chat-input-row { flex: none; padding: 8px; border-top: 1px solid rgba(200,200,200,0.3); }
      .chat-input-row input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 13px; background: rgba(0,0,0,0.3); border: 1px solid rgba(200,200,200,0.4); border-radius: 4px; color: #eee; }
      .chat-gm-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 12px; }
      .chat-gm-body h3 { margin: 0 0 6px; font-size: 12px; font-weight: normal; color: #999; }
      .chat-gm-body label.checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 12px; }
      .mod-list { list-style: none; padding: 0; margin: 0 0 12px; }
      .mod-list li { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.06); border-radius: 4px; }
      .mod-list .mod-meta { color: #999; font-size: 0.85em; margin-left: 6px; }
      .mod-list button, .chat-reload-btn { font-size: 12px; padding: 4px 8px; }
      .chat-reload-btn { width: 100%; padding: 8px; font-size: 13px; }
      /* "Foolproof" (explicit request): neutral/disabled until a mod is
         actually toggled, then obviously flagged -- not a subtle hint
         someone could miss, since there's no hot-reload to fall back on. */
      .chat-reload-btn.dirty { background: rgb(255,217,51); color: #222; font-weight: bold; border-color: rgb(255,217,51); }
    </style>
    <div class="chat-panel" id="chat-panel">
      <div class="chat-resize-handle" id="chat-resize-handle" title="Drag to resize"></div>
      <button class="chat-toggle" id="chat-toggle" type="button" title="Collapse/expand chat">&raquo;</button>
      <div class="chat-body">
        <div class="chat-tabs" id="chat-tabs">
          <button class="chat-tab-btn active" id="chat-tab-chat-btn" type="button">Chat</button>
          <button class="chat-tab-btn" id="chat-tab-gm-btn" type="button">GM</button>
        </div>
        <div class="chat-tab-pane active" id="chat-tab-chat">
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-row">
            <input id="chat-input" type="text" placeholder="Press Enter to chat..." />
          </div>
        </div>
        <div class="chat-tab-pane" id="chat-tab-gm">
          <div class="chat-gm-body">
            <label class="checkbox-row">
              <input type="checkbox" id="chat-see-through-walls" />
              Players can see through walls (third-person camera)
            </label>
            <h3>Mods for this game</h3>
            <ul class="mod-list" id="mod-list"></ul>
            <button class="chat-reload-btn" id="chat-reload-btn" type="button" disabled title="Reload your current page to pick up mod changes (no hot-reload)">Reload this page</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const panel = container.querySelector<HTMLDivElement>("#chat-panel")!;
  const toggle = container.querySelector<HTMLButtonElement>("#chat-toggle")!;
  const resizeHandle = container.querySelector<HTMLDivElement>("#chat-resize-handle")!;
  const messagesEl = container.querySelector<HTMLDivElement>("#chat-messages")!;
  const input = container.querySelector<HTMLInputElement>("#chat-input")!;
  const tabsEl = container.querySelector<HTMLDivElement>("#chat-tabs")!;
  const chatTabBtn = container.querySelector<HTMLButtonElement>("#chat-tab-chat-btn")!;
  const gmTabBtn = container.querySelector<HTMLButtonElement>("#chat-tab-gm-btn")!;
  const chatTabPane = container.querySelector<HTMLDivElement>("#chat-tab-chat")!;
  const gmTabPane = container.querySelector<HTMLDivElement>("#chat-tab-gm")!;
  const seeThroughWallsCheckbox = container.querySelector<HTMLInputElement>("#chat-see-through-walls")!;
  const modListEl = container.querySelector<HTMLUListElement>("#mod-list")!;
  const reloadBtn = container.querySelector<HTMLButtonElement>("#chat-reload-btn")!;

  let collapsed = false;
  let currentWidth = DEFAULT_WIDTH;
  let activeTab: ChatPanelTab = "chat";
  let availableMods: ModManifest[] = [];
  let enabledModIds: string[] = [];

  function setActiveTab(tab: ChatPanelTab): void {
    activeTab = tab;
    chatTabBtn.classList.toggle("active", tab === "chat");
    gmTabBtn.classList.toggle("active", tab === "gm");
    chatTabPane.classList.toggle("active", tab === "chat");
    gmTabPane.classList.toggle("active", tab === "gm");
  }
  chatTabBtn.addEventListener("click", () => setActiveTab("chat"));
  gmTabBtn.addEventListener("click", () => setActiveTab("gm"));

  function renderModsList(): void {
    modListEl.innerHTML = availableMods
      .map((m) => {
        const isEnabled = enabledModIds.includes(m.id);
        return `<li><span>${m.name}<span class="mod-meta">v${m.version}</span></span><button class="mod-toggle-btn" type="button" data-mod-id="${m.id}" data-enabled="${isEnabled}">${isEnabled ? "Disable" : "Enable"}</button></li>`;
      })
      .join("");
  }

  function setReloadDirty(dirty: boolean): void {
    reloadBtn.disabled = !dirty;
    reloadBtn.classList.toggle("dirty", dirty);
    reloadBtn.textContent = dirty ? "Mods changed -- reload this page now" : "Reload this page";
  }

  modListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".mod-toggle-btn");
    if (!button) return;
    const modId = button.dataset.modId!;
    const enable = button.dataset.enabled !== "true";
    options.onToggleMod(modId, enable);
    setReloadDirty(true);
  });

  reloadBtn.addEventListener("click", () => {
    setReloadDirty(false);
    options.onReloadWorld();
  });

  seeThroughWallsCheckbox.addEventListener("change", () => {
    options.onSetSeeThroughWalls(seeThroughWallsCheckbox.checked);
  });

  function applyWidth(width: number): void {
    currentWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    panel.style.width = `${currentWidth}px`;
    setSafeAreaInset(SAFE_AREA_RIGHT_VAR, currentWidth);
  }
  applyWidth(DEFAULT_WIDTH);

  function appendLine(text: string, className: string): void {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    messagesEl.appendChild(line);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  for (const message of options.initialMessages) appendLine(formatMessage(message), "msg");

  function setFocused(focused: boolean): void {
    if (focused) requestCapture("chat");
    else releaseCapture("chat");
    options.onFocusChange?.(focused);
  }

  function sendAndBlur(): void {
    const text = input.value.trim();
    input.value = "";
    if (text) options.onSend(text);
    input.blur();
  }

  input.addEventListener("focus", () => setFocused(true));
  input.addEventListener("blur", () => setFocused(false));
  input.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      sendAndBlur();
    } else if (event.code === "Escape") {
      event.preventDefault();
      input.value = "";
      input.blur();
    }
    // Every other key is left to type normally -- global shortcuts
    // (inventory, page manager, etc.) are guarded by isCaptured() at
    // THEIR end, not suppressed here.
  });

  function setCollapsed(next: boolean): void {
    collapsed = next;
    panel.classList.toggle("collapsed", collapsed);
    toggle.textContent = collapsed ? "«" : "»";
    // .collapsed's CSS width (!important) wins regardless, but clearing
    // the inline width while collapsed keeps applyWidth's own state
    // (currentWidth) as the single thing to restore from on expand,
    // rather than two competing numbers.
    panel.style.width = collapsed ? "" : `${currentWidth}px`;
    // Keep the CSS var honest about the panel's ACTUAL current edge
    // regardless of collapse state, for quickActionsPanel.ts/
    // partyListPanel.ts's own width math.
    setSafeAreaInset(SAFE_AREA_RIGHT_VAR, collapsed ? COLLAPSED_WIDTH : currentWidth);
  }
  toggle.addEventListener("click", () => setCollapsed(!collapsed));

  // Drag-to-resize: a thin handle on the panel's left edge (right-docked
  // panel, so dragging the handle LEFT -- away from the screen edge --
  // should grow it). Real user correction: an earlier version only had
  // the collapse toggle above, cycling between two fixed sizes, which
  // wasn't what was wanted -- this is continuous, not click-through-presets.
  let dragging = false;
  let dragStartX = 0;
  let dragStartWidth = DEFAULT_WIDTH;

  function onHandlePointerDown(event: PointerEvent): void {
    if (collapsed) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartWidth = currentWidth;
    event.preventDefault();
  }
  function onWindowPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    applyWidth(dragStartWidth + (dragStartX - event.clientX));
  }
  function onWindowPointerUp(): void {
    dragging = false;
  }
  resizeHandle.addEventListener("pointerdown", onHandlePointerDown);
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);

  function onWindowKeydown(event: KeyboardEvent): void {
    // Guard against ANY other text field being focused (e.g. pageManager's
    // create-world name input) -- Enter there should submit/behave
    // normally, not get hijacked into focusing chat instead.
    const active = document.activeElement;
    const otherInputFocused = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (otherInputFocused) return;
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      if (collapsed) setCollapsed(false);
      setActiveTab("chat"); // switch back if the GM tab was open -- Enter's whole point is to type a message
      input.focus();
    }
  }
  window.addEventListener("keydown", onWindowKeydown);

  return {
    addMessage(message) {
      appendLine(formatMessage(message), "msg");
    },
    showError(reason) {
      appendLine(reason, "err");
    },
    setGmTabVisible(visible) {
      tabsEl.classList.toggle("show", visible);
      if (visible) {
        // Real request: "GM on means the tab appears" -- jump straight
        // to it rather than leaving the GM to notice a new tab exists.
        setActiveTab("gm");
      } else if (activeTab === "gm") {
        setActiveTab("chat");
      }
    },
    setModsState(nextAvailableMods, nextEnabledModIds) {
      availableMods = nextAvailableMods;
      enabledModIds = nextEnabledModIds;
      renderModsList();
    },
    setSeeThroughWallsState(enabled) {
      seeThroughWallsCheckbox.checked = enabled;
    },
    destroy() {
      window.removeEventListener("keydown", onWindowKeydown);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      if (document.activeElement === input) releaseCapture("chat");
    },
  };
}

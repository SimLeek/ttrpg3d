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

import type { ChatMessage } from "./api.js";
import { requestCapture, releaseCapture } from "./inputCapture.js";

export interface ChatPanelOptions {
  initialMessages: ChatMessage[];
  onSend: (text: string) => void;
  /** Called right after the compose box gains or loses focus, so the caller can suspend/restore pointer-lock mouse-look (a noa concern, kept out of this file). */
  onFocusChange?: (focused: boolean) => void;
}

export interface ChatPanelController {
  addMessage(message: ChatMessage): void;
  showError(reason: string): void;
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
      .chat-panel { position: fixed; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column; background: rgba(20,20,24,0.85); border-left: 2px solid rgba(200,200,200,0.4); font-family: system-ui, sans-serif; color: #eee; z-index: 50; }
      .chat-panel.collapsed { width: 28px !important; }
      .chat-panel.collapsed .chat-body { display: none; }
      .chat-panel.collapsed .chat-resize-handle { display: none; }
      .chat-resize-handle { position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; cursor: ew-resize; }
      .chat-toggle { position: absolute; top: 8px; left: -24px; width: 24px; height: 32px; background: rgba(20,20,24,0.85); border: 2px solid rgba(200,200,200,0.4); border-right: none; border-radius: 4px 0 0 4px; cursor: pointer; color: #eee; font-size: 14px; display: flex; align-items: center; justify-content: center; }
      .chat-body { display: flex; flex-direction: column; height: 100%; min-width: 0; }
      /* Only the message list scrolls -- NOT the panel or document (the
         exact class of bug lobby.ts's own scroll fix already dealt with:
         index.html's html/body overflow:hidden would otherwise make any
         chat longer than one screen simply unreachable). */
      .chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 13px; line-height: 1.4; word-break: break-word; }
      .chat-messages .msg { margin-bottom: 4px; }
      .chat-messages .err { margin-bottom: 4px; color: #e66; font-style: italic; }
      .chat-input-row { flex: none; padding: 8px; border-top: 1px solid rgba(200,200,200,0.3); }
      .chat-input-row input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 13px; background: rgba(0,0,0,0.3); border: 1px solid rgba(200,200,200,0.4); border-radius: 4px; color: #eee; }
    </style>
    <div class="chat-panel" id="chat-panel">
      <div class="chat-resize-handle" id="chat-resize-handle" title="Drag to resize"></div>
      <button class="chat-toggle" id="chat-toggle" type="button" title="Collapse/expand chat">&raquo;</button>
      <div class="chat-body">
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-row">
          <input id="chat-input" type="text" placeholder="Press Enter to chat..." />
        </div>
      </div>
    </div>
  `;

  const panel = container.querySelector<HTMLDivElement>("#chat-panel")!;
  const toggle = container.querySelector<HTMLButtonElement>("#chat-toggle")!;
  const resizeHandle = container.querySelector<HTMLDivElement>("#chat-resize-handle")!;
  const messagesEl = container.querySelector<HTMLDivElement>("#chat-messages")!;
  const input = container.querySelector<HTMLInputElement>("#chat-input")!;

  const MIN_WIDTH = 180;
  const MAX_WIDTH = 640;
  const DEFAULT_WIDTH = 320;

  let collapsed = false;
  let currentWidth = DEFAULT_WIDTH;

  function applyWidth(width: number): void {
    currentWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    panel.style.width = `${currentWidth}px`;
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
    if ((event.code === "Enter" || event.code === "NumpadEnter") && !otherInputFocused) {
      event.preventDefault();
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
    destroy() {
      window.removeEventListener("keydown", onWindowKeydown);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      if (document.activeElement === input) releaseCapture("chat");
    },
  };
}

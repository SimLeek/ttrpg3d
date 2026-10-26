// MVP goal item 4 -- a LOCAL, non-connected test-chat panel for the
// standalone characters page. Real request: "an example chat panel to
// the right so that things that you would click to roll, like spells
// or attacks, would appear in that chat for testing." No WebSocket/
// room connection -- messages arrive either via `addMessage` (clicking
// a sheet's chat-chip) or, round 4, the panel's own compose box
// ("the ability to enter text and press send so that can be tested as
// well... little change since it does little now but it would be
// useful later"). Visually mirrors chatPanel.ts's own message-list/
// input styling for familiarity, but embedded inline as a plain
// column (not `position: fixed`/draggable/collapsible like that file
// -- this is one column within the characters page's own layout, not
// a persistent overlay across the whole app).
//
// Real request, 2026-10-26: "Hopefully the chat supports some html
// and alt text" -- "when moused over that special 22 should display
// the formula behind it." This panel is the right place for it: it's
// LOCAL-only (no other player ever sees it, unlike the real in-game
// chat -- chatPanel.ts/GameRoom.ts -- which still only ever receives
// plain text; giving THAT one the same tooltip/table treatment safely
// for multiplayer is a real, separate follow-up, not done here).
// `addMessage`'s own optional `html` is sanitized (DOMPurify) right
// before insertion, same "ONE deliberate innerHTML-of-untrusted-
// content spot" discipline characterSheetView.ts's own page rendering
// already follows -- the PLAIN `text` form (used for every message
// this panel ALREADY rendered before this feature, including the
// compose box's own human-typed input) stays on the existing,
// unconditionally-safe `textContent` path.

import DOMPurify from "dompurify";

export interface TestChatPanelController {
  addMessage(text: string, html?: string): void;
}

export function mountTestChatPanel(container: HTMLElement): TestChatPanelController {
  container.innerHTML = `
    <style>
      .test-chat-panel { display: flex; flex-direction: column; height: 100%; background: rgba(20,20,24,0.85); border: 1px solid rgba(200,200,200,0.3); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; }
      .test-chat-panel h3 { margin: 0; padding: 8px 10px; font-size: 0.9rem; font-weight: normal; color: #999; border-bottom: 1px solid rgba(200,200,200,0.3); flex: none; }
      .test-chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 13px; line-height: 1.4; word-break: break-word; }
      .test-chat-messages .msg { margin-bottom: 4px; }
      .test-chat-messages .empty { color: #777; font-style: italic; }
      .test-chat-messages .roll-result { font-weight: bold; text-decoration: underline dotted; cursor: help; }
      .test-chat-messages .roll-result-group { background: rgba(255,255,255,0.06); border-radius: 4px; padding: 6px 8px; margin: 2px 0; }
      .test-chat-compose { flex: none; display: flex; gap: 6px; padding: 8px; border-top: 1px solid rgba(200,200,200,0.3); }
      .test-chat-compose input { flex: 1 1 auto; min-width: 0; padding: 6px 8px; font-size: 13px; background: rgba(0,0,0,0.3); border: 1px solid rgba(200,200,200,0.4); border-radius: 4px; color: #eee; }
      .test-chat-compose button { font-size: 13px; padding: 6px 10px; }
    </style>
    <div class="test-chat-panel">
      <h3>Test chat</h3>
      <div class="test-chat-messages" id="test-chat-messages"><div class="empty">Click a chat-chip on the sheet, or type a message below, to see it here.</div></div>
      <div class="test-chat-compose">
        <input id="test-chat-input" type="text" placeholder="Type a message..." />
        <button id="test-chat-send-btn" type="button">Send</button>
      </div>
    </div>
  `;

  const messagesEl = container.querySelector<HTMLDivElement>("#test-chat-messages")!;
  const input = container.querySelector<HTMLInputElement>("#test-chat-input")!;
  const sendBtn = container.querySelector<HTMLButtonElement>("#test-chat-send-btn")!;
  let hasMessages = false;

  function addMessage(text: string, html?: string): void {
    if (!hasMessages) {
      messagesEl.innerHTML = "";
      hasMessages = true;
    }
    const line = document.createElement("div");
    line.className = "msg";
    if (html !== undefined) line.innerHTML = DOMPurify.sanitize(html);
    else line.textContent = text;
    messagesEl.appendChild(line);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function sendFromInput(): void {
    const text = input.value.trim();
    if (!text) return;
    addMessage(text);
    input.value = "";
  }

  sendBtn.addEventListener("click", sendFromInput);
  input.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      sendFromInput();
    }
  });

  return { addMessage };
}

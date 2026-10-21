// MVP goal item 4, round 3 -- a LOCAL, non-connected test-chat panel
// for the standalone characters page. Real request: "an example chat
// panel to the right so that things that you would click to roll,
// like spells or attacks, would appear in that chat for testing."
// Deliberately not a real chat: no WebSocket/room connection, no
// compose box -- there's nothing to type here, messages only ever
// arrive via `addMessage` (characters.ts calls it when a page's
// "roll chip" button is clicked). Visually mirrors chatPanel.ts's own
// message-list styling for familiarity, but embedded inline as a
// plain column (not `position: fixed`/draggable/collapsible like that
// file -- this is one column within the characters page's own layout,
// not a persistent overlay across the whole app).

export interface TestChatPanelController {
  addMessage(text: string): void;
}

export function mountTestChatPanel(container: HTMLElement): TestChatPanelController {
  container.innerHTML = `
    <style>
      .test-chat-panel { display: flex; flex-direction: column; height: 100%; background: rgba(20,20,24,0.85); border: 1px solid rgba(200,200,200,0.3); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; }
      .test-chat-panel h3 { margin: 0; padding: 8px 10px; font-size: 0.9rem; font-weight: normal; color: #999; border-bottom: 1px solid rgba(200,200,200,0.3); flex: none; }
      .test-chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 13px; line-height: 1.4; word-break: break-word; }
      .test-chat-messages .msg { margin-bottom: 4px; }
      .test-chat-messages .empty { color: #777; font-style: italic; }
    </style>
    <div class="test-chat-panel">
      <h3>Test chat (local only -- not connected to any game)</h3>
      <div class="test-chat-messages" id="test-chat-messages"><div class="empty">Click a roll chip on the sheet to see it here.</div></div>
    </div>
  `;

  const messagesEl = container.querySelector<HTMLDivElement>("#test-chat-messages")!;
  let hasMessages = false;

  return {
    addMessage(text: string): void {
      if (!hasMessages) {
        messagesEl.innerHTML = "";
        hasMessages = true;
      }
      const line = document.createElement("div");
      line.className = "msg";
      line.textContent = text;
      messagesEl.appendChild(line);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
  };
}

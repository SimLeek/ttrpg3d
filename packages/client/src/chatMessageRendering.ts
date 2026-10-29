// Real request, 2026-10-29: "the chat in the main game doesn't seem
// to allow the same tables and formatting as test chat and they
// should be exactly the same, so if there is any code duplication,
// eliminate it and merge any functions, prefer test chat since it's
// more advanced." Both chatPanel.ts (the real in-game chat) and
// testChatPanel.ts (the /characters page's own local test chat) used
// to each hand-roll their own near-identical "append one message
// line" function -- testChatPanel's own version was the richer of the
// two (it alone supported an optional sanitized `html` rendering,
// used by a compound-roll's own breakdown table and an ability's own
// info table). This is that ONE function now, used by both.

import DOMPurify from "dompurify";

/**
 * Appends one message line to `container` -- `html` (DOMPurify-
 * sanitized immediately before `innerHTML`, same ONE deliberate
 * innerHTML-of-untrusted-content spot characterSheetView.ts's own
 * header comment already documents) wins when present; otherwise
 * plain `textContent`. Scrolls the container to the new bottom either
 * way.
 */
export function appendChatLine(container: HTMLElement, text: string, className: string, html?: string): void {
  const line = document.createElement("div");
  line.className = className;
  if (html !== undefined) line.innerHTML = DOMPurify.sanitize(html);
  else line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

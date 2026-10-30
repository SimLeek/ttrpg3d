import { describe, it, expect, beforeEach } from "vitest";
import { mountTestChatPanel } from "./testChatPanel.js";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

function dispatchKey(el: Element, code: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

describe("mountTestChatPanel", () => {
  it("shows an empty-state message until the first message, and never shows the removed 'local only' header text", () => {
    mountTestChatPanel(container);
    expect(container.querySelector(".empty")).not.toBeNull();
    expect(container.querySelector(".test-chat-panel")!.textContent).not.toContain("not connected to any game");
  });

  it("addMessage (e.g. a chat-chip click) appends messages in order and clears the empty state", () => {
    const panel = mountTestChatPanel(container);
    panel.addMessage("Aria: Strength modifier -> 3");
    expect(container.querySelector(".empty")).toBeNull();
    panel.addMessage("Aria: Attack -> 7");

    const lines = Array.from(container.querySelectorAll(".msg")).map((el) => el.textContent);
    expect(lines).toEqual(["Aria: Strength modifier -> 3", "Aria: Attack -> 7"]);
  });

  it("the compose box: clicking Send appends the typed text and clears the input", () => {
    mountTestChatPanel(container);
    const input = container.querySelector<HTMLInputElement>("#test-chat-input")!;
    input.value = "hello";
    container.querySelector<HTMLButtonElement>("#test-chat-send-btn")!.click();

    expect(container.querySelector(".msg")!.textContent).toBe("hello");
    expect(input.value).toBe("");
  });

  it("the compose box: pressing Enter also sends, and an empty/whitespace-only message doesn't send", () => {
    mountTestChatPanel(container);
    const input = container.querySelector<HTMLInputElement>("#test-chat-input")!;

    input.value = "  ";
    dispatchKey(input, "Enter");
    expect(container.querySelector(".msg")).toBeNull();

    input.value = "via enter";
    dispatchKey(input, "Enter");
    expect(container.querySelector(".msg")!.textContent).toBe("via enter");
  });

  it("real request, 2026-10-26 -- addMessage's optional html renders as SANITIZED innerHTML (a tooltip span survives), not the plain text fallback", () => {
    const panel = mountTestChatPanel(container);
    panel.addMessage("Aria: Save Bonus -> 22", 'Aria: Save Bonus: <span class="roll-result" title="1d20 + 5: [17]+5 = 22">22</span>');

    const line = container.querySelector(".msg")!;
    const span = line.querySelector<HTMLElement>(".roll-result")!;
    expect(span).not.toBeNull();
    expect(span.title).toBe("1d20 + 5: [17]+5 = 22");
    expect(span.textContent).toBe("22");
  });

  it("a message with NO html still renders as plain escaped text -- a dangerous-looking compose-box message never executes as HTML", () => {
    const panel = mountTestChatPanel(container);
    panel.addMessage('<img src=x onerror="window.__pwned = true">');

    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(container.querySelector(".msg")!.textContent).toBe('<img src=x onerror="window.__pwned = true">');
    expect(container.querySelector(".msg img")).toBeNull();
  });

  it("html IS sanitized -- a dangerous tag/attribute smuggled into a roll's own html is stripped, not executed", () => {
    const panel = mountTestChatPanel(container);
    panel.addMessage("plain fallback", '<span onclick="window.__pwned = true">22</span><script>window.__pwned = true</script>');

    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    const line = container.querySelector(".msg")!;
    expect(line.querySelector("script")).toBeNull();
    expect(line.querySelector("span")!.getAttribute("onclick")).toBeNull();
    expect(line.textContent).toBe("22");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountChatPanel, type ChatPanelController, type ChatPanelOptions } from "./chatPanel.js";
import type { ChatMessage } from "./api.js";

function msg(senderName: string, text: string, id = 1): ChatMessage {
  return { id, senderName, text, createdAt: 0 };
}

function dispatchKeyOn(el: Element, code: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

let container: HTMLElement;
let activePanel: ChatPanelController | null = null;

// mountChatPanel attaches a window-level keydown listener -- track and
// destroy() whatever each test mounts, same discipline hotbar.test.ts
// already uses, so listeners don't pile up across tests sharing the same
// jsdom `window`.
function mount(options: Partial<ChatPanelOptions> & Pick<ChatPanelOptions, "initialMessages" | "onSend">): ChatPanelController {
  activePanel = mountChatPanel(container, options as ChatPanelOptions);
  return activePanel;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  activePanel?.destroy();
  activePanel = null;
});

describe("mountChatPanel", () => {
  it("renders the initial message history on mount", () => {
    mount({ initialMessages: [msg("Alice", "hi there")], onSend: vi.fn() });
    expect(container.querySelector(".chat-messages")!.textContent).toContain("Alice: hi there");
  });

  it("addMessage appends a new line without clearing existing history", () => {
    const panel = mount({ initialMessages: [msg("Alice", "first")], onSend: vi.fn() });
    panel.addMessage(msg("Bob", "second", 2));
    const text = container.querySelector(".chat-messages")!.textContent;
    expect(text).toContain("Alice: first");
    expect(text).toContain("Bob: second");
  });

  it("showError renders the reason as its own line", () => {
    const panel = mount({ initialMessages: [], onSend: vi.fn() });
    panel.showError("invalid dice notation: garbage");
    expect(container.querySelector(".chat-messages")!.textContent).toContain("invalid dice notation: garbage");
  });

  it("typing a message and pressing Enter sends the trimmed text and clears the input", () => {
    const onSend = vi.fn();
    mount({ initialMessages: [], onSend });
    const input = container.querySelector<HTMLInputElement>("#chat-input")!;
    input.focus();
    input.value = "  hello world  ";
    dispatchKeyOn(input, "Enter");
    expect(onSend).toHaveBeenCalledWith("hello world");
    expect(input.value).toBe("");
  });

  it("pressing Enter with an empty input does not call onSend", () => {
    const onSend = vi.fn();
    mount({ initialMessages: [], onSend });
    const input = container.querySelector<HTMLInputElement>("#chat-input")!;
    input.focus();
    dispatchKeyOn(input, "Enter");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("pressing Escape while composing clears the input and does not send", () => {
    const onSend = vi.fn();
    mount({ initialMessages: [], onSend });
    const input = container.querySelector<HTMLInputElement>("#chat-input")!;
    input.focus();
    input.value = "never sent";
    dispatchKeyOn(input, "Escape");
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("calls onFocusChange(true) on focus and onFocusChange(false) on blur", () => {
    const onFocusChange = vi.fn();
    mount({ initialMessages: [], onSend: vi.fn(), onFocusChange });
    const input = container.querySelector<HTMLInputElement>("#chat-input")!;
    input.dispatchEvent(new FocusEvent("focus"));
    expect(onFocusChange).toHaveBeenLastCalledWith(true);
    input.dispatchEvent(new FocusEvent("blur"));
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
  });

  it("the toggle button collapses and expands the panel", () => {
    mount({ initialMessages: [], onSend: vi.fn() });
    const panelEl = container.querySelector<HTMLDivElement>("#chat-panel")!;
    const toggle = container.querySelector<HTMLButtonElement>("#chat-toggle")!;
    expect(panelEl.classList.contains("collapsed")).toBe(false);
    toggle.click();
    expect(panelEl.classList.contains("collapsed")).toBe(true);
    toggle.click();
    expect(panelEl.classList.contains("collapsed")).toBe(false);
  });

  it("dragging the resize handle changes the panel's width (dragging left grows it, right-docked)", () => {
    mount({ initialMessages: [], onSend: vi.fn() });
    const panelEl = container.querySelector<HTMLDivElement>("#chat-panel")!;
    const handle = container.querySelector<HTMLDivElement>("#chat-resize-handle")!;
    const startWidth = parseInt(panelEl.style.width, 10);

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400 })); // moved 100px left -> grows by 100
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(parseInt(panelEl.style.width, 10)).toBe(startWidth + 100);
  });

  it("the resize width is clamped to a sane minimum and maximum", () => {
    mount({ initialMessages: [], onSend: vi.fn() });
    const panelEl = container.querySelector<HTMLDivElement>("#chat-panel")!;
    const handle = container.querySelector<HTMLDivElement>("#chat-resize-handle")!;

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 1000, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 5000 })); // way past the minimum
    expect(parseInt(panelEl.style.width, 10)).toBeGreaterThanOrEqual(150);

    window.dispatchEvent(new PointerEvent("pointermove", { clientX: -5000 })); // way past the maximum
    expect(parseInt(panelEl.style.width, 10)).toBeLessThanOrEqual(700);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("collapsing remembers the dragged width and restores it on expand", () => {
    mount({ initialMessages: [], onSend: vi.fn() });
    const panelEl = container.querySelector<HTMLDivElement>("#chat-panel")!;
    const handle = container.querySelector<HTMLDivElement>("#chat-resize-handle")!;
    const toggle = container.querySelector<HTMLButtonElement>("#chat-toggle")!;

    handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 350 })); // grow by 150
    window.dispatchEvent(new PointerEvent("pointerup"));
    const resizedWidth = parseInt(panelEl.style.width, 10);

    toggle.click(); // collapse
    toggle.click(); // expand
    expect(parseInt(panelEl.style.width, 10)).toBe(resizedWidth);
  });

  it("a global Enter press focuses the chat input when nothing else is focused", () => {
    mount({ initialMessages: [], onSend: vi.fn() });
    const input = container.querySelector<HTMLInputElement>("#chat-input")!;
    expect(document.activeElement).not.toBe(input);
    dispatchKeyOn(window.document.body, "Enter");
    expect(document.activeElement).toBe(input);
  });

  it("a global Enter press does NOT steal focus away from a different already-focused text input", () => {
    mount({ initialMessages: [], onSend: vi.fn() });
    const otherInput = document.createElement("input");
    document.body.appendChild(otherInput);
    otherInput.focus();
    dispatchKeyOn(otherInput, "Enter");
    expect(document.activeElement).toBe(otherInput);
    otherInput.remove();
  });
});

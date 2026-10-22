import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountChatPanel, CHARACTER_DRAG_MIME, type ChatPanelController, type ChatPanelOptions } from "./chatPanel.js";
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
// jsdom `window`. onToggleMod/onReloadWorld/onSetSeeThroughWalls default
// to no-ops so every pre-existing test (which predates the GM tab)
// doesn't need to pass them explicitly -- tests that actually exercise
// the tab override them.
function mount(options: Partial<ChatPanelOptions> & Pick<ChatPanelOptions, "initialMessages" | "onSend">): ChatPanelController {
  activePanel = mountChatPanel(container, {
    onToggleMod: vi.fn(),
    onReloadWorld: vi.fn(),
    onSetSeeThroughWalls: vi.fn(),
    onOpenCharacter: vi.fn(),
    onLinkCharacter: vi.fn(),
    onUnlinkCharacter: vi.fn(),
    onUpdateCharacterLink: vi.fn(),
    onDeleteCharacter: vi.fn(),
    ...options,
  });
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

  it("typing a message and pressing Enter sends the trimmed text (as the default 'my username', null) and clears the input", () => {
    const onSend = vi.fn();
    mount({ initialMessages: [], onSend });
    const input = container.querySelector<HTMLInputElement>("#chat-input")!;
    input.focus();
    input.value = "  hello world  ";
    dispatchKeyOn(input, "Enter");
    expect(onSend).toHaveBeenCalledWith("hello world", null);
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

describe("mountChatPanel's GM tab (MVP goal item 3, docs/ROADMAP.md)", () => {
  it("the tab bar itself is always visible (Chat + Characters are always real tabs); the GM button is hidden until setGmTabVisible(true), becoming visible switches straight to the GM tab, becoming hidden again snaps back to Chat", () => {
    const panel = mount({ initialMessages: [], onSend: vi.fn() });
    const gmTabBtn = container.querySelector<HTMLButtonElement>("#chat-tab-gm-btn")!;
    expect(gmTabBtn.classList.contains("hidden")).toBe(true);
    expect(container.querySelector("#chat-tab-chat")!.classList.contains("active")).toBe(true);

    panel.setGmTabVisible(true);
    expect(gmTabBtn.classList.contains("hidden")).toBe(false);
    expect(container.querySelector("#chat-tab-gm")!.classList.contains("active")).toBe(true);
    expect(container.querySelector("#chat-tab-chat")!.classList.contains("active")).toBe(false);

    panel.setGmTabVisible(false);
    expect(gmTabBtn.classList.contains("hidden")).toBe(true);
    expect(container.querySelector("#chat-tab-chat")!.classList.contains("active")).toBe(true);
  });

  it("clicking between Chat and GM tabs switches panes while both are visible", () => {
    const panel = mount({ initialMessages: [], onSend: vi.fn() });
    panel.setGmTabVisible(true);

    container.querySelector<HTMLButtonElement>("#chat-tab-chat-btn")!.click();
    expect(container.querySelector("#chat-tab-chat")!.classList.contains("active")).toBe(true);

    container.querySelector<HTMLButtonElement>("#chat-tab-gm-btn")!.click();
    expect(container.querySelector("#chat-tab-gm")!.classList.contains("active")).toBe(true);
  });

  it("setModsState renders each available mod with its current enabled state", () => {
    const panel = mount({ initialMessages: [], onSend: vi.fn() });
    panel.setModsState(
      [
        { id: "mod-a", name: "Mod A", version: "1.0.0", entry: "entry.ts" },
        { id: "mod-b", name: "Mod B", version: "2.0.0", entry: "entry.ts" },
      ],
      ["mod-a"],
    );
    const items = container.querySelectorAll<HTMLLIElement>(".mod-list li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Mod A");
    expect(items[0].querySelector<HTMLButtonElement>(".mod-toggle-btn")!.textContent).toBe("Disable");
    expect(items[1].querySelector<HTMLButtonElement>(".mod-toggle-btn")!.textContent).toBe("Enable");
  });

  it("clicking a mod's toggle button calls onToggleMod with the right args and flags the Reload button as dirty", () => {
    const onToggleMod = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onToggleMod });
    panel.setModsState([{ id: "mod-a", name: "Mod A", version: "1.0.0", entry: "entry.ts" }], []);

    const reloadBtn = container.querySelector<HTMLButtonElement>("#chat-reload-btn")!;
    expect(reloadBtn.disabled).toBe(true);

    container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.click();
    expect(onToggleMod).toHaveBeenCalledWith("mod-a", true);
    expect(reloadBtn.disabled).toBe(false);
    expect(reloadBtn.classList.contains("dirty")).toBe(true);
  });

  it("clicking Reload calls onReloadWorld and clears the dirty state", () => {
    const onReloadWorld = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onReloadWorld });
    panel.setModsState([{ id: "mod-a", name: "Mod A", version: "1.0.0", entry: "entry.ts" }], []);
    container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.click(); // dirty it first

    const reloadBtn = container.querySelector<HTMLButtonElement>("#chat-reload-btn")!;
    reloadBtn.click();
    expect(onReloadWorld).toHaveBeenCalled();
    expect(reloadBtn.disabled).toBe(true);
    expect(reloadBtn.classList.contains("dirty")).toBe(false);
  });

  it("setSeeThroughWallsState reflects the current value, and toggling the checkbox calls onSetSeeThroughWalls", () => {
    const onSetSeeThroughWalls = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onSetSeeThroughWalls });
    panel.setSeeThroughWallsState(false);

    const checkbox = container.querySelector<HTMLInputElement>("#chat-see-through-walls")!;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(onSetSeeThroughWalls).toHaveBeenCalledWith(true);
  });
});

describe("mountChatPanel's Characters tab + compose-row 'post as' dropdown (MVP goal item 4 follow-up)", () => {
  const link = (characterId: string, name: string, ownerAccountId: string, visibility: "all" | string[] = "all", folder: string | null = null) => ({
    link: { id: `link-${characterId}`, gameId: "g1", characterId, folder, visibility },
    character: { id: characterId, name, token: { color: [1, 0, 0] as [number, number, number] }, ownerAccountId },
  });

  it("the compose dropdown offers every visible character plus the default 'My username', and onSend carries whichever is selected", () => {
    const onSend = vi.fn();
    const panel = mount({ initialMessages: [], onSend });
    panel.setCharactersState([link("c1", "Thrain", "me")], [], [{ id: "c1", name: "Thrain" }], "me", false, null);

    const select = container.querySelector<HTMLSelectElement>("#chat-send-as")!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["My username", "Thrain"]);

    select.value = "c1";
    const input = container.querySelector<HTMLInputElement>("#chat-input")!;
    input.focus();
    input.value = "I attack!";
    dispatchKeyOn(input, "Enter");
    expect(onSend).toHaveBeenCalledWith("I attack!", "c1");
  });

  it("renders characters grouped by folder, with an '(no folder)' bucket for null, and clicking a row calls onOpenCharacter", () => {
    const onOpenCharacter = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onOpenCharacter });
    panel.setCharactersState([link("c1", "Thrain", "me", "all", "NPCs"), link("c2", "Bram", "me", "all", null)], [], [], "me", false, null);

    const groups = container.querySelectorAll(".character-folder-group h4");
    expect(Array.from(groups).map((g) => g.textContent)).toEqual(["NPCs", "(no folder)"]);

    container.querySelector<HTMLButtonElement>(".open-character-btn[data-character-id='c1']")!.click();
    expect(onOpenCharacter).toHaveBeenCalledWith("c1");
  });

  it("shows folder/visibility/unlink controls on the viewer's OWN character, but not on someone else's, unless isAdmin", () => {
    const panel = mount({ initialMessages: [], onSend: vi.fn() });
    panel.setCharactersState([link("mine", "Mine", "me"), link("theirs", "Theirs", "someone-else")], [], [], "me", false, null);

    expect(container.querySelector(".character-link-manage[data-character-id='mine']")).not.toBeNull();
    expect(container.querySelector(".character-link-manage[data-character-id='theirs']")).toBeNull();

    panel.setCharactersState([link("mine", "Mine", "me"), link("theirs", "Theirs", "someone-else")], [], [], "me", true, null);
    expect(container.querySelector(".character-link-manage[data-character-id='theirs']")).not.toBeNull();
  });

  it("toggling 'All players' off/on calls onUpdateCharacterLink with the right visibility shape", () => {
    const onUpdateCharacterLink = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onUpdateCharacterLink });
    panel.setCharactersState([link("c1", "Thrain", "me", "all")], [{ id: "other", displayName: "Other" }], [], "me", false, null);

    const allCheckbox = container.querySelector<HTMLInputElement>(".link-visibility-all")!;
    allCheckbox.checked = false;
    allCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onUpdateCharacterLink).toHaveBeenCalledWith("c1", { visibility: [] });
  });

  it("the link form only offers the viewer's own NOT-yet-linked characters, and clicking Link calls onLinkCharacter", () => {
    const onLinkCharacter = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onLinkCharacter });
    panel.setCharactersState([link("c1", "AlreadyLinked", "me")], [], [{ id: "c1", name: "AlreadyLinked" }, { id: "c2", name: "NotYetLinked" }], "me", false, null);

    const select = container.querySelector<HTMLSelectElement>("#link-character-select")!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["c2"]);

    container.querySelector<HTMLInputElement>("#link-character-folder")!.value = "Allies";
    container.querySelector<HTMLButtonElement>("#link-character-btn")!.click();
    expect(onLinkCharacter).toHaveBeenCalledWith("c2", "Allies");
  });

  it("clicking Unlink calls onUnlinkCharacter", () => {
    const onUnlinkCharacter = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onUnlinkCharacter });
    panel.setCharactersState([link("c1", "Thrain", "me")], [], [], "me", false, null);

    container.querySelector<HTMLButtonElement>(".unlink-btn")!.click();
    expect(onUnlinkCharacter).toHaveBeenCalledWith("c1");
  });

  it("MVP goal item 4 follow-up: Delete shows only on the viewer's OWN character (never an admin-only row), confirms first, and calls onDeleteCharacter only when confirmed", () => {
    const onDeleteCharacter = vi.fn();
    const panel = mount({ initialMessages: [], onSend: vi.fn(), onDeleteCharacter });
    panel.setCharactersState([link("mine", "Mine", "me"), link("theirs", "Theirs", "someone-else")], [], [], "me", true, null); // isAdmin=true -- can manage theirs, but still shouldn't see Delete on it

    expect(container.querySelector(".delete-char-btn[data-character-id='mine']")).not.toBeNull();
    expect(container.querySelector(".delete-char-btn[data-character-id='theirs']")).toBeNull();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    container.querySelector<HTMLButtonElement>(".delete-char-btn[data-character-id='mine']")!.click();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Mine"));
    expect(onDeleteCharacter).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    container.querySelector<HTMLButtonElement>(".delete-char-btn[data-character-id='mine']")!.click();
    expect(onDeleteCharacter).toHaveBeenCalledWith("mine");
    confirmSpy.mockRestore();
  });

  it("MVP goal item 4 follow-up (drag-and-drop placement): a row is draggable only for the viewer's OWN character, and dragstart puts its characterId on dataTransfer under CHARACTER_DRAG_MIME", () => {
    const panel = mount({ initialMessages: [], onSend: vi.fn() });
    panel.setCharactersState([link("mine", "Mine", "me"), link("theirs", "Theirs", "someone-else")], [], [], "me", false, null);

    const mineLi = container.querySelector<HTMLLIElement>("li[data-character-id='mine']")!;
    const theirsLi = container.querySelector<HTMLLIElement>("li[data-character-id='theirs']")!;
    expect(mineLi.draggable).toBe(true);
    expect(theirsLi.draggable).toBe(false);

    const setData = vi.fn();
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { setData, effectAllowed: "" } });
    mineLi.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith(CHARACTER_DRAG_MIME, "mine");
  });

  it("real bug found live: a row for the viewer's own CURRENTLY-FOCUSED character is never draggable either, since dropping it onto the world is always silently rejected server-side (it already has a live position)", () => {
    const panel = mount({ initialMessages: [], onSend: vi.fn() });
    panel.setCharactersState([link("mine", "Mine", "me"), link("alsoMine", "AlsoMine", "me")], [], [], "me", false, "mine");

    const focusedLi = container.querySelector<HTMLLIElement>("li[data-character-id='mine']")!;
    const otherOwnedLi = container.querySelector<HTMLLIElement>("li[data-character-id='alsoMine']")!;
    expect(focusedLi.draggable).toBe(false); // the focused one -- excluded even though it's owned
    expect(otherOwnedLi.draggable).toBe(true); // a DIFFERENT character you own is still draggable

    // null (no active world session, e.g. the lobby) excludes nothing extra.
    panel.setCharactersState([link("mine", "Mine", "me"), link("alsoMine", "AlsoMine", "me")], [], [], "me", false, null);
    expect(container.querySelector<HTMLLIElement>("li[data-character-id='mine']")!.draggable).toBe(true);
  });
});

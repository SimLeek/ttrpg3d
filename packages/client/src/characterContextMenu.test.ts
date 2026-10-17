import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountCharacterContextMenu, type CharacterContextMenuController, type CharacterContextMenuCallbacks } from "./characterContextMenu.js";
import { isCaptured } from "./inputCapture.js";

let container: HTMLElement;
let menu: CharacterContextMenuController | null = null;

function mount(overrides: Partial<CharacterContextMenuCallbacks> = {}) {
  const callbacks: CharacterContextMenuCallbacks = {
    onOpenCharacterSheet: vi.fn(),
    onEditTokenProperties: vi.fn(),
    onSelectStatusEffects: vi.fn(),
    ...overrides,
  };
  menu = mountCharacterContextMenu(container, callbacks);
  return { menu, callbacks };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  menu?.destroy();
  menu = null;
  container.remove();
});

describe("mountCharacterContextMenu", () => {
  it("is hidden until open() is called, then visible at the given position", () => {
    const { menu } = mount();
    const menuEl = container.querySelector<HTMLDivElement>("#char-ctx-menu")!;
    expect(menuEl.style.display).toBe(""); // "none" comes from the stylesheet default, not an inline style yet

    menu.open(100, 200, "char-1");
    expect(menuEl.style.display).toBe("block");
    expect(menuEl.style.left).toBe("100px");
    expect(menuEl.style.top).toBe("200px");
    expect(menu.isOpen()).toBe(true);
  });

  it("the 'Open character sheet' button is disabled -- item 3 (full character sheets) doesn't exist yet", () => {
    mount();
    const btn = container.querySelector<HTMLButtonElement>("#ctx-open-sheet")!;
    expect(btn.disabled).toBe(true);
  });

  it("clicking 'Edit token properties' calls the callback with the character id the menu was opened for, then closes", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-42");
    container.querySelector<HTMLButtonElement>("#ctx-edit-token")!.click();
    expect(callbacks.onEditTokenProperties).toHaveBeenCalledWith("char-42");
    expect(menu.isOpen()).toBe(false);
  });

  it("clicking 'Select status effects' calls the callback with the character id, then closes", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-7");
    container.querySelector<HTMLButtonElement>("#ctx-status-effects")!.click();
    expect(callbacks.onSelectStatusEffects).toHaveBeenCalledWith("char-7");
    expect(menu.isOpen()).toBe(false);
  });

  it("claims input capture while open, releases it on close", () => {
    const { menu } = mount();
    expect(isCaptured()).toBe(false);
    menu.open(0, 0, "char-1");
    expect(isCaptured()).toBe(true);
    menu.close();
    expect(isCaptured()).toBe(false);
  });

  it("a click outside the menu does NOT close it within the same tick it opened on -- the real bug this guards against: the same right-click mousedown that opens the menu (via voxelEditor.ts's alt-fire handler, synchronously emitted by game-inputs) bubbles up to this file's own document-level listener within that SAME event dispatch, and would otherwise immediately close what it just opened before a single frame ever rendered", () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.isOpen()).toBe(true);
  });

  it("a click outside the menu on a later tick closes it normally", async () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });

  it("pressing Escape closes it", () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.isOpen()).toBe(false);
  });

  it("destroy() releases capture if the menu was left open", () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1");
    menu.destroy();
    expect(isCaptured()).toBe(false);
  });
});

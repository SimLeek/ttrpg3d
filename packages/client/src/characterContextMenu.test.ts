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
    onDeleteInstance: vi.fn(),
    onControl: vi.fn(),
    onAddToTurnOrder: vi.fn(),
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

    menu.open(100, 200, "char-1", "inst-1", false);
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

  it("clicking 'Edit token properties' calls the callback with the character id AND instance id the menu was opened for, then closes", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-42", "inst-42", false);
    container.querySelector<HTMLButtonElement>("#ctx-edit-token")!.click();
    expect(callbacks.onEditTokenProperties).toHaveBeenCalledWith("char-42", "inst-42");
    expect(menu.isOpen()).toBe(false);
  });

  it("clicking 'Select status effects' calls the callback with the character id and instance id, then closes", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-7", "inst-7", false);
    container.querySelector<HTMLButtonElement>("#ctx-status-effects")!.click();
    expect(callbacks.onSelectStatusEffects).toHaveBeenCalledWith("char-7", "inst-7");
    expect(menu.isOpen()).toBe(false);
  });

  it("the real instanceId is still passed through for a PILOTED character too -- real correction, 2026-10-23: a piloted character now has a real, stable instanceId the same as any placed one (isPiloted only gates Control/Delete, not these edit callbacks)", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-focused", "inst-focused", true);
    container.querySelector<HTMLButtonElement>("#ctx-edit-token")!.click();
    expect(callbacks.onEditTokenProperties).toHaveBeenCalledWith("char-focused", "inst-focused");
  });

  it("'Control' is enabled when opened with isPiloted=false, and calls the callback with just the instance id, then closes -- real request: \"Add context menu item: control - switches current control to this token\"", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-11", "inst-11", false);
    const btn = container.querySelector<HTMLButtonElement>("#ctx-control")!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(callbacks.onControl).toHaveBeenCalledWith("inst-11");
    expect(menu.isOpen()).toBe(false);
  });

  it("'Control' is disabled when opened with isPiloted=true (already controlling this character), and clicking it does nothing", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-12", "inst-12", true);
    const btn = container.querySelector<HTMLButtonElement>("#ctx-control")!;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(callbacks.onControl).not.toHaveBeenCalled();
  });

  it("'Delete instance' is enabled when opened with isPiloted=false, and calls the callback with just the instance id, then closes (MVP goal item 4 follow-up)", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-9", "inst-9", false);
    const btn = container.querySelector<HTMLButtonElement>("#ctx-delete-instance")!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(callbacks.onDeleteInstance).toHaveBeenCalledWith("inst-9");
    expect(menu.isOpen()).toBe(false);
  });

  it("'Delete instance' is disabled when opened with isPiloted=true (the character you're currently controlling), and clicking it does nothing", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-10", "inst-10", true);
    const btn = container.querySelector<HTMLButtonElement>("#ctx-delete-instance")!;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(callbacks.onDeleteInstance).not.toHaveBeenCalled();
  });

  it("'Add to Turn Order' is enabled when opened with isPiloted=false, and calls the callback with the character id AND instance id, then closes (docs/BATTLE_SYSTEM.md's Roll20-style right-click-to-add)", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-13", "inst-13", false);
    const btn = container.querySelector<HTMLButtonElement>("#ctx-add-turn-order")!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(callbacks.onAddToTurnOrder).toHaveBeenCalledWith("char-13", "inst-13");
    expect(menu.isOpen()).toBe(false);
  });

  it("'Add to Turn Order' is ALSO enabled when opened with isPiloted=true -- real correction, 2026-10-23: \"I cannot add my currently controlled character to the turn order... even though I should be able to\"", () => {
    const { menu, callbacks } = mount();
    menu.open(10, 10, "char-14", "inst-14", true);
    const btn = container.querySelector<HTMLButtonElement>("#ctx-add-turn-order")!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(callbacks.onAddToTurnOrder).toHaveBeenCalledWith("char-14", "inst-14");
  });

  it("claims input capture while open, releases it on close", () => {
    const { menu } = mount();
    expect(isCaptured()).toBe(false);
    menu.open(0, 0, "char-1", "inst-1", false);
    expect(isCaptured()).toBe(true);
    menu.close();
    expect(isCaptured()).toBe(false);
  });

  it("a click outside the menu does NOT close it within the same tick it opened on -- the real bug this guards against: the same right-click mousedown that opens the menu (via voxelEditor.ts's alt-fire handler, synchronously emitted by game-inputs) bubbles up to this file's own document-level listener within that SAME event dispatch, and would otherwise immediately close what it just opened before a single frame ever rendered", () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1", "inst-1", false);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.isOpen()).toBe(true);
  });

  it("a click outside the menu on a later tick closes it normally", async () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1", "inst-1", false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });

  it("pressing Escape closes it", () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1", "inst-1", false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.isOpen()).toBe(false);
  });

  it("destroy() releases capture if the menu was left open", () => {
    const { menu } = mount();
    menu.open(0, 0, "char-1", "inst-1", false);
    menu.destroy();
    expect(isCaptured()).toBe(false);
  });
});

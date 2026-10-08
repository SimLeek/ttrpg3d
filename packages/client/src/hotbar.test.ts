import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountHotbar, type HotbarController, type HotbarOptions } from "./hotbar.js";
import type { Item } from "@ttrpg3d/shared";

function makeCatalog(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "place-block" as const,
    voxelId: i + 1,
    name: `block-${i}`,
    color: [0, 0, 0] as [number, number, number],
  }));
}

function dispatchKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

function dispatchWheel(deltaY: number): void {
  window.dispatchEvent(new WheelEvent("wheel", { deltaY }));
}

let container: HTMLElement;
let activeHotbar: HotbarController | null = null;

// mountHotbar attaches window-level key/wheel listeners -- track and
// destroy() whatever each test mounts so listeners don't pile up across
// tests sharing the same jsdom `window`.
function mount(options: HotbarOptions): HotbarController {
  activeHotbar = mountHotbar(container, options);
  return activeHotbar;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  activeHotbar?.destroy();
  activeHotbar = null;
});

describe("mountHotbar", () => {
  it("equips the catalog's first item in slot 0 by default", () => {
    const catalog = makeCatalog(3);
    const hotbar = mount({ catalog });
    expect(hotbar.getEquippedItem()).toEqual(catalog[0]);
  });

  it("number keys 1-9 select slots 0-8, and 0 selects slot 9 (the 10th)", () => {
    const catalog = makeCatalog(10);
    const hotbar = mount({ catalog });
    dispatchKey("Digit3");
    expect(hotbar.getEquippedItem()).toEqual(catalog[2]);
    dispatchKey("Digit0");
    expect(hotbar.getEquippedItem()).toEqual(catalog[9]);
    dispatchKey("Digit1");
    expect(hotbar.getEquippedItem()).toEqual(catalog[0]);
  });

  it("mouse wheel cycles selection and wraps around at both ends", () => {
    const catalog = makeCatalog(10);
    const hotbar = mount({ catalog });
    dispatchWheel(1); // forward from slot 0
    expect(hotbar.getEquippedItem()).toEqual(catalog[1]);
    dispatchWheel(-1); // back to slot 0
    dispatchWheel(-1); // wrap backward past the start -> last slot
    expect(hotbar.getEquippedItem()).toEqual(catalog[9]);
    dispatchWheel(1); // wrap forward past the end -> first slot
    expect(hotbar.getEquippedItem()).toEqual(catalog[0]);
  });

  it("clicking an inventory item loads it into the currently-selected hotbar slot", () => {
    const catalog = makeCatalog(12); // more than 10, so some are inventory-only, never in the initial hotbar fill
    const hotbar = mount({ catalog });
    dispatchKey("Digit2"); // select slot 1
    const inventorySlots = container.querySelectorAll<HTMLElement>("#inventory-grid .slot");
    inventorySlots[11]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(hotbar.getEquippedItem()).toEqual(catalog[11]);
  });

  it("E toggles the inventory overlay open and closed, and reports it via onInventoryOpenChange", () => {
    const openStates: boolean[] = [];
    mount({ catalog: makeCatalog(3), onInventoryOpenChange: (open) => openStates.push(open) });
    const overlay = container.querySelector("#inventory-overlay")!;
    expect(overlay.classList.contains("open")).toBe(false);
    dispatchKey("KeyE");
    expect(overlay.classList.contains("open")).toBe(true);
    expect(openStates).toEqual([true]);
    dispatchKey("KeyE");
    expect(overlay.classList.contains("open")).toBe(false);
    expect(openStates).toEqual([true, false]);
  });

  it("Escape closes the inventory if open, but does nothing if it's already closed", () => {
    mount({ catalog: makeCatalog(3) });
    const overlay = container.querySelector("#inventory-overlay")!;
    dispatchKey("Escape");
    expect(overlay.classList.contains("open")).toBe(false); // harmless no-op
    dispatchKey("KeyE");
    expect(overlay.classList.contains("open")).toBe(true);
    dispatchKey("Escape");
    expect(overlay.classList.contains("open")).toBe(false);
  });

  it("a hotbar slot beyond the catalog's size starts unequipped (null)", () => {
    const catalog = makeCatalog(3); // fewer than the 10 hotbar slots
    const hotbar = mount({ catalog });
    dispatchKey("Digit5");
    expect(hotbar.getEquippedItem()).toBeNull();
  });

  it("destroy() stops the hotbar from reacting to further input", () => {
    const catalog = makeCatalog(3);
    const hotbar = mount({ catalog });
    hotbar.destroy();
    activeHotbar = null; // already destroyed, don't double-destroy in afterEach
    dispatchKey("Digit2");
    expect(hotbar.getEquippedItem()).toEqual(catalog[0]); // unchanged -- listener was removed
  });
});

// Hotbar + full-inventory-grid UI, direct port of the old game's
// scripts/ui/player_inventory.gd (read in full, not guessed): a
// 10-slot hotbar (keys 1-9 then 0 for the 10th, Minecraft-style; plain
// mouse-wheel cycles selection) plus a toggleable grid showing every
// catalog item, where clicking a grid item loads it into whichever
// hotbar slot is currently selected.
//
// Deliberately noa-free (no import of noa-engine here) so this stays
// unit-testable against a real but detached DOM (jsdom) without needing
// a real Engine/WebGL context -- see hotbar.test.ts. The one piece that
// genuinely needs noa (suspending pointer-lock mouse-look while the
// inventory grid is open, so the mouse is free to click it) is exposed
// as an `onInventoryOpenChange` callback for game.ts to wire up instead
// of reaching into noa from here directly.
//
// Equip-state shape (`getEquippedItem()` returning a real `Item`, not a
// bare index) is deliberate -- see docs/PORTING_CHECKLIST.md Phase 4/5
// notes: a future non-block item kind (pickaxe, etc.) can be added to
// the `Item` union later without any change to this file's logic.

import type { Item } from "@ttrpg3d/shared";
import { requestCapture, releaseCapture } from "./inputCapture.js";

const HOTBAR_SIZE = 10;

export interface HotbarOptions {
  catalog: Item[];
  /** Called right after the inventory grid opens or closes, so the caller can suspend/restore pointer-lock mouse-look (a noa concern, kept out of this file). */
  onInventoryOpenChange?: (open: boolean) => void;
}

export interface HotbarController {
  getEquippedItem(): Item | null;
  /** Removes this hotbar's window-level key/wheel listeners (and releases its input capture if the inventory was left open). Mirrors game.ts's RunningGame.stop() pattern -- call when leaving the game view. */
  destroy(): void;
}

function itemLabel(item: Item): string {
  switch (item.kind) {
    case "place-block":
      return item.name;
  }
}

function itemColorCss(item: Item): string {
  const [r, g, b] = item.color;
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// Real per-block top-face icons (scripts/build-block-icons.mjs, cropped
// from the same real source atlases the terrain textures come from -- not
// a flat color swatch). `item.color` is still used as the img's CSS
// background (visible for one frame before the icon loads, and as a
// harmless fallback if an icon is ever missing for a future item kind).
function itemIconUrl(item: Item): string {
  return `/textures/icons/${item.name}.png`;
}

export function mountHotbar(container: HTMLElement, options: HotbarOptions): HotbarController {
  const { catalog } = options;

  container.innerHTML = `
    <style>
      /* Shared by both the hotbar row AND the inventory grid -- a slot
         created under either one gets the same look. Originally scoped as
         ".hotbar .slot", which meant inventory-grid slots (not descendants
         of .hotbar) got none of this: no border/background, and critically
         no "position: relative", so their absolutely-positioned icon
         children all collapsed onto the same spot relative to the overlay
         instead of sitting inside their own slot -- confirmed live
         ("completely empty inventory"). Fixed by sharing one real .slot rule. */
      .slot { position: relative; width: 48px; height: 48px; border: 2px solid rgba(200,200,200,0.7); border-radius: 4px; background: rgba(20,20,24,0.75); cursor: pointer; box-sizing: border-box; }
      .slot.selected { border-color: rgb(255,217,51); }
      .slot .icon { position: absolute; inset: 5px; width: calc(100% - 10px); height: calc(100% - 10px); object-fit: fill; image-rendering: pixelated; border-radius: 2px; }
      .slot .num { position: absolute; top: 1px; left: 3px; font-size: 11px; color: #ddd; text-shadow: 1px 1px 0 #000; }
      .hotbar { position: fixed; left: 0; right: 0; bottom: 16px; display: flex; justify-content: center; gap: 6px; pointer-events: none; font-family: system-ui, sans-serif; }
      .hotbar .slot { pointer-events: auto; }
      .inventory-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
      .inventory-overlay.open { display: flex; }
      .inventory-panel { background: rgba(30,30,36,0.95); border: 2px solid rgba(200,200,200,0.7); border-radius: 6px; padding: 14px; max-width: 80vw; }
      .inventory-panel h2 { margin: 0 0 10px; font-size: 16px; color: #eee; font-weight: normal; }
      .inventory-grid { display: grid; grid-template-columns: repeat(8, 48px); gap: 4px; }
    </style>
    <div class="hotbar" id="hotbar-row"></div>
    <div class="inventory-overlay" id="inventory-overlay">
      <div class="inventory-panel">
        <h2>Inventory -- click an item to load it into the selected hotbar slot</h2>
        <div class="inventory-grid" id="inventory-grid"></div>
      </div>
    </div>
  `;

  const hotbarRow = container.querySelector<HTMLDivElement>("#hotbar-row")!;
  const inventoryOverlay = container.querySelector<HTMLDivElement>("#inventory-overlay")!;
  const inventoryGrid = container.querySelector<HTMLDivElement>("#inventory-grid")!;

  const hotbarItems: Array<Item | null> = Array.from({ length: HOTBAR_SIZE }, (_, i) => catalog[i] ?? null);
  let selectedSlot = 0;
  let inventoryOpen = false;

  function renderHotbar(): void {
    hotbarRow.innerHTML = "";
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const item = hotbarItems[i];
      const slot = document.createElement("div");
      slot.className = "slot" + (i === selectedSlot ? " selected" : "");
      slot.dataset.slotIndex = String(i);
      const num = document.createElement("div");
      num.className = "num";
      num.textContent = String((i + 1) % 10); // slot 10 shows "0", Minecraft-style
      slot.appendChild(num);
      if (item) {
        const icon = document.createElement("img");
        icon.className = "icon";
        icon.src = itemIconUrl(item);
        icon.style.background = itemColorCss(item); // visible until the icon loads, and a harmless fallback if one's ever missing
        slot.title = itemLabel(item);
        slot.appendChild(icon);
      }
      slot.addEventListener("click", () => selectSlot(i));
      hotbarRow.appendChild(slot);
    }
  }

  function renderInventoryGrid(): void {
    inventoryGrid.innerHTML = "";
    for (const item of catalog) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.title = itemLabel(item);
      const icon = document.createElement("img");
      icon.className = "icon";
      icon.src = itemIconUrl(item);
      icon.style.background = itemColorCss(item);
      slot.appendChild(icon);
      slot.addEventListener("click", () => setHotbarSlot(selectedSlot, item));
      inventoryGrid.appendChild(slot);
    }
  }

  function selectSlot(index: number): void {
    selectedSlot = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    renderHotbar();
  }

  /** Assigns `item` into hotbar slot `index` -- same effect as clicking an inventory item while that slot's selected. Direct analogue of player_inventory.gd's `set_hotbar_slot`. */
  function setHotbarSlot(index: number, item: Item): void {
    hotbarItems[index] = item;
    renderHotbar();
  }

  function setInventoryOpen(open: boolean): void {
    inventoryOpen = open;
    inventoryOverlay.classList.toggle("open", open);
    if (open) requestCapture("inventory");
    else releaseCapture("inventory");
    options.onInventoryOpenChange?.(open);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.code === "KeyE") {
      setInventoryOpen(!inventoryOpen);
      return;
    }
    if (event.code === "Escape" && inventoryOpen) {
      setInventoryOpen(false);
      return;
    }
    const digitMatch = /^Digit(\d)$/.exec(event.code);
    if (digitMatch) {
      const digit = Number(digitMatch[1]);
      selectSlot(digit === 0 ? 9 : digit - 1); // "1" -> slot 0, ..., "9" -> slot 8, "0" -> slot 9
    }
  }

  function onWheel(event: WheelEvent): void {
    if (event.deltaY === 0) return;
    selectSlot(selectedSlot + (event.deltaY > 0 ? 1 : -1));
  }

  window.addEventListener("keydown", onKeydown);
  window.addEventListener("wheel", onWheel);

  renderHotbar();
  renderInventoryGrid();

  return {
    getEquippedItem(): Item | null {
      return hotbarItems[selectedSlot];
    },
    destroy(): void {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("wheel", onWheel);
      if (inventoryOpen) releaseCapture("inventory");
    },
  };
}

// Right-click context menu for a character token -- MVP goal items 1-2
// (docs/ROADMAP.md). Native browser context menu is ALREADY globally
// suppressed by noa's own Inputs (allowContextMenu:false by default,
// confirmed in its real source), and right-click (Mouse3) already maps to
// noa's alt-fire binding, which voxelEditor.ts already uses for block
// placement. This module is just the DOM overlay itself -- voxelEditor.ts's
// alt-fire handler is what decides whether to open it (token under cursor)
// or fall through to block placement, not a second competing listener here.
//
// Same DOM-overlay mount pattern as every other panel in this project
// (innerHTML + querySelector + createElement), and claims input capture
// (inputCapture.ts) while open so noa's mouse-look/hotkeys don't fire
// underneath it -- same reasoning hotbar.ts's inventory grid already
// established.

import { requestCapture, releaseCapture } from "./inputCapture.js";

const CAPTURE_REASON = "characterContextMenu";

export interface CharacterContextMenuCallbacks {
  onOpenCharacterSheet(characterId: string): void;
  onEditTokenProperties(characterId: string): void;
  onSelectStatusEffects(characterId: string): void;
}

export interface CharacterContextMenuController {
  /** Opens the menu at the given viewport coordinates (e.g. the pointer-lock-exited click position) for the given character. */
  open(x: number, y: number, characterId: string): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function mountCharacterContextMenu(container: HTMLElement, callbacks: CharacterContextMenuCallbacks): CharacterContextMenuController {
  container.innerHTML = `
    <style>
      .char-ctx-menu { position: fixed; display: none; background: rgba(20,20,24,0.95); border: 1px solid rgba(200,200,200,0.4); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; font-size: 13px; z-index: 1000; min-width: 180px; overflow: hidden; }
      .char-ctx-menu button { display: block; width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; color: inherit; font-size: inherit; cursor: pointer; }
      .char-ctx-menu button:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
      .char-ctx-menu button:disabled { color: #777; cursor: default; }
    </style>
    <div class="char-ctx-menu" id="char-ctx-menu">
      <button type="button" id="ctx-open-sheet" disabled title="Full character sheets aren't built yet (MVP goal item 3)">Open character sheet</button>
      <button type="button" id="ctx-edit-token">Edit token properties</button>
      <button type="button" id="ctx-status-effects">Select status effects</button>
    </div>
  `;

  const menu = container.querySelector<HTMLDivElement>("#char-ctx-menu")!;
  const openSheetBtn = container.querySelector<HTMLButtonElement>("#ctx-open-sheet")!;
  const editTokenBtn = container.querySelector<HTMLButtonElement>("#ctx-edit-token")!;
  const statusEffectsBtn = container.querySelector<HTMLButtonElement>("#ctx-status-effects")!;

  let open = false;
  let activeCharacterId: string | null = null;
  // Real bug found live, confirmed via direct source reading, not guessed:
  // the SAME right-click mousedown that opens this menu (via net.ts's
  // voxelEditor.ts alt-fire handler, itself synchronously emitted by
  // game-inputs from a bubble-phase listener on noa's container -- closer
  // to the canvas than `document`) finishes bubbling up to THIS file's
  // own `document`-level "click outside closes it" listener within that
  // SAME event dispatch. That listener saw the click's target (the
  // canvas) wasn't inside the menu and immediately closed it again --
  // open() and close() both completing before a single frame ever
  // rendered, so the menu never visibly appeared. This flag skips outside-
  // click handling for the remainder of the tick the menu was JUST opened
  // on (the standard fix for this exact class of bug, same technique
  // dropdown/menu libraries commonly use) -- a mousedown on any LATER tick
  // still closes it normally.
  let justOpenedThisTick = false;

  function close(): void {
    if (!open) return;
    open = false;
    activeCharacterId = null;
    menu.style.display = "none";
    releaseCapture(CAPTURE_REASON);
  }

  function onOutsideClick(event: MouseEvent): void {
    if (justOpenedThisTick) return;
    if (!menu.contains(event.target as Node)) close();
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
  document.addEventListener("mousedown", onOutsideClick);
  document.addEventListener("keydown", onKeyDown);

  openSheetBtn.addEventListener("click", () => {
    if (activeCharacterId) callbacks.onOpenCharacterSheet(activeCharacterId);
    close();
  });
  editTokenBtn.addEventListener("click", () => {
    if (activeCharacterId) callbacks.onEditTokenProperties(activeCharacterId);
    close();
  });
  statusEffectsBtn.addEventListener("click", () => {
    if (activeCharacterId) callbacks.onSelectStatusEffects(activeCharacterId);
    close();
  });

  return {
    open(x: number, y: number, characterId: string): void {
      open = true;
      activeCharacterId = characterId;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.style.display = "block";
      requestCapture(CAPTURE_REASON);
      justOpenedThisTick = true;
      setTimeout(() => (justOpenedThisTick = false), 0);
    },
    close,
    isOpen: () => open,
    destroy(): void {
      close();
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}

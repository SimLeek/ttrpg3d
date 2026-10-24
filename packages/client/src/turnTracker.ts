// Turn-order tracker widget -- docs/BATTLE_SYSTEM.md, phase 1 (manual
// Add/Remove/Clear All/reorder/Next Turn; initiative-roll-driven adds
// and Reset Turn are later phases, not this file). Styled closer to
// Roll20's own turn-order tracker than redesigned from scratch (direct
// reference call), close to the old game's existing
// turn_tracker_menu.gd shape: a floating, draggable, minimizable,
// non-modal panel, NOT a docked safe-area panel like modePanel.ts/
// hotbar.ts -- it can overlap other UI by design, same as
// characterContextMenu.ts's own floating overlay.
//
// Mounted inside game.ts's startGame() (same per-world/page lifecycle
// as modePanel.ts/hotbar.ts), toggled by modePanel.ts's "Turns"
// button -- this file owns its own visibility, modePanel.ts just
// calls setVisible() and doesn't track the state itself (same split
// hotbar.ts's own inventory-open toggle already uses elsewhere).
//
// GM-only controls (Add, Clear All, Next Turn, roll-value edit,
// up/down reorder arrows) -- confirmed directly ("Only the GM should
// be able to click next turn"; "Add" is explicitly the GM's manual-
// override path). A non-GM session sees the same list, read-only,
// except they can still remove/add their OWN character's entry (see
// canRemoveEntry's own doc). Reordering was native HTML5 drag-and-
// drop originally; real correction, 2026-10-23 ("I just tried it as
// GM and it's pretty bad") -- replaced with plain up/down buttons.
//
// Deliberately noa-free (same reasoning as every other panel file
// here) -- GM status and all data come in via injected callbacks/
// update(), not a direct noa/room import, so this stays jsdom-testable.

import { SAFE_AREA_LEFT_VAR } from "./panelLayout.js";

// Real request: "whether it was open or not should also persist" --
// a per-CLIENT UI preference (same spirit as api.ts's
// CHARACTER_STORAGE_KEY), not Schema-synced room state; different
// sessions can have the tracker open/closed independently of each
// other and of whoever's actually running the turn order.
const TURN_TRACKER_VISIBLE_STORAGE_KEY = "ttrpg3d.turnTrackerVisible";

export interface TurnOrderEntryLike {
  turnEntryId: string;
  label: string;
  hasRollValue: boolean;
  rollValue: number;
  /** Real correction, 2026-10-23: empty for a bare-label ("Add non-character...") entry, a real OtherCharacterState id otherwise -- lets canRemoveEntry/onRowContextMenu address the right thing. */
  instanceId: string;
  characterId: string;
}

export interface TurnTrackerOptions {
  /**
   * Real correction, 2026-10-23: "the gm should be able to see what
   * players will see" -- tied to the G-key `gmOverride` toggle (NOT
   * just real admin status), so an admin previewing the player view
   * (G off) sees the same read-only-minus-their-own-characters list a
   * real player does. Gates Next Turn/Clear All/the manual "Add non-
   * character..." row/drag-to-reorder.
   */
  isGM: () => boolean;
  /** Real correction, 2026-10-23: "if it's the player owning their own characters, then sure, they should be able to remove their specific characters" -- a non-GM player can still remove an entry for a character they own, independent of isGM. Always false for a bare-label entry (nothing to check ownership of). */
  canRemoveEntry: (entry: TurnOrderEntryLike) => boolean;
  onAdd(label: string): void;
  onRemove(turnEntryId: string): void;
  onClearAll(): void;
  onNextTurn(): void;
  onReorder(turnEntryId: string, newIndex: number): void;
  /** Real request: "the number (default 0 if no roll)... editable by gm and not others." GM-only, like onClearAll/onNextTurn/onReorder -- unlike who's IN the order, what number they're sorted/shown by is a GM-tier call. */
  onSetRollValue(turnEntryId: string, value: number): void;
  /**
   * Real request: "let's get the context menu working for the turn
   * order characters, so if I select a turn order character that I
   * own, I should be able to click control." Reuses the SAME floating
   * characterContextMenu.ts instance the 3D tokens already open --
   * net.ts decides whether to actually open it (owned, or GM) and
   * with what `isPiloted` value, this file just reports the right-
   * click and which entry it was on.
   */
  onRowContextMenu?: (entry: TurnOrderEntryLike, screenX: number, screenY: number) => void;
}

export interface TurnTrackerController {
  /** Call whenever the Schema-synced turn order changes (same "poll fresh every tick" idiom respawnControl.ts/chatPanel.ts's seeThroughWalls already use -- no `.listen()` anywhere in this codebase). */
  update(entries: TurnOrderEntryLike[], currentIndex: number, round: number): void;
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  destroy(): void;
}

export function mountTurnTracker(container: HTMLElement, options: TurnTrackerOptions): TurnTrackerController {
  container.innerHTML = `
    <style>
      /* Default position: just right of the left mode-select panel's live
         edge (real request: "near the left side of the screen just to
         the right of the buttons panel on the left") -- same
         SAFE_AREA_LEFT_VAR contract hotbar.ts already reads, so this
         follows modePanel.ts's own collapse/expand automatically.
         Overridden by inline left/top once the user actually drags it
         (see onDocumentMouseMove below). */
      .turn-tracker { position: fixed; top: 80px; left: calc(var(${SAFE_AREA_LEFT_VAR}, 0px) + 10px); width: 220px; background: rgba(20,20,24,0.92); border: 1px solid rgba(200,200,200,0.4); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; font-size: 13px; z-index: 500; display: none; }
      .turn-tracker.minimized .turn-tracker-body { display: none; }
      .turn-tracker-title { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(200,200,200,0.3); cursor: grab; user-select: none; border-radius: 6px 6px 0 0; }
      .turn-tracker.minimized .turn-tracker-title { border-radius: 6px; border-bottom: none; }
      .turn-tracker-title-text { font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .turn-tracker-min-btn { background: none; border: none; color: #eee; cursor: pointer; font-size: 12px; padding: 0 4px; }
      .turn-tracker-body { padding: 6px 8px; }
      .turn-tracker-info { font-size: 11px; opacity: 0.8; margin-bottom: 4px; }
      .turn-tracker-list { list-style: none; margin: 0 0 6px; padding: 0; max-height: 240px; overflow-y: auto; }
      .turn-tracker-entry { display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 3px; margin-bottom: 2px; background: rgba(255,255,255,0.05); }
      .turn-tracker-entry.current { background: rgb(255,217,51); color: #222; }
      .turn-tracker-entry-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .turn-tracker-entry-roll-display { font-size: 11px; opacity: 0.8; min-width: 18px; text-align: center; }
      .turn-tracker-entry-roll-input { width: 30px; font-size: 11px; text-align: center; background: rgba(255,255,255,0.08); border: 1px solid rgba(200,200,200,0.3); border-radius: 3px; color: inherit; padding: 1px 0; }
      /* Real request: "up and down arrows... with up arrow above and down arrow below even if that means they're tiny." */
      .turn-tracker-entry-arrows { display: flex; flex-direction: column; }
      .turn-tracker-entry-arrow { background: none; border: none; color: inherit; cursor: pointer; font-size: 8px; line-height: 1; padding: 0 2px; }
      .turn-tracker-entry-arrow:disabled { opacity: 0.3; cursor: default; }
      .turn-tracker-entry-remove { background: none; border: none; color: inherit; cursor: pointer; font-size: 11px; padding: 0 2px; }
      .turn-tracker-add-row { display: flex; gap: 4px; margin-bottom: 4px; }
      .turn-tracker-add-row input { flex: 1; min-width: 0; }
      .turn-tracker-actions { display: flex; gap: 4px; }
      .turn-tracker-actions button { flex: 1; }
      .turn-tracker-empty { opacity: 0.6; font-size: 12px; padding: 4px 0; }
    </style>
    <div class="turn-tracker" id="turn-tracker">
      <div class="turn-tracker-title" id="turn-tracker-title">
        <span class="turn-tracker-title-text" id="turn-tracker-title-text">Turn Order</span>
        <button type="button" class="turn-tracker-min-btn" id="turn-tracker-min-btn" title="Minimize/restore">&#x2212;</button>
      </div>
      <div class="turn-tracker-body" id="turn-tracker-body">
        <div class="turn-tracker-info" id="turn-tracker-info"></div>
        <ul class="turn-tracker-list" id="turn-tracker-list"></ul>
        <div id="turn-tracker-gm-controls"></div>
      </div>
    </div>
  `;

  const panel = container.querySelector<HTMLDivElement>("#turn-tracker")!;
  const titleBar = container.querySelector<HTMLDivElement>("#turn-tracker-title")!;
  const titleText = container.querySelector<HTMLSpanElement>("#turn-tracker-title-text")!;
  const minBtn = container.querySelector<HTMLButtonElement>("#turn-tracker-min-btn")!;
  const info = container.querySelector<HTMLDivElement>("#turn-tracker-info")!;
  const list = container.querySelector<HTMLUListElement>("#turn-tracker-list")!;
  const gmControls = container.querySelector<HTMLDivElement>("#turn-tracker-gm-controls")!;

  let visible = localStorage.getItem(TURN_TRACKER_VISIBLE_STORAGE_KEY) === "true";
  let minimized = false;
  let lastEntries: TurnOrderEntryLike[] = [];
  let lastCurrentIndex = 0;
  let lastRound = 1;

  function setMinimized(next: boolean): void {
    minimized = next;
    panel.classList.toggle("minimized", minimized);
    minBtn.innerHTML = minimized ? "&#x25A1;" : "&#x2212;";
    renderTitle();
  }
  minBtn.addEventListener("click", () => setMinimized(!minimized));

  // Plain mouse-event dragging for MOVING the whole panel -- rows
  // within the list are reordered via up/down buttons instead (see
  // renderList's own doc), not drag-and-drop.
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let draggingPanel = false;
  function onTitleMouseDown(event: MouseEvent): void {
    // Real-world guard: don't start a panel-move drag from the minimize
    // button itself, or its own click would also fire a move.
    if ((event.target as HTMLElement).closest("#turn-tracker-min-btn")) return;
    draggingPanel = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    event.preventDefault();
  }
  function onDocumentMouseMove(event: MouseEvent): void {
    if (!draggingPanel) return;
    panel.style.left = `${event.clientX - dragOffsetX}px`;
    panel.style.top = `${event.clientY - dragOffsetY}px`;
  }
  function onDocumentMouseUp(): void {
    draggingPanel = false;
  }
  titleBar.addEventListener("mousedown", onTitleMouseDown);
  document.addEventListener("mousemove", onDocumentMouseMove);
  document.addEventListener("mouseup", onDocumentMouseUp);

  function renderTitle(): void {
    if (!minimized) {
      titleText.textContent = "Turn Order";
      return;
    }
    const current = lastEntries[lastCurrentIndex];
    titleText.textContent = current ? `${current.label}'s turn` : "Turn Order";
  }

  function renderGmControls(): void {
    if (!options.isGM()) {
      gmControls.innerHTML = "";
      return;
    }
    gmControls.innerHTML = `
      <div class="turn-tracker-add-row">
        <input type="text" id="turn-tracker-add-input" placeholder="Add non-character..." maxlength="60" />
        <button type="button" id="turn-tracker-add-btn">Add</button>
      </div>
      <div class="turn-tracker-actions">
        <button type="button" id="turn-tracker-next-btn">Next Turn</button>
        <button type="button" id="turn-tracker-clear-btn">Clear All</button>
      </div>
    `;
    const addInput = gmControls.querySelector<HTMLInputElement>("#turn-tracker-add-input")!;
    const addBtn = gmControls.querySelector<HTMLButtonElement>("#turn-tracker-add-btn")!;
    function submitAdd(): void {
      const label = addInput.value.trim();
      if (!label) return;
      options.onAdd(label);
      addInput.value = "";
    }
    addBtn.addEventListener("click", submitAdd);
    addInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitAdd();
    });
    gmControls.querySelector<HTMLButtonElement>("#turn-tracker-next-btn")!.addEventListener("click", () => options.onNextTurn());
    gmControls.querySelector<HTMLButtonElement>("#turn-tracker-clear-btn")!.addEventListener("click", () => options.onClearAll());
  }

  function renderList(): void {
    const isGM = options.isGM();
    list.innerHTML = "";
    if (lastEntries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "turn-tracker-empty";
      empty.textContent = "No one in the turn order yet.";
      list.appendChild(empty);
      return;
    }
    lastEntries.forEach((entry, index) => {
      const li = document.createElement("li");
      li.className = "turn-tracker-entry" + (index === lastCurrentIndex ? " current" : "");
      li.dataset.turnEntryId = entry.turnEntryId;

      const label = document.createElement("span");
      label.className = "turn-tracker-entry-label";
      label.textContent = entry.label;
      li.appendChild(label);

      // Real request: "the number (default 0 if no roll)... editable
      // by gm and not others" -- always shown now (not conditional on
      // hasRollValue), defaulting to 0. GM gets a real input; anyone
      // else gets a plain read-only display.
      const rollValue = entry.hasRollValue ? entry.rollValue : 0;
      if (isGM) {
        const rollInput = document.createElement("input");
        rollInput.type = "number";
        rollInput.className = "turn-tracker-entry-roll-input";
        rollInput.value = String(rollValue);
        function commitRoll(): void {
          const value = Number(rollInput.value);
          if (Number.isFinite(value)) options.onSetRollValue(entry.turnEntryId, value);
        }
        rollInput.addEventListener("blur", commitRoll);
        rollInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") commitRoll();
        });
        li.appendChild(rollInput);
      } else {
        const rollDisplay = document.createElement("span");
        rollDisplay.className = "turn-tracker-entry-roll-display";
        rollDisplay.textContent = String(rollValue);
        li.appendChild(rollDisplay);
      }

      // Real correction, 2026-10-23: reorder via up/down buttons
      // instead of drag-and-drop ("I just tried it as GM and it's
      // pretty bad") -- stays GM-only, same tier as Clear All/Next
      // Turn/the roll-value edit above.
      if (isGM) {
        const arrows = document.createElement("div");
        arrows.className = "turn-tracker-entry-arrows";
        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.className = "turn-tracker-entry-arrow";
        upBtn.title = "Move up";
        upBtn.textContent = "▲";
        upBtn.disabled = index === 0;
        upBtn.addEventListener("click", () => options.onReorder(entry.turnEntryId, index - 1));
        const downBtn = document.createElement("button");
        downBtn.type = "button";
        downBtn.className = "turn-tracker-entry-arrow";
        downBtn.title = "Move down";
        downBtn.textContent = "▼";
        downBtn.disabled = index === lastEntries.length - 1;
        downBtn.addEventListener("click", () => options.onReorder(entry.turnEntryId, index + 1));
        arrows.appendChild(upBtn);
        arrows.appendChild(downBtn);
        li.appendChild(arrows);
      }

      // Real correction, 2026-10-23: "if it's the player owning their
      // own characters, then sure, they should be able to remove
      // their specific characters" -- independent of isGM now.
      if (isGM || options.canRemoveEntry(entry)) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "turn-tracker-entry-remove";
        removeBtn.title = "Remove from turn order";
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => options.onRemove(entry.turnEntryId));
        li.appendChild(removeBtn);
      }

      // Real request: "let's get the context menu working for the
      // turn order characters" -- reuses the same right-click
      // convention the 3D tokens already use; net.ts decides whether
      // there's actually anything ownable/controllable here.
      li.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        options.onRowContextMenu?.(entry, event.clientX, event.clientY);
      });

      list.appendChild(li);
    });
  }

  function renderInfo(): void {
    if (lastEntries.length === 0) {
      info.textContent = "No turn order running.";
      return;
    }
    const current = lastEntries[lastCurrentIndex];
    info.textContent = `Round ${lastRound} -- ${current ? `${current.label}'s turn` : "?"}`;
  }

  function renderAll(): void {
    renderTitle();
    renderInfo();
    renderGmControls();
    renderList();
  }
  renderAll();
  // Apply the restored visibility from localStorage -- only need to
  // act when it was true; false already matches the stylesheet's own
  // default `display: none`, same as a never-toggled panel.
  if (visible) panel.style.display = "block";

  /**
   * Real bug found live, 2026-10-23: net.ts polls `update()` every noa
   * tick (the same "fresh every tick, no .listen()" idiom this file's
   * own header cites), but `renderAll()` unconditionally tore down and
   * rebuilt every button/row via `innerHTML = ...` -- 60 times a
   * second regardless of whether anything actually changed. Replacing
   * a button's own DOM node out from under an active `:hover` is what
   * produced the reported "flashes lighter and darker quickly"
   * flicker. Skips the rebuild entirely when the entries/current
   * index/round are unchanged from the last call.
   */
  function entriesEqual(a: TurnOrderEntryLike[], b: TurnOrderEntryLike[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((entry, i) => entry.turnEntryId === b[i].turnEntryId && entry.label === b[i].label && entry.hasRollValue === b[i].hasRollValue && entry.rollValue === b[i].rollValue && entry.instanceId === b[i].instanceId);
  }

  // Real correction, 2026-10-23: isGM() now follows the G-key toggle
  // ("the gm should be able to see what players will see"), which can
  // flip at any moment with no corresponding turn-order DATA change --
  // tracked separately so update()'s unchanged-skip (the flicker fix
  // above) doesn't also suppress a GM-controls refresh on toggle.
  let lastIsGM = options.isGM();

  return {
    update(entries: TurnOrderEntryLike[], currentIndex: number, round: number): void {
      const isGMNow = options.isGM();
      const unchanged = currentIndex === lastCurrentIndex && round === lastRound && isGMNow === lastIsGM && entriesEqual(entries, lastEntries);
      lastEntries = entries;
      lastCurrentIndex = currentIndex;
      lastRound = round;
      lastIsGM = isGMNow;
      if (unchanged) return;
      renderAll();
    },
    setVisible(nextVisible: boolean): void {
      visible = nextVisible;
      panel.style.display = visible ? "block" : "none";
      localStorage.setItem(TURN_TRACKER_VISIBLE_STORAGE_KEY, String(visible));
    },
    isVisible: () => visible,
    destroy(): void {
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.removeEventListener("mouseup", onDocumentMouseUp);
    },
  };
}

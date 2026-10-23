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
// GM-only controls (Add, per-row Remove, Clear All, Next Turn,
// drag-to-reorder) -- confirmed directly ("Only the GM should be able
// to click next turn"; "Add" is explicitly the GM's manual-override
// path). A non-GM session sees the same list, read-only.
//
// Deliberately noa-free (same reasoning as every other panel file
// here) -- GM status and all data come in via injected callbacks/
// update(), not a direct noa/room import, so this stays jsdom-testable.

export interface TurnOrderEntryLike {
  turnEntryId: string;
  label: string;
  hasRollValue: boolean;
  rollValue: number;
}

export interface TurnTrackerOptions {
  isGM: () => boolean;
  onAdd(label: string): void;
  onRemove(turnEntryId: string): void;
  onClearAll(): void;
  onNextTurn(): void;
  onReorder(turnEntryId: string, newIndex: number): void;
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
      .turn-tracker { position: fixed; top: 80px; right: 20px; width: 220px; background: rgba(20,20,24,0.92); border: 1px solid rgba(200,200,200,0.4); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; font-size: 13px; z-index: 500; display: none; }
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
      .turn-tracker-entry-roll { font-size: 11px; opacity: 0.8; }
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

  let visible = false;
  let minimized = false;
  let lastEntries: TurnOrderEntryLike[] = [];
  let lastCurrentIndex = 0;
  let lastRound = 1;
  let draggingTurnEntryId: string | null = null;

  function setMinimized(next: boolean): void {
    minimized = next;
    panel.classList.toggle("minimized", minimized);
    minBtn.innerHTML = minimized ? "&#x25A1;" : "&#x2212;";
    renderTitle();
  }
  minBtn.addEventListener("click", () => setMinimized(!minimized));

  // Plain mouse-event dragging for MOVING the whole panel -- distinct
  // from the native HTML5 drag-and-drop used below for REORDERING rows
  // within the list; the two don't mix (a continuously-following free
  // position vs. a discrete drop-target swap).
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
    panel.style.right = "auto";
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
        <input type="text" id="turn-tracker-add-input" placeholder="Add entry..." maxlength="60" />
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
      if (isGM) li.draggable = true;

      const label = document.createElement("span");
      label.className = "turn-tracker-entry-label";
      label.textContent = entry.label;
      li.appendChild(label);

      if (entry.hasRollValue) {
        const roll = document.createElement("span");
        roll.className = "turn-tracker-entry-roll";
        roll.textContent = String(entry.rollValue);
        li.appendChild(roll);
      }

      if (isGM) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "turn-tracker-entry-remove";
        removeBtn.title = "Remove from turn order";
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => options.onRemove(entry.turnEntryId));
        li.appendChild(removeBtn);

        li.addEventListener("dragstart", () => {
          draggingTurnEntryId = entry.turnEntryId;
        });
        li.addEventListener("dragover", (event) => event.preventDefault());
        li.addEventListener("drop", (event) => {
          event.preventDefault();
          if (!draggingTurnEntryId || draggingTurnEntryId === entry.turnEntryId) return;
          const dropIndex = lastEntries.findIndex((e) => e.turnEntryId === entry.turnEntryId);
          if (dropIndex === -1) return;
          options.onReorder(draggingTurnEntryId, dropIndex);
          draggingTurnEntryId = null;
        });
      }

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

  return {
    update(entries: TurnOrderEntryLike[], currentIndex: number, round: number): void {
      lastEntries = entries;
      lastCurrentIndex = currentIndex;
      lastRound = round;
      renderAll();
    },
    setVisible(nextVisible: boolean): void {
      visible = nextVisible;
      panel.style.display = visible ? "block" : "none";
    },
    isVisible: () => visible,
    destroy(): void {
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.removeEventListener("mouseup", onDocumentMouseUp);
    },
  };
}

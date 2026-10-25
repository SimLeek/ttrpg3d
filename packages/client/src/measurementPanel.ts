// docs/BATTLE_SYSTEM.md's "Measurement shapes" -- its OWN floating,
// draggable, non-modal panel, explicitly NOT docked to the turn
// tracker (real distinction from the waypoint panel: "this should
// have its own floating box, similar to how the turn tracker had its
// floating ui"). Usable any time, independent of turn order/combat
// state entirely.
//
// Combines two patterns already established elsewhere in this
// codebase rather than inventing a third: turnTracker.ts's own plain-
// mousedown floating/draggable mechanism (this panel is NOT docked to
// anything, so it needs its own position, unlike waypointPanel.ts),
// and waypointPanel.ts's own chat-style collapse (shrink in place,
// toggle button stays visible, rather than minimize-to-title-bar).
//
// Deliberately noa/room-free (same reasoning as every other panel
// file here) -- all data and actions come in via injected callbacks/
// update(), so this stays jsdom-testable.

export type MeasurementShapeKind = "chain" | "cube" | "sphere" | "cone" | "beam";
export type SnapMode = "center" | "corner" | "free";

const COLLAPSED_WIDTH = 28;
const SHAPE_LABELS: Record<MeasurementShapeKind, string> = {
  chain: "Chain",
  cube: "Cube",
  sphere: "Sphere",
  cone: "Cone",
  beam: "Beam",
};

export interface MeasurementPanelOptions {
  /** Which shape type is currently active for placement, if any -- drives which shape's own settings (cone degrees/frustum, beam width) show, and which button renders as selected. */
  activeKind: () => MeasurementShapeKind | undefined;
  onSelectKind(kind: MeasurementShapeKind): void;
  snapMode: () => SnapMode;
  onSetSnapMode(mode: SnapMode): void;
  broadcast: () => boolean;
  onSetBroadcast(enabled: boolean): void;
  coneDegrees: () => number;
  onSetConeDegrees(degrees: number): void;
  isFrustum: () => boolean;
  onSetIsFrustum(enabled: boolean): void;
  beamWidth: () => number;
  onSetBeamWidth(width: number): void;
  /** Real request: "there should also be an option to remove your current measurement object in the distance dialog UI" -- same action right-clicking your own placed shape's context menu's "Delete" entry triggers. */
  onRemoveCurrent(): void;
  /** GM-only, per-world (docs/BATTLE_SYSTEM.md's own cross-reference: "lives in the world's own settings/detail page, same place the generator/its params already live" -- no such page exists yet in this codebase, so this panel is where it lives for now, same precedent the waypoint panel's own distance-metric dropdown already set). */
  isGM: () => boolean;
  ftPerVoxel: () => number;
  onSetFtPerVoxel(value: number): void;
}

export interface MeasurementPanelController {
  /** Same "poll fresh every tick, skip the rebuild when nothing relevant changed" idiom turnTracker.ts/waypointPanel.ts's own update() uses. */
  update(): void;
  destroy(): void;
}

export function mountMeasurementPanel(parent: HTMLElement, options: MeasurementPanelOptions): MeasurementPanelController {
  const container = document.createElement("div");
  container.innerHTML = `
    <style>
      .measurement-panel { position: fixed; top: 80px; left: 260px; width: 170px; display: flex; flex-direction: column; background: rgba(20,20,24,0.92); border: 1px solid rgba(200,200,200,0.4); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; font-size: 12px; z-index: 500; overflow: hidden; }
      .measurement-panel.collapsed { width: ${COLLAPSED_WIDTH}px !important; }
      .measurement-panel.collapsed .measurement-panel-body { display: none; }
      .measurement-panel-header { display: flex; align-items: center; gap: 4px; padding: 4px; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(200,200,200,0.3); cursor: move; }
      .measurement-panel-toggle-btn { background: none; border: none; color: #eee; cursor: pointer; font-size: 12px; padding: 0 2px; flex-shrink: 0; }
      .measurement-panel-title-text { font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .measurement-panel-body { display: flex; flex-direction: column; gap: 4px; padding: 6px; }
      .measurement-panel-shapes { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
      .measurement-panel-shapes button { padding: 3px 0; }
      .measurement-panel-shapes button.active { background: #2a6; color: #fff; }
      .measurement-panel-body select, .measurement-panel-body input[type="number"], .measurement-panel-body button { width: 100%; }
      .measurement-panel-checkbox-row { display: flex; align-items: center; gap: 4px; font-size: 11px; }
      .measurement-panel-shape-settings { display: flex; flex-direction: column; gap: 4px; }
      .measurement-panel-ft-row { display: flex; align-items: center; gap: 4px; font-size: 11px; }
      .measurement-panel-ft-row input { width: 50px; }
    </style>
    <div class="measurement-panel" id="measurement-panel">
      <div class="measurement-panel-header" id="measurement-panel-header">
        <button type="button" class="measurement-panel-toggle-btn" id="measurement-panel-toggle-btn" title="Collapse/expand">&raquo;</button>
        <span class="measurement-panel-title-text">Measure</span>
      </div>
      <div class="measurement-panel-body" id="measurement-panel-body">
        <div class="measurement-panel-shapes" id="measurement-panel-shapes"></div>
        <label>Snap:
          <select id="measurement-snap-select">
            <option value="center">Center</option>
            <option value="corner">Corner</option>
            <option value="free">Free</option>
          </select>
        </label>
        <label class="measurement-panel-checkbox-row">
          <input type="checkbox" id="measurement-broadcast-input" />
          Broadcast to others
        </label>
        <div class="measurement-panel-shape-settings" id="measurement-shape-settings"></div>
        <button type="button" id="measurement-remove-current-btn">Remove my current object</button>
        <div id="measurement-gm-controls"></div>
      </div>
    </div>
  `;
  parent.appendChild(container);

  const panel = container.querySelector<HTMLDivElement>("#measurement-panel")!;
  const header = container.querySelector<HTMLDivElement>("#measurement-panel-header")!;
  const toggleCollapseBtn = container.querySelector<HTMLButtonElement>("#measurement-panel-toggle-btn")!;
  const shapesContainer = container.querySelector<HTMLDivElement>("#measurement-panel-shapes")!;
  const snapSelect = container.querySelector<HTMLSelectElement>("#measurement-snap-select")!;
  const broadcastInput = container.querySelector<HTMLInputElement>("#measurement-broadcast-input")!;
  const shapeSettings = container.querySelector<HTMLDivElement>("#measurement-shape-settings")!;
  const removeCurrentBtn = container.querySelector<HTMLButtonElement>("#measurement-remove-current-btn")!;
  const gmControls = container.querySelector<HTMLDivElement>("#measurement-gm-controls")!;

  let collapsed = false;
  function setCollapsed(next: boolean): void {
    collapsed = next;
    panel.classList.toggle("collapsed", collapsed);
    toggleCollapseBtn.innerHTML = collapsed ? "&laquo;" : "&raquo;";
  }
  toggleCollapseBtn.addEventListener("click", () => setCollapsed(!collapsed));

  // Plain mouse-event dragging, same mechanism turnTracker.ts's own
  // title bar already uses -- this panel is NOT docked to anything,
  // so (unlike waypointPanel.ts) it needs its own position tracking.
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragging = false;
  function onHeaderMouseDown(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest("button")) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
  }
  function onDocumentMouseMove(event: MouseEvent): void {
    if (!dragging) return;
    panel.style.left = `${event.clientX - dragOffsetX}px`;
    panel.style.top = `${event.clientY - dragOffsetY}px`;
  }
  function onDocumentMouseUp(): void {
    dragging = false;
  }
  header.addEventListener("mousedown", onHeaderMouseDown);
  document.addEventListener("mousemove", onDocumentMouseMove);
  document.addEventListener("mouseup", onDocumentMouseUp);

  for (const kind of Object.keys(SHAPE_LABELS) as MeasurementShapeKind[]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = SHAPE_LABELS[kind];
    btn.dataset.kind = kind;
    btn.addEventListener("click", () => options.onSelectKind(kind));
    shapesContainer.appendChild(btn);
  }

  snapSelect.value = options.snapMode();
  snapSelect.addEventListener("change", () => options.onSetSnapMode(snapSelect.value as SnapMode));

  broadcastInput.checked = options.broadcast();
  broadcastInput.addEventListener("change", () => options.onSetBroadcast(broadcastInput.checked));

  removeCurrentBtn.addEventListener("click", () => options.onRemoveCurrent());

  function renderShapeSettings(): void {
    const kind = options.activeKind();
    if (kind === "cone") {
      shapeSettings.innerHTML = `
        <label>Degrees: <input type="number" id="measurement-cone-degrees" min="1" max="179" value="${options.coneDegrees()}" /></label>
        <label class="measurement-panel-checkbox-row"><input type="checkbox" id="measurement-cone-frustum" ${options.isFrustum() ? "checked" : ""} /> Frustum (flat cap)</label>
      `;
      shapeSettings.querySelector<HTMLInputElement>("#measurement-cone-degrees")!.addEventListener("change", (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(value) && value > 0) options.onSetConeDegrees(value);
      });
      shapeSettings.querySelector<HTMLInputElement>("#measurement-cone-frustum")!.addEventListener("change", (e) => options.onSetIsFrustum((e.target as HTMLInputElement).checked));
    } else if (kind === "beam") {
      shapeSettings.innerHTML = `<label>Width: <input type="number" id="measurement-beam-width" min="0.1" step="0.5" value="${options.beamWidth()}" /></label>`;
      shapeSettings.querySelector<HTMLInputElement>("#measurement-beam-width")!.addEventListener("change", (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(value) && value > 0) options.onSetBeamWidth(value);
      });
    } else {
      shapeSettings.innerHTML = "";
    }
  }

  function renderGmControls(): void {
    if (!options.isGM()) {
      gmControls.innerHTML = "";
      return;
    }
    gmControls.innerHTML = `<label class="measurement-panel-ft-row" title="Converts voxel distances into a feet display, for this AND the waypoint system's own distance labels">ft/voxel: <input type="number" id="measurement-ft-per-voxel" min="0.1" step="0.5" value="${options.ftPerVoxel()}" /></label>`;
    const input = gmControls.querySelector<HTMLInputElement>("#measurement-ft-per-voxel")!;
    function commit(): void {
      const value = Number(input.value);
      if (Number.isFinite(value) && value > 0) options.onSetFtPerVoxel(value);
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commit();
    });
  }

  function renderActiveKind(): void {
    const active = options.activeKind();
    for (const btn of shapesContainer.querySelectorAll<HTMLButtonElement>("button")) {
      btn.classList.toggle("active", btn.dataset.kind === active);
    }
  }

  let lastActiveKind = options.activeKind();
  let lastIsGM = options.isGM();
  let lastFtPerVoxel = options.ftPerVoxel();
  renderShapeSettings();
  renderGmControls();
  renderActiveKind();

  return {
    update(): void {
      const activeKindNow = options.activeKind();
      if (activeKindNow !== lastActiveKind) {
        lastActiveKind = activeKindNow;
        renderActiveKind();
        renderShapeSettings();
      }
      const isGMNow = options.isGM();
      const ftPerVoxelNow = options.ftPerVoxel();
      if (isGMNow !== lastIsGM || ftPerVoxelNow !== lastFtPerVoxel) {
        lastIsGM = isGMNow;
        lastFtPerVoxel = ftPerVoxelNow;
        renderGmControls();
      }
    },
    destroy(): void {
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.removeEventListener("mouseup", onDocumentMouseUp);
      container.remove();
    },
  };
}

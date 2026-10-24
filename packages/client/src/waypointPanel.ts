// docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- the small
// panel docked to the RIGHT edge of the turn-order tracker widget
// (mounted as a CHILD of turnTracker.ts's own `getDockElement()`, so
// it automatically follows that panel when dragged and is hidden
// whenever the tracker itself is, with no position/visibility
// tracking of its own). Collapsible independently of the tracker's
// own minimize state.
//
// Deliberately noa/room-free (same reasoning as turnTracker.ts/
// characterContextMenu.ts) -- all data and actions come in via
// injected callbacks/update(), so this stays jsdom-testable.

export interface WaypointPanelOptions {
  /** Real correction, 2026-10-23: tied to the G-key gmOverride toggle, not just real admin status -- same gate every other "GM-only" turn-tracker control uses, so a GM previewing the player view (G off) sees the read-only W+/W- buttons only. Gates the on/off toggle and the distance-metric input. */
  isGM: () => boolean;
  isWaypointsEnabled: () => boolean;
  distanceMetricP: () => number;
  /** Shared by the M keybind and this button (net.ts wires both to the same waypoints.ts action). */
  onAddWaypoint(): void;
  /** Shared by the N keybind and this button. */
  onRemoveWaypoint(): void;
  /** The panel's own manual on/off toggle (GM-only) -- real request: "just add a waypoint on/off toggle button instead, which the GM can press." */
  onToggleWaypoints(): void;
  /** GM-only distance-metric setting (the panel's expanded state) -- 1 = Manhattan, 2 = Euclidean, any other positive number = the general Minkowski-n case. */
  onSetDistanceMetric(p: number): void;
}

export interface WaypointPanelController {
  /** Same "poll fresh every tick, skip the rebuild when nothing relevant changed" idiom turnTracker.ts's own update() uses. */
  update(): void;
  destroy(): void;
}

export function mountWaypointPanel(dockElement: HTMLElement, options: WaypointPanelOptions): WaypointPanelController {
  const container = document.createElement("div");
  container.innerHTML = `
    <style>
      .waypoint-panel { position: absolute; top: 0; left: 100%; margin-left: 6px; width: 150px; background: rgba(20,20,24,0.92); border: 1px solid rgba(200,200,200,0.4); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; font-size: 13px; z-index: 500; }
      .waypoint-panel-title { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(200,200,200,0.3); border-radius: 6px 6px 0 0; }
      .waypoint-panel.minimized .waypoint-panel-title { border-radius: 6px; border-bottom: none; }
      .waypoint-panel-title-text { font-weight: bold; }
      .waypoint-panel-min-btn { background: none; border: none; color: #eee; cursor: pointer; font-size: 12px; padding: 0 4px; }
      .waypoint-panel-body { padding: 6px 8px; }
      .waypoint-panel-row { display: flex; gap: 4px; margin-bottom: 4px; }
      .waypoint-panel-row button { flex: 1; }
      .waypoint-panel-toggle.on { background: #2a6; color: #fff; }
      .waypoint-panel-toggle.off { background: #622; color: #fff; }
      .waypoint-panel-metric { display: flex; align-items: center; gap: 4px; font-size: 11px; margin-top: 4px; }
      .waypoint-panel-metric input { width: 40px; }
    </style>
    <div class="waypoint-panel" id="waypoint-panel">
      <div class="waypoint-panel-title" id="waypoint-panel-title">
        <span class="waypoint-panel-title-text">Waypoints</span>
        <button type="button" class="waypoint-panel-min-btn" id="waypoint-panel-min-btn" title="Minimize/restore">&#x2212;</button>
      </div>
      <div class="waypoint-panel-body" id="waypoint-panel-body">
        <div class="waypoint-panel-row">
          <button type="button" id="waypoint-add-btn" title="Add waypoint (M)">W+</button>
          <button type="button" id="waypoint-remove-btn" title="Revert waypoint (N)">W-</button>
        </div>
        <div class="waypoint-panel-row" id="waypoint-gm-controls"></div>
      </div>
    </div>
  `;
  dockElement.appendChild(container);

  const panel = container.querySelector<HTMLDivElement>("#waypoint-panel")!;
  const minBtn = container.querySelector<HTMLButtonElement>("#waypoint-panel-min-btn")!;
  const addBtn = container.querySelector<HTMLButtonElement>("#waypoint-add-btn")!;
  const removeBtn = container.querySelector<HTMLButtonElement>("#waypoint-remove-btn")!;
  const gmControls = container.querySelector<HTMLDivElement>("#waypoint-gm-controls")!;

  let minimized = false;
  function setMinimized(next: boolean): void {
    minimized = next;
    panel.classList.toggle("minimized", minimized);
    minBtn.innerHTML = minimized ? "&#x25A1;" : "&#x2212;";
    renderGmControls(); // the metric dropdown only shows when NOT minimized -- see its own doc
  }
  minBtn.addEventListener("click", () => setMinimized(!minimized));

  addBtn.addEventListener("click", () => options.onAddWaypoint());
  removeBtn.addEventListener("click", () => options.onRemoveWaypoint());

  function renderGmControls(): void {
    if (!options.isGM()) {
      gmControls.innerHTML = "";
      return;
    }
    const enabled = options.isWaypointsEnabled();
    gmControls.innerHTML = `
      <button type="button" id="waypoint-toggle-btn" class="waypoint-panel-toggle ${enabled ? "on" : "off"}">Waypoints: ${enabled ? "ON" : "OFF"}</button>
    `;
    container.querySelector<HTMLButtonElement>("#waypoint-toggle-btn")!.addEventListener("click", () => options.onToggleWaypoints());

    if (!minimized) {
      const metricRow = document.createElement("div");
      metricRow.className = "waypoint-panel-metric";
      metricRow.innerHTML = `
        <label for="waypoint-metric-input">Distance metric (p):</label>
        <input type="number" id="waypoint-metric-input" min="0.1" step="0.5" value="${options.distanceMetricP()}" />
      `;
      gmControls.appendChild(metricRow);
      const metricInput = metricRow.querySelector<HTMLInputElement>("#waypoint-metric-input")!;
      function commitMetric(): void {
        const value = Number(metricInput.value);
        if (Number.isFinite(value) && value > 0) options.onSetDistanceMetric(value);
      }
      metricInput.addEventListener("blur", commitMetric);
      metricInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") commitMetric();
      });
    }
  }

  let lastIsGM = options.isGM();
  let lastEnabled = options.isWaypointsEnabled();
  let lastMetric = options.distanceMetricP();
  renderGmControls();

  return {
    update(): void {
      const isGMNow = options.isGM();
      const enabledNow = options.isWaypointsEnabled();
      const metricNow = options.distanceMetricP();
      if (isGMNow === lastIsGM && enabledNow === lastEnabled && metricNow === lastMetric) return;
      lastIsGM = isGMNow;
      lastEnabled = enabledNow;
      lastMetric = metricNow;
      renderGmControls();
    },
    destroy(): void {
      container.remove();
    },
  };
}

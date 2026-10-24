// docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- the small
// panel docked to the RIGHT edge of the turn-order tracker widget
// (mounted as a CHILD of turnTracker.ts's own `getDockElement()`, so
// it automatically follows that panel when dragged and is hidden
// whenever the tracker itself is, with no position/visibility
// tracking of its own).
//
// Real correction, 2026-10-23: NOT the tracker's own "minimize to
// just the title bar" style -- this should collapse the same way
// chatPanel.ts does (a persistent panel that shrinks down to a thin
// strip, collapsing back toward whatever it's anchored to -- here,
// toward the turn tracker on its left -- rather than toward a screen
// edge). The toggle button stays visible even collapsed, same as
// chat's own `.chat-toggle`.
//
// Entirely vertical, for a GM or non-GM alike: W+, W-, a color
// picker (everyone's own, not GM-only), then (GM-only) the distance-
// metric label+input, then the on/off toggle at the bottom.
//
// Deliberately noa/room-free (same reasoning as turnTracker.ts/
// characterContextMenu.ts) -- all data and actions come in via
// injected callbacks/update(), so this stays jsdom-testable.

const COLLAPSED_WIDTH = 28;

/**
 * Real request: explain what the Minkowski exponent `p` does WITHOUT
 * math jargon -- verified comprehensible by two independent, context-
 * free readers (shown only this string plus "it's a tooltip in a
 * TTRPG game") before landing on this wording; the first, more
 * literally mathematical draft ("distance formula exponent... 2 =
 * Euclidean... 1 = Manhattan") was confirmed understandable but less
 * clear than this one, which leads with the in-game EFFECT (movement
 * cost) rather than the underlying formula.
 */
const DISTANCE_METRIC_TOOLTIP = "Diagonal movement cost (p). 1 = no diagonal shortcuts (grid steps only). 1.5 ≈ Pathfinder diagonals. 2 = true/real-world distance.";

export interface WaypointPanelOptions {
  /** Real correction, 2026-10-23: tied to the G-key gmOverride toggle, not just real admin status -- same gate every other "GM-only" turn-tracker control uses, so a GM previewing the player view (G off) sees only the universal controls (W+/W-/color). Gates the on/off toggle and the distance-metric input. */
  isGM: () => boolean;
  isWaypointsEnabled: () => boolean;
  distanceMetricP: () => number;
  /** [r,g,b] in 0..1, same convention characterToken.ts's own color editor uses. */
  waypointColor: () => [number, number, number];
  /** Shared by the M keybind and this button (net.ts wires both to the same waypoints.ts action). */
  onAddWaypoint(): void;
  /** Shared by the N keybind and this button. */
  onRemoveWaypoint(): void;
  /** Real request: "add a little color picker for them in the waypoint window" -- everyone picks their OWN waypoint color (not GM-only), real bug found live: the marker/line material only set diffuseColor with lighting disabled, which renders black -- "if the waypoint 3d lines and spheres were supposed to be yellow, then we may have a bug on our hands." */
  onSetColor(rgb: [number, number, number]): void;
  /** The panel's own manual on/off toggle (GM-only) -- real request: "just add a waypoint on/off toggle button instead, which the GM can press." */
  onToggleWaypoints(): void;
  /** GM-only distance-metric setting -- 1 = Manhattan, 2 = Euclidean, any other positive number = the general Minkowski-n case. */
  onSetDistanceMetric(p: number): void;
}

export interface WaypointPanelController {
  /** Same "poll fresh every tick, skip the rebuild when nothing relevant changed" idiom turnTracker.ts's own update() uses. */
  update(): void;
  destroy(): void;
}

function colorToHex([r, g, b]: [number, number, number]): string {
  const toHex = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToColor(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

export function mountWaypointPanel(dockElement: HTMLElement, options: WaypointPanelOptions): WaypointPanelController {
  const container = document.createElement("div");
  container.innerHTML = `
    <style>
      .waypoint-panel { position: absolute; top: 0; left: 100%; margin-left: 6px; width: 110px; display: flex; flex-direction: column; background: rgba(20,20,24,0.92); border: 1px solid rgba(200,200,200,0.4); border-radius: 6px; font-family: system-ui, sans-serif; color: #eee; font-size: 12px; z-index: 500; overflow: hidden; }
      /* Real correction: collapses toward the LEFT edge, same spot it's already anchored to (right next to the turn tracker) -- "collapse to the left into turn order and collapse the whole panel area there," same shrink-in-place mechanic chatPanel.ts's own .collapsed uses, not a separate minimize-to-title-bar scheme. */
      .waypoint-panel.collapsed { width: ${COLLAPSED_WIDTH}px !important; }
      .waypoint-panel.collapsed .waypoint-panel-body { display: none; }
      .waypoint-panel-header { display: flex; align-items: center; gap: 4px; padding: 4px; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(200,200,200,0.3); }
      .waypoint-panel-toggle-btn { background: none; border: none; color: #eee; cursor: pointer; font-size: 12px; padding: 0 2px; flex-shrink: 0; }
      .waypoint-panel-title-text { font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .waypoint-panel-body { display: flex; flex-direction: column; gap: 4px; padding: 6px; }
      .waypoint-panel-body button, .waypoint-panel-body input[type="color"] { width: 100%; }
      .waypoint-panel-enabled-toggle.on { background: #2a6; color: #fff; }
      .waypoint-panel-enabled-toggle.off { background: #622; color: #fff; }
      .waypoint-panel-metric-label { font-size: 11px; }
      .waypoint-panel-metric-input { width: 100%; }
    </style>
    <div class="waypoint-panel" id="waypoint-panel">
      <div class="waypoint-panel-header" id="waypoint-panel-header">
        <button type="button" class="waypoint-panel-toggle-btn" id="waypoint-panel-toggle-btn" title="Collapse/expand">&raquo;</button>
        <span class="waypoint-panel-title-text">Waypoints</span>
      </div>
      <div class="waypoint-panel-body" id="waypoint-panel-body">
        <button type="button" id="waypoint-add-btn" title="Add waypoint (M)">W+</button>
        <button type="button" id="waypoint-remove-btn" title="Revert waypoint (N)">W-</button>
        <input type="color" id="waypoint-color-input" title="Waypoint marker/line color" />
        <div id="waypoint-gm-controls"></div>
      </div>
    </div>
  `;
  dockElement.appendChild(container);

  const panel = container.querySelector<HTMLDivElement>("#waypoint-panel")!;
  const toggleCollapseBtn = container.querySelector<HTMLButtonElement>("#waypoint-panel-toggle-btn")!;
  const addBtn = container.querySelector<HTMLButtonElement>("#waypoint-add-btn")!;
  const removeBtn = container.querySelector<HTMLButtonElement>("#waypoint-remove-btn")!;
  const colorInput = container.querySelector<HTMLInputElement>("#waypoint-color-input")!;
  const gmControls = container.querySelector<HTMLDivElement>("#waypoint-gm-controls")!;

  let collapsed = false;
  function setCollapsed(next: boolean): void {
    collapsed = next;
    panel.classList.toggle("collapsed", collapsed);
    toggleCollapseBtn.innerHTML = collapsed ? "&laquo;" : "&raquo;";
  }
  toggleCollapseBtn.addEventListener("click", () => setCollapsed(!collapsed));

  addBtn.addEventListener("click", () => options.onAddWaypoint());
  removeBtn.addEventListener("click", () => options.onRemoveWaypoint());

  colorInput.value = colorToHex(options.waypointColor());
  colorInput.addEventListener("change", () => options.onSetColor(hexToColor(colorInput.value)));

  function renderGmControls(): void {
    if (!options.isGM()) {
      gmControls.innerHTML = "";
      return;
    }
    const enabled = options.isWaypointsEnabled();
    gmControls.innerHTML = `
      <label class="waypoint-panel-metric-label" for="waypoint-metric-input" title="${DISTANCE_METRIC_TOOLTIP}">p-norm:</label>
      <input type="number" class="waypoint-panel-metric-input" id="waypoint-metric-input" title="${DISTANCE_METRIC_TOOLTIP}" min="0.1" step="0.5" value="${options.distanceMetricP()}" />
      <button type="button" id="waypoint-enabled-toggle-btn" class="waypoint-panel-enabled-toggle ${enabled ? "on" : "off"}">Waypoints: ${enabled ? "ON" : "OFF"}</button>
    `;
    const metricInput = gmControls.querySelector<HTMLInputElement>("#waypoint-metric-input")!;
    function commitMetric(): void {
      const value = Number(metricInput.value);
      if (Number.isFinite(value) && value > 0) options.onSetDistanceMetric(value);
    }
    metricInput.addEventListener("blur", commitMetric);
    metricInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commitMetric();
    });
    gmControls.querySelector<HTMLButtonElement>("#waypoint-enabled-toggle-btn")!.addEventListener("click", () => options.onToggleWaypoints());
  }

  let lastIsGM = options.isGM();
  let lastEnabled = options.isWaypointsEnabled();
  let lastMetric = options.distanceMetricP();
  let lastColorHex = colorInput.value;
  renderGmControls();

  return {
    update(): void {
      const isGMNow = options.isGM();
      const enabledNow = options.isWaypointsEnabled();
      const metricNow = options.distanceMetricP();
      const colorHexNow = colorToHex(options.waypointColor());
      if (colorHexNow !== lastColorHex) {
        lastColorHex = colorHexNow;
        colorInput.value = colorHexNow;
      }
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

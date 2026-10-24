import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountWaypointPanel, type WaypointPanelController, type WaypointPanelOptions } from "./waypointPanel.js";

let dockElement: HTMLElement;
let panel: WaypointPanelController | null = null;

function mount(overrides: Partial<WaypointPanelOptions> = {}) {
  const options: WaypointPanelOptions = {
    isGM: () => true,
    isWaypointsEnabled: () => false,
    distanceMetricP: () => 2,
    onAddWaypoint: vi.fn(),
    onRemoveWaypoint: vi.fn(),
    onToggleWaypoints: vi.fn(),
    onSetDistanceMetric: vi.fn(),
    ...overrides,
  };
  panel = mountWaypointPanel(dockElement, options);
  return { panel, options };
}

beforeEach(() => {
  dockElement = document.createElement("div");
  document.body.appendChild(dockElement);
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  dockElement.remove();
});

describe("mountWaypointPanel", () => {
  it("mounts as a CHILD of the given dock element -- real request: \"attach it as a panel to the turn order on the right of it\"", () => {
    mount();
    expect(dockElement.querySelector("#waypoint-panel")).not.toBeNull();
  });

  it("W+ and W- are always visible, even for a non-GM -- real request: everyone can place/revert their own waypoints", () => {
    const { options } = mount({ isGM: () => false });
    const addBtn = dockElement.querySelector<HTMLButtonElement>("#waypoint-add-btn")!;
    const removeBtn = dockElement.querySelector<HTMLButtonElement>("#waypoint-remove-btn")!;
    addBtn.click();
    expect(options.onAddWaypoint).toHaveBeenCalledOnce();
    removeBtn.click();
    expect(options.onRemoveWaypoint).toHaveBeenCalledOnce();
  });

  it("W+/W- show their keybind as a tooltip -- \"add waypoint (m)\" / \"revert waypoint (n)\"", () => {
    mount();
    expect(dockElement.querySelector("#waypoint-add-btn")!.getAttribute("title")).toBe("Add waypoint (M)");
    expect(dockElement.querySelector("#waypoint-remove-btn")!.getAttribute("title")).toBe("Revert waypoint (N)");
  });

  it("the on/off toggle and distance-metric input are GM-only", () => {
    mount({ isGM: () => false });
    expect(dockElement.querySelector("#waypoint-toggle-btn")).toBeNull();
    expect(dockElement.querySelector("#waypoint-metric-input")).toBeNull();
  });

  it("a GM sees the on/off toggle reflecting the current waypointsEnabled state, and clicking it calls onToggleWaypoints", () => {
    const { options } = mount({ isGM: () => true, isWaypointsEnabled: () => true });
    const toggleBtn = dockElement.querySelector<HTMLButtonElement>("#waypoint-toggle-btn")!;
    expect(toggleBtn.textContent).toContain("ON");
    toggleBtn.click();
    expect(options.onToggleWaypoints).toHaveBeenCalledOnce();
  });

  it("update() reflects a toggle without a full remount", () => {
    let enabled = false;
    const { panel } = mount({ isGM: () => true, isWaypointsEnabled: () => enabled });
    expect(dockElement.querySelector("#waypoint-toggle-btn")!.textContent).toContain("OFF");

    enabled = true;
    panel.update();
    expect(dockElement.querySelector("#waypoint-toggle-btn")!.textContent).toContain("ON");
  });

  it("the distance-metric input commits on blur or Enter, ignoring a non-finite/non-positive value", () => {
    const { options } = mount({ isGM: () => true, distanceMetricP: () => 2 });
    const input = dockElement.querySelector<HTMLInputElement>("#waypoint-metric-input")!;
    expect(input.value).toBe("2");

    input.value = "0";
    input.dispatchEvent(new Event("blur"));
    expect(options.onSetDistanceMetric).not.toHaveBeenCalled();

    input.value = "1";
    input.dispatchEvent(new Event("blur"));
    expect(options.onSetDistanceMetric).toHaveBeenCalledWith(1);
  });

  it("minimizing hides the distance-metric input but keeps W+/W-/the toggle visible -- real request: \"the panel shrinks to a minimal form (buttons only, no expanded settings like the metric dropdown)\"", () => {
    mount({ isGM: () => true });
    expect(dockElement.querySelector("#waypoint-metric-input")).not.toBeNull();

    dockElement.querySelector<HTMLButtonElement>("#waypoint-panel-min-btn")!.click();

    expect(dockElement.querySelector("#waypoint-metric-input")).toBeNull();
    expect(dockElement.querySelector("#waypoint-add-btn")).not.toBeNull();
    expect(dockElement.querySelector("#waypoint-remove-btn")).not.toBeNull();
    expect(dockElement.querySelector("#waypoint-toggle-btn")).not.toBeNull();

    dockElement.querySelector<HTMLButtonElement>("#waypoint-panel-min-btn")!.click();
    expect(dockElement.querySelector("#waypoint-metric-input")).not.toBeNull(); // restored
  });
});

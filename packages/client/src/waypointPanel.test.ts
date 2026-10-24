import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountWaypointPanel, type WaypointPanelController, type WaypointPanelOptions } from "./waypointPanel.js";

let dockElement: HTMLElement;
let panel: WaypointPanelController | null = null;

function mount(overrides: Partial<WaypointPanelOptions> = {}) {
  const options: WaypointPanelOptions = {
    isGM: () => true,
    isWaypointsEnabled: () => false,
    distanceMetricP: () => 2,
    waypointColor: () => [1, 0.9, 0.2],
    onAddWaypoint: vi.fn(),
    onRemoveWaypoint: vi.fn(),
    onSetColor: vi.fn(),
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

  it("the color picker is always visible (not GM-only), reflects the current color, and calling onSetColor when changed -- real request: \"add a little color picker for them in the waypoint window\"", () => {
    const { options } = mount({ isGM: () => false, waypointColor: () => [0, 0.5, 1] });
    const colorInput = dockElement.querySelector<HTMLInputElement>("#waypoint-color-input")!;
    expect(colorInput.value.toLowerCase()).toBe("#0080ff");

    colorInput.value = "#ff0000";
    colorInput.dispatchEvent(new Event("change"));
    expect(options.onSetColor).toHaveBeenCalledWith([1, 0, 0]);
  });

  it("the on/off toggle and distance-metric input are GM-only", () => {
    mount({ isGM: () => false });
    expect(dockElement.querySelector("#waypoint-enabled-toggle-btn")).toBeNull();
    expect(dockElement.querySelector("#waypoint-metric-input")).toBeNull();
  });

  it("both the distance-metric label and input carry the SAME plain-language tooltip explaining what 'p' does", () => {
    mount({ isGM: () => true });
    const label = dockElement.querySelector("#waypoint-metric-input")!.previousElementSibling!;
    const input = dockElement.querySelector("#waypoint-metric-input")!;
    expect(label.getAttribute("title")).toBe(input.getAttribute("title"));
    expect(input.getAttribute("title")).toMatch(/pathfinder/i);
  });

  it("a GM sees the on/off toggle reflecting the current waypointsEnabled state, and clicking it calls onToggleWaypoints", () => {
    const { options } = mount({ isGM: () => true, isWaypointsEnabled: () => true });
    const toggleBtn = dockElement.querySelector<HTMLButtonElement>("#waypoint-enabled-toggle-btn")!;
    expect(toggleBtn.textContent).toContain("ON");
    toggleBtn.click();
    expect(options.onToggleWaypoints).toHaveBeenCalledOnce();
  });

  it("update() reflects a toggle without a full remount", () => {
    let enabled = false;
    const { panel } = mount({ isGM: () => true, isWaypointsEnabled: () => enabled });
    expect(dockElement.querySelector("#waypoint-enabled-toggle-btn")!.textContent).toContain("OFF");

    enabled = true;
    panel.update();
    expect(dockElement.querySelector("#waypoint-enabled-toggle-btn")!.textContent).toContain("ON");
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

  it("collapsing hides the WHOLE body (W+/W-/color/the GM section) the same way chatPanel.ts's own collapse hides its body, leaving just the header's toggle button visible/clickable", () => {
    mount({ isGM: () => true });
    expect(dockElement.querySelector("#waypoint-panel-body")).not.toBeNull();

    dockElement.querySelector<HTMLButtonElement>("#waypoint-panel-toggle-btn")!.click();

    expect(dockElement.querySelector("#waypoint-panel")!.classList.contains("collapsed")).toBe(true);
    // The body's CHILDREN remain in the DOM (CSS hides them via the
    // .collapsed rule, confirmed by class presence above, not removal)
    // -- same "content stays, just visually hidden" approach chat uses.
    expect(dockElement.querySelector("#waypoint-add-btn")).not.toBeNull();

    dockElement.querySelector<HTMLButtonElement>("#waypoint-panel-toggle-btn")!.click();
    expect(dockElement.querySelector("#waypoint-panel")!.classList.contains("collapsed")).toBe(false);
  });
});

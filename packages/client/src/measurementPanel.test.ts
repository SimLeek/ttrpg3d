import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountMeasurementPanel, type MeasurementPanelController, type MeasurementPanelOptions } from "./measurementPanel.js";

let parent: HTMLElement;
let panel: MeasurementPanelController | null = null;

function mount(overrides: Partial<MeasurementPanelOptions> = {}) {
  const options: MeasurementPanelOptions = {
    activeKind: () => undefined,
    onSelectKind: vi.fn(),
    snapMode: () => "center",
    onSetSnapMode: vi.fn(),
    broadcast: () => false,
    onSetBroadcast: vi.fn(),
    coneDegrees: () => 60,
    onSetConeDegrees: vi.fn(),
    isFrustum: () => false,
    onSetIsFrustum: vi.fn(),
    beamWidth: () => 1,
    onSetBeamWidth: vi.fn(),
    onRemoveCurrent: vi.fn(),
    onRequestLookAround: vi.fn(),
    billboardsThroughTerrain: () => false,
    onSetBillboardsThroughTerrain: vi.fn(),
    isGM: () => true,
    ftPerVoxel: () => 5,
    onSetFtPerVoxel: vi.fn(),
    ...overrides,
  };
  panel = mountMeasurementPanel(parent, options);
  return { panel, options };
}

beforeEach(() => {
  parent = document.createElement("div");
  document.body.appendChild(parent);
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  parent.remove();
});

describe("mountMeasurementPanel", () => {
  it("is its own floating panel, mounted as a child of the given parent -- NOT docked like the waypoint panel", () => {
    mount();
    expect(parent.querySelector("#measurement-panel")).not.toBeNull();
  });

  it("renders a button for every shape kind, and clicking one calls onSelectKind", () => {
    const { options } = mount();
    const cubeBtn = parent.querySelector<HTMLButtonElement>('button[data-kind="cube"]')!;
    cubeBtn.click();
    expect(options.onSelectKind).toHaveBeenCalledWith("cube");
  });

  it("marks the active shape's button, and only that one", () => {
    mount({ activeKind: () => "sphere" });
    const buttons = parent.querySelectorAll<HTMLButtonElement>(".measurement-panel-shapes button");
    for (const btn of buttons) {
      expect(btn.classList.contains("active")).toBe(btn.dataset.kind === "sphere");
    }
  });

  it("hides cone-specific settings while a different shape is active", () => {
    mount({ activeKind: () => "cube" });
    expect(parent.querySelector("#measurement-cone-degrees")).toBeNull();
  });

  it("shows cone-specific settings (degrees + frustum toggle) while cone is active, and calls onSetConeDegrees/onSetIsFrustum", () => {
    const { options } = mount({ activeKind: () => "cone" });
    const degreesInput = parent.querySelector<HTMLInputElement>("#measurement-cone-degrees")!;
    degreesInput.value = "45";
    degreesInput.dispatchEvent(new Event("change"));
    expect(options.onSetConeDegrees).toHaveBeenCalledWith(45);

    const frustumInput = parent.querySelector<HTMLInputElement>("#measurement-cone-frustum")!;
    frustumInput.checked = true;
    frustumInput.dispatchEvent(new Event("change"));
    expect(options.onSetIsFrustum).toHaveBeenCalledWith(true);
  });

  it("shows beam-specific settings (width) only while beam is active, and calls onSetBeamWidth", () => {
    const { options } = mount({ activeKind: () => "beam" });
    const widthInput = parent.querySelector<HTMLInputElement>("#measurement-beam-width")!;
    widthInput.value = "3";
    widthInput.dispatchEvent(new Event("change"));
    expect(options.onSetBeamWidth).toHaveBeenCalledWith(3);
  });

  it("the snap-mode select reflects the current value and calls onSetSnapMode when changed", () => {
    const { options } = mount({ snapMode: () => "corner" });
    const select = parent.querySelector<HTMLSelectElement>("#measurement-snap-select")!;
    expect(select.value).toBe("corner");
    select.value = "free";
    select.dispatchEvent(new Event("change"));
    expect(options.onSetSnapMode).toHaveBeenCalledWith("free");
  });

  it("the broadcast checkbox reflects the current value and calls onSetBroadcast when toggled", () => {
    const { options } = mount({ broadcast: () => true });
    const checkbox = parent.querySelector<HTMLInputElement>("#measurement-broadcast-input")!;
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(options.onSetBroadcast).toHaveBeenCalledWith(false);
  });

  it("the billboards-through-terrain checkbox reflects the current value and calls onSetBillboardsThroughTerrain when toggled -- real request: \"an option so the billboards draw over everything similar to the waypoint system\"", () => {
    const { options } = mount({ billboardsThroughTerrain: () => true });
    const checkbox = parent.querySelector<HTMLInputElement>("#measurement-billboards-through-terrain-input")!;
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(options.onSetBillboardsThroughTerrain).toHaveBeenCalledWith(false);
  });

  it("the remove-current button calls onRemoveCurrent -- real request: \"an option to remove your current measurement object in the distance dialog UI\"", () => {
    const { options } = mount();
    parent.querySelector<HTMLButtonElement>("#measurement-remove-current-btn")!.click();
    expect(options.onRemoveCurrent).toHaveBeenCalledOnce();
  });

  it("the ft-per-voxel input is GM-only", () => {
    mount({ isGM: () => false });
    expect(parent.querySelector("#measurement-ft-per-voxel")).toBeNull();
  });

  it("ft-per-voxel commits on blur, ignoring a non-finite/non-positive value", () => {
    const { options } = mount({ isGM: () => true, ftPerVoxel: () => 5 });
    const input = parent.querySelector<HTMLInputElement>("#measurement-ft-per-voxel")!;
    expect(input.value).toBe("5");

    input.value = "0";
    input.dispatchEvent(new Event("blur"));
    expect(options.onSetFtPerVoxel).not.toHaveBeenCalled();

    input.value = "10";
    input.dispatchEvent(new Event("blur"));
    expect(options.onSetFtPerVoxel).toHaveBeenCalledWith(10);
  });

  it("collapsing hides the body, leaving the toggle button visible", () => {
    mount();
    expect(parent.querySelector("#measurement-panel-body")).not.toBeNull();
    parent.querySelector<HTMLButtonElement>("#measurement-panel-toggle-btn")!.click();
    expect(parent.querySelector("#measurement-panel")!.classList.contains("collapsed")).toBe(true);
    expect(parent.querySelector("#measurement-panel-shapes")).not.toBeNull(); // content stays, just hidden via CSS
  });

  it("update() re-renders shape settings when the active kind changes", () => {
    let kind: "cone" | "beam" | undefined = "beam";
    const { panel } = mount({ activeKind: () => kind });
    expect(parent.querySelector("#measurement-beam-width")).not.toBeNull();

    kind = "cone";
    panel.update();
    expect(parent.querySelector("#measurement-beam-width")).toBeNull();
    expect(parent.querySelector("#measurement-cone-degrees")).not.toBeNull();
  });

  it("is hidden by default -- real request: \"the measure UI shouldn't just be there always as it currently is\"", () => {
    const { panel } = mount();
    expect(panel.isVisible()).toBe(false);
    // jsdom's own `.style.display` only reflects an INLINE style, not
    // the stylesheet's own default -- the inline style only gets set
    // once setVisible() is actually called (covered below), so the
    // controller's own isVisible() above is the real assertion here.
  });

  it("setVisible shows/hides the panel, same toggle shape the turn tracker's own widget uses", () => {
    const { panel } = mount();
    panel.setVisible(true);
    expect(panel.isVisible()).toBe(true);
    expect(parent.querySelector<HTMLDivElement>("#measurement-panel")!.style.display).toBe("flex");
    panel.setVisible(false);
    expect(parent.querySelector<HTMLDivElement>("#measurement-panel")!.style.display).toBe("none");
  });

  it("the Look around button calls onRequestLookAround -- real request: \"a special capture mouse button... so the player can move the camera\"", () => {
    const { options } = mount();
    parent.querySelector<HTMLButtonElement>("#measurement-look-around-btn")!.click();
    expect(options.onRequestLookAround).toHaveBeenCalledOnce();
  });
});

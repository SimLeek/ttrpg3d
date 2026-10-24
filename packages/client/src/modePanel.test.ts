import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountModePanel, type ModePanelController, type ModePanelOptions } from "./modePanel.js";

let container: HTMLElement;
let activePanel: ModePanelController | null = null;

function mount(options: ModePanelOptions): ModePanelController {
  activePanel = mountModePanel(container, options);
  return activePanel;
}

function makeOptions(initialLocked: boolean, overrides: Partial<ModePanelOptions> = {}): ModePanelOptions & { listeners: Array<(locked: boolean) => void> } {
  const listeners: Array<(locked: boolean) => void> = [];
  return {
    isPointerLocked: () => initialLocked,
    setPointerLock: vi.fn(),
    onToggleTurnTracker: vi.fn(),
    onPointerLockChange: (cb) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    listeners,
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  activePanel?.destroy();
  activePanel = null;
});

describe("mountModePanel", () => {
  it("highlights Default as active when initially pointer-locked", () => {
    mount(makeOptions(true));
    expect(container.querySelector("#mode-default")!.classList.contains("active")).toBe(true);
    expect(container.querySelector("#mode-select")!.classList.contains("active")).toBe(false);
  });

  it("highlights Select as active when initially not pointer-locked", () => {
    mount(makeOptions(false));
    expect(container.querySelector("#mode-select")!.classList.contains("active")).toBe(true);
    expect(container.querySelector("#mode-default")!.classList.contains("active")).toBe(false);
  });

  it("clicking Default calls setPointerLock(true)", () => {
    const options = makeOptions(false);
    mount(options);
    container.querySelector<HTMLButtonElement>("#mode-default")!.click();
    expect(options.setPointerLock).toHaveBeenCalledWith(true);
  });

  it("clicking Select calls setPointerLock(false)", () => {
    const options = makeOptions(true);
    mount(options);
    container.querySelector<HTMLButtonElement>("#mode-select")!.click();
    expect(options.setPointerLock).toHaveBeenCalledWith(false);
  });

  it("the Distance button is rendered disabled -- the waypoint/distance system isn't built yet", () => {
    const options = makeOptions(true);
    mount(options);
    const distance = container.querySelector<HTMLButtonElement>("#mode-distance")!;
    expect(distance.disabled).toBe(true);
  });

  it("clicking Turns calls onToggleTurnTracker (docs/BATTLE_SYSTEM.md phase 1)", () => {
    const options = makeOptions(true);
    mount(options);
    container.querySelector<HTMLButtonElement>("#mode-turns")!.click();
    expect(options.onToggleTurnTracker).toHaveBeenCalledOnce();
  });

  it("re-highlights correctly when the browser (not a button) changes pointer-lock state, via onPointerLockChange", () => {
    const options = makeOptions(true);
    mount(options);
    expect(container.querySelector("#mode-default")!.classList.contains("active")).toBe(true);

    // Simulate the browser force-exiting lock via Escape -- fires the
    // SAME callback a real noa 'lostPointerLock' event would.
    options.listeners.forEach((cb) => cb(false));

    expect(container.querySelector("#mode-default")!.classList.contains("active")).toBe(false);
    expect(container.querySelector("#mode-select")!.classList.contains("active")).toBe(true);
  });

  it("destroy() unsubscribes from pointer-lock change notifications", () => {
    const options = makeOptions(true);
    const panel = mount(options);
    expect(options.listeners).toHaveLength(1);
    panel.destroy();
    expect(options.listeners).toHaveLength(0);
  });

  it("the toggle button collapses and expands the panel", () => {
    mount(makeOptions(true));
    const panelEl = container.querySelector<HTMLDivElement>("#mode-panel")!;
    const toggle = container.querySelector<HTMLButtonElement>("#mode-toggle")!;
    expect(panelEl.classList.contains("collapsed")).toBe(false);
    toggle.click();
    expect(panelEl.classList.contains("collapsed")).toBe(true);
    toggle.click();
    expect(panelEl.classList.contains("collapsed")).toBe(false);
  });
});

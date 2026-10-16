import { describe, it, expect, beforeEach } from "vitest";
import { mountQuickActionsPanel } from "./quickActionsPanel.js";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("mountQuickActionsPanel", () => {
  it("starts collapsed by default", () => {
    mountQuickActionsPanel(container);
    expect(container.querySelector("#qa-panel")!.classList.contains("collapsed")).toBe(true);
  });

  it("the toggle button expands and re-collapses the panel", () => {
    mountQuickActionsPanel(container);
    const panel = container.querySelector<HTMLDivElement>("#qa-panel")!;
    const toggle = container.querySelector<HTMLButtonElement>("#qa-toggle")!;

    toggle.click();
    expect(panel.classList.contains("collapsed")).toBe(false);
    toggle.click();
    expect(panel.classList.contains("collapsed")).toBe(true);
  });

  it("shows a placeholder message since there are no quick actions yet", () => {
    mountQuickActionsPanel(container);
    expect(container.querySelector("#qa-body")!.textContent).toContain("No quick actions yet");
  });
});

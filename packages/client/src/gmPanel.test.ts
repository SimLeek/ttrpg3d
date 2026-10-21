import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountGmPanel, type GmPanelController, type GmPanelOptions } from "./gmPanel.js";
import { isCaptured } from "./inputCapture.js";
import type { ModManifest } from "./api.js";

let container: HTMLElement;
let activePanel: GmPanelController | null = null;

function fetchJson(url: string): Promise<Response> {
  const body: unknown = url.endsWith("/mods")
    ? ([{ id: "mod-a", name: "Mod A", version: "1.0.0", entry: "entry.ts" }] satisfies ModManifest[])
    : url.includes("/games/") && url.endsWith("/mods")
      ? []
      : [];
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

function mount(options: Partial<GmPanelOptions> = {}): GmPanelController {
  activePanel = mountGmPanel(container, {
    httpUrl: "http://test",
    gameId: "game-1",
    accountId: "account-1",
    getSeeThroughWalls: () => true,
    onSetSeeThroughWalls: vi.fn(),
    reloadWorld: vi.fn(),
    ...options,
  });
  return activePanel;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  // gmPanel.ts fetches mods via api.ts on every setVisible(true) -- no
  // existing client test file mocks global fetch (pageManager.ts/
  // chatPanel.ts's reverted Settings tab never needed to, since they
  // either had no fetch-backed test or received mod data as a prop
  // instead), so this is a local, self-contained mock just for these.
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => fetchJson(url)),
  );
});

afterEach(() => {
  activePanel?.destroy();
  activePanel = null;
  vi.unstubAllGlobals();
});

describe("mountGmPanel", () => {
  it("is hidden until setVisible(true), and hides again on setVisible(false)", () => {
    const panel = mount();
    const overlay = container.querySelector<HTMLDivElement>("#gm-panel-overlay")!;
    expect(overlay.classList.contains("open")).toBe(false);

    panel.setVisible(true);
    expect(overlay.classList.contains("open")).toBe(true);

    panel.setVisible(false);
    expect(overlay.classList.contains("open")).toBe(false);
  });

  // Real pitfall found during planning: gmOverride.ts's own KeyG handler
  // checks isCaptured() on EVERY press, including the one meant to turn
  // GM mode back off. If this panel ever claimed capture while visible,
  // that would self-lock GM mode on permanently -- this assertion guards
  // against reintroducing that.
  it("never claims input capture, even while visible", () => {
    const panel = mount();
    expect(isCaptured()).toBe(false);
    panel.setVisible(true);
    expect(isCaptured()).toBe(false);
  });

  it("the seeThroughWalls checkbox reflects the current value on becoming visible, and toggling it calls onSetSeeThroughWalls", () => {
    const onSetSeeThroughWalls = vi.fn();
    const panel = mount({ getSeeThroughWalls: () => false, onSetSeeThroughWalls });
    panel.setVisible(true);

    const checkbox = container.querySelector<HTMLInputElement>("#gm-see-through-walls")!;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(onSetSeeThroughWalls).toHaveBeenCalledWith(true);
  });

  it("fetches and renders the mods list on becoming visible", async () => {
    const panel = mount();
    panel.setVisible(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const items = container.querySelectorAll<HTMLLIElement>(".mod-list li");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain("Mod A");
  });

  it("clicking Reload calls reloadWorld and clears the dirty state", async () => {
    const reloadWorld = vi.fn();
    const panel = mount({ reloadWorld });
    panel.setVisible(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reloadBtn = container.querySelector<HTMLButtonElement>("#gm-reload-btn")!;
    expect(reloadBtn.disabled).toBe(true);

    container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.click();
    expect(reloadBtn.disabled).toBe(false);
    expect(reloadBtn.classList.contains("dirty")).toBe(true);

    reloadBtn.click();
    expect(reloadWorld).toHaveBeenCalled();
    expect(reloadBtn.disabled).toBe(true);
    expect(reloadBtn.classList.contains("dirty")).toBe(false);
  });
});

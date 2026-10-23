import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountTurnTracker, type TurnTrackerController, type TurnTrackerOptions, type TurnOrderEntryLike } from "./turnTracker.js";

let container: HTMLElement;
let tracker: TurnTrackerController | null = null;

function mount(overrides: Partial<TurnTrackerOptions> = {}) {
  const options: TurnTrackerOptions = {
    isGM: () => true,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onClearAll: vi.fn(),
    onNextTurn: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  tracker = mountTurnTracker(container, options);
  return { tracker, options };
}

function entry(turnEntryId: string, label: string, rollValue?: number): TurnOrderEntryLike {
  return { turnEntryId, label, hasRollValue: rollValue !== undefined, rollValue: rollValue ?? 0 };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  localStorage.clear();
});

afterEach(() => {
  tracker?.destroy();
  tracker = null;
  container.remove();
  localStorage.clear();
});

describe("mountTurnTracker", () => {
  it("remembers its own visibility across a remount via localStorage -- real request: \"whether it was open or not should also persist\"", () => {
    const { tracker: first } = mount();
    first.setVisible(true);
    first.destroy();
    container.remove();

    container = document.createElement("div");
    document.body.appendChild(container);
    const { tracker: second } = mount();
    expect(second.isVisible()).toBe(true);
    expect(container.querySelector<HTMLDivElement>("#turn-tracker")!.style.display).toBe("block");
  });

  it("is hidden until setVisible(true) is called", () => {
    mount();
    const panel = container.querySelector<HTMLDivElement>("#turn-tracker")!;
    expect(panel.style.display).toBe(""); // "none" comes from the stylesheet default, not an inline style yet
    expect(tracker!.isVisible()).toBe(false);

    tracker!.setVisible(true);
    expect(panel.style.display).toBe("block");
    expect(tracker!.isVisible()).toBe(true);
  });

  it("shows an empty-state message when there's no turn order yet", () => {
    const { tracker } = mount();
    tracker.update([], 0, 1);
    expect(container.querySelector("#turn-tracker-list")!.textContent).toContain("No one in the turn order yet");
    expect(container.querySelector("#turn-tracker-info")!.textContent).toContain("No turn order running");
  });

  it("renders entries in order, highlighting the current one, and shows round/turn info", () => {
    const { tracker } = mount();
    tracker.update([entry("1", "A"), entry("2", "B"), entry("3", "C")], 1, 2);

    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");
    expect(rows).toHaveLength(3);
    expect(rows[1].classList.contains("current")).toBe(true);
    expect(rows[0].classList.contains("current")).toBe(false);
    expect(container.querySelector("#turn-tracker-info")!.textContent).toBe("Round 2 -- B's turn");
  });

  it("shows a roll value for entries that have one, and nothing for entries that don't", () => {
    const { tracker } = mount();
    tracker.update([entry("1", "RolledGoblin", 14), entry("2", "ManualAdd")], 0, 1);
    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");
    expect(rows[0].querySelector(".turn-tracker-entry-roll")!.textContent).toBe("14");
    expect(rows[1].querySelector(".turn-tracker-entry-roll")).toBeNull();
  });

  it("GM-only controls (Add row, Next Turn, Clear All, per-row Remove, draggable rows) are present for a GM", () => {
    const { tracker } = mount({ isGM: () => true });
    tracker.update([entry("1", "A")], 0, 1);

    expect(container.querySelector("#turn-tracker-add-input")).not.toBeNull();
    expect(container.querySelector("#turn-tracker-next-btn")).not.toBeNull();
    expect(container.querySelector("#turn-tracker-clear-btn")).not.toBeNull();
    expect(container.querySelector(".turn-tracker-entry-remove")).not.toBeNull();
    expect(container.querySelector<HTMLLIElement>(".turn-tracker-entry")!.draggable).toBe(true);
  });

  it("GM-only controls are absent for a non-GM, who sees a read-only list", () => {
    const { tracker } = mount({ isGM: () => false });
    tracker.update([entry("1", "A")], 0, 1);

    expect(container.querySelector("#turn-tracker-add-input")).toBeNull();
    expect(container.querySelector("#turn-tracker-next-btn")).toBeNull();
    expect(container.querySelector("#turn-tracker-clear-btn")).toBeNull();
    expect(container.querySelector(".turn-tracker-entry-remove")).toBeNull();
    expect(container.querySelector<HTMLLIElement>(".turn-tracker-entry")!.draggable).toBe(false);
  });

  it("clicking Add with a non-empty label calls onAdd and clears the input", () => {
    const { tracker, options } = mount();
    tracker.update([], 0, 1);
    const input = container.querySelector<HTMLInputElement>("#turn-tracker-add-input")!;
    input.value = "Orc Captain";
    container.querySelector<HTMLButtonElement>("#turn-tracker-add-btn")!.click();
    expect(options.onAdd).toHaveBeenCalledWith("Orc Captain");
    expect(input.value).toBe("");
  });

  it("pressing Enter in the Add input also submits, and a blank/whitespace-only label is ignored", () => {
    const { tracker, options } = mount();
    tracker.update([], 0, 1);
    const input = container.querySelector<HTMLInputElement>("#turn-tracker-add-input")!;

    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(options.onAdd).not.toHaveBeenCalled();

    input.value = "Goblin";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(options.onAdd).toHaveBeenCalledWith("Goblin");
  });

  it("clicking Next Turn and Clear All call their own callbacks", () => {
    const { tracker, options } = mount();
    tracker.update([entry("1", "A")], 0, 1);
    container.querySelector<HTMLButtonElement>("#turn-tracker-next-btn")!.click();
    expect(options.onNextTurn).toHaveBeenCalledOnce();
    container.querySelector<HTMLButtonElement>("#turn-tracker-clear-btn")!.click();
    expect(options.onClearAll).toHaveBeenCalledOnce();
  });

  it("clicking a row's Remove button calls onRemove with that entry's id", () => {
    const { tracker, options } = mount();
    tracker.update([entry("1", "A"), entry("2", "B")], 0, 1);
    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");
    rows[1].querySelector<HTMLButtonElement>(".turn-tracker-entry-remove")!.click();
    expect(options.onRemove).toHaveBeenCalledWith("2");
  });

  it("dragging one row onto another calls onReorder with the dragged entry's id and the drop target's CURRENT index", () => {
    const { tracker, options } = mount();
    tracker.update([entry("1", "A"), entry("2", "B"), entry("3", "C")], 0, 1);
    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");

    rows[0].dispatchEvent(new Event("dragstart"));
    rows[2].dispatchEvent(new Event("drop", { cancelable: true }));

    expect(options.onReorder).toHaveBeenCalledWith("1", 2);
  });

  it("dropping onto itself is a no-op", () => {
    const { tracker, options } = mount();
    tracker.update([entry("1", "A"), entry("2", "B")], 0, 1);
    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");

    rows[0].dispatchEvent(new Event("dragstart"));
    rows[0].dispatchEvent(new Event("drop", { cancelable: true }));

    expect(options.onReorder).not.toHaveBeenCalled();
  });

  it("minimizing shows '<name>'s turn' in the title bar instead of 'Turn Order', and restoring reverts it", () => {
    const { tracker } = mount();
    tracker.update([entry("1", "A"), entry("2", "B")], 1, 1);
    const titleText = container.querySelector("#turn-tracker-title-text")!;
    expect(titleText.textContent).toBe("Turn Order");

    container.querySelector<HTMLButtonElement>("#turn-tracker-min-btn")!.click();
    expect(container.querySelector("#turn-tracker")!.classList.contains("minimized")).toBe(true);
    expect(titleText.textContent).toBe("B's turn");

    container.querySelector<HTMLButtonElement>("#turn-tracker-min-btn")!.click();
    expect(container.querySelector("#turn-tracker")!.classList.contains("minimized")).toBe(false);
    expect(titleText.textContent).toBe("Turn Order");
  });
});

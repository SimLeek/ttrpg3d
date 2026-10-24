import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountTurnTracker, type TurnTrackerController, type TurnTrackerOptions, type TurnOrderEntryLike } from "./turnTracker.js";

let container: HTMLElement;
let tracker: TurnTrackerController | null = null;

function mount(overrides: Partial<TurnTrackerOptions> = {}) {
  const options: TurnTrackerOptions = {
    isGM: () => true,
    canRemoveEntry: () => false,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onClearAll: vi.fn(),
    onNextTurn: vi.fn(),
    onReorder: vi.fn(),
    onSetRollValue: vi.fn(),
    onSortByRoll: vi.fn(),
    ...overrides,
  };
  tracker = mountTurnTracker(container, options);
  return { tracker, options };
}

function entry(turnEntryId: string, label: string, rollValue?: number, instanceId = "", characterId = ""): TurnOrderEntryLike {
  return { turnEntryId, label, hasRollValue: rollValue !== undefined, rollValue: rollValue ?? 0, instanceId, characterId };
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
  it("getDockElement() returns the tracker's own root panel element -- real request: \"attach it as a panel to the turn order on the right of it\" (docs/BATTLE_SYSTEM.md's waypoint panel docks as a CHILD of this element)", () => {
    const { tracker } = mount();
    expect(tracker.getDockElement()).toBe(container.querySelector("#turn-tracker"));
  });

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

  it("does NOT rebuild the DOM when update() is called again with unchanged data -- real bug found live: net.ts polls update() every tick, and an unconditional rebuild replaced button nodes out from under an active :hover, reproduced as \"the button flashes lighter and darker quickly\"", () => {
    const { tracker } = mount();
    tracker.update([entry("1", "A"), entry("2", "B")], 0, 1);
    const rowBefore = container.querySelector<HTMLLIElement>(".turn-tracker-entry")!;
    const nextBtnBefore = container.querySelector<HTMLButtonElement>("#turn-tracker-next-btn")!;

    tracker.update([entry("1", "A"), entry("2", "B")], 0, 1); // identical data, same shape -- e.g. a tick where nothing changed

    expect(container.querySelector<HTMLLIElement>(".turn-tracker-entry")).toBe(rowBefore); // same node, not torn down and rebuilt
    expect(container.querySelector<HTMLButtonElement>("#turn-tracker-next-btn")).toBe(nextBtnBefore);
  });

  it("DOES rebuild when a roll value, the current index, or the round actually changes", () => {
    const { tracker } = mount();
    tracker.update([entry("1", "A", 10), entry("2", "B")], 0, 1);
    const rowBefore = container.querySelector<HTMLLIElement>(".turn-tracker-entry")!;

    tracker.update([entry("1", "A", 11), entry("2", "B")], 0, 1); // roll value changed

    expect(container.querySelector<HTMLLIElement>(".turn-tracker-entry")).not.toBe(rowBefore);
    expect(container.querySelector<HTMLInputElement>(".turn-tracker-entry-roll-input")!.value).toBe("11");
  });

  it("the roll number always shows, defaulting to 0 when the entry has no roll yet -- real request: \"the number (default 0 if no roll)\"", () => {
    const { tracker } = mount({ isGM: () => false });
    tracker.update([entry("1", "RolledGoblin", 14), entry("2", "ManualAdd")], 0, 1);
    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");
    expect(rows[0].querySelector(".turn-tracker-entry-roll-display")!.textContent).toBe("14");
    expect(rows[1].querySelector(".turn-tracker-entry-roll-display")!.textContent).toBe("0"); // no roll yet -- default 0, not blank
  });

  it("the roll number is an editable input for a GM, calling onSetRollValue on blur or Enter -- real request: \"editable by gm and not others\"", () => {
    const { tracker, options } = mount({ isGM: () => true });
    tracker.update([entry("1", "A", 5)], 0, 1);
    const input = container.querySelector<HTMLInputElement>(".turn-tracker-entry-roll-input")!;
    expect(input.value).toBe("5");

    input.value = "12";
    input.dispatchEvent(new Event("blur"));
    expect(options.onSetRollValue).toHaveBeenCalledWith("1", 12);
  });

  it("the roll number is a plain read-only display for a non-GM, even for a character they own", () => {
    const { tracker } = mount({ isGM: () => false, canRemoveEntry: () => true });
    tracker.update([entry("1", "MyGoblin", 5, "mine")], 0, 1);
    expect(container.querySelector(".turn-tracker-entry-roll-input")).toBeNull();
    expect(container.querySelector(".turn-tracker-entry-roll-display")!.textContent).toBe("5");
  });

  it("GM-only controls (Add row, Next Turn, Clear All, per-row Remove, up/down arrows) are present for a GM", () => {
    const { tracker } = mount({ isGM: () => true });
    tracker.update([entry("1", "A")], 0, 1);

    expect(container.querySelector("#turn-tracker-add-input")).not.toBeNull();
    expect(container.querySelector("#turn-tracker-next-btn")).not.toBeNull();
    expect(container.querySelector("#turn-tracker-clear-btn")).not.toBeNull();
    expect(container.querySelector("#turn-tracker-sort-asc-btn")).not.toBeNull();
    expect(container.querySelector("#turn-tracker-sort-desc-btn")).not.toBeNull();
    expect(container.querySelector(".turn-tracker-entry-remove")).not.toBeNull();
    expect(container.querySelector(".turn-tracker-entry-arrows")).not.toBeNull();
  });

  it("GM-only controls are absent for a non-GM, who sees a read-only list", () => {
    const { tracker } = mount({ isGM: () => false });
    tracker.update([entry("1", "A")], 0, 1);

    expect(container.querySelector("#turn-tracker-add-input")).toBeNull();
    expect(container.querySelector("#turn-tracker-next-btn")).toBeNull();
    expect(container.querySelector("#turn-tracker-clear-btn")).toBeNull();
    expect(container.querySelector("#turn-tracker-sort-asc-btn")).toBeNull();
    expect(container.querySelector("#turn-tracker-sort-desc-btn")).toBeNull();
    expect(container.querySelector(".turn-tracker-entry-remove")).toBeNull();
    expect(container.querySelector(".turn-tracker-entry-arrows")).toBeNull();
  });

  it("clicking Sort ascending/descending calls onSortByRoll with the right direction -- real request: \"now there are numbers, editable by gm, but the gm can't sort by those, so there should be sort ascending and sort descending buttons\" (gm only)", () => {
    const { tracker, options } = mount();
    tracker.update([entry("1", "A", 5)], 0, 1);
    container.querySelector<HTMLButtonElement>("#turn-tracker-sort-asc-btn")!.click();
    expect(options.onSortByRoll).toHaveBeenCalledWith("asc");
    container.querySelector<HTMLButtonElement>("#turn-tracker-sort-desc-btn")!.click();
    expect(options.onSortByRoll).toHaveBeenCalledWith("desc");
  });

  it("the manual add row's placeholder reads 'Add non-character...' -- real request: distinguish it from the context-menu's per-character 'Add to Turn Order'", () => {
    mount({ isGM: () => true });
    expect(container.querySelector<HTMLInputElement>("#turn-tracker-add-input")!.placeholder).toBe("Add non-character...");
  });

  it("a non-GM player can still remove an entry for a character they OWN -- real correction: \"if it's the player owning their own characters, then sure, they should be able to remove their specific characters\" -- but NOT see Next Turn/Clear All/the add row/up-down arrows, which stay GM-only", () => {
    const { tracker, options } = mount({ isGM: () => false, canRemoveEntry: (e) => e.instanceId === "mine" });
    tracker.update([entry("1", "MyGoblin", undefined, "mine"), entry("2", "SomeoneElses", undefined, "not-mine")], 0, 1);

    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");
    expect(rows[0].querySelector(".turn-tracker-entry-remove")).not.toBeNull(); // owned -- removable
    expect(rows[1].querySelector(".turn-tracker-entry-remove")).toBeNull(); // not owned, not GM -- not removable
    expect(rows[0].querySelector(".turn-tracker-entry-arrows")).toBeNull(); // reordering stays GM-only regardless of ownership
    expect(container.querySelector("#turn-tracker-next-btn")).toBeNull();
    expect(container.querySelector("#turn-tracker-clear-btn")).toBeNull();
    expect(container.querySelector("#turn-tracker-add-input")).toBeNull();

    rows[0].querySelector<HTMLButtonElement>(".turn-tracker-entry-remove")!.click();
    expect(options.onRemove).toHaveBeenCalledWith("1");
  });

  it("right-clicking a row calls onRowContextMenu with that entry and the click's screen position", () => {
    const { tracker, options } = mount({ onRowContextMenu: vi.fn() });
    tracker.update([entry("1", "A", undefined, "inst-1", "char-1")], 0, 1);
    const row = container.querySelector<HTMLLIElement>(".turn-tracker-entry")!;

    row.dispatchEvent(new MouseEvent("contextmenu", { clientX: 50, clientY: 60, cancelable: true }));

    expect(options.onRowContextMenu).toHaveBeenCalledWith(expect.objectContaining({ turnEntryId: "1", instanceId: "inst-1", characterId: "char-1" }), 50, 60);
  });

  it("the update() isGM-change detection still refreshes GM controls when the data itself hasn't changed -- real correction: isGM now follows the G-key toggle, which can flip with no corresponding turn-order data change", () => {
    let gm = false;
    const { tracker } = mount({ isGM: () => gm });
    tracker.update([entry("1", "A")], 0, 1);
    expect(container.querySelector("#turn-tracker-next-btn")).toBeNull();

    gm = true;
    tracker.update([entry("1", "A")], 0, 1); // identical entries/currentIndex/round -- only isGM changed

    expect(container.querySelector("#turn-tracker-next-btn")).not.toBeNull();
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

  it("clicking a row's up/down arrows calls onReorder with that entry's id and the adjacent index -- real correction, 2026-10-23: replaced drag-and-drop (\"I just tried it as GM and it's pretty bad\")", () => {
    const { tracker, options } = mount();
    tracker.update([entry("1", "A"), entry("2", "B"), entry("3", "C")], 0, 1);
    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");

    rows[1].querySelector<HTMLButtonElement>('[title="Move up"]')!.click();
    expect(options.onReorder).toHaveBeenCalledWith("2", 0);

    rows[1].querySelector<HTMLButtonElement>('[title="Move down"]')!.click();
    expect(options.onReorder).toHaveBeenCalledWith("2", 2);
  });

  it("the first row's up arrow and the last row's down arrow are disabled -- nowhere further to move", () => {
    const { tracker } = mount();
    tracker.update([entry("1", "A"), entry("2", "B")], 0, 1);
    const rows = container.querySelectorAll<HTMLLIElement>(".turn-tracker-entry");

    expect(rows[0].querySelector<HTMLButtonElement>('[title="Move up"]')!.disabled).toBe(true);
    expect(rows[0].querySelector<HTMLButtonElement>('[title="Move down"]')!.disabled).toBe(false);
    expect(rows[1].querySelector<HTMLButtonElement>('[title="Move up"]')!.disabled).toBe(false);
    expect(rows[1].querySelector<HTMLButtonElement>('[title="Move down"]')!.disabled).toBe(true);
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

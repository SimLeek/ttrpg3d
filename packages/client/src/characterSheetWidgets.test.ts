import { describe, it, expect, beforeEach } from "vitest";
import { renderVariableWidget, buildVariableWidgetHtml, buildVariableChipHtml, wireVariableWidgets, xOfYMaxKey } from "./characterSheetWidgets.js";
import type { CharacterSheetVariableDef } from "@ttrpg3d/shared";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

function dispatchChange(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("change"));
}

describe("renderVariableWidget", () => {
  it("renders a plain single box for 'number', calling onChange with (id, value) on edit", () => {
    const changes: [string, number | string][] = [];
    const def: CharacterSheetVariableDef = { id: "str", label: "Strength", type: "number", default: 10 };
    renderVariableWidget(container, def, { str: 12 }, (key, value) => changes.push([key, value]));

    const input = container.querySelector<HTMLInputElement>(".sheet-widget-number")!;
    expect(input.value).toBe("12");
    dispatchChange(input, "15");
    expect(changes).toEqual([["str", 15]]);
  });

  it("renders a slider for 'range', with min/max applied and a live-updating value label", () => {
    const def: CharacterSheetVariableDef = { id: "luck", label: "Luck", type: "range", min: 0, max: 20, default: 5 };
    let changed: [string, number | string] | undefined;
    renderVariableWidget(container, def, { luck: 5 }, (key, value) => (changed = [key, value]));

    const slider = container.querySelector<HTMLInputElement>(".sheet-widget-range")!;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("20");
    expect(slider.value).toBe("5");

    slider.value = "18";
    slider.dispatchEvent(new Event("input"));
    expect(container.querySelector(".sheet-widget-range-value")!.textContent).toBe("18"); // label updates live, before "change" commits

    slider.dispatchEvent(new Event("change"));
    expect(changed).toEqual(["luck", 18]);
  });

  it("renders TWO editable boxes for 'xOfY' -- current and max both real inputs, max defaulting from def.max until the character has its own stored value (round 4)", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    const changes: [string, number | string][] = [];
    renderVariableWidget(container, def, { hp: 7 }, (key, value) => changes.push([key, value]));

    const current = container.querySelector<HTMLInputElement>(".sheet-widget-xofy-current")!;
    const max = container.querySelector<HTMLInputElement>(".sheet-widget-xofy-max")!;
    expect(current.value).toBe("7");
    expect(max.value).toBe("10"); // from def.max, nothing stored yet
    expect(max.tagName).toBe("INPUT"); // not a read-only <span>

    dispatchChange(current, "4");
    dispatchChange(max, "12");
    expect(changes).toEqual([
      ["hp", 4],
      [xOfYMaxKey("hp"), 12],
    ]);
  });

  it("an xOfY variable with a previously-stored max value uses that instead of def.max", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    renderVariableWidget(container, def, { hp: 4, [xOfYMaxKey("hp")]: 16 }, () => {});
    expect(container.querySelector<HTMLInputElement>(".sheet-widget-xofy-max")!.value).toBe("16");
  });

  it("renders a plain text box for 'text'", () => {
    const def: CharacterSheetVariableDef = { id: "alignment", label: "Alignment", type: "text", default: "Neutral" };
    let changed: [string, number | string] | undefined;
    renderVariableWidget(container, def, { alignment: "Chaotic Good" }, (key, value) => (changed = [key, value]));

    const input = container.querySelector<HTMLInputElement>(".sheet-widget-text")!;
    expect(input.value).toBe("Chaotic Good");
    dispatchChange(input, "Lawful Evil");
    expect(changed).toEqual(["alignment", "Lawful Evil"]);
  });
});

describe("buildVariableWidgetHtml / wireVariableWidgets (round 4 -- inline embedding)", () => {
  it("builds a plain HTML string that can be embedded elsewhere, then wired up separately", () => {
    const def: CharacterSheetVariableDef = { id: "str", label: "Strength", type: "number", default: 10 };
    const html = buildVariableWidgetHtml(def, { str: 14 });
    expect(html).toContain('data-var-key="str"');
    expect(html).toContain('value="14"');

    container.innerHTML = `<p>Strength: ${html}</p>`;
    let changed: [string, number | string] | undefined;
    wireVariableWidgets(container, (key, value) => (changed = [key, value]));
    dispatchChange(container.querySelector<HTMLInputElement>(".sheet-widget-number")!, "17");
    expect(changed).toEqual(["str", 17]);
  });
});

describe("buildVariableChipHtml (round 4 -- {variableId:button})", () => {
  it("builds a clickable chip showing the current value and label, for a plain variable", () => {
    const def: CharacterSheetVariableDef = { id: "str", label: "Strength", type: "number", default: 10 };
    const html = buildVariableChipHtml(def, { str: 14 });
    expect(html).toContain("chat-chip");
    expect(html).toContain('data-chip-label="Strength"');
    expect(html).toContain('data-chip-value="14"');
  });

  it("shows 'current/max' together for an xOfY variable", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    const html = buildVariableChipHtml(def, { hp: 7 });
    expect(html).toContain('data-chip-value="7/10"');
  });
});

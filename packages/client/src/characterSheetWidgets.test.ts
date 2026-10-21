import { describe, it, expect, beforeEach } from "vitest";
import { renderVariableWidget } from "./characterSheetWidgets.js";
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
  it("renders a plain single box for 'number', calling onChange on edit", () => {
    const onChange = (v: number | string) => results.push(v);
    const results: (number | string)[] = [];
    const def: CharacterSheetVariableDef = { id: "str", label: "Strength", type: "number", default: 10 };
    renderVariableWidget(container, def, 12, onChange);

    const input = container.querySelector<HTMLInputElement>(".sheet-widget-number")!;
    expect(input.value).toBe("12");
    dispatchChange(input, "15");
    expect(results).toEqual([15]);
  });

  it("renders a slider for 'range', with min/max applied and a live-updating value label", () => {
    const def: CharacterSheetVariableDef = { id: "luck", label: "Luck", type: "range", min: 0, max: 20, default: 5 };
    let changed: number | string | undefined;
    renderVariableWidget(container, def, 5, (v) => (changed = v));

    const slider = container.querySelector<HTMLInputElement>(".sheet-widget-range")!;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("20");
    expect(slider.value).toBe("5");

    slider.value = "18";
    slider.dispatchEvent(new Event("input"));
    expect(container.querySelector(".sheet-widget-range-value")!.textContent).toBe("18"); // label updates live, before "change" commits

    slider.dispatchEvent(new Event("change"));
    expect(changed).toBe(18);
  });

  it("renders two boxes for 'xOfY' -- an editable current value and a read-only max, defaulting max to the def's own default when unset", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    let changed: number | string | undefined;
    renderVariableWidget(container, def, 7, (v) => (changed = v));

    const current = container.querySelector<HTMLInputElement>(".sheet-widget-xofy-current")!;
    expect(current.value).toBe("7");
    expect(container.querySelector(".sheet-widget-xofy-max")!.textContent).toBe("10");

    dispatchChange(current, "4");
    expect(changed).toBe(4);
  });

  it("renders a plain text box for 'text'", () => {
    const def: CharacterSheetVariableDef = { id: "alignment", label: "Alignment", type: "text", default: "Neutral" };
    let changed: number | string | undefined;
    renderVariableWidget(container, def, "Chaotic Good", (v) => (changed = v));

    const input = container.querySelector<HTMLInputElement>(".sheet-widget-text")!;
    expect(input.value).toBe("Chaotic Good");
    dispatchChange(input, "Lawful Evil");
    expect(changed).toBe("Lawful Evil");
  });
});

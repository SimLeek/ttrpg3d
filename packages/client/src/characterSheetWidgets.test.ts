import { describe, it, expect, beforeEach } from "vitest";
import { renderVariableWidget, buildVariableWidgetHtml, buildVariableComponentHtml, buildVariableChipHtml, wireVariableWidgets } from "./characterSheetWidgets.js";
import { xOfYMaxKey, type CharacterSheetVariableDef } from "@ttrpg3d/shared";

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

describe("buildVariableComponentHtml (round 5 -- {variableId.x}/{variableId.y}, one box at a time)", () => {
  it("for a non-xOfY type, is identical to buildVariableWidgetHtml regardless of component", () => {
    const def: CharacterSheetVariableDef = { id: "str", label: "Strength", type: "number", default: 10 };
    expect(buildVariableComponentHtml(def, { str: 14 }, "x")).toBe(buildVariableWidgetHtml(def, { str: 14 }));
    expect(buildVariableComponentHtml(def, { str: 14 }, "y")).toBe(buildVariableWidgetHtml(def, { str: 14 }));
  });

  it("for xOfY, 'x' (or the default) renders ONLY the current box, 'y' renders ONLY the max box -- never both", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    const values = { hp: 6, [xOfYMaxKey("hp")]: 16 };

    const defaultHtml = buildVariableComponentHtml(def, values);
    expect(defaultHtml).toContain("sheet-widget-xofy-current");
    expect(defaultHtml).not.toContain("sheet-widget-xofy-max");
    expect(defaultHtml).toContain('value="6"');

    const yHtml = buildVariableComponentHtml(def, values, "y");
    expect(yHtml).toContain("sheet-widget-xofy-max");
    expect(yHtml).not.toContain("sheet-widget-xofy-current");
    expect(yHtml).toContain('value="16"');
  });

  it("the single xOfY box still wires up correctly via wireVariableWidgets", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    container.innerHTML = buildVariableComponentHtml(def, { hp: 6 }, "y");
    let changed: [string, number | string] | undefined;
    wireVariableWidgets(container, (key, value) => (changed = [key, value]));
    dispatchChange(container.querySelector<HTMLInputElement>(".sheet-widget-xofy-max")!, "20");
    expect(changed).toEqual([xOfYMaxKey("hp"), 20]);
  });

  it("real request, 2026-10-26 -- an xOfY with a live maxExpression shows the COMPUTED max, as a disabled box with no data-var-key (editing it would be silently overwritten on the next render anyway)", () => {
    const toughness: CharacterSheetVariableDef = { id: "toughness", label: "Toughness", type: "number", default: 0 };
    const hpBonus: CharacterSheetVariableDef = { id: "hpBonus", label: "HP Bonus", type: "number", default: 0 };
    const hp: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10, maxExpression: "20 + (10 * {toughness}) + {hpBonus}" };
    const defs = [toughness, hpBonus, hp];
    const values = { toughness: 5, hpBonus: 0 };

    const html = buildVariableComponentHtml(hp, values, "y", defs);
    container.innerHTML = html;
    const input = container.querySelector<HTMLInputElement>(".sheet-widget-xofy-max")!;
    expect(input.value).toBe("70");
    expect(input.disabled).toBe(true);
    expect(input.dataset.varKey).toBeUndefined();

    // Not wired as editable at all -- wireVariableWidgets only ever
    // looks at [data-var-key], which this box deliberately lacks.
    let changed: unknown;
    wireVariableWidgets(container, (key, value) => (changed = [key, value]));
    dispatchChange(input, "999");
    expect(changed).toBeUndefined();
  });
});

describe("buildVariableChipHtml (round 4/5 -- {variableId:button}, one value at a time)", () => {
  it("builds a clickable chip showing the current value and label, for a plain variable", () => {
    const def: CharacterSheetVariableDef = { id: "str", label: "Strength", type: "number", default: 10 };
    const html = buildVariableChipHtml(def, { str: 14 });
    expect(html).toContain("chat-chip");
    expect(html).toContain('data-chip-label="Strength"');
    expect(html).toContain('data-chip-value="14"');
  });

  it("for xOfY, defaults to showing just the current value, not 'current/max' together (round 5 correction)", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    const html = buildVariableChipHtml(def, { hp: 7 });
    expect(html).toContain('data-chip-value="7"');
    expect(html).not.toContain("7/10");
  });

  it("for xOfY with component 'y', shows the max value instead", () => {
    const def: CharacterSheetVariableDef = { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 };
    const html = buildVariableChipHtml(def, { hp: 7, [xOfYMaxKey("hp")]: 12 }, "y");
    expect(html).toContain('data-chip-value="12"');
  });
});

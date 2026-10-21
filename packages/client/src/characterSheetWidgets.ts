// MVP goal item 4 (docs/ROADMAP.md), slice 1 -- renders one typed
// character-sheet variable as the widget its type calls for (per the
// roadmap's own wording: a plain single value gets one box, a wide
// numeric range gets a slider, a fractional/x-of-y value gets two
// boxes). Generalizes characterToken.ts's existing bar-fill ratio math
// (`value/max -> clamped 0-1 -> pixel width`, used there for the HP/MP
// billboard bars) into a reusable, type-driven renderer -- same ratio
// clamp, just reused for a plain `<input type=range>` here instead of
// a `@babylonjs/gui` fill rect, since this file is noa-free (used by
// characters.ts, which has no 3D/game context at all).
//
// Pure DOM, no noa dependency -- same "noa-free, unit-testable"
// convention chatPanel.ts/hotbar.ts already follow.

import type { CharacterSheetVariableDef } from "@ttrpg3d/shared";

/**
 * x-of-y values are stored as a single number (the "current" half) --
 * the "max"/"y" half is the variable DEFINITION's own `max` (or, if
 * a template author didn't set one, the variable's own `default`,
 * matching how HP/maxHp both start equal for a fresh character).
 */
function xOfYMax(def: CharacterSheetVariableDef): number {
  return def.max ?? (typeof def.default === "number" ? def.default : 0);
}

/**
 * Renders `def`'s widget into `container` (appended, not replacing
 * existing content -- callers build one wrapper per variable) and
 * wires it to call `onChange` with the new value whenever the user
 * edits it. Returns nothing -- callers read the latest value back via
 * `onChange`, not by re-querying the DOM, mirroring this codebase's
 * other callback-driven DOM-overlay files (chatPanel.ts, hotbar.ts).
 */
export function renderVariableWidget(container: HTMLElement, def: CharacterSheetVariableDef, value: number | string, onChange: (next: number | string) => void): void {
  if (def.type === "xOfY") {
    const max = xOfYMax(def);
    const current = typeof value === "number" ? value : Number(value) || 0;
    const currentInput = document.createElement("input");
    currentInput.type = "number";
    currentInput.className = "sheet-widget-xofy-current";
    currentInput.value = String(current);
    currentInput.addEventListener("change", () => onChange(Number(currentInput.value) || 0));
    const separator = document.createElement("span");
    separator.textContent = " / ";
    const maxLabel = document.createElement("span");
    maxLabel.className = "sheet-widget-xofy-max";
    maxLabel.textContent = String(max);
    container.append(currentInput, separator, maxLabel);
    return;
  }

  if (def.type === "range") {
    const current = typeof value === "number" ? value : Number(value) || 0;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "sheet-widget-range";
    if (def.min !== undefined) slider.min = String(def.min);
    if (def.max !== undefined) slider.max = String(def.max);
    slider.value = String(current);
    const valueLabel = document.createElement("span");
    valueLabel.className = "sheet-widget-range-value";
    valueLabel.textContent = String(current);
    slider.addEventListener("input", () => {
      valueLabel.textContent = slider.value;
    });
    slider.addEventListener("change", () => onChange(Number(slider.value) || 0));
    container.append(slider, valueLabel);
    return;
  }

  if (def.type === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "sheet-widget-text";
    input.value = typeof value === "string" ? value : String(value);
    input.addEventListener("change", () => onChange(input.value));
    container.append(input);
    return;
  }

  // "number" -- a plain single value, one box.
  const input = document.createElement("input");
  input.type = "number";
  input.className = "sheet-widget-number";
  input.value = String(typeof value === "number" ? value : Number(value) || 0);
  input.addEventListener("change", () => onChange(Number(input.value) || 0));
  container.append(input);
}

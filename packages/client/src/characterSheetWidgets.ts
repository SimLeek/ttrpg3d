// MVP goal item 4 (docs/ROADMAP.md) -- builds/wires one typed
// character-sheet variable's widget. Generalizes characterToken.ts's
// existing bar-fill ratio math (`value/max -> clamped 0-1 -> pixel
// width`, used there for the HP/MP billboard bars) into a reusable,
// type-driven renderer -- same ratio clamp, just reused for a plain
// `<input type=range>` here instead of a `@babylonjs/gui` fill rect,
// since this file is noa-free (used by characters.ts, which has no
// 3D/game context at all).
//
// Round 4 reshape: a variable's widget now also needs to be embeddable
// INLINE inside a page's rendered markdown (via `{variableId}` --
// characters.ts's View mode), not just mounted as a standalone DOM
// node in the Core & Variables tab. That means the widget has to exist
// as an HTML STRING first (for insertion into the markdown before
// `marked.parse`+`DOMPurify`, confirmed directly: DOMPurify's default
// allowlist already includes `input`/`select`/`option` and the
// `value`/`min`/`max`/`type`/`data-*` attributes they need -- no
// sanitizer config changes required), with listener-wiring as a
// SEPARATE step applied to whatever DOM those strings end up in
// (either this file's own `renderVariableWidget` wrapper, mounting
// directly, or characters.ts's View mode, wiring up listeners on the
// whole rendered page at once). `buildVariableWidgetHtml`/
// `wireVariableWidgets` are the real implementation now;
// `renderVariableWidget` is a thin convenience wrapper over both, for
// callers (the Core & Variables tab's reserved body-size rows) that
// still just want a single mounted widget with no markdown involved.
//
// Round 5 real correction: round 4 used `buildVariableWidgetHtml`
// (BOTH boxes together for xOfY) for inline refs too -- "if it's
// xOfY you should just have to choose .x or .y to show one in the
// sheet. What you made show up in the sheet would be great for the
// settings page [where it now actually lives], which still has a
// single box for xOfY which doesn't make sense." So the split is now:
// `buildVariableWidgetHtml` (both boxes together) is ONLY for the
// Core & Variables tab's own per-variable value widget;
// `buildVariableComponentHtml`/`buildVariableChipHtml` (ONE box/chip,
// `.x`/`.y`-selectable) are for inline `{variableId}` refs.
//
// Pure DOM, no noa dependency -- same "noa-free, unit-testable"
// convention chatPanel.ts/hotbar.ts already follow.

import type { CharacterSheetVariableDef } from "@ttrpg3d/shared";

export type VariableValueMap = Readonly<Record<string, number | string>>;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function asNumber(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

/**
 * x-of-y values now store BOTH halves in `variableValues` (round 4 --
 * previously the "max" half was read-only, always the variable
 * DEFINITION's own static `def.max`). `xOfYMaxKey` is the convention
 * for where the max half lives; `def.max`/`def.default` are only the
 * INITIAL value before a character has ever set their own.
 */
export function xOfYMaxKey(variableId: string): string {
  return `${variableId}Max`;
}

function xOfYMax(def: CharacterSheetVariableDef, values: VariableValueMap): number {
  const fallback = typeof def.default === "number" ? def.default : 0;
  return asNumber(values[xOfYMaxKey(def.id)] ?? def.max, fallback);
}

function buildXOfYCurrentInputHtml(def: CharacterSheetVariableDef, values: VariableValueMap): string {
  const current = asNumber(values[def.id] ?? def.default, typeof def.default === "number" ? def.default : 0);
  return `<input type="number" class="sheet-widget-xofy-current" data-var-key="${escapeAttr(def.id)}" value="${current}" />`;
}

function buildXOfYMaxInputHtml(def: CharacterSheetVariableDef, values: VariableValueMap): string {
  return `<input type="number" class="sheet-widget-xofy-max" data-var-key="${escapeAttr(xOfYMaxKey(def.id))}" value="${xOfYMax(def, values)}" />`;
}

/** The FULL widget markup for `def`'s value in `values` -- for `xOfY`, BOTH boxes together (current and max). This is the Core & Variables tab's own per-variable value widget (round 5 -- round 4 mistakenly used this for INLINE refs too; see buildVariableComponentHtml below for the inline, one-box-at-a-time version). One `data-var-key` per interactive control. */
export function buildVariableWidgetHtml(def: CharacterSheetVariableDef, values: VariableValueMap): string {
  if (def.type === "xOfY") return `${buildXOfYCurrentInputHtml(def, values)} / ${buildXOfYMaxInputHtml(def, values)}`;

  const value = values[def.id] ?? def.default;

  if (def.type === "text") {
    return `<input type="text" class="sheet-widget-text" data-var-key="${escapeAttr(def.id)}" value="${escapeAttr(typeof value === "string" ? value : String(value))}" />`;
  }

  // "number" -- a plain single value, one box.
  return `<input type="number" class="sheet-widget-number" data-var-key="${escapeAttr(def.id)}" value="${asNumber(value, 0)}" />`;
}

/**
 * The INLINE, one-box-at-a-time widget for a `{variableId}`/
 * `{variableId.x}`/`{variableId.y}` reference (round 5 real
 * correction: "if it's xOfY you should just have to choose .x or .y
 * to show one in the sheet," not both boxes together). For `xOfY`,
 * shows ONLY the current input (`component !== "y"`) or ONLY the max
 * input (`component === "y"`) -- same `data-var-key` convention as
 * `buildVariableWidgetHtml`, so `wireVariableWidgets` needs no
 * changes. For every other type, `component` is simply ignored
 * (there's only one value regardless) -- identical to
 * `buildVariableWidgetHtml`.
 */
export function buildVariableComponentHtml(def: CharacterSheetVariableDef, values: VariableValueMap, component: "x" | "y" = "x"): string {
  if (def.type === "xOfY") return component === "y" ? buildXOfYMaxInputHtml(def, values) : buildXOfYCurrentInputHtml(def, values);
  return buildVariableWidgetHtml(def, values);
}

function resolveComponentValue(def: CharacterSheetVariableDef, values: VariableValueMap, component: "x" | "y"): number | string {
  if (def.type !== "xOfY") return values[def.id] ?? def.default;
  return component === "y" ? xOfYMax(def, values) : asNumber(values[def.id] ?? def.default, typeof def.default === "number" ? def.default : 0);
}

/** A variable rendered as a clickable chip instead of an editable box (`{variableId:button}`) -- posts the chosen component's current value to the test chat on click, same `.chat-chip` mechanism library-call buttons use. Same one-value-at-a-time `component` selection as buildVariableComponentHtml -- a chip is a single announcement, not a combined display. */
export function buildVariableChipHtml(def: CharacterSheetVariableDef, values: VariableValueMap, component: "x" | "y" = "x"): string {
  const value = resolveComponentValue(def, values, component);
  const label = def.type === "xOfY" ? `${def.label} (${component === "y" ? "max" : "current"})` : def.label;
  return `<button type="button" class="chat-chip" data-chip-label="${escapeAttr(label)}" data-chip-value="${escapeAttr(String(value))}">${escapeAttr(String(value))}</button>`;
}

/**
 * Attaches change listeners to every `[data-var-key]` control under
 * `root` (as produced by `buildVariableWidgetHtml`, mounted anywhere
 * -- a single widget host, or a whole rendered page). `onChange`
 * receives the SPECIFIC key that changed (a variable's own id, or its
 * `xOfYMaxKey` for the max half), not just "the variable changed" --
 * callers merge that one key into their own `variableValues` map.
 */
export function wireVariableWidgets(root: ParentNode, onChange: (key: string, next: number | string) => void): void {
  root.querySelectorAll<HTMLInputElement>("[data-var-key]").forEach((input) => {
    const key = input.dataset.varKey!;
    if (input.type === "text") {
      input.addEventListener("change", () => onChange(key, input.value));
    } else {
      input.addEventListener("change", () => onChange(key, Number(input.value) || 0));
    }
  });
}

/** Convenience wrapper for mounting ONE widget directly (the Core & Variables tab's reserved body-size rows) -- builds + wires in one call, no markdown/page involved. */
export function renderVariableWidget(container: HTMLElement, def: CharacterSheetVariableDef, values: VariableValueMap, onChange: (key: string, next: number | string) => void): void {
  container.innerHTML = buildVariableWidgetHtml(def, values);
  wireVariableWidgets(container, onChange);
}

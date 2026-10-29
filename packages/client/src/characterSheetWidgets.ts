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

import { xOfYMaxKey, resolveVariableValue, type CharacterSheetVariableDef } from "@ttrpg3d/shared";

export type VariableValueMap = Readonly<Record<string, number | string>>;
export type VariableDefList = readonly CharacterSheetVariableDef[];

/**
 * Real request, 2026-10-29 (inventory round): a weapon name straight
 * off the real sheet (e.g. "Set of Missiles (One-Handed\n") can carry
 * a literal trailing newline -- left as a raw byte inside an
 * attribute value, it breaks the ONE-LINE markdown table row this
 * widget usually sits in (confirmed: the whole `<input>` rendered as
 * literal escaped text instead of a real widget). `&#10;` has no
 * literal newline BYTE in the markdown source, so it can never do
 * that; the browser decodes it back to a real `\n` once parsed, same
 * entity-encoding fix the Abilities page's own chat-chip values
 * already use for a multi-paragraph description.
 */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#10;");
}

function asNumber(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

function xOfYMax(def: CharacterSheetVariableDef, values: VariableValueMap, defs: VariableDefList): number {
  const fallback = typeof def.default === "number" ? def.default : 0;
  return resolveVariableValue(def.id, "y", defs, values) ?? fallback;
}

function buildXOfYCurrentInputHtml(def: CharacterSheetVariableDef, values: VariableValueMap): string {
  const current = asNumber(values[def.id] ?? def.default, typeof def.default === "number" ? def.default : 0);
  return `<input type="number" class="sheet-widget-xofy-current" data-var-key="${escapeAttr(def.id)}" value="${current}" />`;
}

/**
 * The `data-var-key` a `maxExpression` edit arrives under
 * (`wireVariableWidgets`' own generic `onChange(key, next)`) -- `::`
 * can never appear in an ordinary variable id, so this never collides
 * with a real `variableValues`/`xOfYMaxKey` key. The CALLER (today:
 * characterSheetView.ts's own Core & Variables tab) is the one that
 * actually knows to route a key matching this shape into the sheet's
 * own variable DEFINITION (`maxExpression` is template-level, same
 * tier as label/type, not a per-character value) instead of
 * `variableValues`.
 */
export function maxExpressionFieldKey(variableId: string): string {
  return `${variableId}::maxExpression`;
}

/**
 * Real request, 2026-10-26 (second pass -- real correction after the
 * first one got this backwards): "I should see {{20+{Toughness}*10}}
 * in the y part of the xOfY for HP... when I go to the core tab or
 * other pages, THEN those should be calculated... that allows people
 * to make their own detailed sheets and add custom stuff." The Core &
 * Variables tab's own per-variable EDITOR shows/edits the RAW FORMULA
 * TEXT (wrapped in the same `{{...}}` syntax a page's own markdown
 * already uses) when `maxExpression` is set -- a session can type
 * either a plain number (flat max) or a `{{...}}` formula directly
 * into this ONE box, same as any OTHER sheet author would write a
 * derived stat's formula. `buildXOfYMaxDisplayHtml` below is the
 * OPPOSITE, read-only-computed half of this, used for an inline
 * `{variableId.y}` ref on an actual rendered PAGE.
 */
function buildXOfYMaxEditableHtml(def: CharacterSheetVariableDef, values: VariableValueMap, defs: VariableDefList): string {
  if (def.maxExpression !== undefined) {
    return `<input type="text" class="sheet-widget-xofy-max sheet-widget-xofy-max-formula" data-var-key="${escapeAttr(maxExpressionFieldKey(def.id))}" value="${escapeAttr(`{{${def.maxExpression}}}`)}" />`;
  }
  const value = xOfYMax(def, values, defs);
  return `<input type="number" class="sheet-widget-xofy-max" data-var-key="${escapeAttr(xOfYMaxKey(def.id))}" value="${value}" />`;
}

/** The read-only half of the max box, for an inline `{variableId.y}` ref on an actual rendered page -- shows the LIVE COMPUTED value (same `.computed-value` class a `{{expression}}` segment's own result already uses), never the formula text itself. A flat (non-`maxExpression`) max stays directly editable here too, same as before this feature existed -- only the live-formula case is read-only. */
function buildXOfYMaxDisplayHtml(def: CharacterSheetVariableDef, values: VariableValueMap, defs: VariableDefList): string {
  const value = xOfYMax(def, values, defs);
  if (def.maxExpression !== undefined) return `<span class="sheet-widget-xofy-max computed-value">${value}</span>`;
  return `<input type="number" class="sheet-widget-xofy-max" data-var-key="${escapeAttr(xOfYMaxKey(def.id))}" value="${value}" />`;
}

/**
 * The `data-var-key` a `valueExpression` edit arrives under -- same
 * `::`-separated convention as `maxExpressionFieldKey` above
 * (generalized, real request 2026-10-26 third pass: "Bonus on the
 * page should show the resulting number, and the core&variables
 * should show that equation you put"), just for the "x"/current side
 * of a plain `number` variable instead of xOfY's own "y"/max side.
 */
export function valueExpressionFieldKey(variableId: string): string {
  return `${variableId}::valueExpression`;
}

function resolveLiveNumberValue(def: CharacterSheetVariableDef, values: VariableValueMap, defs: VariableDefList): number {
  const fallback = typeof def.default === "number" ? def.default : 0;
  return resolveVariableValue(def.id, "x", defs, values) ?? fallback;
}

/** The Core & Variables tab's own EDITOR for a plain `number` variable's value -- same split as `buildXOfYMaxEditableHtml` above: a live `valueExpression` shows/edits the RAW `{{...}}` formula text (a session can type either a plain number or a `{{...}}` formula directly into this one box); otherwise it's just an ordinary flat, per-character number input, unchanged from before this feature existed. */
function buildNumberValueEditableHtml(def: CharacterSheetVariableDef, values: VariableValueMap): string {
  if (def.valueExpression !== undefined) {
    return `<input type="text" class="sheet-widget-number-formula" data-var-key="${escapeAttr(valueExpressionFieldKey(def.id))}" value="${escapeAttr(`{{${def.valueExpression}}}`)}" />`;
  }
  const value = asNumber(values[def.id] ?? def.default, typeof def.default === "number" ? def.default : 0);
  return `<input type="number" class="sheet-widget-number" data-var-key="${escapeAttr(def.id)}" value="${value}" />`;
}

/** The read-only half for an inline `{variableId}` ref to a plain `number` variable -- shows the LIVE COMPUTED value (`.computed-value`, same class a `{{expression}}` segment's own result uses) when `valueExpression` is set, never the formula text itself (that's the Core & Variables editor's own job, see `buildNumberValueEditableHtml`). A flat (non-`valueExpression`) number stays directly editable here too, same as before this feature existed. */
function buildNumberValueDisplayHtml(def: CharacterSheetVariableDef, values: VariableValueMap, defs: VariableDefList): string {
  if (def.valueExpression !== undefined) return `<span class="computed-value">${resolveLiveNumberValue(def, values, defs)}</span>`;
  const value = asNumber(values[def.id] ?? def.default, typeof def.default === "number" ? def.default : 0);
  return `<input type="number" class="sheet-widget-number" data-var-key="${escapeAttr(def.id)}" value="${value}" />`;
}

/** The FULL widget markup for `def`'s value in `values` -- for `xOfY`, BOTH boxes together (current and max). This is the Core & Variables tab's own per-variable value widget (round 5 -- round 4 mistakenly used this for INLINE refs too; see buildVariableComponentHtml below for the inline, one-box-at-a-time version). One `data-var-key` per interactive control, including the max box when it's a live formula (see buildXOfYMaxEditableHtml -- this is the EDITOR, so the formula text itself is what's editable here). `defs` defaults to just `[def]` -- only needed at all when `def.maxExpression`/`def.valueExpression` itself references ANOTHER variable. */
export function buildVariableWidgetHtml(def: CharacterSheetVariableDef, values: VariableValueMap, defs: VariableDefList = [def]): string {
  if (def.type === "xOfY") return `${buildXOfYCurrentInputHtml(def, values)} / ${buildXOfYMaxEditableHtml(def, values, defs)}`;

  if (def.type === "text") {
    const value = values[def.id] ?? def.default;
    // Real request, 2026-10-29 (inventory round): "the item names are
    // typically the longest, so those boxes should expand
    // preferentially" -- a plain `<input>` has no width of its own
    // beyond the browser's fixed ~20-character default, so even a
    // table cell with plenty of ROOM (a name column, naturally the
    // widest under `table-layout: auto`'s own content-based sizing)
    // still showed a cramped, fixed-width box. `width: 100%` just
    // fills whatever the surrounding cell/row already allocated it --
    // never WIDER than that, so a short text field elsewhere on a
    // sheet isn't stretched awkwardly either.
    return `<input type="text" class="sheet-widget-text" data-var-key="${escapeAttr(def.id)}" value="${escapeAttr(typeof value === "string" ? value : String(value))}" style="width: 100%; box-sizing: border-box;" />`;
  }

  // "number" -- a plain single value box, or (real request, 2026-10-26,
  // third pass) a LIVE FORMULA editor when valueExpression is set --
  // same idea as xOfY's own max-formula editor above, generalized to
  // the "x" side.
  return buildNumberValueEditableHtml(def, values);
}

/**
 * The INLINE, one-box-at-a-time widget for a `{variableId}`/
 * `{variableId.x}`/`{variableId.y}` reference (round 5 real
 * correction: "if it's xOfY you should just have to choose .x or .y
 * to show one in the sheet," not both boxes together). For `xOfY`,
 * shows ONLY the current input (`component !== "y"`) or ONLY the max
 * display (`component === "y"` -- see buildXOfYMaxDisplayHtml, the
 * COMPUTED half, not the editor's own formula-text half) -- same
 * `data-var-key` convention as `buildVariableWidgetHtml` for
 * everything that's still actually editable here, so
 * `wireVariableWidgets` needs no changes. For every other type,
 * `component` is simply ignored (there's only one value regardless)
 * -- identical to `buildVariableWidgetHtml`.
 */
export function buildVariableComponentHtml(def: CharacterSheetVariableDef, values: VariableValueMap, component: "x" | "y" = "x", defs: VariableDefList = [def]): string {
  if (def.type === "xOfY") return component === "y" ? buildXOfYMaxDisplayHtml(def, values, defs) : buildXOfYCurrentInputHtml(def, values);
  // Real request, 2026-10-26 (third pass): an inline ref to a plain
  // `number` variable with a live `valueExpression` (e.g. a skill's
  // own Bonus) shows the COMPUTED number here, same split as xOfY's
  // own max above -- never the formula text (that's the Core &
  // Variables editor's own job, buildVariableWidgetHtml).
  if (def.type === "number") return buildNumberValueDisplayHtml(def, values, defs);
  return buildVariableWidgetHtml(def, values, defs);
}

function resolveComponentValue(def: CharacterSheetVariableDef, values: VariableValueMap, component: "x" | "y", defs: VariableDefList): number | string {
  if (def.type === "xOfY") return component === "y" ? xOfYMax(def, values, defs) : asNumber(values[def.id] ?? def.default, typeof def.default === "number" ? def.default : 0);
  if (def.type === "number" && def.valueExpression !== undefined) return resolveLiveNumberValue(def, values, defs);
  return values[def.id] ?? def.default;
}

/** A variable rendered as a clickable chip instead of an editable box (`{variableId:button}`) -- posts the chosen component's current value to the test chat on click, same `.chat-chip` mechanism library-call buttons use. Same one-value-at-a-time `component` selection as buildVariableComponentHtml -- a chip is a single announcement, not a combined display. */
export function buildVariableChipHtml(def: CharacterSheetVariableDef, values: VariableValueMap, component: "x" | "y" = "x", defs: VariableDefList = [def]): string {
  const value = resolveComponentValue(def, values, component, defs);
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
/**
 * Real request, 2026-10-28: "each class should be a dropdown with
 * the specific class selected, each breakthrough the same, same with
 * race and sub-race" -- a `<select data-var-key="...">`, baked
 * directly into a mod's own page markdown (same "literal HTML a mod
 * bakes in" precedent the Abilities page's own rows already use,
 * e.g. packages/server/mods/lyrian-chronicles/entry.ts's own
 * `selectHtml`), needs the SAME text-not-number treatment a plain
 * `<input type="text">` already gets -- a `<select>` element's own
 * `.type` is never `"text"` (it's `"select-one"`/`"select-multiple"`),
 * so without this it would fall into the number-coercion branch and
 * turn a race/class NAME into `0`.
 */
export function wireVariableWidgets(root: ParentNode, onChange: (key: string, next: number | string) => void): void {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-var-key]").forEach((input) => {
    const key = input.dataset.varKey!;
    if (input.tagName === "SELECT" || input.type === "text") {
      input.addEventListener("change", () => onChange(key, input.value));
    } else if (input.type === "checkbox") {
      // Real request, 2026-10-29 (inventory round): "Armor Equipped?"/
      // each injury flag is a genuine checkbox baked directly into a
      // page's own markdown (mods/lyrian-chronicles/entry.ts's own
      // `checkboxHtml`) -- there's no boolean variable type (same
      // "stored as 0/1" tier `oldArmorCalc` already uses), so a
      // checkbox's OWN `.checked` state (not `.value`, which is
      // always the literal string "on") is what this needs to read.
      input.addEventListener("change", () => onChange(key, (input as HTMLInputElement).checked ? 1 : 0));
    } else {
      input.addEventListener("change", () => onChange(key, Number(input.value) || 0));
    }
  });
}

/** Convenience wrapper for mounting ONE widget directly (the Core & Variables tab's reserved body-size rows AND its own per-variable list) -- builds + wires in one call, no markdown/page involved. */
export function renderVariableWidget(container: HTMLElement, def: CharacterSheetVariableDef, values: VariableValueMap, onChange: (key: string, next: number | string) => void, defs: VariableDefList = [def]): void {
  container.innerHTML = buildVariableWidgetHtml(def, values, defs);
  wireVariableWidgets(container, onChange);
}

// The tabbed character-sheet UI (Core & Variables + one tab per page) --
// extracted from characters.ts (MVP goal item 4 follow-up, "characters"
// tab/popup) so the standalone /characters page, the in-game popup, and
// the pop-out browser window can all mount the exact SAME sheet-rendering
// logic instead of three copies of it. characters.ts keeps its own
// mods-list/char-list/test-chat-panel page chrome and calls
// `mountCharacterSheetView` for whichever character is selected.
//
// `canEdit: false` (a shared/visible character you don't own or admin)
// drops the "Core & Variables" tab entirely and forces every page into
// View mode (no Edit button) -- interactive (roll chips, edit CURRENT
// values inline) but not editable at the structural level. `canEdit: true`
// is pixel-for-pixel what characters.ts already did before this
// extraction -- a pure module-boundary refactor, not a behavior change
// for that page.
//
// `onPostToChat(label, value)` replaces the old hardcoded
// `testChatPanel.addMessage(...)` call -- the CALLER decides where a
// resolved chip's value actually goes (characters.ts's own local test
// chat panel; the in-game popup/popout's REAL chat, attributed to this
// character via chatNet.ts's `asCharacterId`).
//
// Still true from characters.ts's own history: nothing that dispatches
// its own click/change event ever rebuilds its OWN parent container's
// innerHTML from within that same handler -- only a DIFFERENT button/
// action rebuilds a given sub-tree; the element currently handling an
// event only ever toggles its own classes/attributes in place, or
// triggers a rebuild of some OTHER sibling sub-tree.

import { marked } from "marked";
import DOMPurify from "dompurify";
import { RESERVED_CHARACTER_VARIABLES, RESERVED_TOKEN_IMAGE_VARIABLES, computeMissingModDependencies, findVariableRefs, findLibraryCalls, findExpressionSegments, findCompoundRollSegments, evaluateCharacterSheetExpression, resolveVariableValue, xOfYMaxKey, type CharacterSheetVariableDef, type CharacterSheetVariableType, type CharacterSheetPageDef, type CharacterSheetBarDef } from "@ttrpg3d/shared";
import { fetchCharacterSheetTemplates, fetchCharacterSheetPreview, updateCharacterSheet, uploadImage, importCharacterSheetFromWorkbook, type CharacterRecord, type CharacterSheetTemplateCatalogEntry, type CharacterSheetLibraryCatalogEntry } from "./api.js";
import { renderVariableWidget, buildVariableComponentHtml, buildVariableChipHtml, wireVariableWidgets, maxExpressionFieldKey, valueExpressionFieldKey } from "./characterSheetWidgets.js";
import type { ModActionFn, ModActionOutcome } from "./modActions.js";
import { colorToHex, hexToColor } from "./lobby.js";
import { fetchAndParseWorkbook } from "./characterSheetImport.js";

const VARIABLE_TYPES: CharacterSheetVariableType[] = ["number", "xOfY", "text"];
const SAVE_DEBOUNCE_MS = 500;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface CharacterSheetViewOptions {
  httpUrl: string;
  /** Who's actually viewing/editing right now -- used for the save REST call's `accountId` (the server checks THIS account's permission, owner or admin, not sheetOwnerAccountId). */
  viewerAccountId: string;
  /** The character's OWNER's account -- resolves library calls/templates against THEIR imports, not the viewer's (a popup may show someone else's character). */
  sheetOwnerAccountId: string;
  character: CharacterRecord;
  templates: CharacterSheetTemplateCatalogEntry[];
  libraries: CharacterSheetLibraryCatalogEntry[];
  /** For the dependency warning -- scoped to sheetOwnerAccountId. */
  importedModIds: string[];
  /** false: no "Core & Variables" tab, no Edit-mode button on pages, every page forced into View -- a shared/visible character you don't own or admin is interactive (roll chips, edit CURRENT values inline) but not editable at the structural level. */
  canEdit: boolean;
  /**
   * Real request, 2026-10-26 (traits & abilities round): registered
   * client-side functions a mod's own page markdown can trigger via a
   * literal `<button data-mod-action="modId.actionName">` (see
   * modActions.ts's own header for why this is a THIRD, distinct
   * mechanism from a plain `{{expression}}` or a `{{modId.fn()}}`
   * library call). Optional -- every EXISTING caller that doesn't
   * pass one simply never matches any `[data-mod-action]` button
   * (there's nothing to look up), same as before this option existed.
   * Every real caller passes the SAME shared `MOD_ACTIONS` constant,
   * same as `templates`/`libraries` already are.
   */
  modActions?: Readonly<Record<string, Readonly<Record<string, ModActionFn>>>>;
  /**
   * `html`, real request 2026-10-26: "when moused over that special
   * 22 should display the formula behind it." Optional, sanitized-
   * HTML-safe richer rendering of the SAME result `value` already
   * covers as a plain fallback -- `value` alone stays safe/plain for
   * every EXISTING caller that doesn't care (the standalone page's
   * own test chat panel is the only one that currently renders it;
   * the in-game/popup/popout callers simply never look at this third
   * argument, and get `value`'s own new simplification -- a bare "22",
   * not the full un-substituted formula -- for free either way).
   */
  onPostToChat(label: string, value: string, html?: string): void;
  /** Fired after every successful save (debounced edits included) -- the caller decides what to do with the fresh record (characters.ts updates its own list; the popup/popout mostly just ignores it). */
  onSaved?(updated: CharacterRecord): void;
}

export interface CharacterSheetViewController {
  /** Pushes fresh templates/libraries/importedModIds in (e.g. after a mod import/removal) -- re-renders the dependency warning, and the Core & Variables tab's content if it's the one currently showing. Same "push data in after mount" shape the rest of this project's panels use. */
  refresh(templates: CharacterSheetTemplateCatalogEntry[], libraries: CharacterSheetLibraryCatalogEntry[], importedModIds: string[]): void;
}

export function mountCharacterSheetView(container: HTMLElement, options: CharacterSheetViewOptions): CharacterSheetViewController {
  const { httpUrl, viewerAccountId, sheetOwnerAccountId } = options;
  const character = options.character;
  let templates = options.templates;
  let libraries = options.libraries;
  let importedModIds = options.importedModIds;
  const canEdit = options.canEdit;

  /** "core" = the Core & Variables tab; a number = that page's index. Defaults to the first PAGE (not "core") -- you want to see their sheet, not settings, by default. Never "core" at all when !canEdit (that tab doesn't exist for a read-only viewer). */
  let selectedSheetTab: "core" | number = 0;
  let pageMode: "view" | "edit" = "view";
  // Re-bound after every full rebuild (renderStartPrompt/renderSheetShell
  // replace `container.innerHTML` wholesale, so any earlier reference
  // would be stale) rather than queried once up front.
  let dependencyWarningEl: HTMLDivElement;
  let sheetTabsEl: HTMLDivElement;
  let sheetTabContentEl: HTMLDivElement;

  /** Persists templateId/customSheet/variableValues wholesale -- no per-field endpoint. */
  function saveSheet(): void {
    void updateCharacterSheet(httpUrl, character.id, viewerAccountId, character.templateId, character.customSheet, character.variableValues).then((updated) => {
      options.onSaved?.(updated);
    });
  }

  function renderVariableRow(parent: HTMLElement, def: CharacterSheetVariableDef): void {
    const row = document.createElement("div");
    row.className = "variable-row";
    const label = document.createElement("label");
    label.textContent = def.label;
    const widgetHost = document.createElement("span");
    renderVariableWidget(
      widgetHost,
      def,
      character.variableValues,
      (key, next) => {
        character.variableValues = { ...character.variableValues, [key]: next };
        saveSheet();
      },
      allVariableDefs(),
    );
    row.append(label, widgetHost);
    parent.append(row);
  }

  /**
   * docs/CHARACTER_SHEET_IMPORT.md, part 2 -- the reserved `tokenImage`
   * variable's own editor row. Reuses `renderVariableRow`'s plain text
   * widget above for manually typing/pasting a URL directly, and adds
   * a file picker alongside it that uploads the chosen image and
   * fills that SAME text widget's value in (same `onChange` write-
   * back `saveSheet` already uses) -- one value, two ways to set it,
   * not two competing fields.
   */
  function renderTokenImageUpload(parent: HTMLElement, def: CharacterSheetVariableDef): void {
    renderVariableRow(parent, def);
    const row = document.createElement("div");
    row.className = "variable-row";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      void uploadImage(httpUrl, viewerAccountId, file).then(({ url }) => {
        character.variableValues = { ...character.variableValues, [def.id]: url };
        saveSheet();
        renderCoreTabContent(); // refreshes the plain-text widget above so it shows the newly-uploaded URL
      });
    });
    row.append(fileInput);
    parent.append(row);
  }

  /** Looks up a variable's definition wherever it might live -- the sheet's own variables, or a core reserved one -- for resolving a `{variableId}` reference found in a page's markdown. */
  function findVariableDef(variableId: string): CharacterSheetVariableDef | undefined {
    return character.customSheet!.variables.find((v) => v.id === variableId) ?? RESERVED_CHARACTER_VARIABLES.find((v) => v.id === variableId);
  }

  /** Every variable def this character's sheet knows about -- passed to resolveVariableValue/evaluateCharacterSheetExpression so a `.y` ref or `{{expression}}` against a variable with a live `maxExpression` resolves it, not just a flat stored lookup. */
  function allVariableDefs(): CharacterSheetVariableDef[] {
    return [...character.customSheet!.variables, ...RESERVED_CHARACTER_VARIABLES];
  }

  /**
   * Real bug, found live: a character that just "started from
   * template" (renderStartPrompt's start-blank/start-template
   * buttons) has an EMPTY `variableValues` -- every variable's own
   * widget already falls back to its own declared `default` at
   * render time (buildVariableComponentHtml's own `values[id] ??
   * def.default`), but `evaluateCharacterSheetExpression`/
   * `substituteVariableRefs` only ever look directly in
   * `variableValues` with no concept of a declared default at all, so
   * an expression referencing a never-explicitly-set variable (e.g.
   * `{{...{toughness}...}}` before a real import) fails with "unknown
   * or non-numeric variable" even though the PAGE's own plain
   * `{toughness}` box next to it shows a sensible 0. This builds the
   * SAME effective value every widget already uses, so an
   * expression sees exactly what's visibly on the page, with or
   * without a real import.
   */
  function effectiveVariableValues(): Record<string, number | string> {
    const result: Record<string, number | string> = { ...character.variableValues };
    const defs = allVariableDefs();
    for (const def of defs) {
      if (result[def.id] === undefined) result[def.id] = def.default;
      // A live `maxExpression` (real request, 2026-10-26) always wins
      // over any stored max key -- resolveVariableValue never reads
      // this fallback in that case, so there's nothing to seed here.
      if (def.type === "xOfY" && def.maxExpression === undefined) {
        const maxKey = xOfYMaxKey(def.id);
        if (result[maxKey] === undefined) result[maxKey] = typeof def.max === "number" ? def.max : def.default;
      }
    }
    // Real bug, found live (2026-10-26, third pass -- skills rework):
    // a variable with a live `valueExpression`/`maxExpression` (e.g. a
    // skill's own Bonus = governing substat + skill points) has a
    // STALE flat value in `result` above (whatever was last imported/
    // stored, never the live formula's own result) -- harmless for
    // every CLIENT-side evaluation (`resolveVariableValue`, used by
    // every `evaluateCharacterSheetExpression` call below, always
    // ignores the flat value in favor of the live formula when one
    // exists), but this flat map is ALSO exactly what gets POSTED to
    // the server for a genuine dice roll (`fetchCharacterSheetPreview`'s
    // own `variableValues` body, e.g. every skill's own roll) -- the
    // server has no `defs` of its own to resolve the formula WITH, so
    // it would roll against the stale number instead. Overlaying each
    // one's own LIVE value here, right before anything reads this map,
    // closes that gap at its one source.
    for (const def of defs) {
      if (def.valueExpression !== undefined) {
        const live = resolveVariableValue(def.id, "x", defs, result);
        if (live !== undefined) result[def.id] = live;
      }
      if (def.type === "xOfY" && def.maxExpression !== undefined) {
        const live = resolveVariableValue(def.id, "y", defs, result);
        if (live !== undefined) result[xOfYMaxKey(def.id)] = live;
      }
    }
    return result;
  }

  // ---- dependency warning -------------------------------------------

  function renderDependencyWarning(): void {
    if (!character.templateId) {
      dependencyWarningEl.innerHTML = "";
      return;
    }
    const selectedTemplate = templates.find((t) => t.modId === character.templateId);
    const requiredModIds = [character.templateId, ...(selectedTemplate?.manifest.dependencies ?? [])];
    const missing = computeMissingModDependencies(requiredModIds, importedModIds);
    dependencyWarningEl.innerHTML =
      missing.length > 0
        ? `<div class="dependency-warning">This character's sheet needs mod${missing.length > 1 ? "s" : ""} not currently imported: ${missing.join(", ")}. Import ${missing.length > 1 ? "them" : "it"} above, or any library calls on the sheet will show as missing.</div>`
        : "";
  }

  // ---- a page's content: Edit (raw markdown) XOR View (rendered) -----

  function renderEditMode(page: CharacterSheetPageDef, hostEl: HTMLElement): void {
    const textarea = document.createElement("textarea");
    textarea.className = "page-markdown";
    textarea.placeholder = "Write this page's content in Markdown...";
    textarea.value = page.markdown;
    hostEl.append(textarea);

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    textarea.addEventListener("input", () => {
      page.markdown = textarea.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => saveSheet(), SAVE_DEBOUNCE_MS);
    });
  }

  function renderViewMode(page: CharacterSheetPageDef, hostEl: HTMLElement): void {
    const previewEl = document.createElement("div");
    previewEl.className = "markdown page-preview";
    previewEl.textContent = "Loading...";
    hostEl.append(previewEl);

    // One shared class/data-attribute pair for EVERY clickable chip on
    // this page, whether it came from a library call's default
    // "button" display or a variable ref's opt-in `{id:button}` --
    // same posting mechanism either way.
    previewEl.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(".chat-chip");
      if (!chip) return;
      options.onPostToChat(chip.dataset.chipLabel ?? "", chip.dataset.chipValue ?? "", chip.dataset.chipHtml);
    });

    // Real request, 2026-10-26 (traits & abilities round): a literal
    // `<button data-mod-action="modId.actionName">`, written directly
    // into a mod's own page markdown (plain inline HTML -- marked/
    // DOMPurify already pass this through untouched, same as every
    // OTHER widget string this file injects before parsing). Entirely
    // client-side -- no server round trip for the ACTION itself (an
    // action may still fetch its own read-only reference data, e.g.
    // an ability catalog, same as any other client code can).
    //
    // Real generalization, 2026-10-28 (Abilities round): the action
    // is handed an `apply` CALLBACK instead of returning a plain
    // patch -- see modActions.ts's own header for why ("Add Ability"
    // opens a search popup and only knows what to commit once a
    // result is actually picked, an indeterminate time later; "Auto-
    // Populate Abilities" needs new variable DEFS and a page-markdown
    // edit, not just values). `apply` may run zero times (the session
    // cancels out of a popup), once (the common case), or more than
    // once; each call independently merges-and-re-renders, so an
    // action never needs to batch everything into one call itself.
    previewEl.addEventListener("click", (event) => {
      const actionBtn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-mod-action]");
      if (!actionBtn || actionBtn.disabled) return;
      const [modId, actionName] = (actionBtn.dataset.modAction ?? "").split(".");
      const action = options.modActions?.[modId]?.[actionName];
      if (!action) return;
      const apply = (outcome: ModActionOutcome): void => {
        if (outcome.variableValues) character.variableValues = { ...character.variableValues, ...outcome.variableValues };
        const vars = character.customSheet!.variables;
        for (const v of outcome.variables ?? []) {
          const idx = vars.findIndex((existing) => existing.id === v.id);
          if (idx === -1) vars.push(v);
          else vars[idx] = v;
        }
        for (const edit of outcome.pageEdits ?? []) {
          const target = character.customSheet!.pages.find((p) => p.title === edit.pageTitle);
          if (!target) continue;
          if (edit.replaceMarkdown !== undefined) target.markdown = edit.replaceMarkdown;
          else if (edit.appendMarkdown !== undefined) target.markdown += edit.appendMarkdown;
        }
        saveSheet();
        // Re-render THIS page immediately -- unlike a plain variable
        // edit (which only ever updates the ONE box someone's looking
        // at), the whole POINT of a mod action is to change OTHER
        // cells/content on the same page that this same click never
        // directly touched. Same `innerHTML = ""` + re-invoke pattern
        // renderPageTabContent's own `renderMode()` already uses when
        // switching View/Edit.
        hostEl.innerHTML = "";
        renderViewMode(page, hostEl);
      };
      // Real request, 2026-10-28: "auto-populate... did nothing when
      // clicked" -- a thrown/rejected action (e.g. its own fetch
      // failing) used to fail completely silently, an unhandled
      // promise rejection visible only in devtools. Surfaced directly
      // on the button itself instead, same "Error: ..." convention a
      // dice-roll-chip already uses, so a real failure is at least
      // VISIBLE instead of looking identical to "nothing qualified."
      const originalText = actionBtn.textContent;
      Promise.resolve(action({ variableValues: effectiveVariableValues(), defs: allVariableDefs(), pages: character.customSheet!.pages, httpUrl, accountId: sheetOwnerAccountId }, apply)).catch((err: unknown) => {
        console.error(`mod action ${modId}.${actionName} failed:`, err);
        actionBtn.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        setTimeout(() => {
          actionBtn.textContent = originalText;
        }, 4000);
      });
    });

    // Real correction, 2026-10-26: a `[dice-roll-chip]` is a GENUINE
    // dice roll (real RNG) -- unlike every other chip on this page,
    // its own value is never pre-computed on render (see this
    // function's own header below for why auto-rolling on every
    // render was wrong). Clicking it fetches a FRESH roll for JUST
    // this one segment (re-slicing the page's own markdown down to
    // this segment's own span, same per-segment resolution
    // findLibraryCalls' own segments already use), then both updates
    // the button's own face AND posts to chat -- never both silently
    // happening on page load.
    previewEl.addEventListener("click", (event) => {
      const rollBtn = (event.target as HTMLElement).closest<HTMLButtonElement>(".dice-roll-chip");
      if (!rollBtn || rollBtn.disabled) return;
      const start = Number(rollBtn.dataset.rollStart);
      const end = Number(rollBtn.dataset.rollEnd);
      const label = rollBtn.dataset.rollLabel ?? "Roll";
      rollBtn.disabled = true;
      rollBtn.textContent = "Rolling...";
      void fetchCharacterSheetPreview(httpUrl, sheetOwnerAccountId, page.markdown.slice(start, end), effectiveVariableValues())
        .then((result) => {
          const rolled = result.expressionSegments[0]; // exactly one -- the sliced text is just this one {{...}} segment
          rollBtn.disabled = false;
          if (!rolled || rolled.error !== undefined) {
            rollBtn.textContent = `Error: ${rolled?.error ?? "roll failed"}`;
            return;
          }
          // Real correction, 2026-10-26: "it should just look like 22
          // and when moused over that special 22 should display the
          // formula behind it, rather than that huge arrow" -- `value`
          // is now just the bare result for every caller (in-game
          // chat included); `html` (a tooltip over the SAME number,
          // DiceRoll's own real breakdown) is the OPTIONAL richer
          // version only a caller that can safely render it uses.
          // Real correction, 2026-10-26 (third pass): "it expands into
          // the formula being rolled instead of remaining 'roll'" --
          // the RESULT belongs in chat (already fixed above), not on
          // the button's own face; a "Roll" button is a reusable
          // ACTION trigger, not a one-shot display of its own last
          // result. Stays "Roll" (its own title still updates, for a
          // quick hover-recall of the last breakdown without needing
          // to check chat).
          const text = String(rolled.value);
          rollBtn.textContent = "Roll";
          rollBtn.title = rolled.text ?? "";
          const html = `<span class="roll-result" title="${escapeHtml(rolled.text ?? label)}">${escapeHtml(text)}</span>`;
          options.onPostToChat(label, text, html);
        })
        .catch((err: unknown) => {
          rollBtn.disabled = false;
          rollBtn.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        });
    });

    // Real request, 2026-10-26: "For light attack, we want to display
    // the attack to-hit result, the damage, and the max damage...
    // some table in the chat," generalized (third pass, same day) to
    // EVERY label-as-button roll (stat checks, Evasion, Initiative,
    // a skill's own name). Each part is evaluated CLIENT-SIDE first
    // (same evaluateCharacterSheetExpression every plain expression
    // already uses) -- a compound roll with NO real dice in any part
    // (Evasion, a skill's own Expertise-only companion text) resolves
    // and posts immediately, no server round trip at all, same
    // principle as every other no-dice expression on this page. Only
    // when some part genuinely needs RNG (a "1d20 + ..." stat/skill
    // check, Initiative's real "1d4 + ...") does this fetch a fresh
    // server roll for the WHOLE segment (simplest correct behavior --
    // re-evaluating an already-resolved sibling part server-side is
    // harmless, it's pure arithmetic either way).
    previewEl.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(".compound-roll-chip");
      if (!target || target.disabled) return;
      const rollBtn: HTMLButtonElement = target; // narrowed to non-null, used inside the nested `finish` closure below
      const start = Number(rollBtn.dataset.rollStart);
      const end = Number(rollBtn.dataset.rollEnd);
      const actionLabel = rollBtn.dataset.actionLabel ?? "Roll";
      const parts: { label: string; expression: string; showMax: boolean }[] = JSON.parse(rollBtn.dataset.rollParts ?? "[]");

      // Real request, 2026-10-26 (third pass): "the Agility label
      // would be a button... [posting] agility check: 16" -- a
      // SINGLE-part roll posts using its OWN part label directly
      // (e.g. "evasion: 13", "fitness check: 16"), not wrapped in the
      // multi-part "ActionLabel -> part1: v1, part2: v2" format a
      // bundled action (Light Attack, a skill's roll+expertise pair)
      // still uses.
      function finish(resolved: { label: string; value?: number; text?: string; error?: string; maxValue?: number; showMax: boolean }[]): void {
        rollBtn.disabled = false;
        rollBtn.textContent = actionLabel;
        const firstError = resolved.find((p) => p.error !== undefined);
        if (firstError) {
          rollBtn.textContent = `Error: ${firstError.error}`;
          return;
        }
        const plainParts: string[] = [];
        const htmlLines: string[] = [];
        for (const part of resolved) {
          const text = part.value !== undefined ? String(part.value) : part.text ?? "";
          plainParts.push(`${part.label}: ${text}`);
          htmlLines.push(`${escapeHtml(part.label)}: <span class="roll-result" title="${escapeHtml(part.text ?? part.label)}">${escapeHtml(text)}</span>`);
          if (part.showMax && part.maxValue !== undefined) {
            plainParts.push(`max ${part.label}: ${part.maxValue}`);
            htmlLines.push(`max ${escapeHtml(part.label)}: ${escapeHtml(String(part.maxValue))}`);
          }
        }
        if (resolved.length === 1) {
          const html = `<span class="roll-result" title="${escapeHtml(resolved[0].text ?? resolved[0].label)}">${escapeHtml(plainParts[0])}</span>`;
          options.onPostToChat("", plainParts[0], html);
        } else {
          const html = `<div class="roll-result-group"><strong>${escapeHtml(actionLabel)}</strong><br>${htmlLines.join("<br>")}</div>`;
          options.onPostToChat(actionLabel, plainParts.join(", "), html);
        }
      }

      const effectiveValues = effectiveVariableValues();
      const defs = allVariableDefs();
      const clientResolved = parts.map((part) => ({ ...part, ...evaluateCharacterSheetExpression(part.expression, effectiveValues, true, defs) }));
      if (!clientResolved.some((p) => p.needsRoll)) {
        finish(clientResolved);
        return;
      }
      rollBtn.disabled = true;
      rollBtn.textContent = "Rolling...";
      void fetchCharacterSheetPreview(httpUrl, sheetOwnerAccountId, page.markdown.slice(start, end), effectiveValues)
        .then((result) => {
          const rolled = result.compoundRollSegments[0]; // exactly one -- the sliced text is just this one {{...}} segment
          if (!rolled) {
            rollBtn.disabled = false;
            rollBtn.textContent = `Error: roll failed`;
            return;
          }
          finish(rolled.parts);
        })
        .catch((err: unknown) => {
          rollBtn.disabled = false;
          rollBtn.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        });
    });

    // docs/CHARACTER_SHEET_IMPORT.md, part 1 -- real correction,
    // 2026-10-25 (second pass): "the character sheet results for
    // displaying on the client side can all be done client side...
    // rather than putting calculations on the server side." Plain
    // `{{expression}}` arithmetic now evaluates HERE, client-side, via
    // shared/characterSheet.ts's own evaluateCharacterSheetExpression
    // (expr-eval, not a hand-rolled parser) -- a segment only comes
    // back `needsRoll: true` when it genuinely contains dice notation
    // in an allowed (`button`) spot, since only the server may ever
    // compute a real roll (diceRoll.ts's own "the server is the only
    // place a roll is ever computed" rule).
    const effectiveValues = effectiveVariableValues();
    const defs = allVariableDefs();
    const expressionSegments = findExpressionSegments(page.markdown).map((s) => ({
      ...s,
      kind: "expression" as const,
      ...evaluateCharacterSheetExpression(s.expression, effectiveValues, s.display === "button", defs),
    }));

    // Real request, 2026-10-26: "For light attack, we want to display
    // the attack to-hit result, the damage, and the max damage...
    // some table in the chat." A compound roll is NEVER resolved
    // client-side (it only ever exists as an explicit button/action
    // -- there's no "passive display" case for it the way a plain
    // expression has), so it renders as its own inert button purely
    // from this LOCAL parse, with no evaluation attempted here at
    // all; the click handler above fetches its own fresh result.
    const compoundSegments = findCompoundRollSegments(page.markdown).map((s) => ({ ...s, kind: "compound" as const }));

    // Variable refs (`{variableId}`) resolve entirely client-side --
    // no mod/server involved, just this character's own variableValues.
    // Real bug, found live: `findVariableRefs`'s own guard only checks
    // ONE character back, so a `{variableId}` ref NESTED inside a
    // `{{expression}}` (e.g. the `{toughness}` inside `{{20 + (10 *
    // {toughness}) + {hpBonus}}}`) still matches as its OWN, separate
    // top-level segment -- the expression's own span and this nested
    // ref's span then OVERLAP once merged below, which desyncs the
    // single-pass substitution loop's cursor for the REST of the page
    // (garbled/duplicated text past the first expression). Dropped
    // here: any variable-ref segment entirely CONTAINED within an
    // expression OR compound-roll segment's own span is already
    // handled as part of that segment's own text, not a second,
    // separate reference.
    const variableSegments = findVariableRefs(page.markdown)
      .filter((v) => ![...expressionSegments, ...compoundSegments].some((e) => v.start >= e.start && v.end <= e.end))
      .map((s) => ({ ...s, kind: "variable" as const }));

    // Substitutes each segment with its own HTML snippet BEFORE handing
    // the text to marked -- by the time a flattened, plain-text-only
    // resolution exists, the original markers are gone, so inline
    // widgets/chips have to be built from the ORIGINAL markdown +
    // segments instead. Shared by both render paths below (fully
    // local, or merged with a server roll) so there's one place this
    // logic can drift out of sync.
    function finishRender(callSegments: ((typeof variableSegments)[number] | { kind: "call"; start: number; end: number; modId: string; functionName: string; value: string; display: "box" | "button" })[], exprSegments: typeof expressionSegments): void {
      const allSegments = [...callSegments, ...variableSegments, ...exprSegments, ...compoundSegments].sort((a, b) => a.start - b.start);

      let substituted = "";
      let cursor = 0;
      for (const segment of allSegments) {
        substituted += page.markdown.slice(cursor, segment.start);
        if (segment.kind === "call") {
          const label = `${segment.modId}.${segment.functionName}`;
          substituted +=
            segment.display === "box"
              ? `<span class="computed-value">${escapeHtml(segment.value)}</span>`
              : `<button type="button" class="chat-chip" data-chip-label="${escapeHtml(label)}" data-chip-value="${escapeHtml(segment.value)}">${escapeHtml(segment.value)}</button>`;
        } else if (segment.kind === "expression") {
          // A real imported formula (e.g. "20 + (10 * {toughness}) +
          // {hpBonus}"), evaluated fresh against this character's
          // CURRENT variableValues every render -- live, not a value
          // frozen at import time. `segment.error` covers an unknown
          // variable, a real parser error, AND the "dice rolling not
          // allowed in fixed displays" check, all rendered the SAME
          // way: in red, directly on the sheet. Real correction,
          // 2026-10-26: a `needsRoll` segment is a GENUINE dice roll
          // -- "a few buttons to click and roll, like heavy attack,
          // initiative" means the roll happens when CLICKED, not
          // silently re-rolled every time the page merely renders (a
          // real trust/UX problem: you'd see a DIFFERENT number every
          // time you just looked at your own sheet, with no action on
          // your part). So this renders an inert "Roll" button that
          // fetches its own fresh result on click (this previewEl's
          // own `.dice-roll-chip` listener above), carrying its own
          // span as data attributes since nothing has been resolved
          // yet at render time.
          substituted +=
            segment.error !== undefined
              ? `<span class="expression-error" style="color: red;">${escapeHtml(segment.error)}</span>`
              : segment.needsRoll
                ? `<button type="button" class="dice-roll-chip" data-roll-start="${segment.start}" data-roll-end="${segment.end}" data-roll-label="${escapeHtml(segment.expression)}">Roll</button>`
                : segment.value === undefined
                  ? ""
                  : segment.display === "button"
                    ? `<button type="button" class="chat-chip" data-chip-label="${escapeHtml(segment.expression)}" data-chip-value="${escapeHtml(String(segment.value))}">${escapeHtml(String(segment.value))}</button>`
                    : `<span class="computed-value">${escapeHtml(String(segment.value))}</span>`;
        } else if (segment.kind === "compound") {
          // A compound roll (real request, 2026-10-26; label-as-button
          // rework, same day, third pass: "if we could make the labels
          // buttons instead, that would be best") -- an inert button
          // showing just the action's own label (NOT "Roll <label>" --
          // the button face IS the label, e.g. "Evasion", "Agility",
          // "Medicine", "Initiative"), same click-to-resolve pattern as
          // a plain dice-roll chip. Carries its own parts (label/
          // expression/showMax) as a JSON data attribute so the click
          // handler can evaluate every part CLIENT-SIDE first (same
          // evaluateCharacterSheetExpression every plain expression
          // already uses) and skip the server round trip entirely when
          // none of them actually need real dice (e.g. Evasion, a pure-
          // arithmetic combat stat) -- only a part that genuinely needs
          // RNG (a stat/skill check's "1d20 + ...", Initiative's real
          // "1d4 + ...") still fetches a fresh server roll.
          substituted += `<button type="button" class="compound-roll-chip" data-roll-start="${segment.start}" data-roll-end="${segment.end}" data-action-label="${escapeHtml(segment.actionLabel)}" data-roll-parts="${escapeHtml(JSON.stringify(segment.parts))}">${escapeHtml(segment.actionLabel)}</button>`;
        } else {
          const def = findVariableDef(segment.variableId);
          // An inline ref always shows ONE value (box or chip), never
          // xOfY's two boxes together -- component defaults to "x"
          // (current) when `.x`/`.y` isn't written.
          substituted += !def
            ? `[unknown variable: ${escapeHtml(segment.variableId)}]`
            : segment.display === "button"
              ? buildVariableChipHtml(def, character.variableValues, segment.component, defs)
              : buildVariableComponentHtml(def, character.variableValues, segment.component, defs);
        }
        cursor = segment.end;
      }
      substituted += page.markdown.slice(cursor);

      // The ONE deliberate innerHTML-of-untrusted-content spot in this
      // codebase -- sanitized immediately before insertion (DOMPurify's
      // default allowlist already includes <button>/<input>/<select>
      // and the value/min/max/type/data-* attributes they need,
      // confirmed directly, no extra config needed). chatPanel.ts's
      // textContent convention is the baseline everywhere else.
      previewEl.innerHTML = DOMPurify.sanitize(marked.parse(substituted) as string);
      wireVariableWidgets(previewEl, (key, next) => {
        character.variableValues = { ...character.variableValues, [key]: next };
        saveSheet();
      });
    }

    const libraryCallSegments = findLibraryCalls(page.markdown);

    if (libraryCallSegments.length === 0) {
      // Nothing on this page needs a round trip just to RENDER it --
      // no mod library calls, and a `needsRoll` segment renders as
      // its own inert "Roll" button (above), fetched only once
      // actually clicked, never automatically here.
      finishRender([], expressionSegments);
      return;
    }

    // Always fetches on render (not only on edit) -- a freshly-cloned/
    // just-opened page's library calls must not sit unresolved until
    // the viewer happens to type something. Only `segments` (library
    // calls) ever come from this automatic round trip -- expression
    // segments, including any `needsRoll` ones, are exactly what was
    // already resolved client-side above; this fetch is never asked
    // about them at all.
    void fetchCharacterSheetPreview(httpUrl, sheetOwnerAccountId, page.markdown, effectiveValues).then((result) => {
      const callSegments = result.segments.map((s) => ({ ...s, kind: "call" as const }));
      finishRender(callSegments, expressionSegments);
    });
  }

  function renderPageTabContent(page: CharacterSheetPageDef): void {
    if (!canEdit) {
      // No Edit-mode button at all for a read-only viewer -- just the
      // rendered, interactive page.
      sheetTabContentEl.innerHTML = `<div class="sheet-page" id="page-mode-host"></div>`;
      renderViewMode(page, sheetTabContentEl.querySelector<HTMLDivElement>("#page-mode-host")!);
      return;
    }

    sheetTabContentEl.innerHTML = `<div class="sheet-page"><button type="button" class="page-mode-toggle" id="page-mode-toggle"></button><div id="page-mode-host"></div></div>`;
    const toggleBtn = sheetTabContentEl.querySelector<HTMLButtonElement>("#page-mode-toggle")!;
    const modeHostEl = sheetTabContentEl.querySelector<HTMLDivElement>("#page-mode-host")!;

    function renderMode(): void {
      toggleBtn.textContent = pageMode === "view" ? "Edit" : "View";
      modeHostEl.innerHTML = "";
      if (pageMode === "edit") renderEditMode(page, modeHostEl);
      else renderViewMode(page, modeHostEl);
    }
    renderMode();

    toggleBtn.addEventListener("click", () => {
      pageMode = pageMode === "view" ? "edit" : "view";
      // Only rebuilds modeHostEl (a sibling), never this button's own
      // parent, from within this button's own click handler.
      renderMode();
    });
  }

  // ---- the "Core & Variables" tab: body-size + variable definitions --

  let variablesSectionEl: HTMLDivElement;
  let barsSectionEl: HTMLDivElement;

  function renderVariablesSection(): void {
    const sheet = character.customSheet!;
    variablesSectionEl.innerHTML = `
      <h3>Variables</h3>
      <ul class="variable-def-list" id="variable-def-list"></ul>
      <button type="button" id="add-variable-btn">+ Add variable</button>
    `;
    const listEl = variablesSectionEl.querySelector<HTMLUListElement>("#variable-def-list")!;

    function renderList(): void {
      listEl.innerHTML = sheet.variables
        .map(
          (v, i) => `
        <li data-index="${i}">
          <input class="var-id" data-field="id" value="${v.id}" placeholder="id" />
          <input class="var-label" data-field="label" value="${v.label}" placeholder="label" />
          <select class="var-type" data-field="type">${VARIABLE_TYPES.map((t) => `<option value="${t}"${t === v.type ? " selected" : ""}>${t}</option>`).join("")}</select>
          <select class="var-pages" multiple title="Which page(s) show this variable">${sheet.pages.map((p, pi) => `<option value="${pi}"${p.variableIds.includes(v.id) ? " selected" : ""}>${p.title}</option>`).join("")}</select>
          <span class="var-value-label">Value:</span> <span class="var-value-host" data-index="${i}"></span>
          <button type="button" class="delete-var-btn" data-index="${i}">Delete</button>
        </li>`,
        )
        .join("");
      // This character's CURRENT value widget per variable -- the
      // full, both-boxes-for-xOfY widget belongs HERE, not inline on
      // the sheet. Mounted as real DOM (not a plain HTML string) since
      // renderVariableWidget wires its own listeners -- same pattern
      // renderVariableRow already uses for the reserved body-size rows.
      listEl.querySelectorAll<HTMLSpanElement>(".var-value-host").forEach((host) => {
        const variable = sheet.variables[Number(host.dataset.index)];
        renderVariableWidget(
          host,
          variable,
          character.variableValues,
          (key, next) => {
            // Real request, 2026-10-26: editing the max box's own
            // `{{...}}` formula text is a DEFINITION edit (maxExpression
            // lives on the variable's own def, same tier as label/type
            // -- shared by every page that references `{variableId.y}`),
            // not a per-character variableValues write.
            const formulaEdit = /^(.+)::maxExpression$/.exec(key);
            if (formulaEdit) {
              const target = sheet.variables.find((v) => v.id === formulaEdit[1]);
              if (!target) return;
              const raw = String(next).trim();
              const formulaMatch = /^\{\{([\s\S]*)\}\}$/.exec(raw);
              if (formulaMatch) {
                target.maxExpression = formulaMatch[1].trim();
              } else {
                // Typing a plain number back in toggles the formula
                // OFF -- reverts to an ordinary flat, per-character
                // max value (same xOfYMaxKey convention every other
                // xOfY variable's own max already uses).
                delete target.maxExpression;
                const num = Number(raw);
                character.variableValues = { ...character.variableValues, [xOfYMaxKey(target.id)]: Number.isFinite(num) ? num : 0 };
              }
              saveSheet();
              // The box's own TYPE (text formula vs. number) depends
              // on this -- same reasoning the "type" field change
              // above already rebuilds the list for.
              renderList();
              return;
            }
            // Real request, 2026-10-26 (third pass): the SAME
            // formula-vs-flat split as maxExpression above, just for
            // a plain `number` variable's own "x"/current value (e.g.
            // a skill's own Bonus = governing substat + skill points).
            const valueFormulaEdit = /^(.+)::valueExpression$/.exec(key);
            if (valueFormulaEdit) {
              const target = sheet.variables.find((v) => v.id === valueFormulaEdit[1]);
              if (!target) return;
              const raw = String(next).trim();
              const formulaMatch = /^\{\{([\s\S]*)\}\}$/.exec(raw);
              if (formulaMatch) {
                target.valueExpression = formulaMatch[1].trim();
              } else {
                // Typing a plain number back in toggles the formula
                // OFF -- reverts to an ordinary flat, per-character
                // value.
                delete target.valueExpression;
                const num = Number(raw);
                character.variableValues = { ...character.variableValues, [target.id]: Number.isFinite(num) ? num : 0 };
              }
              saveSheet();
              renderList();
              return;
            }
            character.variableValues = { ...character.variableValues, [key]: next };
            saveSheet();
          },
          allVariableDefs(),
        );
      });
    }
    renderList();

    // Field edits mutate in place and save WITHOUT rebuilding the list
    // (rebuilding mid-edit would lose focus/cursor position).
    listEl.addEventListener("change", (event) => {
      const target = event.target as HTMLElement;
      const li = target.closest<HTMLLIElement>("li[data-index]");
      if (!li) return;
      const index = Number(li.dataset.index);
      const variable = sheet.variables[index];

      if (target instanceof HTMLSelectElement && target.classList.contains("var-pages")) {
        const selectedPageIndices = new Set(Array.from(target.selectedOptions).map((o) => Number(o.value)));
        sheet.pages.forEach((page, pi) => {
          const shouldShow = selectedPageIndices.has(pi);
          const has = page.variableIds.includes(variable.id);
          if (shouldShow && !has) page.variableIds.push(variable.id);
          else if (!shouldShow && has) page.variableIds = page.variableIds.filter((id) => id !== variable.id);
        });
        saveSheet();
        return;
      }

      const field = (target as HTMLInputElement | HTMLSelectElement).dataset.field;
      const value = (target as HTMLInputElement | HTMLSelectElement).value;
      if (field === "id") {
        const oldId = variable.id;
        variable.id = value;
        for (const page of sheet.pages) page.variableIds = page.variableIds.map((id) => (id === oldId ? value : id));
      } else if (field === "label") {
        variable.label = value;
      } else if (field === "type") {
        variable.type = value as CharacterSheetVariableType;
        saveSheet();
        // The value widget's own SHAPE depends on type (one box vs.
        // xOfY's two) -- unlike id/label above, this has to rebuild
        // the row, not just re-save, or the old widget just sits
        // there showing the wrong type's boxes forever.
        renderList();
        // The Bars section's variable dropdown only offers xOfY
        // variables -- a type change can add/remove this variable
        // from that set, so it needs a refresh too (a SIBLING
        // sub-tree, not this list's own ancestor).
        renderBarsSection();
        return;
      }
      saveSheet();
    });

    listEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".delete-var-btn");
      if (!button) return;
      const index = Number(button.dataset.index);
      const [removed] = sheet.variables.splice(index, 1);
      for (const page of sheet.pages) page.variableIds = page.variableIds.filter((id) => id !== removed.id);
      sheet.bars = (sheet.bars ?? []).filter((b) => b.variableId !== removed.id);
      saveSheet();
      renderList();
      renderBarsSection();
    });

    variablesSectionEl.querySelector<HTMLButtonElement>("#add-variable-btn")!.addEventListener("click", () => {
      let n = sheet.variables.length + 1;
      while (sheet.variables.some((v) => v.id === `var${n}`)) n++;
      sheet.variables.push({ id: `var${n}`, label: `Variable ${n}`, type: "number", default: 0 });
      saveSheet();
      renderList();
      renderBarsSection();
    });
  }

  /** "Gotta make it so we actually know what the mod library names are, because right now there's no way to tell" -- listed last on the Core & Variables tab. Read-only (no mutation here) -- just what's callable via `{{modId.fn(args)}}`. */
  function renderLibrariesSection(parent: HTMLElement): void {
    const section = document.createElement("div");
    section.className = "sheet-page";
    section.innerHTML = `
      <h3>Libraries</h3>
      <p class="library-hint">Call a function from one of these in a page's markdown via <code>{{modId.fn(args)}}</code>.</p>
      <ul class="library-list">
        ${
          libraries.length === 0
            ? `<li class="empty">No imported mod provides any library functions.</li>`
            : libraries.map((entry) => `<li><strong>${entry.modId}</strong>: ${entry.functionNames.length > 0 ? entry.functionNames.join(", ") : "(no functions)"}</li>`).join("")
        }
      </ul>
    `;
    parent.append(section);
  }

  /**
   * "Set up what actually display as bars in game ... just a list of
   * var refs and colors and a color picker." Only `xOfY` variables
   * are offered as choices -- a bar needs a current AND a max to
   * compute a fill ratio, so a plain number/text variable can't be
   * one. Placed right after Variables (bars reference them directly)
   * and before Libraries.
   */
  function renderBarsSection(): void {
    const sheet = character.customSheet!;
    sheet.bars ??= [];
    const xOfYVariables = sheet.variables.filter((v) => v.type === "xOfY");

    barsSectionEl.innerHTML = `
      <h3>Bars (shown on the in-game token)</h3>
      <ul class="bar-def-list" id="bar-def-list"></ul>
      <button type="button" id="add-bar-btn"${xOfYVariables.length === 0 ? " disabled" : ""}>+ Add bar</button>
      ${xOfYVariables.length === 0 ? `<p class="bar-hint">Add an xOfY variable first.</p>` : ""}
    `;
    const listEl = barsSectionEl.querySelector<HTMLUListElement>("#bar-def-list")!;

    function renderList(): void {
      const bars = sheet.bars!;
      listEl.innerHTML = bars
        .map(
          (b, i) => `
        <li data-index="${i}">
          <select class="bar-var" data-field="variableId">${xOfYVariables.map((v) => `<option value="${v.id}"${v.id === b.variableId ? " selected" : ""}>${v.label}</option>`).join("")}</select>
          <input class="bar-color" data-field="color" type="color" value="${colorToHex(b.color)}" />
          <button type="button" class="delete-bar-btn" data-index="${i}">Delete</button>
        </li>`,
        )
        .join("");
    }
    renderList();

    listEl.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const li = target.closest<HTMLLIElement>("li[data-index]");
      if (!li) return;
      const bar = sheet.bars![Number(li.dataset.index)];
      if (target.dataset.field === "variableId") bar.variableId = target.value;
      else if (target.dataset.field === "color") bar.color = hexToColor(target.value);
      saveSheet();
    });

    listEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".delete-bar-btn");
      if (!button) return;
      sheet.bars!.splice(Number(button.dataset.index), 1);
      saveSheet();
      renderList();
    });

    barsSectionEl.querySelector<HTMLButtonElement>("#add-bar-btn")?.addEventListener("click", () => {
      const newBar: CharacterSheetBarDef = { variableId: xOfYVariables[0].id, color: [1, 1, 1] };
      sheet.bars!.push(newBar);
      saveSheet();
      renderList();
    });
  }

  function renderCoreTabContent(): void {
    sheetTabContentEl.innerHTML = `<div class="sheet-page" id="body-size-section"><h3>Body (core, always present)</h3></div><div class="sheet-page" id="variables-host"></div><div class="sheet-page" id="bars-host"></div>`;
    const bodySizeSection = sheetTabContentEl.querySelector<HTMLDivElement>("#body-size-section")!;
    for (const def of RESERVED_CHARACTER_VARIABLES) renderVariableRow(bodySizeSection, def);
    for (const def of RESERVED_TOKEN_IMAGE_VARIABLES) renderTokenImageUpload(bodySizeSection, def);
    variablesSectionEl = sheetTabContentEl.querySelector<HTMLDivElement>("#variables-host")!;
    renderVariablesSection();
    barsSectionEl = sheetTabContentEl.querySelector<HTMLDivElement>("#bars-host")!;
    renderBarsSection();
    renderLibrariesSection(sheetTabContentEl);
  }

  // ---- sheet tab bar: "Core & Variables" (if canEdit) + one per page --

  function updateActiveSheetTab(): void {
    sheetTabsEl.querySelectorAll<HTMLButtonElement>(".sheet-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === String(selectedSheetTab));
    });
  }

  function renderSheetTabContent(): void {
    if (selectedSheetTab === "core") renderCoreTabContent();
    else renderPageTabContent(character.customSheet!.pages[selectedSheetTab]);
  }

  function renderSheetTabs(): void {
    const pages = character.customSheet!.pages;
    sheetTabsEl.innerHTML =
      (canEdit ? `<button type="button" class="sheet-tab" data-tab="core">Core &amp; Variables</button>` : "") +
      pages.map((p, i) => `<button type="button" class="sheet-tab" data-tab="${i}">${p.title}</button>`).join("") +
      (canEdit ? `<button type="button" id="add-page-btn">+ Add page</button><button type="button" id="delete-page-btn">Delete this page</button>` : "");
    updateActiveSheetTab();

    sheetTabsEl.querySelectorAll<HTMLButtonElement>(".sheet-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedSheetTab = btn.dataset.tab === "core" ? "core" : Number(btn.dataset.tab);
        pageMode = "view";
        // Only toggles classes on the EXISTING tab buttons and rebuilds
        // the (separate) content sub-tree -- never rebuilds this tab
        // bar's own parent from within a tab's own click handler.
        updateActiveSheetTab();
        renderSheetTabContent();
      });
    });

    if (!canEdit) return;

    sheetTabsEl.querySelector<HTMLButtonElement>("#add-page-btn")!.addEventListener("click", () => {
      const newPage: CharacterSheetPageDef = { title: `Page ${pages.length + 1}`, markdown: "", variableIds: [] };
      pages.push(newPage);
      selectedSheetTab = pages.length - 1;
      pageMode = "view";
      saveSheet();
      renderSheetTabs();
      renderSheetTabContent();
    });

    sheetTabsEl.querySelector<HTMLButtonElement>("#delete-page-btn")!.addEventListener("click", () => {
      if (pages.length <= 1 || typeof selectedSheetTab !== "number") return; // always keep at least one page
      pages.splice(selectedSheetTab, 1);
      selectedSheetTab = Math.max(0, selectedSheetTab - 1);
      pageMode = "view";
      saveSheet();
      renderSheetTabs();
      renderSheetTabContent();
    });
  }

  // ---- top-level: start-prompt (no sheet yet) vs. the tabbed shell ----

  function renderStartPrompt(): void {
    if (!canEdit) {
      container.innerHTML = `<h2>${character.name}'s Sheet</h2><p>This character doesn't have a sheet yet.</p>`;
      return;
    }
    container.innerHTML = `
      <h2>${character.name}'s Sheet</h2>
      <p>This character doesn't have a sheet yet.</p>
      <div class="variable-row"><button type="button" id="start-blank-btn">Start a blank sheet</button></div>
      <div class="variable-row" id="start-template-list"></div>
      <div id="import-template-list"></div>
    `;
    container.querySelector<HTMLButtonElement>("#start-blank-btn")!.addEventListener("click", () => {
      character.customSheet = { name: `${character.name}'s Sheet`, pages: [{ title: "Overview", markdown: "", variableIds: [] }], variables: [], bars: [] };
      character.templateId = null;
      selectedSheetTab = 0; // land on the real page just created, not the Core tab
      pageMode = "view";
      saveSheet();
      renderSheetSection();
    });
    const startTemplateListEl = container.querySelector<HTMLDivElement>("#start-template-list")!;
    startTemplateListEl.innerHTML = templates.map((t) => `<button type="button" class="start-template-btn" data-mod-id="${t.modId}">Start from "${t.template.name}"</button>`).join("");
    startTemplateListEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".start-template-btn");
      if (!button) return;
      const entry = templates.find((t) => t.modId === button.dataset.modId);
      if (!entry) return;
      character.customSheet = structuredClone(entry.template);
      character.templateId = entry.modId;
      selectedSheetTab = 0; // land on the cloned sheet's first page, not the Core tab
      pageMode = "view";
      saveSheet();
      renderSheetSection();
    });
    renderImportSection(container.querySelector<HTMLDivElement>("#import-template-list")!);
  }

  /**
   * docs/CHARACTER_SHEET_IMPORT.md, part 1 -- "Import from URL" for
   * any template whose mod also exports a characterSheetImporter
   * (today, just lyrian-chronicles -- `hasImporter` is what the
   * server actually checked, not a hardcoded mod id here). The
   * BROWSER fetches+parses the export URL directly
   * (characterSheetImport.ts's fetchAndParseWorkbook) -- the server
   * never fetches an arbitrary URL itself, same as every other
   * "paste a URL" flow would need to avoid in this codebase.
   */
  function renderImportSection(hostEl: HTMLDivElement): void {
    const importers = templates.filter((t) => t.hasImporter);
    if (importers.length === 0) return;
    hostEl.innerHTML = importers
      .map(
        (t) => `
      <div class="variable-row import-row" data-mod-id="${t.modId}">
        <span class="import-label">${escapeHtml(t.template.name)}:</span>
        <input type="text" class="import-url-input" placeholder="Google Sheets URL (the ordinary edit/share link is fine)" />
        <button type="button" class="import-from-url-btn">Import</button>
        <span class="import-status"></span>
      </div>`,
      )
      .join("");
    hostEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".import-from-url-btn");
      if (!button) return;
      const row = button.closest<HTMLDivElement>(".import-row")!;
      const modId = row.dataset.modId!;
      const urlInput = row.querySelector<HTMLInputElement>(".import-url-input")!;
      const statusEl = row.querySelector<HTMLSpanElement>(".import-status")!;
      const url = urlInput.value.trim();
      if (!url) return;
      statusEl.textContent = "Importing...";
      button.disabled = true;
      void fetchAndParseWorkbook(url)
        .then((workbook) => importCharacterSheetFromWorkbook(httpUrl, character.id, viewerAccountId, modId, workbook))
        .then((updated) => {
          Object.assign(character, updated);
          selectedSheetTab = 0; // land on the imported sheet's first page, not the Core tab
          pageMode = "view";
          renderSheetSection();
        })
        .catch((err: unknown) => {
          statusEl.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
          button.disabled = false;
        });
    });
  }

  function renderSheetShell(): void {
    if (typeof selectedSheetTab === "number") selectedSheetTab = Math.min(Math.max(selectedSheetTab, 0), character.customSheet!.pages.length - 1);

    container.innerHTML = `
      <h2 id="sheet-heading"></h2>
      <div id="dependency-warning"></div>
      <div class="sheet-tabs" id="sheet-tabs"></div>
      <div id="sheet-tab-content"></div>
    `;
    container.querySelector<HTMLHeadingElement>("#sheet-heading")!.textContent = `${character.name}'s Sheet`;
    dependencyWarningEl = container.querySelector<HTMLDivElement>("#dependency-warning")!;
    sheetTabsEl = container.querySelector<HTMLDivElement>("#sheet-tabs")!;
    sheetTabContentEl = container.querySelector<HTMLDivElement>("#sheet-tab-content")!;

    renderDependencyWarning();
    renderSheetTabs();
    renderSheetTabContent();
  }

  function renderSheetSection(): void {
    if (!character.customSheet) renderStartPrompt();
    else renderSheetShell();
  }

  renderSheetSection();

  return {
    refresh(nextTemplates, nextLibraries, nextImportedModIds) {
      templates = nextTemplates;
      libraries = nextLibraries;
      importedModIds = nextImportedModIds;
      if (!character.customSheet) return; // start-prompt doesn't show a dependency warning/Core tab at all
      renderDependencyWarning();
      if (selectedSheetTab === "core") renderSheetTabContent();
    },
  };
}

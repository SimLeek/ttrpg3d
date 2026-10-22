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
import { RESERVED_BODY_SIZE_VARIABLES, computeMissingModDependencies, findVariableRefs, type CharacterSheetVariableDef, type CharacterSheetVariableType, type CharacterSheetPageDef, type CharacterSheetBarDef } from "@ttrpg3d/shared";
import { fetchCharacterSheetTemplates, fetchCharacterSheetPreview, updateCharacterSheet, type CharacterRecord, type CharacterSheetTemplateCatalogEntry, type CharacterSheetLibraryCatalogEntry } from "./api.js";
import { renderVariableWidget, buildVariableComponentHtml, buildVariableChipHtml, wireVariableWidgets } from "./characterSheetWidgets.js";
import { colorToHex, hexToColor } from "./lobby.js";

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
  onPostToChat(label: string, value: string): void;
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
    renderVariableWidget(widgetHost, def, character.variableValues, (key, next) => {
      character.variableValues = { ...character.variableValues, [key]: next };
      saveSheet();
    });
    row.append(label, widgetHost);
    parent.append(row);
  }

  /** Looks up a variable's definition wherever it might live -- the sheet's own variables, or a core reserved one -- for resolving a `{variableId}` reference found in a page's markdown. */
  function findVariableDef(variableId: string): CharacterSheetVariableDef | undefined {
    return character.customSheet!.variables.find((v) => v.id === variableId) ?? RESERVED_BODY_SIZE_VARIABLES.find((v) => v.id === variableId);
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
      options.onPostToChat(chip.dataset.chipLabel ?? "", chip.dataset.chipValue ?? "");
    });

    // Variable refs (`{variableId}`) resolve entirely client-side --
    // no mod/server involved, just this character's own variableValues.
    const variableSegments = findVariableRefs(page.markdown).map((s) => ({ ...s, kind: "variable" as const }));

    // Always fetches on render (not only on edit) -- a freshly-cloned/
    // just-opened page's library calls must not sit unresolved until
    // the viewer happens to type something.
    void fetchCharacterSheetPreview(httpUrl, sheetOwnerAccountId, page.markdown, character.variableValues).then((result) => {
      const callSegments = result.segments.map((s) => ({ ...s, kind: "call" as const }));
      // Merge both kinds of reference, sorted by position -- a page
      // can freely mix {varId} and {{modId.fn(args)}} in any order.
      const allSegments = [...callSegments, ...variableSegments].sort((a, b) => a.start - b.start);

      // Substitute each segment with its own HTML snippet BEFORE
      // handing the text to marked -- by the time a flattened,
      // plain-text-only resolution exists, the original markers are
      // gone, so inline widgets/chips have to be built from the
      // ORIGINAL markdown + segments instead.
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
        } else {
          const def = findVariableDef(segment.variableId);
          // An inline ref always shows ONE value (box or chip), never
          // xOfY's two boxes together -- component defaults to "x"
          // (current) when `.x`/`.y` isn't written.
          substituted += !def
            ? `[unknown variable: ${escapeHtml(segment.variableId)}]`
            : segment.display === "button"
              ? buildVariableChipHtml(def, character.variableValues, segment.component)
              : buildVariableComponentHtml(def, character.variableValues, segment.component);
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
        renderVariableWidget(host, variable, character.variableValues, (key, next) => {
          character.variableValues = { ...character.variableValues, [key]: next };
          saveSheet();
        });
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
    for (const def of RESERVED_BODY_SIZE_VARIABLES) renderVariableRow(bodySizeSection, def);
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

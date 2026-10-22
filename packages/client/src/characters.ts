// Standalone, account-scoped characters page -- MVP goal item 4
// (docs/ROADMAP.md). Real request: "a seperate page outside of games,
// specific to user accounts, with the different characters, and the
// character sheets displayed like it would be in game... Neither the
// game nor the character page should need 3d graphics to render it,
// just rst/md stuff." Modeled on lobby.ts's "one function, one big
// innerHTML template, closure state, async-IIFE bootstrap" pattern --
// no controller object/destroy, and (like lobby.ts) genuinely noa-free.
//
// Round 2 real corrections (mods-list filtering, clone-not-live-
// reference templates, the two-pane authoring UI, mods as libraries):
// see this file's git history / docs/COMPLETED.md.
//
// Round 3, real feedback from actually using round 2's editor:
// - **Bug fixed**: a page's resolved preview (library calls like
//   {{modId.fn(args)}}) only ever fetched from the markdown textarea's
//   OWN `input` handler -- the first time a page was shown (right
//   after cloning a template, or switching tabs) nothing triggered
//   that fetch, so calls sat unresolved until the user typed
//   something. View mode (below) now ALWAYS fetches on render.
// - **Layout**: Edit and View no longer compete for space side by
//   side -- each is its own full-width mode, toggled by a button, not
//   simultaneous. The whole sheet is also now a real tab bar ("Core &
//   Variables" + one tab per page), not one always-visible stack.
// - **Gap closed**: a page's own variables (via page.variableIds) now
//   render their VALUE widgets directly on that page (both Edit and
//   View), not only in the Core & Variables tab's definitions editor.
// - **New**: a local test-chat panel to the right -- clicking a
//   resolved library call's "roll chip" in View mode posts it there,
//   for trying out spell/attack-style buttons without a live game.
//
// Still true from round 2: nothing that dispatches its own click/
// change event ever rebuilds its OWN parent container's innerHTML
// from within that same handler -- only a DIFFERENT button/action
// rebuilds a given sub-tree; the element currently handling an event
// only ever toggles its own classes/attributes in place, or triggers
// a rebuild of some OTHER sibling sub-tree.

import { marked } from "marked";
import DOMPurify from "dompurify";
import { RESERVED_BODY_SIZE_VARIABLES, computeMissingModDependencies, findVariableRefs, type CharacterSheetVariableDef, type CharacterSheetVariableType, type CharacterSheetPageDef } from "@ttrpg3d/shared";
import {
  fetchAvailableMods,
  fetchAccountMods,
  importAccountMod,
  removeAccountMod,
  fetchCharactersForAccount,
  fetchCharacterSheetTemplates,
  fetchCharacterSheetLibraries,
  updateCharacterSheet,
  fetchCharacterSheetPreview,
  type ModManifest,
  type CharacterRecord,
  type CharacterSheetTemplateCatalogEntry,
  type CharacterSheetLibraryCatalogEntry,
} from "./api.js";
import { renderVariableWidget, buildVariableComponentHtml, buildVariableChipHtml, wireVariableWidgets } from "./characterSheetWidgets.js";
import { mountTestChatPanel, type TestChatPanelController } from "./testChatPanel.js";

const VARIABLE_TYPES: CharacterSheetVariableType[] = ["number", "range", "xOfY", "text"];
const SAVE_DEBOUNCE_MS = 500;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function mountCharactersPage(container: HTMLElement, httpUrl: string, accountId: string): void {
  container.innerHTML = `
    <style>
      .characters-layout { display: flex; gap: 16px; max-width: 1280px; margin: 48px auto; height: calc(100vh - 96px); font-family: system-ui, sans-serif; color: #eee; }
      .characters-page { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
      .characters-page h1 { font-size: 1.5rem; flex: none; }
      .characters-page h2 { font-size: 1.1rem; margin: 0 0 8px; }
      .characters-page h3 { font-size: 0.95rem; margin: 0 0 6px; color: #999; }
      .characters-page section { margin-bottom: 20px; flex: none; }
      .characters-page .scroll-body { overflow-y: auto; flex: 1 1 auto; min-height: 0; padding-right: 4px; }
      .characters-page .mod-list { list-style: none; padding: 0; margin: 0; }
      .characters-page .mod-list li { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; margin-bottom: 4px; background: #2a2a2a; border-radius: 6px; }
      .characters-page .mod-list .mod-meta { color: #999; font-size: 0.85em; margin-left: 6px; }
      .characters-page .char-list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; gap: 8px; flex-wrap: wrap; }
      .characters-page .char-list button { cursor: pointer; }
      .characters-page .char-list button.selected { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .characters-page .dependency-warning { background: rgba(200,80,40,0.25); border: 1px solid rgb(200,80,40); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
      .characters-page .sheet-page { background: #222; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
      .characters-page .variable-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .characters-page .variable-row label { min-width: 120px; }
      .characters-page input, .characters-page select, .characters-page button, .characters-page textarea { font-size: 1rem; padding: 6px 10px; font-family: inherit; }
      .characters-page .sheet-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
      .characters-page .sheet-tab { cursor: pointer; }
      .characters-page .sheet-tab.active { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .characters-page .page-mode-toggle { float: right; }
      .characters-page .page-markdown { width: 100%; min-height: 320px; resize: vertical; box-sizing: border-box; background: #111; color: #eee; border: 1px solid #444; }
      .characters-page .page-preview { min-height: 320px; }
      .characters-page .page-preview img { max-width: 100%; }
      .characters-page .chat-chip { background: rgb(255,217,51); color: #222; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; padding: 2px 8px; }
      .characters-page .computed-value { font-weight: bold; }
      .characters-page .page-preview .sheet-widget-number, .characters-page .page-preview .sheet-widget-text, .characters-page .page-preview .sheet-widget-xofy-current, .characters-page .page-preview .sheet-widget-xofy-max { width: 70px; }
      .characters-page .variable-def-list { list-style: none; padding: 0; margin: 0 0 8px; }
      .characters-page .variable-def-list li { display: flex; gap: 6px; align-items: center; padding: 6px; margin-bottom: 4px; background: #2a2a2a; border-radius: 6px; flex-wrap: wrap; }
      .characters-page .variable-def-list input { width: 90px; }
      .characters-page .variable-def-list select.var-pages { min-width: 120px; }
      .characters-page .var-value-label { color: #999; font-size: 0.85em; }
      .characters-page .library-hint { color: #999; font-size: 0.85em; margin: 0 0 6px; }
      .characters-page .library-hint code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; }
      .characters-page .library-list { list-style: none; padding: 0; margin: 0; }
      .characters-page .library-list li { padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.06); border-radius: 4px; }
      .characters-page .library-list .empty { color: #777; font-style: italic; }
      .test-chat-host { width: 300px; flex: none; }
    </style>
    <div class="characters-layout">
      <div class="characters-page">
        <h1>My Characters</h1>
        <div class="scroll-body">
          <section>
            <h2>Imported mods</h2>
            <ul class="mod-list" id="mod-list"></ul>
          </section>
          <section>
            <h2>Characters</h2>
            <ul class="char-list" id="char-list"></ul>
          </section>
          <section id="sheet-section"></section>
        </div>
      </div>
      <div class="test-chat-host" id="test-chat-host"></div>
    </div>
  `;

  const modListEl = container.querySelector<HTMLUListElement>("#mod-list")!;
  const charListEl = container.querySelector<HTMLUListElement>("#char-list")!;
  const sheetSectionEl = container.querySelector<HTMLDivElement>("#sheet-section")!;
  const testChatPanel: TestChatPanelController = mountTestChatPanel(container.querySelector<HTMLDivElement>("#test-chat-host")!);

  let availableMods: ModManifest[] = [];
  let importedModIds: string[] = [];
  let characters: CharacterRecord[] = [];
  let templates: CharacterSheetTemplateCatalogEntry[] = [];
  let libraries: CharacterSheetLibraryCatalogEntry[] = [];
  let selectedCharacterId: string | null = null;
  /** "core" = the Core & Variables tab; a number = that page's index. Defaults to the first PAGE (not "core") whenever a character becomes selected -- you want to see their sheet, not settings, by default. */
  let selectedSheetTab: "core" | number = 0;
  let pageMode: "view" | "edit" = "view";

  // ---- mods list --------------------------------------------------

  function renderModsList(): void {
    modListEl.innerHTML = availableMods
      .filter((m) => m.characterSheet)
      .map((m) => {
        const isImported = importedModIds.includes(m.id);
        return `<li><span>${m.name}<span class="mod-meta">v${m.version}</span></span><button class="mod-toggle-btn" type="button" data-mod-id="${m.id}" data-imported="${isImported}">${isImported ? "Remove" : "Import"}</button></li>`;
      })
      .join("");
  }

  modListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".mod-toggle-btn");
    if (!button) return;
    const modId = button.dataset.modId!;
    const importing = button.dataset.imported !== "true";
    const call = importing ? importAccountMod(httpUrl, accountId, modId) : removeAccountMod(httpUrl, accountId, modId);
    void call.then(async (updatedIds) => {
      importedModIds = updatedIds;
      // Update just THIS button in place -- rebuilding the whole list
      // from within its own click handler is the exact anti-pattern
      // that caused round 2's double-click bug.
      button.textContent = importing ? "Remove" : "Import";
      button.dataset.imported = String(importing);
      await Promise.all([refreshTemplates(), refreshLibraries()]);
      const character = selectedCharacter();
      if (character) renderDependencyWarning(character);
      // The Libraries list (Core & Variables tab) isn't visible from
      // any other tab, so only re-render when it's actually the one
      // currently showing -- same "only rebuild what's visible"
      // discipline the rest of this file already follows.
      if (character && selectedSheetTab === "core") renderSheetTabContent(character);
    });
  });

  // ---- character list ----------------------------------------------

  function renderCharList(): void {
    charListEl.innerHTML = characters.map((c) => `<button type="button" class="${c.id === selectedCharacterId ? "selected" : ""}" data-character-id="${c.id}">${c.name}</button>`).join("");
  }

  charListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-character-id]");
    if (!button) return;
    selectedCharacterId = button.dataset.characterId!;
    selectedSheetTab = 0;
    pageMode = "view";
    renderCharList();
    renderSheetSection();
  });

  async function refreshTemplates(): Promise<void> {
    templates = await fetchCharacterSheetTemplates(httpUrl, accountId);
  }

  async function refreshLibraries(): Promise<void> {
    libraries = await fetchCharacterSheetLibraries(httpUrl, accountId);
  }

  function selectedCharacter(): CharacterRecord | undefined {
    return characters.find((c) => c.id === selectedCharacterId);
  }

  /** Persists templateId/customSheet/variableValues wholesale -- no per-field endpoint. */
  function saveSheet(character: CharacterRecord): void {
    void updateCharacterSheet(httpUrl, character.id, accountId, character.templateId, character.customSheet, character.variableValues).then((updated) => {
      const index = characters.findIndex((c) => c.id === updated.id);
      if (index !== -1) characters[index] = updated;
    });
  }

  function renderVariableRow(parent: HTMLElement, def: CharacterSheetVariableDef, character: CharacterRecord): void {
    const row = document.createElement("div");
    row.className = "variable-row";
    const label = document.createElement("label");
    label.textContent = def.label;
    const widgetHost = document.createElement("span");
    renderVariableWidget(widgetHost, def, character.variableValues, (key, next) => {
      character.variableValues = { ...character.variableValues, [key]: next };
      saveSheet(character);
    });
    row.append(label, widgetHost);
    parent.append(row);
  }

  /** Looks up a variable's definition wherever it might live -- the sheet's own variables, or a core reserved one -- for resolving a `{variableId}` reference found in a page's markdown. */
  function findVariableDef(character: CharacterRecord, variableId: string): CharacterSheetVariableDef | undefined {
    return character.customSheet!.variables.find((v) => v.id === variableId) ?? RESERVED_BODY_SIZE_VARIABLES.find((v) => v.id === variableId);
  }

  // ---- dependency warning -------------------------------------------

  let dependencyWarningEl: HTMLDivElement;

  function renderDependencyWarning(character: CharacterRecord): void {
    if (!dependencyWarningEl) return;
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

  function renderEditMode(character: CharacterRecord, page: CharacterSheetPageDef, hostEl: HTMLElement): void {
    const textarea = document.createElement("textarea");
    textarea.className = "page-markdown";
    textarea.placeholder = "Write this page's content in Markdown...";
    textarea.value = page.markdown;
    hostEl.append(textarea);

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    textarea.addEventListener("input", () => {
      page.markdown = textarea.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => saveSheet(character), SAVE_DEBOUNCE_MS);
    });
  }

  function renderViewMode(character: CharacterRecord, page: CharacterSheetPageDef, hostEl: HTMLElement): void {
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
      testChatPanel.addMessage(`${character.name}: ${chip.dataset.chipLabel} -> ${chip.dataset.chipValue}`);
    });

    // Variable refs (`{variableId}`) resolve entirely client-side --
    // no mod/server involved, just this character's own variableValues.
    const variableSegments = findVariableRefs(page.markdown).map((s) => ({ ...s, kind: "variable" as const }));

    // Round 3 bug fix (still true): this now ALWAYS fetches on render
    // (previously only the edit textarea's own `input` handler ever
    // triggered it, so a freshly-cloned/just-opened page's library
    // calls sat unresolved, literally, until the user typed something).
    void fetchCharacterSheetPreview(httpUrl, accountId, page.markdown, character.variableValues).then((result) => {
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
          const def = findVariableDef(character, segment.variableId);
          // Round 5 real correction: an inline ref always shows ONE
          // value (box or chip), never xOfY's two boxes together --
          // component defaults to "x" (current) when `.x`/`.y` isn't
          // written, same default buildVariableComponentHtml/
          // buildVariableChipHtml already apply.
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
        saveSheet(character);
      });
    });
  }

  function renderPageTabContent(character: CharacterRecord, page: CharacterSheetPageDef): void {
    sheetTabContentEl.innerHTML = `<div class="sheet-page"><button type="button" class="page-mode-toggle" id="page-mode-toggle"></button><div id="page-mode-host"></div></div>`;
    const toggleBtn = sheetTabContentEl.querySelector<HTMLButtonElement>("#page-mode-toggle")!;
    const modeHostEl = sheetTabContentEl.querySelector<HTMLDivElement>("#page-mode-host")!;

    function renderMode(): void {
      toggleBtn.textContent = pageMode === "view" ? "Edit" : "View";
      modeHostEl.innerHTML = "";
      if (pageMode === "edit") renderEditMode(character, page, modeHostEl);
      else renderViewMode(character, page, modeHostEl);
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

  function renderVariablesSection(character: CharacterRecord): void {
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
          <input class="var-default" data-field="default" value="${v.default}" placeholder="default" />
          <select class="var-pages" multiple title="Which page(s) show this variable">${sheet.pages.map((p, pi) => `<option value="${pi}"${p.variableIds.includes(v.id) ? " selected" : ""}>${p.title}</option>`).join("")}</select>
          <span class="var-value-label">Value:</span> <span class="var-value-host" data-index="${i}"></span>
          <button type="button" class="delete-var-btn" data-index="${i}">Delete</button>
        </li>`,
        )
        .join("");
      // This character's CURRENT value widget per variable (round 5 --
      // the full, both-boxes-for-xOfY widget belongs HERE, not inline
      // on the sheet; see characterSheetWidgets.ts's own header for
      // the real correction this follows from). Mounted as real DOM
      // (not a plain HTML string) since renderVariableWidget wires its
      // own listeners -- same pattern renderVariableRow already uses
      // for the reserved body-size rows above.
      listEl.querySelectorAll<HTMLSpanElement>(".var-value-host").forEach((host) => {
        const variable = sheet.variables[Number(host.dataset.index)];
        renderVariableWidget(host, variable, character.variableValues, (key, next) => {
          character.variableValues = { ...character.variableValues, [key]: next };
          saveSheet(character);
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
        saveSheet(character);
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
        saveSheet(character);
        // The value widget's own SHAPE depends on type (one box vs.
        // xOfY's two) -- unlike id/label/default below, this has to
        // rebuild the row, not just re-save, or the old widget just
        // sits there showing the wrong type's boxes forever (real bug
        // found live: switching xOfY -> number left both the old
        // xOfY boxes AND a number box on screen at once).
        renderList();
        return;
      } else if (field === "default") {
        const asNumber = Number(value);
        variable.default = value !== "" && !Number.isNaN(asNumber) ? asNumber : value;
      }
      saveSheet(character);
    });

    listEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".delete-var-btn");
      if (!button) return;
      const index = Number(button.dataset.index);
      const [removed] = sheet.variables.splice(index, 1);
      for (const page of sheet.pages) page.variableIds = page.variableIds.filter((id) => id !== removed.id);
      saveSheet(character);
      renderList();
    });

    variablesSectionEl.querySelector<HTMLButtonElement>("#add-variable-btn")!.addEventListener("click", () => {
      let n = sheet.variables.length + 1;
      while (sheet.variables.some((v) => v.id === `var${n}`)) n++;
      sheet.variables.push({ id: `var${n}`, label: `Variable ${n}`, type: "number", default: 0 });
      saveSheet(character);
      renderList();
    });
  }

  /** "Gotta make it so we actually know what the mod library names are, because right now there's no way to tell" -- listed last on the Core & Variables tab, per the explicit placement request. Read-only (no mutation here) -- just what's callable via `{{modId.fn(args)}}`. */
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

  function renderCoreTabContent(character: CharacterRecord): void {
    sheetTabContentEl.innerHTML = `<div class="sheet-page" id="body-size-section"><h3>Body (core, always present)</h3></div><div class="sheet-page" id="variables-host"></div>`;
    const bodySizeSection = sheetTabContentEl.querySelector<HTMLDivElement>("#body-size-section")!;
    for (const def of RESERVED_BODY_SIZE_VARIABLES) renderVariableRow(bodySizeSection, def, character);
    variablesSectionEl = sheetTabContentEl.querySelector<HTMLDivElement>("#variables-host")!;
    renderVariablesSection(character);
    renderLibrariesSection(sheetTabContentEl);
  }

  // ---- sheet tab bar: "Core & Variables" + one per page ---------------

  let sheetTabsEl: HTMLDivElement;
  let sheetTabContentEl: HTMLDivElement;

  function updateActiveSheetTab(): void {
    sheetTabsEl.querySelectorAll<HTMLButtonElement>(".sheet-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === String(selectedSheetTab));
    });
  }

  function renderSheetTabContent(character: CharacterRecord): void {
    if (selectedSheetTab === "core") renderCoreTabContent(character);
    else renderPageTabContent(character, character.customSheet!.pages[selectedSheetTab]);
  }

  function renderSheetTabs(character: CharacterRecord): void {
    const pages = character.customSheet!.pages;
    sheetTabsEl.innerHTML =
      `<button type="button" class="sheet-tab" data-tab="core">Core &amp; Variables</button>` +
      pages.map((p, i) => `<button type="button" class="sheet-tab" data-tab="${i}">${p.title}</button>`).join("") +
      `<button type="button" id="add-page-btn">+ Add page</button><button type="button" id="delete-page-btn">Delete this page</button>`;
    updateActiveSheetTab();

    sheetTabsEl.querySelectorAll<HTMLButtonElement>(".sheet-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedSheetTab = btn.dataset.tab === "core" ? "core" : Number(btn.dataset.tab);
        pageMode = "view";
        // Only toggles classes on the EXISTING tab buttons and rebuilds
        // the (separate) content sub-tree -- never rebuilds this tab
        // bar's own parent from within a tab's own click handler.
        updateActiveSheetTab();
        renderSheetTabContent(character);
      });
    });

    sheetTabsEl.querySelector<HTMLButtonElement>("#add-page-btn")!.addEventListener("click", () => {
      const newPage: CharacterSheetPageDef = { title: `Page ${pages.length + 1}`, markdown: "", variableIds: [] };
      pages.push(newPage);
      selectedSheetTab = pages.length - 1;
      pageMode = "view";
      saveSheet(character);
      renderSheetTabs(character);
      renderSheetTabContent(character);
    });

    sheetTabsEl.querySelector<HTMLButtonElement>("#delete-page-btn")!.addEventListener("click", () => {
      if (pages.length <= 1 || typeof selectedSheetTab !== "number") return; // always keep at least one page
      pages.splice(selectedSheetTab, 1);
      selectedSheetTab = Math.max(0, selectedSheetTab - 1);
      pageMode = "view";
      saveSheet(character);
      renderSheetTabs(character);
      renderSheetTabContent(character);
    });
  }

  // ---- top-level sheet section: start-prompt vs. the tabbed shell ----

  function renderStartPrompt(character: CharacterRecord): void {
    sheetSectionEl.innerHTML = `
      <h2>${character.name}'s Sheet</h2>
      <p>This character doesn't have a sheet yet.</p>
      <div class="variable-row"><button type="button" id="start-blank-btn">Start a blank sheet</button></div>
      <div class="variable-row" id="start-template-list"></div>
    `;
    sheetSectionEl.querySelector<HTMLButtonElement>("#start-blank-btn")!.addEventListener("click", () => {
      character.customSheet = { name: `${character.name}'s Sheet`, pages: [{ title: "Overview", markdown: "", variableIds: [] }], variables: [] };
      character.templateId = null;
      selectedSheetTab = 0; // land on the real page just created, not the Core tab
      pageMode = "view";
      saveSheet(character);
      renderSheetSection();
    });
    const startTemplateListEl = sheetSectionEl.querySelector<HTMLDivElement>("#start-template-list")!;
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
      saveSheet(character);
      renderSheetSection();
    });
  }

  function renderSheetShell(character: CharacterRecord): void {
    if (typeof selectedSheetTab === "number") selectedSheetTab = Math.min(Math.max(selectedSheetTab, 0), character.customSheet!.pages.length - 1);

    sheetSectionEl.innerHTML = `
      <h2>${character.name}'s Sheet</h2>
      <div id="dependency-warning"></div>
      <div class="sheet-tabs" id="sheet-tabs"></div>
      <div id="sheet-tab-content"></div>
    `;
    dependencyWarningEl = sheetSectionEl.querySelector<HTMLDivElement>("#dependency-warning")!;
    sheetTabsEl = sheetSectionEl.querySelector<HTMLDivElement>("#sheet-tabs")!;
    sheetTabContentEl = sheetSectionEl.querySelector<HTMLDivElement>("#sheet-tab-content")!;

    renderDependencyWarning(character);
    renderSheetTabs(character);
    renderSheetTabContent(character);
  }

  function renderSheetSection(): void {
    const character = selectedCharacter();
    if (!character) {
      sheetSectionEl.innerHTML = "";
      return;
    }
    if (!character.customSheet) renderStartPrompt(character);
    else renderSheetShell(character);
  }

  void (async () => {
    [availableMods, importedModIds, characters] = await Promise.all([fetchAvailableMods(httpUrl), fetchAccountMods(httpUrl, accountId), fetchCharactersForAccount(httpUrl, accountId)]);
    renderModsList();
    renderCharList();
    await Promise.all([refreshTemplates(), refreshLibraries()]);
    selectedCharacterId = characters[0]?.id ?? null;
    renderCharList();
    renderSheetSection();
  })();
}

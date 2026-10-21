// Standalone, account-scoped characters page -- MVP goal item 4
// (docs/ROADMAP.md). Real request: "a seperate page outside of games,
// specific to user accounts, with the different characters, and the
// character sheets displayed like it would be in game... Neither the
// game nor the character page should need 3d graphics to render it,
// just rst/md stuff." Modeled on lobby.ts's "one function, one big
// innerHTML template, closure state, async-IIFE bootstrap" pattern --
// no controller object/destroy, and (like lobby.ts) genuinely noa-free.
//
// Round 2, real corrections from the first playtest:
// - Mods list only shows mods relevant to character sheets (`m.characterSheet`),
//   not every mod on disk -- example-noop has no business here.
// - A mod's `characterSheetTemplate` is now ONLY ever a CLONE SOURCE:
//   "Start from template X" deep-copies it into the character's own
//   `customSheet`, which is what's actually rendered/edited from then
//   on -- "not 'this is all you get ever' once the mod is loaded in."
// - Real authoring: a two-pane editor (raw markdown left, live
//   rendered preview right) plus a variables list the user can
//   add/remove/retype themselves -- "the only people that can make
//   character sheets are programmers" is the gap this closes.
// - Mods can provide LIBRARIES of callable functions
//   (`{{modId.fn(args)}}` inline in a page's markdown, resolved
//   server-side via the new character-sheet-preview endpoint -- see
//   api.ts's own doc on why that can't happen client-side) -- "the
//   mod is not supposed to be _just_ a template, but also libraries."
// - Structural fix for the "need two clicks" bug: nothing that
//   dispatches its own click/change event ever rebuilds its OWN
//   parent container's innerHTML from within that same handler (a
//   real anti-pattern) -- only a DIFFERENT button/action rebuilds a
//   given sub-tree; the element that's currently handling an event
//   only ever has its own attributes/classes toggled in place, or
//   triggers a rebuild of some OTHER sibling sub-tree.

import { marked } from "marked";
import DOMPurify from "dompurify";
import { RESERVED_BODY_SIZE_VARIABLES, computeMissingModDependencies, type CharacterSheetVariableDef, type CharacterSheetVariableType, type CharacterSheetPageDef } from "@ttrpg3d/shared";
import {
  fetchAvailableMods,
  fetchAccountMods,
  importAccountMod,
  removeAccountMod,
  fetchCharactersForAccount,
  fetchCharacterSheetTemplates,
  updateCharacterSheet,
  fetchCharacterSheetPreview,
  type ModManifest,
  type CharacterRecord,
  type CharacterSheetTemplateCatalogEntry,
} from "./api.js";
import { renderVariableWidget } from "./characterSheetWidgets.js";

const VARIABLE_TYPES: CharacterSheetVariableType[] = ["number", "range", "xOfY", "text"];
const PREVIEW_DEBOUNCE_MS = 500;

export function mountCharactersPage(container: HTMLElement, httpUrl: string, accountId: string): void {
  container.innerHTML = `
    <style>
      .characters-page { max-width: 960px; margin: 48px auto; font-family: system-ui, sans-serif; color: #eee; max-height: calc(100vh - 96px); display: flex; flex-direction: column; }
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
      .characters-page .page-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
      .characters-page .page-tab { cursor: pointer; }
      .characters-page .page-tab.active { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .characters-page .editor-split { display: flex; gap: 12px; }
      .characters-page .editor-split textarea { flex: 1 1 50%; min-height: 220px; resize: vertical; box-sizing: border-box; background: #111; color: #eee; border: 1px solid #444; }
      .characters-page .editor-split .editor-preview { flex: 1 1 50%; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; padding: 8px 12px; overflow-y: auto; }
      .characters-page .editor-preview img { max-width: 100%; }
      .characters-page .variable-def-list { list-style: none; padding: 0; margin: 0 0 8px; }
      .characters-page .variable-def-list li { display: flex; gap: 6px; align-items: center; padding: 6px; margin-bottom: 4px; background: #2a2a2a; border-radius: 6px; flex-wrap: wrap; }
      .characters-page .variable-def-list input { width: 90px; }
      .characters-page .variable-def-list select.var-pages { min-width: 120px; }
    </style>
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
  `;

  const modListEl = container.querySelector<HTMLUListElement>("#mod-list")!;
  const charListEl = container.querySelector<HTMLUListElement>("#char-list")!;
  const sheetSectionEl = container.querySelector<HTMLDivElement>("#sheet-section")!;

  let availableMods: ModManifest[] = [];
  let importedModIds: string[] = [];
  let characters: CharacterRecord[] = [];
  let templates: CharacterSheetTemplateCatalogEntry[] = [];
  let selectedCharacterId: string | null = null;
  let selectedPageIndex = 0;

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
      // that caused the double-click bug elsewhere on this page.
      button.textContent = importing ? "Remove" : "Import";
      button.dataset.imported = String(importing);
      await refreshTemplates();
      const character = selectedCharacter();
      if (character) renderDependencyWarning(character);
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
    selectedPageIndex = 0;
    renderCharList();
    renderSheetSection();
  });

  async function refreshTemplates(): Promise<void> {
    templates = await fetchCharacterSheetTemplates(httpUrl, accountId);
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
    const currentValue = character.variableValues[def.id] ?? def.default;
    renderVariableWidget(widgetHost, def, currentValue, (next) => {
      character.variableValues = { ...character.variableValues, [def.id]: next };
      saveSheet(character);
    });
    row.append(label, widgetHost);
    parent.append(row);
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

  // ---- the two-pane page editor --------------------------------------

  let pageEditorEl: HTMLDivElement;

  function renderPageEditor(character: CharacterRecord): void {
    const page = character.customSheet!.pages[selectedPageIndex];
    pageEditorEl.innerHTML = `
      <div class="editor-split">
        <textarea id="page-markdown" placeholder="Write this page's content in Markdown..."></textarea>
        <div class="editor-preview markdown" id="page-preview"></div>
      </div>
    `;
    const textarea = pageEditorEl.querySelector<HTMLTextAreaElement>("#page-markdown")!;
    const previewEl = pageEditorEl.querySelector<HTMLDivElement>("#page-preview")!;
    textarea.value = page.markdown;

    function renderLocalPreview(markdown: string): void {
      // The ONE deliberate innerHTML-of-untrusted-content spot in this
      // codebase -- sanitized immediately before insertion (see this
      // file's own header; chatPanel.ts's textContent convention is
      // the baseline everywhere else).
      previewEl.innerHTML = DOMPurify.sanitize(marked.parse(markdown) as string);
    }
    renderLocalPreview(page.markdown);

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    textarea.addEventListener("input", () => {
      page.markdown = textarea.value;
      // Instant local feedback (unresolved {{...}} calls shown literally)
      // while the debounced, fully-resolved version below is in flight.
      renderLocalPreview(textarea.value);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        saveSheet(character);
        void fetchCharacterSheetPreview(httpUrl, accountId, page.markdown, character.variableValues).then((resolved) => {
          renderLocalPreview(resolved);
        });
      }, PREVIEW_DEBOUNCE_MS);
    });
  }

  // ---- page tabs -----------------------------------------------------

  let pageTabsEl: HTMLDivElement;

  function updateActivePageTab(): void {
    pageTabsEl.querySelectorAll<HTMLButtonElement>(".page-tab").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.index) === selectedPageIndex);
    });
  }

  function renderPageTabs(character: CharacterRecord): void {
    const pages = character.customSheet!.pages;
    pageTabsEl.innerHTML =
      pages.map((p, i) => `<button type="button" class="page-tab" data-index="${i}">${p.title}</button>`).join("") +
      `<button type="button" id="add-page-btn">+ Add page</button><button type="button" id="delete-page-btn">Delete this page</button>`;
    updateActivePageTab();

    pageTabsEl.querySelectorAll<HTMLButtonElement>(".page-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedPageIndex = Number(btn.dataset.index);
        // Only toggles classes on the EXISTING tab buttons and rebuilds
        // the (separate) editor sub-tree -- never rebuilds this tab's
        // own parent from within its own click handler (the bug this
        // round fixes elsewhere on this page).
        updateActivePageTab();
        renderPageEditor(character);
      });
    });

    pageTabsEl.querySelector<HTMLButtonElement>("#add-page-btn")!.addEventListener("click", () => {
      const newPage: CharacterSheetPageDef = { title: `Page ${pages.length + 1}`, markdown: "", variableIds: [] };
      pages.push(newPage);
      selectedPageIndex = pages.length - 1;
      saveSheet(character);
      renderPageTabs(character);
      renderPageEditor(character);
    });

    pageTabsEl.querySelector<HTMLButtonElement>("#delete-page-btn")!.addEventListener("click", () => {
      if (pages.length <= 1) return; // always keep at least one page
      pages.splice(selectedPageIndex, 1);
      selectedPageIndex = Math.max(0, selectedPageIndex - 1);
      saveSheet(character);
      renderPageTabs(character);
      renderPageEditor(character);
    });
  }

  // ---- variables list (user-defined, not just values) ----------------

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
          <button type="button" class="delete-var-btn" data-index="${i}">Delete</button>
        </li>`,
        )
        .join("");
    }
    renderList();

    // Field edits mutate in place and save WITHOUT rebuilding the list
    // (rebuilding mid-edit would lose focus/cursor position, same
    // reentrancy class this round already fixes elsewhere).
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

  // ---- top-level sheet section: start-prompt vs. the editor shell ----

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
      saveSheet(character);
      renderSheetSection();
    });
  }

  function renderSheetShell(character: CharacterRecord): void {
    selectedPageIndex = Math.min(Math.max(selectedPageIndex, 0), character.customSheet!.pages.length - 1);

    sheetSectionEl.innerHTML = `
      <h2>${character.name}'s Sheet</h2>
      <div id="dependency-warning"></div>
      <div class="sheet-page" id="body-size-section"><h3>Body (core, always present)</h3></div>
      <div class="page-tabs" id="page-tabs"></div>
      <div class="sheet-page" id="page-editor-host"></div>
      <div class="sheet-page" id="variables-host"></div>
    `;
    dependencyWarningEl = sheetSectionEl.querySelector<HTMLDivElement>("#dependency-warning")!;
    pageTabsEl = sheetSectionEl.querySelector<HTMLDivElement>("#page-tabs")!;
    pageEditorEl = sheetSectionEl.querySelector<HTMLDivElement>("#page-editor-host")!;
    variablesSectionEl = sheetSectionEl.querySelector<HTMLDivElement>("#variables-host")!;

    const bodySizeSection = sheetSectionEl.querySelector<HTMLDivElement>("#body-size-section")!;
    for (const def of RESERVED_BODY_SIZE_VARIABLES) renderVariableRow(bodySizeSection, def, character);

    renderDependencyWarning(character);
    renderPageTabs(character);
    renderPageEditor(character);
    renderVariablesSection(character);
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
    await refreshTemplates();
    selectedCharacterId = characters[0]?.id ?? null;
    renderCharList();
    renderSheetSection();
  })();
}

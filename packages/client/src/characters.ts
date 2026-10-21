// Standalone, account-scoped characters page -- MVP goal item 4
// (docs/ROADMAP.md), slice 1. Real request: "a seperate page outside
// of games, specific to user accounts, with the different characters,
// and the character sheets displayed like it would be in game...
// Neither the game nor the character page should need 3d graphics to
// render it, just rst/md stuff." Modeled directly on lobby.ts's "one
// function, one big innerHTML template, closure state, async-IIFE
// bootstrap" pattern -- no controller object/destroy, same as that
// file (and, like it, genuinely noa-free: this page never touches a
// game/room/WorldRoom at all).
//
// Mod imports here are per-ACCOUNT, not site-wide and not per-game --
// real direction, 2026-10-21: "the character sheet page would itself
// have mods imported as libraries for different functionalities, and
// those mods would have to be imported to the character page itself
// per account, NOT site-wide." A character's template/library mods
// not being in the account's own importedModIds is a real, expected
// state (not an error) -- surfaced as a plain warning banner, not a
// hard block, per "both the gm and player would be notified."
//
// Markdown rendering: the ONE place in this codebase that deliberately
// inserts sanitized HTML via innerHTML (via `marked` -> `DOMPurify.
// sanitize`) -- everywhere else that renders untrusted text uses
// `textContent` (chatPanel.ts's own existing convention), which is
// exactly why this one spot needs the sanitization step at all.

import { marked } from "marked";
import DOMPurify from "dompurify";
import { RESERVED_BODY_SIZE_VARIABLES, computeMissingModDependencies, type CharacterSheetVariableDef } from "@ttrpg3d/shared";
import {
  fetchAvailableMods,
  fetchAccountMods,
  importAccountMod,
  removeAccountMod,
  fetchCharactersForAccount,
  fetchCharacterSheetTemplates,
  updateCharacterSheet,
  type ModManifest,
  type CharacterRecord,
  type CharacterSheetTemplateCatalogEntry,
} from "./api.js";
import { renderVariableWidget } from "./characterSheetWidgets.js";

export function mountCharactersPage(container: HTMLElement, httpUrl: string, accountId: string): void {
  container.innerHTML = `
    <style>
      .characters-page { max-width: 720px; margin: 48px auto; font-family: system-ui, sans-serif; color: #eee; max-height: calc(100vh - 96px); display: flex; flex-direction: column; }
      .characters-page h1 { font-size: 1.5rem; flex: none; }
      .characters-page h2 { font-size: 1.1rem; margin: 0 0 8px; }
      .characters-page section { margin-bottom: 20px; flex: none; }
      .characters-page .scroll-body { overflow-y: auto; flex: 1 1 auto; min-height: 0; }
      .characters-page .mod-list { list-style: none; padding: 0; margin: 0; }
      .characters-page .mod-list li { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; margin-bottom: 4px; background: #2a2a2a; border-radius: 6px; }
      .characters-page .mod-list .mod-meta { color: #999; font-size: 0.85em; margin-left: 6px; }
      .characters-page .char-list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; gap: 8px; flex-wrap: wrap; }
      .characters-page .char-list button { cursor: pointer; }
      .characters-page .char-list button.selected { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .characters-page .dependency-warning { background: rgba(200,80,40,0.25); border: 1px solid rgb(200,80,40); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
      .characters-page .sheet-page { background: #222; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
      .characters-page .sheet-page .markdown img { max-width: 100%; }
      .characters-page .variable-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .characters-page .variable-row label { min-width: 120px; }
      .characters-page input, .characters-page select, .characters-page button { font-size: 1rem; padding: 6px 10px; }
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

  function renderModsList(): void {
    modListEl.innerHTML = availableMods
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
      renderModsList();
      await refreshTemplates();
      renderSheet();
    });
  });

  function renderCharList(): void {
    charListEl.innerHTML = characters.map((c) => `<button type="button" class="${c.id === selectedCharacterId ? "selected" : ""}" data-character-id="${c.id}">${c.name}</button>`).join("");
  }

  charListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-character-id]");
    if (!button) return;
    selectedCharacterId = button.dataset.characterId!;
    renderCharList();
    renderSheet();
  });

  async function refreshTemplates(): Promise<void> {
    templates = await fetchCharacterSheetTemplates(httpUrl, accountId);
  }

  function selectedCharacter(): CharacterRecord | undefined {
    return characters.find((c) => c.id === selectedCharacterId);
  }

  /** Persists templateId + the full merged variableValues (reserved body-size vars + whatever the current template defines) wholesale -- no per-variable endpoint. */
  function saveSheet(character: CharacterRecord, templateId: string | null, variableValues: Record<string, number | string>): void {
    void updateCharacterSheet(httpUrl, character.id, accountId, templateId, variableValues).then((updated) => {
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
      saveSheet(character, character.templateId, character.variableValues);
    });
    row.append(label, widgetHost);
    parent.append(row);
  }

  function renderSheet(): void {
    const character = selectedCharacter();
    if (!character) {
      sheetSectionEl.innerHTML = "";
      return;
    }

    const templateOptions = `<option value="">(no template)</option>` + templates.map((t) => `<option value="${t.modId}"${t.modId === character.templateId ? " selected" : ""}>${t.template.name}</option>`).join("");
    sheetSectionEl.innerHTML = `
      <h2>${character.name}'s Sheet</h2>
      <div class="variable-row">
        <label for="template-select">Template:</label>
        <select id="template-select">${templateOptions}</select>
      </div>
      <div id="dependency-warning"></div>
      <div class="sheet-page" id="body-size-section"><h3>Body (core, always present)</h3></div>
      <div id="template-pages"></div>
    `;

    const templateSelect = sheetSectionEl.querySelector<HTMLSelectElement>("#template-select")!;
    templateSelect.addEventListener("change", () => {
      character.templateId = templateSelect.value || null;
      saveSheet(character, character.templateId, character.variableValues);
      renderSheet();
    });

    const bodySizeSection = sheetSectionEl.querySelector<HTMLDivElement>("#body-size-section")!;
    for (const def of RESERVED_BODY_SIZE_VARIABLES) renderVariableRow(bodySizeSection, def, character);

    const selectedTemplate = templates.find((t) => t.modId === character.templateId);
    const dependencyWarningEl = sheetSectionEl.querySelector<HTMLDivElement>("#dependency-warning")!;
    if (character.templateId) {
      const requiredModIds = [character.templateId, ...(selectedTemplate?.manifest.dependencies ?? [])];
      const missing = computeMissingModDependencies(requiredModIds, importedModIds);
      if (missing.length > 0) {
        dependencyWarningEl.innerHTML = `<div class="dependency-warning">This character's sheet needs mod${missing.length > 1 ? "s" : ""} not currently imported: ${missing.join(", ")}. Import them above to see the full sheet.</div>`;
      }
    }

    const pagesEl = sheetSectionEl.querySelector<HTMLDivElement>("#template-pages")!;
    if (!selectedTemplate) return;
    for (const page of selectedTemplate.template.pages) {
      const pageEl = document.createElement("div");
      pageEl.className = "sheet-page";
      const markdownEl = document.createElement("div");
      markdownEl.className = "markdown";
      // The ONE deliberate innerHTML-of-untrusted-content spot in this
      // codebase -- sanitized immediately before insertion, see this
      // file's own header.
      markdownEl.innerHTML = DOMPurify.sanitize(marked.parse(page.markdown) as string);
      pageEl.append(markdownEl);
      for (const variableId of page.variableIds) {
        const def = selectedTemplate.template.variables.find((v) => v.id === variableId);
        if (def) renderVariableRow(pageEl, def, character);
      }
      pagesEl.append(pageEl);
    }
  }

  void (async () => {
    [availableMods, importedModIds, characters] = await Promise.all([fetchAvailableMods(httpUrl), fetchAccountMods(httpUrl, accountId), fetchCharactersForAccount(httpUrl, accountId)]);
    renderModsList();
    renderCharList();
    await refreshTemplates();
    selectedCharacterId = characters[0]?.id ?? null;
    renderCharList();
    renderSheet();
  })();
}

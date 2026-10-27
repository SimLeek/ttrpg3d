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
// MVP goal item 4 follow-up ("characters" tab + popup/popout): the
// entire tabbed sheet-rendering machinery (Core & Variables + pages)
// moved out into `characterSheetView.ts` so the in-game popup and
// pop-out window can mount the exact SAME logic instead of a second
// copy of it -- this file now only keeps the mods-list/char-list/
// test-chat-panel page chrome and mounts that module for whichever
// character is selected, with `onPostToChat` wired to the local test
// chat panel (unchanged behavior for this page -- there's no real
// game/chat here at all, same reasoning this page has always had no
// 3D either).

import {
  fetchAvailableMods,
  fetchAccountMods,
  importAccountMod,
  removeAccountMod,
  fetchCharactersForAccount,
  fetchCharacterSheetTemplates,
  fetchCharacterSheetLibraries,
  deleteCharacter,
  createCharacter,
  importCharacterSheetFromWorkbook,
  type ModManifest,
  type CharacterRecord,
  type CharacterSheetTemplateCatalogEntry,
  type CharacterSheetLibraryCatalogEntry,
} from "./api.js";
import { mountCharacterSheetView, type CharacterSheetViewController } from "./characterSheetView.js";
import { mountTestChatPanel, type TestChatPanelController } from "./testChatPanel.js";
import { colorToHex, hexToColor, randomCharacterColor } from "./lobby.js";
import { fetchAndParseWorkbook } from "./characterSheetImport.js";
import { MOD_ACTIONS } from "./modActions.js";

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
      .characters-page .char-item { display: flex; align-items: center; gap: 2px; }
      .characters-page .char-list button { cursor: pointer; }
      .characters-page .char-list button.selected { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .characters-page .delete-char-btn { padding: 6px 8px; color: #e66; }
      .characters-page .new-char-row { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
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
      .characters-page .bar-def-list { list-style: none; padding: 0; margin: 0 0 8px; }
      .characters-page .bar-def-list li { display: flex; gap: 6px; align-items: center; padding: 6px; margin-bottom: 4px; background: #2a2a2a; border-radius: 6px; }
      .characters-page .bar-hint { color: #999; font-size: 0.85em; margin: 4px 0 0; }
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
            <div class="new-char-row">
              <input id="new-character-name" placeholder="New character name" />
              <input id="new-character-color" type="color" title="Token color" />
              <button type="button" id="create-character-btn">+ Create new character</button>
            </div>
            <div id="import-new-character-list"></div>
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
  const newCharacterNameInput = container.querySelector<HTMLInputElement>("#new-character-name")!;
  const newCharacterColorInput = container.querySelector<HTMLInputElement>("#new-character-color")!;
  const createCharacterBtn = container.querySelector<HTMLButtonElement>("#create-character-btn")!;
  const importNewCharacterListEl = container.querySelector<HTMLDivElement>("#import-new-character-list")!;
  newCharacterColorInput.value = colorToHex(randomCharacterColor());

  let availableMods: ModManifest[] = [];
  let importedModIds: string[] = [];
  let characters: CharacterRecord[] = [];
  let templates: CharacterSheetTemplateCatalogEntry[] = [];
  let libraries: CharacterSheetLibraryCatalogEntry[] = [];
  let selectedCharacterId: string | null = null;
  let currentView: CharacterSheetViewController | undefined;

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
      currentView?.refresh(templates, libraries, importedModIds);
    });
  });

  // ---- character list ----------------------------------------------

  function renderCharList(): void {
    charListEl.innerHTML = characters
      .map(
        (c) => `
      <span class="char-item">
        <button type="button" class="select-char-btn ${c.id === selectedCharacterId ? "selected" : ""}" data-character-id="${c.id}">${c.name}</button>
        <button type="button" class="delete-char-btn" data-character-id="${c.id}" title="Delete this character">✕</button>
      </span>`,
      )
      .join("");
  }

  charListEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const deleteBtn = target.closest<HTMLButtonElement>(".delete-char-btn");
    if (deleteBtn) {
      const characterId = deleteBtn.dataset.characterId!;
      const character = characters.find((c) => c.id === characterId);
      if (!character || !window.confirm(`Delete "${character.name}"? This can't be undone.`)) return;
      void deleteCharacter(httpUrl, characterId, accountId).then(() => {
        characters = characters.filter((c) => c.id !== characterId);
        if (selectedCharacterId === characterId) selectedCharacterId = characters[0]?.id ?? null;
        renderCharList();
        renderSheetSection();
      });
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-character-id]");
    if (!button) return;
    selectedCharacterId = button.dataset.characterId!;
    renderCharList();
    renderSheetSection();
  });

  // MVP goal item 4 follow-up -- real gap found live: this page never
  // had a way to CREATE a character at all (only the lobby did), which
  // became a real dead end once deleting your last/only character was
  // also possible from here ("deleting a character worked, but then I
  // was unable to create a new character on the characters page after
  // that"). Mirrors lobby.ts's own create-character flow exactly
  // (same REST call, same hex<->[r,g,b] color convention).
  createCharacterBtn.addEventListener("click", () => {
    const name = newCharacterNameInput.value.trim();
    if (!name) return;
    void createCharacter(httpUrl, accountId, name, hexToColor(newCharacterColorInput.value)).then((newCharacter) => {
      characters.push(newCharacter);
      selectedCharacterId = newCharacter.id;
      newCharacterNameInput.value = "";
      newCharacterColorInput.value = colorToHex(randomCharacterColor());
      renderCharList();
      renderSheetSection();
    });
  });

  /**
   * Real request, 2026-10-26: "add an import-url option to the
   * characters page when the mod is imported, because I want to see
   * how it looks like visually too... rather than expecting something
   * good to show up from default/0 values." A one-click "create +
   * import" path on THIS page's own top-level Characters section
   * (not nested inside an already-selected character's own sheet
   * view, which only ever offers importing for a brand-new, no-sheet-
   * yet character) -- one row per importer-capable template (same
   * `hasImporter` catalog flag characterSheetView.ts's own import
   * section already checks), each creating a fresh character and
   * immediately importing into it in one step.
   */
  function renderImportNewCharacterSection(): void {
    const importers = templates.filter((t) => t.hasImporter);
    importNewCharacterListEl.innerHTML = importers
      .map(
        (t) => `
      <div class="variable-row import-row" data-mod-id="${t.modId}">
        <span class="import-label">${escapeHtml(t.template.name)}:</span>
        <input type="text" class="import-new-character-name" placeholder="New character name" />
        <input type="text" class="import-url-input" placeholder="Google Sheets URL (the ordinary edit/share link is fine)" />
        <button type="button" class="import-from-url-btn">Create + Import</button>
        <span class="import-status"></span>
      </div>`,
      )
      .join("");
  }

  importNewCharacterListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".import-from-url-btn");
    if (!button) return;
    const row = button.closest<HTMLDivElement>(".import-row")!;
    const modId = row.dataset.modId!;
    const template = templates.find((t) => t.modId === modId);
    const nameInput = row.querySelector<HTMLInputElement>(".import-new-character-name")!;
    const urlInput = row.querySelector<HTMLInputElement>(".import-url-input")!;
    const statusEl = row.querySelector<HTMLSpanElement>(".import-status")!;
    const url = urlInput.value.trim();
    if (!url) return;
    const name = nameInput.value.trim() || `${template?.template.name ?? "Imported"} character`;
    statusEl.textContent = "Importing...";
    button.disabled = true;
    void createCharacter(httpUrl, accountId, name, randomCharacterColor())
      .then((newCharacter) =>
        fetchAndParseWorkbook(url)
          .then((workbook) => importCharacterSheetFromWorkbook(httpUrl, newCharacter.id, accountId, modId, workbook))
          .catch((err: unknown) => {
            // The character itself was created even though the import
            // failed (a bad URL, say) -- keep it (same "stale id, not
            // a crash" spirit as everywhere else) rather than silently
            // losing track of it, so the session can just retry the
            // import from its own now-existing sheet section instead.
            characters.push(newCharacter);
            renderCharList();
            throw err;
          }),
      )
      .then((updated) => {
        characters.push(updated);
        selectedCharacterId = updated.id;
        nameInput.value = "";
        urlInput.value = "";
        statusEl.textContent = "";
        button.disabled = false;
        renderCharList();
        renderSheetSection();
      })
      .catch((err: unknown) => {
        statusEl.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
        button.disabled = false;
      });
  });

  async function refreshTemplates(): Promise<void> {
    templates = await fetchCharacterSheetTemplates(httpUrl, accountId);
    renderImportNewCharacterSection();
  }

  async function refreshLibraries(): Promise<void> {
    libraries = await fetchCharacterSheetLibraries(httpUrl, accountId);
  }

  function selectedCharacter(): CharacterRecord | undefined {
    return characters.find((c) => c.id === selectedCharacterId);
  }

  function renderSheetSection(): void {
    const character = selectedCharacter();
    sheetSectionEl.innerHTML = "";
    currentView = undefined;
    if (!character) return;
    currentView = mountCharacterSheetView(sheetSectionEl, {
      httpUrl,
      viewerAccountId: accountId,
      sheetOwnerAccountId: accountId,
      character,
      templates,
      libraries,
      importedModIds,
      canEdit: true,
      modActions: MOD_ACTIONS,
      // Real request, 2026-10-26 (third pass): a single-part roll
      // (e.g. "evasion: 13") arrives with an empty `label`, posted
      // verbatim with no "-> " wrapper -- see characterSheetView.ts's
      // own single-part posting path.
      onPostToChat: (label, value, html) =>
        testChatPanel.addMessage(`${character.name}: ${label ? `${label} -> ${value}` : value}`, html !== undefined ? `${escapeHtml(character.name)}: ${html}` : undefined),
      onSaved: (updated) => {
        const index = characters.findIndex((c) => c.id === updated.id);
        if (index !== -1) characters[index] = updated;
      },
    });
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

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
  type ModManifest,
  type CharacterRecord,
  type CharacterSheetTemplateCatalogEntry,
  type CharacterSheetLibraryCatalogEntry,
} from "./api.js";
import { mountCharacterSheetView, type CharacterSheetViewController } from "./characterSheetView.js";
import { mountTestChatPanel, type TestChatPanelController } from "./testChatPanel.js";

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
    charListEl.innerHTML = characters.map((c) => `<button type="button" class="${c.id === selectedCharacterId ? "selected" : ""}" data-character-id="${c.id}">${c.name}</button>`).join("");
  }

  charListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-character-id]");
    if (!button) return;
    selectedCharacterId = button.dataset.characterId!;
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
      onPostToChat: (label, value) => testChatPanel.addMessage(`${character.name}: ${label} -> ${value}`),
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

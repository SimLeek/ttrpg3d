// Full-page bootstrap for a character sheet popped out into its own
// browser window (MVP goal item 4 follow-up, "characters" tab/popup --
// "something that can be popped out into a new separate browser
// window"). Mounted by main.ts's `/game/:gameId/character/:characterId`
// route -- a genuinely separate browser window/JS realm, so this opens
// its OWN `connectChat` connection (two browser tabs/windows on one
// account already works everywhere else in this app; nothing here
// needs to share a live reference with the tab that opened it) purely
// to SEND (and, for completeness, receive errors for) chat -- no 3D, no
// party list, no visible chat log in this window this round (posting
// works; seeing the scrollback here doesn't yet -- a flagged follow-up,
// not silently promised).

import { fetchAccounts, fetchCharacter, fetchCharacterSheetTemplates, fetchCharacterSheetLibraries, fetchAccountMods, ACCOUNT_STORAGE_KEY } from "./api.js";
import { connectChat } from "./chatNet.js";
import { mountCharacterSheetView } from "./characterSheetView.js";
import { MOD_ACTIONS } from "./modActions.js";

export async function mountCharacterSheetWindow(container: HTMLElement, httpUrl: string, wsUrl: string, gameId: string, characterId: string): Promise<void> {
  container.innerHTML = `
    <style>
      body { margin: 0; background: #181818; }
      .char-sheet-window { max-width: 900px; margin: 24px auto; padding: 0 16px 48px; font-family: system-ui, sans-serif; color: #eee; }
      .char-sheet-window .sheet-page { background: #222; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
      .char-sheet-window .variable-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .char-sheet-window .variable-row label { min-width: 120px; }
      .char-sheet-window input, .char-sheet-window select, .char-sheet-window button, .char-sheet-window textarea { font-size: 1rem; padding: 6px 10px; font-family: inherit; }
      .char-sheet-window .sheet-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
      .char-sheet-window .sheet-tab { cursor: pointer; }
      .char-sheet-window .sheet-tab.active { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .char-sheet-window .page-mode-toggle { float: right; }
      .char-sheet-window .page-markdown { width: 100%; min-height: 320px; resize: vertical; box-sizing: border-box; background: #111; color: #eee; border: 1px solid #444; }
      .char-sheet-window .chat-chip { background: rgb(255,217,51); color: #222; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; padding: 2px 8px; }
      .char-sheet-window .dependency-warning { background: rgba(200,80,40,0.25); border: 1px solid rgb(200,80,40); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
      .char-sheet-window .variable-def-list, .char-sheet-window .bar-def-list, .char-sheet-window .library-list { list-style: none; padding: 0; margin: 0 0 8px; }
      .char-sheet-window .variable-def-list li, .char-sheet-window .bar-def-list li { display: flex; gap: 6px; align-items: center; padding: 6px; margin-bottom: 4px; background: #2a2a2a; border-radius: 6px; flex-wrap: wrap; }
      #char-sheet-window-status { font-size: 0.85em; color: #999; margin-bottom: 12px; }
    </style>
    <div class="char-sheet-window">
      <p id="char-sheet-window-status">Loading...</p>
      <div id="char-sheet-window-body"></div>
    </div>
  `;
  const statusEl = container.querySelector<HTMLParagraphElement>("#char-sheet-window-status")!;
  const bodyEl = container.querySelector<HTMLDivElement>("#char-sheet-window-body")!;

  const storedAccountId = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  if (!storedAccountId) {
    statusEl.textContent = "Not logged in -- open this from the game's Characters tab instead.";
    return;
  }
  const accounts = await fetchAccounts(httpUrl);
  const account = accounts.find((a) => a.id === storedAccountId);
  if (!account) {
    statusEl.textContent = "Not logged in -- open this from the game's Characters tab instead.";
    return;
  }

  let character;
  let canEdit: boolean;
  try {
    ({ character, canEdit } = await fetchCharacter(httpUrl, characterId, account.id));
  } catch {
    statusEl.textContent = "This character doesn't exist, or you don't have access to it.";
    return;
  }

  const [templates, libraries, importedModIds, connection] = await Promise.all([
    fetchCharacterSheetTemplates(httpUrl, character.ownerAccountId),
    fetchCharacterSheetLibraries(httpUrl, character.ownerAccountId),
    fetchAccountMods(httpUrl, character.ownerAccountId),
    connectChat(wsUrl, gameId, account.displayName, account.id, characterId),
  ]);

  statusEl.textContent = `Connected to this game's chat as ${account.displayName} -- posts from this window attribute to ${character.name}.`;
  connection.onError((reason) => {
    statusEl.textContent = `Chat error: ${reason}`;
  });

  mountCharacterSheetView(bodyEl, {
    httpUrl,
    viewerAccountId: account.id,
    sheetOwnerAccountId: character.ownerAccountId,
    character,
    templates,
    libraries,
    importedModIds,
    canEdit,
    modActions: MOD_ACTIONS,
    // Real request, 2026-10-26 (third pass): a single-part label-as-
    // button roll (e.g. "evasion: 13") posts its own already-complete
    // "label: value" text with an empty `label` arg (characterSheetView.ts's
    // own single-part posting path) -- shown verbatim, no "-> " wrapper,
    // unlike a multi-part bundled action (e.g. "Light Attack -> atk: 24, damage: 12").
    onPostToChat: (label, value, html) => connection.send(label ? `${label} -> ${value}` : value, characterId, html),
  });
}

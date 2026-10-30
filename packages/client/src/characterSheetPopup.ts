// In-game character-sheet popup -- MVP goal item 4 follow-up
// ("characters" tab): "a pop up should open that should basically be
// that character sheet... opened to the first page tab, pretty much
// all the same stuff, just with the stuff actually going to the real
// chat." Mounts the exact same `characterSheetView.ts` the standalone
// /characters page uses -- only `onPostToChat` differs (sends through
// the already-open, real game chat connection instead of a local test
// panel), and `canEdit` is computed server-side (fetchCharacter) so a
// shared/visible character you don't own or admin renders read-only
// (no "Core & Variables" tab, no Edit-mode button -- see
// characterSheetView.ts's own header).
//
// Same centered-modal-over-the-safe-area pattern as pageManager.ts
// (`display:none` -> `.open`, input capture while open, Escape/✕ to
// close) -- the established "popup over the 3D canvas" convention in
// this project.
//
// "Pop out" is the first `window.open` usage in this client -- opens
// a genuinely separate browser window at a dedicated route
// (main.ts's `/game/:gameId/character/:characterId`), which mounts
// the SAME `characterSheetView.ts` full-page with its OWN independent
// chat connection (two browser windows/tabs on one account is already
// how this app works everywhere else -- nothing here needs to share a
// live reference across them). Closes this in-game modal when popping
// out, rather than leaving both open at once.

import { fetchCharacter, fetchCharacterSheetTemplates, fetchCharacterSheetLibraries, fetchAccountMods, type CharacterSheetTemplateCatalogEntry, type CharacterSheetLibraryCatalogEntry } from "./api.js";
import { mountCharacterSheetView, type CharacterSheetViewController } from "./characterSheetView.js";
import { getAllModActions, ensureModActionsLoaded } from "./modActions.js";
import { requestCapture, releaseCapture } from "./inputCapture.js";
import { SAFE_AREA_LEFT_VAR, SAFE_AREA_RIGHT_VAR, SAFE_AREA_TOP_VAR, SAFE_AREA_BOTTOM_VAR } from "./panelLayout.js";

const CAPTURE_REASON = "characterSheetPopup";

export interface CharacterSheetPopupOptions {
  httpUrl: string;
  gameId: string;
  viewerAccountId: string;
  /** Sends through the already-open, real game chat connection (main.ts's runningChat.connection), attributed to this character. `html` (real request, 2026-10-29 -- "the chat in the main game... should be exactly the same [as test chat]") is the same richer rendering test chat's own onPostToChat already carries. */
  onPostToChat(characterId: string, text: string, html?: string): void;
}

export interface CharacterSheetPopupController {
  open(characterId: string): void;
  close(): void;
  destroy(): void;
}

export function mountCharacterSheetPopup(container: HTMLElement, options: CharacterSheetPopupOptions): CharacterSheetPopupController {
  const { httpUrl, gameId, viewerAccountId } = options;

  container.innerHTML = `
    <style>
      .char-sheet-popup-overlay { position: fixed; left: var(${SAFE_AREA_LEFT_VAR}, 0px); right: var(${SAFE_AREA_RIGHT_VAR}, 0px); top: var(${SAFE_AREA_TOP_VAR}, 0px); bottom: var(${SAFE_AREA_BOTTOM_VAR}, 0px); background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; font-family: system-ui, sans-serif; z-index: 10; }
      .char-sheet-popup-overlay.open { display: flex; }
      .char-sheet-popup-panel { background: rgba(24,24,28,0.97); border: 2px solid rgba(200,200,200,0.7); border-radius: 6px; padding: 16px; width: min(900px, 90vw); max-height: 90vh; overflow-y: auto; color: #eee; }
      .char-sheet-popup-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
      .char-sheet-popup-header h2 { margin: 0; font-size: 16px; font-weight: normal; }
      .char-sheet-popup-header .actions { display: flex; gap: 6px; flex: none; }
      .char-sheet-popup-header button { font-size: 0.9rem; padding: 4px 10px; }
      .char-sheet-popup-panel .sheet-page { background: #222; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
      .char-sheet-popup-panel .variable-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .char-sheet-popup-panel .variable-row label { min-width: 120px; }
      .char-sheet-popup-panel input, .char-sheet-popup-panel select, .char-sheet-popup-panel button, .char-sheet-popup-panel textarea { font-size: 1rem; padding: 6px 10px; font-family: inherit; }
      .char-sheet-popup-panel .sheet-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
      .char-sheet-popup-panel .sheet-tab { cursor: pointer; }
      .char-sheet-popup-panel .sheet-tab.active { border-color: rgb(255,217,51); color: rgb(255,217,51); }
      .char-sheet-popup-panel .page-mode-toggle { float: right; }
      .char-sheet-popup-panel .page-markdown { width: 100%; min-height: 320px; resize: vertical; box-sizing: border-box; background: #111; color: #eee; border: 1px solid #444; }
      .char-sheet-popup-panel .page-preview { min-height: 120px; }
      .char-sheet-popup-panel .chat-chip { background: rgb(255,217,51); color: #222; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; padding: 2px 8px; }
      .char-sheet-popup-panel .dependency-warning { background: rgba(200,80,40,0.25); border: 1px solid rgb(200,80,40); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
      .char-sheet-popup-panel .variable-def-list, .char-sheet-popup-panel .bar-def-list, .char-sheet-popup-panel .library-list { list-style: none; padding: 0; margin: 0 0 8px; }
      .char-sheet-popup-panel .variable-def-list li, .char-sheet-popup-panel .bar-def-list li { display: flex; gap: 6px; align-items: center; padding: 6px; margin-bottom: 4px; background: #2a2a2a; border-radius: 6px; flex-wrap: wrap; }
    </style>
    <div class="char-sheet-popup-overlay" id="char-sheet-popup-overlay">
      <div class="char-sheet-popup-panel">
        <div class="char-sheet-popup-header">
          <h2 id="char-sheet-popup-title">Loading...</h2>
          <div class="actions">
            <button type="button" id="char-sheet-popup-popout">Pop out</button>
            <button type="button" id="char-sheet-popup-close">✕</button>
          </div>
        </div>
        <div id="char-sheet-popup-body"></div>
      </div>
    </div>
  `;

  const overlay = container.querySelector<HTMLDivElement>("#char-sheet-popup-overlay")!;
  const titleEl = container.querySelector<HTMLHeadingElement>("#char-sheet-popup-title")!;
  const bodyEl = container.querySelector<HTMLDivElement>("#char-sheet-popup-body")!;
  const popoutBtn = container.querySelector<HTMLButtonElement>("#char-sheet-popup-popout")!;
  const closeBtn = container.querySelector<HTMLButtonElement>("#char-sheet-popup-close")!;

  let isOpen = false;
  let openCharacterId: string | null = null;
  let view: CharacterSheetViewController | undefined;

  function setOpen(next: boolean): void {
    isOpen = next;
    overlay.classList.toggle("open", isOpen);
    if (isOpen) requestCapture(CAPTURE_REASON);
    else releaseCapture(CAPTURE_REASON);
    if (!isOpen) {
      openCharacterId = null;
      view = undefined;
      bodyEl.innerHTML = "";
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.code === "Escape" && isOpen) setOpen(false);
  }
  window.addEventListener("keydown", onKeydown);

  closeBtn.addEventListener("click", () => setOpen(false));
  popoutBtn.addEventListener("click", () => {
    if (!openCharacterId) return;
    window.open(`${location.origin}/game/${encodeURIComponent(gameId)}/character/${encodeURIComponent(openCharacterId)}`, "_blank", "width=720,height=800");
    setOpen(false);
  });

  return {
    open(characterId: string): void {
      openCharacterId = characterId;
      titleEl.textContent = "Loading...";
      bodyEl.innerHTML = "";
      setOpen(true);

      void fetchCharacter(httpUrl, characterId, viewerAccountId).then(async ({ character, canEdit }) => {
        if (openCharacterId !== characterId) return; // a different character was opened/closed before this resolved
        titleEl.textContent = `${character.name}'s Sheet`;
        const [templates, libraries, importedModIds]: [CharacterSheetTemplateCatalogEntry[], CharacterSheetLibraryCatalogEntry[], string[]] = await Promise.all([
          fetchCharacterSheetTemplates(httpUrl, character.ownerAccountId),
          fetchCharacterSheetLibraries(httpUrl, character.ownerAccountId),
          fetchAccountMods(httpUrl, character.ownerAccountId),
        ]);
        if (openCharacterId !== characterId) return;
        // This popup never shows the account mods list/"Import" button
        // itself -- same reasoning as characterSheetWindow.ts's own copy
        // of this line.
        for (const modId of importedModIds) void ensureModActionsLoaded(modId);
        view = mountCharacterSheetView(bodyEl, {
          httpUrl,
          viewerAccountId,
          sheetOwnerAccountId: character.ownerAccountId,
          character,
          templates,
          libraries,
          importedModIds,
          canEdit,
          modActions: getAllModActions(),
          // Real request, 2026-10-26 (third pass): a single-part roll
          // (e.g. "evasion: 13") arrives with an empty `label` and an
          // already-complete `value` text (characterSheetView.ts's own
          // single-part posting path) -- posted verbatim, no "-> "
          // wrapper, unlike a multi-part bundled action.
          onPostToChat: (label, value, html) => options.onPostToChat(characterId, label ? `${label} -> ${value}` : value, html),
        });
      });
    },
    close(): void {
      setOpen(false);
    },
    destroy(): void {
      window.removeEventListener("keydown", onKeydown);
      if (isOpen) releaseCapture(CAPTURE_REASON);
    },
  };
}

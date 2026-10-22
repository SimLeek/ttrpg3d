// Game-wide chat panel, docked to the right edge -- the OUTERMOST,
// largest of the eventual panel UI chrome (docs/ROADMAP.md's MVP goal
// section, item 3): the other planned panels (mode-select, party list,
// quick-actions) don't exist yet, and chat is "the most important," so
// it gets the most room for now. Width is drag-resizable (a handle on
// the panel's left edge -- real user correction: an earlier version of
// this only had a click-to-collapse toggle between two fixed sizes,
// which wasn't what was actually wanted), plus a separate click-to-
// collapse toggle tab for quickly getting it out of the way entirely --
// the two aren't mutually exclusive, collapsing just remembers the
// dragged width to restore on expand.
//
// Deliberately noa-free (same reasoning as hotbar.ts), so this stays
// unit-testable against a real but detached DOM (jsdom) without a real
// Engine/WebGL context -- see chatPanel.test.ts. Pointer-lock suspend
// while typing is exposed as an `onFocusChange` callback for whatever
// mounts this to wire up (mirrors hotbar.ts's `onInventoryOpenChange`
// pattern -- NOT pageManager.ts's gap of requesting capture but never
// touching pointer-lock, which would leave the mouse locked while
// trying to type).
//
// Enter with no input focused opens/focuses the box; Enter while
// focused sends the message and blurs back to gameplay (same two-step
// convention most multiplayer games use); Escape while focused blurs
// WITHOUT sending and without closing the whole panel -- chat itself
// stays visible "for the entire game," unlike hotbar/pageManager's
// Escape-closes-the-overlay panels.
//
// GM-only tab (real correction, 2026-10-21, second pass -- a prior
// attempt put this GM content in a separate floating overlay,
// gmPanel.ts; explicitly rejected: "don't just make everything a
// window... this should be a gm-only panel in the same space as chat,
// so it should be another tab... GM on means the tab appears, GM off
// means the tab disappears"). Content: the per-game mods list (enable/
// disable + a dirty-flagged "Reload this page" button, since no hot-
// reload exists) and the seeThroughWalls checkbox (blockShaders.ts's
// xray-cutout shader + cameraZoom.ts's real wall-collision clamp, both
// toggled together -- see game.ts's own wiring for why).
//
// MVP goal item 4 follow-up ("characters" tab): a SECOND real tab,
// "Characters," always visible (not GM-gated) -- real correction: with
// 2+ always-real tabs now (Chat, Characters), the WHOLE bar is shown
// unconditionally; only the GM tab itself is still conditionally
// added/removed (appended last/rightmost, via `setGmTabVisible`,
// unchanged in spirit from before -- just no longer also gating the
// bar's own visibility). Tab order: Chat, Characters, GM.
//
// Real correction: "a player should be able to drop down and select
// what character they want to post as out of all the characters they
// have access to, or their username by default... right above the
// chat typing entry area." So the compose row also gets a `<select>`
// populated from the SAME visible-characters list the Characters tab
// uses -- `onSend`'s signature carries whichever one is currently
// selected (null = "my username", the default).
//
// Stays "noa-free, pure presentational" like the rest of this file --
// data/actions are props and setXState() push-methods (mirrors
// addMessage's "push updated data in after mount" shape); main.ts owns
// the actual fetching/mutation/room-message sends.

import type { ChatMessage, ModManifest, VisibleGameCharacterEntry } from "./api.js";
import { requestCapture, releaseCapture } from "./inputCapture.js";
import { PERSISTENT_PANEL_Z_INDEX, SAFE_AREA_RIGHT_VAR, setSafeAreaInset } from "./panelLayout.js";

const MIN_WIDTH = 180;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 320;
const COLLAPSED_WIDTH = 28;

type ChatPanelTab = "chat" | "characters" | "gm";

/** MVP goal item 4 follow-up (drag-and-drop placement) -- the dataTransfer key a dragged Characters-tab row's characterId travels under; characterPlacement.ts's `drop` handler reads this same key back out. A custom type, not plain "text/plain", so a drag from somewhere else in the page (or outside it) is never mistaken for a character drop. */
export const CHARACTER_DRAG_MIME = "application/x-ttrpg3d-character-id";

export interface ChatPanelOptions {
  initialMessages: ChatMessage[];
  /** `asCharacterId` is whichever character the compose row's "post as" dropdown currently has selected -- null for the default "my username." */
  onSend: (text: string, asCharacterId: string | null) => void;
  /** Called right after the compose box gains or loses focus, so the caller can suspend/restore pointer-lock mouse-look (a noa concern, kept out of this file). */
  onFocusChange?: (focused: boolean) => void;
  /** Fired when the GM tab's Enable/Disable button is clicked -- main.ts owns the actual `enableGameMod`/`disableGameMod` REST call and feeds the real result back via `setModsState`. */
  onToggleMod: (modId: string, enable: boolean) => void;
  /** Fired by the GM tab's Reload button -- main.ts re-launches the player's own current world (no hot-reload exists, this is the real "pick up the new mod list" mechanism). */
  onReloadWorld: () => void;
  /** Fired by the GM tab's seeThroughWalls checkbox -- main.ts sends the admin-gated room message via the current RunningGame. */
  onSetSeeThroughWalls: (enabled: boolean) => void;
  /** Fired by clicking a character row in the Characters tab -- main.ts opens the character-sheet popup. */
  onOpenCharacter: (characterId: string) => void;
  /** Fired by the "Link" button -- main.ts owns the actual REST call and feeds the fresh list back via `setCharactersState`. */
  onLinkCharacter: (characterId: string, folder: string | null) => void;
  onUnlinkCharacter: (characterId: string) => void;
  onUpdateCharacterLink: (characterId: string, patch: { folder?: string | null; visibility?: "all" | string[] }) => void;
  /** Fired by the "Delete" button (owner-only, confirmed first) -- deletes the character record itself, not just this game's link to it. */
  onDeleteCharacter: (characterId: string) => void;
}

export interface ChatPanelController {
  addMessage(message: ChatMessage): void;
  showError(reason: string): void;
  /** Shows/hides JUST the GM tab button+pane -- driven by gmOverride.ts's own toggle (GM on = true), not a separate hotkey. The outer tab bar itself is always visible now (Chat + Characters are always real tabs). Hiding while the GM tab is the active one snaps back to Chat. */
  setGmTabVisible(visible: boolean): void;
  /** Pushes fresh mod data into the GM tab (initial fetch, and after every toggle's REST response) -- same "data arrives after mount" shape as addMessage. */
  setModsState(availableMods: ModManifest[], enabledModIds: string[]): void;
  /** Reflects the room's current seeThroughWalls value in the GM tab's checkbox (initial value, and any live change -- e.g. another admin toggled it). */
  setSeeThroughWallsState(enabled: boolean): void;
  /**
   * Pushes fresh data into the Characters tab AND the compose row's
   * "post as" dropdown (same underlying list, two places it's used).
   * `isAdmin` governs whether folder/visibility/unlink controls show
   * on EVERY row (an admin can manage any linked character) or only
   * the viewer's own (reused from the SAME gmOverride signal the GM
   * tab's own visibility already uses, not a second permission system).
   */
  setCharactersState(visibleLinks: VisibleGameCharacterEntry[], participantAccounts: { id: string; displayName: string }[], myCharacters: { id: string; name: string }[], viewerAccountId: string, isAdmin: boolean): void;
  /** Removes this panel's window-level key listener and releases its input capture if the compose box was left focused. Mirrors hotbar.ts's destroy() pattern. */
  destroy(): void;
}

function formatMessage(message: ChatMessage): string {
  return `${message.senderName}: ${message.text}`;
}

export function mountChatPanel(container: HTMLElement, options: ChatPanelOptions): ChatPanelController {
  container.innerHTML = `
    <style>
      /* z-index needed: this panel's container is created in main.ts
         BEFORE a game session's startGame() ever runs (so it survives
         page switches -- see main.ts's enterGame), which means noa's own
         canvas element is always a LATER DOM sibling appended on every
         page switch and would otherwise paint on top with no explicit
         z-index -- reproduced live as "no chat panel visible at all"
         (it was there, just hidden underneath the canvas). pageManager.ts
         needed the same fix for an unrelated reason (its own z-index:10)
         -- this is set higher since chat is meant to be the outermost,
         always-visible panel. */
      /* No CSS width here -- the panel's width is set inline via JS
         (applyWidth below), which is the single source of truth while
         expanded; .collapsed overrides it back down to a fixed tab
         width, cleared again on expand. */
      .chat-panel { position: fixed; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column; background: rgba(20,20,24,0.85); border-left: 2px solid rgba(200,200,200,0.4); font-family: system-ui, sans-serif; color: #eee; z-index: ${PERSISTENT_PANEL_Z_INDEX}; }
      .chat-panel.collapsed { width: ${COLLAPSED_WIDTH}px !important; }
      .chat-panel.collapsed .chat-body { display: none; }
      .chat-panel.collapsed .chat-resize-handle { display: none; }
      .chat-resize-handle { position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; cursor: ew-resize; }
      .chat-toggle { position: absolute; top: 8px; left: -24px; width: 24px; height: 32px; background: rgba(20,20,24,0.85); border: 2px solid rgba(200,200,200,0.4); border-right: none; border-radius: 4px 0 0 4px; cursor: pointer; color: #eee; font-size: 14px; display: flex; align-items: center; justify-content: center; }
      .chat-body { display: flex; flex-direction: column; height: 100%; min-width: 0; }
      /* Always visible now -- Chat + Characters are always 2 real
         tabs. Only the GM button itself (.hidden) toggles. */
      .chat-tabs { display: flex; flex: none; border-bottom: 1px solid rgba(200,200,200,0.3); }
      .chat-tab-btn { flex: 1; padding: 6px 4px; font-size: 12px; background: none; border: none; color: #999; cursor: pointer; border-bottom: 2px solid transparent; }
      .chat-tab-btn.active { color: #eee; border-bottom-color: rgb(255,217,51); }
      .chat-tab-btn.hidden { display: none; }
      .chat-tab-pane { display: none; flex-direction: column; flex: 1 1 auto; min-height: 0; }
      .chat-tab-pane.active { display: flex; }
      .chat-send-as { flex: none; width: 100%; box-sizing: border-box; margin-bottom: 6px; padding: 4px 6px; font-size: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(200,200,200,0.4); border-radius: 4px; color: #eee; }
      .chat-characters-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 12px; }
      .link-character-form { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; }
      .link-character-form select, .link-character-form input { font-size: 12px; padding: 4px; }
      .character-folder-group h4 { margin: 10px 0 4px; font-size: 11px; color: #999; text-transform: uppercase; }
      .character-link-list { list-style: none; padding: 0; margin: 0; }
      .character-link-list li { padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.06); border-radius: 4px; }
      .character-link-list .open-character-btn { display: block; width: 100%; text-align: left; font-weight: bold; background: none; border: none; color: rgb(255,217,51); cursor: pointer; padding: 2px 0; }
      .character-link-manage { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-top: 4px; font-size: 11px; }
      .character-link-manage input[type="text"] { width: 90px; font-size: 11px; padding: 2px 4px; }
      .character-link-manage select { font-size: 11px; max-width: 120px; }
      .character-link-list .empty { color: #777; font-style: italic; }
      /* Only the message list scrolls -- NOT the panel or document (the
         exact class of bug lobby.ts's own scroll fix already dealt with:
         index.html's html/body overflow:hidden would otherwise make any
         chat longer than one screen simply unreachable). */
      .chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 13px; line-height: 1.4; word-break: break-word; }
      .chat-messages .msg { margin-bottom: 4px; }
      .chat-messages .err { margin-bottom: 4px; color: #e66; font-style: italic; }
      .chat-input-row { flex: none; padding: 8px; border-top: 1px solid rgba(200,200,200,0.3); }
      .chat-input-row input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 13px; background: rgba(0,0,0,0.3); border: 1px solid rgba(200,200,200,0.4); border-radius: 4px; color: #eee; }
      .chat-gm-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; font-size: 12px; }
      .chat-gm-body h3 { margin: 0 0 6px; font-size: 12px; font-weight: normal; color: #999; }
      .chat-gm-body label.checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 12px; }
      .mod-list { list-style: none; padding: 0; margin: 0 0 12px; }
      .mod-list li { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.06); border-radius: 4px; }
      .mod-list .mod-meta { color: #999; font-size: 0.85em; margin-left: 6px; }
      .mod-list button, .chat-reload-btn { font-size: 12px; padding: 4px 8px; }
      .chat-reload-btn { width: 100%; padding: 8px; font-size: 13px; }
      /* "Foolproof" (explicit request): neutral/disabled until a mod is
         actually toggled, then obviously flagged -- not a subtle hint
         someone could miss, since there's no hot-reload to fall back on. */
      .chat-reload-btn.dirty { background: rgb(255,217,51); color: #222; font-weight: bold; border-color: rgb(255,217,51); }
    </style>
    <div class="chat-panel" id="chat-panel">
      <div class="chat-resize-handle" id="chat-resize-handle" title="Drag to resize"></div>
      <button class="chat-toggle" id="chat-toggle" type="button" title="Collapse/expand chat">&raquo;</button>
      <div class="chat-body">
        <div class="chat-tabs" id="chat-tabs">
          <button class="chat-tab-btn active" id="chat-tab-chat-btn" type="button">Chat</button>
          <button class="chat-tab-btn" id="chat-tab-characters-btn" type="button">Characters</button>
          <button class="chat-tab-btn hidden" id="chat-tab-gm-btn" type="button">GM</button>
        </div>
        <div class="chat-tab-pane active" id="chat-tab-chat">
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-row">
            <select class="chat-send-as" id="chat-send-as" title="Post as">
              <option value="">My username</option>
            </select>
            <input id="chat-input" type="text" placeholder="Press Enter to chat..." />
          </div>
        </div>
        <div class="chat-tab-pane" id="chat-tab-characters">
          <div class="chat-characters-body" id="chat-characters-body">
            <div class="link-character-form">
              <select id="link-character-select"></select>
              <input id="link-character-folder" type="text" placeholder="Folder (optional)" />
              <button type="button" id="link-character-btn">Link</button>
            </div>
            <div id="character-groups"></div>
          </div>
        </div>
        <div class="chat-tab-pane" id="chat-tab-gm">
          <div class="chat-gm-body">
            <label class="checkbox-row">
              <input type="checkbox" id="chat-see-through-walls" />
              Players can see through walls (third-person camera)
            </label>
            <h3>Mods for this game</h3>
            <ul class="mod-list" id="mod-list"></ul>
            <button class="chat-reload-btn" id="chat-reload-btn" type="button" disabled title="Reload your current page to pick up mod changes (no hot-reload)">Reload this page</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const panel = container.querySelector<HTMLDivElement>("#chat-panel")!;
  const toggle = container.querySelector<HTMLButtonElement>("#chat-toggle")!;
  const resizeHandle = container.querySelector<HTMLDivElement>("#chat-resize-handle")!;
  const messagesEl = container.querySelector<HTMLDivElement>("#chat-messages")!;
  const input = container.querySelector<HTMLInputElement>("#chat-input")!;
  const sendAsSelect = container.querySelector<HTMLSelectElement>("#chat-send-as")!;
  const chatTabBtn = container.querySelector<HTMLButtonElement>("#chat-tab-chat-btn")!;
  const charactersTabBtn = container.querySelector<HTMLButtonElement>("#chat-tab-characters-btn")!;
  const gmTabBtn = container.querySelector<HTMLButtonElement>("#chat-tab-gm-btn")!;
  const chatTabPane = container.querySelector<HTMLDivElement>("#chat-tab-chat")!;
  const charactersTabPane = container.querySelector<HTMLDivElement>("#chat-tab-characters")!;
  const gmTabPane = container.querySelector<HTMLDivElement>("#chat-tab-gm")!;
  const seeThroughWallsCheckbox = container.querySelector<HTMLInputElement>("#chat-see-through-walls")!;
  const modListEl = container.querySelector<HTMLUListElement>("#mod-list")!;
  const reloadBtn = container.querySelector<HTMLButtonElement>("#chat-reload-btn")!;
  const linkSelectEl = container.querySelector<HTMLSelectElement>("#link-character-select")!;
  const linkFolderInput = container.querySelector<HTMLInputElement>("#link-character-folder")!;
  const linkBtn = container.querySelector<HTMLButtonElement>("#link-character-btn")!;
  const characterGroupsEl = container.querySelector<HTMLDivElement>("#character-groups")!;

  let collapsed = false;
  let currentWidth = DEFAULT_WIDTH;
  let activeTab: ChatPanelTab = "chat";
  let availableMods: ModManifest[] = [];
  let enabledModIds: string[] = [];
  let visibleLinks: VisibleGameCharacterEntry[] = [];
  let participantAccounts: { id: string; displayName: string }[] = [];
  let myCharacters: { id: string; name: string }[] = [];
  let viewerAccountId = "";
  let isAdmin = false;

  function setActiveTab(tab: ChatPanelTab): void {
    activeTab = tab;
    chatTabBtn.classList.toggle("active", tab === "chat");
    charactersTabBtn.classList.toggle("active", tab === "characters");
    gmTabBtn.classList.toggle("active", tab === "gm");
    chatTabPane.classList.toggle("active", tab === "chat");
    charactersTabPane.classList.toggle("active", tab === "characters");
    gmTabPane.classList.toggle("active", tab === "gm");
  }
  chatTabBtn.addEventListener("click", () => setActiveTab("chat"));
  charactersTabBtn.addEventListener("click", () => setActiveTab("characters"));
  gmTabBtn.addEventListener("click", () => setActiveTab("gm"));

  function renderSendAsOptions(): void {
    const previouslySelected = sendAsSelect.value;
    sendAsSelect.innerHTML = `<option value="">My username</option>${visibleLinks.map((entry) => `<option value="${entry.character.id}">${entry.character.name}</option>`).join("")}`;
    // Keep the current selection if it's still a valid option (same
    // character still visible) -- a refresh shouldn't silently reset
    // "who am I posting as" back to the default mid-conversation.
    if (Array.from(sendAsSelect.options).some((o) => o.value === previouslySelected)) sendAsSelect.value = previouslySelected;
  }

  function renderCharacterGroups(): void {
    const notYetLinked = myCharacters.filter((c) => !visibleLinks.some((l) => l.character.id === c.id));
    linkSelectEl.innerHTML = notYetLinked.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    linkBtn.disabled = notYetLinked.length === 0;

    if (visibleLinks.length === 0) {
      characterGroupsEl.innerHTML = `<p class="character-link-list empty">No characters linked to this game yet.</p>`;
      return;
    }

    const groups = new Map<string, VisibleGameCharacterEntry[]>();
    for (const entry of visibleLinks) {
      const key = entry.link.folder ?? "(no folder)";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(entry);
    }

    characterGroupsEl.innerHTML = Array.from(groups.entries())
      .map(([folder, entries]) => {
        const rows = entries
          .map(({ link, character }) => {
            const isOwner = character.ownerAccountId === viewerAccountId;
            const canManage = isAdmin || isOwner;
            const visibilityIsAll = link.visibility === "all";
            // MVP goal item 4 follow-up (drag-and-drop placement): only
            // your OWN characters are draggable -- placeCharacter is
            // self-service only (WorldRoom.ts), so starting a drag for
            // someone else's character could only ever end in a silent
            // server-side no-op. `isOwner` already computed above.
            return `
          <li data-character-id="${character.id}" ${isOwner ? 'draggable="true"' : ""}>
            <button type="button" class="open-character-btn" data-character-id="${character.id}">${character.name}</button>
            ${
              canManage
                ? `<div class="character-link-manage" data-character-id="${character.id}">
                  <input type="text" class="link-folder-input" data-character-id="${character.id}" value="${link.folder ?? ""}" placeholder="Folder" />
                  <label><input type="checkbox" class="link-visibility-all" data-character-id="${character.id}" ${visibilityIsAll ? "checked" : ""} /> All players</label>
                  ${!visibilityIsAll ? `<select class="link-visibility-list" data-character-id="${character.id}" multiple>${participantAccounts.filter((a) => a.id !== character.ownerAccountId).map((a) => `<option value="${a.id}"${Array.isArray(link.visibility) && link.visibility.includes(a.id) ? " selected" : ""}>${a.displayName}</option>`).join("")}</select>` : ""}
                  <button type="button" class="unlink-btn" data-character-id="${character.id}">Unlink</button>
                  ${
                    // MVP goal item 4 follow-up ("deleting a character"):
                    // deliberately OWNER-ONLY, not canManage/isAdmin -- an
                    // admin can already unlink (above); deleting destroys
                    // the character record itself, not just this game's
                    // link to it, so it's never an admin's call to make on
                    // someone else's character.
                    isOwner ? `<button type="button" class="delete-char-btn" data-character-id="${character.id}">Delete</button>` : ""
                  }
                </div>`
                : ""
            }
          </li>`;
          })
          .join("");
        return `<div class="character-folder-group"><h4>${folder}</h4><ul class="character-link-list">${rows}</ul></div>`;
      })
      .join("");
  }

  characterGroupsEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const openBtn = target.closest<HTMLButtonElement>(".open-character-btn");
    if (openBtn) {
      options.onOpenCharacter(openBtn.dataset.characterId!);
      return;
    }
    const unlinkBtn = target.closest<HTMLButtonElement>(".unlink-btn");
    if (unlinkBtn) {
      options.onUnlinkCharacter(unlinkBtn.dataset.characterId!);
      return;
    }
    const deleteBtn = target.closest<HTMLButtonElement>(".delete-char-btn");
    if (deleteBtn) {
      const characterId = deleteBtn.dataset.characterId!;
      const name = visibleLinks.find((l) => l.character.id === characterId)?.character.name ?? "this character";
      if (window.confirm(`Delete "${name}"? This can't be undone.`)) options.onDeleteCharacter(characterId);
    }
  });

  // MVP goal item 4 follow-up (drag-and-drop placement): the native
  // HTML5 drag-and-drop `dataTransfer` channel is the mechanism itself
  // -- no new ChatPanelOptions callback needed, net.ts's own `drop`
  // listener on noa's canvas reads this same characterId straight back
  // out (this file stays "noa-free, pure presentational," per its own
  // header -- dataTransfer is a browser-native channel, not a room
  // message or app callback).
  characterGroupsEl.addEventListener("dragstart", (event) => {
    const li = (event.target as HTMLElement).closest<HTMLLIElement>("li[draggable='true']");
    if (!li || !event.dataTransfer) return;
    event.dataTransfer.setData(CHARACTER_DRAG_MIME, li.dataset.characterId!);
    event.dataTransfer.effectAllowed = "copy";
  });

  characterGroupsEl.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    const manage = target.closest<HTMLDivElement>(".character-link-manage");
    if (!manage) return;
    const characterId = manage.dataset.characterId!;
    if (target instanceof HTMLInputElement && target.classList.contains("link-folder-input")) {
      options.onUpdateCharacterLink(characterId, { folder: target.value.trim() === "" ? null : target.value });
    } else if (target instanceof HTMLInputElement && target.classList.contains("link-visibility-all")) {
      options.onUpdateCharacterLink(characterId, { visibility: target.checked ? "all" : [] });
    } else if (target instanceof HTMLSelectElement && target.classList.contains("link-visibility-list")) {
      options.onUpdateCharacterLink(characterId, { visibility: Array.from(target.selectedOptions).map((o) => o.value) });
    }
  });

  linkBtn.addEventListener("click", () => {
    const characterId = linkSelectEl.value;
    if (!characterId) return;
    const folder = linkFolderInput.value.trim();
    options.onLinkCharacter(characterId, folder === "" ? null : folder);
    linkFolderInput.value = "";
  });

  function renderModsList(): void {
    modListEl.innerHTML = availableMods
      .map((m) => {
        const isEnabled = enabledModIds.includes(m.id);
        return `<li><span>${m.name}<span class="mod-meta">v${m.version}</span></span><button class="mod-toggle-btn" type="button" data-mod-id="${m.id}" data-enabled="${isEnabled}">${isEnabled ? "Disable" : "Enable"}</button></li>`;
      })
      .join("");
  }

  function setReloadDirty(dirty: boolean): void {
    reloadBtn.disabled = !dirty;
    reloadBtn.classList.toggle("dirty", dirty);
    reloadBtn.textContent = dirty ? "Mods changed -- reload this page now" : "Reload this page";
  }

  modListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".mod-toggle-btn");
    if (!button) return;
    const modId = button.dataset.modId!;
    const enable = button.dataset.enabled !== "true";
    options.onToggleMod(modId, enable);
    setReloadDirty(true);
  });

  reloadBtn.addEventListener("click", () => {
    setReloadDirty(false);
    options.onReloadWorld();
  });

  seeThroughWallsCheckbox.addEventListener("change", () => {
    options.onSetSeeThroughWalls(seeThroughWallsCheckbox.checked);
  });

  function applyWidth(width: number): void {
    currentWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    panel.style.width = `${currentWidth}px`;
    setSafeAreaInset(SAFE_AREA_RIGHT_VAR, currentWidth);
  }
  applyWidth(DEFAULT_WIDTH);

  function appendLine(text: string, className: string): void {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    messagesEl.appendChild(line);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  for (const message of options.initialMessages) appendLine(formatMessage(message), "msg");

  function setFocused(focused: boolean): void {
    if (focused) requestCapture("chat");
    else releaseCapture("chat");
    options.onFocusChange?.(focused);
  }

  function sendAndBlur(): void {
    const text = input.value.trim();
    input.value = "";
    if (text) options.onSend(text, sendAsSelect.value || null);
    input.blur();
  }

  input.addEventListener("focus", () => setFocused(true));
  input.addEventListener("blur", () => setFocused(false));
  input.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      sendAndBlur();
    } else if (event.code === "Escape") {
      event.preventDefault();
      input.value = "";
      input.blur();
    }
    // Every other key is left to type normally -- global shortcuts
    // (inventory, page manager, etc.) are guarded by isCaptured() at
    // THEIR end, not suppressed here.
  });

  function setCollapsed(next: boolean): void {
    collapsed = next;
    panel.classList.toggle("collapsed", collapsed);
    toggle.textContent = collapsed ? "«" : "»";
    // .collapsed's CSS width (!important) wins regardless, but clearing
    // the inline width while collapsed keeps applyWidth's own state
    // (currentWidth) as the single thing to restore from on expand,
    // rather than two competing numbers.
    panel.style.width = collapsed ? "" : `${currentWidth}px`;
    // Keep the CSS var honest about the panel's ACTUAL current edge
    // regardless of collapse state, for quickActionsPanel.ts/
    // partyListPanel.ts's own width math.
    setSafeAreaInset(SAFE_AREA_RIGHT_VAR, collapsed ? COLLAPSED_WIDTH : currentWidth);
  }
  toggle.addEventListener("click", () => setCollapsed(!collapsed));

  // Drag-to-resize: a thin handle on the panel's left edge (right-docked
  // panel, so dragging the handle LEFT -- away from the screen edge --
  // should grow it). Real user correction: an earlier version only had
  // the collapse toggle above, cycling between two fixed sizes, which
  // wasn't what was wanted -- this is continuous, not click-through-presets.
  let dragging = false;
  let dragStartX = 0;
  let dragStartWidth = DEFAULT_WIDTH;

  function onHandlePointerDown(event: PointerEvent): void {
    if (collapsed) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartWidth = currentWidth;
    event.preventDefault();
  }
  function onWindowPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    applyWidth(dragStartWidth + (dragStartX - event.clientX));
  }
  function onWindowPointerUp(): void {
    dragging = false;
  }
  resizeHandle.addEventListener("pointerdown", onHandlePointerDown);
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);

  function onWindowKeydown(event: KeyboardEvent): void {
    // Guard against ANY other text field being focused (e.g. pageManager's
    // create-world name input) -- Enter there should submit/behave
    // normally, not get hijacked into focusing chat instead.
    const active = document.activeElement;
    const otherInputFocused = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (otherInputFocused) return;
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      if (collapsed) setCollapsed(false);
      setActiveTab("chat"); // switch back if the GM tab was open -- Enter's whole point is to type a message
      input.focus();
    }
  }
  window.addEventListener("keydown", onWindowKeydown);

  return {
    addMessage(message) {
      appendLine(formatMessage(message), "msg");
    },
    showError(reason) {
      appendLine(reason, "err");
    },
    setGmTabVisible(visible) {
      gmTabBtn.classList.toggle("hidden", !visible);
      if (visible) {
        // Real request: "GM on means the tab appears" -- jump straight
        // to it rather than leaving the GM to notice a new tab exists.
        setActiveTab("gm");
      } else if (activeTab === "gm") {
        setActiveTab("chat");
      }
    },
    setModsState(nextAvailableMods, nextEnabledModIds) {
      availableMods = nextAvailableMods;
      enabledModIds = nextEnabledModIds;
      renderModsList();
    },
    setCharactersState(nextVisibleLinks, nextParticipantAccounts, nextMyCharacters, nextViewerAccountId, nextIsAdmin) {
      visibleLinks = nextVisibleLinks;
      participantAccounts = nextParticipantAccounts;
      myCharacters = nextMyCharacters;
      viewerAccountId = nextViewerAccountId;
      isAdmin = nextIsAdmin;
      renderSendAsOptions();
      renderCharacterGroups();
    },
    setSeeThroughWallsState(enabled) {
      seeThroughWallsCheckbox.checked = enabled;
    },
    destroy() {
      window.removeEventListener("keydown", onWindowKeydown);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      if (document.activeElement === input) releaseCapture("chat");
    },
  };
}

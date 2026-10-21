// GM-only settings panel -- real correction, 2026-10-21: mods (MVP goal
// item 3) briefly lived in chatPanel.ts's Settings tab (visible to every
// player, only the mutation was admin-gated), then the user explicitly
// rejected that: "mods should definitely also be GM only... everything
// on current settings should be on the gm only panel, which should
// appear and disappear whenever gm mode is toggled." So this panel's
// visibility itself is GM-gated (driven by gmOverride.ts's own toggle,
// via net.ts's `setVisible` wiring), not just its mutating REST calls.
// A real per-PLAYER settings panel (brightness, sound, etc.) is future
// scope, built when there's something real to put in it -- this is not
// that, and isn't trying to be.
//
// Content: the per-game mods list (moved here verbatim from the
// reverted chatPanel.ts Settings tab -- same markup, same dirty-flagged
// Reload button, same api.ts calls) plus a new `seeThroughWalls`
// checkbox (the third-person xray-cutout shader toggle, see
// blockShaders.ts/game.ts).
//
// Deliberately does NOT call requestCapture/releaseCapture (unlike
// pageManager.ts): there's no free-text `<input>` here to protect from
// stray keystrokes, and gmOverride.ts's own KeyG handler checks
// isCaptured() on EVERY press -- including the one meant to turn GM
// mode back off -- so claiming capture while this panel is visible
// would self-lock GM mode on permanently. See gmOverride.ts's own
// comment on installGmOverride's onActiveChange param for the full
// reasoning.

import { fetchAvailableMods, fetchGameMods, enableGameMod, disableGameMod, type ModManifest } from "./api.js";
import { SAFE_AREA_LEFT_VAR, SAFE_AREA_RIGHT_VAR, SAFE_AREA_TOP_VAR, SAFE_AREA_BOTTOM_VAR } from "./panelLayout.js";

export interface GmPanelOptions {
  httpUrl: string;
  gameId: string;
  accountId: string;
  /** Reads the live, Schema-synced value off the world room's own state -- net.ts's own `!!room.state.seeThroughWalls`. */
  getSeeThroughWalls: () => boolean;
  /** Sends the admin-gated "setSeeThroughWalls" room message -- net.ts implements this as `room.send(...)`. */
  onSetSeeThroughWalls: (enabled: boolean) => void;
  /** No hot-reload exists for mods -- re-launches the player's own current world, same teardown/recreate cycle page-switching already uses. */
  reloadWorld: () => void;
}

export interface GmPanelController {
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function mountGmPanel(container: HTMLElement, options: GmPanelOptions): GmPanelController {
  const { httpUrl, gameId, accountId, getSeeThroughWalls, onSetSeeThroughWalls, reloadWorld } = options;

  container.innerHTML = `
    <style>
      .gm-panel-overlay { position: fixed; left: var(${SAFE_AREA_LEFT_VAR}, 0px); right: var(${SAFE_AREA_RIGHT_VAR}, 0px); top: var(${SAFE_AREA_TOP_VAR}, 0px); bottom: var(${SAFE_AREA_BOTTOM_VAR}, 0px); background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; font-family: system-ui, sans-serif; z-index: 10; }
      .gm-panel-overlay.open { display: flex; }
      .gm-panel { background: rgba(30,30,36,0.95); border: 2px solid rgb(255,217,51); border-radius: 6px; padding: 16px; min-width: 360px; max-width: 80vw; color: #eee; font-size: 13px; }
      .gm-panel h2 { margin: 0 0 10px; font-size: 15px; font-weight: normal; }
      .gm-panel h3 { margin: 16px 0 6px; font-size: 12px; font-weight: normal; color: #999; }
      .gm-panel .mod-list { list-style: none; padding: 0; margin: 0; }
      .gm-panel .mod-list li { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.06); border-radius: 4px; }
      .gm-panel .mod-list .mod-meta { color: #999; font-size: 0.85em; margin-left: 6px; }
      .gm-panel .mod-list button { font-size: 12px; padding: 4px 8px; }
      .gm-reload-btn { width: 100%; padding: 8px; font-size: 13px; margin-top: 8px; }
      /* "Foolproof" (explicit request): neutral/disabled until a mod is
         actually toggled, then obviously flagged -- not a subtle hint
         someone could miss, since there's no hot-reload to fall back on. */
      .gm-reload-btn.dirty { background: rgb(255,217,51); color: #222; font-weight: bold; border-color: rgb(255,217,51); }
      .gm-panel label.checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    </style>
    <div class="gm-panel-overlay" id="gm-panel-overlay">
      <div class="gm-panel">
        <h2>GM Settings (visible only while GM mode is on)</h2>
        <label class="checkbox-row">
          <input type="checkbox" id="gm-see-through-walls" />
          Players can see through walls (third-person camera)
        </label>
        <h3>Mods for this game</h3>
        <ul class="mod-list" id="gm-mod-list"></ul>
        <button class="gm-reload-btn" id="gm-reload-btn" type="button" disabled title="Reload your current page to pick up mod changes (no hot-reload)">Reload this page</button>
      </div>
    </div>
  `;

  const overlay = container.querySelector<HTMLDivElement>("#gm-panel-overlay")!;
  const seeThroughWallsCheckbox = container.querySelector<HTMLInputElement>("#gm-see-through-walls")!;
  const modListEl = container.querySelector<HTMLUListElement>("#gm-mod-list")!;
  const reloadBtn = container.querySelector<HTMLButtonElement>("#gm-reload-btn")!;

  let availableMods: ModManifest[] = [];
  let enabledModIds: string[] = [];

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

  async function refreshMods(): Promise<void> {
    [availableMods, enabledModIds] = await Promise.all([fetchAvailableMods(httpUrl), fetchGameMods(httpUrl, gameId)]);
    renderModsList();
  }

  modListEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".mod-toggle-btn");
    if (!button) return;
    const modId = button.dataset.modId!;
    const enable = button.dataset.enabled !== "true";
    const toggle = enable ? enableGameMod(httpUrl, gameId, accountId, modId) : disableGameMod(httpUrl, gameId, accountId, modId);
    void toggle.then((updatedModIds) => {
      enabledModIds = updatedModIds;
      renderModsList();
    });
    setReloadDirty(true);
  });

  reloadBtn.addEventListener("click", () => {
    setReloadDirty(false);
    reloadWorld();
  });

  seeThroughWallsCheckbox.addEventListener("change", () => {
    onSetSeeThroughWalls(seeThroughWallsCheckbox.checked);
  });

  return {
    setVisible(visible: boolean): void {
      overlay.classList.toggle("open", visible);
      if (visible) {
        seeThroughWallsCheckbox.checked = getSeeThroughWalls();
        setReloadDirty(false);
        void refreshMods();
      }
    },
    destroy(): void {
      // No window-level listeners/capture were ever claimed (see this
      // file's header) -- nothing to release.
    },
  };
}

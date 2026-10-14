// In-game page-management panel -- the roll20-"pages" UI, direct port of
// the old game's real scripts/ui/dm_world_menu.gd (read in full): one
// generator-type picker, per-generator param fields shown/hidden by
// selection, create button. Admin-gated (same `isAdmin` Schema signal
// gmOverride.ts already reads) since creating/switching a game's pages is
// a GM action, matching the old game's DM-only menu.
//
// Same plain-DOM-overlay pattern as hotbar.ts's inventory grid -- a
// toggleable panel, not part of noa's own canvas. Reachable via M (not yet
// claimed by any other binding).
//
// Switching pages reuses the PROVEN stop()+startGame() cycle (via the
// injected `onSwitchWorld` callback, implemented by main.ts, which already
// owns the mutable `runningGame` reference) rather than trying to clear
// noa's loaded chunks/entities in place -- noa has no supported API for
// that, and a fresh engine is already a well-tested teardown/setup path.
// Real limitation, not fixed here: switching only affects the client doing
// the switching -- no cross-client "everyone follows the GM's active page"
// sync yet (see the games-and-world-generators plan's explicit out-of-
// scope note).

import { WORLD_GENERATORS, VOXEL_TYPES, type GeneratorId, type GeneratorParams, type LimestoneSlabParams, DEFAULT_LIMESTONE_SLAB_PARAMS } from "@ttrpg3d/shared";
import { fetchWorldsForGame, createWorldInGame, type WorldRecord } from "./api.js";
import { requestCapture, releaseCapture } from "./inputCapture.js";

export interface PageManagerOptions {
  httpUrl: string;
  gameId: string;
  accountId: string;
  currentWorldId: string;
  isAdmin: () => boolean;
  onSwitchWorld: (worldId: string, worldName: string) => void;
}

export interface PageManagerController {
  destroy(): void;
}

export function mountPageManager(container: HTMLElement, options: PageManagerOptions): PageManagerController {
  const { httpUrl, gameId, accountId, currentWorldId, isAdmin, onSwitchWorld } = options;

  container.innerHTML = `
    <style>
      .page-mgr-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; font-family: system-ui, sans-serif; z-index: 10; }
      .page-mgr-overlay.open { display: flex; }
      .page-mgr-panel { background: rgba(30,30,36,0.95); border: 2px solid rgba(200,200,200,0.7); border-radius: 6px; padding: 16px; min-width: 420px; max-width: 80vw; color: #eee; }
      .page-mgr-panel h2 { margin: 0 0 10px; font-size: 16px; font-weight: normal; }
      .page-mgr-panel ul { list-style: none; padding: 0; margin: 0 0 16px; }
      .page-mgr-panel li { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; margin-bottom: 4px; background: rgba(255,255,255,0.06); border-radius: 4px; }
      .page-mgr-panel li.current { border: 1px solid rgb(255,217,51); }
      .page-mgr-panel .page-meta { color: #999; font-size: 0.8rem; margin-left: 6px; }
      .page-mgr-panel .row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
      .page-mgr-panel input, .page-mgr-panel select, .page-mgr-panel button { font-size: 1rem; padding: 5px 8px; }
      .page-mgr-panel .params-row input { width: 70px; }
    </style>
    <div class="page-mgr-overlay" id="page-mgr-overlay">
      <div class="page-mgr-panel">
        <h2>Pages -- switch between this game's worlds, or create a new one</h2>
        <ul id="page-list"></ul>
        <div class="row">
          <input id="page-name" placeholder="New page name" style="flex:1" />
          <select id="page-generator"></select>
        </div>
        <div class="row params-row" id="page-params"></div>
        <div class="row">
          <button id="page-create-btn" type="button">Create page</button>
        </div>
      </div>
    </div>
  `;

  const overlay = container.querySelector<HTMLDivElement>("#page-mgr-overlay")!;
  const listEl = container.querySelector<HTMLUListElement>("#page-list")!;
  const nameInput = container.querySelector<HTMLInputElement>("#page-name")!;
  const generatorSelect = container.querySelector<HTMLSelectElement>("#page-generator")!;
  const paramsRow = container.querySelector<HTMLDivElement>("#page-params")!;
  const createBtn = container.querySelector<HTMLButtonElement>("#page-create-btn")!;

  let worlds: WorldRecord[] = [];
  let open = false;

  generatorSelect.innerHTML = WORLD_GENERATORS.map((g) => `<option value="${g.id}">${g.name} [${g.classifications.join(", ")}]</option>`).join("");

  function renderParamFields(): void {
    const generatorId = generatorSelect.value as GeneratorId;
    if (generatorId !== "limestone_slab") {
      paramsRow.innerHTML = "";
      return;
    }
    const p = DEFAULT_LIMESTONE_SLAB_PARAMS;
    // Real bug found live: a raw <input type="number"> for voxelId just
    // showed "1" with nothing identifying what block that even is --
    // "no user will be able to memorize the internal voxel UIDs."
    // Direct port of the old game's real scripts/pcg/voxel_catalog.gd
    // intent (it scanned the block library specifically to back this
    // exact param picker in dm_world_menu.gd) -- a named <select> instead.
    const voxelOptions = VOXEL_TYPES.filter((v) => v.placeable)
      .map((v) => `<option value="${v.id}"${v.id === p.voxelId ? " selected" : ""}>${v.name}</option>`)
      .join("");
    paramsRow.innerHTML = `
      <label>W<input id="param-width" type="number" value="${p.width}" /></label>
      <label>H<input id="param-height" type="number" value="${p.height}" /></label>
      <label>D<input id="param-depth" type="number" value="${p.depth}" /></label>
      <label>Block<select id="param-voxelid">${voxelOptions}</select></label>
    `;
  }

  function readParams(): GeneratorParams {
    const generatorId = generatorSelect.value as GeneratorId;
    if (generatorId !== "limestone_slab") return {};
    const num = (id: string, fallback: number) => Number(container.querySelector<HTMLInputElement>(`#${id}`)?.value) || fallback;
    const params: LimestoneSlabParams = {
      width: num("param-width", DEFAULT_LIMESTONE_SLAB_PARAMS.width),
      height: num("param-height", DEFAULT_LIMESTONE_SLAB_PARAMS.height),
      depth: num("param-depth", DEFAULT_LIMESTONE_SLAB_PARAMS.depth),
      voxelId: num("param-voxelid", DEFAULT_LIMESTONE_SLAB_PARAMS.voxelId),
    };
    return params;
  }

  function renderList(): void {
    listEl.innerHTML = worlds
      .map((w) => {
        const isCurrent = w.id === currentWorldId;
        const def = WORLD_GENERATORS.find((g) => g.id === w.generatorId);
        return `<li class="${isCurrent ? "current" : ""}"><span>${w.name}<span class="page-meta">[${def?.name ?? w.generatorId}]</span></span>${isCurrent ? "<span>(current)</span>" : `<button class="switch-btn" type="button" data-world-id="${w.id}" data-world-name="${w.name}">Switch</button>`}</li>`;
      })
      .join("");
  }

  async function refreshWorlds(): Promise<void> {
    worlds = await fetchWorldsForGame(httpUrl, gameId);
    renderList();
  }

  function setOpen(next: boolean): void {
    open = next;
    overlay.classList.toggle("open", open);
    if (open) requestCapture("pageManager");
    else releaseCapture("pageManager");
  }

  generatorSelect.addEventListener("change", renderParamFields);

  createBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const generatorId = generatorSelect.value as GeneratorId;
    const params = readParams();
    void createWorldInGame(httpUrl, gameId, accountId, name, generatorId, params).then(() => {
      nameInput.value = "";
      return refreshWorlds();
    });
  });

  listEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".switch-btn");
    if (!button) return;
    const worldId = button.dataset.worldId!;
    const worldName = button.dataset.worldName ?? "";
    setOpen(false);
    onSwitchWorld(worldId, worldName);
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.code === "Escape" && open) {
      setOpen(false);
      return;
    }
    if (event.code !== "KeyM") return;
    if (!open && !isAdmin()) return; // can't OPEN without being admin; always allowed to close
    setOpen(!open);
    if (open) void refreshWorlds();
  }

  window.addEventListener("keydown", onKeydown);
  renderParamFields();

  return {
    destroy(): void {
      window.removeEventListener("keydown", onKeydown);
      if (open) releaseCapture("pageManager");
    },
  };
}

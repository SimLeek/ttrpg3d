// Connects to the server's "world" room: streams chunks (noa's
// worldDataNeeded -> server "requestChunk" -> binary "chunk" reply, per the
// architecture plan's Schema-vs-raw-binary split) and syncs player
// transforms both ways (this client's position out, everyone else's in).
//
// No anti-cheat / physics-verification requirement (per the migration
// plan) -- the client just reports its own position; the server doesn't
// re-simulate or validate it.

import { Client, type Room } from "@colyseus/sdk";
import * as BABYLON from "@babylonjs/core";
import type { Engine } from "noa-engine";
import { CHUNK_SIZE, decodeChunk, type ChunkRequest, type Item } from "@ttrpg3d/shared";
import { installVoxelEditor } from "./voxelEditor.js";
import { installGmOverride } from "./gmOverride.js";
import { installRespawnControl } from "./respawnControl.js";
import { mountPageManager } from "./pageManager.js";
import { createCharacterToken, TOKEN_PLANE_HEIGHT, type CharacterToken, type CharacterTokenBarData, type HoveredBar } from "./characterToken.js";
import { pickToken, type TrackedToken } from "./tokenPicking.js";
import { mountCharacterContextMenu } from "./characterContextMenu.js";
import type { PlayerController } from "./movement/PlayerController.js";
import { PLAYER_BODY_HEIGHT, resizeLocalPlayerBody, resizeEntityBody, createBodyAnchor, type PlayerBodyMesh } from "./playerBodyMesh.js";

interface EditBlockMessage {
  x: number;
  y: number;
  z: number;
  voxelId: number;
}

interface StatusEffectLike {
  icon: string;
  label: string;
}

/** Mirrors WorldState.ts's BarState -- whatever the character's sheet currently configures as bars, not a fixed hp/mp pair (docs/ROADMAP.md item 4 follow-up). */
interface BarLike {
  variableId: string;
  label: string;
  value: number;
  max: number;
  colorR: number;
  colorG: number;
  colorB: number;
}

interface RemotePlayerLike {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  characterId: string;
  characterName: string;
  tokenColorR: number;
  tokenColorG: number;
  tokenColorB: number;
  bars: BarLike[];
  statusEffects: StatusEffectLike[];
  /** MVP goal item 4 follow-up -- flattened server-side from the character's own bodyWidth/Height/Depth sheet variables (WorldRoom.ts's applyBodySizeToPlayer), defaulting to the same values as PLAYER_BODY_WIDTH/HEIGHT/DEPTH below. */
  bodyWidth: number;
  bodyHeight: number;
  bodyDepth: number;
}

/** Colyseus's Schema array -> characterToken.ts's plain data shape. */
function toTokenBars(bars: Iterable<BarLike> | undefined): CharacterTokenBarData[] {
  return Array.from(bars ?? []).map((b) => ({ variableId: b.variableId, label: b.label, value: b.value, max: b.max, color: [b.colorR, b.colorG, b.colorB] }));
}

// Send position at a fraction of tick rate -- small DM-hosted groups (per
// the architecture plan's scale assumptions) don't need every-tick updates,
// and this keeps the message volume light without adding visible lag.
const POS_SEND_EVERY_N_TICKS = 3;

export interface WorldConnection {
  /** Actually tells the server this client is leaving the room -- see the
   * doc comment at the bottom of this function for why this exists. */
  leave(): void;
  /** GM-only chat tab (chatPanel.ts, via game.ts's RunningGame.setSeeThroughWalls) -- sends the admin-gated room message; WorldRoom.ts re-checks admin status server-side regardless of what this client claims. */
  setSeeThroughWalls(enabled: boolean): void;
}

export async function connectAndStreamWorld(
  noa: Engine,
  url: string,
  playerName: string,
  worldId: string,
  accountId: string,
  // MVP goal items 1-2 (docs/ROADMAP.md) -- resolved server-side via
  // store.getCharacter in WorldRoom.onJoin, never trusted as-is. Null is a
  // real state (no character selected yet), not an error.
  characterId: string | null,
  getEquippedItem: () => Item | null,
  playerController: PlayerController,
  fallbackSpawn: readonly [number, number, number],
  httpUrl: string,
  gameId: string,
  // MVP goal items 1-2 (docs/ROADMAP.md): real bug found live -- a
  // characterToken billboard only ever existed for REMOTE players (same
  // precedent net.ts's original fixed-color box had), so a solo tester
  // in a single tab sees nothing at all, even zoomed into third person
  // where playerBodyMesh.ts's own box IS visible. Attaching the local
  // player's own token to that existing box (same child-mesh-follows-
  // parent technique as the remote tokens) makes solo testing/playing
  // actually show something, and lets the owned-token hover/click
  // features work on your OWN hp/mp too, not just other players'.
  playerBodyMesh: PlayerBodyMesh,
  onSwitchWorld: (worldId: string, worldName: string) => void,
  // gmOverride.ts's own G-key toggle -- forwarded straight through to
  // game.ts's RunningGame.onGmActiveChange listeners, for chatPanel.ts's
  // GM tab (main.ts wires the two together).
  onGmActiveChange: (active: boolean) => void,
  // Polled every tick below (not event-based -- see respawnControl.ts's
  // own worldBottomY/hasRespawnAnchor precedent for reading a scalar
  // Schema field fresh each tick, no `.listen()` anywhere in this file).
  onSeeThroughWallsChange: (enabled: boolean) => void,
): Promise<WorldConnection> {
  // noa starts emitting worldDataNeeded for chunks around the spawn point
  // almost immediately (well before a WebSocket connection + Colyseus
  // matchmaking round-trip can possibly finish) -- so the listener below
  // must attach synchronously, right now, before any `await`. Requests that
  // arrive before the room connection is ready get queued and flushed once
  // it is, rather than lost (confirmed live: attaching this listener only
  // after `await client.joinOrCreate(...)` meant the very first batch of
  // chunk requests around spawn were silently dropped forever -- nothing
  // ever rendered, reproduced as "blue as far as the eye can see").
  const pendingChunks = new Map<string, { id: string; data: any }>();
  const queuedRequests: ChunkRequest[] = [];
  let room: Room | undefined;

  function requestChunk(req: ChunkRequest): void {
    if (room) {
      room.send("requestChunk", req);
    } else {
      queuedRequests.push(req);
    }
  }

  noa.world.on(
    "worldDataNeeded",
    (id: string, data: any, x: number, y: number, z: number) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      pendingChunks.set(`${cx},${cy},${cz}`, { id, data });
      requestChunk({ cx, cy, cz });
    },
  );

  const client = new Client(url);
  // worldId is matched against WorldRoom.filterBy(['worldId']) server-side
  // (server.ts) -- without it every player would land in the same shared
  // room regardless of which world they picked. accountId is used ONLY
  // server-side (WorldRoom.onJoin -> store.isWorldAdmin, core/mod-boundary
  // plan's GM admin-override escape hatch) to check owner/admin/root
  // status -- never trusted blindly, checked fresh against the store.
  room = await client.joinOrCreate("world", { name: playerName, worldId, accountId, characterId: characterId ?? undefined });
  for (const req of queuedRequests) room.send("requestChunk", req);
  queuedRequests.length = 0;

  function isAdmin(): boolean {
    if (!room) return false;
    const players = (room.state as { players?: Map<string, { isAdmin?: boolean }> } | undefined)?.players;
    return !!players?.get(room.sessionId)?.isAdmin;
  }

  const gmOverride = installGmOverride(noa, room, playerController, onGmActiveChange);
  installRespawnControl(noa, room, playerController, fallbackSpawn);

  // Real bug found live: the client never actually applied the SERVER's
  // own computed spawn position to the local player at all -- it just
  // sat wherever noa's `playerStart` cosmetic placeholder (game.ts's
  // `SPAWN` constant) put it. This went unnoticed through the whole
  // hand-built-test-area era because that constant was hand-tuned to
  // exactly match the old fixed, single spawnPosition() every world used
  // -- a coincidence, not a real round-trip. Now that spawn is real,
  // per-generator, per-world, and (games-and-world-generators PR)
  // per-anchor, nothing was ever pulling the player onto it -- reproduced
  // live as "spawns underground" even where the SERVER's own computed
  // spawn was a verified-safe, open-air position. Fixed: wait for our own
  // PlayerState entry to actually appear in the synced room state (per
  // the "late sync" reasoning the remote-player loop below already
  // accounts for), then teleportTo it once via the SAME mechanism
  // respawnControl.ts's Shift+R already uses.
  let appliedInitialSpawn = false;
  noa.on("tick", () => {
    if (appliedInitialSpawn) return;
    const players = (room.state as { players?: Map<string, { x: number; y: number; z: number }> } | undefined)?.players;
    const me = players?.get(room.sessionId);
    if (!me) return;
    appliedInitialSpawn = true;
    playerController.teleportTo([me.x, me.y, me.z]);
  });

  const pageManagerContainer = document.createElement("div");
  document.body.appendChild(pageManagerContainer);
  const pageManager = mountPageManager(pageManagerContainer, {
    httpUrl,
    gameId,
    accountId,
    currentWorldId: worldId,
    isAdmin,
    onSwitchWorld,
  });

  room.onMessage("chunk", (bytes: Uint8Array) => {
    const { cx, cy, cz, voxels } = decodeChunk(bytes);
    const key = `${cx},${cy},${cz}`;
    const pending = pendingChunks.get(key);
    if (!pending) return; // no longer needed (player moved away) -- fine to drop
    pendingChunks.delete(key);
    let idx = 0;
    for (let i = 0; i < CHUNK_SIZE; i++) {
      for (let j = 0; j < CHUNK_SIZE; j++) {
        for (let k = 0; k < CHUNK_SIZE; k++) {
          pending.data.set(i, j, k, voxels[idx++]);
        }
      }
    }
    noa.world.setChunkData(pending.id, pending.data);
  });

  // ---- character tokens (MVP goal items 1-2): right-click context menu +
  // left-click-to-edit bar-value overlay, both DOM overlays mounted up front
  // so voxelEditor.ts's hooks (installed just below) always have
  // somewhere real to open into.
  //
  // Real bug found live: the "owned" predicate used to compare against
  // the characterId THIS CLIENT ORIGINALLY SENT (the `characterId`
  // parameter) -- but WorldRoom.ts's onJoin can resolve a DIFFERENT one
  // server-side (the default-character fallback, when none was
  // explicitly picked), and the client never learns about that via the
  // parameter it passed in. Reading the LOCAL SESSION's own resolved
  // characterId fresh off synced Schema state instead -- room.state's
  // own player entry for `room.sessionId` is already the authoritative,
  // live-updated answer to "which character am I actually playing," so
  // there's no reason to track a separate, potentially-stale local copy.
  function myResolvedCharacterId(): string {
    const players = (room!.state as { players?: Map<string, RemotePlayerLike> } | undefined)?.players;
    return players?.get(room!.sessionId)?.characterId ?? "";
  }

  const contextMenuContainer = document.createElement("div");
  document.body.appendChild(contextMenuContainer);
  const contextMenu = mountCharacterContextMenu(contextMenuContainer, {
    onOpenCharacterSheet: () => {
      // Stub -- full character sheets are MVP goal item 3, not built yet.
      // The menu item itself is disabled client-side too (characterContextMenu.ts).
    },
    onEditTokenProperties: (characterId) => {
      openColorEditor(characterId, lastMenuOpenScreen.x, lastMenuOpenScreen.y);
    },
    onSelectStatusEffects: (characterId) => {
      openStatusEffectsEditor(characterId, lastMenuOpenScreen.x, lastMenuOpenScreen.y);
    },
  });
  let lastMenuOpenScreen = { x: 0, y: 0 };

  const statInputContainer = document.createElement("div");
  statInputContainer.style.cssText = "position:fixed;z-index:1001;";
  document.body.appendChild(statInputContainer);

  /** Click-to-edit a bar's current value: a real HTML <input> overlay (this project's established DOM-overlay convention for text entry), not a Babylon GUI InputText control -- avoids that control's own keyboard-capture/IME quirks for what's purely "type a number." Always the CURRENT half of whichever variable the bar points at -- max is edited on the character sheet page, same as every other xOfY variable (docs/ROADMAP.md item 4 follow-up: bars are configurable, not a fixed hp/mp pair). */
  function openStatEditor(characterIdToEdit: string, variableId: string, x: number, y: number): void {
    const input = document.createElement("input");
    input.type = "number";
    input.style.cssText = `position:fixed; left:${x}px; top:${y}px; width:60px; font-size:14px; z-index:1001;`;
    const players = (room!.state as { players?: Map<string, RemotePlayerLike> } | undefined)?.players;
    const current = Array.from(players?.values() ?? []).find((p) => p.characterId === characterIdToEdit);
    const currentBar = current?.bars.find((b) => b.variableId === variableId);
    input.value = String(currentBar?.value ?? 0);
    statInputContainer.innerHTML = "";
    statInputContainer.appendChild(input);
    // Real bug found live: calling focus() synchronously, within the SAME
    // mousedown dispatch that created this input (via voxelEditor.ts's
    // "fire" handler), loses the race against the browser's OWN default
    // focus handling for that same click -- which still runs afterward
    // and shifts focus back to the canvas (the actual click target),
    // immediately blurring this input before the user can type anything.
    // Deferring to the next tick lets this run AFTER that default action
    // has already happened, so it sticks.
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    function commit(): void {
      const value = Number(input.value);
      if (Number.isFinite(value)) room!.send("setCharacterVariableValue", { characterId: characterIdToEdit, variableId, value });
      statInputContainer.innerHTML = "";
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") statInputContainer.innerHTML = "";
    });
    input.addEventListener("blur", commit);
  }

  /** Minimal color-picker overlay backing "Edit token properties" -- full token-property authoring is downstream of MVP goal item 3, this is just the color this project's rendering can actually use today (characterToken.ts's generalization of the existing fixed-color-box convention). */
  function openColorEditor(characterIdToEdit: string, x: number, y: number): void {
    const input = document.createElement("input");
    input.type = "color";
    input.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:1001;`;
    statInputContainer.innerHTML = "";
    statInputContainer.appendChild(input);
    input.click();
    input.addEventListener("change", () => {
      const hex = input.value;
      const color: [number, number, number] = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
      room!.send("setCharacterToken", { characterId: characterIdToEdit, color });
      statInputContainer.innerHTML = "";
    });
  }

  /** Minimal status-effect toggle overlay -- a flat, fixed small catalog (no mod-based status-effect catalog/definitions system yet, that's downstream of MVP goal item 3). */
  function openStatusEffectsEditor(characterIdToEdit: string, x: number, y: number): void {
    const CATALOG: StatusEffectLike[] = [
      { icon: "poison", label: "Poisoned" },
      { icon: "stun", label: "Stunned" },
      { icon: "blessed", label: "Blessed" },
    ];
    const players = (room!.state as { players?: Map<string, RemotePlayerLike> } | undefined)?.players;
    const current = Array.from(players?.values() ?? []).find((p) => p.characterId === characterIdToEdit);
    const activeLabels = new Set((current?.statusEffects ?? []).map((e) => e.label));

    const panel = document.createElement("div");
    panel.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:1001; background:rgba(20,20,24,0.95); border:1px solid rgba(200,200,200,0.4); border-radius:6px; padding:8px; font-family:system-ui,sans-serif; color:#eee; font-size:13px;`;
    for (const effect of CATALOG) {
      const label = document.createElement("label");
      label.style.cssText = "display:block; padding:2px 0; cursor:pointer;";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = activeLabels.has(effect.label);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) activeLabels.add(effect.label);
        else activeLabels.delete(effect.label);
        const statusEffects = CATALOG.filter((e) => activeLabels.has(e.label));
        room!.send("setStatusEffects", { characterId: characterIdToEdit, statusEffects });
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(` ${effect.label}`));
      panel.appendChild(label);
    }
    statInputContainer.innerHTML = "";
    statInputContainer.appendChild(panel);
  }

  // ---- character tokens: color-matched body boxes + a billboard above
  // each (characterToken.ts) showing name/bars/status -- replaces the
  // old fixed-red-box-only remote-player rendering. ----
  const scene = noa.rendering.getScene();
  // Real feedback: "the hp/mp bars... intersecting with the character" --
  // and "ref the player's height and add to it... instead of setting a
  // fixed position." Desired distance from the player's FEET to the
  // billboard's own CENTER: the body's own current height (per-player
  // now, see tokenYOffsetFor below -- MVP goal item 4 follow-up), plus
  // a small clearance gap, plus half the billboard's own height
  // (TOKEN_PLANE_HEIGHT -- now sized to
  // the GUI content's real extent, not an arbitrary square, see that
  // constant's own doc in characterToken.ts) so its BOTTOM edge -- not
  // its center -- is what actually clears the box's top.
  const TOKEN_CLEARANCE_ABOVE_HEAD = 0.1;
  // Real bug found live ("still a fair bit above the player... instead of
  // just above their head"): the billboard is PARENTED to the body box
  // (below), and noa's own entity->mesh positioning already places that
  // box's own local origin at the box's CENTER in world space (feet +
  // bodyHeight/2 -- confirmed directly in noa's mesh.js component and
  // this exact [0, bodyHeight/2, 0] offset, used for both the local and
  // every remote box below). A child's own `position` is an offset from
  // THAT already-elevated origin, not from the feet -- so setting it
  // directly to the height-above-feet value double-counts the box's own
  // half-height. Subtracting it back out here is what actually fixes
  // that. MVP goal item 4 follow-up: body height is now per-CHARACTER
  // (bodyWidth/Height/Depth sheet variables), not the one shared
  // PLAYER_BODY_HEIGHT constant everyone used to have -- this is now a
  // function of each player's own current height instead of a module-
  // level constant.
  function tokenYOffsetFor(bodyHeight: number): number {
    const heightAboveFeet = bodyHeight + TOKEN_CLEARANCE_ABOVE_HEAD + TOKEN_PLANE_HEIGHT / 2;
    return heightAboveFeet - bodyHeight / 2;
  }
  const remoteEntities = new Map<string, number>(); // sessionId -> noa entity id
  const remoteMaterials = new Map<string, BABYLON.StandardMaterial>();
  const remoteBodyMeshes = new Map<string, BABYLON.Mesh>(); // sessionId -> body box mesh, for tokenPicking.ts's extraHitboxMeshes
  const remoteTokens = new Map<string, CharacterToken>();
  const remoteTokenAnchors = new Map<string, BABYLON.TransformNode>(); // sessionId -> the scale-cancelling anchor the token is actually parented to, see playerBodyMesh.ts's own doc
  // MVP goal item 4 follow-up -- last-applied body size per session (local uses the fixed "local" key), so resize only happens on an ACTUAL change rather than every tick.
  const appliedBodySizes = new Map<string, [number, number, number]>();
  const LOCAL_BODY_SIZE_KEY = "__local__";
  function bodySizeChanged(key: string, width: number, height: number, depth: number): boolean {
    const prev = appliedBodySizes.get(key);
    const changed = !prev || prev[0] !== width || prev[1] !== height || prev[2] !== depth;
    if (changed) appliedBodySizes.set(key, [width, height, depth]);
    return changed;
  }
  const trackedTokens: TrackedToken[] = [];
  let hoveredSessionId: string | undefined;
  let hoveredBarSessionId: string | undefined;

  /**
   * Real bug found live, confirmed via direct debug logging (not guessed):
   * picking always used the viewport-center ray -- correct for "Default"
   * pointer-locked/crosshair play (matches noa's own voxel-targeting
   * convention), but in "Select" mode (modePanel.ts) the cursor is a
   * real, freely-moving mouse, and hovering/clicking a token anywhere
   * off-center never picked anything. `noa.container.hasPointerLock`
   * (real, typed noa API) correctly distinguishes the two modes --
   * confirmed live, it does flip to `false` on switching to Select.
   *
   * `scene.pointerX`/`scene.pointerY` turned out to be the wrong source
   * for the real cursor position though: confirmed live, via the exact
   * same debug logging, that they stay permanently stuck at (0,0) in this
   * project regardless of actual mouse movement. Babylon's own pointer-
   * position tracking is wired up by `scene.attachControl`, which noa
   * never calls -- noa drives all input through its own `game-inputs`
   * pipeline instead (confirmed via grep: no `attachControl` call
   * anywhere in noa-engine's source). So this tracks the real mouse
   * position itself via a plain DOM `mousemove` listener on noa's own
   * canvas, converted to canvas-relative coordinates (what
   * `createPickingRay` expects) via `getBoundingClientRect()`.
   */
  let lastMouseScreen = { x: 0, y: 0 };
  noa.container.canvas.addEventListener("mousemove", (event: MouseEvent) => {
    const rect = (noa.container.canvas as HTMLCanvasElement).getBoundingClientRect();
    lastMouseScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  });

  function currentPickScreenPoint(): { x: number; y: number } {
    if (noa.container.hasPointerLock) {
      return { x: scene.getEngine().getRenderWidth() / 2, y: scene.getEngine().getRenderHeight() / 2 };
    }
    return lastMouseScreen;
  }

  function rebuildTrackedTokens(): void {
    trackedTokens.length = 0;
    const players = (room!.state as { players?: Map<string, RemotePlayerLike> } | undefined)?.players;
    if (!players) return;
    for (const [sessionId, p] of players) {
      const token = remoteTokens.get(sessionId);
      if (!token) continue;
      // The body box (local: playerBodyMesh.mesh; remote: remoteBodyMeshes)
      // is an EXTRA, coarser pick target for the same token -- see
      // tokenPicking.ts's TrackedToken doc for the real "the player should
      // be easier [to pick than the thin billboard]" request this answers.
      const bodyMesh = sessionId === room!.sessionId ? playerBodyMesh.mesh : remoteBodyMeshes.get(sessionId);
      trackedTokens.push({
        sessionId,
        characterId: p.characterId,
        owned: !!p.characterId && p.characterId === myResolvedCharacterId(),
        planeMesh: token.mesh,
        extraHitboxMeshes: bodyMesh ? [bodyMesh] : undefined,
      });
    }
  }

  /**
   * Geometric hit-test (characterToken.ts's header explains why --
   * AdvancedDynamicTexture's own pointer hover can't work here since noa
   * sets scene.skipPointerMovePicking). Shared by the per-tick hover
   * highlight below and voxelEditor.ts's click-to-edit hook -- both need
   * the exact same "which owned token's bar, if any, is at this screen
   * point" answer, just at different moments (continuously vs. on click).
   */
  function resolveHoveredBar(screenPoint: { x: number; y: number }): { characterId: string; sessionId: string; variableId: string } | undefined {
    const result = pickToken(scene, trackedTokens, screenPoint);
    if (!result?.owned) return undefined;
    const token = remoteTokens.get(result.sessionId);
    if (!token) return undefined;
    if (result.pickedMesh !== token.mesh) return undefined; // hit the body box (the coarser extraHitboxMeshes target), not the billboard plane -- not precise enough for bar editing
    const localPoint = BABYLON.Vector3.TransformCoordinates(result.worldPoint, token.mesh.getWorldMatrix().clone().invert());
    const variableId = token.hitTestLocalPoint(localPoint.x, localPoint.y);
    return variableId ? { characterId: result.characterId, sessionId: result.sessionId, variableId } : undefined;
  }

  // ---- voxel edits: apply locally immediately (installVoxelEditor already
  // does this via noa.setBlock before this callback even runs), send
  // intent to the server, and apply other clients' edits the same way we
  // apply our own. Installed here (after the room connects), not up with
  // the worldDataNeeded listener above -- unlike chunk requests, a click
  // can't happen before this function has had a chance to run past the
  // `await` below, so there's no pre-connection window to queue against.
  installVoxelEditor(
    noa,
    getEquippedItem,
    (x, y, z, voxelId) => {
      room.send("editBlock", { x, y, z, voxelId });
    },
    () => gmOverride.isActive(),
    {
      pickOwnedToken: () => {
        const result = pickToken(scene, trackedTokens, currentPickScreenPoint());
        return result?.owned ? { characterId: result.characterId } : undefined;
      },
      pickHoveredStatBar: () => {
        const resolved = resolveHoveredBar(currentPickScreenPoint());
        return resolved ? { characterId: resolved.characterId, variableId: resolved.variableId } : undefined;
      },
      openContextMenu: (characterIdToOpen, x, y) => {
        lastMenuOpenScreen = { x, y };
        contextMenu.open(x, y, characterIdToOpen);
      },
      openStatEditor,
    },
  );

  room.onMessage("blockChanged", ({ x, y, z, voxelId }: EditBlockMessage) => {
    noa.setBlock(voxelId, x, y, z);
  });

  noa.on("tick", () => {
    // GM-only chat tab's seeThroughWalls checkbox (chatPanel.ts): poll
    // the room's own Schema-synced value fresh every tick, same idiom
    // respawnControl.ts already uses for worldBottomY/hasRespawnAnchor
    // -- no `.listen()` anywhere in this codebase for a scalar field.
    onSeeThroughWallsChange(!!(room.state as { seeThroughWalls?: boolean } | undefined)?.seeThroughWalls);

    // Over a real connection (unlike @colyseus/testing's in-process
    // harness), the initial full-state sync can arrive a tick or two after
    // joinOrCreate() resolves -- confirmed directly via a real-socket smoke
    // test, not an assumption. Guard rather than assume state is populated.
    const players = (room.state as { players?: Map<string, RemotePlayerLike> } | undefined)?.players;
    if (!players) return;
    const seen = new Set<string>();
    for (const [sessionId, p] of players) {
      seen.add(sessionId);

      // Real bug found live: a characterToken billboard only ever existed
      // for REMOTE players (same precedent the original fixed-color box
      // had) -- a solo tester in a single tab saw nothing at all, not even
      // zoomed into third person where playerBodyMesh.ts's own box IS
      // visible. Attach the local token to that EXISTING box instead of
      // building a second one -- no remote-style entity/material of our
      // own needed, playerBodyMesh.ts already owns that.
      if (sessionId === room.sessionId) {
        let localToken = remoteTokens.get(sessionId);
        if (!localToken) {
          localToken = createCharacterToken(scene, p.characterName || p.name);
          // Parented to the scale-cancelling anchor, NOT the body mesh
          // directly -- see PlayerBodyMesh.tokenAnchor's own doc for
          // the real squish/offset-drift bug this fixes.
          localToken.mesh.parent = playerBodyMesh.tokenAnchor;
          localToken.mesh.position = new BABYLON.Vector3(0, tokenYOffsetFor(p.bodyHeight), 0);
          localToken.mesh.scaling.setAll(p.bodyHeight / PLAYER_BODY_HEIGHT);
          // Real bug found live: a mesh built via plain MeshBuilder and
          // just parented, without ever going through noa's own rendering
          // API, is NEVER added to noa's custom octree-based active-mesh
          // selection (sceneOctreeManager.js) -- Babylon's render loop then
          // only ever draws what THAT returns (confirmed directly in
          // @babylonjs/core's OctreeSceneComponent.getActiveMeshCandidates),
          // so the billboard existed, was correctly positioned, and was
          // completely invisible. Registering it the same way noa's own
          // `mesh` ECS component already does for the box fixes this.
          noa.rendering.addMeshToScene(localToken.mesh, false);
          remoteTokens.set(sessionId, localToken);
        }
        // isPickable too, not just isVisible -- Babylon's pick/pickWithRay
        // ignores isVisible entirely, and in first person this token sits
        // right at the camera itself, which would otherwise get picked
        // constantly instead of whatever's actually being looked at.
        const thirdPerson = playerBodyMesh.isThirdPerson();
        localToken.mesh.isVisible = thirdPerson;
        localToken.mesh.isPickable = thirdPerson;

        if (bodySizeChanged(LOCAL_BODY_SIZE_KEY, p.bodyWidth, p.bodyHeight, p.bodyDepth)) {
          resizeLocalPlayerBody(noa, playerBodyMesh, p.bodyWidth, p.bodyHeight, p.bodyDepth);
          localToken.mesh.position.y = tokenYOffsetFor(p.bodyHeight);
          localToken.mesh.scaling.setAll(p.bodyHeight / PLAYER_BODY_HEIGHT);
        }
        localToken.update({
          name: p.characterName || p.name,
          bars: toTokenBars(p.bars),
          statusEffects: Array.from(p.statusEffects ?? []),
        });
        continue;
      }

      let eid = remoteEntities.get(sessionId);
      let material = remoteMaterials.get(sessionId);
      let token = remoteTokens.get(sessionId);
      if (eid === undefined || !material || !token) {
        // Default red (the project's original fixed color) when no real
        // character is selected -- a characterless join is a real state
        // (see WorldRoom.ts's onJoin), not an error, and still needs to
        // render as SOMETHING.
        const hasCharacter = !!p.characterId;
        material = new BABYLON.StandardMaterial(`remotePlayerMat-${sessionId}`, scene);
        material.diffuseColor = hasCharacter ? new BABYLON.Color3(p.tokenColorR, p.tokenColorG, p.tokenColorB) : new BABYLON.Color3(0.9, 0.2, 0.2);
        remoteMaterials.set(sessionId, material);

        // MVP goal item 4 follow-up: built at THIS player's own current
        // body size (not the shared PLAYER_BODY_WIDTH/HEIGHT/DEPTH
        // constants) -- a brand-new remote entity always starts sized
        // correctly, same spirit as the resize-on-change branch below
        // for one already seen before.
        const mesh = BABYLON.MeshBuilder.CreateBox(`remote-${sessionId}`, { width: p.bodyWidth, height: p.bodyHeight, depth: p.bodyDepth }, scene);
        mesh.material = material;
        eid = noa.entities.add([p.x, p.y, p.z], p.bodyWidth, p.bodyHeight, mesh, [0, p.bodyHeight / 2, 0], false, false);
        remoteEntities.set(sessionId, eid);
        remoteBodyMeshes.set(sessionId, mesh);
        appliedBodySizes.set(sessionId, [p.bodyWidth, p.bodyHeight, p.bodyDepth]);
        const anchor = createBodyAnchor(mesh);
        remoteTokenAnchors.set(sessionId, anchor);

        token = createCharacterToken(scene, p.characterName || p.name);
        // Parented to the scale-cancelling anchor, NOT the body mesh
        // directly -- see PlayerBodyMesh.tokenAnchor's own doc for the
        // real squish/offset-drift bug this fixes. Still follows the
        // box's own noa-driven position for free (the anchor is just
        // an extra link in the SAME parent chain).
        token.mesh.parent = anchor;
        token.mesh.position = new BABYLON.Vector3(0, tokenYOffsetFor(p.bodyHeight), 0);
        token.mesh.scaling.setAll(p.bodyHeight / PLAYER_BODY_HEIGHT);
        noa.rendering.addMeshToScene(token.mesh, false); // see the matching comment on the local-token branch above -- same real bug, same fix
        remoteTokens.set(sessionId, token);
      } else {
        noa.entities.setPosition(eid, [p.x, p.y, p.z]);
        material.diffuseColor = p.characterId ? new BABYLON.Color3(p.tokenColorR, p.tokenColorG, p.tokenColorB) : new BABYLON.Color3(0.9, 0.2, 0.2);
        if (bodySizeChanged(sessionId, p.bodyWidth, p.bodyHeight, p.bodyDepth)) {
          resizeEntityBody(noa, eid, remoteBodyMeshes.get(sessionId)!, remoteTokenAnchors.get(sessionId)!, p.bodyWidth, p.bodyHeight, p.bodyDepth);
          token.mesh.position.y = tokenYOffsetFor(p.bodyHeight);
          token.mesh.scaling.setAll(p.bodyHeight / PLAYER_BODY_HEIGHT);
        }
      }

      token.update({
        name: p.characterName || p.name,
        bars: toTokenBars(p.bars),
        statusEffects: Array.from(p.statusEffects ?? []),
      });
    }
    for (const [sessionId, eid] of remoteEntities) {
      if (!seen.has(sessionId)) {
        // deleteEntity is inherited from ent-comp's ECS base class -- see
        // the same cast rationale in movement/PlayerController.ts.
        (noa.entities as unknown as { deleteEntity(id: number): void }).deleteEntity(eid);
        remoteEntities.delete(sessionId);
        remoteBodyMeshes.delete(sessionId); // the mesh itself is disposed by deleteEntity above (noa's mesh component's onRemove)
        appliedBodySizes.delete(sessionId);
        remoteTokenAnchors.get(sessionId)?.dispose();
        remoteTokenAnchors.delete(sessionId);
        remoteTokens.get(sessionId)?.dispose();
        remoteTokens.delete(sessionId);
        remoteMaterials.get(sessionId)?.dispose();
        remoteMaterials.delete(sessionId);
      }
    }

    rebuildTrackedTokens();
    const screenPoint = currentPickScreenPoint();
    const picked = pickToken(scene, trackedTokens, screenPoint);
    const nextHovered = picked?.owned ? picked.sessionId : undefined;
    if (nextHovered !== hoveredSessionId) {
      if (hoveredSessionId) setHighlight(hoveredSessionId, false);
      if (nextHovered) setHighlight(nextHovered, true);
      hoveredSessionId = nextHovered;
    }

    // Real request: the bar itself should show feedback for whichever one
    // is specifically under the cursor, same spirit as the coarser token/
    // body-box outline above.
    const hoveredBar = resolveHoveredBar(screenPoint);
    if (hoveredBar?.sessionId !== hoveredBarSessionId) {
      if (hoveredBarSessionId) remoteTokens.get(hoveredBarSessionId)?.setHoveredBar(undefined);
      if (hoveredBar) remoteTokens.get(hoveredBar.sessionId)?.setHoveredBar(hoveredBar.variableId);
      hoveredBarSessionId = hoveredBar?.sessionId;
    }
  });

  const HIGHLIGHT_OUTLINE_COLOR = new BABYLON.Color3(1, 0.85, 0.2);

  // Real feedback: a dim material-emissive tint was too subtle to notice,
  // and only ever applied to the BODY BOX -- hovering was often actually
  // landing on the billboard plane instead (a separate mesh, floating
  // above the box), which never got any visual change at all. Babylon's
  // own built-in outline rendering (a real, standard AbstractMesh
  // feature -- not hand-rolled) is a much more visible "this is
  // interactable" indicator, applied to BOTH meshes so whichever one the
  // cursor is actually over still shows the SAME obvious feedback.
  function setHighlight(sessionId: string, on: boolean): void {
    const bodyMesh = sessionId === room!.sessionId ? playerBodyMesh.mesh : remoteBodyMeshes.get(sessionId);
    const planeMesh = remoteTokens.get(sessionId)?.mesh;
    for (const mesh of [bodyMesh, planeMesh]) {
      if (!mesh) continue;
      mesh.renderOutline = on;
      mesh.outlineWidth = 0.04;
      mesh.outlineColor = HIGHLIGHT_OUTLINE_COLOR;
    }
  }

  // ---- send our own position ----
  let tickCount = 0;
  noa.on("tick", () => {
    // Gated on the initial-spawn correction above -- sending our own
    // (still-cosmetic-placeholder) position before that correction lands
    // would overwrite the server's real computed spawn in its own Schema
    // state (WorldRoom's "pos" handler unconditionally trusts whatever
    // position it's sent), erasing the fix before the player ever sees it.
    if (!appliedInitialSpawn) return;
    tickCount++;
    if (tickCount % POS_SEND_EVERY_N_TICKS !== 0) return;
    const pos = noa.ents.getPosition(noa.playerEntity);
    if (!pos) return;
    room.send("pos", { x: pos[0], y: pos[1], z: pos[2], yaw: noa.camera.heading });
  });

  // Real bug found live: leaving the game route (game.ts's RunningGame.stop())
  // tore down the local noa/Babylon view but never told the SERVER this
  // client disconnected -- the WebSocket just sat open with nothing reading
  // from it. The old session's PlayerState lingered in that world's room
  // state; reconnecting (even as a "new" session) made the leftover one
  // render as a red, non-colliding "remote player" ghost box, reproduced
  // live and confirmed from a screenshot. `leave()` here is what game.ts's
  // stop() now actually calls.
  return {
    leave() {
      pageManager.destroy();
      pageManagerContainer.remove();
      contextMenu.destroy();
      contextMenuContainer.remove();
      statInputContainer.remove();
      for (const token of remoteTokens.values()) token.dispose();
      for (const material of remoteMaterials.values()) material.dispose();
      room.leave();
    },

    setSeeThroughWalls(enabled: boolean): void {
      room.send("setSeeThroughWalls", { enabled });
    },
  };
}

// The actual 3D game view -- this is what used to be the entire content of
// main.ts before the worlds lobby page existed. Now it's a function the
// router calls once an account has picked a world to play, instead of
// running immediately on page load.
//
// `worldId` IS sent to the server now (as a room-creation option, matched
// against WorldRoom.filterBy(['worldId']) in server.ts) so different
// worlds get different room instances -- and testArea.ts's generator now
// varies a small region near spawn by worldId too, since two different
// worlds looked completely identical in practice (confirmed live,
// "impossible to tell which I'm in"). An on-screen label was tried first
// and explicitly rejected in favor of real, lookable-at terrain
// differences -- see testArea.ts's variant-region comment for that part.
// This file's only remaining job for it is a console log, not UI.

import { Engine } from "noa-engine";
import { CHUNK_SIZE, VOXEL_TYPES, FACE_ORDER, CORE_ATLAS_URL, buildBlockCatalog } from "@ttrpg3d/shared";
import { connectAndStreamWorld } from "./net.js";
import { installPlayerController } from "./movement/PlayerController.js";
import { installOriginShiftLogger } from "./originShiftLogger.js";
import { buildCrossPlantMesh } from "./plantMesh.js";
import { buildCubeObjectMesh } from "./cubeObjectMesh.js";
import { mountHotbar } from "./hotbar.js";
import { mountModePanel } from "./modePanel.js";
import { installCameraZoom } from "./cameraZoom.js";
import { installUnderwaterEffect } from "./underwaterEffect.js";
import { installPlayerBodyMesh } from "./playerBodyMesh.js";
import * as BABYLON from "@babylonjs/core";
import { XrayFadePlugin, AtlasSamplingPlugin, updateXrayUniforms } from "./blockShaders.js";

// noa's registerBlock material array is a *fixed* 6-element order -- but
// registry.js's own doc comment on the 6-length branch ("interpret as
// [-x, +x, -y, +y, -z, +z]") is actually wrong, confirmed by tracing the
// real consumer: terrainMesher.js's constructMeshMask calls
// getMaterial(id0, d*2) / getMaterial(id1, d*2+1), and
// getBlockFaceMaterial's OWN comment says dir 0..5 is
// [+x, -x, +y, -y, +z, -z] -- which matches the actual mesher code (id0 is
// the voxel on the low side of the face, so its "d*2" face points toward
// +axis). Mismatching this swapped every pair (confirmed live: grass's
// bottom/dirt texture was rendering on the top face instead of the green
// top texture). This order is what's actually consumed -- use it, not the
// registerBlock-branch comment. voxelTypes.ts's shared FACE_ORDER already
// matches it (reused as-is for each type's own atlas layer order too,
// since it's already a fixed order both sides need to agree on).
//
// Each "cube" type's faces live in ITS OWN atlas (type.atlasUrl,
// type.atlasBaseLayer) rather than one hardcoded atlas constant here --
// noa's material registration is already per-material
// (`registerMaterial(name, {textureURL, atlasIndex})`), so different
// types can freely point at different atlases with no engine-side
// limitation. All of today's built-in types happen to share one atlas
// (the most performant arrangement for a fixed, known set -- see
// voxelTypes.ts's CORE_ATLAS_URL), but this loop doesn't know or care --
// it just reads whatever each type says, which is what lets a future
// mod-provided block (its own atlasUrl/atlasBaseLayer) register through
// this exact same path with no changes here.

// Matches testArea.ts's spawnPosition() exactly -- avoids the player
// rendering somewhere wrong for the one tick before the server's own spawn
// position round-trips back. NOT the area center -- see that function's
// comment for why (it collided with the center marker pillar).
const SPAWN: [number, number, number] = [8, 5, 24];

export interface RunningGame {
  /**
   * Tears down the noa/Babylon instance -- noa-engine has no built-in
   * dispose API (checked its source directly: no dispose/destroy method
   * anywhere), so this does the closest equivalent by hand: pause the tick
   * loop, dispose the Babylon scene+engine (frees the WebGL context --
   * important, browsers cap how many can exist at once), and remove noa's
   * own container/canvas element (appended directly to document.body by
   * noa itself, confirmed via its container.js). Needed because leaving
   * the game route previously left the canvas running full-screen on top
   * of the lobby with no way back short of a hard refresh -- reproduced
   * live via the browser back button.
   */
  stop(): void;
  /**
   * Suspends/restores pointer-lock mouse-look -- exposed outward so
   * main.ts's chat panel (mounted independently of this per-page
   * session, surviving page switches that tear this whole RunningGame
   * down and rebuild it) can suspend mouse-look while its compose box
   * is focused, the same way hotbar.ts's own onInventoryOpenChange
   * callback already does from inside this file.
   */
  setPointerLock(locked: boolean): void;
  /** Current pointer-lock state, read directly off noa's own real `hasPointerLock` flag -- not tracked separately here, so it can never drift out of sync with reality. */
  isPointerLocked(): boolean;
  /**
   * Relays noa.container's own real `gainedPointerLock`/`lostPointerLock`
   * events (confirmed directly in noa-engine's container.d.ts -- it
   * `extends EventEmitter`, driven by the actual browser pointer-lock-
   * change detection) so modePanel.ts's Default/Select buttons can stay
   * highlighted correctly even when the BROWSER force-exits lock via
   * Escape, not just when this file's own setPointerLock is called.
   * Returns an unsubscribe function.
   */
  onPointerLockChange(cb: (locked: boolean) => void): () => void;
  /**
   * Relays gmOverride.ts's own G-key toggle -- main.ts's chatPanel.ts
   * (mounted independently of this per-page session, same reasoning as
   * onPointerLockChange above) uses this to show/hide its GM-only tab
   * exactly when GM mode turns on/off, no separate hotkey. Returns an
   * unsubscribe function; a FRESH subscription is needed on every new
   * RunningGame (main.ts re-subscribes after every launchGame call).
   */
  onGmActiveChange(cb: (active: boolean) => void): () => void;
  /**
   * Relays net.ts's per-tick poll of the room's own Schema-synced
   * seeThroughWalls value -- chatPanel.ts's GM tab reflects it in its
   * checkbox. Same re-subscribe-per-RunningGame caveat as above.
   */
  onSeeThroughWallsChange(cb: (enabled: boolean) => void): () => void;
  /** Sends the admin-gated "setSeeThroughWalls" room message -- chatPanel.ts's GM tab checkbox calls this via main.ts. */
  setSeeThroughWalls(enabled: boolean): void;
  /** docs/BATTLE_SYSTEM.md's waypoint/distance measurement GM settings checkboxes -- same tier/pattern as onSeeThroughWallsChange/setSeeThroughWalls. */
  onWaypointAutoOnChange(cb: (enabled: boolean) => void): () => void;
  onWaypointAutoOffChange(cb: (enabled: boolean) => void): () => void;
  setWaypointAutoOn(enabled: boolean): void;
  setWaypointAutoOff(enabled: boolean): void;
  /** No hot-reload exists for mods -- re-launches the player's own current world, same teardown/recreate cycle page-switching already uses. chatPanel.ts's GM tab "Reload this page" button calls this via main.ts. */
  reloadWorld(): void;
}

export function startGame(
  gameId: string,
  worldId: string,
  worldName: string,
  serverUrl: string,
  httpUrl: string,
  playerName: string,
  accountId: string,
  // MVP goal items 1-2 (docs/ROADMAP.md) -- threaded through exactly like
  // accountId above, all the way to net.ts's joinOrCreate options. Null is
  // a real state (no character selected yet), not an error.
  characterId: string | null,
  onSwitchWorld: (worldId: string, worldName: string) => void,
): RunningGame {
  console.log(`[game] starting world "${worldName}" (${worldId})`);

  const noa = new Engine({
    debug: true,
    showFPS: true,
    chunkSize: CHUNK_SIZE,
    chunkAddDistance: 2.5,
    chunkRemoveDistance: 3.5,
    playerStart: SPAWN,
    // Closer to Godot's typical 60Hz physics step than noa's own 30Hz
    // default -- the ported movement constants (speed/friction-as-max-delta)
    // were tuned against that, and matching tick rate avoids having to
    // retune them just because the engine changed.
    tickRate: 60,
    // Matches the old repo's center_of_universe.gd threshold (128) closely
    // enough in spirit -- rebase a bit more eagerly than noa's own default
    // (25) is fine; smaller/more-frequent shifts are cheaper to verify during
    // the Phase 2 playtest than rare/large ones.
    originRebaseDistance: 40,
    // Real block textures -- self-authored PNGs decoded from the old
    // game's own Blender/Godot source, served by Vite at this path.
    // registerMaterial below resolves textureURL against this base: the
    // shared atlas for cube types (see cubeAtlasIndex above), or the
    // plant textures loaded directly in plantMesh.ts's custom mesh.
    texturePath: "/textures/blocks/",
    // Real bug found live: "it does capture the mouse and start
    // controlling the camera when adding points to 'chain', which
    // isn't intuitive." Root cause, confirmed directly in
    // micro-game-shell's own source: noa's `stickyPointerLock`
    // defaults to true, which wires a RAW click listener directly on
    // the canvas element -- completely separate from and invisible to
    // this project's own fire/alt-fire handling (voxelEditor.ts) --
    // that re-requests pointer lock on literally every single click,
    // regardless of mode. This project already has its own complete,
    // deliberate pointer-lock management (Default/Select/Measure
    // modes, chat focus, hotbar, the "Look around" button) with no
    // need for noa's own "any click re-locks" convenience behavior,
    // which actively fights it. Disabled globally.
    stickyPointerLock: false,
  });

  const scene = noa.rendering.getScene();

  // ONE shared material for every "cutout"-mode cube type still on the
  // core atlas (dirt/grass/log/leaves/ores/etc) -- built once and reused
  // via noa's `registerMaterial(name, {renderMaterial})`, which bypasses
  // noa's own auto-created atlas material entirely once set (confirmed
  // directly in terrainMaterials.js's createTerrainMat: `if (matInfo.
  // renderMat) return matInfo.renderMat`). Reusing one object (rather than
  // building a new one per type) preserves the single-shared-GPU-material
  // performance characteristic the atlas work was for -- terrainMaterials.
  // js's own decideTerrainMatID dedupes by this exact object identity.
  // AtlasSamplingPlugin re-implements noa's own internal (non-exported)
  // TerrainMaterialPlugin to sample the real texture-array atlas;
  // XrayFadePlugin layers the old game's universal xray-if-behind cutout
  // fade on top -- see blockShaders.ts's header for both.
  const coreAtlasMaterial = new BABYLON.StandardMaterial("core-atlas-mat", scene);
  const coreAtlasTexture = new BABYLON.Texture(
    `/textures/blocks/${CORE_ATLAS_URL}`,
    scene,
    true,
    false,
    BABYLON.Texture.NEAREST_SAMPLINGMODE,
  );
  // hasAlpha=true: real bug found porting GLASS (voxelTypes.ts) -- every
  // other cutout-mode type's real source texture is fully opaque
  // (alpha=255 throughout), so the base material's own alpha handling
  // never mattered until a type with real alpha variance (GLASS's
  // opaque-border/transparent-center cutout pattern) needed it actually
  // read from the atlas rather than assumed 1.0. AtlasSamplingPlugin
  // below samples the atlas's real RGBA (including alpha) into
  // `baseColor`, but Babylon's own base fragment shader only carries
  // that into its `alpha` variable when the diffuse texture itself is
  // marked as having alpha -- XrayFadePlugin's cutout discard reads that
  // same `alpha` value, so without this, glass rendered fully opaque.
  coreAtlasTexture.hasAlpha = true;
  coreAtlasMaterial.diffuseTexture = coreAtlasTexture;
  coreAtlasMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
  // Real request: "turn backface culling off for terrain if you don't
  // want to see the insides of everything with the cutout shader" --
  // with it on (Babylon's default), looking through a cutout hole in
  // one face (leaves, ores, etc.) at an adjacent block shows nothing,
  // since that neighbor's OWN face pointing back at the gap is culled
  // as a backface from this angle. Safe to disable here with no
  // glass-style z-fighting risk (see cubeObjectMesh.ts's own doc on
  // why GLASS specifically must stay culled): every type sharing this
  // material is `opaque: true` (glass is the only `opaque: false`
  // cutout type, and it uses its own separate cube-object mesh/
  // material entirely, untouched by this), so the greedy mesher never
  // emits two coincident faces for a boundary between two of these --
  // there's only ONE face per boundary to begin with, just now
  // rendered from either side.
  coreAtlasMaterial.backFaceCulling = false;
  new AtlasSamplingPlugin(coreAtlasMaterial, coreAtlasTexture);
  new XrayFadePlugin(coreAtlasMaterial, "cutout");

  // Real per-material alpha_min values from the old game's actual
  // shader_*.tres files (not the shader's generic default) -- water/
  // watertop use 0.5, quartz uses the same 0.2 as everything else
  // (DEFAULT_XRAY_PARAMS.alphaMin), so no override needed for it.
  const TRANSPARENT_ALPHA_MIN: Partial<Record<string, number>> = { water: 0.5, watertop: 0.5 };

  // Per-type registration, from the shared table (packages/shared's
  // single source of truth for both this loop and the server's
  // generator). Real per-face textures (each type's own atlasUrl/
  // atlasBaseLayer -- see the top-of-file comment on why that's per-type,
  // not one hardcoded atlas here) and a real alpha-cutout plant mesh --
  // both decoded directly from the old game's actual Blender/Godot source
  // files (dirt.obj's UVs for the per-face atlas layout, tall_grass.obj's
  // geometry+UVs for the cross mesh), not guessed. See voxelTypes.ts's
  // `mesh` field doc for the full rationale.
  for (const type of VOXEL_TYPES) {
    if (type.mesh === "cube" && type.atlasUrl && type.atlasBaseLayer !== null) {
      // "cutout"-mode cube type, still on the shared core atlas -- reuse
      // coreAtlasMaterial for every face via renderMaterial. atlasIndex is
      // still passed per face: it's read unconditionally by noa's
      // registerMaterial regardless of renderMaterial, and drives the
      // texAtlasIndices vertex attribute the terrain mesher populates
      // (confirmed in noa's registry.js/terrainMesher.js) -- the same
      // attribute AtlasSamplingPlugin's shader code reads.
      const { atlasBaseLayer } = type;
      const materialNames = FACE_ORDER.map((face) => `${type.name}-${face}`);
      FACE_ORDER.forEach((face, i) => {
        noa.registry.registerMaterial(materialNames[i], { renderMaterial: coreAtlasMaterial, atlasIndex: atlasBaseLayer + i });
      });
      // opaque: type.opaque ?? true -- see VoxelTypeDef.opaque's own doc.
      // Only GLASS sets this false today; every other cutout type keeps
      // noa's normal neighbor-face-culling behavior.
      noa.registry.registerBlock(type.id, { material: materialNames, solid: type.solid, fluid: type.fluid, opaque: type.opaque ?? true });
    } else if (type.mesh === "cube" && type.transparencyMode === "transparent" && type.textureFile) {
      // water/watertop/quartz: off the atlas, own small standalone
      // texture+material (XrayFadePlugin("transparent", ...) -- real soft
      // alpha blend, backface culling off so the surface is visible from
      // both sides, direct fix for "water invisible from inside" since
      // these were previously backface-culled opaque cubes). Same texture
      // on every face -- confirmed visually uniform/repeating across the
      // old game's own source images, no per-face distinction worth
      // keeping (see transparencyMode's doc).
      const material = new BABYLON.StandardMaterial(`${type.name}-mat`, scene);
      const texture = new BABYLON.Texture(`/textures/blocks/${type.textureFile}`, scene, true, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
      texture.hasAlpha = true;
      material.diffuseTexture = texture;
      material.backFaceCulling = false;
      // Real, documented Babylon limitation (confirmed via the Babylon
      // forum, not guessed): an alpha-blended material with
      // backFaceCulling off can still have its OWN far faces culled when
      // the camera is INSIDE the mesh (e.g. swimming inside a water
      // voxel, looking up at the surface from below) -- exactly the
      // reported "water surface cannot be seen from below" bug.
      // separateCullingPass (does culling in its own pass instead of
      // relying on draw order) plus forceDepthWrite is the documented fix.
      material.separateCullingPass = true;
      material.forceDepthWrite = true;
      material.specularColor = new BABYLON.Color3(0, 0, 0);
      // Spreads over DEFAULT_XRAY_PARAMS inside the plugin -- must omit the
      // key entirely (not pass `alphaMin: undefined`) for quartz to fall
      // through to the default 0.2 rather than overwriting it with undefined.
      const alphaMin = TRANSPARENT_ALPHA_MIN[type.name];
      new XrayFadePlugin(material, "transparent", alphaMin === undefined ? {} : { alphaMin });
      noa.registry.registerMaterial(type.name, { renderMaterial: material });
      noa.registry.registerBlock(type.id, { material: type.name, solid: type.solid, fluid: type.fluid, opaque: false });
    } else if (type.mesh === "cross" && type.textureFile) {
      const mesh = buildCrossPlantMesh(scene, type.name, `/textures/blocks/${type.textureFile}`);
      // opaque defaults to true for any non-fluid block (confirmed in
      // noa-engine's registry.js BlockOptions) -- left at that default,
      // the terrain mesher culled the FACE OF THE SOLID BLOCK BELOW each
      // plant placement, since it thought the cell above was opaque and
      // would hide it anyway. The thin cross mesh doesn't actually cover
      // that face, so the result was a real hole in the ground's render
      // under every tallgrass/deadshrub, with the plant's own sprite
      // appearing to float over it -- confirmed live, and absent before
      // these were registered as opaque solid cubes (where the culling
      // was actually correct). Must be explicit false here.
      noa.registry.registerBlock(type.id, { blockMesh: mesh, solid: type.solid, fluid: type.fluid, opaque: false });
    } else if (type.mesh === "cube-object" && type.textureFile) {
      // GLASS today -- see voxelTypes.ts's `mesh` doc for why a
      // see-through SOLID block needs noa's object-mesher (bypasses the
      // greedy terrain mesher's neighbor-culling entirely) rather than
      // the shared atlas-cube path every other solid cube type above
      // uses.
      const mesh = buildCubeObjectMesh(scene, type.name, `/textures/blocks/${type.textureFile}`);
      noa.registry.registerBlock(type.id, { blockMesh: mesh, solid: type.solid, fluid: type.fluid, opaque: type.opaque ?? true });
    } else {
      noa.registry.registerMaterial(type.name, { color: type.color });
      noa.registry.registerBlock(type.id, { material: type.name, solid: type.solid, fluid: type.fluid });
    }
  }

  // Feeds blockShaders.ts's shared player/camera-position uniforms once
  // per frame -- every XrayFadePlugin instance (on coreAtlasMaterial and
  // each transparent-type material) reads these same two vectors when it
  // binds. Direct analogue of the old game's player_camera_with_cutout.gd,
  // which set the equivalent `global uniform vec3` pair every frame.
  //
  // MUST be noa.globalToLocal()'d first, not fed the raw getPosition()/
  // getPosition() GLOBAL (world) coords directly -- real bug found live
  // ("upon origin shift... the cutout went off in the distance"). Terrain
  // mesh vertices (vPositionW in the shader, read via blockShaders.ts's
  // CUSTOM_FRAGMENT_UPDATE_ALPHA) are built in noa's LOCAL/render frame
  // (relative to noa.worldOriginOffset, confirmed directly in
  // terrainMesher.js/components/position.js), while `noa.ents.getPosition`
  // and `noa.camera.getPosition()` both deliberately return GLOBAL world
  // coords (confirmed directly in camera.js's own getPosition: `this.noa.
  // localToGlobal(loc, globalCamPos)`). The two frames coincide (by
  // coincidence) until the first origin rebase, after which they diverge
  // by exactly worldOriginOffset -- displacing the whole xray cone by that
  // same amount, matching the reported symptom exactly.
  const localPlayerPos: [number, number, number] = [0, 0, 0];
  const localCameraPos: [number, number, number] = [0, 0, 0];
  const centerGlobal: [number, number, number] = [0, 0, 0];
  // GM-only tab toggle (chatPanel.ts, wired via net.ts's per-tick poll
  // of the room's Schema-synced `seeThroughWalls` field) -- true (the
  // existing/default behavior) until net.ts's connection resolves and
  // reports the real value. When false, feed the PLAYER's own position
  // as both uniforms below: blockShaders.ts's cutout math only runs
  // when distance(cameraPos, playerPos) > xray_cameraMinDist (2.0), so
  // a zero-distance pair unconditionally skips the cutout branch for
  // every fragment on every draw call (including shadow passes, since
  // the uniform is one shared global pair, not view-gated) -- a
  // provable early-exit, not a heuristic. Real correction: this ALONE
  // only stops the visual fade -- cameraZoom.ts's own separate
  // collision clamp (toggled alongside this, see the connection setup
  // below) is what stops the camera from physically passing through
  // walls at all.
  let seeThroughWallsEnabled = true;
  // docs/BATTLE_SYSTEM.md's measurement shapes -- the mode-panel's own
  // "Distance" button highlight. Only modePanel.ts needs to know about
  // this (unlike seeThroughWalls, which chatPanel.ts AND cameraZoom.ts
  // both need), so a plain mirrored local variable is enough -- no
  // Set-of-listeners needed, just the same "net.ts polls the real
  // source every tick, calls this callback" idiom as seeThroughWalls.
  let measureModeActiveLocal = false;
  const gmActiveListeners = new Set<(active: boolean) => void>();
  const seeThroughWallsListeners = new Set<(enabled: boolean) => void>();
  const waypointAutoOnListeners = new Set<(enabled: boolean) => void>();
  const waypointAutoOffListeners = new Set<(enabled: boolean) => void>();
  scene.onBeforeRenderObservable.add(() => {
    // noa.ents.getPosition returns the BOTTOM-CENTER of the player's AABB
    // (confirmed directly in components/position.js's own doc comment),
    // not the body's actual center -- feeding that straight in as the
    // cone's apex put it ~0.9 units too low (half the player's own
    // height), leaving a visible gap below/in front of the player where
    // the fade math didn't line up with where the body actually is
    // (reported live). Real center = feet position + height/2.
    const posData = noa.ents.getPositionData(noa.playerEntity);
    const feet = posData?.position ?? noa.ents.getPosition(noa.playerEntity) ?? [0, 0, 0];
    const height = posData ? posData.height : 0;
    centerGlobal[0] = feet[0];
    centerGlobal[1] = feet[1] + height / 2;
    centerGlobal[2] = feet[2];
    noa.globalToLocal(centerGlobal, null, localPlayerPos);
    noa.globalToLocal(noa.camera.getPosition(), null, localCameraPos);
    updateXrayUniforms(localPlayerPos, seeThroughWallsEnabled ? localCameraPos : localPlayerPos);
  });

  const playerController = installPlayerController(noa);
  installOriginShiftLogger(noa);
  const cameraZoom = installCameraZoom(noa);
  installUnderwaterEffect(noa);
  const playerBodyMesh = installPlayerBodyMesh(noa);

  // Hotbar + inventory UI (hotbar.ts, direct port of the old game's
  // player_inventory.gd) -- a plain DOM overlay, not part of noa's own
  // canvas, so it gets its own container appended to the page like
  // lobby.ts's UI does. Deliberately noa-free internally (see hotbar.ts's
  // header) -- the one real noa dependency, suspending pointer-lock
  // mouse-look while the inventory grid is open so the mouse is free to
  // click it, is wired here instead via onInventoryOpenChange.
  const hotbarContainer = document.createElement("div");
  document.body.appendChild(hotbarContainer);
  const hotbar = mountHotbar(hotbarContainer, {
    catalog: buildBlockCatalog(),
    onInventoryOpenChange: (open) => noa.container.setPointerLock(!open),
  });

  // Left mode-select panel (modePanel.ts) -- per-page lifecycle, same as
  // hotbar above (see that file's own header for why). Wired directly to
  // noa.container here (not through the RunningGame interface below,
  // which is only for EXTERNAL callers like main.ts) -- same direct
  // pattern hotbar's own onInventoryOpenChange already uses.
  const modePanelContainer = document.createElement("div");
  document.body.appendChild(modePanelContainer);
  const modePanel = mountModePanel(modePanelContainer, {
    isPointerLocked: () => noa.container.hasPointerLock,
    // Real request, 2026-10-24: Default/Select both exit Measure mode
    // (not a second click on Distance itself) -- "you control and tab
    // through the points then, not the character, and the view/
    // camera remain in place" only applies WHILE in measure mode, so
    // switching to either of the other two modes needs to hand
    // movement/camera control back.
    setPointerLock: (locked) => {
      noa.container.setPointerLock(locked);
      void connection.then((c) => c?.setMeasureModeActive(false));
    },
    onPointerLockChange: (cb) => {
      const onGained = () => cb(true);
      const onLost = () => cb(false);
      noa.container.on("gainedPointerLock", onGained);
      noa.container.on("lostPointerLock", onLost);
      return () => {
        noa.container.off("gainedPointerLock", onGained);
        noa.container.off("lostPointerLock", onLost);
      };
    },
    // docs/BATTLE_SYSTEM.md phase 1 -- `connection` (below) is a Promise,
    // same "call once it resolves" pattern setSeeThroughWalls below
    // already uses; safe to reference here even though it's declared
    // textually later -- by the time a user can actually click this
    // button, the synchronous rest of this function has long finished
    // assigning it.
    onToggleTurnTracker: () => void connection.then((c) => c?.toggleTurnTracker()),
    isMeasureModeActive: () => measureModeActiveLocal,
    // Real request, 2026-10-24: "similar to the turns button, clicking
    // the distance mode button should open or close the measure
    // floating UI" -- a real TOGGLE now (open<->close), not an always-
    // enter. Uses the already-mirrored local flag (kept fresh every
    // tick below) rather than needing a separate round-trip to ask
    // net.ts's own measurementShapes for its current state first.
    onSelectMeasureMode: () => void connection.then((c) => c?.setMeasureModeActive(!measureModeActiveLocal)),
  });

  // Resolves to the real server connection once joinOrCreate() completes --
  // stop() below chains onto this (rather than needing its own connected/
  // not-yet-connected branch) so leaving works correctly whether the
  // connection has finished by then or not.
  const connection = connectAndStreamWorld(
    noa,
    serverUrl,
    playerName,
    worldId,
    accountId,
    characterId,
    hotbar.getEquippedItem,
    playerController,
    SPAWN,
    httpUrl,
    gameId,
    playerBodyMesh,
    onSwitchWorld,
    // gmOverride.ts's own G-key toggle, forwarded here from net.ts --
    // relayed to this file's own listener set below (RunningGame.
    // onGmActiveChange) for chatPanel.ts's GM tab, via main.ts.
    (active) => {
      for (const cb of gmActiveListeners) cb(active);
    },
    (enabled) => {
      seeThroughWallsEnabled = enabled;
      // Real correction: the shader toggle above only fades/un-fades
      // geometry visually -- it never stopped the camera from
      // physically clipping THROUGH walls in the first place (that's
      // cameraZoom.ts's own separate collision clamp, permanently
      // disabled by default for an unrelated reason -- see its
      // header). seeThroughWalls OFF needs to restore BOTH: no fade,
      // AND real collision, or walls don't actually "behave like
      // walls" at all.
      cameraZoom.setWallClipAllowed(enabled);
      for (const cb of seeThroughWallsListeners) cb(enabled);
    },
    (enabled) => {
      for (const cb of waypointAutoOnListeners) cb(enabled);
    },
    (enabled) => {
      for (const cb of waypointAutoOffListeners) cb(enabled);
    },
    (active) => {
      measureModeActiveLocal = active;
    },
  ).catch((err) => {
    console.error("[net] failed to connect to world server:", err);
    return null;
  });

  return {
    stop(): void {
      // Real bug found live: this used to only tear down the local view --
      // the server never learned the client left, so the old session
      // lingered in that world's room state and reappeared as a red,
      // walk-through "ghost" player box on reconnecting (confirmed from a
      // screenshot). Actually leave the room now.
      connection.then((c) => c?.leave());

      hotbar.destroy();
      hotbarContainer.remove();
      modePanel.destroy();
      modePanelContainer.remove();

      noa.setPaused(true);
      try {
        const scene = noa.rendering.getScene();
        const engine = scene.getEngine();
        scene.dispose();
        engine.dispose();
      } catch (err) {
        console.error("[game] error disposing Babylon scene/engine:", err);
      }
      noa.container.element.remove();
    },

    setPointerLock(locked: boolean): void {
      noa.container.setPointerLock(locked);
    },

    isPointerLocked(): boolean {
      return noa.container.hasPointerLock;
    },

    onPointerLockChange(cb: (locked: boolean) => void): () => void {
      const onGained = () => cb(true);
      const onLost = () => cb(false);
      noa.container.on("gainedPointerLock", onGained);
      noa.container.on("lostPointerLock", onLost);
      return () => {
        noa.container.off("gainedPointerLock", onGained);
        noa.container.off("lostPointerLock", onLost);
      };
    },

    onGmActiveChange(cb: (active: boolean) => void): () => void {
      gmActiveListeners.add(cb);
      return () => gmActiveListeners.delete(cb);
    },

    onSeeThroughWallsChange(cb: (enabled: boolean) => void): () => void {
      seeThroughWallsListeners.add(cb);
      return () => seeThroughWallsListeners.delete(cb);
    },

    setSeeThroughWalls(enabled: boolean): void {
      void connection.then((c) => c?.setSeeThroughWalls(enabled));
    },

    onWaypointAutoOnChange(cb: (enabled: boolean) => void): () => void {
      waypointAutoOnListeners.add(cb);
      return () => waypointAutoOnListeners.delete(cb);
    },

    onWaypointAutoOffChange(cb: (enabled: boolean) => void): () => void {
      waypointAutoOffListeners.add(cb);
      return () => waypointAutoOffListeners.delete(cb);
    },

    setWaypointAutoOn(enabled: boolean): void {
      void connection.then((c) => c?.setWaypointAutoOn(enabled));
    },

    setWaypointAutoOff(enabled: boolean): void {
      void connection.then((c) => c?.setWaypointAutoOff(enabled));
    },

    reloadWorld(): void {
      onSwitchWorld(worldId, worldName);
    },
  };
}

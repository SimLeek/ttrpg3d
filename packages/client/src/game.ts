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
import { mountHotbar } from "./hotbar.js";
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
}

export function startGame(worldId: string, worldName: string, serverUrl: string, playerName: string): RunningGame {
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
  coreAtlasMaterial.diffuseTexture = coreAtlasTexture;
  coreAtlasMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
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
      noa.registry.registerBlock(type.id, { material: materialNames, solid: type.solid, fluid: type.fluid });
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
    updateXrayUniforms(localPlayerPos, localCameraPos);
  });

  installPlayerController(noa);
  installOriginShiftLogger(noa);
  installCameraZoom(noa);
  installUnderwaterEffect(noa);
  installPlayerBodyMesh(noa);

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

  // Resolves to the real server connection once joinOrCreate() completes --
  // stop() below chains onto this (rather than needing its own connected/
  // not-yet-connected branch) so leaving works correctly whether the
  // connection has finished by then or not.
  const connection = connectAndStreamWorld(noa, serverUrl, playerName, worldId, hotbar.getEquippedItem).catch((err) => {
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
  };
}

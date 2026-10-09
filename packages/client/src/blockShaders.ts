// Two Babylon.js MaterialPluginBase subclasses, direct ports of the old
// game's real shaders -- not from-scratch rewrites. Both extend a plain
// StandardMaterial (reusing its existing lighting/texture pipeline)
// rather than a fully custom ShaderMaterial, which would mean
// reimplementing that lighting model by hand -- confirmed as the real,
// supported extension mechanism by reading noa-engine's own
// TerrainMaterialPlugin (node_modules/noa-engine/src/lib/
// terrainMaterials.js) and Babylon's own shipped injection points
// (node_modules/@babylonjs/core/Shaders/default.fragment.js).
//
// XrayFadePlugin -- ported from the old repo's
// 3dAssets/shaders/xray_if_behind_cutout.gdshader and
// xray_if_behind_transparent.gdshader (both read in full; identical fade
// math, only the final alpha handling differs). Fades a material toward
// transparent along a cone from the player toward the camera, so geometry
// between the two doesn't just block the view. Real per-material
// parameter values are from the old repo's actual .tres files (not the
// shader's own generic uniform defaults): dirt/grass/water/watertop all
// use cutoutRadius=1.5, cutoutPow=3.0, forwardPow=0.05, coneExtra=1.0,
// floorFadeStart=0.0, floorFadeLength=0.25, cameraMinDist=0.5; alphaMin
// varies (water/watertop 0.5, everything else 0.2) -- see
// DEFAULT_XRAY_PARAMS below.
//
// AtlasSamplingPlugin -- a direct re-implementation of noa-engine's own
// (internal, not exported) TerrainMaterialPlugin: samples the shared
// block texture-array atlas via a `texAtlasIndices` per-vertex attribute
// noa's own terrain mesher already populates (driven by each registered
// material's `atlasIndex` option, independent of which actual Babylon
// material ends up used for rendering -- confirmed directly in noa's
// registry.js/terrainMesher.js). Needed because `registerMaterial(name,
// {renderMaterial})` (used to attach XrayFadePlugin to cube types)
// bypasses noa's own atlas-material creation entirely once set, so
// nothing else will sample the atlas for them otherwise.

import * as BABYLON from "@babylonjs/core";

export interface XrayFadeParams {
  cutoutRadius: number;
  cutoutPow: number;
  forwardPow: number;
  coneExtra: number;
  floorFadeStart: number;
  floorFadeLength: number;
  alphaMin: number;
  cameraMinDist: number;
}

export const DEFAULT_XRAY_PARAMS: XrayFadeParams = {
  cutoutRadius: 1.5,
  cutoutPow: 3.0,
  forwardPow: 0.05,
  coneExtra: 1.0,
  floorFadeStart: 0.0,
  floorFadeLength: 0.25,
  alphaMin: 0.2,
  cameraMinDist: 0.5,
};

// Shared by every XrayFadePlugin instance -- set once per frame (see
// updateXrayUniforms, called from game.ts's onBeforeRenderObservable),
// not polled per-material-per-frame. Mirrors the old game's own
// `global uniform vec3 player_position/camera_position` (set once per
// frame from playable/player_camera_with_cutout.gd) -- Babylon has no
// literal global-uniform equivalent, so every plugin instance just reads
// these same two module-level vectors when it binds.
const sharedPlayerPos = BABYLON.Vector3.Zero();
const sharedCameraPos = BABYLON.Vector3.Zero();

export function updateXrayUniforms(playerPos: readonly [number, number, number], cameraPos: readonly [number, number, number]): void {
  sharedPlayerPos.set(playerPos[0], playerPos[1], playerPos[2]);
  sharedCameraPos.set(cameraPos[0], cameraPos[1], cameraPos[2]);
}

export class XrayFadePlugin extends BABYLON.MaterialPluginBase {
  private readonly mode: "cutout" | "transparent";
  private readonly params: XrayFadeParams;

  constructor(material: BABYLON.Material, mode: "cutout" | "transparent", params: Partial<XrayFadeParams> = {}) {
    super(material, "XrayFade", 210, {});
    this.mode = mode;
    this.params = { ...DEFAULT_XRAY_PARAMS, ...params };
    this._enable(true);
    if (mode === "transparent") {
      // Real alpha blend, not the default alpha-test-on-hasAlpha behavior
      // confirmed earlier this session -- matches the old shader's
      // `render_mode blend_mix`.
      //
      // Real bug found live: `transparencyMode` alone does NOT engage
      // blending for a StandardMaterial -- confirmed directly in
      // standardMaterial.js's needAlphaBlending(), which never even reads
      // `transparencyMode`; it requires `useAlphaFromDiffuseTexture`
      // (a separate flag, default false) to be true too. Without it,
      // needAlphaBlending() stays false and the material renders fully
      // opaque regardless of transparencyMode -- reproduced live as
      // "fully opaque, cutout just looks brighter instead of see-through"
      // (the only visible effect was this plugin's own hard `discard`
      // once alpha dropped near zero -- a binary hole, not a soft fade).
      // Belongs here, not at each call site, so no future "transparent"
      // material can forget it the same way.
      if (material instanceof BABYLON.StandardMaterial) {
        material.useAlphaFromDiffuseTexture = true;
      }
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    }
  }

  getClassName(): string {
    return "XrayFadePlugin";
  }

  getUniforms() {
    return {
      ubo: [
        { name: "xray_playerPos", size: 3, type: "vec3" },
        { name: "xray_cameraPos", size: 3, type: "vec3" },
        { name: "xray_cutoutRadius", size: 1, type: "float" },
        { name: "xray_cutoutPow", size: 1, type: "float" },
        { name: "xray_forwardPow", size: 1, type: "float" },
        { name: "xray_coneExtra", size: 1, type: "float" },
        { name: "xray_floorFadeStart", size: 1, type: "float" },
        { name: "xray_floorFadeLength", size: 1, type: "float" },
        { name: "xray_alphaMin", size: 1, type: "float" },
        { name: "xray_cameraMinDist", size: 1, type: "float" },
      ],
      fragment: `
        uniform vec3 xray_playerPos;
        uniform vec3 xray_cameraPos;
        uniform float xray_cutoutRadius;
        uniform float xray_cutoutPow;
        uniform float xray_forwardPow;
        uniform float xray_coneExtra;
        uniform float xray_floorFadeStart;
        uniform float xray_floorFadeLength;
        uniform float xray_alphaMin;
        uniform float xray_cameraMinDist;
      `,
    };
  }

  bindForSubMesh(uniformBuffer: BABYLON.UniformBuffer): void {
    uniformBuffer.updateFloat3("xray_playerPos", sharedPlayerPos.x, sharedPlayerPos.y, sharedPlayerPos.z);
    uniformBuffer.updateFloat3("xray_cameraPos", sharedCameraPos.x, sharedCameraPos.y, sharedCameraPos.z);
    uniformBuffer.updateFloat("xray_cutoutRadius", this.params.cutoutRadius);
    uniformBuffer.updateFloat("xray_cutoutPow", this.params.cutoutPow);
    uniformBuffer.updateFloat("xray_forwardPow", this.params.forwardPow);
    uniformBuffer.updateFloat("xray_coneExtra", this.params.coneExtra);
    uniformBuffer.updateFloat("xray_floorFadeStart", this.params.floorFadeStart);
    uniformBuffer.updateFloat("xray_floorFadeLength", this.params.floorFadeLength);
    uniformBuffer.updateFloat("xray_alphaMin", this.params.alphaMin);
    uniformBuffer.updateFloat("xray_cameraMinDist", this.params.cameraMinDist);
  }

  getCustomCode(shaderType: "vertex" | "fragment") {
    if (shaderType !== "fragment") return null;
    // `vPositionW` is already a real-world-position varying, set by
    // Babylon's own default vertex shader before this point (confirmed
    // directly in default.vertex.js/default.fragment.js) -- no custom
    // vertex-shader code needed to get a world-position varying of our
    // own, just reuse the one that already exists.
    const discardLine = this.mode === "cutout" ? "if (alpha < 0.999) discard;" : "if (alpha < 0.001) discard;";
    return {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        {
          float original_alpha = alpha;
          vec3 cam_to_player = xray_cameraPos - xray_playerPos;
          float line_length = length(cam_to_player);
          if (line_length > xray_cameraMinDist && original_alpha > 0.001) {
            vec3 dir = normalize(cam_to_player);
            float t = dot(vPositionW - xray_playerPos, dir);
            vec3 closest = xray_playerPos + t * dir;
            float perp_dist = length(vPositionW - closest);
            float cone_radius = xray_cutoutRadius * (t / line_length) + xray_coneExtra;
            float cutout = 1.0;
            if (perp_dist < cone_radius) {
              float normalized = perp_dist / cone_radius;
              cutout = pow(normalized, xray_cutoutPow);
            }
            float y_dist = vPositionW.y - (xray_playerPos.y - xray_floorFadeStart);
            float vertical_mask = 0.0;
            if (xray_cameraPos.y > xray_playerPos.y) {
              vertical_mask = clamp(-y_dist / xray_floorFadeLength, 0.0, 1.0);
            }
            alpha = original_alpha * cutout;
            if (t < 0.0) {
              alpha -= t / (xray_cutoutRadius * xray_forwardPow);
            }
            alpha = mix(alpha, original_alpha, vertical_mask);
            alpha = clamp(alpha, xray_alphaMin * original_alpha, original_alpha);
          }
          ${discardLine}
        }
      `,
    };
  }
}

export class AtlasSamplingPlugin extends BABYLON.MaterialPluginBase {
  private atlasTextureArray: BABYLON.RawTexture2DArray | null = null;

  constructor(material: BABYLON.Material, sourceTexture: BABYLON.Texture) {
    super(material, "AtlasSampling", 200, { NOA_TWOD_ARRAY_TEXTURE: false });
    this._enable(true);
    sourceTexture.onLoadObservable.add((tex) => this.setTextureArrayData(tex));
  }

  private setTextureArrayData(texture: BABYLON.Texture): void {
    const { width, height } = texture.getSize();
    const numLayers = Math.round(height / width);
    const data = (texture as unknown as { _readPixelsSync(): Uint8Array })._readPixelsSync();
    this.atlasTextureArray = new BABYLON.RawTexture2DArray(
      data,
      width,
      width,
      numLayers,
      BABYLON.Engine.TEXTUREFORMAT_RGBA,
      texture.getScene()!,
      true,
      false,
      BABYLON.Texture.NEAREST_SAMPLINGMODE,
    );
  }

  getClassName(): string {
    return "AtlasSamplingPlugin";
  }

  getSamplers(samplers: string[]): void {
    samplers.push("atlasTexture");
  }

  getAttributes(attributes: string[]): void {
    attributes.push("texAtlasIndices");
  }

  getUniforms() {
    return { ubo: [] };
  }

  bindForSubMesh(uniformBuffer: BABYLON.UniformBuffer): void {
    if (this.atlasTextureArray) {
      uniformBuffer.setTexture("atlasTexture", this.atlasTextureArray);
    }
  }

  prepareDefines(defines: Record<string, boolean>): void {
    defines["NOA_TWOD_ARRAY_TEXTURE"] = true;
  }

  getCustomCode(shaderType: "vertex" | "fragment"): Record<string, string> {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
          uniform highp sampler2DArray atlasTexture;
          attribute float texAtlasIndices;
          varying float texAtlasIndex;
        `,
        CUSTOM_VERTEX_MAIN_BEGIN: `texAtlasIndex = texAtlasIndices;`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        uniform highp sampler2DArray atlasTexture;
        varying float texAtlasIndex;
      `,
      "!baseColor\\=texture2D\\(diffuseSampler,vDiffuseUV\\+uvOffset\\);": `baseColor = texture(atlasTexture, vec3(vDiffuseUV, texAtlasIndex));`,
    };
  }
}

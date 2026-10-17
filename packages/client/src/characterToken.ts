// A character's 3D billboard: name + HP/MP bars + a status-effect icon row
// above them, always facing the camera. MVP goal items 1-2 (docs/ROADMAP.md)
// -- genuinely new, confirmed against the old game's own code: its NPC
// dialog system (NPCs/npc_dialog_system.gd) is a proximity-triggered
// Sprite3D showing DIALOG TEXT, not an always-visible HP/MP+status billboard
// (that was only ever a commented-out, never-wired stub -- "saving this as
// commented for hp above head maybe", NPCs/evil_blob_ai.gd). This is a
// PLAYER-character token, not a port of that NPC system.
//
// Uses noa's own `mesh` ECS component for positioning (same mechanism
// net.ts's remote-player boxes and playerBodyMesh.ts's local body already
// rely on) -- this module only builds/updates the billboard mesh + its GUI
// content; net.ts attaches it to an entity and repositions it per tick the
// same way it already does for the box mesh.
//
// Real constraint found live, confirmed directly in source, not guessed:
// AdvancedDynamicTexture's own built-in hover/click detection (its
// attachToMesh) depends entirely on Babylon's automatic per-pointer-move
// scene picking (`scene.onPointerObservable`'s auto-computed pickInfo) --
// but noa's own Rendering constructor unconditionally sets
// `scene.skipPointerMovePicking = true` (a real perf necessity for a
// voxel game: a full-scene raycast against every chunk mesh on every
// mouse-move would be disastrous), which makes the ADT's own pointer
// system permanently see an empty, never-hit PickingInfo on every move.
// So HP/MP-bar hit-testing here is geometric instead, in the token's own
// LOCAL plane space (hitTestLocalPoint below) -- net.ts drives it from
// the SAME camera-center ray tokenPicking.ts already uses for "which
// token," transforming the ray's world-space hit point into this plane's
// local space via its own (invertible) world matrix. This also means
// HP/MP-bar interaction uses the exact same crosshair-based model as
// every other interaction in this game (block targeting, token picking
// itself) rather than real mouse position, which is more consistent, not
// a compromise.

import * as BABYLON from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";

export interface StatusEffectData {
  icon: string;
  label: string;
}

export interface CharacterTokenData {
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  statusEffects: StatusEffectData[];
}

const TEXTURE_WIDTH = 256;
const STATUS_ICON_SIZE = 32;
const BAR_HEIGHT = 20;
const BAR_WIDTH = 220;
const BAR_LEFT = (TEXTURE_WIDTH - BAR_WIDTH) / 2;
const HP_BAR_TOP = STATUS_ICON_SIZE + 24;
const MP_BAR_TOP = HP_BAR_TOP + BAR_HEIGHT + 4;
/**
 * Real feedback from a live screenshot: the billboard appeared to float
 * well above the character, with a big gap between the player and the
 * visible bars. Root cause, confirmed via the SAME debug log used to
 * verify the raycast math (which turned out to be exactly correct) --
 * the texture/plane used to be a full 256x256 SQUARE, but the actual
 * content (status row + name + 2 bars) only ever occupied its TOP ~40%;
 * the rest was blank, transparent texture that still took up real
 * physical space on the plane. net.ts's "clear the player's head"
 * vertical-offset math correctly cleared the PLANE's own geometric
 * bottom edge, but that edge sat far below the actually-visible content,
 * which is what "floats too high" really meant. Fixed at the root: size
 * the texture/plane to the content's real extent (CONTENT_HEIGHT) instead
 * of an arbitrary square, with a small bottom margin -- not another
 * magic clearance number layered on top of the real problem.
 */
const CONTENT_BOTTOM_MARGIN = 8;
const TEXTURE_HEIGHT = MP_BAR_TOP + BAR_HEIGHT + CONTENT_BOTTOM_MARGIN;
/** The plane's own world-unit width (createCharacterToken's CreatePlane call below). Exported so net.ts could reference it if it ever needs the horizontal extent; the vertical one (TOKEN_PLANE_HEIGHT, derived to preserve the texture's aspect ratio so content is never stretched) is what the vertical-offset math actually needs. */
export const TOKEN_PLANE_WIDTH = 1.5;
export const TOKEN_PLANE_HEIGHT = (TOKEN_PLANE_WIDTH * TEXTURE_HEIGHT) / TEXTURE_WIDTH;

interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Converts a pixel-space rect (texture coordinates, Y-down, origin top-left) into the plane's own LOCAL space (world units, Y-up, origin center) -- see this file's header for why this geometric approach replaces AdvancedDynamicTexture's own (structurally broken, in this project) pointer-hover system. */
function pixelRectToLocal(rect: PixelRect): { minX: number; minY: number; maxX: number; maxY: number } {
  const toLocalX = (px: number) => (px / TEXTURE_WIDTH - 0.5) * TOKEN_PLANE_WIDTH;
  const toLocalY = (py: number) => (0.5 - py / TEXTURE_HEIGHT) * TOKEN_PLANE_HEIGHT; // Y flips: pixel-space grows downward, local plane space grows upward
  return { minX: toLocalX(rect.left), maxX: toLocalX(rect.right), minY: toLocalY(rect.bottom), maxY: toLocalY(rect.top) };
}

export type HoveredBar = "hp" | "mp";

export interface CharacterToken {
  mesh: BABYLON.Mesh;
  /** Exposed mainly for test introspection -- production callers otherwise only need `mesh`/`update`/`hitTestLocalPoint`/`dispose`. */
  texture: GUI.AdvancedDynamicTexture;
  update(data: CharacterTokenData): void;
  /** Geometric hit-test against the HP/MP bars, given a point already in this token's own LOCAL space (see this file's header -- net.ts does the world-to-local transform via `mesh.getWorldMatrix()`). Returns which bar (if any) contains the point. */
  hitTestLocalPoint(localX: number, localY: number): HoveredBar | undefined;
  /** Real request: the bar itself should show SOME feedback when it's the one under the cursor (a border highlight), same spirit as the token/body-box outline for the coarser "is this token owned/interactable" hover. Pass undefined to clear. */
  setHoveredBar(bar: HoveredBar | undefined): void;
  dispose(): void;
}

/** Builds one billboard plane + its GUI content for a single character token. Mounted via noa's `mesh` ECS component by the caller (net.ts) -- this function is noa-free, just Babylon. */
export function createCharacterToken(scene: BABYLON.Scene, name: string): CharacterToken {
  const plane = BABYLON.MeshBuilder.CreatePlane(`token-${name}`, { width: TOKEN_PLANE_WIDTH, height: TOKEN_PLANE_HEIGHT }, scene);
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
  // Stays pickable (the default): AdvancedDynamicTexture's own hover/click
  // detection (its attachToMesh below) relies on scene.onPointerObservable's
  // real-mouse-position pick against THIS mesh to find which GUI control is
  // under the cursor -- an unpickable mesh would silently break the HP/MP-
  // bar hover/click feature entirely. tokenPicking.ts's coarser "which
  // token" pick (a separate scene.pickWithRay call from the camera center,
  // not the real mouse position) targets this SAME mesh with no conflict --
  // two independent pick mechanisms for two different input models (real
  // mouse position while pointer is unlocked vs. a center-screen ray while
  // pointer-locked).

  const texture = GUI.AdvancedDynamicTexture.CreateForMesh(plane, TEXTURE_WIDTH, TEXTURE_HEIGHT, false);

  // Real root cause, confirmed directly in @babylonjs/gui's own source
  // (Control's constructor defaults both _horizontalAlignment and
  // _verticalAlignment to CENTER): every control added to the texture's
  // root container is centered by default, with `top`/`left` acting as
  // offsets FROM that centered position -- NOT from the top-left corner,
  // which is what this file's pixel<->local-space math (HP_BAR_TOP,
  // BAR_LEFT, pixelRectToLocal, ...) always assumed. This was the actual
  // source of every "the bars are in the wrong place" report in this
  // investigation -- not the raycast math (verified correct), not the
  // plane sizing (a real, separate issue, but not this one). Forcing
  // TOP/LEFT alignment on every control positioned via `top`/`left` below
  // makes those values real top-left pixel offsets, matching what the
  // layout math has been assuming the whole time.
  const statusRow = new GUI.StackPanel();
  statusRow.isVertical = false;
  statusRow.height = `${STATUS_ICON_SIZE}px`;
  statusRow.top = "0px";
  statusRow.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  statusRow.isVisible = false;
  texture.addControl(statusRow);

  const nameLabel = new GUI.TextBlock("name", name);
  nameLabel.color = "white";
  nameLabel.fontSize = 18;
  nameLabel.height = "22px";
  nameLabel.top = `${STATUS_ICON_SIZE}px`;
  nameLabel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  texture.addControl(nameLabel);

  function makeBar(topOffset: number, fillColor: string) {
    const background = new GUI.Rectangle();
    background.width = `${BAR_WIDTH}px`;
    background.height = `${BAR_HEIGHT}px`;
    background.top = `${topOffset}px`;
    background.left = `${BAR_LEFT}px`;
    background.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    background.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
    background.background = "#222";
    background.thickness = 1;
    background.color = "#000";
    texture.addControl(background);

    const fill = new GUI.Rectangle();
    fill.height = `${BAR_HEIGHT}px`;
    fill.background = fillColor;
    fill.thickness = 0;
    fill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    background.addControl(fill);

    const label = new GUI.TextBlock();
    label.color = "white";
    label.fontSize = 13;
    background.addControl(label);

    return { background, fill, label };
  }

  const hpBar = makeBar(HP_BAR_TOP, "#c0392b");
  const mpBar = makeBar(MP_BAR_TOP, "#2980b9");
  const hpRectLocal = pixelRectToLocal({ left: BAR_LEFT, top: HP_BAR_TOP, right: BAR_LEFT + BAR_WIDTH, bottom: HP_BAR_TOP + BAR_HEIGHT });
  const mpRectLocal = pixelRectToLocal({ left: BAR_LEFT, top: MP_BAR_TOP, right: BAR_LEFT + BAR_WIDTH, bottom: MP_BAR_TOP + BAR_HEIGHT });

  function setBarFill(bar: typeof hpBar, value: number, max: number): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    bar.fill.width = `${220 * ratio}px`;
    bar.label.text = `${value}/${max}`;
  }

  function update(data: CharacterTokenData): void {
    nameLabel.text = data.name;
    setBarFill(hpBar, data.hp, data.maxHp);
    setBarFill(mpBar, data.mp, data.maxMp);

    statusRow.clearControls();
    statusRow.isVisible = data.statusEffects.length > 0;
    for (const effect of data.statusEffects) {
      const icon = new GUI.Rectangle();
      icon.width = `${STATUS_ICON_SIZE}px`;
      icon.height = `${STATUS_ICON_SIZE}px`;
      icon.background = "#444";
      icon.thickness = 0;

      const label = new GUI.TextBlock();
      label.text = effect.label.slice(0, 1).toUpperCase();
      label.color = "white";
      icon.addControl(label);

      statusRow.addControl(icon);
    }
  }

  update({ name, hp: 0, maxHp: 0, mp: 0, maxMp: 0, statusEffects: [] });

  function hitTestLocalPoint(localX: number, localY: number): HoveredBar | undefined {
    if (localX >= hpRectLocal.minX && localX <= hpRectLocal.maxX && localY >= hpRectLocal.minY && localY <= hpRectLocal.maxY) return "hp";
    if (localX >= mpRectLocal.minX && localX <= mpRectLocal.maxX && localY >= mpRectLocal.minY && localY <= mpRectLocal.maxY) return "mp";
    return undefined;
  }

  const BAR_BORDER_DEFAULT = "#000";
  const BAR_BORDER_HOVERED = "#ffd933"; // same gold the token/body-box outline uses (net.ts's HIGHLIGHT_OUTLINE_COLOR), for one consistent "this is interactable" color across both hover tiers

  function setHoveredBar(bar: HoveredBar | undefined): void {
    hpBar.background.thickness = bar === "hp" ? 3 : 1;
    hpBar.background.color = bar === "hp" ? BAR_BORDER_HOVERED : BAR_BORDER_DEFAULT;
    mpBar.background.thickness = bar === "mp" ? 3 : 1;
    mpBar.background.color = bar === "mp" ? BAR_BORDER_HOVERED : BAR_BORDER_DEFAULT;
  }

  return {
    mesh: plane,
    texture,
    update,
    hitTestLocalPoint,
    setHoveredBar,
    dispose() {
      texture.dispose();
      plane.dispose();
    },
  };
}

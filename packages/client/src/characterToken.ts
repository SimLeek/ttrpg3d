// A character's 3D billboard: name + configurable fill bars + a
// status-effect icon row above them, always facing the camera. MVP goal
// items 1-2 (docs/ROADMAP.md) -- genuinely new, confirmed against the old
// game's own code: its NPC dialog system (NPCs/npc_dialog_system.gd) is a
// proximity-triggered Sprite3D showing DIALOG TEXT, not an always-visible
// HP/MP+status billboard (that was only ever a commented-out, never-wired
// stub -- "saving this as commented for hp above head maybe",
// NPCs/evil_blob_ai.gd). This is a PLAYER-character token, not a port of
// that NPC system.
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
// So bar hit-testing here is geometric instead, in the token's own
// LOCAL plane space (hitTestLocalPoint below) -- net.ts drives it from
// the SAME camera-center ray tokenPicking.ts already uses for "which
// token," transforming the ray's world-space hit point into this plane's
// local space via its own (invertible) world matrix. This also means
// bar interaction uses the exact same crosshair-based model as every
// other interaction in this game (block targeting, token picking itself)
// rather than real mouse position, which is more consistent, not a
// compromise.
//
// Round 2 real correction (docs/ROADMAP.md item 4 follow-up): bars used
// to be a hardcoded HP/MP pair, each with its own fixed color baked in
// at creation. "They used to be hp and mp, but those are optional now
// ... n bars of whatever color." Bars are now whatever the character's
// sheet configures (CharacterSheetBarDef -> shared's resolveCharacterBars,
// synced via WorldState.ts's PlayerState.bars) -- any xOfY variable, any
// color, any count. The billboard reserves a FIXED number of bar slots
// (MAX_DISPLAYED_BARS) at creation and simply hides the unused ones
// (`isVisible = false`) rather than resizing the plane/texture on every
// bar-count change -- same "reserve space, toggle visibility" precedent
// the status-icon row above already uses one tier up. A real dynamic-
// height billboard would also have to make net.ts's token vertical-offset
// math (which assumes TOKEN_PLANE_HEIGHT is a fixed constant) recompute
// per-token, which is real, separate complexity not worth it yet for "not
// too complicated" scope -- revisit if 4 bars turns out to be the wrong
// cap during playtesting.

import * as BABYLON from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";

export interface StatusEffectData {
  icon: string;
  label: string;
}

export interface CharacterTokenBarData {
  variableId: string;
  label: string;
  value: number;
  max: number;
  color: [number, number, number];
}

export interface CharacterTokenData {
  name: string;
  /** Whatever the character's sheet currently configures -- see this file's header. Capped at MAX_DISPLAYED_BARS; extras are silently not shown, not an error. */
  bars: CharacterTokenBarData[];
  statusEffects: StatusEffectData[];
}

/** Fixed billboard capacity -- see this file's header for why this is a hard cap, not a dynamically-resized plane. */
const MAX_DISPLAYED_BARS = 4;

const TEXTURE_WIDTH = 256;
const STATUS_ICON_SIZE = 32;
const BAR_HEIGHT = 20;
const BAR_WIDTH = 220;
const BAR_LEFT = (TEXTURE_WIDTH - BAR_WIDTH) / 2;
const BAR_TOP_BASE = STATUS_ICON_SIZE + 24;
const BAR_STEP = BAR_HEIGHT + 4;
/**
 * Real feedback from a live screenshot: the billboard appeared to float
 * well above the character, with a big gap between the player and the
 * visible bars. Root cause, confirmed via the SAME debug log used to
 * verify the raycast math (which turned out to be exactly correct) --
 * the texture/plane used to be a full 256x256 SQUARE, but the actual
 * content (status row + name + bars) only ever occupied its TOP portion;
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
const TEXTURE_HEIGHT = BAR_TOP_BASE + (MAX_DISPLAYED_BARS - 1) * BAR_STEP + BAR_HEIGHT + CONTENT_BOTTOM_MARGIN;
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

function colorToHex([r, g, b]: [number, number, number]): string {
  const toHex = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** The bar's own variableId when the slot is currently showing one, undefined when hidden (no configured bar occupies that slot right now). */
export type HoveredBar = string | undefined;

export interface CharacterToken {
  mesh: BABYLON.Mesh;
  /** Exposed mainly for test introspection -- production callers otherwise only need `mesh`/`update`/`hitTestLocalPoint`/`dispose`. */
  texture: GUI.AdvancedDynamicTexture;
  update(data: CharacterTokenData): void;
  /** Geometric hit-test against the currently-visible bars, given a point already in this token's own LOCAL space (see this file's header -- net.ts does the world-to-local transform via `mesh.getWorldMatrix()`). Returns the hit bar's variableId, if any. */
  hitTestLocalPoint(localX: number, localY: number): HoveredBar;
  /** Real request: the bar itself should show SOME feedback when it's the one under the cursor (a border highlight), same spirit as the token/body-box outline for the coarser "is this token owned/interactable" hover. Pass undefined to clear. */
  setHoveredBar(variableId: HoveredBar): void;
  dispose(): void;
}

/** Builds one billboard plane + its GUI content for a single character token. Mounted via noa's `mesh` ECS component by the caller (net.ts) -- this function is noa-free, just Babylon. */
export function createCharacterToken(scene: BABYLON.Scene, name: string): CharacterToken {
  const plane = BABYLON.MeshBuilder.CreatePlane(`token-${name}`, { width: TOKEN_PLANE_WIDTH, height: TOKEN_PLANE_HEIGHT }, scene);
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
  // Stays pickable (the default): AdvancedDynamicTexture's own hover/click
  // detection (its attachToMesh below) relies on scene.onPointerObservable's
  // real-mouse-position pick against THIS mesh to find which GUI control is
  // under the cursor -- an unpickable mesh would silently break the bar
  // hover/click feature entirely. tokenPicking.ts's coarser "which
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
  // which is what this file's pixel<->local-space math (BAR_TOP_BASE,
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

  function makeBarSlot(topOffset: number) {
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
    fill.thickness = 0;
    fill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    background.addControl(fill);

    const label = new GUI.TextBlock();
    label.color = "white";
    label.fontSize = 13;
    background.addControl(label);

    return { background, fill, label };
  }

  const barSlots = Array.from({ length: MAX_DISPLAYED_BARS }, (_, i) => makeBarSlot(BAR_TOP_BASE + i * BAR_STEP));
  const barSlotRectsLocal = barSlots.map((_, i) => {
    const top = BAR_TOP_BASE + i * BAR_STEP;
    return pixelRectToLocal({ left: BAR_LEFT, top, right: BAR_LEFT + BAR_WIDTH, bottom: top + BAR_HEIGHT });
  });
  /** Which variableId each slot is CURRENTLY showing, kept in lockstep with the last `update()` call -- undefined for a hidden (unused) slot. */
  let currentBarIds: HoveredBar[] = barSlots.map(() => undefined);
  let hoveredBarId: HoveredBar;

  const BAR_BORDER_DEFAULT = "#000";
  const BAR_BORDER_HOVERED = "#ffd933"; // same gold the token/body-box outline uses (net.ts's HIGHLIGHT_OUTLINE_COLOR), for one consistent "this is interactable" color across both hover tiers

  function applyHoverHighlight(): void {
    barSlots.forEach((slot, i) => {
      const isHovered = hoveredBarId !== undefined && currentBarIds[i] === hoveredBarId;
      slot.background.thickness = isHovered ? 3 : 1;
      slot.background.color = isHovered ? BAR_BORDER_HOVERED : BAR_BORDER_DEFAULT;
    });
  }

  function setBarFill(slot: (typeof barSlots)[number], bar: CharacterTokenBarData): void {
    const ratio = bar.max > 0 ? Math.max(0, Math.min(1, bar.value / bar.max)) : 0;
    slot.fill.background = colorToHex(bar.color);
    slot.fill.width = `${BAR_WIDTH * ratio}px`;
    slot.label.text = `${bar.value}/${bar.max}`;
  }

  function update(data: CharacterTokenData): void {
    nameLabel.text = data.name;

    barSlots.forEach((slot, i) => {
      const bar = data.bars[i];
      slot.background.isVisible = bar !== undefined;
      currentBarIds[i] = bar?.variableId;
      if (bar) setBarFill(slot, bar);
    });
    applyHoverHighlight();

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

  update({ name, bars: [], statusEffects: [] });

  function hitTestLocalPoint(localX: number, localY: number): HoveredBar {
    for (let i = 0; i < barSlots.length; i++) {
      if (currentBarIds[i] === undefined) continue;
      const rect = barSlotRectsLocal[i];
      if (localX >= rect.minX && localX <= rect.maxX && localY >= rect.minY && localY <= rect.maxY) return currentBarIds[i];
    }
    return undefined;
  }

  function setHoveredBar(variableId: HoveredBar): void {
    hoveredBarId = variableId;
    applyHoverHighlight();
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

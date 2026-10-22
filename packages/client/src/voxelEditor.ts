// Place/break interaction. Breaking is unchanged from the original
// Phase-2 stub (always sets the targeted block to AIR, type-agnostic --
// matches the old game's del_vox_item.gd, which isn't equip-gated
// either). Placing now places whatever's equipped in the hotbar
// (hotbar.ts), not a hardcoded block type -- the Phase 4 extension this
// file was always scoped to become (see the old header comment this
// replaces).
//
// Binds noa's own default "fire"/"alt-fire" actions (left-click/right-
// click -- confirmed via game-inputs' source: DOM MouseEvent.button + 1,
// so button 0/left -> "Mouse1" -> "fire", button 2/right -> "Mouse3" ->
// "alt-fire") rather than adding new ones. noa.targetedBlock.position is
// the solid block being looked at (for breaking); .adjacent is the empty
// cell next to it along the hit normal (for placing) -- both read
// directly from noa's own block-targeting, not recomputed by hand. This
// is exactly the old game's voxel_interactor.gd's placement-position
// formula (hit voxel stepped back along the normal) -- noa already does
// that math internally, nothing to port there.
//
// Character-overlap guard (don't let the player place a block that would
// overlap their own collision box) is a direct port of
// voxel_interactor.gd's `_is_voxel_overlapping_character`, adapted to
// noa's own position-component shape (`.position` is the entity's
// bottom-center/feet anchor, `.width`/`.height` build the box upward and
// outward from there -- confirmed directly in noa's own
// updatePositionExtents) instead of Godot's CollisionShape3D lookup.

import type { Engine } from "noa-engine";
import { aabbsOverlap, type AABB, type Item } from "@ttrpg3d/shared";

const AIR = 0;

function playerAabb(noa: Engine): AABB {
  const state = noa.ents.getPositionData(noa.playerEntity) as { position: number[]; width: number; height: number };
  const [x, y, z] = state.position;
  const hw = state.width / 2;
  return { minX: x - hw, minY: y, minZ: z - hw, maxX: x + hw, maxY: y + state.height, maxZ: z + hw };
}

function blockAabb(x: number, y: number, z: number): AABB {
  return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
}

export interface TokenInteractionHooks {
  /**
   * Coarse mesh-level pick (tokenPicking.ts) -- answers "is the cursor
   * over a token, and do I own it" right now. Backs the right-click
   * context menu. `instanceId` (MVP goal item 4 follow-up, "multiple
   * instances of the same character... for monsters"): undefined for
   * the focused character, the specific placed instance's own id
   * otherwise -- callers need this to edit/delete the RIGHT one once
   * several instances can share a characterId.
   */
  pickOwnedToken: () => { characterId: string; instanceId?: string } | undefined;
  /** The GUI's own fine-grained hover state (characterToken.ts's hitTestLocalPoint) -- answers "is the cursor over an editable bar, and which variable does it point at" right now (bars are whatever the character's sheet configures, not a fixed hp/mp pair -- docs/ROADMAP.md item 4 follow-up). Backs left-click-to-edit. */
  pickHoveredStatBar: () => { characterId: string; instanceId?: string; variableId: string } | undefined;
  /** Opens characterContextMenu.ts at the given viewport coordinates for the picked character/instance. */
  openContextMenu: (characterId: string, instanceId: string | undefined, screenX: number, screenY: number) => void;
  /** Opens the HTML <input> overlay (net.ts) at the given viewport coordinates to edit one variable's current value. */
  openStatEditor: (characterId: string, instanceId: string | undefined, variableId: string, screenX: number, screenY: number) => void;
  /**
   * Real feedback, two related bugs found live: "if I right click
   * while in default mode, the context menu pops up instead of me
   * placing an item... some UI remains after used, like status effect
   * or token properties. Once the screen is left clicked in select
   * mode, all of those floating UIs should disappear if they're still
   * there, and should remain in select mode if there were any, but if
   * there were not any then it should move to default mode." Closes
   * any currently-open floating overlay (net.ts's stat-value/color/
   * status-effect editors, and the context menu) -- returns whether
   * anything WAS actually open, so the "fire" handler below knows
   * whether to stay in Select mode or drop back to Default.
   */
  closeFloatingUi: () => boolean;
}

export function installVoxelEditor(
  noa: Engine,
  getEquippedItem: () => Item | null,
  onEdit: (x: number, y: number, z: number, voxelId: number) => void,
  // GM admin-override escape hatch (core/mod-boundary plan): instant
  // build/delete bypasses the overlap guard while active -- a live check
  // (called per placement, not read once), matching gmOverride.ts's own
  // toggle semantics. Optional/defaulted so every existing call site (and
  // every test) that doesn't care about GM mode keeps working unchanged.
  isGmModeActive: () => boolean = () => false,
  // MVP goal items 1-2 (docs/ROADMAP.md): left-click (Mouse1/fire) on an
  // editable bar opens its value editor instead of breaking a block,
  // and right-click (Mouse3/alt-fire) on an owned token opens its context
  // menu instead of placing a block -- both confirmed as the SAME
  // bindings block-editing already uses, so both branch INSIDE the
  // existing handlers rather than adding competing listeners. Optional/
  // defaulted so every existing call site (and every test) that doesn't
  // care about tokens keeps working unchanged.
  tokenInteraction?: TokenInteractionHooks,
): void {
  // Pointer-locked play has no live clientX/clientY from noa's own input
  // state (just movement deltas) -- a real MouseEvent still reports
  // *some* coordinate even locked (wherever the cursor was when lock was
  // requested, typically center), so this just remembers the most recent
  // click's screen position for whichever overlay opens to use.
  //
  // Real bug found live ("these are all in the wrong location"): game-
  // inputs' own mousedown listener (on noa's container, confirmed in its
  // source -- closer to the canvas) is a BUBBLE-phase listener, same as
  // this one originally was, but attached on `document` (further up the
  // bubble path). Bubble-phase listeners fire inner-to-outer, so noa's
  // own listener -- and the synchronous "fire"/"alt-fire" emission it
  // triggers, which reads `lastClickScreen` -- ran BEFORE this listener
  // had a chance to update it with the CURRENT click's position. Every
  // overlay opened at the PREVIOUS click's position instead. Capture
  // phase fires top-down, before ANY bubble-phase listener anywhere in
  // the tree, which guarantees this runs first regardless of where
  // game-inputs attaches its own listener.
  let lastClickScreen = { x: 0, y: 0 };
  document.addEventListener(
    "mousedown",
    (event) => {
      lastClickScreen = { x: event.clientX, y: event.clientY };
    },
    { capture: true },
  );

  // Real bug found live: "if I right click while in default mode, the
  // context menu pops up instead of me placing an item. Those should
  // be off in default mode... Right clicking or left clicking in
  // default mode should add or remove blocks as usual, but that
  // should not happen in select or other modes." Before this fix,
  // fire/alt-fire ALWAYS checked for a token/bar under the cursor
  // first, regardless of mode -- harmless back when Default (pointer-
  // locked, crosshair-based) was the ONLY mode, but wrong now that
  // Select (modePanel.ts: free cursor) exists specifically FOR token/
  // UI interaction. `noa.container.hasPointerLock` is the real,
  // already-established mode signal (currentPickScreenPoint in net.ts
  // already branches on it) -- Default and Select are now a clean
  // either/or: block editing ONLY in Default, token/stat/floating-UI
  // interaction ONLY in Select, never both from the same click.
  noa.inputs.down.on("fire", () => {
    if (noa.container.hasPointerLock) {
      const tgt = noa.targetedBlock;
      if (!tgt) return;
      const [x, y, z] = tgt.position;
      noa.setBlock(AIR, x, y, z);
      onEdit(x, y, z, AIR);
      return;
    }

    const hoveredStat = tokenInteraction?.pickHoveredStatBar();
    if (hoveredStat) {
      tokenInteraction!.openStatEditor(hoveredStat.characterId, hoveredStat.instanceId, hoveredStat.variableId, lastClickScreen.x, lastClickScreen.y);
      return;
    }

    // Clicked on nothing in particular while in Select mode -- real
    // request: dismiss any leftover floating UI (status effects/token
    // properties/stat editor, or the context menu); stay in Select if
    // something WAS open, otherwise drop back to Default.
    const hadOpenUi = tokenInteraction?.closeFloatingUi() ?? false;
    if (!hadOpenUi) noa.container.setPointerLock(true);
  });

  noa.inputs.down.on("alt-fire", () => {
    if (noa.container.hasPointerLock) {
      const item = getEquippedItem();
      if (!item || item.kind !== "place-block") return; // nothing equipped, or a future non-block item kind with no placement behavior
      const tgt = noa.targetedBlock;
      if (!tgt) return;
      const [x, y, z] = tgt.adjacent;
      if (!isGmModeActive() && aabbsOverlap(blockAabb(x, y, z), playerAabb(noa))) return; // would overlap the player -- refuse, same as the old game (GM mode bypasses this, same as it bypasses terrain collision)
      noa.setBlock(item.voxelId, x, y, z);
      onEdit(x, y, z, item.voxelId);
      return;
    }

    const picked = tokenInteraction?.pickOwnedToken();
    if (picked) {
      tokenInteraction!.openContextMenu(picked.characterId, picked.instanceId, lastClickScreen.x, lastClickScreen.y);
    }
  });
}

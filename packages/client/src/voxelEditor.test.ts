import { describe, it, expect, vi } from "vitest";
import { installVoxelEditor, type TokenInteractionHooks, type MeasurementPlacementHooks } from "./voxelEditor.js";
import type { Engine } from "noa-engine";
import type { Item } from "@ttrpg3d/shared";

// Real feedback found live: "if I right click while in default mode,
// the context menu pops up instead of me placing an item... Right
// clicking or left clicking in default mode should add or remove
// blocks as usual, but that should not happen in select or other
// modes." This is the first real test for voxelEditor.ts (every other
// noa-coupled input module in this codebase -- respawnControl.ts,
// gmOverride.ts -- has none, verified by playtest only) -- the mode-
// gating logic here is pure conditional wiring around a few simple
// fakes (an EventEmitter-shaped `inputs.down`, a boolean
// `container.hasPointerLock`), cheap enough to actually unit-test, and
// this exact class of regression (block editing and token interaction
// bleeding into each other's mode) has now broken live TWICE -- worth
// locking down.

function fakeNoa(hasPointerLock: boolean, targetedBlock: { position: number[]; adjacent: number[] } | null) {
  const handlers = new Map<string, () => void>();
  const setBlock = vi.fn();
  const setPointerLock = vi.fn();
  const noa = {
    inputs: { down: { on: (name: string, cb: () => void) => handlers.set(name, cb) } },
    container: { hasPointerLock, setPointerLock },
    targetedBlock,
    setBlock,
    ents: { getPositionData: () => ({ position: [0, 0, 0], width: 0.6, height: 1.8 }) },
    playerEntity: 1,
  } as unknown as Engine;
  return {
    noa,
    setBlock,
    setPointerLock,
    fire: () => handlers.get("fire")!(),
    altFire: () => handlers.get("alt-fire")!(),
  };
}

function fakeTokenInteraction(overrides: Partial<TokenInteractionHooks> = {}) {
  return {
    pickOwnedToken: () => undefined,
    pickHoveredStatBar: () => undefined,
    openContextMenu: vi.fn(),
    openStatEditor: vi.fn(),
    closeFloatingUi: vi.fn(() => false),
    ...overrides,
  } as TokenInteractionHooks & { openStatEditor: ReturnType<typeof vi.fn>; openContextMenu: ReturnType<typeof vi.fn>; closeFloatingUi: ReturnType<typeof vi.fn> };
}

function fakeMeasurementPlacement(overrides: Partial<MeasurementPlacementHooks> = {}) {
  return {
    isMeasureModeActive: () => false,
    onPlacePoint: vi.fn(),
    pickObjectAtCursor: () => undefined,
    openContextMenu: vi.fn(),
    ...overrides,
  } as MeasurementPlacementHooks & { onPlacePoint: ReturnType<typeof vi.fn>; openContextMenu: ReturnType<typeof vi.fn> };
}

const PLACE_BLOCK_ITEM: Item = { kind: "place-block", voxelId: 5, name: "Test Block", color: [1, 1, 1] };

describe("installVoxelEditor's Default/Select mode gating (MVP goal items 1-2 follow-up, real bug found live twice)", () => {
  it("Default mode (pointer-locked): fire breaks the targeted block and never consults tokenInteraction at all", () => {
    const { noa, setBlock, fire } = fakeNoa(true, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const onEdit = vi.fn();
    const tokenInteraction = fakeTokenInteraction({ pickHoveredStatBar: vi.fn(() => ({ characterId: "c1", instanceId: "i1", variableId: "hp" })) });
    installVoxelEditor(noa, () => null, onEdit, undefined, tokenInteraction);

    fire();

    expect(setBlock).toHaveBeenCalledWith(0, 1, 2, 3);
    expect(onEdit).toHaveBeenCalledWith(1, 2, 3, 0);
    expect(tokenInteraction.pickHoveredStatBar).not.toHaveBeenCalled();
    expect(tokenInteraction.openStatEditor).not.toHaveBeenCalled();
  });

  it("Default mode: alt-fire places the equipped block and never consults tokenInteraction at all, even with an owned token 'at the crosshair'", () => {
    const { noa, setBlock, altFire } = fakeNoa(true, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const onEdit = vi.fn();
    const tokenInteraction = fakeTokenInteraction({ pickOwnedToken: vi.fn(() => ({ characterId: "c1", instanceId: "i1", isPiloted: true })) });
    installVoxelEditor(noa, () => PLACE_BLOCK_ITEM, onEdit, undefined, tokenInteraction);

    altFire();

    expect(setBlock).toHaveBeenCalledWith(5, 1, 3, 3);
    expect(onEdit).toHaveBeenCalledWith(1, 3, 3, 5);
    expect(tokenInteraction.pickOwnedToken).not.toHaveBeenCalled();
    expect(tokenInteraction.openContextMenu).not.toHaveBeenCalled();
  });

  it("Select mode (not pointer-locked): fire on a hovered stat bar opens its editor and never touches block editing", () => {
    const { noa, setBlock, fire } = fakeNoa(false, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const onEdit = vi.fn();
    const tokenInteraction = fakeTokenInteraction({ pickHoveredStatBar: () => ({ characterId: "c1", instanceId: "i1", variableId: "hp" }) });
    installVoxelEditor(noa, () => null, onEdit, undefined, tokenInteraction);

    fire();

    expect(tokenInteraction.openStatEditor).toHaveBeenCalledWith("c1", "i1", "hp", 0, 0);
    expect(setBlock).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("Select mode: alt-fire on an owned token opens its context menu and never touches block editing, even with a block equipped", () => {
    const { noa, setBlock, altFire } = fakeNoa(false, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const onEdit = vi.fn();
    const tokenInteraction = fakeTokenInteraction({ pickOwnedToken: () => ({ characterId: "c1", instanceId: "i1", isPiloted: false }) });
    installVoxelEditor(noa, () => PLACE_BLOCK_ITEM, onEdit, undefined, tokenInteraction);

    altFire();

    expect(tokenInteraction.openContextMenu).toHaveBeenCalledWith("c1", "i1", false, 0, 0);
    expect(setBlock).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("Select mode: alt-fire on nothing owned is a no-op -- no block placement, no context menu (real request: block editing 'should not happen in select or other modes')", () => {
    const { noa, setBlock, altFire } = fakeNoa(false, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const tokenInteraction = fakeTokenInteraction();
    installVoxelEditor(noa, () => PLACE_BLOCK_ITEM, vi.fn(), undefined, tokenInteraction);

    altFire();

    expect(setBlock).not.toHaveBeenCalled();
    expect(tokenInteraction.openContextMenu).not.toHaveBeenCalled();
  });

  it("Select mode: fire on nothing in particular closes any leftover floating UI and STAYS in Select mode when something WAS open -- real request: \"should remain in select mode if there were any\"", () => {
    const { noa, setPointerLock, fire } = fakeNoa(false, null);
    const tokenInteraction = fakeTokenInteraction({ closeFloatingUi: vi.fn(() => true) });
    installVoxelEditor(noa, () => null, vi.fn(), undefined, tokenInteraction);

    fire();

    expect(tokenInteraction.closeFloatingUi).toHaveBeenCalled();
    expect(setPointerLock).not.toHaveBeenCalled();
  });

  it("Select mode: fire on nothing in particular drops back to Default mode when NOTHING was open -- real request: \"if there were not any then it should move to default mode\"", () => {
    const { noa, setPointerLock, fire } = fakeNoa(false, null);
    const tokenInteraction = fakeTokenInteraction({ closeFloatingUi: vi.fn(() => false) });
    installVoxelEditor(noa, () => null, vi.fn(), undefined, tokenInteraction);

    fire();

    expect(tokenInteraction.closeFloatingUi).toHaveBeenCalled();
    expect(setPointerLock).toHaveBeenCalledWith(true);
  });

  it("Select mode: fire with no tokenInteraction at all is a safe no-op for block editing, and (nothing to have been 'open') drops back to Default mode same as the no-UI-open case above", () => {
    const { noa, setBlock, setPointerLock, fire } = fakeNoa(false, null);
    installVoxelEditor(noa, () => null, vi.fn());

    expect(() => fire()).not.toThrow();
    expect(setBlock).not.toHaveBeenCalled();
    expect(setPointerLock).toHaveBeenCalledWith(true);
  });
});

describe("installVoxelEditor's measurementPlacement hook (docs/BATTLE_SYSTEM.md's measurement shapes)", () => {
  it("fire places a measurement point instead of breaking a block, while a shape is actively being placed, even in Default (pointer-locked) mode", () => {
    const { noa, setBlock, fire } = fakeNoa(true, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const measurementPlacement = fakeMeasurementPlacement({ isMeasureModeActive: () => true });
    installVoxelEditor(noa, () => null, vi.fn(), undefined, undefined, measurementPlacement);

    fire();

    expect(measurementPlacement.onPlacePoint).toHaveBeenCalledOnce();
    expect(setBlock).not.toHaveBeenCalled();
  });

  it("fire falls through to normal block-editing once nothing is being placed", () => {
    const { noa, setBlock, fire } = fakeNoa(true, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const measurementPlacement = fakeMeasurementPlacement({ isMeasureModeActive: () => false });
    installVoxelEditor(noa, () => null, vi.fn(), undefined, undefined, measurementPlacement);

    fire();

    expect(measurementPlacement.onPlacePoint).not.toHaveBeenCalled();
    expect(setBlock).toHaveBeenCalledWith(0, 1, 2, 3);
  });

  it("alt-fire opens a measurement object's own context menu instead of normal alt-fire behavior, checked regardless of placement state or mode", () => {
    const { noa, setBlock, altFire } = fakeNoa(true, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const measurementPlacement = fakeMeasurementPlacement({ pickObjectAtCursor: () => "shape-1" });
    installVoxelEditor(noa, () => PLACE_BLOCK_ITEM, vi.fn(), undefined, undefined, measurementPlacement);

    altFire();

    expect(measurementPlacement.openContextMenu).toHaveBeenCalledWith("shape-1", expect.any(Number), expect.any(Number));
    expect(setBlock).not.toHaveBeenCalled(); // normal alt-fire (block placement) never ran
  });

  it("alt-fire falls through to normal behavior when nothing is under the cursor", () => {
    const { noa, setBlock, altFire } = fakeNoa(true, { position: [1, 2, 3], adjacent: [1, 3, 3] });
    const measurementPlacement = fakeMeasurementPlacement({ pickObjectAtCursor: () => undefined });
    installVoxelEditor(noa, () => PLACE_BLOCK_ITEM, vi.fn(), undefined, undefined, measurementPlacement);

    altFire();

    expect(measurementPlacement.openContextMenu).not.toHaveBeenCalled();
    expect(setBlock).toHaveBeenCalledWith(5, 1, 3, 3);
  });
});

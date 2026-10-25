// docs/BATTLE_SYSTEM.md's "Measurement shapes" -- the 3D placement/
// rendering/keybind half (measurementPanel.ts is the UI shell;
// voxelEditor.ts's MeasurementPlacementHooks is how a world click
// reaches this file instead of block-editing/token-interaction).
//
// Real scoping decision (BATTLE_SYSTEM.md's own doc notes this):
// everything about a shape that's still being actively PLACED (the
// ghost preview, WASD/Tab point editing) is pure client-side state --
// nothing reaches the server until the shape is actually finalized (a
// chain via Enter, a fixed-point-count shape -- cube/sphere/cone/beam
// -- automatically the moment its last required point is placed).
// Only the finalized result is ever sent, via "placeMeasurementShape".

import * as BABYLON from "@babylonjs/core";
import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import { minkowskiDistance, type Point3 } from "@ttrpg3d/shared";
import type { PlayerController } from "./movement/PlayerController.js";
import { createDistanceLabel, type DistanceLabel } from "./distanceLabel.js";
import { tokenScaleFor } from "./playerBodyMesh.js";
import { isCapturedByOther, requestCapture, releaseCapture } from "./inputCapture.js";
import type { MeasurementShapeKind, SnapMode } from "./measurementPanel.js";

const SHAPE_COLOR = new BABYLON.Color3(0.3, 0.7, 1); // distinguishes a measurement object from the waypoint system's own yellow
const OBJECT_ALPHA = 0.45; // "rendered semi-transparent"
const DEFAULT_CONE_DEGREES = 60;
const DEFAULT_BEAM_WIDTH = 1;
/**
 * Real request, 2026-10-24: "Measure should be the distance button in
 * the mode panel. It should put you in measure mode, and you control
 * and tab through the points then, not the character, and the view/
 * camera remain in place while the wasd space shift are pressed and
 * while the mouse moves." Claims capture (freezes character movement
 * via PlayerController.ts's own `isCaptured() ? {} : noa.inputs.state`
 * check) and drops pointer-lock (freezes mouse-look, same as Select
 * mode's own cursor-free state) -- this module's OWN keydown handler
 * checks `isCapturedByOther` (not plain `isCaptured`), so claiming
 * this doesn't block its own WASD/Space/Shift/Tab point-editing, only
 * the character's.
 */
const MEASURE_MODE_CAPTURE_REASON = "measurementShapes";

/** chain has no fixed count (keeps growing until Enter finalizes it) -- every other shape finalizes itself the moment its last required point lands. */
export function requiredPointCount(kind: MeasurementShapeKind): number | undefined {
  return kind === "chain" ? undefined : 2;
}

/** Tab/Shift+Tab point cycling, wrapping at either end -- shared by every shape kind. */
export function cycleIndex(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return 0;
  return (current + direction + count) % count;
}

/** "Snap mode: center / corner / free." Center matches the existing waypoint system's own `snapToVoxelGridCenter`; corner is the same floor with no recenter; free passes the raw position through unsnapped. */
export function snapPoint(point: Point3, mode: SnapMode): Point3 {
  if (mode === "free") return point;
  const [x, y, z] = [Math.floor(point[0]), Math.floor(point[1]), Math.floor(point[2])];
  if (mode === "corner") return [x, y, z];
  return [x + 0.5, y + 0.5, z + 0.5];
}

/**
 * WASD point movement -- real correction, 2026-10-24: "there shouldn't
 * be a left right handedness issue since the wasd should be
 * controlling the point similar to a character instance just snapped
 * to voxel." NOT a separate direction-snapping scheme (the earlier
 * cardinal-only version this replaces) -- the EXACT SAME camera-
 * relative formula every real movement provider in this codebase
 * already uses (confirmed directly in MoverResource.ts/
 * SwimResource.ts/NoclipFlyProvider.ts, all three identical): rotate
 * the input vector by the camera's own heading. `inputX`: left(-1)/
 * right(+1). `inputY`: backward(-1)/forward(+1). Rounded to the
 * nearest whole step per axis (not left continuous) so a single key
 * press moves the point by exactly one voxel -- the "snapped to
 * voxel" half, layered on TOP of the same real direction math rather
 * than replacing it with a cardinal-only approximation.
 */
export function movementStep(inputX: number, inputY: number, headingRad: number): [number, number] {
  const sin = Math.sin(headingRad);
  const cos = Math.cos(headingRad);
  const dirX = inputX * cos + inputY * sin;
  const dirZ = -inputX * sin + inputY * cos;
  return [Math.round(dirX), Math.round(dirZ)];
}

/**
 * Billboard sizing's own shared AABB -- real request: "these should
 * all be using the same function to keep the code clean," fed each
 * shape's own axis-aligned bounding box. Exact for cube (the box IS
 * its own two corners) and sphere (center +/- radius); an honest
 * over-approximation for cone/beam (padded by the shape's own widest
 * radius in every axis, rather than computing the true AABB of an
 * arbitrarily-ROTATED cylinder/cone, which needs real per-rotation
 * geometry this feature doesn't otherwise need) -- fine for a
 * billboard's own rough size, not used for anything gameplay-exact.
 */
export function shapeAabb(kind: MeasurementShapeKind, points: Point3[], coneDegreesOrBeamWidth?: number): { width: number; height: number; depth: number } {
  if (kind === "cube") {
    const [a, b] = points;
    return { width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), depth: Math.abs(a[2] - b[2]) };
  }
  if (kind === "sphere") {
    const radius = minkowskiDistance(points[0], points[1], 2);
    return { width: radius * 2, height: radius * 2, depth: radius * 2 };
  }
  // cone/beam: pad the axis segment's own box by the widest radius.
  const [a, b] = points;
  const axisLength = minkowskiDistance(a, b, 2);
  const radius = kind === "beam" ? (coneDegreesOrBeamWidth ?? DEFAULT_BEAM_WIDTH) / 2 : axisLength * Math.tan(((coneDegreesOrBeamWidth ?? DEFAULT_CONE_DEGREES) * Math.PI) / 180 / 2);
  return {
    width: Math.abs(a[0] - b[0]) + radius * 2,
    height: Math.abs(a[1] - b[1]) + radius * 2,
    depth: Math.abs(a[2] - b[2]) + radius * 2,
  };
}

/**
 * The shared sizing function itself -- real request: one function,
 * called with a different box per shape. Real correction, 2026-10-24:
 * "should probably select the max largest axis, since I just made a
 * wide short box and it had a tiny billboard" -- feeds the AABB's
 * LARGEST axis (not just height) into the exact same tokenScaleFor a
 * character's own billboard uses. Applies to net.ts's own character
 * billboard sizing too now (max(bodyWidth, bodyHeight, bodyDepth)
 * instead of bodyHeight alone), same "including for the character"
 * correction -- tokenScaleFor itself is unchanged either way, just
 * what's fed into it.
 */
function billboardScaleFor(aabb: { width: number; height: number; depth: number }): number {
  return tokenScaleFor(Math.max(aabb.width, aabb.height, aabb.depth));
}

interface MeasurementPointLike {
  x: number;
  y: number;
  z: number;
}

export interface MeasurementShapeLike {
  shapeId: string;
  kind: string;
  ownerAccountId: string;
  points: Iterable<MeasurementPointLike>;
  broadcast: boolean;
  coneDegrees: number;
  isFrustum: boolean;
  beamWidth: number;
}

interface WorldStateLike {
  measurementShapes?: Iterable<MeasurementShapeLike>;
  ftPerVoxel?: number;
}

export interface MeasurementShapesController {
  /** The mode-panel's own "Distance" button -- real request: "It should put you in measure mode, and you control and tab through the points then, not the character, and the view/camera remain in place." */
  isMeasureModeActive(): boolean;
  setMeasureModeActive(enabled: boolean): void;
  activeKind(): MeasurementShapeKind | undefined;
  selectKind(kind: MeasurementShapeKind): void;
  snapMode(): SnapMode;
  setSnapMode(mode: SnapMode): void;
  broadcast(): boolean;
  setBroadcast(enabled: boolean): void;
  coneDegrees(): number;
  setConeDegrees(degrees: number): void;
  isFrustum(): boolean;
  setIsFrustum(enabled: boolean): void;
  beamWidth(): number;
  setBeamWidth(width: number): void;
  removeCurrentObject(): void;
  /**
   * The mode-panel's own "Look around" button -- real request,
   * 2026-10-24: "capturing the mouse can work but there should be a
   * special capture mouse button for that so the player can move the
   * camera." Re-acquires pointer-lock (camera mouse-look) WITHOUT
   * leaving Measure mode or releasing the movement-freeze capture --
   * exiting back to the free cursor happens via the browser's own
   * native Escape-exits-pointer-lock behavior, nothing bespoke needed.
   */
  requestLookAround(): void;
  /** Wired into voxelEditor.ts's installVoxelEditor as its `measurementPlacement` argument -- reuses isMeasureModeActive() above directly, since a click should never fall through to normal block-editing/token-interaction while Measure mode is on at all, picked shape or not. */
  onPlacePoint(): void;
  pickObjectAtCursor(): string | undefined;
  openContextMenu(shapeId: string, screenX: number, screenY: number): void;
  destroy(): void;
}

function ftPerVoxelLabel(voxelDistance: number, ftPerVoxel: number): string {
  return `${(voxelDistance * ftPerVoxel).toFixed(1)} ft`;
}

export function installMeasurementShapes(noa: Engine, room: Room, _playerController: PlayerController, accountId: string): MeasurementShapesController {
  const scene = noa.rendering.getScene();
  const material = new BABYLON.StandardMaterial("measurement-shape-mat", scene);
  material.diffuseColor = SHAPE_COLOR;
  material.emissiveColor = SHAPE_COLOR;
  material.alpha = OBJECT_ALPHA;
  material.specularColor = new BABYLON.Color3(0, 0, 0);
  material.backFaceCulling = false;

  const ghostMaterial = material.clone("measurement-ghost-mat");
  ghostMaterial.alpha = OBJECT_ALPHA * 0.6; // a touch more transparent than a finalized object, so a preview always reads as "not real yet"

  // Real request, 2026-10-24: "The selected point should change color
  // so I can tell." A bright, fully-opaque material reused for
  // whichever ghost point marker is currently selected (Tab/WASD
  // target) -- distinct from every other marker's own (semi-
  // transparent) shape-kind color.
  const selectedPointMaterial = new BABYLON.StandardMaterial("measurement-selected-point-mat", scene);
  selectedPointMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
  selectedPointMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
  selectedPointMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

  function state(): WorldStateLike | undefined {
    return room.state as WorldStateLike | undefined;
  }

  function ftPerVoxel(): number {
    return state()?.ftPerVoxel ?? 5;
  }

  let measureModeActive = false;

  // ---- In-progress placement (pure client state until finalized) ----
  let activeKind: MeasurementShapeKind | undefined;
  let activePoints: Point3[] = [];
  let selectedIndex = 0;
  let snapModeValue: SnapMode = "center";
  let broadcastValue = true;
  let coneDegreesValue = DEFAULT_CONE_DEGREES;
  let isFrustumValue = false;
  let beamWidthValue = DEFAULT_BEAM_WIDTH;
  /**
   * Real request, 2026-10-24: "if it's a 2 point object then holding
   * should continually set the second point, until release where
   * it's persisted as the measure object." True between the mousedown
   * that placed a fixed-point-count shape's FIRST point and the
   * mouseup that releases it -- every tick in between, point 2 tracks
   * the cursor's own live raycast target (see the tick loop below),
   * giving continuous visual feedback of the real shape as it's
   * dragged, same as dragging a rectangle in a paint program. Never
   * set for a chain -- each of its clicks is an independent, discrete
   * new point, no drag-continuation.
   */
  let isDraggingSecondPoint = false;

  function resetPlacement(): void {
    activeKind = undefined;
    activePoints = [];
    selectedIndex = 0;
    isDraggingSecondPoint = false;
  }

  function currentPickScreenPoint(): { x: number; y: number } {
    if (noa.container.hasPointerLock) {
      return { x: scene.getEngine().getRenderWidth() / 2, y: scene.getEngine().getRenderHeight() / 2 };
    }
    return lastMouseScreen;
  }

  let lastMouseScreen = { x: 0, y: 0 };
  document.addEventListener("mousemove", (event) => {
    lastMouseScreen = { x: event.clientX, y: event.clientY };
  });

  // Releases a fixed-point-count shape's own drag -- see
  // isDraggingSecondPoint's own doc. A raw DOM listener, same
  // precedent this file's own mousemove tracking above (and
  // voxelEditor.ts's own lastClickScreen) already set, since noa's
  // input system only exposes a discrete DOWN event ("fire"), not a
  // paired up/release one. Real correction, 2026-10-24: release no
  // longer finalizes by itself -- it just freezes point 2 wherever it
  // was let go, leaving both points open to further Tab/WASD
  // adjustment until Enter (shared with the chain's own finalize)
  // actually persists it.
  document.addEventListener("mouseup", () => {
    isDraggingSecondPoint = false;
  });

  /** Real correction, 2026-10-24 (same bug/fix characterPlacement.ts's own doc explains in full): `scene.createPickingRay`'s ray.origin is in noa's LOCAL (origin-shifted) frame, but `noa.pick()` expects GLOBAL and shifts it again internally -- converting back to global first avoids a silent double-shift. */
  function raycastTerrain(screenPoint: { x: number; y: number }): Point3 | undefined {
    const camera = scene.activeCamera;
    if (!camera) return undefined;
    const ray = scene.createPickingRay(screenPoint.x, screenPoint.y, BABYLON.Matrix.Identity(), camera);
    const pos = noa.localToGlobal([ray.origin.x, ray.origin.y, ray.origin.z], []) as [number, number, number];
    const dir = [ray.direction.x, ray.direction.y, ray.direction.z];
    const hit = noa.pick(pos, dir, 256);
    if (!hit) return undefined;
    // Real bug found live: "when I tried free [snap mode], instead of
    // placing the first dot it just dragged it to wherever the mouse
    // was, and that happened for all other shapes [too]." noa reuses
    // ONE mutable result object across every single pick() call (the
    // same gotcha this file's own earlier diagnostic-logging doc
    // already flagged for a different reason) -- `snapPoint`'s
    // center/corner branches both return a freshly built array, which
    // accidentally hid this by always copying the values out. "free"
    // returns its input completely unchanged, so every point stored
    // from a "free"-mode hit was secretly still pointing at noa's own
    // internal buffer -- any LATER pick() call (the next tick's own
    // drag update, or anything else that picks) kept mutating it out
    // from under already-placed points. A plain spread copy here
    // protects every caller uniformly, regardless of snap mode.
    const p = hit.position as unknown as Point3;
    return [p[0], p[1], p[2]];
  }

  function finalizeIfReady(): void {
    const required = requiredPointCount(activeKind!);
    if (required !== undefined && activePoints.length < required) return;
    room.send("placeMeasurementShape", {
      kind: activeKind,
      points: activePoints.map(([x, y, z]) => ({ x, y, z })),
      broadcast: broadcastValue,
      coneDegrees: coneDegreesValue,
      isFrustum: isFrustumValue,
      beamWidth: beamWidthValue,
    });
    resetPlacement();
  }

  // ---- Keybinds: WASD/Space/Shift move the selected point; Tab/Shift+Tab cycle selection; Enter finalizes ----
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if (isCapturedByOther(MEASURE_MODE_CAPTURE_REASON)) return;
    if (!activeKind || activePoints.length === 0) return;

    const point = activePoints[selectedIndex];

    if (event.code === "KeyW" || event.code === "KeyS" || event.code === "KeyA" || event.code === "KeyD") {
      const inputX = (event.code === "KeyD" ? 1 : 0) - (event.code === "KeyA" ? 1 : 0);
      const inputY = (event.code === "KeyW" ? 1 : 0) - (event.code === "KeyS" ? 1 : 0);
      const [dx, dz] = movementStep(inputX, inputY, noa.camera.heading);
      activePoints[selectedIndex] = snapPoint([point[0] + dx, point[1], point[2] + dz], snapModeValue);
    } else if (event.code === "Space") {
      activePoints[selectedIndex] = [point[0], point[1] + 1, point[2]];
    } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      activePoints[selectedIndex] = [point[0], point[1] - 1, point[2]];
    } else if (event.code === "Tab") {
      event.preventDefault(); // don't let it shift DOM focus away -- same guard focusCycling.ts's own Tab handler already applies
      selectedIndex = cycleIndex(activePoints.length, selectedIndex, event.shiftKey ? -1 : 1);
    } else if (event.code === "Enter") {
      // Real correction, 2026-10-24: finalizes ANY kind now, not just
      // a chain -- "when they're placed, I want to control the start
      // and end points with tabbing, wasd space shift," which means a
      // fixed-point-count shape also needs an explicit finalize step
      // instead of auto-persisting the instant its drag releases.
      // finalizeIfReady() itself still checks the required count, so
      // this is a harmless no-op for a fixed-point-count shape that
      // isn't fully placed yet.
      finalizeIfReady();
    }
  });

  // ---- 3D rendering: the in-progress ghost preview, plus every finalized shape this session can see ----
  interface ShapeVisuals {
    meshes: BABYLON.Mesh[];
    labels: DistanceLabel[];
    lastKey: string;
  }
  const visualsByShapeId = new Map<string, ShapeVisuals>();
  let ghostVisuals: ShapeVisuals | undefined;

  function disposeVisuals(visuals: ShapeVisuals): void {
    for (const mesh of visuals.meshes) mesh.dispose();
    for (const label of visuals.labels) label.dispose();
  }

  /**
   * Builds every mesh + billboard for one shape, finalized or still a
   * ghost preview -- the SAME builder either way, just a different
   * material/id prefix. `selectedIndex` only matters for a ghost
   * (`undefined` for a finalized shape, which has no "selected point"
   * concept any more).
   *
   * Real request, 2026-10-24: "no matter what the mode, clicking
   * should generate a sphere/point so it shows feedback" and "the
   * lack of ability to... tell if a point is placed make it hard to
   * test" -- a point marker now renders for EVERY kind (not just
   * chain), always, even before a 2-point shape has enough points to
   * build its own real geometry yet. The selected one (Tab/WASD
   * target) uses `selectedPointMaterial` (bright white) instead of the
   * shape's own color, so it's visually obvious which point keyboard
   * input currently affects.
   */
  function buildShapeVisuals(idPrefix: string, mat: BABYLON.Material, kind: MeasurementShapeKind, points: Point3[], coneDegrees: number, isFrustumFlag: boolean, beamWidth: number, pickable: boolean, selectedIndex?: number): ShapeVisuals {
    const meshes: BABYLON.Mesh[] = [];
    const labels: DistanceLabel[] = [];
    const ftPV = ftPerVoxel();

    function addLabelAt(pos: Point3, text: string, scale = 1): void {
      const label = createDistanceLabel(scene, text);
      label.mesh.position = new BABYLON.Vector3(...pos);
      label.mesh.scaling.setAll(scale);
      noa.rendering.addMeshToScene(label.mesh, false);
      labels.push(label);
    }

    points.forEach((p, i) => {
      const marker = BABYLON.MeshBuilder.CreateSphere(`${idPrefix}-pt-${i}`, { diameter: 0.3 }, scene);
      marker.position = new BABYLON.Vector3(...p);
      marker.material = i === selectedIndex ? selectedPointMaterial : mat;
      marker.isPickable = pickable;
      noa.rendering.addMeshToScene(marker, false);
      meshes.push(marker);
    });

    if (kind === "chain") {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const tube = BABYLON.MeshBuilder.CreateTube(`${idPrefix}-seg-${i}`, { path: [new BABYLON.Vector3(...a), new BABYLON.Vector3(...b)], radius: 0.08, cap: BABYLON.Mesh.CAP_ALL }, scene);
        tube.material = mat;
        tube.isPickable = pickable;
        noa.rendering.addMeshToScene(tube, false);
        meshes.push(tube);
        const mid: Point3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.3, (a[2] + b[2]) / 2];
        addLabelAt(mid, ftPerVoxelLabel(minkowskiDistance(a, b, 2), ftPV));
      }
    } else if (kind === "cube" && points.length === 2) {
      const [a, b] = points;
      const mid: Point3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const box = BABYLON.MeshBuilder.CreateBox(`${idPrefix}-cube`, { width: Math.abs(a[0] - b[0]) || 0.01, height: Math.abs(a[1] - b[1]) || 0.01, depth: Math.abs(a[2] - b[2]) || 0.01 }, scene);
      box.position = new BABYLON.Vector3(...mid);
      box.material = mat;
      box.isPickable = pickable;
      noa.rendering.addMeshToScene(box, false);
      meshes.push(box);
      const aabb = shapeAabb("cube", points);
      addLabelAt([mid[0], mid[1] + aabb.height / 2 + 0.3, mid[2]], ftPerVoxelLabel(minkowskiDistance(a, b, 2), ftPV), billboardScaleFor(aabb));
    } else if (kind === "sphere" && points.length === 2) {
      const [center, edge] = points;
      const radius = minkowskiDistance(center, edge, 2);
      const sphere = BABYLON.MeshBuilder.CreateSphere(`${idPrefix}-sphere`, { diameter: Math.max(radius, 0.05) * 2 }, scene);
      sphere.position = new BABYLON.Vector3(...center);
      sphere.material = mat;
      sphere.isPickable = pickable;
      noa.rendering.addMeshToScene(sphere, false);
      meshes.push(sphere);
      const aabb = shapeAabb("sphere", points);
      addLabelAt([center[0], center[1] + radius + 0.3, center[2]], `r=${ftPerVoxelLabel(radius, ftPV)}`, billboardScaleFor(aabb));
    } else if ((kind === "cone" || kind === "beam") && points.length === 2) {
      const [a, b] = points;
      const axisVec = new BABYLON.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const axisLength = axisVec.length() || 0.01;
      const halfAxis = axisVec.scale(0.5); // the REAL half-length offset -- computed before any normalize() below, which mutates its receiver in place in Babylon
      const mid = new BABYLON.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      // Real correction, 2026-10-24: "it's a cone/frustum from a
      // point and the frustum part would just be a rectangle/square
      // end instead of circular" -- BOTH kinds are a true point at
      // the near end (the end at point 'a', the FIRST point placed --
      // no separate near-cap radius at all); `isFrustum` only changes
      // the FAR end's (point 'b', "the wide flat part") own cross-
      // section shape -- round (a real cone) vs. a 4-sided square/
      // pyramid (a "frustum" in this feature's own terms).
      //
      // Real bug found live, confirmed directly against
      // cylinderBuilder.js: CreateCylinder puts `diameterTop` at its
      // OWN local +Y end -- and the rotation below aligns local +Y
      // with the real a->b direction, so `diameterTop` is what ends
      // up at 'b' (the far/wide end), and `diameterBottom` is what
      // ends up at 'a' (the near/point end) -- the OPPOSITE of what
      // the names alone suggest. The first version of this code
      // assigned 0 to `topDiameter` and the wide formula to
      // `bottomDiameter`, meaning the WIDE end rendered at 'a' and the
      // POINT rendered at 'b' -- exactly backwards ("the wide end is
      // at the character while the point is far away, which is the
      // opposite of what you want"). Swapped here to match "first
      // point start[s narrow], second part[is the] wide flat part."
      const topDiameter = kind === "beam" ? beamWidth : 2 * axisLength * Math.tan((coneDegrees * Math.PI) / 180 / 2);
      const bottomDiameter = kind === "beam" ? beamWidth : 0;
      const tessellation = kind === "beam" ? 16 : isFrustumFlag ? 4 : 24;
      const mesh = BABYLON.MeshBuilder.CreateCylinder(`${idPrefix}-${kind}`, { height: axisLength, diameterTop: topDiameter, diameterBottom: bottomDiameter, tessellation }, scene);
      mesh.position = mid;
      // Aligns the cylinder's default local +Y axis with the real a->b
      // direction -- the standard "rotation between two vectors"
      // quaternion, since CreateCylinder always builds along local Y.
      const up = BABYLON.Vector3.Up();
      const axisNormalized = axisVec.clone().normalize(); // clone first -- normalize() mutates in place, and axisVec's own un-normalized length is still needed below
      const dot = BABYLON.Vector3.Dot(up, axisNormalized);
      if (dot < 0.9999) {
        const rotAxis = dot < -0.9999 ? new BABYLON.Vector3(1, 0, 0) : BABYLON.Vector3.Cross(up, axisNormalized).normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        mesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(rotAxis, angle);
      }
      mesh.material = mat;
      mesh.isPickable = pickable;
      noa.rendering.addMeshToScene(mesh, false);
      meshes.push(mesh);
      if (kind === "beam") {
        addLabelAt([mid.x, mid.y + 0.3, mid.z], ftPerVoxelLabel(axisLength, ftPV)); // fixed/default size, same as the chain/waypoint billboards -- NOT the shared AABB-scale function (see this feature's own doc on why beam is excepted)
      } else {
        // Cone/frustum billboard goes above the mesh's own TOPMOST
        // vertex along the vertical axis, regardless of rotation --
        // NOT "the tip" or "the near cap" (see shapeAabb's own doc
        // and this feature's doc for why that framing is wrong once
        // the shape can be rotated). `mid.add(halfAxis)` is the 'b'
        // (far/wide) end -- which the diameter swap above puts
        // `topDiameter` at; `mid.subtract(halfAxis)` is the 'a'
        // (near/point) end, with `bottomDiameter` (always 0 here).
        const topCandidate1 = mid.add(halfAxis).y + topDiameter / 2;
        const topCandidate2 = mid.subtract(halfAxis).y + bottomDiameter / 2;
        const topY = Math.max(topCandidate1, topCandidate2);
        const aabb = shapeAabb("cone", points, coneDegrees);
        addLabelAt([mid.x, topY + 0.3, mid.z], ftPerVoxelLabel(axisLength, ftPV), billboardScaleFor(aabb));
      }
    }

    return { meshes, labels, lastKey: "" };
  }

  noa.on("tick", () => {
    const s = state();

    // Live-drag point 2 of a fixed-point-count shape -- see
    // isDraggingSecondPoint's own doc.
    if (isDraggingSecondPoint && activePoints.length === 2) {
      const hit = raycastTerrain(currentPickScreenPoint());
      if (hit) activePoints[1] = snapPoint(hit, snapModeValue);
    }

    // Ghost preview for the shape currently being placed.
    if (activeKind && activePoints.length > 0) {
      const key = JSON.stringify([activeKind, activePoints, selectedIndex, coneDegreesValue, isFrustumValue, beamWidthValue]);
      if (ghostVisuals?.lastKey !== key) {
        if (ghostVisuals) disposeVisuals(ghostVisuals);
        ghostVisuals = buildShapeVisuals("measurement-ghost", ghostMaterial, activeKind, activePoints, coneDegreesValue, isFrustumValue, beamWidthValue, false, selectedIndex);
        ghostVisuals.lastKey = key;
      }
    } else if (ghostVisuals) {
      disposeVisuals(ghostVisuals);
      ghostVisuals = undefined;
    }

    // Every finalized shape this session can see: its own (always),
    // or anyone's if `broadcast` is set -- see MeasurementShapeState's
    // own doc for why this filter is client-side, not server-enforced.
    const seen = new Set<string>();
    for (const shape of s?.measurementShapes ?? []) {
      if (!shape.broadcast && shape.ownerAccountId !== accountId) continue;
      seen.add(shape.shapeId);
      const points: Point3[] = Array.from(shape.points, (p) => [p.x, p.y, p.z] as Point3);
      const key = JSON.stringify([shape.kind, points, shape.coneDegrees, shape.isFrustum, shape.beamWidth, ftPerVoxel()]);
      const existing = visualsByShapeId.get(shape.shapeId);
      if (existing?.lastKey === key) continue;
      if (existing) disposeVisuals(existing);
      const fresh = buildShapeVisuals(`measurement-${shape.shapeId}`, material, shape.kind as MeasurementShapeKind, points, shape.coneDegrees, shape.isFrustum, shape.beamWidth, true);
      fresh.lastKey = key;
      visualsByShapeId.set(shape.shapeId, fresh);
    }
    for (const [shapeId, visuals] of visualsByShapeId) {
      if (!seen.has(shapeId)) {
        disposeVisuals(visuals);
        visualsByShapeId.delete(shapeId);
      }
    }
  });

  function setMeasureModeActive(enabled: boolean): void {
    if (enabled === measureModeActive) return;
    measureModeActive = enabled;
    if (enabled) {
      requestCapture(MEASURE_MODE_CAPTURE_REASON);
      noa.container.setPointerLock(false);
    } else {
      releaseCapture(MEASURE_MODE_CAPTURE_REASON);
      noa.container.setPointerLock(true);
      resetPlacement(); // discards whatever was still being placed -- nothing in-progress has been sent to the server yet
    }
  }

  return {
    isMeasureModeActive: () => measureModeActive,
    setMeasureModeActive,
    activeKind: () => activeKind,
    // Real correction, 2026-10-24: "they all seem to be working off of
    // the current and previous point, but really when I select a new
    // shape it should reset the points" -- this used to seed point 1
    // from the player's CURRENT position automatically, which is why
    // every shape looked like it "started from the character" instead
    // of waiting for a real first click. Selecting a shape type now
    // only clears any in-progress placement and picks the kind --
    // "the first click (on terrain OR a character instance...) places
    // the first point," same as every point after it, no exceptions.
    selectKind(kind: MeasurementShapeKind): void {
      resetPlacement();
      activeKind = kind;
      setMeasureModeActive(true); // picking a shape is how you start measuring -- real convenience, not asked for verbatim, but "Distance" alone (no shape yet) should also work on its own
    },
    snapMode: () => snapModeValue,
    setSnapMode(mode: SnapMode): void {
      snapModeValue = mode;
    },
    broadcast: () => broadcastValue,
    setBroadcast(enabled: boolean): void {
      broadcastValue = enabled;
    },
    coneDegrees: () => coneDegreesValue,
    setConeDegrees(degrees: number): void {
      coneDegreesValue = degrees;
    },
    isFrustum: () => isFrustumValue,
    setIsFrustum(enabled: boolean): void {
      isFrustumValue = enabled;
    },
    beamWidth: () => beamWidthValue,
    setBeamWidth(width: number): void {
      beamWidthValue = width;
    },
    removeCurrentObject(): void {
      const mine = Array.from(state()?.measurementShapes ?? []).find((s) => s.ownerAccountId === accountId);
      if (mine) room.send("deleteMeasurementShape", { shapeId: mine.shapeId });
    },
    requestLookAround(): void {
      noa.container.setPointerLock(true);
    },
    onPlacePoint(): void {
      if (!activeKind || isDraggingSecondPoint) return; // already mid-drag -- this mousedown is the SAME press, not a new one (see installVoxelEditor's own "fire" doc: one emission per press)
      const required = requiredPointCount(activeKind);
      // Real correction, 2026-10-24: "when they're placed, I want to
      // control the start and end points with tabbing, wasd space
      // shift" -- a fixed-point-count shape no longer auto-finalizes
      // the instant its last point lands (or, now, the instant its
      // drag releases); once it has its required point count, further
      // clicks are a no-op (not a 3rd point, not a re-finalize) --
      // Tab/WASD adjust EITHER point from here, and Enter (below,
      // shared with the chain's own finalize) actually persists it.
      if (required !== undefined && activePoints.length >= required) return;
      const hit = raycastTerrain(currentPickScreenPoint());
      if (!hit) return;
      const point = snapPoint(hit, snapModeValue);
      if (required !== undefined && activePoints.length === 0) {
        // A fixed-point-count shape's FIRST point starts the drag --
        // point 2 begins as a duplicate (degenerate until the cursor
        // actually moves) and live-tracks the cursor every tick until
        // mouseup (below) releases it.
        activePoints.push(point, [point[0], point[1], point[2]]); // two INDEPENDENT arrays, not the same reference twice -- see raycastTerrain's own doc on why a shared/stale reference is exactly the kind of bug that bit this file already
        selectedIndex = 1;
        isDraggingSecondPoint = true;
        return;
      }
      activePoints.push(point);
      selectedIndex = activePoints.length - 1;
    },
    pickObjectAtCursor(): string | undefined {
      const screenPoint = currentPickScreenPoint();
      const pickResult = scene.pick(screenPoint.x, screenPoint.y, (mesh) => mesh.name.startsWith("measurement-") && !mesh.name.startsWith("measurement-ghost"));
      if (!pickResult?.hit || !pickResult.pickedMesh) return undefined;
      for (const [shapeId] of visualsByShapeId) {
        if (pickResult.pickedMesh.name.includes(shapeId)) return shapeId;
      }
      return undefined;
    },
    openContextMenu(shapeId: string, screenX: number, screenY: number): void {
      const existing = document.getElementById("measurement-context-menu");
      existing?.remove();
      const menu = document.createElement("div");
      menu.id = "measurement-context-menu";
      menu.style.cssText = `position:fixed; left:${screenX}px; top:${screenY}px; background:rgba(20,20,24,0.95); border:1px solid rgba(200,200,200,0.4); border-radius:4px; font-family:system-ui,sans-serif; font-size:13px; color:#eee; z-index:1001;`;
      menu.innerHTML = `<button type="button" id="measurement-context-delete" style="display:block; width:100%; padding:6px 12px; background:none; border:none; color:#eee; cursor:pointer; text-align:left;">Delete</button>`;
      document.body.appendChild(menu);
      menu.querySelector("#measurement-context-delete")!.addEventListener("click", () => {
        room.send("deleteMeasurementShape", { shapeId });
        menu.remove();
      });
      const closeOnOutsideClick = (event: MouseEvent) => {
        if (!menu.contains(event.target as Node)) {
          menu.remove();
          document.removeEventListener("mousedown", closeOnOutsideClick, true);
        }
      };
      document.addEventListener("mousedown", closeOnOutsideClick, true);
    },
    destroy(): void {
      if (measureModeActive) releaseCapture(MEASURE_MODE_CAPTURE_REASON); // don't leak the capture claim past this module's own lifetime (e.g. a page/world switch mid-measure)
      if (ghostVisuals) disposeVisuals(ghostVisuals);
      for (const visuals of visualsByShapeId.values()) disposeVisuals(visuals);
      visualsByShapeId.clear();
      material.dispose();
      ghostMaterial.dispose();
      selectedPointMaterial.dispose();
    },
  };
}

// docs/BATTLE_SYSTEM.md's "Measurement shapes" -- the 3D placement/
// rendering/keybind half (measurementPanel.ts is the UI shell;
// voxelEditor.ts's MeasurementPlacementHooks is how a world click
// reaches this file instead of block-editing/token-interaction).
//
// Real correction, 2026-10-24: "there shouldn't really be a finalize,
// once a player makes a measurement that should be the current one
// and it should persist" -- there is no longer a separate "still
// being placed, nothing sent yet" phase. A shape is sent to the
// server (via "placeMeasurementShape") the moment it's first
// meaningful (a fixed-point-count shape's drag releasing; a chain
// gaining a 2nd point), and again on every later Tab/WASD edit --
// see persistCurrent()'s own doc. Entering Measure mode or picking a
// shape type is still pure client state until that first real point
// exists.

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
 * Real request, 2026-10-27: "a 'cube' option which is almost exactly
 * the same as the sphere, and starts with the first point in the
 * center, and the second point is the radius, and the other point
 * takes the max distance in any axis aligned dimension and makes that
 * the 'radius'." Unlike sphere's own radius (`minkowskiDistance` at
 * p=2, the real corner-to-corner distance), this is the Chebyshev/
 * max-norm distance -- deliberately NOT `minkowskiDistance(a, b,
 * Infinity)` (that function explicitly falls back to Euclidean for a
 * non-finite p, a different, unrelated real correction -- see
 * shared/distance.ts's own test for why).
 */
function cubeRadius(center: Point3, edge: Point3): number {
  return Math.max(Math.abs(center[0] - edge[0]), Math.abs(center[1] - edge[1]), Math.abs(center[2] - edge[2]));
}

function cross3(u: Point3, v: Point3): Point3 {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function normalize3(v: Point3): Point3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Real correction, 2026-10-24: "the end square rotates unexpectedly
 * ... it'd be best to just make that frustum axis aligned instead ...
 * a good way to deal with this would be for you to add a test that
 * receives the vertices of the frustum ... and tell that the top and
 * bottom lines of the frustum end square lay fully, so both points,
 * on a plane that has its normal as the up vector (so, the ground
 * plane), and that should always be the case." Replaces the earlier
 * attempt (aligning a generic rotated cylinder's own local frame to
 * the axis via a minimal-rotation quaternion, whose ROLL around the
 * axis is whatever a reference-vector cross product happens to
 * produce, with no guarantee it stays level) with a basis built
 * directly from world "up": `right = cross(worldUp, axis)` has a
 * ZERO Y-component for ANY axis direction -- a plain consequence of
 * crossing anything with a purely-vertical vector, not an
 * approximation -- so the two corners offset by `+right`/`-right` at
 * a FIXED `up2` sign share the exact same Y, and likewise for the
 * other sign: the square's own "top" edge and "bottom" edge are each
 * GUARANTEED to lie in a plane whose normal is the up vector, for
 * every axis direction, with the sole exception of the axis pointing
 * exactly straight up/down (where "yaw" around a vertical axis has
 * no defined meaning at all) -- handled explicitly below rather than
 * left to an unstable cross product. Returns the far (wide) end's
 * four corners as [topRight, topLeft, bottomLeft, bottomRight].
 */
export function frustumFarCorners(a: Point3, b: Point3, width: number): [Point3, Point3, Point3, Point3] {
  const axis: Point3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const axisNorm = normalize3(axis);
  let right = cross3([0, 1, 0], axisNorm);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0]; // axis is exactly vertical -- yaw is undefined, any horizontal vector works
  right = normalize3(right);
  const up2 = normalize3(cross3(axisNorm, right));
  const half = width / 2;
  const corner = (rightSign: number, up2Sign: number): Point3 => [
    b[0] + right[0] * half * rightSign + up2[0] * half * up2Sign,
    b[1] + right[1] * half * rightSign + up2[1] * half * up2Sign,
    b[2] + right[2] * half * rightSign + up2[2] * half * up2Sign,
  ];
  return [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
}

/**
 * Billboard sizing's own shared AABB -- real request: "these should
 * all be using the same function to keep the code clean," fed each
 * shape's own axis-aligned bounding box. Exact for box (the box IS
 * its own two corners), sphere (center +/- radius), and cube (center
 * +/- the same max-axis "radius" on every axis -- see `cubeRadius`
 * below); an honest over-approximation for cone/beam (padded by the
 * shape's own widest radius in every axis, rather than computing the
 * true AABB of an arbitrarily-ROTATED cylinder/cone, which needs real
 * per-rotation geometry this feature doesn't otherwise need) -- fine
 * for a billboard's own rough size, not used for anything gameplay-
 * exact.
 */
export function shapeAabb(kind: MeasurementShapeKind, points: Point3[], coneDegreesOrBeamWidth?: number): { width: number; height: number; depth: number } {
  if (kind === "box") {
    const [a, b] = points;
    return { width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), depth: Math.abs(a[2] - b[2]) };
  }
  if (kind === "sphere") {
    const radius = minkowskiDistance(points[0], points[1], 2);
    return { width: radius * 2, height: radius * 2, depth: radius * 2 };
  }
  if (kind === "cube") {
    const radius = cubeRadius(points[0], points[1]);
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
  billboardsThroughTerrain(): boolean;
  setBillboardsThroughTerrain(enabled: boolean): void;
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

/**
 * Real request, 2026-10-24: "there should also be an option so the
 * billboards draw over everything similar to the waypoint system,
 * just add a checkbox for it." Exact same two-part trick
 * waypoints.ts's own showThroughTerrain already uses and documents in
 * full (depth-function/no-depth-write for the alpha-blended label
 * material, PLUS a higher renderingGroupId so draw order is
 * guaranteed even against other opaque geometry in the same pass) --
 * duplicated here rather than imported since waypoints.ts keeps its
 * own copies private, same precedent this file's own billboard-
 * scaling helper already follows for anything not explicitly shared.
 * Only applied to the label mesh/material -- "the billboards," not
 * the shape geometry itself.
 */
function applyShowThroughTerrainToLabel(label: DistanceLabel, showThroughTerrain: boolean): void {
  label.mesh.renderingGroupId = showThroughTerrain ? 1 : 0;
  if (label.mesh.material) {
    label.mesh.material.disableDepthWrite = showThroughTerrain;
    label.mesh.material.depthFunction = showThroughTerrain ? BABYLON.Constants.ALWAYS : BABYLON.Constants.LEQUAL;
  }
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
  let billboardsThroughTerrainValue = false;

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
    if (!isDraggingSecondPoint) return;
    isDraggingSecondPoint = false;
    persistCurrent(); // real correction, 2026-10-24: see persistCurrent's own doc -- release is now the actual "make the measurement" moment, not just the end of the drag preview
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

  function lookAround(): void {
    noa.container.setPointerLock(true);
  }

  /**
   * Real correction, 2026-10-24: "there shouldn't really be a
   * finalize, once a player makes a measurement that should be the
   * current one and it should persist... the current drag and
   * measure and then tab and move around is good as the
   * instantaneously persisted version." Replaces the old Enter-gated
   * `finalizeIfReady` entirely -- sends the CURRENT point set to the
   * server the moment there's something meaningful to show (a fixed-
   * point-count shape's drag releasing; a chain gaining its 2nd+
   * point), and again on every later Tab/WASD edit, WITHOUT resetting
   * local state afterward -- `activeKind`/`activePoints` stay live so
   * the player keeps editing the SAME already-persisted object.
   * `placeMeasurementShape`'s own server-side handler already
   * replaces the sender's previous shape on every call (WorldRoom.ts:
   * "each session has one current measurement object at a time"), so
   * no shapeId needs to be tracked client-side to know what to
   * update -- every call here just re-describes the whole shape as it
   * now stands.
   */
  function persistCurrent(): void {
    if (!activeKind) return;
    const required = requiredPointCount(activeKind);
    const minimumMeaningfulPoints = activeKind === "chain" ? 2 : required ?? 1;
    if (activePoints.length < minimumMeaningfulPoints) return;
    room.send("placeMeasurementShape", {
      kind: activeKind,
      points: activePoints.map(([x, y, z]) => ({ x, y, z })),
      broadcast: broadcastValue,
      coneDegrees: coneDegreesValue,
      isFrustum: isFrustumValue,
      beamWidth: beamWidthValue,
    });
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
      persistCurrent();
    } else if (event.code === "Space") {
      activePoints[selectedIndex] = [point[0], point[1] + 1, point[2]];
      persistCurrent();
    } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      activePoints[selectedIndex] = [point[0], point[1] - 1, point[2]];
      persistCurrent();
    } else if (event.code === "Tab") {
      event.preventDefault(); // don't let it shift DOM focus away -- same guard focusCycling.ts's own Tab handler already applies
      selectedIndex = cycleIndex(activePoints.length, selectedIndex, event.shiftKey ? -1 : 1);
    } else if (event.code === "Enter") {
      // Real correction, 2026-10-24: Enter no longer finalizes anything
      // (see persistCurrent's own doc on why there's no finalize step
      // left to trigger) -- it's the "nice enter/esc combo" for camera
      // control instead, explicitly requested: "enter currently gives
      // cam control btw, I like it so I'd prefer to keep that."
      lookAround();
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

    function addLabelAt(pos: Point3, text: string, scale = 1, lines = 2): void {
      const label = createDistanceLabel(scene, text, lines);
      label.mesh.position = new BABYLON.Vector3(...pos);
      label.mesh.scaling.setAll(scale);
      noa.rendering.addMeshToScene(label.mesh, false);
      applyShowThroughTerrainToLabel(label, billboardsThroughTerrainValue);
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
      // Real request, 2026-10-24: "Chain should have the same D and T
      // that the waypoint system has" -- same two-line "D: {this
      // segment}\nT: {whole chain}" format waypoints.ts's own segment
      // labels already use, "T" being the SAME total for every
      // segment's label along the chain (the whole path's length),
      // not a running cumulative-so-far total.
      const segmentDistances = points.slice(0, -1).map((p, i) => minkowskiDistance(p, points[i + 1], 2));
      const totalDistance = segmentDistances.reduce((sum, d) => sum + d, 0);
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const tube = BABYLON.MeshBuilder.CreateTube(`${idPrefix}-seg-${i}`, { path: [new BABYLON.Vector3(...a), new BABYLON.Vector3(...b)], radius: 0.08, cap: BABYLON.Mesh.CAP_ALL }, scene);
        tube.material = mat;
        tube.isPickable = pickable;
        noa.rendering.addMeshToScene(tube, false);
        meshes.push(tube);
        const mid: Point3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.3, (a[2] + b[2]) / 2];
        addLabelAt(mid, `D: ${(segmentDistances[i] * ftPV).toFixed(1)}ft\nT: ${(totalDistance * ftPV).toFixed(1)}ft`);
      }
    } else if (kind === "box" && points.length === 2) {
      const [a, b] = points;
      const mid: Point3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const box = BABYLON.MeshBuilder.CreateBox(`${idPrefix}-box`, { width: Math.abs(a[0] - b[0]) || 0.01, height: Math.abs(a[1] - b[1]) || 0.01, depth: Math.abs(a[2] - b[2]) || 0.01 }, scene);
      box.position = new BABYLON.Vector3(...mid);
      box.material = mat;
      box.isPickable = pickable;
      noa.rendering.addMeshToScene(box, false);
      meshes.push(box);
      const aabb = shapeAabb("box", points);
      // Real request, 2026-10-24: "Cube [now Box] should have W, H,
      // and D all on different lines on top of each other" -- replaces
      // the single corner-to-corner diagonal distance with the box's
      // own three real axis extents, one per line (needs a 3rd line's
      // worth of vertical room -- see distanceLabel.ts's own `lines`
      // param).
      const boxText = `W: ${(aabb.width * ftPV).toFixed(1)}ft\nH: ${(aabb.height * ftPV).toFixed(1)}ft\nD: ${(aabb.depth * ftPV).toFixed(1)}ft`;
      addLabelAt([mid[0], mid[1] + aabb.height / 2 + 0.3, mid[2]], boxText, billboardScaleFor(aabb), 3);
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
    } else if (kind === "cube" && points.length === 2) {
      // Real request, 2026-10-27: "almost exactly the same as the
      // sphere" -- same center-then-radius-point input, but the
      // "radius" is the LARGEST single-axis distance (not the real
      // corner-to-corner distance), and the rendered shape is an
      // equal-sided BOX (width=height=depth=2*radius), not a sphere.
      const [center, edge] = points;
      const radius = cubeRadius(center, edge);
      const cube = BABYLON.MeshBuilder.CreateBox(`${idPrefix}-cube`, { size: Math.max(radius, 0.025) * 2 }, scene);
      cube.position = new BABYLON.Vector3(...center);
      cube.material = mat;
      cube.isPickable = pickable;
      noa.rendering.addMeshToScene(cube, false);
      meshes.push(cube);
      const aabb = shapeAabb("cube", points);
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

      let mesh: BABYLON.Mesh;
      let topY: number;
      if (kind === "cone" && isFrustumFlag) {
        // Real correction, 2026-10-24: a real mesh built directly from
        // `frustumFarCorners` (see its own doc) instead of a rotated,
        // tessellated CreateCylinder -- that approach could only ever
        // promise "a square cross-section," never WHICH way it faces,
        // since a generic "align local Y to the axis" quaternion's own
        // roll around that axis isn't tied to world "up" at all. This
        // mesh's far-face vertices are already in real WORLD
        // coordinates, so no position/rotation transform is needed --
        // the mesh's own local origin stays at the default identity.
        const [tr, tl, bl, br] = frustumFarCorners(a, b, topDiameter);
        const positions = [...a, ...tr, ...tl, ...bl, ...br];
        const indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 2, 3, 1, 3, 4]; // 4 side faces (apex=0 to each far edge) + 2 cap faces (the far square itself)
        const normals: number[] = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        const vertexData = new BABYLON.VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.normals = normals;
        mesh = new BABYLON.Mesh(`${idPrefix}-${kind}`, scene);
        vertexData.applyToMesh(mesh);
        topY = Math.max(a[1], tr[1], tl[1], bl[1], br[1]);
      } else {
        const tessellation = kind === "beam" ? 16 : 24;
        mesh = BABYLON.MeshBuilder.CreateCylinder(`${idPrefix}-${kind}`, { height: axisLength, diameterTop: topDiameter, diameterBottom: bottomDiameter, tessellation }, scene);
        // Real bug found live, 2026-10-24, confirmed directly against
        // noa-engine's own source (rendering.js's addMeshToScene):
        // `mesh.position = mid` (no clone!) made `mesh.position` and
        // this function's own `mid` variable the EXACT SAME Vector3
        // OBJECT. noa's addMeshToScene then does `mesh.position.
        // fromArray(globalToLocal(...))` -- an IN-PLACE mutation of
        // whatever Vector3 object `mesh.position` happens to be, to
        // convert it from the global coordinate this file set it to
        // into noa's local (origin-shifted) frame. Since `mid` was
        // THAT SAME object, this silently corrupted `mid` itself from
        // a real-world position into a local-shifted one, for every
        // later use of `mid` in this branch (both the label's own
        // position below AND, before this fix moved it earlier, the
        // topY calculation) -- a double-shift once combined with
        // addLabelAt's own separate addMeshToScene call for the label
        // mesh. Exactly why "I don't see any billboards at all on
        // cones or beams" -- and why it only shows up once a session
        // has moved far enough to trigger noa's own origin rebase
        // (`worldOriginOffset` starts at [0,0,0], where this bug
        // silently cancels itself out). Same bug CLASS this file
        // already hit twice before (noa's reused `_pickResult`,
        // Babylon's own in-place `normalize()`) -- clone before
        // handing a vector to anything that might mutate it.
        mesh.position = mid.clone();
        // Aligns the cylinder's default local +Y axis with the real
        // a->b direction -- the standard "rotation between two
        // vectors" quaternion, since CreateCylinder always builds
        // along local Y. Roll around that axis is left unconstrained
        // here (world "up" as the reference vector, same as always) --
        // harmless for a ROUND cross-section, unlike the square
        // frustum case above, which needs its own dedicated geometry
        // instead of relying on this rotation at all.
        const up = BABYLON.Vector3.Up();
        const axisNormalized = axisVec.clone().normalize(); // clone first -- normalize() mutates in place, and axisVec's own un-normalized length is still needed below
        const dot = BABYLON.Vector3.Dot(up, axisNormalized);
        if (dot < 0.9999) {
          const rotAxis = dot < -0.9999 ? new BABYLON.Vector3(1, 0, 0) : BABYLON.Vector3.Cross(up, axisNormalized).normalize();
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          mesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(rotAxis, angle);
        }
        // Billboard goes above the mesh's own TOPMOST vertex along the
        // vertical axis, regardless of rotation -- NOT "the tip"/"the
        // near cap" (see shapeAabb's own doc for why that framing is
        // wrong once the shape can be rotated). `mid.add(halfAxis)` is
        // the 'b' (far/wide) end; `mid.subtract(halfAxis)` is the 'a'
        // (near) end.
        const topCandidate1 = mid.add(halfAxis).y + topDiameter / 2;
        const topCandidate2 = mid.subtract(halfAxis).y + bottomDiameter / 2;
        topY = Math.max(topCandidate1, topCandidate2);
      }
      mesh.material = mat;
      mesh.isPickable = pickable;
      noa.rendering.addMeshToScene(mesh, false);
      meshes.push(mesh);

      if (kind === "beam") {
        addLabelAt([mid.x, topY + 0.3, mid.z], ftPerVoxelLabel(axisLength, ftPV));
      } else {
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
      const key = JSON.stringify([activeKind, activePoints, selectedIndex, coneDegreesValue, isFrustumValue, beamWidthValue, billboardsThroughTerrainValue]);
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
      const key = JSON.stringify([shape.kind, points, shape.coneDegrees, shape.isFrustum, shape.beamWidth, ftPerVoxel(), billboardsThroughTerrainValue]);
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
      // Only clears the LOCAL ghost/editing state -- whatever was
      // already persisted via persistCurrent() stays on the server
      // untouched ("once a player makes a measurement that should be
      // the current one and it should persist").
      resetPlacement();
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
    billboardsThroughTerrain: () => billboardsThroughTerrainValue,
    setBillboardsThroughTerrain(enabled: boolean): void {
      billboardsThroughTerrainValue = enabled;
    },
    requestLookAround: lookAround,
    onPlacePoint(): void {
      if (!activeKind || isDraggingSecondPoint) return; // already mid-drag -- this mousedown is the SAME press, not a new one (see installVoxelEditor's own "fire" doc: one emission per press)
      const required = requiredPointCount(activeKind);
      if (required !== undefined && activePoints.length >= required) {
        // Real request, 2026-10-24: "once I click the screen again, it
        // should start making another cube... I have to select another
        // shape button instead of just making more by clicking the
        // screen, which can be cube again, but it would be nice to
        // just click and drag to have it work." A completed (already-
        // persisted) fixed-point-count shape no longer makes further
        // clicks a no-op -- the NEXT click starts a brand new one of
        // the SAME kind, same "reset the points" the shape-type button
        // itself already does (selectKind's own doc), just triggered
        // by a click instead of re-picking the button. The previous
        // object stays persisted on the server exactly as it was.
        activePoints = [];
        selectedIndex = 0;
      }
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
      persistCurrent(); // a chain has no drag-release moment of its own -- each added point IS the "make it" moment once there are enough to form a segment
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

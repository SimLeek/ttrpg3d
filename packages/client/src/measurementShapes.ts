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
import { tokenScaleFor, PLAYER_BODY_HEIGHT } from "./playerBodyMesh.js";
import { isCaptured } from "./inputCapture.js";
import type { MeasurementShapeKind, SnapMode } from "./measurementPanel.js";

const SHAPE_COLOR = new BABYLON.Color3(0.3, 0.7, 1); // distinguishes a measurement object from the waypoint system's own yellow
const OBJECT_ALPHA = 0.45; // "rendered semi-transparent"
const DEFAULT_CONE_DEGREES = 60;
const DEFAULT_BEAM_WIDTH = 1;
// Real scoping decision (not specified by the doc): a frustum's own
// near-cap radius isn't user-configurable -- a small fixed fraction
// of the far-cap radius is enough to make it visually read as
// "truncated," without adding a second parameter nobody asked for.
const FRUSTUM_NEAR_RADIUS_FRACTION = 0.2;

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

/** W/S: the camera's own forward direction, projected onto the horizontal plane and snapped to the nearest of the 4 cardinal (voxel-grid-aligned) directions -- "ws matches direction of camera snapped to voxel coords." */
export function snappedCameraForward(cameraDirection: Point3): [number, number, number] {
  const [dx, , dz] = cameraDirection;
  if (Math.abs(dx) > Math.abs(dz)) return [Math.sign(dx) || 1, 0, 0];
  return [0, 0, Math.sign(dz) || 1];
}

/** A/D: perpendicular to the snapped forward direction, same horizontal plane. */
export function snappedCameraRight(cameraDirection: Point3): [number, number, number] {
  const [fx, , fz] = snappedCameraForward(cameraDirection);
  return [fz, 0, -fx];
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

/** The shared sizing function itself -- real request: one function, called with a different box per shape. Matches net.ts's own character-token billboard scale exactly (tokenScaleFor), just fed a shape's AABB height instead of a real character's body height. */
function billboardScaleFor(aabb: { height: number }): number {
  return tokenScaleFor(aabb.height);
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
  /** Wired into voxelEditor.ts's installVoxelEditor as its `measurementPlacement` argument. */
  isPlacing(): boolean;
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

  function state(): WorldStateLike | undefined {
    return room.state as WorldStateLike | undefined;
  }

  function ftPerVoxel(): number {
    return state()?.ftPerVoxel ?? 5;
  }

  // ---- In-progress placement (pure client state until finalized) ----
  let activeKind: MeasurementShapeKind | undefined;
  let activePoints: Point3[] = [];
  let selectedIndex = 0;
  let snapModeValue: SnapMode = "center";
  let broadcastValue = true;
  let coneDegreesValue = DEFAULT_CONE_DEGREES;
  let isFrustumValue = false;
  let beamWidthValue = DEFAULT_BEAM_WIDTH;

  function resetPlacement(): void {
    activeKind = undefined;
    activePoints = [];
    selectedIndex = 0;
  }

  function myLivePosition(): Point3 | undefined {
    const pos = noa.ents.getPosition(noa.playerEntity);
    return pos ? [pos[0], pos[1], pos[2]] : undefined;
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

  /** Real correction, 2026-10-24 (same bug/fix characterPlacement.ts's own doc explains in full): `scene.createPickingRay`'s ray.origin is in noa's LOCAL (origin-shifted) frame, but `noa.pick()` expects GLOBAL and shifts it again internally -- converting back to global first avoids a silent double-shift. */
  function raycastTerrain(screenPoint: { x: number; y: number }): Point3 | undefined {
    const camera = scene.activeCamera;
    if (!camera) return undefined;
    const ray = scene.createPickingRay(screenPoint.x, screenPoint.y, BABYLON.Matrix.Identity(), camera);
    const pos = noa.localToGlobal([ray.origin.x, ray.origin.y, ray.origin.z], []) as [number, number, number];
    const dir = [ray.direction.x, ray.direction.y, ray.direction.z];
    const hit = noa.pick(pos, dir, 256);
    return hit ? (hit.position as unknown as Point3) : undefined;
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

  // ---- Keybinds: WASD/Space/Shift move the selected point; Tab/Shift+Tab cycle selection; Enter finalizes a chain ----
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if (isCaptured()) return;
    if (!activeKind || activePoints.length === 0) return;

    const point = activePoints[selectedIndex];
    const dir = noa.camera.getDirection() as unknown as Point3;

    if (event.code === "KeyW" || event.code === "KeyS") {
      const [sx, , sz] = snappedCameraForward(dir);
      const sign = event.code === "KeyW" ? 1 : -1;
      activePoints[selectedIndex] = [point[0] + sx * sign, point[1], point[2] + sz * sign];
    } else if (event.code === "KeyA" || event.code === "KeyD") {
      const [sx, , sz] = snappedCameraRight(dir);
      const sign = event.code === "KeyD" ? 1 : -1;
      activePoints[selectedIndex] = [point[0] + sx * sign, point[1], point[2] + sz * sign];
    } else if (event.code === "Space") {
      activePoints[selectedIndex] = [point[0], point[1] + 1, point[2]];
    } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      activePoints[selectedIndex] = [point[0], point[1] - 1, point[2]];
    } else if (event.code === "Tab") {
      event.preventDefault(); // don't let it shift DOM focus away -- same guard focusCycling.ts's own Tab handler already applies
      selectedIndex = cycleIndex(activePoints.length, selectedIndex, event.shiftKey ? -1 : 1);
    } else if (event.code === "Enter" && activeKind === "chain") {
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

  /** Builds every mesh + billboard for one shape, finalized or still a ghost preview -- the SAME builder either way, just a different material/id prefix and (for a chain) a possible trailing live segment to the cursor's own preview point. */
  function buildShapeVisuals(idPrefix: string, mat: BABYLON.Material, kind: MeasurementShapeKind, points: Point3[], coneDegrees: number, isFrustumFlag: boolean, beamWidth: number): ShapeVisuals {
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

    if (kind === "chain") {
      points.forEach((p, i) => {
        const marker = BABYLON.MeshBuilder.CreateSphere(`${idPrefix}-pt-${i}`, { diameter: 0.3 }, scene);
        marker.position = new BABYLON.Vector3(...p);
        marker.material = mat;
        marker.isPickable = false;
        noa.rendering.addMeshToScene(marker, false);
        meshes.push(marker);
      });
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const tube = BABYLON.MeshBuilder.CreateTube(`${idPrefix}-seg-${i}`, { path: [new BABYLON.Vector3(...a), new BABYLON.Vector3(...b)], radius: 0.08, cap: BABYLON.Mesh.CAP_ALL }, scene);
        tube.material = mat;
        tube.isPickable = false;
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
      box.isPickable = false;
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
      sphere.isPickable = false;
      noa.rendering.addMeshToScene(sphere, false);
      meshes.push(sphere);
      const aabb = shapeAabb("sphere", points);
      addLabelAt([center[0], center[1] + radius + 0.3, center[2]], `r=${ftPerVoxelLabel(radius, ftPV)}`, billboardScaleFor(aabb));
    } else if ((kind === "cone" || kind === "beam") && points.length === 2) {
      const [a, b] = points;
      const axisVec = new BABYLON.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const axisLength = axisVec.length() || 0.01;
      const mid = new BABYLON.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      const topDiameter = kind === "beam" ? beamWidth : (isFrustumFlag ? 2 * axisLength * Math.tan((coneDegrees * Math.PI) / 180 / 2) * FRUSTUM_NEAR_RADIUS_FRACTION : 0);
      const bottomDiameter = kind === "beam" ? beamWidth : 2 * axisLength * Math.tan((coneDegrees * Math.PI) / 180 / 2);
      const mesh = BABYLON.MeshBuilder.CreateCylinder(`${idPrefix}-${kind}`, { height: axisLength, diameterTop: topDiameter, diameterBottom: bottomDiameter, tessellation: 16 }, scene);
      mesh.position = mid;
      // Aligns the cylinder's default local +Y axis with the real a->b
      // direction -- the standard "rotation between two vectors"
      // quaternion, since CreateCylinder always builds along local Y.
      const up = BABYLON.Vector3.Up();
      const axisNormalized = axisVec.normalize();
      const dot = BABYLON.Vector3.Dot(up, axisNormalized);
      if (dot < 0.9999) {
        const rotAxis = dot < -0.9999 ? new BABYLON.Vector3(1, 0, 0) : BABYLON.Vector3.Cross(up, axisNormalized).normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        mesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(rotAxis, angle);
      }
      mesh.material = mat;
      mesh.isPickable = false;
      noa.rendering.addMeshToScene(mesh, false);
      meshes.push(mesh);
      if (kind === "beam") {
        addLabelAt([mid.x, mid.y + 0.3, mid.z], ftPerVoxelLabel(axisLength, ftPV)); // fixed/default size, same as the chain/waypoint billboards -- NOT the shared AABB-scale function (see this feature's own doc on why beam is excepted)
      } else {
        // Cone/frustum billboard goes above the mesh's own TOPMOST
        // vertex along the vertical axis, regardless of rotation --
        // NOT "the tip" or "the near cap" (see shapeAabb's own doc
        // and this feature's doc for why that framing is wrong once
        // the shape can be rotated). Since both caps are flat circles
        // approximated by `tessellation` points, the topmost point of
        // either cap already bounds the whole mesh's own top -- a
        // cheap, correct-under-any-rotation stand-in for a full
        // vertex scan.
        const halfAxis = axisVec.scale(0.5);
        const topCandidate1 = mid.add(halfAxis).y + bottomDiameter / 2;
        const topCandidate2 = mid.subtract(halfAxis).y + topDiameter / 2;
        const topY = Math.max(topCandidate1, topCandidate2);
        const aabb = shapeAabb("cone", points, coneDegrees);
        addLabelAt([mid.x, topY + 0.3, mid.z], ftPerVoxelLabel(axisLength, ftPV), billboardScaleFor(aabb));
      }
    }

    return { meshes, labels, lastKey: "" };
  }

  noa.on("tick", () => {
    const s = state();

    // Ghost preview for the shape currently being placed.
    if (activeKind && activePoints.length > 0) {
      const key = JSON.stringify([activeKind, activePoints, selectedIndex, coneDegreesValue, isFrustumValue, beamWidthValue]);
      if (ghostVisuals?.lastKey !== key) {
        if (ghostVisuals) disposeVisuals(ghostVisuals);
        ghostVisuals = buildShapeVisuals("measurement-ghost", ghostMaterial, activeKind, activePoints, coneDegreesValue, isFrustumValue, beamWidthValue);
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
      const fresh = buildShapeVisuals(`measurement-${shape.shapeId}`, material, shape.kind as MeasurementShapeKind, points, shape.coneDegrees, shape.isFrustum, shape.beamWidth);
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

  return {
    activeKind: () => activeKind,
    selectKind(kind: MeasurementShapeKind): void {
      resetPlacement();
      activeKind = kind;
      const pos = myLivePosition();
      if (pos) {
        activePoints = [snapPoint(pos, snapModeValue)];
        selectedIndex = 0;
      }
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
    isPlacing: () => !!activeKind,
    onPlacePoint(): void {
      if (!activeKind) return;
      const hit = raycastTerrain(currentPickScreenPoint());
      if (!hit) return;
      const point = snapPoint(hit, snapModeValue);
      activePoints.push(point);
      selectedIndex = activePoints.length - 1;
      const required = requiredPointCount(activeKind);
      if (required !== undefined && activePoints.length >= required) finalizeIfReady();
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
      if (ghostVisuals) disposeVisuals(ghostVisuals);
      for (const visuals of visualsByShapeId.values()) disposeVisuals(visuals);
      visualsByShapeId.clear();
      material.dispose();
      ghostMaterial.dispose();
    },
  };
}

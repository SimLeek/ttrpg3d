// docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- M (mark a
// waypoint), N ("walk back to it first, then a second press actually
// removes it" -- same guard the old game had), Enter (finalize/clear
// the current chain, guarded against hijacking a text input the same
// way Tab/Escape already are elsewhere in this codebase), plus the 3D
// markers/segments/distance labels themselves.
//
// Deliberately noa/room-coupled (unlike turnTracker.ts/
// characterContextMenu.ts) -- same tier as respawnControl.ts/
// gmOverride.ts/characterPlacement.ts, mounted once per connected
// world from net.ts. The pure "snap to grid"/"am I standing on it"
// decisions are factored out below so they're unit-testable without a
// real noa/Babylon instance.

import * as BABYLON from "@babylonjs/core";
import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import { minkowskiDistance, type Point3 } from "@ttrpg3d/shared";
import type { PlayerController } from "./movement/PlayerController.js";
import { createDistanceLabel, type DistanceLabel } from "./distanceLabel.js";
import { isCaptured } from "./inputCapture.js";

/** "Waypoints snap to voxel-grid centers by default" -- floor to the containing cell, then recenter (+0.5 on each axis), not the cell's corner. */
export function snapToVoxelGridCenter(pos: Point3): [number, number, number] {
  return [Math.floor(pos[0]) + 0.5, Math.floor(pos[1]) + 0.5, Math.floor(pos[2]) + 0.5];
}

/** Real request: "walk back to the last waypoint first, then a second press actually removes it." Tolerance is "same voxel cell," not exact float equality -- a player standing anywhere inside the cell a snapped waypoint occupies counts as standing on it. */
export function isStandingOnWaypoint(playerPos: Point3, waypoint: Point3): boolean {
  return Math.floor(playerPos[0]) === Math.floor(waypoint[0]) && Math.floor(playerPos[1]) === Math.floor(waypoint[1]) && Math.floor(playerPos[2]) === Math.floor(waypoint[2]);
}

interface WaypointLike {
  x: number;
  y: number;
  z: number;
}

/**
 * Real correction, 2026-10-24: waypoints/waypointColor* moved from the
 * piloting SESSION (`PlayerState`) to the piloted CHARACTER INSTANCE
 * (`OtherCharacterState`) -- "the waypoint thing seems to be per
 * player, so when I tab through different 3d instances, the waypoints
 * then go in a line from the previous location to the instance I'm
 * controlling now. It should really be waypoints just following a
 * specific instance." A piloted instance is `players.get(x)
 * .currentInstance`; an idle one lives directly in the world's own
 * `otherCharacters` array -- both are rendered below, keyed by
 * `instanceId` rather than `sessionId`.
 */
interface OtherCharacterLike {
  instanceId: string;
  x: number;
  y: number;
  z: number;
  bodyWidth: number;
  waypoints?: Iterable<WaypointLike>;
  waypointColorR?: number;
  waypointColorG?: number;
  waypointColorB?: number;
}

interface RemotePlayerLike {
  currentInstance?: OtherCharacterLike;
}

interface WorldStateLike {
  waypointsEnabled?: boolean;
  waypointDistanceMetricP?: number;
  players?: Map<string, RemotePlayerLike>;
  otherCharacters?: Iterable<OtherCharacterLike>;
}

const DEFAULT_MARKER_COLOR: [number, number, number] = [1, 0.9, 0.2]; // yellow, per docs/BATTLE_SYSTEM.md -- per-player override via the waypoint panel's own color picker
const MIN_MARKER_RADIUS = 0.08;
const MIN_LINE_RADIUS = 0.02;

/**
 * Real request: "the billboard and waypoint lines/spheres get
 * obscured when they go through terrain... there should be a way to
 * see them." A per-PLAYER, purely client-side preference (no server
 * sync needed -- it only changes how THIS viewer renders waypoint
 * meshes, not any shared state) -- not a shader change at all: a
 * StandardMaterial that always passes the depth test
 * (`depthFunction = ALWAYS`) and doesn't write its own depth
 * (`disableDepthWrite`) renders on top of whatever else is already
 * drawn, same trick engines use for gizmo/x-ray overlays. Confirmed
 * fine by the user for this to also render in front of OTHER meshes
 * (not just terrain), not just a cutout/alpha-test effect.
 */
const SHOW_THROUGH_TERRAIN_STORAGE_KEY = "ttrpg3d.waypointsShowThroughTerrain";

function applyShowThroughTerrainToMaterial(material: BABYLON.Material, showThroughTerrain: boolean): void {
  material.disableDepthWrite = showThroughTerrain;
  material.depthFunction = showThroughTerrain ? BABYLON.Constants.ALWAYS : BABYLON.Constants.LEQUAL;
}

/**
 * Real bug found live: the depth-function trick above alone made the
 * BILLBOARD (the distance label) render through terrain correctly,
 * but NOT the marker spheres/line tubes. Root cause: the label's
 * plane, backed by `AdvancedDynamicTexture`, is alpha-blended --
 * Babylon already draws every alpha-blended mesh in a SEPARATE pass,
 * strictly after all opaque geometry (including terrain) regardless
 * of submission order, so it "just worked." The marker/tube meshes
 * are plain opaque `StandardMaterial` -- they draw in the SAME opaque
 * pass as the terrain itself, where a depth-write/test trick alone
 * doesn't guarantee draw ORDER against something else in that same
 * pass. A higher `renderingGroupId` fixes this properly: Babylon
 * always draws a higher rendering group strictly after every lower
 * one, so group 1 is guaranteed to draw after terrain's default
 * group 0, independent of submission order.
 */
function applyShowThroughTerrainToMesh(mesh: BABYLON.AbstractMesh, showThroughTerrain: boolean): void {
  mesh.renderingGroupId = showThroughTerrain ? 1 : 0;
}

interface PlayerWaypointVisuals {
  markers: BABYLON.Mesh[];
  segments: BABYLON.Mesh[];
  labels: DistanceLabel[];
  lastKey: string;
}

export interface WaypointsController {
  /** Shared by the M keybind and the waypoint panel's own W+ button (net.ts wires both to this). */
  addAtCurrentPosition(): void;
  /** Shared by the N keybind and the waypoint panel's own W- button. */
  removeOrWalkBack(): void;
  isShowThroughTerrain(): boolean;
  setShowThroughTerrain(enabled: boolean): void;
  destroy(): void;
}

export function installWaypoints(noa: Engine, room: Room, playerController: PlayerController): WaypointsController {
  const scene = noa.rendering.getScene();

  // Real bug found live: a StandardMaterial with disableLighting ON
  // sources its unlit color from `emissiveColor`, NOT `diffuseColor`
  // (diffuse reflection needs a light contribution to multiply
  // against -- with lighting disabled there isn't one, so it renders
  // black) -- confirmed against this codebase's own
  // characterPlacement.ts marker, which already sets BOTH together
  // for exactly this reason. "If the waypoint 3d lines and spheres
  // were supposed to be yellow, then we may have a bug on our hands"
  // -- they were, and this was it. One material PER INSTANCE now
  // (not shared) since color is a per-character preference (the
  // waypoint panel's own color picker).
  const materialsByInstance = new Map<string, BABYLON.StandardMaterial>();
  let showThroughTerrain = localStorage.getItem(SHOW_THROUGH_TERRAIN_STORAGE_KEY) === "true";

  function materialFor(instanceId: string, color: [number, number, number]): BABYLON.StandardMaterial {
    let material = materialsByInstance.get(instanceId);
    if (!material) {
      material = new BABYLON.StandardMaterial(`waypoint-marker-mat-${instanceId}`, scene);
      material.disableLighting = true;
      materialsByInstance.set(instanceId, material);
    }
    const c = new BABYLON.Color3(...color);
    material.diffuseColor = c;
    material.emissiveColor = c;
    applyShowThroughTerrainToMaterial(material, showThroughTerrain);
    return material;
  }

  function state(): WorldStateLike | undefined {
    return room.state as WorldStateLike | undefined;
  }

  function myWaypoints(): WaypointLike[] {
    return Array.from(state()?.players?.get(room.sessionId)?.currentInstance?.waypoints ?? []);
  }

  function myLivePosition(): Point3 | undefined {
    const pos = noa.ents.getPosition(noa.playerEntity);
    if (!pos) return undefined;
    return [pos[0], pos[1], pos[2]];
  }

  // ---- M / N / Enter keybinds ----
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    // Enter has real, standard meaning while typing (submit a form
    // field) -- isCaptured() alone doesn't cover this (net.ts's own
    // stat-value/color editor inputs, and the waypoint panel's own
    // metric input, don't claim capture), so this checks DOM focus
    // directly too, same as focusCycling.ts's own Tab guard.
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if (isCaptured()) return;
    if (!state()?.waypointsEnabled) return; // "M/N... do nothing while disabled"

    if (event.code === "KeyM") {
      addAtCurrentPosition();
    } else if (event.code === "KeyN") {
      removeOrWalkBack();
    } else if (event.code === "Enter") {
      room.send("clearWaypoints");
    }
  });

  /** Shared by N and the panel's own W- button (net.ts wires both to this). */
  function removeOrWalkBack(): void {
    if (!state()?.waypointsEnabled) return;
    const waypoints = myWaypoints();
    const last = waypoints[waypoints.length - 1];
    if (!last) return;
    const pos = myLivePosition();
    if (!pos) return;
    if (isStandingOnWaypoint(pos, [last.x, last.y, last.z])) {
      room.send("removeWaypoint");
    } else {
      // Real port of the old game's own M/N waypoint-mark/undo -- "ITS
      // M/N waypoint-mark/undo actually TELEPORTS the player between
      // marked waypoints" (docs/PORTING_CHECKLIST.md), the same
      // teleportTo entry point respawnControl.ts's own Shift+R uses.
      playerController.teleportTo([last.x, last.y, last.z]);
    }
  }

  /** Shared by M and the panel's own W+ button. */
  function addAtCurrentPosition(): void {
    if (!state()?.waypointsEnabled) return;
    const pos = myLivePosition();
    if (!pos) return;
    const [x, y, z] = snapToVoxelGridCenter(pos);
    room.send("addWaypoint", { x, y, z });
  }

  // ---- 3D rendering: markers + segments + distance labels, for EVERY character instance's own waypoint chain (piloted AND idle) ----
  const visualsByInstance = new Map<string, PlayerWaypointVisuals>();

  function disposeVisuals(visuals: PlayerWaypointVisuals): void {
    for (const mesh of visuals.markers) mesh.dispose();
    for (const mesh of visuals.segments) mesh.dispose();
    for (const label of visuals.labels) label.dispose();
  }

  function buildVisualsFor(instanceId: string, waypoints: WaypointLike[], livePos: Point3 | undefined, bodyWidth: number, metricP: number, color: [number, number, number]): PlayerWaypointVisuals {
    const markerRadius = Math.max(MIN_MARKER_RADIUS, bodyWidth * 0.25);
    const lineRadius = Math.max(MIN_LINE_RADIUS, bodyWidth * 0.06);
    const material = materialFor(instanceId, color);
    const markers: BABYLON.Mesh[] = [];
    const segments: BABYLON.Mesh[] = [];
    const labels: DistanceLabel[] = [];

    waypoints.forEach((w, i) => {
      const marker = BABYLON.MeshBuilder.CreateSphere(`waypoint-${instanceId}-${i}`, { diameter: markerRadius * 2 }, scene);
      marker.position = new BABYLON.Vector3(w.x, w.y, w.z);
      marker.material = material;
      marker.isPickable = false;
      applyShowThroughTerrainToMesh(marker, showThroughTerrain);
      noa.rendering.addMeshToScene(marker, false);
      markers.push(marker);
    });

    // Every consecutive waypoint-to-waypoint pair, plus one more LIVE
    // segment from the LAST waypoint to the player's current
    // position -- each segment's own endpoints, computed up front so
    // "T" (the whole path's total length) is known before building
    // any one label.
    const segmentEndpoints: [Point3, Point3][] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      segmentEndpoints.push([[waypoints[i].x, waypoints[i].y, waypoints[i].z], [waypoints[i + 1].x, waypoints[i + 1].y, waypoints[i + 1].z]]);
    }
    const lastWaypoint = waypoints[waypoints.length - 1];
    if (lastWaypoint && livePos) segmentEndpoints.push([[lastWaypoint.x, lastWaypoint.y, lastWaypoint.z], livePos]);

    const segmentDistances = segmentEndpoints.map(([a, b]) => minkowskiDistance(a, b, metricP));
    const totalDistance = segmentDistances.reduce((sum, d) => sum + d, 0);

    segmentEndpoints.forEach(([a, b], i) => {
      const tube = BABYLON.MeshBuilder.CreateTube(
        `waypoint-segment-${instanceId}-${i}`,
        { path: [new BABYLON.Vector3(...a), new BABYLON.Vector3(...b)], radius: lineRadius, cap: BABYLON.Mesh.CAP_ALL, updatable: false },
        scene,
      );
      tube.material = material;
      tube.isPickable = false;
      applyShowThroughTerrainToMesh(tube, showThroughTerrain);
      noa.rendering.addMeshToScene(tube, false);
      segments.push(tube);

      // Real request: "change the billboards a bit: D: {this line's
      // distance}, T:{whole path distance}, since I found myself
      // wanting to know exactly how far the distance was."
      // Two lines, not comma-separated on one -- real correction: "the
      // billboard for the distance/total... getting cut off at normal
      // distances."
      const label = createDistanceLabel(scene, `D: ${segmentDistances[i].toFixed(1)}\nT: ${totalDistance.toFixed(1)}`);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.3, (a[2] + b[2]) / 2] as Point3;
      label.mesh.position = new BABYLON.Vector3(...mid);
      applyShowThroughTerrainToMesh(label.mesh, showThroughTerrain);
      if (label.mesh.material) applyShowThroughTerrainToMaterial(label.mesh.material, showThroughTerrain);
      noa.rendering.addMeshToScene(label.mesh, false);
      labels.push(label);
    });

    return { markers, segments, labels, lastKey: "" };
  }

  noa.on("tick", () => {
    const s = state();
    if (!s) return;
    // Piloted instances (players.get(x).currentInstance) AND idle ones
    // (otherCharacters) both carry their own waypoint chain now -- see
    // this file's own OtherCharacterLike doc above.
    const instances: OtherCharacterLike[] = [];
    if (s.players) for (const player of s.players.values()) if (player.currentInstance) instances.push(player.currentInstance);
    if (s.otherCharacters) for (const other of s.otherCharacters) instances.push(other);
    const seen = new Set<string>();

    for (const instance of instances) {
      const waypoints = Array.from(instance.waypoints ?? []);
      if (waypoints.length === 0) continue;
      const instanceId = instance.instanceId;
      seen.add(instanceId);

      const livePos: Point3 = [instance.x, instance.y, instance.z];
      const bodyWidth = instance.bodyWidth ?? 0.6;
      const metricP = s.waypointDistanceMetricP ?? 2;
      const color: [number, number, number] = [instance.waypointColorR ?? DEFAULT_MARKER_COLOR[0], instance.waypointColorG ?? DEFAULT_MARKER_COLOR[1], instance.waypointColorB ?? DEFAULT_MARKER_COLOR[2]];
      // Cheap skip, same spirit as turnTracker.ts's own update() diff --
      // only rebuild this instance's meshes when something relevant
      // actually changed (its own waypoints, its live position, body
      // size, the shared metric, its own marker color, or the LOCAL
      // viewer's own show-through-terrain preference -- the one case
      // where a toggle isn't ABOUT this particular instance's data,
      // but still needs every instance's visuals rebuilt with fresh
      // materials to take effect).
      const key = JSON.stringify([waypoints, livePos, bodyWidth, metricP, color, showThroughTerrain]);
      const existing = visualsByInstance.get(instanceId);
      if (existing?.lastKey === key) continue;
      if (existing) disposeVisuals(existing);
      const fresh = buildVisualsFor(instanceId, waypoints, livePos, bodyWidth, metricP, color);
      fresh.lastKey = key;
      visualsByInstance.set(instanceId, fresh);
    }

    for (const [instanceId, visuals] of visualsByInstance) {
      if (!seen.has(instanceId)) {
        disposeVisuals(visuals);
        visualsByInstance.delete(instanceId);
        materialsByInstance.get(instanceId)?.dispose();
        materialsByInstance.delete(instanceId);
      }
    }
  });

  return {
    addAtCurrentPosition,
    removeOrWalkBack,
    isShowThroughTerrain: () => showThroughTerrain,
    setShowThroughTerrain(enabled: boolean): void {
      showThroughTerrain = enabled;
      localStorage.setItem(SHOW_THROUGH_TERRAIN_STORAGE_KEY, String(enabled));
      // The next tick's key comparison picks this up and rebuilds
      // every session's visuals with the new material settings --
      // see the key's own doc above.
    },
    destroy(): void {
      for (const visuals of visualsByInstance.values()) disposeVisuals(visuals);
      visualsByInstance.clear();
      for (const material of materialsByInstance.values()) material.dispose();
      materialsByInstance.clear();
    },
  };
}

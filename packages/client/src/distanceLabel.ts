// A minimal billboard: one line of text, always facing the camera.
// docs/BATTLE_SYSTEM.md's waypoint/distance measurement calls for
// reusing this project's existing billboard mechanism
// (characterToken.ts's @babylonjs/gui-based plane) rather than a
// separate one-off text-rendering approach -- this module extends
// that SAME technique (CreatePlane + billboardMode + AdvancedDynamicTexture.
// CreateForMesh) in its simplest possible form, since a distance label
// has no bars/status icons to reserve layout for.

import * as BABYLON from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";

// Real correction: "make the billboard for the distance/total taller
// and put them on multiple lines because they're getting cut off at
// normal distances" -- wider AND taller than the original single-line
// size, since waypoints.ts now sets two lines of text ("D: ...\nT:
// ...").
const TEXTURE_WIDTH = 170;
const TEXTURE_HEIGHT = 90;
export const DISTANCE_LABEL_PLANE_WIDTH = 0.7;
export const DISTANCE_LABEL_PLANE_HEIGHT = (DISTANCE_LABEL_PLANE_WIDTH * TEXTURE_HEIGHT) / TEXTURE_WIDTH;

export interface DistanceLabel {
  mesh: BABYLON.Mesh;
  setText(text: string): void;
  dispose(): void;
}

export function createDistanceLabel(scene: BABYLON.Scene, initialText: string): DistanceLabel {
  const plane = BABYLON.MeshBuilder.CreatePlane("distance-label", { width: DISTANCE_LABEL_PLANE_WIDTH, height: DISTANCE_LABEL_PLANE_HEIGHT }, scene);
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // always fully camera-facing, unlike character tokens (Y-only) -- a segment label can sit at any pitch, not just upright
  plane.isPickable = false; // purely informational -- never a pick/hover target

  const texture = GUI.AdvancedDynamicTexture.CreateForMesh(plane, TEXTURE_WIDTH, TEXTURE_HEIGHT, false);
  const background = new GUI.Rectangle("distance-label-bg");
  background.width = 1;
  background.height = 1;
  background.thickness = 0;
  background.background = "rgba(0,0,0,0.55)";
  texture.addControl(background);

  const textBlock = new GUI.TextBlock("distance-label-text", initialText);
  textBlock.color = "#ffe533"; // yellow, matching the waypoint markers themselves
  textBlock.fontSize = 24;
  background.addControl(textBlock);

  return {
    mesh: plane,
    setText(text: string): void {
      textBlock.text = text;
    },
    dispose(): void {
      texture.dispose();
      plane.dispose();
    },
  };
}

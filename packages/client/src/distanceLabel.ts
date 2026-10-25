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
const TEXTURE_HEIGHT_PER_LINE = 45; // the original 2-line size (90px) divided evenly -- real request, 2026-10-24: "Cube should have W, H, and D all on different lines," a 3rd caller needing more vertical room than the 2-line default
export const DISTANCE_LABEL_PLANE_WIDTH = 0.7;

export interface DistanceLabel {
  mesh: BABYLON.Mesh;
  setText(text: string): void;
  dispose(): void;
}

/** `lines` sizes the label's own texture/plane height -- defaults to 2 (every existing caller's own line count: "D:"/"T:", or a single line that just doesn't use the 2nd one). Pass 3+ for a caller showing more lines (e.g. cube's W:/H:/D:) so they don't get cut off, same reasoning the original 1-line -> 2-line bump already used. */
export function createDistanceLabel(scene: BABYLON.Scene, initialText: string, lines = 2): DistanceLabel {
  const textureHeight = TEXTURE_HEIGHT_PER_LINE * lines;
  const planeHeight = (DISTANCE_LABEL_PLANE_WIDTH * textureHeight) / TEXTURE_WIDTH;
  const plane = BABYLON.MeshBuilder.CreatePlane("distance-label", { width: DISTANCE_LABEL_PLANE_WIDTH, height: planeHeight }, scene);
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // always fully camera-facing, unlike character tokens (Y-only) -- a segment label can sit at any pitch, not just upright
  plane.isPickable = false; // purely informational -- never a pick/hover target

  const texture = GUI.AdvancedDynamicTexture.CreateForMesh(plane, TEXTURE_WIDTH, textureHeight, false);
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

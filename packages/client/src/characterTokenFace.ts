// docs/CHARACTER_SHEET_IMPORT.md, part 2 -- the circular billboard
// INSIDE a character's wireframe box (buildWireframeBox,
// playerBodyMesh.ts), showing that character's own tokenImage if one
// is set, or a plain ASCII smiley tinted to their token color
// otherwise ("we already have text token[s], I think you could just
// render the ascii smiley face code in a circle that matches the
// character color"). A SEPARATE billboard from characterToken.ts's
// own name+bars plane -- that one still renders above the character;
// this one sits centered inside the box itself.
//
// Circular, not square: the plane's own width/height both equal the
// given diameter (real request: "that would be the billboard width
// and height"), and the GUI content is drawn into a `GUI.Ellipse`
// filling the whole texture -- everything outside that ellipse stays
// fully transparent (AdvancedDynamicTexture's own default), so the
// plane reads as a circle, not a square card with a circle on it.

import * as BABYLON from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";

const TEXTURE_SIZE = 128;
const SMILEY_TEXT = ":)";

export interface CharacterTokenFace {
  mesh: BABYLON.Mesh;
  /** Exposed mainly for test introspection, same precedent characterToken.ts's own CharacterToken.texture already sets. */
  texture: GUI.AdvancedDynamicTexture;
  /** Diameter equals the inscribed-sphere size (`min(bodyWidth, bodyHeight, bodyDepth)`, computed by the caller) -- this file doesn't know about body dimensions at all, just the final number. */
  setDiameter(diameter: number): void;
  /** Also tints the smiley fallback's own background to match -- the real request's own "in a circle that matches the character color." */
  setColor(color: BABYLON.Color3): void;
  /** Undefined (or empty) shows the ASCII smiley fallback instead. */
  setImage(url: string | undefined): void;
  dispose(): void;
}

function colorToHex(c: BABYLON.Color3): string {
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

/** Plain relative-luminance check -- white smiley text on a dark token color, black on a light one, so it's always legible against whatever color a player picked. */
function legibleTextColorFor(c: BABYLON.Color3): string {
  const luminance = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

export function createCharacterTokenFace(scene: BABYLON.Scene, name: string, diameter: number, color: BABYLON.Color3): CharacterTokenFace {
  // Built at a fixed 1x1 unit size and resized purely via `.scaling`
  // (setDiameter below) -- unlike buildWireframeBox's GreasedLine mesh
  // (confirmed NOT to follow `.scaling`, see that file's own test), a
  // plain CreatePlane mesh scales completely normally, same as every
  // other billboard plane in this codebase already relies on
  // (distanceLabel.ts's `label.mesh.scaling.setAll(scale)` etc.).
  const plane = BABYLON.MeshBuilder.CreatePlane(`${name}-face`, { width: 1, height: 1 }, scene);
  plane.scaling.setAll(diameter);
  // Real correction, 2026-10-25: "I'd like the internal character
  // token billboard to just point always at the camera so it's
  // always visible, even from above" -- the name/bars billboard
  // (characterToken.ts) uses BILLBOARDMODE_Y (stays upright, rotates
  // only around the vertical axis -- its surface normal is the
  // camera direction PROJECTED onto the ground plane, not the real
  // camera direction), which is wrong for a face meant to be visible
  // from any angle, including looking straight down. BILLBOARDMODE_ALL
  // is the SAME full camera-facing mode distanceLabel.ts's own
  // billboards already use.
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  // Real request, 2026-10-25: the wireframe box (buildWireframeBox) is
  // now hard to right-click/hover (practically just its thin lines) --
  // this face billboard becomes the easier, bigger target in its
  // place for the SAME token (net.ts adds this mesh to
  // TrackedToken.extraHitboxMeshes, tokenPicking.ts's own "additional
  // pick target" mechanism), so it needs to be pickable now, unlike
  // the purely-decorative distance labels/measurement billboards
  // elsewhere in this codebase.
  plane.isPickable = true;

  const texture = GUI.AdvancedDynamicTexture.CreateForMesh(plane, TEXTURE_SIZE, TEXTURE_SIZE, false);

  const circle = new GUI.Ellipse("token-face-circle");
  circle.width = "100%";
  circle.height = "100%";
  circle.thickness = 0;
  texture.addControl(circle);

  const smiley = new GUI.TextBlock("token-face-smiley", SMILEY_TEXT);
  smiley.fontSize = TEXTURE_SIZE * 0.45;
  circle.addControl(smiley);

  const image = new GUI.Image("token-face-image");
  image.stretch = GUI.Image.STRETCH_FILL;
  image.isVisible = false;
  circle.addControl(image);

  function applyColor(c: BABYLON.Color3): void {
    circle.background = colorToHex(c);
    smiley.color = legibleTextColorFor(c);
  }
  applyColor(color);

  return {
    mesh: plane,
    texture,
    setDiameter(diameter: number): void {
      plane.scaling.setAll(diameter);
    },
    setColor: applyColor,
    setImage(url: string | undefined): void {
      image.isVisible = !!url;
      smiley.isVisible = !url;
      if (url) image.source = url;
    },
    dispose(): void {
      texture.dispose();
      plane.dispose();
    },
  };
}

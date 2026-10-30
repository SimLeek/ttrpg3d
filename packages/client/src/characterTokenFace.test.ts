import { describe, it, expect } from "vitest";
import * as BABYLON from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";
import { createCharacterTokenFace } from "./characterTokenFace.js";

function makeScene(): BABYLON.Scene {
  const engine = new BABYLON.NullEngine();
  return new BABYLON.Scene(engine);
}

function findControl<T extends GUI.Control>(root: GUI.Container, predicate: (c: GUI.Control) => boolean): T | undefined {
  for (const child of root.children) {
    if (predicate(child)) return child as T;
    if (child instanceof GUI.Container) {
      const found = findControl<T>(child, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

describe("createCharacterTokenFace (docs/CHARACTER_SHEET_IMPORT.md, part 2 -- the circular token billboard inside the wireframe box)", () => {
  it("fully camera-facing (BILLBOARDMODE_ALL, not Y-only) and pickable -- real request: \"always visible, even from above\", and the new easier-to-click target now that the wireframe box is hard to right-click", () => {
    const face = createCharacterTokenFace(makeScene(), "test", 1, new BABYLON.Color3(1, 0, 0));
    expect(face.mesh.billboardMode).toBe(BABYLON.Mesh.BILLBOARDMODE_ALL);
    expect(face.mesh.isPickable).toBe(true);
  });

  it("shows the ASCII smiley fallback by default, with no image", () => {
    const face = createCharacterTokenFace(makeScene(), "test", 1, new BABYLON.Color3(1, 0, 0));
    const smiley = findControl<GUI.TextBlock>(face.texture.rootContainer, (c) => c instanceof GUI.TextBlock);
    const image = findControl<GUI.Image>(face.texture.rootContainer, (c) => c instanceof GUI.Image);
    expect(smiley?.text).toBe(":)");
    expect(smiley?.isVisible).toBe(true);
    expect(image?.isVisible).toBe(false);
  });

  it("setImage swaps to the image and hides the smiley; setImage(undefined) swaps back", () => {
    const face = createCharacterTokenFace(makeScene(), "test", 1, new BABYLON.Color3(1, 0, 0));
    const smiley = findControl<GUI.TextBlock>(face.texture.rootContainer, (c) => c instanceof GUI.TextBlock)!;
    const image = findControl<GUI.Image>(face.texture.rootContainer, (c) => c instanceof GUI.Image)!;

    face.setImage("https://example.com/token.png");
    expect(image.isVisible).toBe(true);
    expect(smiley.isVisible).toBe(false);
    expect(image.source).toBe("https://example.com/token.png");

    face.setImage(undefined);
    expect(image.isVisible).toBe(false);
    expect(smiley.isVisible).toBe(true);
  });

  it("setDiameter scales the plane uniformly (a circle stays a circle)", () => {
    const face = createCharacterTokenFace(makeScene(), "test", 1, new BABYLON.Color3(1, 0, 0));
    face.setDiameter(2.5);
    expect(face.mesh.scaling.x).toBeCloseTo(2.5, 5);
    expect(face.mesh.scaling.y).toBeCloseTo(2.5, 5);
    expect(face.mesh.scaling.z).toBeCloseTo(2.5, 5);
  });

  it("setColor re-tints the smiley fallback's own background", () => {
    const face = createCharacterTokenFace(makeScene(), "test", 1, new BABYLON.Color3(1, 0, 0));
    const circle = findControl<GUI.Ellipse>(face.texture.rootContainer, (c) => c instanceof GUI.Ellipse)!;
    face.setColor(new BABYLON.Color3(0, 1, 0));
    expect(circle.background).toBe("#00ff00");
  });

  it("the diameter the caller passes IS the plane's own initial world size", () => {
    const face = createCharacterTokenFace(makeScene(), "test", 0.6, new BABYLON.Color3(1, 0, 0));
    expect(face.mesh.scaling.x).toBeCloseTo(0.6, 5);
  });

  it("the smiley's own text color stays legible against both a light and a dark token color", () => {
    const face = createCharacterTokenFace(makeScene(), "test", 1, new BABYLON.Color3(1, 1, 1));
    const smiley = findControl<GUI.TextBlock>(face.texture.rootContainer, (c) => c instanceof GUI.TextBlock)!;
    expect(smiley.color).toBe("#000000"); // white background -> dark text

    face.setColor(new BABYLON.Color3(0, 0, 0));
    expect(smiley.color).toBe("#ffffff"); // black background -> light text
  });
});

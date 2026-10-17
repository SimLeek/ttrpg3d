import { describe, it, expect } from "vitest";
import * as BABYLON from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";
import { createCharacterToken } from "./characterToken.js";

function makeScene(): BABYLON.Scene {
  const engine = new BABYLON.NullEngine();
  return new BABYLON.Scene(engine);
}

describe("createCharacterToken (headless NullEngine -- data-binding only, real billboard/camera-facing behavior needs a real playtest)", () => {
  it("billboards on the Y axis and stays pickable (both the coarse camera-center pick and the GUI's own real-mouse hover/click pick target this same mesh)", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    expect(token.mesh.billboardMode).toBe(BABYLON.Mesh.BILLBOARDMODE_Y);
    expect(token.mesh.isPickable).toBe(true);
  });

  it("update() writes the character's name and hp/mp values onto the GUI text controls", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    token.update({ name: "Aria", hp: 3, maxHp: 10, mp: 7, maxMp: 10, statusEffects: [] });

    const texts: string[] = [];
    function collect(control: GUI.Control): void {
      if (control instanceof GUI.TextBlock) texts.push(control.text);
      if (control instanceof GUI.Container) {
        for (const child of control.children) collect(child);
      }
    }
    collect(token.texture.rootContainer);

    expect(texts).toContain("Aria");
    expect(texts.some((t) => t === "3/10")).toBe(true);
    expect(texts.some((t) => t === "7/10")).toBe(true);
  });

  it("status effects render one icon control per effect, and the row is hidden when empty", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    const statusRow = token.texture.rootContainer.children.find((c) => c instanceof GUI.StackPanel) as GUI.StackPanel;

    token.update({ name: "Aria", hp: 10, maxHp: 10, mp: 10, maxMp: 10, statusEffects: [] });
    expect(statusRow.isVisible).toBe(false);
    expect(statusRow.children.length).toBe(0);

    token.update({
      name: "Aria",
      hp: 10,
      maxHp: 10,
      mp: 10,
      maxMp: 10,
      statusEffects: [
        { icon: "poison.svg", label: "Poisoned" },
        { icon: "stun.svg", label: "Stunned" },
      ],
    });
    expect(statusRow.isVisible).toBe(true);
    expect(statusRow.children.length).toBe(2);
  });

  it("hitTestLocalPoint finds the HP bar above the MP bar, and returns undefined outside both (geometric hit-test -- replaces AdvancedDynamicTexture's own pointer hover, which can't work here since noa sets scene.skipPointerMovePicking). Local-space values here are negative, not a mistake: the plane is now sized to the content's real extent (TOKEN_PLANE_HEIGHT, not an arbitrary square -- see that constant's own doc), and both bars sit below the plane's own vertical center once the status/name row above them is accounted for.", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    expect(token.hitTestLocalPoint(0, -0.07)).toBe("hp");
    expect(token.hitTestLocalPoint(0, -0.21)).toBe("mp");
    expect(token.hitTestLocalPoint(0, -0.14)).toBeUndefined(); // gap between the two bars
    expect(token.hitTestLocalPoint(0.7, -0.07)).toBeUndefined(); // same height as the HP bar, but outside its width
    expect(token.hitTestLocalPoint(10, 10)).toBeUndefined(); // far outside the plane entirely
  });

  it("setHoveredBar gives the hovered bar a highlighted border and leaves the other at its default, clearing back to default for undefined", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    const [hpBackground, mpBackground] = token.texture.rootContainer.children.filter((c) => c instanceof GUI.Rectangle) as GUI.Rectangle[];

    token.setHoveredBar("hp");
    expect(hpBackground.thickness).toBeGreaterThan(mpBackground.thickness);
    expect(hpBackground.color).not.toBe(mpBackground.color);

    token.setHoveredBar("mp");
    expect(mpBackground.thickness).toBeGreaterThan(hpBackground.thickness);
    expect(mpBackground.color).not.toBe(hpBackground.color);

    token.setHoveredBar(undefined);
    expect(hpBackground.thickness).toBe(mpBackground.thickness);
    expect(hpBackground.color).toBe(mpBackground.color);
  });

  it("every root-level control is TOP/LEFT-anchored, not left at @babylonjs/gui's own default CENTER -- the real bug this investigation found, confirmed directly in GUI's Control constructor: default alignment makes `top`/`left` offsets FROM CENTER, not from the top-left corner this file's pixel<->local-space math (HP_BAR_TOP, BAR_LEFT, pixelRectToLocal) has always assumed, which is what actually caused every 'the bars are in the wrong place' report, not the raycast math (verified correct) or the plane sizing (a real, separate fix)", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    for (const control of token.texture.rootContainer.children) {
      expect(control.verticalAlignment).toBe(GUI.Control.VERTICAL_ALIGNMENT_TOP);
    }
    const rectangles = token.texture.rootContainer.children.filter((c) => c instanceof GUI.Rectangle) as GUI.Rectangle[];
    expect(rectangles.length).toBeGreaterThan(0); // sanity -- the HP/MP bar backgrounds should be there
    for (const rect of rectangles) {
      expect(rect.horizontalAlignment).toBe(GUI.Control.HORIZONTAL_ALIGNMENT_LEFT);
    }
  });

  it("dispose() disposes both the texture and the mesh without throwing", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    expect(() => token.dispose()).not.toThrow();
    expect(token.mesh.isDisposed()).toBe(true);
  });
});

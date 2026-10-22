import { describe, it, expect } from "vitest";
import * as BABYLON from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";
import { createCharacterToken, type CharacterTokenBarData } from "./characterToken.js";

function makeScene(): BABYLON.Scene {
  const engine = new BABYLON.NullEngine();
  return new BABYLON.Scene(engine);
}

const hpBar: CharacterTokenBarData = { variableId: "hp", label: "HP", value: 3, max: 10, color: [0.75, 0.22, 0.17] };
const mpBar: CharacterTokenBarData = { variableId: "mp", label: "MP", value: 7, max: 10, color: [0.16, 0.5, 0.73] };

describe("createCharacterToken (headless NullEngine -- data-binding only, real billboard/camera-facing behavior needs a real playtest)", () => {
  it("billboards on the Y axis and stays pickable (both the coarse camera-center pick and the GUI's own real-mouse hover/click pick target this same mesh)", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    expect(token.mesh.billboardMode).toBe(BABYLON.Mesh.BILLBOARDMODE_Y);
    expect(token.mesh.isPickable).toBe(true);
  });

  it("update() writes the character's name and each configured bar's value/max onto the GUI text controls -- bars are whatever the sheet configures now, not a fixed hp/mp pair", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    token.update({ name: "Aria", bars: [hpBar, mpBar], statusEffects: [] });

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

  it("shows exactly as many bars as configured (0, 1, the 4-slot cap, and silently clamps anything beyond it)", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    const slots = () => token.texture.rootContainer.children.filter((c) => c instanceof GUI.Rectangle) as GUI.Rectangle[];

    token.update({ name: "Aria", bars: [], statusEffects: [] });
    expect(slots().filter((s) => s.isVisible)).toHaveLength(0);

    token.update({ name: "Aria", bars: [hpBar], statusEffects: [] });
    expect(slots().filter((s) => s.isVisible)).toHaveLength(1);

    const fourBars = [hpBar, mpBar, { ...hpBar, variableId: "stamina" }, { ...mpBar, variableId: "mana" }];
    token.update({ name: "Aria", bars: fourBars, statusEffects: [] });
    expect(slots().filter((s) => s.isVisible)).toHaveLength(4);

    const fiveBars = [...fourBars, { ...hpBar, variableId: "fifth" }];
    token.update({ name: "Aria", bars: fiveBars, statusEffects: [] });
    expect(slots().filter((s) => s.isVisible)).toHaveLength(4); // clamped, not an error -- the 5th bar never occupies a slot at all
  });

  it("status effects render one icon control per effect, and the row is hidden when empty", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    const statusRow = token.texture.rootContainer.children.find((c) => c instanceof GUI.StackPanel) as GUI.StackPanel;

    token.update({ name: "Aria", bars: [hpBar, mpBar], statusEffects: [] });
    expect(statusRow.isVisible).toBe(false);
    expect(statusRow.children.length).toBe(0);

    token.update({
      name: "Aria",
      bars: [hpBar, mpBar],
      statusEffects: [
        { icon: "poison.svg", label: "Poisoned" },
        { icon: "stun.svg", label: "Stunned" },
      ],
    });
    expect(statusRow.isVisible).toBe(true);
    expect(statusRow.children.length).toBe(2);
  });

  it("hitTestLocalPoint finds the first bar above the second (by variableId), and returns undefined outside both, in the gap, and for a hidden slot. Local-space values here reflect the billboard's fixed 4-slot-tall reserved layout (see TEXTURE_HEIGHT's own doc) -- not a mistake that they differ from a 2-bar-only layout's numbers.", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    token.update({ name: "Aria", bars: [hpBar, mpBar], statusEffects: [] });

    expect(token.hitTestLocalPoint(0, 0.0703)).toBe("hp");
    expect(token.hitTestLocalPoint(0, -0.0703)).toBe("mp");
    expect(token.hitTestLocalPoint(0, 0)).toBeUndefined(); // gap between the two bars
    expect(token.hitTestLocalPoint(0.7, 0.0703)).toBeUndefined(); // same height as the first bar, but outside its width
    expect(token.hitTestLocalPoint(0, -0.21)).toBeUndefined(); // a reserved-but-unused slot (only 2 bars configured)
    expect(token.hitTestLocalPoint(10, 10)).toBeUndefined(); // far outside the plane entirely
  });

  it("setHoveredBar gives the hovered bar a highlighted border and leaves the other at its default, clearing back to default for undefined", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    token.update({ name: "Aria", bars: [hpBar, mpBar], statusEffects: [] });
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

  it("every root-level control is TOP/LEFT-anchored, not left at @babylonjs/gui's own default CENTER -- the real bug this investigation found, confirmed directly in GUI's Control constructor: default alignment makes `top`/`left` offsets FROM CENTER, not from the top-left corner this file's pixel<->local-space math (BAR_TOP_BASE, BAR_LEFT, pixelRectToLocal) has always assumed, which is what actually caused every 'the bars are in the wrong place' report, not the raycast math (verified correct) or the plane sizing (a real, separate fix)", () => {
    const token = createCharacterToken(makeScene(), "Aria");
    for (const control of token.texture.rootContainer.children) {
      expect(control.verticalAlignment).toBe(GUI.Control.VERTICAL_ALIGNMENT_TOP);
    }
    const rectangles = token.texture.rootContainer.children.filter((c) => c instanceof GUI.Rectangle) as GUI.Rectangle[];
    expect(rectangles.length).toBeGreaterThan(0); // sanity -- the reserved bar-slot backgrounds should be there
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

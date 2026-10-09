import { describe, it, expect } from "vitest";
import { WorldBottomCatch } from "./worldBottomCatch.js";

describe("WorldBottomCatch", () => {
  it("fires exactly once on the tick a position first crosses below the threshold", () => {
    const catcher = new WorldBottomCatch(-20);
    expect(catcher.update(5)).toBe(false); // well above
    expect(catcher.update(-19.9)).toBe(false); // still at-or-above
    expect(catcher.update(-20.1)).toBe(true); // crosses -- fires once
    expect(catcher.update(-25)).toBe(false); // still below, but not a NEW crossing
  });

  it("re-arms once back at-or-above, so a second fall fires again", () => {
    const catcher = new WorldBottomCatch(-20);
    expect(catcher.update(-25)).toBe(true);
    expect(catcher.update(0)).toBe(false); // back up
    expect(catcher.update(-21)).toBe(true); // falls again -- fires again
  });

  it("the exact threshold value is NOT below (strict <)", () => {
    const catcher = new WorldBottomCatch(-20);
    expect(catcher.update(-20)).toBe(false);
  });

  it("reset() re-arms immediately, even if the caller never moved back above the threshold", () => {
    const catcher = new WorldBottomCatch(-20);
    expect(catcher.update(-25)).toBe(true);
    catcher.reset();
    expect(catcher.update(-25)).toBe(true); // fires again despite being called with the same still-below y
  });

  it("Number.MIN_SAFE_INTEGER (WorldState.ts's real default for a genuinely bottomless generator -- see its own doc for why not literal -Infinity) never fires for any real gameplay y", () => {
    const catcher = new WorldBottomCatch(Number.MIN_SAFE_INTEGER);
    expect(catcher.update(0)).toBe(false);
    expect(catcher.update(-1e10)).toBe(false);
    expect(catcher.update(-1e15)).toBe(false); // deep, but still well above the sentinel
  });
});

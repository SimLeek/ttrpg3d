import { describe, it, expect } from "vitest";
import { registerModActions, getAllModActions } from "./modActionRegistry.js";
import { getAllModActions as getAllModActionsViaBootstrap } from "./modActions.js";

describe("modActionRegistry (real request, 2026-10-29 -- \"mods should be able to do this without elevated privileges\": a mod self-registers instead of being hardcoded by name in a shared file)", () => {
  it("registerModActions makes an action retrievable via getAllModActions, merging rather than replacing a mod's existing entries", () => {
    const before = Object.keys(getAllModActions()["a-test-mod"] ?? {});
    registerModActions("a-test-mod", { actionOne: () => {} });
    registerModActions("a-test-mod", { actionTwo: () => {} });

    const actions = getAllModActions()["a-test-mod"];
    expect(Object.keys(actions ?? {})).toEqual([...before, "actionOne", "actionTwo"]);
  });
});

describe("modActions.ts (real request, 2026-10-29 -- \"this file's only remaining job is the bootstrap list\")", () => {
  it("importing modActions.ts (its own side-effecting import of lyrianChronicles.js) actually registers that mod's real actions in the SAME registry getAllModActions reads from -- not just a type-check, a genuine runtime effect", () => {
    const actions = getAllModActionsViaBootstrap()["lyrian-chronicles"];
    expect(actions).toBeDefined();
    // A representative few, not an exhaustive list -- this is checking the WIRING (self-registration actually ran), not re-testing each action's own behavior (covered in mods/lyrianChronicles.test.ts).
    expect(typeof actions!.recalculateTraitsCosts).toBe("function");
    expect(typeof actions!.addAbility).toBe("function");
    expect(typeof actions!.addCombatLoadoutItem).toBe("function");
  });
});

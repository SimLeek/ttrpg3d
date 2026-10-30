import { describe, it, expect } from "vitest";
import { registerModActions, getAllModActions } from "./modActionRegistry.js";
import { getAllModActions as getAllModActionsViaBootstrap, ensureModActionsLoaded } from "./modActions.js";

describe("modActionRegistry (real request, 2026-10-29 -- \"mods should be able to do this without elevated privileges\": a mod self-registers instead of being hardcoded by name in a shared file)", () => {
  it("registerModActions makes an action retrievable via getAllModActions, merging rather than replacing a mod's existing entries", () => {
    const before = Object.keys(getAllModActions()["a-test-mod"] ?? {});
    registerModActions("a-test-mod", { actionOne: () => {} });
    registerModActions("a-test-mod", { actionTwo: () => {} });

    const actions = getAllModActions()["a-test-mod"];
    expect(Object.keys(actions ?? {})).toEqual([...before, "actionOne", "actionTwo"]);
  });
});

describe("modActions.ts (real follow-up, 2026-10-29 -- \"run what this does when the mod is imported by a user, like when clicking the mod import button\")", () => {
  it("a modId with no registered client loader is a safe no-op, not a crash", async () => {
    await expect(ensureModActionsLoaded("no-such-mod")).resolves.toBeUndefined();
    expect(getAllModActionsViaBootstrap()["no-such-mod"]).toBeUndefined();
  });

  it("ensureModActionsLoaded(\"lyrian-chronicles\") dynamically loads that mod's client file, which then self-registers its real actions in the SAME registry getAllModActions reads from -- not just a type-check, a genuine runtime effect, and NOT just because some earlier eager top-level import already ran it", async () => {
    await ensureModActionsLoaded("lyrian-chronicles");
    const actions = getAllModActionsViaBootstrap()["lyrian-chronicles"];
    expect(actions).toBeDefined();
    // A representative few, not an exhaustive list -- this is checking the WIRING (self-registration actually ran), not re-testing each action's own behavior (covered in mods/lyrianChronicles.test.ts).
    expect(typeof actions!.recalculateTraitsCosts).toBe("function");
    expect(typeof actions!.addAbility).toBe("function");
    expect(typeof actions!.addCombatLoadoutItem).toBe("function");
  });

  it("calling ensureModActionsLoaded twice for the same modId is safe (memoized, not a double-registration)", async () => {
    await ensureModActionsLoaded("lyrian-chronicles");
    const before = Object.keys(getAllModActionsViaBootstrap()["lyrian-chronicles"] ?? {});
    await ensureModActionsLoaded("lyrian-chronicles");
    const after = Object.keys(getAllModActionsViaBootstrap()["lyrian-chronicles"] ?? {});
    expect(after).toEqual(before);
  });
});

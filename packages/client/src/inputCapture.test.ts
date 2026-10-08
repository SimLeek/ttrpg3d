import { describe, it, expect, beforeEach } from "vitest";
import { requestCapture, releaseCapture, isCaptured } from "./inputCapture.js";

// The module holds its own Set at module scope, shared across tests in
// this file -- clean it between tests by releasing every reason any test
// might have requested, so tests don't leak state into each other.
function resetCapture(): void {
  for (const reason of ["a", "b", "inventory"]) releaseCapture(reason);
}

describe("inputCapture", () => {
  beforeEach(resetCapture);

  it("is not captured with no active reasons", () => {
    expect(isCaptured()).toBe(false);
  });

  it("is captured once any reason is requested", () => {
    requestCapture("inventory");
    expect(isCaptured()).toBe(true);
  });

  it("stays captured while at least one of several reasons is still active", () => {
    requestCapture("a");
    requestCapture("b");
    releaseCapture("a");
    expect(isCaptured()).toBe(true);
    releaseCapture("b");
    expect(isCaptured()).toBe(false);
  });

  it("releasing a reason that was never requested is a harmless no-op", () => {
    releaseCapture("never-requested");
    expect(isCaptured()).toBe(false);
  });

  it("requesting the same reason twice and releasing it once clears it", () => {
    requestCapture("a");
    requestCapture("a");
    releaseCapture("a");
    expect(isCaptured()).toBe(false);
  });
});

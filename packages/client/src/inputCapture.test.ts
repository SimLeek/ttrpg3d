import { describe, it, expect, beforeEach } from "vitest";
import { requestCapture, releaseCapture, isCaptured, isCapturedByOther } from "./inputCapture.js";

// The module holds its own Set at module scope, shared across tests in
// this file -- clean it between tests by releasing every reason any test
// might have requested, so tests don't leak state into each other.
function resetCapture(): void {
  for (const reason of ["a", "b", "inventory", "measurementShapes", "chat"]) releaseCapture(reason);
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

describe("isCapturedByOther (docs/BATTLE_SYSTEM.md's measurement shapes -- Measure mode can't block its own point-editing keys)", () => {
  beforeEach(resetCapture);

  it("is false when the ONLY active reason is the caller's own", () => {
    requestCapture("measurementShapes");
    expect(isCapturedByOther("measurementShapes")).toBe(false);
    expect(isCaptured()).toBe(true); // plain isCaptured() is still true -- a different consumer still sees it
  });

  it("is true when something ELSE is also capturing", () => {
    requestCapture("measurementShapes");
    requestCapture("chat");
    expect(isCapturedByOther("measurementShapes")).toBe(true);
  });

  it("is false when nothing is captured at all", () => {
    expect(isCapturedByOther("measurementShapes")).toBe(false);
  });
});

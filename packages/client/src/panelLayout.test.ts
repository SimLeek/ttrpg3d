import { describe, it, expect, afterEach } from "vitest";
import { setSafeAreaInset, observeSafeAreaInset } from "./panelLayout.js";

afterEach(() => {
  // Don't leak custom properties between tests.
  document.documentElement.style.removeProperty("--test-safe-area-var");
});

describe("setSafeAreaInset", () => {
  it("sets the given custom property to a rounded pixel value", () => {
    setSafeAreaInset("--test-safe-area-var", 42.6);
    expect(document.documentElement.style.getPropertyValue("--test-safe-area-var")).toBe("43px");
  });
});

describe("observeSafeAreaInset", () => {
  it("degrades to a no-op (not throwing) when ResizeObserver isn't available -- confirmed real in this project's jsdom test environment, not assumed", () => {
    expect(typeof ResizeObserver).toBe("undefined");
    const el = document.createElement("div");
    document.body.appendChild(el);
    let cleanup: (() => void) | undefined;
    expect(() => {
      cleanup = observeSafeAreaInset(el, "--test-safe-area-var", "width");
    }).not.toThrow();
    expect(() => cleanup?.()).not.toThrow();
    el.remove();
  });
});
